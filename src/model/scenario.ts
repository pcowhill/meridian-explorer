/**
 * Scenario engine: which steps are visible, what the example database looks
 * like after each one, how balances derive from it, and how to assemble a
 * starting trace for any endpoint from its contract. Pure functions.
 */
import type {
  Contract,
  DetailLevel,
  FlowStep,
  Scenario,
  ScenarioStep,
  StateEffect,
  StepKind,
  WorldState,
} from './types';
import type { Model } from './model';

// ---------------------------------------------------------------------------
// Step visibility
// ---------------------------------------------------------------------------

export const stepDetail = (s: ScenarioStep): DetailLevel => s.detail ?? 2;

/** Steps of one variant, in order, regardless of detail level. */
export function variantSteps(scenario: Scenario, variantId: string): ScenarioStep[] {
  return scenario.steps.filter((s) => !s.variants || s.variants.includes(variantId));
}

/** Steps of one variant that are shown at the given detail level. */
export function visibleSteps(scenario: Scenario, variantId: string, detail: DetailLevel): ScenarioStep[] {
  const steps = variantSteps(scenario, variantId);
  const shown = steps.filter((s) => stepDetail(s) <= detail);
  // Never show an empty stage: fall back to the least-detailed steps available.
  if (shown.length === 0 && steps.length > 0) {
    const min = Math.min(...steps.map(stepDetail));
    return steps.filter((s) => stepDetail(s) === min);
  }
  return shown;
}

/** Participants that actually appear in the visible steps, in declared order. */
export function activeParticipants(scenario: Scenario, steps: ScenarioStep[]): string[] {
  const used = new Set<string>();
  for (const s of steps) {
    used.add(s.from);
    used.add(s.to);
  }
  const ordered = scenario.participants.filter((p) => used.has(p));
  for (const u of used) if (!ordered.includes(u)) ordered.push(u);
  return ordered;
}

// ---------------------------------------------------------------------------
// Database state replay
// ---------------------------------------------------------------------------

export function cloneState(state: WorldState): WorldState {
  const out: WorldState = {};
  for (const [table, rows] of Object.entries(state)) out[table] = rows.map((r) => ({ ...r }));
  return out;
}

/** Apply effects to a state, returning a new state (input is not mutated). */
export function applyEffects(state: WorldState, effects: StateEffect[] | undefined): WorldState {
  if (!effects?.length) return state;
  const next = cloneState(state);
  for (const ef of effects) {
    const rows = (next[ef.table] ??= []);
    if (ef.op === 'insert' && ef.row) {
      rows.push({ ...ef.row });
    } else if (ef.op === 'update' && ef.id) {
      const i = rows.findIndex((r) => r.id === ef.id);
      if (i >= 0) rows[i] = { ...rows[i], ...ef.set };
    } else if (ef.op === 'delete' && ef.id) {
      const i = rows.findIndex((r) => r.id === ef.id);
      if (i >= 0) rows.splice(i, 1);
    }
  }
  return next;
}

/**
 * The example database after the first `count` steps of `steps` have run.
 * Effects of steps hidden by the detail level still apply — hiding a step from
 * the audience must not change what happened — so pass the full variant step
 * list together with the id of the last visible step that has completed.
 */
export function stateAfter(scenario: Scenario, variantId: string, lastCompletedStepId: string | null): WorldState {
  let state = cloneState(scenario.initialState ?? {});
  if (!lastCompletedStepId) return state;
  for (const step of variantSteps(scenario, variantId)) {
    state = applyEffects(state, step.effects);
    if (step.id === lastCompletedStepId) break;
  }
  return state;
}

/**
 * State before a visible step runs = state after the previous VISIBLE step,
 * plus the effects of any hidden steps between them.
 */
export function stateBefore(scenario: Scenario, variantId: string, stepId: string): WorldState {
  let state = cloneState(scenario.initialState ?? {});
  for (const step of variantSteps(scenario, variantId)) {
    if (step.id === stepId) break;
    state = applyEffects(state, step.effects);
  }
  return state;
}

export type RowChange = 'added' | 'changed' | 'removed' | 'same';

export interface RowDiff {
  id: string;
  change: RowChange;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Field names whose value differs (for `changed`). */
  fields: string[];
}

export interface TableDiff {
  table: string;
  rows: RowDiff[];
  changed: boolean;
}

/** Row-level diff of two states, table by table. */
export function diffStates(before: WorldState, after: WorldState): TableDiff[] {
  const tables = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return tables.map((table) => {
    const b = new Map((before[table] ?? []).map((r) => [String(r.id), r]));
    const a = new Map((after[table] ?? []).map((r) => [String(r.id), r]));
    const rows: RowDiff[] = [];
    for (const [id, row] of a) {
      const prev = b.get(id);
      if (!prev) rows.push({ id, change: 'added', after: row, fields: Object.keys(row) });
      else {
        const fields = [...new Set([...Object.keys(prev), ...Object.keys(row)])].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(row[k]));
        rows.push({ id, change: fields.length ? 'changed' : 'same', before: prev, after: row, fields });
      }
    }
    for (const [id, row] of b) if (!a.has(id)) rows.push({ id, change: 'removed', before: row, fields: [] });
    return { table, rows, changed: rows.some((r) => r.change !== 'same') };
  });
}

// ---------------------------------------------------------------------------
// Balance derivation
// ---------------------------------------------------------------------------

export interface LedgerRow {
  id?: string;
  accountId?: string;
  amountMinor: number;
  direction: 'credit' | 'debit';
  status: 'pending' | 'posted' | 'held' | 'failed' | 'reversed' | 'disputed';
  origin?: string;
  description?: string;
}

export interface Balances {
  currentMinor: number;
  availableMinor: number;
  pendingCreditMinor: number;
  pendingDebitMinor: number;
  heldMinor: number;
}

/** How one entry contributes to each balance — the teaching view of `deriveBalances`. */
export interface EntryContribution {
  current: number;
  available: number;
  rule: string;
}

/**
 * A line-for-line re-implementation of Meridian's `deriveBalances`
 * (packages/shared/src/ledger.ts:90-133), kept here so the explorer can
 * recompute balances live as example rows change. The rules:
 *  - posted / disputed: affect current AND available.
 *  - pending: a credit is tracked but not available; a debit is reserved out of available.
 *  - held: reduces available only.
 *  - failed / reversed: no effect.
 */
export function deriveBalances(entries: readonly LedgerRow[]): Balances {
  let currentMinor = 0;
  let availableMinor = 0;
  let pendingCreditMinor = 0;
  let pendingDebitMinor = 0;
  let heldMinor = 0;
  for (const entry of entries) {
    const c = contributionOf(entry);
    currentMinor += c.current;
    availableMinor += c.available;
    if (entry.status === 'pending') {
      if (entry.direction === 'credit') pendingCreditMinor += entry.amountMinor;
      else pendingDebitMinor += entry.amountMinor;
    } else if (entry.status === 'held') {
      heldMinor += entry.amountMinor;
    }
  }
  return { currentMinor, availableMinor, pendingCreditMinor, pendingDebitMinor, heldMinor };
}

export function contributionOf(entry: LedgerRow): EntryContribution {
  const signed = entry.direction === 'credit' ? entry.amountMinor : -entry.amountMinor;
  switch (entry.status) {
    case 'posted':
      return { current: signed, available: signed, rule: 'Posted: counts in current and available.' };
    case 'disputed':
      return { current: signed, available: signed, rule: 'Disputed: still treated as posted until the dispute is decided.' };
    case 'pending':
      return entry.direction === 'credit'
        ? { current: 0, available: 0, rule: 'Pending credit: tracked, but not spendable yet.' }
        : { current: 0, available: -entry.amountMinor, rule: 'Pending debit: reserved out of available immediately.' };
    case 'held':
      return { current: 0, available: -entry.amountMinor, rule: 'Held: reduces available only.' };
    case 'failed':
      return { current: 0, available: 0, rule: 'Failed: never happened — no effect.' };
    case 'reversed':
      return { current: 0, available: 0, rule: 'Reversed: undone — no effect.' };
    default:
      return { current: 0, available: 0, rule: 'Unknown status: ignored.' };
  }
}

/** Derived balances of one account in an example database. */
export function accountBalances(state: WorldState, accountId: string): Balances {
  const rows = (state.LedgerEntry ?? []).filter((r) => r.accountId === accountId) as unknown as LedgerRow[];
  return deriveBalances(rows);
}

/** Format integer minor units as dollars, e.g. 123456 → "$1,234.56". */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${cents}`;
}

// ---------------------------------------------------------------------------
// Automatic trace assembly
// ---------------------------------------------------------------------------

const FLOW_KIND: Record<FlowStep['kind'], StepKind> = {
  hook: 'guard',
  guard: 'guard',
  validate: 'validate',
  call: 'call',
  'db-read': 'db-read',
  'db-write': 'db-write',
  transaction: 'call',
  emit: 'event',
  decision: 'decision',
  respond: 'response',
};

const FLOW_DETAIL: Record<FlowStep['kind'], DetailLevel> = {
  hook: 4,
  guard: 3,
  validate: 3,
  call: 3,
  'db-read': 4,
  'db-write': 3,
  transaction: 4,
  emit: 3,
  decision: 3,
  respond: 2,
};

/**
 * Build a starting scenario for any endpoint from its contract: who calls it,
 * the request, each server-side flow step in order, and the response. The
 * result is a normal Scenario the presenter can edit, marked `simplified`
 * because nesting and payloads are approximated from the contract.
 */
export function assembleTrace(model: Model, endpointId: string): Scenario | null {
  const contract: Contract | undefined = model.contract(endpointId);
  const endpoint = model.entity(endpointId);
  if (!contract || !endpoint) return null;

  const steps: ScenarioStep[] = [];
  const participants: string[] = [];
  const add = (id: string) => {
    if (model.has(id) && !participants.includes(id)) participants.push(id);
  };
  let n = 0;
  const nextId = () => `auto-${++n}`;

  // --- Who initiates it: prefer a client function that calls the endpoint, and the page calling that.
  const httpCallers = model.incoming(endpointId).filter((r) => r.kind === 'http');
  const callerId = contract.calledBy?.find((c) => model.has(c)) ?? httpCallers[0]?.from;
  const caller = model.entity(callerId);
  let pageId: string | undefined;
  if (caller) {
    if (caller.kind === 'page' || caller.kind === 'component') pageId = caller.id;
    else {
      const callerOfCaller = model
        .incoming(caller.id)
        .filter((r) => r.kind === 'calls')
        .map((r) => model.entity(r.from))
        .find((e) => e && (e.kind === 'page' || e.kind === 'component'));
      pageId = callerOfCaller?.id;
    }
  }
  const app = caller ? model.appOf(caller.id) : undefined;
  const roleId = contract.auth.roles?.length
    ? `role:${contract.auth.roles[0]}`
    : app?.id === 'operations'
      ? 'role:ops_agent'
      : 'role:customer';
  const clientId = caller?.id ?? app?.id ?? (contract.auth.surface === 'operations' ? 'operations' : 'customer');

  if (model.has(roleId)) add(roleId);
  if (pageId) add(pageId);
  add(clientId);
  add(endpointId);

  if (model.has(roleId) && (pageId || clientId)) {
    steps.push({
      id: nextId(),
      kind: 'ui',
      title: 'Someone starts the operation',
      from: roleId,
      to: pageId ?? clientId,
      label: contract.summary,
      narrative: `${model.entity(roleId)?.name ?? 'A user'} triggers this from ${model.entity(pageId ?? clientId)?.name ?? 'the client'}.`,
      detail: 1,
      confidence: 'simplified',
    });
  }
  if (pageId && pageId !== clientId) {
    steps.push({
      id: nextId(),
      kind: 'client',
      title: 'Client code builds the request',
      from: pageId,
      to: clientId,
      label: caller?.name ?? 'call API client',
      narrative: `The page calls ${caller?.name ?? 'its API client'}, which prepares the HTTP request.`,
      detail: 3,
      sources: caller?.sources?.slice(0, 1),
      confidence: 'simplified',
    });
  }
  steps.push({
    id: nextId(),
    kind: 'request',
    title: 'HTTP request',
    from: clientId,
    to: endpointId,
    label: `${contract.method} ${contract.path}`,
    narrative: `${contract.method} ${contract.path}${contract.auth.required ? ' with the session cookie' : ''}${contract.auth.csrf ? ' and the CSRF header' : ''}.`,
    detail: 2,
    payload: {
      title: 'Request',
      format: 'http-request',
      line: `${contract.method} ${contract.path}`,
      data: contract.requestExample ?? null,
      typeRef: contract.bodyTypeRef,
    },
    sources: contract.sources.slice(0, 1),
  });

  let caller2 = endpointId;
  for (const f of contract.flow) {
    if (f.kind === 'respond') continue;
    const target = f.target && model.has(f.target) ? f.target : endpointId;
    const nested = f.kind === 'db-read' || f.kind === 'db-write' || f.kind === 'emit' || f.kind === 'transaction';
    const from = nested ? caller2 : endpointId;
    add(target);
    steps.push({
      id: nextId(),
      kind: FLOW_KIND[f.kind],
      title: f.label,
      from,
      to: target,
      label: f.label,
      narrative: [f.detail, ...(f.rejects ?? []).map((r) => `Rejects with ${r.status}${r.code ? ` ${r.code}` : ''} when ${r.when}.`)].filter(Boolean).join(' ') || f.label,
      detail: FLOW_DETAIL[f.kind],
      sources: f.source ? [f.source] : undefined,
      confidence: f.confidence,
    });
    if (f.kind === 'call' && target !== endpointId) caller2 = target;
  }

  const ok = contract.responses.find((r) => r.status >= 200 && r.status < 300) ?? contract.responses[0];
  steps.push({
    id: nextId(),
    kind: 'response',
    title: 'HTTP response',
    from: endpointId,
    to: clientId,
    label: ok ? `${ok.status} ${ok.description}` : 'response',
    narrative: ok?.description ?? 'The server responds.',
    detail: 2,
    payload: ok ? { title: 'Response', format: 'http-response', line: String(ok.status), data: ok.example ?? null, typeRef: ok.typeRef } : undefined,
  });
  if (pageId) {
    steps.push({
      id: nextId(),
      kind: 'state',
      title: 'The screen updates',
      from: clientId,
      to: pageId,
      label: 'render result',
      narrative: `${model.entity(pageId)?.name ?? 'The page'} shows the outcome.`,
      detail: 1,
      confidence: 'simplified',
    });
  }

  return {
    id: `trace:${endpointId}`,
    title: `${contract.method} ${contract.path}`,
    question: `What happens on ${contract.method} ${contract.path}?`,
    summary: `${contract.summary} — assembled automatically from the endpoint's contract; edit freely.`,
    category: 'custom',
    tags: ['auto-assembled'],
    participants,
    related: [endpointId],
    variants: [{ id: 'main', label: 'Main path', outcome: 'success' }],
    defaultVariant: 'main',
    steps,
    sources: contract.sources,
    confidence: 'simplified',
    custom: true,
  };
}

/** A reusable step harvested from a contract flow, for the step library. */
export interface ReusableStep {
  key: string;
  label: string;
  kind: StepKind;
  target: string;
  detail?: string;
  usedBy: number;
  flow: FlowStep;
}

/** Distinct flow steps across all contracts, most-used first. */
export function reusableSteps(model: Model): ReusableStep[] {
  const map = new Map<string, ReusableStep>();
  for (const c of model.contracts.values()) {
    for (const f of c.flow) {
      if (!f.target || !model.has(f.target) || f.kind === 'respond') continue;
      const key = `${f.kind}:${f.target}`;
      const existing = map.get(key);
      if (existing) existing.usedBy++;
      else map.set(key, { key, label: f.label, kind: FLOW_KIND[f.kind], target: f.target, detail: f.detail, usedBy: 1, flow: f });
    }
  }
  return [...map.values()].sort((a, b) => b.usedBy - a.usedBy || a.label.localeCompare(b.label));
}
