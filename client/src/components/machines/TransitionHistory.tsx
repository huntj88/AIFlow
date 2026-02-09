import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TransitionRecord } from '@/types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

interface TransitionHistoryProps {
  readonly history: readonly TransitionRecord[];
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function TransitionHistory({ history }: TransitionHistoryProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  if (history.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="transition-history-empty"
      >
        {t('machines.instance.history_empty')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="transition-history">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">{t('machines.instance.history_from')}</th>
            <th className="px-4 py-2 font-medium">{t('machines.instance.history_to')}</th>
            <th className="px-4 py-2 font-medium">{t('machines.instance.history_action')}</th>
            <th className="px-4 py-2 font-medium">{t('machines.instance.history_duration')}</th>
            <th className="px-4 py-2 font-medium">{t('machines.instance.history_time')}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((record, idx) => (
            <TransitionRow
              key={record.id}
              record={record}
              index={idx + 1}
              isExpanded={expandedId === record.id}
              onToggle={toggleExpand}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Row
// ────────────────────────────────────────────────────────────────────────────

interface TransitionRowProps {
  readonly record: TransitionRecord;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly onToggle: (id: string) => void;
}

function TransitionRow({ record, index, isExpanded, onToggle }: TransitionRowProps) {
  const timestamp = new Date(record.timestamp).toLocaleTimeString();

  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-surface)]"
        onClick={() => {
          onToggle(record.id);
        }}
        data-testid={`transition-row-${record.id}`}
      >
        <td className="px-4 py-2 text-[var(--color-text-muted)]">{index}</td>
        <td className="px-4 py-2 font-mono text-xs">{record.fromState}</td>
        <td className="px-4 py-2 font-mono text-xs">{record.toState}</td>
        <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-muted)]">
          {record.actionId ?? '—'}
        </td>
        <td className="px-4 py-2 tabular-nums">{record.durationMs}ms</td>
        <td className="px-4 py-2 text-[var(--color-text-muted)]">{timestamp}</td>
      </tr>
      {isExpanded && record.data != null && (
        <tr data-testid={`transition-detail-${record.id}`}>
          <td colSpan={6} className="bg-[var(--color-surface)] px-6 py-3">
            <pre className="max-h-48 overflow-auto rounded-md bg-[var(--color-bg)] p-3 text-xs">
              {JSON.stringify(record.data, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
