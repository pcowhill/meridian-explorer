import { describe, expect, it } from 'vitest';
import { baseModel } from '@/model';
import { computeEmphasis, lensVisibleCount, neighbourhood } from './emphasis';
import { toSpec } from './edges';
import { navigate } from './nav';
import { layoutScene } from './scene';
import { zoomBand } from './store';
import { ensureVisible, fitRect, inView } from './viewport';
import { computeVisible } from './visibility';

const tree = computeVisible(baseModel, {
  root: 'meridian',
  expanded: new Set(['meridian', 'backend']),
  detail: 3,
  forced: [],
  revealAll: new Set(),
  focus: false,
});
const specs = baseModel.liftRelations(new Set(tree.order)).map(toSpec);
const rects = layoutScene(baseModel, tree);
const rep = (id: string) => {
  let cur: string | undefined = id;
  while (cur && !tree.nodes.has(cur)) cur = baseModel.entity(cur)?.parent;
  return cur;
};

describe('emphasis', () => {
  it('finds neighbours along drawn edges', () => {
    const n = neighbourhood(tree, specs, 'be.money');
    expect(n.neighbours.has('db')).toBe(true);
    expect(n.inside.has('be.money')).toBe(true);
  });

  it('highlight dependencies: focuses the selection and neighbours, dims the rest', () => {
    const fx = computeEmphasis({
      tree,
      edges: specs,
      selected: 'be.money',
      highlight: true,
      spotlight: false,
      lens: null,
      representative: rep,
    });
    expect(fx.nodeFx.get('be.money')).toBe('focus');
    expect(fx.nodeFx.get('db')).toBe('focus');
    expect(fx.nodeFx.get('backend')).toBeUndefined(); // context container
    expect(fx.nodeFx.get('role:customer')).toBe('dim');
    expect([...fx.edgeFx.values()]).toContain('focus');
  });

  it('spotlight dims everything outside the selection', () => {
    const fx = computeEmphasis({
      tree,
      edges: specs,
      selected: 'backend',
      highlight: false,
      spotlight: true,
      lens: null,
      representative: rep,
    });
    expect(fx.nodeFx.get('backend')).toBe('focus');
    expect(fx.nodeFx.get('be.money')).toBeUndefined();
    expect(fx.nodeFx.get('customer')).toBe('dim');
  });

  it('lens marks implementers (or their visible representative) and the containers holding them', () => {
    const lens = new Set(baseModel.implementersOf('feat:transfers').map((e) => e.id));
    const fx = computeEmphasis({
      tree,
      edges: specs,
      selected: null,
      highlight: false,
      spotlight: false,
      lens,
      representative: rep,
    });
    expect([...fx.nodeFx.values()]).toContain('lens');
    expect(fx.nodeFx.get('meridian')).toBe('lens-in');
    expect(lensVisibleCount(tree, lens)).toBeGreaterThanOrEqual(0);
  });

  it('does nothing without a mode', () => {
    const fx = computeEmphasis({
      tree,
      edges: specs,
      selected: 'backend',
      highlight: false,
      spotlight: false,
      lens: null,
      representative: rep,
    });
    expect(fx.nodeFx.size).toBe(0);
  });
});

describe('keyboard navigation', () => {
  it('moves to parent, first child and siblings', () => {
    expect(navigate(tree, rects, null, 'down')).toBe('meridian');
    expect(navigate(tree, rects, 'backend', 'up')).toBe('meridian');
    expect(navigate(tree, rects, 'meridian', 'down')).toBe('role:customer');
    expect(navigate(tree, rects, 'role:customer', 'right')).toBe('role:joint_customer');
    expect(navigate(tree, rects, 'role:customer', 'left')).toBeNull();
    expect(navigate(tree, rects, 'customer', 'down')).toBeNull(); // collapsed
  });
});

describe('viewport + zoom bands', () => {
  const canvas = { width: 1000, height: 800 };
  it('fits a rect centred and clamps zoom', () => {
    const vp = fitRect({ x: 0, y: 0, w: 1000, h: 400 }, canvas, { padding: 0 });
    expect(vp.zoom).toBe(1);
    expect(vp.y).toBe(200);
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, canvas, { maxZoom: 1.5 }).zoom).toBe(1.5);
  });

  it('ensureVisible pans when it fits, zooms out when not, and does nothing when visible', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(ensureVisible({ x: 100, y: 100, w: 100, h: 100 }, vp, canvas)).toBeNull();
    const pan = ensureVisible({ x: 2000, y: 100, w: 100, h: 100 }, vp, canvas)!;
    expect(pan.zoom).toBe(1);
    expect(inView({ x: 2000, y: 100, w: 100, h: 100 }, pan, canvas)).toBe(true);
    const out = ensureVisible({ x: 0, y: 0, w: 3000, h: 100 }, vp, canvas)!;
    expect(out.zoom).toBeLessThan(1);
  });

  it('maps zoom to semantic bands', () => {
    expect(zoomBand(0.3)).toBe('far');
    expect(zoomBand(0.9)).toBe('mid');
    expect(zoomBand(1.5)).toBe('near');
  });
});
