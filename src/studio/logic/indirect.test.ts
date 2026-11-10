import { describe, expect, it } from 'vitest';
import { baseModel as m, getModel } from '@/model';
import { BUILT_IN_LAYERS } from '@/state/builtinLayers';
import { entityNode, expandIndirect, spotFor } from './build';
import { autoConnect, edgeStatus, entityOf, indirectLink } from './modelEdges';

const PAGE = 'cu:pages/Dashboard';
const EP = 'ep:GET /api/accounts';

describe('indirect connections', () => {
  it('finds a two-relation chain through one intermediate', () => {
    const link = indirectLink(m, PAGE, EP)!;
    expect(link.via).toBe('cu:lib/auth#fetchAccounts');
    expect(link.relationIds).toHaveLength(2);
    expect(link.forward).toBe(true);
    expect(indirectLink(m, PAGE, EP, new Set(['cu:lib/auth#fetchAccounts']))).toBeNull();
  });

  it('auto-connect adds a dotted "via" edge only when there is no direct relation', () => {
    const ep = entityNode(EP, { x: 600, y: 0 });
    const page = entityNode(PAGE, { x: 0, y: 0 });
    const edges = autoConnect(m, [ep, page], [], new Set([page.id]));
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.data).toMatchObject({ strokeStyle: 'dotted', label: 'via fetchAccounts', indirect: { via: 'cu:lib/auth#fetchAccounts' } });
    expect([e.source, e.target]).toEqual([page.id, ep.id]);
    expect(edgeStatus(m, PAGE, EP, e.data)).toBe('indirect');
    // A direct relation wins: no indirect edge.
    const fn = entityNode('cu:lib/auth#fetchAccounts', { x: 300, y: 0 });
    expect(autoConnect(m, [ep, fn], [], new Set([fn.id])).some((x) => x.data?.indirect)).toBe(false);
    // Never duplicated.
    expect(autoConnect(m, [ep, page], edges, new Set([page.id]))).toHaveLength(0);
  });

  it('limits indirect links to two per added entity', () => {
    const others = ['ep:GET /api/accounts', 'ep:GET /api/fraud-alerts', 'ep:GET /api/me', 'ep:GET /api/accounts/:id/transactions'].filter((id) => m.has(id) && indirectLink(m, PAGE, id));
    const nodes = others.map((id, i) => entityNode(id, { x: 400, y: i * 150 }));
    const page = entityNode(PAGE, { x: 0, y: 0 });
    const edges = autoConnect(m, [...nodes, page], [], new Set([page.id]));
    expect(edges.length).toBeLessThanOrEqual(2);
    expect(edges.length).toBe(Math.min(2, others.length));
  });

  it('is hypothetical when a relation in the chain is (SimPay via the partner endpoint)', () => {
    const h = getModel(BUILT_IN_LAYERS);
    const link = indirectLink(h, 'hypo:simpay', 'be:money/movements#createExternalMovement');
    expect(link?.hypothetical).toBe(true);
    const target = entityNode('be:money/movements#createExternalMovement', { x: 0, y: 0 });
    // Placed beside its indirect partner, not at the fallback point.
    const p = spotFor(h, [target], 'hypo:simpay', { x: 5000, y: 5000 });
    expect(Math.abs(p.x)).toBeLessThan(1000);
  });

  it('expanding replaces the indirect edge with the intermediate and two real relations', () => {
    const ep = entityNode(EP, { x: 600, y: 0 });
    const page = entityNode(PAGE, { x: 0, y: 0 });
    const edges = autoConnect(m, [ep, page], [], new Set([page.id]));
    const r = expandIndirect(m, [ep, page], edges, edges[0].id)!;
    expect(r.nodes).toHaveLength(3);
    expect(entityOf(r.added)).toBe('cu:lib/auth#fetchAccounts');
    expect(r.edges).toHaveLength(2);
    expect(r.edges.every((e) => !e.data?.indirect && (e.data?.relationIds?.length ?? 0) > 0)).toBe(true);
    expect(r.edges.map((e) => edgeStatus(m, entityOf([ep, page, r.added].find((n) => n.id === e.source)), entityOf([ep, page, r.added].find((n) => n.id === e.target)), e.data))).toEqual(['known', 'known']);
  });
});
