#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001/api/machines}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(pwd -P)}"
ARTIFACT_DIR="${ARTIFACT_DIR:-${WORKSPACE_ROOT}/.aiflow-artifacts}"
MACHINE_NAME="${MACHINE_NAME:-dev-copilot-cli-workflow}"
WORKFLOW_TAG="${WORKFLOW_TAG:-dev-copilot-workflow}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-180}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required" >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

RESPONSE_STATUS=""
RESPONSE_BODY=""

request_json() {
  local method="$1"
  local url="$2"
  local data="${3:-}"

  local tmp
  tmp="$(mktemp)"

  if [[ -n "$data" ]]; then
    RESPONSE_STATUS="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$data")"
  else
    RESPONSE_STATUS="$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url")"
  fi

  RESPONSE_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

parse_existing_definition_id() {
  local json="$1"
  local name="$2"
  local tag="$3"

  node -e '
const input = process.argv[1];
const name = process.argv[2];
const tag = process.argv[3];
let parsed;
try {
  parsed = JSON.parse(input);
} catch (error) {
  console.error("malformed JSON from GET /definitions:", String(error));
  process.exit(10);
}
if (!Array.isArray(parsed)) {
  console.error("malformed payload from GET /definitions: expected array");
  process.exit(11);
}
const found = parsed.find((item) => {
  if (!item || typeof item !== "object") return false;
  if (item.name === name) return true;
  const tags = item.metadata && Array.isArray(item.metadata.tags) ? item.metadata.tags : [];
  return tags.includes(tag);
});
if (!found) {
  process.stdout.write("");
  process.exit(0);
}
if (typeof found.id !== "string" || found.id.length === 0) {
  console.error("definition match found but id missing");
  process.exit(12);
}
process.stdout.write(found.id);
' "$json" "$name" "$tag"
}

extract_required_id() {
  local json="$1"
  local label="$2"

  node -e '
const input = process.argv[1];
const label = process.argv[2];
let parsed;
try {
  parsed = JSON.parse(input);
} catch (error) {
  console.error(`malformed JSON from ${label}:`, String(error));
  process.exit(20);
}
const id = parsed && typeof parsed.id === "string" ? parsed.id : "";
if (!id) {
  console.error(`${label} response missing required id`);
  process.exit(21);
}
process.stdout.write(id);
' "$json" "$label"
}

extract_instance_fields() {
  local json="$1"

  node -e '
const input = process.argv[1];
let parsed;
try {
  parsed = JSON.parse(input);
} catch (error) {
  console.error("malformed JSON while polling instance:", String(error));
  process.exit(30);
}
const status = typeof parsed.status === "string" ? parsed.status : "";
const currentState = typeof parsed.currentState === "string" ? parsed.currentState : "";
const conversationId =
  parsed && parsed.stateData && typeof parsed.stateData.conversationId === "string"
    ? parsed.stateData.conversationId
    : "";
if (!status || !currentState) {
  console.error("instance payload missing status/currentState");
  process.exit(31);
}
process.stdout.write(JSON.stringify({ status, currentState, conversationId }));
' "$json"
}

DEFINITION_PAYLOAD="$(cat <<JSON
{
  "name": "$MACHINE_NAME",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "initialState": "runCopilot",
  "states": {
    "runCopilot": {
      "name": "runCopilot",
      "type": "action",
      "actionId": "copilot-cli-prompt"
    },
    "handleExecError": {
      "name": "handleExecError",
      "type": "action",
      "actionId": "handle-copilot-exec-error"
    },
    "completed": { "name": "completed", "type": "terminal" },
    "cancelled": { "name": "cancelled", "type": "terminal" },
    "error": { "name": "error", "type": "terminal" }
  },
  "transitions": [
    { "from": "runCopilot", "to": "completed" },
    { "from": "runCopilot", "to": "handleExecError" },
    { "from": "runCopilot", "to": "error" },
    { "from": "handleExecError", "to": "completed" },
    { "from": "handleExecError", "to": "error" }
  ],
  "metadata": {
    "description": "Developer curl workflow for copilot-cli-prompt",
    "tags": ["dev", "$WORKFLOW_TAG"]
  }
}
JSON
)"

echo "[1/5] Discovering existing definition..."
request_json GET "$BASE_URL/definitions"
if [[ "$RESPONSE_STATUS" != "200" ]]; then
  echo "error: GET /definitions failed with status $RESPONSE_STATUS" >&2
  echo "$RESPONSE_BODY" >&2
  exit 2
fi

existing_definition_id="$(parse_existing_definition_id "$RESPONSE_BODY" "$MACHINE_NAME" "$WORKFLOW_TAG")"
definition_id=""

if [[ -n "$existing_definition_id" ]]; then
  echo "[2/5] Upsert branch: update (definitionId=$existing_definition_id)"
  request_json PUT "$BASE_URL/definitions/$existing_definition_id" "$DEFINITION_PAYLOAD"

  if [[ "$RESPONSE_STATUS" == "404" || "$RESPONSE_STATUS" == "409" ]]; then
    echo "[2/5] PUT returned $RESPONSE_STATUS, retrying once via create branch"
    request_json POST "$BASE_URL/definitions" "$DEFINITION_PAYLOAD"
    if [[ "$RESPONSE_STATUS" != "201" ]]; then
      echo "error: POST retry failed with status $RESPONSE_STATUS" >&2
      echo "$RESPONSE_BODY" >&2
      exit 3
    fi
    definition_id="$(extract_required_id "$RESPONSE_BODY" "POST /definitions (retry)")"
    echo "[2/5] Upsert branch finalized: create (definitionId=$definition_id)"
  else
    if [[ "$RESPONSE_STATUS" != "200" ]]; then
      echo "error: PUT /definitions/$existing_definition_id failed with status $RESPONSE_STATUS" >&2
      echo "$RESPONSE_BODY" >&2
      exit 4
    fi
    definition_id="$(extract_required_id "$RESPONSE_BODY" "PUT /definitions/:id")"
  fi
else
  echo "[2/5] Upsert branch: create"
  request_json POST "$BASE_URL/definitions" "$DEFINITION_PAYLOAD"
  if [[ "$RESPONSE_STATUS" != "201" ]]; then
    echo "error: POST /definitions failed with status $RESPONSE_STATUS" >&2
    echo "$RESPONSE_BODY" >&2
    exit 5
  fi
  definition_id="$(extract_required_id "$RESPONSE_BODY" "POST /definitions")"
fi

echo "[2/5] Selected definitionId=$definition_id"

start_instance() {
  local prompt="$1"
  local conversation_id="${2:-}"

  local input_json
  if [[ -n "$conversation_id" ]]; then
    input_json="{\"prompt\":\"$prompt\",\"conversationId\":\"$conversation_id\",\"successState\":\"completed\",\"execErrorState\":\"handleExecError\"}"
  else
    input_json="{\"prompt\":\"$prompt\",\"successState\":\"completed\",\"execErrorState\":\"handleExecError\"}"
  fi

  local payload
  payload="$(cat <<JSON
{
  "definitionId": "$definition_id",
  "input": $input_json,
  "workspaceRoot": "$WORKSPACE_ROOT",
  "runtimeOptions": {
    "cliDirectoryPolicy": {
      "workspaceDirs": ["$WORKSPACE_ROOT"],
      "artifactDirs": ["$ARTIFACT_DIR"]
    },
    "cliOutputCapture": { "enabled": true }
  }
}
JSON
)"

  request_json POST "$BASE_URL/instances" "$payload"
  if [[ "$RESPONSE_STATUS" != "201" ]]; then
    echo "error: POST /instances failed with status $RESPONSE_STATUS" >&2
    echo "$RESPONSE_BODY" >&2
    exit 6
  fi

  extract_required_id "$RESPONSE_BODY" "POST /instances"
}

poll_instance_to_terminal() {
  local instance_id="$1"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    request_json GET "$BASE_URL/instances/$instance_id"
    if [[ "$RESPONSE_STATUS" != "200" ]]; then
      echo "error: GET /instances/$instance_id failed with status $RESPONSE_STATUS" >&2
      echo "$RESPONSE_BODY" >&2
      exit 7
    fi

    local fields
    fields="$(extract_instance_fields "$RESPONSE_BODY")"

    local status current_state
    status="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.status);' "$fields")"
    current_state="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.currentState);' "$fields")"

    echo "[$(date -Iseconds)] instance=$instance_id status=$status currentState=$current_state" >&2

    if [[ "$status" == "completed" || "$status" == "error" || "$status" == "cancelled" ]]; then
      echo "$RESPONSE_BODY"
      return 0
    fi

    local now elapsed
    now="$(date +%s)"
    elapsed="$((now - start_ts))"
    if (( elapsed > POLL_TIMEOUT_SECONDS )); then
      echo "error: polling timeout after ${POLL_TIMEOUT_SECONDS}s for instance $instance_id" >&2
      exit 8
    fi

    sleep "$POLL_INTERVAL_SECONDS"
  done
}

echo "[3/5] Starting first copilot instance (helloWorld.md request)..."
first_instance_id="$(start_instance "Create helloWorld.md with a short greeting.")"
echo "[3/5] first instance id=$first_instance_id"

first_final="$(poll_instance_to_terminal "$first_instance_id")"
first_status="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.status);' "$first_final")"
first_reason="$(node -e '
const v=JSON.parse(process.argv[1]);
const reason = v && v.stateData && typeof v.stateData.reason === "string" ? v.stateData.reason : "";
process.stdout.write(reason);
' "$first_final")"
first_conversation_id="$(node -e '
const v=JSON.parse(process.argv[1]);
const cid = v && v.stateData && typeof v.stateData.conversationId === "string" ? v.stateData.conversationId : "";
process.stdout.write(cid);
' "$first_final")"

echo "[4/5] First run terminal status=$first_status"

if [[ -z "$first_conversation_id" ]]; then
  echo "error: first run did not return stateData.conversationId; cannot demonstrate chaining" >&2
  if [[ "$first_reason" == "missing_conversation_id" ]]; then
    echo "hint: your installed Copilot CLI may not support the flags expected by the server action (e.g. --allow-dir / --conversation-id)." >&2
    echo "hint: current Copilot CLI versions commonly use --add-dir and --resume <sessionId>." >&2
  fi
  echo "$first_final" >&2
  exit 9
fi

echo "[4/5] conversationId from first run=$first_conversation_id"
echo "[5/5] Starting follow-up run with forwarded conversationId..."

second_instance_id="$(start_instance "Follow up in same conversation and update helloWorld.md with one extra line." "$first_conversation_id")"
echo "[5/5] second instance id=$second_instance_id"

second_final="$(poll_instance_to_terminal "$second_instance_id")"
second_status="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.status);' "$second_final")"
second_conversation_id="$(node -e '
const v=JSON.parse(process.argv[1]);
const cid = v && v.stateData && typeof v.stateData.conversationId === "string" ? v.stateData.conversationId : "";
process.stdout.write(cid);
' "$second_final")"

echo "done: firstStatus=$first_status secondStatus=$second_status"
echo "done: firstConversationId=$first_conversation_id secondConversationId=$second_conversation_id"

if [[ -n "$second_conversation_id" && "$second_conversation_id" != "$first_conversation_id" ]]; then
  echo "warning: follow-up returned a different conversationId" >&2
fi
