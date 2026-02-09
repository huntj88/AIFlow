import {
  Background,
  BackgroundVariant,
  type Edge,
  type EdgeTypes,
  Handle,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { useCallback, useMemo } from 'react';

import type { StateDefinition, StateMachineDefinition, TransitionRule } from '@/types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface StateDiagramProps {
  readonly definition: StateMachineDefinition;
  readonly currentState: string;
  readonly visitedStates?: ReadonlySet<string>;
}

interface StateNodeData {
  label: string;
  stateType: StateDefinition['type'];
  isCurrent: boolean;
  isVisited: boolean;
  isInitial: boolean;
  [key: string]: unknown;
}

type StateNode = Node<StateNodeData>;

// ────────────────────────────────────────────────────────────────────────────
// Dagre layout
// ────────────────────────────────────────────────────────────────────────────

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

function layoutGraph(nodes: StateNode[], edges: Edge[]): { nodes: StateNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: laidOut, edges };
}

// ────────────────────────────────────────────────────────────────────────────
// Custom node component
// ────────────────────────────────────────────────────────────────────────────

function StateNodeComponent({ data }: NodeProps<StateNode>) {
  const { label, stateType, isCurrent, isVisited, isInitial } = data;

  // Base style
  let bg = 'bg-[var(--color-surface)]';
  let border = 'border-[var(--color-border)]';
  let text = 'text-[var(--color-text)]';
  let extra = '';

  // Terminal states
  if (stateType === 'terminal') {
    bg = 'bg-gray-200 dark:bg-gray-700';
    border = 'border-gray-400 dark:border-gray-500';
  }

  // Child machine / parallel states
  if (stateType === 'child_machine') {
    border = 'border-purple-400 dark:border-purple-500';
  }
  if (stateType === 'parallel_children') {
    border = 'border-indigo-400 dark:border-indigo-500';
  }

  // Visited
  if (isVisited && !isCurrent) {
    bg = 'bg-green-50 dark:bg-green-950';
    border = 'border-green-300 dark:border-green-700';
    text = 'text-green-800 dark:text-green-200';
  }

  // Current state - most prominent
  if (isCurrent) {
    bg = 'bg-blue-100 dark:bg-blue-900';
    border = 'border-blue-500 dark:border-blue-400';
    text = 'text-blue-900 dark:text-blue-100';
    extra = 'ring-2 ring-blue-400 ring-offset-1 animate-pulse';
  }

  const shape = stateType === 'terminal' ? 'rounded-full' : 'rounded-lg';

  return (
    <div
      className={`flex items-center justify-center border-2 px-4 py-2 text-sm font-medium shadow-sm ${bg} ${border} ${text} ${shape} ${extra}`}
      style={{ minWidth: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      data-testid={`state-node-${label}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--color-border)]" />
      <div className="flex items-center gap-1.5">
        {isInitial && <span className="text-xs">▶</span>}
        {stateType === 'child_machine' && <span className="text-xs">🔗</span>}
        {stateType === 'parallel_children' && <span className="text-xs">⫘</span>}
        <span>{label}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[var(--color-border)]" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  stateNode: StateNodeComponent,
} as const;

const edgeTypes: EdgeTypes = {} as const;

// ────────────────────────────────────────────────────────────────────────────
// Build graph from definition
// ────────────────────────────────────────────────────────────────────────────

function buildGraph(
  definition: StateMachineDefinition,
  currentState: string,
  visitedStates: ReadonlySet<string>,
): { nodes: StateNode[]; edges: Edge[] } {
  const nodes: StateNode[] = Object.entries(definition.states).map(([name, state]) => ({
    id: name,
    type: 'stateNode',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      stateType: state.type,
      isCurrent: name === currentState,
      isVisited: visitedStates.has(name),
      isInitial: name === definition.initialState,
    },
  }));

  const edges: Edge[] = definition.transitions.map((tr: TransitionRule, idx: number) => ({
    id: `e-${tr.from}-${tr.to}-${String(idx)}`,
    source: tr.from,
    target: tr.to,
    label: tr.label ?? undefined,
    animated: tr.from === currentState,
    style: { stroke: tr.from === currentState ? '#3b82f6' : undefined },
    labelStyle: { fontSize: 11, fill: 'var(--color-text-muted)' },
  }));

  return layoutGraph(nodes, edges);
}

// ────────────────────────────────────────────────────────────────────────────
// Inner component (needs ReactFlowProvider above)
// ────────────────────────────────────────────────────────────────────────────

function StateDiagramInner({
  definition,
  currentState,
  visitedStates = new Set(),
}: StateDiagramProps) {
  const { fitView } = useReactFlow();

  const graph = useMemo(
    () => buildGraph(definition, currentState, visitedStates),
    [definition, currentState, visitedStates],
  );

  const [nodes, , onNodesChange] = useNodesState(graph.nodes);
  const [edges, , onEdgesChange] = useEdgesState(graph.edges);

  const onInit = useCallback(() => {
    void fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <div className="h-full w-full" data-testid="state-diagram">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Exported wrapper with provider
// ────────────────────────────────────────────────────────────────────────────

export function StateDiagram(props: StateDiagramProps) {
  return (
    <ReactFlowProvider>
      <StateDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
