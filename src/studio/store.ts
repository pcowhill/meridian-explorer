/**
 * Live editing state of the Explanation Studio: the active board's nodes and
 * edges (React Flow objects), selection, undo/redo history and transient
 * presentation state (connect mode, spotlight, path animation).
 *
 * Every board mutation goes through `commit`, which pushes the previous
 * {nodes, edges} snapshot onto the undo stack (snapshots share structure, so
 * this is cheap). Drags and resizes call `checkpoint()` once at gesture start
 * and then stream position/size changes without further history entries, so
 * a whole drag is one undo step. The Studio component autosaves to the
 * workspace whenever `revision` changes.
 */
import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from '@xyflow/react';
import { create } from 'zustand';
import type { StudioBoard } from '@/state/workspace';
import { newId } from '@/state/workspace';
import type { AlignMode, Point } from './logic/geometry';
import { absPos, absRect, alignRects, distributeRects, indexNodes, nodeSize, sortParentsFirst } from './logic/geometry';
import {
  autoLayout,
  cloneElements,
  decorate,
  frameAt,
  fromStudioEdge,
  fromStudioNode,
  groupIntoFrame,
  normalise,
  removeNodes,
  reparent,
  toStudioEdge,
  toStudioNode,
  type Patch,
} from './logic/build';
import { autoConnect, entityOf, knownEdgeData, newEdgeId } from './logic/modelEdges';
import { currentModel } from './model';
import type { EdgeData, NodeStyle, SEdge, SNode } from './types';

export interface Snapshot {
  nodes: SNode[];
  edges: SEdge[];
}

export interface FocusState {
  nodeIds: string[];
  edgeIds: string[];
  /** Highlight path (edges emphasised) vs plain spotlight. */
  mode: 'spotlight' | 'path';
}

export interface AnimState {
  nodes: string[];
  edges: (string | null)[];
  /** Number of hops completed (0 … nodes.length - 1). */
  index: number;
  playing: boolean;
}

export interface StudioState extends Snapshot {
  boardId: string | null;
  viewport: { x: number; y: number; zoom: number } | undefined;
  past: Snapshot[];
  future: Snapshot[];
  /** Bumped on every content change; drives autosave. */
  revision: number;
  coalesce: { key: string; at: number } | null;
  /** Ids in the order they were selected (for chains). */
  selectionOrder: string[];
  editingId: string | null;
  editingEdgeId: string | null;
  connectMode: boolean;
  connectFrom: string | null;
  focus: FocusState | null;
  anim: AnimState | null;
  /** Fit-the-view request consumed by the canvas. */
  fitRequest: { ids: string[]; seq: number } | null;

  load: (board: StudioBoard | null) => void;
  toBoard: (base: StudioBoard) => StudioBoard;
  setViewport: (v: { x: number; y: number; zoom: number }) => void;

  checkpoint: () => void;
  commit: (fn: (s: Snapshot) => Partial<Snapshot>, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;

  onNodesChange: (changes: NodeChange<SNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<SEdge>[]) => void;
  setSelection: (nodeIds: string[], edgeIds?: string[]) => void;
  requestFit: (ids: string[]) => void;

  applyPatch: (patch: Patch, opts?: { replaceNodes?: SNode[] }) => void;
  addNodes: (nodes: SNode[], edges?: SEdge[], opts?: { autoConnect?: boolean }) => void;
  updateNodeData: (id: string, patch: Record<string, unknown>, coalesce?: string) => void;
  updateEdgeData: (id: string, patch: Partial<EdgeData>, coalesce?: string) => void;
  setNodeStyle: (ids: string[], style: Partial<NodeStyle>) => void;
  resizeNode: (id: string, w: number, h: number) => void;
  deleteSelection: () => void;
  deleteElements: (nodeIds: string[], edgeIds: string[]) => void;
  duplicateSelection: () => void;
  pasteElements: (clip: Snapshot, at?: Point) => void;
  hideSelection: () => void;
  showElements: (nodeIds: string[], edgeIds?: string[]) => void;
  toggleLock: () => void;
  toggleProposed: () => void;
  zOrder: (where: 'front' | 'back') => void;
  groupSelection: (label?: string) => string | null;
  align: (mode: AlignMode) => void;
  distribute: (axis: 'x' | 'y') => void;
  nudge: (dx: number, dy: number) => void;
  layout: (ids?: string[]) => void;
  connect: (source: string, target: string, handles?: { sourceHandle?: string | null; targetHandle?: string | null }) => SEdge | null;
  endDrag: (ids: string[]) => void;

  setEditing: (id: string | null) => void;
  setEditingEdge: (id: string | null) => void;
  setConnectMode: (on: boolean) => void;
  setConnectFrom: (id: string | null) => void;
  setFocus: (focus: FocusState | null) => void;
  setAnim: (anim: AnimState | null) => void;
  stepAnim: (delta: number) => void;
}

const HISTORY_LIMIT = 150;
const COALESCE_MS = 1200;

export const selectedNodeIds = (s: Pick<Snapshot, 'nodes'>): string[] => s.nodes.filter((n) => n.selected).map((n) => n.id);
export const selectedEdgeIds = (s: Pick<Snapshot, 'edges'>): string[] => s.edges.filter((e) => e.selected).map((e) => e.id);

/** Selected nodes, plus anything inside selected frames. */
function withFrameContents(nodes: SNode[], ids: string[]): string[] {
  const set = new Set(ids);
  for (const n of nodes) if (n.parentId && set.has(n.parentId)) set.add(n.id);
  return [...set];
}

export const useStudio = create<StudioState>()((set, get) => {
  const snapshot = (): Snapshot => ({ nodes: get().nodes, edges: get().edges });

  const commit: StudioState['commit'] = (fn, opts) => {
    const s = get();
    const now = Date.now();
    const coalesced = !!opts?.coalesce && s.coalesce?.key === opts.coalesce && now - s.coalesce.at < COALESCE_MS;
    const result = fn(snapshot());
    set({
      ...result,
      past: coalesced ? s.past : [...s.past, snapshot()].slice(-HISTORY_LIMIT),
      future: [],
      revision: s.revision + 1,
      coalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  };

  const selectOnly = (nodes: SNode[], ids: ReadonlySet<string>): SNode[] =>
    nodes.map((n) => (!!n.selected === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) }));
  const deselectEdges = (edges: SEdge[]): SEdge[] => edges.map((e) => (e.selected ? { ...e, selected: false } : e));

  return {
    boardId: null,
    viewport: undefined,
    nodes: [],
    edges: [],
    past: [],
    future: [],
    revision: 0,
    coalesce: null,
    selectionOrder: [],
    editingId: null,
    editingEdgeId: null,
    connectMode: false,
    connectFrom: null,
    focus: null,
    anim: null,
    fitRequest: null,

    load: (board) => {
      const { nodes, edges } = normalise((board?.nodes ?? []).map(fromStudioNode), (board?.edges ?? []).map(fromStudioEdge));
      set({
        boardId: board?.id ?? null,
        viewport: board?.viewport,
        nodes,
        edges,
        past: [],
        future: [],
        coalesce: null,
        selectionOrder: [],
        editingId: null,
        editingEdgeId: null,
        connectFrom: null,
        focus: null,
        anim: null,
      });
    },

    toBoard: (base) => {
      const s = get();
      return { ...base, nodes: s.nodes.map(toStudioNode), edges: s.edges.map(toStudioEdge), viewport: s.viewport ?? base.viewport };
    },

    setViewport: (viewport) => set({ viewport }),

    checkpoint: () => {
      const s = get();
      set({ past: [...s.past, snapshot()].slice(-HISTORY_LIMIT), future: [], coalesce: null });
    },
    commit,

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({ ...prev, past: s.past.slice(0, -1), future: [snapshot(), ...s.future].slice(0, HISTORY_LIMIT), revision: s.revision + 1, coalesce: null, editingId: null, editingEdgeId: null, anim: null });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ ...next, past: [...s.past, snapshot()].slice(-HISTORY_LIMIT), future: s.future.slice(1), revision: s.revision + 1, coalesce: null, editingId: null, editingEdgeId: null, anim: null });
    },

    onNodesChange: (changes) => {
      const s = get();
      // Removal goes through deleteSelection (so it is undoable and respects locks).
      const relevant = changes.filter((c) => c.type !== 'remove');
      if (!relevant.length) return;
      const content = relevant.some((c) => (c.type === 'position' && c.position) || (c.type === 'dimensions' && c.resizing));
      let order = s.selectionOrder;
      for (const c of relevant) {
        if (c.type !== 'select') continue;
        order = c.selected ? [...order.filter((x) => x !== c.id), c.id] : order.filter((x) => x !== c.id);
      }
      set({ nodes: applyNodeChanges(relevant, s.nodes), selectionOrder: order, revision: content ? s.revision + 1 : s.revision });
    },
    onEdgesChange: (changes) => {
      const relevant = changes.filter((c) => c.type !== 'remove');
      if (relevant.length) set({ edges: applyEdgeChanges(relevant, get().edges) });
    },
    setSelection: (nodeIds, edgeIds = []) => {
      const ns = new Set(nodeIds);
      const es = new Set(edgeIds);
      set((s) => ({
        nodes: selectOnly(s.nodes, ns),
        edges: s.edges.map((e) => (!!e.selected === es.has(e.id) ? e : { ...e, selected: es.has(e.id) })),
        selectionOrder: nodeIds,
      }));
    },
    requestFit: (ids) => set((s) => ({ fitRequest: { ids, seq: (s.fitRequest?.seq ?? 0) + 1 } })),

    applyPatch: (patch, opts) => {
      if (!patch.nodes.length && !patch.edges.length && !opts?.replaceNodes) {
        if (patch.select.length) get().setSelection(patch.select);
        if (patch.focus.length) get().requestFit(patch.focus);
        return;
      }
      // Many new nodes: select nothing (the toast says what was added); one new node: select it.
      const select = patch.nodes.length === 0 ? patch.select : patch.nodes.length === 1 ? [patch.nodes[0].id] : [];
      const sel = new Set(select);
      commit((s) => ({
        nodes: sortParentsFirst([...selectOnly(opts?.replaceNodes ?? s.nodes, new Set()), ...patch.nodes]).map((n) => (!!n.selected === sel.has(n.id) ? n : { ...n, selected: sel.has(n.id) })),
        edges: [...deselectEdges(s.edges), ...patch.edges],
      }));
      set({ selectionOrder: select });
      if (patch.focus.length) get().requestFit(patch.focus);
    },

    addNodes: (nodes, edges = [], opts) => {
      const model = currentModel();
      const ids = new Set(nodes.map((n) => n.id));
      commit((s) => {
        const all = [...selectOnly(s.nodes, new Set()), ...nodes.map((n) => ({ ...n, selected: true }))];
        const extra = opts?.autoConnect ? autoConnect(model, all, [...s.edges, ...edges], ids) : [];
        return { nodes: sortParentsFirst(all), edges: [...deselectEdges(s.edges), ...edges, ...extra] };
      });
      set({ selectionOrder: [...ids] });
    },

    updateNodeData: (id, patch, coalesce) =>
      commit((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? decorate({ ...n, data: { ...n.data, ...patch } }) : n)) }), { coalesce: coalesce ? `${id}:${coalesce}` : undefined }),

    updateEdgeData: (id, patch, coalesce) =>
      commit((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) }), { coalesce: coalesce ? `${id}:${coalesce}` : undefined }),

    setNodeStyle: (ids, style) => {
      const set_ = new Set(ids);
      commit((s) => ({ nodes: s.nodes.map((n) => (set_.has(n.id) ? { ...n, data: { ...n.data, style: { ...((n.data.style as NodeStyle) ?? {}), ...style } } } : n)) }));
    },

    resizeNode: (id, w, h) => commit((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, width: w, height: h } : n)) })),

    deleteElements: (nodeIds, edgeIds) => {
      const s = get();
      const locked = new Set(s.nodes.filter((n) => (n.data as { locked?: boolean }).locked).map((n) => n.id));
      const ids = new Set(nodeIds.filter((id) => !locked.has(id)));
      const eids = new Set(edgeIds);
      if (!ids.size && !eids.size) return;
      commit((cur) => {
        const r = removeNodes(cur.nodes, cur.edges, ids);
        return { nodes: r.nodes, edges: r.edges.filter((e) => !eids.has(e.id)) };
      });
      set((st) => ({
        selectionOrder: [],
        focus: st.focus ? { ...st.focus, nodeIds: st.focus.nodeIds.filter((x) => !ids.has(x)), edgeIds: st.focus.edgeIds.filter((x) => !eids.has(x)) } : null,
        anim: null,
      }));
    },
    deleteSelection: () => {
      const s = get();
      get().deleteElements(selectedNodeIds(s), selectedEdgeIds(s));
    },

    duplicateSelection: () => {
      const s = get();
      const ids = selectedNodeIds(s).filter((id) => {
        const n = s.nodes.find((x) => x.id === id);
        return !(n?.parentId && s.nodes.find((p) => p.id === n.parentId)?.selected);
      });
      if (!ids.length) return;
      const c = cloneElements(s.nodes, s.edges, ids, { x: 32, y: 32 });
      commit((cur) => ({ nodes: sortParentsFirst([...selectOnly(cur.nodes, new Set()), ...c.nodes]), edges: [...deselectEdges(cur.edges), ...c.edges] }));
      set({ selectionOrder: c.nodes.map((n) => n.id) });
    },

    pasteElements: (clip, at) => {
      if (!clip.nodes.length) return;
      const top = clip.nodes.filter((n) => !n.parentId || !clip.nodes.some((p) => p.id === n.parentId));
      const byId = indexNodes(clip.nodes);
      let offset: Point = { x: 40, y: 40 };
      if (at) {
        const xs = top.map((n) => absPos(n, byId));
        offset = { x: at.x - Math.min(...xs.map((p) => p.x)), y: at.y - Math.min(...xs.map((p) => p.y)) };
      }
      const c = cloneElements(clip.nodes, clip.edges, top.map((n) => n.id), offset);
      commit((cur) => ({ nodes: sortParentsFirst([...selectOnly(cur.nodes, new Set()), ...c.nodes]), edges: [...deselectEdges(cur.edges), ...c.edges] }));
      set({ selectionOrder: c.nodes.map((n) => n.id) });
    },

    hideSelection: () => {
      const s = get();
      const ids = new Set(withFrameContents(s.nodes, selectedNodeIds(s)));
      const eids = new Set(selectedEdgeIds(s));
      if (!ids.size && !eids.size) return;
      commit((cur) => ({
        nodes: cur.nodes.map((n) => (ids.has(n.id) ? { ...n, hidden: true, selected: false } : n)),
        edges: cur.edges.map((e) => (eids.has(e.id) ? { ...e, hidden: true, selected: false } : e)),
      }));
    },
    showElements: (nodeIds, edgeIds = []) => {
      const ids = new Set(nodeIds);
      const eids = new Set(edgeIds);
      commit((cur) => ({
        nodes: cur.nodes.map((n) => (ids.has(n.id) && n.hidden ? { ...n, hidden: false } : n)),
        edges: cur.edges.map((e) => (eids.has(e.id) && e.hidden ? { ...e, hidden: false } : e)),
      }));
    },

    toggleLock: () => {
      const s = get();
      const ids = new Set(selectedNodeIds(s));
      if (!ids.size) return;
      const lock = s.nodes.some((n) => ids.has(n.id) && !(n.data as { locked?: boolean }).locked);
      commit((cur) => ({ nodes: cur.nodes.map((n) => (ids.has(n.id) ? decorate({ ...n, data: { ...n.data, locked: lock || undefined } }) : n)) }));
    },

    toggleProposed: () => {
      const s = get();
      const ids = new Set(selectedNodeIds(s));
      const eids = new Set(selectedEdgeIds(s));
      const anyOff = s.nodes.some((n) => ids.has(n.id) && n.type !== 'entity' && !(n.data as { proposed?: boolean }).proposed) || s.edges.some((e) => eids.has(e.id) && !e.data?.proposed);
      commit((cur) => ({
        nodes: cur.nodes.map((n) => (ids.has(n.id) && n.type !== 'entity' ? { ...n, data: { ...n.data, proposed: anyOff || undefined } } : n)),
        edges: cur.edges.map((e) => (eids.has(e.id) ? { ...e, data: { ...e.data, proposed: anyOff || undefined } } : e)),
      }));
    },

    zOrder: (where) => {
      const s = get();
      const ids = new Set(selectedNodeIds(s));
      if (!ids.size) return;
      const content = s.nodes.filter((n) => n.type !== 'frame' && !ids.has(n.id));
      const max = Math.max(1, ...content.map((n) => n.zIndex ?? 1));
      commit((cur) => ({
        nodes: cur.nodes.map((n) => {
          // Frames stay beneath content; they only reorder among themselves.
          if (n.type === 'frame') return ids.has(n.id) ? { ...n, zIndex: where === 'front' ? 0 : -1 } : n;
          if (ids.has(n.id)) return { ...n, zIndex: where === 'front' ? max + 1 : 1 };
          return where === 'back' ? { ...n, zIndex: (n.zIndex ?? 1) + 1 } : n;
        }),
      }));
    },

    groupSelection: (label = 'Frame') => {
      const s = get();
      const ids = selectedNodeIds(s).filter((id) => {
        const n = s.nodes.find((x) => x.id === id);
        return n && n.type !== 'frame';
      });
      if (!ids.length) return null;
      const g = groupIntoFrame(s.nodes, ids, label);
      if (!g) return null;
      commit(() => ({ nodes: selectOnly(g.nodes, new Set([g.frame.id])) }));
      set({ editingId: g.frame.id, selectionOrder: [g.frame.id] });
      return g.frame.id;
    },

    align: (mode) => {
      const s = get();
      const byId = indexNodes(s.nodes);
      const sel = s.nodes.filter((n) => n.selected);
      if (sel.length < 2) return;
      const target = alignRects(new Map(sel.map((n) => [n.id, absRect(n, byId)])), mode);
      commit((cur) => ({ nodes: moveTo(cur.nodes, target) }));
    },
    distribute: (axis) => {
      const s = get();
      const byId = indexNodes(s.nodes);
      const sel = s.nodes.filter((n) => n.selected);
      if (sel.length < 3) return;
      const target = distributeRects(new Map(sel.map((n) => [n.id, absRect(n, byId)])), axis);
      commit((cur) => ({ nodes: moveTo(cur.nodes, target) }));
    },
    nudge: (dx, dy) => {
      const s = get();
      const ids = new Set(selectedNodeIds(s));
      // Moving a frame moves its contents; do not double-move children of selected frames.
      const movable = s.nodes.filter((n) => ids.has(n.id) && !(n.data as { locked?: boolean }).locked && !(n.parentId && ids.has(n.parentId)));
      if (!movable.length) return;
      const m = new Set(movable.map((n) => n.id));
      commit((cur) => ({ nodes: cur.nodes.map((n) => (m.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) }), { coalesce: 'nudge' });
    },
    layout: (ids) => {
      const s = get();
      const target = autoLayout(s.nodes, s.edges, ids);
      if (!target.size) return;
      commit((cur) => ({ nodes: moveTo(cur.nodes, target) }));
      get().requestFit([...target.keys()]);
    },

    connect: (source, target, handles) => {
      if (source === target) return null;
      const s = get();
      const byId = indexNodes(s.nodes);
      const a = entityOf(byId.get(source));
      const b = entityOf(byId.get(target));
      let edge: SEdge;
      if (a && b) {
        const known = knownEdgeData(currentModel(), a, b);
        if (known) {
          const [src, tgt] = known.forward ? [source, target] : [target, source];
          edge = { id: newEdgeId(), source: src, target: tgt, type: 'studio', data: known.data, selected: true };
        } else {
          // Not in Meridian: drawn, but marked clearly as unverified / proposed.
          edge = { id: newEdgeId(), source, target, type: 'studio', data: { arrow: 'end', strokeStyle: 'dashed' }, selected: true };
        }
      } else {
        edge = { id: newEdgeId(), source, target, type: 'studio', sourceHandle: handles?.sourceHandle ?? undefined, targetHandle: handles?.targetHandle ?? undefined, data: { arrow: 'end' }, selected: true };
      }
      commit((cur) => ({ nodes: selectOnly(cur.nodes, new Set()), edges: [...deselectEdges(cur.edges), edge] }));
      return edge;
    },

    endDrag: (ids) => {
      // Dropping a node onto a frame puts it inside; dragging it out takes it out. Part of the drag's undo step.
      const s = get();
      let nodes = s.nodes;
      const byId = indexNodes(nodes);
      let changed = false;
      for (const id of ids) {
        const n = byId.get(id);
        if (!n || n.type === 'frame') continue;
        if (n.parentId && ids.includes(n.parentId)) continue;
        const r = absRect(n, byId);
        const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const frame = frameAt(nodes, centre, new Set([id]));
        if ((frame?.id ?? undefined) !== n.parentId) {
          nodes = reparent(nodes, id, frame?.id);
          changed = true;
        }
      }
      if (changed) set({ nodes, revision: s.revision + 1 });
    },

    setEditing: (editingId) => set({ editingId }),
    setEditingEdge: (editingEdgeId) => set({ editingEdgeId }),
    setConnectMode: (connectMode) => set({ connectMode, connectFrom: null }),
    setConnectFrom: (connectFrom) => set({ connectFrom }),
    setFocus: (focus) => set({ focus }),
    setAnim: (anim) => set({ anim }),
    stepAnim: (delta) =>
      set((s) => {
        if (!s.anim) return s;
        const max = s.anim.nodes.length - 1;
        const index = Math.max(0, Math.min(max, s.anim.index + delta));
        return { anim: { ...s.anim, index, playing: index >= max ? false : s.anim.playing } };
      }),
  };
});

/** Move nodes to absolute positions, converting to parent-relative coordinates. */
function moveTo(nodes: SNode[], target: ReadonlyMap<string, Point>): SNode[] {
  const byId = indexNodes(nodes);
  return nodes.map((n) => {
    const p = target.get(n.id);
    if (!p) return n;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const base = parent ? absPos(parent, byId) : { x: 0, y: 0 };
    return { ...n, position: { x: Math.round(p.x - base.x), y: Math.round(p.y - base.y) } };
  });
}

/** A new, empty board record. */
export function newBoard(name: string): StudioBoard {
  const now = new Date().toISOString();
  return { id: newId('board'), name, nodes: [], edges: [], createdAt: now, updatedAt: now };
}

/** Rendered size helper re-exported for components. */
export { nodeSize };
