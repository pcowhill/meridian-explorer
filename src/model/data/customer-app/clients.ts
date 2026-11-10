import type { Entity, FieldDef, Relation, SourceRef } from '../../types';
import { cu, cuFile, rel, repo } from './helpers';

/**
 * The customer app's API clients (`apps/customer/src/lib/*`): one module per
 * domain, and one entity per exported function that performs a `fetch`, each
 * with an `http` relation to the exact backend endpoint it calls.
 */

// ---------------------------------------------------------------------------
// Fetch functions (table-driven so every function gets the same treatment:
// entity + http relation + shared-type relations + CSRF relation for POSTs)
// ---------------------------------------------------------------------------

interface ClientFn {
  /** File name under lib/, without extension. */
  file: string;
  name: string;
  signature: string;
  method: 'GET' | 'POST';
  /** Path exactly as registered on the server. */
  path: string;
  lines: [number, number];
  summary: string;
  /** What it does and returns. */
  description: string;
  /** What goes on the wire. */
  sends: string;
  /** How failures are mapped. */
  errors: string;
  /** Shared DTO ids carried by the request/response. */
  types?: string[];
  tags: string[];
  aliases?: string[];
  example?: unknown;
  /** Lines of the file-private helper that attaches cookie + CSRF header. */
  init: SourceRef;
  /** Wire protocol note; defaults to cookie-carrying fetch. */
  protocol?: string;
  detail?: 3 | 4;
  extraSources?: SourceRef[];
}

const COOKIE_FETCH = 'HTTP/JSON (fetch, credentials: "include")';

const INIT = {
  auth: cu('lib/auth.ts', 25, 42, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  money: cu('lib/money.ts', 34, 47, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  cards: cu('lib/cards.ts', 33, 46, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  risk: cu('lib/risk.ts', 25, 38, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  schedules: cu('lib/schedules.ts', 36, 49, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  lending: cu('lib/lending.ts', 38, 51, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  invitations: cu('lib/invitations.ts', 17, 30, 'const jsonInit', 'Cookie + CSRF header + conditional Content-Type'),
  onboarding: cu('lib/onboarding.ts', 57, 62, '...csrfHeaders()', 'Inline init: CSRF header (empty for a visitor) + JSON, no credentials option'),
  api: cu('lib/api.ts', 44, 52, 'fetch(`${API_URL}/status`)', 'Bare fetch, no init object'),
};

const MONEY_ERRORS =
  'Never throws. 2xx with a JSON body → `{ ok: true, data }`; 2xx with an unreadable body → `code: "unknown_error"`. Non-2xx → `{ ok: false, code, message, fields }` where `code` is the body\'s `code` (or `unknown_error`), `message` is the server\'s `error` text if present, otherwise a friendly default chosen by `messageForCode`, and `fields` is the per-field map from a 400 `invalid_request`. A thrown fetch (backend unreachable) → `code: "network_error"`.';

const FNS: ClientFn[] = [
  // ---- lib/api.ts -------------------------------------------------------------
  {
    file: 'api',
    name: 'fetchStatus',
    signature: 'fetchStatus(): Promise<StatusResponse | null>',
    method: 'GET',
    path: '/status',
    lines: [31, 55],
    summary: 'Fetches the backend status at most once every 15 seconds for the whole app, returning `null` instead of throwing when the API is down.',
    description:
      'A module-level `statusCache` stores the in-flight or most recent promise with a timestamp. Any call within `STATUS_CACHE_MS` (15 000 ms) receives that same promise, so the public-demo banner, the status pill and the sign-in form — all of which mount together — share one request. The result drives two things: the "Backend online · v… · db ready" pill, and whether the shared-public-demo warning is shown (`status.publicDemo`).',
    sends: '`fetch(`${API_URL}/status`)` with no init object: no `credentials: "include"`, no CSRF header, no body. It is the only request in the app that does not go through a `jsonInit` helper; the endpoint is public and needs no session.',
    errors: 'A non-2xx response and a thrown network error both resolve to `null`, which callers read as "backend offline". The `null` is cached for the same 15 s, so a backend that comes up is noticed on the next page load after the window.',
    types: ['sh:types#StatusResponse'],
    tags: ['http', 'public-demo', 'integration'],
    aliases: ['status probe', 'health check', 'backend status'],
    init: INIT.api,
    protocol: 'HTTP/JSON (fetch, default credentials, no custom headers)',
    extraSources: [cu('lib/api.ts', 31, 33, 'STATUS_CACHE_MS = 15_000', 'The shared 15-second cache')],
  },

  // ---- lib/auth.ts ------------------------------------------------------------
  {
    file: 'auth',
    name: 'login',
    signature: 'login(email: string, password: string): Promise<LoginResult>',
    method: 'POST',
    path: '/api/auth/login',
    lines: [58, 90],
    summary: 'Posts the credentials and returns either the signed-in user or the backend\'s error code — it never throws.',
    description:
      'Called only through `AuthProvider.login`. On a 2xx it expects `{ user }` (`AuthResponse`) and returns `{ ok: true, user }`; the session itself arrives as an httpOnly `Set-Cookie` that the browser stores and this code never sees.',
    sends: 'JSON body `{ email, password }`, `Content-Type: application/json`, `credentials: "include"` (so the `Set-Cookie` in the response is accepted cross-origin in development) and the CSRF header if a `mer_csrf` cookie already exists.',
    errors: 'Non-2xx → `{ ok: false, code, message }` using the body\'s `code` (`invalid_credentials`, `account_locked`, `account_disabled`, `invalid_request`, and `rate_limited` on the public demo) and `error` text; a missing body gives `unknown_error`. A 2xx without `user` → `unknown_error`. A thrown fetch → `network_error` ("Cannot reach the banking service…"). The Login page maps each code to its own sentence.',
    types: ['sh:auth#AuthResponse', 'sh:auth#SessionUser', 'sh:auth#ApiErrorResponse'],
    tags: ['auth', 'security', 'http'],
    aliases: ['sign in', 'authenticate'],
    example: { request: { email: 'avery.customer@example.com', password: '<demo password>' }, result: { ok: true, user: { id: 'usr_avery', email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' } } },
    init: INIT.auth,
    detail: 3,
  },
  {
    file: 'auth',
    name: 'logout',
    signature: 'logout(): Promise<void>',
    method: 'POST',
    path: '/api/auth/logout',
    lines: [92, 99],
    summary: 'Asks the server to revoke the session and clear the cookie; swallows every failure so the UI can always sign out locally.',
    description:
      'Best effort by design: `AuthProvider.logout` clears the cached user whether or not this call succeeded. The response body is not read.',
    sends: 'A body-less POST with `credentials: "include"` and the CSRF header. `jsonInit` deliberately omits `Content-Type` here: a POST that declares `application/json` with an empty body is rejected by the backend with 400, which would silently skip the server-side revoke.',
    errors: 'None surfaced. A network error is caught and ignored; a non-2xx status is not inspected.',
    tags: ['auth', 'security', 'http'],
    aliases: ['sign out'],
    init: INIT.auth,
  },
  {
    file: 'auth',
    name: 'fetchMe',
    signature: 'fetchMe(): Promise<SessionUser | null>',
    method: 'GET',
    path: '/api/auth/me',
    lines: [101, 114],
    summary: 'Asks the server who the session cookie belongs to; returns the user, or `null` for "not signed in" and "backend unreachable" alike.',
    description:
      'This is the session-hydration request: `AuthProvider` issues it once when the app loads. As a side effect of being the first safe GET, it is also the request on which the backend sets the readable `mer_csrf` cookie that later mutations echo.',
    sends: 'GET with `credentials: "include"`; no body, no `Content-Type`. The CSRF header is spread in if a token exists and is ignored by the server on a GET.',
    errors: 'Any non-2xx (normally 401) → `null`; a thrown fetch → `null`; a 2xx without `user` → `null`. Callers cannot tell these apart and do not need to.',
    types: ['sh:auth#AuthResponse', 'sh:auth#SessionUser'],
    tags: ['auth', 'security', 'http'],
    aliases: ['who am i', 'session hydration', 'current user'],
    init: INIT.auth,
    detail: 3,
  },
  {
    file: 'auth',
    name: 'fetchLoginHistory',
    signature: 'fetchLoginHistory(): Promise<LoginEventDTO[] | null>',
    method: 'GET',
    path: '/api/auth/login-history',
    lines: [116, 126],
    summary: 'Loads the signed-in user\'s recent sign-in attempts for the dashboard\'s "Recent sign-in activity" card.',
    description: 'Unwraps `{ events }`; a 2xx without `events` yields an empty array.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Non-2xx or network failure → `null`, which the dashboard renders as "Sign-in history is unavailable right now."',
    types: ['sh:auth#LoginEventDTO'],
    tags: ['auth', 'audit', 'http'],
    init: INIT.auth,
  },
  {
    file: 'auth',
    name: 'fetchAccounts',
    signature: 'fetchAccounts(): Promise<AccountSummary[] | null>',
    method: 'GET',
    path: '/api/accounts',
    lines: [128, 138],
    summary: 'Loads every account the signed-in user may see, each with balances the server derived from the ledger.',
    description:
      'The most-called read in the app: Dashboard, Move money, Wallet, Loans & CDs, Scheduled payments and Statements each call it on mount to populate their account lists and selectors. There is no client-side cache, so each page visit asks the server again and always shows freshly derived balances. Lives in `lib/auth.ts` for historical reasons (it was added with the first authenticated screen).',
    sends: 'GET with `credentials: "include"`; no body. The server decides which accounts are visible from the session — the client sends no user or account id.',
    errors: 'Non-2xx or network failure → `null`. Every caller treats `null` as "accounts unavailable" and shows an offline card; an empty array is a distinct, valid "no accounts yet" state.',
    types: ['sh:auth#AccountSummary'],
    tags: ['money', 'data', 'http'],
    aliases: ['list accounts', 'balances'],
    init: INIT.auth,
    detail: 3,
  },
  {
    file: 'auth',
    name: 'fetchAccountTransactions',
    signature: 'fetchAccountTransactions(accountId: string, query: TransactionQuery = {}): Promise<TransactionsFetch>',
    method: 'GET',
    path: '/api/accounts/:id/transactions',
    lines: [151, 174],
    summary: 'Loads one account\'s header (with derived balances) and its transactions, reporting the HTTP status so the page can tell "no access" from "offline".',
    description:
      'Returns `{ status, data }` rather than `null` on failure. The function can add `?q=&group=&origin=` from a `TransactionQuery`, but its only caller (`AccountDetail`) passes no query: the full list is fetched once and all searching and filtering then happens in the browser inside `TransactionList`, using the same shared `filterTransactions` the server would apply.\n\nNote that the account detail page gets its account header from this response; the customer app never calls `GET /api/accounts/:id`.',
    sends: 'GET `/api/accounts/<encodeURIComponent(id)>/transactions[?q&group&origin]` with `credentials: "include"`; no body.',
    errors: 'Non-2xx → `{ status: res.status, data: null }` (the page maps 403 → "No access to this account", 404 → "Account not found"). A thrown fetch → `{ status: 0, data: null }` ("Account unavailable").',
    types: ['sh:transactions#AccountTransactionsResponse', 'sh:transactions#TransactionQuery'],
    tags: ['money', 'ledger', 'data', 'http'],
    aliases: ['transaction history', 'account detail'],
    init: INIT.auth,
    detail: 3,
  },

  // ---- lib/money.ts -----------------------------------------------------------
  {
    file: 'money',
    name: 'createTransfer',
    signature: 'createTransfer(input: TransferRequest): Promise<MoneyResult<TransferResponse>>',
    method: 'POST',
    path: '/api/transfers',
    lines: [117, 128],
    summary: 'Submits an immediate transfer between two of the user\'s own accounts and returns both accounts with their new derived balances.',
    description:
      'A thin wrapper over the private `postMoney` helper. The caller (`MoveMoney` → `TransferFlow`) passes the value already normalised by the shared `validateTransfer`. On success `data.accounts` holds the source and destination `AccountSummary` re-derived after both ledger legs posted, which is why the confirmation panel can show new balances without another request.',
    sends: 'JSON body `{ fromAccountId, toAccountId, amountMinor, memo }` (amount in integer minor units), `Content-Type: application/json`, `credentials: "include"`, and `x-meridian-csrf` from the `mer_csrf` cookie.',
    errors: `${MONEY_ERRORS} Codes the UI distinguishes: \`insufficient_funds\`, \`invalid_request\`, \`forbidden\`, \`unauthenticated\` / \`session_expired\`. Fallback message: "That transfer could not be completed. Please try again."`,
    types: ['sh:money-movement#TransferRequest', 'sh:money-movement#TransferResponse'],
    tags: ['money', 'http', 'validation'],
    aliases: ['transfer', 'internal transfer', 'move money'],
    example: { request: { fromAccountId: 'acc_checking', toAccountId: 'acc_savings', amountMinor: 2500, memo: 'Move to savings' } },
    init: INIT.money,
    detail: 3,
    extraSources: [cu('lib/money.ts', 87, 115, 'async function postMoney', 'Shared POST helper + error mapping')],
  },
  {
    file: 'money',
    name: 'createMovement',
    signature: 'createMovement(input: ExternalMovementRequest): Promise<MoneyResult<ExternalMovementResponse>>',
    method: 'POST',
    path: '/api/movements',
    lines: [130, 144],
    summary: 'Submits a reviewable external movement — check deposit, ACH, wire or bill payment — which the server only queues for an operator.',
    description:
      'Used by three tabs of Move money (Deposit a check, Send money, Pay a bill); the `kind` field in the body distinguishes them. On success `data` carries a `reference` (shown as `MOV-…`), the `kind`, `amountMinor`, `direction` and `status: "pending_review"`. Nothing has posted at that point: the customer sees a Pending row until an operator approves it.',
    sends: 'JSON body `{ accountId, kind, amountMinor, direction?, counterparty?, memo? }` as normalised by the shared `validateExternalMovement`, with `credentials: "include"` and the CSRF header.',
    errors: `${MONEY_ERRORS} Fallback message: "That request could not be submitted. Please try again."`,
    types: ['sh:money-movement#ExternalMovementRequest', 'sh:money-movement#ExternalMovementResponse'],
    tags: ['money', 'operations', 'http', 'validation'],
    aliases: ['deposit', 'ACH', 'wire', 'bill pay', 'external movement'],
    example: { request: { accountId: 'acc_checking', kind: 'bill_pay', amountMinor: 12000, direction: 'outbound', counterparty: 'City Power & Light', memo: null } },
    init: INIT.money,
    detail: 3,
    extraSources: [cu('lib/money.ts', 87, 115, 'async function postMoney', 'Shared POST helper + error mapping')],
  },

  // ---- lib/cards.ts -----------------------------------------------------------
  {
    file: 'cards',
    name: 'listCards',
    signature: 'listCards(): Promise<CardResult<CardListResponse>>',
    method: 'GET',
    path: '/api/cards',
    lines: [129, 132],
    summary: 'Loads every card the signed-in user can see, each with its travel notices.',
    description: 'One call populates the whole wallet. The customer app never calls the per-account variant `GET /api/accounts/:id/cards`.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Never throws; failures become `{ ok: false, code, message }`. The Wallet page treats any failure as "Cards unavailable". Fallback message: "Your cards could not be loaded."',
    types: ['sh:cards#CardListResponse', 'sh:cards#CardDTO'],
    tags: ['cards', 'http'],
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'issueCard',
    signature: 'issueCard(accountId: string, input: IssueCardRequest): Promise<CardResult<CardResponse>>',
    method: 'POST',
    path: '/api/accounts/:id/cards',
    lines: [134, 144],
    summary: 'Issues a new simulated debit or credit card on one of the user\'s accounts.',
    description: 'Returns `{ card }`; the Wallet prepends it to the list. The account id travels in the URL, the card type and network in the body.',
    sends: 'POST `/api/accounts/<id>/cards` with JSON `{ cardType, network }` (normalised by the shared `validateIssueCard`), `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. `invalid_request` / `bad_request` carry `fields` for the form; `forbidden`, `not_found`, `unauthenticated` / `session_expired` get friendly defaults; network failure → `network_error`. Fallback: "That card could not be issued. Please try again."',
    types: ['sh:cards#IssueCardRequest', 'sh:cards#CardResponse'],
    tags: ['cards', 'http', 'validation'],
    example: { accountId: 'acc_checking', request: { cardType: 'debit', network: 'visa' } },
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'freezeCard',
    signature: 'freezeCard(cardId: string): Promise<CardResult<CardResponse>>',
    method: 'POST',
    path: '/api/cards/:id/freeze',
    lines: [146, 153],
    summary: 'Temporarily locks an active card.',
    description: 'Returns the updated `{ card }` (now `frozen`), which the Wallet swaps into its list.',
    sends: 'Body-less POST (so no `Content-Type`) with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; the error `message` is shown inline on that card. Fallback: "That card could not be frozen. Please try again."',
    types: ['sh:cards#CardResponse'],
    tags: ['cards', 'http'],
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'unfreezeCard',
    signature: 'unfreezeCard(cardId: string): Promise<CardResult<CardResponse>>',
    method: 'POST',
    path: '/api/cards/:id/unfreeze',
    lines: [155, 162],
    summary: 'Re-activates a frozen card.',
    description: 'Mirror image of `freezeCard`; returns the updated `{ card }` (now `active`).',
    sends: 'Body-less POST with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; the error `message` is shown inline on that card. Fallback: "That card could not be unfrozen. Please try again."',
    types: ['sh:cards#CardResponse'],
    tags: ['cards', 'http'],
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'reportCard',
    signature: 'reportCard(cardId: string, input: ReportCardRequest): Promise<CardResult<ReplaceCardResponse>>',
    method: 'POST',
    path: '/api/cards/:id/report',
    lines: [164, 178],
    summary: 'Reports a card lost or stolen; the server retires it and issues a replacement in the same call.',
    description: 'The response carries both cards: `card` is the replacement, `replaced` is the old card in its terminal status. The Wallet uses both to update its list without re-fetching.',
    sends: 'JSON `{ reason }` (`lost` or `stolen`, validated by the shared `validateReportCard`) with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. A `fields.reason` message is shown under the select; the summary `message` goes to the card\'s alert. Fallback: "That card could not be reported. Please try again."',
    types: ['sh:cards#ReportCardRequest', 'sh:cards#ReplaceCardResponse'],
    tags: ['cards', 'risk', 'http'],
    aliases: ['lost card', 'stolen card', 'replace card'],
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'addTravelNotice',
    signature: 'addTravelNotice(cardId: string, input: TravelNoticeRequest): Promise<CardResult<TravelNoticeResponse>>',
    method: 'POST',
    path: '/api/cards/:id/travel-notices',
    lines: [180, 190],
    summary: 'Adds a travel notice (destination and date range) to an in-service card.',
    description: 'Returns the whole updated `card` including its notices, so the Wallet replaces the card rather than patching a notice list.',
    sends: 'JSON `{ destination, startsOn, endsOn, note }` with ISO dates (`YYYY-MM-DD`), as normalised by the shared `validateTravelNotice`; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; `fields` light up destination / dates / note. Fallback: "That travel notice could not be added. Please try again."',
    types: ['sh:cards#TravelNoticeRequest', 'sh:cards#TravelNoticeResponse'],
    tags: ['cards', 'http', 'validation'],
    init: INIT.cards,
  },
  {
    file: 'cards',
    name: 'cancelTravelNotice',
    signature: 'cancelTravelNotice(cardId: string, noticeId: string): Promise<CardResult<TravelNoticeResponse>>',
    method: 'POST',
    path: '/api/cards/:id/travel-notices/:noticeId/cancel',
    lines: [192, 204],
    summary: 'Cancels one active travel notice on a card.',
    description: 'Returns the updated `card`; the Wallet shows only notices whose status is still `active`.',
    sends: 'Body-less POST with both ids URL-encoded into the path; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. Fallback: "That travel notice could not be cancelled. Please try again."',
    types: ['sh:cards#TravelNoticeResponse'],
    tags: ['cards', 'http'],
    init: INIT.cards,
  },

  // ---- lib/risk.ts ------------------------------------------------------------
  {
    file: 'risk',
    name: 'fileDispute',
    signature: 'fileDispute(input: DisputeRequest): Promise<RiskResult<DisputeResponse>>',
    method: 'POST',
    path: '/api/disputes',
    lines: [111, 118],
    summary: 'Flags one posted transaction as disputed and queues it for operator review.',
    description:
      'Called from the inline dispute form inside `TransactionList`. The response `{ ok, message, requestId }` is not shown; the list only needs to know the call succeeded so it can flip that row to a "Disputed" badge locally. No balance changes as a result of this call.',
    sends: 'JSON `{ ledgerEntryId, reason, details }` as normalised by the shared `validateDispute`; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. `invalid_request` / `bad_request` return `fields` (reason, details); `forbidden` → "You do not have access to this item."; `not_found` → "That item could not be found."; network → `network_error`. Fallback: "That dispute could not be filed. Please try again."',
    types: ['sh:risk#DisputeRequest', 'sh:risk#DisputeResponse'],
    tags: ['risk', 'http', 'validation'],
    aliases: ['dispute a transaction', 'chargeback'],
    example: { request: { ledgerEntryId: 'le_002', reason: 'not_recognized', details: null } },
    init: INIT.risk,
    detail: 3,
  },
  {
    file: 'risk',
    name: 'listFraudAlerts',
    signature: 'listFraudAlerts(): Promise<RiskResult<FraudAlertListResponse>>',
    method: 'GET',
    path: '/api/fraud-alerts',
    lines: [120, 127],
    summary: 'Loads the signed-in customer\'s pending fraud alerts for the dashboard\'s "Security alerts" section.',
    description: 'Returns `{ alerts }`; each `FraudAlertSummary` has the summary line, merchant, amount and any response already recorded.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Never throws. The dashboard turns any failure into `null` and renders nothing, so an offline backend does not produce an alarming empty section. Fallback: "Fraud alerts could not be loaded."',
    types: ['sh:risk#FraudAlertListResponse'],
    tags: ['risk', 'http'],
    init: INIT.risk,
  },
  {
    file: 'risk',
    name: 'respondToFraudAlert',
    signature: 'respondToFraudAlert(alertId: string, response: FraudResponse): Promise<RiskResult<FraudRespondResult>>',
    method: 'POST',
    path: '/api/fraud-alerts/:id/respond',
    lines: [129, 145],
    summary: 'Records the customer\'s answer to a fraud alert: "it was me" (`confirm_legit`) or "report fraud" (`report_fraud`).',
    description:
      'The backend returns the updated operations request, but the customer UI has no use for it. The function therefore discards the body and, on success, returns `{ response }` — the value the customer just chose — so the dashboard can collapse the alert to its recorded outcome. The answer does not reverse a charge by itself; an operator acts on it.',
    sends: 'JSON `{ response }` to `/api/fraud-alerts/<id>/respond` with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; an error result is passed through unchanged and shown above the alert list. Fallback: "That response could not be recorded. Please try again."',
    types: ['sh:risk#FraudResponse'],
    tags: ['risk', 'http'],
    aliases: ['confirm fraud', 'fraud response'],
    example: { alertId: 'req_fraud_1', request: { response: 'report_fraud' } },
    init: INIT.risk,
    detail: 3,
    extraSources: [cu('lib/risk.ts', 105, 109, 'export interface FraudRespondResult')],
  },

  // ---- lib/schedules.ts -------------------------------------------------------
  {
    file: 'schedules',
    name: 'createSchedule',
    signature: 'createSchedule(input: CreateScheduleRequest): Promise<ScheduleResult<CreateScheduleResponse>>',
    method: 'POST',
    path: '/api/schedules',
    lines: [128, 141],
    summary: 'Creates a one-off, weekly or monthly scheduled transfer or bill payment. No money moves at creation.',
    description: 'Returns `{ schedule, message }`. The schedule only fires when an operator advances the simulation clock past its next-run date.',
    sends: 'JSON `{ kind, fromAccountId, toAccountId | counterparty, amountMinor, frequency, firstRunInDays, memo }` as normalised by the shared `validateCreateSchedule`; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. `invalid_request` returns `fields`; `forbidden` means one of the accounts is not the caller\'s; network → `network_error`. Fallback: "That schedule could not be created. Please try again."',
    types: ['sh:schedules#CreateScheduleRequest', 'sh:schedules#CreateScheduleResponse'],
    tags: ['time', 'money', 'http', 'validation'],
    aliases: ['recurring payment', 'schedule a payment'],
    example: { request: { kind: 'bill_pay', fromAccountId: 'acc_checking', counterparty: 'City Power & Light', amountMinor: 12000, frequency: 'monthly', firstRunInDays: 0, memo: null } },
    init: INIT.schedules,
    detail: 3,
  },
  {
    file: 'schedules',
    name: 'fetchSchedules',
    signature: 'fetchSchedules(): Promise<ScheduleResult<ScheduleListResponse>>',
    method: 'GET',
    path: '/api/schedules',
    lines: [143, 150],
    summary: 'Loads the caller\'s own scheduled payments with status, next run and run history.',
    description: 'Returns `{ schedules }`.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Never throws; the page turns a failure into "Scheduled payments unavailable". Fallback: "We could not load your scheduled payments."',
    types: ['sh:schedules#ScheduleListResponse', 'sh:schedules#ScheduleDTO'],
    tags: ['time', 'http'],
    init: INIT.schedules,
  },
  {
    file: 'schedules',
    name: 'cancelSchedule',
    signature: 'cancelSchedule(id: string): Promise<ScheduleResult<CancelScheduleResponse>>',
    method: 'POST',
    path: '/api/schedules/:id/cancel',
    lines: [152, 163],
    summary: 'Cancels an active schedule and returns it in its new `cancelled` state.',
    description: 'The page replaces the row with the returned `schedule`.',
    sends: 'Body-less POST with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. 403 `forbidden` (not yours), 404 `not_found` and 409 `conflict` ("That schedule is no longer active, so it cannot be cancelled.") surface as discriminated errors shown on the row.',
    types: ['sh:schedules#CancelScheduleResponse'],
    tags: ['time', 'http'],
    init: INIT.schedules,
  },
  {
    file: 'schedules',
    name: 'fetchClock',
    signature: 'fetchClock(): Promise<ScheduleResult<ClockResponse>>',
    method: 'GET',
    path: '/api/clock',
    lines: [165, 176],
    summary: 'Reads the current simulated date so pages can show what "now" means for schedules and interest.',
    description:
      'Display only. Used by Scheduled payments and by Loans & CDs (for "matures in N days"). Customers can read the clock but cannot advance it; that is a staff action in the operations app. The value is fetched once when the page mounts and is not refreshed, so a page left open does not notice an operator advancing the clock.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Never throws; callers store `null` on failure and show "Simulation clock unavailable".',
    types: ['sh:clock#ClockResponse'],
    tags: ['time', 'http'],
    aliases: ['simulated date', 'simulation clock'],
    init: INIT.schedules,
  },
  {
    file: 'schedules',
    name: 'fetchAccountStatements',
    signature: 'fetchAccountStatements(accountId: string): Promise<ScheduleResult<AccountStatementsResponse>>',
    method: 'GET',
    path: '/api/accounts/:id/statements',
    lines: [178, 191],
    summary: 'Loads the monthly statement periods the server derives for one account as of the simulated date.',
    description: 'Lives in `lib/schedules.ts` because statements and the clock shipped together. Returns `{ accountId, asOf, periods }` (`AccountStatementsResponse`): `asOf` is the simulated time the figures were computed at, and each period has opening and closing balances, credits, debits and a settled-entry count.',
    sends: 'GET `/api/accounts/<id>/statements` with `credentials: "include"`; no body.',
    errors: 'Never throws. The Statements page keeps the error `code`: `forbidden` / `not_found` show a neutral "Statements unavailable for this account", anything else shows the red offline card.',
    types: ['sh:statements#AccountStatementsResponse'],
    tags: ['money', 'data', 'time', 'http'],
    init: INIT.schedules,
  },

  // ---- lib/lending.ts ---------------------------------------------------------
  {
    file: 'lending',
    name: 'listLending',
    signature: 'listLending(): Promise<LendingResult<LendingListResponse>>',
    method: 'GET',
    path: '/api/lending',
    lines: [134, 141],
    summary: 'Loads the caller\'s CDs and loans with server-derived figures (CD value, amount owed, monthly payment).',
    description: 'Returns `{ products }`.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Never throws; the page turns a failure into "Loans & CDs unavailable". Fallback: "We could not load your loans and CDs."',
    types: ['sh:lending#LendingListResponse', 'sh:lending#LendingProductDTO'],
    tags: ['lending', 'http'],
    init: INIT.lending,
  },
  {
    file: 'lending',
    name: 'openCd',
    signature: 'openCd(input: OpenCdRequest): Promise<LendingResult<LendingProductResponse>>',
    method: 'POST',
    path: '/api/lending/cds',
    lines: [143, 155],
    summary: 'Opens a certificate of deposit funded from one of the user\'s cash accounts.',
    description: 'Returns `{ product, message }`. The APY is not sent — the server applies the bank\'s offered rate for the chosen term.',
    sends: 'JSON `{ fundingAccountId, principalMinor, termMonths }` (normalised by the shared `validateOpenCd`); `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. Codes with friendly defaults: `insufficient_funds`, `invalid_request` (+`fields`), `inactive_account`, `forbidden`, `not_found`, `unauthenticated` / `session_expired`; network → `network_error`. Fallback: "That CD could not be opened. Please try again."',
    types: ['sh:lending#OpenCdRequest', 'sh:lending#LendingProductResponse'],
    tags: ['lending', 'money', 'http', 'validation'],
    example: { request: { fundingAccountId: 'acc_savings', principalMinor: 50000, termMonths: 12 } },
    init: INIT.lending,
    detail: 3,
  },
  {
    file: 'lending',
    name: 'openLoan',
    signature: 'openLoan(input: OpenLoanRequest): Promise<LendingResult<LendingProductResponse>>',
    method: 'POST',
    path: '/api/lending/loans',
    lines: [157, 169],
    summary: 'Opens a loan whose cash is disbursed straight into one of the user\'s accounts.',
    description: 'Returns `{ product, message }`; the product includes the monthly payment the server computed.',
    sends: 'JSON `{ disbursementAccountId, principalMinor, termMonths }` (normalised by the shared `validateOpenLoan`); `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; same code set as `openCd`. Fallback: "That loan could not be opened. Please try again."',
    types: ['sh:lending#OpenLoanRequest', 'sh:lending#LendingProductResponse'],
    tags: ['lending', 'money', 'http', 'validation'],
    init: INIT.lending,
  },
  {
    file: 'lending',
    name: 'payLoan',
    signature: 'payLoan(id: string, input: LoanPaymentRequest): Promise<LendingResult<LendingProductResponse>>',
    method: 'POST',
    path: '/api/lending/loans/:id/pay',
    lines: [171, 187],
    summary: 'Makes a payment on an active loan — the scheduled monthly amount, or a custom amount.',
    description: 'Returns the updated `{ product, message }` (lower amount owed, or `paid_off`).',
    sends: 'JSON `{ fromAccountId, amountMinor }` where `amountMinor: null` means "pay the scheduled monthly payment" and the server resolves the figure; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. Adds `invalid_state` ("That product can no longer accept this action.") to the usual set. Fallback: "That payment could not be completed. Please try again."',
    types: ['sh:lending#LoanPaymentRequest', 'sh:lending#LendingProductResponse'],
    tags: ['lending', 'money', 'http'],
    init: INIT.lending,
  },
  {
    file: 'lending',
    name: 'withdrawCd',
    signature: 'withdrawCd(id: string, input: WithdrawCdRequest): Promise<LendingResult<LendingProductResponse>>',
    method: 'POST',
    path: '/api/lending/cds/:id/withdraw',
    lines: [189, 204],
    summary: 'Withdraws a matured CD into one of the user\'s accounts and closes it.',
    description: 'Returns the updated `{ product, message }` (now `closed`). The button is only offered when the shared `isCdWithdrawable` says the CD is matured, and the server checks again.',
    sends: 'JSON `{ toAccountId }`; `credentials: "include"` and the CSRF header.',
    errors: 'Never throws. `not_matured` → "This CD has not matured yet, so it cannot be withdrawn."; `invalid_state`, `forbidden`, `not_found` as elsewhere. Fallback: "That CD could not be withdrawn. Please try again."',
    types: ['sh:lending#WithdrawCdRequest', 'sh:lending#LendingProductResponse'],
    tags: ['lending', 'money', 'http'],
    init: INIT.lending,
  },

  // ---- lib/onboarding.ts ------------------------------------------------------
  {
    file: 'onboarding',
    name: 'submitApplication',
    signature: 'submitApplication(input: OpenAccountRequest): Promise<SubmitApplicationResult>',
    method: 'POST',
    path: '/api/onboarding/applications',
    lines: [44, 82],
    summary: 'Submits a visitor\'s open-account application to the one public write endpoint the customer app uses.',
    description:
      'The applicant has no session, so this is the only mutating call that does not send the session cookie. Success requires a 2xx whose body has a `reference`; the page then shows it (`MER-…`). Submitting creates no user, account or money — it queues a request an operator must approve.',
    sends: 'JSON body with the value normalised by the shared `validateOpenAccount` (trimmed name, lower-cased email, password, product, `initialFundingMinor` in cents, `consent: true`, optional `jointInviteEmail`). Headers: `Content-Type: application/json` plus `...csrfHeaders()`, which is normally empty for a logged-out visitor. No `credentials: "include"`.',
    errors: 'Never throws. Non-2xx → `{ ok: false, fields, message }` — there is no `code` in this result type; `fields` carries server-only findings such as an email that is already registered. A 2xx without `reference` → "Unexpected response from the server." A thrown fetch → "Cannot reach the banking service…".',
    types: ['sh:onboarding#OpenAccountRequest', 'sh:onboarding#OpenAccountResponse'],
    tags: ['onboarding', 'http', 'validation', 'public-demo'],
    aliases: ['open account', 'apply', 'sign up'],
    example: { request: { fullName: 'Alex Rivera', email: 'alex.rivera@example.com', password: '<chosen password>', product: 'checking', initialFundingMinor: 10000, consent: true, jointInviteEmail: null } },
    init: INIT.onboarding,
    protocol: 'HTTP/JSON (fetch, no credentials option — public endpoint)',
    detail: 3,
  },

  // ---- lib/invitations.ts -----------------------------------------------------
  {
    file: 'invitations',
    name: 'fetchInvitations',
    signature: 'fetchInvitations(): Promise<AccountInvitationDTO[] | null>',
    method: 'GET',
    path: '/api/invitations',
    lines: [46, 60],
    summary: 'Loads the pending joint-owner invitations addressed to the signed-in user.',
    description: 'Unwraps `{ invitations }`. Feeds the dashboard\'s invitation inbox.',
    sends: 'GET with `credentials: "include"`; no body.',
    errors: 'Non-2xx or network failure → `null`; the inbox then renders nothing rather than an error.',
    types: ['sh:onboarding#AccountInvitationDTO'],
    tags: ['onboarding', 'rbac', 'http'],
    init: INIT.invitations,
  },
  {
    file: 'invitations',
    name: 'createInvitation',
    signature: 'createInvitation(accountId: string, inviteeEmail: string): Promise<InvitationResult>',
    method: 'POST',
    path: '/api/accounts/:id/invitations',
    lines: [90, 101],
    summary: 'Lets an account owner invite someone, by email, to become a joint owner of that account.',
    description: 'Returns `{ ok: true, invitation }`. The form is only rendered when the viewer\'s relationship to the account is `owner`, and the server enforces the same rule.',
    sends: 'JSON `{ inviteeEmail }` to `/api/accounts/<id>/invitations`; `credentials: "include"` and the CSRF header. The email is trimmed by the page but not otherwise validated client-side.',
    errors: 'Never throws. Non-2xx → `{ ok: false, code, message }` with the server\'s `error` text (403 when the caller is not the owner) or "That action could not be completed. Please try again."; network → `network_error`. No per-field map and no per-code friendly messages in this client.',
    types: ['sh:onboarding#AccountInvitationDTO'],
    tags: ['onboarding', 'rbac', 'http'],
    aliases: ['invite joint owner'],
    init: INIT.invitations,
    extraSources: [cu('lib/invitations.ts', 62, 88, 'async function postInvitation', 'Shared POST helper')],
  },
  {
    file: 'invitations',
    name: 'acceptInvitation',
    signature: 'acceptInvitation(id: string): Promise<InvitationResult>',
    method: 'POST',
    path: '/api/invitations/:id/accept',
    lines: [103, 106],
    summary: 'Accepts a pending invitation, which grants the caller access to the shared account.',
    description: 'On success the dashboard removes the invitation from the inbox and re-fetches the account list so the newly shared account appears.',
    sends: 'Body-less POST with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; the error `message` is shown above the inbox.',
    types: ['sh:onboarding#AccountInvitationDTO'],
    tags: ['onboarding', 'rbac', 'http'],
    init: INIT.invitations,
  },
  {
    file: 'invitations',
    name: 'declineInvitation',
    signature: 'declineInvitation(id: string): Promise<InvitationResult>',
    method: 'POST',
    path: '/api/invitations/:id/decline',
    lines: [108, 111],
    summary: 'Declines a pending invitation; nothing is shared.',
    description: 'On success the dashboard removes the invitation from the inbox. The account list is not re-fetched because nothing changed.',
    sends: 'Body-less POST with `credentials: "include"` and the CSRF header.',
    errors: 'Never throws; the error `message` is shown above the inbox.',
    types: ['sh:onboarding#AccountInvitationDTO'],
    tags: ['onboarding', 'rbac', 'http'],
    init: INIT.invitations,
  },
];

const fnId = (f: ClientFn) => `cu:lib/${f.file}#${f.name}`;

const fnEntities: Entity[] = FNS.map((f) => ({
  id: fnId(f),
  kind: 'function',
  name: f.name,
  parent: `cu:lib/${f.file}`,
  summary: f.summary,
  description: `${f.description}\n\nRequest: ${f.sends}\n\nFailure handling: ${f.errors}`,
  signature: f.signature,
  ...(f.detail ? { detail: f.detail } : {}),
  tags: f.tags,
  ...(f.aliases ? { aliases: [...f.aliases, `${f.method} ${f.path}`] } : { aliases: [`${f.method} ${f.path}`] }),
  ...(f.example !== undefined ? { example: f.example } : {}),
  tech: ['fetch'],
  sources: [cu(`lib/${f.file}.ts`, f.lines[0], f.lines[1], `function ${f.name}`), f.init, ...(f.extraSources ?? [])],
}));

const fnRelations: Relation[] = FNS.flatMap((f) => {
  const id = fnId(f);
  const out: Relation[] = [
    rel(id, `ep:${f.method} ${f.path}`, 'http', {
      label: `${f.method} ${f.path}`,
      summary: f.summary,
      description: `${f.sends}\n\n${f.errors}`,
      protocol: f.protocol ?? COOKIE_FETCH,
      ...(f.types ? { data: f.types } : {}),
      tags: f.tags,
      sources: [cu(`lib/${f.file}.ts`, f.lines[0], f.lines[1], `function ${f.name}`), f.init],
    }),
  ];
  for (const t of f.types ?? []) {
    out.push(
      rel(id, t, 'uses-type', {
        label: t.split('#')[1],
        detail: 5,
        sources: [cuFile(`lib/${f.file}.ts`, t.split('#')[1])],
      }),
    );
  }
  if (f.method === 'POST') {
    out.push(
      rel(id, 'cu:lib/csrf#csrfHeaders', 'calls', {
        label: 'csrfHeaders()',
        summary:
          f.file === 'onboarding'
            ? 'Spread inline into the headers for uniformity; empty for a logged-out visitor, and the endpoint is CSRF-exempt.'
            : 'Through the file-private `jsonInit`, which spreads `csrfHeaders()` into every request this module builds.',
        detail: 4,
        tags: ['security', 'csrf'],
        sources: [f.init],
      }),
    );
  }
  return out;
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

function resultFields(successField: FieldDef, withFields: boolean): FieldDef[] {
  return [
    { name: 'ok', type: 'boolean', required: true, description: 'Discriminant: `true` for a 2xx with a usable body, otherwise `false`.' },
    successField,
    { name: 'code', type: 'string', description: 'Only when `ok` is false: the backend\'s `code`, or `unknown_error` / `network_error` produced by the client.' },
    { name: 'message', type: 'string', description: 'Only when `ok` is false: the server\'s `error` text, or a friendly default for the code.' },
    ...(withFields
      ? [{ name: 'fields', type: 'Record<string, string>', description: 'Only when `ok` is false: per-field messages from a 400 `invalid_request`, keyed by the shared validator\'s field names.' } as FieldDef]
      : []),
  ];
}

function sameShapeResult(file: string, name: string, lines: [number, number], forWhat: string): Entity {
  return {
    id: `cu:lib/${file}#${name}`,
    kind: 'type',
    name: `${name}<T>`,
    parent: `cu:lib/${file}`,
    summary: `Discriminated result returned by every ${forWhat} call: \`{ ok: true, data }\` or \`{ ok: false, code, message, fields? }\`.`,
    description: `Structurally identical to \`MoneyResult<T>\` in \`lib/money.ts\`; each client file declares its own copy rather than sharing one.`,
    detail: 5,
    tags: ['http', 'types'],
    fields: resultFields({ name: 'data', type: 'T', description: 'Only when `ok` is true: the parsed success body.' }, true),
    sources: [cu(`lib/${file}.ts`, lines[0], lines[1], `export type ${name}`)],
  };
}

const typeEntities: Entity[] = [
  {
    id: 'cu:lib/money#MoneyResult',
    kind: 'type',
    name: 'MoneyResult<T>',
    parent: 'cu:lib/money',
    summary: 'The "never throw" result shape used across the API clients: success carries `data`, failure carries a `code`, a `message` and optional per-field errors.',
    description:
      'Pages branch on `result.ok` instead of using try/catch. On failure they put `result.fields` under the matching inputs and `result.message` in a banner. `code` lets a caller special-case an outcome (for example `insufficient_funds`), though at this commit the pages only display the message.\n\nThe cards, risk, schedules and lending clients each declare a structurally identical type (`CardResult`, `RiskResult`, `ScheduleResult`, `LendingResult`).',
    tags: ['http', 'types', 'validation'],
    aliases: ['discriminated result', 'result type', 'never throws'],
    fields: resultFields({ name: 'data', type: 'T', description: 'Only when `ok` is true: the parsed success body.' }, true),
    example: { ok: false, code: 'insufficient_funds', message: 'Not enough available funds in that account for this amount.' },
    sources: [
      cu('lib/money.ts', 58, 61, 'export type MoneyResult'),
      cu('lib/money.ts', 70, 85, 'function messageForCode', 'Friendly default per error code'),
    ],
  },
  sameShapeResult('cards', 'CardResult', [57, 60], 'card'),
  sameShapeResult('risk', 'RiskResult', [48, 51], 'fraud / dispute'),
  sameShapeResult('schedules', 'ScheduleResult', [60, 63], 'schedule, clock and statement'),
  sameShapeResult('lending', 'LendingResult', [62, 65], 'lending'),
  {
    id: 'cu:lib/auth#LoginResult',
    kind: 'type',
    name: 'LoginResult',
    parent: 'cu:lib/auth',
    summary: 'Outcome of a sign-in attempt: the user on success, or an error `code` and `message`.',
    tags: ['auth', 'types'],
    fields: resultFields({ name: 'user', type: 'SessionUser', description: 'Only when `ok` is true.', typeRef: 'sh:auth#SessionUser' }, false),
    values: [
      { value: 'invalid_credentials', meaning: 'Email and password do not match (from the backend).' },
      { value: 'account_locked', meaning: 'Too many failed attempts; temporarily locked (from the backend).' },
      { value: 'account_disabled', meaning: 'The account is disabled (from the backend).' },
      { value: 'invalid_request', meaning: 'Email or password missing/malformed (from the backend).' },
      { value: 'rate_limited', meaning: 'Public-demo sign-in rate limit hit (from the backend; the Login page has a message for it).' },
      { value: 'network_error', meaning: 'Produced by the client when fetch throws.' },
      { value: 'unknown_error', meaning: 'Produced by the client when the response has no usable body.' },
    ],
    example: { ok: false, code: 'invalid_credentials', message: 'Invalid email or password.' },
    sources: [
      cu('lib/auth.ts', 44, 47, 'export type LoginResult'),
      cu('pages/Login.tsx', 32, 50, 'function messageForCode', 'Where each code becomes a sentence'),
    ],
  },
  {
    id: 'cu:lib/auth#TransactionsFetch',
    kind: 'type',
    name: 'TransactionsFetch',
    parent: 'cu:lib/auth',
    summary: 'Result of loading an account\'s transactions: the HTTP status (0 when unreachable) plus the data when successful.',
    tags: ['http', 'types'],
    fields: [
      { name: 'status', type: 'number', required: true, description: 'HTTP status, or 0 when the backend was unreachable.' },
      { name: 'data', type: 'AccountTransactionsResponse | null', required: true, description: 'Present only on success.', typeRef: 'sh:transactions#AccountTransactionsResponse' },
    ],
    example: { status: 403, data: null },
    sources: [cu('lib/auth.ts', 140, 149, 'export interface TransactionsFetch')],
  },
  {
    id: 'cu:lib/onboarding#SubmitApplicationResult',
    kind: 'type',
    name: 'SubmitApplicationResult',
    parent: 'cu:lib/onboarding',
    summary: 'Outcome of submitting an application: the queued reference on success, or field errors plus one summary message.',
    description: 'Unlike the other result types it has no `code`.',
    detail: 5,
    tags: ['onboarding', 'types'],
    fields: [
      { name: 'ok', type: 'boolean', required: true },
      { name: 'data', type: 'OpenAccountResponse', description: 'Only when `ok` is true: `{ reference, status, product, message }`.', typeRef: 'sh:onboarding#OpenAccountResponse' },
      { name: 'fields', type: 'Record<string, string>', description: 'Only when `ok` is false: field → message from the server\'s 400 body.' },
      { name: 'message', type: 'string', description: 'Only when `ok` is false: one human-readable summary.' },
    ],
    sources: [cu('lib/onboarding.ts', 18, 26, 'export type SubmitApplicationResult')],
  },
  {
    id: 'cu:lib/invitations#InvitationResult',
    kind: 'type',
    name: 'InvitationResult',
    parent: 'cu:lib/invitations',
    summary: 'Outcome of creating, accepting or declining an invitation: the invitation on success, or `code` and `message`.',
    detail: 5,
    tags: ['onboarding', 'types'],
    fields: resultFields({ name: 'invitation', type: 'AccountInvitationDTO', description: 'Only when `ok` is true.', typeRef: 'sh:onboarding#AccountInvitationDTO' }, false),
    sources: [cu('lib/invitations.ts', 41, 44, 'export type InvitationResult')],
  },
];

// ---------------------------------------------------------------------------
// Modules and non-fetch symbols
// ---------------------------------------------------------------------------

const SAME_PATTERN =
  'It follows the pattern set by `lib/money.ts`: a private `jsonInit` adds `credentials: "include"`, the CSRF header and (only when there is a body) `Content-Type: application/json`; a private request helper converts every outcome into a discriminated result so callers never need try/catch; and the customer app sends no `x-meridian-surface` header, so the backend falls back to the customer session cookie.';

const moduleEntities: Entity[] = [
  {
    id: 'cu:lib/api',
    kind: 'module',
    name: 'api (base URL + status)',
    parent: 'cu.api',
    summary: 'Decides, once at load time, which origin every request goes to, and provides the shared backend-status probe.',
    description:
      'API base URL resolution happens at module scope: `API_URL = resolveApiBaseUrl({ explicit: VITE_API_URL, mode, origin: window.location.origin, fallback: LOCAL_URLS.backend })`. The rule itself is a pure function in the shared package so both frontends and their tests agree:\n\n1. a non-blank `VITE_API_URL` always wins;\n2. otherwise a production build uses the page\'s own origin — the deployment serves the built app and reverse-proxies `/api/*`, `/health`, `/status` and `/socket.io/*` on the same hostname, so there is no separate API host;\n3. otherwise (dev server, tests) `http://localhost:3000`.\n\nEvery other client file imports `API_URL` and prefixes its paths with it.\n\nThe module also computes `WS_URL` for Socket.IO, but nothing imports it: the customer app does not open a socket and subscribes to no real-time events. The backend-status pill and the public-demo banner are fed by a plain `GET /status` (`fetchStatus`), fetched once per page load and cached for 15 seconds.',
    audience: {
      executive: 'Tells the website where the bank\'s server is.',
      systems: 'Same-origin in production (reverse proxy forwards `/api/*`, `/health`, `/status`); `http://localhost:3000` in development; overridable with `VITE_API_URL`. No WebSocket from this app.',
    },
    tags: ['http', 'config', 'integration'],
    aliases: ['API_URL', 'base url', 'VITE_API_URL', 'same origin', 'api.ts'],
    tech: ['fetch', 'Vite env'],
    sources: [
      cu('lib/api.ts', 3, 21, 'resolveApiBaseUrl', 'Doc comment + API_URL'),
      repo('packages/shared/src/public-demo.ts', 161, 180, 'export function resolveApiBaseUrl', 'The shared rule'),
      cu('lib/api.ts', 23, 29, 'const WS_URL', 'Computed and exported, never imported'),
    ],
  },
  {
    id: 'cu:lib/api#API_URL',
    kind: 'constant',
    name: 'API_URL',
    parent: 'cu:lib/api',
    summary: 'The backend origin every customer-app request is prefixed with, fixed when the bundle loads.',
    values: [
      { value: 'VITE_API_URL', meaning: 'Explicit build-time override, any mode (trimmed, trailing slashes removed).' },
      { value: 'window.location.origin', meaning: 'Production build without an override: same origin as the page, e.g. https://banking.cowhill.dev.' },
      { value: 'http://localhost:3000', meaning: 'Development server and tests (`LOCAL_URLS.backend`).' },
    ],
    example: 'https://banking.cowhill.dev',
    tags: ['config', 'http'],
    sources: [cu('lib/api.ts', 16, 21, 'const API_URL = resolveApiBaseUrl')],
  },
  {
    id: 'cu:lib/api#WS_URL',
    kind: 'constant',
    name: 'WS_URL',
    parent: 'cu:lib/api',
    summary: 'A Socket.IO base URL that is computed and exported but used by nothing in the customer app.',
    description: 'Resolved with `VITE_WS_URL` as the override and `API_URL` as the fallback. No file under `apps/customer/src` imports it or `socket.io-client`.',
    detail: 5,
    tags: ['config', 'realtime'],
    sources: [cu('lib/api.ts', 23, 29, 'const WS_URL'), cu('lib/api.ts', 57, 57, 'export { API_URL, WS_URL }')],
  },
  {
    id: 'cu:lib/useApiStatus',
    kind: 'module',
    name: 'useApiStatus',
    parent: 'cu.api',
    summary: 'React hook that asks for the backend status once when a component mounts.',
    description: 'Returns `{ loading, status }`, starting at `{ loading: true, status: null }`. Despite the word "polls" in its comment there is no interval: it calls `fetchStatus()` once per mount, and that call is itself served from a 15-second shared cache.',
    tags: ['http', 'ui'],
    sources: [cu('lib/useApiStatus.ts', 5, 25, 'export function useApiStatus')],
  },
  {
    id: 'cu:lib/useApiStatus#useApiStatus',
    kind: 'function',
    name: 'useApiStatus',
    parent: 'cu:lib/useApiStatus',
    summary: 'Hook returning `{ loading, status }` for the backend status; `status` is `null` when the API is unreachable.',
    signature: 'useApiStatus(): ApiStatusState',
    detail: 5,
    tags: ['http', 'ui'],
    sources: [cu('lib/useApiStatus.ts', 10, 25, 'export function useApiStatus')],
  },
  {
    id: 'cu:lib/public-demo',
    kind: 'module',
    name: 'public-demo',
    parent: 'cu.api',
    summary: 'Decides whether the "shared, disposable public demo" warning should be shown.',
    description: 'Two signals, either is enough: the build-time flag `VITE_PUBLIC_DEMO` (so the warning is there from first paint) and the backend\'s `GET /status` → `publicDemo` (the authoritative runtime flag). Neither is set in ordinary local development.',
    tags: ['public-demo', 'ui'],
    sources: [cu('lib/public-demo.ts', 4, 18, 'export function usePublicDemo')],
  },
  {
    id: 'cu:lib/public-demo#PUBLIC_DEMO_BUILD',
    kind: 'constant',
    name: 'PUBLIC_DEMO_BUILD',
    parent: 'cu:lib/public-demo',
    summary: 'Build-time boolean parsed from `VITE_PUBLIC_DEMO`.',
    detail: 5,
    tags: ['public-demo', 'config'],
    sources: [cu('lib/public-demo.ts', 12, 12, 'export const PUBLIC_DEMO_BUILD')],
  },
  {
    id: 'cu:lib/public-demo#usePublicDemo',
    kind: 'function',
    name: 'usePublicDemo',
    parent: 'cu:lib/public-demo',
    summary: 'Hook: true when the build flag is set or the backend reports `publicDemo: true`.',
    signature: 'usePublicDemo(): boolean',
    tags: ['public-demo', 'ui'],
    sources: [cu('lib/public-demo.ts', 14, 18, 'export function usePublicDemo')],
  },
  {
    id: 'cu:lib/auth',
    kind: 'module',
    name: 'auth (auth + accounts client)',
    parent: 'cu.api',
    summary: 'The original API client: sign-in, sign-out, "who am I", sign-in history, the account list and one account\'s transactions.',
    description:
      'Six exported fetch functions. It established the conventions the later clients copy: every request that takes part in a session sends `credentials: "include"` because the session is an httpOnly cookie; nothing throws; failures come back as `null` (reads) or a typed result (`login`, `fetchAccountTransactions`).\n\nThe reads here return `null` on any failure rather than a `{ ok, code }` result, which is why Dashboard-era screens can only say "unavailable", while later screens (cards, schedules, lending) can distinguish `forbidden` from offline.',
    tags: ['auth', 'http', 'money'],
    aliases: ['auth.ts', 'auth client', 'accounts client'],
    tech: ['fetch'],
    sources: [cu('lib/auth.ts', 13, 23, 'Auth + account API client')],
  },
  {
    id: 'cu:lib/auth#jsonInit',
    kind: 'function',
    name: 'jsonInit (private, repeated per client file)',
    parent: 'cu:lib/auth',
    summary: 'Builds the `RequestInit` for every API call: session cookie, CSRF header, and a JSON content type only when there is a body.',
    description:
      'Not exported. The same eight lines are repeated verbatim in `auth.ts`, `money.ts`, `cards.ts`, `risk.ts`, `schedules.ts`, `lending.ts` and `invitations.ts`; this entity stands for all seven copies.\n\nWhat it guarantees: (1) `credentials: "include"` so the httpOnly session cookie is sent even when the API is on another origin (development); (2) `...csrfHeaders()` on every request, so no mutating call can be written without the token; (3) `Content-Type: application/json` only if `init.body != null` — a body-less POST such as logout, freeze or cancel must not claim JSON, because the backend rejects an empty JSON body with 400.\n\nCaller-supplied headers are spread after the CSRF header and so could override it; no caller passes any.',
    signature: 'jsonInit(init: RequestInit = {}): RequestInit',
    detail: 3,
    tags: ['security', 'csrf', 'http', 'auth'],
    aliases: ['credentials include', 'request init', 'fetch wrapper'],
    example: { credentials: 'include', method: 'POST', headers: { 'x-meridian-csrf': '<mer_csrf cookie value>', 'Content-Type': 'application/json' }, body: '{"fromAccountId":"acc_checking","toAccountId":"acc_savings","amountMinor":2500,"memo":null}' },
    sources: [
      cu('lib/auth.ts', 25, 42, 'const jsonInit', 'Explains why Content-Type is conditional'),
      cu('lib/money.ts', 34, 47, 'const jsonInit', 'One of the six other copies'),
    ],
  },
  {
    id: 'cu:lib/money',
    kind: 'module',
    name: 'money (money-movement client)',
    parent: 'cu.api',
    summary: 'Two POST wrappers behind the Move money page: an immediate internal transfer and a reviewable external movement.',
    description:
      'Both exported functions go through one private helper, `postMoney(url, body, fallback)`, which performs the fetch and maps the outcome to `MoneyResult<T>`. Both endpoints share an error envelope: 400 `invalid_request` with a `fields` map, 400 `insufficient_funds`, 403 `forbidden`, 401 when the session is gone. The `fields` map is passed straight through so the form can mark the same inputs the server objected to.\n\nThe module comment records a deliberate choice: the customer app sends no `x-meridian-surface` header, so the backend defaults to the customer session cookie.',
    tags: ['money', 'http', 'validation'],
    aliases: ['money.ts', 'transfer client', 'movements client'],
    tech: ['fetch'],
    sources: [
      cu('lib/money.ts', 10, 32, 'Money-movement API client'),
      cu('lib/money.ts', 87, 115, 'async function postMoney', 'Fetch + error mapping'),
    ],
  },
  {
    id: 'cu:lib/cards',
    kind: 'module',
    name: 'cards (card lifecycle client)',
    parent: 'cu.api',
    summary: 'Seven wrappers for the wallet: list cards, issue, freeze, unfreeze, report lost/stolen, add and cancel travel notices.',
    description: `${SAME_PATTERN}\n\nPrivate \`get\` / \`post\` helpers sit on a common \`request\`; \`post\` omits the body entirely when given \`undefined\`, which is how freeze, unfreeze and cancel become body-less POSTs. None of these calls moves money.`,
    tags: ['cards', 'http'],
    aliases: ['cards.ts', 'card client'],
    tech: ['fetch'],
    sources: [
      cu('lib/cards.ts', 14, 31, 'Card lifecycle API client'),
      cu('lib/cards.ts', 87, 127, 'async function request', 'request / get / post helpers'),
    ],
  },
  {
    id: 'cu:lib/risk',
    kind: 'module',
    name: 'risk (fraud + dispute client)',
    parent: 'cu.api',
    summary: 'Three wrappers: file a dispute, list the customer\'s fraud alerts, and answer one.',
    description: `${SAME_PATTERN}\n\nNothing here edits a balance: filing a dispute flags a ledger entry, and answering a fraud alert records the customer's choice for an operator to act on.`,
    tags: ['risk', 'http'],
    aliases: ['risk.ts', 'fraud client', 'dispute client'],
    tech: ['fetch'],
    sources: [
      cu('lib/risk.ts', 10, 23, 'Fraud + dispute API client'),
      cu('lib/risk.ts', 76, 103, 'async function request', 'Fetch + error mapping'),
    ],
  },
  {
    id: 'cu:lib/schedules',
    kind: 'module',
    name: 'schedules (schedules, clock + statements client)',
    parent: 'cu.api',
    summary: 'Five wrappers: create, list and cancel scheduled payments, read the simulation clock, and load an account\'s statements.',
    description: `${SAME_PATTERN}\n\nThree loosely related things live here because they shipped in the same milestone. The error envelope adds 409 \`conflict\` for cancelling a schedule that is no longer active.`,
    tags: ['time', 'money', 'http'],
    aliases: ['schedules.ts', 'clock client', 'statements client'],
    tech: ['fetch'],
    sources: [
      cu('lib/schedules.ts', 12, 34, 'Scheduled-payments + simulation-clock + statements API client'),
      cu('lib/schedules.ts', 93, 126, 'async function requestSchedule', 'Fetch + error mapping'),
    ],
  },
  {
    id: 'cu:lib/lending',
    kind: 'module',
    name: 'lending (loans + CDs client)',
    parent: 'cu.api',
    summary: 'Five wrappers: list lending products, open a CD, open a loan, pay a loan, withdraw a matured CD.',
    description: `${SAME_PATTERN}\n\nIts \`messageForCode\` knows the lending-specific codes \`invalid_state\`, \`not_matured\` and \`inactive_account\` in addition to the money-movement set.`,
    tags: ['lending', 'money', 'http'],
    aliases: ['lending.ts', 'loans client', 'CD client'],
    tech: ['fetch'],
    sources: [
      cu('lib/lending.ts', 12, 36, 'Lending API client'),
      cu('lib/lending.ts', 74, 97, 'function messageForCode', 'Lending error codes → messages'),
      cu('lib/lending.ts', 99, 132, 'async function requestLending', 'Fetch + error mapping'),
    ],
  },
  {
    id: 'cu:lib/onboarding',
    kind: 'module',
    name: 'onboarding (application client)',
    parent: 'cu.api',
    summary: 'One wrapper for the public open-account application.',
    description: 'The only client that deliberately omits `credentials: "include"`: the applicant is a logged-out visitor, so there is no session to attach and the endpoint is CSRF-exempt. It still never throws.',
    tags: ['onboarding', 'http'],
    aliases: ['onboarding.ts', 'application client'],
    tech: ['fetch'],
    sources: [cu('lib/onboarding.ts', 5, 16, 'Onboarding API client')],
  },
  {
    id: 'cu:lib/invitations',
    kind: 'module',
    name: 'invitations (joint-owner client)',
    parent: 'cu.api',
    summary: 'Four wrappers: list my pending invitations, invite someone to an account I own, accept, decline.',
    description: 'Session-bound like `lib/auth.ts` (`credentials: "include"` + CSRF header through its own `jsonInit`). The list call returns `null` on failure so the inbox can hide itself; the three POSTs share `postInvitation` and return `InvitationResult`.',
    tags: ['onboarding', 'rbac', 'http'],
    aliases: ['invitations.ts', 'joint owner'],
    tech: ['fetch'],
    sources: [
      cu('lib/invitations.ts', 5, 15, 'Joint-invitation API client'),
      cu('lib/invitations.ts', 62, 88, 'async function postInvitation', 'Shared POST helper'),
    ],
  },

  // ---- Presentation helpers (no network) --------------------------------------
  {
    id: 'cu:lib/account-display',
    kind: 'module',
    name: 'account-display',
    parent: 'cu.api',
    summary: 'Pure labels and formatters shared by the dashboard, account detail and transaction list — no React, no network.',
    description: 'Centralised so the three surfaces label account types, relationships, ledger statuses and signed amounts the same way. It sits under `lib/` next to the API clients but performs no requests.',
    detail: 4,
    tags: ['ui', 'money'],
    aliases: ['account-display.ts', 'formatters', 'labels'],
    sources: [cu('lib/account-display.ts', 11, 16, 'Presentational lookups')],
  },
  {
    id: 'cu:lib/account-display#groupAccounts',
    kind: 'function',
    name: 'groupAccounts',
    parent: 'cu:lib/account-display',
    summary: 'Splits the account list into "cash" (everything except CDs and loans) and "lending" (CDs and loans), preserving order.',
    description: 'Exists so the dashboard\'s "Total available cash" sums checking and savings only. A loan account carries a negative balance (the amount owed); adding it to the headline would understate the customer\'s cash. Anything that is not a CD or a loan — including an `external` account — lands in the cash bucket, which a unit test pins.',
    signature: 'groupAccounts(accounts: AccountSummary[]): { cash: AccountSummary[]; lending: AccountSummary[] }',
    tags: ['money', 'ui', 'lending'],
    sources: [
      cu('lib/account-display.ts', 84, 101, 'export function groupAccounts'),
      cu('lib/account-display.ts', 63, 82, 'export function isLendingAccount', 'isCashAccount / isLendingAccount'),
    ],
  },
  {
    id: 'cu:lib/account-display#formatSignedMinor',
    kind: 'function',
    name: 'formatSignedMinor',
    parent: 'cu:lib/account-display',
    summary: 'Formats a signed minor-unit amount with an explicit sign: credits `+`, debits `-`, zero `+`.',
    signature: "formatSignedMinor(minor: number, currency = 'USD'): string",
    detail: 5,
    tags: ['money', 'ui'],
    example: { input: -4890, output: '-$48.90' },
    sources: [cu('lib/account-display.ts', 50, 54, 'export function formatSignedMinor')],
  },
  {
    id: 'cu:lib/account-display#savingsApyNote',
    kind: 'function',
    name: 'savingsApyNote',
    parent: 'cu:lib/account-display',
    summary: 'Returns the "Earns 1.50% APY (simulated)" note for a savings account, or `null` for any other type.',
    description: 'The rate comes from the shared `DEFAULT_SAVINGS_APY_BPS` (150), formatted with the shared `formatApy`.',
    signature: 'savingsApyNote(type: AccountType): string | null',
    detail: 5,
    tags: ['lending', 'ui'],
    sources: [cu('lib/account-display.ts', 103, 107, 'export function savingsApyNote')],
  },
  {
    id: 'cu:lib/account-display#TXN_STATUS_META',
    kind: 'constant',
    name: 'TXN_STATUS_META',
    parent: 'cu:lib/account-display',
    summary: 'Badge label and colour for each ledger status as the customer sees it.',
    values: [
      { value: 'posted', meaning: 'Badge "Posted" (green). Not shown on rows in the Posted group.' },
      { value: 'pending', meaning: 'Badge "Pending" (amber).' },
      { value: 'held', meaning: 'Badge "Hold" (amber).' },
      { value: 'disputed', meaning: 'Badge "Disputed" (rose).' },
      { value: 'failed', meaning: 'Badge "Failed" (grey).' },
      { value: 'reversed', meaning: 'Badge "Reversed" (grey).' },
    ],
    detail: 5,
    tags: ['ledger', 'ui'],
    sources: [cu('lib/account-display.ts', 40, 48, 'export const TXN_STATUS_META')],
  },
  {
    id: 'cu:lib/account-display#RELATIONSHIP_META',
    kind: 'constant',
    name: 'RELATIONSHIP_META',
    parent: 'cu:lib/account-display',
    summary: 'Badge label and colour for the viewer\'s relationship to an account.',
    values: [
      { value: 'owner', meaning: 'Badge "Owner".' },
      { value: 'joint', meaning: 'Badge "Joint".' },
      { value: 'authorized', meaning: 'Badge "Authorized".' },
      { value: 'viewer', meaning: 'Badge "View only". Pages also hide money-moving actions for this relationship.' },
    ],
    detail: 5,
    tags: ['rbac', 'ui'],
    sources: [cu('lib/account-display.ts', 18, 24, 'export const RELATIONSHIP_META')],
  },
  {
    id: 'cu:lib/cta',
    kind: 'module',
    name: 'cta',
    parent: 'cu.api',
    summary: 'Pure rule that rewrites "Log in" / "Open an account" buttons to "Visit your Dashboard" for a signed-in visitor.',
    description: 'No React and no network, so it can be unit-tested. Used by the marketing `PageHero` and `CTASection` components.',
    detail: 4,
    tags: ['ui', 'auth'],
    aliases: ['call to action', 'cta.ts'],
    sources: [cu('lib/cta.ts', 1, 13, 'Session-aware call-to-action resolution')],
  },
  {
    id: 'cu:lib/cta#resolveCtas',
    kind: 'function',
    name: 'resolveCtas',
    parent: 'cu:lib/cta',
    summary: 'Returns the CTA list unchanged when logged out; when logged in, collapses every auth-entry CTA into one `/dashboard` button.',
    description: 'The first auth-entry CTA (`/login` or `/open-account`, ignoring any query or hash) keeps its position and extra fields but gets `to: "/dashboard"` and the label "Visit your Dashboard"; later ones are dropped. CTAs that point anywhere else pass through untouched.',
    signature: 'resolveCtas<T extends CtaLike>(ctas: readonly T[], loggedIn: boolean): T[]',
    tags: ['ui', 'auth'],
    sources: [
      cu('lib/cta.ts', 33, 56, 'export function resolveCtas'),
      cu('lib/cta.ts', 21, 31, 'export function isAuthEntryPath', 'Which paths count as auth entry points'),
    ],
  },
  {
    id: 'cu:lib/nav',
    kind: 'module',
    name: 'nav',
    parent: 'cu.api',
    summary: 'The public navigation links (Home, Checking, Savings, Cards, Loans & CDs, About) shared by the header and footer.',
    detail: 5,
    tags: ['ui'],
    sources: [cu('lib/nav.ts', 1, 31, 'export const PRIMARY_NAV')],
  },
  {
    id: 'cu:lib/cn',
    kind: 'module',
    name: 'cn',
    parent: 'cu.api',
    summary: 'One-line helper that merges conditional class names and de-duplicates conflicting Tailwind utilities.',
    detail: 5,
    tags: ['ui'],
    tech: ['clsx', 'tailwind-merge'],
    sources: [cu('lib/cn.ts', 4, 7, 'export function cn')],
  },
];

const CLIENT_MODULES = ['auth', 'money', 'cards', 'risk', 'schedules', 'lending', 'onboarding', 'invitations'];

const moduleRelations: Relation[] = [
  ...CLIENT_MODULES.map((m) =>
    rel(`cu:lib/${m}`, 'cu:lib/api#API_URL', 'uses-type', {
      label: '`${API_URL}/api/…`',
      summary: 'Every URL this client builds is prefixed with the resolved API base URL.',
      detail: 4,
      sources: [cuFile(`lib/${m}.ts`, "import { API_URL } from './api'")],
    }),
  ),
  rel('cu:lib/auth#jsonInit', 'cu:lib/csrf#csrfHeaders', 'calls', {
    label: '...csrfHeaders()',
    summary: 'Spread first into the headers of every request the client modules build.',
    sources: [cu('lib/auth.ts', 35, 42, '...csrfHeaders()')],
  }),
  rel('cu:lib/api#API_URL', 'sh:public-demo#resolveApiBaseUrl', 'calls', {
    label: 'resolveApiBaseUrl({ explicit, mode, origin, fallback })',
    summary: 'The base URL rule is the shared pure function; this module only supplies the Vite env values and `window.location.origin`.',
    sources: [cu('lib/api.ts', 16, 21, 'resolveApiBaseUrl({')],
  }),
  rel('cu:lib/api#API_URL', 'sh:constants#LOCAL_URLS', 'uses-type', {
    label: 'fallback: LOCAL_URLS.backend',
    detail: 5,
    sources: [cu('lib/api.ts', 16, 21, 'LOCAL_URLS.backend')],
  }),
  rel('cu:lib/useApiStatus#useApiStatus', 'cu:lib/api#fetchStatus', 'calls', {
    label: 'fetchStatus()',
    summary: 'Once per mount; concurrent mounts share the cached promise.',
    sources: [cu('lib/useApiStatus.ts', 14, 22, 'fetchStatus()')],
  }),
  rel('cu:lib/public-demo#usePublicDemo', 'cu:lib/useApiStatus#useApiStatus', 'calls', {
    label: 'useApiStatus()',
    summary: 'Reads `status?.publicDemo`, the backend\'s runtime flag.',
    sources: [cu('lib/public-demo.ts', 14, 18, 'useApiStatus()')],
  }),
  rel('cu:lib/public-demo#PUBLIC_DEMO_BUILD', 'sh:public-demo#parseBooleanFlag', 'calls', {
    label: 'parseBooleanFlag(import.meta.env.VITE_PUBLIC_DEMO)',
    detail: 5,
    sources: [cu('lib/public-demo.ts', 12, 12, 'parseBooleanFlag')],
  }),
  rel('cu:lib/account-display#formatSignedMinor', 'sh:money#formatMinor', 'calls', {
    label: 'formatMinor(Math.abs(minor), currency)',
    detail: 5,
    sources: [cu('lib/account-display.ts', 50, 54, 'formatMinor(Math.abs(minor), currency)')],
  }),
  rel('cu:lib/account-display#savingsApyNote', 'sh:lending#DEFAULT_SAVINGS_APY_BPS', 'uses-type', {
    label: 'formatApy(DEFAULT_SAVINGS_APY_BPS)',
    detail: 5,
    sources: [cu('lib/account-display.ts', 103, 107, 'formatApy(DEFAULT_SAVINGS_APY_BPS)')],
  }),
  rel('cu:lib/account-display#groupAccounts', 'sh:auth#AccountSummary', 'uses-type', {
    label: 'AccountSummary[]',
    detail: 5,
    sources: [cu('lib/account-display.ts', 90, 93, 'AccountSummary[]')],
  }),
];

export const clientEntities: Entity[] = [...moduleEntities, ...fnEntities, ...typeEntities];
export const clientRelations: Relation[] = [...fnRelations, ...moduleRelations];

/** Ids of every exported fetch function, for the hand-off and for cross-checks. */
export const FETCH_FUNCTION_IDS: string[] = FNS.map(fnId);
