/**
 * Which entities are on the Atlas map. Pure functions over the model.
 *
 * A container's children are drawn only when it is expanded. A child shows
 * when its detail level is within the global dial, when it is hypothetical,
 * when it is "forced" (the selection, its ancestors, explicitly revealed
 * things, lens implementers), or when its parent's hidden children were
 * revealed with the "+N more" chip. Features are never map nodes.
 */
import type { DetailLevel, Entity, Model, Relation } from '@/model';

export interface VisibleNode {
  id: string;
  parent: string | null;
  depth: number;
  /** Visible children, in sibling order (only when expanded). */
  children: string[];
  /** Has (non-feature) children in the model. */
  isContainer: boolean;
  expanded: boolean;
  /** Children hidden by the detail dial (expanded containers only). */
  hiddenCount: number;
  /** An outside thing shown as a faded stub while a container is focused. */
  stub?: boolean;
}

export interface VisibleTree {
  root: string;
  nodes: Map<string, VisibleNode>;
  /** Depth-first order (parents before children). */
  order: string[];
  /** Stub ids (focus mode only). */
  stubs: string[];
}

export interface VisibilityOptions {
  root: string;
  expanded: ReadonlySet<string>;
  detail: DetailLevel;
  /** Entities that must pass the detail filter (selection, reveals, lens) — ancestors are added automatically. */
  forced: Iterable<string>;
  /** Containers whose detail-hidden children are revealed ("+N more"). */
  revealAll: ReadonlySet<string>;
  /** Focus mode: the root is always expanded. */
  focus: boolean;
}

export const isMapEntity = (e: Entity | undefined): e is Entity => !!e && e.kind !== 'feature';

export function mapChildren(model: Model, id: string): Entity[] {
  return model.children(id).filter(isMapEntity);
}

export function isContainer(model: Model, id: string): boolean {
  return mapChildren(model, id).length > 0;
}

/** The forced set plus every ancestor of each member. */
export function withAncestors(model: Model, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!model.has(id)) continue;
    out.add(id);
    for (const a of model.ancestorIds(id)) out.add(a);
  }
  return out;
}

export function childPasses(model: Model, child: Entity, detail: DetailLevel, forced: ReadonlySet<string>): boolean {
  return model.detailOf(child) <= detail || child.confidence === 'hypothetical' || forced.has(child.id);
}

export function computeVisible(model: Model, opts: VisibilityOptions): VisibleTree {
  const forced = withAncestors(model, opts.forced);
  const nodes = new Map<string, VisibleNode>();
  const order: string[] = [];
  const walk = (id: string, parent: string | null, depth: number) => {
    const kids = mapChildren(model, id);
    const container = kids.length > 0;
    const expanded = container && (opts.expanded.has(id) || (opts.focus && depth === 0));
    const node: VisibleNode = {
      id,
      parent,
      depth,
      children: [],
      isContainer: container,
      expanded,
      hiddenCount: 0,
    };
    nodes.set(id, node);
    order.push(id);
    if (!expanded) return;
    const reveal = opts.revealAll.has(id);
    for (const k of kids) {
      if (reveal || childPasses(model, k, opts.detail, forced)) {
        node.children.push(k.id);
        walk(k.id, id, depth + 1);
      } else node.hiddenCount++;
    }
  };
  if (model.has(opts.root)) walk(opts.root, null, 0);
  return { root: opts.root, nodes, order, stubs: [] };
}

/**
 * For a focused container, the outside things it connects to, each lifted to
 * the child of the lowest common ancestor that contains it (so a focused
 * subsystem shows "SQLite Database" or a sibling subsystem, not individual
 * functions elsewhere).
 */
export function focusStubs(model: Model, focus: string, relationOk: (r: Relation) => boolean, max = 12): string[] {
  const inside = new Set([focus, ...model.descendants(focus).map((d) => d.id)]);
  const focusChain = new Set([...model.ancestorIds(focus), focus]);
  const counts = new Map<string, number>();
  for (const r of model.relations) {
    const fin = inside.has(r.from);
    const tin = inside.has(r.to);
    if (fin === tin) continue;
    if (!relationOk(r)) continue;
    const other = fin ? r.to : r.from;
    const otherEntity = model.entity(other);
    if (!isMapEntity(otherEntity)) continue;
    const path = model.path(other).map((e) => e.id);
    // Lowest common ancestor = deepest member of path that is also on the focus chain.
    let lcaIndex = -1;
    for (let i = 0; i < path.length; i++) if (focusChain.has(path[i])) lcaIndex = i;
    const stub = path[lcaIndex + 1];
    if (!stub || focusChain.has(stub)) continue;
    counts.set(stub, (counts.get(stub) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id]) => id)
    .sort((a, b) => siblingKey(model, a) - siblingKey(model, b) || a.localeCompare(b));
}

function siblingKey(model: Model, id: string): number {
  const e = model.entity(id);
  const depth = model.ancestorIds(id).length;
  return depth * 1e6 + (e?.layout?.row ?? 50) * 1000 + (e?.layout?.order ?? e?.order ?? 500);
}

export function addStubs(tree: VisibleTree, stubs: string[]): VisibleTree {
  const nodes = new Map(tree.nodes);
  const add = stubs.filter((s) => !nodes.has(s));
  for (const s of add)
    nodes.set(s, {
      id: s,
      parent: null,
      depth: 0,
      children: [],
      isContainer: false,
      expanded: false,
      hiddenCount: 0,
      stub: true,
    });
  return { ...tree, nodes, order: [...tree.order, ...add], stubs: add };
}

/**
 * Isolate a neighbourhood: keep only `keep` (selection + neighbours, plus the
 * selection's visible contents) and their ancestor containers.
 */
export function isolateTree(tree: VisibleTree, keep: ReadonlySet<string>): VisibleTree {
  const kept = new Set<string>();
  for (const id of keep) {
    let cur: string | null | undefined = id;
    while (cur && tree.nodes.has(cur) && !kept.has(cur)) {
      kept.add(cur);
      cur = tree.nodes.get(cur)!.parent;
    }
  }
  kept.add(tree.root);
  const nodes = new Map<string, VisibleNode>();
  for (const id of tree.order) {
    if (!kept.has(id)) continue;
    const n = tree.nodes.get(id)!;
    nodes.set(id, {
      ...n,
      children: n.children.filter((c) => kept.has(c)),
      hiddenCount: 0,
    });
  }
  return {
    ...tree,
    nodes,
    order: tree.order.filter((id) => kept.has(id)),
    stubs: tree.stubs.filter((s) => kept.has(s)),
  };
}

/** Visible descendants of a node (inclusive). */
export function visibleSubtree(tree: VisibleTree, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    const n = tree.nodes.get(x);
    if (!n) return;
    out.push(x);
    n.children.forEach(walk);
  };
  walk(id);
  return out;
}
