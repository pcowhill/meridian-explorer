/**
 * Pure board builders: node factories, the rapid-construction generators
 * (dependency diagram, connections, children/neighbours, question boards,
 * system overview, inbox imports, before/after, sequence from a chain) and
 * structural edits (clone, group into frame, remove, re-parent, auto-layout).
 *
 * Every function takes the current nodes/edges and returns a patch; the store
 * applies it as one undoable step.
 */
import { channelOf, type Model, type Relation, type RelationKind, type ScenarioStep } from '@/model';
import type { StudioImport } from '@/state/app';
import type { StudioEdge, StudioNode } from '@/state/workspace';
import { DEFAULT_SIZE, type EdgeData, type EntityData, type SEdge, type SNode, type SequenceData, type StudioNodeType } from '../types';
import { absPos, absRect, boundsOf, clearOrigin, contains, findFreeSpot, indexNodes, nodeSize, snap, sortParentsFirst, type Point, type Rect } from './geometry';
import { layered, grid, row, type LayoutEdge } from './layout';
import { autoConnect, describeRelations, edgeDataFromLifted, edgesPerChannel, entityOf, indirectLink, knownEdgeData, liftedForBoard, newEdgeId, relationsForPair } from './modelEdges';

export interface Patch {
  nodes: SNode[];
  edges: SEdge[];
  /** Node ids to select afterwards. */
  select: string[];
  /** Node ids to fit the view to afterwards. */
  focus: string[];
  /** Human-readable outcome for a toast. */
  message?: string;
}

let nodeSeq = 0;
export const newNodeId = (): string => `n_${Date.now().toString(36)}${(nodeSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** React Flow flags derived from a node's type and data (never persisted). */
export function decorate(n: SNode): SNode {
  const locked = !!(n.data as { locked?: boolean }).locked;
  const frame = n.type === 'frame';
  const draggable = !locked;
  const className = frame ? 'studio-frame' : undefined;
  const dragHandle = frame ? '.frame-handle' : undefined;
  if (n.draggable === draggable && n.deletable === !locked && n.className === className && n.dragHandle === dragHandle) return n;
  return { ...n, draggable, deletable: !locked, className, dragHandle };
}

export function makeNode(type: StudioNodeType, position: Point, data: SNode['data'], size?: { w: number; h: number }): SNode {
  const s = size ?? DEFAULT_SIZE[type];
  return decorate({ id: newNodeId(), type, position: { x: Math.round(position.x), y: Math.round(position.y) }, width: s.w, height: s.h, zIndex: type === 'frame' ? 0 : 1, data });
}

export function entityNode(entityId: string, position: Point): SNode {
  return makeNode('entity', position, { entityId } satisfies EntityData);
}

export function textNode(text: string, position: Point, size: 'md' | 'lg' | 'xl' = 'lg', width = 520): SNode {
  const h = size === 'xl' ? 56 : size === 'lg' ? 44 : 36;
  return makeNode('text', position, { label: text, style: { textSize: size } }, { w: width, h });
}

const emptyPatch = (): Patch => ({ nodes: [], edges: [], select: [], focus: [] });

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function toStudioNode(n: SNode): StudioNode {
  const s = nodeSize(n);
  const out: StudioNode = { id: n.id, type: n.type ?? 'shape', position: { x: n.position.x, y: n.position.y }, width: s.w, height: s.h, data: n.data as Record<string, unknown> };
  if (n.parentId) out.parentId = n.parentId;
  if (n.zIndex !== undefined) out.zIndex = n.zIndex;
  if (n.hidden) out.hidden = true;
  return out;
}

export function fromStudioNode(n: StudioNode): SNode {
  return decorate({
    id: n.id,
    type: n.type as StudioNodeType,
    position: { ...n.position },
    width: n.width,
    height: n.height,
    parentId: n.parentId,
    zIndex: n.zIndex,
    hidden: n.hidden,
    data: n.data as SNode['data'],
  });
}

export function toStudioEdge(e: SEdge): StudioEdge {
  return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null, type: 'studio', data: e.data as Record<string, unknown> };
}

export function fromStudioEdge(e: StudioEdge): SEdge {
  return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined, type: 'studio', data: (e.data ?? {}) as EdgeData, hidden: (e as { hidden?: boolean }).hidden };
}

/** Load-time repair: parents first, drop edges whose ends are missing, drop dangling parents. */
export function normalise(nodes: SNode[], edges: SEdge[]): { nodes: SNode[]; edges: SEdge[] } {
  const ids = new Set(nodes.map((n) => n.id));
  const fixed = nodes.map((n) => (n.parentId && !ids.has(n.parentId) ? { ...n, parentId: undefined } : n));
  return { nodes: sortParentsFirst(fixed), edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

// ---------------------------------------------------------------------------
// Placing entities
// ---------------------------------------------------------------------------

const allRects = (nodes: readonly SNode[]): Rect[] => {
  const byId = indexNodes(nodes);
  return nodes.filter((n) => !n.hidden).map((n) => absRect(n, byId));
};

export function entityInstances(nodes: readonly SNode[]): Map<string, SNode[]> {
  const m = new Map<string, SNode[]>();
  for (const n of nodes) {
    const e = entityOf(n);
    if (e) m.set(e, [...(m.get(e) ?? []), n]);
  }
  return m;
}

export interface PlaceOptions {
  title?: string;
  note?: string;
  layout?: 'auto' | 'sequence' | 'grid';
  /** Explicit edges (entity ids); when omitted known relations are connected automatically. */
  edges?: StudioImport['edges'];
  autoConnect?: boolean;
  /** Wrap layered layouts after this many columns (fit to the visible canvas). */
  maxColumns?: number;
  /** Top-left of the new content (default: clear of everything on the board). */
  origin?: Point;
}

/**
 * Put entities on the board: one node per entity not already there, laid out
 * clear of existing content, connected by explicit or known edges, with an
 * optional title and note.
 */
export function placeEntities(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], entityIds: readonly string[], opts: PlaceOptions = {}): Patch {
  const patch = emptyPatch();
  const ids = [...new Set(entityIds.filter((id) => model.has(id)))];
  if (!ids.length) return patch;
  const existing = entityInstances(nodes);
  const fresh = ids.filter((id) => !existing.has(id));
  const layoutMode = opts.layout ?? 'auto';

  const size = DEFAULT_SIZE.entity;
  const items = fresh.map((id) => ({ id, w: size.w, h: size.h }));
  let layoutEdges: LayoutEdge[] = [];
  if (opts.edges?.length) layoutEdges = opts.edges.map((e) => ({ source: e.from, target: e.to }));
  else if (layoutMode === 'auto') layoutEdges = liftedForBoard(model, new Set(fresh)).map((l) => edgeDataFromLifted(l)).map((x) => ({ source: x.source, target: x.target }));
  const rel = layoutMode === 'sequence' ? row(items, 170) : layoutMode === 'grid' ? grid(items) : layered(items, layoutEdges, { gapX: 120, gapY: 32, maxColumns: opts.maxColumns ?? 4 });

  const origin = opts.origin ?? clearOrigin(allRects(nodes));
  const titleH = opts.title ? 76 : 0;
  const created = new Map<string, SNode>();
  for (const id of fresh) {
    const p = rel.get(id)!;
    const n = entityNode(id, { x: origin.x + p.x, y: origin.y + titleH + p.y });
    created.set(id, n);
    patch.nodes.push(n);
  }
  const contentBounds = boundsOf(patch.nodes.map((n) => ({ x: n.position.x, y: n.position.y, w: nodeSize(n).w, h: nodeSize(n).h })));
  if (opts.title && fresh.length) {
    const t = textNode(opts.title, { x: origin.x, y: origin.y }, 'xl', Math.max(360, Math.min(900, contentBounds?.w ?? 400)));
    patch.nodes.unshift(t);
  }
  if (opts.note && fresh.length) {
    const y = (contentBounds ? contentBounds.y + contentBounds.h : origin.y + titleH) + 36;
    patch.nodes.push(makeNode('note', { x: origin.x, y }, { label: opts.note }, { w: 300, h: 110 }));
  }

  const nodeFor = (entityId: string): SNode | undefined => created.get(entityId) ?? existing.get(entityId)?.[0];
  const all = [...nodes, ...patch.nodes];
  if (opts.edges?.length) {
    opts.edges.forEach((e, i) => {
      const s = nodeFor(e.from);
      const t = nodeFor(e.to);
      if (!s || !t || s.id === t.id) return;
      const kind = e.kind as RelationKind | undefined;
      let channel;
      try {
        channel = kind ? channelOf(kind) : undefined;
      } catch {
        channel = undefined;
      }
      const rels = relationsForPair(model, e.from, e.to).filter((r) => !kind || r.kind === kind);
      const data: EdgeData = {
        label: e.label ?? (rels.length ? describeRelations(rels) : undefined),
        channel: channel ?? (rels[0] ? channelOf(rels[0].kind) : undefined),
        relationIds: e.hypothetical ? undefined : rels.map((r) => r.id),
        proposed: e.hypothetical || undefined,
        strokeStyle: e.hypothetical ? 'dashed' : 'solid',
        arrow: 'end',
        order: e.order ?? (layoutMode === 'sequence' ? i + 1 : undefined),
      };
      patch.edges.push({ id: newEdgeId(), source: s.id, target: t.id, type: 'studio', data });
    });
  } else if (layoutMode === 'sequence') {
    for (let i = 0; i + 1 < ids.length; i++) {
      const s = nodeFor(ids[i]);
      const t = nodeFor(ids[i + 1]);
      if (!s || !t) continue;
      const rels = relationsForPair(model, ids[i], ids[i + 1]);
      patch.edges.push({ id: newEdgeId(), source: s.id, target: t.id, type: 'studio', data: { label: rels.length ? describeRelations(rels) : undefined, relationIds: rels.map((r) => r.id), channel: rels[0] ? channelOf(rels[0].kind) : undefined, order: i + 1, arrow: 'end' } });
    }
  } else if (opts.autoConnect !== false) {
    patch.edges.push(...autoConnect(model, all, edges, new Set([...created.values()].map((n) => n.id))));
  }

  patch.select = patch.nodes.map((n) => n.id);
  // Frame the new content; only when nothing is new, frame the existing instances.
  patch.focus = patch.nodes.length ? patch.nodes.map((n) => n.id) : ids.map((id) => nodeFor(id)!.id);
  patch.message = fresh.length ? `Added ${fresh.length} component${fresh.length === 1 ? '' : 's'}` : 'Already on the board';
  return patch;
}

/** A cross-mode request (`sendToStudio`). A single entity that is already on the board is just selected. */
export function planImport(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], req: StudioImport, maxColumns?: number): Patch {
  const ids = req.entities.filter((id) => model.has(id));
  const existing = entityInstances(nodes);
  if (ids.length === 1 && existing.has(ids[0])) {
    const n = existing.get(ids[0])![0];
    return { nodes: [], edges: [], select: [n.id], focus: [n.id], message: `${model.entity(ids[0])?.name} is already on the board` };
  }
  const single = ids.length === 1;
  const patch = placeEntities(model, nodes, edges, ids, {
    title: single ? undefined : req.title,
    note: req.note,
    layout: req.layout ?? 'auto',
    edges: req.edges,
    maxColumns: req.layout === 'sequence' ? undefined : maxColumns,
    origin: single ? singleSpot(model, nodes, ids[0]) : undefined,
  });
  return patch;
}

/** A single imported entity goes beside what it relates to, else next to the content. */
function singleSpot(model: Model, nodes: readonly SNode[], id: string): Point {
  const fallback = nextToContent(nodes, DEFAULT_SIZE.entity);
  return spotFor(model, nodes, id, { x: fallback.x + DEFAULT_SIZE.entity.w / 2, y: fallback.y + DEFAULT_SIZE.entity.h / 2 }, false) ?? fallback;
}

/** Next free spot near the existing content's right edge (for single additions). */
export function nextToContent(nodes: readonly SNode[], size: { w: number; h: number }): Point {
  const rects = allRects(nodes);
  const b = boundsOf(rects);
  if (!b) return { x: 0, y: 0 };
  return findFreeSpot(rects, size.w, size.h, { x: b.x + b.w + 80 + size.w / 2, y: b.y + size.h / 2 });
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const STRUCTURAL: RelationKind[] = ['tests', 'documents', 'implements'];

/**
 * Dependency diagram: the entity in the middle, what it depends on to the
 * right, what depends on it to the left (depth 1 or 2), edges from the model.
 */
export function dependencyDiagram(model: Model, nodes: readonly SNode[], entityId: string, depth: 1 | 2 = 1, perColumn = 10): Patch {
  const patch = emptyPatch();
  const e = model.entity(entityId);
  if (!e) return patch;
  const placed = new Map<string, SNode>();
  const levels: { right: string[][]; left: string[][] } = { right: [], left: [] };
  const extra: { right: number; left: number } = { right: 0, left: 0 };
  const seen = new Set([entityId]);
  const relsFor = (id: string, dir: 'out' | 'in'): Relation[] => (dir === 'out' ? model.outgoing(id) : model.incoming(id)).filter((r) => !STRUCTURAL.includes(r.kind));
  for (const side of ['right', 'left'] as const) {
    let frontier = [entityId];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const r of relsFor(id, side === 'right' ? 'out' : 'in')) {
          const other = side === 'right' ? r.to : r.from;
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
        }
      }
      if (next.length > perColumn) extra[side] += next.length - perColumn;
      const kept = next.slice(0, perColumn);
      if (!kept.length) break;
      levels[side].push(kept);
      frontier = kept;
    }
  }

  // Slightly narrower cards keep a 3–5 column diagram readable on a laptop screen.
  const size = { w: 210, h: DEFAULT_SIZE.entity.h };
  const gapX = 120;
  const gapY = 22;
  const colH = (n: number) => n * size.h + Math.max(0, n - 1) * gapY;
  const tallest = Math.max(size.h, ...levels.left.map((c) => colH(c.length)), ...levels.right.map((c) => colH(c.length)));
  const origin = clearOrigin(allRects(nodes));
  const top = origin.y + 92;
  const centreX = origin.x + levels.left.length * (size.w + gapX);
  const mid = top + tallest / 2;

  const card = (id: string, p: Point) => makeNode('entity', p, { entityId: id } satisfies EntityData, size);
  const centre = card(entityId, { x: centreX, y: mid - size.h / 2 });
  placed.set(entityId, centre);
  const putColumn = (ids: string[], x: number) => {
    let y = mid - colH(ids.length) / 2;
    for (const id of ids) {
      placed.set(id, card(id, { x, y }));
      y += size.h + gapY;
    }
  };
  levels.right.forEach((col, i) => putColumn(col, centreX + (i + 1) * (size.w + gapX)));
  levels.left.forEach((col, i) => putColumn(col, centreX - (i + 1) * (size.w + gapX)));

  patch.nodes.push(textNode(`Dependencies of ${e.name}`, { x: origin.x, y: origin.y }, 'xl', 640));
  patch.nodes.push(
    makeNode('text', { x: origin.x, y: origin.y + 48 }, { label: '← what depends on it   ·   what it depends on →', style: { textSize: 'sm' } }, { w: 520, h: 28 }),
  );
  patch.nodes.push(...placed.values());
  const notes: string[] = [];
  if (extra.left) notes.push(`${extra.left} more dependent${extra.left === 1 ? '' : 's'} not shown`);
  if (extra.right) notes.push(`${extra.right} more dependenc${extra.right === 1 ? 'y' : 'ies'} not shown`);
  if (notes.length) patch.nodes.push(makeNode('text', { x: centreX, y: top + tallest + 24 }, { label: notes.join(' · '), style: { textSize: 'sm' } }, { w: 420, h: 28 }));

  // Edges: every relation between placed entities (direct, not lifted), aggregated per pair + channel.
  const placedIds = new Set(placed.keys());
  const groups = new Map<string, Relation[]>();
  for (const id of placedIds) {
    for (const r of model.outgoing(id)) {
      if (!placedIds.has(r.to) || STRUCTURAL.includes(r.kind)) continue;
      const key = `${r.from}|${r.to}|${channelOf(r.kind)}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  }
  for (const [key, rels] of groups) {
    const [from, to] = key.split('|');
    patch.edges.push({
      id: newEdgeId(),
      source: placed.get(from)!.id,
      target: placed.get(to)!.id,
      type: 'studio',
      data: { label: describeRelations(rels), channel: channelOf(rels[0].kind), relationIds: rels.map((r) => r.id), arrow: 'end', strokeStyle: rels.every((r) => r.confidence === 'hypothetical') ? 'dashed' : 'solid' },
    });
  }
  patch.select = [centre.id];
  patch.focus = patch.nodes.map((n) => n.id);
  patch.message = `Dependency diagram: ${levels.left.flat().length} dependents, ${levels.right.flat().length} dependencies`;
  return patch;
}

/** Entity ids along the shortest relation chain between two entities (ends excluded), with the relations. */
export function chainBetween(model: Model, a: string, b: string): { via: string[]; relations: Relation[] } | null {
  const chain = model.pathBetween(a, b);
  if (!chain?.length) return null;
  const inA = (id: string) => model.isWithin(id, a);
  let prev = inA(chain[0].from) ? chain[0].from : chain[0].to;
  const seq: string[] = [];
  for (const r of chain) {
    const next = r.from === prev ? r.to : r.from;
    seq.push(next);
    prev = next;
  }
  const via = seq.slice(0, -1).filter((id) => !model.isWithin(id, a) && !model.isWithin(id, b));
  return { via, relations: chain };
}

/** All direct relations between two entity nodes, or the shortest chain through intermediates. */
export function connections(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], nodeA: string, nodeB: string): Patch | null {
  const byId = indexNodes(nodes);
  const na = byId.get(nodeA);
  const nb = byId.get(nodeB);
  const a = entityOf(na);
  const b = entityOf(nb);
  if (!na || !nb || !a || !b) return null;
  const patch = emptyPatch();
  const direct = edgesPerChannel(model, a, b);
  const has = (s: string, t: string, channel?: string) => edges.some((e) => ((e.source === s && e.target === t) || (e.source === t && e.target === s)) && (e.data?.channel ?? undefined) === channel);
  if (direct.length) {
    for (const d of direct) {
      const [s, t] = d.forward ? [na.id, nb.id] : [nb.id, na.id];
      if (has(s, t, d.data.channel)) continue;
      patch.edges.push({ id: newEdgeId(), source: s, target: t, type: 'studio', data: d.data });
    }
    patch.select = [na.id, nb.id];
    patch.focus = [na.id, nb.id];
    patch.message = patch.edges.length ? `${direct.length} kind${direct.length === 1 ? '' : 's'} of direct connection` : 'All direct connections are already drawn';
    return patch;
  }
  const chain = chainBetween(model, a, b);
  if (!chain) return null;
  const ra = absRect(na, byId);
  const rb = absRect(nb, byId);
  const existing = entityInstances(nodes);
  const seqNodes: SNode[] = [na];
  const rects = allRects(nodes);
  chain.via.forEach((id, i) => {
    const reuse = existing.get(id)?.[0];
    if (reuse) {
      seqNodes.push(reuse);
      return;
    }
    const t = (i + 1) / (chain.via.length + 1);
    const cx = ra.x + ra.w / 2 + (rb.x + rb.w / 2 - ra.x - ra.w / 2) * t;
    const cy = ra.y + ra.h / 2 + (rb.y + rb.h / 2 - ra.y - ra.h / 2) * t + 140;
    const p = findFreeSpot(rects, DEFAULT_SIZE.entity.w, DEFAULT_SIZE.entity.h, { x: cx, y: cy });
    const n = entityNode(id, p);
    rects.push({ x: p.x, y: p.y, w: DEFAULT_SIZE.entity.w, h: DEFAULT_SIZE.entity.h });
    patch.nodes.push(n);
    seqNodes.push(n);
  });
  seqNodes.push(nb);
  for (let i = 0; i + 1 < seqNodes.length; i++) {
    const ea = entityOf(seqNodes[i])!;
    const eb = entityOf(seqNodes[i + 1])!;
    const rels = relationsForPair(model, ea, eb);
    const r = rels[0];
    const forward = r ? model.isWithin(r.from, ea) : true;
    const [s, t] = forward ? [seqNodes[i].id, seqNodes[i + 1].id] : [seqNodes[i + 1].id, seqNodes[i].id];
    patch.edges.push({
      id: newEdgeId(),
      source: s,
      target: t,
      type: 'studio',
      data: { label: describeRelations(rels), channel: r ? channelOf(r.kind) : undefined, relationIds: rels.map((x) => x.id), order: i + 1, arrow: 'end' },
    });
  }
  patch.select = seqNodes.map((n) => n.id);
  patch.focus = seqNodes.map((n) => n.id);
  patch.message = `No direct relation — connected through ${chain.via.length} intermediate${chain.via.length === 1 ? '' : 's'}`;
  return patch;
}

/** Children of an entity node, placed in a grid below it. */
export function addChildren(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], nodeId: string, limit = 24): Patch | null {
  const byId = indexNodes(nodes);
  const n = byId.get(nodeId);
  const id = entityOf(n);
  if (!n || !id) return null;
  const onBoard = entityInstances(nodes);
  const kids = model.childIds(id).filter((c) => !onBoard.has(c));
  if (!kids.length) return { ...emptyPatch(), select: [nodeId], message: model.hasChildren(id) ? 'All children are already on the board' : 'This component has no children' };
  const r = absRect(n, byId);
  const shown = kids.slice(0, limit);
  const cols = Math.min(4, shown.length);
  const w = DEFAULT_SIZE.entity.w;
  const startX = r.x + r.w / 2 - (cols * w + (cols - 1) * 32) / 2;
  const desired = { x: startX, y: r.y + r.h + 90 };
  const rects = allRects(nodes);
  const totalH = Math.ceil(shown.length / cols) * (DEFAULT_SIZE.entity.h + 32);
  const block = { w: cols * w + (cols - 1) * 32, h: totalH };
  const free = rects.some((x) => x.y > r.y + r.h && x.y < desired.y + block.h && x.x < desired.x + block.w && x.x + x.w > desired.x)
    ? findFreeSpot(rects, block.w, block.h, { x: desired.x + block.w / 2, y: desired.y + block.h / 2 })
    : desired;
  const patch = placeEntities(model, nodes, edges, shown, { layout: 'grid', origin: { x: snap(free.x), y: snap(free.y) } });
  const pos = grid(shown.map((k) => ({ id: k, w, h: DEFAULT_SIZE.entity.h })), { columns: cols, gapX: 32, gapY: 32 });
  for (const node of patch.nodes) {
    const e = entityOf(node);
    const p = e ? pos.get(e) : undefined;
    if (p) node.position = { x: snap(free.x) + p.x, y: snap(free.y) + p.y };
  }
  if (kids.length > shown.length) patch.message = `Added ${shown.length} of ${kids.length} children`;
  else patch.message = `Added ${shown.length} child${shown.length === 1 ? '' : 'ren'}`;
  return patch;
}

/** Neighbours of an entity node: callers/dependents to the left, dependencies to the right. */
export function addNeighbours(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], nodeId: string, limit = 12): Patch | null {
  const byId = indexNodes(nodes);
  const n = byId.get(nodeId);
  const id = entityOf(n);
  if (!n || !id) return null;
  const onBoard = entityInstances(nodes);
  const uniq = (xs: string[]) => [...new Set(xs)].filter((x) => x !== id && !onBoard.has(x) && model.has(x));
  const left = uniq(model.incoming(id).filter((r) => !STRUCTURAL.includes(r.kind)).map((r) => r.from)).slice(0, limit);
  const right = uniq(model.outgoing(id).filter((r) => !STRUCTURAL.includes(r.kind)).map((r) => r.to)).filter((x) => !left.includes(x)).slice(0, limit);
  if (!left.length && !right.length) return { ...emptyPatch(), select: [nodeId], message: 'No further neighbours to add' };
  const r = absRect(n, byId);
  const size = DEFAULT_SIZE.entity;
  const rects = allRects(nodes);
  const created: SNode[] = [];
  const column = (ids: string[], x: number) => {
    const h = ids.length * size.h + (ids.length - 1) * 24;
    let y = r.y + r.h / 2 - h / 2;
    for (const e of ids) {
      const p = findFreeSpot(rects, size.w, size.h, { x: x + size.w / 2, y: y + size.h / 2 }, 16);
      const node = entityNode(e, p);
      rects.push({ x: p.x, y: p.y, w: size.w, h: size.h });
      created.push(node);
      y += size.h + 24;
    }
  };
  column(left, r.x - size.w - 150);
  column(right, r.x + r.w + 150);
  const all = [...nodes, ...created];
  const newEdges = autoConnect(model, all, edges, new Set(created.map((c) => c.id)));
  return {
    nodes: created,
    edges: newEdges,
    select: [nodeId, ...created.map((c) => c.id)],
    focus: [nodeId, ...created.map((c) => c.id)],
    message: `Added ${created.length} neighbour${created.length === 1 ? '' : 's'}`,
  };
}

/** Meridian's top-level applications, data store, external parties and people. */
export function systemOverviewIds(model: Model): string[] {
  return model.childIds(model.root).filter((id) => ['app', 'datastore', 'role', 'external', 'package'].includes(model.entity(id)?.kind ?? ''));
}

// ---------------------------------------------------------------------------
// Chains, sequences, animation
// ---------------------------------------------------------------------------

/** Edge connecting two nodes (either direction), if any. */
export const edgeBetween = (edges: readonly SEdge[], a: string, b: string): SEdge | undefined =>
  edges.find((e) => !e.hidden && ((e.source === a && e.target === b) || (e.source === b && e.target === a)));

/**
 * Order a set of nodes as a chain. If the edges among them form a simple path
 * it is followed (starting from the end that has an outgoing edge); otherwise
 * the given order (e.g. the order they were selected) is kept.
 */
export function orderChain(ids: readonly string[], edges: readonly SEdge[]): { nodes: string[]; edges: (string | null)[] } {
  const set = new Set(ids);
  const inner = edges.filter((e) => !e.hidden && set.has(e.source) && set.has(e.target) && e.source !== e.target);
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of inner) {
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  let order = [...ids];
  const ends = ids.filter((id) => adj.get(id)!.size === 1);
  const isPath = ids.length >= 2 && ends.length === 2 && ids.every((id) => adj.get(id)!.size <= 2);
  if (isPath) {
    const outgoing = (id: string) => inner.some((e) => e.source === id);
    const byOrder = [...ends].sort((x, y) => ids.indexOf(x) - ids.indexOf(y));
    const start = byOrder.find((id) => outgoing(id) && !inner.some((e) => e.target === id)) ?? byOrder[0];
    const walk = [start];
    const seen = new Set([start]);
    while (walk.length < ids.length) {
      const next = [...adj.get(walk[walk.length - 1])!].find((x) => !seen.has(x));
      if (!next) break;
      walk.push(next);
      seen.add(next);
    }
    if (walk.length === ids.length) order = walk;
  }
  const chainEdges = order.slice(1).map((id, i) => edgeBetween(inner, order[i], id)?.id ?? null);
  return { nodes: order, edges: chainEdges };
}

const participantOf = (n: SNode): string => entityOf(n) ?? ((n.data as { label?: string }).label?.trim() || n.type || n.id);

/** A sequence widget from an ordered chain of board nodes (labels from the edges between them). */
export function sequenceFromChain(nodes: readonly SNode[], edges: readonly SEdge[], chain: readonly string[]): SequenceData {
  const byId = indexNodes(nodes);
  const participants: string[] = [];
  const steps: ScenarioStep[] = [];
  chain.forEach((id) => {
    const p = participantOf(byId.get(id)!);
    if (!participants.includes(p)) participants.push(p);
  });
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = byId.get(chain[i])!;
    const b = byId.get(chain[i + 1])!;
    const e = edgeBetween(edges, a.id, b.id);
    const label = e?.data?.label || 'then';
    const from = e && e.source === b.id ? participantOf(b) : participantOf(a);
    const to = e && e.source === b.id ? participantOf(a) : participantOf(b);
    steps.push({ id: `s${i + 1}`, kind: e?.data?.channel === 'data' ? 'db-write' : e?.data?.channel === 'http' ? 'request' : e?.data?.channel === 'realtime' ? 'event' : 'call', title: label, from, to, label, narrative: label, hypothetical: e?.data?.proposed || undefined });
  }
  return { label: 'Sequence', custom: { participants, steps }, step: 0 };
}

/** The endpoint involved in a selection (an endpoint entity, or either end of a known edge touching one). */
export function endpointFor(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], nodeIds: readonly string[], edgeIds: readonly string[]): string | null {
  const byId = indexNodes(nodes);
  for (const eid of edgeIds) {
    const e = edges.find((x) => x.id === eid);
    if (!e) continue;
    for (const end of [e.source, e.target]) {
      const ent = entityOf(byId.get(end));
      if (ent && model.contract(ent)) return ent;
    }
    for (const rid of e.data?.relationIds ?? []) {
      const r = model.relation(rid);
      if (r && model.contract(r.to)) return r.to;
      if (r && model.contract(r.from)) return r.from;
    }
  }
  if (nodeIds.length === 1) {
    const ent = entityOf(byId.get(nodeIds[0]));
    if (ent && model.contract(ent)) return ent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

/** Copies of nodes (and the edges among them) with fresh ids, offset by `offset`. Children of copied frames stay inside. */
export function cloneElements(nodes: readonly SNode[], edges: readonly SEdge[], ids: readonly string[], offset: Point): { nodes: SNode[]; edges: SEdge[]; map: Map<string, string> } {
  const byId = indexNodes(nodes);
  const pick = new Set(ids);
  // Copying a frame copies its contents.
  for (const n of nodes) if (n.parentId && pick.has(n.parentId)) pick.add(n.id);
  const map = new Map<string, string>();
  for (const id of pick) map.set(id, newNodeId());
  const out: SNode[] = [];
  for (const id of pick) {
    const n = byId.get(id);
    if (!n) continue;
    const keepParent = n.parentId && pick.has(n.parentId);
    const pos = keepParent ? n.position : absPos(n, byId);
    out.push(
      decorate({
        id: map.get(id)!,
        type: n.type,
        position: keepParent ? { ...pos } : { x: pos.x + offset.x, y: pos.y + offset.y },
        width: nodeSize(n).w,
        height: nodeSize(n).h,
        parentId: keepParent ? map.get(n.parentId!) : undefined,
        zIndex: n.zIndex,
        data: structuredClone(n.data),
        selected: true,
      }),
    );
  }
  const outEdges: SEdge[] = edges
    .filter((e) => pick.has(e.source) && pick.has(e.target))
    .map((e) => ({ ...e, id: newEdgeId(), source: map.get(e.source)!, target: map.get(e.target)!, data: structuredClone(e.data), selected: false }));
  return { nodes: sortParentsFirst(out), edges: outEdges, map };
}

/** Set a node's parent frame (or none), keeping its absolute position. */
export function reparent(nodes: readonly SNode[], childId: string, parentId: string | undefined): SNode[] {
  const byId = indexNodes(nodes);
  const child = byId.get(childId);
  if (!child || child.parentId === parentId) return [...nodes];
  const abs = absPos(child, byId);
  const parent = parentId ? byId.get(parentId) : undefined;
  const pAbs = parent ? absPos(parent, byId) : { x: 0, y: 0 };
  const next = nodes.map((n) => (n.id === childId ? { ...n, parentId: parent?.id, position: { x: abs.x - pAbs.x, y: abs.y - pAbs.y } } : n));
  return sortParentsFirst(next);
}

/** The top-most frame containing a point (excluding some ids). */
export function frameAt(nodes: readonly SNode[], p: Point, exclude: ReadonlySet<string>): SNode | undefined {
  const byId = indexNodes(nodes);
  const frames = nodes.filter((n) => n.type === 'frame' && !n.hidden && !exclude.has(n.id) && contains(absRect(n, byId), p));
  return frames.sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))[0];
}

/** Wrap top-level nodes in a new titled frame. Frames are not nested. */
export function groupIntoFrame(nodes: readonly SNode[], ids: readonly string[], label = 'Frame', extra: Partial<SNode['data']> = {}): { nodes: SNode[]; frame: SNode } | null {
  const byId = indexNodes(nodes);
  const members = ids.map((id) => byId.get(id)).filter((n): n is SNode => !!n && n.type !== 'frame');
  if (!members.length) return null;
  const b = boundsOf(members.map((n) => absRect(n, byId)))!;
  const pad = 32;
  const frame = makeNode('frame', { x: snap(b.x - pad), y: snap(b.y - pad - 28) }, { label, ...extra }, { w: Math.round(b.w + pad * 2), h: Math.round(b.h + pad * 2 + 28) });
  let next: SNode[] = [frame, ...nodes];
  for (const m of members) next = reparent(next, m.id, frame.id);
  return { nodes: next, frame };
}

/** Remove nodes (children of removed frames are kept, at their absolute position) and their edges. */
export function removeNodes(nodes: readonly SNode[], edges: readonly SEdge[], ids: ReadonlySet<string>): { nodes: SNode[]; edges: SEdge[] } {
  let next = [...nodes];
  for (const n of nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) next = reparent(next, n.id, undefined);
  return { nodes: next.filter((n) => !ids.has(n.id)), edges: edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)) };
}

/** Layered left→right layout of top-level nodes (the given ones, or all), anchored at their current top-left. */
export function autoLayout(nodes: readonly SNode[], edges: readonly SEdge[], ids?: readonly string[]): Map<string, Point> {
  const byId = indexNodes(nodes);
  const top = (id: string): string => {
    let n = byId.get(id);
    while (n?.parentId && byId.get(n.parentId)) n = byId.get(n.parentId);
    return n?.id ?? id;
  };
  const scope = new Set((ids?.length ? ids.map(top) : nodes.filter((n) => !n.parentId).map((n) => n.id)).filter((id) => !byId.get(id)?.hidden));
  const items = [...scope].map((id) => {
    const s = nodeSize(byId.get(id)!);
    return { id, w: s.w, h: s.h };
  });
  if (items.length < 2) return new Map();
  const le = edges.map((e) => ({ source: top(e.source), target: top(e.target) })).filter((e) => scope.has(e.source) && scope.has(e.target) && e.source !== e.target);
  // Text/notes without edges would otherwise form a column; keep the ordering by current position.
  items.sort((a, b) => byId.get(a.id)!.position.y - byId.get(b.id)!.position.y || byId.get(a.id)!.position.x - byId.get(b.id)!.position.x);
  const rel = layered(items, le, { gapX: 120, gapY: 40 });
  const b = boundsOf(items.map((i) => absRect(byId.get(i.id)!, byId)))!;
  const out = new Map<string, Point>();
  for (const [id, p] of rel) out.set(id, { x: snap(b.x + p.x), y: snap(b.y + p.y) });
  return out;
}

/** Before/after: wrap the selection in an "Existing" frame and put an editable copy in a "Proposed" frame beside it. */
export function beforeAfter(nodes: readonly SNode[], edges: readonly SEdge[], ids: readonly string[]): Patch & { replace: SNode[] } | null {
  const byId = indexNodes(nodes);
  let members = ids.map((id) => byId.get(id)).filter((n): n is SNode => !!n);
  // Selecting a frame means its contents.
  const frames = members.filter((n) => n.type === 'frame').map((f) => f.id);
  members = [...members.filter((n) => n.type !== 'frame'), ...nodes.filter((n) => n.parentId && frames.includes(n.parentId))];
  const memberIds = [...new Set(members.map((n) => n.id))];
  if (!memberIds.length) return null;
  const existing = groupIntoFrame(nodes, memberIds, 'Existing');
  if (!existing) return null;
  const fr = existing.frame;
  const others = existing.nodes.filter((n) => n.id !== fr.id && !memberIds.includes(n.id));
  const rects = allRects(others);
  const want = { x: fr.position.x + (fr.width ?? 0) + 96 + (fr.width ?? 0) / 2, y: fr.position.y + (fr.height ?? 0) / 2 };
  const spot = findFreeSpot(rects, fr.width ?? 400, fr.height ?? 300, want, 32);
  const offset = { x: spot.x - fr.position.x, y: spot.y - fr.position.y };
  const copy = cloneElements(existing.nodes, edges, [fr.id], offset);
  const proposedFrameId = copy.map.get(fr.id)!;
  const copyNodes = copy.nodes.map((n) => (n.id === proposedFrameId ? { ...n, data: { ...n.data, label: 'Proposed', proposed: true, style: { stroke: 'purple' as const, strokeStyle: 'dashed' as const } } } : n));
  return {
    replace: existing.nodes.map((n) => ({ ...n, selected: false })),
    nodes: copyNodes,
    edges: copy.edges,
    select: [proposedFrameId],
    focus: [fr.id, proposedFrameId],
    message: 'Edit the “Proposed” copy; the “Existing” frame keeps the original',
  };
}

/** Normalise a set of nodes for a template (positions relative to the group's top-left). */
export function templateFrom(nodes: readonly SNode[], edges: readonly SEdge[], ids: readonly string[]): { nodes: StudioNode[]; edges: StudioEdge[] } {
  const byId = indexNodes(nodes);
  const pick = new Set(ids.length ? ids : nodes.map((n) => n.id));
  for (const n of nodes) if (n.parentId && pick.has(n.parentId)) pick.add(n.id);
  const sel = nodes.filter((n) => pick.has(n.id));
  const b = boundsOf(sel.map((n) => absRect(n, byId))) ?? { x: 0, y: 0, w: 0, h: 0 };
  const out = sel.map((n) => {
    const keep = n.parentId && pick.has(n.parentId);
    const p = keep ? n.position : absPos(n, byId);
    return toStudioNode({ ...n, parentId: keep ? n.parentId : undefined, position: keep ? p : { x: p.x - b.x, y: p.y - b.y } });
  });
  return { nodes: out, edges: edges.filter((e) => pick.has(e.source) && pick.has(e.target)).map(toStudioEdge) };
}

/** Insert template content at an origin with fresh ids. */
export function instantiate(tpl: { nodes: StudioNode[]; edges: StudioEdge[] }, origin: Point): { nodes: SNode[]; edges: SEdge[] } {
  const nodes = tpl.nodes.map(fromStudioNode);
  const edges = tpl.edges.map(fromStudioEdge);
  const top = nodes.filter((n) => !n.parentId).map((n) => n.id);
  const c = cloneElements(nodes, edges, top, origin);
  return { nodes: c.nodes, edges: c.edges };
}

/**
 * Where a single new entity should go: beside the on-board entity it relates to
 * (right of what calls it, left of what it calls; an indirect partner if there
 * is no direct one), else near `fallback`. With `orFallback` false, returns
 * null when nothing on the board relates to it.
 */
export function spotFor(model: Model, nodes: readonly SNode[], entityId: string, fallback: Point): Point;
export function spotFor(model: Model, nodes: readonly SNode[], entityId: string, fallback: Point, orFallback: false): Point | null;
export function spotFor(model: Model, nodes: readonly SNode[], entityId: string, fallback: Point, orFallback = true): Point | null {
  const size = DEFAULT_SIZE.entity;
  const rects = allRects(nodes);
  const byId = indexNodes(nodes);
  const ents = nodes.filter((n) => entityOf(n) && !n.hidden && entityOf(n) !== entityId);
  const pick = (cands: { node: SNode; right: boolean }[]) => {
    let best: { node: SNode; right: boolean; d: number } | null = null;
    for (const c of cands) {
      const r = absRect(c.node, byId);
      const d = Math.hypot(r.x + r.w / 2 - fallback.x, r.y + r.h / 2 - fallback.y);
      if (!best || d < best.d) best = { ...c, d };
    }
    return best;
  };
  let best = pick(
    ents.flatMap((n) => {
      const rels = relationsForPair(model, entityId, entityOf(n)!).filter((r) => !STRUCTURAL.includes(r.kind));
      return rels.length ? [{ node: n, right: rels.some((x) => model.isWithin(x.from, entityOf(n)!)) }] : [];
    }),
  );
  if (!best && ents.length <= 80) {
    const onBoard = new Set(ents.map((n) => entityOf(n)!));
    best = pick(
      ents.flatMap((n) => {
        const link = indirectLink(model, entityId, entityOf(n)!, onBoard);
        return link ? [{ node: n, right: !link.forward }] : [];
      }),
    );
  }
  if (!best) return orFallback ? findFreeSpot(rects, size.w, size.h, fallback, 40) : null;
  const r = absRect(best.node, byId);
  const want = { x: best.right ? r.x + r.w + 140 + size.w / 2 : r.x - 140 - size.w / 2, y: r.y + r.h / 2 };
  return findFreeSpot(rects, size.w, size.h, want, 40);
}

/**
 * Replace an indirect edge by the intermediate entity and the two real
 * relationships (placed between the two ends). Returns the new arrays.
 */
export function expandIndirect(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], edgeId: string): { nodes: SNode[]; edges: SEdge[]; added: SNode } | null {
  const e = edges.find((x) => x.id === edgeId);
  const via = e?.data?.indirect?.via;
  if (!e || !via || !model.has(via)) return null;
  const byId = indexNodes(nodes);
  const a = byId.get(e.source);
  const b = byId.get(e.target);
  if (!a || !b) return null;
  const ra = absRect(a, byId);
  const rb = absRect(b, byId);
  const size = DEFAULT_SIZE.entity;
  const want = { x: (ra.x + ra.w / 2 + rb.x + rb.w / 2) / 2, y: (ra.y + ra.h / 2 + rb.y + rb.h / 2) / 2 };
  const p = findFreeSpot(allRects(nodes), size.w, size.h, want, 32);
  const mid = entityNode(via, p);
  const out: SEdge[] = edges.filter((x) => x.id !== edgeId);
  for (const end of [a, b]) {
    const k = knownEdgeData(model, entityOf(end)!, via);
    if (!k) continue;
    const [s, t] = k.forward ? [end.id, mid.id] : [mid.id, end.id];
    out.push({ id: newEdgeId(), source: s, target: t, type: 'studio', data: k.data });
  }
  return { nodes: [...nodes, mid], edges: out, added: mid };
}
