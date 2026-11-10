/**
 * Derives everything the Atlas draws from shared + local state: the visible
 * tree, the target layout, the lifted edges (all channels, for the filter
 * counts, and the drawn subset), the label plan and the node data objects.
 * Every step is memoised on its real inputs, so hover/zoom never recompute it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUDIENCES, channelOf, type AudienceId, type Entity, type LiftedEdge, type Model, type RelationChannel } from '@/model';
import { useApp } from '@/state/app';
import type { AtlasNodeData } from './AtlasNode';
import { placeLabels, routeEdges, toSpec, type EdgeSpec } from './edges';
import type { Rect } from './layout';
import { layoutScene } from './scene';
import { useAtlasLocal } from './store';
import { neighbourhood } from './emphasis';
import { addStubs, computeVisible, focusStubs, isContainer, isolateTree, mapChildren, visibleSubtree, type VisibleTree } from './visibility';

export interface Scene {
  tree: VisibleTree;
  /** Root of the layout (the focused container, or the system). */
  root: string;
  focus: string | null;
  rects: Map<string, Rect>;
  /** Drawn edges. */
  specs: EdgeSpec[];
  /** Edge counts per channel for the current visible set (drawn or not). */
  channelCounts: Record<RelationChannel, number>;
  /** Lifted edges exist but every one is filtered out by channel. */
  allFiltered: boolean;
  labelOk: Set<string>;
  nodeData: Map<string, AtlasNodeData>;
  selectedOnMap: string | null;
  lensIds: Set<string> | null;
  isolating: boolean;
}

const ZERO: Record<RelationChannel, number> = { http: 0, realtime: 0, call: 0, data: 0, type: 0, security: 0, ops: 0, structure: 0 };

function emphasised(e: Entity, audience: AudienceId): boolean {
  const preset = AUDIENCES.find((a) => a.id === audience);
  if (!preset) return false;
  if (preset.emphasis.kinds?.includes(e.kind)) return true;
  return !!preset.emphasis.tags?.some((t) => e.tags?.includes(t));
}

export function useScene(model: Model): Scene {
  const atlas = useApp((s) => s.atlas);
  const detail = useApp((s) => s.detail);
  const audience = useApp((s) => s.audience);
  const selection = useApp((s) => s.selection);
  const revealAll = useAtlasLocal((s) => s.revealAll);
  const pinned = useAtlasLocal((s) => s.pinned);

  const selectedEntity = selection?.type === 'entity' && model.has(selection.id) ? selection.id : null;
  const focus = atlas.focus && model.has(atlas.focus) && isContainer(model, atlas.focus) ? atlas.focus : null;
  const root = focus ?? model.root;
  const channels = atlas.channels;

  const lensIds = useMemo(() => {
    if (!atlas.lens || !model.has(atlas.lens)) return null;
    return new Set(model.implementersOf(atlas.lens).filter((e) => e.kind !== 'feature').map((e) => e.id));
  }, [atlas.lens, model]);

  // 1. Visible tree (before isolation).
  const baseTree = useMemo(() => {
    const forced = [...pinned, ...(selectedEntity ? [selectedEntity] : []), ...(lensIds ?? [])];
    let tree = computeVisible(model, { root, expanded: new Set(atlas.expanded), detail, forced, revealAll: new Set(revealAll), focus: !!focus });
    if (focus) {
      const chans = new Set(channels);
      tree = addStubs(tree, focusStubs(model, focus, (r) => chans.has(channelOf(r.kind))));
    }
    return tree;
  }, [model, root, atlas.expanded, detail, revealAll, pinned, selectedEntity, lensIds, focus, channels]);

  // 2. Lifted edges for every channel; the drawn subset depends on the filter.
  const lifted = useMemo(() => {
    let all: LiftedEdge[] = model.liftRelations(new Set(baseTree.order));
    if (focus) {
      const inside = new Set(visibleSubtree(baseTree, focus));
      all = all.filter((e) => inside.has(e.a) || inside.has(e.b));
    }
    return all;
  }, [model, baseTree, focus]);

  const channelCounts = useMemo(() => {
    const c = { ...ZERO };
    for (const e of lifted) c[e.channel]++;
    return c;
  }, [lifted]);

  const baseSpecs = useMemo(() => {
    const on = new Set(channels);
    return lifted.filter((e) => on.has(e.channel)).map(toSpec);
  }, [lifted, channels]);

  // 3. Neighbourhood isolation.
  const isolating = atlas.isolate && !!selectedEntity && baseTree.nodes.has(selectedEntity);
  const { tree, specs } = useMemo(() => {
    if (!isolating || !selectedEntity) return { tree: baseTree, specs: baseSpecs };
    const { inside, neighbours } = neighbourhood(baseTree, baseSpecs, selectedEntity);
    const t = isolateTree(baseTree, new Set([...inside, ...neighbours]));
    return { tree: t, specs: baseSpecs.filter((e) => t.nodes.has(e.a) && t.nodes.has(e.b)) };
  }, [isolating, selectedEntity, baseTree, baseSpecs]);

  // 4. Layout + label plan (target geometry, not the animated one).
  const rects = useMemo(() => layoutScene(model, tree), [model, tree]);
  const labelOk = useMemo(() => {
    const geoms = routeEdges(specs, rects);
    const leaves: Rect[] = [];
    for (const [id, r] of rects) {
      const n = tree.nodes.get(id);
      if (n && !n.expanded) leaves.push(r);
      else if (n) leaves.push({ x: r.x, y: r.y, w: r.w, h: 44 });
    }
    return placeLabels(specs, geoms, leaves);
  }, [specs, rects, tree]);

  // 5. Node data (stable per structural change; independent of geometry).
  const nodeData = useMemo(() => {
    const out = new Map<string, AtlasNodeData>();
    for (const id of tree.order) {
      const n = tree.nodes.get(id)!;
      const e = model.entity(id);
      if (!e) continue;
      out.set(id, {
        id,
        name: e.name,
        kind: e.kind,
        summary: model.summaryFor(e, audience),
        tech: e.tech ?? [],
        childCount: mapChildren(model, id).length,
        hiddenCount: n.hiddenCount,
        visibleChildren: n.children.length,
        isContainer: n.isContainer,
        expanded: n.expanded,
        depth: n.stub ? 1 : n.depth,
        isRoot: id === model.root,
        isFocusRoot: !!focus && id === focus,
        stub: !!n.stub,
        confidence: model.confidenceOf(e),
        removal: model.isProposedRemoval(id),
        modified: model.modificationsFor(id).filter((m) => m.op !== 'remove').length,
        emphasis: emphasised(e, audience),
        featureCount: model.outgoing(id).filter((r) => r.kind === 'implements').length,
        detail,
      });
    }
    return out;
  }, [tree, model, audience, focus, detail]);

  // Keep things the user navigated to on the map even if the dial would hide them.
  useEffect(() => {
    if (!selectedEntity) return;
    const e = model.entity(selectedEntity);
    if (!e || model.detailOf(e) <= detail) return;
    const local = useAtlasLocal.getState();
    if (!local.pinned.includes(selectedEntity)) local.set({ pinned: [...local.pinned.slice(-40), selectedEntity] });
  }, [selectedEntity, model, detail]);

  return {
    tree,
    root,
    focus,
    rects,
    specs,
    channelCounts,
    allFiltered: lifted.length > 0 && baseSpecs.length === 0,
    labelOk,
    nodeData,
    selectedOnMap: selectedEntity && tree.nodes.has(selectedEntity) ? selectedEntity : null,
    lensIds,
    isolating,
  };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Animate from the previously displayed rects to new targets (≈200 ms, ease-out). */
export function useTweenedRects(target: Map<string, Rect>, duration = 200): Map<string, Rect> {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    const reduce = prefersReducedMotion();
    const moving = [...target.keys()].some((id) => {
      const a = from.get(id);
      const b = target.get(id)!;
      return a && (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h);
    });
    if (reduce || !moving) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = easeOut(t);
      const next = new Map<string, Rect>();
      for (const [id, b] of target) {
        const a = from.get(id);
        next.set(id, a && t < 1 ? lerpRect(a, b, k) : b);
      }
      const value = t < 1 ? next : target;
      shownRef.current = value;
      setShown(value);
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}
