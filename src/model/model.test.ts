import { describe, expect, it } from 'vitest';
import { AUDIENCES, baseModel, channelOf, getModel, githubUrl, REPO, snippetKey, type Entity, type SourceRef } from './index';
import { SLICES } from './data/index';
import { GUIDED_QUESTIONS } from './data/questions';
import { simpayLayer } from '../state/layers/simpay';
import snippets from './generated/snippets.json';

const m = baseModel;

describe('knowledge model integrity', () => {
  it('has substantial, source-grounded coverage', () => {
    const s = m.stats();
    expect(s.entities).toBeGreaterThan(800);
    expect(s.relations).toBeGreaterThan(1500);
    expect(s.contracts).toBeGreaterThanOrEqual(51);
    expect(s.scenarios).toBeGreaterThanOrEqual(12);
    expect(s.sourceRefs).toBeGreaterThan(2000);
    expect(s.byConfidence.hypothetical).toBe(0);
  });

  it('has unique entity ids across slices', () => {
    const seen = new Set<string>();
    for (const slice of Object.values(SLICES)) {
      for (const e of slice.entities ?? []) {
        expect(seen.has(e.id), `duplicate ${e.id}`).toBe(false);
        seen.add(e.id);
      }
    }
  });

  it('gives every entity a resolvable parent (except the system and features)', () => {
    for (const e of m.entities.values()) {
      if (e.kind === 'system' || e.kind === 'feature') continue;
      expect(e.parent, `${e.id} has no parent`).toBeTruthy();
      expect(m.has(e.parent!), `${e.id} → missing parent ${e.parent}`).toBe(true);
    }
  });

  it('has no containment cycles and everything hangs off the root', () => {
    for (const e of m.entities.values()) {
      if (e.kind === 'feature') continue;
      const path = m.path(e.id);
      expect(path[0].id).toBe('meridian');
      expect(new Set(path.map((p) => p.id)).size).toBe(path.length);
    }
  });

  it('dropped no relation for a missing endpoint', () => {
    expect(m.dangling.map((r) => r.id)).toEqual([]);
  });

  it('pairs every endpoint with a contract and every contract with an endpoint', () => {
    const endpoints = m.byKind('endpoint');
    expect(endpoints.length).toBe(m.contracts.size);
    for (const e of endpoints) {
      const c = m.contract(e.id);
      expect(c, `no contract for ${e.id}`).toBeDefined();
      expect(c!.id).toBe(`ep:${c!.method} ${c!.path}`);
      expect(c!.flow.length).toBeGreaterThan(0);
      expect(c!.responses.length).toBeGreaterThan(0);
      for (const f of c!.flow) if (f.target) expect(m.has(f.target), `${e.id} flow → ${f.target}`).toBe(true);
    }
  });

  it('cites a source for every non-feature, non-role entity', () => {
    const missing = [...m.entities.values()].filter((e) => !['feature', 'role'].includes(e.kind) && !(e.sources?.length));
    expect(missing.map((e) => e.id)).toEqual([]);
  });

  it('bundles an excerpt for every cited line range', () => {
    const keys = new Set(Object.keys(snippets as Record<string, unknown>));
    const missing: string[] = [];
    const check = (s: SourceRef | undefined) => {
      if (s?.start && s.end && !keys.has(snippetKey(s))) missing.push(snippetKey(s));
    };
    for (const e of m.entities.values()) e.sources?.forEach(check);
    for (const r of m.relations) r.sources?.forEach(check);
    for (const c of m.contracts.values()) {
      c.sources.forEach(check);
      c.flow.forEach((f) => check(f.source));
    }
    for (const s of m.scenarios) s.steps.forEach((st) => st.sources?.forEach(check));
    expect(missing.slice(0, 5)).toEqual([]);
  });

  it('resolves every scenario reference', () => {
    for (const s of m.scenarios) {
      const variants = new Set(s.variants.map((v) => v.id));
      expect(variants.has(s.defaultVariant)).toBe(true);
      for (const p of [...s.participants, ...s.related]) expect(m.has(p), `${s.id} → ${p}`).toBe(true);
      for (const st of s.steps) {
        expect(s.participants).toContain(st.from);
        expect(s.participants).toContain(st.to);
        for (const v of st.variants ?? []) expect(variants.has(v), `${s.id}/${st.id} variant ${v}`).toBe(true);
        for (const o of st.decision?.options ?? []) expect(variants.has(o.variant)).toBe(true);
      }
    }
  });

  it('prepares every guided question with real ids in all three modes', () => {
    expect(GUIDED_QUESTIONS).toHaveLength(8);
    for (const q of GUIDED_QUESTIONS) {
      expect(m.has(q.atlas.select), `${q.id} atlas.select ${q.atlas.select}`).toBe(true);
      for (const id of q.atlas.expand) expect(m.has(id), `${q.id} atlas.expand ${id}`).toBe(true);
      expect(m.scenario(q.theater.scenario), `${q.id} scenario ${q.theater.scenario}`).toBeDefined();
      for (const id of q.studio.entities) expect(m.has(id), `${q.id} studio ${id}`).toBe(true);
    }
  });

  it('links sources to the pinned commit', () => {
    const url = githubUrl({ file: 'apps/backend/src/server.ts', start: 34, end: 40 });
    expect(url).toBe(`${REPO.url}/blob/${REPO.sha}/apps/backend/src/server.ts#L34-L40`);
    expect(REPO.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('hierarchy', () => {
  it('opens Meridian into its three applications', () => {
    const apps = m.children('meridian').filter((e) => e.kind === 'app').map((e) => e.name);
    expect(apps).toEqual(expect.arrayContaining(['Customer Banking App', 'Operations Simulator', 'Backend API']));
  });

  it('orders children by layout row, then order', () => {
    const kids = m.children('meridian');
    const rows = kids.map((k) => k.layout?.row ?? 50);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('walks ancestors root-first and finds the owning app', () => {
    const id = 'be:money/movements#createTransfer';
    expect(m.ancestorIds(id)).toEqual(['meridian', 'backend', 'be.money', 'be:money/movements']);
    expect(m.appOf(id)?.id).toBe('backend');
    expect(m.isWithin(id, 'backend')).toBe(true);
    expect(m.isWithin(id, 'customer')).toBe(false);
    expect(m.descendants('be.money').some((d) => d.id === id)).toBe(true);
  });

  it('derives a default detail level from the kind', () => {
    expect(m.detailOf(m.entity('meridian')!)).toBe(1);
    expect(m.detailOf(m.entity('backend')!)).toBe(1);
    expect(m.detailOf(m.entity('be.money')!)).toBe(2);
    expect(m.detailOf(m.entity('be:money/movements#summarize')!)).toBe(4);
    // Authors may promote an important symbol.
    expect(m.detailOf(m.entity('be:money/movements#createTransfer')!)).toBeLessThanOrEqual(4);
  });

  it('rewords summaries per audience and falls back to the default', () => {
    const backend = m.entity('backend')!;
    expect(m.summaryFor(backend, 'executive')).not.toBe(backend.summary);
    expect(m.summaryFor(m.entity('be.money')!, 'executive')).toBe(m.entity('be.money')!.summary);
  });
});

describe('relations', () => {
  it('maps every relation kind to a channel', () => {
    for (const r of m.relations) expect(channelOf(r.kind)).toBeTruthy();
  });

  it('aggregates fine-grained relations up to the visible nodes', () => {
    const visible = new Set(['meridian', ...m.childIds('meridian')]);
    const edges = m.liftRelations(visible);
    const http = edges.find((e) => e.channel === 'http' && [e.a, e.b].includes('customer') && [e.a, e.b].includes('backend'));
    expect(http).toBeDefined();
    expect(http!.forward.length + http!.backward.length).toBeGreaterThan(20);
    expect(http!.headline?.id).toBe('rel:customer->backend:http');
    // Real-time is operations ↔ backend only: the customer app opens no socket.
    const rt = edges.filter((e) => e.channel === 'realtime');
    expect(rt.some((e) => [e.a, e.b].includes('operations') && [e.a, e.b].includes('backend'))).toBe(true);
    expect(rt.some((e) => [e.a, e.b].includes('customer'))).toBe(false);
    // No edge joins a container to something inside it.
    for (const e of edges) expect(m.isWithin(e.a, e.b) || m.isWithin(e.b, e.a)).toBe(false);
  });

  it('refines aggregated edges when a container is expanded', () => {
    const collapsed = new Set(['meridian', ...m.childIds('meridian')]);
    const expanded = new Set([...collapsed, ...m.childIds('backend')]);
    const before = m.liftRelations(collapsed).filter((e) => e.a === 'backend' || e.b === 'backend').length;
    const after = m.liftRelations(expanded).filter((e) => m.isWithin(e.a, 'backend') || m.isWithin(e.b, 'backend')).length;
    expect(after).toBeGreaterThan(before);
  });

  it('filters aggregated edges by channel', () => {
    const visible = new Set(['meridian', ...m.childIds('meridian')]);
    const only = m.liftRelations(visible, new Set(['data']));
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((e) => e.channel === 'data')).toBe(true);
  });

  it('finds what a change would affect, direct dependents first', () => {
    const impact = m.impactOf('sh:ledger#deriveBalances', 2);
    expect(impact.length).toBeGreaterThan(3);
    expect(impact[0].distance).toBe(1);
    expect(impact.filter((i) => i.distance === 1).every((i) => i.confidence !== 'inferred' || i.via.confidence !== undefined)).toBe(true);
    expect(impact.filter((i) => i.distance === 2).every((i) => i.confidence === 'inferred')).toBe(true);
    expect(impact.some((i) => i.entity.id.startsWith('be:money/movements'))).toBe(true);
  });

  it('finds a chain of relations between two components', () => {
    const chain = m.pathBetween('cu:pages/MoveMoney', 'db:LedgerEntry');
    expect(chain).not.toBeNull();
    expect(chain!.length).toBeGreaterThanOrEqual(2);
    expect(m.pathBetween('meridian', 'nope')).toBeNull();
  });

  it('offers the relevant scenario for a component', () => {
    expect(m.scenariosFor('be:money/movements#createTransfer').map((s) => s.id)).toContain('transfer');
    expect(m.scenariosFor('be.money').length).toBeGreaterThan(0);
    expect(m.scenariosFor('ep:POST /api/ops/requests/:id/action').map((s) => s.id)).toContain('ops-approval');
  });

  it('maps features to what implements them', () => {
    expect(m.features().length).toBeGreaterThan(20);
    expect(m.implementersOf('feat:transfers').length).toBeGreaterThan(0);
    expect(m.featuresOf('be:money/movements#createTransfer').map((f) => f.id)).toContain('feat:transfers');
  });
});

describe('hypothetical layers', () => {
  const withLayer = getModel([simpayLayer]);

  it('overlays proposed entities without touching the baseline', () => {
    expect(baseModel.has('hypo:simpay')).toBe(false);
    expect(withLayer.has('hypo:simpay')).toBe(true);
    expect(withLayer.entities.size).toBe(baseModel.entities.size + simpayLayer.entities.length);
    expect(withLayer.dangling).toEqual([]);
    // A baseline entity is the same object in both models.
    expect(withLayer.entity('backend')).toBe(baseModel.entity('backend'));
  });

  it('forces everything from a layer to be hypothetical', () => {
    for (const e of simpayLayer.entities) expect(withLayer.isHypothetical(e.id)).toBe(true);
    for (const r of simpayLayer.relations) expect(withLayer.relation(r.id)?.confidence).toBe('hypothetical');
    expect(withLayer.contract('ep:POST /api/partner/movements')?.confidence).toBe('hypothetical');
    expect(withLayer.scenario('simpay-payment')?.confidence).toBe('hypothetical');
    expect((withLayer.entity('be:money/movements#createExternalMovement') as Entity).confidence).not.toBe('hypothetical');
  });

  it('records proposed changes against baseline entities', () => {
    expect(withLayer.modificationsFor('sh:money-movement#ExternalMovementRequest')[0].field?.name).toBe('externalReference');
    expect(baseModel.modificationsFor('sh:money-movement#ExternalMovementRequest')).toEqual([]);
    const removal = getModel([{ ...simpayLayer, id: 'x', updatedAt: 'now', modifications: [{ id: 'm', target: 'be.seed', op: 'remove', summary: 'drop' }] }]);
    expect(removal.isProposedRemoval('be.seed')).toBe(true);
  });

  it('shows the hypothetical edge to existing code in aggregated edges', () => {
    const visible = new Set(['meridian', ...withLayer.childIds('meridian'), ...withLayer.childIds('boundary:external')]);
    const edge = withLayer.liftRelations(visible).find((e) => [e.a, e.b].includes('hypo:simpay') && [e.a, e.b].includes('backend'));
    expect(edge?.hypothetical).toBe(true);
  });

  it('caches by layer identity', () => {
    const again = getModel([simpayLayer]);
    expect(getModel([simpayLayer])).toBe(again);
    expect(getModel([])).toBe(baseModel);
  });
});

describe('audiences', () => {
  it('defines five presets with increasing technical depth', () => {
    expect(AUDIENCES.map((a) => a.id)).toEqual(['executive', 'end-user', 'systems', 'developer', 'dba']);
    expect(AUDIENCES[0].detail).toBeLessThan(AUDIENCES[3].detail);
  });
});
