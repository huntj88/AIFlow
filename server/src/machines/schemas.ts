/**
 * Effect Schema validators for all definition, instance, and API request/response types.
 *
 * Uses `Schema` from the `effect` package (v3.x consolidated — not `@effect/schema`).
 * These schemas are used for:
 * - API request body validation
 * - Store data integrity
 * - Runtime decode/encode of definition structures
 *
 * @module
 */

import { Schema } from 'effect';

// ────────────────────────────────────────────────────────────────────────────
// JSON Schema
// ────────────────────────────────────────────────────────────────────────────

/** Runtime validator for `JsonSchema` — a generic JSON Schema object. */
export const JsonSchemaSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

// ────────────────────────────────────────────────────────────────────────────
// Definition Schemas
// ────────────────────────────────────────────────────────────────────────────

/** Runtime validator for `ChildSpawnDefinition`. */
export const ChildSpawnDefinitionSchema = Schema.Struct({
  key: Schema.String,
  machineDefId: Schema.String,
  inputMapping: Schema.String,
});

/** The four allowed state types as a Schema union of literals. */
export const StateTypeSchema = Schema.Union(
  Schema.Literal('action'),
  Schema.Literal('child_machine'),
  Schema.Literal('parallel_children'),
  Schema.Literal('terminal'),
);

/** The two allowed parallel modes as a Schema union of literals. */
export const ParallelModeSchema = Schema.Union(
  Schema.Literal('all_or_interrupt'),
  Schema.Literal('all_settled'),
);

/** Runtime validator for `StateDefinition`. */
export const StateDefinitionSchema = Schema.Struct({
  name: Schema.String,
  type: StateTypeSchema,
  actionId: Schema.optional(Schema.String),
  childMachineDefId: Schema.optional(Schema.String),
  childInputMapping: Schema.optional(Schema.String),
  children: Schema.optional(Schema.Array(ChildSpawnDefinitionSchema)),
  description: Schema.optional(Schema.String),
  dataSchema: Schema.optional(JsonSchemaSchema),
  timeoutMs: Schema.optional(Schema.Number),
  parallelMode: Schema.optional(ParallelModeSchema),
});

/** Runtime validator for `TransitionRule`. */
export const TransitionRuleSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  label: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

/** Runtime validator for definition `metadata`. */
export const DefinitionMetadataSchema = Schema.Struct({
  createdAt: Schema.String,
  updatedAt: Schema.String,
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
});

/** Runtime validator for `StateMachineDefinition`. */
export const StateMachineDefinitionSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema,
  states: Schema.Record({ key: Schema.String, value: StateDefinitionSchema }),
  initialState: Schema.String,
  transitions: Schema.Array(TransitionRuleSchema),
  metadata: DefinitionMetadataSchema,
});

/**
 * Runtime validator for `CreateDefinitionRequest`.
 * Same as the full definition but without server-generated fields:
 * `id`, `version`, `metadata.createdAt`, `metadata.updatedAt`.
 */
export const CreateDefinitionRequestSchema = Schema.Struct({
  name: Schema.String,
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema,
  states: Schema.Record({ key: Schema.String, value: StateDefinitionSchema }),
  initialState: Schema.String,
  transitions: Schema.Array(TransitionRuleSchema),
  metadata: Schema.optional(
    Schema.Struct({
      description: Schema.optional(Schema.String),
      tags: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

/**
 * Runtime validator for `UpdateDefinitionRequest`.
 * Same as create — server manages `id`, `version`, and timestamps.
 */
export const UpdateDefinitionRequestSchema = CreateDefinitionRequestSchema;

// ────────────────────────────────────────────────────────────────────────────
// Instance Schemas
// ────────────────────────────────────────────────────────────────────────────

/** Runtime validator for `StartInstanceRequest`. */
export const StartInstanceRequestSchema = Schema.Struct({
  definitionId: Schema.String,
  input: Schema.Unknown,
});

/** The six allowed instance statuses as a Schema union of literals. */
export const InstanceStatusSchema = Schema.Union(
  Schema.Literal('running'),
  Schema.Literal('completed'),
  Schema.Literal('cancelled'),
  Schema.Literal('error'),
  Schema.Literal('waiting_for_child'),
  Schema.Literal('suspended'),
);

/** Runtime validator for `TransitionRecord`. */
export const TransitionRecordSchema = Schema.Struct({
  id: Schema.String,
  fromState: Schema.String,
  toState: Schema.String,
  data: Schema.optional(Schema.Unknown),
  timestamp: Schema.String,
  durationMs: Schema.Number,
  actionId: Schema.optional(Schema.String),
  childInstanceId: Schema.optional(Schema.String),
  childDefinitionId: Schema.optional(Schema.String),
  childInstanceIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  middlewareResults: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

/** Log level literals. */
export const LogLevelSchema = Schema.Union(
  Schema.Literal('debug'),
  Schema.Literal('info'),
  Schema.Literal('warn'),
  Schema.Literal('error'),
);

/** Runtime validator for `LogEntry`. */
export const LogEntrySchema = Schema.Struct({
  id: Schema.String,
  instanceId: Schema.String,
  stateName: Schema.String,
  level: LogLevelSchema,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
  timestamp: Schema.String,
});

/** Runtime validator for `ArtifactMetadata`. */
export const ArtifactMetadataSchema = Schema.Struct({
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
}).annotations({ additionalProperties: true });

/** Runtime validator for `ArtifactRecord`. */
export const ArtifactRecordSchema = Schema.Struct({
  name: Schema.String,
  instanceId: Schema.String,
  stateName: Schema.String,
  size: Schema.Number,
  mimeType: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  createdAt: Schema.String,
});

/** Runtime validator for `MachineInstance`. */
export const MachineInstanceSchema = Schema.Struct({
  id: Schema.String,
  definitionId: Schema.String,
  definitionVersion: Schema.Number,
  status: InstanceStatusSchema,
  currentState: Schema.String,
  stateData: Schema.Unknown,
  input: Schema.Unknown,
  output: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  parentInstanceId: Schema.optional(Schema.String),
  childInstanceId: Schema.optional(Schema.String),
  childInstanceIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  history: Schema.Array(TransitionRecordSchema),
  logs: Schema.Array(LogEntrySchema),
  artifacts: Schema.Array(ArtifactRecordSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

/** Runtime validator for `InstanceFilter` (query parameters). */
export const InstanceFilterSchema = Schema.Struct({
  status: Schema.optional(InstanceStatusSchema),
  definitionId: Schema.optional(Schema.String),
  parentInstanceId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});

// ────────────────────────────────────────────────────────────────────────────
// Response Schemas
// ────────────────────────────────────────────────────────────────────────────

/** Runtime validator for definition validation error responses (§2.4). */
export const DefinitionErrorResponseSchema = Schema.Struct({
  message: Schema.String,
  details: Schema.Array(Schema.String),
});

/** Runtime validator for "not found" responses (§21.1). */
export const NotFoundResponseSchema = Schema.Struct({
  message: Schema.String,
  id: Schema.String,
});

// ────────────────────────────────────────────────────────────────────────────
// Decode Utilities
// ────────────────────────────────────────────────────────────────────────────

/** Decode an unknown value as a `CreateDefinitionRequest`. Returns `Either<A, ParseError>`. */
export const decodeCreateDefinition = Schema.decodeUnknownEither(CreateDefinitionRequestSchema);

/** Decode an unknown value as an `UpdateDefinitionRequest`. Returns `Either<A, ParseError>`. */
export const decodeUpdateDefinition = Schema.decodeUnknownEither(UpdateDefinitionRequestSchema);

/** Decode an unknown value as a `StartInstanceRequest`. Returns `Either<A, ParseError>`. */
export const decodeStartInstance = Schema.decodeUnknownEither(StartInstanceRequestSchema);

/** Decode an unknown value as a `StateMachineDefinition`. Returns `Either<A, ParseError>`. */
export const decodeDefinition = Schema.decodeUnknownEither(StateMachineDefinitionSchema);

/** Decode an unknown value as a `MachineInstance`. Returns `Either<A, ParseError>`. */
export const decodeInstance = Schema.decodeUnknownEither(MachineInstanceSchema);

/** Decode an unknown value as an `InstanceFilter`. Returns `Either<A, ParseError>`. */
export const decodeInstanceFilter = Schema.decodeUnknownEither(InstanceFilterSchema);
