import { describe, expect, it } from 'vitest';
import { baseModel } from '@/model';
import { computeEmphasis, lensVisibleCount, neighbourhood } from './emphasis';
import { toSpec } from './edges';
import { navigate } from './nav';
import { layoutScene } from './scene';
import { zoomBand } from './store';
import { afterExpand, CHROME, ensureVisible, fitRect, frameSelection, inView, placeRect, READABLE_ZOOM } from './viewport';
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
    expect(inView({ x: 2000, y: 100, w: 100, h: 100 }, pan, canvas, 20)).toBe(true);
    const out = ensureVisible({ x: 0, y: 0, w: 3000, h: 100 }, vp, canvas)!;
    expect(out.zoom).toBeLessThan(1);
  });

  it('maps zoom to semantic bands', () => {
    expect(zoomBand(0.3)).toBe('far');
    expect(zoomBand(0.9)).toBe('mid');
    expect(zoomBand(1.5)).toBe('near');
  });
});

describe('camera policy', () => {
  const canvas = { width: 1200, height: 800 };
  it('after an expand keeps the header in place when the new contents fit', () => {
    const vp = { x: 100, y: 50, zoom: 1 };
    const r = { x: 200, y: 200, w: 400, h: 300 };
    expect(afterExpand(r, vp, canvas)).toEqual(vp);
  });

  it('after an expand zooms out only to the readable minimum and brings the header into view', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const r = { x: 100, y: 100, w: 4000, h: 3000 };
    const next = afterExpand(r, vp, canvas);
    expect(next.zoom).toBe(READABLE_ZOOM);
    expect(r.x * next.zoom + next.x).toBe(CHROME.left);
    expect(r.y * next.zoom + next.y).toBe(CHROME.top);
  });

  it('frames an arriving selection at a readable zoom, centred on it when the frame is too big', () => {
    const node = { x: 3000, y: 2000, w: 200, h: 90 };
    const frame = { x: 0, y: 0, w: 6000, h: 4000 };
    const vp = frameSelection(node, frame, canvas);
    expect(vp.zoom).toBe(READABLE_ZOOM);
    const cx = (node.x + node.w / 2) * vp.zoom + vp.x;
    expect(Math.abs(cx - (CHROME.left + (canvas.width - CHROME.left - CHROME.right) / 2))).toBeLessThan(1);
    const small = frameSelection(node, { x: 2900, y: 1900, w: 500, h: 300 }, canvas);
    expect(small.zoom).toBeGreaterThan(1);
    expect(placeRect({ x: 0, y: 0, w: 10, h: 10 }, 1, canvas).x).toBeCloseTo(CHROME.left + (canvas.width - CHROME.left - CHROME.right) / 2 - 5);
  });
});
