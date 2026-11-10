/**
 * The queryable Meridian model: one object built from the baseline slices plus
 * any active hypothetical layers. Pure logic, no React — every mode and the
 * search index read through this API.
 */
import type {
  AudienceId,
  Confidence,
  Contract,
  DetailLevel,
  Entity,
  EntityKind,
  GlossaryTerm,
  HypotheticalLayer,
  HypotheticalModification,
  ModelSlice,
  Relation,
  RelationChannel,
  RelationKind,
  Scenario,
  SourceRef,
  StateMachine,
} from './types';
import { REPO } from './data/core';

// ---------------------------------------------------------------------------
// Static tables
// ---------------------------------------------------------------------------

const KIND_DETAIL: Record<EntityKind, DetailLevel> = {
  system: 1,
  app: 1,
  feature: 1,
  datastore: 2,
  subsystem: 2,
  role: 2,
  package: 3,
  module: 3,
  'route-group': 3,
  endpoint: 3,
  'db-model': 3,
  event: 3,
  page: 3,
  external: 3,
  infra: 3,
  function: 4,
  class: 4,
  type: 4,
  constant: 4,
  component: 4,
  test: 5,
  doc: 5,
};

export const KIND_LABEL: Record<EntityKind, string> = {
  system: 'System',
  app: 'Application',
  package: 'Library',
  datastore: 'Database',
  subsystem: 'Subsystem',
  module: 'Module',
  'route-group': 'Route group',
  endpoint: 'Endpoint',
  function: 'Function',
  class: 'Class',
  type: 'Type',
  constant: 'Constant',
  'db-model': 'Table',
  event: 'Event',
  page: 'Page',
  component: 'Component',
  feature: 'Feature',
  role: 'Role',
  external: 'External',
  infra: 'Infrastructure',
  test: 'Test',
  doc: 'Document',
};

const CHANNEL_OF: Record<RelationKind, RelationChannel> = {
  http: 'http',
  websocket: 'realtime',
  emits: 'realtime',
  subscribes: 'realtime',
  calls: 'call',
  handles: 'call',
  renders: 'call',
  navigates: 'call',
  triggers: 'call',
  implements: 'structure',
  extends: 'type',
  reads: 'data',
  writes: 'data',
  references: 'data',
  imports: 'type',
  'uses-type': 'type',
  validates: 'type',
  guards: 'security',
  tests: 'structure',
  documents: 'structure',
  deploys: 'ops',
  proxies: 'ops',
  'actor-uses': 'ops',
};

export const CHANNELS: { id: RelationChannel; label: string; description: string }[] = [
  { id: 'http', label: 'HTTP', description: 'Requests from a client to an API endpoint' },
  { id: 'realtime', label: 'Real-time', description: 'Socket.IO connections and events' },
  { id: 'call', label: 'Calls', description: 'One piece of code invoking another' },
  { id: 'data', label: 'Data', description: 'Database reads, writes and foreign keys' },
  { id: 'type', label: 'Types & validation', description: 'Shared types, validators and imports' },
  { id: 'security', label: 'Security', description: 'Guards and access checks' },
  { id: 'ops', label: 'People & delivery', description: 'Who uses what; deployment and proxying' },
  { id: 'structure', label: 'Tests & features', description: 'Tests, documentation and feature mapping' },
];

export const RELATION_VERB: Record<RelationKind, string> = {
  http: 'calls over HTTP',
  websocket: 'connects by socket to',
  emits: 'emits',
  subscribes: 'listens for',
  calls: 'calls',
  handles: 'handles',
  renders: 'renders',
  navigates: 'navigates to',
  triggers: 'triggers',
  implements: 'implements',
  extends: 'extends',
  reads: 'reads',
  writes: 'writes',
  references: 'references',
  imports: 'imports',
  'uses-type': 'uses',
  validates: 'validates',
  guards: 'guards',
  tests: 'tests',
  documents: 'documents',
  deploys: 'deploys',
  proxies: 'proxies to',
  'actor-uses': 'uses',
};

export const channelOf = (kind: RelationKind): RelationChannel => CHANNEL_OF[kind];

/** GitHub permalink for a source reference at the pinned commit. */
export function githubUrl(ref: SourceRef): string {
  const anchor = ref.start ? `#L${ref.start}${ref.end && ref.end !== ref.start ? `-L${ref.end}` : ''}` : '';
  return `${REPO.url}/blob/${REPO.sha}/${ref.file}${anchor}`;
}

export function sourceLabel(ref: SourceRef): string {
  const name = ref.file.split('/').slice(-2).join('/');
  return ref.start ? `${name}:${ref.start}${ref.end && ref.end !== ref.start ? `–${ref.end}` : ''}` : name;
}

export const snippetKey = (ref: SourceRef): string => `${ref.file}:${ref.start ?? 0}-${ref.end ?? 0}`;

// ---------------------------------------------------------------------------
// Aggregated ("lifted") edges
// ---------------------------------------------------------------------------

/** All relations between two visible nodes on one channel, drawn as one edge. */
export interface LiftedEdge {
  id: string;
  /** Visible node ids. `a` → `b` is the direction of the first relation seen. */
  a: string;
  b: string;
  channel: RelationChannel;
  /** Underlying relations running a → b and b → a. */
  forward: Relation[];
  backward: Relation[];
  /** A curated relation defined exactly between a and b, if one exists. */
  headline?: Relation;
  hypothetical: boolean;
}

export interface ImpactItem {
  entity: Entity;
  /** Hops from the changed entity (1 = direct dependent). */
  distance: number;
  /** The relation that makes it depend on the previous hop. */
  via: Relation;
  /** Direct, repository-verified relations are `verified`; transitive ones `inferred`. */
  confidence: Confidence;
  /** Entity ids from the changed entity to this one. */
  path: string[];
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const ROOT_ID = 'meridian';

export class Model {
  readonly root = ROOT_ID;
  readonly entities = new Map<string, Entity>();
  readonly relations: Relation[] = [];
  readonly contracts = new Map<string, Contract>();
  readonly scenarios: Scenario[] = [];
  readonly stateMachines: StateMachine[] = [];
  readonly glossary: GlossaryTerm[] = [];
  readonly modifications: HypotheticalModification[] = [];
  /** Relations dropped because an endpoint id did not resolve. */
  readonly dangling: Relation[] = [];

  private childIndex = new Map<string, string[]>();
  private outIndex = new Map<string, Relation[]>();
  private inIndex = new Map<string, Relation[]>();
  private relationById = new Map<string, Relation>();
  private removed = new Set<string>();

  constructor(slices: ModelSlice[], layers: HypotheticalLayer[] = []) {
    for (const s of slices) {
      for (const e of s.entities ?? []) this.entities.set(e.id, e);
      for (const c of s.contracts ?? []) this.contracts.set(c.id, c);
      this.scenarios.push(...(s.scenarios ?? []));
      this.stateMachines.push(...(s.stateMachines ?? []));
      this.glossary.push(...(s.glossary ?? []));
    }
    for (const layer of layers) {
      for (const e of layer.entities) this.entities.set(e.id, { ...e, confidence: 'hypothetical' });
      for (const c of layer.contracts) this.contracts.set(c.id, { ...c, confidence: 'hypothetical' });
      this.scenarios.push(...layer.scenarios.map((s) => ({ ...s, confidence: 'hypothetical' as const })));
      for (const m of layer.modifications) {
        this.modifications.push(m);
        if (m.op === 'remove') this.removed.add(m.target);
      }
    }
    const allRelations = [
      ...slices.flatMap((s) => s.relations ?? []),
      ...layers.flatMap((l) => l.relations.map((r) => ({ ...r, confidence: 'hypothetical' as const }))),
    ];
    for (const r of allRelations) {
      if (!this.entities.has(r.from) || !this.entities.has(r.to) || r.from === r.to) {
        this.dangling.push(r);
        continue;
      }
      if (this.relationById.has(r.id)) continue;
      this.relations.push(r);
      this.relationById.set(r.id, r);
      push(this.outIndex, r.from, r);
      push(this.inIndex, r.to, r);
    }
    for (const e of this.entities.values()) {
      if (e.parent && this.entities.has(e.parent)) push(this.childIndex, e.parent, e.id);
    }
    for (const [parent, kids] of this.childIndex) {
      kids.sort((x, y) => this.siblingOrder(x) - this.siblingOrder(y) || this.entities.get(x)!.name.localeCompare(this.entities.get(y)!.name));
      this.childIndex.set(parent, kids);
    }
    this.glossary.sort((a, b) => a.term.localeCompare(b.term));
  }

  private siblingOrder(id: string): number {
    const e = this.entities.get(id)!;
    return (e.layout?.row ?? 50) * 1000 + (e.layout?.order ?? e.order ?? 500);
  }

  // ---- Entities & hierarchy -------------------------------------------------

  entity(id: string | null | undefined): Entity | undefined {
    return id ? this.entities.get(id) : undefined;
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  relation(id: string | null | undefined): Relation | undefined {
    return id ? this.relationById.get(id) : undefined;
  }

  children(id: string): Entity[] {
    return (this.childIndex.get(id) ?? []).map((c) => this.entities.get(c)!);
  }

  childIds(id: string): string[] {
    return this.childIndex.get(id) ?? [];
  }

  hasChildren(id: string): boolean {
    return (this.childIndex.get(id)?.length ?? 0) > 0;
  }

  parentOf(id: string): Entity | undefined {
    const p = this.entities.get(id)?.parent;
    return p ? this.entities.get(p) : undefined;
  }

  /** Root-first chain of ancestors (excluding the entity itself). */
  ancestors(id: string): Entity[] {
    const chain: Entity[] = [];
    const seen = new Set<string>();
    let cur = this.parentOf(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = this.parentOf(cur.id);
    }
    return chain;
  }

  ancestorIds(id: string): string[] {
    return this.ancestors(id).map((e) => e.id);
  }

  /** Breadcrumb path root → entity (inclusive). */
  path(id: string): Entity[] {
    const e = this.entities.get(id);
    return e ? [...this.ancestors(id), e] : [];
  }

  descendants(id: string): Entity[] {
    const out: Entity[] = [];
    const walk = (x: string) => {
      for (const c of this.childIds(x)) {
        out.push(this.entities.get(c)!);
        walk(c);
      }
    };
    walk(id);
    return out;
  }

  isWithin(id: string, ancestor: string): boolean {
    if (id === ancestor) return true;
    return this.ancestorIds(id).includes(ancestor);
  }

  /** The application / top-level container an entity belongs to. */
  appOf(id: string): Entity | undefined {
    const p = this.path(id);
    return p.find((e) => e.kind === 'app' || e.kind === 'package' || e.kind === 'datastore') ?? p[1] ?? p[0];
  }

  detailOf(e: Entity): DetailLevel {
    return e.detail ?? KIND_DETAIL[e.kind];
  }

  confidenceOf(x: { confidence?: Confidence }): Confidence {
    return x.confidence ?? 'verified';
  }

  isHypothetical(id: string): boolean {
    return this.entities.get(id)?.confidence === 'hypothetical';
  }

  isProposedRemoval(id: string): boolean {
    return this.removed.has(id);
  }

  modificationsFor(id: string): HypotheticalModification[] {
    return this.modifications.filter((m) => m.target === id);
  }

  features(): Entity[] {
    return [...this.entities.values()].filter((e) => e.kind === 'feature');
  }

  byKind(kind: EntityKind): Entity[] {
    return [...this.entities.values()].filter((e) => e.kind === kind);
  }

  summaryFor(e: Entity, audience: AudienceId): string {
    return e.audience?.[audience] ?? e.summary;
  }

  // ---- Relations ------------------------------------------------------------

  outgoing(id: string): Relation[] {
    return this.outIndex.get(id) ?? [];
  }

  incoming(id: string): Relation[] {
    return this.inIndex.get(id) ?? [];
  }

  /** Relations touching the entity itself. */
  relationsOf(id: string): Relation[] {
    return [...this.outgoing(id), ...this.incoming(id)];
  }

  /** Relations touching the entity or anything inside it, excluding purely internal ones. */
  relationsAcross(id: string): Relation[] {
    const inside = new Set([id, ...this.descendants(id).map((d) => d.id)]);
    return this.relations.filter((r) => inside.has(r.from) !== inside.has(r.to));
  }

  /** Relations wholly inside a container. */
  relationsWithin(id: string): Relation[] {
    const inside = new Set([id, ...this.descendants(id).map((d) => d.id)]);
    return this.relations.filter((r) => inside.has(r.from) && inside.has(r.to));
  }

  /** Direct neighbours (other end of every relation touching the entity). */
  neighbors(id: string): string[] {
    const out = new Set<string>();
    for (const r of this.relationsOf(id)) out.add(r.from === id ? r.to : r.from);
    return [...out];
  }

  /** The deepest ancestor-or-self of `id` that is in `visible`. */
  visibleRepresentative(id: string, visible: ReadonlySet<string>): string | undefined {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (visible.has(cur)) return cur;
      seen.add(cur);
      cur = this.entities.get(cur)?.parent;
    }
    return undefined;
  }

  /**
   * Aggregate every relation up to the nodes currently visible. A relation
   * between two functions shows as an edge between their modules when the
   * modules are collapsed, between their apps when those are, and so on.
   * `leaf` is the set of visible nodes that are NOT expanded (an expanded
   * container delegates its edges to its visible children).
   */
  liftRelations(visible: ReadonlySet<string>, channels?: ReadonlySet<RelationChannel>): LiftedEdge[] {
    const groups = new Map<string, LiftedEdge>();
    for (const r of this.relations) {
      const channel = channelOf(r.kind);
      if (channels && !channels.has(channel)) continue;
      const a = this.visibleRepresentative(r.from, visible);
      const b = this.visibleRepresentative(r.to, visible);
      if (!a || !b || a === b) continue;
      // An edge between a container and something inside it is containment noise.
      if (this.isWithin(a, b) || this.isWithin(b, a)) continue;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = `${lo}|${hi}|${channel}`;
      let g = groups.get(key);
      if (!g) {
        g = { id: `edge:${key}`, a, b, channel, forward: [], backward: [], hypothetical: true };
        groups.set(key, g);
      }
      if (a === g.a) g.forward.push(r);
      else g.backward.push(r);
      if (r.confidence !== 'hypothetical') g.hypothetical = false;
      if ((r.from === g.a && r.to === g.b) || (r.from === g.b && r.to === g.a)) {
        if (!g.headline || (r.detail ?? 9) < (g.headline.detail ?? 9)) g.headline = r;
      }
    }
    return [...groups.values()];
  }

  // ---- Contracts, scenarios, state machines ---------------------------------

  contract(id: string | null | undefined): Contract | undefined {
    return id ? this.contracts.get(id) : undefined;
  }

  /** Contracts for an endpoint, or for every endpoint inside a container. */
  contractsWithin(id: string): Contract[] {
    const own = this.contracts.get(id);
    if (own) return [own];
    return this.descendants(id)
      .map((d) => this.contracts.get(d.id))
      .filter((c): c is Contract => !!c);
  }

  /** Endpoints whose handler flow touches the entity. */
  contractsUsing(id: string): Contract[] {
    return [...this.contracts.values()].filter((c) => c.flow.some((f) => f.target === id) || c.calledBy?.includes(id));
  }

  scenario(id: string | null | undefined): Scenario | undefined {
    return id ? this.scenarios.find((s) => s.id === id) : undefined;
  }

  /**
   * Scenarios relevant to an entity, best match first: explicitly related,
   * then participating, then related to something inside / containing it.
   */
  scenariosFor(id: string): Scenario[] {
    const inside = new Set(this.descendants(id).map((d) => d.id));
    const above = new Set(this.ancestorIds(id));
    const scored: { s: Scenario; score: number }[] = [];
    for (const s of this.scenarios) {
      let score = 0;
      if (s.related.includes(id)) score = 100;
      else if (s.participants.includes(id)) score = 80;
      else if (s.steps.some((st) => st.from === id || st.to === id)) score = 70;
      else if (s.related.some((r) => inside.has(r))) score = 50;
      else if (s.participants.some((p) => inside.has(p))) score = 40;
      else if (s.related.some((r) => above.has(r) && this.entities.get(r)?.kind !== 'system' && this.entities.get(r)?.kind !== 'app')) score = 20;
      if (score) scored.push({ s, score });
    }
    return scored.sort((x, y) => y.score - x.score).map((x) => x.s);
  }

  stateMachinesFor(id: string): StateMachine[] {
    return this.stateMachines.filter((m) => m.subject === id || m.transitions.some((t) => t.by === id));
  }

  stateMachine(id: string): StateMachine | undefined {
    return this.stateMachines.find((m) => m.id === id);
  }

  /** Features an entity (or its ancestors) implements. */
  featuresOf(id: string): Entity[] {
    const ids = new Set<string>();
    for (const x of [id, ...this.ancestorIds(id)]) {
      for (const r of this.outgoing(x)) if (r.kind === 'implements') ids.add(r.to);
    }
    return [...ids].map((f) => this.entities.get(f)!).filter(Boolean);
  }

  /** Entities that implement a feature. */
  implementersOf(featureId: string): Entity[] {
    return this.incoming(featureId)
      .filter((r) => r.kind === 'implements')
      .map((r) => this.entities.get(r.from)!)
      .filter(Boolean);
  }

  // ---- Graph queries ---------------------------------------------------------

  /**
   * Who is affected if `id` changes: everything that depends on it, breadth
   * first. Direct dependents come from repository-verified relations; anything
   * further out is a transitive inference and labelled as such.
   */
  impactOf(id: string, maxDepth = 3): ImpactItem[] {
    const DEPENDS: RelationKind[] = ['calls', 'uses-type', 'validates', 'imports', 'http', 'reads', 'writes', 'tests', 'renders', 'subscribes', 'emits', 'guards', 'handles', 'extends', 'references'];
    const out: ImpactItem[] = [];
    const seen = new Set<string>([id]);
    let frontier: { id: string; path: string[] }[] = [{ id, path: [id] }];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const cur of frontier) {
        // Things inside the changed entity change with it.
        const targets = depth === 1 ? [cur.id, ...this.descendants(cur.id).map((d) => d.id)] : [cur.id];
        for (const t of targets) {
          for (const r of this.incoming(t)) {
            if (!DEPENDS.includes(r.kind)) continue;
            // `guards` and `emits` point from the dependency to the dependent's target; skip inverted semantics.
            if (seen.has(r.from)) continue;
            const e = this.entities.get(r.from);
            if (!e) continue;
            seen.add(r.from);
            const direct = depth === 1 && this.confidenceOf(r) === 'verified';
            out.push({ entity: e, distance: depth, via: r, confidence: r.confidence === 'hypothetical' ? 'hypothetical' : direct ? 'verified' : 'inferred', path: [...cur.path, r.from] });
            next.push({ id: r.from, path: [...cur.path, r.from] });
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /**
   * Shortest chain of relations connecting two entities (either direction).
   * Endpoints may be containers: anything inside them counts as the endpoint.
   */
  pathBetween(fromId: string, toId: string, maxDepth = 8): Relation[] | null {
    if (!this.has(fromId) || !this.has(toId)) return null;
    const starts = new Set([fromId, ...this.descendants(fromId).map((d) => d.id)]);
    const goals = new Set([toId, ...this.descendants(toId).map((d) => d.id)]);
    const prev = new Map<string, { node: string; rel: Relation } | null>();
    let frontier = [...starts];
    for (const s of frontier) prev.set(s, null);
    const SKIP: RelationKind[] = ['tests', 'documents', 'implements', 'actor-uses'];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const r of this.relationsOf(cur)) {
          if (SKIP.includes(r.kind)) continue;
          const other = r.from === cur ? r.to : r.from;
          if (prev.has(other)) continue;
          prev.set(other, { node: cur, rel: r });
          if (goals.has(other)) {
            const chain: Relation[] = [];
            let at: string = other;
            for (let step = prev.get(at); step; step = prev.get(at)) {
              chain.unshift(step.rel);
              at = step.node;
            }
            return chain;
          }
          next.push(other);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Every relation running directly between two (possibly container) entities. */
  relationsBetween(aId: string, bId: string): Relation[] {
    const a = new Set([aId, ...this.descendants(aId).map((d) => d.id)]);
    const b = new Set([bId, ...this.descendants(bId).map((d) => d.id)]);
    return this.relations.filter((r) => (a.has(r.from) && b.has(r.to)) || (b.has(r.from) && a.has(r.to)));
  }

  /** Counts used on overview screens and in docs. */
  stats() {
    const byConfidence: Record<Confidence, number> = { verified: 0, simplified: 0, inferred: 0, hypothetical: 0 };
    let sourceRefs = 0;
    for (const e of this.entities.values()) {
      byConfidence[this.confidenceOf(e)]++;
      sourceRefs += e.sources?.length ?? 0;
    }
    for (const r of this.relations) sourceRefs += r.sources?.length ?? 0;
    return {
      entities: this.entities.size,
      relations: this.relations.length,
      contracts: this.contracts.size,
      scenarios: this.scenarios.length,
      stateMachines: this.stateMachines.length,
      glossary: this.glossary.length,
      sourceRefs,
      byConfidence,
    };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
