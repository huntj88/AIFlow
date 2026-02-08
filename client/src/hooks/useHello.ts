import { useCallback, useState } from 'react';

import { apiClient } from '@/utils/apiClient';
import { runWithLogging } from '@/utils/logger';

interface HelloState {
  data: string | null;
  loading: boolean;
  error: string | null;
}

export function useHello() {
  const [state, setState] = useState<HelloState>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchHello = useCallback(() => {
    setState({ data: null, loading: true, error: null });

    runWithLogging(apiClient.hello())
      .then((res) => {
        setState({ data: res.message, loading: false, error: null });
      })
      .catch((err: unknown) => {
        setState({ data: null, loading: false, error: String(err) });
      });
  }, []);

  return { ...state, fetchHello };
}
