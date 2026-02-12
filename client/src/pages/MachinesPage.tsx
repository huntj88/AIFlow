import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { SkeletonCard, SkeletonRow } from '@/components/common/Skeleton';
import { DefinitionCard } from '@/components/machines/DefinitionCard';
import { InstanceRow } from '@/components/machines/InstanceRow';
import { QuickStartPanel } from '@/components/machines/QuickStartPanel';
import { useMachineDefinitions } from '@/hooks/useMachineDefinitions';
import { useMachineInstances } from '@/hooks/useMachineInstances';
import type { MachineInstance } from '@/types/machines';
import { machineRoutes } from '@/utils/machineRoutes';

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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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
      void navigate(machineRoutes.editDefinition(_id));
    },
    [navigate],
  );

  const handleDeleteDefinition = useCallback(
    (id: string) => {
      const def = definitions.find((d) => d.id === id);
      setDeleteTarget({ id, name: def?.name ?? id });
    },
    [definitions],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await defsStore.deleteDefinition(deleteTarget.id);
      toast.success(t('machines.toast.definitionDeleted'));
    } catch (err) {
      toast.error(
        t('machines.toast.error', { message: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setDeleteTarget(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, t]);

  const handleCreateDefinition = useCallback(() => {
    void navigate(machineRoutes.newDefinition());
  }, [navigate]);

  const handleSelectInstance = useCallback(
    (id: string) => {
      void navigate(machineRoutes.viewInstance(id));
    },
    [navigate],
  );

  const handleResumeInstance = useCallback(
    (id: string) => {
      void instancesStore
        .resumeInstance(id)
        .then(() => {
          toast.success(t('machines.toast.instanceResumed'));
        })
        .catch((err: unknown) => {
          toast.error(
            t('machines.toast.error', {
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const handleLaunch = useCallback(
    async (definitionId: string, input: unknown, workspaceRoot: string) => {
      try {
        const instance = await instancesStore.startInstance(definitionId, input, workspaceRoot);
        toast.success(t('machines.toast.instanceStarted'));
        void navigate(machineRoutes.viewInstance(instance.id));
      } catch (err) {
        toast.error(
          t('machines.toast.error', { message: err instanceof Error ? err.message : String(err) }),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, t],
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
              <div className="grid gap-3 sm:grid-cols-2" data-testid="definitions-skeleton">
                <SkeletonCard />
                <SkeletonCard />
              </div>
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
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-left">
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
                      <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </tbody>
                </table>
              </div>
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
            onLaunch={(defId, input, wsRoot) => {
              void handleLaunch(defId, input, wsRoot);
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('machines.definitions.delete')}
        message={t('machines.definitions.delete_confirm', { name: deleteTarget?.name ?? '' })}
        variant="danger"
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => {
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

export default MachinesPage;
