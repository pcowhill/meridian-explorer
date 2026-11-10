import { describe, expect, it } from 'vitest';
import { baseModel } from '@/model';
import { DEFAULT_SIZE, type SEdge, type SNode } from '../types';
import { absPos, alignRects, distributeRects, findFreeSpot, indexNodes, overlaps, sortParentsFirst, type Rect } from './geometry';
import { grid, layered, rankItems, row } from './layout';
import { autoConnect, edgeStatus, knownEdgeData, liftedForBoard } from './modelEdges';
import {
  addChildren,
  addNeighbours,
  beforeAfter,
  chainBetween,
  cloneElements,
  connections,
  dependencyDiagram,
  entityNode,
  fromStudioEdge,
  fromStudioNode,
  groupIntoFrame,
  instantiate,
  makeNode,
  orderChain,
  placeEntities,
  planImport,
  removeNodes,
  reparent,
  sequenceFromChain,
  spotFor,
  systemOverviewIds,
  templateFrom,
  toStudioEdge,
  toStudioNode,
  autoLayout,
  endpointFor,
} from './build';
import { bindingItems, jsonSpec, matchItems, quickWidgets, type WidgetKind } from './widgets';

const m = baseModel;
const EP = 'ep:POST /api/transfers';
const FN = 'be:money/movements#createTransfer';
const LE = 'db:LedgerEntry';

const edge = (id: string, source: string, target: string, data: SEdge['data'] = {}): SEdge => ({ id, source, target, type: 'studio', data });

describe('geometry', () => {
  it('finds a free spot that does not overlap existing rectangles', () => {
    const rects: Rect[] = [{ x: 0, y: 0, w: 200, h: 100 }];
    const p = findFreeSpot(rects, 200, 100, { x: 100, y: 50 });
    expect(overlaps({ x: p.x, y: p.y, w: 200, h: 100 }, rects[0])).toBe(false);
    const empty = findFreeSpot([], 200, 100, { x: 100, y: 50 });
    expect(empty).toEqual({ x: 0, y: 0 });
  });

  it('resolves absolute positions through parents and sorts parents first', () => {
    const frame = makeNode('frame', { x: 100, y: 100 }, { label: 'F' });
    const child = { ...makeNode('note', { x: 10, y: 20 }, {}), parentId: frame.id };
    expect(absPos(child, indexNodes([child, frame]))).toEqual({ x: 110, y: 120 });
    expect(sortParentsFirst([child, frame]).map((n) => n.id)).toEqual([frame.id, child.id]);
  });

  it('aligns and distributes', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, w: 10, h: 10 }],
      ['b', { x: 50, y: 30, w: 20, h: 10 }],
      ['c', { x: 200, y: 5, w: 10, h: 10 }],
    ]);
    expect(alignRects(rects, 'left').get('b')).toEqual({ x: 0, y: 30 });
    expect(alignRects(rects, 'bottom').get('a')).toEqual({ x: 0, y: 30 });
    const d = distributeRects(rects, 'x');
    // total span 210, sizes 40 → gap 85
    expect(d.get('b')!.x).toBeCloseTo(95);
    expect(distributeRects(new Map([...rects].slice(0, 2)), 'x').size).toBe(0);
  });
});

describe('layout', () => {
  it('ranks by longest path and survives cycles', () => {
    const r = rankItems(['a', 'b', 'c'], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ]);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
  });

  it('lays out left→right by edge direction, unconnected last', () => {
    const items = ['a', 'b', 'c', 'z'].map((id) => ({ id, w: 100, h: 50 }));
    const p = layered(items, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
    expect(p.get('z')!.x).toBeGreaterThan(p.get('c')!.x);
  });

  it('row keeps order; grid wraps', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, w: 100, h: 50 }));
    const r = row(items, 20);
    expect([r.get('a')!.x, r.get('b')!.x, r.get('c')!.x]).toEqual([0, 120, 240]);
    const g = grid(items, { columns: 2 });
    expect(g.get('c')!.y).toBeGreaterThan(0);
  });
});

describe('model edges', () => {
  it('recognises a known relationship and its direction', () => {
    const k = knownEdgeData(m, FN, EP)!;
    expect(k).not.toBeNull();
    expect(k.forward).toBe(false); // the endpoint calls the function
    expect(k.data.channel).toBe('call');
    expect(k.data.relationIds!.length).toBeGreaterThan(0);
    expect(edgeStatus(m, EP, FN, k.data)).toBe('known');
  });

  it('marks a line between unrelated entities as not in Meridian', () => {
    expect(knownEdgeData(m, 'cu:pages/MoveMoney', 'db:Card')).toBeNull();
    expect(edgeStatus(m, 'cu:pages/MoveMoney', 'db:Card', {})).toBe('unverified');
    expect(edgeStatus(m, undefined, 'db:Card', {})).toBe('free');
  });

  it('auto-connects only new nodes and never duplicates an edge', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const b = entityNode(FN, { x: 400, y: 0 });
    const c = entityNode(LE, { x: 800, y: 0 });
    const first = autoConnect(m, [a, b], [], new Set([b.id]));
    expect(first).toHaveLength(1);
    expect(first[0].source).toBe(a.id);
    const again = autoConnect(m, [a, b], first, new Set([b.id]));
    expect(again).toHaveLength(0);
    const third = autoConnect(m, [a, b, c], first, new Set([c.id]));
    expect(third.some((e) => e.source === b.id && e.target === c.id && e.data?.channel === 'data')).toBe(true);
  });

  it('filters test/doc noise out of lifted relations', () => {
    expect(liftedForBoard(m, new Set([FN, 'tests'])).every((l) => l.channel !== 'structure')).toBe(true);
  });
});

describe('placing and importing', () => {
  it('places entities clear of existing content with a title, connected by known relations', () => {
    const existing = makeNode('note', { x: 0, y: 0 }, { label: 'x' });
    const p = placeEntities(m, [existing], [], [EP, FN, LE, 'nope:missing'], { title: 'Transfer' });
    const ents = p.nodes.filter((n) => n.type === 'entity');
    expect(ents).toHaveLength(3);
    expect(p.nodes.some((n) => n.type === 'text' && n.data.label === 'Transfer')).toBe(true);
    expect(ents.every((n) => n.position.x > 190)).toBe(true);
    expect(p.edges.length).toBeGreaterThanOrEqual(2);
    expect(p.select.length).toBe(p.nodes.length);
  });

  it('sequence layout is strictly left→right with numbered edges', () => {
    const p = placeEntities(m, [], [], [EP, FN, LE], { layout: 'sequence' });
    const xs = [EP, FN, LE].map((id) => p.nodes.find((n) => n.data.entityId === id)!.position.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(p.edges.map((e) => e.data?.order)).toEqual([1, 2]);
  });

  it('explicit hypothetical edges are drawn as proposed', () => {
    const p = planImport(m, [], [], { id: 'i', title: 'T', source: 'atlas', entities: [EP, LE], edges: [{ from: EP, to: LE, label: 'maybe', hypothetical: true, order: 3 }] });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].data).toMatchObject({ proposed: true, label: 'maybe', order: 3, strokeStyle: 'dashed' });
  });

  it('a single entity already on the board is selected, not duplicated', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const p = planImport(m, [a], [], { id: 'i', title: 'x', source: 'inspector', entities: [EP] });
    expect(p.nodes).toHaveLength(0);
    expect(p.select).toEqual([a.id]);
  });

  it('puts a related entity beside the node it relates to', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const p = spotFor(m, [a], FN, { x: 0, y: 0 });
    expect(p.x).toBeGreaterThan(DEFAULT_SIZE.entity.w);
  });
});

describe('generators', () => {
  it('builds a dependency diagram with dependents left and dependencies right', () => {
    const p = dependencyDiagram(m, [], 'sh:ledger#deriveBalances');
    const centre = p.nodes.find((n) => n.data.entityId === 'sh:ledger#deriveBalances')!;
    const callers = m.incoming('sh:ledger#deriveBalances').map((r) => r.from);
    const left = p.nodes.filter((n) => callers.includes(n.data.entityId as string));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((n) => n.position.x < centre.position.x)).toBe(true);
    expect(p.edges.length).toBeGreaterThan(0);
    const d2 = dependencyDiagram(m, [], 'sh:ledger#deriveBalances', 2);
    expect(d2.nodes.length).toBeGreaterThanOrEqual(p.nodes.length);
  });

  it('shows direct connections, or the shortest chain through intermediates', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const b = entityNode(FN, { x: 500, y: 0 });
    const direct = connections(m, [a, b], [], a.id, b.id)!;
    expect(direct.nodes).toHaveLength(0);
    expect(direct.edges.length).toBeGreaterThan(0);
    const c = entityNode('cu:pages/MoveMoney', { x: 0, y: 0 });
    const d = entityNode(LE, { x: 800, y: 0 });
    const chain = connections(m, [c, d], [], c.id, d.id)!;
    expect(chain.nodes.length).toBeGreaterThan(0);
    expect(chain.edges.map((e) => e.data?.order)).toEqual(chain.edges.map((_, i) => i + 1));
    expect(chainBetween(m, 'cu:pages/MoveMoney', LE)!.via.length).toBe(chain.nodes.length);
  });

  it('adds children and neighbours not already on the board', () => {
    const app = entityNode('backend', { x: 0, y: 0 });
    const kids = addChildren(m, [app], [], app.id)!;
    expect(kids.nodes.length).toBe(Math.min(24, m.childIds('backend').length));
    const n = entityNode(FN, { x: 0, y: 0 });
    const nb = addNeighbours(m, [n], [], n.id)!;
    expect(nb.nodes.length).toBeGreaterThan(0);
    expect(nb.edges.length).toBeGreaterThan(0);
    expect(nb.nodes.some((x) => x.data.entityId === FN)).toBe(false);
  });

  it('system overview lists top-level apps, the database and roles', () => {
    const ids = systemOverviewIds(m);
    expect(ids).toEqual(expect.arrayContaining(['customer', 'operations', 'backend', 'db', 'role:customer']));
  });

  it('orders a chain along its edges and builds a sequence from it', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((l, i) => makeNode('shape', { x: i * 300, y: 0 }, { shape: 'rounded', label: l }));
    const edges = [edge('e1', b.id, c.id, { label: 'then' }), edge('e2', a.id, b.id, { label: 'calls' })];
    const ch = orderChain([c.id, a.id, b.id], edges);
    expect(ch.nodes).toEqual([a.id, b.id, c.id]);
    expect(ch.edges).toEqual(['e2', 'e1']);
    const seq = sequenceFromChain([a, b, c], edges, ch.nodes);
    expect(seq.custom!.participants).toEqual(['A', 'B', 'C']);
    expect(seq.custom!.steps.map((s) => s.label)).toEqual(['calls', 'then']);
  });

  it('finds the endpoint behind a selected relationship', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const b = entityNode(FN, { x: 400, y: 0 });
    const k = knownEdgeData(m, EP, FN)!;
    const e = edge('e', a.id, b.id, k.data);
    expect(endpointFor(m, [a, b], [e], [], ['e'])).toBe(EP);
  });
});

describe('structure', () => {
  it('clones with fresh ids, keeps frame contents and inner edges', () => {
    const frame = makeNode('frame', { x: 0, y: 0 }, { label: 'F' });
    const a = { ...makeNode('note', { x: 10, y: 40 }, { label: 'a' }), parentId: frame.id };
    const b = makeNode('note', { x: 400, y: 0 }, { label: 'b' });
    const e = edge('e', a.id, b.id);
    const c = cloneElements([frame, a, b], [e], [frame.id, b.id], { x: 50, y: 50 });
    expect(c.nodes).toHaveLength(3);
    expect(c.edges).toHaveLength(1);
    expect(c.nodes.find((n) => n.data.label === 'a')!.parentId).toBe(c.map.get(frame.id));
    expect(c.nodes.every((n) => ![frame.id, a.id, b.id].includes(n.id))).toBe(true);
  });

  it('groups into a frame, reparents, and removing the frame keeps its contents', () => {
    const a = makeNode('note', { x: 100, y: 100 }, {});
    const b = makeNode('note', { x: 400, y: 100 }, {});
    const g = groupIntoFrame([a, b], [a.id, b.id], 'Group')!;
    const byId = indexNodes(g.nodes);
    expect(byId.get(a.id)!.parentId).toBe(g.frame.id);
    expect(absPos(byId.get(a.id)!, byId)).toEqual({ x: 100, y: 100 });
    const r = removeNodes(g.nodes, [], new Set([g.frame.id]));
    expect(r.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(r.nodes.find((n) => n.id === a.id)!.position).toEqual({ x: 100, y: 100 });
    const back = reparent(g.nodes, a.id, undefined);
    expect(back.find((n) => n.id === a.id)!.position).toEqual({ x: 100, y: 100 });
  });

  it('before/after wraps the original and adds a proposed copy', () => {
    const a = entityNode(EP, { x: 0, y: 0 });
    const b = entityNode(FN, { x: 400, y: 0 });
    const ba = beforeAfter([a, b], [edge('e', a.id, b.id)], [a.id, b.id])!;
    const frames = [...ba.replace, ...ba.nodes].filter((n) => n.type === 'frame');
    expect(frames.map((f) => f.data.label).sort()).toEqual(['Existing', 'Proposed']);
    expect(frames.find((f) => f.data.label === 'Proposed')!.data.proposed).toBe(true);
    expect(ba.nodes.filter((n) => n.type === 'entity')).toHaveLength(2);
    expect(ba.edges).toHaveLength(1);
  });

  it('auto-layout moves only top-level nodes and anchors at the group top-left', () => {
    const a = makeNode('note', { x: 0, y: 0 }, {});
    const b = makeNode('note', { x: 0, y: 400 }, {});
    const pos = autoLayout([a, b], [edge('e', a.id, b.id)]);
    expect(pos.get(a.id)!.x).toBeLessThan(pos.get(b.id)!.x);
    expect(Math.min(pos.get(a.id)!.y, pos.get(b.id)!.y)).toBe(0);
  });

  it('round-trips through the workspace envelope and templates', () => {
    const frame = makeNode('frame', { x: 100, y: 100 }, { label: 'F', locked: true });
    const a = { ...makeNode('note', { x: 10, y: 40 }, { label: 'a' }), parentId: frame.id, hidden: true };
    const e = edge('e', frame.id, a.id, { label: 'x', order: 2 });
    const back = fromStudioNode(toStudioNode(a));
    expect(back).toMatchObject({ id: a.id, parentId: frame.id, hidden: true, position: a.position, width: a.width });
    expect(fromStudioNode(toStudioNode(frame)).draggable).toBe(false);
    expect(fromStudioEdge(toStudioEdge(e)).data).toEqual(e.data);
    const tpl = templateFrom([frame, a], [e], []);
    const inst = instantiate(tpl, { x: 1000, y: 1000 });
    expect(inst.nodes).toHaveLength(2);
    expect(inst.nodes.find((n) => n.type === 'frame')!.position).toEqual({ x: 1000, y: 1000 });
  });
});

describe('widget bindings', () => {
  it('offers bindings for every widget kind', () => {
    const kinds: WidgetKind[] = ['code', 'json', 'table', 'class', 'contract', 'sequence', 'state', 'timeline', 'compare', 'transform', 'balance'];
    for (const k of kinds) expect(bindingItems(m, k).length, k).toBeGreaterThan(0);
  });

  it('matches camelCase tokens by prefix', () => {
    const items = bindingItems(m, 'json');
    const hits = matchItems(items, 'transfers request');
    expect(hits[0].key).toBe(`req:${EP}`);
    expect(matchItems(bindingItems(m, 'sequence'), 'approval').some((x) => x.key === 'ops-approval')).toBe(true);
  });

  it('builds JSON from a contract example and quick widgets for an entity', () => {
    const s = jsonSpec(m, { kind: 'request', id: EP });
    expect(JSON.parse((s.data as { json: string }).json)).toEqual(m.contract(EP)!.requestExample);
    const q = quickWidgets(m, FN).map((x) => x.label);
    expect(q).toContain('Code');
    expect(quickWidgets(m, EP).map((x) => x.label)).toEqual(expect.arrayContaining(['Contract', 'Request JSON', 'Trace']));
    expect(quickWidgets(m, LE).map((x) => x.label)).toContain('Table');
  });

  it('every binding produces node data of a known type', () => {
    for (const it of bindingItems(m, 'compare').slice(0, 5)) {
      const s = it.make();
      expect(s.type).toBe('compare');
    }
    const node: SNode = makeNode('json', { x: 0, y: 0 }, jsonSpec(m, { kind: 'entity', id: LE }).data);
    expect(node.type).toBe('json');
  });
});
