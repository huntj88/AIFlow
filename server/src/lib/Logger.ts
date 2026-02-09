import { trace } from '@opentelemetry/api';
import { Cause, FiberId, HashMap, Layer, List, Logger, LogLevel } from 'effect';

/**
 * Wide structured JSON logger for the server.
 *
 * When OpenTelemetry is active, injects `trace_id` and `span_id` fields
 * into every log entry for trace correlation (Task 31).
 */
const traceCorrelatedJsonLogger = Logger.make<unknown, undefined>(
  ({ annotations, cause, date, fiberId, logLevel, message, spans }) => {
    const now = date.getTime();

    // Build structured entry matching Effect's JSON logger shape
    const entry: Record<string, unknown> = {
      timestamp: date.toISOString(),
      level: logLevel.label,
      fiber: FiberId.threadName(fiberId),
      message: serializeMessage(message),
    };

    // Spans with duration
    if (List.isCons(spans)) {
      const spanEntries: Record<string, number>[] = [];
      let current = spans as List.List<{ readonly label: string; readonly startTime: number }>;
      while (List.isCons(current)) {
        const span = current.head;
        spanEntries.push({ [span.label]: now - span.startTime });
        current = current.tail;
      }
      if (spanEntries.length > 0) entry.spans = spanEntries;
    }

    // Annotations
    if (HashMap.size(annotations) > 0) {
      const annots: Record<string, unknown> = {};
      for (const [key, value] of annotations) {
        annots[key] = value;
      }
      entry.annotations = annots;
    }

    // Cause (error chain)
    if (!Cause.isEmpty(cause)) {
      entry.cause = Cause.pretty(cause);
    }

    // OTel trace correlation — inject trace_id and span_id when active
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      entry.trace_id = spanContext.traceId;
      entry.span_id = spanContext.spanId;
    }

    const line = JSON.stringify(entry);
    globalThis.console.log(line);
  },
);

function serializeMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(serializeMessage).join(' ');
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

export const JsonLoggerLive = Logger.replace(Logger.defaultLogger, traceCorrelatedJsonLogger);

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
