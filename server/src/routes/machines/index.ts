/**
 * Combined machine routes barrel (Task 21).
 *
 * Merges all machine sub-routers into a single `MachineRouter` that
 * is mounted alongside the existing `HelloRouter` in `HttpServer.ts`.
 *
 * @module
 */

import { HttpRouter } from '@effect/platform';

import { ActionsRouter } from './actions.js';
import { DefinitionsRouter } from './definitions.js';
import { InstancesRouter } from './instances.js';

// ────────────────────────────────────────────────────────────────────────────
// Combined Router
// ────────────────────────────────────────────────────────────────────────────

export const MachineRouter = HttpRouter.empty.pipe(
  HttpRouter.mount('/', DefinitionsRouter),
  HttpRouter.mount('/', ActionsRouter),
  HttpRouter.mount('/', InstancesRouter),
);
