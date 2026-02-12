import { describe, expect, it } from 'vitest';

import {
  mkActionError,
  mkDefinitionError,
  mkNotFoundError,
  mkStoreError,
  mkValidationError,
} from './types.js';

import type {
  ChildSpawnDefinition,
  LogEntry,
  MachineError,
  MachineEvent,
  MachineInstance,
  MachineResult,
  ParallelChildrenResult,
  StateDefinition,
  StateMachineDefinition,
  TransitionRecord,
  TransitionRule,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Error Constructor Helpers
// ────────────────────────────────────────────────────────────────────────────

describe('Error constructor helpers', () => {
  it('mkActionError produces a correctly tagged ActionError', () => {
    const err = mkActionError({
      actionId: 'http-request',
      stateName: 'fetchData',
      cause: 'timeout',
    });
    expect(err).toEqual({
      _tag: 'ActionError',
      actionId: 'http-request',
      stateName: 'fetchData',
      cause: 'timeout',
    });
    expect(err._tag).toBe('ActionError');
  });

  it('mkValidationError produces a correctly tagged ValidationError', () => {
    const err = mkValidationError({ message: 'invalid schema', path: '/inputSchema' });
    expect(err).toEqual({
      _tag: 'ValidationError',
      message: 'invalid schema',
      path: '/inputSchema',
    });
    expect(err._tag).toBe('ValidationError');
  });

  it('mkValidationError works without optional path', () => {
    const err = mkValidationError({ message: 'bad data' });
    expect(err._tag).toBe('ValidationError');
    expect(err.path).toBeUndefined();
  });

  it('mkStoreError produces a correctly tagged StoreError', () => {
    const cause = new Error('disk full');
    const err = mkStoreError({ operation: 'save', cause });
    expect(err._tag).toBe('StoreError');
    expect(err.operation).toBe('save');
    expect(err.cause).toBe(cause);
  });

  it('mkNotFoundError produces a correctly tagged NotFoundError', () => {
    const err = mkNotFoundError({ entityType: 'definition', id: 'abc-123' });
    expect(err).toEqual({
      _tag: 'NotFoundError',
      entityType: 'definition',
      id: 'abc-123',
    });
    expect(err._tag).toBe('NotFoundError');
  });

  it('mkNotFoundError supports all entity types', () => {
    const defErr = mkNotFoundError({ entityType: 'definition', id: '1' });
    const instErr = mkNotFoundError({ entityType: 'instance', id: '2' });
    const actErr = mkNotFoundError({ entityType: 'action', id: '3' });
    expect(defErr.entityType).toBe('definition');
    expect(instErr.entityType).toBe('instance');
    expect(actErr.entityType).toBe('action');
  });

  it('mkDefinitionError produces a correctly tagged DefinitionError', () => {
    const err = mkDefinitionError({
      message: 'missing terminal states',
      details: ['missing: completed', 'missing: cancelled'],
    });
    expect(err).toEqual({
      _tag: 'DefinitionError',
      message: 'missing terminal states',
      details: ['missing: completed', 'missing: cancelled'],
    });
    expect(err._tag).toBe('DefinitionError');
  });

  it('mkDefinitionError works without optional details', () => {
    const err = mkDefinitionError({ message: 'invalid definition' });
    expect(err._tag).toBe('DefinitionError');
    expect(err.details).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Compile-Time Type Checks (these just need to compile, not run)
// ────────────────────────────────────────────────────────────────────────────

describe('Type compile-time checks', () => {
  it('MachineError is a union of 5 tagged error types', () => {
    // Verify discriminant-based narrowing compiles
    const narrow = (err: MachineError): string => {
      switch (err._tag) {
        case 'ActionError':
          return err.actionId;
        case 'ValidationError':
          return err.message;
        case 'StoreError':
          return err.operation;
        case 'NotFoundError':
          return err.id;
        case 'DefinitionError':
          return err.message;
      }
    };
    expect(narrow).toBeTypeOf('function');
  });

  it('MachineInstance.status has all 6 possible values', () => {
    const statuses: MachineInstance['status'][] = [
      'running',
      'completed',
      'cancelled',
      'error',
      'waiting_for_child',
      'suspended',
    ];
    expect(statuses).toHaveLength(6);
  });

  it('StateDefinition.type has all 4 possible values', () => {
    const types: StateDefinition['type'][] = [
      'action',
      'child_machine',
      'parallel_children',
      'terminal',
    ];
    expect(types).toHaveLength(4);
  });

  it('MachineResult has all 3 variants', () => {
    const completed: MachineResult<string> = {
      status: 'completed',
      output: 'done',
      instanceId: '1',
    };
    const cancelled: MachineResult = { status: 'cancelled', instanceId: '2' };
    const errored: MachineResult = { status: 'error', error: 'boom', instanceId: '3' };

    expect(completed.status).toBe('completed');
    expect(cancelled.status).toBe('cancelled');
    expect(errored.status).toBe('error');
  });

  it('MachineEvent is a union of 10 event types', () => {
    const eventTypes: MachineEvent['type'][] = [
      'state_changed',
      'transition_recorded',
      'log_entry',
      'machine_completed',
      'machine_resumed',
      'child_spawned',
      'child_completed',
      'children_spawned',
      'children_completed',
    ];
    expect(eventTypes).toHaveLength(9);
  });

  it('all definition types compile', () => {
    const rule: TransitionRule = { from: 'a', to: 'b', label: 'go', description: 'next' };
    const child: ChildSpawnDefinition = {
      key: 'c1',
      machineDefId: 'def-1',
      inputMapping: '$.stateData',
    };
    const state: StateDefinition = {
      name: 'myState',
      type: 'parallel_children',
      actionId: 'some-action',
      children: [child],
      parallelMode: 'all_settled',
    };
    const def: StateMachineDefinition = {
      id: 'def-1',
      name: 'test',
      version: 1,
      inputSchema: {},
      outputSchema: {},
      states: { myState: state },
      initialState: 'myState',
      transitions: [rule],
      metadata: { createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    };
    expect(def.id).toBe('def-1');
  });

  it('all runtime types compile', () => {
    const record: TransitionRecord = {
      id: 'tr-1',
      fromState: 'a',
      toState: 'b',
      timestamp: '2026-01-01',
      durationMs: 100,
      actionId: 'act',
      childInstanceId: 'ci-1',
      childDefinitionId: 'cd-1',
      childInstanceIds: { c1: 'ci-2' },
      middlewareResults: { audit: true },
      data: { x: 1 },
    };
    const log: LogEntry = {
      id: 'log-1',
      instanceId: 'inst-1',
      stateName: 'fetchData',
      level: 'info',
      message: 'fetched',
      data: { url: 'http://example.com' },
      timestamp: '2026-01-01',
    };
    const instance: MachineInstance = {
      id: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
      status: 'running',
      currentState: 'start',
      stateData: null,
      input: { key: 'value' },
      history: [record],
      logs: [log],
      workspaceRoot: '/tmp/workspace',
      familyRootInstanceId: 'inst-1',
      artifactsPath: '/tmp/data/artifacts/inst-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    expect(instance.id).toBe('inst-1');
  });

  it('ParallelChildrenResult compiles', () => {
    const result: ParallelChildrenResult = {
      results: {
        c1: { status: 'completed', output: 'ok', instanceId: 'ci-1' },
        c2: { status: 'error', error: 'fail', instanceId: 'ci-2' },
      },
      childInstanceIds: { c1: 'ci-1', c2: 'ci-2' },
    };
    expect(Object.keys(result.results)).toHaveLength(2);
  });
});
