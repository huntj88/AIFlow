/**
 * Middleware barrel export (Task 07)
 *
 * Re-exports all middleware, the executor, and provides a default
 * middleware stack in the recommended registration order.
 *
 * @module
 */

import type { TransitionMiddleware } from '../types.js';

import { AuditMiddleware } from './AuditMiddleware.js';
import { LoggingMiddleware } from './LoggingMiddleware.js';
import { TelemetryMiddleware } from './TelemetryMiddleware.js';
import { ValidationMiddleware } from './ValidationMiddleware.js';

export {
  MiddlewareExecutor,
  makeMiddlewareExecutor,
  makeMiddlewareExecutorLayer,
} from './MiddlewareExecutor.js';
export type { MiddlewareExecutor as MiddlewareExecutorInterface } from './MiddlewareExecutor.js';

export { ValidationMiddleware } from './ValidationMiddleware.js';
export { LoggingMiddleware } from './LoggingMiddleware.js';
export { AuditMiddleware, createAuditMiddleware } from './AuditMiddleware.js';
export type { AuditRecord, AuditMiddlewareInstance } from './AuditMiddleware.js';
export { TelemetryMiddleware } from './TelemetryMiddleware.js';

/**
 * Default middleware stack in recommended registration order.
 *
 * Before hooks fire in this order:
 *   1. ValidationMiddleware  — reject invalid data early
 *   2. LoggingMiddleware     — log state entry
 *   3. TelemetryMiddleware   — start timing
 *   4. AuditMiddleware       — (no before hook)
 *
 * After hooks fire in reverse:
 *   1. AuditMiddleware       — record audit trail
 *   2. TelemetryMiddleware   — record duration
 *   3. LoggingMiddleware     — log transition result
 *   4. ValidationMiddleware  — (no after hook)
 */
export const defaultMiddleware: TransitionMiddleware[] = [
  ValidationMiddleware,
  LoggingMiddleware,
  TelemetryMiddleware,
  AuditMiddleware,
];
