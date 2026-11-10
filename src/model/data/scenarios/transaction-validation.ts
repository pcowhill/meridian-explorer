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
  WALL_NOW,
  bal,
  movementRows,
  pendingBacklog,
  step,
} from '../money/scenario-data';

/**
 * "How does transaction validation work?"
 *
 * The layered checks a money request meets, in the order they run, told
 * through one $75.00 bill payment (an external, reviewable movement — the
 * kind that meets every layer, including the pending-movement cap). Each
 * variant is the story of one layer saying no.
 */

// ---- Lanes ------------------------------------------------------------------
const AV = 'role:customer';
const PAGE = 'cu:pages/MoveMoney';
const LIB = 'cu:lib/money#createMovement';
const CSRFL = 'be:auth/csrf#csrfHook';
const RATEL = 'be:abuse/rate-limit';
const AUTHL = 'be:auth/guards#requireAuth';
const EP = 'ep:POST /api/movements';
const SVC = 'be:money/movements#createExternalMovement';
const DB = 'db';

// ---- Files ------------------------------------------------------------------
const F = {
  page: 'apps/customer/src/pages/MoveMoney.tsx',
  lib: 'apps/customer/src/lib/money.ts',
  cuCsrf: 'apps/customer/src/lib/csrf.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  server: 'apps/backend/src/server.ts',
  config: 'apps/backend/src/config.ts',
  rate: 'apps/backend/src/abuse/rate-limit.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  sessions: 'apps/backend/src/auth/sessions.ts',
  route: 'apps/backend/src/routes/money.ts',
  shMove: 'packages/shared/src/money-movement.ts',
  shDemo: 'packages/shared/src/public-demo.ts',
  movements: 'apps/backend/src/money/movements.ts',
  access: 'apps/backend/src/auth/access.ts',
  ledger: 'packages/shared/src/ledger.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  moneyTest: 'apps/backend/src/routes/money.test.ts',
  csrfTest: 'apps/backend/src/routes/csrf.test.ts',
  capsTest: 'apps/backend/src/routes/caps.test.ts',
  demoTest: 'apps/backend/src/routes/public-demo.test.ts',
} as const;
const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef => ({ file, start, end, symbol, ...(note ? { note } : {}) });

// ---- Variants (in the order of the layer that rejects) -----------------------
const PASS = 'passes-all';
const CLIENT = 'rejected-by-client';
const CSRF = 'rejected-by-csrf';
const AUTHV = 'rejected-by-auth';
const RATE = 'rejected-by-rate-limit';
const VALID = 'rejected-by-validator';
const ACCESS = 'rejected-by-access';
const FUNDS = 'rejected-by-funds';
const CAP = 'rejected-by-cap';

const ALL = [PASS, CLIENT, CSRF, AUTHV, RATE, VALID, ACCESS, FUNDS, CAP];
/** Variants that start from Avery's own form. CSRF / VALID / ACCESS send a hand-made request. */
const FORM = [PASS, CLIENT, AUTHV, RATE, FUNDS, CAP];
const without = (...out: string[]) => ALL.filter((v) => !out.includes(v));
const AT_SERVER = without(CLIENT);
const PAST_CSRF = without(CLIENT, CSRF);
const PAST_AUTH = without(CLIENT, CSRF, AUTHV);
const PAST_RATE = without(CLIENT, CSRF, AUTHV, RATE);
const PAST_VALIDATOR = without(CLIENT, CSRF, AUTHV, RATE, VALID);
const PAST_ACCESS = [PASS, FUNDS, CAP];
const PAST_FUNDS = [PASS, CAP];

// ---- Example values ---------------------------------------------------------
const plus8h = (iso: string) => new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString();
const AMOUNT_ERROR = 'Enter an amount between $0.01 and $50,000 (simulated).';

/** What the form sends (the validator's normalized value). */
const BODY = { accountId: CHK, kind: 'bill_pay', amountMinor: 7500, direction: 'outbound', counterparty: 'Metro Water', memo: null };
const BODY_OVER = { ...BODY, amountMinor: 240000 };
const BODY_STRING = { accountId: CHK, kind: 'bill_pay', amountMinor: '75.00', counterparty: 'Metro Water' };
const BODY_JORDAN = { accountId: SAV, kind: 'bill_pay', amountMinor: 7500, counterparty: 'Metro Water' };

const JORDAN_HEADERS: Record<string, string> = {
  Cookie: 'mer_session=<Jordan session token>; mer_csrf=<Jordan csrf token>',
  'x-meridian-csrf': '<Jordan csrf token>',
  'Content-Type': 'application/json',
};

const CHK_BEFORE = bal(245110, 233110, 0, 12000);
const CHK_AFTER = bal(245110, 225610, 0, 19500);

const ROWS = movementRows({
  entryId: 'le_101',
  requestId: 'req_101',
  auditId: 'aud_101',
  eventId: 'evt_101',
  kind: 'bill_pay',
  opsType: 'bill_pay',
  label: 'Bill payment',
  amountMinor: 7500,
  amountText: '$75.00',
  direction: 'outbound',
  counterparty: 'Metro Water',
  description: 'Bill payment — Metro Water',
  reference: 'MOV-7C1E40',
});

const RESPONSE = {
  reference: 'MOV-7C1E40',
  kind: 'bill_pay',
  status: 'pending_review',
  amountMinor: 7500,
  direction: 'outbound',
  message:
    'Your simulated movement was submitted and is awaiting operator review. It will appear as “Pending” until an operator posts it. (SIMULATION — no real money network was contacted.)',
};

/** Variant groups that carry different example data. */
interface Group {
  suffix: string;
  variants: string[];
  body: Record<string, unknown>;
  user: { id: string; email: string; displayName: string; role: string };
  session: string;
}
const GROUPS: Group[] = [
  { suffix: '', variants: [PASS, CSRF, AUTHV, RATE, CAP], body: BODY, user: AVERY, session: 'ses_avery' },
  { suffix: '-over', variants: [FUNDS], body: BODY_OVER, user: AVERY, session: 'ses_avery' },
  { suffix: '-string', variants: [VALID], body: BODY_STRING, user: AVERY, session: 'ses_avery' },
  { suffix: '-jordan', variants: [ACCESS], body: BODY_JORDAN, user: JORDAN, session: 'ses_jordan' },
];
function split(allowed: string[], make: (g: Group) => ScenarioStep): ScenarioStep[] {
  return GROUPS.map((g) => ({ ...g, variants: g.variants.filter((v) => allowed.includes(v)) }))
    .filter((g) => g.variants.length > 0)
    .map((g) => {
      const s = make(g);
      return { ...s, id: s.id + g.suffix, variants: g.variants };
    });
}

function rejection(id: string, variant: string, from: string, to: string, status: string, body: Record<string, unknown>, narrative: string, sources: SourceRef[], extra: Partial<ScenarioStep> = {}): ScenarioStep {
  const code = String(body.code);
  return step(id, 'response', from, to, `${status.split(' ')[0]} ${code}`, `${status} { code: '${code}' }`, narrative, {
    detail: 1,
    variants: [variant],
    payload: { title: 'Error response', format: 'http-response', line: status, data: body, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code'] },
    sources,
    ...extra,
  });
}

function nothingWritten(id: string, variant: string, layer: string, sessionNote: string): ScenarioStep {
  return step(id, 'state', DB, DB, 'Nothing written', 'no rows', `Rejected by ${layer}. No LedgerEntry, OperationsRequest, AuditLog or SimulatedEvent row is written, so no balance changes and nothing reaches the operations queue. ${sessionNote}`, {
    detail: 2,
    variants: [variant],
    audience: { dba: `0 rows for the payment. ${sessionNote}` },
    payload: { title: 'Everyday Checking (unchanged)', format: 'json', data: CHK_BEFORE, typeRef: 'sh:ledger#DerivedBalances', highlight: ['availableMinor'] },
  });
}
const NO_SESSION_WRITE = 'There is no database write at all.';
const SESSION_WRITE_ONLY = 'The only write was `requireAuth` sliding the session\'s expiry.';

// ---- Steps ------------------------------------------------------------------

const steps: ScenarioStep[] = [
  // ---- Set-up for two variants ------------------------------------------------
  step('setup-cap', 'note', DB, DB, 'Avery already has 25 movements in review', '25 pending requests',
    'Set-up for this variant: Avery has 25 $1.00 mobile check deposits awaiting operator review — 25 pending OperationsRequest rows, each with a pending credit LedgerEntry. Pending credits are not added to available, so her balances are unchanged.',
    { detail: 2, variants: [CAP], effects: pendingBacklog(25), sources: [src(F.capsTest, 146, 162, 'movements awaiting review per user are capped')] }),
  step('setup-rate', 'note', RATEL, RATEL, 'Public-demo mode, budget spent', '30 of 30 used',
    'Set-up for this variant: the backend runs in public-demo mode (`PUBLIC_DEMO=true`, or `RATE_LIMITS=true`), which turns the in-memory limiters on. Avery has already sent 30 requests to the money endpoints in the current 5-minute window — the `money` bucket counts every request that reaches it, including ones the server then rejected, so the example database is unchanged. Outside public-demo mode this layer does not exist.',
    { detail: 2, variants: [RATE], sources: [src(F.config, 60, 60, 'rateLimitsEnabled: publicDemo ||'), src(F.demoTest, 267, 287, 'authenticated money movement is keyed per USER')] }),

  // ---- How the request is produced --------------------------------------------
  step('fill-form', 'ui', AV, PAGE, 'Avery submits a bill payment', 'click "Submit payment"',
    'On Move money → Pay a bill, Avery chooses Everyday Checking, types the biller "Metro Water" and 75.00, and clicks "Submit payment".',
    {
      detail: 1,
      variants: [PASS, AUTHV, RATE, CAP],
      audience: { executive: 'A customer asks the bank to pay a $75.00 bill.', 'end-user': 'You fill in the bill payment form and press "Submit payment".' },
      sources: [src(F.page, 853, 855, 'Submit payment')],
    }),
  step('fill-form-over', 'ui', AV, PAGE, 'Avery submits a large bill payment', 'click "Submit payment"',
    'Avery fills in the same form with 2400.00 — less than her $2,451.10 posted balance, more than the $2,331.10 available.',
    { detail: 1, variants: [FUNDS], audience: { executive: 'A customer asks to pay $2,400.00 — more than is available.' }, sources: [src(F.page, 853, 855, 'Submit payment')] }),
  step('fill-form-big', 'ui', AV, PAGE, 'Avery types an amount over the cap', 'click "Submit payment"',
    'Avery types 60000.00. The amount input carries `max="50000"`, but the form is `noValidate`, so the browser does not block the submit — the shared validator is what catches it.',
    { detail: 1, variants: [CLIENT], audience: { executive: 'A customer types an amount above the $50,000 limit.' }, sources: [src(F.page, 187, 194, 'max="50000"'), src(F.page, 814, 814, 'noValidate')] }),
  step('crafted-forged', 'note', AV, AV, 'A forged request', 'cookies, no header',
    'A request carrying Avery\'s cookies but no `x-meridian-csrf` header — the shape of a cross-site forgery: a foreign page can make the browser attach cookies but can neither read `mer_csrf` nor add a custom header without a CORS preflight.',
    { detail: 1, variants: [CSRF], audience: { executive: 'Another website tries to make Avery\'s browser pay a bill without her knowing.' }, sources: [src(F.csrf, 7, 28, 'double-submit token')] }),
  step('crafted-string', 'note', AV, AV, 'A request sent around the form', 'hand-made body',
    'A request sent directly from Avery\'s signed-in tab (valid cookies and CSRF header) with the amount as the string "75.00" instead of an integer. The browser-side check never runs for a request like this — it is a convenience, not a defence.',
    { detail: 1, variants: [VALID], audience: { executive: 'Someone sends the bank a malformed payment directly, skipping the app\'s screen.' } }),
  step('crafted-jordan', 'note', AV, AV, 'Jordan targets an account he cannot use', 'hand-made request',
    'Jordan Joint (joint_customer) has joint access to Everyday Checking only. His form would not offer Goal Savings, so he sends the request directly: a $75.00 bill payment from Goal Savings.',
    { detail: 1, variants: [ACCESS], audience: { executive: 'A joint customer tries to pay a bill from an account that is not shared with him.' } }),

  // ---- Layer 1: the browser ----------------------------------------------------
  step('l1-client', 'validate', PAGE, PAGE, 'Layer 1 — shared validator in the browser', 'validateExternalMovement(form)',
    '`handleSubmit` converts the amount with `parseAmountMinor` and calls the shared `validateExternalMovement` with kind `bill_pay`. Rules: an account id; a reviewable kind (external_ach, wire, mobile_check_deposit, bill_pay — not internal_transfer); amount an integer from 1 to 5,000,000 minor units ($0.01–$50,000); direction fixed by kind (bill_pay and wire are outbound, a deposit inbound, an ACH must say which); a counterparty for every kind except a mobile check deposit, trimmed to 80 characters; memo trimmed to 140. The same function runs again on the server.',
    {
      detail: 2,
      variants: FORM,
      audience: { 'end-user': 'The app checks your entries before sending anything.' },
      payload: { title: 'validateExternalMovement input', format: 'args', data: { accountId: CHK, kind: 'bill_pay', amountMinor: 7500, counterparty: 'Metro Water', memo: '' }, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor', 'counterparty'] },
      sources: [src(F.page, 781, 792, 'const check = validateExternalMovement({'), src(F.shMove, 226, 285, 'export function validateExternalMovement'), src(F.shMove, 98, 105, 'maxMinor: 50_000_00')],
    }),
  step('l1-decision', 'decision', PAGE, PAGE, 'Does the form pass?', 'check.ok?',
    'If any rule fails, the field errors are shown and nothing is sent.',
    {
      detail: 2,
      variants: FORM,
      decision: { question: 'Does the form pass validateExternalMovement?', options: [{ label: 'Valid', variant: PASS }, { label: 'Amount above $50,000', variant: CLIENT }] },
      sources: [src(F.page, 789, 792, 'setErrors(check.errors)')],
    }),
  step('l1-reject', 'ui', PAGE, AV, 'Inline error, no request', 'amount error under the field',
    '`setErrors(check.errors)` puts "Enter an amount between $0.01 and $50,000 (simulated)." under the Amount field and `handleSubmit` returns. No HTTP request is made.',
    {
      detail: 1,
      variants: [CLIENT],
      audience: { executive: 'The app catches the mistake before anything reaches the bank.', 'end-user': 'A red message under Amount tells you the allowed range.' },
      payload: { title: 'check.errors', format: 'return', data: { amountMinor: AMOUNT_ERROR }, typeRef: 'sh:money-movement#ExternalMovementField', highlight: ['amountMinor'] },
      sources: [src(F.shMove, 185, 185, 'const AMOUNT_ERROR'), src(F.page, 789, 792, 'setErrors(check.errors)')],
    }),
  nothingWritten('end-client', CLIENT, 'the shared validator in the browser', NO_SESSION_WRITE),

  step('send', 'client', PAGE, LIB, 'Build the request', 'createMovement(check.value)',
    'The page passes the normalized value — direction already resolved to `outbound`, empty memo turned into null — to `createMovement`. `jsonInit` adds `credentials: "include"` and `csrfHeaders()`, which copies the `mer_csrf` cookie into the `x-meridian-csrf` header.',
    {
      detail: 3,
      variants: without(CLIENT, CSRF, VALID, ACCESS),
      sources: [src(F.page, 793, 795, 'await createMovement(check.value)'), src(F.lib, 136, 144, 'export function createMovement'), src(F.lib, 40, 47, 'const jsonInit'), src(F.cuCsrf, 39, 42, 'export function csrfHeaders')],
    }),

  // ---- The request lands on the global hooks ------------------------------------
  step('request', 'request', LIB, CSRFL, 'POST the movement', 'POST /api/movements', 'The request reaches the server; the first global `onRequest` hook sees it before the body is parsed.', {
    detail: 2, variants: [PASS, RATE, CAP],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_OK, data: BODY, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor'] },
  }),
  step('request-over', 'request', LIB, CSRFL, 'POST the movement', 'POST /api/movements', 'Same request with amountMinor 240000.', {
    detail: 2, variants: [FUNDS],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_OK, data: BODY_OVER, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor'] },
  }),
  step('request-nosession', 'request', LIB, CSRFL, 'POST without a session', 'POST /api/movements', 'The browser no longer holds the `mer_session` cookie, so the request carries only `mer_csrf`, the echoed header and the body.', {
    detail: 2, variants: [AUTHV],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_NO_SESSION, data: BODY, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor'] },
  }),
  step('request-forged', 'request', AV, CSRFL, 'POST with cookies only', 'POST /api/movements', 'Session cookie attached, `x-meridian-csrf` header absent.', {
    detail: 2, variants: [CSRF],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_NO_CSRF, data: BODY, typeRef: 'sh:money-movement#ExternalMovementRequest' },
  }),
  step('request-string', 'request', AV, CSRFL, 'POST with a string amount', 'POST /api/movements', 'Valid cookies and header; `amountMinor` is the string "75.00".', {
    detail: 2, variants: [VALID],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_OK, data: BODY_STRING, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor'] },
  }),
  step('request-jordan', 'request', AV, CSRFL, 'POST from Jordan\'s session', 'POST /api/movements', 'Jordan\'s own valid cookies and header, naming Goal Savings as the account.', {
    detail: 2, variants: [ACCESS],
    payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: JORDAN_HEADERS, data: BODY_JORDAN, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['accountId'] },
  }),

  // ---- Layer 2: CSRF -----------------------------------------------------------
  step('l2-csrf', 'guard', CSRFL, CSRFL, 'Layer 2 — CSRF double-submit check', 'header == mer_csrf cookie?',
    'Global `onRequest` hook, registered once in `buildServer`. For an unsafe method on a non-exempt path, a request that carries a session cookie must send `x-meridian-csrf` equal to the `mer_csrf` cookie (constant-time compare). A request with no session cookie is let through on purpose: it cannot act as anyone, and the auth guard gives the honest 401.',
    {
      detail: 2,
      variants: AT_SERVER,
      audience: { executive: 'The bank checks the request really came from its own app, not from another website.', systems: 'Fastify onRequest hook; double-submit cookie pattern; exempt: login, logout, public onboarding.' },
      sources: [src(F.server, 77, 77, "app.addHook('onRequest', csrfHook)"), src(F.csrf, 86, 116, 'export async function csrfHook'), src(F.csrf, 30, 35, 'const EXEMPT_PATHS')],
    }),
  step('l2-decision', 'decision', CSRFL, CSRFL, 'Token valid?', 'match?',
    'Session cookie + matching header → continue. No session cookie → continue to the auth guard. Session cookie + missing or different header → 403.',
    {
      detail: 3,
      variants: AT_SERVER,
      decision: {
        question: 'Does a request with a session cookie carry a matching CSRF header?',
        options: [
          { label: 'Header matches', variant: PASS },
          { label: 'No session cookie — let through', variant: AUTHV },
          { label: 'Header missing', variant: CSRF },
        ],
      },
      sources: [src(F.csrf, 107, 115, 'if (!hasSession) return;')],
    }),
  rejection('l2-reject', CSRF, CSRFL, AV, '403 Forbidden', { error: 'Missing or invalid CSRF token. Reload the page and try again.', code: 'csrf_failed' },
    'The hook answers 403 `csrf_failed` and the request ends there: no guard, handler or query runs.',
    [src(F.csrf, 110, 115, 'csrf_failed'), src(F.csrfTest, 43, 58, 'rejects an authenticated state-changing POST with NO csrf header')]),
  nothingWritten('end-csrf', CSRF, 'the CSRF hook', NO_SESSION_WRITE),

  // ---- Layer 3: mutation valve ----------------------------------------------------
  step('l3-valve', 'guard', CSRFL, RATEL, 'Layer 3 — mutation valve (public demo only)', 'mutationValveHook',
    'Second global hook: at most 200 state-changing requests per client IP per 5 minutes, across every endpoint, counted in process memory. It runs before authentication, so its key is the IP. It is a no-op unless abuse protection is on (public-demo mode or `RATE_LIMITS=true`); over the budget it answers 429 `rate_limited` with `Retry-After`.',
    {
      detail: 3,
      variants: PAST_CSRF,
      sources: [src(F.server, 79, 81, 'mutationValveHook'), src(F.rate, 170, 183, 'export async function mutationValveHook'), src(F.shDemo, 105, 106, 'mutations: { max: 200')],
    }),

  // ---- Layer 4: authentication ------------------------------------------------------
  step('l4-auth-none', 'guard', RATEL, AUTHL, 'Layer 4 — session required', 'requireAuth',
    'First route preHandler. There is no `mer_session` cookie.',
    { detail: 2, variants: [AUTHV], sources: [src(F.route, 64, 64, "preHandler: [requireAuth, rateLimit('money')]"), src(F.guards, 47, 53, 'export const requireAuth')] }),
  ...split(PAST_AUTH, (g) =>
    step('l4-auth', 'guard', RATEL, AUTHL, 'Layer 4 — session required', 'requireAuth',
      `First route preHandler. The \`mer_session\` token is hashed and looked up; a revoked or expired session, or a disabled user, is refused. ${g.user.displayName}'s session is live: its expiry slides forward 8 hours and \`req.user\` is set — every later layer works on this identity, never on ids from the body.`,
      {
        detail: 1,
        audience: { executive: 'The bank checks who is asking.', dba: 'SELECT Session by tokenHash; UPDATE Session SET lastSeenAt, expiresAt (wall clock).' },
        payload: { title: 'req.user', format: 'return', data: g.user, typeRef: 'sh:auth#SessionUser', highlight: ['id'] },
        effects: [{ op: 'update', table: 'Session', id: g.session, set: { lastSeenAt: WALL_NOW, expiresAt: plus8h(WALL_NOW) } }],
        sources: [src(F.route, 64, 64, "preHandler: [requireAuth, rateLimit('money')]"), src(F.guards, 47, 66, 'export const requireAuth'), src(F.sessions, 50, 72, 'export async function resolveSession')],
      }),
  ),
  step('l4-decision', 'decision', AUTHL, AUTHL, 'Signed in?', 'session?',
    'No cookie → 401 `unauthenticated`. A dead session → 401 `session_expired` (and the cookie is cleared).',
    {
      detail: 3,
      variants: PAST_CSRF,
      decision: { question: 'Is there a live customer session?', options: [{ label: 'Yes', variant: PASS }, { label: 'No session cookie', variant: AUTHV }] },
      sources: [src(F.guards, 48, 59, 'session_expired')],
    }),
  rejection('l4-reject', AUTHV, AUTHL, LIB, '401 Unauthorized', { error: 'Not authenticated.', code: 'unauthenticated' },
    '`requireAuth` ends the request with 401. The form shows the server\'s text, "Not authenticated.", in its banner.',
    [src(F.guards, 50, 53, 'Not authenticated.'), src(F.moneyTest, 215, 218, 'requires authentication (401)'), src(F.page, 801, 802, 'setBanner(result.message)')]),
  nothingWritten('end-auth', AUTHV, 'the auth guard', NO_SESSION_WRITE),

  // ---- Layer 5: per-user rate limit --------------------------------------------------
  ...split(PAST_AUTH, (g) =>
    step('l5-rate', 'guard', AUTHL, RATEL, 'Layer 5 — per-user money budget (public demo only)', "rateLimit('money')",
      'Second preHandler, deliberately after `requireAuth` so the key is the user, not the IP. In public-demo mode the `money` bucket allows 30 requests per 5 minutes per user, shared by `POST /api/transfers` and `POST /api/movements`. With abuse protection off it returns immediately.',
      {
        detail: 2,
        payload: { title: 'money bucket', format: 'json', data: { max: 30, windowMs: 300000, key: `user:${g.user.id}` }, typeRef: 'sh:public-demo#RateLimitRule', highlight: ['key'] },
        sources: [src(F.rate, 152, 168, 'export function rateLimit'), src(F.rate, 137, 140, 'export function clientKey'), src(F.shDemo, 91, 92, 'money: { max: 30')],
      }),
  ),
  step('l5-decision', 'decision', RATEL, RATEL, 'Budget left?', 'count < 30?',
    'Fixed window per (bucket, user): the 31st request inside the window is refused.',
    {
      detail: 3,
      variants: PAST_AUTH,
      decision: { question: 'Is the user within the money budget (public-demo mode)?', options: [{ label: 'Within budget, or limits off', variant: PASS }, { label: '31st request in the window', variant: RATE }] },
      sources: [src(F.rate, 60, 78, 'if (entry.count >= max)')],
    }),
  rejection('l5-reject', RATE, RATEL, LIB, '429 Too Many Requests', { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' },
    '`rateLimitedResponse` sets `Retry-After` to the seconds left in the window and answers 429 `rate_limited`. The handler never runs. The form shows the server\'s message in its banner.',
    [src(F.rate, 142, 150, 'export function rateLimitedResponse'), src(F.demoTest, 280, 287, 'toBe(429)')],
    { payload: { title: 'Error response', format: 'http-response', line: '429 Too Many Requests', headers: { 'retry-after': '212' }, data: { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' }, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code'] } }),
  nothingWritten('end-rate', RATE, 'the per-user rate limit', SESSION_WRITE_ONLY),

  // ---- Layer 6: coercion -----------------------------------------------------------
  ...split(PAST_RATE, (g) =>
    step('l6-coerce', 'validate', RATEL, EP, 'Layer 6 — type coercion and length caps', 'typeof … ? … : undefined',
      `The handler copies each field only if it has the expected JavaScript type: strings for accountId, kind, direction, counterparty and memo (accountId, counterparty and memo cut to 500 characters), a number for amountMinor. Anything else becomes \`undefined\`. The whole body was already capped at 64 KB by Fastify's \`bodyLimit\`.${g.suffix === '-string' ? ' Here the string "75.00" becomes `amountMinor: undefined`.' : ''}`,
      {
        detail: 3,
        payload:
          g.suffix === '-string'
            ? { title: 'Coerced input', format: 'args', data: { accountId: CHK, kind: 'bill_pay', amountMinor: null, direction: null, counterparty: 'Metro Water', memo: null }, typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['amountMinor'] }
            : undefined,
        sources: [src(F.route, 30, 30, 'const MAX_FIELD = 500'), src(F.route, 93, 101, "typeof body.amountMinor === 'number'"), src(F.server, 60, 60, 'bodyLimit: MAX_REQUEST_BODY_BYTES'), src(F.shDemo, 137, 137, 'MAX_REQUEST_BODY_BYTES = 64 * 1024')],
      }),
  ),

  // ---- Layer 7: shared validator on the server ---------------------------------------
  step('l7-validate', 'validate', EP, EP, 'Layer 7 — shared validator on the server', 'validateExternalMovement(body)',
    'The same `validateExternalMovement` the browser ran, now on input the server controls. It still checks shape only: ownership and balances need the database.',
    {
      detail: 1,
      variants: PAST_RATE,
      audience: { executive: 'The bank re-checks the request itself rather than trusting the app.' },
      sources: [src(F.route, 94, 101, 'const check = validateExternalMovement({'), src(F.shMove, 226, 285, 'export function validateExternalMovement')],
    }),
  step('l7-decision', 'decision', EP, EP, 'Well-formed?', 'check.ok?',
    'Any failed rule produces a field-keyed error map.',
    {
      detail: 3,
      variants: PAST_RATE,
      decision: { question: 'Does the body pass validateExternalMovement?', options: [{ label: 'Valid', variant: PASS }, { label: 'amountMinor missing (was a string)', variant: VALID }] },
      sources: [src(F.shMove, 176, 183, 'function validAmount')],
    }),
  rejection('l7-reject', VALID, EP, AV, '400 Bad Request', { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { amountMinor: AMOUNT_ERROR } },
    '`invalid()` answers 400 `invalid_request` with the validator\'s `fields` map — the same keys and messages the form uses, so a form would show it under Amount.',
    [src(F.route, 55, 59, "code: 'invalid_request'"), src(F.route, 102, 104, 'Please correct the highlighted fields.')],
    { payload: { title: 'Error response', format: 'http-response', line: '400 Bad Request', data: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { amountMinor: AMOUNT_ERROR } }, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['fields.amountMinor'] } }),
  nothingWritten('end-validator', VALID, 'the server-side validator', SESSION_WRITE_ONLY),

  // ---- Layers 8–11: the money service -------------------------------------------------
  step('call-service', 'call', EP, SVC, 'Hand over to the money service', 'createExternalMovement(user, value, now)',
    'The handler reads the simulated now with `simulationNow` and calls `createExternalMovement` with `req.user`, the normalized value and that time. The remaining checks need the database and live here; each failure is a `MovementError` that `handleMovementError` maps to a status.',
    { detail: 3, variants: PAST_VALIDATOR, sources: [src(F.route, 105, 106, 'createExternalMovement(req.user!, check.value'), src(F.route, 32, 53, 'function movementHttpStatus')] }),
  ...split(PAST_VALIDATOR, (g) =>
    step('l8-access', 'db-read', SVC, DB, 'Layer 8 — account access', 'requireMovableAccount(user, accountId)',
      `Loads the account (404 \`not_found\` if it does not exist), then \`getAccountRelationship\`: the user's \`AccountAccess\` row for that account, or ownership via \`Account.userId\`. The relationship must be owner, joint or authorized — a viewer or no relationship is 403 \`forbidden\`. ${g.suffix === '-jordan' ? 'Jordan has no row for Goal Savings and does not own it: null.' : 'Avery holds an owner grant on Everyday Checking.'}`,
      {
        detail: 1,
        audience: { executive: 'The bank checks the customer may use this account.', dba: 'SELECT Account + LedgerEntry columns; SELECT AccountAccess by (userId, accountId); fallback SELECT Account.userId.' },
        payload:
          g.suffix === '-jordan'
            ? { title: 'getAccountRelationship(usr_jordan, acc_savings)', format: 'return', data: null, typeRef: 'sh:auth#AccountRelationship' }
            : { title: 'AccountAccess', format: 'row', data: { id: 'acs_1', userId: IDS.avery, accountId: CHK, relationship: 'owner' }, typeRef: 'db:AccountAccess', highlight: ['relationship'] },
        sources: [src(F.movements, 285, 285, 'await requireMovableAccount(user.id, input.accountId)'), src(F.movements, 114, 127, 'async function requireMovableAccount'), src(F.access, 67, 88, 'export async function getAccountRelationship')],
      }),
  ),
  step('l8-decision', 'decision', SVC, SVC, 'Movable relationship?', 'owner | joint | authorized?',
    'Only these three relationships may move money.',
    {
      detail: 3,
      variants: PAST_VALIDATOR,
      decision: { question: 'Does the caller have a movable relationship to the account?', options: [{ label: 'Owner', variant: PASS }, { label: 'None (Jordan → Goal Savings)', variant: ACCESS }] },
      sources: [src(F.movements, 67, 67, 'MOVABLE_RELATIONSHIPS'), src(F.movements, 125, 127, "throw new MovementError('forbidden'")],
    }),
  rejection('l8-reject', ACCESS, EP, AV, '403 Forbidden', { error: 'You cannot move money on that account.', code: 'forbidden' },
    '`MovementError("forbidden")` → `handleMovementError` → 403.',
    [src(F.movements, 125, 127, 'You cannot move money on that account.'), src(F.route, 36, 37, "case 'forbidden'")]),
  nothingWritten('end-access', ACCESS, 'the account-access check', SESSION_WRITE_ONLY.replace('the session', 'Jordan\'s session')),

  step('l9-status', 'validate', SVC, SVC, 'Layer 9 — account must be active', "status === 'active'",
    'A frozen or closed account throws `inactive_account`, mapped to 400. Everyday Checking is active.',
    { detail: 3, variants: PAST_ACCESS, sources: [src(F.movements, 128, 130, "account.status !== 'active'"), src(F.route, 41, 42, 'inactive_account')] }),

  step('l10-funds', 'call', SVC, SVC, 'Layer 10 — available funds (outbound only)', 'availableMinor(account) < amount?',
    'Only for outbound movements (an inbound deposit skips it). `availableMinor` runs the shared `deriveBalances` over the account\'s ledger rows: 245110 posted, minus the 12000 pending debit already reserved = 233110 available. Posted balance is not the test — available is.',
    {
      detail: 1,
      variants: PAST_ACCESS,
      audience: { executive: 'The bank checks there is enough money available, counting payments still pending.' },
      payload: { title: 'deriveBalances(checking)', format: 'return', data: CHK_BEFORE, typeRef: 'sh:ledger#DerivedBalances', highlight: ['availableMinor'] },
      sources: [src(F.movements, 287, 291, "direction === 'outbound' && availableMinor(account) < input.amountMinor"), src(F.movements, 81, 89, 'function availableMinor'), src(F.ledger, 79, 119, 'export function deriveBalances')],
    }),
  step('l10-decision', 'decision', SVC, SVC, 'Enough available?', 'amount ≤ 233110?',
    '7500 fits; 240000 does not.',
    {
      detail: 3,
      variants: PAST_ACCESS,
      decision: { question: 'Is the outbound amount within the available balance?', options: [{ label: '7500 ≤ 233110', variant: PASS }, { label: '240000 > 233110', variant: FUNDS }] },
      sources: [src(F.movements, 289, 291, 'insufficient_funds')],
    }),
  rejection('l10-reject', FUNDS, EP, LIB, '400 Bad Request', { error: 'That movement exceeds the available balance.', code: 'insufficient_funds' },
    '`insufficient_funds` maps to 400. The form shows "That movement exceeds the available balance." in its banner and keeps the values.',
    [src(F.movements, 289, 291, 'That movement exceeds the available balance.'), src(F.moneyTest, 203, 212, "toBe('insufficient_funds')"), src(F.page, 801, 802, 'setBanner(result.message)')]),
  nothingWritten('end-funds', FUNDS, 'the available-funds check', SESSION_WRITE_ONLY),

  step('l11-cap', 'db-read', SVC, DB, 'Layer 11 — pending-movement cap', 'count pending movements',
    'Enforced in every mode, not only the public demo: `RESOURCE_CAPS.pendingMovementsPerUser` = 25. The service counts OperationsRequest rows with status `pending`, `subjectEmail` = the caller\'s email and type ach / wire / deposit / bill_pay. An operator\'s approve or reject frees capacity. Internal transfers have no such cap — they never wait for review.',
    {
      detail: 2,
      variants: PAST_FUNDS,
      audience: { dba: "SELECT COUNT(*) FROM OperationsRequest WHERE status = 'pending' AND subjectEmail = ? AND type IN ('ach','wire','deposit','bill_pay')." },
      payload: { title: 'Cap', format: 'json', data: { pendingMovementsPerUser: 25 }, typeRef: 'sh:public-demo#RESOURCE_CAPS', highlight: ['pendingMovementsPerUser'] },
      sources: [src(F.movements, 293, 308, 'RESOURCE_CAPS.pendingMovementsPerUser'), src(F.shDemo, 111, 133, 'pendingMovementsPerUser: 25')],
    }),
  step('l11-decision', 'decision', SVC, SVC, 'Under the cap?', 'awaitingReview < 25?',
    'Zero pending movements in the base example; 25 in the cap variant.',
    {
      detail: 3,
      variants: PAST_FUNDS,
      decision: { question: 'Does the user have fewer than 25 movements awaiting review?', options: [{ label: '0 awaiting review', variant: PASS }, { label: '25 awaiting review', variant: CAP }] },
      sources: [src(F.movements, 303, 308, 'awaitingReview >= RESOURCE_CAPS.pendingMovementsPerUser')],
    }),
  rejection('l11-reject', CAP, EP, LIB, '409 Conflict', { error: 'You already have 25 movements awaiting operator review (the simulated maximum).', code: 'limit_reached' },
    '`limit_reached` maps to 409. The form shows the message in its banner.',
    [src(F.movements, 303, 307, 'limit_reached'), src(F.route, 38, 40, "case 'limit_reached'"), src(F.capsTest, 159, 161, "toBe('limit_reached')")]),
  nothingWritten('end-cap', CAP, 'the pending-movement cap', `${SESSION_WRITE_ONLY} The 25 rows shown are the set-up backlog, not something this request wrote.`),

  // ---- Layer 12: one transaction -----------------------------------------------------------
  step('l12-tx', 'db-write', SVC, DB, 'Layer 12 — one database transaction', '$transaction: 4 inserts',
    'Every check passed. One `prisma.$transaction` writes the pending debit LedgerEntry (which immediately reserves $75.00 of available), the linked bill_pay OperationsRequest whose payload carries the ledger entry id, the `ops_request_created` AuditLog row and a "received — under review" SimulatedEvent. If any insert fails, none of them persist. Nothing posts until an operator approves.',
    {
      detail: 1,
      variants: [PASS],
      audience: {
        executive: 'Only after every check passes does the bank record the payment — as pending, for an employee to review.',
        dba: 'BEGIN; INSERT LedgerEntry (pending debit, origin payment); INSERT OperationsRequest; INSERT AuditLog; INSERT SimulatedEvent; COMMIT.',
      },
      payload: { title: 'LedgerEntry (pending)', format: 'row', data: ROWS.entry, typeRef: 'db:LedgerEntry', highlight: ['status', 'direction'] },
      effects: [
        { op: 'insert', table: 'LedgerEntry', row: ROWS.entry },
        { op: 'insert', table: 'OperationsRequest', row: ROWS.request },
        { op: 'insert', table: 'AuditLog', row: ROWS.audit },
        { op: 'insert', table: 'SimulatedEvent', row: ROWS.event },
      ],
      sources: [src(F.movements, 314, 328, 'await prisma.$transaction(async (tx) => {'), src(F.movements, 341, 382, 'tx.operationsRequest.create'), src(F.audit, 44, 67, 'export async function writeAudit')],
    }),
  step('respond', 'response', EP, LIB, '201 pending review', "201 { status: 'pending_review' }",
    'The handler pushes the new request and event to the operators\' room (`ops:request_changed`, `ops:external_event`) and replies 201. The page shows "Submitted for review" with the reference.',
    {
      detail: 2,
      variants: [PASS],
      payload: { title: 'ExternalMovementResponse', format: 'http-response', line: '201 Created', data: RESPONSE, typeRef: 'sh:money-movement#ExternalMovementResponse', highlight: ['status', 'reference'] },
      sources: [src(F.route, 107, 120, "status: 'pending_review'"), src(F.page, 327, 338, 'Submitted for review')],
    }),
  step('end-pass', 'state', DB, DB, 'Payment queued', 'available 225610',
    'Four rows were written. Everyday Checking: current still 245110 (nothing posted), available 225610, pending debits 19500 — the new $75.00 is reserved alongside the earlier $120.00 bill payment.',
    {
      detail: 2,
      variants: [PASS],
      audience: { dba: '+1 LedgerEntry, +1 OperationsRequest, +1 AuditLog, +1 SimulatedEvent, 1 Session update.' },
      payload: { title: 'Everyday Checking (after)', format: 'json', data: CHK_AFTER, typeRef: 'sh:ledger#DerivedBalances', highlight: ['availableMinor', 'pendingDebitMinor'] },
      sources: [src(F.moneyTest, 189, 201, 'reserves available funds for an outbound movement')],
    }),
];

// ---- Scenario -------------------------------------------------------------------

export const scenario: Scenario = {
  id: 'transaction-validation',
  title: 'The layers that validate a money request',
  question: 'How does transaction validation work?',
  summary:
    'A money request meets twelve checks in a fixed order: the shared validator in the browser, the CSRF hook, the public-demo mutation valve, the session guard, the per-user money rate limit, type coercion in the route, the same shared validator on the server, account access, account status, available funds, the pending-movement cap, and finally a single database transaction. Each variant shows one layer refusing; a refused request writes nothing.',
  category: 'security',
  tags: ['security', 'validation', 'auth', 'money', 'public-demo', 'ledger'],
  participants: [AV, PAGE, LIB, CSRFL, RATEL, AUTHL, EP, SVC, DB],
  related: [
    'sh:money-movement#validateExternalMovement',
    'sh:money-movement#validateTransfer',
    'sh:money-movement#MOVEMENT_LIMITS',
    'sh:money-movement#MOVEMENT_TEXT',
    'be:auth/csrf#csrfHook',
    'be:abuse/rate-limit#mutationValveHook',
    'be:abuse/rate-limit#rateLimit',
    'be:auth/guards#requireAuth',
    'be:money/movements#requireMovableAccount',
    'be:money/movements#createExternalMovement',
    'be:money/movements#createTransfer',
    'be:routes/money#handleMovementError',
    'be:auth/access#getAccountRelationship',
    'sh:public-demo#RESOURCE_CAPS',
    'sh:public-demo#PUBLIC_DEMO_RATE_LIMITS',
    'sh:ledger#deriveBalances',
    'ep:POST /api/movements',
    'ep:POST /api/transfers',
    'cu:pages/MoveMoney',
    'cu:lib/csrf#csrfHeaders',
    'feat:csrf',
    'feat:rate-limits',
    'feat:auth',
    'feat:external-movements',
    'feat:transfers',
    'test:apps/backend/src/routes/csrf.test.ts',
    'test:apps/backend/src/routes/caps.test.ts',
    'test:apps/backend/src/routes/money.test.ts',
  ],
  variants: [
    { id: PASS, label: 'Passes every layer', description: 'The $75.00 bill payment is queued: four rows in one transaction.', outcome: 'success' },
    { id: CLIENT, label: 'Rejected in the browser', description: '$60,000 fails the shared validator before any request is sent.', outcome: 'rejected' },
    { id: CSRF, label: 'Rejected by CSRF', description: 'Cookies without the x-meridian-csrf header: 403 csrf_failed.', outcome: 'rejected' },
    { id: AUTHV, label: 'Rejected by auth', description: 'No session cookie: 401 unauthenticated.', outcome: 'rejected' },
    { id: RATE, label: 'Rejected by rate limit', description: 'Public-demo mode only: the 31st money request in 5 minutes gets 429 rate_limited.', outcome: 'rejected' },
    { id: VALID, label: 'Rejected by the server validator', description: 'A hand-made request with a string amount: 400 invalid_request with fields.', outcome: 'rejected' },
    { id: ACCESS, label: 'Rejected by account access', description: 'Jordan Joint names Goal Savings, which is not shared with him: 403 forbidden.', outcome: 'rejected' },
    { id: FUNDS, label: 'Rejected for funds', description: '$2,400.00 exceeds the $2,331.10 available: 400 insufficient_funds.', outcome: 'rejected' },
    { id: CAP, label: 'Rejected by the pending cap', description: 'Avery already has 25 movements awaiting review: 409 limit_reached.', outcome: 'rejected' },
  ],
  defaultVariant: PASS,
  initialState: {
    ...baseState(),
    Session: [
      { id: 'ses_avery', userId: IDS.avery, tokenHash: '<sha-256 of the mer_session token>', createdAt: '2026-10-01T14:30:00.000Z', lastSeenAt: '2026-10-01T15:06:12.000Z', expiresAt: '2026-10-01T23:06:12.000Z', revokedAt: null },
      { id: 'ses_jordan', userId: JORDAN.id, tokenHash: '<sha-256 of Jordan\'s mer_session token>', createdAt: '2026-10-01T14:50:00.000Z', lastSeenAt: '2026-10-01T15:05:40.000Z', expiresAt: '2026-10-01T23:05:40.000Z', revokedAt: null },
    ],
  },
  watchAccounts: [CHK],
  steps,
  sources: [
    src(F.route, 61, 124, 'export async function moneyRoutes'),
    src(F.movements, 273, 308, 'export async function createExternalMovement'),
    src(F.shMove, 194, 285, 'export function validateExternalMovement'),
    src(F.csrf, 86, 116, 'export async function csrfHook'),
    src(F.rate, 152, 183, 'export function rateLimit'),
  ],
};

