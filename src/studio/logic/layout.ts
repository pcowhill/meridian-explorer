/** Deterministic layouts: layered left→right (by edge direction), a strict row, and a grid. */
import type { Point } from './geometry';

export interface LayoutItem {
  id: string;
  w: number;
  h: number;
}
export interface LayoutEdge {
  source: string;
  target: string;
}

/** Rank every item by the longest path from a source, ignoring edges that close a cycle. */
export function rankItems(ids: readonly string[], edges: readonly LayoutEdge[]): Map<string, number> {
  const set = new Set(ids);
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const e of edges) if (set.has(e.source) && set.has(e.target) && e.source !== e.target) out.get(e.source)!.push(e.target);

  // DFS to drop back edges (cycle breaking), producing a DAG.
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>(ids.map((id) => [id, []]));
  const order: string[] = [];
  const visit = (v: string) => {
    state.set(v, 1);
    for (const w of out.get(v)!) {
      const s = state.get(w) ?? 0;
      if (s === 1) continue; // back edge
      dag.get(v)!.push(w);
      if (s === 0) visit(w);
    }
    state.set(v, 2);
    order.push(v);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  order.reverse(); // topological

  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const v of order) for (const w of dag.get(v)!) rank.set(w, Math.max(rank.get(w)!, rank.get(v)! + 1));
  return rank;
}

/** Layered left→right layout. Returns top-left positions relative to (0, 0). */
export function layered(items: readonly LayoutItem[], edges: readonly LayoutEdge[], opts: { gapX?: number; gapY?: number; maxColumns?: number } = {}): Map<string, Point> {
  const gapX = opts.gapX ?? 110;
  const gapY = opts.gapY ?? 36;
  const ids = items.map((i) => i.id);
  const set = new Set(ids);
  const relevant = edges.filter((e) => set.has(e.source) && set.has(e.target) && e.source !== e.target);
  if (!relevant.length) return grid(items, { gapX: 48, gapY: gapY });

  const connected = new Set(relevant.flatMap((e) => [e.source, e.target]));
  const rank = rankItems(ids.filter((id) => connected.has(id)), relevant);
  const maxRank = Math.max(0, ...rank.values());
  // Unconnected items go into their own column at the end.
  for (const id of ids) if (!connected.has(id)) rank.set(id, maxRank + 1);

  const columns: string[][] = [];
  for (const id of ids) (columns[rank.get(id)!] ??= []).push(id);
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];

  // Barycentre ordering sweeps to reduce crossings.
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of relevant) {
    neighbours.get(e.source)!.push(e.target);
    neighbours.get(e.target)!.push(e.source);
  }
  const indexIn = new Map<string, number>();
  const reindex = () => columns.forEach((col) => col.forEach((id, i) => indexIn.set(id, i)));
  reindex();
  for (let sweep = 0; sweep < 4; sweep++) {
    const range = sweep % 2 === 0 ? columns.map((_, i) => i).slice(1) : columns.map((_, i) => i).reverse().slice(1);
    for (const c of range) {
      const ref = sweep % 2 === 0 ? c - 1 : c + 1;
      const refSet = new Set(columns[ref] ?? []);
      const score = (id: string) => {
        const ns = neighbours.get(id)!.filter((n) => refSet.has(n));
        return ns.length ? ns.reduce((s, n) => s + indexIn.get(n)!, 0) / ns.length : indexIn.get(id)!;
      };
      const scored = columns[c].map((id) => ({ id, s: score(id) }));
      scored.sort((a, b) => a.s - b.s);
      columns[c] = scored.map((x) => x.id);
      reindex();
    }
  }

  const size = new Map(items.map((i) => [i.id, i]));
  const filled = columns.filter((c) => c.length);
  // Long chains wrap into bands (read left→right, then the next band below) so they stay readable.
  const maxC = Math.max(1, opts.maxColumns ?? Infinity);
  const pos = new Map<string, Point>();
  let bandY = 0;
  for (let start = 0; start < filled.length; start += maxC) {
    const band = filled.slice(start, start + maxC);
    const heights = band.map((col) => col.reduce((s, id) => s + size.get(id)!.h, 0) + Math.max(0, col.length - 1) * gapY);
    const tallest = Math.max(...heights);
    let x = 0;
    band.forEach((col, ci) => {
      const width = Math.max(...col.map((id) => size.get(id)!.w));
      let y = bandY + (tallest - heights[ci]) / 2;
      for (const id of col) {
        const it = size.get(id)!;
        pos.set(id, { x: Math.round(x + (width - it.w) / 2), y: Math.round(y) });
        y += it.h + gapY;
      }
      x += width + gapX;
    });
    bandY += tallest + gapY * 3;
  }
  return pos;
}

/** Strict left→right row in the given order, vertically centred. */
export function row(items: readonly LayoutItem[], gapX = 110): Map<string, Point> {
  const tallest = Math.max(0, ...items.map((i) => i.h));
  const pos = new Map<string, Point>();
  let x = 0;
  for (const it of items) {
    pos.set(it.id, { x, y: Math.round((tallest - it.h) / 2) });
    x += it.w + gapX;
  }
  return pos;
}

/** Roughly square grid in reading order. */
export function grid(items: readonly LayoutItem[], opts: { gapX?: number; gapY?: number; columns?: number } = {}): Map<string, Point> {
  const gapX = opts.gapX ?? 48;
  const gapY = opts.gapY ?? 36;
  const cols = Math.max(1, opts.columns ?? Math.ceil(Math.sqrt(items.length * 1.6)));
  const pos = new Map<string, Point>();
  const colW = Math.max(0, ...items.map((i) => i.w));
  let y = 0;
  for (let r = 0; r * cols < items.length; r++) {
    const rowItems = items.slice(r * cols, r * cols + cols);
    const rowH = Math.max(...rowItems.map((i) => i.h));
    rowItems.forEach((it, c) => pos.set(it.id, { x: c * (colW + gapX), y }));
    y += rowH + gapY;
  }
  return pos;
}
