// ────────────────────────────────────────────────────────────────────────────
// State configuration panel — right sidebar for editing a selected state node
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type EditorNodeData, useDefinitionEditor } from '@/hooks/useDefinitionEditor';
import type { ActionMetadata, StateMachineDefinition } from '@/types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

interface StateConfigPanelProps {
  readonly actions: ActionMetadata[];
  readonly definitions: StateMachineDefinition[];
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function StateConfigPanel({ actions, definitions }: StateConfigPanelProps) {
  const { t } = useTranslation();

  const nodes = useDefinitionEditor((s) => s.nodes);
  const selectedNodeId = useDefinitionEditor((s) => s.selectedNodeId);
  const updateState = useDefinitionEditor((s) => s.updateState);
  const removeState = useDefinitionEditor((s) => s.removeState);
  const setInitialState = useDefinitionEditor((s) => s.setInitialState);
  const initialStateName = useDefinitionEditor((s) => s.initialState);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  const handleUpdate = useCallback(
    (patch: Partial<EditorNodeData>) => {
      if (selectedNodeId) updateState(selectedNodeId, patch);
    },
    [selectedNodeId, updateState],
  );

  if (!selectedNode) return null;

  const { data } = selectedNode;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3" data-testid="state-config-panel">
      <h3 className="text-sm font-semibold">{t('machines.editor.stateConfig')}</h3>

      {/* State name */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.stateName')}
        <input
          type="text"
          value={data.label}
          onChange={(e) => {
            handleUpdate({ label: e.target.value });
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="state-name-input"
        />
      </label>

      {/* State type */}
      <label className="flex flex-col gap-1 text-xs">
        {t('machines.editor.stateType')}
        <select
          value={data.stateType}
          onChange={(e) => {
            handleUpdate({
              stateType: e.target.value as EditorNodeData['stateType'],
            });
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          data-testid="state-type-select"
        >
          <option value="action">action</option>
          <option value="child_machine">child_machine</option>
          <option value="parallel_children">parallel_children</option>
          <option value="terminal">terminal</option>
        </select>
      </label>

      {/* Action ID (for action / child_machine / parallel_children) */}
      {data.stateType !== 'terminal' && (
        <label className="flex flex-col gap-1 text-xs">
          {t('machines.editor.actionId')}
          <select
            value={data.actionId ?? ''}
            onChange={(e) => {
              handleUpdate({ actionId: e.target.value || undefined });
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
            data-testid="action-id-select"
          >
            <option value="">— none —</option>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Timeout */}
      {data.stateType !== 'terminal' && (
        <label className="flex flex-col gap-1 text-xs">
          {t('machines.editor.timeout')}
          <input
            type="number"
            min={0}
            value={data.timeoutMs ?? ''}
            onChange={(e) => {
              handleUpdate({
                timeoutMs: e.target.value ? Number(e.target.value) : undefined,
              });
            }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
            data-testid="timeout-input"
          />
        </label>
      )}

      {/* Is Initial */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={data.label === initialStateName}
          onChange={() => {
            setInitialState(data.label);
          }}
          data-testid="initial-state-checkbox"
        />
        {t('machines.editor.isInitial')}
      </label>

      {/* ── Child Machine fields ──────────────────────────────────────────── */}
      {data.stateType === 'child_machine' && (
        <>
          <label className="flex flex-col gap-1 text-xs">
            {t('machines.editor.childMachineDefId')}
            <select
              value={data.childMachineDefId ?? ''}
              onChange={(e) => {
                handleUpdate({ childMachineDefId: e.target.value || undefined });
              }}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
              data-testid="child-def-select"
            >
              <option value="">— none —</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('machines.editor.childInputMapping')}
            <input
              type="text"
              value={data.childInputMapping ?? ''}
              onChange={(e) => {
                handleUpdate({ childInputMapping: e.target.value || undefined });
              }}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
              data-testid="child-input-mapping"
            />
          </label>
        </>
      )}

      {/* ── Parallel Children fields ──────────────────────────────────────── */}
      {data.stateType === 'parallel_children' && (
        <>
          <label className="flex flex-col gap-1 text-xs">
            {t('machines.editor.parallelMode')}
            <select
              value={data.parallelMode ?? 'all_or_interrupt'}
              onChange={(e) => {
                handleUpdate({
                  parallelMode: e.target.value as 'all_or_interrupt' | 'all_settled',
                });
              }}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
              data-testid="parallel-mode-select"
            >
              <option value="all_or_interrupt">all_or_interrupt</option>
              <option value="all_settled">all_settled</option>
            </select>
          </label>

          <div className="flex flex-col gap-2 text-xs">
            <span className="font-medium">{t('machines.editor.children')}</span>
            {(data.children ?? []).map((child, i) => (
              <div
                key={child.key || String(i)}
                className="flex flex-col gap-1 rounded border border-[var(--color-border)] p-2"
              >
                <input
                  type="text"
                  placeholder={t('machines.editor.childKey')}
                  value={child.key}
                  onChange={(e) => {
                    const updated = [...(data.children ?? [])];
                    updated[i] = { ...updated[i], key: e.target.value };
                    handleUpdate({ children: updated });
                  }}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm"
                />
                <select
                  value={child.machineDefId}
                  onChange={(e) => {
                    const updated = [...(data.children ?? [])];
                    updated[i] = { ...updated[i], machineDefId: e.target.value };
                    handleUpdate({ children: updated });
                  }}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm"
                >
                  <option value="">— {t('machines.editor.childMachineId')} —</option>
                  {definitions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder={t('machines.editor.childInput')}
                  value={child.inputMapping}
                  onChange={(e) => {
                    const updated = [...(data.children ?? [])];
                    updated[i] = { ...updated[i], inputMapping: e.target.value };
                    handleUpdate({ children: updated });
                  }}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-sm"
                />
                <button
                  onClick={() => {
                    const updated = (data.children ?? []).filter((_, idx) => idx !== i);
                    handleUpdate({ children: updated });
                  }}
                  className="self-end text-[10px] text-red-500"
                >
                  {t('machines.editor.removeChild')}
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                handleUpdate({
                  children: [
                    ...(data.children ?? []),
                    { key: '', machineDefId: '', inputMapping: '' },
                  ],
                });
              }}
              className="rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface)]"
              data-testid="add-child-btn"
            >
              + {t('machines.editor.addChild')}
            </button>
          </div>
        </>
      )}

      {/* Delete state button */}
      <button
        onClick={() => {
          if (selectedNodeId) removeState(selectedNodeId);
        }}
        className="mt-2 rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
        data-testid="delete-state-btn"
      >
        {t('machines.editor.deleteState')}
      </button>
    </div>
  );
}
