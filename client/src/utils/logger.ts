import { Effect, Layer, Logger, LogLevel } from 'effect';

/**
 * Client-side structured logger.
 * Uses Effect's JSON logger which outputs structured entries to the console.
 * In production, set minimum level to Info to reduce noise.
 */
const logLevel = import.meta.env.MODE === 'production' ? LogLevel.Info : LogLevel.Debug;

export const ClientLoggerLive = Layer.mergeAll(Logger.json, Logger.minimumLogLevel(logLevel));

/**
 * Helper to run an Effect with the client logger.
 */
export const runWithLogging = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(ClientLoggerLive), Effect.runPromise);
