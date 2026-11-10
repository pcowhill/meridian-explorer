import type { Scenario, ScenarioStep, SourceRef, StateEffect } from '../../types';
import { IDS, baseState } from '../fixtures';
import { AVERY, CHK, SAM, SIM_NOW, bal, ledgerRow, movementRows, step, summaryOf } from '../money/scenario-data';

/**
 * "How are account balances calculated?"
 *
 * A data-centred walkthrough of `GET /api/accounts`: the access-scoped lookup,
 * the ledger rows it loads, and `deriveBalances` applying one rule per entry
 * status. Avery's Everyday Checking starts from the fixture rows le_001..le_003
 * plus five rows added below so that every status rule is exercised once.
 *
 * Everyday Checking, by rule:
 *   posted    le_001 +250000, le_002 −4890          → current 245110, available 245110
 *   pending ↑ le_005 32000 (credit)                 → pendingCredit 32000 (no balance change)
 *   pending ↓ le_003 12000 (debit)                  → pendingDebit 12000, available 233110
 *   held      le_006 7500                           → held 7500, available 225610
 *   failed    le_008 45000, reversed le_007 4430    → nothing
 *   disputed  le_009 −4210                          → current 240900, available 221400
 */

// ---- Lanes ------------------------------------------------------------------
const AVERY_ROLE = 'role:customer';
const DASH = 'cu:pages/Dashboard';
const FETCH = 'cu:lib/auth#fetchAccounts';
const EP = 'ep:GET /api/accounts';
const ACCESS = 'be:auth/access#listAccessibleAccounts';
const DERIVE = 'sh:ledger#deriveBalances';
const DB = 'db';
const MOVES = 'be:money/movements';
const OPS = 'role:ops_agent';

// ---- Sources ------------------------------------------------------------------
const F = {
  ledger: 'packages/shared/src/ledger.ts',
  ledgerTest: 'packages/shared/src/ledger.test.ts',
  access: 'apps/backend/src/auth/access.ts',
  routes: 'apps/backend/src/routes/accounts.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  sessions: 'apps/backend/src/auth/sessions.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  dashboard: 'apps/customer/src/pages/Dashboard.tsx',
  cuAuth: 'apps/customer/src/lib/auth.ts',
  schema: 'apps/backend/prisma/schema.prisma',
  sharedAuth: 'packages/shared/src/auth.ts',
  seedPlan: 'apps/backend/src/seed-plan.ts',
  seedPlanTest: 'apps/backend/src/seed-plan.test.ts',
  movements: 'apps/backend/src/money/movements.ts',
  requests: 'apps/backend/src/ops/requests.ts',
  moneyTest: 'apps/backend/src/routes/money.test.ts',
} as const;

const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

// ---- Example rows -----------------------------------------------------------------
/** Rows added to the fixture so every status rule in `deriveBalances` fires once. */
const EXTRA_ENTRIES = [
  ledgerRow({ id: 'le_005', accountId: CHK, amountMinor: 32000, direction: 'credit', status: 'pending', origin: 'deposit', description: 'Mobile check deposit', postedAt: null, createdAt: '2026-09-30T15:00:00.000Z' }),
  ledgerRow({ id: 'le_006', accountId: CHK, amountMinor: 7500, direction: 'debit', status: 'held', origin: 'card', description: 'Rental hold — DriveEasy Cars', postedAt: null, createdAt: '2026-09-29T15:00:00.000Z' }),
  ledgerRow({ id: 'le_007', accountId: CHK, amountMinor: 4430, direction: 'debit', status: 'reversed', origin: 'card', description: 'QuickFuel', postedAt: '2026-08-12T12:00:00.000Z', createdAt: '2026-08-12T12:00:00.000Z' }),
  ledgerRow({ id: 'le_008', accountId: CHK, amountMinor: 45000, direction: 'debit', status: 'failed', origin: 'payment', description: 'ACH payment to External Savings ••1234', postedAt: null, createdAt: '2026-09-20T15:00:00.000Z' }),
  ledgerRow({ id: 'le_009', accountId: CHK, amountMinor: 4210, direction: 'debit', status: 'disputed', origin: 'card', description: 'Trattoria Romana', postedAt: '2026-08-07T12:00:00.000Z', createdAt: '2026-08-07T12:00:00.000Z' }),
];

/** Wall-clock instants (Session and AuditLog use the real clock, not the simulated one). */
const WALL_GET = '2026-10-01T15:06:02.000Z';
const WALL_APPROVE = '2026-10-01T15:12:40.000Z';
const plus8h = (iso: string) => new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString();

const SESSION_AVERY = {
  id: 'ses_avery',
  userId: IDS.avery,
  tokenHash: '<sha-256 of the mer_session token>',
  createdAt: '2026-10-01T14:30:00.000Z',
  lastSeenAt: '2026-10-01T15:01:10.000Z',
  expiresAt: '2026-10-01T23:01:10.000Z',
  revokedAt: null,
};

const CHECKING_BAL = bal(240900, 221400, 32000, 12000, 7500);
const SAVINGS_BAL = bal(500000, 500000);
const ACCOUNTS_RESPONSE = { accounts: [summaryOf('checking', CHECKING_BAL), summaryOf('savings', SAVINGS_BAL)] };

/** The three columns deriveBalances reads, for every checking row. */
const CHECKING_LIKE = [
  { id: 'le_001', amountMinor: 250000, direction: 'credit', status: 'posted' },
  { id: 'le_002', amountMinor: 4890, direction: 'debit', status: 'posted' },
  { id: 'le_003', amountMinor: 12000, direction: 'debit', status: 'pending' },
  { id: 'le_005', amountMinor: 32000, direction: 'credit', status: 'pending' },
  { id: 'le_006', amountMinor: 7500, direction: 'debit', status: 'held' },
  { id: 'le_007', amountMinor: 4430, direction: 'debit', status: 'reversed' },
  { id: 'le_008', amountMinor: 45000, direction: 'debit', status: 'failed' },
  { id: 'le_009', amountMinor: 4210, direction: 'debit', status: 'disputed' },
];

// ---- Short story: one bill payment from pending to posted --------------------------
const RIDGE = movementRows({
  entryId: 'le_010',
  requestId: 'req_ridge',
  auditId: 'aud_ridge1',
  eventId: 'evt_ridge1',
  kind: 'bill_pay',
  opsType: 'bill_pay',
  label: 'Bill payment',
  amountMinor: 6000,
  amountText: '$60.00',
  direction: 'outbound',
  counterparty: 'RidgeMobile',
  description: 'Bill payment — RidgeMobile',
  reference: 'MOV-2B8E5F',
});
/** What `asMovementPayload` returns for the stored payload (it always materialises `reversed`). */
const RIDGE_NORMALIZED = {
  kind: 'bill_pay',
  amountMinor: 6000,
  direction: 'outbound',
  accountId: CHK,
  counterparty: 'RidgeMobile',
  memo: null,
  ledgerEntryIds: ['le_010'],
  reversed: false,
  reference: 'MOV-2B8E5F',
};

const APPROVE_EFFECTS: StateEffect[] = [
  {
    op: 'update',
    table: 'OperationsRequest',
    id: 'req_ridge',
    set: { status: 'approved', lastAction: 'approve', lastActorId: IDS.sam, lastActorRole: 'ops_agent', lastActorName: SAM.displayName, lastActionNote: null, resolvedAt: SIM_NOW, updatedAt: SIM_NOW },
  },
  {
    op: 'insert',
    table: 'AuditLog',
    row: {
      id: 'aud_ridge2',
      actorId: IDS.sam,
      actorRole: 'ops_agent',
      action: 'ops_approve',
      entity: 'operations_request',
      entityId: 'req_ridge',
      reason: null,
      metadata: JSON.stringify({ action: 'approve', actorName: SAM.displayName, fromStatus: 'pending', toStatus: 'approved' }),
      createdAt: WALL_APPROVE,
    },
  },
];

const POST_EFFECTS: StateEffect[] = [
  { op: 'update', table: 'LedgerEntry', id: 'le_010', set: { status: 'posted', postedAt: SIM_NOW } },
  {
    op: 'insert',
    table: 'AuditLog',
    row: {
      id: 'aud_ridge3',
      actorId: IDS.sam,
      actorRole: 'ops_agent',
      action: 'movement_posted',
      entity: 'ledger_entry',
      entityId: 'le_010',
      reason: 'Posted Bill payment $60.00 (simulated)',
      metadata: JSON.stringify({ ...RIDGE_NORMALIZED, posted: 1, actorName: SAM.displayName }),
      createdAt: WALL_APPROVE,
    },
  },
  {
    op: 'insert',
    table: 'SimulatedEvent',
    row: {
      id: 'evt_ridge2',
      channel: 'email',
      direction: 'outbound',
      kind: 'movement_posted',
      status: 'sent',
      summary: 'Bill payment posted — $60.00 (simulated)',
      detail: 'SIMULATION — no real money network or provider was contacted.',
      requestId: 'req_ridge',
      metadata: null,
      createdAt: SIM_NOW,
    },
  },
];

const W = ['walkthrough'];
const P = ['pending-then-posted'];

// ---- Steps ----------------------------------------------------------------------
const steps: ScenarioStep[] = [
  // ===== Shared opening ==========================================================
  step('no-balance-column', 'note', DB, DB, 'There is no balance column', 'Account has no balance field', 'The `Account` model has an id, owner, type, name, currency, status and dates — but no balance. Balances are computed on every read from the account\'s `LedgerEntry` rows, an append-only table whose `amountMinor` is always a positive integer of cents and whose sign comes from `direction`. Money moves only by inserting rows or changing an entry\'s `status`; nothing ever edits a stored number.', {
    audience: {
      executive: 'Meridian never stores a balance. It keeps a list of every money event and works the balance out from that list each time it is asked.',
      'end-user': 'Your balance is calculated from your transaction list every time you look at it.',
      dba: 'Account (id, userId, type, name, currency, status, openedAt, interestAccruedThrough, createdAt, updatedAt) has no balance column. LedgerEntry(amountMinor Int > 0, direction credit|debit, status pending|posted|held|failed|reversed|disputed, origin, postedAt?) is indexed on accountId and status.',
    },
    detail: 1,
    payload: {
      title: 'Everyday Checking — the account row and its ledger',
      format: 'row',
      data: { Account: { id: CHK, userId: IDS.avery, type: 'checking', name: 'Everyday Checking', currency: 'USD', status: 'active' }, LedgerEntry: CHECKING_LIKE },
      typeRef: 'db:Account',
      highlight: ['Account', 'LedgerEntry'],
    },
    sources: [
      src(F.schema, 103, 129, 'model Account {', 'No balance field on Account'),
      src(F.schema, 131, 147, 'Balances are derived from these rows, never edited.'),
      src(F.ledger, 1, 14, 'NEVER stored as an editable field'),
    ],
  }),
  step('which-story', 'decision', AVERY_ROLE, DASH, 'Walk through the read, or watch one entry change?', 'choose the story', 'Two ways to see the same rules: follow one `GET /api/accounts` from the dashboard to `deriveBalances`, rule by rule, or follow one bill payment as it is inserted pending and later posted by an operator.', {
    detail: 2,
    decision: {
      question: 'Which story do you want to follow?',
      options: [
        { label: 'Full walkthrough of a balance read', variant: 'walkthrough', description: 'Dashboard → GET /api/accounts → access check → ledger rows → deriveBalances rule by rule → JSON → Current vs Available.' },
        { label: 'One payment: pending, then posted', variant: 'pending-then-posted', description: 'A pending debit lowers available only; the operator\'s approval posts it and current catches up.' },
      ],
    },
  }),

  // ===== Walkthrough: the read path ==================================================
  step('open-dashboard', 'ui', AVERY_ROLE, DASH, 'Avery opens her dashboard', 'open /dashboard', 'Avery Customer, signed in to the customer app, lands on the dashboard. On mount its effect calls `fetchAccounts()` (and, in parallel, the login history). Until the answer arrives the accounts section shows two pulsing skeleton cards.', {
    audience: { executive: 'The customer opens the app and asks to see her accounts.', 'end-user': 'Avery opens her dashboard.' },
    detail: 1,
    variants: W,
    sources: [src(F.dashboard, 536, 547, 'void fetchAccounts().then((data) =>'), src(F.dashboard, 139, 150, 'animate-pulse')],
  }),
  step('fetch-accounts', 'client', DASH, FETCH, 'fetchAccounts()', 'fetchAccounts()', '`fetchAccounts` issues `fetch(API_URL + "/api/accounts")` through `jsonInit()`, which sets `credentials: "include"` so the browser attaches the httpOnly `mer_session` cookie, and spreads `csrfHeaders()` (ignored by the server on a GET). There is no body, so no Content-Type. A non-2xx answer or a network error returns `null`, which the dashboard renders as "Accounts unavailable".', {
    detail: 3,
    variants: W,
    sources: [src(F.cuAuth, 128, 138, 'export async function fetchAccounts'), src(F.cuAuth, 35, 42, "credentials: 'include'")],
  }),
  step('get-accounts', 'request', FETCH, EP, 'GET /api/accounts', 'GET /api/accounts', 'One HTTP GET with the session cookie. The customer app sends no `x-meridian-surface` header, so the backend reads the customer cookie `mer_session`. On a safe method the global `csrfHook` checks nothing.', {
    audience: { systems: 'HTTPS GET, cookie-authenticated, no body. The route takes no query parameters.' },
    detail: 2,
    variants: W,
    payload: {
      title: 'Accounts request',
      format: 'http-request',
      line: 'GET /api/accounts',
      headers: { Cookie: 'mer_session=<session token>; mer_csrf=<csrf token>', 'x-meridian-csrf': '<csrf token>' },
      data: null,
    },
    sources: [src(F.routes, 45, 50, "app.get('/api/accounts'"), src(F.csrf, 86, 93, 'SAFE_METHODS.has(method)')],
  }),
  step('require-auth', 'guard', EP, EP, 'requireAuth resolves the session', 'requireAuth → req.user = Avery', 'The route\'s preHandler `requireAuth` reads the `mer_session` cookie and resolves it to a live session: the token is hashed and looked up, a revoked or expired session or a disabled user is refused (401 `session_expired`), a missing cookie is refused (401 `unauthenticated`). A live session slides forward eight hours — the only write this read performs — and `req.user` becomes Avery.', {
    audience: { dba: 'UPDATE Session SET lastSeenAt = now(), expiresAt = now() + 8h WHERE id = ses_avery (wall-clock time, not the simulated clock).' },
    detail: 3,
    variants: W,
    payload: { title: 'req.user', format: 'json', data: AVERY, typeRef: 'sh:auth#SessionUser' },
    effects: [{ op: 'update', table: 'Session', id: 'ses_avery', set: { lastSeenAt: WALL_GET, expiresAt: plus8h(WALL_GET) } }],
    sources: [src(F.guards, 47, 66, 'export const requireAuth'), src(F.sessions, 50, 72, 'Sliding idle timeout')],
  }),
  step('list-accessible', 'call', EP, ACCESS, 'Only the accounts Avery may see', 'listAccessibleAccounts(prisma, user.id)', 'The handler passes only the authenticated user id; the client cannot name an account here. `listAccessibleAccounts` answers "which accounts may this user see?" from `AccountAccess` grants, so Avery (owner of both) gets checking and savings, while Jordan Joint (a `joint` grant on checking only) would get checking alone.', {
    audience: { executive: 'The server only looks at accounts this customer is allowed to see.' },
    detail: 3,
    variants: W,
    payload: { title: 'Arguments', format: 'args', data: { userId: IDS.avery } },
    sources: [src(F.routes, 45, 50, 'listAccessibleAccounts(prisma, user.id)'), src(F.access, 107, 111, 'export async function listAccessibleAccounts')],
  }),
  step('read-grants', 'db-read', ACCESS, DB, 'Grants, accounts and every ledger row', 'AccountAccess ⨝ Account ⨝ LedgerEntry', 'One Prisma query loads Avery\'s `AccountAccess` rows, each with its `Account` and all of that account\'s `ledgerEntries` — every status, no date filter. Everyday Checking brings eight rows: le_001–le_003 from the fixture plus a pending deposit, a card hold, a reversed and a failed entry, and a disputed charge.', {
    audience: { dba: 'SELECT * FROM AccountAccess WHERE userId = usr_avery, including Account and all LedgerEntry rows per account (no status filter: the derivation needs pending/held rows too).' },
    detail: 4,
    variants: W,
    payload: { title: 'Everyday Checking ledger rows (fields deriveBalances uses)', format: 'row', data: CHECKING_LIKE, typeRef: 'db:LedgerEntry', highlight: ['3', '4', '5', '6', '7'] },
    sources: [src(F.access, 112, 123, 'prisma.accountAccess.findMany')],
  }),
  step('read-owned', 'db-read', ACCESS, DB, 'Fallback: owned accounts without a grant', 'Account WHERE userId', 'A second query loads accounts whose `Account.userId` is Avery, so an account created without an explicit grant is never orphaned from its owner. Both of Avery\'s accounts already came through grants, so nothing is added here.', {
    detail: 5,
    variants: W,
    sources: [src(F.access, 125, 135, 'Defensive fallback')],
  }),
  step('to-summary', 'call', ACCESS, DERIVE, 'Each account: map its rows, derive', 'toSummary → deriveBalances(entries)', '`toSummary` maps every ledger row to just `{ amountMinor, direction, status }` and calls the shared `deriveBalances`. That is the single definition of a balance in Meridian: the backend uses it here, in the movement service\'s funds check and in transfer responses. The function walks the entries once with five running totals that start at zero.', {
    detail: 3,
    variants: W,
    payload: { title: 'deriveBalances input (Everyday Checking)', format: 'args', data: CHECKING_LIKE.map(({ amountMinor, direction, status }) => ({ amountMinor, direction, status })), typeRef: 'sh:ledger#LedgerEntryLike' },
    sources: [src(F.access, 38, 55, 'const balances = deriveBalances('), src(F.ledger, 79, 96, 'export function deriveBalances')],
  }),
  step('assert-minor', 'validate', DERIVE, DERIVE, 'Every amount must be a positive integer', 'assertMinor + amountMinor ≥ 0', 'Before applying any rule, each entry\'s amount is checked: `assertMinor` throws on a non-integer or unsafe integer, and a negative amount throws "ledger amountMinor must be positive; use `direction` to indicate sign". All eight checking amounts pass.', {
    detail: 5,
    variants: W,
    sources: [src(F.ledger, 97, 101, 'assertMinor(entry.amountMinor'), src(F.ledgerTest, 49, 53, 'throws if an amount is negative')],
  }),
  step('rule-posted', 'call', DERIVE, DERIVE, 'Rule: posted counts in current and available', "case 'posted' → ±amount to both", 'A posted entry is settled money. Its signed amount (credit +, debit −) is added to both current and available. le_001 adds 250000 (opening deposit) and le_002 subtracts 4890 (QuickFuel card purchase).', {
    audience: { 'end-user': 'Completed transactions change both of your balances.', dba: 'current = available = 250000 − 4890 = 245110.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals after the posted rows', format: 'json', data: { applied: ['le_001 +250000', 'le_002 −4890'], ...bal(245110, 245110) }, highlight: ['currentMinor', 'availableMinor'] },
    sources: [src(F.ledger, 104, 110, "case 'posted':"), src(F.ledger, 75, 77, 'function signed')],
  }),
  step('rule-pending-credit', 'call', DERIVE, DERIVE, 'Rule: a pending credit is tracked, not spendable', "case 'pending' (credit)", 'A pending credit is incoming money that has not settled. It is added to `pendingCreditMinor` only — neither current nor available rises. le_005, a $320.00 mobile check deposit still awaiting operator review, adds 32000 to pending credits and nothing else. This is the conservative choice the doc comment names: Avery cannot spend a deposit before it posts.', {
    audience: { executive: 'Money on its way in is shown but cannot be spent until it clears.', 'end-user': 'Your $320.00 check deposit shows as pending; you cannot spend it yet.', dba: 'pendingCredit = 32000; current and available stay 245110.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals', format: 'json', data: { applied: ['le_005 pending credit 32000'], ...bal(245110, 245110, 32000) }, highlight: ['pendingCreditMinor'] },
    sources: [src(F.ledger, 111, 113, 'pendingCreditMinor += entry.amountMinor'), src(F.ledger, 82, 85, 'credits are tracked but NOT added to available')],
  }),
  step('rule-pending-debit', 'call', DERIVE, DERIVE, 'Rule: a pending debit is reserved at once', "case 'pending' (debit)", 'A pending debit is outgoing money not yet settled. It is added to `pendingDebitMinor` and subtracted from available immediately, but current is unchanged. le_003, the $120.00 City Power & Light bill payment waiting for an operator, takes available from 245110 to 233110.', {
    audience: { executive: 'Money on its way out is set aside straight away, so it cannot be spent twice.', 'end-user': 'Your $120.00 bill payment is pending: it already reduces what you can spend.', dba: 'pendingDebit = 12000; available = 245110 − 12000 = 233110; current stays 245110.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals', format: 'json', data: { applied: ['le_003 pending debit 12000'], ...bal(245110, 233110, 32000, 12000) }, highlight: ['pendingDebitMinor', 'availableMinor'] },
    sources: [src(F.ledger, 114, 119, 'pendingDebitMinor += entry.amountMinor')],
  }),
  step('rule-held', 'call', DERIVE, DERIVE, 'Rule: a hold reduces available only', "case 'held'", 'A held entry is an authorization hold. Its amount is added to `heldMinor` and subtracted from available; current is unchanged. le_006, a $75.00 rental-car hold from DriveEasy Cars, takes available from 233110 to 225610.', {
    audience: { 'end-user': 'A $75.00 card hold lowers what you can spend, but not your current balance.', dba: 'held = 7500; available = 233110 − 7500 = 225610.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals', format: 'json', data: { applied: ['le_006 held 7500'], ...bal(245110, 225610, 32000, 12000, 7500) }, highlight: ['heldMinor', 'availableMinor'] },
    sources: [src(F.ledger, 120, 124, "case 'held':")],
  }),
  step('rule-failed-reversed', 'call', DERIVE, DERIVE, 'Rule: failed and reversed entries count for nothing', "case 'failed' / 'reversed'", 'Failed and reversed entries stay in the ledger as history but have no balance effect. le_008 is a $450.00 outbound ACH payment an operator rejected (pending → failed); le_007 is a $44.30 QuickFuel charge that was posted and later reversed (posted → reversed), the shared primitive behind movement reversals, upheld disputes and confirmed fraud. Neither row is deleted; neither changes any total.', {
    audience: { executive: 'Cancelled and refunded items remain on record but no longer affect the balance.', 'end-user': 'A rejected payment and a refunded charge appear in your history but do not change your balance.', dba: 'No change: le_007 (reversed, 4430) and le_008 (failed, 45000) contribute 0.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals (unchanged)', format: 'json', data: { applied: ['le_007 reversed 4430 → 0', 'le_008 failed 45000 → 0'], ...bal(245110, 225610, 32000, 12000, 7500) } },
    sources: [src(F.ledger, 125, 128, "case 'reversed':"), src(F.movements, 397, 404, 'export async function reverseLedgerEntries'), src(F.ledgerTest, 40, 47, 'ignores failed and reversed entries entirely')],
  }),
  step('rule-disputed', 'call', DERIVE, DERIVE, 'Rule: a disputed entry still counts as posted', "case 'disputed'", 'A disputed entry shares the posted branch: its signed amount changes both current and available while the dispute is open. le_009, a $42.10 Trattoria Romana charge Avery is disputing, subtracts 4210 from both. If an operator upholds the dispute, the entry is flipped to reversed and stops counting.', {
    audience: { 'end-user': 'A charge you are disputing still counts against your balance until the dispute is decided.', dba: 'current = 245110 − 4210 = 240900; available = 225610 − 4210 = 221400.' },
    detail: 3,
    variants: W,
    payload: { title: 'Running totals', format: 'json', data: { applied: ['le_009 disputed −4210'], ...CHECKING_BAL }, highlight: ['currentMinor', 'availableMinor'] },
    sources: [src(F.ledger, 104, 110, "case 'disputed':"), src(F.ledger, 26, 26, 'treated as posted for now')],
  }),
  step('derived-result', 'state', DERIVE, ACCESS, 'The DerivedBalances result', 'return { current, available, … }', 'The loop ends and returns five numbers. Current = posted + disputed = 250000 − 4890 − 4210 = 240900 ($2,409.00). Available = current − pending debits − holds = 240900 − 12000 − 7500 = 221400 ($2,214.00). Pending credits (32000) are reported but not included in either. The order of the entries does not matter: every rule only adds or subtracts.', {
    audience: {
      executive: 'Everyday Checking: $2,409.00 settled, $2,214.00 available to spend, $320.00 on its way in.',
      'end-user': 'Current balance $2,409.00; available $2,214.00.',
      dba: 'current 240900 = 250000 − 4890 − 4210; available 221400 = 240900 − 12000 − 7500; pendingCredit 32000; pendingDebit 12000; held 7500. Goal Savings (le_004 only): 500000 / 500000.',
    },
    detail: 1,
    variants: W,
    payload: { title: 'DerivedBalances — Everyday Checking', format: 'return', data: CHECKING_BAL, typeRef: 'sh:ledger#DerivedBalances', highlight: ['currentMinor', 'availableMinor'] },
    sources: [src(F.ledger, 62, 73, 'export interface DerivedBalances'), src(F.ledger, 132, 132, 'return { currentMinor, availableMinor'), src(F.ledgerTest, 25, 38, 'reserves pending debits and holds from available')],
  }),
  step('build-summary', 'call', ACCESS, EP, 'AccountSummary per account, sorted by name', 'AccountSummary[] (by name)', '`toSummary` wraps the balances with the account\'s id, name, type, status, currency and the caller\'s relationship (`owner` for both of Avery\'s). `listAccessibleAccounts` returns the summaries sorted by name, so Everyday Checking comes before Goal Savings.', {
    detail: 4,
    variants: W,
    sources: [src(F.access, 56, 64, 'relationship,'), src(F.access, 137, 139, "localeCompare(b.name)"), src(F.sharedAuth, 131, 144, 'export interface AccountSummary')],
  }),
  step('accounts-response', 'response', EP, FETCH, '200 { accounts }', '200 { accounts: [...] }', 'The handler sends `{ accounts }`. Each balance in the JSON was computed during this request; none was read from storage. Integer minor units travel as they are — formatting to dollars happens in the browser.', {
    audience: { systems: 'JSON body, integers in cents; no caching layer between the handler and the ledger.' },
    detail: 2,
    variants: W,
    payload: { title: 'Accounts response', format: 'http-response', line: '200 OK', data: ACCOUNTS_RESPONSE, typeRef: 'sh:auth#AccountSummary', highlight: ['accounts.0.balances.currentMinor', 'accounts.0.balances.availableMinor'] },
    sources: [src(F.routes, 48, 49, 'return reply.send({ accounts })')],
  }),
  step('dashboard-shows', 'ui', DASH, AVERY_ROLE, 'Available vs Current on the card', 'Available $2,214.00 · Current $2,409.00', 'The Everyday Checking card shows Available $2,214.00 in large type and Current $2,409.00 beside it, then "Includes $195.00 pending/held." — pending debits plus holds (12000 + 7500). The pending $320.00 deposit is not mentioned on the card. The headline "Total available cash" sums available across checking and savings: 221400 + 500000 = $7,214.00.', {
    audience: {
      executive: 'The customer sees two numbers: what has settled and what she can spend now.',
      'end-user': 'Avery sees $2,214.00 available and $2,409.00 current, with $195.00 pending or on hold. Her total available cash is $7,214.00.',
    },
    detail: 1,
    variants: W,
    payload: { title: 'What the card renders', format: 'json', data: { Available: '$2,214.00', Current: '$2,409.00', note: 'Includes $195.00 pending/held.', 'Total available cash': '$7,214.00' } },
    sources: [src(F.dashboard, 108, 129, 'balances.pendingDebitMinor + balances.heldMinor'), src(F.dashboard, 179, 181, 'const totalAvailable')],
  }),
  step('conservation', 'note', DERIVE, DB, 'The settled total and where money may come from', 'settledTotalMinor · BANK_ORIGINATED_ORIGINS', '`settledTotalMinor` sums the signed posted and disputed entries — summed over every account it is the system\'s money supply. An internal transfer posts a debit and a credit of the same amount, so it leaves that total unchanged. Only a bank-originated origin (`seed`, `interest`, `fee`, `adjustment`, `deposit`) may add value; a settled credit of any other origin, other than a transfer leg, is "money from nowhere". The ledger test pins the transfer case.', {
    audience: { executive: 'Moving money between accounts never creates money; new money can only come from the bank\'s own events such as deposits and interest.', dba: 'SUM(CASE direction WHEN credit THEN amountMinor ELSE -amountMinor END) over status IN (posted, disputed) is invariant under transfers.' },
    detail: 3,
    variants: W,
    payload: { title: 'Bank-originated origins', format: 'json', data: { BANK_ORIGINATED_ORIGINS: ['seed', 'interest', 'fee', 'adjustment', 'deposit'], notBankOriginated: ['transfer', 'payment', 'card'] }, typeRef: 'sh:ledger#BANK_ORIGINATED_ORIGINS' },
    sources: [src(F.ledger, 135, 148, 'export function settledTotalMinor'), src(F.ledger, 47, 54, 'export const BANK_ORIGINATED_ORIGINS'), src(F.ledgerTest, 56, 80, 'an internal transfer conserves total settled value across accounts')],
  }),
  step('seed-invariants', 'note', DERIVE, DB, 'The seed is checked against the same invariant', 'assertSeedInvariants', 'The demo seed is held to the rule before it is written: `assertSeedInvariants` requires settled transfer legs to net to zero and every settled credit to be a transfer leg or bank-originated. `seed-plan.test.ts` runs it on the real plan and proves it rejects a tampered plan that adds a posted `card` credit ("illegal magic money").', {
    detail: 4,
    variants: W,
    sources: [src(F.seedPlan, 839, 870, 'export function assertSeedInvariants'), src(F.seedPlanTest, 49, 71, 'rejects a tampered plan that conjures money from nowhere')],
  }),

  // ===== Short story: pending, then posted ============================================
  step('pp-before', 'state', DB, AVERY_ROLE, 'Starting point', 'current $2,409.00 · available $2,214.00', 'Everyday Checking starts at current 240900 and available 221400 (the same eight entries as the walkthrough: one pending bill payment, one hold, one disputed charge, plus rows with no effect).', {
    audience: { executive: 'The customer has $2,409.00 settled and $2,214.00 she can spend.' },
    detail: 1,
    variants: P,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: CHECKING_BAL, typeRef: 'sh:ledger#DerivedBalances' },
    sources: [src(F.ledger, 90, 133, 'export function deriveBalances')],
  }),
  step('pp-submit', 'call', AVERY_ROLE, MOVES, 'Avery submits a $60.00 bill payment', 'createExternalMovement(bill_pay, 6000)', 'Avery pays $60.00 to RidgeMobile from the Move money page. `POST /api/movements` validates the request and calls `createExternalMovement`, which confirms she may move money on the account and that 6000 does not exceed available (221400). The `external-movement` scenario shows this request in full.', {
    audience: { 'end-user': 'Avery pays her $60.00 phone bill.' },
    detail: 2,
    variants: P,
    confidence: 'simplified',
    payload: { title: 'Normalized movement', format: 'args', data: { accountId: CHK, kind: 'bill_pay', amountMinor: 6000, direction: 'outbound', counterparty: 'RidgeMobile', memo: null }, typeRef: 'sh:money-movement#NormalizedExternalMovement' },
    sources: [src(F.movements, 280, 291, 'export async function createExternalMovement')],
  }),
  step('pp-insert-pending', 'db-write', MOVES, DB, 'A pending debit row is inserted', 'INSERT LedgerEntry (pending debit)', 'Inside one transaction the service inserts the ledger entry with `status: "pending"`, `origin: "payment"` and `postedAt: null`. No balance is touched — there is none to touch. The same transaction writes the linked operations request (its payload lists `ledgerEntryIds: ["le_010"]`), an `ops_request_created` audit row and a "received — under review" simulated email.', {
    audience: { dba: 'INSERT LedgerEntry le_010 (debit 6000, pending, origin payment, postedAt NULL); INSERT OperationsRequest req_ridge (bill_pay, pending, payload JSON); INSERT AuditLog; INSERT SimulatedEvent — one transaction.' },
    detail: 3,
    variants: P,
    payload: { title: 'LedgerEntry le_010', format: 'row', data: RIDGE.entry, typeRef: 'db:LedgerEntry', highlight: ['status', 'postedAt'] },
    effects: [
      { op: 'insert', table: 'LedgerEntry', row: RIDGE.entry },
      { op: 'insert', table: 'OperationsRequest', row: RIDGE.request },
      { op: 'insert', table: 'AuditLog', row: RIDGE.audit },
      { op: 'insert', table: 'SimulatedEvent', row: RIDGE.event },
    ],
    sources: [src(F.movements, 314, 328, "status: 'pending'"), src(F.movements, 330, 365, 'ledgerEntryIds: [entry.id]')],
  }),
  step('pp-available-drops', 'state', DB, AVERY_ROLE, 'Available drops; current does not', 'available $2,214.00 → $2,154.00', 'On the next `GET /api/accounts` the new row hits the pending-debit rule: available falls by 6000 to 215400 and pending debits rise to 18000, while current stays 240900. The dashboard card now reads "Includes $255.00 pending/held." (18000 + 7500). The money is reserved, so Avery cannot spend it twice, but it has not left.', {
    audience: {
      executive: 'The payment is set aside immediately; it has not been paid yet.',
      'end-user': 'Avery\'s available balance drops to $2,154.00 straight away; her current balance stays $2,409.00.',
      dba: 'available = 240900 − 18000 − 7500 = 215400; current unchanged at 240900.',
    },
    detail: 1,
    variants: P,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: CHECKING_BAL, after: bal(240900, 215400, 32000, 18000, 7500) }, highlight: ['after.availableMinor', 'after.currentMinor'] },
    sources: [src(F.ledger, 114, 119, 'availableMinor -= entry.amountMinor'), src(F.dashboard, 124, 129, 'pending/held'), src(F.moneyTest, 189, 201, 'The pending debit immediately reserves available')],
  }),
  step('pp-approve', 'call', OPS, MOVES, 'Sam approves the request', 'applyOperatorAction(approve)', 'Sam Operator approves req_ridge in the operations console. `applyOperatorAction` finds a movement payload on the request and, in one transaction, marks the request `approved` with Sam as last actor, writes the `ops_approve` audit row and calls `postApprovedMovement`. The `ops-approval` scenario shows this request in full.', {
    audience: { executive: 'A bank employee approves the payment.', 'end-user': 'The bank approves Avery\'s payment.' },
    detail: 2,
    variants: P,
    effects: APPROVE_EFFECTS,
    sources: [src(F.requests, 333, 346, 'postApprovedMovement(tx, existing, input.actor, now)')],
  }),
  step('pp-post', 'db-write', MOVES, DB, 'pending → posted', 'UPDATE LedgerEntry SET status = posted', '`postApprovedMovement` follows the soft link in the payload and runs `updateMany` on those ids that are still pending: `status` becomes `posted` and `postedAt` the simulated now. It then audits `movement_posted` (metadata: the normalized payload, `posted: 1`, Sam\'s name) and records a "posted" simulated email. The amount column is never touched.', {
    audience: { dba: 'UPDATE LedgerEntry SET status = \'posted\', postedAt = <sim now> WHERE id IN (le_010) AND status = \'pending\'; INSERT AuditLog (movement_posted); INSERT SimulatedEvent (movement_posted).' },
    detail: 3,
    variants: P,
    payload: { title: 'updateMany', format: 'args', data: { where: { id: { in: ['le_010'] }, status: 'pending' }, data: { status: 'posted', postedAt: SIM_NOW } }, highlight: ['data.status'] },
    effects: POST_EFFECTS,
    sources: [src(F.movements, 439, 476, 'export async function postApprovedMovement')],
  }),
  step('pp-current-catches-up', 'state', DB, AVERY_ROLE, 'Current catches up; available stays', 'current $2,409.00 → $2,349.00', 'The entry now hits the posted rule instead of the pending one: current falls by 6000 to 234900, pending debits drop back to 12000, and available stays 215400 — it already excluded the $60.00. Posting the debit also lowers the system-wide settled total by 6000: money leaves through a posted payment debit, the only way besides a bank-originated credit that the total moves.', {
    audience: {
      executive: 'The payment is complete; the settled balance now matches what was already set aside.',
      'end-user': 'Avery\'s current balance becomes $2,349.00; her available balance stays $2,154.00. The payment no longer reads Pending.',
      dba: 'current = 250000 − 4890 − 4210 − 6000 = 234900; available = 234900 − 12000 − 7500 = 215400.',
    },
    detail: 1,
    variants: P,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: bal(240900, 215400, 32000, 18000, 7500), after: bal(234900, 215400, 32000, 12000, 7500) }, highlight: ['after.currentMinor', 'after.pendingDebitMinor'] },
    sources: [src(F.ledger, 104, 110, "case 'posted':"), src(F.movements, 44, 45, 'system-wide settled total only ever moves'), src(F.moneyTest, 259, 277, 'approving an outbound movement posts the debit')],
  }),
];

export const scenario: Scenario = {
  id: 'account-balances',
  title: 'How a balance is derived',
  question: 'How are account balances calculated?',
  summary:
    'Meridian stores no balance. When Avery opens her dashboard, GET /api/accounts loads only the accounts she may see, with all their ledger entries, and the shared deriveBalances applies one rule per entry status to produce current and available balances. A short variant follows one bill payment from pending (available drops) to posted (current catches up).',
  category: 'data',
  tags: ['ledger', 'data', 'money', 'balances'],
  participants: [AVERY_ROLE, DASH, FETCH, EP, ACCESS, DERIVE, DB, MOVES, OPS],
  related: [
    'ep:GET /api/accounts',
    'be:routes/accounts',
    'be:auth/access#listAccessibleAccounts',
    'be:auth/access#getAccessibleAccount',
    'sh:ledger#deriveBalances',
    'sh:ledger#DerivedBalances',
    'sh:ledger#settledTotalMinor',
    'sh:ledger#BANK_ORIGINATED_ORIGINS',
    'sh:ledger#LEDGER_STATUSES',
    'sh:auth#AccountSummary',
    'cu:pages/Dashboard',
    'cu:lib/auth#fetchAccounts',
    'be:money/movements#postApprovedMovement',
    'be:seed-plan',
    'test:apps/backend/src/seed-plan.test.ts',
    'test:apps/backend/src/routes/money.test.ts',
    'db:Account',
    'db:LedgerEntry',
    'db:AccountAccess',
    'feat:balances',
    'feat:accounts',
  ],
  variants: [
    { id: 'walkthrough', label: 'Full walkthrough', description: 'Dashboard → GET /api/accounts → access-scoped lookup → deriveBalances rule by rule → Current vs Available on screen.', outcome: 'info' },
    { id: 'pending-then-posted', label: 'Pending, then posted', description: 'A $60.00 bill payment is inserted pending (available drops, current unchanged), then an operator approval posts it (current catches up).', outcome: 'success' },
  ],
  defaultVariant: 'walkthrough',
  initialState: {
    ...baseState(),
    LedgerEntry: [...baseState().LedgerEntry, ...EXTRA_ENTRIES],
    Session: [SESSION_AVERY],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    src(F.ledger, 79, 133, 'export function deriveBalances'),
    src(F.access, 107, 140, 'export async function listAccessibleAccounts'),
    src(F.routes, 45, 50, "app.get('/api/accounts'"),
    src(F.dashboard, 64, 136, 'function AccountOverviewCard'),
  ],
};
