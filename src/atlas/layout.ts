/**
 * Deterministic recursive "nested rows" layout for the Atlas. Pure.
 *
 * Every expanded container lays its visible children out in rows: children
 * that declare `layout.row` share that row (sorted by `layout.order`);
 * children without a row are packed after them into a grid whose column
 * count depends on the TOTAL number of such siblings in the model (not on how
 * many are currently visible), so the detail dial never reshuffles them.
 * Sizes are computed bottom-up; rows are left-aligned and top-aligned, so
 * expanding a node only pushes things to its right and below it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface LayoutNode {
  id: string;
  /** Collapsed size (also the minimum size of an expanded container). */
  size: Size;
  /** Visible children when expanded; `null` when collapsed or a leaf. */
  children: LayoutNode[] | null;
  /** `layout.row` from the model, if declared. */
  row?: number;
  /** Order within the row / among siblings. */
  order: number;
  /** Total number of row-less siblings in the model (drives grid columns). */
  gridTotal?: number;
}

export const LAYOUT = {
  header: 44,
  pad: 20,
  gapX: 28,
  gapY: 40,
  emptyHeight: 64,
  minExpandedWidth: 280,
  stubGap: 96,
} as const;

/** Columns for a grid of `total` row-less siblings: roughly 3:2, at most 6. */
export function gridColumns(total: number): number {
  if (total <= 3) return Math.max(1, total);
  return Math.min(6, Math.ceil(Math.sqrt(total * 1.5)));
}

/** Group children into rows (declared rows first, then the grid). Exported for tests. */
export function arrangeRows(children: LayoutNode[]): LayoutNode[][] {
  const rowed = new Map<number, LayoutNode[]>();
  const loose: LayoutNode[] = [];
  for (const c of children) {
    if (c.row === undefined || c.row === null) loose.push(c);
    else {
      const list = rowed.get(c.row) ?? [];
      list.push(c);
      rowed.set(c.row, list);
    }
  }
  const rows: LayoutNode[][] = [...rowed.keys()]
    .sort((a, b) => a - b)
    .map((r) => rowed.get(r)!.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
  if (loose.length) {
    loose.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const cols = gridColumns(Math.max(loose.length, loose[0].gridTotal ?? loose.length));
    for (let i = 0; i < loose.length; i += cols) rows.push(loose.slice(i, i + cols));
  }
  return rows;
}

interface Measured {
  w: number;
  h: number;
  /** Child offsets relative to this node's top-left. */
  kids: { node: LayoutNode; m: Measured; dx: number; dy: number }[];
}

function measure(node: LayoutNode): Measured {
  if (!node.children) return { w: node.size.w, h: node.size.h, kids: [] };
  if (node.children.length === 0) {
    return { w: Math.max(node.size.w, LAYOUT.minExpandedWidth), h: LAYOUT.header + LAYOUT.emptyHeight, kids: [] };
  }
  const rows = arrangeRows(node.children);
  const kids: Measured['kids'] = [];
  let y = LAYOUT.header + 8;
  let maxW = 0;
  rows.forEach((row, ri) => {
    let x = LAYOUT.pad;
    let rowH = 0;
    row.forEach((child, ci) => {
      const m = measure(child);
      if (ci > 0) x += LAYOUT.gapX;
      kids.push({ node: child, m, dx: x, dy: y });
      x += m.w;
      rowH = Math.max(rowH, m.h);
    });
    maxW = Math.max(maxW, x);
    y += rowH;
    if (ri < rows.length - 1) y += LAYOUT.gapY;
  });
  const w = Math.max(node.size.w, LAYOUT.minExpandedWidth, maxW + LAYOUT.pad);
  const h = y + LAYOUT.pad;
  return { w, h, kids };
}

function place(m: Measured, id: string, x: number, y: number, out: Map<string, Rect>): void {
  out.set(id, { x, y, w: m.w, h: m.h });
  for (const k of m.kids) place(k.m, k.node.id, x + k.dx, y + k.dy, out);
}

/**
 * Lay out a tree rooted at (0, 0). Optional `stubs` (focus mode) are placed in
 * a centred row above the root.
 */
export function layoutTree(root: LayoutNode, stubs: { id: string; size: Size }[] = []): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const m = measure(root);
  place(m, root.id, 0, 0, out);
  if (stubs.length) {
    const maxRowW = Math.max(m.w, 900);
    const rows: { id: string; size: Size }[][] = [[]];
    let rowW = 0;
    for (const s of stubs) {
      const add = (rows[rows.length - 1].length ? LAYOUT.gapX : 0) + s.size.w;
      if (rowW + add > maxRowW && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(s);
      rowW += (rows[rows.length - 1].length > 1 ? LAYOUT.gapX : 0) + s.size.w;
    }
    let y = -LAYOUT.stubGap;
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      const h = Math.max(...row.map((s) => s.size.h));
      y -= h;
      const total = row.reduce((sum, s) => sum + s.size.w, 0) + LAYOUT.gapX * (row.length - 1);
      let x = (m.w - total) / 2;
      for (const s of row) {
        out.set(s.id, { x, y, w: s.size.w, h: s.size.h });
        x += s.size.w + LAYOUT.gapX;
      }
      y -= LAYOUT.gapX;
    }
  }
  return out;
}

export function boundsOf(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
