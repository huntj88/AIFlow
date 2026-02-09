import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DefinitionCard } from '@/components/machines/DefinitionCard';
import { InstanceRow } from '@/components/machines/InstanceRow';
import { QuickStartPanel } from '@/components/machines/QuickStartPanel';
import { useMachineDefinitions } from '@/hooks/useMachineDefinitions';
import { useMachineInstances } from '@/hooks/useMachineInstances';
import type { MachineInstance } from '@/types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Status filter type
// ────────────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | MachineInstance['status'];

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'running',
  'suspended',
  'completed',
  'error',
  'cancelled',
];

// ────────────────────────────────────────────────────────────────────────────
// Auto-refresh interval (ms)
// ────────────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 10_000;

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function MachinesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── Stores ─────────────────────────────────────────────────────────────

  const defsStore = useMachineDefinitions();
  const definitions = defsStore.definitions;
  const defsLoading = defsStore.isLoading;
  const defsError = defsStore.error;

  const instancesStore = useMachineInstances();
  const instances = instancesStore.instances;
  const instancesLoading = instancesStore.isLoading;
  const instancesError = instancesStore.error;

  // ── Local state ────────────────────────────────────────────────────────

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // ── Initial fetch + auto-refresh instances ─────────────────────────────

  useEffect(() => {
    void defsStore.fetchDefinitions();
    void instancesStore.fetchInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void instancesStore.fetchInstances();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleEditDefinition = useCallback(
    (_id: string) => {
      // Task 30 will implement the editor route; for now navigate to a placeholder
      void navigate(`/machines/definitions/${_id}/edit`);
    },
    [navigate],
  );

  const handleDeleteDefinition = useCallback(
    (id: string) => {
      void defsStore.deleteDefinition(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleCreateDefinition = useCallback(() => {
    void navigate('/machines/definitions/new');
  }, [navigate]);

  const handleSelectInstance = useCallback(
    (id: string) => {
      void navigate(`/machines/instances/${id}`);
    },
    [navigate],
  );

  const handleResumeInstance = useCallback(
    (id: string) => {
      void instancesStore.resumeInstance(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleLaunch = useCallback(
    async (definitionId: string, input: unknown) => {
      try {
        const instance = await instancesStore.startInstance(definitionId, input);
        void navigate(`/machines/instances/${instance.id}`);
      } catch {
        // Error is already set in the store
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate],
  );

  // ── Filtered instances ─────────────────────────────────────────────────

  const filteredInstances =
    statusFilter === 'all' ? instances : instances.filter((i) => i.status === statusFilter);

  // ── Error display ──────────────────────────────────────────────────────

  const error = defsError ?? instancesError;

  return (
    <div data-testid="machines-page">
      <h2 className="mb-6 text-2xl font-semibold">{t('machines.dashboard.title')}</h2>

      {error && (
        <div
          className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          data-testid="machines-error"
        >
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ── Left: Definitions + Instances ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-8">
          {/* Definitions section */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('machines.definitions.title')}</h3>
              <button
                onClick={handleCreateDefinition}
                className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white"
                data-testid="create-definition-button"
              >
                {t('machines.definitions.create')}
              </button>
            </div>

            {defsLoading && definitions.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
            ) : definitions.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]" data-testid="definitions-empty">
                {t('machines.definitions.empty')}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="definitions-list">
                {definitions.map((def) => (
                  <DefinitionCard
                    key={def.id}
                    definition={def}
                    onEdit={handleEditDefinition}
                    onDelete={handleDeleteDefinition}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Instances section */}
          <section>
            <h3 className="mb-3 text-lg font-semibold">{t('machines.instances.title')}</h3>

            {/* Filter tabs */}
            <div className="mb-3 flex gap-1" data-testid="status-filter-tabs">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setStatusFilter(filter);
                  }}
                  className={`rounded-md px-3 py-1 text-sm ${
                    statusFilter === filter
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                  }`}
                  data-testid={`filter-tab-${filter}`}
                >
                  {t(`machines.instances.filter.${filter}`)}
                </button>
              ))}
            </div>

            {instancesLoading && instances.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
            ) : filteredInstances.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]" data-testid="instances-empty">
                {t('machines.instances.empty')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-left" data-testid="instances-table">
                  <thead className="bg-[var(--color-surface)]">
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                        Definition
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                        Status
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                        Current State
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                        Created
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                        {/* Actions */}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstances.map((instance) => (
                      <InstanceRow
                        key={instance.id}
                        instance={instance}
                        definitions={definitions}
                        onSelect={handleSelectInstance}
                        onResume={handleResumeInstance}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Right: Quick Start ─────────────────────────────────────────── */}
        <div>
          <QuickStartPanel
            definitions={definitions}
            isLoading={instancesLoading}
            onLaunch={(defId, input) => {
              void handleLaunch(defId, input);
            }}
          />
        </div>
      </div>
    </div>
  );
}
