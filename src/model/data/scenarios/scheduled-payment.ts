import type { Scenario, ScenarioStep, SourceRef, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';

/**
 * "How does a customer set up a recurring payment?"
 *
 * Avery creates a schedule on the Scheduled payments page. The shared validator
 * runs in the form and again on the server; the service checks account access
 * and the active-schedule cap, then stores the INSTRUCTIONS only — no money
 * moves until an operator advances the simulation clock (see `clock-advance`).
 *
 * The simulation clock sits at the seed instant NOW (2026-10-01T15:00Z) and
 * nobody advances it while Avery is on the page.
 */

const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

const F = {
  page: 'apps/customer/src/pages/ScheduledPayments.tsx',
  lib: 'apps/customer/src/lib/schedules.ts',
  route: 'apps/backend/src/routes/schedules.ts',
  svc: 'apps/backend/src/scheduler/schedules.ts',
  shSchedules: 'packages/shared/src/schedules.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  access: 'apps/backend/src/auth/access.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  caps: 'packages/shared/src/public-demo.ts',
  scheduler: 'apps/backend/src/scheduler/scheduler.ts',
  movements: 'apps/backend/src/money/movements.ts',
  test: 'apps/backend/src/routes/clock-schedules.test.ts',
} as const;

// ---- Lanes ------------------------------------------------------------------
const AVERY = 'role:customer';
const PAGE = 'cu:pages/ScheduledPayments';
const VALIDATE = 'sh:schedules#validateCreateSchedule';
const LIB = 'cu:lib/schedules';
const ROUTE = 'be:routes/schedules';
const SVC = 'be:scheduler/schedules';
const DB = 'db';
const SCHED = 'be:scheduler/scheduler#runDueSchedules';

// ---- Variants -----------------------------------------------------------------
const BILL = 'monthly-bill-pay';
const ONCE = 'one-time-transfer';
const CANCEL = 'cancelled';
const INVALID = 'invalid';
type Kind = 'bill' | 'transfer';
const variantsOf = (k: Kind) => (k === 'bill' ? [BILL, CANCEL] : [ONCE]);

// ---- Example values ---------------------------------------------------------------
const WALL_CREATE = '2026-10-01T15:02:31.000Z';
const WALL_CANCEL = '2026-10-01T15:04:12.000Z';

interface Spec {
  id: string;
  body: Record<string, unknown>;
  row: Record<string, unknown>;
  dto: Record<string, unknown>;
  audit: Record<string, unknown>;
  firstRun: string;
}

function spec(k: Kind): Spec {
  const isBill = k === 'bill';
  const id = isBill ? 'sch_internet' : 'sch_once';
  const firstRunInDays = isBill ? 5 : 3;
  const firstRun = isBill ? '2026-10-06T15:00:00.000Z' : '2026-10-04T15:00:00.000Z';
  const body = isBill
    ? { kind: 'bill_pay', fromAccountId: IDS.checking, toAccountId: null, counterparty: 'Northside Internet', memo: 'Home internet', amountMinor: 6500, frequency: 'monthly', firstRunInDays }
    : { kind: 'internal_transfer', fromAccountId: IDS.checking, toAccountId: IDS.savings, counterparty: null, memo: 'Emergency fund top-up', amountMinor: 50000, frequency: 'once', firstRunInDays };
  const row = {
    id,
    userId: IDS.avery,
    kind: body.kind,
    fromAccountId: IDS.checking,
    toAccountId: body.toAccountId,
    counterparty: body.counterparty,
    memo: body.memo,
    amountMinor: body.amountMinor,
    frequency: body.frequency,
    nextRunAt: firstRun,
    status: 'active',
    lastRunAt: null,
    runCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const dto = {
    id,
    kind: body.kind,
    amountMinor: body.amountMinor,
    fromAccountId: IDS.checking,
    fromAccountName: 'Everyday Checking',
    toAccountId: body.toAccountId,
    toAccountName: isBill ? null : 'Goal Savings',
    counterparty: body.counterparty,
    memo: body.memo,
    frequency: body.frequency,
    status: 'active',
    nextRunAt: firstRun,
    lastRunAt: null,
    runCount: 0,
    createdAt: NOW,
  };
  const audit = {
    id: 'aud_201',
    actorId: IDS.avery,
    actorRole: 'customer',
    action: 'schedule_created',
    entity: 'payment_schedule',
    entityId: id,
    reason: isBill
      ? `Scheduled Bill payment $65.00 (Monthly; first run ${firstRun}) (simulated)`
      : `Scheduled Transfer between your accounts $500.00 (One time; first run ${firstRun}) (simulated)`,
    metadata: JSON.stringify({ kind: body.kind, amountMinor: body.amountMinor, frequency: body.frequency, fromAccountId: IDS.checking, toAccountId: body.toAccountId, firstRunInDays, actorName: 'Avery Customer' }),
    createdAt: WALL_CREATE,
  };
  return { id, body, row, dto, audit, firstRun };
}
const S: Record<Kind, Spec> = { bill: spec('bill'), transfer: spec('transfer') };

const CUSTOMER_HEADERS = {
  Cookie: 'mer_session=<opaque session token>; mer_csrf=<csrf token>',
  'x-meridian-csrf': '<csrf token>',
  'Content-Type': 'application/json',
};
const CREATED_MESSAGE = 'Your schedule was created (SIMULATION). It will run when the simulation clock reaches its next run date — nothing has moved yet.';

// ---- Per-kind create steps ------------------------------------------------------

function createSteps(k: Kind): ScenarioStep[] {
  const s = S[k];
  const v = variantsOf(k);
  const isBill = k === 'bill';
  return [
    {
      id: `fill-${k}`,
      kind: 'ui',
      title: isBill ? 'Avery sets up a monthly bill pay' : 'Avery sets up a one-time transfer',
      from: AVERY,
      to: PAGE,
      label: isBill ? 'Pay a bill · $65.00 · Monthly · in 5 days' : 'Transfer · $500.00 · One time · in 3 days',
      narrative: isBill
        ? 'Avery picks "Pay a bill", Pay from = Everyday Checking, Biller = "Northside Internet", Amount = 65.00, How often = Monthly, First run in = 5 days, Memo = "Home internet", and presses "Schedule payment". The account selector only lists active, non-viewer accounts.'
        : 'Avery keeps "Transfer between your accounts", From = Everyday Checking, To = Goal Savings, Amount = 500.00, How often = One time, First run in = 3 days, Memo = "Emergency fund top-up", and presses "Schedule payment".',
      audience: {
        executive: isBill ? 'The customer sets up her internet bill to be paid every month.' : 'The customer schedules a single future transfer to her savings.',
        'end-user': isBill ? 'Avery schedules a $65.00 monthly payment to Northside Internet, starting in 5 days.' : 'Avery schedules $500.00 to move to savings in 3 days.',
      },
      detail: 1,
      variants: v,
      sources: [src(F.page, 273, 276, 'const KIND_OPTIONS'), src(F.page, 56, 59, 'function movableAccounts'), src(F.page, 474, 514, 'SCHEDULE_FREQUENCIES.map')],
    },
    {
      id: `client-validate-${k}`,
      kind: 'validate',
      title: 'Validate in the browser',
      from: PAGE,
      to: VALIDATE,
      label: 'validateCreateSchedule(form)',
      narrative:
        '`handleSubmit` converts the dollar string to minor units with `toMinor` and runs the shared `validateCreateSchedule` — the same function the server runs. It checks shape only: a known kind, a from account, a distinct to account (transfer) or a non-empty biller trimmed to 80 characters (bill pay), an integer amount of 1 – 5,000,000 minor units, a known frequency, and 0 – 365 days to the first run. The memo is trimmed to 140 characters or null.',
      detail: 4,
      variants: v,
      payload: { title: 'NormalizedCreateSchedule', format: 'return', data: { ok: true, errors: {}, value: s.body }, typeRef: 'sh:schedules#NormalizedCreateSchedule', highlight: ['value.amountMinor', 'value.frequency', 'value.firstRunInDays'] },
      sources: [src(F.page, 327, 351, 'const check = validateCreateSchedule'), src(F.shSchedules, 202, 271, 'export function validateCreateSchedule'), src(F.shSchedules, 52, 61, 'export const SCHEDULE_LIMITS')],
    },
    {
      id: `request-${k}`,
      kind: 'request',
      title: 'POST the schedule',
      from: LIB,
      to: ROUTE,
      label: 'POST /api/schedules',
      narrative:
        'The page passes the normalized value to `createSchedule` in the customer schedules client. `jsonInit` adds `credentials: "include"` (the httpOnly `mer_session` cookie) and the CSRF double-submit header; the customer app sends no surface header, so the backend reads the customer cookie by default.',
      audience: { executive: 'The app sends the instruction to the bank\'s server.', systems: 'HTTPS POST, JSON body, customer session cookie + CSRF header.' },
      detail: 2,
      variants: v,
      payload: { title: 'CreateScheduleRequest', format: 'http-request', line: 'POST /api/schedules', headers: CUSTOMER_HEADERS, data: s.body, typeRef: 'sh:schedules#CreateScheduleRequest', highlight: ['kind', 'frequency', 'firstRunInDays'] },
      sources: [src(F.page, 352, 353, 'await createSchedule(check.value)'), src(F.lib, 133, 141, 'export function createSchedule'), src(F.lib, 42, 49, 'const jsonInit')],
    },
    {
      id: `guards-${k}`,
      kind: 'guard',
      title: 'CSRF, session, rate limit',
      from: ROUTE,
      to: ROUTE,
      label: "csrfHook → requireAuth → rateLimit('schedules')",
      narrative:
        'The global CSRF hook compares the header with the `mer_csrf` cookie. The route\'s preHandlers then resolve the session to Avery (`requireAuth`) and count the call in the `schedules` bucket (20 per 5 minutes, enforced only in public-demo mode). There is no role guard: any signed-in user may schedule on their own accounts.',
      detail: 3,
      variants: v,
      sources: [src(F.csrf, 86, 116, 'export async function csrfHook'), src(F.route, 63, 66, "rateLimit('schedules')"), src(F.guards, 47, 66, 'export const requireAuth'), src(F.caps, 94, 94, 'schedules:')],
    },
    {
      id: `server-validate-${k}`,
      kind: 'validate',
      title: 'Validate again on the server',
      from: ROUTE,
      to: VALIDATE,
      label: 'validateCreateSchedule(body)',
      narrative: 'The handler copies only correctly-typed fields from the body (strings cut to 500 characters) and runs the same shared validator. It passes, so the handler reads the simulated now and calls the service.',
      detail: 4,
      variants: v,
      sources: [src(F.route, 66, 80, 'validateCreateSchedule({')],
    },
    {
      id: `sim-now-${k}`,
      kind: 'db-read',
      title: 'Read the simulated now',
      from: ROUTE,
      to: DB,
      label: 'simulationNow() → SimulationClock',
      narrative: `\`simulationNow\` reads (upserting if missing) the SimulationClock singleton: ${NOW}. The first due date is computed from this simulated time, not the wall clock.`,
      audience: { dba: "SimulationClock upsert WHERE id = 'singleton' with an empty update — effectively a read." },
      detail: 4,
      variants: v,
      payload: { title: 'now', format: 'return', data: NOW },
      sources: [src(F.route, 81, 83, 'await simulationNow(prisma)'), src(F.clock, 53, 60, 'export async function simulationNow')],
    },
    {
      id: `access-${k}`,
      kind: 'db-read',
      title: isBill ? 'Check access to the source account' : 'Check access to both accounts',
      from: SVC,
      to: DB,
      label: 'requireSchedulableAccount',
      narrative: isBill
        ? '`createSchedule` calls `requireSchedulableAccount` for the source account: the account must exist (else 404 `not_found`), Avery\'s relationship must be owner, joint or authorized — never viewer (else 403 `forbidden`), and it must be active (else 400 `inactive_account`). Avery owns Everyday Checking.'
        : '`createSchedule` checks the source account with `requireSchedulableAccount`; for an internal transfer it also requires a destination different from the source and runs the same check on Goal Savings. Avery owns both.',
      audience: { executive: 'The bank confirms the customer may move money from that account.' },
      detail: 4,
      variants: v,
      sources: [src(F.svc, 79, 90, 'async function requireSchedulableAccount'), src(F.svc, 98, 110, 'export async function createSchedule'), src(F.access, 72, 87, 'export async function getAccountRelationship')],
    },
    {
      id: `cap-${k}`,
      kind: 'db-read',
      title: 'Check the active-schedule cap',
      from: SVC,
      to: DB,
      label: "count PaymentSchedule status='active'",
      narrative: 'The service counts Avery\'s active schedules. At 25 (`RESOURCE_CAPS.activeSchedulesPerUser`) it would refuse with 409 `limit_reached`; completed and cancelled schedules do not count. Avery has none.',
      detail: 5,
      variants: v,
      payload: { title: 'Active schedules', format: 'return', data: 0 },
      sources: [src(F.svc, 112, 121, 'activeSchedulesPerUser'), src(F.caps, 119, 122, 'activeSchedulesPerUser: 25')],
    },
    {
      id: `insert-${k}`,
      kind: 'db-write',
      title: 'Store the schedule',
      from: SVC,
      to: DB,
      label: 'INSERT PaymentSchedule',
      narrative: `\`nextRunAt\` = now + ${s.body.firstRunInDays} × 24 h = ${s.firstRun}. The row stores only the instruction: kind, accounts${isBill ? ', biller' : ''}, amount, frequency, the first due date, status \`active\` and run bookkeeping at zero. ${isBill ? '`toAccountId` is forced to null for a bill pay.' : '`counterparty` is forced to null for a transfer.'} No ledger entry is written.`,
      audience: {
        executive: 'The instruction is saved. No money moves yet.',
        'end-user': `Avery's ${isBill ? 'bill payment' : 'transfer'} is scheduled for ${isBill ? '6 October' : '4 October'}.`,
        dba: 'INSERT PaymentSchedule; createdAt and updatedAt are set explicitly to the SIMULATED now, not the column defaults.',
      },
      detail: 1,
      variants: v,
      payload: { title: 'PaymentSchedule row', format: 'row', data: s.row, typeRef: 'db:PaymentSchedule', highlight: ['nextRunAt', 'status', 'runCount'] },
      effects: [{ op: 'insert', table: 'PaymentSchedule', row: s.row }],
      sources: [src(F.svc, 123, 141, 'prisma.paymentSchedule.create')],
    },
    {
      id: `audit-${k}`,
      kind: 'db-write',
      title: 'Audit the new schedule',
      from: SVC,
      to: DB,
      label: "INSERT AuditLog 'schedule_created'",
      narrative: '`writeAudit` records the creation with a human-readable reason (kind label, amount, frequency, first run) and metadata including `firstRunInDays`. Not in a transaction with the insert.',
      audience: { dba: 'INSERT AuditLog; metadata is a JSON string; createdAt = wall clock.' },
      detail: 4,
      variants: v,
      payload: { title: 'AuditLog row', format: 'row', data: s.audit, typeRef: 'db:AuditLog', highlight: ['action', 'reason'] },
      effects: [{ op: 'insert', table: 'AuditLog', row: s.audit }],
      sources: [src(F.svc, 143, 163, "action: 'schedule_created'"), src(F.audit, 44, 67, 'export async function writeAudit')],
    },
    {
      id: `response-${k}`,
      kind: 'response',
      title: '201 Created',
      from: ROUTE,
      to: LIB,
      label: '201 { schedule, message }',
      narrative: 'The route replies 201 with the schedule DTO (account names joined in) and a confirmation that nothing has moved yet.',
      detail: 2,
      variants: v,
      payload: { title: 'CreateScheduleResponse', format: 'http-response', line: '201 Created', data: { schedule: s.dto, message: CREATED_MESSAGE }, typeRef: 'sh:schedules#CreateScheduleResponse', highlight: ['schedule.nextRunAt', 'message'] },
      sources: [src(F.route, 84, 89, 'reply.code(201)'), src(F.svc, 59, 77, 'export function toScheduleDTO')],
    },
    {
      id: `confirm-${k}`,
      kind: 'ui',
      title: 'The schedule appears',
      from: PAGE,
      to: AVERY,
      label: 'confirmation + new card',
      narrative: `\`requestSchedule\` returns \`{ ok: true, data }\`; the form resets and \`handleCreated\` prepends the schedule to the list and shows the server's message. The new card reads "${isBill ? 'Bill payment · Monthly · Everyday Checking → Northside Internet · $65.00 · ACTIVE · Next run Oct 6, 2026' : 'Transfer between your accounts · One time · Everyday Checking → Goal Savings · $500.00 · ACTIVE · Next run Oct 4, 2026'} · Times run 0" with a "Cancel schedule" button.`,
      audience: { executive: 'The customer sees her scheduled payment, with the date it will first run.', 'end-user': 'Avery sees the confirmation and the new scheduled payment in her list.' },
      detail: 1,
      variants: v,
      sources: [src(F.lib, 99, 126, 'async function requestSchedule'), src(F.page, 354, 358, 'onCreated(result.data.schedule, result.data.message)'), src(F.page, 758, 762, 'function handleCreated'), src(F.page, 618, 654, 'Times run')],
    },
  ];
}

// ---- Hand-off to the clock ----------------------------------------------------------

const FIRE_BILL_EFFECTS: StateEffect[] = [
  { op: 'insert', table: 'LedgerEntry', row: { id: 'le_103', accountId: IDS.checking, amountMinor: 6500, direction: 'debit', status: 'pending', origin: 'payment', description: 'Bill payment — Northside Internet', postedAt: null, createdAt: '2026-10-06T15:00:00.000Z' } },
  { op: 'update', table: 'PaymentSchedule', id: 'sch_internet', set: { nextRunAt: '2026-11-06T15:00:00.000Z', status: 'active', runCount: 1, lastRunAt: '2026-10-06T15:00:00.000Z' } },
];
const FIRE_ONCE_EFFECTS: StateEffect[] = [
  { op: 'insert', table: 'LedgerEntry', row: { id: 'le_101', accountId: IDS.checking, amountMinor: 50000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Transfer to Goal Savings — Emergency fund top-up', postedAt: '2026-10-04T15:00:00.000Z', createdAt: '2026-10-04T15:00:00.000Z' } },
  { op: 'insert', table: 'LedgerEntry', row: { id: 'le_102', accountId: IDS.savings, amountMinor: 50000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Transfer from Everyday Checking — Emergency fund top-up', postedAt: '2026-10-04T15:00:00.000Z', createdAt: '2026-10-04T15:00:00.000Z' } },
  { op: 'update', table: 'PaymentSchedule', id: 'sch_once', set: { nextRunAt: null, status: 'completed', runCount: 1, lastRunAt: '2026-10-04T15:00:00.000Z' } },
];

const listedBill = { ...S.bill.dto };
const firedBill = { ...S.bill.dto, nextRunAt: '2026-11-06T15:00:00.000Z', lastRunAt: '2026-10-06T15:00:00.000Z', runCount: 1 };
const firedOnce = { ...S.transfer.dto, status: 'completed', nextRunAt: null, lastRunAt: '2026-10-04T15:00:00.000Z', runCount: 1 };
const cancelledBill = { ...S.bill.dto, status: 'cancelled', nextRunAt: null };
const CANCEL_AUDIT = {
  id: 'aud_202',
  actorId: IDS.avery,
  actorRole: 'customer',
  action: 'schedule_cancelled',
  entity: 'payment_schedule',
  entityId: 'sch_internet',
  reason: 'Schedule cancelled by the customer (simulated)',
  metadata: JSON.stringify({ actorName: 'Avery Customer' }),
  createdAt: WALL_CANCEL,
};

// ---- Steps ---------------------------------------------------------------------------

const steps: ScenarioStep[] = [
  {
    id: 'open-page',
    kind: 'ui',
    title: 'Avery opens Scheduled payments',
    from: AVERY,
    to: PAGE,
    label: 'open /scheduled-payments',
    narrative:
      'On mount the page fires three requests in parallel: her accounts (for the selectors), `GET /api/clock` for the "Current simulated date" panel, and `GET /api/schedules` for her list — empty so far. The panel explains that schedules fire only when an operator advances the simulation clock.',
    audience: { 'end-user': 'Avery opens Scheduled payments and sees the simulated date and an empty list.' },
    detail: 2,
    payload: { title: 'GET /api/clock → 200', format: 'http-response', line: '200 OK', data: { clock: { currentTime: NOW, speed: 1 } }, typeRef: 'sh:clock#ClockResponse', highlight: ['clock.currentTime'] },
    sources: [src(F.page, 742, 756, 'void fetchClock()'), src(F.page, 709, 726, 'function SimulatedClockPanel')],
  },
  {
    id: 'decide-kind',
    kind: 'decision',
    title: 'What does Avery schedule?',
    from: PAGE,
    to: PAGE,
    label: 'kind / frequency / valid?',
    narrative: 'The form offers two kinds (transfer between own accounts, bill pay) and three frequencies (once, weekly, monthly).',
    detail: 2,
    decision: {
      question: 'What does Avery submit?',
      options: [
        { label: 'Monthly bill pay', variant: BILL },
        { label: 'One-time transfer to savings', variant: ONCE },
        { label: 'Monthly bill pay she later cancels', variant: CANCEL },
        { label: 'A bill pay with no biller', variant: INVALID },
      ],
    },
    sources: [src(F.shSchedules, 21, 33, 'SCHEDULE_FREQUENCIES')],
  },

  // ---- Invalid ------------------------------------------------------------------------------
  {
    id: 'fill-invalid',
    kind: 'ui',
    title: 'Avery forgets the biller',
    from: AVERY,
    to: PAGE,
    label: 'Pay a bill · Biller empty',
    narrative: 'Avery picks "Pay a bill", Everyday Checking, Amount 25.00, Monthly, but leaves Biller empty and presses "Schedule payment".',
    audience: { 'end-user': 'Avery submits a bill payment without saying who to pay.' },
    detail: 1,
    variants: [INVALID],
    sources: [src(F.page, 453, 464, 'id="schedule-biller"')],
  },
  {
    id: 'client-invalid',
    kind: 'validate',
    title: 'The form flags the field',
    from: PAGE,
    to: VALIDATE,
    label: "errors.counterparty = 'Enter the biller’s name.'",
    narrative:
      '`validateCreateSchedule` finds no biller after trimming and returns `ok: false` with `counterparty: "Enter the biller’s name."`. `handleSubmit` sets the field errors and returns — no request is sent. The Biller input shows the message under it.',
    audience: { executive: 'The app catches the mistake before anything is sent.', 'end-user': 'A red message under Biller says "Enter the biller’s name."' },
    detail: 2,
    variants: [INVALID],
    payload: { title: 'Validation result', format: 'return', data: { ok: false, errors: { counterparty: 'Enter the biller’s name.' } }, highlight: ['errors.counterparty'] },
    sources: [src(F.shSchedules, 225, 228, 'Enter the biller’s name.'), src(F.page, 347, 350, 'setErrors(check.errors)')],
  },
  {
    id: 'request-invalid',
    kind: 'request',
    title: 'The same body sent directly',
    from: LIB,
    to: ROUTE,
    label: 'POST /api/schedules (no counterparty)',
    narrative: 'The server does not trust the form. A request without a biller — as the integration test sends it — passes the guards and reaches the handler\'s own validation.',
    detail: 3,
    variants: [INVALID],
    confidence: 'simplified',
    payload: { title: 'CreateScheduleRequest', format: 'http-request', line: 'POST /api/schedules', headers: CUSTOMER_HEADERS, data: { kind: 'bill_pay', fromAccountId: IDS.checking, amountMinor: 2500, frequency: 'monthly' }, typeRef: 'sh:schedules#CreateScheduleRequest', highlight: ['kind'] },
    sources: [src(F.test, 135, 145, 'rejects a bill-pay schedule with no biller')],
  },
  {
    id: 'response-invalid',
    kind: 'response',
    title: '400 with field errors',
    from: ROUTE,
    to: LIB,
    label: '400 { code: invalid_request, fields }',
    narrative: 'The shared validator fails the same way; `invalid()` replies 400 `invalid_request` with the per-field `fields` map, which the form would merge into its inline errors. Nothing is written.',
    detail: 3,
    variants: [INVALID],
    payload: { title: 'Error response', format: 'http-response', line: '400 Bad Request', data: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { counterparty: 'Enter the biller’s name.' } }, highlight: ['fields.counterparty'] },
    sources: [src(F.route, 57, 61, 'function invalid'), src(F.route, 78, 80, "'Please correct the highlighted fields.'"), src(F.page, 360, 361, 'setErrors(result.fields ?? {})')],
  },

  // ---- Create (bill pay + cancel share these) -------------------------------------------------
  ...createSteps('bill'),
  ...createSteps('transfer'),

  // ---- Keep or cancel? ----------------------------------------------------------------
  {
    id: 'decide-keep',
    kind: 'decision',
    title: 'Keep it or cancel it?',
    from: AVERY,
    to: AVERY,
    label: 'keep / cancel',
    narrative: 'While the schedule is active Avery can cancel it from its card.',
    detail: 2,
    variants: [BILL, CANCEL],
    decision: {
      question: 'Does Avery keep the schedule?',
      options: [
        { label: 'Keep it', variant: BILL },
        { label: 'Cancel it before it runs', variant: CANCEL },
      ],
    },
  },

  // ---- Cancel ----------------------------------------------------------------------------
  {
    id: 'click-cancel',
    kind: 'ui',
    title: 'Avery cancels the schedule',
    from: AVERY,
    to: PAGE,
    label: 'click Cancel schedule',
    narrative: 'Avery presses "Cancel schedule" on the Northside Internet card. `ScheduleItem.cancel` sets the card busy and calls `cancelSchedule(schedule.id)`.',
    audience: { executive: 'The customer stops the recurring payment.', 'end-user': 'Avery cancels the internet bill payment.' },
    detail: 1,
    variants: [CANCEL],
    sources: [src(F.page, 581, 592, 'async function cancel()'), src(F.page, 642, 654, 'Cancel schedule')],
  },
  {
    id: 'request-cancel',
    kind: 'request',
    title: 'POST the cancel',
    from: LIB,
    to: ROUTE,
    label: 'POST /api/schedules/sch_internet/cancel',
    narrative: 'A POST with no body, the customer session cookie and the CSRF header. The route runs the same `requireAuth` + `rateLimit("schedules")` preHandlers, reads the simulated now and calls `cancelSchedule`.',
    detail: 2,
    variants: [CANCEL],
    payload: { title: 'Cancel request', format: 'http-request', line: 'POST /api/schedules/sch_internet/cancel', headers: { Cookie: CUSTOMER_HEADERS.Cookie, 'x-meridian-csrf': '<csrf token>' }, data: null },
    sources: [src(F.lib, 157, 163, 'export function cancelSchedule'), src(F.route, 100, 109, "app.post('/api/schedules/:id/cancel'")],
  },
  {
    id: 'cancel-checks',
    kind: 'validate',
    title: 'Owner and still active?',
    from: SVC,
    to: DB,
    label: 'findUnique PaymentSchedule',
    narrative:
      '`cancelSchedule` loads the row: unknown id → 404 `not_found`; another user\'s schedule → 403 `forbidden` (ownership is by `userId`, so even a joint holder of the account cannot cancel it); a status other than `active` → 409 `already_inactive`. Avery owns this active schedule.',
    detail: 4,
    variants: [CANCEL],
    sources: [src(F.svc, 185, 192, 'export async function cancelSchedule'), src(F.route, 34, 46, 'function scheduleHttpStatus')],
  },
  {
    id: 'cancel-update',
    kind: 'db-write',
    title: 'Mark it cancelled',
    from: SVC,
    to: DB,
    label: "UPDATE PaymentSchedule status='cancelled', nextRunAt=null",
    narrative: 'The row becomes `cancelled` with `nextRunAt` null — the scheduler only picks `active` rows with a non-null `nextRunAt`, so it can never fire. `updatedAt` is set to the simulated now.',
    audience: {
      executive: 'The payment instruction is switched off; it will never run.',
      'end-user': 'The schedule shows as Cancelled.',
      dba: "UPDATE PaymentSchedule WHERE id = 'sch_internet' SET status, nextRunAt = NULL, updatedAt (simulated). The row is kept, not deleted.",
    },
    detail: 1,
    variants: [CANCEL],
    payload: { title: 'PaymentSchedule update', format: 'row', data: { status: 'cancelled', nextRunAt: null, updatedAt: NOW }, typeRef: 'db:PaymentSchedule', highlight: ['status', 'nextRunAt'] },
    effects: [{ op: 'update', table: 'PaymentSchedule', id: 'sch_internet', set: { status: 'cancelled', nextRunAt: null, updatedAt: NOW } }],
    sources: [src(F.svc, 194, 198, "status: 'cancelled', nextRunAt: null")],
  },
  {
    id: 'cancel-audit',
    kind: 'db-write',
    title: 'Audit the cancel',
    from: SVC,
    to: DB,
    label: "INSERT AuditLog 'schedule_cancelled'",
    narrative: '`writeAudit` records the cancellation by the customer.',
    audience: { dba: 'INSERT AuditLog; createdAt = wall clock.' },
    detail: 4,
    variants: [CANCEL],
    payload: { title: 'AuditLog row', format: 'row', data: CANCEL_AUDIT, typeRef: 'db:AuditLog', highlight: ['action'] },
    effects: [{ op: 'insert', table: 'AuditLog', row: CANCEL_AUDIT }],
    sources: [src(F.svc, 200, 210, "action: 'schedule_cancelled'")],
  },
  {
    id: 'response-cancel',
    kind: 'response',
    title: '200 with the cancelled schedule',
    from: ROUTE,
    to: LIB,
    label: '200 { schedule }',
    narrative: 'The route replies 200 with the updated DTO.',
    detail: 3,
    variants: [CANCEL],
    payload: { title: 'CancelScheduleResponse', format: 'http-response', line: '200 OK', data: { schedule: cancelledBill }, typeRef: 'sh:schedules#CancelScheduleResponse', highlight: ['schedule.status', 'schedule.nextRunAt'] },
    sources: [src(F.route, 103, 105, 'reply.send({ schedule } satisfies CancelScheduleResponse)'), src(F.test, 165, 187, 'cancels an active schedule (owner only); re-cancel is 409')],
  },
  {
    id: 'cancel-ui',
    kind: 'ui',
    title: 'The card shows Cancelled',
    from: PAGE,
    to: AVERY,
    label: 'CANCELLED · Next run —',
    narrative: '`handleCancelled` replaces the schedule in the list by id. The card is dimmed, the badge reads CANCELLED, Next run shows "—" and the Cancel button is gone. A second cancel of the same id would get 409 `already_inactive`.',
    audience: { 'end-user': 'The internet bill schedule now shows as Cancelled.' },
    detail: 2,
    variants: [CANCEL],
    sources: [src(F.page, 764, 770, 'function handleCancelled'), src(F.page, 579, 579, 'const active = isActiveSchedule(schedule.status)')],
  },
  {
    id: 'cancel-never-fires',
    kind: 'note',
    title: 'Later clock advances skip it',
    from: SCHED,
    to: DB,
    label: "WHERE status = 'active' AND nextRunAt ≤ to",
    narrative: 'When an operator later advances the clock past 6 October, `runDueSchedules` selects only active schedules with a due `nextRunAt`, so the cancelled schedule is never loaded and no money moves. The integration test "a cancelled schedule never fires" pins this.',
    audience: { executive: 'No payment is ever made for the cancelled schedule.' },
    detail: 2,
    variants: [CANCEL],
    sources: [src(F.scheduler, 59, 63, "where: { status: 'active', nextRunAt: { not: null, lte: upTo } }"), src(F.test, 368, 386, 'a cancelled schedule never fires')],
  },

  // ---- List, then the clock fires it ---------------------------------------------------------
  {
    id: 'list',
    kind: 'request',
    title: 'Avery revisits her list',
    from: LIB,
    to: ROUTE,
    label: 'GET /api/schedules',
    narrative:
      'Next time the page loads, `fetchSchedules` calls `GET /api/schedules` (session only — no CSRF or rate limit on this read). `listSchedulesForUser` returns only Avery\'s own schedules, ordered by status, then next run, then newest first.',
    detail: 3,
    variants: [BILL],
    payload: { title: 'ScheduleListResponse', format: 'http-response', line: '200 OK', data: { schedules: [listedBill] }, typeRef: 'sh:schedules#ScheduleListResponse', highlight: ['schedules.0.nextRunAt'] },
    sources: [src(F.lib, 143, 150, 'export function fetchSchedules'), src(F.route, 95, 98, "app.get('/api/schedules'"), src(F.svc, 166, 174, 'export async function listSchedulesForUser')],
  },
  {
    id: 'fire-bill',
    kind: 'call',
    title: 'The clock passes 6 October',
    from: SCHED,
    to: DB,
    label: 'fired by clock-advance',
    narrative:
      'Nothing happens until an operator advances the simulation clock past `nextRunAt` (see the "clock-advance" scenario). Then the scheduler claims the occurrence (`nextRunAt` → 6 November, status stays `active`), fires it as Avery through `createExternalMovement` — a PENDING `payment` debit dated 6 October plus a queued `bill_pay` review — and records `runCount` 1 and `lastRunAt`. The ops request, audit and event rows written at the same time are shown in "clock-advance".',
    audience: {
      executive: 'When simulated time reaches the due date, the bill is submitted for staff approval.',
      'end-user': 'On 6 October (simulated) a pending $65.00 payment appears in Avery\'s checking.',
    },
    detail: 1,
    variants: [BILL],
    confidence: 'simplified',
    effects: FIRE_BILL_EFFECTS,
    sources: [src(F.scheduler, 138, 148, 'CLAIM this occurrence first'), src(F.scheduler, 166, 194, "kind === 'bill_pay'"), src(F.movements, 314, 328, "status: 'pending'")],
  },
  {
    id: 'fire-once',
    kind: 'call',
    title: 'The clock passes 4 October',
    from: SCHED,
    to: DB,
    label: 'fired by clock-advance → completed',
    narrative:
      'When an operator advances the clock past 4 October (see "clock-advance"), the scheduler claims the occurrence: `addInterval(occurrence, "once")` returns null, so the claim writes `nextRunAt` = null and status `completed` before any money moves. `createTransfer` then posts both `transfer` legs dated 4 October, and the bookkeeping sets `runCount` 1 and `lastRunAt`. The audit and event rows are shown in "clock-advance".',
    audience: {
      executive: 'On the due date the $500 moves to savings and the one-time schedule is finished.',
      'end-user': '$500.00 moves from checking to savings on 4 October (simulated).',
      dba: 'Claim: UPDATE PaymentSchedule SET nextRunAt = NULL, status = \'completed\'. Then two INSERT LedgerEntry (transfer legs) in one transaction, then UPDATE runCount/lastRunAt.',
    },
    detail: 1,
    variants: [ONCE],
    confidence: 'simplified',
    effects: FIRE_ONCE_EFFECTS,
    sources: [src(F.scheduler, 138, 148, "following === null ? 'completed' : 'active'"), src(F.shSchedules, 113, 117, "case 'once':"), src(F.scheduler, 151, 165, 'await createTransfer('), src(F.test, 231, 249, "expect(summary.status).toBe('completed')")],
  },
  {
    id: 'after-bill',
    kind: 'state',
    title: 'The list shows the run',
    from: PAGE,
    to: AVERY,
    label: 'Times run 1 · Next run Nov 6',
    narrative: 'On her next visit the card reads "Last run Oct 6, 2026 · Next run Nov 6, 2026 · Times run 1", still ACTIVE with a Cancel button. Checking\'s available balance has dropped by $65.00 because the pending debit reserves it; the current balance changes only when an operator approves.',
    audience: { executive: 'The schedule has run once and is waiting for next month.', 'end-user': 'Avery sees the payment ran once and the next one is due 6 November.' },
    detail: 1,
    variants: [BILL],
    payload: { title: 'ScheduleDTO', format: 'json', data: firedBill, typeRef: 'sh:schedules#ScheduleDTO', highlight: ['runCount', 'lastRunAt', 'nextRunAt'] },
    sources: [src(F.page, 618, 631, 'Times run')],
  },
  {
    id: 'after-once',
    kind: 'state',
    title: 'The schedule is completed',
    from: PAGE,
    to: AVERY,
    label: 'COMPLETED · Next run —',
    narrative: 'The card is dimmed with a COMPLETED badge, "Next run —", "Last run Oct 4, 2026", "Times run 1", and no Cancel button (only active schedules can be cancelled).',
    audience: { executive: 'The one-time schedule is finished.', 'end-user': 'Avery sees the one-time transfer as completed.' },
    detail: 1,
    variants: [ONCE],
    payload: { title: 'ScheduleDTO', format: 'json', data: firedOnce, typeRef: 'sh:schedules#ScheduleDTO', highlight: ['status', 'nextRunAt'] },
    sources: [src(F.page, 618, 654, 'Times run'), src(F.shSchedules, 45, 48, 'export function isActiveSchedule')],
  },
];

export const scenario: Scenario = {
  id: 'scheduled-payment',
  title: 'A customer schedules a recurring payment',
  question: 'How does a customer set up a recurring payment?',
  summary:
    'Avery sets up a monthly bill pay (or a one-time transfer) on the Scheduled payments page. The shared validator runs in the browser and again on the server; the service checks she may move money on the account and is under the active-schedule cap, then stores a PaymentSchedule row with its first due date computed from the simulated clock. No money moves until an operator advances the clock past that date; she can cancel while it is active.',
  category: 'time',
  tags: ['time', 'money', 'validation', 'audit', 'ui'],
  participants: [AVERY, PAGE, VALIDATE, LIB, ROUTE, SVC, DB, SCHED],
  related: [
    'ep:POST /api/schedules',
    'ep:GET /api/schedules',
    'ep:POST /api/schedules/:id/cancel',
    'be:routes/schedules',
    'be:scheduler/schedules#createSchedule',
    'be:scheduler/schedules#cancelSchedule',
    'be:scheduler/schedules#listSchedulesForUser',
    'be:scheduler/schedules#requireSchedulableAccount',
    VALIDATE,
    'sh:schedules#SCHEDULE_LIMITS',
    'sh:schedules#addInterval',
    'cu:pages/ScheduledPayments',
    'cu:lib/schedules#createSchedule',
    'cu:lib/schedules#cancelSchedule',
    'cu:lib/schedules#fetchSchedules',
    'db:PaymentSchedule',
    'db:AuditLog',
    'feat:schedules',
  ],
  variants: [
    { id: BILL, label: 'Monthly bill pay', description: 'A $65.00 monthly bill pay to Northside Internet, first run in 5 days; it later fires once.', outcome: 'success' },
    { id: ONCE, label: 'One-time transfer', description: 'A $500.00 one-time transfer to savings; after it fires the schedule is completed.', outcome: 'success' },
    { id: CANCEL, label: 'Cancelled', description: 'Avery cancels the bill pay before it runs; it never fires.', outcome: 'info' },
    { id: INVALID, label: 'Invalid', description: 'No biller: the form stops it; the server would answer 400 invalid_request with field errors.', outcome: 'rejected' },
  ],
  defaultVariant: BILL,
  initialState: baseState(),
  watchAccounts: [IDS.checking, IDS.savings],
  steps,
  sources: [
    src(F.route, 63, 110, 'export async function scheduleRoutes'),
    src(F.svc, 92, 164, 'export async function createSchedule'),
    src(F.shSchedules, 202, 271, 'export function validateCreateSchedule'),
    src(F.page, 283, 362, 'function CreateScheduleForm'),
    src(F.test, 113, 187, 'schedule CRUD + access control'),
  ],
};
