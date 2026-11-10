/** The React Flow canvas: wiring between React Flow events, the Studio store and the shared selection. */
import { useCallback, useEffect, useRef, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '@/state/app';
import { cn } from '@/ui/primitives';
import { addEntity, addFree, addWidget, registerFlow } from './commands';
import { edgeTypes } from './edges/StudioEdge';
import { selectEdge, sharedSelectionForNode } from './interactions';
import { bindingItems, type WidgetKind } from './logic/widgets';
import { currentModel } from './model';
import { nodeTypes } from './nodes';
import { usePrefs } from './prefs';
import { useStudio } from './store';
import type { SEdge, SNode, StudioNodeType } from './types';
import { KIND_COLOR } from '@/ui/kinds';
import type { EntityKind } from '@/model';

/** Drag payload from the palette. */
export const DRAG_MIME = 'application/x-meridian-studio';
export type DragPayload = { kind: 'entity'; id: string } | { kind: 'free'; type: StudioNodeType; data?: Record<string, unknown> } | { kind: 'widget'; widget: WidgetKind; key: string };

const MINIMAP_COLOR = (n: Node): string => {
  if (n.type === 'entity') {
    const e = currentModel().entity((n.data as { entityId?: string }).entityId);
    return e ? (e.confidence === 'hypothetical' ? 'var(--k-hypo)' : KIND_COLOR[e.kind as EntityKind]) : 'var(--line-strong)';
  }
  if (n.type === 'frame') return 'transparent';
  return 'var(--line-strong)';
};

export function Canvas() {
  const flow = useReactFlow<SNode, SEdge>();
  const wrap = useRef<HTMLDivElement>(null);
  const { nodes, edges, connectMode, fitRequest, viewport } = useStudio(
    useShallow((s) => ({ nodes: s.nodes, edges: s.edges, connectMode: s.connectMode, fitRequest: s.fitRequest, viewport: s.viewport })),
  );
  const boardId = useStudio((s) => s.boardId);
  const snap = usePrefs((s) => s.snap);
  const minimap = usePrefs((s) => s.minimap);
  const presenting = useApp((s) => s.presenting);

  useEffect(() => {
    registerFlow(flow, wrap.current);
    return () => registerFlow(null, null);
  }, [flow]);

  // Restore the saved viewport when a board loads (or fit it once if none was saved).
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!boardId || restored.current === boardId) return;
    restored.current = boardId;
    const t = window.setTimeout(() => {
      if (viewport) void flow.setViewport(viewport);
      else if (useStudio.getState().nodes.length) void flow.fitView({ padding: 0.2, maxZoom: 1.1 });
      else void flow.setViewport({ x: 80, y: 80, zoom: 1 });
    }, 20);
    return () => window.clearTimeout(t);
  }, [boardId, viewport, flow]);

  useEffect(() => {
    if (!fitRequest) return;
    const t = window.setTimeout(() => {
      void flow.fitView({ nodes: fitRequest.ids.map((id) => ({ id })), padding: 0.2, duration: 320, maxZoom: 1.2 });
    }, 40);
    return () => window.clearTimeout(t);
  }, [fitRequest, flow]);

  const onConnect = useCallback((c: Connection) => {
    const s = useStudio.getState();
    const e = s.connect(c.source, c.target, { sourceHandle: c.sourceHandle, targetHandle: c.targetHandle });
    if (e) selectEdge(e.id);
  }, []);

  const onNodeClick = useCallback((ev: React.MouseEvent, node: SNode) => {
    const s = useStudio.getState();
    if (s.connectMode) {
      if (!s.connectFrom) s.setConnectFrom(node.id);
      else if (s.connectFrom !== node.id) {
        const e = s.connect(s.connectFrom, node.id);
        s.setConnectFrom(ev.shiftKey ? s.connectFrom : node.id);
        if (e) selectEdge(e.id);
      }
      return;
    }
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) return;
    const sel = sharedSelectionForNode(node);
    if (sel) useApp.getState().select(sel);
  }, []);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: SNode) => {
    if ((node.data as { locked?: boolean }).locked) return;
    useStudio.getState().setEditing(node.id);
  }, []);

  const onEdgeClick = useCallback((ev: React.MouseEvent, edge: Edge) => {
    selectEdge(edge.id, ev.shiftKey);
  }, []);
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => useStudio.getState().setEditingEdge(edge.id), []);

  const onPaneClick = useCallback(() => {
    const s = useStudio.getState();
    if (s.connectMode && s.connectFrom) s.setConnectFrom(null);
  }, []);

  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    useStudio.getState().setViewport(vp);
  }, []);

  const onDragStart = useCallback(() => useStudio.getState().checkpoint(), []);
  const onDragStop = useCallback((_: unknown, __: unknown, dragged: SNode[]) => useStudio.getState().endDrag(dragged.map((n) => n.id)), []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const p = JSON.parse(raw) as DragPayload;
      if (p.kind === 'entity') addEntity(p.id, at);
      else if (p.kind === 'free') addFree(p.type, p.data, { at });
      else {
        const item = bindingItems(currentModel(), p.widget).find((x) => x.key === p.key);
        if (item) addWidget(item.make(), undefined, at);
      }
    },
    [flow],
  );

  return (
    <div ref={wrap} className={cn('studio-canvas absolute inset-0', connectMode && 'studio-connect-mode')} data-testid="studio-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <pattern id="studio-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="8" style={{ fill: 'color-mix(in srgb, var(--k-hypo) 16%, transparent)' }} />
          </pattern>
        </defs>
      </svg>
      <ReactFlow<SNode, SEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={useStudio.getState().onNodesChange}
        onEdgesChange={useStudio.getState().onEdgesChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        onNodeDragStart={onDragStart}
        onSelectionDragStart={onDragStart}
        onNodeDragStop={onDragStop}
        onSelectionDragStop={(_e, dragged) => useStudio.getState().endDrag(dragged.map((n) => n.id))}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionMode={SelectionMode.Partial}
        disableKeyboardA11y
        elevateNodesOnSelect={false}
        snapToGrid={snap}
        snapGrid={[16, 16]}
        minZoom={0.08}
        maxZoom={2.5}
        zoomOnDoubleClick={false}
        nodeDragThreshold={2}
        defaultEdgeOptions={{ type: 'studio' }}
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2, strokeDasharray: '6 4' }}
        proOptions={{ hideAttribution: false }}
        aria-label="Studio board"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.3} color="var(--grid-dot)" />
        {minimap && !presenting && <MiniMap pannable zoomable nodeColor={MINIMAP_COLOR} nodeStrokeWidth={2} className="studio-minimap" ariaLabel="Board minimap" position="bottom-right" />}
      </ReactFlow>
    </div>
  );
}
