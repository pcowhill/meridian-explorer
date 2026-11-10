import type { Contract, ContractError, Entity, FlowStep, Relation } from '../../types';
import { P, ent, rel, src } from './util';

/**
 * Route groups, endpoints and contracts for the clock, schedule and lending
 * endpoints (`routes/clock.ts`, `routes/schedules.ts`, `routes/lending.ts`).
 */

// ---------------------------------------------------------------------------
// Shared flow steps and errors
// ---------------------------------------------------------------------------

const hookSteps = (): FlowStep[] => [
  {
    kind: 'hook',
    target: 'be:auth/csrf#csrfHook',
    label: 'csrfHook (global onRequest)',
    detail: 'The request carries a session cookie and is not a safe method, so the `x-meridian-csrf` header must equal the `mer_csrf` cookie.',
    rejects: [{ status: 403, code: 'csrf_failed', when: 'A session cookie is present but the CSRF header is missing or does not match the cookie' }],
    source: src(P.csrf, 86, 116, 'export async function csrfHook'),
  },
  {
    kind: 'hook',
    target: 'be:abuse/rate-limit#mutationValveHook',
    label: 'mutationValveHook (global onRequest)',
    detail: 'Public-demo mode only: counts every state-changing request per client IP (200 per 5 minutes). A no-op in local development.',
    rejects: [{ status: 429, code: 'rate_limited', when: 'Abuse protection is on and the client exceeded the `mutations` valve' }],
    source: src(P.rateLimit, 178, 183, 'export async function mutationValveHook'),
  },
];

const authStep = (): FlowStep => ({
  kind: 'guard',
  target: 'be:auth/guards#requireAuth',
  label: 'requireAuth',
  detail: 'Resolves the session cookie for the calling surface and sets `req.user` (id, email, displayName, role).',
  rejects: [
    { status: 401, code: 'unauthenticated', when: 'No session cookie for the calling surface' },
    { status: 401, code: 'session_expired', when: 'The session token is unknown, expired or revoked (the cookie is cleared)' },
  ],
  source: src(P.guards, 47, 66, 'export const requireAuth'),
});

const roleStep = (): FlowStep => ({
  kind: 'guard',
  target: 'be:auth/guards#requireRole',
  label: "requireRole('ops_agent', 'admin')",
  detail: 'Staff only. A customer or joint-customer session stops here.',
  rejects: [{ status: 403, code: 'forbidden', when: 'The signed-in user\'s role is not `ops_agent` or `admin`' }],
  source: src(P.guards, 72, 86, 'export function requireRole'),
});

const rateStep = (bucket: 'operations' | 'schedules' | 'lending', limit: string): FlowStep => ({
  kind: 'guard',
  target: 'be:abuse/rate-limit#rateLimit',
  label: `rateLimit('${bucket}')`,
  detail: `Public-demo mode only: ${limit} per signed-in user. A no-op otherwise.`,
  rejects: [{ status: 429, code: 'rate_limited', when: `Abuse protection is on and the user exceeded the \`${bucket}\` bucket (response carries \`retry-after\`)` }],
  source: src(P.rateLimit, 158, 168, 'export function rateLimit'),
});

const E_UNAUTH: ContractError[] = [
  { status: 401, code: 'unauthenticated', when: 'No session cookie for the calling surface', example: { error: 'Not authenticated.', code: 'unauthenticated' }, source: src(P.guards, 47, 53, 'unauthenticated') },
  { status: 401, code: 'session_expired', when: 'The session is unknown, expired or revoked', example: { error: 'Your session has expired. Please log in again.', code: 'session_expired' }, source: src(P.guards, 54, 59, 'session_expired') },
];
const E_CSRF: ContractError = {
  status: 403,
  code: 'csrf_failed',
  when: 'The `x-meridian-csrf` header is missing or differs from the `mer_csrf` cookie',
  example: { error: 'Missing or invalid CSRF token. Reload the page and try again.', code: 'csrf_failed' },
  source: src(P.csrf, 110, 115, 'csrf_failed'),
};
const E_RATE: ContractError = {
  status: 429,
  code: 'rate_limited',
  when: 'Public-demo mode only: the per-user bucket or the global mutation valve is exhausted',
  example: { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' },
  source: src(P.rateLimit, 142, 150, 'rate_limited'),
};
const E_ROLE: ContractError = {
  status: 403,
  code: 'forbidden',
  when: 'The signed-in user is not `ops_agent` or `admin`',
  example: { error: 'You do not have access to this resource.', code: 'forbidden' },
  source: src(P.guards, 78, 84, 'forbidden'),
};

// Example DTOs reused in responses.
const EX_SCHEDULE = {
  id: 'sch_internet',
  kind: 'bill_pay',
  amountMinor: 6500,
  fromAccountId: 'acc_checking',
  fromAccountName: 'Everyday Checking',
  toAccountId: null,
  toAccountName: null,
  counterparty: 'Northside Internet',
  memo: 'Home internet',
  frequency: 'monthly',
  status: 'active',
  nextRunAt: '2026-10-06T15:00:00.000Z',
  lastRunAt: null,
  runCount: 0,
  createdAt: '2026-10-01T15:00:00.000Z',
};
const EX_LOAN = {
  id: 'lp_loan',
  kind: 'loan',
  status: 'active',
  accountId: 'acc_loan',
  accountName: 'Personal loan',
  apyBps: 1200,
  termMonths: 12,
  principalMinor: 100000,
  paymentMinor: 8885,
  openedAt: '2026-10-01T15:00:00.000Z',
  maturesAt: '2027-10-01T15:00:00.000Z',
  lastAccruedAt: '2026-10-01T15:00:00.000Z',
  balanceMinor: -100000,
  outstandingMinor: 100000,
};
const EX_CD = {
  id: 'lp_cd',
  kind: 'cd',
  status: 'active',
  accountId: 'acc_cd',
  accountName: '6-month CD',
  apyBps: 350,
  termMonths: 6,
  principalMinor: 200000,
  paymentMinor: null,
  openedAt: '2026-10-01T15:00:00.000Z',
  maturesAt: '2027-04-01T15:00:00.000Z',
  lastAccruedAt: '2026-10-01T15:00:00.000Z',
  balanceMinor: 200000,
  outstandingMinor: 0,
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const httpEntities: Entity[] = [
  ent('be:routes/clock', 'route-group', 'routes/clock.ts', 'be.http', 'Clock endpoints: read the simulated date, advance it (staff only), and list every customer\'s schedules (staff only).', {
    description:
      'The advance handler is the orchestrator of everything time-driven. In order it: validates the request, calls `advanceClock`, runs the scheduler up to the new time, runs interest accrual up to the new time, broadcasts the queued bill-pay requests and simulated events to operator consoles, and responds with the new clock plus both summaries. Accrual runs after the scheduler on purpose, so a payment fired in this advance is in the balance before interest is computed.',
    tech: ['Fastify'],
    tags: ['time', 'operations', 'api'],
    aliases: ['clockRoutes'],
    sources: [src(P.rClock, 17, 31, 'export async function clockRoutes'), src(P.rClock, 37, 41, "rateLimit('operations')", 'The two staff guard chains')],
  }),
  ent('be:routes/schedules', 'route-group', 'routes/schedules.ts', 'be.http', 'Customer scheduled-payment endpoints: create, list own, cancel.', {
    description:
      'Thin handlers: coerce the body, run the shared validator, read the simulated now, delegate to the schedule service, and map `ScheduleError` codes to HTTP statuses. String body fields are cut to 500 characters before validation.',
    tech: ['Fastify'],
    tags: ['time', 'money', 'api'],
    aliases: ['scheduleRoutes'],
    sources: [src(P.rSchedules, 21, 30, 'Customer scheduled-payment endpoints'), src(P.rSchedules, 63, 64, 'export async function scheduleRoutes')],
  }),
  ent('be:routes/schedules#scheduleHttpStatus', 'function', 'scheduleHttpStatus', 'be:routes/schedules', 'Maps a `ScheduleError` code to an HTTP status.', {
    values: [
      { value: 'not_found', meaning: '404' },
      { value: 'forbidden', meaning: '403' },
      { value: 'already_inactive / limit_reached', meaning: '409' },
      { value: 'inactive_account / invalid', meaning: '400' },
    ],
    signature: 'function scheduleHttpStatus(code: ScheduleErrorCode): number',
    detail: 5,
    tags: ['api'],
    sources: [src(P.rSchedules, 34, 55, 'function scheduleHttpStatus')],
  }),
  ent('be:routes/lending', 'route-group', 'routes/lending.ts', 'be.http', 'Lending endpoints: list, open a CD, open a loan, pay a loan, withdraw a matured CD, plus the staff-only list of all products.', {
    description:
      'Every mutation shares one guard chain (`requireAuth`, then the `lending` rate-limit bucket), validates with the shared validator, reads the simulated now and delegates to the lending service. `LendingError` codes are mapped to HTTP statuses. The handlers read only the fields the request types define, so a rate or payment sent by a client is ignored — the validator recomputes both from the term.',
    tech: ['Fastify'],
    tags: ['lending', 'money', 'api'],
    aliases: ['lendingRoutes'],
    sources: [src(P.rLending, 26, 34, 'Customer lending & deposit endpoints'), src(P.rLending, 62, 64, 'export async function lendingRoutes')],
  }),
  ent('be:routes/lending#lendingHttpStatus', 'function', 'lendingHttpStatus', 'be:routes/lending', 'Maps a `LendingError` code to an HTTP status.', {
    values: [
      { value: 'not_found', meaning: '404' },
      { value: 'forbidden', meaning: '403' },
      { value: 'limit_reached', meaning: '409' },
      { value: 'insufficient_funds / inactive_account / invalid_state / not_matured', meaning: '400' },
    ],
    signature: 'function lendingHttpStatus(code: LendingErrorCode): number',
    detail: 5,
    tags: ['api'],
    sources: [src(P.rLending, 36, 54, 'function lendingHttpStatus')],
  }),

  // endpoints
  ent('ep:GET /api/clock', 'endpoint', 'GET /api/clock', 'be:routes/clock', 'Returns the current simulated date to any signed-in user.', {
    tags: ['time'],
    sources: [src(P.rClock, 32, 35, "app.get('/api/clock'")],
  }),
  ent('ep:POST /api/ops/clock/advance', 'endpoint', 'POST /api/ops/clock/advance', 'be:routes/clock', 'Staff only: moves the simulated clock forward, fires every schedule that became due and accrues interest.', {
    audience: {
      executive: 'The fast-forward button: staff move the bank\'s calendar ahead and everything that depends on time happens.',
      dba: 'One request can write to `SimulationClock`, `AuditLog`, `PaymentSchedule`, `LedgerEntry`, `OperationsRequest`, `SimulatedEvent`, `Account` and `LendingProduct`.',
    },
    tags: ['time', 'operations', 'money', 'lending'],
    aliases: ['advance the clock', 'fast-forward'],
    sources: [src(P.rClock, 43, 73, "app.post('/api/ops/clock/advance'")],
  }),
  ent('ep:GET /api/ops/schedules', 'endpoint', 'GET /api/ops/schedules', 'be:routes/clock', 'Staff only: lists every customer\'s scheduled payments.', {
    tags: ['time', 'operations'],
    sources: [src(P.rClock, 75, 78, "app.get('/api/ops/schedules'")],
  }),
  ent('ep:POST /api/schedules', 'endpoint', 'POST /api/schedules', 'be:routes/schedules', 'Creates a one-time or recurring transfer or bill payment. No money moves until the clock passes its due date.', {
    tags: ['time', 'money'],
    aliases: ['create schedule', 'schedule a payment'],
    sources: [src(P.rSchedules, 66, 93, "app.post('/api/schedules'")],
  }),
  ent('ep:GET /api/schedules', 'endpoint', 'GET /api/schedules', 'be:routes/schedules', 'Lists the schedules the caller created.', {
    tags: ['time'],
    sources: [src(P.rSchedules, 95, 98, "app.get('/api/schedules'")],
  }),
  ent('ep:POST /api/schedules/:id/cancel', 'endpoint', 'POST /api/schedules/:id/cancel', 'be:routes/schedules', 'Cancels one of the caller\'s active schedules.', {
    tags: ['time'],
    sources: [src(P.rSchedules, 100, 109, "app.post('/api/schedules/:id/cancel'")],
  }),
  ent('ep:GET /api/lending', 'endpoint', 'GET /api/lending', 'be:routes/lending', 'Lists the CDs and loans on accounts the caller can access, with derived balances.', {
    tags: ['lending'],
    sources: [src(P.rLending, 67, 70, "app.get('/api/lending'")],
  }),
  ent('ep:POST /api/lending/cds', 'endpoint', 'POST /api/lending/cds', 'be:routes/lending', 'Opens a CD funded from one of the caller\'s accounts.', {
    tags: ['lending', 'money'],
    sources: [src(P.rLending, 73, 87, "app.post('/api/lending/cds'")],
  }),
  ent('ep:POST /api/lending/loans', 'endpoint', 'POST /api/lending/loans', 'be:routes/lending', 'Opens a loan and pays the principal into one of the caller\'s accounts.', {
    tags: ['lending', 'money'],
    sources: [src(P.rLending, 90, 104, "app.post('/api/lending/loans'")],
  }),
  ent('ep:POST /api/lending/loans/:id/pay', 'endpoint', 'POST /api/lending/loans/:id/pay', 'be:routes/lending', 'Makes a payment on an active loan from one of the caller\'s accounts.', {
    tags: ['lending', 'money'],
    sources: [src(P.rLending, 107, 121, "app.post('/api/lending/loans/:id/pay'")],
  }),
  ent('ep:POST /api/lending/cds/:id/withdraw', 'endpoint', 'POST /api/lending/cds/:id/withdraw', 'be:routes/lending', 'Withdraws a matured CD\'s full balance to one of the caller\'s accounts and closes it.', {
    tags: ['lending', 'money'],
    sources: [src(P.rLending, 124, 135, "app.post('/api/lending/cds/:id/withdraw'")],
  }),
  ent('ep:GET /api/ops/lending', 'endpoint', 'GET /api/ops/lending', 'be:routes/lending', 'Staff only: lists every customer\'s CDs and loans. Read-only.', {
    tags: ['lending', 'operations'],
    sources: [src(P.rLending, 138, 141, "app.get('/api/ops/lending'")],
  }),
];

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

const scheduleServiceErrors: ContractError[] = [
  { status: 404, code: 'not_found', when: 'The source (or destination) account does not exist', example: { error: 'That account was not found.', code: 'not_found' }, source: src(P.schedules, 81, 82, 'not_found') },
  { status: 403, code: 'forbidden', when: 'The caller is not owner / joint / authorized on the source or destination account', example: { error: 'You cannot schedule payments on that account.', code: 'forbidden' }, source: src(P.schedules, 83, 86, 'forbidden') },
  { status: 400, code: 'inactive_account', when: 'An account involved is not `active`', example: { error: 'That account is not active.', code: 'inactive_account' }, source: src(P.schedules, 87, 89, 'inactive_account') },
  { status: 400, code: 'invalid', when: 'Service-level repeat of the destination rules for an internal transfer (normally caught by the validator first)', example: { error: 'Choose two different accounts.', code: 'invalid' }, source: src(P.schedules, 104, 108, 'Choose two different accounts.') },
  { status: 409, code: 'limit_reached', when: 'The caller already has 25 active schedules', example: { error: 'You already have 25 active schedules (the simulated maximum). Cancel one to add another.', code: 'limit_reached' }, source: src(P.schedules, 115, 121, 'limit_reached') },
];

const lendingAccountErrors = (what: string): ContractError[] => [
  { status: 404, code: 'not_found', when: `The ${what} account does not exist`, example: { error: 'That account was not found.', code: 'not_found' }, source: src(P.lending, 80, 82, 'not_found') },
  { status: 403, code: 'forbidden', when: `The caller is not owner / joint / authorized on the ${what} account`, example: { error: 'You cannot use that account.', code: 'forbidden' }, source: src(P.lending, 83, 86, 'forbidden') },
  { status: 400, code: 'inactive_account', when: `The ${what} account is not \`active\``, example: { error: 'That account is not active.', code: 'inactive_account' }, source: src(P.lending, 87, 89, 'inactive_account') },
];
const E_LENDING_CAP: ContractError = {
  status: 409,
  code: 'limit_reached',
  when: 'The caller already has 10 active CDs/loans',
  example: { error: 'You already have 10 open CDs/loans (the simulated maximum). Pay off or withdraw one to open another.', code: 'limit_reached' },
  source: src(P.lending, 191, 200, 'limit_reached'),
};
const E_LENDING_FIELDS = (fields: Record<string, string>): ContractError => ({
  status: 400,
  code: 'invalid_request',
  when: 'The shared validator rejects the body; `fields` maps each offending field to its message',
  example: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields },
  source: src(P.rLending, 56, 60, 'invalid_request'),
});
const productErrors: ContractError[] = [
  { status: 404, code: 'not_found', when: 'No lending product has that id', example: { error: 'That product was not found.', code: 'not_found' }, source: src(P.lending, 326, 328, 'not_found') },
  { status: 403, code: 'forbidden', when: 'The caller is not owner / joint / authorized on the product\'s account', example: { error: 'You cannot act on that product.', code: 'forbidden' }, source: src(P.lending, 330, 333, 'forbidden') },
];

export const httpContracts: Contract[] = [
  // ---- GET /api/clock -------------------------------------------------------
  {
    id: 'ep:GET /api/clock',
    method: 'GET',
    path: '/api/clock',
    summary: 'Read the current simulated date and speed.',
    description: 'Display only. Both apps use it to show "current simulated date" before the first heartbeat arrives.',
    auth: { required: true, surface: 'either', csrf: false, notes: 'Any signed-in role. No rate-limit bucket.' },
    responses: [{ status: 200, description: 'The clock.', typeRef: 'sh:clock#ClockResponse', example: { clock: { currentTime: '2026-10-01T15:00:00.000Z', speed: 1 } } }],
    errors: [...E_UNAUTH],
    flow: [
      authStep(),
      { kind: 'call', target: 'be:clock/clock#getClockState', label: 'getClockState(prisma)', detail: 'Reads the singleton and converts it to a DTO.', source: src(P.rClock, 32, 35, 'getClockState(prisma)') },
      { kind: 'db-read', target: 'db:SimulationClock', label: 'upsert singleton', detail: 'A read that creates the row at the wall-clock time if it does not exist yet.', source: src(P.clock, 35, 42, 'simulationClock.upsert') },
      { kind: 'respond', label: '200 { clock }', source: src(P.rClock, 34, 34, 'ClockResponse') },
    ],
    sideEffects: ['None in normal operation. On a database with no clock row, the first read creates it.'],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchClock', 'cu:lib/schedules#fetchClock'],
    integrationNotes: 'Send the session cookie. `currentTime` is the simulated date, not the server\'s real time — use it for anything that reasons about due dates, maturity or statements.',
    sources: [src(P.rClock, 32, 35, "app.get('/api/clock'")],
  },

  // ---- POST /api/ops/clock/advance -----------------------------------------
  {
    id: 'ep:POST /api/ops/clock/advance',
    method: 'POST',
    path: '/api/ops/clock/advance',
    summary: 'Advance the simulation clock forward, then fire due schedules and accrue interest.',
    description:
      'The body may combine `days`, `hours` and `minutes`; they are summed into whole minutes. The handler runs four things in sequence and none of them share a transaction: the clock update (with its audit row), the scheduler, interest accrual, and the real-time broadcast. The clock row is therefore already at the new time while schedules and accrual run.',
    auth: {
      required: true,
      roles: ['ops_agent', 'admin'],
      surface: 'operations',
      csrf: true,
      rateLimit: 'operations',
      notes: 'The `operations` bucket (60 per 5 minutes per user) applies in public-demo mode only.',
    },
    body: [
      { name: 'days', type: 'number', required: false, rules: ['Used only if it is a JSON number', 'Truncated to a whole number', 'Defaults to 0'] },
      { name: 'hours', type: 'number', required: false, rules: ['Used only if it is a JSON number', 'Truncated to a whole number', 'Defaults to 0'] },
      { name: 'minutes', type: 'number', required: false, rules: ['Used only if it is a JSON number', 'Truncated to a whole number', 'Defaults to 0'] },
    ],
    bodyTypeRef: 'sh:clock#AdvanceClockRequest',
    requestExample: { days: 30 },
    responses: [
      {
        status: 200,
        description: 'The new clock, one summary per schedule that ran or skipped, and the interest accrual summary.',
        typeRef: 'sh:schedules#AdvanceClockResponse',
        example: {
          clock: { currentTime: '2026-10-31T15:00:00.000Z', speed: 1 },
          fired: [
            { scheduleId: 'sch_savings', kind: 'internal_transfer', runs: 1, postedMinor: 20000, queuedMinor: 0, skipped: 0, status: 'active' },
            { scheduleId: 'sch_internet', kind: 'bill_pay', runs: 1, postedMinor: 0, queuedMinor: 6500, skipped: 0, status: 'active' },
          ],
          accrued: { savingsAccountsAccrued: 1, cdsAccrued: 1, loansAccrued: 1, totalInterestCreditedMinor: 1400, totalInterestChargedMinor: 2000, cdsMatured: 0 },
        },
      },
    ],
    errors: [
      {
        status: 400,
        code: 'invalid_request',
        when: 'The summed advance is less than 1 minute (zero or backwards) or more than 527,040 minutes (366 days)',
        example: { error: 'Advance the clock forward by at least one minute (the simulation clock cannot rewind).', code: 'invalid_request' },
        source: src(P.rClock, 50, 54, 'invalid_request'),
      },
      {
        status: 400,
        code: 'invalid_advance',
        when: '`advanceClock` itself rejects a non-positive or non-integer minute count. Unreachable through this route because `validateAdvance` runs first; kept as a backstop',
        example: { error: 'The simulation clock can only move forward.', code: 'invalid_advance' },
        source: src(P.rClock, 67, 70, 'ClockError'),
      },
      ...E_UNAUTH,
      E_ROLE,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      roleStep(),
      rateStep('operations', '60 requests per 5 minutes'),
      {
        kind: 'validate',
        target: 'sh:clock#validateAdvance',
        label: 'validateAdvance({ minutes, hours, days })',
        detail: 'Non-number fields are dropped, the rest are truncated and summed. The total must be 1 … 527,040 minutes.',
        rejects: [{ status: 400, code: 'invalid_request', when: 'Total < 1 minute or > 366 days' }],
        source: src(P.rClock, 44, 54, 'validateAdvance'),
      },
      {
        kind: 'call',
        target: 'be:clock/clock#advanceClock',
        label: 'advanceClock(prisma, minutes, req.user)',
        detail: 'Reads the singleton, computes the new time and returns `{ clock, from, to }`.',
        rejects: [{ status: 400, code: 'invalid_advance', when: 'Backstop: minutes is not a positive integer' }],
        source: src(P.rClock, 56, 56, 'advanceClock(prisma, check.value.minutes, req.user!)'),
      },
      { kind: 'db-write', target: 'db:SimulationClock', label: 'update singleton.currentTime', detail: 'The clock moves. From here on `simulationNow()` returns the new time.', source: src(P.clock, 78, 81, 'simulationClock.update') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert clock_advanced', detail: 'Actor, minutes, from and to instants.', source: src(P.clock, 83, 96, 'clock_advanced') },
      {
        kind: 'call',
        target: 'be:scheduler/scheduler#runDueSchedules',
        label: 'runDueSchedules(advanced.to)',
        detail: 'Fires every active schedule with `nextRunAt <= to`, one occurrence at a time, through the money service. Failed occurrences are skipped and recorded; this call does not throw for them.',
        source: src(P.rClock, 57, 58, 'runDueSchedules(advanced.to)'),
      },
      { kind: 'db-write', target: 'db:PaymentSchedule', label: 'claim + bookkeeping per occurrence', detail: '`nextRunAt` / `status` first, then `runCount` / `lastRunAt` after a successful fire.', source: src(P.scheduler, 142, 148, 'paymentSchedule.update') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert transfer legs / pending payment debit', detail: 'Two posted `transfer` rows per internal-transfer occurrence; one pending `payment` debit per bill-pay occurrence. All dated at the occurrence\'s due instant.', source: src(P.scheduler, 150, 187, 'createTransfer') },
      { kind: 'db-write', target: 'db:OperationsRequest', label: 'insert bill_pay request (per bill-pay occurrence)', detail: 'A pending queue item linked to the pending ledger entry.', source: src(P.movements, 341, 354, 'operationsRequest.create') },
      {
        kind: 'call',
        target: 'be:lending/accrual#runInterestAccrual',
        label: 'runInterestAccrual(advanced.to)',
        detail: 'Runs after the scheduler so payments fired in this advance are in the balances. Posts one `interest` entry per elapsed month for each savings account, CD and loan, advances their bookmarks and matures CDs.',
        source: src(P.rClock, 59, 62, 'runInterestAccrual(advanced.to)'),
      },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert interest entries', detail: 'Credits on savings and CD accounts, debits on loan accounts, `origin: \'interest\'`.', source: src(P.accrual, 84, 95, "origin: 'interest'") },
      { kind: 'db-write', target: 'db:LendingProduct', label: 'update lastAccruedAt / status', detail: 'Bookmark forward by whole months; `matured` when a CD reaches `maturesAt`. Savings use `Account.interestAccruedThrough` instead.', source: src(P.accrual, 175, 183, 'lendingProduct.update') },
      { kind: 'emit', target: 'ev:ops:request_changed', label: "opsRealtime.requestChanged('created', request)", detail: 'Once per bill-pay request the scheduler queued, to the operators room.', source: src(P.rClock, 63, 63, 'requestChanged') },
      { kind: 'emit', target: 'ev:ops:external_event', label: 'opsRealtime.externalEvent(event)', detail: 'Once per simulated event produced by the run (fired, skipped, movement received).', source: src(P.rClock, 64, 64, 'externalEvent') },
      { kind: 'respond', label: '200 { clock, fired, accrued }', source: src(P.rClock, 65, 66, 'AdvanceClockResponse') },
    ],
    sideEffects: [
      'Updates the SimulationClock singleton and writes an AuditLog row `clock_advanced`.',
      'For each due internal-transfer occurrence: two posted `transfer` LedgerEntry rows and an AuditLog row `money_transfer`.',
      'For each due bill-pay occurrence: one pending `payment` LedgerEntry, one pending OperationsRequest, an AuditLog row `ops_request_created` and a SimulatedEvent.',
      'For each skipped occurrence: a SimulatedEvent `schedule_skipped` and an AuditLog row `schedule_payment_skipped`; no ledger rows.',
      'Updates PaymentSchedule rows (nextRunAt, status, runCount, lastRunAt).',
      'Posts `interest` LedgerEntry rows and advances Account.interestAccruedThrough / LendingProduct.lastAccruedAt; may set a CD to `matured`.',
      'Emits `ops:request_changed` and `ops:external_event` to operator consoles; within 10 seconds `sim:heartbeat` carries the new simulated time to every client.',
    ],
    mutates: true,
    calledBy: ['op:lib/opsApi#advanceClock'],
    integrationNotes:
      'Send the operations session cookie, the `x-meridian-surface: operations` header and the `x-meridian-csrf` header. The advance cannot be undone — there is no rewind. It is not idempotent: sending the same body twice advances twice. Schedules catch up on missed occurrences (up to 60 per schedule per call), so a long jump can post many entries. A calendar month is not a unit: the console\'s "+1 month" preset sends `{ days: 30 }`, which may or may not cross a monthly interest anniversary.',
    sources: [src(P.rClock, 43, 73, "app.post('/api/ops/clock/advance'"), src(P.rClock, 17, 30, 'Simulation-clock endpoints')],
  },

  // ---- GET /api/ops/schedules ----------------------------------------------
  {
    id: 'ep:GET /api/ops/schedules',
    method: 'GET',
    path: '/api/ops/schedules',
    summary: 'List every customer\'s schedules for the operator console.',
    auth: { required: true, roles: ['ops_agent', 'admin'], surface: 'operations', csrf: false },
    responses: [{ status: 200, description: 'All schedules: active first, then by next run date, then newest.', typeRef: 'sh:schedules#ScheduleListResponse', example: { schedules: [EX_SCHEDULE] } }],
    errors: [...E_UNAUTH, E_ROLE],
    flow: [
      authStep(),
      roleStep(),
      { kind: 'call', target: 'be:scheduler/schedules#listAllSchedules', label: 'listAllSchedules()', source: src(P.rClock, 75, 78, 'listAllSchedules') },
      { kind: 'db-read', target: 'db:PaymentSchedule', label: 'findMany (with from/to account names)', source: src(P.schedules, 177, 182, 'paymentSchedule.findMany') },
      { kind: 'respond', label: '200 { schedules }', source: src(P.rClock, 77, 77, 'ScheduleListResponse') },
    ],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchSchedules'],
    integrationNotes: 'Read-only. The DTO does not include the owning customer; it identifies a schedule by its account names and biller.',
    sources: [src(P.rClock, 75, 78, "app.get('/api/ops/schedules'")],
  },

  // ---- POST /api/schedules --------------------------------------------------
  {
    id: 'ep:POST /api/schedules',
    method: 'POST',
    path: '/api/schedules',
    summary: 'Create a scheduled or recurring payment.',
    description:
      'Creating a schedule only stores the instruction. The first due date is the simulated now plus `firstRunInDays` days; the payment fires when an operator advances the clock to or past that date. Funds are not checked now — they are checked each time an occurrence fires.',
    auth: {
      required: true,
      surface: 'customer',
      csrf: true,
      rateLimit: 'schedules',
      notes: 'No role check: any signed-in session passes; the service requires a non-viewer relationship on each account. The `schedules` bucket (20 per 5 minutes per user) applies in public-demo mode only.',
    },
    body: [
      { name: 'kind', type: 'string', required: true, values: ['internal_transfer', 'bill_pay'], rules: ['Must be one of the two schedule kinds'] },
      { name: 'fromAccountId', type: 'string', required: true, rules: ['Non-empty after trimming', 'Caller must be owner / joint / authorized on it and it must be active (checked in the service)'] },
      { name: 'toAccountId', type: 'string', required: false, rules: ['Required when kind is `internal_transfer`', 'Must differ from `fromAccountId`', 'Same access rules as the source account', 'Ignored for `bill_pay`'] },
      { name: 'counterparty', type: 'string', required: false, rules: ['Required when kind is `bill_pay` (the biller)', 'Trimmed and cut to 80 characters', 'Ignored for `internal_transfer`'] },
      { name: 'memo', type: 'string', required: false, rules: ['Trimmed and cut to 140 characters; empty becomes null'] },
      { name: 'amountMinor', type: 'number', required: true, rules: ['Integer minor units', 'Between 1 and 5,000,000 ($0.01 – $50,000)'] },
      { name: 'frequency', type: 'string', required: true, values: ['once', 'weekly', 'monthly'] },
      { name: 'firstRunInDays', type: 'number', required: false, rules: ['Whole number from 0 to 365', 'Defaults to 0 (due at the current simulated instant)'] },
    ],
    bodyTypeRef: 'sh:schedules#CreateScheduleRequest',
    requestExample: { kind: 'bill_pay', fromAccountId: 'acc_checking', counterparty: 'Northside Internet', memo: 'Home internet', amountMinor: 6500, frequency: 'monthly', firstRunInDays: 5 },
    responses: [
      {
        status: 201,
        description: 'The created schedule and a confirmation message.',
        typeRef: 'sh:schedules#CreateScheduleResponse',
        example: {
          schedule: EX_SCHEDULE,
          message: 'Your schedule was created (SIMULATION). It will run when the simulation clock reaches its next run date — nothing has moved yet.',
        },
      },
    ],
    errors: [
      {
        status: 400,
        code: 'invalid_request',
        when: 'The shared validator rejects the body; `fields` maps each offending field to its message',
        example: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { counterparty: 'Enter the biller’s name.' } },
        source: src(P.rSchedules, 57, 61, 'invalid_request'),
      },
      ...scheduleServiceErrors,
      ...E_UNAUTH,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('schedules', '20 requests per 5 minutes'),
      {
        kind: 'validate',
        target: 'sh:schedules#validateCreateSchedule',
        label: 'validateCreateSchedule(body)',
        detail: 'Fields of the wrong JSON type are dropped and strings cut to 500 characters before the shared validator runs.',
        rejects: [{ status: 400, code: 'invalid_request', when: 'Any field fails; response includes `fields`' }],
        source: src(P.rSchedules, 67, 80, 'validateCreateSchedule'),
      },
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', detail: 'The simulated instant used for `createdAt` and as the base of the first due date.', source: src(P.rSchedules, 82, 82, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:scheduler/schedules#createSchedule',
        label: 'createSchedule(req.user, value, now)',
        detail: 'Access checks, the active-schedule cap, the insert and the audit row.',
        rejects: [
          { status: 404, code: 'not_found', when: 'An account does not exist' },
          { status: 403, code: 'forbidden', when: 'No movable relationship on an account' },
          { status: 400, code: 'inactive_account', when: 'An account is not active' },
          { status: 409, code: 'limit_reached', when: '25 active schedules already' },
        ],
        source: src(P.rSchedules, 83, 83, 'createSchedule(req.user!, check.value, now)'),
      },
      { kind: 'db-read', target: 'db:Account', label: 'findUnique (status) per account', source: src(P.schedules, 81, 82, 'account.findUnique') },
      { kind: 'db-read', target: 'db:PaymentSchedule', label: "count active for user", source: src(P.schedules, 115, 115, 'paymentSchedule.count') },
      { kind: 'db-write', target: 'db:PaymentSchedule', label: "insert (status 'active', nextRunAt)", detail: '`nextRunAt = now + firstRunInDays × 24h`.', source: src(P.schedules, 123, 141, 'paymentSchedule.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert schedule_created', source: src(P.schedules, 143, 161, 'schedule_created') },
      { kind: 'respond', label: '201 { schedule, message }', source: src(P.rSchedules, 84, 89, 'reply.code(201)') },
    ],
    sideEffects: ['Inserts one PaymentSchedule row.', 'Writes an AuditLog row `schedule_created`.', 'No ledger entry, no operations request, no real-time event.'],
    mutates: true,
    calledBy: ['cu:lib/schedules#createSchedule'],
    integrationNotes:
      'Send the customer session cookie and the `x-meridian-csrf` header. Amounts are integer minor units. Nothing moves when this returns 201; watch the schedule\'s `runCount`, `lastRunAt` and `nextRunAt` after the clock advances. `firstRunInDays: 0` means "due at the current simulated instant", which fires on the next advance of any size.',
    sources: [src(P.rSchedules, 66, 93, "app.post('/api/schedules'")],
  },

  // ---- GET /api/schedules ---------------------------------------------------
  {
    id: 'ep:GET /api/schedules',
    method: 'GET',
    path: '/api/schedules',
    summary: 'List the schedules the caller created.',
    auth: { required: true, surface: 'customer', csrf: false, notes: 'Scoped by creator (`PaymentSchedule.userId`), not by account access.' },
    responses: [{ status: 200, description: 'The caller\'s schedules: active first, then by next run date, then newest.', typeRef: 'sh:schedules#ScheduleListResponse', example: { schedules: [EX_SCHEDULE] } }],
    errors: [...E_UNAUTH],
    flow: [
      authStep(),
      { kind: 'call', target: 'be:scheduler/schedules#listSchedulesForUser', label: 'listSchedulesForUser(req.user.id)', source: src(P.rSchedules, 95, 98, 'listSchedulesForUser') },
      { kind: 'db-read', target: 'db:PaymentSchedule', label: 'findMany where userId (with account names)', source: src(P.schedules, 167, 173, 'paymentSchedule.findMany') },
      { kind: 'respond', label: '200 { schedules }', source: src(P.rSchedules, 97, 97, 'ScheduleListResponse') },
    ],
    mutates: false,
    calledBy: ['cu:lib/schedules#fetchSchedules'],
    integrationNotes: 'Includes completed and cancelled schedules; filter on `status` client-side.',
    sources: [src(P.rSchedules, 95, 98, "app.get('/api/schedules'")],
  },

  // ---- POST /api/schedules/:id/cancel --------------------------------------
  {
    id: 'ep:POST /api/schedules/:id/cancel',
    method: 'POST',
    path: '/api/schedules/:id/cancel',
    summary: 'Cancel an active schedule so it never fires again.',
    description: 'Only the user who created the schedule may cancel it. Cancelling does not undo occurrences that already fired.',
    auth: { required: true, surface: 'customer', csrf: true, rateLimit: 'schedules', notes: 'Shares the `schedules` bucket with create.' },
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'The schedule id.' }],
    requestExample: null,
    responses: [
      {
        status: 200,
        description: 'The schedule, now `cancelled` with `nextRunAt: null`.',
        typeRef: 'sh:schedules#CancelScheduleResponse',
        example: { schedule: { ...EX_SCHEDULE, status: 'cancelled', nextRunAt: null } },
      },
    ],
    errors: [
      { status: 404, code: 'not_found', when: 'No schedule has that id', example: { error: 'That schedule was not found.', code: 'not_found' }, source: src(P.schedules, 187, 188, 'not_found') },
      { status: 403, code: 'forbidden', when: 'The schedule was created by a different user', example: { error: 'That is not your schedule.', code: 'forbidden' }, source: src(P.schedules, 189, 189, 'forbidden') },
      { status: 409, code: 'already_inactive', when: 'The schedule is already completed or cancelled', example: { error: 'That schedule is no longer active.', code: 'already_inactive' }, source: src(P.schedules, 190, 192, 'already_inactive') },
      ...E_UNAUTH,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('schedules', '20 requests per 5 minutes'),
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', source: src(P.rSchedules, 103, 103, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:scheduler/schedules#cancelSchedule',
        label: 'cancelSchedule(req.user, id, now)',
        rejects: [
          { status: 404, code: 'not_found', when: 'Unknown id' },
          { status: 403, code: 'forbidden', when: 'Not the creator' },
          { status: 409, code: 'already_inactive', when: 'Not active' },
        ],
        source: src(P.rSchedules, 104, 104, 'cancelSchedule(req.user!, id, now)'),
      },
      { kind: 'db-read', target: 'db:PaymentSchedule', label: 'findUnique by id', source: src(P.schedules, 187, 187, 'paymentSchedule.findUnique') },
      { kind: 'db-write', target: 'db:PaymentSchedule', label: "update status 'cancelled', nextRunAt null, updatedAt now", source: src(P.schedules, 194, 198, 'paymentSchedule.update') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert schedule_cancelled', source: src(P.schedules, 200, 208, 'schedule_cancelled') },
      { kind: 'respond', label: '200 { schedule }', source: src(P.rSchedules, 105, 105, 'CancelScheduleResponse') },
    ],
    sideEffects: ['Updates one PaymentSchedule row to `cancelled`.', 'Writes an AuditLog row `schedule_cancelled`.'],
    mutates: true,
    calledBy: ['cu:lib/schedules#cancelSchedule'],
    integrationNotes: 'No body. The 409 code is `already_inactive` (the customer client\'s header comment calls it `conflict`; the server never sends that code). Repeating a cancel returns 409, not 200.',
    sources: [src(P.rSchedules, 100, 109, "app.post('/api/schedules/:id/cancel'")],
  },

  // ---- GET /api/lending -----------------------------------------------------
  {
    id: 'ep:GET /api/lending',
    method: 'GET',
    path: '/api/lending',
    summary: 'List the caller\'s CDs and loans with derived balances.',
    auth: { required: true, surface: 'customer', csrf: false, notes: 'Scoped to accounts the caller owns or holds an access grant on.' },
    responses: [{ status: 200, description: 'Products newest first. `balanceMinor` is derived from the ledger at read time.', typeRef: 'sh:lending#LendingListResponse', example: { products: [EX_LOAN, EX_CD] } }],
    errors: [...E_UNAUTH],
    flow: [
      authStep(),
      { kind: 'call', target: 'be:lending/lending#listLendingForUser', label: 'listLendingForUser(req.user)', source: src(P.rLending, 67, 70, 'listLendingForUser') },
      { kind: 'db-read', target: 'db:AccountAccess', label: 'findMany grants for user', source: src(P.lending, 450, 450, 'accountAccess.findMany') },
      { kind: 'db-read', target: 'db:LendingProduct', label: 'findMany where accountId in accessible accounts', source: src(P.lending, 454, 458, 'lendingProduct.findMany') },
      { kind: 'db-read', target: 'db:LedgerEntry', label: 'findMany per product account', detail: 'To derive each product\'s balance.', source: src(P.lending, 103, 109, 'ledgerEntry.findMany') },
      { kind: 'respond', label: '200 { products }', source: src(P.rLending, 69, 69, 'LendingListResponse') },
    ],
    mutates: false,
    calledBy: ['cu:lib/lending#listLending'],
    integrationNotes: 'A loan\'s `balanceMinor` is negative while money is owed; use `outstandingMinor` for the positive amount owed.',
    sources: [src(P.rLending, 67, 70, "app.get('/api/lending'")],
  },

  // ---- POST /api/lending/cds ------------------------------------------------
  {
    id: 'ep:POST /api/lending/cds',
    method: 'POST',
    path: '/api/lending/cds',
    summary: 'Open a certificate of deposit.',
    description: 'Creates a `cd` account, moves the principal into it from the funding account as a net-zero pair of transfer entries, and records the terms. The rate is looked up from the term; the client cannot set it.',
    auth: { required: true, surface: 'customer', csrf: true, rateLimit: 'lending', notes: 'The `lending` bucket (20 per 5 minutes per user) applies in public-demo mode only.' },
    body: [
      { name: 'fundingAccountId', type: 'string', required: true, rules: ['Non-empty', 'Caller must be owner / joint / authorized on it and it must be active', 'Available balance must cover the principal'] },
      { name: 'principalMinor', type: 'number', required: true, rules: ['Integer minor units', 'Between 10,000 and 100,000,000 ($100 – $1,000,000)'] },
      { name: 'termMonths', type: 'number', required: true, values: ['6', '12', '24', '60'], rules: ['Must be an offered CD term'] },
    ],
    bodyTypeRef: 'sh:lending#OpenCdRequest',
    requestExample: { fundingAccountId: 'acc_checking', principalMinor: 200000, termMonths: 6 },
    responses: [{ status: 201, description: 'The new CD.', typeRef: 'sh:lending#LendingProductResponse', example: { product: EX_CD, message: 'Your CD is open (simulated).' } }],
    errors: [
      E_LENDING_FIELDS({ termMonths: 'Choose an offered CD term.' }),
      ...lendingAccountErrors('funding'),
      { status: 400, code: 'insufficient_funds', when: 'The funding account\'s available balance is less than the principal', example: { error: 'That deposit exceeds the available balance.', code: 'insufficient_funds' }, source: src(P.lending, 211, 213, 'insufficient_funds') },
      E_LENDING_CAP,
      ...E_UNAUTH,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('lending', '20 requests per 5 minutes'),
      { kind: 'validate', target: 'sh:lending#validateOpenCd', label: 'validateOpenCd(body)', detail: 'Adds `apyBps` from the CD rate table.', rejects: [{ status: 400, code: 'invalid_request', when: 'A field fails; response includes `fields`' }], source: src(P.rLending, 74, 80, 'validateOpenCd') },
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', source: src(P.rLending, 82, 82, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:lending/lending#openCd',
        label: 'openCd(req.user, value, now)',
        rejects: [
          { status: 404, code: 'not_found', when: 'Funding account missing' },
          { status: 403, code: 'forbidden', when: 'No movable relationship' },
          { status: 400, code: 'inactive_account', when: 'Funding account not active' },
          { status: 400, code: 'insufficient_funds', when: 'Available < principal' },
          { status: 409, code: 'limit_reached', when: '10 active products already' },
        ],
        source: src(P.rLending, 82, 82, 'openCd(req.user!, check.value'),
      },
      { kind: 'transaction', label: 'prisma.$transaction', detail: 'The five writes below commit together.', source: src(P.lending, 219, 219, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:Account', label: "insert CD account (type 'cd')", source: src(P.lending, 220, 222, "type: 'cd'") },
      { kind: 'db-write', target: 'db:AccountAccess', label: "insert owner grant", source: src(P.lending, 223, 225, 'accountAccess.create') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert transfer pair (funding debit, CD credit)', source: src(P.lending, 226, 233, 'postTransferPair') },
      { kind: 'db-write', target: 'db:LendingProduct', label: "insert product (kind 'cd')", source: src(P.lending, 234, 247, 'lendingProduct.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert lending_open_cd', source: src(P.lending, 248, 256, 'lending_open_cd') },
      { kind: 'respond', label: '201 { product, message }', source: src(P.rLending, 83, 83, 'reply.code(201)') },
    ],
    sideEffects: ['Creates an Account (type `cd`) and an owner AccountAccess row.', 'Posts two `transfer` LedgerEntry rows that net to zero.', 'Inserts a LendingProduct and an AuditLog row `lending_open_cd`.'],
    mutates: true,
    calledBy: ['cu:lib/lending#openCd'],
    integrationNotes: 'Send `fundingAccountId`, `principalMinor` and `termMonths` only. The customer app also sends the `apyBps` its validator computed; the server never reads it. The money is locked until maturity: there is no early withdrawal.',
    sources: [src(P.rLending, 73, 87, "app.post('/api/lending/cds'")],
  },

  // ---- POST /api/lending/loans ----------------------------------------------
  {
    id: 'ep:POST /api/lending/loans',
    method: 'POST',
    path: '/api/lending/loans',
    summary: 'Open a loan and receive the principal.',
    description: 'Creates a `loan` account and posts a net-zero pair: the loan account is debited (it now shows a negative balance, the amount owed) and the disbursement account is credited. There is no credit decision and no operator review.',
    auth: { required: true, surface: 'customer', csrf: true, rateLimit: 'lending' },
    body: [
      { name: 'disbursementAccountId', type: 'string', required: true, rules: ['Non-empty', 'Caller must be owner / joint / authorized on it and it must be active'] },
      { name: 'principalMinor', type: 'number', required: true, rules: ['Integer minor units', 'Between 10,000 and 100,000,000 ($100 – $1,000,000)'] },
      { name: 'termMonths', type: 'number', required: true, values: ['12', '24', '36', '60'], rules: ['Must be an offered loan term'] },
    ],
    bodyTypeRef: 'sh:lending#OpenLoanRequest',
    requestExample: { disbursementAccountId: 'acc_checking', principalMinor: 100000, termMonths: 12 },
    responses: [{ status: 201, description: 'The new loan, including its level monthly payment.', typeRef: 'sh:lending#LendingProductResponse', example: { product: EX_LOAN, message: 'Your loan is funded (simulated).' } }],
    errors: [E_LENDING_FIELDS({ termMonths: 'Choose an offered loan term.' }), ...lendingAccountErrors('disbursement'), E_LENDING_CAP, ...E_UNAUTH, E_CSRF, E_RATE],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('lending', '20 requests per 5 minutes'),
      { kind: 'validate', target: 'sh:lending#validateOpenLoan', label: 'validateOpenLoan(body)', detail: 'Adds `apyBps` from the loan rate table and `paymentMinor` from `amortizedPaymentMinor`.', rejects: [{ status: 400, code: 'invalid_request', when: 'A field fails; response includes `fields`' }], source: src(P.rLending, 91, 97, 'validateOpenLoan') },
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', source: src(P.rLending, 99, 99, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:lending/lending#openLoan',
        label: 'openLoan(req.user, value, now)',
        rejects: [
          { status: 404, code: 'not_found', when: 'Disbursement account missing' },
          { status: 403, code: 'forbidden', when: 'No movable relationship' },
          { status: 400, code: 'inactive_account', when: 'Disbursement account not active' },
          { status: 409, code: 'limit_reached', when: '10 active products already' },
        ],
        source: src(P.rLending, 99, 99, 'openLoan(req.user!, check.value'),
      },
      { kind: 'transaction', label: 'prisma.$transaction', source: src(P.lending, 276, 276, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:Account', label: "insert loan account (type 'loan')", source: src(P.lending, 277, 279, "type: 'loan'") },
      { kind: 'db-write', target: 'db:AccountAccess', label: 'insert owner grant', source: src(P.lending, 280, 282, 'accountAccess.create') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert transfer pair (loan debit, disbursement credit)', detail: 'No funds check on the loan account: it is meant to go negative.', source: src(P.lending, 283, 293, 'postTransferPair') },
      { kind: 'db-write', target: 'db:LendingProduct', label: "insert product (kind 'loan', paymentMinor)", source: src(P.lending, 294, 307, 'lendingProduct.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert lending_open_loan', source: src(P.lending, 308, 316, 'lending_open_loan') },
      { kind: 'respond', label: '201 { product, message }', source: src(P.rLending, 100, 100, 'reply.code(201)') },
    ],
    sideEffects: ['Creates an Account (type `loan`) and an owner AccountAccess row.', 'Posts two `transfer` LedgerEntry rows that net to zero; the loan account balance becomes negative.', 'Inserts a LendingProduct and an AuditLog row `lending_open_loan`.'],
    mutates: true,
    calledBy: ['cu:lib/lending#openLoan'],
    integrationNotes: 'The response\'s `paymentMinor` is the suggested level payment; the server does not collect it automatically and does not enforce a payment schedule. Interest is charged monthly on whatever is owed when the clock advances.',
    sources: [src(P.rLending, 90, 104, "app.post('/api/lending/loans'")],
  },

  // ---- POST /api/lending/loans/:id/pay --------------------------------------
  {
    id: 'ep:POST /api/lending/loans/:id/pay',
    method: 'POST',
    path: '/api/lending/loans/:id/pay',
    summary: 'Make a loan payment.',
    description: 'Moves money from one of the caller\'s accounts to the loan account. With no `amountMinor` the scheduled monthly payment is paid. The amount is capped at what is owed; when the loan reaches zero it becomes `paid_off` and its account is closed.',
    auth: { required: true, surface: 'customer', csrf: true, rateLimit: 'lending' },
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'The lending product id (not the account id).' }],
    body: [
      { name: 'fromAccountId', type: 'string', required: true, rules: ['Non-empty', 'Caller must be owner / joint / authorized on it and it must be active', 'Must not be the loan account itself', 'Available balance must cover the amount actually paid'] },
      { name: 'amountMinor', type: 'number | null', required: false, rules: ['Omit or null to pay the product\'s `paymentMinor`', 'If given: integer between 100 and 100,000,000 ($1 – $1,000,000)', 'Capped server-side at the amount owed'] },
    ],
    bodyTypeRef: 'sh:lending#LoanPaymentRequest',
    requestExample: { fromAccountId: 'acc_checking', amountMinor: null },
    responses: [
      {
        status: 200,
        description: 'The updated loan.',
        typeRef: 'sh:lending#LendingProductResponse',
        example: { product: { ...EX_LOAN, lastAccruedAt: '2026-11-01T15:00:00.000Z', balanceMinor: -92115, outstandingMinor: 92115 }, message: 'Payment posted (simulated).' },
      },
    ],
    errors: [
      E_LENDING_FIELDS({ amountMinor: 'Enter a payment between $1 and $1,000,000 (simulated).' }),
      ...productErrors,
      { status: 400, code: 'invalid_state', when: 'The product is not a loan, is not `active`, has nothing owed, or the paying account is the loan account', example: { error: 'That loan is already paid off or closed.', code: 'invalid_state' }, source: src(P.lending, 344, 356, 'invalid_state') },
      ...lendingAccountErrors('paying'),
      { status: 400, code: 'insufficient_funds', when: 'The paying account\'s available balance is less than the amount', example: { error: 'That payment exceeds the available balance.', code: 'insufficient_funds' }, source: src(P.lending, 358, 360, 'insufficient_funds') },
      ...E_UNAUTH,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('lending', '20 requests per 5 minutes'),
      { kind: 'validate', target: 'sh:lending#validateLoanPayment', label: 'validateLoanPayment(body)', rejects: [{ status: 400, code: 'invalid_request', when: 'A field fails; response includes `fields`' }], source: src(P.rLending, 108, 114, 'validateLoanPayment') },
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', source: src(P.rLending, 116, 116, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:lending/lending#makeLoanPayment',
        label: 'makeLoanPayment(req.user, id, value, now)',
        detail: 'Product access, state checks, amount resolution (`min(requested, owed)`), funds check.',
        rejects: [
          { status: 404, code: 'not_found', when: 'Unknown product or paying account' },
          { status: 403, code: 'forbidden', when: 'No movable relationship on the product or paying account' },
          { status: 400, code: 'invalid_state', when: 'Not a loan / not active / nothing owed / paying from the loan itself' },
          { status: 400, code: 'insufficient_funds', when: 'Available < amount' },
        ],
        source: src(P.rLending, 116, 116, 'makeLoanPayment(req.user!, id, check.value'),
      },
      { kind: 'db-read', target: 'db:LedgerEntry', label: 'derive amount owed and available balance', source: src(P.lending, 350, 360, 'availableMinor(prisma, from.id)') },
      { kind: 'transaction', label: 'prisma.$transaction', source: src(P.lending, 362, 362, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert transfer pair (paying debit, loan credit)', source: src(P.lending, 363, 370, 'postTransferPair') },
      { kind: 'decision', label: 'remainingOwed <= 0 ?', detail: 'If nothing remains owed the loan is paid off.', source: src(P.lending, 372, 373, 'paidOff') },
      { kind: 'db-write', target: 'db:LendingProduct', label: "update status ('paid_off' or 'active'), updatedAt", source: src(P.lending, 374, 377, 'lendingProduct.update') },
      { kind: 'db-write', target: 'db:Account', label: "update loan account status 'closed' (only when paid off)", source: src(P.lending, 378, 380, "status: 'closed'") },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert lending_loan_payment / lending_loan_paid_off', source: src(P.lending, 381, 389, 'lending_loan_payment') },
      { kind: 'respond', label: '200 { product, message }', source: src(P.rLending, 117, 117, 'Payment posted (simulated).') },
    ],
    sideEffects: ['Posts two `transfer` LedgerEntry rows that net to zero.', 'May set the LendingProduct to `paid_off` and its Account to `closed`.', 'Writes an AuditLog row `lending_loan_payment` or `lending_loan_paid_off`.'],
    mutates: true,
    calledBy: ['cu:lib/lending#payLoan'],
    integrationNotes: 'An overpayment is not an error: only the amount owed is taken. Read `outstandingMinor` in the response for what remains.',
    sources: [src(P.rLending, 107, 121, "app.post('/api/lending/loans/:id/pay'")],
  },

  // ---- POST /api/lending/cds/:id/withdraw -----------------------------------
  {
    id: 'ep:POST /api/lending/cds/:id/withdraw',
    method: 'POST',
    path: '/api/lending/cds/:id/withdraw',
    summary: 'Withdraw a matured CD.',
    description: 'Moves the CD\'s entire balance (principal plus interest earned) to one of the caller\'s accounts and closes the CD and its account. Refused before maturity.',
    auth: { required: true, surface: 'customer', csrf: true, rateLimit: 'lending' },
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'The lending product id.' }],
    body: [{ name: 'toAccountId', type: 'string', required: true, rules: ['Non-empty', 'Caller must be owner / joint / authorized on it and it must be active', 'Must not be the CD account itself'] }],
    bodyTypeRef: 'sh:lending#WithdrawCdRequest',
    requestExample: { toAccountId: 'acc_checking' },
    responses: [
      {
        status: 200,
        description: 'The CD, now `closed` with a zero balance.',
        typeRef: 'sh:lending#LendingProductResponse',
        example: { product: { ...EX_CD, status: 'closed', lastAccruedAt: '2027-04-01T15:00:00.000Z', balanceMinor: 0 }, message: 'Your matured CD proceeds were transferred (simulated).' },
      },
    ],
    errors: [
      E_LENDING_FIELDS({ toAccountId: 'Choose the account to receive the funds.' }),
      ...productErrors,
      { status: 400, code: 'invalid_state', when: 'The product is not a CD, is already closed, has no balance, or the receiving account is the CD account', example: { error: 'That CD is already closed.', code: 'invalid_state' }, source: src(P.lending, 405, 415, 'invalid_state') },
      { status: 400, code: 'not_matured', when: 'The CD\'s status is not `matured` and the simulated now is before `maturesAt`', example: { error: 'This CD has not reached maturity yet.', code: 'not_matured' }, source: src(P.lending, 407, 409, 'not_matured') },
      ...lendingAccountErrors('receiving'),
      ...E_UNAUTH,
      E_CSRF,
      E_RATE,
    ],
    flow: [
      ...hookSteps(),
      authStep(),
      rateStep('lending', '20 requests per 5 minutes'),
      { kind: 'validate', target: 'sh:lending#validateWithdrawCd', label: 'validateWithdrawCd(body)', rejects: [{ status: 400, code: 'invalid_request', when: '`toAccountId` missing' }], source: src(P.rLending, 125, 128, 'validateWithdrawCd') },
      { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', detail: 'Also the instant compared against `maturesAt`.', source: src(P.rLending, 130, 130, 'simulationNow(prisma)') },
      {
        kind: 'call',
        target: 'be:lending/lending#withdrawMaturedCd',
        label: 'withdrawMaturedCd(req.user, id, toAccountId, now)',
        rejects: [
          { status: 404, code: 'not_found', when: 'Unknown product or receiving account' },
          { status: 403, code: 'forbidden', when: 'No movable relationship on the product or receiving account' },
          { status: 400, code: 'invalid_state', when: 'Not a CD / already closed / empty / withdrawing into itself' },
          { status: 400, code: 'not_matured', when: 'Before maturity' },
        ],
        source: src(P.rLending, 130, 130, 'withdrawMaturedCd(req.user!, id'),
      },
      { kind: 'db-read', target: 'db:LedgerEntry', label: 'derive the CD balance', source: src(P.lending, 414, 415, 'currentMinor(prisma, account.id)') },
      { kind: 'transaction', label: 'prisma.$transaction', source: src(P.lending, 417, 417, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert transfer pair (CD debit, receiving credit) for the full balance', source: src(P.lending, 418, 425, 'postTransferPair') },
      { kind: 'db-write', target: 'db:LendingProduct', label: "update status 'closed'", source: src(P.lending, 426, 429, 'lendingProduct.update') },
      { kind: 'db-write', target: 'db:Account', label: "update CD account status 'closed'", source: src(P.lending, 430, 430, 'account.update') },
      { kind: 'db-write', target: 'db:AuditLog', label: 'insert lending_cd_withdrawn', source: src(P.lending, 431, 439, 'lending_cd_withdrawn') },
      { kind: 'respond', label: '200 { product, message }', source: src(P.rLending, 131, 131, 'Your matured CD proceeds were transferred (simulated).') },
    ],
    sideEffects: ['Posts two `transfer` LedgerEntry rows that net to zero.', 'Sets the LendingProduct and its Account to `closed`.', 'Writes an AuditLog row `lending_cd_withdrawn`.'],
    mutates: true,
    calledBy: ['cu:lib/lending#withdrawCd'],
    integrationNotes: 'A CD matures when an operator advances the clock to or past `maturesAt`; poll `GET /api/lending` for `status: \'matured\'`. The full balance is always withdrawn — there is no amount field.',
    sources: [src(P.rLending, 124, 135, "app.post('/api/lending/cds/:id/withdraw'")],
  },

  // ---- GET /api/ops/lending -------------------------------------------------
  {
    id: 'ep:GET /api/ops/lending',
    method: 'GET',
    path: '/api/ops/lending',
    summary: 'List every customer\'s lending products for the operator console.',
    auth: { required: true, roles: ['ops_agent', 'admin'], surface: 'operations', csrf: false },
    responses: [{ status: 200, description: 'All products, newest first.', typeRef: 'sh:lending#LendingListResponse', example: { products: [EX_LOAN, EX_CD] } }],
    errors: [...E_UNAUTH, E_ROLE],
    flow: [
      authStep(),
      roleStep(),
      { kind: 'call', target: 'be:lending/lending#listAllLending', label: 'listAllLending()', source: src(P.rLending, 138, 141, 'listAllLending') },
      { kind: 'db-read', target: 'db:LendingProduct', label: 'findMany all (with account name)', source: src(P.lending, 464, 467, 'lendingProduct.findMany') },
      { kind: 'db-read', target: 'db:LedgerEntry', label: 'findMany per product account', detail: 'To derive each balance.', source: src(P.lending, 103, 109, 'ledgerEntry.findMany') },
      { kind: 'respond', label: '200 { products }', source: src(P.rLending, 140, 140, 'LendingListResponse') },
    ],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchLending'],
    integrationNotes: 'Read-only: operators cannot open, pay or close a customer\'s product. The DTO does not name the owning customer.',
    sources: [src(P.rLending, 138, 141, "app.get('/api/ops/lending'")],
  },
];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const AUTH_SRC = {
  clockGet: src(P.rClock, 32, 32, 'requireAuth'),
  opsOnly: src(P.rClock, 37, 37, 'requireRole'),
  opsMutation: src(P.rClock, 41, 41, "rateLimit('operations')"),
  schedGuarded: src(P.rSchedules, 64, 64, "rateLimit('schedules')"),
  schedGet: src(P.rSchedules, 95, 95, 'requireAuth'),
  lendGuarded: src(P.rLending, 64, 64, "rateLimit('lending')"),
  lendGet: src(P.rLending, 67, 67, 'requireAuth'),
  lendOps: src(P.rLending, 138, 138, 'requireRole'),
};

function guardRels(ep: string, authSrc: (typeof AUTH_SRC)[keyof typeof AUTH_SRC], opts: { role?: boolean; rate?: string } = {}): Relation[] {
  const out: Relation[] = [rel(ep, 'be:auth/guards#requireAuth', 'guards', 'preHandler: requireAuth', { sources: [authSrc], order: 1 })];
  if (opts.role) out.push(rel(ep, 'be:auth/guards#requireRole', 'guards', "preHandler: requireRole('ops_agent', 'admin')", { sources: [authSrc], order: 2 }));
  if (opts.rate) out.push(rel(ep, 'be:abuse/rate-limit#rateLimit', 'guards', `preHandler: rateLimit('${opts.rate}')`, { sources: [authSrc], order: 3 }));
  return out;
}

export const httpRelations: Relation[] = [
  // guards
  ...guardRels('ep:GET /api/clock', AUTH_SRC.clockGet),
  ...guardRels('ep:POST /api/ops/clock/advance', AUTH_SRC.opsMutation, { role: true, rate: 'operations' }),
  ...guardRels('ep:GET /api/ops/schedules', AUTH_SRC.opsOnly, { role: true }),
  ...guardRels('ep:POST /api/schedules', AUTH_SRC.schedGuarded, { rate: 'schedules' }),
  ...guardRels('ep:GET /api/schedules', AUTH_SRC.schedGet),
  ...guardRels('ep:POST /api/schedules/:id/cancel', AUTH_SRC.schedGuarded, { rate: 'schedules' }),
  ...guardRels('ep:GET /api/lending', AUTH_SRC.lendGet),
  ...guardRels('ep:POST /api/lending/cds', AUTH_SRC.lendGuarded, { rate: 'lending' }),
  ...guardRels('ep:POST /api/lending/loans', AUTH_SRC.lendGuarded, { rate: 'lending' }),
  ...guardRels('ep:POST /api/lending/loans/:id/pay', AUTH_SRC.lendGuarded, { rate: 'lending' }),
  ...guardRels('ep:POST /api/lending/cds/:id/withdraw', AUTH_SRC.lendGuarded, { rate: 'lending' }),
  ...guardRels('ep:GET /api/ops/lending', AUTH_SRC.lendOps, { role: true }),

  // clock routes
  rel('ep:GET /api/clock', 'be:clock/clock#getClockState', 'calls', 'getClockState(prisma)', { sources: [src(P.rClock, 32, 35, 'getClockState(prisma)')] }),
  rel('ep:GET /api/clock', 'sh:clock#ClockResponse', 'uses-type', 'responds ClockResponse', { sources: [src(P.rClock, 34, 34, 'ClockResponse')], detail: 5 }),
  rel('ep:POST /api/ops/clock/advance', 'sh:clock#validateAdvance', 'validates', 'validateAdvance({ minutes, hours, days })', { order: 4, sources: [src(P.rClock, 44, 54, 'validateAdvance')] }),
  rel('ep:POST /api/ops/clock/advance', 'be:clock/clock#advanceClock', 'calls', 'advanceClock(prisma, check.value.minutes, req.user!)', {
    order: 5,
    summary: 'Moves the clock and returns the new time.',
    sources: [src(P.rClock, 56, 56, 'advanceClock(prisma, check.value.minutes, req.user!)')],
  }),
  rel('ep:POST /api/ops/clock/advance', 'be:scheduler/scheduler#runDueSchedules', 'calls', 'runDueSchedules(advanced.to)', {
    order: 6,
    summary: 'Fires everything that became due.',
    sources: [src(P.rClock, 57, 58, 'runDueSchedules(advanced.to)')],
  }),
  rel('ep:POST /api/ops/clock/advance', 'be:lending/accrual#runInterestAccrual', 'calls', 'runInterestAccrual(advanced.to)', {
    order: 7,
    summary: 'Accrues interest after the scheduler has run.',
    sources: [src(P.rClock, 59, 62, 'runInterestAccrual(advanced.to)')],
  }),
  rel('ep:POST /api/ops/clock/advance', 'be:ops/realtime#OpsRealtime', 'calls', 'app.opsRealtime.requestChanged / externalEvent', {
    order: 8,
    summary: 'Hands the scheduler\'s requests and events to the real-time publisher.',
    sources: [src(P.rClock, 63, 64, 'app.opsRealtime')],
  }),
  rel('ep:POST /api/ops/clock/advance', 'ev:ops:request_changed', 'emits', "requestChanged('created', request) per fired bill pay", {
    order: 9,
    summary: 'A bill pay fired by the scheduler appears in operator queues like one a customer submitted by hand.',
    sources: [src(P.rClock, 63, 63, 'requestChanged')],
  }),
  rel('ep:POST /api/ops/clock/advance', 'ev:ops:external_event', 'emits', 'externalEvent(event) per simulated event', { order: 10, sources: [src(P.rClock, 64, 64, 'externalEvent')] }),
  rel('ep:POST /api/ops/clock/advance', 'be:clock/clock#ClockError', 'uses-type', 'catch ClockError → 400', { sources: [src(P.rClock, 67, 70, 'ClockError')], detail: 5 }),
  rel('ep:POST /api/ops/clock/advance', 'sh:schedules#AdvanceClockResponse', 'uses-type', 'responds AdvanceClockResponse', { sources: [src(P.rClock, 65, 66, 'AdvanceClockResponse')] }),
  rel('ep:POST /api/ops/clock/advance', 'sh:clock#AdvanceClockRequest', 'uses-type', 'body: AdvanceClockRequest', { sources: [src(P.rClock, 44, 49, 'body.minutes')], detail: 5 }),
  rel('ep:GET /api/ops/schedules', 'be:scheduler/schedules#listAllSchedules', 'calls', 'listAllSchedules()', { sources: [src(P.rClock, 75, 78, 'listAllSchedules')] }),
  rel('ep:POST /api/ops/clock/advance', 'feat:clock', 'implements', 'operator advances the clock'),
  rel('ep:POST /api/ops/clock/advance', 'feat:schedules', 'implements', 'fires due schedules'),
  rel('ep:POST /api/ops/clock/advance', 'feat:interest', 'implements', 'accrues interest'),
  rel('ep:GET /api/clock', 'feat:clock', 'implements', 'read the simulated date'),

  // schedule routes
  rel('ep:POST /api/schedules', 'sh:schedules#validateCreateSchedule', 'validates', 'validateCreateSchedule(body)', { order: 3, sources: [src(P.rSchedules, 67, 80, 'validateCreateSchedule')] }),
  rel('ep:POST /api/schedules', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 4, sources: [src(P.rSchedules, 82, 82, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/schedules', 'be:scheduler/schedules#createSchedule', 'calls', 'createSchedule(req.user!, check.value, now)', { order: 5, sources: [src(P.rSchedules, 83, 83, 'createSchedule(req.user!, check.value, now)')] }),
  rel('ep:POST /api/schedules', 'be:routes/schedules#scheduleHttpStatus', 'calls', 'handleScheduleError → scheduleHttpStatus(err.code)', { order: 6, sources: [src(P.rSchedules, 90, 92, 'handleScheduleError')], detail: 5 }),
  rel('ep:POST /api/schedules', 'sh:schedules#CreateScheduleResponse', 'uses-type', 'responds CreateScheduleResponse', { sources: [src(P.rSchedules, 84, 89, 'CreateScheduleResponse')], detail: 5 }),
  rel('ep:GET /api/schedules', 'be:scheduler/schedules#listSchedulesForUser', 'calls', 'listSchedulesForUser(req.user!.id)', { sources: [src(P.rSchedules, 95, 98, 'listSchedulesForUser')] }),
  rel('ep:POST /api/schedules/:id/cancel', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 3, sources: [src(P.rSchedules, 103, 103, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/schedules/:id/cancel', 'be:scheduler/schedules#cancelSchedule', 'calls', 'cancelSchedule(req.user!, id, now)', { order: 4, sources: [src(P.rSchedules, 104, 104, 'cancelSchedule(req.user!, id, now)')] }),
  rel('ep:POST /api/schedules/:id/cancel', 'be:routes/schedules#scheduleHttpStatus', 'calls', 'handleScheduleError → scheduleHttpStatus(err.code)', { order: 5, sources: [src(P.rSchedules, 106, 108, 'handleScheduleError')], detail: 5 }),
  rel('be:routes/schedules#scheduleHttpStatus', 'be:scheduler/schedules#ScheduleError', 'uses-type', 'maps ScheduleErrorCode → status', { sources: [src(P.rSchedules, 48, 55, 'ScheduleError')], detail: 5 }),
  rel('ep:POST /api/schedules', 'feat:schedules', 'implements', 'create a schedule'),
  rel('ep:POST /api/schedules/:id/cancel', 'feat:schedules', 'implements', 'cancel a schedule'),

  // lending routes
  rel('ep:GET /api/lending', 'be:lending/lending#listLendingForUser', 'calls', 'listLendingForUser(req.user!)', { sources: [src(P.rLending, 67, 70, 'listLendingForUser')] }),
  rel('ep:POST /api/lending/cds', 'sh:lending#validateOpenCd', 'validates', 'validateOpenCd(body)', { order: 3, sources: [src(P.rLending, 74, 80, 'validateOpenCd')] }),
  rel('ep:POST /api/lending/cds', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 4, sources: [src(P.rLending, 82, 82, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/lending/cds', 'be:lending/lending#openCd', 'calls', 'openCd(req.user!, check.value, now)', { order: 5, sources: [src(P.rLending, 82, 82, 'openCd(req.user!, check.value')] }),
  rel('ep:POST /api/lending/loans', 'sh:lending#validateOpenLoan', 'validates', 'validateOpenLoan(body)', { order: 3, sources: [src(P.rLending, 91, 97, 'validateOpenLoan')] }),
  rel('ep:POST /api/lending/loans', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 4, sources: [src(P.rLending, 99, 99, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/lending/loans', 'be:lending/lending#openLoan', 'calls', 'openLoan(req.user!, check.value, now)', { order: 5, sources: [src(P.rLending, 99, 99, 'openLoan(req.user!, check.value')] }),
  rel('ep:POST /api/lending/loans/:id/pay', 'sh:lending#validateLoanPayment', 'validates', 'validateLoanPayment(body)', { order: 3, sources: [src(P.rLending, 108, 114, 'validateLoanPayment')] }),
  rel('ep:POST /api/lending/loans/:id/pay', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 4, sources: [src(P.rLending, 116, 116, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/lending/loans/:id/pay', 'be:lending/lending#makeLoanPayment', 'calls', 'makeLoanPayment(req.user!, id, check.value, now)', { order: 5, sources: [src(P.rLending, 116, 116, 'makeLoanPayment(req.user!, id, check.value')] }),
  rel('ep:POST /api/lending/cds/:id/withdraw', 'sh:lending#validateWithdrawCd', 'validates', 'validateWithdrawCd(body)', { order: 3, sources: [src(P.rLending, 125, 128, 'validateWithdrawCd')] }),
  rel('ep:POST /api/lending/cds/:id/withdraw', 'be:clock/clock#simulationNow', 'calls', 'simulationNow(prisma)', { order: 4, sources: [src(P.rLending, 130, 130, 'simulationNow(prisma)')] }),
  rel('ep:POST /api/lending/cds/:id/withdraw', 'be:lending/lending#withdrawMaturedCd', 'calls', 'withdrawMaturedCd(req.user!, id, toAccountId, now)', { order: 5, sources: [src(P.rLending, 130, 130, 'withdrawMaturedCd(req.user!, id')] }),
  rel('ep:GET /api/ops/lending', 'be:lending/lending#listAllLending', 'calls', 'listAllLending()', { sources: [src(P.rLending, 138, 141, 'listAllLending')] }),
  rel('be:routes/lending#lendingHttpStatus', 'be:lending/lending#LendingError', 'uses-type', 'maps LendingErrorCode → status', { sources: [src(P.rLending, 49, 54, 'LendingError')], detail: 5 }),
  rel('ep:POST /api/lending/cds', 'feat:lending', 'implements', 'open a CD'),
  rel('ep:POST /api/lending/loans', 'feat:lending', 'implements', 'open a loan'),
  rel('ep:POST /api/lending/loans/:id/pay', 'feat:lending', 'implements', 'pay a loan'),
  rel('ep:POST /api/lending/cds/:id/withdraw', 'feat:lending', 'implements', 'withdraw a matured CD'),
];
