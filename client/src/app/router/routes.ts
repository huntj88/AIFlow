export const ROUTES = {
  HOME: '/',
  MACHINES: '/machines',
  MACHINE_DEFINITION: '/machines/definitions/:id',
  MACHINE_DEFINITION_NEW: '/machines/definitions/new',
  MACHINE_DEFINITION_EDIT: '/machines/definitions/:id/edit',
  MACHINE_INSTANCE: '/machines/instances/:instanceId',
} as const;
