import { Layer, Logger, LogLevel } from 'effect';

/**
 * Wide structured JSON logger for the server.
 * Outputs one JSON line per log entry with:
 *   timestamp, level, message, spans (with duration), annotations, fiber
 */
export const JsonLoggerLive = Logger.json;

/**
 * Minimum log level — Debug in dev, Info in production.
 */
export const LogLevelLive = Logger.minimumLogLevel(
  process.env.NODE_ENV === 'production' ? LogLevel.Info : LogLevel.Debug,
);

/**
 * Combined logger layer for the server.
 */
export const ServerLoggerLive = Layer.mergeAll(JsonLoggerLive, LogLevelLive);
