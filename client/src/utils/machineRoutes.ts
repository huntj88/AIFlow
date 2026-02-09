// ────────────────────────────────────────────────────────────────────────────
// URL helpers for machine-related navigation
// ────────────────────────────────────────────────────────────────────────────

export const machineRoutes = {
  /** Machines dashboard listing definitions + instances. */
  dashboard: () => '/machines',

  /** Create a new definition (definition editor, blank). */
  newDefinition: () => '/machines/definitions/new',

  /** View a definition by ID. */
  viewDefinition: (id: string) => `/machines/definitions/${id}`,

  /** Edit an existing definition by ID. */
  editDefinition: (id: string) => `/machines/definitions/${id}/edit`,

  /** View a running/completed machine instance. */
  viewInstance: (id: string) => `/machines/instances/${id}`,
} as const;
