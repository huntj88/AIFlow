// ────────────────────────────────────────────────────────────────────────────
// Definition Editor — main layout with React Flow canvas, toolbar, and panels
// ────────────────────────────────────────────────────────────────────────────

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type EdgeTypes,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { type EditorEdge, type EditorNode, useDefinitionEditor } from '@/hooks/useDefinitionEditor';
import { useMachineDefinitions } from '@/hooks/useMachineDefinitions';
import type { ActionMetadata, StateMachineDefinition } from '@/types/machines';
import { apiClient } from '@/utils/apiClient';
import { runWithLogging } from '@/utils/logger';

import { DefinitionMetaPanel } from './DefinitionMetaPanel';
import { StateConfigPanel } from './StateConfigPanel';
import { StateNode } from './StateNode';
import { TransitionEdge } from './TransitionEdge';

// ────────────────────────────────────────────────────────────────────────────
// Node / Edge type registrations
// ────────────────────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  editorStateNode: StateNode,
} as const;

const edgeTypes: EdgeTypes = {
  editorTransitionEdge: TransitionEdge,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

interface DefinitionEditorProps {
  /** Existing definition to edit, or undefined for new. */
  readonly existingDefinition?: StateMachineDefinition;
}

// ────────────────────────────────────────────────────────────────────────────
// Inner component (needs ReactFlowProvider above)
// ────────────────────────────────────────────────────────────────────────────

function DefinitionEditorInner({ existingDefinition }: DefinitionEditorProps) {
  const { t } = useTranslation();
  const { fitView } = useReactFlow();
  const navigate = useNavigate();

  // ── Store selectors ────────────────────────────────────────────────────
  const nodes = useDefinitionEditor((s) => s.nodes);
  const edges = useDefinitionEditor((s) => s.edges);
  const selectedNodeId = useDefinitionEditor((s) => s.selectedNodeId);
  const isDirty = useDefinitionEditor((s) => s.isDirty);
  const validationErrors = useDefinitionEditor((s) => s.validationErrors);
  const undoStack = useDefinitionEditor((s) => s.undoStack);
  const redoStack = useDefinitionEditor((s) => s.redoStack);
  const definitionId = useDefinitionEditor((s) => s.definitionId);

  const setNodes = useDefinitionEditor((s) => s.setNodes);
  const setEdges = useDefinitionEditor((s) => s.setEdges);
  const setSelectedNode = useDefinitionEditor((s) => s.setSelectedNode);
  const setSelectedEdge = useDefinitionEditor((s) => s.setSelectedEdge);
  const addState = useDefinitionEditor((s) => s.addState);
  const addTransition = useDefinitionEditor((s) => s.addTransition);
  const removeTransition = useDefinitionEditor((s) => s.removeTransition);
  const loadDefinition = useDefinitionEditor((s) => s.loadDefinition);
  const toDefinition = useDefinitionEditor((s) => s.toDefinition);
  const validate = useDefinitionEditor((s) => s.validate);
  const undo = useDefinitionEditor((s) => s.undo);
  const redo = useDefinitionEditor((s) => s.redo);
  const reset = useDefinitionEditor((s) => s.reset);

  const createDef = useCallback(
    (body: Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>) =>
      useMachineDefinitions.getState().createDefinition(body),
    [],
  );
  const updateDef = useCallback(
    (id: string, body: Partial<Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>>) =>
      useMachineDefinitions.getState().updateDefinition(id, body),
    [],
  );

  // ── Local state ────────────────────────────────────────────────────────
  const [actions, setActions] = useState<ActionMetadata[]>([]);
  const [definitions, setDefinitions] = useState<StateMachineDefinition[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing definition on mount ──────────────────────────────────
  useEffect(() => {
    if (existingDefinition) {
      loadDefinition(existingDefinition);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDefinition?.id]);

  // ── Fetch actions and definitions for dropdowns ────────────────────────
  useEffect(() => {
    void runWithLogging(apiClient.getActions())
      .then((a) => {
        setActions(a);
      })
      .catch(() => {
        /* swallow — dropdowns will just be empty */
      });
    void runWithLogging(apiClient.getDefinitions())
      .then((d) => {
        setDefinitions(d);
      })
      .catch(() => {
        /* swallow */
      });
  }, []);

  // ── Fit view when nodes change significantly ───────────────────────────
  useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to allow layout to settle
      const timer = setTimeout(() => {
        void fitView({ padding: 0.15 });
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [nodes.length, fitView]);

  // ── beforeunload guard ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [isDirty]);

  // ── React Flow callbacks ───────────────────────────────────────────────

  const onNodesChange: OnNodesChange<EditorNode> = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, nodes);
      setNodes(updated);
    },
    [nodes, setNodes],
  );

  const onEdgesChange: OnEdgesChange<EditorEdge> = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, edges);
      setEdges(updated);
    },
    [edges, setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        addTransition(connection.source, connection.target);
      }
    },
    [addTransition],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: EditorNode) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: EditorEdge) => {
      setSelectedEdge(edge.id);
    },
    [setSelectedEdge],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  // ── Toolbar handlers ───────────────────────────────────────────────────

  const handleAddState = useCallback(() => {
    addState('', 'action');
  }, [addState]);

  const handleValidate = useCallback(() => {
    const errors = validate();
    setShowValidation(true);
    if (errors.filter((e) => e.severity === 'error').length === 0) {
      toast.success(t('machines.editor.validationPassed'));
    } else {
      toast.error(t('machines.editor.validationFailed', { count: errors.length }));
    }
  }, [validate, t]);

  const handleSave = useCallback(async () => {
    const errors = validate();
    setShowValidation(true);
    if (errors.filter((e) => e.severity === 'error').length > 0) {
      toast.error(t('machines.editor.validationFailed', { count: errors.length }));
      return;
    }

    setIsSaving(true);
    try {
      const def = toDefinition();
      if (definitionId) {
        await updateDef(definitionId, def);
        toast.success(t('machines.toast.definitionSaved'));
      } else {
        const created = await createDef(def);
        // Update editor state with new ID
        useDefinitionEditor.setState({
          definitionId: created.id,
          definitionVersion: created.version,
          isDirty: false,
        });
        toast.success(t('machines.toast.definitionSaved'));
        // Redirect to edit URL with the new ID
        void navigate(`/machines/definitions/${created.id}/edit`, { replace: true });
      }
      useDefinitionEditor.setState({ isDirty: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('machines.editor.saveError')}: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [validate, toDefinition, definitionId, createDef, updateDef, t, navigate]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Save: Ctrl+S / Cmd+S
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        void handleSave();
        return;
      }
      // Delete selected edge
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useDefinitionEditor.getState().selectedEdgeId;
        if (sel) {
          removeTransition(sel);
          return;
        }
      }
      // Escape — deselect
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
        return;
      }
      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [undo, redo, removeTransition, setSelectedNode, setSelectedEdge, handleSave]);

  const handleExport = useCallback(() => {
    const def = toDefinition();
    const json = JSON.stringify(def, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.name || 'definition'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [toDefinition]);

  const handleImport = useCallback(() => {
    if (isDirty && !window.confirm(t('machines.editor.importConfirm'))) return;
    fileInputRef.current?.click();
  }, [isDirty, t]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
          loadDefinition({
            id: (parsed.id as string | undefined) ?? '',
            name: (parsed.name as string | undefined) ?? '',
            version: (parsed.version as number | undefined) ?? 1,
            inputSchema: (parsed.inputSchema as Record<string, unknown> | undefined) ?? {},
            outputSchema: (parsed.outputSchema as Record<string, unknown> | undefined) ?? {},
            states: (parsed.states as StateMachineDefinition['states'] | undefined) ?? {},
            initialState: (parsed.initialState as string | undefined) ?? '',
            transitions:
              (parsed.transitions as StateMachineDefinition['transitions'] | undefined) ?? [],
            metadata: (parsed.metadata as StateMachineDefinition['metadata'] | undefined) ?? {
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
          useDefinitionEditor.setState({ isDirty: true, definitionId: null });
          toast.success(t('machines.editor.importSuccess'));
        } catch {
          toast.error(t('machines.editor.importError'));
        }
      };
      reader.readAsText(file);
      // Reset file input so re-importing the same file works
      e.target.value = '';
    },
    [loadDefinition, t],
  );

  const handleBack = useCallback(() => {
    if (isDirty && !window.confirm(t('machines.confirm.unsavedChanges'))) return;
    void navigate('/machines');
  }, [isDirty, navigate, t]);

  const handleDeleteDefinition = useCallback(async () => {
    if (!definitionId) return;
    setShowDeleteConfirm(false);
    try {
      await useMachineDefinitions.getState().deleteDefinition(definitionId);
      toast.success(t('machines.toast.definitionDeleted'));
      void navigate('/machines');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('machines.toast.error', { message: msg }));
    }
  }, [definitionId, navigate, t]);

  // ── Render ─────────────────────────────────────────────────────────────

  const errorCount = validationErrors.filter((e) => e.severity === 'error').length;
  const warningCount = validationErrors.filter((e) => e.severity === 'warning').length;

  return (
    <div className="flex h-full flex-col" data-testid="definition-editor">
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        data-testid="import-file-input"
      />

      {/* ── Canvas + Side Panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* React Flow Canvas */}
        <div className="flex-1">
          <ReactFlow<EditorNode, EditorEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'editorTransitionEdge' }}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={3}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right sidebar */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)]">
          {selectedNodeId ? (
            <StateConfigPanel actions={actions} definitions={definitions} />
          ) : (
            <>
              <div className="p-3 text-xs text-[var(--color-text-muted)]">
                {t('machines.editor.noSelection')}
              </div>
              <DefinitionMetaPanel />
            </>
          )}
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <button
          onClick={handleBack}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          data-testid="back-btn"
        >
          {t('machines.editor.backToDashboard')}
        </button>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <button
          onClick={handleAddState}
          className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs text-white"
          data-testid="add-state-btn"
        >
          {t('machines.editor.addState')}
        </button>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving}
          className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          data-testid="save-btn"
        >
          {isSaving ? t('machines.editor.saving') : t('machines.editor.save')}
        </button>

        <button
          onClick={handleValidate}
          className="rounded bg-amber-600 px-3 py-1 text-xs text-white"
          data-testid="validate-btn"
        >
          {t('machines.editor.validate')}
        </button>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <button
          onClick={handleImport}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          data-testid="import-btn"
        >
          {t('machines.editor.import')}
        </button>

        <button
          onClick={handleExport}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          data-testid="export-btn"
        >
          {t('machines.editor.export')}
        </button>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-30"
          data-testid="undo-btn"
        >
          {t('machines.editor.undo')}
        </button>

        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-30"
          data-testid="redo-btn"
        >
          {t('machines.editor.redo')}
        </button>

        {/* Dirty indicator */}
        {isDirty && (
          <span className="text-xs text-amber-500" data-testid="dirty-indicator">
            ● {t('machines.editor.unsaved')}
          </span>
        )}

        {definitionId && (
          <>
            <div className="h-4 w-px bg-[var(--color-border)]" />
            <button
              onClick={() => {
                setShowDeleteConfirm(true);
              }}
              className="rounded bg-red-500 px-3 py-1 text-xs text-white"
              data-testid="delete-definition-btn"
            >
              {t('machines.editor.deleteDefinition')}
            </button>
          </>
        )}
      </div>

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t('machines.editor.deleteDefinition')}
        message={t('machines.editor.deleteDefinitionConfirm')}
        variant="danger"
        onConfirm={() => {
          void handleDeleteDefinition();
        }}
        onCancel={() => {
          setShowDeleteConfirm(false);
        }}
      />

      {/* ── Validation errors ───────────────────────────────────────────── */}
      {showValidation && validationErrors.length > 0 && (
        <div
          className="max-h-40 overflow-y-auto border-t border-[var(--color-border)] bg-red-50 px-4 py-2 dark:bg-red-950"
          data-testid="validation-errors"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-red-700 dark:text-red-300">
              {t('machines.editor.validationFailed', {
                count: errorCount + warningCount,
              })}
            </span>
            <button
              onClick={() => {
                setShowValidation(false);
              }}
              className="text-xs text-red-500 hover:underline"
              data-testid="dismiss-validation"
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-0.5">
            {validationErrors.map((err, i) => (
              <li
                key={`${err.rule}-${String(i)}`}
                className={`text-xs ${err.severity === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}
              >
                <span className="font-mono">[{err.rule}]</span>{' '}
                {err.stateName && <span className="font-medium">{err.stateName}: </span>}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Exported wrapper with ReactFlowProvider
// ────────────────────────────────────────────────────────────────────────────

export function DefinitionEditor(props: DefinitionEditorProps) {
  return (
    <ReactFlowProvider>
      <DefinitionEditorInner {...props} />
    </ReactFlowProvider>
  );
}
