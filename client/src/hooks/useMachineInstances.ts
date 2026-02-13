import { create } from 'zustand';

import type {
  InstanceFilter,
  MachineEvent,
  MachineInstance,
  MachineRuntimeOptions,
} from '../types/machines';
import { apiClient } from '../utils/apiClient';
import { runWithLogging } from '../utils/logger';
import { machineSocket } from '../utils/machineSocket';

// ────────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────────

interface MachineInstancesStore {
  instances: MachineInstance[];
  currentInstance: MachineInstance | null;
  isLoading: boolean;
  error: string | null;

  fetchInstances(filter?: InstanceFilter): Promise<void>;
  fetchInstance(id: string): Promise<void>;
  startInstance(
    definitionId: string,
    input: unknown,
    workspaceRoot: string,
    runtimeOptions: MachineRuntimeOptions,
  ): Promise<MachineInstance>;
  cancelInstance(id: string): Promise<void>;
  resumeInstance(id: string): Promise<void>;

  /** Subscribe to WebSocket events for an instance. Returns an unsubscribe function. */
  subscribeToInstance(id: string): () => void;

  /** Process a single incoming WebSocket event. */
  handleEvent(event: MachineEvent): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Return a shallow-updated instance if it matches the given id, or the original. */
function patchInstance(
  instance: MachineInstance,
  id: string,
  patch: Partial<MachineInstance>,
): MachineInstance {
  return instance.id === id ? { ...instance, ...patch } : instance;
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

export const useMachineInstances = create<MachineInstancesStore>()((set, get) => ({
  instances: [],
  currentInstance: null,
  isLoading: false,
  error: null,

  // ── REST actions ─────────────────────────────────────────────────────────

  async fetchInstances(filter) {
    set({ isLoading: true, error: null });
    try {
      const instances = await runWithLogging(apiClient.getInstances(filter));
      set({ instances, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async fetchInstance(id) {
    set({ isLoading: true, error: null });
    try {
      const instance = await runWithLogging(apiClient.getInstance(id));
      set({ currentInstance: instance, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async startInstance(definitionId, input, workspaceRoot, runtimeOptions) {
    set({ isLoading: true, error: null });
    try {
      const instance = await runWithLogging(
        apiClient.startInstance(definitionId, input, workspaceRoot, runtimeOptions),
      );
      // Optimistically add the returned instance to the list
      set((state) => ({
        instances: [...state.instances, instance],
        currentInstance: instance,
        isLoading: false,
      }));
      return instance;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      throw err;
    }
  },

  async cancelInstance(id) {
    set({ error: null });
    try {
      await runWithLogging(apiClient.cancelInstance(id));
      // Re-fetch to get the updated state
      const instance = await runWithLogging(apiClient.getInstance(id));
      set((state) => ({
        instances: state.instances.map((i) => patchInstance(i, id, instance)),
        currentInstance: state.currentInstance?.id === id ? instance : state.currentInstance,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async resumeInstance(id) {
    set({ error: null });
    try {
      await runWithLogging(apiClient.resumeInstance(id));
      // Re-fetch to get the updated state
      const instance = await runWithLogging(apiClient.getInstance(id));
      set((state) => ({
        instances: state.instances.map((i) => patchInstance(i, id, instance)),
        currentInstance: state.currentInstance?.id === id ? instance : state.currentInstance,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // ── WebSocket integration ────────────────────────────────────────────────

  subscribeToInstance(id) {
    const unsub = machineSocket.subscribe(id, (event) => {
      get().handleEvent(event);
    });
    return unsub;
  },

  handleEvent(event) {
    const { instanceId } = event;

    const applyPatch = (patch: Partial<MachineInstance>) => {
      set((state) => ({
        instances: state.instances.map((i) => patchInstance(i, instanceId, patch)),
        currentInstance:
          state.currentInstance?.id === instanceId
            ? { ...state.currentInstance, ...patch }
            : state.currentInstance,
      }));
    };

    switch (event.type) {
      case 'state_changed': {
        applyPatch({
          currentState: event.data.currentState,
          stateData: event.data.stateData,
        });
        break;
      }

      case 'transition_recorded': {
        const { currentInstance, instances } = get();
        const target =
          currentInstance?.id === instanceId
            ? currentInstance
            : instances.find((i) => i.id === instanceId);
        if (target) {
          applyPatch({ history: [...target.history, event.data] });
        }
        break;
      }

      case 'log_entry': {
        const { currentInstance, instances } = get();
        const target =
          currentInstance?.id === instanceId
            ? currentInstance
            : instances.find((i) => i.id === instanceId);
        if (target) {
          applyPatch({ logs: [...target.logs, event.data] });
        }
        break;
      }

      case 'machine_completed': {
        const { data } = event;
        if (data.status === 'completed') {
          applyPatch({ status: 'completed', output: data.output });
        } else if (data.status === 'cancelled') {
          applyPatch({ status: 'cancelled' });
        } else {
          applyPatch({ status: 'error', error: data.error });
        }
        break;
      }

      case 'machine_resumed': {
        applyPatch({
          status: 'running',
          currentState: event.data.resumedState,
        });
        break;
      }

      case 'child_spawned': {
        applyPatch({
          status: 'waiting_for_child',
          childInstanceId: event.data.childInstanceId,
        });
        break;
      }

      case 'child_completed': {
        applyPatch({ childInstanceId: undefined });
        break;
      }

      case 'children_spawned': {
        applyPatch({
          status: 'waiting_for_child',
          childInstanceIds: event.data.childInstanceIds,
        });
        break;
      }

      case 'children_completed': {
        applyPatch({ childInstanceIds: undefined });
        break;
      }
    }
  },
}));
