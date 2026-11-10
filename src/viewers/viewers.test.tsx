import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { baseModel, diffStates, type WorldState } from '@/model';
import { BalanceCalculator } from './BalanceCalculator';
import { ContractView } from './ContractView';
import { DbTable } from './DbTable';
import { FieldTable } from './Fields';
import { JsonView } from './JsonView';
import { SequenceDiagram } from './SequenceDiagram';
import { StateMachineView } from './StateMachineView';

describe('JsonView', () => {
  const data = { amountMinor: 25000, memo: null, accounts: [{ id: 'acc_checking', balances: { currentMinor: 1 } }] };

  it('renders nested values and collapses on demand', () => {
    render(<JsonView data={data} defaultDepth={4} />);
    expect(screen.getByText('amountMinor')).toBeInTheDocument();
    expect(screen.getByText('currentMinor')).toBeInTheDocument();
    const collapse = screen.getAllByRole('button', { name: 'Collapse' });
    fireEvent.click(collapse[1]); // collapse `accounts`
    expect(screen.queryByText('currentMinor')).not.toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('marks added and changed fields against another value', () => {
    const { container } = render(<JsonView data={{ status: 'posted', postedAt: 'now' }} compareTo={{ status: 'pending' }} />);
    expect(container.querySelector('[data-path="status"]')).toHaveAttribute('data-diff', 'changed');
    expect(container.querySelector('[data-path="postedAt"]')).toHaveAttribute('data-diff', 'added');
    expect(screen.getByText(/was/)).toBeInTheDocument();
  });

  it('hides a field and can show it again', () => {
    render(<JsonView data={{ a: 1, b: 2 }} hideable showToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide b' }));
    expect(screen.getByText('b: hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show 1 hidden'));
    expect(screen.queryByText('b: hidden')).not.toBeInTheDocument();
  });

  it('reports picked paths', () => {
    const picked: string[] = [];
    render(<JsonView data={data} defaultDepth={4} onPick={(p) => picked.push(p)} />);
    fireEvent.click(screen.getByText('currentMinor'));
    expect(picked).toEqual(['accounts.0.balances.currentMinor']);
  });
});

describe('BalanceCalculator', () => {
  it('recomputes balances when an entry’s status changes', () => {
    render(<BalanceCalculator />);
    expect(screen.getByTestId('balance-current')).toHaveTextContent('$2,409.00');
    expect(screen.getByTestId('balance-available')).toHaveTextContent('$2,289.00');
    // Post the pending bill payment: current drops, available is unchanged.
    const row = document.querySelector('[data-entry="le_003"]') as HTMLElement;
    fireEvent.change(within(row).getByLabelText('Status'), { target: { value: 'posted' } });
    expect(screen.getByTestId('balance-current')).toHaveTextContent('$2,289.00');
    expect(screen.getByTestId('balance-available')).toHaveTextContent('$2,289.00');
    // Reverse the disputed charge: both rise.
    const disputed = document.querySelector('[data-entry="le_006"]') as HTMLElement;
    fireEvent.change(within(disputed).getByLabelText('Status'), { target: { value: 'reversed' } });
    expect(screen.getByTestId('balance-current')).toHaveTextContent('$2,331.10');
  });

  it('adds and removes entries', () => {
    render(<BalanceCalculator />);
    fireEvent.click(screen.getByRole('button', { name: /Add entry/ }));
    expect(screen.getByTestId('balance-available')).toHaveTextContent('$2,239.00');
    fireEvent.click(screen.getByRole('button', { name: 'Remove New entry' }));
    expect(screen.getByTestId('balance-available')).toHaveTextContent('$2,289.00');
  });
});

describe('ContractView', () => {
  const contract = baseModel.contract('ep:POST /api/transfers')!;

  it('shows method, path, auth, body rules, errors and server flow', () => {
    render(<ContractView contract={contract} />);
    expect(screen.getAllByText('/api/transfers').length).toBeGreaterThan(0);
    expect(screen.getByTestId('contract-auth')).toHaveTextContent(/Session required/);
    expect(screen.getByTestId('contract-auth')).toHaveTextContent(/CSRF/);
    expect(screen.getByTestId('contract-auth')).toHaveTextContent(/changes state/);
    const body = screen.getAllByTestId('field-table')[0];
    for (const f of ['fromAccountId', 'toAccountId', 'amountMinor']) expect(within(body).getByText(f)).toBeInTheDocument();
    expect(screen.getByTestId('contract-errors')).toHaveTextContent('insufficient_funds');
    expect(screen.getByTestId('contract-flow').querySelectorAll('li').length).toBe(contract.flow.length);
  });

  it('switches between response statuses', () => {
    const multi = [...baseModel.contracts.values()].find((c) => c.responses.length > 1) ?? contract;
    render(<ContractView contract={multi} />);
    const status = multi.responses[multi.responses.length - 1].status;
    fireEvent.click(screen.getByRole('button', { name: String(status) }));
    expect(screen.getByRole('button', { name: String(status) })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a live probe only for public, read-only endpoints', () => {
    const { unmount } = render(<ContractView contract={contract} />);
    expect(screen.queryByTestId('live-probe')).not.toBeInTheDocument();
    unmount();
    render(<ContractView contract={baseModel.contract('ep:GET /status')!} />);
    expect(screen.getByTestId('live-probe')).toHaveTextContent(/no credentials sent/i);
  });

  it('expands a flow step to its detail and source', () => {
    render(<ContractView contract={contract} />);
    const step = screen.getByTestId('contract-flow').querySelectorAll('li button')[0] as HTMLElement;
    fireEvent.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('DbTable', () => {
  it('highlights inserted and updated rows', () => {
    const before: WorldState = { LedgerEntry: [{ id: 'le_1', status: 'pending', amountMinor: 100 }] };
    const after: WorldState = { LedgerEntry: [{ id: 'le_1', status: 'posted', amountMinor: 100 }, { id: 'le_2', status: 'posted', amountMinor: 5 }] };
    const [diff] = diffStates(before, after);
    const { container } = render(<DbTable table="LedgerEntry" diff={diff} />);
    expect(container.querySelector('[data-row="le_1"]')).toHaveAttribute('data-change', 'changed');
    expect(container.querySelector('[data-row="le_2"]')).toHaveAttribute('data-change', 'added');
    expect(screen.getByText('100 ($1.00)')).toBeInTheDocument();
  });
});

describe('FieldTable', () => {
  it('lists columns with keys, foreign keys and proposed fields', () => {
    const entity = baseModel.entity('db:LedgerEntry')!;
    render(<FieldTable fields={entity.fields!} db proposed={[{ name: 'externalReference', type: 'String?' }]} />);
    expect(screen.getByText('accountId')).toBeInTheDocument();
    expect(screen.getByText('proposed')).toBeInTheDocument();
    expect(document.querySelector('[data-entity="db:Account"]')).toBeInTheDocument();
  });
});

describe('StateMachineView', () => {
  it('draws every state and explains a clicked transition', () => {
    const machine = baseModel.stateMachine('sm:ledger-entry-status')!;
    const { container } = render(<StateMachineView machine={machine} />);
    for (const s of machine.states) expect(container.querySelector(`[data-state="${s.id}"]`)).toBeInTheDocument();
    const t = machine.transitions[0];
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${t.from} to ${t.to}`) })[0]);
    expect(screen.getByTestId('state-machine')).toHaveTextContent(t.label);
  });
});

describe('SequenceDiagram', () => {
  it('draws one lane per participant and one row per step, marking the active step', () => {
    const s = baseModel.scenario('transfer')!;
    const steps = s.steps.filter((st) => !st.variants || st.variants.includes(s.defaultVariant)).slice(0, 6);
    const participants = s.participants.filter((p) => steps.some((st) => st.from === p || st.to === p));
    const clicked: number[] = [];
    const { container } = render(<SequenceDiagram participants={participants} steps={steps} activeIndex={2} onStepClick={(i) => clicked.push(i)} />);
    expect(container.querySelectorAll('[data-lane]').length).toBe(participants.length);
    expect(container.querySelectorAll('[data-step]').length).toBe(steps.length);
    expect(container.querySelector('[data-state="active"]')).toHaveAttribute('data-step', steps[2].id);
    expect(container.querySelectorAll('[data-state="future"]').length).toBe(3);
    fireEvent.click(container.querySelector(`[data-step="${steps[4].id}"]`)!);
    expect(clicked).toEqual([4]);
  });
});
