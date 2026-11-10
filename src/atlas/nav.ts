/** Keyboard navigation over the visible Atlas tree. Pure. */
import type { Rect } from './layout';
import type { VisibleTree } from './visibility';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Siblings in reading order (row by row, left to right) using the laid-out rects. */
export function readingOrder(ids: readonly string[], rects: ReadonlyMap<string, Rect>): string[] {
  return [...ids].sort((a, b) => {
    const ra = rects.get(a);
    const rb = rects.get(b);
    if (!ra || !rb) return 0;
    return ra.y - rb.y || ra.x - rb.x;
  });
}

/**
 * Where an arrow key moves the selection: ↑ parent, ↓ first child (when the
 * container is expanded), ←/→ previous / next sibling. Returns null when there
 * is nowhere to go. With nothing selected, any arrow selects the root.
 */
export function navigate(tree: VisibleTree, rects: ReadonlyMap<string, Rect>, current: string | null, dir: Direction): string | null {
  if (!current || !tree.nodes.has(current)) return tree.nodes.has(tree.root) ? tree.root : null;
  const node = tree.nodes.get(current)!;
  if (dir === 'up') return node.parent;
  if (dir === 'down') {
    if (!node.expanded || node.children.length === 0) return null;
    return readingOrder(node.children, rects)[0] ?? null;
  }
  const siblings = node.parent ? readingOrder(tree.nodes.get(node.parent)!.children, rects) : node.stub ? tree.stubs : [current];
  const i = siblings.indexOf(current);
  const j = dir === 'left' ? i - 1 : i + 1;
  return siblings[j] ?? null;
}
