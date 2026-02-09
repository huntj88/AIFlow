import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LogEntry } from '@/types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type LogLevel = LogEntry['level'];

interface LogViewerProps {
  readonly logs: readonly LogEntry[];
  /** All state names from the definition (for the filter dropdown). */
  readonly stateNames: readonly string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-gray-500 dark:text-gray-400',
  info: 'text-blue-600 dark:text-blue-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

const LEVEL_BG: Record<LogLevel, string> = {
  debug: '',
  info: '',
  warn: 'bg-amber-50 dark:bg-amber-950/30',
  error: 'bg-red-50 dark:bg-red-950/30',
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function LogViewer({ logs, stateNames }: LogViewerProps) {
  const { t } = useTranslation();

  // ── Filters ────────────────────────────────────────────────────────────

  const [stateFilter, setStateFilter] = useState<string>('');
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [autoScroll, setAutoScroll] = useState(true);

  const toggleLevel = useCallback((level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  // ── Filtered logs ──────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      logs.filter((entry) => {
        if (stateFilter && entry.stateName !== stateFilter) return false;
        if (!enabledLevels.has(entry.level)) return false;
        return true;
      }),
    [logs, stateFilter, enabledLevels],
  );

  // ── Auto-scroll ────────────────────────────────────────────────────────

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" data-testid="log-viewer">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        {/* State filter */}
        <select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
          }}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
          data-testid="log-state-filter"
        >
          <option value="">{t('machines.instance.logs_all_states')}</option>
          {stateNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {/* Level toggles */}
        <div className="flex gap-1">
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => {
                toggleLevel(level);
              }}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                enabledLevels.has(level)
                  ? `${LEVEL_STYLES[level]} bg-[var(--color-surface)]`
                  : 'text-[var(--color-text-muted)] opacity-40'
              }`}
              data-testid={`log-level-toggle-${level}`}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Auto-scroll toggle */}
        <label className="ml-auto flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={() => {
              setAutoScroll((prev) => !prev);
            }}
            data-testid="log-autoscroll-toggle"
          />
          {t('machines.instance.logs_autoscroll')}
        </label>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-xs"
        data-testid="log-entries"
      >
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            {t('machines.instance.logs_empty')}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-3 border-b border-[var(--color-border)]/30 px-4 py-1.5 ${LEVEL_BG[entry.level]}`}
              data-testid={`log-entry-${entry.id}`}
            >
              <span className="shrink-0 text-[var(--color-text-muted)]">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`shrink-0 w-10 font-semibold uppercase ${LEVEL_STYLES[entry.level]}`}
              >
                {entry.level}
              </span>
              <span className="shrink-0 text-[var(--color-text-muted)]">[{entry.stateName}]</span>
              <span className="flex-1">{entry.message}</span>
              {entry.data != null && (
                <span
                  className="shrink-0 text-[var(--color-text-muted)]"
                  title={JSON.stringify(entry.data)}
                >
                  📎
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
