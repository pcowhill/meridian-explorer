import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { baseModel, visibleSteps } from '@/model';
import { useApp } from '@/state/app';
import { useWorkspace, initialWorkspace } from '@/state/workspace';
import Theater from './Theater';
import { useDrafts } from './drafts';

function open(scenarioId: string | null, stepIndex = 0, variant: string | null = null) {
  useApp.setState((s) => ({ detail: 3, audience: 'systems', selection: null, theater: { ...s.theater, scenarioId, variant, stepIndex, view: 'sequence', speed: 1 } }));
}

beforeEach(() => {
  useWorkspace.setState({ ...initialWorkspace(), tourSeen: true });
  useDrafts.setState({ drafts: {} });
});
afterEach(() => cleanup());

describe('Scenario Theater', () => {
  it('shows the landing page with every scenario as a question', () => {
    open(null);
    render(<Theater />);
    expect(screen.getByTestId('theater-landing')).toBeInTheDocument();
    for (const s of baseModel.scenarios) expect(document.querySelector(`[data-scenario="${s.id}"]`)).not.toBeNull();
  });

  it('steps forward with the transport and the keyboard', () => {
    open('ops-approval');
    render(<Theater />);
    const n = visibleSteps(baseModel.scenario('ops-approval')!, 'approve', 3).length;
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 1 of ${n}`);
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 2 of ${n}`);
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 3 of ${n}`);
    fireEvent.click(screen.getByLabelText('Restart'));
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 1 of ${n}`);
  });

  it('switches outcome at a decision and stays on the decision step', () => {
    const sc = baseModel.scenario('ops-approval')!;
    const d = visibleSteps(sc, 'approve', 3).findIndex((s) => s.decision);
    open('ops-approval', d);
    render(<Theater />);
    const title = screen.getByTestId('step-title').textContent;
    const reject = screen.getAllByTestId('decision-option').find((b) => b.getAttribute('data-variant') === 'reject')!;
    fireEvent.click(reject);
    expect(useApp.getState().theater.variant).toBe('reject');
    expect(screen.getByTestId('step-title').textContent).toBe(title);
    expect((screen.getByTestId('variant-select') as HTMLSelectElement).value).toBe('reject');
  });

  it('switches views', () => {
    open('login');
    render(<Theater />);
    const sw = screen.getByTestId('view-switch');
    fireEvent.click(sw.querySelector('[data-view="timeline"]')!);
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument();
    fireEvent.click(sw.querySelector('[data-view="stage"]')!);
    expect(screen.getByTestId('stage-view')).toBeInTheDocument();
  });

  it('assembles a trace from the endpoint picker', () => {
    open(null);
    render(<Theater />);
    fireEvent.click(screen.getAllByLabelText('New scenario from endpoint')[0]);
    fireEvent.change(screen.getByTestId('endpoint-search'), { target: { value: 'accounts' } });
    fireEvent.click(document.querySelector('[data-endpoint="ep:GET /api/accounts"]')!);
    expect(useApp.getState().theater.scenarioId).toBe('trace:ep:GET /api/accounts');
    expect(screen.getByTestId('scenario-title')).toHaveTextContent('GET /api/accounts');
  });

  it('explains unknown scenario ids', () => {
    open('custom:not-here');
    render(<Theater />);
    expect(screen.getByTestId('theater-unknown')).toHaveTextContent('not in this browser');
  });

  it('customises, edits and saves a scenario', () => {
    open('trace:ep:GET /api/accounts');
    render(<Theater />);
    act(() => {
      fireEvent.click(screen.getByLabelText('Edit scenario'));
    });
    // The copy is an unsaved draft until Save.
    expect(useWorkspace.getState().customScenarios).toHaveLength(0);
    const drafts = Object.values(useDrafts.getState().drafts);
    expect(drafts).toHaveLength(1);
    expect(useApp.getState().theater.scenarioId).toBe(drafts[0].id);
    // Customising the original again reuses that copy.
    act(() => {
      useApp.setState((s) => ({ theater: { ...s.theater, scenarioId: 'trace:ep:GET /api/accounts' } }));
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Edit scenario'));
    });
    expect(Object.values(useDrafts.getState().drafts)).toHaveLength(1);
    expect(useApp.getState().theater.scenarioId).toBe(drafts[0].id);
    act(() => {
      fireEvent.click(screen.getByLabelText('Save scenario'));
    });
    expect(useWorkspace.getState().customScenarios.map((s) => s.id)).toEqual([drafts[0].id]);
  });

  it('shows workflows involving the selected entity', () => {
    open(null);
    useApp.setState({ selection: { type: 'entity', id: 'ep:POST /api/transfers' } });
    render(<Theater />);
    const box = screen.getByTestId('involving');
    expect(within(box).getByTestId('assemble-trace')).toBeInTheDocument();
    expect(box.querySelectorAll('[data-involving]').length).toBeGreaterThan(0);
  });
});
