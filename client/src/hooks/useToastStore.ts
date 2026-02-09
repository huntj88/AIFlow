import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast(toast) {
    const id = `toast-${String(toastCounter)}-${String(Date.now())}`;
    toastCounter += 1;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));

    // Auto-dismiss
    const duration = toast.duration ?? 5000;
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  removeToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
