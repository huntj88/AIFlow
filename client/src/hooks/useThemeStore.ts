import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'aiflow-theme' },
  ),
);
