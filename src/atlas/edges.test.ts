import { describe, expect, it } from 'vitest';
import { baseModel, type LiftedEdge, type Relation } from '@/model';
import { chooseSides, countLabel, edgeZ, nodeZ, placeLabels, routeEdges, strokeWidth, toSpec, type EdgeSpec } from './edges';
import { overlaps, type Rect } from './layout';

const rel = (from: string, to: string, extra: Partial<Relation> = {}): Relation => ({ id: `${from}>${to}`, from, to, kind: 'http', ...extra });
const spec = (id: string, a: string, b: string, extra: Partial<EdgeSpec> = {}): EdgeSpec => ({
  id,
  a,
  b,
  channel: 'http',
  count: 1,
  forward: true,
  backward: false,
  hypothetical: false,
  label: id,
  ...extra,
});

describe('toSpec', () => {
  it('uses the headline label, else a count', () => {
    const base: LiftedEdge = {
      id: 'e',
      a: 'x',
      b: 'y',
      channel: 'call',
      forward: [rel('x', 'y'), rel('x', 'y')],
      backward: [rel('y', 'x')],
      hypothetical: false,
    };
    expect(toSpec(base)).toMatchObject({
      count: 3,
      forward: true,
      backward: true,
      label: '3 calls',
    });
    expect(toSpec({ ...base, headline: rel('x', 'y', { label: 'HTTPS' }) }).label).toBe('HTTPS');
    expect(countLabel('http', 1)).toBe('1 HTTP call');
  });

  it('scales thickness gently', () => {
    expect(strokeWidth(1)).toBe(1.25);
    expect(strokeWidth(8)).toBeGreaterThan(strokeWidth(2));
    expect(strokeWidth(10000)).toBe(3.5);
  });

  it('distinguishes HTTP from real-time between Meridian’s top level parts', () => {
    const visible = new Set(['meridian', ...baseModel.childIds('meridian')]);
    const specs = baseModel.liftRelations(visible).map(toSpec);
    const http = specs.find((s) => s.channel === 'http' && [s.a, s.b].sort().join() === 'backend,customer');
    const rt = specs.find((s) => s.channel === 'realtime' && [s.a, s.b].sort().join() === 'backend,operations');
    expect(http).toBeDefined();
    expect(rt).toBeDefined();
  });
});

describe('routing', () => {
  const A: Rect = { x: 0, y: 0, w: 100, h: 50 };
  const below: Rect = { x: 0, y: 200, w: 100, h: 50 };
  const right: Rect = { x: 300, y: 0, w: 100, h: 50 };

  it('chooses facing sides', () => {
    expect(chooseSides(A, below)).toEqual(['bottom', 'top']);
    expect(chooseSides(below, A)).toEqual(['top', 'bottom']);
    expect(chooseSides(A, right)).toEqual(['right', 'left']);
    expect(chooseSides(right, A)).toEqual(['left', 'right']);
  });

  it('draws arrows for the directions present and puts the midpoint on the path', () => {
    const rects = new Map([
      ['a', A],
      ['b', below],
    ]);
    const g = routeEdges([spec('e', 'a', 'b', { backward: true })], rects).get('e')!;
    expect(g.arrowB).toBeDefined();
    expect(g.arrowA).toBeDefined();
    expect(g.path.startsWith('M50,50')).toBe(true);
    expect(g.mid).toEqual({ x: 50, y: 125 });
    const one = routeEdges([spec('e', 'a', 'b')], rects).get('e')!;
    expect(one.arrowA).toBeUndefined();
  });

  it('spreads edges sharing a side in the order of their other ends', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, w: 300, h: 50 }],
      ['l', { x: -200, y: 200, w: 100, h: 50 }],
      ['r', { x: 400, y: 200, w: 100, h: 50 }],
    ]);
    const g = routeEdges([spec('toR', 'a', 'r'), spec('toL', 'a', 'l')], rects);
    const startX = (id: string) => Number(g.get(id)!.path.slice(1).split(',')[0]);
    expect(startX('toL')).toBeLessThan(startX('toR'));
  });

  it('skips edges whose ends are not laid out', () => {
    expect(routeEdges([spec('e', 'a', 'zz')], new Map([['a', A]])).size).toBe(0);
  });

  it('places labels without overlapping each other or obstacles', () => {
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, w: 100, h: 50 }],
      ['b', { x: 0, y: 300, w: 100, h: 50 }],
      ['c', { x: 10, y: 0, w: 100, h: 50 }],
      ['d', { x: 10, y: 300, w: 100, h: 50 }],
    ]);
    const specs = [spec('ab', 'a', 'b', { count: 5 }), spec('cd', 'c', 'd')];
    const geoms = routeEdges(specs, rects);
    const ok = placeLabels(specs, geoms, []);
    expect(ok.has('ab')).toBe(true);
    expect(ok.has('cd')).toBe(false); // collides with the heavier one
    const blocked = placeLabels(specs, geoms, [{ x: -100, y: 100, w: 400, h: 100 }]);
    expect(blocked.size).toBe(0);
    expect(overlaps({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(false);
  });

  it('stacks edges behind cards but above the regions that contain them', () => {
    expect(edgeZ(1, 3)).toBeGreaterThan(nodeZ(0));
    expect(edgeZ(1, 3)).toBeLessThan(nodeZ(1));
  });
});
