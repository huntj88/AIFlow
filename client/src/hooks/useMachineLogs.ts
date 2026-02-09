import { create } from 'zustand';

import type { LogEntry } from '../types/machines';
import { apiClient } from '../utils/apiClient';
import { runWithLogging } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────────

interface LogFilters {
  state?: string;
  level?: string;
}

interface MachineLogsStore {
  logs: LogEntry[];
  isLoading: boolean;
  error: string | null;
  filters: LogFilters;

  fetchLogs(instanceId: string, state?: string): Promise<void>;
  setFilter(filters: Partial<LogFilters>): void;
  addLogEntry(entry: LogEntry): void;
  filteredLogs(): LogEntry[];
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

export const useMachineLogs = create<MachineLogsStore>()((set, get) => ({
  logs: [],
  isLoading: false,
  error: null,
  filters: {},

  async fetchLogs(instanceId, state) {
    set({ isLoading: true, error: null });
    try {
      const logs = await runWithLogging(apiClient.getInstanceLogs(instanceId, state));
      set({ logs, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  setFilter(filters) {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
  },

  addLogEntry(entry) {
    set((state) => ({ logs: [...state.logs, entry] }));
  },

  filteredLogs() {
    const { logs, filters } = get();
    return logs.filter((entry) => {
      if (filters.state && entry.stateName !== filters.state) return false;
      if (filters.level && entry.level !== filters.level) return false;
      return true;
    });
  },
}));
