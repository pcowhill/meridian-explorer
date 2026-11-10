/**
 * Glue between the model, the visible tree and the pure layout: node sizes and
 * the LayoutNode tree. Pure.
 */
import type { Model } from '@/model';
import { layoutTree, type LayoutNode, type Rect, type Size } from './layout';
import { mapChildren, type VisibleTree } from './visibility';

export const SIZES = {
  root: { w: 340, h: 156 },
  container: { w: 240, h: 112 },
  leaf: { w: 216, h: 96 },
  stub: { w: 236, h: 60 },
} as const satisfies Record<string, Size>;

export function nodeSize(tree: VisibleTree, id: string): Size {
  const n = tree.nodes.get(id);
  if (!n) return SIZES.leaf;
  if (n.stub) return SIZES.stub;
  if (n.depth === 0 && !n.expanded) return SIZES.root;
  return n.isContainer ? SIZES.container : SIZES.leaf;
}

export function toLayoutNode(model: Model, tree: VisibleTree, id: string): LayoutNode {
  const n = tree.nodes.get(id)!;
  const e = model.entity(id);
  const parent = n.parent;
  let gridTotal: number | undefined;
  if (parent && e?.layout?.row === undefined) {
    gridTotal = mapChildren(model, parent).filter((c) => c.layout?.row === undefined).length;
  }
  const siblingIndex = parent ? mapChildren(model, parent).findIndex((c) => c.id === id) : 0;
  return {
    id,
    size: nodeSize(tree, id),
    children: n.expanded ? n.children.map((c) => toLayoutNode(model, tree, c)) : null,
    row: e?.layout?.row,
    order: e?.layout?.row !== undefined ? (e.layout.order ?? siblingIndex) : siblingIndex,
    gridTotal,
  };
}

export function layoutScene(model: Model, tree: VisibleTree): Map<string, Rect> {
  if (!tree.nodes.has(tree.root)) return new Map();
  const root = toLayoutNode(model, tree, tree.root);
  return layoutTree(
    root,
    tree.stubs.map((s) => ({ id: s, size: SIZES.stub })),
  );
}
