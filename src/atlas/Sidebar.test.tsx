import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { baseModel } from '@/model';
import { useApp } from '@/state/app';
import { Sidebar, treeRows } from './Sidebar';
import { resetMap, revealHidden, setLens, toggleNode } from './actions';
import { useAtlasLocal } from './store';

const counts = {
  http: 3,
  realtime: 1,
  call: 0,
  data: 2,
  type: 0,
  security: 0,
  ops: 4,
  structure: 0,
};

beforeEach(() => {
  useApp.setState((s) => ({
    selection: null,
    atlas: {
      ...s.atlas,
      expanded: [],
      focus: null,
      lens: null,
      isolate: false,
      channels: ['http', 'realtime'],
    },
  }));
  useAtlasLocal.setState({ treeFilter: '', revealAll: [], pinned: [] });
});

describe('treeRows', () => {
  it('follows the expand state and lists matches when filtering', () => {
    expect(treeRows(baseModel, new Set(), '').map((r) => r.entity.id)).toEqual(['meridian']);
    const open = treeRows(baseModel, new Set(['meridian']), '');
    expect(open.map((r) => r.entity.id)).toContain('backend');
    const found = treeRows(baseModel, new Set(), 'ledgerentry');
    expect(found[0].entity.id).toBe('db:LedgerEntry');
    expect(found[0].path).toContain('SQLite Database');
  });
});

describe('Sidebar', () => {
  it('renders the tree, and a row click reveals and selects on the map', () => {
    useApp.setState((s) => ({ atlas: { ...s.atlas, expanded: ['meridian'] } }));
    render(<Sidebar model={baseModel} counts={counts} />);
    const tree = screen.getByTestId('atlas-tree');
    const row = tree.querySelector('[data-tree-entity="backend"]') as HTMLElement;
    fireEvent.click(within(row).getByText('Backend API'));
    expect(useApp.getState().selection).toEqual({
      type: 'entity',
      id: 'backend',
    });
    expect(useApp.getState().atlas.expanded).toContain('meridian');
  });

  it('channel chips show counts and toggle the shared channel filter', () => {
    render(<Sidebar model={baseModel} counts={counts} />);
    const chip = screen.getByTestId('channel-data');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(useApp.getState().atlas.channels).toContain('data');
  });

  it('the tree chevron mirrors expansion', () => {
    render(<Sidebar model={baseModel} counts={counts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the contents of Meridian' }));
    expect(useApp.getState().atlas.expanded).toEqual(['meridian']);
  });
});

describe('actions', () => {
  it('collapsing moves a hidden selection up to the collapsed container', () => {
    useApp.setState((s) => ({
      selection: { type: 'entity', id: 'be.money' },
      atlas: { ...s.atlas, expanded: ['meridian', 'backend'] },
    }));
    toggleNode(baseModel, { id: 'backend', isContainer: true, expanded: true });
    expect(useApp.getState().atlas.expanded).toEqual(['meridian']);
    expect(useApp.getState().selection).toEqual({
      type: 'entity',
      id: 'backend',
    });
  });

  it('the lens expands the ancestors of implementers and toggles off', () => {
    setLens(baseModel, 'feat:transfers');
    expect(useApp.getState().atlas.lens).toBe('feat:transfers');
    expect(useApp.getState().atlas.expanded).toContain('meridian');
    setLens(baseModel, 'feat:transfers');
    expect(useApp.getState().atlas.lens).toBeNull();
  });

  it('"+N more" and reset', () => {
    revealHidden('backend');
    expect(useAtlasLocal.getState().revealAll).toEqual(['backend']);
    useApp.setState((s) => ({ atlas: { ...s.atlas, expanded: ['meridian'] } }));
    resetMap();
    expect(useApp.getState().atlas.expanded).toEqual([]);
    expect(useAtlasLocal.getState().revealAll).toEqual([]);
  });
});
