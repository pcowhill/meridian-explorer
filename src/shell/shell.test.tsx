import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useApp } from '@/state/app';
import { initialWorkspace, useWorkspace } from '@/state/workspace';
import { CommandPalette } from './CommandPalette';
import { averageFor, evaluationMarkdown } from './EvaluationPanel';
import { formatKeys, useHotkeys } from './hotkeys';
import { Inspector } from './Inspector';
import { touchedBaseline } from './LayersPanel';
import { Panels } from './Panels';
import { TopBar } from './TopBar';
import { simpayLayer } from '@/state/layers/simpay';

beforeEach(() => {
  useWorkspace.setState({ ...initialWorkspace(), tourSeen: true });
  useApp.setState({ mode: 'atlas', selection: null, inspectorOpen: true, inspectorTab: 'overview', commandOpen: false, help: null, presenting: false, past: [], future: [], studioInbox: [], audience: 'systems', detail: 3 });
});

const key = (k: string, init: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));

describe('Inspector', () => {
  it('explains the selected entity and switches sections', () => {
    render(<Inspector />);
    expect(screen.queryByTestId('inspector')).not.toBeInTheDocument();
    act(() => useApp.getState().selectEntity('ep:POST /api/transfers'));
    expect(screen.getByTestId('inspector-title')).toHaveTextContent('POST /api/transfers');
    fireEvent.click(screen.getByRole('tab', { name: /Contract/ }));
    expect(screen.getByTestId('contract-view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Relations/ }));
    expect(screen.getAllByTestId('relation-rows').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /Code/ }));
    expect(screen.getAllByTestId('source-ref').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /Impact/ }));
    expect(screen.getByTestId('impact-tab')).toBeInTheDocument();
  });

  it('navigates from a relation row to the relation, and offers related workflows', () => {
    render(<Inspector />);
    act(() => useApp.getState().selectEntity('be:money/movements#createTransfer', { tab: 'relations' }));
    fireEvent.click(screen.getAllByTestId('relation-rows')[0].querySelector('button')!);
    expect(useApp.getState().selection?.type).toBe('relation');
    act(() => useApp.getState().selectEntity('be:money/movements#createTransfer', { tab: 'workflows' }));
    fireEvent.click(document.querySelector('[data-scenario="transfer"]')!);
    expect(useApp.getState()).toMatchObject({ mode: 'theater', theater: { scenarioId: 'transfer' } });
  });

  it('explains an aggregated edge with its endpoints', () => {
    render(<Inspector />);
    act(() => useApp.getState().select({ type: 'edge', a: 'customer', b: 'backend', channel: 'http' }));
    expect(screen.getByTestId('inspector-title')).toHaveTextContent(/HTTPS/);
    expect(within(screen.getByTestId('edge-endpoints')).getAllByRole('button').length).toBeGreaterThan(10);
  });

  it('shows columns, an example row and the balance calculator for the ledger table', () => {
    render(<Inspector />);
    act(() => useApp.getState().selectEntity('db:LedgerEntry', { tab: 'data' }));
    expect(screen.getAllByText('amountMinor').length).toBeGreaterThan(0);
    expect(screen.getByTestId('balance-calculator')).toBeInTheDocument();
    expect(screen.getByTestId('state-machine')).toBeInTheDocument();
  });

  it('records a proposed removal in a hypothetical layer, never in the baseline', () => {
    render(<Inspector />);
    act(() => useApp.getState().selectEntity('be.seed'));
    fireEvent.click(screen.getByRole('button', { name: /What if/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Propose removing this/ }));
    const mine = useWorkspace.getState().layers.find((l) => !l.builtIn)!;
    expect(mine.modifications[0]).toMatchObject({ target: 'be.seed', op: 'remove' });
    expect(screen.getByText('proposed removal')).toBeInTheDocument();
  });

  it('marks hypothetical entities and lets them be deleted', () => {
    act(() => useWorkspace.getState().setLayerActive('layer:simpay', true));
    render(<Inspector />);
    act(() => useApp.getState().selectEntity('hypo:simpay'));
    expect(document.querySelector('[data-confidence="hypothetical"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this hypothetical item' })).toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  it('searches locally and reveals the chosen component in the Atlas', () => {
    act(() => useApp.getState().setCommandOpen(true));
    render(<CommandPalette />);
    expect(screen.getByText('What happens when a customer transfers money?')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'deriveBalances' } });
    const first = document.querySelector('[data-result="entity:sh:ledger#deriveBalances"]')!;
    expect(first).toBeInTheDocument();
    fireEvent.click(first);
    const s = useApp.getState();
    expect(s.commandOpen).toBe(false);
    expect(s.selection).toEqual({ type: 'entity', id: 'sh:ledger#deriveBalances' });
    expect(s.atlas.expanded).toEqual(expect.arrayContaining(['meridian', 'shared', 'sh:ledger']));
  });

  it('opens a scenario result in the Theater and filters by type', () => {
    act(() => useApp.getState().setCommandOpen(true));
    render(<CommandPalette />);
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'transfer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Scenarios' }));
    const hit = document.querySelector('[data-result="scenario:transfer"]')!;
    fireEvent.click(hit);
    expect(useApp.getState()).toMatchObject({ mode: 'theater', theater: { scenarioId: 'transfer' } });
  });

  it('in the Studio, choosing a component queues it for the board', () => {
    act(() => useApp.setState({ mode: 'studio', commandOpen: true }));
    render(<CommandPalette />);
    fireEvent.change(screen.getByTestId('command-input'), { target: { value: 'LedgerEntry' } });
    fireEvent.click(document.querySelector('[data-result="entity:db:LedgerEntry"]')!);
    expect(useApp.getState().studioInbox[0].entities).toEqual(['db:LedgerEntry']);
  });
});

describe('TopBar', () => {
  it('switches mode, audience and detail', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByTestId('mode-theater'));
    expect(useApp.getState().mode).toBe('theater');
    fireEvent.click(screen.getByTestId('audience-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Executive/ }));
    expect(useApp.getState()).toMatchObject({ audience: 'executive', detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'More detail' }));
    expect(useApp.getState().detail).toBe(2);
  });

  it('toggles a hypothetical layer from the What-if menu', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByTestId('layers-button'));
    fireEvent.click(within(screen.getByTestId('layers-menu')).getAllByRole('switch')[0]);
    expect(useWorkspace.getState().activeLayerIds).toEqual(['layer:simpay']);
  });

  it('collapses to a small bar in presenter mode', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByTestId('present-button'));
    expect(screen.getByTestId('presenter-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('exit-presenting'));
    expect(screen.getByTestId('top-bar')).toBeInTheDocument();
  });
});

describe('Panels', () => {
  it('lists registered shortcuts in the reference', () => {
    function Host() {
      useHotkeys([{ id: 't.x', keys: 'x', label: 'Test action', group: 'Everywhere', run: () => undefined }]);
      return <Panels />;
    }
    act(() => useApp.getState().setHelp('shortcuts'));
    render(<Host />);
    expect(within(screen.getByTestId('shortcut-list')).getByText('Test action')).toBeInTheDocument();
  });

  it('filters the glossary', () => {
    act(() => useApp.getState().setHelp('glossary'));
    render(<Panels />);
    fireEvent.change(screen.getByLabelText('Filter glossary'), { target: { value: 'minor units' } });
    expect(within(screen.getByTestId('glossary-list')).getAllByText(/minor units/i).length).toBeGreaterThan(0);
  });

  it('saves and reopens a view', () => {
    act(() => {
      useApp.getState().openInAtlas('db:LedgerEntry');
      useApp.getState().setHelp('views');
    });
    render(<Panels />);
    fireEvent.click(screen.getByTestId('save-view'));
    expect(useWorkspace.getState().views).toHaveLength(1);
    act(() => useApp.getState().select(null));
    fireEvent.click(screen.getByTestId('open-view'));
    expect(useApp.getState().selection).toEqual({ type: 'entity', id: 'db:LedgerEntry' });
  });

  it('starts a guided question in the chosen mode', () => {
    act(() => useApp.getState().setHelp('questions'));
    render(<Panels />);
    fireEvent.click(screen.getByTestId('question-q-balances-theater'));
    expect(useApp.getState()).toMatchObject({ mode: 'theater', theater: { scenarioId: 'account-balances' }, help: null });
  });

  it('records ratings in the evaluation worksheet', () => {
    act(() => useApp.getState().setHelp('evaluation'));
    render(<Panels />);
    fireEvent.change(screen.getByTestId('eval-note-A-atlas'), { target: { value: 'Clear overview' } });
    fireEvent.click(screen.getByRole('tab', { name: /Rubric/ }));
    fireEvent.click(screen.getByTestId('rate-atlas-speed-4'));
    fireEvent.click(screen.getByTestId('rate-atlas-clarity-2'));
    expect(screen.getByTestId('avg-atlas')).toHaveTextContent('3.0');
    const e = useWorkspace.getState().evaluation;
    expect(averageFor(e, 'atlas')).toBe(3);
    expect(averageFor(e, 'studio')).toBeNull();
    const md = evaluationMarkdown(e);
    expect(md).toContain('| Speed of explanation construction | 4 | – | – |');
    expect(md).toContain('Clear overview');
  });

  it('resets the workspace after confirmation', () => {
    act(() => {
      useWorkspace.getState().toggleStar('backend');
      useApp.getState().setHelp('workspace');
    });
    render(<Panels />);
    fireEvent.click(screen.getByTestId('reset-workspace'));
    fireEvent.click(screen.getByTestId('confirm-reset'));
    expect(useWorkspace.getState().starred).toEqual([]);
  });
});

describe('hotkeys', () => {
  it('fires registered shortcuts but not while typing', () => {
    let count = 0;
    function Host() {
      useHotkeys([{ id: 't.k', keys: 'k', label: 'K', group: 'Everywhere', run: () => count++ }]);
      return <input aria-label="field" />;
    }
    render(<Host />);
    key('k');
    expect(count).toBe(1);
    const input = screen.getByLabelText('field');
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true })));
    expect(count).toBe(1);
    key('k', { ctrlKey: true });
    expect(count).toBe(1);
  });

  it('formats combos for display', () => {
    expect(formatKeys('/ mod+k')).toHaveLength(2);
    expect(formatKeys('ArrowRight')).toEqual(['→']);
    expect(formatKeys('space')).toEqual(['Space']);
  });
});

describe('layer comparison', () => {
  it('lists the baseline parts a proposal touches', () => {
    const touched = touchedBaseline(simpayLayer);
    expect(touched).toEqual(expect.arrayContaining(['be:money/movements#createExternalMovement', 'sh:money-movement#ExternalMovementRequest', 'db:Account']));
    expect(touched.some((id) => id.startsWith('hypo:'))).toBe(false);
  });
});
