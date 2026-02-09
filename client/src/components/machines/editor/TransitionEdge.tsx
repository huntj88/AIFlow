// ────────────────────────────────────────────────────────────────────────────
// Custom React Flow edge for the definition editor
// ────────────────────────────────────────────────────────────────────────────

import { BaseEdge, type EdgeProps, getBezierPath, EdgeLabelRenderer } from '@xyflow/react';
import { memo } from 'react';

import type { EditorEdge } from '@/hooks/useDefinitionEditor';

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

function TransitionEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  selected,
}: EdgeProps<EditorEdge>) {
  const condition = data?.condition;
  const displayLabel = typeof label === 'string' ? label : (condition ?? '');
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strokeColor = selected ? 'var(--color-accent, #3b82f6)' : 'var(--color-border, #94a3b8)';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: condition ? '6 3' : undefined,
        }}
      />
      {displayLabel !== '' && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px,${String(labelY)}px)`,
            }}
            data-testid={`edge-label-${id}`}
          >
            {displayLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const TransitionEdge = memo(TransitionEdgeInner);
