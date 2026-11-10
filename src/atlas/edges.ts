/**
 * Atlas edges: turning lifted relations into drawable, routed edges. Pure.
 *
 * Routing is deliberately cheap and predictable: each edge leaves and enters
 * on the facing sides of its two boxes (bottom→top when one is below the
 * other, otherwise right→left), edges sharing a side are spread across it in
 * the order of their other ends (so they do not cross at the port), and the
 * curve is a point-symmetric cubic whose midpoint is exactly the middle of the
 * path (where the label and the click target sit).
 */
import type { LiftedEdge, RelationChannel } from '@/model';
import { overlaps, type Rect } from './layout';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export interface Point {
  x: number;
  y: number;
}

export interface EdgeSpec {
  id: string;
  a: string;
  b: string;
  channel: RelationChannel;
  count: number;
  /** Relations a → b exist (arrow at b). */
  forward: boolean;
  /** Relations b → a exist (arrow at a). */
  backward: boolean;
  hypothetical: boolean;
  label: string;
}

export interface EdgeGeom {
  path: string;
  mid: Point;
  /** Arrowhead polygons (SVG `points`). */
  arrowB?: string;
  arrowA?: string;
}

const NOUN: Record<RelationChannel, [string, string]> = {
  http: ['HTTP call', 'HTTP calls'],
  realtime: ['real-time link', 'real-time links'],
  call: ['call', 'calls'],
  data: ['data access', 'data accesses'],
  type: ['type dependency', 'type dependencies'],
  security: ['guard', 'guards'],
  ops: ['link', 'links'],
  structure: ['link', 'links'],
};

export function countLabel(channel: RelationChannel, n: number): string {
  return `${n} ${NOUN[channel][n === 1 ? 0 : 1]}`;
}

export function toSpec(e: LiftedEdge): EdgeSpec {
  const count = e.forward.length + e.backward.length;
  return {
    id: e.id,
    a: e.a,
    b: e.b,
    channel: e.channel,
    count,
    forward: e.forward.length > 0,
    backward: e.backward.length > 0,
    hypothetical: e.hypothetical,
    label: e.headline?.label ?? countLabel(e.channel, count),
  };
}

/** Gentle thickness scale: 1.25px for one relation, capped at 3.5px for big bundles. */
export function strokeWidth(count: number): number {
  return Math.min(3.5, 1.25 + Math.log2(Math.max(1, count)) * 0.4);
}

export function chooseSides(A: Rect, B: Rect): [Side, Side] {
  if (B.y >= A.y + A.h) return ['bottom', 'top'];
  if (A.y >= B.y + B.h) return ['top', 'bottom'];
  if (B.x >= A.x + A.w) return ['right', 'left'];
  if (A.x >= B.x + B.w) return ['left', 'right'];
  // Overlapping boxes (should not happen between non-nested nodes): use centres.
  return A.y + A.h / 2 <= B.y + B.h / 2 ? ['bottom', 'top'] : ['top', 'bottom'];
}

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function portPoint(r: Rect, side: Side, index: number, total: number): Point {
  const horizontal = side === 'top' || side === 'bottom';
  const length = horizontal ? r.w : r.h;
  const span = total > 1 ? Math.min(length * 0.7, (total - 1) * 22) : 0;
  const offset = total > 1 ? -span / 2 + (span * index) / (total - 1) : 0;
  if (horizontal) return { x: r.x + r.w / 2 + offset, y: side === 'top' ? r.y : r.y + r.h };
  return { x: side === 'left' ? r.x : r.x + r.w, y: r.y + r.h / 2 + offset };
}

function arrow(tip: Point, n: Point, size = 5): string {
  // n points out of the node the arrow enters; the arrow points against it.
  const bx = tip.x + n.x * size * 1.3;
  const by = tip.y + n.y * size * 1.3;
  const px = -n.y * size * 0.62;
  const py = n.x * size * 0.62;
  const f = (v: number) => Math.round(v * 10) / 10;
  return `${f(tip.x)},${f(tip.y)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}`;
}

/** Route every edge whose two ends have rects. */
export function routeEdges(specs: readonly EdgeSpec[], rects: ReadonlyMap<string, Rect>): Map<string, EdgeGeom> {
  type End = { edge: string; end: 'a' | 'b'; other: Point };
  const sides = new Map<string, [Side, Side]>();
  const ports = new Map<string, End[]>();
  for (const s of specs) {
    const A = rects.get(s.a);
    const B = rects.get(s.b);
    if (!A || !B) continue;
    const [sa, sb] = chooseSides(A, B);
    sides.set(s.id, [sa, sb]);
    const ka = `${s.a}\u0000${sa}`;
    const kb = `${s.b}\u0000${sb}`;
    (ports.get(ka) ?? ports.set(ka, []).get(ka)!).push({
      edge: s.id,
      end: 'a',
      other: center(B),
    });
    (ports.get(kb) ?? ports.set(kb, []).get(kb)!).push({
      edge: s.id,
      end: 'b',
      other: center(A),
    });
  }
  const at = new Map<string, Point>();
  for (const [key, ends] of ports) {
    const [node, side] = key.split('\u0000') as [string, Side];
    const r = rects.get(node)!;
    const horizontal = side === 'top' || side === 'bottom';
    ends.sort((p, q) => (horizontal ? p.other.x - q.other.x : p.other.y - q.other.y) || p.edge.localeCompare(q.edge));
    ends.forEach((e, i) => at.set(`${e.edge}\u0000${e.end}`, portPoint(r, side, i, ends.length)));
  }
  const out = new Map<string, EdgeGeom>();
  for (const s of specs) {
    const sd = sides.get(s.id);
    if (!sd) continue;
    const p0 = at.get(`${s.id}\u0000a`)!;
    const p3 = at.get(`${s.id}\u0000b`)!;
    const n0 = NORMAL[sd[0]];
    const n3 = NORMAL[sd[1]];
    const along = Math.abs(n0.x ? p3.x - p0.x : p3.y - p0.y);
    const k = Math.max(26, Math.min(180, along * 0.5));
    const p1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k };
    const p2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
    const f = (v: number) => Math.round(v * 10) / 10;
    const mid = {
      x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
      y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
    };
    out.set(s.id, {
      path: `M${f(p0.x)},${f(p0.y)} C${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} ${f(p3.x)},${f(p3.y)}`,
      mid,
      arrowB: s.forward ? arrow(p3, n3) : undefined,
      arrowA: s.backward ? arrow(p0, n0) : undefined,
    });
  }
  return out;
}

export function labelSize(label: string): { w: number; h: number } {
  return { w: Math.min(260, label.length * 6.1 + 18), h: 20 };
}

/**
 * Which edge labels can be shown permanently (at close zoom) without colliding
 * with each other or with leaf boxes. Greedy, heaviest edges first.
 */
export function placeLabels(specs: readonly EdgeSpec[], geoms: ReadonlyMap<string, EdgeGeom>, obstacles: readonly Rect[]): Set<string> {
  const placed: Rect[] = [];
  const ok = new Set<string>();
  const order = [...specs].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  for (const s of order) {
    const g = geoms.get(s.id);
    if (!g) continue;
    const { w, h } = labelSize(s.label);
    const r = { x: g.mid.x - w / 2, y: g.mid.y - h / 2, w, h };
    if (placed.some((p) => overlaps(p, r)) || obstacles.some((o) => overlaps(o, r))) continue;
    placed.push(r);
    ok.add(s.id);
  }
  return ok;
}

/**
 * Stacking: nodes sit at depth × 10. An edge sits just below the shallower of
 * its two ends — above the container region that holds that end, but BEHIND
 * every card at that depth or deeper — so edges never cross node text (deeper
 * regions are translucent, so edges running under them stay visible).
 */
export const nodeZ = (depth: number): number => depth * 10;
export const edgeZ = (depthA: number, depthB: number): number => Math.min(depthA, depthB) * 10 - 5;
