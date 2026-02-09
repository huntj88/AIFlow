import { FetchHttpClient, HttpBody, HttpClient } from '@effect/platform';
import { Effect } from 'effect';

import type {
  ActionMetadata,
  ArtifactRecord,
  ArtifactTree,
  InstanceFilter,
  LogEntry,
  MachineInstance,
  StateMachineDefinition,
  TransitionRecord,
} from '../types/machines';

// ────────────────────────────────────────────────────────────────────────────
// HTTP Helpers
// ────────────────────────────────────────────────────────────────────────────

const makeGet = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.GET ${path}`),
  );

const makePost = (path: string, body: unknown) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const jsonBody = yield* HttpBody.json(body);
    const response = yield* client.post(path, { body: jsonBody });
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.POST ${path}`),
  );

const makePut = (path: string, body: unknown) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const jsonBody = yield* HttpBody.json(body);
    const response = yield* client.put(path, { body: jsonBody });
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.PUT ${path}`),
  );

const makeDelete = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    yield* client.del(path);
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap(() => Effect.log('API delete succeeded', { path })),
    Effect.withLogSpan(`api.DELETE ${path}`),
  );

const makeGetBinary = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* response.arrayBuffer;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap(() => Effect.log('API binary response received', { path })),
    Effect.withLogSpan(`api.GET ${path}`),
  );

// ────────────────────────────────────────────────────────────────────────────
// Query String Builder
// ────────────────────────────────────────────────────────────────────────────

const buildQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return (
    '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  );
};

// ────────────────────────────────────────────────────────────────────────────
// API Client
// ────────────────────────────────────────────────────────────────────────────

export const apiClient = {
  // ── Hello ────────────────────────────────────────────────────────────────
  hello: () => makeGet('/api/hello') as Effect.Effect<{ message: string }, Error>,

  // ── Definitions ──────────────────────────────────────────────────────────

  /** List all state machine definitions. */
  getDefinitions: () =>
    makeGet('/api/machines/definitions') as Effect.Effect<StateMachineDefinition[], Error>,

  /** Get a single definition by ID. */
  getDefinition: (id: string) =>
    makeGet(`/api/machines/definitions/${encodeURIComponent(id)}`) as Effect.Effect<
      StateMachineDefinition,
      Error
    >,

  /** Create a new state machine definition. */
  createDefinition: (body: Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>) =>
    makePost('/api/machines/definitions', body) as Effect.Effect<StateMachineDefinition, Error>,

  /** Update an existing definition (bumps version). */
  updateDefinition: (
    id: string,
    body: Partial<Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>>,
  ) =>
    makePut(`/api/machines/definitions/${encodeURIComponent(id)}`, body) as Effect.Effect<
      StateMachineDefinition,
      Error
    >,

  /** Delete a definition. Returns void on success (204). */
  deleteDefinition: (id: string) =>
    makeDelete(`/api/machines/definitions/${encodeURIComponent(id)}`) as Effect.Effect<void, Error>,

  // ── Actions ──────────────────────────────────────────────────────────────

  /** List all registered actions with their metadata. */
  getActions: () => makeGet('/api/machines/actions') as Effect.Effect<ActionMetadata[], Error>,

  /** Get metadata for a single action. */
  getAction: (id: string) =>
    makeGet(`/api/machines/actions/${encodeURIComponent(id)}`) as Effect.Effect<
      ActionMetadata,
      Error
    >,

  // ── Instances ────────────────────────────────────────────────────────────

  /** Start a new machine instance (returns immediately — instance runs in background). */
  startInstance: (definitionId: string, input: unknown) =>
    makePost('/api/machines/instances', { definitionId, input }) as Effect.Effect<
      MachineInstance,
      Error
    >,

  /** List machine instances with optional filters. */
  getInstances: (filter?: InstanceFilter) =>
    makeGet('/api/machines/instances' + buildQuery({ ...filter })) as Effect.Effect<
      MachineInstance[],
      Error
    >,

  /** Get a single machine instance by ID. */
  getInstance: (id: string) =>
    makeGet(`/api/machines/instances/${encodeURIComponent(id)}`) as Effect.Effect<
      MachineInstance,
      Error
    >,

  /** Get transition history for an instance. */
  getInstanceHistory: (id: string) =>
    makeGet(`/api/machines/instances/${encodeURIComponent(id)}/history`) as Effect.Effect<
      TransitionRecord[],
      Error
    >,

  /** Get log entries for an instance, optionally filtered by state. */
  getInstanceLogs: (id: string, state?: string) =>
    makeGet(
      `/api/machines/instances/${encodeURIComponent(id)}/logs` + buildQuery({ state }),
    ) as Effect.Effect<LogEntry[], Error>,

  /** Cancel a running instance. */
  cancelInstance: (id: string) =>
    makePost(`/api/machines/instances/${encodeURIComponent(id)}/cancel`, {}) as Effect.Effect<
      { message: string },
      Error
    >,

  /** Resume a suspended instance. */
  resumeInstance: (id: string) =>
    makePost(`/api/machines/instances/${encodeURIComponent(id)}/resume`, {}) as Effect.Effect<
      { message: string },
      Error
    >,

  // ── Artifacts ────────────────────────────────────────────────────────────

  /** Get flat list of artifacts for an instance. */
  getInstanceArtifacts: (id: string) =>
    makeGet(`/api/machines/instances/${encodeURIComponent(id)}/artifacts`) as Effect.Effect<
      ArtifactRecord[],
      Error
    >,

  /** Get recursive artifact tree for an instance and its children. */
  getInstanceArtifactTree: (id: string) =>
    makeGet(
      `/api/machines/instances/${encodeURIComponent(id)}/artifacts?tree=true`,
    ) as Effect.Effect<ArtifactTree, Error>,

  /** Download a specific artifact as binary content. */
  downloadArtifact: (instanceId: string, name: string) =>
    makeGetBinary(
      `/api/machines/instances/${encodeURIComponent(instanceId)}/artifacts/${encodeURIComponent(name)}`,
    ) as Effect.Effect<ArrayBuffer, Error>,
};
