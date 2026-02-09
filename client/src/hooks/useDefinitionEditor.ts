// ────────────────────────────────────────────────────────────────────────────
// Definition Editor — Zustand store
// Manages React Flow nodes/edges, undo/redo, dirty tracking, and validation.
// ────────────────────────────────────────────────────────────────────────────

import type { Edge, Node } from '@xyflow/react';
import dagre from 'dagre';
import { create } from 'zustand';

import type {
  ChildSpawnDefinition,
  StateDefinition,
  StateMachineDefinition,
  TransitionRule,
} from '../types/machines';
import { type ValidationError, validateDefinition } from '../utils/definitionValidator';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const MAX_UNDO = 50;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

// ────────────────────────────────────────────────────────────────────────────
// Editor node/edge data types
// ────────────────────────────────────────────────────────────────────────────

export interface EditorNodeData {
  label: string;
  stateType: StateDefinition['type'];
  isInitial: boolean;
  actionId?: string;
  timeoutMs?: number;
  description?: string;
  childMachineDefId?: string;
  childInputMapping?: string;
  parallelMode?: 'all_or_interrupt' | 'all_settled';
  children?: ChildSpawnDefinition[];
  [key: string]: unknown;
}

export type EditorNode = Node<EditorNodeData>;

export interface EditorEdgeData {
  condition?: string;
  [key: string]: unknown;
}

export type EditorEdge = Edge<EditorEdgeData>;

// ────────────────────────────────────────────────────────────────────────────
// Snapshot for undo/redo
// ────────────────────────────────────────────────────────────────────────────

interface EditorSnapshot {
  nodes: EditorNode[];
  edges: EditorEdge[];
  name: string;
  description: string;
  initialState: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs?: number;
  maxDepth?: number;
  middleware: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────────

export interface DefinitionEditorState {
  // ── Graph state ──────────────────────────────────────────────────────────
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // ── Definition metadata ──────────────────────────────────────────────────
  definitionId: string | null;
  definitionVersion: number;
  name: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  initialState: string;
  timeoutMs?: number;
  maxDepth?: number;
  middleware: string[];

  // ── Tracking ─────────────────────────────────────────────────────────────
  isDirty: boolean;
  validationErrors: ValidationError[];

  // ── Undo/Redo ────────────────────────────────────────────────────────────
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  // ── Node actions ─────────────────────────────────────────────────────────
  addState: (
    stateName: string,
    type: StateDefinition['type'],
    position?: { x: number; y: number },
  ) => void;
  removeState: (nodeId: string) => void;
  updateState: (nodeId: string, patch: Partial<EditorNodeData>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  setInitialState: (stateName: string) => void;

  // ── Edge actions ─────────────────────────────────────────────────────────
  addTransition: (from: string, to: string, label?: string) => void;
  removeTransition: (edgeId: string) => void;

  // ── Graph sync (from React Flow callbacks) ───────────────────────────────
  setNodes: (nodes: EditorNode[]) => void;
  setEdges: (edges: EditorEdge[]) => void;

  // ── Definition metadata actions ──────────────────────────────────────────
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setInputSchema: (schema: string) => void;
  setOutputSchema: (schema: string) => void;
  setTimeoutMs: (ms: number | undefined) => void;
  setMaxDepth: (depth: number | undefined) => void;
  setMiddleware: (middleware: string[]) => void;

  // ── Undo/Redo ────────────────────────────────────────────────────────────
  undo: () => void;
  redo: () => void;
  pushSnapshot: () => void;

  // ── I/O ──────────────────────────────────────────────────────────────────
  loadDefinition: (def: StateMachineDefinition) => void;
  toDefinition: () => Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>;
  validate: () => ValidationError[];
  reset: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Dagre layout helper
// ────────────────────────────────────────────────────────────────────────────

function layoutNodes(nodes: EditorNode[], edges: EditorEdge[]): EditorNode[] {
  if (nodes.length === 0) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ────────────────────────────────────────────────────────────────────────────

function definitionToGraph(def: StateMachineDefinition): {
  nodes: EditorNode[];
  edges: EditorEdge[];
} {
  const nodes: EditorNode[] = Object.entries(def.states).map(([name, state]) => ({
    id: name,
    type: 'editorStateNode',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      stateType: state.type,
      isInitial: name === def.initialState,
      actionId: state.actionId,
      timeoutMs: state.timeoutMs,
      description: state.description,
      childMachineDefId: state.childMachineDefId,
      childInputMapping: state.childInputMapping,
      parallelMode: state.parallelMode,
      children: state.children ? [...state.children] : undefined,
    },
  }));

  const edges: EditorEdge[] = def.transitions.map((tr, idx) => ({
    id: `e-${tr.from}-${tr.to}-${String(idx)}`,
    source: tr.from,
    target: tr.to,
    type: 'editorTransitionEdge',
    label: tr.label ?? undefined,
    data: { condition: tr.label },
  }));

  const laidOutNodes = layoutNodes(nodes, edges);
  return { nodes: laidOutNodes, edges };
}

function graphToStates(nodes: EditorNode[]): Record<string, StateDefinition> {
  const states: Record<string, StateDefinition> = {};
  for (const node of nodes) {
    const d = node.data;
    const state: StateDefinition = {
      name: d.label,
      type: d.stateType,
      ...(d.actionId ? { actionId: d.actionId } : {}),
      ...(d.timeoutMs ? { timeoutMs: d.timeoutMs } : {}),
      ...(d.description ? { description: d.description } : {}),
      ...(d.childMachineDefId ? { childMachineDefId: d.childMachineDefId } : {}),
      ...(d.childInputMapping ? { childInputMapping: d.childInputMapping } : {}),
      ...(d.parallelMode ? { parallelMode: d.parallelMode } : {}),
      ...(d.children && d.children.length > 0 ? { children: d.children } : {}),
    };
    states[d.label] = state;
  }
  return states;
}

function graphToTransitions(edges: EditorEdge[]): TransitionRule[] {
  return edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    ...(typeof edge.label === 'string' && edge.label ? { label: edge.label } : {}),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot helpers
// ────────────────────────────────────────────────────────────────────────────

function takeSnapshot(state: DefinitionEditorState): EditorSnapshot {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    name: state.name,
    description: state.description,
    initialState: state.initialState,
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    timeoutMs: state.timeoutMs,
    maxDepth: state.maxDepth,
    middleware: [...state.middleware],
  };
}

function restoreSnapshot(snapshot: EditorSnapshot): Partial<DefinitionEditorState> {
  return {
    nodes: structuredClone(snapshot.nodes),
    edges: structuredClone(snapshot.edges),
    name: snapshot.name,
    description: snapshot.description,
    initialState: snapshot.initialState,
    inputSchema: snapshot.inputSchema,
    outputSchema: snapshot.outputSchema,
    timeoutMs: snapshot.timeoutMs,
    maxDepth: snapshot.maxDepth,
    middleware: [...snapshot.middleware],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Initial state
// ────────────────────────────────────────────────────────────────────────────

const INITIAL_EDITOR_STATE = {
  nodes: [] as EditorNode[],
  edges: [] as EditorEdge[],
  selectedNodeId: null,
  selectedEdgeId: null,
  definitionId: null,
  definitionVersion: 0,
  name: '',
  description: '',
  inputSchema: '{}',
  outputSchema: '{}',
  initialState: '',
  timeoutMs: undefined,
  maxDepth: undefined,
  middleware: [] as string[],
  isDirty: false,
  validationErrors: [] as ValidationError[],
  undoStack: [] as EditorSnapshot[],
  redoStack: [] as EditorSnapshot[],
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

let nextNodeCounter = 1;

export const useDefinitionEditor = create<DefinitionEditorState>()((set, get) => ({
  ...INITIAL_EDITOR_STATE,

  // ── Node actions ─────────────────────────────────────────────────────────

  addState(stateName, type, position) {
    const state = get();
    state.pushSnapshot();
    const id = stateName || `state_${String(nextNodeCounter++)}`;
    const newNode: EditorNode = {
      id,
      type: 'editorStateNode',
      position: position ?? { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 },
      data: {
        label: id,
        stateType: type,
        isInitial: state.nodes.length === 0,
      },
    };
    const nodes = [...state.nodes, newNode];
    const initialState = state.nodes.length === 0 ? id : state.initialState;
    set({ nodes, initialState, isDirty: true, redoStack: [] });
  },

  removeState(nodeId) {
    const state = get();
    state.pushSnapshot();
    const nodes = state.nodes.filter((n) => n.id !== nodeId);
    const edges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    const removedNode = state.nodes.find((n) => n.id === nodeId);
    let { initialState } = state;
    if (removedNode && removedNode.data.label === initialState) {
      initialState = nodes.length > 0 ? nodes[0].data.label : '';
      // Mark new initial node
      if (nodes.length > 0) {
        nodes[0] = { ...nodes[0], data: { ...nodes[0].data, isInitial: true } };
      }
    }
    set({
      nodes,
      edges,
      initialState,
      isDirty: true,
      redoStack: [],
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    });
  },

  updateState(nodeId, patch) {
    const state = get();
    state.pushSnapshot();
    const nodes = state.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const newData = { ...n.data, ...patch };
      // If label changed, update the node id to match
      if (patch.label && patch.label !== n.id) {
        return { ...n, id: patch.label, data: newData };
      }
      return { ...n, data: newData };
    });

    // If label changed, update edges and initialState
    let { edges, initialState } = state;
    if (patch.label) {
      const oldLabel = state.nodes.find((n) => n.id === nodeId)?.data.label;
      const newLabel = patch.label;
      if (oldLabel && newLabel && oldLabel !== newLabel) {
        edges = edges.map((e) => ({
          ...e,
          source: e.source === oldLabel ? newLabel : e.source,
          target: e.target === oldLabel ? newLabel : e.target,
        }));
        if (initialState === oldLabel) {
          initialState = patch.label;
        }
      }
    }

    set({ nodes, edges, initialState, isDirty: true, redoStack: [] });
  },

  setSelectedNode(nodeId) {
    set({ selectedNodeId: nodeId, selectedEdgeId: nodeId ? null : get().selectedEdgeId });
  },

  setSelectedEdge(edgeId) {
    set({ selectedEdgeId: edgeId, selectedNodeId: edgeId ? null : get().selectedNodeId });
  },

  setInitialState(stateName) {
    const state = get();
    state.pushSnapshot();
    const nodes = state.nodes.map((n) => ({
      ...n,
      data: { ...n.data, isInitial: n.data.label === stateName },
    }));
    set({ nodes, initialState: stateName, isDirty: true, redoStack: [] });
  },

  // ── Edge actions ─────────────────────────────────────────────────────────

  addTransition(from, to, label) {
    const state = get();
    state.pushSnapshot();
    const id = `e-${from}-${to}-${String(Date.now())}`;
    const newEdge: EditorEdge = {
      id,
      source: from,
      target: to,
      type: 'editorTransitionEdge',
      label: label ?? undefined,
      data: { condition: label },
    };
    set({ edges: [...state.edges, newEdge], isDirty: true, redoStack: [] });
  },

  removeTransition(edgeId) {
    const state = get();
    state.pushSnapshot();
    set({
      edges: state.edges.filter((e) => e.id !== edgeId),
      isDirty: true,
      redoStack: [],
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
    });
  },

  // ── Graph sync ───────────────────────────────────────────────────────────

  setNodes(nodes) {
    set({ nodes, isDirty: true });
  },

  setEdges(edges) {
    set({ edges, isDirty: true });
  },

  // ── Definition metadata ──────────────────────────────────────────────────

  setName(name) {
    get().pushSnapshot();
    set({ name, isDirty: true, redoStack: [] });
  },

  setDescription(description) {
    get().pushSnapshot();
    set({ description, isDirty: true, redoStack: [] });
  },

  setInputSchema(schema) {
    get().pushSnapshot();
    set({ inputSchema: schema, isDirty: true, redoStack: [] });
  },

  setOutputSchema(schema) {
    get().pushSnapshot();
    set({ outputSchema: schema, isDirty: true, redoStack: [] });
  },

  setTimeoutMs(ms) {
    get().pushSnapshot();
    set({ timeoutMs: ms, isDirty: true, redoStack: [] });
  },

  setMaxDepth(depth) {
    get().pushSnapshot();
    set({ maxDepth: depth, isDirty: true, redoStack: [] });
  },

  setMiddleware(middleware) {
    get().pushSnapshot();
    set({ middleware, isDirty: true, redoStack: [] });
  },

  // ── Undo/Redo ────────────────────────────────────────────────────────────

  pushSnapshot() {
    const state = get();
    const snap = takeSnapshot(state);
    const stack = [...state.undoStack, snap];
    if (stack.length > MAX_UNDO) stack.shift();
    set({ undoStack: stack });
  },

  undo() {
    const state = get();
    if (state.undoStack.length === 0) return;
    const newUndo = [...state.undoStack];
    const snapshot = newUndo.pop();
    if (!snapshot) return;
    const currentSnap = takeSnapshot(state);
    set({
      ...restoreSnapshot(snapshot),
      undoStack: newUndo,
      redoStack: [...state.redoStack, currentSnap],
      isDirty: true,
    });
  },

  redo() {
    const state = get();
    if (state.redoStack.length === 0) return;
    const newRedo = [...state.redoStack];
    const snapshot = newRedo.pop();
    if (!snapshot) return;
    const currentSnap = takeSnapshot(state);
    set({
      ...restoreSnapshot(snapshot),
      redoStack: newRedo,
      undoStack: [...state.undoStack, currentSnap],
      isDirty: true,
    });
  },

  // ── I/O ──────────────────────────────────────────────────────────────────

  loadDefinition(def) {
    const { nodes, edges } = definitionToGraph(def);
    nextNodeCounter = nodes.length + 1;
    set({
      nodes,
      edges,
      definitionId: def.id,
      definitionVersion: def.version,
      name: def.name,
      description: def.metadata.description ?? '',
      inputSchema: JSON.stringify(def.inputSchema, null, 2),
      outputSchema: JSON.stringify(def.outputSchema, null, 2),
      initialState: def.initialState,
      timeoutMs: undefined,
      maxDepth: undefined,
      middleware: [],
      isDirty: false,
      validationErrors: [],
      undoStack: [],
      redoStack: [],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  toDefinition() {
    const state = get();
    let inputSchema: Record<string, unknown> = {};
    let outputSchema: Record<string, unknown> = {};
    try {
      inputSchema = JSON.parse(state.inputSchema) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    try {
      outputSchema = JSON.parse(state.outputSchema) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }

    return {
      name: state.name,
      inputSchema,
      outputSchema,
      states: graphToStates(state.nodes),
      initialState: state.initialState,
      transitions: graphToTransitions(state.edges),
    };
  },

  validate() {
    const state = get();
    const def = state.toDefinition();
    // Build a partial definition matching the validator's expected shape
    const partial = {
      ...def,
      states: def.states,
      transitions: def.transitions,
      initialState: def.initialState,
    };
    const errors = validateDefinition(partial);
    set({ validationErrors: errors });
    return errors;
  },

  reset() {
    nextNodeCounter = 1;
    set({ ...INITIAL_EDITOR_STATE });
  },
}));
