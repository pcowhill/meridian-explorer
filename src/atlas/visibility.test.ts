import { describe, expect, it } from 'vitest';
import { baseModel, channelOf, getModel, type HypotheticalLayer } from '@/model';
import { addStubs, computeVisible, focusStubs, isolateTree, visibleSubtree, type VisibilityOptions } from './visibility';

const opts = (o: Partial<VisibilityOptions>): VisibilityOptions => ({
  root: 'meridian',
  expanded: new Set(),
  detail: 3,
  forced: [],
  revealAll: new Set(),
  focus: false,
  ...o,
});

describe('computeVisible', () => {
  it('shows only Meridian when nothing is expanded', () => {
    const t = computeVisible(baseModel, opts({}));
    expect(t.order).toEqual(['meridian']);
    expect(t.nodes.get('meridian')).toMatchObject({
      expanded: false,
      isContainer: true,
    });
  });

  it('filters children by the detail dial and counts the hidden ones', () => {
    const t = computeVisible(baseModel, opts({ expanded: new Set(['meridian']), detail: 1 }));
    expect(t.nodes.get('meridian')!.children).toEqual(['customer', 'operations', 'backend']);
    expect(t.nodes.get('meridian')!.hiddenCount).toBe(baseModel.childIds('meridian').length - 3);
  });

  it('never makes features map nodes', () => {
    const t = computeVisible(baseModel, opts({ expanded: new Set(baseModel.entities.keys()), detail: 5 }));
    for (const id of t.order) expect(baseModel.entity(id)!.kind).not.toBe('feature');
  });

  it('keeps the selection (and its ancestors) visible regardless of detail', () => {
    const fn = 'be:money/movements#describeMovement';
    const t = computeVisible(
      baseModel,
      opts({
        expanded: new Set(['meridian', 'backend', 'be.money', 'be:money/movements']),
        detail: 1,
        forced: [fn],
      }),
    );
    for (const id of ['backend', 'be.money', 'be:money/movements', fn]) expect(t.nodes.has(id), id).toBe(true);
  });

  it('only shows children of expanded containers', () => {
    const t = computeVisible(baseModel, opts({ expanded: new Set(['backend']), detail: 5, forced: ['be.money'] }));
    expect(t.order).toEqual(['meridian']);
  });

  it('"+N more" reveals the hidden children of one container only', () => {
    const t = computeVisible(
      baseModel,
      opts({
        expanded: new Set(['meridian', 'backend']),
        detail: 1,
        revealAll: new Set(['backend']),
      }),
    );
    expect(t.nodes.get('backend')!.children).toHaveLength(baseModel.childIds('backend').length);
    expect(t.nodes.get('backend')!.hiddenCount).toBe(0);
    expect(t.nodes.get('meridian')!.hiddenCount).toBeGreaterThan(0);
  });

  it('always shows hypothetical children', () => {
    const layer: HypotheticalLayer = {
      id: 'l',
      name: 'L',
      description: '',
      entities: [
        {
          id: 'hypo:x',
          kind: 'external',
          name: 'X',
          parent: 'meridian',
          summary: 'x',
          detail: 5,
        },
      ],
      relations: [],
      contracts: [],
      modifications: [],
      scenarios: [],
    };
    const t = computeVisible(getModel([layer]), opts({ expanded: new Set(['meridian']), detail: 1 }));
    expect(t.nodes.has('hypo:x')).toBe(true);
  });

  it('focus mode expands the focused root', () => {
    const t = computeVisible(baseModel, opts({ root: 'backend', focus: true }));
    expect(t.nodes.get('backend')!.expanded).toBe(true);
    expect(t.nodes.get('backend')!.depth).toBe(0);
  });
});

describe('focus stubs', () => {
  it('lifts outside connections to the child of the common ancestor', () => {
    const stubs = focusStubs(baseModel, 'backend', () => true);
    expect(stubs).toEqual(expect.arrayContaining(['customer', 'operations', 'db']));
    expect(stubs).not.toContain('backend');
    expect(stubs).not.toContain('meridian');
  });

  it('respects the channel filter', () => {
    const stubs = focusStubs(baseModel, 'backend', (r) => channelOf(r.kind) === 'data');
    expect(stubs).toContain('db');
    expect(stubs).not.toContain('customer');
  });

  it('uses sibling subsystems for a focused subsystem', () => {
    const stubs = focusStubs(baseModel, 'be.money', () => true);
    expect(stubs.some((s) => baseModel.parentOf(s)?.id === 'backend')).toBe(true);
    expect(stubs).toContain('db');
  });

  it('addStubs marks stub nodes', () => {
    const t = addStubs(computeVisible(baseModel, opts({ root: 'backend', focus: true })), ['db']);
    expect(t.nodes.get('db')).toMatchObject({ stub: true });
    expect(t.stubs).toEqual(['db']);
  });
});

describe('isolateTree', () => {
  it('keeps the kept nodes and their ancestors only', () => {
    const t = computeVisible(baseModel, opts({ expanded: new Set(['meridian', 'backend']), detail: 3 }));
    const iso = isolateTree(t, new Set(['be.money', 'db']));
    expect(new Set(iso.order)).toEqual(new Set(['meridian', 'backend', 'be.money', 'db']));
    expect(iso.nodes.get('backend')!.children).toEqual(['be.money']);
    expect(visibleSubtree(iso, 'backend')).toEqual(['backend', 'be.money']);
  });
});
