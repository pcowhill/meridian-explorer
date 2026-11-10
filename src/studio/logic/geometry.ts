/** Pure geometry over board nodes: sizes, absolute rectangles, free space, alignment. */
import { DEFAULT_SIZE, type SNode } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

export const GRID = 16;

export function nodeSize(n: Pick<SNode, 'type' | 'width' | 'height' | 'measured'>): { w: number; h: number } {
  const d = DEFAULT_SIZE[n.type as keyof typeof DEFAULT_SIZE] ?? { w: 200, h: 100 };
  return { w: n.width ?? n.measured?.width ?? d.w, h: n.height ?? n.measured?.height ?? d.h };
}

export type NodeIndex = ReadonlyMap<string, SNode>;
export const indexNodes = (nodes: readonly SNode[]): Map<string, SNode> => new Map(nodes.map((n) => [n.id, n]));

/** Absolute (flow) position of a node, resolving its parent chain. */
export function absPos(n: SNode, byId: NodeIndex): Point {
  let x = n.position.x;
  let y = n.position.y;
  const seen = new Set<string>([n.id]);
  let p = n.parentId ? byId.get(n.parentId) : undefined;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    x += p.position.x;
    y += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return { x, y };
}

export function absRect(n: SNode, byId: NodeIndex): Rect {
  const p = absPos(n, byId);
  const s = nodeSize(n);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const overlaps = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;

export const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const snap = (v: number, grid = GRID): number => Math.round(v / grid) * grid;

/**
 * The free spot for a w×h box closest to `near` (its centre), searched on an
 * expanding ring so a new element never lands on top of existing ones.
 */
export function findFreeSpot(rects: readonly Rect[], w: number, h: number, near: Point, margin = 24): Point {
  const start = { x: snap(near.x - w / 2), y: snap(near.y - h / 2) };
  const free = (p: Point) => !rects.some((r) => overlaps({ x: p.x, y: p.y, w, h }, r, margin));
  if (free(start)) return start;
  const step = 32;
  for (let ring = 1; ring < 80; ring++) {
    const candidates: Point[] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push({ x: start.x + i * step, y: start.y - ring * step });
      candidates.push({ x: start.x + i * step, y: start.y + ring * step });
      candidates.push({ x: start.x - ring * step, y: start.y + i * step });
      candidates.push({ x: start.x + ring * step, y: start.y + i * step });
    }
    candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
    const hit = candidates.find(free);
    if (hit) return hit;
  }
  return { x: start.x, y: start.y + 2000 };
}

/** Where a new group of content should start so it sits clear of everything already on the board. */
export function clearOrigin(rects: readonly Rect[], gap = 160): Point {
  const b = boundsOf(rects);
  if (!b) return { x: 0, y: 0 };
  return { x: snap(b.x + b.w + gap), y: snap(b.y) };
}

/** Parents must precede their children in React Flow's node array. */
export function sortParentsFirst<T extends { id: string; parentId?: string }>(nodes: readonly T[]): T[] {
  const ids = new Set(nodes.map((n) => n.id));
  const placed = new Set<string>();
  const out: T[] = [];
  let pending = [...nodes];
  for (let guard = 0; pending.length && guard < 20; guard++) {
    const next: T[] = [];
    for (const n of pending) {
      if (!n.parentId || !ids.has(n.parentId) || placed.has(n.parentId)) {
        out.push(n);
        placed.add(n.id);
      } else next.push(n);
    }
    pending = next;
  }
  return [...out, ...pending];
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** New absolute positions that align the rectangles. */
export function alignRects(rects: ReadonlyMap<string, Rect>, mode: AlignMode): Map<string, Point> {
  const list = [...rects.values()];
  const b = boundsOf(list);
  const out = new Map<string, Point>();
  if (!b) return out;
  for (const [id, r] of rects) {
    let { x, y } = r;
    if (mode === 'left') x = b.x;
    if (mode === 'right') x = b.x + b.w - r.w;
    if (mode === 'center') x = b.x + b.w / 2 - r.w / 2;
    if (mode === 'top') y = b.y;
    if (mode === 'bottom') y = b.y + b.h - r.h;
    if (mode === 'middle') y = b.y + b.h / 2 - r.h / 2;
    out.set(id, { x, y });
  }
  return out;
}

/** Equal gaps between rectangles along one axis (first and last stay put). */
export function distributeRects(rects: ReadonlyMap<string, Rect>, axis: 'x' | 'y'): Map<string, Point> {
  const entries = [...rects.entries()].sort((a, b) => (axis === 'x' ? a[1].x - b[1].x : a[1].y - b[1].y));
  const out = new Map<string, Point>();
  if (entries.length < 3) return out;
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const first = entries[0][1];
  const last = entries[entries.length - 1][1];
  const total = entries.reduce((s, [, r]) => s + size(r), 0);
  const gap = (pos(last) + size(last) - pos(first) - total) / (entries.length - 1);
  let cursor = pos(first);
  for (const [id, r] of entries) {
    out.set(id, axis === 'x' ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
    cursor += size(r) + gap;
  }
  return out;
}
