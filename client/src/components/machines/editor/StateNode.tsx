// ────────────────────────────────────────────────────────────────────────────
// Custom React Flow node for the definition editor
// ────────────────────────────────────────────────────────────────────────────

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';

import type { EditorNode } from '@/hooks/useDefinitionEditor';

// ────────────────────────────────────────────────────────────────────────────
// Style helpers
// ────────────────────────────────────────────────────────────────────────────

function getNodeClasses(
  stateType: string,
  isInitial: boolean,
  selected: boolean,
): { bg: string; border: string; text: string; shape: string; extra: string } {
  let bg = 'bg-[var(--color-surface)]';
  let border = 'border-[var(--color-border)]';
  let text = 'text-[var(--color-text)]';
  let extra = '';
  const shape = stateType === 'terminal' ? 'rounded-full' : 'rounded-lg';

  switch (stateType) {
    case 'action':
      bg = 'bg-blue-50 dark:bg-blue-950';
      border = 'border-blue-400 dark:border-blue-500';
      break;
    case 'child_machine':
      bg = 'bg-purple-50 dark:bg-purple-950';
      border = 'border-purple-400 dark:border-purple-500';
      break;
    case 'parallel_children':
      bg = 'bg-indigo-50 dark:bg-indigo-950';
      border = 'border-indigo-400 dark:border-indigo-500';
      break;
    case 'terminal':
      bg = 'bg-gray-100 dark:bg-gray-800';
      border = 'border-gray-400 dark:border-gray-500';
      text = 'text-gray-600 dark:text-gray-300';
      break;
  }

  if (isInitial) {
    extra = 'ring-2 ring-green-400 ring-offset-1';
  }

  if (selected) {
    extra += ' ring-2 ring-[var(--color-accent)] ring-offset-1';
  }

  return { bg, border, text, shape, extra };
}

function getTypeIcon(stateType: string): string {
  switch (stateType) {
    case 'action':
      return '⚡';
    case 'child_machine':
      return '🔗';
    case 'parallel_children':
      return '⫘';
    case 'terminal':
      return '⏹';
    default:
      return '';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

function StateNodeInner({ data, selected }: NodeProps<EditorNode>) {
  const { label, stateType, isInitial, actionId, timeoutMs } = data;
  const { bg, border, text, shape, extra } = getNodeClasses(stateType, isInitial, selected);

  return (
    <div
      className={`flex min-w-[180px] flex-col border-2 px-4 py-2 text-sm font-medium shadow-sm ${bg} ${border} ${text} ${shape} ${extra}`}
      data-testid={`editor-node-${label}`}
    >
      {/* Target handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !bg-[var(--color-border)]"
      />

      {/* Header: icon + name */}
      <div className="flex items-center gap-1.5">
        {isInitial && <span className="text-xs text-green-600">▶</span>}
        <span className="text-xs">{getTypeIcon(stateType)}</span>
        <span className="truncate font-semibold">{label}</span>
      </div>

      {/* Badges */}
      <div className="mt-1 flex flex-wrap gap-1">
        <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/10">{stateType}</span>
        {actionId && (
          <span className="truncate rounded bg-blue-100 px-1 text-[10px] text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {actionId}
          </span>
        )}
        {timeoutMs != null && timeoutMs > 0 && (
          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            {timeoutMs}ms
          </span>
        )}
      </div>

      {/* Source handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !bg-[var(--color-border)]"
      />
    </div>
  );
}

export const StateNode = memo(StateNodeInner);
