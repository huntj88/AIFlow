import { create } from 'zustand';

import type { ArtifactRecord, ArtifactTree } from '../types/machines';
import { apiClient } from '../utils/apiClient';
import { runWithLogging } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────────

interface MachineArtifactsStore {
  artifacts: ArtifactRecord[];
  artifactTree: ArtifactTree | null;
  isLoading: boolean;
  error: string | null;

  fetchArtifacts(instanceId: string): Promise<void>;
  fetchArtifactTree(instanceId: string): Promise<void>;
  addArtifact(record: ArtifactRecord): void;
  downloadArtifact(instanceId: string, name: string): Promise<Blob>;
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

export const useMachineArtifacts = create<MachineArtifactsStore>()((set) => ({
  artifacts: [],
  artifactTree: null,
  isLoading: false,
  error: null,

  async fetchArtifacts(instanceId) {
    set({ isLoading: true, error: null });
    try {
      const artifacts = await runWithLogging(apiClient.getInstanceArtifacts(instanceId));
      set({ artifacts, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  async fetchArtifactTree(instanceId) {
    set({ isLoading: true, error: null });
    try {
      const artifactTree = await runWithLogging(apiClient.getInstanceArtifactTree(instanceId));
      set({ artifactTree, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  addArtifact(record) {
    set((state) => ({ artifacts: [...state.artifacts, record] }));
  },

  async downloadArtifact(instanceId, name) {
    try {
      const buffer = await runWithLogging(apiClient.downloadArtifact(instanceId, name));
      return new Blob([buffer]);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },
}));
