import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { MachineInstance } from '@/types/machines';
import { machineRoutes } from '@/utils/machineRoutes';

import { StatusBadge } from './StatusBadge';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ChildInfo {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly key?: string;
  readonly status?: MachineInstance['status'];
}

interface ChildMachineTreeProps {
  readonly parentInstanceId: string;
  /** Direct child from `child_machine` state. */
  readonly childInstanceId?: string;
  /** Children from `parallel_children` state (key → instanceId). */
  readonly childInstanceIds?: Record<string, string>;
  /** Definitions map for resolving names. */
  readonly definitionNames: Record<string, string>;
  /** Statuses of child instances from events. */
  readonly childStatuses: Record<string, MachineInstance['status']>;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function ChildMachineTree({
  parentInstanceId,
  childInstanceId,
  childInstanceIds,
  definitionNames,
  childStatuses,
}: ChildMachineTreeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Build flat list of children
  const children: ChildInfo[] = [];

  if (childInstanceId) {
    children.push({
      instanceId: childInstanceId,
      definitionId: '', // Will resolve via definitionNames
      status: childStatuses[childInstanceId],
    });
  }

  if (childInstanceIds) {
    for (const [key, id] of Object.entries(childInstanceIds)) {
      children.push({
        instanceId: id,
        definitionId: '',
        key,
        status: childStatuses[id],
      });
    }
  }

  const handleNavigate = (instanceId: string) => {
    void navigate(`${machineRoutes.viewInstance(instanceId)}?parent=${parentInstanceId}`);
  };

  if (children.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="child-tree-empty"
      >
        {t('machines.instance.children_empty')}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4" data-testid="child-machine-tree">
      {/* Parent root */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-lg">📦</span>
        <span className="font-medium">{t('machines.instance.children_parent')}</span>
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {parentInstanceId.slice(0, 8)}…
        </span>
      </div>

      {/* Children */}
      <div className="ml-6 space-y-1 border-l-2 border-[var(--color-border)] pl-4">
        {children.map((child) => (
          <button
            key={child.instanceId}
            onClick={() => {
              handleNavigate(child.instanceId);
            }}
            className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-[var(--color-surface)]"
            data-testid={`child-node-${child.instanceId}`}
          >
            <span className="text-base">🔗</span>
            <span className="font-mono text-xs">{child.instanceId.slice(0, 8)}…</span>
            {child.key && (
              <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                {child.key}
              </span>
            )}
            {definitionNames[child.instanceId] && (
              <span className="text-[var(--color-text-muted)]">
                {definitionNames[child.instanceId]}
              </span>
            )}
            {child.status && <StatusBadge status={child.status} />}
          </button>
        ))}
      </div>
    </div>
  );
}
