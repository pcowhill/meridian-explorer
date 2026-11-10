import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useApp } from '@/state/app';
import Atlas from './Atlas';
import { useAtlasLocal } from './store';

describe('Atlas (smoke)', () => {
  it('mounts with its sidebar, controls and breadcrumb; T hides the sidebar', () => {
    useApp.setState((s) => ({ selection: null, atlas: { ...s.atlas, expanded: [], focus: null, lens: null } }));
    render(
      <ReactFlowProvider>
        <Atlas />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId('atlas-root')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-tree')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-breadcrumb')).toHaveTextContent('Meridian');
    expect(screen.getByRole('button', { name: 'Zoom to fit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add hypothetical component' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    });
    expect(useAtlasLocal.getState().sidebarOpen).toBe(false);
    expect(screen.queryByTestId('atlas-tree')).not.toBeInTheDocument();
    act(() => useAtlasLocal.getState().set({ sidebarOpen: true }));
  });

  it('shows the focus breadcrumb path and leaves focus from it', () => {
    useApp.setState((s) => ({ atlas: { ...s.atlas, expanded: ['meridian', 'backend'], focus: 'backend' } }));
    render(
      <ReactFlowProvider>
        <Atlas />
      </ReactFlowProvider>,
    );
    const crumbs = screen.getByTestId('atlas-breadcrumb');
    expect(crumbs).toHaveTextContent('Whole system');
    expect(crumbs).toHaveTextContent('Backend API');
    act(() => screen.getByRole('button', { name: 'Leave focus' }).click());
    expect(useApp.getState().atlas.focus).toBeNull();
  });
});
