import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '@/state/app';
import { initialWorkspace, useWorkspace } from '@/state/workspace';
import Studio from './Studio';
import { useStudio } from './store';

const renderStudio = () =>
  render(
    <ReactFlowProvider>
      <div style={{ width: 1200, height: 800 }}>
        <Studio />
      </div>
    </ReactFlowProvider>,
  );

beforeEach(() => {
  useWorkspace.setState({ ...initialWorkspace(), tourSeen: true });
  useApp.setState({ studioInbox: [], selection: null, mode: 'studio' });
  useStudio.getState().load(null);
});

describe('Explanation Studio', () => {
  it('creates a board on first open and offers the fastest starts', () => {
    renderStudio();
    expect(screen.getByTestId('studio-root')).toBeInTheDocument();
    expect(useWorkspace.getState().boards).toHaveLength(1);
    expect(screen.getByTestId('studio-empty')).toBeInTheDocument();
    expect(screen.getByTestId('node-count')).toHaveTextContent('0 items');
    expect(screen.getByLabelText('Generate')).toBeInTheDocument();
    for (const label of ['Undo', 'Redo', 'Add text', 'Add note', 'Add frame', 'Connect mode', 'Duplicate', 'Delete', 'Zoom to fit', 'Auto-layout', 'Spotlight', 'Add hypothetical component', 'Export board', 'Import board', 'Export PNG']) {
      expect(screen.getAllByLabelText(label).length, label).toBeGreaterThan(0);
    }
  });

  it('adds a component from the palette search', () => {
    renderStudio();
    fireEvent.change(screen.getByTestId('palette-search'), { target: { value: 'transfer' } });
    const hit = document.querySelector('[data-palette-entity="ep:POST /api/transfers"]') as HTMLElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit);
    expect(useStudio.getState().nodes.map((n) => n.data.entityId)).toContain('ep:POST /api/transfers');
    expect(useApp.getState().selection).toEqual({ type: 'entity', id: 'ep:POST /api/transfers' });
  });

  it('consumes the cross-mode inbox and places the request', () => {
    renderStudio();
    act(() => {
      useApp.getState().sendToStudio({ title: 'Path', source: 'atlas', entities: ['ep:POST /api/transfers', 'be:money/movements#createTransfer'], layout: 'sequence' });
    });
    const s = useStudio.getState();
    expect(useApp.getState().studioInbox).toHaveLength(0);
    expect(s.nodes.filter((n) => n.type === 'entity')).toHaveLength(2);
    expect(s.nodes.some((n) => n.type === 'text' && n.data.label === 'Path')).toBe(true);
    expect(s.edges[0].data?.order).toBe(1);
  });

  it('autosaves the board to the workspace', async () => {
    renderStudio();
    act(() => {
      useApp.getState().sendToStudio({ title: 'One', source: 'inspector', entities: ['db:LedgerEntry'] });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    const ws = useWorkspace.getState();
    const board = ws.boards.find((b) => b.id === ws.activeBoardId)!;
    expect(board.nodes.map((n) => n.data.entityId)).toContain('db:LedgerEntry');
  });
});
