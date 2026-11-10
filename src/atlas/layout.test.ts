import { describe, expect, it } from 'vitest';
import { baseModel, type DetailLevel } from '@/model';
import { arrangeRows, boundsOf, contains, gridColumns, layoutTree, overlaps, type LayoutNode, type Rect } from './layout';
import { layoutScene } from './scene';
import { computeVisible, type VisibleTree } from './visibility';

const leaf = (id: string, order: number, row?: number): LayoutNode => ({
  id,
  size: { w: 100, h: 50 },
  children: null,
  order,
  row,
});

function scene(expanded: string[], detail: DetailLevel = 3, extra: Partial<Parameters<typeof computeVisible>[1]> = {}) {
  const tree = computeVisible(baseModel, {
    root: 'meridian',
    expanded: new Set(expanded),
    detail,
    forced: [],
    revealAll: new Set(),
    focus: false,
    ...extra,
  });
  return { tree, rects: layoutScene(baseModel, tree) };
}

function checkInvariants(tree: VisibleTree, rects: Map<string, Rect>) {
  for (const id of tree.order) {
    const n = tree.nodes.get(id)!;
    const r = rects.get(id)!;
    expect(r, id).toBeDefined();
    // Children inside their parent, below the header band.
    for (const c of n.children) {
      const cr = rects.get(c)!;
      expect(contains(r, cr), `${c} inside ${id}`).toBe(true);
      expect(cr.y).toBeGreaterThanOrEqual(r.y + 44);
    }
    // No overlaps among siblings.
    for (let i = 0; i < n.children.length; i++)
      for (let j = i + 1; j < n.children.length; j++) expect(overlaps(rects.get(n.children[i])!, rects.get(n.children[j])!), `${n.children[i]} vs ${n.children[j]}`).toBe(false);
  }
}

describe('gridColumns / arrangeRows', () => {
  it('uses a roughly 3:2 grid capped at 6 columns', () => {
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(3)).toBe(3);
    expect(gridColumns(14)).toBe(5);
    expect(gridColumns(100)).toBe(6);
  });

  it('puts declared rows first, sorted by order, then the grid', () => {
    const rows = arrangeRows([leaf('c', 0, 1), leaf('a', 1, 0), leaf('b', 0, 0), leaf('x', 0), leaf('y', 1)]);
    expect(rows.map((r) => r.map((n) => n.id))).toEqual([['b', 'a'], ['c'], ['x', 'y']]);
  });

  it('sizes the grid from the total number of row-less siblings, not the visible ones', () => {
    const kids = [0, 1, 2, 3].map((i) => ({
      ...leaf(`k${i}`, i),
      gridTotal: 14,
    }));
    expect(arrangeRows(kids)).toHaveLength(1); // 5 columns → one row of four
  });
});

describe('layoutTree', () => {
  it('is deterministic', () => {
    const a = scene(['meridian', 'backend', 'db'], 5);
    const b = scene(['meridian', 'backend', 'db'], 5);
    expect([...a.rects.entries()]).toEqual([...b.rects.entries()]);
  });

  it('keeps children inside parents with no sibling overlaps, at every depth', () => {
    const s = scene(['meridian', 'backend', 'be.money', 'be:money/movements', 'db', 'customer', 'cu.portal', 'shared', 'sh:money'], 5);
    checkInvariants(s.tree, s.rects);
  });

  it('places a collapsed root alone at the origin', () => {
    const s = scene([]);
    expect(s.tree.order).toEqual(['meridian']);
    expect(s.rects.get('meridian')).toMatchObject({ x: 0, y: 0 });
  });

  it('expanding a container does not move anything above it or earlier in its row', () => {
    const before = scene(['meridian']);
    const after = scene(['meridian', 'backend']);
    // Roles (row 0) and the two apps (row 1) are above Backend API (row 2).
    for (const id of ['role:customer', 'role:ops_agent', 'customer', 'operations']) expect(after.rects.get(id)).toEqual(before.rects.get(id));
    // Backend keeps its top-left corner; it only grows.
    const b0 = before.rects.get('backend')!;
    const b1 = after.rects.get('backend')!;
    expect([b1.x, b1.y]).toEqual([b0.x, b0.y]);
    expect(b1.w).toBeGreaterThan(b0.w);
    // The database sits in Backend's row, to its right: it slides right by the growth and stays on the row.
    expect(after.rects.get('db')!.x - before.rects.get('db')!.x).toBe(b1.w - b0.w);
    expect(after.rects.get('db')!.x).toBeGreaterThan(b1.x + b1.w - 1);
    // Things in the rows below move down, keeping their order.
    expect(after.rects.get('infra')!.y).toBeGreaterThan(before.rects.get('infra')!.y);
    expect(after.rects.get('infra')!.x).toBe(before.rects.get('infra')!.x);
  });

  it('changing the detail level keeps sibling order (no reshuffle)', () => {
    const order = (s: ReturnType<typeof scene>, parent: string) =>
      [...s.tree.nodes.get(parent)!.children].sort((a, b) => s.rects.get(a)!.y - s.rects.get(b)!.y || s.rects.get(a)!.x - s.rects.get(b)!.x);
    const low = scene(['meridian', 'backend'], 2);
    const high = scene(['meridian', 'backend'], 5);
    for (const parent of ['meridian', 'backend']) {
      const shared = order(low, parent);
      expect(order(high, parent).filter((id) => shared.includes(id))).toEqual(shared);
    }
  });

  it('places focus stubs in a row above the root', () => {
    const root: LayoutNode = {
      id: 'r',
      size: { w: 200, h: 100 },
      children: [leaf('a', 0), leaf('b', 1)],
      order: 0,
    };
    const rects = layoutTree(root, [
      { id: 's1', size: { w: 80, h: 30 } },
      { id: 's2', size: { w: 80, h: 30 } },
    ]);
    const s1 = rects.get('s1')!;
    const s2 = rects.get('s2')!;
    expect(s1.y + s1.h).toBeLessThan(0);
    expect(s1.y).toBe(s2.y);
    expect(overlaps(s1, s2)).toBe(false);
  });

  it('gives an expanded container with no visible children room for its message', () => {
    const rects = layoutTree({
      id: 'r',
      size: { w: 200, h: 100 },
      children: [],
      order: 0,
    });
    expect(rects.get('r')!.w).toBeGreaterThanOrEqual(280);
  });

  it('boundsOf covers every rect', () => {
    expect(
      boundsOf([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -5, y: 20, w: 10, h: 10 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 15, h: 30 });
    expect(boundsOf([])).toBeNull();
  });
});
