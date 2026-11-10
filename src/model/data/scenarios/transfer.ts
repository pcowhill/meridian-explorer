import type { Scenario, ScenarioStep, SourceRef } from '../../types';
import { IDS, baseState } from '../fixtures';
import {
  AVERY,
  CHK,
  HEADERS_NO_CSRF,
  HEADERS_NO_SESSION,
  HEADERS_OK,
  JORDAN,
  SAV,
  SIM_NOW,
  WALL_NOW,
  auditRow,
  bal,
  ledgerRow,
  step,
  summaryOf,
} from '../money/scenario-data';

/**
 * "What happens when a customer transfers money?"
 *
 * Avery Customer moves $250.00 (25000 minor) from Everyday Checking to Goal
 * Savings on the Move money page. Internal transfers are immediate: the server
 * posts both legs and the audit row in one transaction, then re-derives both
 * balances for the response.
 */

// ---- Lanes ------------------------------------------------------------------
const AV = 'role:customer';
const PAGE = 'cu:pages/MoveMoney';
const LIB = 'cu:lib/money#createTransfer';
const EP = 'ep:POST /api/transfers';
const AUTH = 'be.auth';
const ABUSE = 'be.abuse';
const VAL = 'sh:money-movement#validateTransfer';
const SVC = 'be:money/movements#createTransfer';
const DB = 'db';

// ---- Files ------------------------------------------------------------------
const F = {
  page: 'apps/customer/src/pages/MoveMoney.tsx',
  lib: 'apps/customer/src/lib/money.ts',
  cuCsrf: 'apps/customer/src/lib/csrf.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  server: 'apps/backend/src/server.ts',
  rate: 'apps/backend/src/abuse/rate-limit.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  sessions: 'apps/backend/src/auth/sessions.ts',
  route: 'apps/backend/src/routes/money.ts',
  shMove: 'packages/shared/src/money-movement.ts',
  shDemo: 'packages/shared/src/public-demo.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  movements: 'apps/backend/src/money/movements.ts',
  access: 'apps/backend/src/auth/access.ts',
  ledger: 'packages/shared/src/ledger.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  test: 'apps/backend/src/routes/money.test.ts',
  csrfTest: 'apps/backend/src/routes/csrf.test.ts',
} as const;
const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef => ({ file, start, end, symbol, ...(note ? { note } : {}) });

// ---- Variants ---------------------------------------------------------------
const OK = 'success';
const INVALID = 'invalid-input';
const FUNDS = 'insufficient-funds';
const FORBIDDEN = 'forbidden-account';
const NOAUTH = 'not-signed-in';
const CSRF = 'csrf-missing';

/** Variants that start from Avery's own form submission. */
const FORM = [OK, FUNDS, NOAUTH];
/** Variants still running after each server-side gate. */
const PAST_CSRF = [OK, INVALID, FUNDS, FORBIDDEN, NOAUTH];
const PAST_AUTH = [OK, INVALID, FUNDS, FORBIDDEN];
const PAST_VALIDATOR = [OK, FUNDS, FORBIDDEN];
const PAST_ACCESS = [OK, FUNDS];

// ---- Example values ---------------------------------------------------------
const AMOUNT = 25000;
const OVER = 240000; // $2,400.00 — below the $2,451.10 current balance, above the $2,331.10 available
const MEMO = 'Move to savings';
const plus8h = (iso: string) => new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString();

const BODY = { fromAccountId: CHK, toAccountId: SAV, amountMinor: AMOUNT, memo: MEMO };
const BODY_OVER = { fromAccountId: CHK, toAccountId: SAV, amountMinor: OVER, memo: MEMO };
const BODY_SAME = { fromAccountId: CHK, toAccountId: CHK, amountMinor: AMOUNT, memo: MEMO };
const BODY_JORDAN = { fromAccountId: SAV, toAccountId: CHK, amountMinor: 1000, memo: null };

const CHK_BEFORE = bal(245110, 233110, 0, 12000);
const SAV_BEFORE = bal(500000, 500000);
const CHK_AFTER = bal(220110, 208110, 0, 12000);
const SAV_AFTER = bal(525000, 525000);

const DEBIT = ledgerRow({
  id: 'le_101',
  accountId: CHK,
  amountMinor: AMOUNT,
  direction: 'debit',
  status: 'posted',
  origin: 'transfer',
  description: `Transfer to Goal Savings — ${MEMO}`,
  postedAt: SIM_NOW,
});
const CREDIT = ledgerRow({
  id: 'le_102',
  accountId: SAV,
  amountMinor: AMOUNT,
  direction: 'credit',
  status: 'posted',
  origin: 'transfer',
  description: `Transfer from Everyday Checking — ${MEMO}`,
  postedAt: SIM_NOW,
});
const AUDIT = auditRow({
  id: 'aud_101',
  actor: AVERY,
  action: 'money_transfer',
  entity: 'account',
  entityId: CHK,
  reason: 'Transfer $250.00 to Goal Savings (simulated)',
  metadata: { amountMinor: AMOUNT, fromAccountId: CHK, toAccountId: SAV, actorName: AVERY.displayName },
});

const RESPONSE = {
  ok: true,
  message: 'Transfer posted (simulated). Both accounts have been updated.',
  amountMinor: AMOUNT,
  accounts: [summaryOf('checking', CHK_AFTER), summaryOf('savings', SAV_AFTER)],
};

const JORDAN_HEADERS: Record<string, string> = {
  Cookie: 'mer_session=<Jordan session token>; mer_csrf=<Jordan csrf token>',
  'x-meridian-csrf': '<Jordan csrf token>',
  'Content-Type': 'application/json',
};

const sessionTouch = (id: string) => ({ op: 'update' as const, table: 'Session', id, set: { lastSeenAt: WALL_NOW, expiresAt: plus8h(WALL_NOW) } });

/** Variant groups that carry different example data (amount, accounts, caller). */
interface Group {
  suffix: string;
  variants: string[];
  body: { fromAccountId: string; toAccountId: string; amountMinor: number; memo: string | null };
  user: { id: string; email: string; displayName: string; role: string };
}
const GROUPS: Group[] = [
  { suffix: '', variants: [OK, NOAUTH, CSRF], body: BODY, user: AVERY },
  { suffix: '-over', variants: [FUNDS], body: BODY_OVER, user: AVERY },
  { suffix: '-same', variants: [INVALID], body: BODY_SAME, user: AVERY },
  { suffix: '-jordan', variants: [FORBIDDEN], body: BODY_JORDAN, user: JORDAN },
];
/** One copy of a step per group that is still running at that point (`allowed`). */
function split(allowed: string[], make: (g: Group) => ScenarioStep): ScenarioStep[] {
  return GROUPS.map((g) => ({ ...g, variants: g.variants.filter((v) => allowed.includes(v)) }))
    .filter((g) => g.variants.length > 0)
    .map((g) => {
      const s = make(g);
      return { ...s, id: s.id + g.suffix, variants: g.variants };
    });
}

// ---- Small builders ---------------------------------------------------------

function request(id: string, variant: string, from: string, headers: Record<string, string>, body: unknown, title: string, narrative: string, extra: Partial<ScenarioStep> = {}): ScenarioStep {
  return step(id, 'request', from, EP, title, 'POST /api/transfers', narrative, {
    detail: 2,
    variants: [variant],
    payload: { title: 'Transfer request', format: 'http-request', line: 'POST /api/transfers', headers, data: body, typeRef: 'sh:money-movement#TransferRequest', highlight: ['amountMinor', 'fromAccountId', 'toAccountId'] },
    ...extra,
  });
}

function errorResponse(id: string, variant: string, to: string, status: string, body: Record<string, unknown>, narrative: string, sources: SourceRef[], extra: Partial<ScenarioStep> = {}): ScenarioStep {
  return step(id, 'response', EP, to, `${status.split(' ')[0]} ${String(body.code)}`, `${status} { code: '${String(body.code)}' }`, narrative, {
    detail: 2,
    variants: [variant],
    payload: { title: 'Error response', format: 'http-response', line: status, data: body, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code'] },
    sources,
    ...extra,
  });
}

function nothingWritten(id: string, variant: string, narrative: string, extra: Partial<ScenarioStep> = {}): ScenarioStep {
  return step(id, 'state', DB, DB, 'Nothing moved', 'no ledger rows', narrative, {
    detail: 2,
    variants: [variant],
    payload: {
      title: 'Derived balances (unchanged)',
      format: 'json',
      data: { [CHK]: CHK_BEFORE, [SAV]: SAV_BEFORE },
      typeRef: 'sh:ledger#DerivedBalances',
      highlight: [`${CHK}.availableMinor`],
    },
    ...extra,
  });
}

// ---- Steps ------------------------------------------------------------------

const steps: ScenarioStep[] = [
  step('start', 'state', DB, DB, 'Starting balances', 'derived from 4 ledger rows',
    'Before anything happens, Everyday Checking has $2,451.10 posted (an opening deposit minus a QuickFuel card purchase) and $2,331.10 available, because a pending $120.00 bill payment is already reserved out of available. Goal Savings has $5,000.00. Neither number is stored: both are derived from LedgerEntry rows.',
    {
      detail: 2,
      audience: {
        executive: 'Avery has $2,331.10 she can spend in checking and $5,000.00 in savings.',
        dba: 'No balance column exists. Balances are computed from LedgerEntry rows (le_001…le_004) on every read.',
      },
      payload: { title: 'Derived balances', format: 'json', data: { [CHK]: CHK_BEFORE, [SAV]: SAV_BEFORE }, typeRef: 'sh:ledger#DerivedBalances', highlight: [`${CHK}.availableMinor`, `${CHK}.pendingDebitMinor`] },
      sources: [src(F.ledger, 90, 133, 'export function deriveBalances')],
    }),

  // ---- How the request is produced -----------------------------------------
  step('fill-form', 'ui', AV, PAGE, 'Avery fills in the transfer', 'click "Transfer now"',
    'On Move money → Transfer, Avery picks From = Everyday Checking, To = Goal Savings, types 250.00 and the memo "Move to savings", then clicks "Transfer now". The selectors only list accounts that are active and not view-only, and each selector hides the account chosen in the other, so the form cannot pick the same account twice. `handleSubmit` runs.',
    {
      detail: 1,
      variants: [OK, NOAUTH],
      audience: {
        executive: 'A customer asks to move $250.00 from checking to savings.',
        'end-user': 'You choose the two accounts, enter $250.00 and press "Transfer now".',
      },
      sources: [src(F.page, 70, 73, 'function movableAccounts'), src(F.page, 140, 140, 'const options = exclude'), src(F.page, 472, 474, 'Transfer now')],
    }),
  step('fill-form-over', 'ui', AV, PAGE, 'Avery asks for more than she can spend', 'click "Transfer now"',
    'Avery fills in the same form but types 2400.00. That is less than the $2,451.10 posted balance but more than the $2,331.10 available, because the pending bill payment already reserves $120.00. The option labels show the available amount, but nothing in the form stops her.',
    {
      detail: 1,
      variants: [FUNDS],
      audience: {
        executive: 'A customer asks to move $2,400.00 — more than is available to spend.',
        'end-user': 'You enter $2,400.00, which is more than your available balance.',
      },
      sources: [src(F.page, 76, 81, 'function accountOptionLabel'), src(F.page, 472, 474, 'Transfer now')],
    }),
  step('crafted-same', 'note', AV, AV, 'A request sent around the form', 'hand-made request',
    'The form cannot produce this request: its selectors exclude each other\'s choice and it runs the same validator before sending. Here the request is sent directly — for example from a script in Avery\'s signed-in tab — with Everyday Checking as both source and destination. The client-side check is a convenience; the server must check again.',
    { detail: 1, variants: [INVALID], audience: { executive: 'Someone sends the bank a malformed transfer directly, skipping the app\'s screen.' }, sources: [src(F.page, 140, 140, 'const options = exclude')] }),
  step('crafted-jordan', 'note', AV, AV, 'Jordan targets an account he cannot use', 'hand-made request',
    'Jordan Joint (role joint_customer) has joint access to Everyday Checking only — he has no grant on Goal Savings. With a single movable account his Transfer tab shows "Need two accounts", so he sends the request directly from his signed-in tab: $10.00 from Goal Savings to Everyday Checking. This is the case `money.test.ts` pins down.',
    {
      detail: 1,
      variants: [FORBIDDEN],
      audience: { executive: 'A joint customer tries to pull money out of an account that is not shared with him.' },
      sources: [src(F.page, 413, 423, 'Need two accounts'), src(F.test, 121, 130, 'forbids transferring from an account the caller cannot access')],
    }),
  step('forged', 'note', AV, AV, 'A request without the CSRF header', 'forged request',
    'A request reaches the server carrying Avery\'s cookies (`mer_session` and `mer_csrf`) but no `x-meridian-csrf` header. That is the shape of a forged cross-site request: a foreign page can make the browser attach cookies, but it can neither read `mer_csrf` nor set a custom header without a CORS preflight the allowlist blocks.',
    {
      detail: 1,
      variants: [CSRF],
      audience: { executive: 'Another website tries to make Avery\'s browser move her money without her knowing.' },
      sources: [src(F.csrf, 7, 28, 'double-submit token'), src(F.csrfTest, 43, 48, 'rejects an authenticated state-changing POST with NO csrf header')],
    }),

  // ---- Client side ----------------------------------------------------------
  ...split(FORM, (g) =>
    step('client-validate', 'validate', PAGE, VAL, 'Validate in the browser', 'validateTransfer(form)',
      '`handleSubmit` converts the typed dollars with `parseAmountMinor` (`toMinor` rounds to whole cents) and calls the shared `validateTransfer` — the same function the server runs. It checks the shape only: both ids present and different, amount an integer between 1 and 5,000,000 minor units ($0.01–$50,000), memo trimmed and cut to 140 characters. It cannot see balances, so it passes; the field errors are cleared and the button switches to "Transferring…".',
      {
        detail: 3,
        payload: { title: 'validateTransfer input', format: 'args', data: g.body, typeRef: 'sh:money-movement#TransferRequest', highlight: ['amountMinor'] },
        sources: [src(F.page, 383, 400, 'const check = validateTransfer({'), src(F.page, 262, 268, 'function parseAmountMinor'), src(F.shMove, 200, 224, 'export function validateTransfer')],
      }),
  ),
  ...split(FORM, (g) =>
    step('client-send', 'client', PAGE, LIB, 'Call the money client', 'createTransfer(check.value)',
      'The page passes the validator\'s normalized value to `createTransfer` in `lib/money.ts`. `postMoney` builds the fetch with `jsonInit`: `credentials: "include"` so the httpOnly `mer_session` cookie rides along, `Content-Type: application/json`, and `csrfHeaders()`, which reads the non-httpOnly `mer_csrf` cookie from `document.cookie` and echoes it as `x-meridian-csrf`. The customer app sends no surface header, so the backend uses the customer cookie.',
      {
        detail: 3,
        payload: { title: 'NormalizedTransfer', format: 'args', data: g.body, typeRef: 'sh:money-movement#NormalizedTransfer', highlight: ['amountMinor'] },
        sources: [src(F.page, 401, 401, 'await createTransfer(check.value)'), src(F.lib, 40, 47, 'const jsonInit'), src(F.lib, 122, 128, 'export function createTransfer'), src(F.cuCsrf, 39, 42, 'export function csrfHeaders')],
      }),
  ),

  request('request', OK, LIB, HEADERS_OK, BODY, 'POST the transfer',
    'One HTTPS POST with a JSON body. The amount travels as integer minor units (25000), never as a decimal string.',
    { audience: { systems: 'fetch POST, JSON body, session cookie + double-submit CSRF header.' }, sources: [src(F.lib, 92, 94, 'async function postMoney')] }),
  request('request-over', FUNDS, LIB, HEADERS_OK, BODY_OVER, 'POST the transfer', 'The same POST with amountMinor 240000.', { sources: [src(F.lib, 92, 94, 'async function postMoney')] }),
  request('request-nosession', NOAUTH, LIB, HEADERS_NO_SESSION, BODY, 'POST without a session', 'The browser no longer holds the `mer_session` cookie (the session has ended in this browser), so only `mer_csrf` and the echoed header go out with the body.', { sources: [src(F.lib, 92, 94, 'async function postMoney')] }),
  request('request-same', INVALID, AV, HEADERS_OK, BODY_SAME, 'POST a same-account transfer', 'Valid cookies and CSRF header, but `fromAccountId` and `toAccountId` are both acc_checking.', { detail: 3 }),
  request('request-jordan', FORBIDDEN, AV, JORDAN_HEADERS, BODY_JORDAN, 'POST from Jordan\'s session', 'Jordan\'s own session cookie and matching CSRF header, asking to move 1000 minor units out of Goal Savings.', { detail: 3 }),
  request('request-forged', CSRF, AV, HEADERS_NO_CSRF, BODY, 'POST with cookies but no header', 'The cookies are attached automatically; the `x-meridian-csrf` header is missing.', { detail: 3 }),

  // ---- Global hooks -----------------------------------------------------------
  step('csrf-hook', 'guard', EP, AUTH, 'CSRF double-submit check', 'csrfHook (onRequest)',
    'The first global `onRequest` hook. POST is an unsafe method and /api/transfers is not on the exempt list (login, logout, public onboarding). If the request carries no session cookie it is let through so `requireAuth` can answer with an honest 401. Otherwise the `x-meridian-csrf` header must equal the `mer_csrf` cookie, compared in constant time.',
    {
      detail: 3,
      audience: { systems: 'Fastify onRequest hook registered in buildServer before every route. Runs before the body is parsed.' },
      sources: [src(F.server, 77, 81, "app.addHook('onRequest', csrfHook)"), src(F.csrf, 86, 116, 'export async function csrfHook')],
    }),
  step('csrf-decision', 'decision', AUTH, AUTH, 'Is the CSRF token valid?', 'header == cookie?',
    'Three outcomes: the header matches the cookie (continue), there is no session cookie at all (continue — nothing to forge), or a session cookie is present with a missing or different header (403).',
    {
      detail: 3,
      decision: {
        question: 'Does a request with a session cookie carry a matching x-meridian-csrf header?',
        options: [
          { label: 'Header matches mer_csrf', variant: OK },
          { label: 'No session cookie — let through to the auth guard', variant: NOAUTH },
          { label: 'Session cookie present, header missing', variant: CSRF },
        ],
      },
      sources: [src(F.csrf, 107, 115, 'if (!hasSession) return;')],
    }),
  errorResponse('csrf-403', CSRF, AV, '403 Forbidden', { error: 'Missing or invalid CSRF token. Reload the page and try again.', code: 'csrf_failed' },
    '`csrfHook` sends 403 `csrf_failed` and the request ends inside the hook: no preHandler, no route handler and no database query runs.',
    [src(F.csrf, 110, 115, 'csrf_failed'), src(F.csrfTest, 43, 48, "toBe('csrf_failed')")],
    { detail: 1, audience: { executive: 'The bank refuses the forged request before looking at it.' } }),
  nothingWritten('csrf-end', CSRF, 'The forged request is rejected before authentication. No LedgerEntry, AuditLog or Session row is written; both balances are exactly as before.'),

  step('valve', 'guard', EP, ABUSE, 'Mutation valve', 'mutationValveHook (onRequest)',
    'The second global hook caps every state-changing request per client IP (200 per 5 minutes). It is a no-op unless abuse protection is on — public-demo mode or `RATE_LIMITS=true` — so in local development it returns immediately.',
    {
      detail: 4,
      variants: PAST_CSRF,
      sources: [src(F.rate, 178, 183, 'export async function mutationValveHook'), src(F.rate, 110, 112, 'export function limitsActive'), src(F.shDemo, 105, 106, 'mutations: { max: 200')],
    }),

  // ---- Route preHandlers -------------------------------------------------------
  step('require-auth-none', 'guard', EP, AUTH, 'Look for a session', 'requireAuth',
    'First preHandler of the route (`guarded = { preHandler: [requireAuth, rateLimit("money")] }`). It reads the customer cookie `mer_session` — and finds none.',
    {
      detail: 3,
      variants: [NOAUTH],
      payload: { title: 'req.user', format: 'return', data: null, typeRef: 'sh:auth#SessionUser' },
      sources: [src(F.route, 64, 66, "rateLimit('money')"), src(F.guards, 47, 53, 'export const requireAuth')],
    }),
  ...split(PAST_AUTH, (g) =>
    step('require-auth', 'guard', EP, AUTH, 'Resolve the session', 'requireAuth',
      `First preHandler of the route (\`guarded = { preHandler: [requireAuth, rateLimit("money")] }\`). It reads the customer cookie \`mer_session\`, hashes the token and looks the session up with its user. ${g.user.displayName}'s session is live, so its idle timeout slides forward 8 hours and \`req.user\` becomes { id, email, displayName, role }.`,
      {
        detail: 3,
        audience: { dba: 'SELECT Session by tokenHash (with User), then UPDATE Session SET lastSeenAt = now, expiresAt = now + 8h — wall-clock time, not simulated time.' },
        payload: { title: 'req.user', format: 'return', data: g.user, typeRef: 'sh:auth#SessionUser', highlight: ['id', 'role'] },
        sources: [src(F.route, 64, 66, "rateLimit('money')"), src(F.guards, 47, 66, 'export const requireAuth'), src(F.sessions, 50, 72, 'export async function resolveSession')],
      }),
  ),
  step('auth-decision', 'decision', AUTH, AUTH, 'Is there a live session?', 'session?',
    'No `mer_session` cookie means 401 `unauthenticated`; a cookie whose session is revoked, expired or belongs to a disabled user means 401 `session_expired` and the cookie is cleared.',
    {
      detail: 3,
      variants: PAST_CSRF,
      decision: {
        question: 'Does the request carry a valid customer session?',
        options: [
          { label: 'Live session — req.user is set', variant: OK },
          { label: 'No session cookie', variant: NOAUTH },
        ],
      },
      sources: [src(F.guards, 48, 59, "code: 'unauthenticated'")],
    }),
  step('session-touch', 'db-write', AUTH, DB, 'Slide the session expiry', "UPDATE Session",
    'Side effect of authentication: the session row gets `lastSeenAt` = now and `expiresAt` = now + 8 hours.',
    {
      detail: 5,
      variants: [OK, INVALID, FUNDS],
      audience: { dba: 'UPDATE Session SET lastSeenAt, expiresAt WHERE id = ses_avery. Not part of the transfer transaction.' },
      effects: [sessionTouch('ses_avery')],
      sources: [src(F.sessions, 64, 68, 'prisma.session.update')],
    }),
  step('session-touch-jordan', 'db-write', AUTH, DB, 'Slide the session expiry', 'UPDATE Session',
    'Jordan\'s session row gets `lastSeenAt` = now and `expiresAt` = now + 8 hours.',
    { detail: 5, variants: [FORBIDDEN], effects: [sessionTouch('ses_jordan')], sources: [src(F.sessions, 64, 68, 'prisma.session.update')] }),
  errorResponse('auth-401', NOAUTH, LIB, '401 Unauthorized', { error: 'Not authenticated.', code: 'unauthenticated' },
    '`requireAuth` ends the request with 401 before the rate limiter, the handler or any money code runs.',
    [src(F.guards, 50, 53, 'Not authenticated.'), src(F.test, 138, 141, 'requires authentication (401)')],
    { detail: 1, audience: { executive: 'The bank refuses because nobody is signed in.' } }),
  step('auth-banner', 'ui', PAGE, AV, 'The form shows the server\'s message', 'banner: "Not authenticated."',
    '`postMoney` returns `{ ok: false, code: "unauthenticated", message }`. The message is the server\'s `error` text when there is one — `messageForCode`\'s friendlier "Your session has ended…" is only the fallback — so the banner reads "Not authenticated." The form keeps its values.',
    {
      detail: 2,
      variants: [NOAUTH],
      audience: { 'end-user': 'A red banner says you are not signed in; your entries stay in the form.' },
      sources: [src(F.lib, 100, 107, 'message: err?.error ?? messageForCode(code, fallback)'), src(F.page, 407, 408, 'setBanner(result.message)')],
    }),
  nothingWritten('auth-end', NOAUTH, 'Rejected at the auth guard. No LedgerEntry, AuditLog or Session row is written; both balances are unchanged.'),

  ...split(PAST_AUTH, (g) =>
    step('rate-limit', 'guard', EP, ABUSE, 'Per-user money budget', "rateLimit('money')",
      'Second preHandler. In public-demo mode it counts this request against the `money` bucket — 30 requests per 5 minutes, keyed by `user:<id>` because `requireAuth` has already set `req.user` — and answers 429 `rate_limited` past the budget. With abuse protection off it does nothing.',
      {
        detail: 4,
        payload: { title: 'Bucket rule (public demo only)', format: 'json', data: { bucket: 'money', max: 30, windowMs: 300000, key: `user:${g.user.id}` }, typeRef: 'sh:public-demo#RateLimitRule', highlight: ['key'] },
        sources: [src(F.rate, 158, 168, 'export function rateLimit'), src(F.rate, 137, 140, 'export function clientKey'), src(F.shDemo, 91, 92, 'money: { max: 30')],
      }),
  ),

  // ---- Handler ---------------------------------------------------------------------
  step('coerce', 'validate', EP, EP, 'Coerce and cap the body', 'typeof checks + slice(0, 500)',
    'The handler never trusts the body\'s types: ids and memo are kept only if they are strings and are cut to 500 characters; `amountMinor` is kept only if it is already a number. Anything else becomes `undefined`, which the validator then reports as missing.',
    { detail: 4, variants: PAST_AUTH, sources: [src(F.route, 30, 30, 'const MAX_FIELD = 500'), src(F.route, 67, 73, "typeof body.amountMinor === 'number'")] }),
  ...split(PAST_AUTH, (g) =>
    step('server-validate', 'validate', EP, VAL, 'Validate on the server', 'validateTransfer(body)',
      'The same shared `validateTransfer` the form ran. It cannot know about ownership or balances — those need the database — so it checks shape only and returns the normalized value (trimmed ids, memo trimmed to 140 characters or null).',
      {
        detail: 3,
        payload:
          g.suffix === '-same'
            ? { title: 'Validation result', format: 'return', data: { ok: false, errors: { toAccountId: 'Choose two different accounts.' } }, typeRef: 'sh:money-movement#TransferField', highlight: ['errors.toAccountId'] }
            : { title: 'Validation result', format: 'return', data: { ok: true, errors: {}, value: g.body }, typeRef: 'sh:money-movement#NormalizedTransfer', highlight: ['ok'] },
        sources: [src(F.route, 68, 73, 'const check = validateTransfer({'), src(F.shMove, 194, 224, 'export function validateTransfer')],
      }),
  ),
  step('validate-decision', 'decision', VAL, VAL, 'Is the body well-formed?', 'check.ok?',
    'Rules: `fromAccountId` present; `toAccountId` present and different from the source; `amountMinor` an integer from 1 to 5,000,000; memo optional.',
    {
      detail: 3,
      variants: PAST_AUTH,
      decision: {
        question: 'Does the body pass validateTransfer?',
        options: [
          { label: 'Valid', variant: OK },
          { label: 'Same account on both sides', variant: INVALID },
        ],
      },
      sources: [src(F.shMove, 205, 212, "errors.toAccountId = 'Choose two different accounts.'")],
    }),
  errorResponse('invalid-400', INVALID, AV, '400 Bad Request', { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { toAccountId: 'Choose two different accounts.' } },
    'The handler answers through `invalid()`: 400 `invalid_request` with the validator\'s per-field `fields` map, keyed by the same field names the form uses — the form would merge them under the matching inputs.',
    [src(F.route, 55, 59, "code: 'invalid_request'"), src(F.route, 74, 76, 'Please correct the highlighted fields.'), src(F.test, 132, 136, 'rejects same-source-and-destination and missing fields (400)')],
    { detail: 1, payload: { title: 'Error response', format: 'http-response', line: '400 Bad Request', data: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { toAccountId: 'Choose two different accounts.' } }, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code', 'fields.toAccountId'] }, audience: { executive: 'The bank refuses a request that does not make sense.' } }),
  nothingWritten('invalid-end', INVALID, 'Rejected by the validator before the money service is called. Nothing is written apart from the session\'s sliding expiry; both balances are unchanged.'),

  step('sim-now', 'db-read', EP, DB, 'Read the simulation clock', 'simulationNow(prisma)',
    'Money is dated by the simulation clock, not the wall clock. `simulationNow` upserts the `SimulationClock` singleton (creating it only if missing) and returns its `currentTime` — 2026-10-01T15:00:00Z here.',
    {
      detail: 4,
      variants: PAST_VALIDATOR,
      payload: { title: 'now', format: 'return', data: SIM_NOW, typeRef: 'db:SimulationClock' },
      sources: [src(F.route, 78, 78, 'await simulationNow(prisma)'), src(F.clock, 53, 60, 'export async function simulationNow')],
    }),
  ...split(PAST_VALIDATOR, (g) =>
    step('call-service', 'call', EP, SVC, 'Call the money service', 'createTransfer(user, value, now)',
      'The handler hands the authenticated user, the normalized transfer and the simulated now to `createTransfer` in `money/movements.ts`. Any `MovementError` it throws is mapped to an HTTP status by `handleMovementError`.',
      {
        detail: 3,
        payload: { title: 'createTransfer arguments', format: 'args', data: { user: g.user, input: g.body, now: SIM_NOW }, typeRef: 'sh:money-movement#NormalizedTransfer', highlight: ['input.amountMinor'] },
        sources: [src(F.route, 77, 78, 'createTransfer(req.user!, check.value'), src(F.movements, 170, 181, 'export async function createTransfer')],
      }),
  ),

  // ---- Service checks ---------------------------------------------------------
  ...split(PAST_VALIDATOR, (g) =>
    step('access-from', 'db-read', SVC, DB, 'Check the source account', 'requireMovableAccount(from)',
      `\`requireMovableAccount\` loads the account with the three ledger columns it needs, then asks \`getAccountRelationship\`: an \`AccountAccess\` row for (user, account) decides the relationship; failing that, \`Account.userId\` = user counts as owner. Only owner, joint or authorized may move money. ${
        g.suffix === '-jordan'
          ? 'Jordan has no AccountAccess row for Goal Savings and does not own it, so the relationship is null.'
          : 'Avery has an owner grant on Everyday Checking.'
      }`,
      {
        detail: 1,
        audience: {
          executive: 'The bank checks that the customer is allowed to use both accounts.',
          dba: 'SELECT Account (id, name, status) + its LedgerEntry (amountMinor, direction, status); SELECT AccountAccess by the (userId, accountId) unique key; if none, SELECT Account.userId.',
        },
        payload:
          g.suffix === '-jordan'
            ? { title: 'getAccountRelationship(usr_jordan, acc_savings)', format: 'return', data: null, typeRef: 'sh:auth#AccountRelationship' }
            : { title: 'Access lookup', format: 'row', data: { id: 'acs_1', userId: IDS.avery, accountId: CHK, relationship: 'owner' }, typeRef: 'db:AccountAccess', highlight: ['relationship'] },
        sources: [src(F.movements, 114, 132, 'async function requireMovableAccount'), src(F.access, 67, 88, 'export async function getAccountRelationship'), src(F.movements, 67, 67, 'MOVABLE_RELATIONSHIPS')],
      }),
  ),
  step('access-decision', 'decision', SVC, SVC, 'May this user move money here?', 'relationship ∈ owner|joint|authorized?',
    'A missing account throws `not_found` (404). No relationship — or a `viewer` one — throws `forbidden` (403). Jordan has a joint grant on Everyday Checking only, and Goal Savings belongs to Avery, so his relationship to it is null.',
    {
      detail: 3,
      variants: PAST_VALIDATOR,
      decision: {
        question: 'Does the caller have a movable relationship to the source account?',
        options: [
          { label: 'Owner grant', variant: OK },
          { label: 'No grant (Jordan → Goal Savings)', variant: FORBIDDEN },
        ],
      },
      sources: [src(F.movements, 123, 127, "throw new MovementError('forbidden'")],
    }),
  errorResponse('forbidden-403', FORBIDDEN, AV, '403 Forbidden', { error: 'You cannot move money on that account.', code: 'forbidden' },
    '`createTransfer` throws `MovementError("forbidden")` from the first `requireMovableAccount` call. The handler\'s catch passes it to `handleMovementError`, which maps `forbidden` → 403 and sends `{ error, code }`.',
    [src(F.route, 32, 53, 'function movementHttpStatus'), src(F.test, 121, 130, 'toBe(403)')],
    { detail: 1, audience: { executive: 'The bank refuses: the account is not his to use.' } }),
  nothingWritten('forbidden-end', FORBIDDEN, 'Refused by the access check before any write. Only Jordan\'s session expiry moved; no LedgerEntry or AuditLog row exists for the attempt — failed transfers are not audited.'),

  step('status-check', 'validate', SVC, SVC, 'Account must be active', "account.status === 'active'",
    'After the relationship check, a non-active account throws `inactive_account` (400). Everyday Checking is active. `requireMovableAccount` then runs the same three checks for Goal Savings, the destination — Avery owns it and it is active.',
    {
      detail: 4,
      variants: PAST_ACCESS,
      sources: [src(F.movements, 128, 131, "throw new MovementError('inactive_account'"), src(F.movements, 180, 181, 'const to = await requireMovableAccount')],
    }),
  step('funds', 'call', SVC, SVC, 'Check available funds', 'availableMinor(from) < amount?',
    '`availableMinor` feeds the source account\'s ledger rows to the shared `deriveBalances`: posted rows count fully, a pending debit is reserved out of available, a pending credit is not added. For Everyday Checking that is 250000 − 4890 − 12000 = 233110.',
    {
      detail: 1,
      variants: PAST_ACCESS,
      audience: {
        executive: 'The bank checks there is enough money available — counting payments that are still pending.',
        'end-user': 'Your available balance, not your posted balance, is what counts.',
      },
      payload: { title: 'deriveBalances(checking)', format: 'return', data: CHK_BEFORE, typeRef: 'sh:ledger#DerivedBalances', highlight: ['availableMinor'] },
      sources: [src(F.movements, 81, 89, 'function availableMinor'), src(F.ledger, 103, 119, "case 'pending'"), src(F.movements, 183, 185, 'insufficient_funds')],
    }),
  step('funds-decision', 'decision', SVC, SVC, 'Enough available?', '233110 ≥ amount?',
    'The comparison is against available, not current: 25000 fits; 240000 does not, even though the posted balance is 245110.',
    {
      detail: 3,
      variants: PAST_ACCESS,
      decision: {
        question: 'Is the amount within the source account\'s available balance?',
        options: [
          { label: '25000 ≤ 233110', variant: OK },
          { label: '240000 > 233110', variant: FUNDS },
        ],
      },
      sources: [src(F.movements, 183, 185, 'availableMinor(from.account) < input.amountMinor')],
    }),
  errorResponse('funds-400', FUNDS, LIB, '400 Bad Request', { error: 'That transfer exceeds the available balance.', code: 'insufficient_funds' },
    '`MovementError("insufficient_funds")` maps to 400 through the `default` branch of `movementHttpStatus`.',
    [src(F.movements, 183, 185, 'That transfer exceeds the available balance.'), src(F.route, 41, 42, 'return 400; // insufficient_funds'), src(F.test, 107, 119, 'rejects a transfer that exceeds available funds (400) and posts nothing')],
    { detail: 2 }),
  step('funds-banner', 'ui', PAGE, AV, 'The form shows the refusal', 'banner: "That transfer exceeds…"',
    'The server\'s `error` text becomes the banner: "That transfer exceeds the available balance." No per-field errors are set because the response has no `fields`. The form keeps 2400.00 so Avery can lower it.',
    {
      detail: 1,
      variants: [FUNDS],
      audience: { executive: 'The customer is told there is not enough available money.', 'end-user': 'A banner says the transfer exceeds your available balance.' },
      sources: [src(F.page, 402, 408, 'setBanner(result.message)')],
    }),
  nothingWritten('funds-end', FUNDS, 'Refused before the transaction opens. No LedgerEntry or AuditLog row is written (the test asserts the ledger count is unchanged); only the session expiry moved.'),

  // ---- The write --------------------------------------------------------------
  step('debit', 'db-write', SVC, DB, 'Post the debit leg', 'INSERT LedgerEntry (debit)',
    '`prisma.$transaction` opens. First write: a posted `transfer` debit of 25000 on Everyday Checking, described "Transfer to Goal Savings — Move to savings", with `postedAt` and `createdAt` both set to the simulated now. No balance is updated anywhere — the row is the movement.',
    {
      detail: 1,
      variants: [OK],
      audience: {
        executive: 'The bank records $250.00 leaving checking…',
        dba: 'BEGIN; INSERT LedgerEntry (origin transfer, direction debit, status posted). createdAt is set explicitly to the simulation time, not left to the column default.',
      },
      payload: { title: 'LedgerEntry (debit leg)', format: 'row', data: DEBIT, typeRef: 'db:LedgerEntry', highlight: ['direction', 'amountMinor', 'origin'] },
      effects: [{ op: 'insert', table: 'LedgerEntry', row: DEBIT }],
      sources: [src(F.movements, 187, 201, 'await prisma.$transaction(async (tx) => {')],
    }),
  step('credit', 'db-write', SVC, DB, 'Post the credit leg', 'INSERT LedgerEntry (credit)',
    'Second write in the same transaction: a posted `transfer` credit of 25000 on Goal Savings, "Transfer from Everyday Checking — Move to savings". The two legs net to zero, so the system-wide settled total does not change — the invariant `money.test.ts` checks.',
    {
      detail: 4,
      variants: [OK],
      audience: { executive: '…and the same $250.00 arriving in savings, in one indivisible step.', dba: 'INSERT LedgerEntry (origin transfer, direction credit, status posted). Same transaction.' },
      payload: { title: 'LedgerEntry (credit leg)', format: 'row', data: CREDIT, typeRef: 'db:LedgerEntry', highlight: ['direction', 'accountId'] },
      effects: [{ op: 'insert', table: 'LedgerEntry', row: CREDIT }],
      sources: [src(F.movements, 202, 213, "direction: 'credit'"), src(F.test, 88, 97, 'expect(await settledTotal()).toBe(totalBefore)')],
    }),
  step('audit', 'db-write', SVC, DB, 'Audit the transfer', "INSERT AuditLog 'money_transfer'",
    '`writeAudit(tx, …)` inserts the audit row inside the same transaction: actor Avery (customer), action `money_transfer` on entity `account` = the source account, a human-readable reason and metadata with the amount, both account ids and the actor\'s name. Then the transaction commits — all three rows or none.',
    {
      detail: 4,
      variants: [OK],
      audience: { dba: 'INSERT AuditLog; metadata is a JSON string; createdAt is the column default (database wall clock), unlike the ledger rows. COMMIT.' },
      payload: { title: 'AuditLog row', format: 'row', data: AUDIT, typeRef: 'db:AuditLog', highlight: ['action', 'reason'] },
      effects: [{ op: 'insert', table: 'AuditLog', row: AUDIT }],
      sources: [src(F.movements, 214, 228, "action: 'money_transfer'"), src(F.audit, 44, 67, 'export async function writeAudit')],
    }),
  step('summaries', 'db-read', SVC, DB, 'Re-derive both accounts', 'summarize(from), summarize(to)',
    'After the commit, `summarize` reloads each account with all its ledger rows and runs `deriveBalances` again, attaching the caller\'s relationship. Checking: current 220110, available 208110 (the $120.00 bill payment is still reserved). Savings: 525000.',
    {
      detail: 3,
      variants: [OK],
      payload: { title: 'TransferResult', format: 'return', data: { amountMinor: AMOUNT, accounts: RESPONSE.accounts }, typeRef: 'be:money/movements#TransferResult', highlight: ['accounts.0.balances.availableMinor', 'accounts.1.balances.availableMinor'] },
      sources: [src(F.movements, 91, 112, 'async function summarize'), src(F.movements, 230, 236, 'await summarize(prisma, from.account.id, from.relationship)')],
    }),
  step('response', 'response', EP, LIB, '201 with fresh balances', '201 { ok, accounts }',
    'The handler wraps the result in a `TransferResponse` and replies 201 Created. No operator review, socket event or simulated message is involved: an internal transfer is final immediately.',
    {
      detail: 2,
      variants: [OK],
      audience: { systems: 'HTTP 201, JSON body. No realtime emit on this route.' },
      payload: { title: 'TransferResponse', format: 'http-response', line: '201 Created', data: RESPONSE, typeRef: 'sh:money-movement#TransferResponse', highlight: ['message', 'accounts'] },
      sources: [src(F.route, 79, 85, 'reply.code(201).send(response)')],
    }),
  step('done', 'ui', PAGE, AV, 'Transfer complete', 'TransferDone',
    '`postMoney` returns `{ ok: true, data }`; the page stores it and renders `TransferDone`: "Transfer complete", the server\'s message, "You moved $250.00 between your accounts." and each account\'s available balance from the response — $2,081.10 and $5,250.00. The page does not re-fetch: the account list it loaded on mount stays as it was, so after "Make another" the selector labels show the old available amounts until the page is reloaded.',
    {
      detail: 1,
      variants: [OK],
      audience: { executive: 'The customer sees the money moved and both new balances straight away.', 'end-user': 'A green "Transfer complete" panel shows your new available balances.' },
      sources: [src(F.page, 403, 406, 'setDone(result.data)'), src(F.page, 300, 325, 'function TransferDone'), src(F.page, 913, 921, 'void fetchAccounts().then')],
    }),
  step('end', 'state', DB, DB, 'Balances re-derive', '6 ledger rows',
    'The example database now holds two more ledger rows and one audit row. Re-deriving: Everyday Checking 220110 current / 208110 available; Goal Savings 525000. Avery\'s total settled money is the same $7,451.10 as before.',
    {
      detail: 2,
      variants: [OK],
      audience: { dba: '+2 LedgerEntry, +1 AuditLog, 1 Session update. No UPDATE on Account — there is no balance column.' },
      payload: { title: 'Derived balances (after)', format: 'json', data: { [CHK]: CHK_AFTER, [SAV]: SAV_AFTER }, typeRef: 'sh:ledger#DerivedBalances', highlight: [`${CHK}.availableMinor`, `${SAV}.currentMinor`] },
      sources: [src(F.test, 74, 105, 'posts BOTH legs, nets to zero')],
    }),
];

// ---- Scenario -------------------------------------------------------------------

export const scenario: Scenario = {
  id: 'transfer',
  title: 'A customer transfers money between accounts',
  question: 'What happens when a customer transfers money?',
  summary:
    'Avery Customer moves $250.00 from Everyday Checking to Goal Savings. The form runs the shared validator, the request passes the CSRF hook, the session guard and the money rate limit, the server re-validates, checks that she may use both accounts and has enough available money, then posts a debit and a credit ledger entry and an audit row in one transaction. Balances are never stored — both are re-derived for the response.',
  category: 'money',
  tags: ['money', 'ledger', 'validation', 'security', 'auth', 'audit'],
  participants: [AV, PAGE, LIB, EP, AUTH, ABUSE, VAL, SVC, DB],
  related: [
    EP,
    SVC,
    VAL,
    PAGE,
    LIB,
    'be:routes/money',
    'be:money/movements#requireMovableAccount',
    'be:money/movements#availableMinor',
    'be:money/movements#summarize',
    'be:money/movements#MovementError',
    'be:routes/money#handleMovementError',
    'be:auth/access#getAccountRelationship',
    'be:auth/audit#writeAudit',
    'be:auth/csrf#csrfHook',
    'be:auth/guards#requireAuth',
    'be:abuse/rate-limit#rateLimit',
    'be:abuse/rate-limit#mutationValveHook',
    'be:clock/clock#simulationNow',
    'sh:ledger#deriveBalances',
    'sh:money-movement#TransferResponse',
    'cu:lib/csrf#csrfHeaders',
    'db:LedgerEntry',
    'db:AuditLog',
    'db:AccountAccess',
    'feat:transfers',
    'feat:balances',
    'feat:audit',
    'test:apps/backend/src/routes/money.test.ts',
  ],
  variants: [
    { id: OK, label: 'Transfer posts', description: 'Both legs and the audit row are written; checking drops and savings rises by $250.00.', outcome: 'success' },
    { id: INVALID, label: 'Invalid input', description: 'A hand-made request uses the same account on both sides; the shared validator rejects it with 400 invalid_request and a fields map.', outcome: 'rejected' },
    { id: FUNDS, label: 'Insufficient funds', description: '$2,400.00 exceeds the $2,331.10 available (a pending payment is reserved); 400 insufficient_funds.', outcome: 'rejected' },
    { id: FORBIDDEN, label: 'Account not accessible', description: 'Jordan Joint tries to move money out of Goal Savings, which is not shared with him; 403 forbidden.', outcome: 'rejected' },
    { id: NOAUTH, label: 'Not signed in', description: 'No session cookie: the CSRF hook lets it through and requireAuth answers 401 unauthenticated.', outcome: 'rejected' },
    { id: CSRF, label: 'CSRF header missing', description: 'Cookies without the x-meridian-csrf header — the forged-request shape — are refused 403 csrf_failed by the global hook.', outcome: 'rejected' },
  ],
  defaultVariant: OK,
  initialState: {
    ...baseState(),
    Session: [
      { id: 'ses_avery', userId: IDS.avery, tokenHash: '<sha-256 of the mer_session token>', createdAt: '2026-10-01T14:30:00.000Z', lastSeenAt: '2026-10-01T15:06:12.000Z', expiresAt: '2026-10-01T23:06:12.000Z', revokedAt: null },
      { id: 'ses_jordan', userId: JORDAN.id, tokenHash: '<sha-256 of Jordan\'s mer_session token>', createdAt: '2026-10-01T14:50:00.000Z', lastSeenAt: '2026-10-01T15:05:40.000Z', expiresAt: '2026-10-01T23:05:40.000Z', revokedAt: null },
    ],
  },
  watchAccounts: [CHK, SAV],
  steps,
  sources: [
    src(F.route, 61, 89, "app.post('/api/transfers'"),
    src(F.movements, 170, 237, 'export async function createTransfer'),
    src(F.shMove, 194, 224, 'export function validateTransfer'),
    src(F.page, 383, 409, 'async function handleSubmit'),
    src(F.test, 73, 142, 'POST /api/transfers (internal, immediate)'),
  ],
};
