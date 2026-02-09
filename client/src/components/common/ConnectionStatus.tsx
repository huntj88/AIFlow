import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { machineSocket } from '@/utils/machineSocket';

// ────────────────────────────────────────────────────────────────────────────
// ConnectionStatus — WebSocket status indicator for the app header
// ────────────────────────────────────────────────────────────────────────────

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export function ConnectionStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConnectionState>(
    machineSocket.connected ? 'connected' : 'disconnected',
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setState(machineSocket.connected ? 'connected' : 'disconnected');
    }, 2000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const config: Record<ConnectionState, { dot: string; label: string }> = {
    connected: { dot: 'bg-green-500', label: t('machines.websocket.connected') },
    reconnecting: { dot: 'bg-amber-500', label: t('machines.websocket.reconnecting') },
    disconnected: { dot: 'bg-red-500', label: t('machines.websocket.disconnected') },
  };

  const { dot, label } = config[state];

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"
      title={label}
      data-testid="connection-status"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
