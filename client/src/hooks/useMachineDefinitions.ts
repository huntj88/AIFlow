import { create } from 'zustand';

import type { StateMachineDefinition } from '../types/machines';
import { apiClient } from '../utils/apiClient';
import { runWithLogging } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Request body types (mirrors what apiClient expects)
// ────────────────────────────────────────────────────────────────────────────

type CreateDefinitionRequest = Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>;
type UpdateDefinitionRequest = Partial<Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>>;

// ────────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────────

interface MachineDefinitionsStore {
  definitions: StateMachineDefinition[];
  isLoading: boolean;
  error: string | null;

  fetchDefinitions(): Promise<void>;
  createDefinition(body: CreateDefinitionRequest): Promise<StateMachineDefinition>;
  updateDefinition(id: string, body: UpdateDefinitionRequest): Promise<StateMachineDefinition>;
  deleteDefinition(id: string): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

export const useMachineDefinitions = create<MachineDefinitionsStore>()((set, get) => ({
  definitions: [],
  isLoading: false,
  error: null,

  async fetchDefinitions() {
    set({ isLoading: true, error: null });
    try {
      const definitions = await runWithLogging(apiClient.getDefinitions());
      set({ definitions, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async createDefinition(body) {
    set({ isLoading: true, error: null });
    try {
      const created = await runWithLogging(apiClient.createDefinition(body));
      // Refresh the full list so ordering/version is consistent with server
      await get().fetchDefinitions();
      return created;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      throw err;
    }
  },

  async updateDefinition(id, body) {
    set({ isLoading: true, error: null });
    try {
      const updated = await runWithLogging(apiClient.updateDefinition(id, body));
      await get().fetchDefinitions();
      return updated;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      throw err;
    }
  },

  async deleteDefinition(id) {
    set({ isLoading: true, error: null });
    try {
      await runWithLogging(apiClient.deleteDefinition(id));
      await get().fetchDefinitions();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      throw err;
    }
  },
}));
