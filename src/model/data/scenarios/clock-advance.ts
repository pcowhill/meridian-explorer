import type { Scenario, ScenarioStep, SourceRef, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';

/**
 * "What happens when the simulation clock advances?"
 *
 * Sam Operator steps the simulated clock forward from the console. The route
 * moves the SimulationClock singleton, fires every schedule that has come due
 * (reusing the money service, dated at each occurrence's simulated due time),
 * then accrues savings interest for every whole simulated month that elapsed.
 *
 * Example data: two of Avery's schedules created at the seed instant — a monthly
 * $200.00 checking → savings transfer due 2026-10-03 and a monthly $65.00 bill
 * pay to Northside Internet due 2026-10-06. Savings interest is bookmarked at the
 * seed instant (the seed sets `interestAccruedThrough = now`).
 */

const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

const F = {
  page: 'apps/operations/src/pages/SimulationClock.tsx',
  opsApi: 'apps/operations/src/lib/opsApi.ts',
  opsApiBase: 'apps/operations/src/lib/api.ts',
  opsData: 'apps/operations/src/lib/OpsDataContext.tsx',
  opsSocket: 'apps/operations/src/lib/useOpsSocket.ts',
  route: 'apps/backend/src/routes/clock.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  shClock: 'packages/shared/src/clock.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  scheduler: 'apps/backend/src/scheduler/scheduler.ts',
  shSchedules: 'packages/shared/src/schedules.ts',
  movements: 'apps/backend/src/money/movements.ts',
  accrual: 'apps/backend/src/lending/accrual.ts',
  lending: 'apps/backend/src/lending/lending.ts',
  shLending: 'packages/shared/src/lending.ts',
  ledger: 'packages/shared/src/ledger.ts',
  realtime: 'apps/backend/src/realtime.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  test: 'apps/backend/src/routes/clock-schedules.test.ts',
  adr: 'docs/process/decisions/ADR-0002-simulation-clock-and-scheduler.md',
  seed: 'apps/backend/src/seed-apply.ts',
} as const;

// ---- Lanes ------------------------------------------------------------------
const SAM = 'role:ops_agent';
const PAGE = 'op:pages/SimulationClock';
const ROUTE = 'be:routes/clock';
const CLOCK = 'be:clock/clock#advanceClock';
const SCHED = 'be:scheduler/scheduler#runDueSchedules';
const MOVES = 'be:money/movements';
const ACCRUAL = 'be:lending/accrual#runInterestAccrual';
const DB = 'db';
const AVERY = 'role:customer';

// ---- Variants -----------------------------------------------------------------
const FIRES = 'fires-schedules-and-interest';
const NOTHING = 'nothing-due';
const SKIP = 'insufficient-funds-skip';
const BACK = 'backwards-rejected';
const FORBID = 'forbidden-role';
type Month = typeof FIRES | typeof SKIP;
const MONTH: Month[] = [FIRES, SKIP];
const STAFF_FORWARD = [FIRES, NOTHING, SKIP];

// ---- Example values -------------------------------------------------------------
/** Simulated instants. NOW = 2026-10-01T15:00Z is the seed instant. */
const TO_MONTH = '2026-11-01T15:00:00.000Z'; // NOW + 31 days (44,640 minutes)
const TO_HOUR = '2026-10-01T16:00:00.000Z'; // NOW + 1 hour
const DUE_TRANSFER = '2026-10-03T15:00:00.000Z';
const DUE_BILL = '2026-10-06T15:00:00.000Z';
const NEXT_TRANSFER = '2026-11-03T15:00:00.000Z';
const NEXT_BILL = '2026-11-06T15:00:00.000Z';
/** Wall-clock instants — AuditLog.createdAt and Prisma `@updatedAt` columns use the real clock. */
const WALL_CLOCK = '2026-10-01T15:06:00.041Z';
const WALL_TRANSFER = '2026-10-01T15:06:00.087Z';
const WALL_BILL = '2026-10-01T15:06:00.132Z';
const WALL_ACCRUAL = '2026-10-01T15:06:00.188Z';
const WALL_SETUP = '2026-10-01T14:52:10.000Z';

const SCH_T = 'sch_savings';
const SCH_B = 'sch_internet';
const REQ = 'req_101';
const REF = 'MOV-7C21D4';

const SCHEDULE_TRANSFER = {
  id: SCH_T,
  userId: IDS.avery,
  kind: 'internal_transfer',
  fromAccountId: IDS.checking,
  toAccountId: IDS.savings,
  counterparty: null,
  memo: 'Monthly savings',
  amountMinor: 20000,
  frequency: 'monthly',
  nextRunAt: DUE_TRANSFER,
  status: 'active',
  lastRunAt: null,
  runCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};
const SCHEDULE_BILL = {
  id: SCH_B,
  userId: IDS.avery,
  kind: 'bill_pay',
  fromAccountId: IDS.checking,
  toAccountId: null,
  counterparty: 'Northside Internet',
  memo: 'Home internet',
  amountMinor: 6500,
  frequency: 'monthly',
  nextRunAt: DUE_BILL,
  status: 'active',
  lastRunAt: null,
  runCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};
const dto = (row: typeof SCHEDULE_TRANSFER | typeof SCHEDULE_BILL) => ({
  id: row.id,
  kind: row.kind,
  amountMinor: row.amountMinor,
  fromAccountId: row.fromAccountId,
  fromAccountName: 'Everyday Checking',
  toAccountId: row.toAccountId,
  toAccountName: row.toAccountId ? 'Goal Savings' : null,
  counterparty: row.counterparty,
  memo: row.memo,
  frequency: row.frequency,
  status: row.status,
  nextRunAt: row.nextRunAt,
  lastRunAt: row.lastRunAt,
  runCount: row.runCount,
  createdAt: row.createdAt,
});

// Rows the "insufficient funds" setup inserts: an earlier immediate transfer.
const SETUP_EFFECTS: StateEffect[] = [
  { op: 'insert', table: 'LedgerEntry', row: { id: 'le_090', accountId: IDS.checking, amountMinor: 220000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Transfer to Goal Savings', postedAt: WALL_SETUP, createdAt: WALL_SETUP } },
  { op: 'insert', table: 'LedgerEntry', row: { id: 'le_091', accountId: IDS.savings, amountMinor: 220000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Transfer from Everyday Checking', postedAt: WALL_SETUP, createdAt: WALL_SETUP } },
];

const minutesFor = (v: string) => (v === NOTHING ? 60 : 44640);
const toFor = (v: string) => (v === NOTHING ? TO_HOUR : TO_MONTH);

const clockAuditRow = (v: string) => ({
  id: 'aud_101',
  actorId: IDS.sam,
  actorRole: 'ops_agent',
  action: 'clock_advanced',
  entity: 'simulation_clock',
  entityId: 'singleton',
  reason: `Advanced the simulation clock by ${minutesFor(v)} minute(s) to ${toFor(v)} (simulated)`,
  metadata: JSON.stringify({ fromISO: NOW, toISO: toFor(v), minutes: minutesFor(v), actorName: 'Sam Operator' }),
  createdAt: WALL_CLOCK,
});

// Internal-transfer fire (FIRES only).
const LEG_DEBIT = { id: 'le_101', accountId: IDS.checking, amountMinor: 20000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Transfer to Goal Savings — Monthly savings', postedAt: DUE_TRANSFER, createdAt: DUE_TRANSFER };
const LEG_CREDIT = { id: 'le_102', accountId: IDS.savings, amountMinor: 20000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Transfer from Everyday Checking — Monthly savings', postedAt: DUE_TRANSFER, createdAt: DUE_TRANSFER };
const TRANSFER_AUDIT = {
  id: 'aud_102',
  actorId: IDS.avery,
  actorRole: 'customer',
  action: 'money_transfer',
  entity: 'account',
  entityId: IDS.checking,
  reason: 'Transfer $200.00 to Goal Savings (simulated)',
  metadata: JSON.stringify({ amountMinor: 20000, fromAccountId: IDS.checking, toAccountId: IDS.savings, actorName: 'Avery Customer' }),
  createdAt: WALL_TRANSFER,
};
const TRANSFER_FIRED_EVENT = {
  id: 'evt_101',
  channel: 'email',
  direction: 'outbound',
  kind: 'schedule_fired',
  status: 'sent',
  summary: 'Scheduled transfer between your accounts — $200.00 (simulated)',
  detail: `Simulated scheduled payment fired on ${DUE_TRANSFER}.`,
  requestId: null,
  metadata: null,
  createdAt: DUE_TRANSFER,
};

// Internal-transfer skip (SKIP only).
const SKIP_EVENT = {
  id: 'evt_101',
  channel: 'email',
  direction: 'outbound',
  kind: 'schedule_skipped',
  status: 'failed',
  summary: 'Scheduled transfer between your accounts skipped — $200.00 (simulated)',
  detail: 'Simulated: That transfer exceeds the available balance.',
  requestId: null,
  metadata: null,
  createdAt: DUE_TRANSFER,
};
const SKIP_AUDIT = {
  id: 'aud_102',
  actorId: IDS.avery,
  actorRole: 'system',
  action: 'schedule_payment_skipped',
  entity: 'payment_schedule',
  entityId: SCH_T,
  reason: 'That transfer exceeds the available balance.',
  metadata: JSON.stringify({ occurrenceISO: DUE_TRANSFER, code: 'insufficient_funds', amountMinor: 20000 }),
  createdAt: WALL_TRANSFER,
};

// Bill-pay fire (both month variants).
const MOVEMENT_PAYLOAD = {
  kind: 'bill_pay',
  amountMinor: 6500,
  direction: 'outbound',
  accountId: IDS.checking,
  counterparty: 'Northside Internet',
  memo: 'Home internet',
  ledgerEntryIds: ['le_103'],
  reference: REF,
};
const PENDING_ENTRY = { id: 'le_103', accountId: IDS.checking, amountMinor: 6500, direction: 'debit', status: 'pending', origin: 'payment', description: 'Bill payment — Northside Internet', postedAt: null, createdAt: DUE_BILL };
const OPS_REQUEST = {
  id: REQ,
  type: 'bill_pay',
  status: 'pending',
  priority: 'normal',
  summary: 'Bill payment — Northside Internet ($65.00)',
  detail: "A bill payment of $65.00 from the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.",
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: JSON.stringify(MOVEMENT_PAYLOAD),
  lastAction: null,
  lastActorId: null,
  lastActorRole: null,
  lastActorName: null,
  lastActionNote: null,
  resolvedAt: null,
  createdAt: DUE_BILL,
  updatedAt: DUE_BILL,
};
const OPS_REQUEST_DTO = {
  id: REQ,
  type: 'bill_pay',
  status: 'pending',
  priority: 'normal',
  summary: OPS_REQUEST.summary,
  detail: OPS_REQUEST.detail,
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: MOVEMENT_PAYLOAD,
  lastAction: null,
  lastActorName: null,
  lastActionNote: null,
  createdAt: DUE_BILL,
  updatedAt: DUE_BILL,
  resolvedAt: null,
};
const INTAKE_AUDIT = {
  id: 'aud_103',
  actorId: IDS.avery,
  actorRole: 'customer',
  action: 'ops_request_created',
  entity: 'operations_request',
  entityId: REQ,
  reason: 'Bill payment — Northside Internet ($65.00) — submitted by Avery Customer (simulated)',
  metadata: JSON.stringify({ reference: REF, kind: 'bill_pay', ledgerEntryId: 'le_103' }),
  createdAt: WALL_BILL,
};
const RECEIVED_EVENT = {
  id: 'evt_102',
  channel: 'email',
  direction: 'outbound',
  kind: 'movement_received',
  status: 'sent',
  summary: 'Bill payment received — under review (simulated)',
  detail: `Simulated confirmation that ${REF} ($65.00) was received and is awaiting operator review.`,
  requestId: REQ,
  metadata: null,
  createdAt: DUE_BILL,
};
const BILL_FIRED_EVENT = {
  id: 'evt_103',
  channel: 'email',
  direction: 'outbound',
  kind: 'schedule_fired',
  status: 'sent',
  summary: 'Scheduled bill payment — $65.00 (simulated)',
  detail: `Simulated scheduled payment fired on ${DUE_BILL}.`,
  requestId: null,
  metadata: null,
  createdAt: DUE_BILL,
};
/** SimulatedEvent row → DTO (the `metadata` column is not exposed). */
const eventDto = (row: Record<string, unknown>) => {
  const out = { ...row };
  delete out.metadata;
  return out;
};

// Interest (both month variants). Savings balance at accrual time:
//   FIRES: 500000 + 20000 (the fired transfer)              = 520000 → round(520000 × 150 / 120000) = 650
//   SKIP:  500000 + 220000 (the setup transfer), no fire    = 720000 → round(720000 × 150 / 120000) = 900
const SAVINGS_BALANCE: Record<Month, number> = { [FIRES]: 520000, [SKIP]: 720000 };
const INTEREST: Record<Month, number> = { [FIRES]: 650, [SKIP]: 900 };
const fmt = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const interestRow = (v: Month) => ({ id: 'le_104', accountId: IDS.savings, amountMinor: INTEREST[v], direction: 'credit', status: 'posted', origin: 'interest', description: 'Interest earned (simulated)', postedAt: TO_MONTH, createdAt: TO_MONTH });
const interestAudit = (v: Month) => ({
  id: 'aud_104',
  actorId: null,
  actorRole: 'system',
  action: 'interest_accrued_savings',
  entity: 'account',
  entityId: IDS.savings,
  reason: `Accrued ${fmt(INTEREST[v])} savings interest over 1 month(s) (simulated)`,
  metadata: JSON.stringify({ months: 1, creditedMinor: INTEREST[v], throughISO: TO_MONTH }),
  createdAt: WALL_ACCRUAL,
});

const firedSummary = (v: Month) => [
  v === FIRES
    ? { scheduleId: SCH_T, kind: 'internal_transfer', runs: 1, postedMinor: 20000, queuedMinor: 0, skipped: 0, status: 'active' }
    : { scheduleId: SCH_T, kind: 'internal_transfer', runs: 0, postedMinor: 0, queuedMinor: 0, skipped: 1, status: 'active' },
  { scheduleId: SCH_B, kind: 'bill_pay', runs: 1, postedMinor: 0, queuedMinor: 6500, skipped: 0, status: 'active' },
];
const accruedSummary = (v: Month | typeof NOTHING) => ({
  savingsAccountsAccrued: v === NOTHING ? 0 : 1,
  cdsAccrued: 0,
  loansAccrued: 0,
  totalInterestCreditedMinor: v === NOTHING ? 0 : INTEREST[v],
  totalInterestChargedMinor: 0,
  cdsMatured: 0,
});

const OPS_HEADERS = {
  Cookie: 'mer_ops_session=<opaque session token>; mer_csrf=<csrf token>',
  'x-meridian-surface': 'operations',
  'x-meridian-csrf': '<csrf token>',
  'Content-Type': 'application/json',
};

// ---- Per-variant step builders ------------------------------------------------

function clickStep(v: string): ScenarioStep {
  if (v === NOTHING) {
    return {
      id: 'click-hour',
      kind: 'ui',
      title: 'Sam clicks "+1 hour"',
      from: SAM,
      to: PAGE,
      label: 'click +1 hour',
      narrative: 'Sam clicks the "+1 hour" preset under Jump ahead. Its body is `{ hours: 1 }`; `runAdvance` validates it with `validateAdvance` (60 minutes — fine), sets the panel busy and calls `advanceClock(body)`.',
      audience: { executive: 'An employee moves the simulated date forward by one hour.', 'end-user': 'Sam presses "+1 hour".' },
      detail: 1,
      variants: [NOTHING],
      sources: [src(F.page, 103, 108, 'const PRESETS'), src(F.page, 179, 191, 'const runAdvance')],
    };
  }
  return {
    id: 'click-month',
    kind: 'ui',
    title: 'Sam advances 31 days',
    from: SAM,
    to: PAGE,
    label: 'Days = 31 → Advance clock',
    narrative:
      'Sam types 31 in the custom Days field and presses "Advance clock". `submitCustom` builds `{ days: 31, hours: 0 }` (an empty field becomes 0) and calls `runAdvance`, which re-checks it with the shared `validateAdvance` before sending. He uses 31 days rather than the "+1 month" preset because that preset is `{ days: 30 }`: from 1 October it would stop at 31 October 15:00, one day short of the first monthly interest anniversary (1 November 15:00), so no interest would accrue.',
    audience: {
      executive: 'An employee moves the simulated calendar forward one month.',
      'end-user': 'Sam fast-forwards the simulated date by 31 days.',
    },
    detail: 1,
    variants: MONTH,
    sources: [src(F.page, 206, 218, 'function submitCustom'), src(F.page, 103, 108, "{ label: '+1 month', body: { days: 30 } }"), src(F.page, 179, 191, 'const runAdvance')],
  };
}

function requestStep(v: string): ScenarioStep {
  const body = v === NOTHING ? { hours: 1 } : { days: 31, hours: 0 };
  return {
    id: `request-${v === NOTHING ? 'hour' : 'month'}`,
    kind: 'request',
    title: 'POST the advance',
    from: PAGE,
    to: ROUTE,
    label: 'POST /api/ops/clock/advance',
    narrative:
      '`advanceClock(body)` in the operations API client goes through `apiRequest`: `fetch` with `credentials: "include"` (the httpOnly operations session cookie), the `x-meridian-surface: operations` header, and — because it is a POST — the CSRF token from the `mer_csrf` cookie echoed in `x-meridian-csrf`.',
    audience: {
      executive: 'The console sends the request to the bank\'s server.',
      systems: 'One HTTPS POST with a JSON body, the operations session cookie, the surface header and the double-submit CSRF header.',
    },
    detail: 2,
    variants: [v],
    payload: { title: 'Advance request', format: 'http-request', line: 'POST /api/ops/clock/advance', headers: OPS_HEADERS, data: body, typeRef: 'sh:clock#AdvanceClockRequest', highlight: v === NOTHING ? ['hours'] : ['days'] },
    sources: [src(F.opsApi, 116, 121, 'export function advanceClock'), src(F.opsApiBase, 147, 164, 'csrfHeaders()')],
  };
}

function claimStep(which: 'transfer' | 'bill', variants: string[]): ScenarioStep {
  const isT = which === 'transfer';
  const set = { nextRunAt: isT ? NEXT_TRANSFER : NEXT_BILL, status: 'active', updatedAt: TO_MONTH };
  return {
    id: `claim-${which}`,
    kind: 'db-write',
    title: `Claim the ${isT ? 'transfer' : 'bill-pay'} occurrence`,
    from: SCHED,
    to: DB,
    label: `UPDATE PaymentSchedule nextRunAt = ${(isT ? NEXT_TRANSFER : NEXT_BILL).slice(0, 10)}`,
    narrative: `\`fireSchedule\` takes the occurrence at ${isT ? DUE_TRANSFER : DUE_BILL} and computes the following one with \`addInterval(occurrence, 'monthly')\` — one calendar month later, day clamped. Before any money moves it CLAIMS the occurrence: \`nextRunAt\` jumps to ${isT ? NEXT_TRANSFER : NEXT_BILL}, status stays \`active\` (it would become \`completed\` for a one-time schedule), \`updatedAt\` = the new clock time. A crash after this point can lose the occurrence but never double-fire it. ${isT ? NEXT_TRANSFER : NEXT_BILL} is after ${TO_MONTH}, so the catch-up loop runs once.`,
    audience: { dba: `UPDATE PaymentSchedule WHERE id = '${isT ? SCH_T : SCH_B}' SET nextRunAt, status, updatedAt. Autocommit — not in a transaction with the money writes that follow.` },
    detail: 4,
    variants,
    payload: { title: 'PaymentSchedule claim', format: 'row', data: set, highlight: ['nextRunAt'] },
    effects: [{ op: 'update', table: 'PaymentSchedule', id: isT ? SCH_T : SCH_B, set }],
    sources: [src(F.scheduler, 138, 148, 'CLAIM this occurrence first'), src(F.shSchedules, 113, 122, 'export function addInterval')],
  };
}

function billSteps(): ScenarioStep[] {
  return [
    claimStep('bill', MONTH),
    {
      id: 'create-external',
      kind: 'call',
      title: 'Fire the bill pay',
      from: SCHED,
      to: MOVES,
      label: 'createExternalMovement(owner, bill_pay, occurrenceAt)',
      narrative:
        'For a `bill_pay` schedule the scheduler calls the same `createExternalMovement` a manual bill payment uses, as the owner, with `now` = the due instant. It re-checks access, then the outbound funds check: checking\'s available balance must cover $65.00 (it does in both month variants). It also counts Avery\'s pending reviewable movements against the cap of 25 before writing.',
      audience: { executive: 'The monthly internet bill is submitted as a payment that staff must approve.' },
      detail: 3,
      variants: MONTH,
      payload: {
        title: 'createExternalMovement arguments',
        format: 'args',
        data: { user: { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' }, input: { accountId: IDS.checking, kind: 'bill_pay', amountMinor: 6500, direction: 'outbound', counterparty: 'Northside Internet', memo: 'Home internet' }, now: DUE_BILL },
        typeRef: 'sh:money-movement#NormalizedExternalMovement',
        highlight: ['now', 'input.amountMinor'],
      },
      sources: [src(F.scheduler, 166, 184, "kind === 'bill_pay'"), src(F.movements, 280, 308, 'export async function createExternalMovement')],
    },
    {
      id: 'pending-entry',
      kind: 'db-write',
      title: 'Pending payment debit',
      from: MOVES,
      to: DB,
      label: "INSERT LedgerEntry (pending 'payment' debit)",
      narrative:
        'Inside one `prisma.$transaction`: first a PENDING `payment` debit of $65.00 on checking, `postedAt` null, `createdAt` = the due instant. Nothing posts yet; the pending debit reserves the money in the available balance.',
      audience: {
        executive: 'The $65.00 is set aside in checking until an employee approves the payment.',
        'end-user': 'Avery sees a pending $65.00 bill payment to Northside Internet.',
        dba: 'INSERT LedgerEntry, status pending, origin payment, dated at the simulated due time (2026-10-06), not the wall clock.',
      },
      detail: 1,
      variants: MONTH,
      payload: { title: 'LedgerEntry row', format: 'row', data: PENDING_ENTRY, typeRef: 'db:LedgerEntry', highlight: ['status', 'createdAt'] },
      effects: [{ op: 'insert', table: 'LedgerEntry', row: PENDING_ENTRY }],
      sources: [src(F.movements, 314, 328, "status: 'pending'")],
    },
    {
      id: 'ops-request',
      kind: 'db-write',
      title: 'Queue the operator review',
      from: MOVES,
      to: DB,
      label: "INSERT OperationsRequest (type 'bill_pay')",
      narrative:
        'Second write in the transaction: an `OperationsRequest` of type `bill_pay`, status `pending`, priority `normal`, whose JSON payload links the pending ledger entry (`ledgerEntryIds`) and carries the movement reference. This is the item an operator later approves or rejects.',
      audience: {
        executive: 'A review task appears in the operations queue.',
        dba: 'INSERT OperationsRequest. `payload` is a JSON string; the ledger link is soft (inside the JSON), not a foreign key.',
      },
      detail: 2,
      variants: MONTH,
      payload: { title: 'OperationsRequest row', format: 'row', data: OPS_REQUEST, typeRef: 'db:OperationsRequest', highlight: ['type', 'status', 'payload'] },
      effects: [{ op: 'insert', table: 'OperationsRequest', row: OPS_REQUEST }],
      sources: [src(F.movements, 330, 354, 'tx.operationsRequest.create')],
    },
    {
      id: 'intake-audit-event',
      kind: 'db-write',
      title: 'Intake audit + "received" notice',
      from: MOVES,
      to: DB,
      label: "INSERT AuditLog 'ops_request_created' + SimulatedEvent",
      narrative:
        'Still in the same transaction: the intake audit row (actor = Avery, because the schedule owner is the acting principal) and a simulated "received — under review" email event linked to the request. The transaction then commits all four rows together.',
      audience: { dba: 'INSERT AuditLog (createdAt = wall clock default) and INSERT SimulatedEvent (createdAt = the simulated due time).' },
      detail: 5,
      variants: MONTH,
      payload: { title: 'AuditLog + SimulatedEvent rows', format: 'row', data: { auditLog: INTAKE_AUDIT, simulatedEvent: RECEIVED_EVENT }, highlight: ['auditLog.action', 'simulatedEvent.kind'] },
      effects: [
        { op: 'insert', table: 'AuditLog', row: INTAKE_AUDIT },
        { op: 'insert', table: 'SimulatedEvent', row: RECEIVED_EVENT },
      ],
      sources: [src(F.movements, 356, 384, "action: 'ops_request_created'"), src(F.movements, 135, 161, 'export async function recordSimEvent')],
    },
    {
      id: 'bill-bookkeeping',
      kind: 'db-write',
      title: 'Record the bill-pay run',
      from: SCHED,
      to: DB,
      label: 'UPDATE PaymentSchedule runCount + 1; INSERT schedule_fired',
      narrative:
        'Back in `fireSchedule`: the success bookkeeping increments `runCount` and sets `lastRunAt` to the occurrence; then `recordSimEvent` writes a `schedule_fired` notice dated at the occurrence. The ops request and both events are pushed into the scheduler result for the route to broadcast.',
      audience: { dba: 'UPDATE PaymentSchedule SET runCount = runCount + 1, lastRunAt; `updatedAt` is not in the data, so Prisma\'s @updatedAt stamps the wall clock. INSERT SimulatedEvent.' },
      detail: 4,
      variants: MONTH,
      payload: { title: 'Bookkeeping', format: 'row', data: { paymentSchedule: { runCount: 1, lastRunAt: DUE_BILL, updatedAt: WALL_BILL }, simulatedEvent: BILL_FIRED_EVENT }, highlight: ['paymentSchedule.runCount'] },
      effects: [
        { op: 'update', table: 'PaymentSchedule', id: SCH_B, set: { runCount: 1, lastRunAt: DUE_BILL, updatedAt: WALL_BILL } },
        { op: 'insert', table: 'SimulatedEvent', row: BILL_FIRED_EVENT },
      ],
      sources: [src(F.scheduler, 189, 208, 'runCount: { increment: 1 }')],
    },
  ];
}

function accrualSteps(v: Month): ScenarioStep[] {
  const bal = SAVINGS_BALANCE[v];
  const i = INTEREST[v];
  return [
    {
      id: `accrual-plan-${v}`,
      kind: 'call',
      title: 'Plan one month of savings interest',
      from: ACCRUAL,
      to: ACCRUAL,
      label: `round(${bal} × 150 / 120000) = ${i}`,
      narrative: `For Goal Savings the bookmark is \`interestAccruedThrough\` = ${NOW} (set by the seed). \`accountCurrentMinor\` derives the settled balance from the ledger right now — ${fmt(bal)}, ${v === FIRES ? 'including the $200.00 the scheduler just posted' : 'including the earlier $2,200.00 transfer'}. \`planMonthlyAccrual\` steps whole months: the first anniversary, ${TO_MONTH}, is ≤ the new clock time, the second (2026-12-01) is not, so one period. \`monthlyAccrualMinor\` = round(balance × 150 bps / (10000 × 12)) = round(${bal} × 150 / 120000) = ${i} → ${fmt(i)}. The rate is \`DEFAULT_SAVINGS_APY_BPS\` = 150 (1.50%), applied as simple monthly interest at APY/12.`,
      audience: {
        executive: `Savings earn 1.50% a year, credited monthly: ${fmt(i)} this month.`,
        dba: `No interest table — the inputs are Account.interestAccruedThrough and the sum of posted/disputed LedgerEntry rows for the account (${bal}).`,
      },
      detail: 3,
      variants: [v],
      payload: { title: 'AccrualPlan', format: 'return', data: { periods: [{ at: TO_MONTH, interestMinor: i }], newBookmark: TO_MONTH, monthsStepped: 1 }, highlight: ['periods.0.interestMinor'] },
      sources: [
        src(F.accrual, 116, 124, 'interestAccruedThrough ?? acct.openedAt'),
        src(F.accrual, 54, 73, 'function planMonthlyAccrual'),
        src(F.shLending, 101, 112, 'export function monthlyAccrualMinor'),
        src(F.shLending, 69, 70, 'DEFAULT_SAVINGS_APY_BPS = 150'),
      ],
    },
    {
      id: `interest-credit-${v}`,
      kind: 'db-write',
      title: 'Credit savings interest',
      from: ACCRUAL,
      to: DB,
      label: `INSERT LedgerEntry 'interest' credit ${fmt(i)}`,
      narrative: `In one transaction per account, \`postInterest\` writes a bank-originated, POSTED \`interest\` credit of ${fmt(i)} on Goal Savings, dated at the anniversary (${TO_MONTH}). Interest is the only origin here that changes the system-wide settled total.`,
      audience: {
        executive: `The savings account earns ${fmt(i)} of simulated interest.`,
        'end-user': `Avery\'s Goal Savings shows "Interest earned (simulated)" +${fmt(i)}.`,
        dba: 'INSERT LedgerEntry, origin interest, status posted, postedAt = createdAt = the simulated anniversary.',
      },
      detail: 1,
      variants: [v],
      payload: { title: 'LedgerEntry row', format: 'row', data: interestRow(v), typeRef: 'db:LedgerEntry', highlight: ['amountMinor', 'origin', 'postedAt'] },
      effects: [{ op: 'insert', table: 'LedgerEntry', row: interestRow(v) }],
      sources: [src(F.accrual, 125, 130, "'Interest earned (simulated)'"), src(F.accrual, 75, 96, 'async function postInterest')],
    },
    {
      id: `accrual-bookmark-${v}`,
      kind: 'db-write',
      title: 'Advance the bookmark and audit',
      from: ACCRUAL,
      to: DB,
      label: 'UPDATE Account interestAccruedThrough; INSERT AuditLog',
      narrative: `Same transaction: the savings account's \`interestAccruedThrough\` moves to ${TO_MONTH} (whole months only, so a re-run with the same time accrues nothing), and because something was credited a system audit row \`interest_accrued_savings\` is written with no actor id.`,
      audience: { dba: 'UPDATE Account SET interestAccruedThrough (updatedAt via @updatedAt = wall clock); INSERT AuditLog actorRole system, actorId null. Commit.' },
      detail: 4,
      variants: [v],
      payload: { title: 'Bookmark + audit', format: 'row', data: { account: { interestAccruedThrough: TO_MONTH }, auditLog: interestAudit(v) }, highlight: ['account.interestAccruedThrough'] },
      effects: [
        { op: 'update', table: 'Account', id: IDS.savings, set: { interestAccruedThrough: TO_MONTH, updatedAt: WALL_ACCRUAL } },
        { op: 'insert', table: 'AuditLog', row: interestAudit(v) },
      ],
      sources: [src(F.accrual, 131, 143, 'interestAccruedThrough: plan.newBookmark')],
    },
  ];
}

function responseStep(v: Month | typeof NOTHING): ScenarioStep {
  const to = toFor(v);
  const fired = v === NOTHING ? [] : firedSummary(v);
  return {
    id: `response-${v}`,
    kind: 'response',
    title: '200 with what fired',
    from: ROUTE,
    to: PAGE,
    label: '200 OK { clock, fired, accrued }',
    narrative:
      v === NOTHING
        ? 'The route replies 200 with the new clock, an empty `fired` list and an all-zero accrual summary.'
        : 'The route replies 200 with the new clock, one `ScheduleFireSummary` per schedule that ran or skipped, and the accrual summary.',
    detail: 2,
    variants: [v],
    payload: {
      title: 'AdvanceClockResponse',
      format: 'http-response',
      line: '200 OK',
      data: { clock: { currentTime: to, speed: 1 }, fired, accrued: accruedSummary(v) },
      typeRef: 'sh:schedules#AdvanceClockResponse',
      highlight: v === NOTHING ? ['clock.currentTime', 'fired'] : ['clock.currentTime', 'fired', 'accrued.totalInterestCreditedMinor'],
    },
    sources: [src(F.route, 65, 66, 'const response: AdvanceClockResponse')],
  };
}

function summaryStep(v: Month | typeof NOTHING): ScenarioStep {
  const text =
    v === NOTHING
      ? 'The Last advance panel reads "Nothing was due — no schedules fired." and, under Interest accrued, "No interest accrued — no month elapsed for any product."'
      : v === FIRES
        ? 'The Last advance panel lists "Transfer between your accounts · 1 run · Posted $200.00 · Queued $0.00 · Active" and "Bill payment · 1 run · Posted $0.00 · Queued $65.00 · Active", then "1 savings account, 0 CDs, 0 loans · Credited $6.50 · Charged $0.00".'
        : 'The Last advance panel lists "Transfer between your accounts · 0 runs · Posted $0.00 · Queued $0.00 · Skipped 1 · Active" and "Bill payment · 1 run · Queued $65.00 · Active", then "Credited $9.00".';
  return {
    id: `summary-${v}`,
    kind: 'ui',
    title: 'Sam sees the result',
    from: PAGE,
    to: SAM,
    label: v === NOTHING ? 'nothing was due' : 'fired + accrued summary',
    narrative: `\`runAdvance\` shows the new simulated time straight away, stores \`fired\` and \`accrued\`, then reloads the live queue and event feed (\`refresh()\`) and the schedule table (\`fetchSchedules\`) in parallel. ${text}`,
    audience: {
      executive: v === NOTHING ? 'Nothing was due in that hour.' : v === FIRES ? 'The employee sees what the month produced: one transfer made, one bill queued, interest paid.' : 'The employee sees the transfer was skipped for lack of funds; the bill was still queued.',
      'end-user': 'Sam reads the summary of the advance.',
    },
    detail: v === NOTHING ? 1 : 2,
    variants: [v],
    sources: [src(F.page, 188, 194, 'setLastFired(fired)'), src(F.page, 340, 384, 'Last advance'), src(F.page, 63, 100, 'function AccrualSummaryRow'), src(F.opsData, 58, 63, 'const refresh')],
  };
}

function heartbeatStep(v: Month | typeof NOTHING): ScenarioStep {
  const to = toFor(v);
  return {
    id: `heartbeat-${v}`,
    kind: 'event',
    title: 'Heartbeat carries the new time',
    from: DB,
    to: PAGE,
    label: 'sim:heartbeat { simulationTime }',
    narrative:
      'Independently of the request, `emitHeartbeat` in the backend\'s realtime module runs every 10 seconds: it reads the SimulationClock singleton and emits `sim:heartbeat` to every connected socket with the wall-clock `serverTime` and the simulated `simulationTime`. Every operator console (including other operators who did not advance) updates its displayed simulated date from it.',
    audience: { systems: 'Socket.IO broadcast to all clients (not just the ops room) — the simulated date is not sensitive.' },
    detail: 3,
    variants: [v],
    confidence: 'simplified',
    payload: { title: 'sim:heartbeat', format: 'socket', line: 'sim:heartbeat → all sockets', data: { serverTime: '2026-10-01T15:06:08.000Z', simulationTime: to }, typeRef: 'sh:clock#SimHeartbeatPayload', highlight: ['simulationTime'] },
    sources: [src(F.realtime, 43, 45, 'emitHeartbeat(io, prisma)'), src(F.realtime, 59, 68, 'async function emitHeartbeat'), src(F.opsData, 99, 101, 'onHeartbeat'), src(F.page, 118, 120, 'setDisplayTime(simulationTime)')],
  };
}

// ---- Steps ---------------------------------------------------------------------

const steps: ScenarioStep[] = [
  {
    id: 'setup-low-checking',
    kind: 'state',
    title: 'Setup: checking is nearly empty',
    from: DB,
    to: DB,
    label: '$2,200.00 already moved to savings',
    narrative:
      'Example setup for this variant only: earlier the same day Avery moved $2,200.00 from checking to savings with an immediate transfer (immediate transfers are dated by the wall clock). Checking is left with a current balance of $251.10 and — with the existing $120.00 pending bill payment — an available balance of $131.10, less than the $200.00 the transfer schedule needs. The audit row of that earlier transfer is omitted.',
    audience: { executive: 'In this version, the customer has already spent most of her checking balance.' },
    detail: 2,
    variants: [SKIP],
    confidence: 'simplified',
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { currentMinor: 25110, availableMinor: 13110, pendingDebitMinor: 12000 }, highlight: ['availableMinor'] },
    effects: SETUP_EFFECTS,
    sources: [src(F.ledger, 90, 132, 'export function deriveBalances')],
  },
  {
    id: 'open-page',
    kind: 'ui',
    title: 'Sam opens the Simulation clock page',
    from: SAM,
    to: PAGE,
    label: 'open Simulation clock',
    narrative:
      'Sam (ops_agent) opens the Simulation clock page in the operations console. It shows the simulated now (from the live data context, kept fresh by the socket heartbeat) and loads every customer schedule with `GET /api/ops/schedules` — here Avery\'s two active monthly schedules.',
    audience: { 'end-user': 'Sam opens the clock page and sees two upcoming payments.' },
    detail: 2,
    variants: STAFF_FORWARD.concat(BACK),
    payload: {
      title: 'GET /api/ops/schedules → 200',
      format: 'http-response',
      line: '200 OK',
      data: { schedules: [dto(SCHEDULE_TRANSFER), dto(SCHEDULE_BILL)] },
      typeRef: 'sh:schedules#ScheduleListResponse',
      highlight: ['schedules.0.nextRunAt', 'schedules.1.nextRunAt'],
    },
    sources: [src(F.page, 110, 120, 'export function SimulationClock'), src(F.page, 155, 172, 'const loadSchedules'), src(F.route, 75, 78, "app.get('/api/ops/schedules'")],
  },
  {
    id: 'decide-advance',
    kind: 'decision',
    title: 'Which advance, from whom?',
    from: PAGE,
    to: PAGE,
    label: 'how far / which session?',
    narrative: 'What happens depends on how far the clock is moved and who sends the request.',
    detail: 2,
    decision: {
      question: 'What advance is requested, and by whom?',
      options: [
        { label: 'Staff, 31 days forward (funds available)', variant: FIRES, description: 'Both schedules fire; one month of savings interest accrues.' },
        { label: 'Staff, +1 hour', variant: NOTHING, description: 'Nothing is due; only the clock moves.' },
        { label: 'Staff, 31 days forward (checking nearly empty)', variant: SKIP, description: 'The transfer occurrence is skipped and recorded; the bill pay still queues.' },
        { label: 'Staff, −1 day', variant: BACK, description: 'Rejected — the clock only moves forward.' },
        { label: 'A customer session', variant: FORBID, description: '403 — only ops_agent / admin may advance.' },
      ],
    },
  },

  // ---- Backwards: blocked in the console, rejected by the server --------------------
  {
    id: 'type-backwards',
    kind: 'ui',
    title: 'Sam types −1 day',
    from: SAM,
    to: PAGE,
    label: 'Days = -1',
    narrative:
      'Sam types −1 in the Days field. The input has `min={0}` but typing a negative number is still possible. The live `customCheck` runs `validateAdvance({ days: -1, hours: 0 })`: −1440 minutes is below the minimum of 1, so the form shows "Advance the clock forward by at least one minute (the simulation clock cannot rewind)." and the Advance clock button is disabled.',
    audience: { executive: 'The console will not let anyone move the simulated date backwards.', 'end-user': 'The button greys out and a message explains the clock cannot rewind.' },
    detail: 1,
    variants: [BACK],
    sources: [src(F.page, 220, 225, 'const customCheck'), src(F.page, 318, 328, 'disabled={advancing || !customCheck.ok}'), src(F.shClock, 62, 74, 'export function validateAdvance')],
  },
  {
    id: 'request-backwards',
    kind: 'request',
    title: 'The same body sent directly',
    from: PAGE,
    to: ROUTE,
    label: 'POST /api/ops/clock/advance { days: -1 }',
    narrative:
      'The server does not rely on the console. Sending the body anyway — as the integration test does with `advance({ days: -1 })` under a staff session — reaches the route with valid cookies and CSRF header.',
    audience: { systems: 'A scripted POST that bypasses the console\'s pre-check.' },
    detail: 3,
    variants: [BACK],
    confidence: 'simplified',
    payload: { title: 'Advance request', format: 'http-request', line: 'POST /api/ops/clock/advance', headers: OPS_HEADERS, data: { days: -1 }, typeRef: 'sh:clock#AdvanceClockRequest', highlight: ['days'] },
    sources: [src(F.test, 97, 100, 'the clock is forward-only')],
  },

  // ---- Forbidden: a customer session ------------------------------------------------
  {
    id: 'request-customer',
    kind: 'request',
    title: 'A customer session calls the endpoint',
    from: AVERY,
    to: ROUTE,
    label: 'POST /api/ops/clock/advance (customer session)',
    narrative:
      'A request with Avery\'s customer session (as the integration test sends it — no customer screen offers this) asks to advance by one day. Its CSRF header is valid, so the global CSRF hook lets it through to the route\'s guards.',
    audience: { systems: 'POST with the customer session cookie `mer_session` and a valid double-submit CSRF header.' },
    detail: 2,
    variants: [FORBID],
    payload: {
      title: 'Advance request',
      format: 'http-request',
      line: 'POST /api/ops/clock/advance',
      headers: { Cookie: 'mer_session=<opaque session token>; mer_csrf=<csrf token>', 'x-meridian-surface': 'customer', 'x-meridian-csrf': '<csrf token>', 'Content-Type': 'application/json' },
      data: { days: 1 },
      typeRef: 'sh:clock#AdvanceClockRequest',
    },
    sources: [src(F.test, 92, 95, 'a customer cannot advance the clock')],
  },
  {
    id: 'guards-forbidden',
    kind: 'guard',
    title: 'Role check refuses a customer',
    from: ROUTE,
    to: ROUTE,
    label: "requireRole('ops_agent', 'admin') → 403",
    narrative:
      '`requireAuth` resolves the session (Avery, role `customer`). `requireRole("ops_agent", "admin")` does not find `customer` in its list and ends the request with 403 `forbidden`. The handler never runs: the clock does not move and nothing is audited.',
    audience: { executive: 'Only bank staff can move the simulated date.' },
    detail: 3,
    variants: [FORBID],
    sources: [src(F.route, 41, 43, "requireRole('ops_agent', 'admin')"), src(F.guards, 72, 85, 'export function requireRole')],
  },
  {
    id: 'response-forbidden',
    kind: 'response',
    title: '403 forbidden',
    from: ROUTE,
    to: AVERY,
    label: '403 { code: forbidden }',
    narrative: 'The caller receives 403 with the generic access message. No row is written.',
    audience: { executive: 'The request is refused.' },
    detail: 1,
    variants: [FORBID],
    payload: { title: 'ApiErrorResponse', format: 'http-response', line: '403 Forbidden', data: { error: 'You do not have access to this resource.', code: 'forbidden' }, highlight: ['code'] },
    sources: [src(F.guards, 78, 84, "code: 'forbidden'")],
  },

  // ---- Staff forward advances ---------------------------------------------------------
  clickStep(FIRES),
  clickStep(NOTHING),
  requestStep(FIRES),
  requestStep(NOTHING),
  {
    id: 'guards',
    kind: 'guard',
    title: 'CSRF, session, staff role, rate limit',
    from: ROUTE,
    to: ROUTE,
    label: 'csrfHook → requireAuth → requireRole → rateLimit',
    narrative:
      'The global `csrfHook` compares the CSRF header with the `mer_csrf` cookie. The route\'s preHandlers then run in order: `requireAuth` resolves the operations session to Sam, `requireRole("ops_agent", "admin")` accepts him, and `rateLimit("operations")` counts the call against the operator mutation budget (a no-op unless public-demo abuse limits are on).',
    audience: { executive: 'The server confirms this is a signed-in staff member.', systems: 'Fastify onRequest CSRF hook, then the preHandler chain [requireAuth, requireRole, rateLimit].' },
    detail: 3,
    variants: STAFF_FORWARD.concat(BACK),
    sources: [src(F.csrf, 86, 116, 'export async function csrfHook'), src(F.route, 39, 43, "rateLimit('operations')"), src(F.guards, 47, 66, 'export const requireAuth'), src(F.rateLimit, 158, 168, 'export function rateLimit')],
  },
  ...STAFF_FORWARD.map(
    (v): ScenarioStep => ({
      id: `validate-${v}`,
      kind: 'validate',
      title: 'Validate a forward advance',
      from: ROUTE,
      to: ROUTE,
      label: `validateAdvance → ${minutesFor(v)} minutes`,
      narrative:
        'The handler copies only numeric `minutes` / `hours` / `days` from the body and calls the shared `validateAdvance`, which sums them to whole minutes (days × 1440 + hours × 60 + minutes, each truncated) and requires 1 ≤ minutes ≤ 527,040 (366 days).',
      audience: { executive: 'The server checks the step is forward and no more than a year.' },
      detail: 4,
      variants: [v],
      payload: { title: 'NormalizedAdvance', format: 'return', data: { ok: true, errors: {}, value: { minutes: minutesFor(v) } }, typeRef: 'sh:clock#NormalizedAdvance', highlight: ['value.minutes'] },
      sources: [src(F.route, 44, 49, 'validateAdvance({'), src(F.shClock, 52, 74, 'export function validateAdvance'), src(F.shClock, 25, 30, 'ADVANCE_CLOCK_LIMITS')],
    }),
  ),
  {
    id: 'validate-backwards',
    kind: 'validate',
    title: 'Backwards advance rejected',
    from: ROUTE,
    to: ROUTE,
    label: 'validateAdvance → −1440 < 1',
    narrative:
      '`validateAdvance({ days: -1 })` totals −1440 minutes, below `ADVANCE_CLOCK_LIMITS.minMinutes` (1). The handler returns 400 with the validator\'s message and code `invalid_request`. (`advanceClock` has its own `invalid_advance` guard for a non-positive value, but the route never reaches it on this path.)',
    audience: { executive: 'The server refuses to move time backwards.' },
    detail: 3,
    variants: [BACK],
    payload: { title: 'Validation result', format: 'return', data: { ok: false, errors: { amount: 'Advance the clock forward by at least one minute (the simulation clock cannot rewind).' } }, highlight: ['errors.amount'] },
    sources: [src(F.route, 50, 54, "code: 'invalid_request'"), src(F.shClock, 62, 74, 'cannot rewind'), src(F.clock, 72, 74, "'invalid_advance'")],
  },
  {
    id: 'response-backwards',
    kind: 'response',
    title: '400 invalid_request',
    from: ROUTE,
    to: PAGE,
    label: '400 { code: invalid_request }',
    narrative: 'The response is 400; the clock row, schedules and ledger are untouched and no audit row is written.',
    audience: { executive: 'Nothing changes.' },
    detail: 2,
    variants: [BACK],
    payload: { title: 'ApiErrorResponse', format: 'http-response', line: '400 Bad Request', data: { error: 'Advance the clock forward by at least one minute (the simulation clock cannot rewind).', code: 'invalid_request' }, highlight: ['code'] },
    sources: [src(F.route, 50, 54, "code: 'invalid_request'"), src(F.test, 97, 100, 'statusCode).toBe(400)')],
  },
  ...STAFF_FORWARD.map(
    (v): ScenarioStep => ({
      id: `call-advance-${v}`,
      kind: 'call',
      title: 'Advance the clock',
      from: ROUTE,
      to: CLOCK,
      label: 'advanceClock(prisma, minutes, req.user)',
      narrative:
        '`advanceClock` re-checks that `minutes` is a positive integer, reads (upserting if missing) the SimulationClock singleton and computes `to = advanceBy(currentTime, minutes)`.',
      detail: 3,
      variants: [v],
      payload: { title: 'advanceClock arguments', format: 'args', data: { minutes: minutesFor(v), actor: { id: IDS.sam, displayName: 'Sam Operator', role: 'ops_agent' } }, highlight: ['minutes'] },
      sources: [src(F.route, 55, 56, 'advanceClock(prisma, check.value.minutes, req.user!)'), src(F.clock, 62, 76, 'export async function advanceClock')],
    }),
  ),
  {
    id: 'clock-update-month',
    kind: 'db-write',
    title: 'Move the simulated now',
    from: CLOCK,
    to: DB,
    label: `UPDATE SimulationClock currentTime = ${TO_MONTH.slice(0, 10)}`,
    narrative: `The singleton row's \`currentTime\` moves from ${NOW} to ${TO_MONTH}. Every place that dates scheduled money reads this value through \`simulationNow\`.`,
    audience: {
      executive: 'The simulated calendar jumps from 1 October to 1 November.',
      dba: "UPDATE SimulationClock WHERE id = 'singleton' SET currentTime. Not in a transaction with the scheduler's writes; `updatedAt` is stamped with the wall clock by @updatedAt.",
    },
    detail: 1,
    variants: MONTH,
    payload: { title: 'SimulationClock update', format: 'row', data: { id: 'singleton', currentTime: TO_MONTH, speed: 1, updatedAt: WALL_CLOCK }, typeRef: 'db:SimulationClock', highlight: ['currentTime'] },
    effects: [{ op: 'update', table: 'SimulationClock', id: 'singleton', set: { currentTime: TO_MONTH, updatedAt: WALL_CLOCK } }],
    sources: [src(F.clock, 75, 81, 'db.simulationClock.update')],
  },
  {
    id: 'clock-update-hour',
    kind: 'db-write',
    title: 'Move the simulated now',
    from: CLOCK,
    to: DB,
    label: 'UPDATE SimulationClock currentTime = 16:00',
    narrative: `The singleton row's \`currentTime\` moves from ${NOW} to ${TO_HOUR}.`,
    audience: { executive: 'The simulated clock moves forward one hour.', dba: "UPDATE SimulationClock WHERE id = 'singleton' SET currentTime." },
    detail: 1,
    variants: [NOTHING],
    payload: { title: 'SimulationClock update', format: 'row', data: { id: 'singleton', currentTime: TO_HOUR, speed: 1, updatedAt: WALL_CLOCK }, typeRef: 'db:SimulationClock', highlight: ['currentTime'] },
    effects: [{ op: 'update', table: 'SimulationClock', id: 'singleton', set: { currentTime: TO_HOUR, updatedAt: WALL_CLOCK } }],
    sources: [src(F.clock, 75, 81, 'db.simulationClock.update')],
  },
  ...[FIRES, NOTHING, SKIP].map(
    (v): ScenarioStep => ({
      id: `clock-audit-${v}`,
      kind: 'db-write',
      title: 'Audit the advance',
      from: CLOCK,
      to: DB,
      label: "INSERT AuditLog 'clock_advanced'",
      narrative: `\`writeAudit\` records who advanced the clock, by how many minutes and from/to which instants. This happens before any schedule fires, so the advance is audited even if a later step fails. \`advanceClock\` then returns the new clock DTO plus \`from\` and \`to\`.`,
      audience: { executive: 'Every advance is logged with who did it.', dba: 'INSERT AuditLog; metadata is a JSON string; createdAt is the wall-clock column default.' },
      detail: 4,
      variants: [v],
      payload: { title: 'AuditLog row', format: 'row', data: clockAuditRow(v), typeRef: 'db:AuditLog', highlight: ['action', 'metadata'] },
      effects: [{ op: 'insert', table: 'AuditLog', row: clockAuditRow(v) }],
      sources: [src(F.clock, 83, 102, "action: 'clock_advanced'"), src(F.audit, 44, 67, 'export async function writeAudit')],
    }),
  ),
  {
    id: 'run-due',
    kind: 'db-read',
    title: 'Find due schedules',
    from: SCHED,
    to: DB,
    label: 'findMany PaymentSchedule active, nextRunAt ≤ to',
    narrative:
      'The route calls `runDueSchedules(advanced.to)`. It loads every `active` schedule whose `nextRunAt` is not null and at or before the new time, with its owner, oldest due first: the transfer (due 3 Oct) then the bill pay (due 6 Oct). Each is fired by `fireSchedule` inside its own try/catch so one failure cannot strand the rest.',
    audience: { executive: 'The system looks for every payment that has come due in the skipped-over month.' },
    detail: 3,
    variants: MONTH,
    payload: { title: 'Due schedules', format: 'return', data: [SCHEDULE_TRANSFER, SCHEDULE_BILL].map((r) => ({ id: r.id, kind: r.kind, amountMinor: r.amountMinor, nextRunAt: r.nextRunAt, user: { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' } })), highlight: ['0.nextRunAt', '1.nextRunAt'] },
    sources: [src(F.route, 57, 58, 'runDueSchedules(advanced.to)'), src(F.scheduler, 57, 80, 'export async function runDueSchedules')],
  },
  {
    id: 'run-due-none',
    kind: 'db-read',
    title: 'Find due schedules — none',
    from: SCHED,
    to: DB,
    label: 'findMany → []',
    narrative: `\`runDueSchedules(${TO_HOUR})\` finds no active schedule due by 16:00 (the earliest is 3 October), so it returns empty \`fired\`, \`requests\` and \`events\` lists. No PaymentSchedule row changes.`,
    audience: { executive: 'Nothing is due within the hour.' },
    detail: 3,
    variants: [NOTHING],
    payload: { title: 'SchedulerResult', format: 'return', data: { fired: [], requests: [], events: [] }, typeRef: 'be:scheduler/scheduler#SchedulerResult' },
    sources: [src(F.scheduler, 57, 80, 'export async function runDueSchedules')],
  },

  // ---- Transfer schedule -----------------------------------------------------------------
  claimStep('transfer', MONTH),
  {
    id: 'create-transfer',
    kind: 'call',
    title: 'Fire the transfer as Avery',
    from: SCHED,
    to: MOVES,
    label: 'createTransfer(owner, {…}, occurrenceAt)',
    narrative:
      'For an `internal_transfer` the scheduler calls the same `createTransfer` an immediate transfer uses. The acting principal is the schedule OWNER (Avery, built from the joined user row), and `now` is the occurrence\'s simulated due time, not the wall clock. `createTransfer` re-checks that Avery can move money on both accounts and that both are active, then compares checking\'s derived available balance with $200.00.',
    audience: { executive: 'The scheduled $200 savings transfer runs with the customer\'s own permissions.' },
    detail: 3,
    variants: MONTH,
    payload: {
      title: 'createTransfer arguments',
      format: 'args',
      data: { user: { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' }, input: { fromAccountId: IDS.checking, toAccountId: IDS.savings, amountMinor: 20000, memo: 'Monthly savings' }, now: DUE_TRANSFER },
      typeRef: 'sh:money-movement#NormalizedTransfer',
      highlight: ['now', 'user.id'],
    },
    sources: [src(F.scheduler, 82, 89, 'function ownerOf'), src(F.scheduler, 151, 165, "kind === 'internal_transfer'"), src(F.movements, 175, 185, 'export async function createTransfer')],
  },
  {
    id: 'decide-funds',
    kind: 'decision',
    title: 'Enough available in checking?',
    from: MOVES,
    to: MOVES,
    label: 'available ≥ 20000?',
    narrative: 'The funds check uses `deriveBalances` over checking\'s ledger rows: available = posted total − pending debits − held.',
    detail: 3,
    variants: MONTH,
    decision: {
      question: 'Does checking\'s available balance cover $200.00?',
      options: [
        { label: 'Yes — $2,331.10 available', variant: FIRES },
        { label: 'No — $131.10 available', variant: SKIP },
      ],
    },
    sources: [src(F.movements, 81, 89, 'function availableMinor'), src(F.movements, 183, 185, 'insufficient_funds')],
  },
  {
    id: 'transfer-legs',
    kind: 'db-write',
    title: 'Post both transfer legs',
    from: MOVES,
    to: DB,
    label: "INSERT 2 × LedgerEntry 'transfer' (posted)",
    narrative:
      'In one `prisma.$transaction`, a POSTED `transfer` debit on checking and a POSTED `transfer` credit on savings, same amount, both dated at the due time (3 October), plus the `money_transfer` audit row. The pair nets to zero across the bank. The audit actor is Avery (role `customer`), because the scheduler acts as the owner; the advance itself is attributed to Sam in its own row.',
    audience: {
      executive: '$200 moves from checking to savings, dated the day it was due.',
      'end-user': 'Avery sees "Transfer to Goal Savings — Monthly savings" −$200.00 and the matching +$200.00 in savings.',
      dba: 'Two INSERT LedgerEntry rows and one INSERT AuditLog in one transaction; ledger postedAt = createdAt = 2026-10-03T15:00Z (simulated due time); AuditLog.createdAt = wall clock.',
    },
    detail: 1,
    variants: [FIRES],
    payload: { title: 'LedgerEntry rows', format: 'row', data: [LEG_DEBIT, LEG_CREDIT], typeRef: 'db:LedgerEntry', highlight: ['0.postedAt', '1.postedAt'] },
    effects: [
      { op: 'insert', table: 'LedgerEntry', row: LEG_DEBIT },
      { op: 'insert', table: 'LedgerEntry', row: LEG_CREDIT },
      { op: 'insert', table: 'AuditLog', row: TRANSFER_AUDIT },
    ],
    sources: [src(F.movements, 187, 213, "origin: 'transfer'"), src(F.movements, 214, 228, "action: 'money_transfer'")],
  },
  {
    id: 'transfer-bookkeeping',
    kind: 'db-write',
    title: 'Record the transfer run',
    from: SCHED,
    to: DB,
    label: 'UPDATE PaymentSchedule runCount + 1; INSERT schedule_fired',
    narrative: '`fireSchedule` increments `runCount`, sets `lastRunAt` to the occurrence, and writes a `schedule_fired` simulated email dated at the occurrence. `postedMinor` for this schedule becomes 20000.',
    audience: { dba: 'UPDATE PaymentSchedule SET runCount = runCount + 1, lastRunAt (updatedAt via @updatedAt = wall clock); INSERT SimulatedEvent.' },
    detail: 4,
    variants: [FIRES],
    payload: { title: 'Bookkeeping', format: 'row', data: { paymentSchedule: { runCount: 1, lastRunAt: DUE_TRANSFER, updatedAt: WALL_TRANSFER }, simulatedEvent: TRANSFER_FIRED_EVENT }, highlight: ['paymentSchedule.runCount'] },
    effects: [
      { op: 'update', table: 'PaymentSchedule', id: SCH_T, set: { runCount: 1, lastRunAt: DUE_TRANSFER, updatedAt: WALL_TRANSFER } },
      { op: 'insert', table: 'SimulatedEvent', row: TRANSFER_FIRED_EVENT },
    ],
    sources: [src(F.scheduler, 189, 208, 'runCount: { increment: 1 }')],
  },
  {
    id: 'skip-event',
    kind: 'db-write',
    title: 'Record the skipped occurrence',
    from: SCHED,
    to: DB,
    label: "INSERT SimulatedEvent 'schedule_skipped'",
    narrative:
      '`createTransfer` throws `MovementError("insufficient_funds", "That transfer exceeds the available balance.")` before writing anything. `fireSchedule` catches it — the occurrence is already claimed, so it must not rethrow. It counts a skip and writes a FAILED `schedule_skipped` simulated email dated at the occurrence. `runCount` and `lastRunAt` are NOT updated; `nextRunAt` stays at 3 November from the claim.',
    audience: {
      executive: 'The transfer is skipped this month because checking is short; it will try again next month.',
      'end-user': 'Avery gets a (simulated) notice that her $200.00 savings transfer was skipped.',
    },
    detail: 1,
    variants: [SKIP],
    payload: { title: 'SimulatedEvent row', format: 'row', data: SKIP_EVENT, typeRef: 'db:SimulatedEvent', highlight: ['kind', 'status', 'detail'] },
    effects: [{ op: 'insert', table: 'SimulatedEvent', row: SKIP_EVENT }],
    sources: [src(F.scheduler, 209, 232, "'schedule_skipped'"), src(F.movements, 183, 185, "'insufficient_funds'")],
  },
  {
    id: 'skip-audit',
    kind: 'db-write',
    title: 'Audit the skip',
    from: SCHED,
    to: DB,
    label: "INSERT AuditLog 'schedule_payment_skipped'",
    narrative:
      'Then `writeAudit` records `schedule_payment_skipped` on the `payment_schedule`: `actorId` is the owner\'s id but `actorRole` is `system`, `reason` is the error message, and metadata carries the occurrence time, the error code and the amount. Both writes are best-effort (`.catch`) so a logging failure cannot strand the loop.',
    audience: { dba: 'INSERT AuditLog (entity payment_schedule, actorRole system). The integration test asserts this row exists.' },
    detail: 4,
    variants: [SKIP],
    payload: { title: 'AuditLog row', format: 'row', data: SKIP_AUDIT, typeRef: 'db:AuditLog', highlight: ['action', 'metadata'] },
    effects: [{ op: 'insert', table: 'AuditLog', row: SKIP_AUDIT }],
    sources: [src(F.scheduler, 233, 245, "'schedule_payment_skipped'"), src(F.test, 343, 366, 'skips (does not fire) an occurrence with insufficient funds')],
  },

  // ---- Bill-pay schedule -------------------------------------------------------------------
  ...billSteps(),
  // ---- Interest accrual -------------------------------------------------------------------------
  {
    id: 'accrual-call',
    kind: 'call',
    title: 'Run interest accrual',
    from: ROUTE,
    to: ACCRUAL,
    label: 'runInterestAccrual(advanced.to)',
    narrative:
      'After the scheduler (so a payment that just fired is reflected), the route calls `runInterestAccrual` with the new time. It loads every active savings account, then every active lending product (CDs and loans — none in this example).',
    audience: { executive: 'Next, the bank pays interest for any whole month that passed.' },
    detail: 3,
    variants: STAFF_FORWARD,
    sources: [src(F.route, 59, 62, 'runInterestAccrual(advanced.to)'), src(F.accrual, 113, 118, 'export async function runInterestAccrual')],
  },
  {
    id: 'accrual-none',
    kind: 'call',
    title: 'No whole month elapsed',
    from: ACCRUAL,
    to: ACCRUAL,
    label: 'monthsStepped = 0 → skip',
    narrative: `For Goal Savings the bookmark is ${NOW}; the first anniversary (2026-11-01T15:00Z) is after ${TO_HOUR}, so \`planMonthlyAccrual\` steps zero months and the account is skipped without a transaction. A partial month is never accrued. No row changes; the summary stays all zeros.`,
    audience: { executive: 'No interest — a month has not passed yet.' },
    detail: 3,
    variants: [NOTHING],
    payload: { title: 'AccrualPlan', format: 'return', data: { periods: [], newBookmark: NOW, monthsStepped: 0 }, highlight: ['monthsStepped'] },
    sources: [src(F.accrual, 116, 124, 'if (plan.monthsStepped === 0) continue'), src(F.accrual, 54, 73, 'function planMonthlyAccrual')],
  },
  ...accrualSteps(FIRES),
  ...accrualSteps(SKIP),

  // ---- Broadcast + respond ---------------------------------------------------------------------
  ...MONTH.map((v): ScenarioStep => ({
    id: `emit-ops-${v}`,
    kind: 'event',
    title: 'Push the new review and events to operators',
    from: ROUTE,
    to: PAGE,
    label: 'ops:request_changed + ops:external_event',
    narrative:
      '`runDueSchedules` has returned one `ScheduleFireSummary` per schedule that ran or skipped, plus the new ops request and every simulated event it produced. Only after accrual also finishes, the route publishes each new ops request with `requestChanged("created", request)` and each simulated event with `externalEvent(event)` to the `ops` Socket.IO room. Every operator console upserts the Northside Internet bill pay into its queue and prepends the events to its feed. Customer sockets are never in that room.',
    audience: {
      executive: 'Every employee\'s queue shows the new bill payment to review straight away.',
      systems: 'Socket.IO room `ops`: one `ops:request_changed` and three `ops:external_event` messages.',
    },
    detail: 3,
    variants: [v],
    payload: { title: 'ops:request_changed', format: 'socket', line: 'room "ops": 1 × ops:request_changed, 3 × ops:external_event', data: { 'ops:request_changed': { change: 'created', request: OPS_REQUEST_DTO }, 'ops:external_event': [v === FIRES ? TRANSFER_FIRED_EVENT : SKIP_EVENT, RECEIVED_EVENT, BILL_FIRED_EVENT].map((event) => ({ event: eventDto(event) })) }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['ops:request_changed.change'] },
    sources: [src(F.route, 63, 64, "app.opsRealtime.requestChanged('created', request)"), src(F.opsRealtime, 42, 50, 'SOCKET_EVENTS.opsRequestChanged'), src(F.opsSocket, 51, 56, 'SOCKET_EVENTS.opsExternalEvent')],
  })),
  responseStep(FIRES),
  responseStep(NOTHING),
  responseStep(SKIP),
  summaryStep(FIRES),
  summaryStep(NOTHING),
  summaryStep(SKIP),
  heartbeatStep(FIRES),
  heartbeatStep(NOTHING),
  heartbeatStep(SKIP),

  // ---- Outcome ---------------------------------------------------------------------------------
  {
    id: 'balances-fires',
    kind: 'state',
    title: "Avery's balances after the month",
    from: DB,
    to: AVERY,
    label: 'checking avail $2,066.10 · savings $5,206.50',
    narrative:
      'Nothing is pushed to the customer app; the next load re-derives balances from the ledger. Checking: current 250000 − 4890 − 20000 = 225110 ($2,251.10); available = 225110 − 12000 − 6500 pending = 206610 ($2,066.10). Goal Savings: 500000 + 20000 + 650 = 520650 ($5,206.50).',
    audience: {
      executive: 'Savings grew by the transfer plus interest; the internet bill waits for approval.',
      'end-user': 'Avery sees $200.00 moved to savings, $6.50 interest, and a pending $65.00 internet bill.',
      dba: 'No stored balances: the change is four new LedgerEntry rows (two posted transfer legs, one pending payment, one posted interest credit).',
    },
    detail: 1,
    variants: [FIRES],
    payload: { title: 'Derived balances', format: 'json', data: { checking: { before: { currentMinor: 245110, availableMinor: 233110 }, after: { currentMinor: 225110, availableMinor: 206610 } }, savings: { before: { currentMinor: 500000 }, after: { currentMinor: 520650 } } }, highlight: ['savings.after.currentMinor'] },
    sources: [src(F.ledger, 90, 132, 'export function deriveBalances')],
  },
  {
    id: 'balances-skip',
    kind: 'state',
    title: "Avery's balances after the month",
    from: DB,
    to: AVERY,
    label: 'checking avail $66.10 · savings $7,209.00',
    narrative:
      'Checking: current 25110 ($251.10) is unchanged — the transfer never posted; available = 25110 − 12000 − 6500 = 6610 ($66.10). Goal Savings: 720000 + 900 = 720900 ($7,209.00). The transfer schedule is still active and will try again on 3 November.',
    audience: { executive: 'The skipped transfer moved no money; interest was still paid on savings.', 'end-user': 'Avery\'s savings transfer did not happen this month; her internet bill is pending.' },
    detail: 1,
    variants: [SKIP],
    payload: { title: 'Derived balances', format: 'json', data: { checking: { currentMinor: 25110, availableMinor: 6610 }, savings: { currentMinor: 720900 } }, highlight: ['checking.availableMinor'] },
    sources: [src(F.ledger, 90, 132, 'export function deriveBalances')],
  },
];

export const scenario: Scenario = {
  id: 'clock-advance',
  title: 'An operator advances the simulation clock',
  question: 'What happens when the simulation clock advances?',
  summary:
    'Sam Operator moves the simulated date forward. The server checks he is staff and that the step is forward, moves the SimulationClock singleton and audits it, fires every schedule that came due — a savings transfer posts both legs at its due date, a bill pay queues a pending payment for review — then credits one month of savings interest at 1.50% APY. Operators get the new review over the socket and the heartbeat carries the new simulated time.',
  category: 'time',
  tags: ['time', 'money', 'ledger', 'lending', 'audit', 'rbac', 'realtime', 'operations'],
  participants: [SAM, PAGE, ROUTE, CLOCK, SCHED, MOVES, ACCRUAL, DB, AVERY],
  related: [
    'ep:POST /api/ops/clock/advance',
    'ep:GET /api/ops/schedules',
    'be:routes/clock',
    CLOCK,
    'be:clock/clock#simulationNow',
    SCHED,
    'be:scheduler/scheduler#fireSchedule',
    'be:money/movements#createTransfer',
    'be:money/movements#createExternalMovement',
    ACCRUAL,
    'be:lending/accrual#planMonthlyAccrual',
    'sh:clock#validateAdvance',
    'sh:clock#ADVANCE_CLOCK_LIMITS',
    'sh:schedules#addInterval',
    'sh:schedules#AdvanceClockResponse',
    'sh:schedules#ScheduleFireSummary',
    'sh:lending#monthlyAccrualMinor',
    'sh:lending#DEFAULT_SAVINGS_APY_BPS',
    'op:pages/SimulationClock',
    'op:lib/opsApi#advanceClock',
    'be:realtime#emitHeartbeat',
    'ev:sim:heartbeat',
    'ev:ops:request_changed',
    'db:SimulationClock',
    'db:PaymentSchedule',
    'db:LedgerEntry',
    'db:OperationsRequest',
    'db:AuditLog',
    'db:SimulatedEvent',
    'db:Account',
    'feat:clock',
    'feat:schedules',
    'feat:interest',
  ],
  variants: [
    { id: FIRES, label: 'Schedules fire + interest', description: 'A 31-day advance fires the $200.00 transfer and the $65.00 bill pay and credits $6.50 of savings interest.', outcome: 'success' },
    { id: NOTHING, label: 'Nothing due', description: 'A one-hour advance: only the clock row and its audit row change.', outcome: 'info' },
    { id: SKIP, label: 'Insufficient funds', description: 'Checking cannot cover the $200.00 transfer: the occurrence is skipped and recorded, the schedule moves on to next month; the bill pay still queues.', outcome: 'success' },
    { id: BACK, label: 'Backwards', description: 'A negative advance is blocked in the console and rejected by the server with 400 invalid_request.', outcome: 'rejected' },
    { id: FORBID, label: 'Customer session', description: 'A customer session is refused with 403 forbidden.', outcome: 'rejected' },
  ],
  defaultVariant: FIRES,
  initialState: (() => {
    const base = baseState();
    return {
      ...base,
      Account: base.Account.map((a) => (a.id === IDS.savings ? { ...a, interestAccruedThrough: NOW } : a)),
      PaymentSchedule: [SCHEDULE_TRANSFER, SCHEDULE_BILL],
    };
  })(),
  watchAccounts: [IDS.checking, IDS.savings],
  steps,
  sources: [
    src(F.route, 43, 73, "app.post('/api/ops/clock/advance'"),
    src(F.clock, 62, 103, 'export async function advanceClock'),
    src(F.scheduler, 91, 253, 'async function fireSchedule'),
    src(F.accrual, 107, 154, 'export async function runInterestAccrual'),
    src(F.seed, 377, 381, 'interestAccruedThrough: now', 'The seed bookmarks savings interest at the seed instant'),
    src(F.test, 192, 267, 'firing due schedules on clock advance'),
    src(F.adr, 20, 43, 'The clock is the authoritative "now" for money dating'),
  ],
};
