import { HttpMiddleware } from '@effect/platform';

/**
 * Middleware that logs every incoming request with method, URL, status, and duration.
 * Uses Effect's built-in HttpMiddleware.logger which integrates with the configured logger layer.
 */
export const withRequestLogging = HttpMiddleware.logger;
