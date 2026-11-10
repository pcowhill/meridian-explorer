/**
 * Studio commands used by the toolbar, palette, menus and shortcuts. They read
 * the live store and the React Flow instance (registered by the canvas) and
 * apply every change through the store, so everything is undoable.
 */
import type { ReactFlowInstance } from '@xyflow/react';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { useApp } from '@/state/app';
import { downloadText, makeExport, parseImport, pickTextFile } from '@/state/io';
import { newId, useWorkspace, type StudioBoard } from '@/state/workspace';
import {
  addChildren,
  addNeighbours,
  beforeAfter,
  connections,
  dependencyDiagram,
  endpointFor,
  entityInstances,
  fromStudioEdge,
  fromStudioNode,
  instantiate,
  makeNode,
  orderChain,
  placeEntities,
  sequenceFromChain,
  spotFor,
  systemOverviewIds,
  templateFrom,
  toStudioEdge,
  toStudioNode,
  type Patch,
} from './logic/build';
import { absRect, boundsOf, findFreeSpot, indexNodes, nodeSize, type Point } from './logic/geometry';
import { entityOf, newEdgeId } from './logic/modelEdges';
import { traceSpec, type WidgetSpec } from './logic/widgets';
import { currentModel } from './model';
import { usePrefs } from './prefs';
import { newBoard, selectedEdgeIds, selectedNodeIds, useStudio, type Snapshot } from './store';
import { DEFAULT_SIZE, type SEdge, type SNode, type StudioNodeType } from './types';

let flow: ReactFlowInstance<SNode, SEdge> | null = null;
let canvasEl: HTMLElement | null = null;

export function registerFlow(f: ReactFlowInstance<SNode, SEdge> | null, el: HTMLElement | null): void {
  flow = f;
  canvasEl = el;
}

const toast = (m: string, tone: 'info' | 'ok' | 'warn' = 'info') => useApp.getState().toast(m, tone);
const st = () => useStudio.getState();

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function viewCenter(): Point {
  if (!flow || !canvasEl) return { x: 0, y: 0 };
  const r = canvasEl.getBoundingClientRect();
  return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

function visibleRects() {
  const s = st();
  const byId = indexNodes(s.nodes);
  return s.nodes.filter((n) => !n.hidden).map((n) => absRect(n, byId));
}

/** Fit padding that keeps content clear of the floating panels and bars. */
export function fitPadding(): { top: `${number}px`; right: `${number}px`; bottom: `${number}px`; left: `${number}px` } {
  const panel = canvasEl?.parentElement?.querySelector('[data-testid=selection-panel]')?.getBoundingClientRect();
  const legend = canvasEl?.parentElement?.querySelector('[data-testid=hypo-legend]');
  const h = canvasEl?.getBoundingClientRect().height ?? 800;
  let top = legend ? 64 : 40;
  let right = 24;
  // A short panel only takes the top strip; a tall one takes the right column.
  if (panel && panel.height < h * 0.3) top = Math.max(top, Math.round(panel.height + 28));
  else if (panel) right = Math.round(panel.width + 36);
  return { top: `${top}px`, right: `${right}px`, bottom: '72px', left: '24px' };
}

/** How many layered columns fit the visible canvas at a readable zoom (0.6). */
export function layoutColumns(): number {
  const w = canvasEl?.getBoundingClientRect().width ?? 1000;
  const unit = DEFAULT_SIZE.entity.w + 120;
  return Math.max(2, Math.min(6, Math.floor(((w - 48) / 0.6 + 120) / unit)));
}

let lastFit: { ids: string[]; at: number } | null = null;

/**
 * Fit content into the part of the canvas that is actually free (clear of the
 * floating panels): max zoom 1; for up to ~14 nodes never below 0.6 (the
 * content then starts at the top-left of the free area instead of shrinking).
 */
export function fitContent(ids: string[], duration = 300): void {
  if (!flow || !canvasEl) return;
  const s = st();
  const visible = s.nodes.filter((n) => !n.hidden);
  const set = new Set(ids);
  const target = ids.length ? visible.filter((n) => set.has(n.id)) : visible;
  if (!target.length) return;
  const b = flow.getNodesBounds(target.map((n) => n.id));
  const p = fitPadding();
  const px = (v: string) => parseFloat(v);
  const rect = canvasEl.getBoundingClientRect();
  const left = px(p.left);
  const top = px(p.top);
  const availW = Math.max(120, rect.width - left - px(p.right));
  const availH = Math.max(120, rect.height - top - px(p.bottom));
  let zoom = Math.min(availW / Math.max(1, b.width), availH / Math.max(1, b.height), 1);
  zoom = Math.max(zoom, target.length <= 14 ? 0.6 : 0.08);
  const w = b.width * zoom;
  const h = b.height * zoom;
  const x = (w <= availW ? left + (availW - w) / 2 : left) - b.x * zoom;
  const y = (h <= availH ? top + (availH - h) / 2 : top) - b.y * zoom;
  void flow.setViewport({ x, y, zoom }, { duration });
  lastFit = { ids, at: Date.now() };
}

/** The canvas resized right after a fit (e.g. the inspector opened): fit once more. */
export function refitAfterResize(): void {
  if (lastFit && Date.now() - lastFit.at < 600) {
    const ids = lastFit.ids;
    lastFit = null;
    fitContent(ids, 160);
  }
}

export function fitTo(ids: string[], duration = 280): void {
  if (!flow) return;
  window.setTimeout(() => fitContent(ids, duration), 40);
}

/** Bring a rectangle into view: fit a small board entirely, otherwise pan to it. */
function ensureVisible(r: { x: number; y: number; w: number; h: number }): void {
  if (isOnScreen(r, 24)) return;
  const nodes = st().nodes.filter((n) => !n.hidden);
  window.setTimeout(() => {
    if (nodes.length <= 14) fitContent([], 280);
    else void flow?.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom: flow.getZoom(), duration: 280 });
  }, 30);
}

export function fitAll(): void {
  fitTo([]);
}

export function centerOn(id: string): void {
  const s = st();
  const n = s.nodes.find((x) => x.id === id);
  if (!n || !flow) return;
  const r = absRect(n, indexNodes(s.nodes));
  void flow.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 260 });
}

// ---------------------------------------------------------------------------
// Adding things
// ---------------------------------------------------------------------------

/** Add an entity at a point (or the next free spot near the view centre). Already on the board → select and centre it. */
export function addEntity(entityId: string, at?: Point | null): string | null {
  const model = currentModel();
  if (!model.has(entityId)) return null;
  const existing = entityInstances(st().nodes).get(entityId)?.[0];
  if (existing && !at) {
    st().setSelection([existing.id]);
    centerOn(existing.id);
    useApp.getState().selectEntity(entityId);
    return existing.id;
  }
  const s = DEFAULT_SIZE.entity;
  const p = at ? { x: at.x - s.w / 2, y: at.y - s.h / 2 } : spotFor(model, st().nodes, entityId, viewCenter());
  const node = makeNode('entity', p, { entityId });
  st().addNodes([node], [], { autoConnect: usePrefs.getState().autoConnect });
  // Adding should not pop the inspector open (it would shrink the canvas mid-construction); follow along only if it is already showing something.
  if (useApp.getState().selection) useApp.getState().selectEntity(entityId);
  if (!at) ensureVisible({ x: p.x, y: p.y, w: s.w, h: s.h });
  return node.id;
}

/** Add a free element at the view centre (Text/Note/Shape/Callout/Frame) and start editing its label. */
export function addFree(type: StudioNodeType, data: Record<string, unknown> = {}, opts: { edit?: boolean; at?: Point } = {}): string {
  if (type === 'frame' && selectedNodeIds(st()).length) {
    const id = st().groupSelection('Frame');
    if (id) return id;
  }
  const size = DEFAULT_SIZE[type];
  const p = opts.at ? { x: opts.at.x - size.w / 2, y: opts.at.y - size.h / 2 } : findFreeSpot(visibleRects(), size.w, size.h, viewCenter());
  const defaults: Record<string, Record<string, unknown>> = {
    text: { label: '' },
    note: { label: '' },
    shape: { shape: 'rounded', label: '' },
    callout: { label: '', pointer: 'left' },
    frame: { label: 'Frame' },
  };
  const node = makeNode(type, p, { ...(defaults[type] ?? {}), ...data });
  st().addNodes([node]);
  if (opts.edit !== false && type !== 'frame') st().setEditing(node.id);
  return node.id;
}

/** Place a widget: next to an entity node (with a dotted link) or at the view centre. */
export function addWidget(spec: WidgetSpec, attachTo?: string, at?: Point): string {
  const s = st();
  const rects = visibleRects();
  let p: Point;
  const edges: SEdge[] = [];
  const anchor = attachTo ? s.nodes.find((n) => n.id === attachTo) : undefined;
  if (at) p = { x: at.x - spec.size.w / 2, y: at.y - spec.size.h / 2 };
  else if (anchor) {
    const r = absRect(anchor, indexNodes(s.nodes));
    p = findFreeSpot(rects, spec.size.w, spec.size.h, { x: r.x + r.w + 80 + spec.size.w / 2, y: r.y + spec.size.h / 2 - 20 });
  } else p = findFreeSpot(rects, spec.size.w, spec.size.h, viewCenter());
  const node = makeNode(spec.type, p, spec.data, spec.size);
  if (anchor) edges.push({ id: newEdgeId(), source: anchor.id, target: node.id, type: 'studio', data: { arrow: 'none', strokeStyle: 'dotted', color: 'gray' } });
  s.addNodes([node], edges);
  if (!isOnScreen({ x: p.x, y: p.y, w: spec.size.w, h: spec.size.h }, 16)) {
    if (anchor) fitTo([anchor.id, node.id]);
    else ensureVisible({ x: p.x, y: p.y, w: spec.size.w, h: spec.size.h });
  }
  return node.id;
}

export function applyPatch(patch: Patch | null, opts?: { replaceNodes?: SNode[] }): void {
  if (!patch) return;
  st().applyPatch(patch, opts);
  if (patch.message) toast(patch.message, patch.nodes.length || patch.edges.length ? 'ok' : 'info');
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export type GenerateKind = 'dependency' | 'connections' | 'children' | 'neighbours' | 'sequence' | 'animate' | 'before-after' | 'question' | 'overview';

/** Entity nodes in the selection (selection order). */
export function selectedEntityNodes(): SNode[] {
  const s = st();
  const byId = indexNodes(s.nodes);
  const order = s.selectionOrder.filter((id) => byId.get(id)?.selected);
  const rest = selectedNodeIds(s).filter((id) => !order.includes(id));
  return [...order, ...rest].map((id) => byId.get(id)!).filter((n) => entityOf(n));
}

/** Why a generator cannot run on the current selection (null = it can). */
export function generateBlocker(kind: GenerateKind): string | null {
  const s = st();
  const ents = selectedEntityNodes();
  const nodes = selectedNodeIds(s);
  switch (kind) {
    case 'dependency':
    case 'children':
    case 'neighbours':
      return ents.length === 1 ? null : 'Select one Meridian component';
    case 'connections':
      return ents.length === 2 ? null : 'Select two Meridian components';
    case 'sequence':
      return endpointFor(currentModel(), s.nodes, s.edges, nodes, selectedEdgeIds(s)) || nodes.length >= 2 ? null : 'Select a chain of nodes, an endpoint, or a relationship to an endpoint';
    case 'animate':
      return chainFromSelection() ? null : 'Select two or more connected nodes (or an edge chain)';
    case 'before-after':
      return nodes.length ? null : 'Select what to compare';
    default:
      return null;
  }
}

export function generate(kind: GenerateKind, arg?: string | number): void {
  const model = currentModel();
  const s = st();
  const blocker = generateBlocker(kind);
  if (blocker) {
    toast(blocker, 'warn');
    return;
  }
  const ents = selectedEntityNodes();
  switch (kind) {
    case 'dependency': {
      const id = entityOf(ents[0])!;
      applyPatch(dependencyDiagram(model, s.nodes, id, arg === 2 ? 2 : 1));
      return;
    }
    case 'connections': {
      const p = connections(model, s.nodes, s.edges, ents[0].id, ents[1].id);
      if (!p) toast('Meridian has no chain of relationships between these two', 'warn');
      else applyPatch(p);
      return;
    }
    case 'children':
      applyPatch(addChildren(model, s.nodes, s.edges, ents[0].id));
      return;
    case 'neighbours':
      applyPatch(addNeighbours(model, s.nodes, s.edges, ents[0].id));
      return;
    case 'sequence': {
      const endpoint = endpointFor(model, s.nodes, s.edges, selectedNodeIds(s), selectedEdgeIds(s));
      const below = selectionBottomLeft();
      if (endpoint) {
        const spec = traceSpec(endpoint);
        const id = addWidget(spec, undefined, below ? { x: below.x + spec.size.w / 2, y: below.y + 60 + spec.size.h / 2 } : undefined);
        fitTo([id]);
        toast('Sequence assembled from the endpoint’s contract', 'ok');
        return;
      }
      const chain = orderChain(chainIdsFromSelection(), s.edges);
      const data = sequenceFromChain(s.nodes, s.edges, chain.nodes);
      const size = { w: Math.max(420, Math.min(1100, 140 * (data.custom!.participants.length + 0.5))), h: Math.max(220, 140 + data.custom!.steps.length * 38) };
      const id = addWidget({ type: 'sequence', data, size }, undefined, below ? { x: below.x + size.w / 2, y: below.y + 60 + size.h / 2 } : undefined);
      fitTo([id, ...chain.nodes]);
      toast('Sequence built from the selected chain', 'ok');
      return;
    }
    case 'animate':
      startAnimation();
      return;
    case 'before-after': {
      const p = beforeAfter(s.nodes, s.edges, selectedNodeIds(s));
      if (!p) toast('Select nodes (not only frames) to compare', 'warn');
      else applyPatch(p, { replaceNodes: p.replace });
      return;
    }
    case 'question': {
      const q = GUIDED_QUESTIONS.find((x) => x.id === arg) ?? GUIDED_QUESTIONS[0];
      applyPatch(placeEntities(model, s.nodes, s.edges, q.studio.entities, { title: q.studio.title, note: q.question, autoConnect: true, maxColumns: layoutColumns() }));
      return;
    }
    case 'overview':
      applyPatch(placeEntities(model, s.nodes, s.edges, systemOverviewIds(model), { title: 'Meridian — system overview', autoConnect: true, maxColumns: layoutColumns() }));
      return;
  }
}

function selectionBottomLeft(): Point | null {
  const s = st();
  const byId = indexNodes(s.nodes);
  const b = boundsOf(s.nodes.filter((n) => n.selected).map((n) => absRect(n, byId)));
  return b ? { x: b.x, y: b.y + b.h } : null;
}

function chainIdsFromSelection(): string[] {
  const s = st();
  const sel = new Set(selectedNodeIds(s));
  let ids = [...s.selectionOrder.filter((id) => sel.has(id)), ...[...sel].filter((id) => !s.selectionOrder.includes(id))];
  // Edges selected without their nodes: use their ends.
  if (ids.length < 2) {
    const fromEdges = s.edges.filter((e) => e.selected).flatMap((e) => [e.source, e.target]);
    ids = [...new Set([...ids, ...fromEdges])];
  }
  // Frames are containers, not chain members.
  return ids.filter((id) => s.nodes.find((n) => n.id === id)?.type !== 'frame');
}

export function chainFromSelection(): { nodes: string[]; edges: (string | null)[] } | null {
  const ids = chainIdsFromSelection();
  if (ids.length < 2) return null;
  return orderChain(ids, st().edges);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function startAnimation(): void {
  const chain = chainFromSelection();
  if (!chain) {
    toast('Select two or more connected nodes to animate', 'warn');
    return;
  }
  st().setFocus(null);
  st().setSelection([]);
  st().setAnim({ nodes: chain.nodes, edges: chain.edges, index: 0, playing: true });
}

function focusFromSelection(mode: 'spotlight' | 'path'): boolean {
  const s = st();
  const ids = new Set(selectedNodeIds(s));
  for (const n of s.nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
  // Frames containing selected nodes stay visible too.
  for (const n of s.nodes) if (ids.has(n.id) && n.parentId) ids.add(n.parentId);
  const eids = new Set(selectedEdgeIds(s));
  for (const e of s.edges) {
    if (eids.has(e.id)) {
      ids.add(e.source);
      ids.add(e.target);
    }
  }
  if (!ids.size) return false;
  const edgeIds = s.edges.filter((e) => eids.has(e.id) || (ids.has(e.source) && ids.has(e.target))).map((e) => e.id);
  s.setFocus({ nodeIds: [...ids], edgeIds, mode });
  return true;
}

export function toggleSpotlight(): void {
  if (st().focus) {
    st().setFocus(null);
    return;
  }
  if (!focusFromSelection('spotlight')) toast('Select what to spotlight first', 'warn');
}

export function highlightPath(): void {
  if (st().focus?.mode === 'path') {
    st().setFocus(null);
    return;
  }
  if (!focusFromSelection('path')) toast('Select the nodes of the path first', 'warn');
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

let clipboard: Snapshot | null = null;
const CLIP_MARK = 'meridianStudioClip';

/** Copy the selection (internal clipboard + system clipboard as JSON). Returns the JSON or null. */
export function copySelection(): string | null {
  const s = st();
  const ids = new Set(selectedNodeIds(s));
  for (const n of s.nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
  if (!ids.size) return null;
  const byId = indexNodes(s.nodes);
  const nodes = s.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const keep = n.parentId && ids.has(n.parentId);
      return { ...n, parentId: keep ? n.parentId : undefined, position: keep ? n.position : (() => { const r = absRect(n, byId); return { x: r.x, y: r.y }; })(), selected: false, width: nodeSize(n).w, height: nodeSize(n).h };
    });
  const edges = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  clipboard = { nodes, edges };
  return JSON.stringify({ [CLIP_MARK]: 1, nodes: nodes.map(toStudioNode), edges: edges.map(toStudioEdge) });
}

/** Paste from system clipboard text (if it is a Studio clip) or the internal clipboard. */
export function paste(text?: string | null): boolean {
  let clip = clipboard;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed[CLIP_MARK] && Array.isArray(parsed.nodes)) clip = { nodes: parsed.nodes.map(fromStudioNode), edges: (parsed.edges ?? []).map(fromStudioEdge) };
    } catch {
      /* not a Studio clip */
    }
  }
  if (!clip?.nodes.length) return false;
  const byId = indexNodes(clip.nodes);
  const b = boundsOf(clip.nodes.filter((n) => !n.parentId).map((n) => absRect(n, byId)));
  const c = viewCenter();
  // Paste into view if the source is off-screen, else offset from the original.
  const onScreen = b && flow ? isOnScreen(b) : false;
  st().pasteElements(clip, onScreen || !b ? undefined : { x: c.x - b.w / 2, y: c.y - b.h / 2 });
  return true;
}

/** Fully inside the visible canvas (inset by `inset` screen px)? With inset < 0 any overlap counts. */
function isOnScreen(b: { x: number; y: number; w: number; h: number }, inset = -1): boolean {
  if (!flow || !canvasEl) return false;
  const vp = flow.getViewport();
  const el = canvasEl.getBoundingClientRect();
  const left = -vp.x / vp.zoom;
  const top = -vp.y / vp.zoom;
  const right = left + el.width / vp.zoom;
  const bottom = top + el.height / vp.zoom;
  if (inset < 0) return b.x < right && b.x + b.w > left && b.y < bottom && b.y + b.h > top;
  const m = inset / vp.zoom;
  return b.x >= left + m && b.y >= top + m && b.x + b.w <= right - m && b.y + b.h <= bottom - m;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** Write the live board to the workspace now. */
export function saveNow(): void {
  const s = st();
  if (!s.boardId) return;
  const ws = useWorkspace.getState();
  const board = ws.boards.find((b) => b.id === s.boardId);
  if (!board) return;
  ws.saveBoard(s.toBoard(board));
}

export function switchBoard(id: string): void {
  saveNow();
  const ws = useWorkspace.getState();
  const b = ws.boards.find((x) => x.id === id);
  if (!b) return;
  ws.setActiveBoard(id);
  st().load(b);
}

export function createBoard(name?: string): string {
  saveNow();
  const ws = useWorkspace.getState();
  const b = newBoard(name ?? nextBoardName(ws.boards));
  ws.saveBoard(b);
  ws.setActiveBoard(b.id);
  st().load(b);
  return b.id;
}

export function nextBoardName(boards: StudioBoard[]): string {
  for (let i = boards.length + 1; ; i++) {
    const name = `Board ${i}`;
    if (!boards.some((b) => b.name === name)) return name;
  }
}

export function renameBoard(id: string, name: string): void {
  const ws = useWorkspace.getState();
  const b = ws.boards.find((x) => x.id === id);
  if (!b || !name.trim()) return;
  if (id === st().boardId) ws.saveBoard({ ...st().toBoard(b), name: name.trim() });
  else ws.saveBoard({ ...b, name: name.trim() });
}

export function duplicateBoard(id: string): void {
  saveNow();
  const ws = useWorkspace.getState();
  const b = ws.boards.find((x) => x.id === id);
  if (!b) return;
  const now = new Date().toISOString();
  const copy: StudioBoard = { ...structuredClone(b), id: newId('board'), name: `${b.name} (copy)`, createdAt: now, updatedAt: now };
  ws.saveBoard(copy);
  ws.setActiveBoard(copy.id);
  st().load(copy);
  toast(`Duplicated “${b.name}”`, 'ok');
}

export function deleteBoard(id: string): void {
  const ws = useWorkspace.getState();
  const b = ws.boards.find((x) => x.id === id);
  if (!b) return;
  ws.deleteBoard(id);
  const rest = useWorkspace.getState().boards;
  if (id === st().boardId) {
    if (rest.length) switchBoard(rest[0].id);
    else createBoard();
  }
  toast(`Deleted “${b.name}” — export a board first if you may need it again`, 'info');
}

export function exportBoard(): void {
  saveNow();
  const ws = useWorkspace.getState();
  const b = ws.boards.find((x) => x.id === st().boardId);
  if (!b) return;
  downloadText(`${slug(b.name)}.studio-board.json`, makeExport('board', b));
  toast(`Exported “${b.name}”`, 'ok');
}

export async function importBoard(): Promise<void> {
  const text = await pickTextFile();
  if (!text) return;
  const r = parseImport(text);
  if (!r.ok) {
    toast(r.errors[0] ?? 'Import failed', 'warn');
    return;
  }
  if (r.kind !== 'board') {
    toast(`This file is a ${r.kind} export — import it from the Workspace panel`, 'warn');
    return;
  }
  saveNow();
  const ws = useWorkspace.getState();
  const now = new Date().toISOString();
  const clash = ws.boards.some((b) => b.id === r.data.id);
  const board: StudioBoard = { ...r.data, id: clash ? newId('board') : r.data.id, name: clash ? `${r.data.name} (imported)` : r.data.name, updatedAt: now };
  ws.saveBoard(board);
  ws.setActiveBoard(board.id);
  st().load(board);
  window.setTimeout(fitAll, 60);
  toast(`Imported “${board.name}”${r.warnings.length ? ` — ${r.warnings[0]}` : ''}`, 'ok');
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

/** Export what is currently in view as a PNG (download + clipboard where allowed). */
export async function exportPng(): Promise<void> {
  const el = canvasEl?.querySelector<HTMLElement>('.react-flow');
  if (!el) return;
  const { toBlob } = await import('html-to-image');
  const bg = getComputedStyle(el).getPropertyValue('--canvas').trim() || getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  const skip = ['react-flow__minimap', 'react-flow__controls', 'react-flow__panel', 'studio-overlay', 'react-flow__resize-control', 'react-flow__handle'];
  try {
    const blob = await toBlob(el, {
      backgroundColor: bg || '#ffffff',
      pixelRatio: 2,
      filter: (node) => !(node instanceof HTMLElement && skip.some((c) => node.classList.contains(c))),
    });
    if (!blob) throw new Error('empty');
    const board = useWorkspace.getState().boards.find((b) => b.id === st().boardId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(board?.name ?? 'board')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    let copied = false;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copied = true;
      }
    } catch {
      copied = false;
    }
    toast(copied ? 'PNG downloaded and copied to the clipboard — paste it into chat' : 'PNG downloaded', 'ok');
  } catch {
    toast('Could not render the PNG', 'warn');
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function saveTemplate(name: string, scope: 'selection' | 'board'): void {
  const s = st();
  const ids = scope === 'selection' ? selectedNodeIds(s) : [];
  const t = templateFrom(s.nodes, s.edges, ids);
  if (!t.nodes.length) {
    toast('Nothing to save', 'warn');
    return;
  }
  useWorkspace.getState().saveTemplate({ id: newId('tpl'), name: name.trim() || 'Template', nodes: t.nodes, edges: t.edges, createdAt: new Date().toISOString() });
  toast(`Saved template “${name.trim() || 'Template'}”`, 'ok');
}

export function insertTemplate(tpl: { nodes: import('@/state/workspace').StudioNode[]; edges: import('@/state/workspace').StudioEdge[] }): void {
  const rects = visibleRects();
  const nodes = tpl.nodes.map(fromStudioNode);
  const byId = indexNodes(nodes);
  const b = boundsOf(nodes.filter((n) => !n.parentId).map((n) => absRect(n, byId))) ?? { x: 0, y: 0, w: 200, h: 100 };
  const p = findFreeSpot(rects, b.w, b.h, viewCenter(), 40);
  const out = instantiate(tpl, p);
  st().applyPatch({ nodes: out.nodes, edges: out.edges, select: out.nodes.map((n) => n.id), focus: out.nodes.map((n) => n.id) });
}
