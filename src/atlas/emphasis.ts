/**
 * Presentation effects for the Atlas — which nodes and edges are emphasised or
 * faded by "Highlight dependencies", "Spotlight" and the feature lens. Pure.
 */
import type { EdgeSpec } from './edges';
import type { EdgeFx, NodeFx } from './store';
import { visibleSubtree, type VisibleTree } from './visibility';

export interface EmphasisInput {
  tree: VisibleTree;
  edges: readonly EdgeSpec[];
  /** Selected entity id when it is on the map. */
  selected: string | null;
  highlight: boolean;
  spotlight: boolean;
  /** Implementers of the lens feature (any depth; mapped to visible representatives). */
  lens: ReadonlySet<string> | null;
  /** Map an entity id to its nearest visible ancestor-or-self. */
  representative: (id: string) => string | undefined;
}

export interface Emphasis {
  nodeFx: Map<string, NodeFx>;
  edgeFx: Map<string, EdgeFx>;
}

function ancestorsInTree(tree: VisibleTree, id: string): string[] {
  const out: string[] = [];
  let cur = tree.nodes.get(id)?.parent;
  while (cur) {
    out.push(cur);
    cur = tree.nodes.get(cur)?.parent ?? null;
  }
  return out;
}

/** Neighbours of a node (and everything visible inside it) along the drawn edges. */
export function neighbourhood(tree: VisibleTree, edges: readonly EdgeSpec[], id: string): { inside: Set<string>; neighbours: Set<string>; incident: Set<string> } {
  const inside = new Set(visibleSubtree(tree, id));
  const neighbours = new Set<string>();
  const incident = new Set<string>();
  for (const e of edges) {
    const ai = inside.has(e.a);
    const bi = inside.has(e.b);
    if (ai === bi) continue;
    incident.add(e.id);
    neighbours.add(ai ? e.b : e.a);
  }
  return { inside, neighbours, incident };
}

export function computeEmphasis(input: EmphasisInput): Emphasis {
  const { tree, edges, selected } = input;
  const nodeFx = new Map<string, NodeFx>();
  const edgeFx = new Map<string, EdgeFx>();
  const all = tree.order;

  if (selected && tree.nodes.has(selected) && input.spotlight) {
    const keep = new Set(visibleSubtree(tree, selected));
    for (const id of all) nodeFx.set(id, keep.has(id) ? (id === selected ? 'focus' : undefined) : 'dim');
    for (const e of edges) edgeFx.set(e.id, keep.has(e.a) && keep.has(e.b) ? undefined : 'dim');
    return { nodeFx, edgeFx };
  }

  if (selected && tree.nodes.has(selected) && input.highlight) {
    const { inside, neighbours, incident } = neighbourhood(tree, edges, selected);
    const context = new Set<string>();
    for (const n of [selected, ...neighbours]) for (const a of ancestorsInTree(tree, n)) context.add(a);
    for (const id of all) {
      if (id === selected || neighbours.has(id)) nodeFx.set(id, 'focus');
      else if (inside.has(id) || context.has(id)) nodeFx.set(id, undefined);
      else nodeFx.set(id, 'dim');
    }
    for (const e of edges) edgeFx.set(e.id, incident.has(e.id) ? 'focus' : 'dim');
    return { nodeFx, edgeFx };
  }

  if (input.lens) {
    const hits = new Set<string>();
    for (const id of input.lens) {
      const rep = input.representative(id);
      if (rep) hits.add(rep);
    }
    const containing = new Set<string>();
    for (const h of hits) for (const a of ancestorsInTree(tree, h)) containing.add(a);
    for (const id of all) {
      const n = tree.nodes.get(id)!;
      if (hits.has(id)) nodeFx.set(id, 'lens');
      else if (containing.has(id)) nodeFx.set(id, 'lens-in');
      else nodeFx.set(id, n.expanded ? undefined : 'dim');
    }
    for (const e of edges) edgeFx.set(e.id, hits.has(e.a) || hits.has(e.b) ? undefined : 'dim');
  }
  return { nodeFx, edgeFx };
}

/** How many lens implementers are actually on the map (as themselves). */
export function lensVisibleCount(tree: VisibleTree, lens: ReadonlySet<string>): number {
  let n = 0;
  for (const id of lens) if (tree.nodes.has(id)) n++;
  return n;
}
