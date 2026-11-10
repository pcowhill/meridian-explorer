/**
 * Deterministic local search over the knowledge model (MiniSearch: an inverted
 * index with prefix + fuzzy matching). No network, no AI.
 */
import MiniSearch from 'minisearch';
import type { Entity } from './types';
import { KIND_LABEL, type Model } from './model';

export type SearchResultType = 'entity' | 'scenario' | 'term' | 'machine';

export interface SearchResult {
  /** Index document id (`entity:<id>`, `scenario:<id>`, …). */
  key: string;
  type: SearchResultType;
  /** The underlying id (entity id, scenario id, glossary term, state machine id). */
  id: string;
  title: string;
  subtitle: string;
  /** Display label for the kind, e.g. `Endpoint`, `Scenario`. */
  kind: string;
  score: number;
}

interface Doc {
  key: string;
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  aliases: string;
  tags: string;
  path: string;
  text: string;
}

/** Split on punctuation AND camelCase so `createTransfer` matches "transfer". */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9_]+/)) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    out.push(lower);
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .split(' ')
      .filter(Boolean);
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase());
  }
  return out;
}

export class SearchIndex {
  private mini: MiniSearch<Doc>;
  private docs = new Map<string, Doc>();

  constructor(model: Model) {
    this.mini = new MiniSearch<Doc>({
      idField: 'key',
      fields: ['title', 'aliases', 'tags', 'path', 'text', 'kind'],
      storeFields: ['key'],
      tokenize,
      searchOptions: {
        boost: { title: 5, aliases: 3, path: 2, tags: 1.5, kind: 1.2 },
        prefix: true,
        fuzzy: (term) => (term.length > 4 ? 0.2 : 0),
        combineWith: 'AND',
      },
    });

    const docs: Doc[] = [];
    for (const e of model.entities.values()) docs.push(entityDoc(model, e));
    for (const s of model.scenarios) {
      docs.push({
        key: `scenario:${s.id}`,
        type: 'scenario',
        id: s.id,
        title: s.title,
        subtitle: s.question,
        kind: s.confidence === 'hypothetical' ? 'Hypothetical scenario' : 'Scenario',
        aliases: s.question,
        tags: [s.category, ...(s.tags ?? [])].join(' '),
        path: '',
        text: `${s.summary} ${s.variants.map((v) => v.label).join(' ')}`,
      });
    }
    for (const g of model.glossary) {
      docs.push({
        key: `term:${g.term}`,
        type: 'term',
        id: g.term,
        title: g.term,
        subtitle: g.definition,
        kind: 'Glossary',
        aliases: (g.aliases ?? []).join(' '),
        tags: '',
        path: '',
        text: g.definition,
      });
    }
    for (const m of model.stateMachines) {
      docs.push({
        key: `machine:${m.id}`,
        type: 'machine',
        id: m.id,
        title: m.name,
        subtitle: m.summary,
        kind: 'State machine',
        aliases: m.field ?? '',
        tags: 'state lifecycle status',
        path: '',
        text: `${m.summary} ${m.states.map((s) => s.id).join(' ')}`,
      });
    }
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      this.docs.set(d.key, d);
    }
    this.mini.addAll([...this.docs.values()]);
  }

  search(query: string, limit = 30, filter?: (r: SearchResult) => boolean): SearchResult[] {
    const q = query.trim();
    if (!q) return [];
    let hits = this.mini.search(q);
    if (hits.length === 0) hits = this.mini.search(q, { combineWith: 'OR' });
    const out: SearchResult[] = [];
    for (const h of hits) {
      const d = this.docs.get(h.id as string);
      if (!d) continue;
      // An exact title match always wins.
      const exact = d.title.toLowerCase() === q.toLowerCase() ? 1000 : 0;
      const r: SearchResult = { key: d.key, type: d.type, id: d.id, title: d.title, subtitle: d.subtitle, kind: d.kind, score: h.score + exact };
      if (filter && !filter(r)) continue;
      out.push(r);
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  get size(): number {
    return this.docs.size;
  }
}

function entityDoc(model: Model, e: Entity): Doc {
  const contract = model.contract(e.id);
  const where = model
    .ancestors(e.id)
    .slice(1)
    .map((a) => a.name)
    .join(' › ');
  return {
    key: `entity:${e.id}`,
    type: 'entity',
    id: e.id,
    title: e.name,
    subtitle: where ? `${where} — ${e.summary}` : e.summary,
    kind: e.confidence === 'hypothetical' ? `Hypothetical ${KIND_LABEL[e.kind].toLowerCase()}` : KIND_LABEL[e.kind],
    aliases: [...(e.aliases ?? []), e.route ?? '', contract ? `${contract.method} ${contract.path}` : ''].join(' '),
    tags: [...(e.tags ?? []), ...(e.tech ?? [])].join(' '),
    path: [e.id, ...(e.sources ?? []).slice(0, 2).map((s) => s.file)].join(' '),
    text: [e.summary, e.signature ?? '', (e.fields ?? []).map((f) => f.name).join(' '), (e.values ?? []).map((v) => v.value).join(' '), contract?.summary ?? ''].join(' '),
  };
}
