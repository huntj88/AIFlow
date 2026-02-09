import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { SkeletonHeader } from '@/components/common/Skeleton';
import { ArtifactViewer } from '@/components/machines/ArtifactViewer';
import { ChildMachineTree } from '@/components/machines/ChildMachineTree';
import { LogViewer } from '@/components/machines/LogViewer';
import { StateDiagram } from '@/components/machines/StateDiagram';
import { StatusBadge } from '@/components/machines/StatusBadge';
import { TransitionHistory } from '@/components/machines/TransitionHistory';
import { useMachineArtifacts } from '@/hooks/useMachineArtifacts';
import { useMachineDefinitions } from '@/hooks/useMachineDefinitions';
import { useMachineInstances } from '@/hooks/useMachineInstances';
import { useMachineLogs } from '@/hooks/useMachineLogs';
import { useMachineSocket } from '@/hooks/useMachineSocket';
import type { MachineEvent, MachineInstance } from '@/types/machines';
import { machineRoutes } from '@/utils/machineRoutes';

// ────────────────────────────────────────────────────────────────────────────
// Tab type
// ────────────────────────────────────────────────────────────────────────────

type Tab = 'diagram' | 'history' | 'logs' | 'children' | 'artifacts';

const TABS: Tab[] = ['diagram', 'history', 'logs', 'children', 'artifacts'];

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function MachineInstancePage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('parent');
  const { t } = useTranslation();

  // ── Stores ─────────────────────────────────────────────────────────────

  const instancesStore = useMachineInstances();
  const defsStore = useMachineDefinitions();
  const logsStore = useMachineLogs();
  const artifactsStore = useMachineArtifacts();

  const instance = instancesStore.currentInstance;
  const isLoading = instancesStore.isLoading;
  const error = instancesStore.error;

  // ── Local state ────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<Tab>('diagram');
  const [definitionMissing, setDefinitionMissing] = useState(false);
  const [childStatuses, setChildStatuses] = useState<Record<string, MachineInstance['status']>>({});
  const [childDefNames] = useState<Record<string, string>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── Fetch initial data ─────────────────────────────────────────────────

  useEffect(() => {
    if (!instanceId) return;

    void instancesStore.fetchInstance(instanceId);
    void logsStore.fetchLogs(instanceId);
    void artifactsStore.fetchArtifacts(instanceId);
    void artifactsStore.fetchArtifactTree(instanceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // Fetch the definition once we have the instance
  useEffect(() => {
    if (!instance) return;

    // Only fetch definitions if we haven't already
    if (defsStore.definitions.length === 0) {
      void defsStore.fetchDefinitions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.definitionId]);

  // Resolve definition
  const definition = useMemo(() => {
    if (!instance) return null;
    const def = defsStore.definitions.find((d) => d.id === instance.definitionId);
    if (!def && defsStore.definitions.length > 0) {
      setDefinitionMissing(true);
    }
    return def ?? null;
  }, [instance, defsStore.definitions]);

  // Visited states from history
  const visitedStates = useMemo(() => {
    if (!instance) return new Set<string>();
    const states = new Set<string>();
    for (const h of instance.history) {
      states.add(h.fromState);
      states.add(h.toState);
    }
    return states;
  }, [instance]);

  // State names for log filter
  const stateNames = useMemo(() => {
    if (!definition) return [];
    return Object.keys(definition.states);
  }, [definition]);

  // ── WebSocket event handler ────────────────────────────────────────────

  const handleEvent = useCallback(
    (event: MachineEvent) => {
      // The useMachineInstances store already handles state_changed,
      // transition_recorded, log_entry, and machine_completed.
      // We augment with additional handlers:

      switch (event.type) {
        case 'log_entry':
          logsStore.addLogEntry(event.data);
          break;

        case 'artifact_created':
          artifactsStore.addArtifact(event.data);
          // Re-fetch tree to include new artifact
          if (instanceId) {
            void artifactsStore.fetchArtifactTree(instanceId);
          }
          break;

        case 'child_spawned':
          setChildStatuses((prev) => ({
            ...prev,
            [event.data.childInstanceId]: 'running',
          }));
          break;

        case 'child_completed': {
          const result = event.data.result;
          setChildStatuses((prev) => ({
            ...prev,
            [event.data.childInstanceId]:
              result.status === 'completed'
                ? 'completed'
                : result.status === 'cancelled'
                  ? 'cancelled'
                  : 'error',
          }));
          break;
        }

        case 'children_spawned':
          setChildStatuses((prev) => {
            const next = { ...prev };
            for (const id of Object.values(event.data.childInstanceIds)) {
              next[id] = 'running';
            }
            return next;
          });
          break;

        case 'children_completed':
          setChildStatuses((prev) => {
            const next = { ...prev };
            for (const [key, result] of Object.entries(event.data.results)) {
              // key is the child key, but we need the instance ID
              // For now, update based on result status
              const status: MachineInstance['status'] =
                result.status === 'completed'
                  ? 'completed'
                  : result.status === 'cancelled'
                    ? 'cancelled'
                    : 'error';
              if ('instanceId' in result) {
                next[result.instanceId] = status;
              } else {
                // Fall through — key might be instance ID in some cases
                next[key] = status;
              }
            }
            return next;
          });
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instanceId],
  );

  // Subscribe to WebSocket for this instance
  useMachineSocket(instanceId, handleEvent);

  // ── Loading & error states ─────────────────────────────────────────────

  if (!instanceId) {
    return (
      <div className="p-6 text-center text-[var(--color-text-muted)]">
        {t('machines.instance.no_id')}
      </div>
    );
  }

  if (isLoading && !instance) {
    return (
      <div className="p-6" data-testid="instance-loading">
        <SkeletonHeader />
        <div className="mt-4 h-[500px] animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]" />
      </div>
    );
  }

  if (error && !instance) {
    return (
      <div className="p-6 text-center text-red-600" data-testid="instance-error">
        {error}
      </div>
    );
  }

  if (!instance) {
    return (
      <div
        className="p-6 text-center text-[var(--color-text-muted)]"
        data-testid="instance-not-found"
      >
        {t('machines.instance.not_found')}
      </div>
    );
  }

  // Derive definition name
  const definitionName = definition?.name ?? instance.definitionId;

  // Can cancel?
  const canCancel = instance.status === 'running' || instance.status === 'waiting_for_child';
  const canResume = instance.status === 'suspended';

  return (
    <div className="flex h-full flex-col" data-testid="machine-instance-page">
      {/* ── Parent breadcrumb ─────────────────────────────────────────── */}
      {parentId && (
        <div className="mb-2 text-sm" data-testid="parent-breadcrumb">
          <Link
            to={machineRoutes.viewInstance(parentId)}
            className="text-[var(--color-accent)] hover:underline"
          >
            {t('machines.instance.parentBreadcrumb', { id: parentId.slice(0, 8) + '…' })}
          </Link>
          <span className="mx-1 text-[var(--color-text-muted)]">›</span>
          <span>{instance.id.slice(0, 8)}…</span>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] pb-4">
        <h2 className="text-xl font-semibold">{definitionName}</h2>
        <StatusBadge status={instance.status} />
        <span className="font-mono text-xs text-[var(--color-text-muted)]">{instance.id}</span>

        {definitionMissing && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-200">
            {t('machines.instance.definition_unavailable')}
          </span>
        )}

        <div className="ml-auto flex gap-2">
          {canResume && (
            <button
              onClick={() => {
                void instancesStore
                  .resumeInstance(instance.id)
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
              }}
              className="rounded-md bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600"
              data-testid="resume-button"
            >
              {t('machines.instance.resume')}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => {
                setShowCancelConfirm(true);
              }}
              className="rounded-md bg-red-500 px-4 py-1.5 text-sm text-white hover:bg-red-600"
              data-testid="cancel-button"
            >
              {t('machines.instance.cancel')}
            </button>
          )}
        </div>
      </header>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <nav
        className="flex gap-1 border-b border-[var(--color-border)] py-2"
        data-testid="instance-tabs"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
            }}
            className={`rounded-md px-4 py-1.5 text-sm ${
              activeTab === tab
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
            }`}
            data-testid={`tab-${tab}`}
          >
            {t(`machines.instance.tab_${tab}`)}
          </button>
        ))}
      </nav>

      {/* ── Panel content ───────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-hidden pt-4">
        {activeTab === 'diagram' && definition && (
          <div className="h-[500px] rounded-lg border border-[var(--color-border)]">
            <StateDiagram
              definition={definition}
              currentState={instance.currentState}
              visitedStates={visitedStates}
            />
          </div>
        )}
        {activeTab === 'diagram' && !definition && (
          <div className="py-12 text-center text-[var(--color-text-muted)]">
            {definitionMissing
              ? t('machines.instance.definition_unavailable')
              : t('machines.instance.loading')}
          </div>
        )}

        {activeTab === 'history' && <TransitionHistory history={instance.history} />}

        {activeTab === 'logs' && (
          <div className="h-[500px]">
            <LogViewer logs={logsStore.logs} stateNames={stateNames} />
          </div>
        )}

        {activeTab === 'children' && (
          <ChildMachineTree
            parentInstanceId={instance.id}
            childInstanceId={instance.childInstanceId}
            childInstanceIds={instance.childInstanceIds}
            definitionNames={childDefNames}
            childStatuses={childStatuses}
          />
        )}

        {activeTab === 'artifacts' && (
          <ArtifactViewer
            instanceId={instance.id}
            artifactTree={artifactsStore.artifactTree}
            artifacts={artifactsStore.artifacts}
          />
        )}
      </div>

      {/* ── Cancel confirmation ─────────────────────────────────────────── */}
      <ConfirmDialog
        open={showCancelConfirm}
        title={t('machines.instance.cancel')}
        message={t('machines.confirm.cancelInstance')}
        variant="danger"
        onConfirm={() => {
          setShowCancelConfirm(false);
          void instancesStore
            .cancelInstance(instance.id)
            .then(() => {
              toast.success(t('machines.toast.instanceCancelled'));
            })
            .catch((err: unknown) => {
              toast.error(
                t('machines.toast.error', {
                  message: err instanceof Error ? err.message : String(err),
                }),
              );
            });
        }}
        onCancel={() => {
          setShowCancelConfirm(false);
        }}
      />
    </div>
  );
}

export default MachineInstancePage;
