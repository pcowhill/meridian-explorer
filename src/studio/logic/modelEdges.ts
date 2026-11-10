/**
 * How board edges relate to the Meridian model: which relations a line between
 * two entity nodes stands for, how it is labelled and coloured, and whether it
 * is a known fact, hypothetical, or drawn by the user with no basis in the model.
 */
import { CHANNELS, RELATION_VERB, channelOf, type LiftedEdge, type Model, type Relation, type RelationChannel } from '@/model';
import type { EdgeData, SEdge, SNode } from '../types';
import { absPos, indexNodes, nodeSize } from './geometry';

export type EdgeStatus = 'known' | 'hypothetical' | 'unverified' | 'free';

const pairCache = new WeakMap<Model, Map<string, Relation[]>>();

/** All relations directly between two entities (or anything inside them), cached per model. */
export function relationsForPair(model: Model, a: string, b: string): Relation[] {
  let cache = pairCache.get(model);
  if (!cache) {
    cache = new Map();
    pairCache.set(model, cache);
  }
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = model.has(a) && model.has(b) && a !== b ? model.relationsBetween(a, b) : [];
    cache.set(key, hit);
  }
  return hit;
}

/** Whether an edge between two nodes is backed by the model. */
export function edgeStatus(model: Model, a: string | undefined, b: string | undefined, data: EdgeData | undefined): EdgeStatus {
  if (!a || !b) return 'free';
  let rels = relationsForPair(model, a, b);
  if (data?.channel) {
    const onChannel = rels.filter((r) => channelOf(r.kind) === data.channel);
    if (onChannel.length) rels = onChannel;
  }
  if (!rels.length) return 'unverified';
  return rels.some((r) => r.confidence !== 'hypothetical') ? 'known' : 'hypothetical';
}

export const channelLabel = (c: RelationChannel): string => CHANNELS.find((x) => x.id === c)?.label ?? c;

/** A short label for a group of relations. */
export function describeRelations(rels: readonly Relation[], headline?: Relation): string {
  if (headline) return headline.label ?? RELATION_VERB[headline.kind];
  if (rels.length === 1) return rels[0].label ?? RELATION_VERB[rels[0].kind];
  const kinds = [...new Set(rels.map((r) => r.kind))];
  return `${kinds.slice(0, 2).join(' · ')}${kinds.length > 2 ? ' …' : ''} ×${rels.length}`;
}

/** The dominant channel of a set of relations (most relations; ties → declaration order). */
export function primaryChannel(rels: readonly Relation[]): RelationChannel | undefined {
  const count = new Map<RelationChannel, number>();
  for (const r of rels) count.set(channelOf(r.kind), (count.get(channelOf(r.kind)) ?? 0) + 1);
  let best: RelationChannel | undefined;
  let n = 0;
  for (const c of CHANNELS) {
    const k = count.get(c.id) ?? 0;
    if (k > n) {
      best = c.id;
      n = k;
    }
  }
  return best;
}

/**
 * Edge data for a line the user drew between two entities. Returns the
 * direction to use (true = keep source→target) and the data, or null when the
 * model has no relation between them.
 */
export function knownEdgeData(model: Model, a: string, b: string): { data: EdgeData; forward: boolean } | null {
  const all = relationsForPair(model, a, b);
  if (!all.length) return null;
  const meaningful = all.filter((r) => channelOf(r.kind) !== 'structure');
  const pool = meaningful.length ? meaningful : all;
  const channel = primaryChannel(pool)!;
  const rels = pool.filter((r) => channelOf(r.kind) === channel);
  const headline = rels.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  const fwd = rels.filter((r) => model.isWithin(r.from, a)).length;
  const back = rels.length - fwd;
  const hypothetical = rels.every((r) => r.confidence === 'hypothetical');
  return {
    forward: fwd >= back,
    data: {
      label: describeRelations(rels, headline),
      channel,
      relationIds: rels.map((r) => r.id),
      arrow: (fwd > 0 && back > 0) || headline?.bidirectional ? 'both' : 'end',
      strokeStyle: hypothetical ? 'dashed' : 'solid',
    },
  };
}

/** Every relation between two entities as one edge per channel (for "show all connections"). */
export function edgesPerChannel(model: Model, a: string, b: string): { data: EdgeData; forward: boolean }[] {
  const all = relationsForPair(model, a, b);
  const byChannel = new Map<RelationChannel, Relation[]>();
  for (const r of all) {
    const c = channelOf(r.kind);
    byChannel.set(c, [...(byChannel.get(c) ?? []), r]);
  }
  return [...byChannel.entries()].map(([channel, rels]) => {
    const headline = rels.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
    const fwd = rels.filter((r) => model.isWithin(r.from, a)).length;
    const back = rels.length - fwd;
    return {
      forward: fwd >= back,
      data: {
        label: describeRelations(rels, headline),
        channel,
        relationIds: rels.map((r) => r.id),
        arrow: fwd > 0 && back > 0 ? 'both' : 'end',
        strokeStyle: rels.every((r) => r.confidence === 'hypothetical') ? 'dashed' : 'solid',
      },
    };
  });
}

/** Lifted relations among the entities on a board, without test/doc/feature noise. */
export function liftedForBoard(model: Model, entityIds: ReadonlySet<string>): LiftedEdge[] {
  return model.liftRelations(entityIds).filter((l) => {
    if (l.channel !== 'structure') return true;
    return model.entity(l.a)?.kind === 'feature' || model.entity(l.b)?.kind === 'feature';
  });
}

export function edgeDataFromLifted(l: LiftedEdge): { data: EdgeData; source: string; target: string } {
  const rels = [...l.forward, ...l.backward];
  const forward = l.forward.length > 0;
  return {
    source: forward ? l.a : l.b,
    target: forward ? l.b : l.a,
    data: {
      label: describeRelations(rels, l.headline),
      channel: l.channel,
      relationIds: rels.map((r) => r.id),
      arrow: (l.forward.length > 0 && l.backward.length > 0) || l.headline?.bidirectional ? 'both' : 'end',
      strokeStyle: l.hypothetical ? 'dashed' : 'solid',
    },
  };
}

export const entityOf = (n: SNode | undefined): string | undefined => (n?.type === 'entity' ? (n.data as { entityId?: string }).entityId : undefined);

const pairKey = (s: string, t: string, channel: string | undefined) => `${s < t ? s : t}|${s < t ? t : s}|${channel ?? '*'}`;

let edgeSeq = 0;
export const newEdgeId = (): string => `e_${Date.now().toString(36)}${(edgeSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Known-relationship edges between the newly placed entity nodes and the
 * entities already on the board (aggregated per pair + channel, like the Atlas).
 * When an entity appears several times, the nearest instance is connected.
 */
export function autoConnect(model: Model, nodes: readonly SNode[], edges: readonly SEdge[], newNodeIds: ReadonlySet<string>): SEdge[] {
  const byId = indexNodes(nodes);
  const instances = new Map<string, SNode[]>();
  for (const n of nodes) {
    const e = entityOf(n);
    if (e && model.has(e) && !n.hidden) instances.set(e, [...(instances.get(e) ?? []), n]);
  }
  const newEntities = new Set([...newNodeIds].map((id) => entityOf(byId.get(id))).filter((x): x is string => !!x));
  if (!newEntities.size) return [];
  const existing = new Set(edges.map((e) => pairKey(e.source, e.target, e.data?.channel)));
  const centre = (n: SNode) => {
    const p = absPos(n, byId);
    const s = nodeSize(n);
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };
  const out: SEdge[] = [];
  for (const l of liftedForBoard(model, new Set(instances.keys()))) {
    if (!newEntities.has(l.a) && !newEntities.has(l.b)) continue;
    const { data, source, target } = edgeDataFromLifted(l);
    for (const [mine, other] of [
      [source, target],
      [target, source],
    ] as const) {
      for (const n of instances.get(mine) ?? []) {
        if (!newNodeIds.has(n.id)) continue;
        const c = centre(n);
        const candidates = (instances.get(other) ?? []).filter((m) => m.id !== n.id);
        if (!candidates.length) continue;
        const m = candidates.reduce((best, x) => {
          const cx = centre(x);
          const cb = centre(best);
          return Math.hypot(cx.x - c.x, cx.y - c.y) < Math.hypot(cb.x - c.x, cb.y - c.y) ? x : best;
        });
        const s = mine === source ? n.id : m.id;
        const t = mine === source ? m.id : n.id;
        const key = pairKey(s, t, data.channel);
        if (existing.has(key)) continue;
        existing.add(key);
        out.push({ id: newEdgeId(), source: s, target: t, type: 'studio', data: { ...data } });
      }
    }
  }
  return out;
}
