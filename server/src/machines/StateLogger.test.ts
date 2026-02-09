/**
 * StateLogger — Unit Tests (Task 06)
 *
 * Tests for the `StateLoggerFactory` and the `StateLogger` it produces.
 * Covers all 4 log levels, field structure, optional data, ordering,
 * and infallibility guarantees.
 *
 * @module
 */

import { Effect, Logger } from 'effect';
import { describe, expect, it, beforeEach } from 'vitest';

import { createStateLoggerFactory, type StateLoggerFactory } from './StateLogger.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'inst-test-001';
const STATE_NAME = 'process-data';

/** ISO 8601 regex (simplified). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

/** UUID v4 regex. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run a logger effect with a minimal Effect runtime, suppressing actual
 * console output by using a no-op logger layer.
 */
function runLogger(effect: Effect.Effect<void>): Promise<void> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('StateLoggerFactory', () => {
  let factory: StateLoggerFactory;

  beforeEach(() => {
    factory = createStateLoggerFactory();
  });

  it('creates a logger scoped to instanceId and stateName', async () => {
    const logger = factory.create(INSTANCE_ID, STATE_NAME);
    await runLogger(logger.info('hello'));

    const entries = factory.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].instanceId).toBe(INSTANCE_ID);
    expect(entries[0].stateName).toBe(STATE_NAME);
  });

  describe('log levels', () => {
    it.each(['debug', 'info', 'warn', 'error'] as const)(
      'produces a LogEntry with level "%s"',
      async (level) => {
        const logger = factory.create(INSTANCE_ID, STATE_NAME);
        await runLogger(logger[level](`${level} message`));

        const entries = factory.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe(level);
        expect(entries[0].message).toBe(`${level} message`);
      },
    );
  });

  describe('LogEntry fields', () => {
    it('includes a UUID id', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('test'));

      expect(factory.getEntries()[0].id).toMatch(UUID_RE);
    });

    it('includes an ISO timestamp', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('test'));

      expect(factory.getEntries()[0].timestamp).toMatch(ISO_DATE_RE);
    });

    it('captures optional data when provided', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      const testData = { key: 'value', count: 42 };
      await runLogger(logger.info('with data', testData));

      const entry = factory.getEntries()[0];
      expect(entry.data).toEqual(testData);
    });

    it('leaves data undefined when not provided', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('no data'));

      expect(factory.getEntries()[0].data).toBeUndefined();
    });

    it('produces unique ids for each entry', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('first'));
      await runLogger(logger.info('second'));
      await runLogger(logger.info('third'));

      const ids = factory.getEntries().map((e) => e.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('ordering', () => {
    it('collects entries in the order they are logged', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.debug('first'));
      await runLogger(logger.info('second'));
      await runLogger(logger.warn('third'));
      await runLogger(logger.error('fourth'));

      const messages = factory.getEntries().map((e) => e.message);
      expect(messages).toEqual(['first', 'second', 'third', 'fourth']);
    });

    it('interleaves entries from multiple loggers', async () => {
      const loggerA = factory.create(INSTANCE_ID, 'state-a');
      const loggerB = factory.create(INSTANCE_ID, 'state-b');

      await runLogger(loggerA.info('a1'));
      await runLogger(loggerB.info('b1'));
      await runLogger(loggerA.info('a2'));

      const entries = factory.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].stateName).toBe('state-a');
      expect(entries[1].stateName).toBe('state-b');
      expect(entries[2].stateName).toBe('state-a');
    });
  });

  describe('infallibility', () => {
    it('succeeds with an empty message', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info(''));

      expect(factory.getEntries()).toHaveLength(1);
      expect(factory.getEntries()[0].message).toBe('');
    });

    it('succeeds with undefined data', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('msg', undefined));

      expect(factory.getEntries()).toHaveLength(1);
    });

    it('succeeds with complex nested data', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      const complex = { nested: { deeply: { value: [1, 2, 3] } }, fn: 'string' };
      await runLogger(logger.debug('complex', complex));

      expect(factory.getEntries()[0].data).toEqual(complex);
    });

    it('succeeds with null data', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.warn('null data', null));

      expect(factory.getEntries()).toHaveLength(1);
      expect(factory.getEntries()[0].data).toBeNull();
    });
  });

  describe('clear()', () => {
    it('removes all collected entries', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('a'));
      await runLogger(logger.info('b'));

      expect(factory.getEntries()).toHaveLength(2);

      factory.clear();
      expect(factory.getEntries()).toHaveLength(0);
    });

    it('allows new entries after clearing', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      await runLogger(logger.info('before'));
      factory.clear();
      await runLogger(logger.info('after'));

      expect(factory.getEntries()).toHaveLength(1);
      expect(factory.getEntries()[0].message).toBe('after');
    });
  });

  describe('Effect.log annotations', () => {
    it('emits via Effect.log with correct annotations', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];

      // Create a custom logger to capture the Effect.log output
      const testLogger = Logger.make(({ message, annotations }) => {
        logMessages.push({
          message: typeof message === 'string' ? message : String(message),
          annotations: Object.fromEntries(annotations),
        });
      });

      await Effect.runPromise(
        logger
          .info('annotated msg', { foo: 'bar' })
          .pipe(
            Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
            Effect.withLogSpan('test'),
          ),
      );

      expect(logMessages).toHaveLength(1);
      expect(logMessages[0].annotations).toMatchObject({
        machineInstanceId: INSTANCE_ID,
        stateName: STATE_NAME,
        level: 'info',
        data: JSON.stringify({ foo: 'bar' }),
      });
    });

    it('omits data annotation when data is not provided', async () => {
      const logger = factory.create(INSTANCE_ID, STATE_NAME);
      const logMessages: { annotations: Record<string, unknown> }[] = [];

      const testLogger = Logger.make(({ annotations }) => {
        logMessages.push({ annotations: Object.fromEntries(annotations) });
      });

      await Effect.runPromise(
        logger
          .info('no data')
          .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))),
      );

      expect(logMessages).toHaveLength(1);
      expect(logMessages[0].annotations).not.toHaveProperty('data');
    });
  });
});
