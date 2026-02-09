import { useEffect } from 'react';

import type { MachineEvent } from '../types/machines';
import type { MachineEventCallback } from '../utils/machineSocket';
import { machineSocket } from '../utils/machineSocket';

/**
 * Subscribe to real-time WebSocket events for a specific machine instance.
 *
 * The hook automatically subscribes on mount (or when `instanceId` changes)
 * and unsubscribes on unmount. The connection is opened lazily on the first
 * subscribe call.
 *
 * **Important**: `onEvent` should be a stable reference (wrap with
 * `useCallback`) to avoid unnecessary re-subscriptions.
 *
 * @example
 * ```tsx
 * const handleEvent = useCallback((e: MachineEvent) => {
 *   if (e.type === 'state_changed') { … }
 * }, []);
 *
 * useMachineSocket(instanceId, handleEvent);
 * ```
 */
export function useMachineSocket(
  instanceId: string | undefined,
  onEvent: MachineEventCallback,
): void {
  useEffect(() => {
    if (!instanceId) return;

    const unsub = machineSocket.subscribe(instanceId, onEvent);
    return unsub;
  }, [instanceId, onEvent]);
}

/**
 * Subscribe to events for a specific instance, filtered by event type.
 *
 * This is a convenience wrapper around {@link useMachineSocket} that only
 * invokes `onEvent` when the incoming event's `type` matches one of the
 * provided `types`.
 */
export function useMachineSocketFiltered(
  instanceId: string | undefined,
  types: readonly MachineEvent['type'][],
  onEvent: MachineEventCallback,
): void {
  useEffect(() => {
    if (!instanceId) return;

    const typeSet = new Set<string>(types);
    const handler: MachineEventCallback = (event) => {
      if (typeSet.has(event.type)) {
        onEvent(event);
      }
    };

    const unsub = machineSocket.subscribe(instanceId, handler);
    return unsub;
    // types is an array so we serialize it for the dep check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, JSON.stringify(types), onEvent]);
}
