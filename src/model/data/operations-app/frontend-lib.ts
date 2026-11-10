import type { Entity, Relation } from '../../types';
import { ops, rel, src } from './helpers';

/**
 * Operations console — `apps/operations/src/lib/*`: the HTTP clients, the
 * Socket.IO hook + live data context, and the operator session.
 */

const HTTP = 'HTTP/1.1 JSON (fetch, credentials: include)';

// ---------------------------------------------------------------------------
// op.api — fetch wrappers
// ---------------------------------------------------------------------------

const apiEntities: Entity[] = [
  {
    id: 'op:lib/api',
    kind: 'module',
    name: 'lib/api.ts',
    parent: 'op.api',
    summary:
      'The console’s base HTTP client: it decides which origin to call, marks every request as coming from the operations console, adds the CSRF header to mutations and turns failures into `ApiError`.',
    description:
      'Everything the operations console sends to the backend goes through this file. `API_URL` and `WS_URL` come from the shared `resolveApiBaseUrl` rule (explicit `VITE_API_URL` / `VITE_WS_URL`, else the page’s own origin in a production build, else `http://localhost:3000`).\n\nThree things are applied uniformly. (1) `credentials: "include"`, so the browser attaches the httpOnly `mer_ops_session` cookie. (2) The surface header `x-meridian-surface: operations`, so the backend reads the OPERATIONS cookie even when the browser omits `Origin` (it does on same-origin GETs) — without it the backend falls back to the customer cookie and answers 401. (3) On POST/PUT/PATCH/DELETE, the `x-meridian-csrf` header echoed from the `mer_csrf` cookie.\n\nThe auth calls (`login`, `logout`, `fetchMe`) and `fetchOpsSummary` call `fetch` directly; every other staff call goes through the generic `apiRequest<T>()`. Any non-2xx is converted by `toApiError` into an `ApiError(status, code, message)`; a 401 whose code is `unauthenticated` or `session_expired` additionally fires the session-invalid listener so the app drops back to the sign-in screen.',
    tech: ['fetch'],
    tags: ['http', 'client', 'security', 'auth'],
    aliases: ['ops api client', 'operations fetch wrapper'],
    sources: [
      ops('lib/api.ts', 11, 31, 'resolveApiBaseUrl', 'API + socket base URL resolution'),
      ops('lib/api.ts', 45, 52, 'SURFACE_HEADERS', 'The operations surface header'),
      ops('lib/api.ts', 142, 164, 'export async function apiRequest', 'Shared JSON request helper'),
    ],
  },
  {
    id: 'op:lib/api#API_URL',
    kind: 'constant',
    name: 'API_URL / WS_URL',
    parent: 'op:lib/api',
    summary: 'The base URLs the console uses for HTTP and for Socket.IO, resolved once when the bundle loads.',
    description:
      '`API_URL = resolveApiBaseUrl({ explicit: VITE_API_URL, mode, origin: window.location.origin, fallback: LOCAL_URLS.backend })`. `WS_URL` uses the same rule with `VITE_WS_URL` and falls back to `API_URL`, so in a production build both are the page’s own origin (`https://banking-ops.cowhill.dev`) and the reverse proxy forwards `/api/*` and `/socket.io/*` to the backend.',
    values: [
      { value: 'API_URL', meaning: 'Prefix for every `fetch` — `http://localhost:3000` in dev, the page origin in a production build, or `VITE_API_URL`.' },
      { value: 'WS_URL', meaning: 'Socket.IO base — `VITE_WS_URL` if set, otherwise `API_URL`.' },
    ],
    tags: ['http', 'config', 'public-demo'],
    sources: [
      ops('lib/api.ts', 11, 31, 'const WS_URL = resolveApiBaseUrl'),
      ops('lib/api.ts', 227, 227, 'export { API_URL, WS_URL }'),
      src('packages/shared/src/public-demo.ts', 161, 180, 'export function resolveApiBaseUrl', 'The shared resolution rule'),
    ],
  },
  {
    id: 'op:lib/api#SURFACE_HEADERS',
    kind: 'constant',
    name: 'SURFACE_HEADERS',
    parent: 'op:lib/api',
    summary: 'The header `x-meridian-surface: operations` that tells the backend which session cookie to read.',
    description:
      'A module-private constant spread into every authenticated request. The backend keeps two independent session cookies (`mer_session` for the customer app, `mer_ops_session` for this console) and picks one per request from this header, falling back to `Origin`. Browsers omit `Origin` on same-origin GETs, so before v0.6.2 the console’s GETs were read against the customer cookie, got 401, and the app bounced to sign-in in a loop.',
    example: { 'x-meridian-surface': 'operations' },
    tags: ['security', 'auth', 'http'],
    aliases: ['surface header', 'x-meridian-surface'],
    sources: [
      ops('lib/api.ts', 45, 52, "[AUTH.surfaceHeader]: 'operations'"),
      src('packages/shared/src/auth.ts', 62, 70, "surfaceHeader: 'x-meridian-surface'", 'Header name + the v0.6.1 login-loop history'),
    ],
  },
  {
    id: 'op:lib/api#ApiError',
    kind: 'class',
    name: 'ApiError',
    parent: 'op:lib/api',
    summary: 'The error every failed backend call throws, carrying the HTTP status and the backend’s machine-readable `code`.',
    description:
      'Pages catch it with `err instanceof ApiError` and show `err.message` (the backend’s `error` text); the sign-in page switches on `err.code` (`invalid_credentials`, `account_locked`, `rate_limited`, …) to pick operator-facing copy.',
    fields: [
      { name: 'status', type: 'number', required: true, description: 'HTTP status of the response.' },
      { name: 'code', type: 'string', required: true, description: 'Body `code`, or `unknown_error` when the body had none.' },
      { name: 'message', type: 'string', required: true, description: 'Body `error`, or `Request failed (<status>).`' },
    ],
    example: { name: 'ApiError', status: 409, code: 'already_resolved', message: 'That request has already been resolved and cannot be actioned again.' },
    tags: ['http', 'client'],
    sources: [ops('lib/api.ts', 88, 103, 'export class ApiError extends Error')],
  },
  {
    id: 'op:lib/api#OpsSummary',
    kind: 'type',
    name: 'OpsSummary',
    parent: 'op:lib/api',
    summary: 'The four counts returned by `GET /api/ops/summary` for the dashboard tiles.',
    description:
      'Declared locally in the console (it mirrors the backend payload rather than importing a shared type). The dashboard renders `users`, `accounts` and `lockedAccounts`; `pendingRequests` is fetched but not displayed — the “Open requests” tile is computed from the live queue instead.',
    fields: [
      { name: 'users', type: 'number', required: true },
      { name: 'accounts', type: 'number', required: true },
      { name: 'pendingRequests', type: 'number', required: true, description: 'Not rendered by the dashboard.' },
      { name: 'lockedAccounts', type: 'number', required: true },
    ],
    example: { users: 4, accounts: 4, pendingRequests: 9, lockedAccounts: 0 },
    tags: ['operations'],
    sources: [ops('lib/api.ts', 77, 86, 'export interface OpsSummary')],
  },
  {
    id: 'op:lib/api#fetchStatus',
    kind: 'function',
    name: 'fetchStatus',
    parent: 'op:lib/api',
    summary: 'Asks the backend for `/status` and returns `null` instead of throwing when the API is unreachable.',
    description:
      'A plain `fetch(`${API_URL}/status`)` — no credentials, no surface header (the endpoint is public). The in-flight promise is cached for 15 seconds (`STATUS_CACHE_MS`) so the header pill and the public-demo notice share one request. Non-OK responses and network errors both resolve to `null`.',
    signature: 'export async function fetchStatus(): Promise<StatusResponse | null>',
    tags: ['http', 'client', 'public-demo'],
    sources: [ops('lib/api.ts', 33, 35, 'STATUS_CACHE_MS'), ops('lib/api.ts', 54, 69, 'export async function fetchStatus')],
  },
  {
    id: 'op:lib/api#setSessionInvalidHandler',
    kind: 'function',
    name: 'setSessionInvalidHandler',
    parent: 'op:lib/api',
    summary: 'Registers the one callback to run when the backend says the operator’s session is gone.',
    description:
      'Stores a single module-level listener (`onSessionInvalid`). `AuthProvider` registers one on mount and clears it on unmount. It is invoked by `toApiError` only for HTTP 401 with code `unauthenticated` or `session_expired` — a failed login is also a 401 but carries `invalid_credentials`, so it does not trigger it.',
    signature: 'export function setSessionInvalidHandler(handler: (() => void) | null): void',
    tags: ['auth', 'security'],
    sources: [ops('lib/api.ts', 114, 129, 'export function setSessionInvalidHandler')],
  },
  {
    id: 'op:lib/api#toApiError',
    kind: 'function',
    name: 'toApiError',
    parent: 'op:lib/api',
    summary: 'Converts a non-OK response into an `ApiError` and notices when the failure means “your session has ended”.',
    description:
      'Module-private. Reads the JSON body defensively (`readJson` returns `{}` for an empty or non-JSON body), takes `code` (default `unknown_error`) and `error` (default `Request failed (<status>).`), and — when the status is 401 and the code is in `SESSION_INVALID_CODES` — calls the registered session-invalid handler before returning the error.',
    signature: 'async function toApiError(res: Response): Promise<ApiError>',
    tags: ['http', 'auth'],
    sources: [ops('lib/api.ts', 128, 140, 'async function toApiError'), ops('lib/api.ts', 105, 112, 'async function readJson')],
  },
  {
    id: 'op:lib/api#apiRequest',
    kind: 'function',
    name: 'apiRequest',
    parent: 'op:lib/api',
    summary: 'The generic JSON request helper every `/api/ops/*`, `/api/admin/*` and clock call goes through.',
    description:
      '`fetch(`${API_URL}${path}`, …)` with `credentials: "include"` and headers merged in this order: the surface header; `csrfHeaders()` only when `init.method` is POST/PUT/PATCH/DELETE; `Content-Type: application/json` only when there is a body; then any caller headers. A non-2xx throws the `ApiError` built by `toApiError`; otherwise the JSON body is returned as `T`.',
    signature: 'export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T>',
    detail: 3,
    tags: ['http', 'client', 'security'],
    sources: [
      ops('lib/api.ts', 142, 164, 'export async function apiRequest<T>'),
      ops('lib/api.ts', 37, 43, 'MUTATING_METHODS', 'Which methods get the CSRF header'),
    ],
  },
  {
    id: 'op:lib/api#login',
    kind: 'function',
    name: 'login',
    parent: 'op:lib/api',
    summary: 'Signs an operator in with email and password; the backend sets the operations session cookie.',
    description:
      '`POST /api/auth/login` with `{ email, password }`, `credentials: "include"`, the surface header (so the backend issues `mer_ops_session`, not the customer cookie) and `csrfHeaders()`. Returns `data.user`. A 200 only proves the credentials are valid — the endpoint authenticates customers too; the caller (`Login`) checks the role and signs a non-staff user straight back out.',
    signature: 'export async function login(email: string, password: string): Promise<SessionUser>',
    tags: ['auth', 'http', 'security'],
    sources: [ops('lib/api.ts', 166, 185, 'export async function login')],
  },
  {
    id: 'op:lib/api#logout',
    kind: 'function',
    name: 'logout',
    parent: 'op:lib/api',
    summary: 'Ends the operator session on the backend; the response is not inspected.',
    description:
      '`POST /api/auth/logout` with `credentials: "include"`, the surface header and the CSRF header. Best-effort: the response status is ignored, and a network failure rejects the promise (the header’s log-out button uses `try/finally`).',
    signature: 'export async function logout(): Promise<void>',
    tags: ['auth', 'http'],
    sources: [ops('lib/api.ts', 187, 194, 'export async function logout')],
  },
  {
    id: 'op:lib/api#fetchMe',
    kind: 'function',
    name: 'fetchMe',
    parent: 'op:lib/api',
    summary: 'Asks the backend who is signed in on the operations surface; `null` means nobody.',
    description:
      '`GET /api/auth/me` with the cookie and the surface header. Any non-OK response (including 401) and any network error resolve to `null` — it never throws and never fires the session-invalid handler, which is what lets the app show the sign-in screen quietly on first load.',
    signature: 'export async function fetchMe(): Promise<SessionUser | null>',
    tags: ['auth', 'http'],
    sources: [ops('lib/api.ts', 196, 212, 'export async function fetchMe')],
  },
  {
    id: 'op:lib/api#fetchOpsSummary',
    kind: 'function',
    name: 'fetchOpsSummary',
    parent: 'op:lib/api',
    summary: 'Loads the platform counts shown on the operations dashboard.',
    description:
      '`GET /api/ops/summary` with the cookie and the surface header (a direct `fetch`, not `apiRequest`). Throws `ApiError` on any non-2xx — 403 `forbidden` for a non-staff session, 401 when the session is gone (which also fires the session-invalid handler).',
    signature: 'export async function fetchOpsSummary(): Promise<OpsSummary>',
    tags: ['http', 'operations'],
    sources: [ops('lib/api.ts', 214, 225, 'export async function fetchOpsSummary')],
  },

  // ---- opsApi ---------------------------------------------------------------
  {
    id: 'op:lib/opsApi',
    kind: 'module',
    name: 'lib/opsApi.ts',
    parent: 'op.api',
    summary: 'Typed client functions for the staff endpoints: the request queue, operator actions, simulated events, reversals, the clock, schedules and lending.',
    description:
      'Ten thin functions, one per endpoint, all built on `apiRequest` — so each carries the operations cookie and surface header, adds the CSRF header when it is a POST, and throws `ApiError` on failure. Request and response shapes are the shared DTO types from `@simbank/shared`; several functions unwrap the response envelope (`res.request`, `res.event`, `res.events`) so callers get the DTO directly.',
    tech: ['fetch'],
    tags: ['http', 'client', 'operations'],
    sources: [
      ops('lib/opsApi.ts', 22, 27, 'Typed client for the v0.5.0 operations endpoints'),
      ops('lib/opsApi.ts', 98, 103, 'Simulation clock (v0.9.0)'),
    ],
  },
  {
    id: 'op:lib/opsApi#fetchOpsRequests',
    kind: 'function',
    name: 'fetchOpsRequests',
    parent: 'op:lib/opsApi',
    summary: 'Loads the request queue together with its per-status counts.',
    description:
      '`GET /api/ops/requests`, optionally with `?status=` and `?type=` built by the private `queryString` helper. The console always calls it with no filter and filters in the browser, so it holds the whole queue.',
    signature: 'export function fetchOpsRequests(query: OperationsQueueQuery = {}): Promise<OperationsQueueResponse>',
    tags: ['http', 'operations'],
    sources: [ops('lib/opsApi.ts', 29, 40, 'export function fetchOpsRequests')],
  },
  {
    id: 'op:lib/opsApi#fetchOpsRequestDetail',
    kind: 'function',
    name: 'fetchOpsRequestDetail',
    parent: 'op:lib/opsApi',
    summary: 'Loads one request with its audit history and linked simulated events.',
    description: '`GET /api/ops/requests/<id>` (the id is `encodeURIComponent`-escaped); returns `res.request`. A missing id surfaces as `ApiError` 404.',
    signature: 'export async function fetchOpsRequestDetail(id: string): Promise<OperationsRequestDetailDTO>',
    tags: ['http', 'operations', 'audit'],
    sources: [ops('lib/opsApi.ts', 42, 48, 'export async function fetchOpsRequestDetail')],
  },
  {
    id: 'op:lib/opsApi#applyOpsAction',
    kind: 'function',
    name: 'applyOpsAction',
    parent: 'op:lib/opsApi',
    summary: 'Sends an operator decision — approve, reject, hold, request info — or a plain note for one request.',
    description:
      '`POST /api/ops/requests/<id>/action` with body `{ action, note }` (type-checked with `satisfies OperatorActionRequest`). `note` is `undefined` for the quick buttons on a queue card and the trimmed text from the detail panel. Returns `res.request`, the updated queue item. Because it is a POST, `apiRequest` adds the CSRF header.',
    signature:
      "export async function applyOpsAction(id: string, action: OperatorActionRequest['action'], note?: string): Promise<OperationsRequestDTO>",
    detail: 3,
    tags: ['http', 'operations', 'audit'],
    sources: [ops('lib/opsApi.ts', 50, 61, 'export async function applyOpsAction')],
  },
  {
    id: 'op:lib/opsApi#simulateEvent',
    kind: 'function',
    name: 'simulateEvent',
    parent: 'op:lib/opsApi',
    summary: 'Asks the backend to record a simulated external event (SMS, email, MFA or identity).',
    description: '`POST /api/ops/simulate/event` with the `SimulateEventRequest` as JSON; returns `res.event`. Nothing is sent to a real provider — the backend stores a `SimulatedEvent` row and broadcasts it.',
    signature: 'export async function simulateEvent(input: SimulateEventRequest): Promise<SimulatedEventDTO>',
    tags: ['http', 'operations', 'integration'],
    sources: [ops('lib/opsApi.ts', 63, 70, 'export async function simulateEvent')],
  },
  {
    id: 'op:lib/opsApi#fetchOpsEvents',
    kind: 'function',
    name: 'fetchOpsEvents',
    parent: 'op:lib/opsApi',
    summary: 'Loads the most recent simulated events, newest first.',
    description: '`GET /api/ops/events?limit=<n>` (default 50); returns `res.events`.',
    signature: 'export async function fetchOpsEvents(limit = 50): Promise<SimulatedEventDTO[]>',
    tags: ['http', 'operations', 'integration'],
    sources: [ops('lib/opsApi.ts', 72, 76, 'export async function fetchOpsEvents')],
  },
  {
    id: 'op:lib/opsApi#reverseMovement',
    kind: 'function',
    name: 'reverseMovement',
    parent: 'op:lib/opsApi',
    summary: 'Reverses a money movement that was already approved and posted, with a mandatory reason.',
    description:
      '`POST /api/ops/movements/<requestId>/reverse` with `{ reason }` (`satisfies ReverseMovementRequest`); returns `res.request`. The backend flips the linked ledger entry to `reversed` and marks the request payload `reversed: true`. Documented failures: 400 `not_a_movement`, 409 `nothing_to_reverse`.',
    signature: 'export async function reverseMovement(requestId: string, reason: string): Promise<OperationsRequestDTO>',
    tags: ['http', 'operations', 'money', 'ledger'],
    sources: [ops('lib/opsApi.ts', 78, 96, 'export async function reverseMovement')],
  },
  {
    id: 'op:lib/opsApi#fetchClock',
    kind: 'function',
    name: 'fetchClock',
    parent: 'op:lib/opsApi',
    summary: 'Reads the current simulated time.',
    description: '`GET /api/clock` — open to any signed-in user; here it is sent on the operations surface. Used once on mount as a fallback until the first socket heartbeat arrives.',
    signature: 'export function fetchClock(): Promise<ClockResponse>',
    tags: ['http', 'time'],
    sources: [ops('lib/opsApi.ts', 105, 108, 'export function fetchClock')],
  },
  {
    id: 'op:lib/opsApi#advanceClock',
    kind: 'function',
    name: 'advanceClock',
    parent: 'op:lib/opsApi',
    summary: 'Steps the simulation clock forward and returns what that advance caused.',
    description:
      '`POST /api/ops/clock/advance` with `{ days?, hours?, minutes? }`. The response carries the new `clock`, a `fired` summary per schedule that ran, and (since v1.0.0) the `accrued` interest summary. The page validates with the shared `validateAdvance` first; the server validates again.',
    signature: 'export function advanceClock(body: AdvanceClockRequest): Promise<AdvanceClockResponse>',
    detail: 3,
    tags: ['http', 'time', 'operations'],
    sources: [ops('lib/opsApi.ts', 110, 121, 'export function advanceClock')],
  },
  {
    id: 'op:lib/opsApi#fetchSchedules',
    kind: 'function',
    name: 'fetchSchedules',
    parent: 'op:lib/opsApi',
    summary: 'Lists every customer’s scheduled and recurring payments for the clock page.',
    description: '`GET /api/ops/schedules` → `{ schedules: ScheduleDTO[] }` (staff only).',
    signature: 'export function fetchSchedules(): Promise<{ schedules: ScheduleDTO[] }>',
    tags: ['http', 'time', 'operations'],
    sources: [ops('lib/opsApi.ts', 123, 126, 'export function fetchSchedules')],
  },
  {
    id: 'op:lib/opsApi#fetchLending',
    kind: 'function',
    name: 'fetchLending',
    parent: 'op:lib/opsApi',
    summary: 'Lists every customer’s CDs and loans — read-only for operators.',
    description: '`GET /api/ops/lending` → `LendingListResponse` (`{ products }`). There is no operator endpoint that opens or changes a lending product.',
    signature: 'export function fetchLending(): Promise<LendingListResponse>',
    tags: ['http', 'lending', 'operations'],
    sources: [ops('lib/opsApi.ts', 128, 137, 'export function fetchLending')],
  },

  // ---- adminApi -------------------------------------------------------------
  {
    id: 'op:lib/adminApi',
    kind: 'module',
    name: 'lib/adminApi.ts',
    parent: 'op.api',
    summary: 'The admin-only client: one function that creates a demo user.',
    description:
      'Contains only `createAdminUser`. The backend also registers `GET /api/admin/users` (the user roster), but no client code in this app calls it — the console’s admin page is a create form, not a list.',
    tags: ['http', 'client', 'rbac'],
    sources: [ops('lib/adminApi.ts', 4, 10, 'Typed client for the admin-only provisioning endpoints')],
  },
  {
    id: 'op:lib/adminApi#createAdminUser',
    kind: 'function',
    name: 'createAdminUser',
    parent: 'op:lib/adminApi',
    summary: 'Creates a simulated user and, optionally, an account with an opening deposit.',
    description:
      '`POST /api/admin/users` through `apiRequest` (cookie, surface header, CSRF header). Resolves with the created user, any opened account and the non-secret demo password to hand over. A duplicate email comes back as `ApiError` 409; a non-admin operator gets 403 from the backend’s role guard.',
    signature: 'export function createAdminUser(input: AdminCreateUserRequest): Promise<AdminCreateUserResponse>',
    tags: ['http', 'rbac', 'operations', 'onboarding'],
    sources: [ops('lib/adminApi.ts', 12, 22, 'export function createAdminUser')],
  },
];

// ---------------------------------------------------------------------------
// op.live — socket + live data
// ---------------------------------------------------------------------------

const liveEntities: Entity[] = [
  {
    id: 'op:lib/useOpsSocket',
    kind: 'module',
    name: 'lib/useOpsSocket.ts',
    parent: 'op.live',
    summary: 'The React hook that opens the console’s single Socket.IO connection and forwards operations events to the app.',
    description:
      'The client half of the live queue. It connects to `WS_URL` at path `/socket.io` with `withCredentials: true` (so the `mer_ops_session` cookie travels with the handshake) and `extraHeaders: { "x-meridian-surface": "operations" }`. `extraHeaders` only applies to the HTTP long-polling handshake, which is exactly where the backend decides whether to join the socket to the operators room.\n\nIt listens for three server events — `ops:request_changed`, `ops:external_event` and `sim:heartbeat` — plus the built-in `connect` / `disconnect`. It does not listen for `sim:welcome` (the server still sends it). The client never emits anything: all operator actions are HTTP calls.',
    tech: ['socket.io-client 4'],
    tags: ['realtime', 'socket', 'operations'],
    aliases: ['ops socket', 'websocket client', 'live updates'],
    sources: [
      ops('lib/useOpsSocket.ts', 23, 30, 'Subscribe to the operations real-time channel'),
      ops('lib/useOpsSocket.ts', 36, 47, 'extraHeaders', 'Connection options'),
    ],
  },
  {
    id: 'op:lib/useOpsSocket#OpsSocketHandlers',
    kind: 'type',
    name: 'OpsSocketHandlers',
    parent: 'op:lib/useOpsSocket',
    summary: 'The three optional callbacks a caller passes to receive pushed events.',
    fields: [
      { name: 'onRequestChanged', type: '(payload: OpsRequestChangedPayload) => void', description: 'A request was created or updated (`ops:request_changed`).', typeRef: 'sh:operations#OpsRequestChangedPayload' },
      { name: 'onExternalEvent', type: '(payload: OpsExternalEventPayload) => void', description: 'A simulated external event was recorded (`ops:external_event`).', typeRef: 'sh:operations#OpsExternalEventPayload' },
      { name: 'onHeartbeat', type: '(payload: SimHeartbeatPayload) => void', description: 'The 10-second heartbeat with `serverTime` and the optional `simulationTime` (`sim:heartbeat`).', typeRef: 'sh:clock#SimHeartbeatPayload' },
    ],
    tags: ['realtime'],
    sources: [ops('lib/useOpsSocket.ts', 12, 21, 'export interface OpsSocketHandlers')],
  },
  {
    id: 'op:lib/useOpsSocket#useOpsSocket',
    kind: 'function',
    name: 'useOpsSocket',
    parent: 'op:lib/useOpsSocket',
    summary: 'Opens one socket for the lifetime of the component and returns whether it is currently connected.',
    description:
      'The effect has an empty dependency list, so exactly one `io(...)` connection is created on mount and `socket.disconnect()` runs on unmount. The handlers live in a ref that is reassigned on every render, so callers can pass fresh closures without tearing the connection down. `connected` flips on the socket’s `connect` / `disconnect` events and drives the “Live / Reconnecting…” pill; reconnection itself is socket.io-client’s default behaviour.',
    signature: 'export function useOpsSocket(handlers: OpsSocketHandlers): { connected: boolean }',
    detail: 3,
    tags: ['realtime', 'socket'],
    sources: [
      ops('lib/useOpsSocket.ts', 31, 67, 'export function useOpsSocket'),
      ops('lib/useOpsSocket.ts', 49, 59, 'SOCKET_EVENTS.opsRequestChanged', 'The event subscriptions'),
    ],
  },
  {
    id: 'op:lib/OpsDataContext',
    kind: 'module',
    name: 'lib/OpsDataContext.tsx',
    parent: 'op.live',
    summary: 'The provider that holds the live request queue, the simulated-event feed and the simulated time for every console page.',
    description:
      'One `OpsDataProvider` is mounted inside the staff gate, above the layout and all routes, so the dashboard, the queues page, the messaging page and the clock page all read the same in-memory state and only one socket is ever open.\n\nState: `requests` (the whole queue), `events` (newest first, capped at 100), `simulationTime`, `loading`, `error`, plus `connected` from the socket hook. `counts` is derived with the shared `countRequestsByStatus(requests)`.\n\nThree things feed that state: the initial `refresh()` (two GETs in parallel), the operator’s own actions (`act`, `reverse`, `simulate` write the HTTP response into state immediately), and pushed socket events. Because writes are keyed by id — `upsertRequest` replaces in place, `prependEvent` ignores an id it already has — the socket echo of the operator’s own action is harmless, and another operator’s action lands the same way.',
    tech: ['React context'],
    tags: ['realtime', 'state', 'operations'],
    aliases: ['ops data provider', 'live queue state'],
    sources: [
      ops('lib/OpsDataContext.tsx', 23, 29, 'Owns the live operations data'),
      ops('lib/OpsDataContext.tsx', 96, 102, 'useOpsSocket', 'Socket events wired into state'),
    ],
  },
  {
    id: 'op:lib/OpsDataContext#OpsDataProvider',
    kind: 'function',
    name: 'OpsDataProvider',
    parent: 'op:lib/OpsDataContext',
    summary: 'The component that loads the queue once, subscribes to the socket and publishes the result through React context.',
    description:
      'On mount it runs `refresh()` and, separately, a best-effort `fetchClock()` so the simulated date is known before the first heartbeat (a failure there is swallowed). It calls `useOpsSocket` with `onRequestChanged → upsertRequest(request)`, `onExternalEvent → prependEvent(event)` and `onHeartbeat → setSimulationTime(t)` when the heartbeat carries a time. The memoised context value exposes the state plus `refresh`, `act`, `reverse` and `simulate`.',
    signature: 'export function OpsDataProvider({ children }: { children: ReactNode })',
    detail: 3,
    tags: ['realtime', 'state'],
    sources: [
      ops('lib/OpsDataContext.tsx', 30, 39, 'export function OpsDataProvider'),
      ops('lib/OpsDataContext.tsx', 79, 102, 'onHeartbeat', 'Clock seed + socket wiring'),
      ops('lib/OpsDataContext.tsx', 131, 148, 'OpsDataContext.Provider'),
    ],
  },
  {
    id: 'op:lib/OpsDataContext#upsertRequest',
    kind: 'function',
    name: 'upsertRequest',
    parent: 'op:lib/OpsDataContext',
    summary: 'Merges one request into the queue: replace it if the id is known, otherwise put it at the top.',
    description:
      'The single write path for queue items. `findIndex` by `request.id`; `-1` → `[request, ...prev]` (a new request appears first); otherwise a copied array with that slot replaced, so the item keeps its position. It is called with the HTTP response of the operator’s own action and again with the `ops:request_changed` push for the same change — the second call is an in-place replace with identical data.',
    signature: 'const upsertRequest = useCallback((request: OperationsRequestDTO) => { … }, [])',
    detail: 3,
    tags: ['realtime', 'state'],
    sources: [ops('lib/OpsDataContext.tsx', 41, 49, 'const upsertRequest')],
  },
  {
    id: 'op:lib/OpsDataContext#prependEvent',
    kind: 'function',
    name: 'prependEvent',
    parent: 'op:lib/OpsDataContext',
    summary: 'Adds a simulated event to the top of the feed unless it is already there, keeping at most 100.',
    description: 'If an event with the same id exists the previous array is returned unchanged (this de-duplicates the socket echo of an event the operator just created); otherwise `[event, ...prev].slice(0, MAX_EVENTS)` with `MAX_EVENTS = 100`.',
    signature: 'const prependEvent = useCallback((event: SimulatedEventDTO) => { … }, [])',
    tags: ['realtime', 'state'],
    sources: [ops('lib/OpsDataContext.tsx', 51, 56, 'const prependEvent'), ops('lib/OpsDataContext.tsx', 21, 21, 'MAX_EVENTS = 100')],
  },
  {
    id: 'op:lib/OpsDataContext#refresh',
    kind: 'function',
    name: 'refresh',
    parent: 'op:lib/OpsDataContext',
    summary: 'Re-reads the whole queue and the event feed from the backend and replaces local state with them.',
    description:
      '`Promise.all([fetchOpsRequests(), fetchOpsEvents()])`, then `setRequests(queue.requests)` and `setEvents(feed)`. On failure it stores a readable `error` (the `ApiError` message, or “Could not load operations data — is the simulated backend running?”). Runs once on mount, and the clock page calls it after an advance so bill-pay reviews queued by fired schedules show up.',
    signature: 'const refresh = useCallback(async () => { … }, [])',
    tags: ['state', 'http'],
    sources: [ops('lib/OpsDataContext.tsx', 58, 77, 'const refresh')],
  },
  {
    id: 'op:lib/OpsDataContext#act',
    kind: 'function',
    name: 'act',
    parent: 'op:lib/OpsDataContext',
    summary: 'Applies an operator action over HTTP and writes the updated request into the live queue.',
    description: '`applyOpsAction(id, action, note)` → `upsertRequest(updated)` → return it. A rejected call (`ApiError`) propagates to the caller untouched and leaves state as it was — there is no optimistic update to undo.',
    signature: 'act: (id: string, action: OpsAction, note?: string) => Promise<OperationsRequestDTO>',
    detail: 3,
    tags: ['operations', 'state'],
    sources: [ops('lib/OpsDataContext.tsx', 104, 111, 'const act')],
  },
  {
    id: 'op:lib/OpsDataContext#reverse',
    kind: 'function',
    name: 'reverse',
    parent: 'op:lib/OpsDataContext',
    summary: 'Reverses a posted movement over HTTP and writes the updated request into the live queue.',
    description: '`reverseMovement(id, reason)` → `upsertRequest(updated)`. The request stays `approved`; what changes is `payload.reversed`, which the badges read.',
    signature: 'reverse: (id: string, reason: string) => Promise<OperationsRequestDTO>',
    tags: ['operations', 'money', 'state'],
    sources: [ops('lib/OpsDataContext.tsx', 113, 120, 'const reverse')],
  },
  {
    id: 'op:lib/OpsDataContext#simulate',
    kind: 'function',
    name: 'simulate',
    parent: 'op:lib/OpsDataContext',
    summary: 'Creates a simulated external event over HTTP and puts it at the top of the feed.',
    description: '`simulateEvent(input)` → `prependEvent(event)`. The matching `ops:external_event` push is dropped by the id check in `prependEvent`.',
    signature: 'simulate: (input: SimulateEventRequest) => Promise<SimulatedEventDTO>',
    tags: ['operations', 'integration', 'state'],
    sources: [ops('lib/OpsDataContext.tsx', 122, 129, 'const simulate')],
  },
  {
    id: 'op:lib/ops-data-context',
    kind: 'module',
    name: 'lib/ops-data-context.ts',
    parent: 'op.live',
    summary: 'Declares the shape of the live operations data and the `useOpsData()` hook pages read it with.',
    description: 'Split from the provider component so React Fast Refresh keeps working (a file that exports a component should export nothing else).',
    tags: ['state', 'realtime'],
    sources: [ops('lib/ops-data-context.ts', 10, 16, 'Live operations data shared across the console')],
  },
  {
    id: 'op:lib/ops-data-context#OpsDataValue',
    kind: 'type',
    name: 'OpsDataValue',
    parent: 'op:lib/ops-data-context',
    summary: 'Everything a console page can read or do through the live data context.',
    fields: [
      { name: 'requests', type: 'OperationsRequestDTO[]', required: true, description: 'The whole queue; pages filter it client-side.', typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'counts', type: 'OpsStatusCounts', required: true, description: 'Per-status counts derived from `requests`.' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, description: 'Recent simulated events, newest first (max 100).', typeRef: 'sh:operations#SimulatedEventDTO' },
      { name: 'loading', type: 'boolean', required: true, description: 'True until the initial load resolves.' },
      { name: 'error', type: 'string | null', required: true, description: 'Message when the initial load failed.' },
      { name: 'connected', type: 'boolean', required: true, description: 'Socket.IO connection state.' },
      { name: 'simulationTime', type: 'string | null', required: true, description: 'Simulated “now” (ISO), from the heartbeat or the one-shot `GET /api/clock`.' },
      { name: 'refresh', type: '() => Promise<void>', required: true },
      { name: 'act', type: '(id: string, action: OpsAction, note?: string) => Promise<OperationsRequestDTO>', required: true },
      { name: 'reverse', type: '(id: string, reason: string) => Promise<OperationsRequestDTO>', required: true },
      { name: 'simulate', type: '(input: SimulateEventRequest) => Promise<SimulatedEventDTO>', required: true },
    ],
    tags: ['state', 'realtime'],
    sources: [ops('lib/ops-data-context.ts', 17, 48, 'export interface OpsDataValue')],
  },
  {
    id: 'op:lib/ops-data-context#useOpsData',
    kind: 'function',
    name: 'useOpsData',
    parent: 'op:lib/ops-data-context',
    summary: 'Hook that returns the live operations data, or throws if used outside the provider.',
    signature: 'export function useOpsData(): OpsDataValue',
    tags: ['state'],
    sources: [ops('lib/ops-data-context.ts', 50, 59, 'export function useOpsData')],
  },
  {
    id: 'op:lib/useOpsSummary',
    kind: 'module',
    name: 'lib/useOpsSummary.ts',
    parent: 'op.live',
    summary: 'A hook that fetches the dashboard counts once when the dashboard mounts.',
    description:
      'Calls `fetchOpsSummary()` once (no polling, no socket) and returns `{ loading, summary, error }`. Unlike the queue these counts do not update live; they refresh when the dashboard is opened again.',
    signature: 'export function useOpsSummary(): OpsSummaryState',
    tags: ['state', 'operations'],
    sources: [ops('lib/useOpsSummary.ts', 11, 42, 'export function useOpsSummary')],
  },
  {
    id: 'op:lib/useApiStatus',
    kind: 'module',
    name: 'lib/useApiStatus.ts',
    parent: 'op.live',
    summary: 'A hook that reads the backend’s `/status` once on mount.',
    description: 'Wraps `fetchStatus()` (which caches for 15 s) and returns `{ loading, status }`. Used by the header’s “API online · v…” pill and by the public-demo check.',
    signature: 'export function useApiStatus(): ApiStatusState',
    tags: ['state', 'public-demo'],
    sources: [ops('lib/useApiStatus.ts', 10, 25, 'export function useApiStatus')],
  },
];

// ---------------------------------------------------------------------------
// op.session — operator sign-in state
// ---------------------------------------------------------------------------

const sessionEntities: Entity[] = [
  {
    id: 'op:lib/AuthContext',
    kind: 'module',
    name: 'lib/AuthContext.tsx',
    parent: 'op.session',
    summary: 'The provider that knows who is signed in to the console and exposes `login` and `logout`.',
    description:
      'Wraps the whole app. It holds three pieces of state: `user` (a `SessionUser` or `null`), `loading` (true until the first `GET /api/auth/me` answers) and `sessionEnded` (true when the backend rejected the session mid-use rather than the operator logging out).\n\nThe session itself is the httpOnly `mer_ops_session` cookie — the app never sees the token. This provider only mirrors what the backend says.',
    tech: ['React context'],
    tags: ['auth', 'security', 'state'],
    aliases: ['auth provider', 'operator session'],
    sources: [ops('lib/AuthContext.tsx', 6, 17, 'export function AuthProvider')],
  },
  {
    id: 'op:lib/AuthContext#AuthProvider',
    kind: 'function',
    name: 'AuthProvider',
    parent: 'op:lib/AuthContext',
    summary: 'Restores the session on load, signs the operator out in the UI when the backend rejects the session, and wraps the login/logout calls.',
    description:
      'Mount effect 1: `fetchMe()` → `setUser(me)`, `setLoading(false)`.\nMount effect 2: `setSessionInvalidHandler(() => { setUser(null); setSessionEnded(true); })`, removed on unmount — so any staff call that comes back 401 `unauthenticated` / `session_expired` returns the app to the sign-in screen with an explanation.\n`login` calls the API client, stores the returned user and clears `sessionEnded`; `logout` calls the API client then clears the user; `refresh` re-runs `fetchMe()`.',
    signature: 'export function AuthProvider({ children }: { children: ReactNode })',
    detail: 3,
    tags: ['auth', 'security'],
    sources: [
      ops('lib/AuthContext.tsx', 14, 31, 'fetchMe()', 'Session restore on mount'),
      ops('lib/AuthContext.tsx', 33, 44, 'setSessionInvalidHandler', 'Session-ended handling (B-04)'),
      ops('lib/AuthContext.tsx', 46, 62, 'const login = useCallback'),
    ],
  },
  {
    id: 'op:lib/auth-context',
    kind: 'module',
    name: 'lib/auth-context.ts',
    parent: 'op.session',
    summary: 'The auth context object, the `useAuth()` hook and the rule for which roles may use the console.',
    tags: ['auth', 'rbac'],
    sources: [ops('lib/auth-context.ts', 4, 15, 'OPERATOR_ROLES')],
  },
  {
    id: 'op:lib/auth-context#isOperatorRole',
    kind: 'function',
    name: 'isOperatorRole',
    parent: 'op:lib/auth-context',
    summary: 'True only for the two staff roles, `ops_agent` and `admin`.',
    description:
      'Checks membership of the private `OPERATOR_ROLES = ["ops_agent", "admin"]`. This is the console’s client-side admission rule: the app gate and the sign-in page both call it. It is a convenience, not the security boundary — every `/api/ops/*` endpoint enforces the same roles on the server.',
    signature: 'export function isOperatorRole(role: UserRole | undefined): boolean',
    values: [
      { value: 'ops_agent', meaning: 'Admitted.' },
      { value: 'admin', meaning: 'Admitted; additionally sees the “Create demo user” page.' },
      { value: 'customer / joint_customer', meaning: 'Not admitted — shown the operator sign-in screen.' },
    ],
    detail: 3,
    tags: ['rbac', 'security'],
    sources: [ops('lib/auth-context.ts', 4, 15, 'export function isOperatorRole')],
  },
  {
    id: 'op:lib/auth-context#AuthContextValue',
    kind: 'type',
    name: 'AuthContextValue',
    parent: 'op:lib/auth-context',
    summary: 'What `useAuth()` returns: the current user, loading and session-ended flags, and the login/logout/refresh functions.',
    fields: [
      { name: 'user', type: 'SessionUser | null', required: true, typeRef: 'sh:auth#SessionUser' },
      { name: 'loading', type: 'boolean', required: true, description: 'True until the initial `GET /api/auth/me` resolves.' },
      { name: 'sessionEnded', type: 'boolean', required: true, description: 'True after the backend rejected the session mid-use; cleared by the next login or logout.' },
      { name: 'login', type: '(email: string, password: string) => Promise<SessionUser>', required: true },
      { name: 'logout', type: '() => Promise<void>', required: true },
      { name: 'refresh', type: '() => Promise<void>', required: true },
    ],
    tags: ['auth'],
    sources: [ops('lib/auth-context.ts', 17, 39, 'export interface AuthContextValue')],
  },
  {
    id: 'op:lib/auth-context#useAuth',
    kind: 'function',
    name: 'useAuth',
    parent: 'op:lib/auth-context',
    summary: 'Hook that returns the auth context, or throws if used outside `AuthProvider`.',
    signature: 'export function useAuth(): AuthContextValue',
    tags: ['auth'],
    sources: [ops('lib/auth-context.ts', 41, 50, 'export function useAuth')],
  },
  {
    id: 'op:lib/csrf',
    kind: 'module',
    name: 'lib/csrf.ts',
    parent: 'op.session',
    summary: 'Reads the CSRF token cookie so it can be echoed back as a request header.',
    description:
      'The client half of the double-submit CSRF check. The backend sets a NON-httpOnly cookie `mer_csrf` on safe GETs and on login; this module reads it from `document.cookie` and returns it as the `x-meridian-csrf` header. The backend rejects an authenticated state-changing request whose header does not match the cookie with 403.',
    tags: ['security', 'auth'],
    aliases: ['double submit', 'x-meridian-csrf'],
    sources: [ops('lib/csrf.ts', 3, 11, 'CSRF double-submit helper')],
  },
  {
    id: 'op:lib/csrf#csrfHeaders',
    kind: 'function',
    name: 'csrfHeaders',
    parent: 'op:lib/csrf',
    summary: 'Returns `{ "x-meridian-csrf": <token> }` when the CSRF cookie exists, otherwise an empty object.',
    description:
      'Returns `{}` when there is no `document` or no `mer_csrf` cookie yet (for example before the first GET has seeded it). The private `readCookie` splits `document.cookie` on `;`, trims, matches the `name=` prefix and URL-decodes the value.',
    signature: 'export function csrfHeaders(): Record<string, string>',
    example: { 'x-meridian-csrf': '3f9c…e1' },
    tags: ['security'],
    sources: [ops('lib/csrf.ts', 13, 34, 'export function csrfHeaders')],
  },
];

// ---------------------------------------------------------------------------
// Small utilities (op.ui)
// ---------------------------------------------------------------------------

const utilEntities: Entity[] = [
  {
    id: 'op:lib/format',
    kind: 'module',
    name: 'lib/format.ts',
    parent: 'op.ui',
    summary: 'Formats a timestamp as a short relative label such as “6m ago”.',
    description: '`relativeTime(iso, now = Date.now())` → `just now` / `Nm ago` / `Nh ago` / `Nd ago`; an unparseable date gives an empty string. It compares against the browser’s wall clock, not the simulation clock.',
    signature: 'export function relativeTime(iso: string, now: number = Date.now()): string',
    detail: 5,
    tags: ['ui'],
    sources: [ops('lib/format.ts', 1, 16, 'export function relativeTime')],
  },
  {
    id: 'op:lib/cn',
    kind: 'module',
    name: 'lib/cn.ts',
    parent: 'op.ui',
    summary: 'Joins conditional CSS class names and resolves conflicting Tailwind utilities.',
    signature: 'export function cn(...inputs: ClassValue[]): string',
    detail: 5,
    tech: ['clsx', 'tailwind-merge'],
    tags: ['ui'],
    sources: [ops('lib/cn.ts', 4, 7, 'export function cn')],
  },
  {
    id: 'op:lib/public-demo',
    kind: 'module',
    name: 'lib/public-demo.ts',
    parent: 'op.ui',
    summary: 'Decides whether the console should show the shared-public-demo warning.',
    description:
      'Two signals, either is enough: the build-time flag `VITE_PUBLIC_DEMO` (parsed with the shared `parseBooleanFlag` into `PUBLIC_DEMO_BUILD`, true from the first paint) and the backend’s `/status → publicDemo` at runtime (`usePublicDemo()` reads it through `useApiStatus`). Neither is set in local development.',
    signature: 'export function usePublicDemo(): boolean',
    tags: ['public-demo', 'ui'],
    sources: [ops('lib/public-demo.ts', 4, 16, 'export function usePublicDemo')],
  },
];

export const libEntities: Entity[] = [...apiEntities, ...liveEntities, ...sessionEntities, ...utilEntities];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const viaApiRequest = (fn: string, line: number, endLine: number, symbol: string, label: string): Relation =>
  rel(`op:lib/opsApi#${fn}`, 'op:lib/api#apiRequest', 'calls', {
    label,
    sources: [ops('lib/opsApi.ts', line, endLine, symbol)],
    detail: 5,
  });

export const libRelations: Relation[] = [
  // ---- HTTP: client function → endpoint -------------------------------------
  rel('op:lib/api#fetchStatus', 'ep:GET /status', 'http', {
    label: 'GET /status',
    summary: 'Unauthenticated status probe; resolves to null on any failure.',
    description: 'No cookie, no surface header, no CSRF. Result cached for 15 s per page load.',
    protocol: 'HTTP/1.1 JSON (fetch)',
    data: ['sh:types#StatusResponse'],
    sources: [ops('lib/api.ts', 54, 69, '/status')],
  }),
  rel('op:lib/api#login', 'ep:POST /api/auth/login', 'http', {
    label: 'POST /api/auth/login',
    summary: 'Operator sign-in on the operations surface.',
    description:
      'Headers: `Content-Type: application/json`, `x-meridian-surface: operations`, and `x-meridian-csrf` when the cookie already exists. `credentials: "include"` so the `Set-Cookie: mer_ops_session` is stored. Errors become `ApiError` with the backend code: 400 `invalid_request`, 401 `invalid_credentials`, 403 `account_disabled`, 423 `account_locked`, 429 `rate_limited`.',
    protocol: HTTP,
    data: ['sh:auth#AuthResponse', 'sh:auth#SessionUser'],
    sources: [ops('lib/api.ts', 175, 185, '/api/auth/login')],
  }),
  rel('op:lib/api#logout', 'ep:POST /api/auth/logout', 'http', {
    label: 'POST /api/auth/logout',
    summary: 'Revokes the operations session and clears its cookie.',
    description: 'Headers: surface header + CSRF header; `credentials: "include"`. The response is ignored.',
    protocol: HTTP,
    sources: [ops('lib/api.ts', 187, 194, '/api/auth/logout')],
  }),
  rel('op:lib/api#fetchMe', 'ep:GET /api/auth/me', 'http', {
    label: 'GET /api/auth/me',
    summary: 'Session restore on page load.',
    description: 'Headers: surface header; `credentials: "include"`. 401 and network errors both map to `null` (no error thrown).',
    protocol: HTTP,
    data: ['sh:auth#AuthResponse'],
    sources: [ops('lib/api.ts', 200, 212, '/api/auth/me')],
  }),
  rel('op:lib/api#fetchOpsSummary', 'ep:GET /api/ops/summary', 'http', {
    label: 'GET /api/ops/summary',
    summary: 'Dashboard counts (staff only).',
    description: 'Headers: surface header; `credentials: "include"`. Non-2xx → `ApiError` (403 `forbidden` for a non-staff session).',
    protocol: HTTP,
    sources: [ops('lib/api.ts', 218, 225, '/api/ops/summary')],
  }),
  rel('op:lib/opsApi#fetchOpsRequests', 'ep:GET /api/ops/requests', 'http', {
    label: 'GET /api/ops/requests',
    summary: 'The whole queue plus status counts.',
    description: 'Via `apiRequest`: cookie + surface header, no CSRF (GET). Optional `status` / `type` query parameters; the console sends none.',
    protocol: HTTP,
    data: ['sh:operations#OperationsQueueResponse'],
    sources: [ops('lib/opsApi.ts', 37, 40, '/api/ops/requests')],
  }),
  rel('op:lib/opsApi#fetchOpsRequestDetail', 'ep:GET /api/ops/requests/:id', 'http', {
    label: 'GET /api/ops/requests/:id',
    summary: 'One request with history and linked events.',
    protocol: HTTP,
    data: ['sh:operations#OperationsRequestDetailDTO'],
    sources: [ops('lib/opsApi.ts', 42, 48, '/api/ops/requests/${encodeURIComponent(id)}')],
  }),
  rel('op:lib/opsApi#applyOpsAction', 'ep:POST /api/ops/requests/:id/action', 'http', {
    label: 'POST /api/ops/requests/:id/action',
    summary: 'Approve, reject, hold, request info, or add a note.',
    description:
      'Body `{ action, note? }`. Via `apiRequest`: cookie, surface header, `x-meridian-csrf`, `Content-Type: application/json`. The backend’s error (for example 409 when the request is already resolved, 400 for an invalid action) reaches the page as `ApiError.message`.',
    protocol: HTTP,
    data: ['sh:operations#OperatorActionRequest', 'sh:operations#OperationsRequestDTO'],
    sources: [ops('lib/opsApi.ts', 50, 61, '/action')],
  }),
  rel('op:lib/opsApi#simulateEvent', 'ep:POST /api/ops/simulate/event', 'http', {
    label: 'POST /api/ops/simulate/event',
    summary: 'Record a simulated SMS / email / MFA / identity event.',
    description: 'Body = `SimulateEventRequest`. Via `apiRequest`: cookie, surface header, CSRF header.',
    protocol: HTTP,
    data: ['sh:operations#SimulateEventRequest', 'sh:operations#SimulatedEventDTO'],
    sources: [ops('lib/opsApi.ts', 63, 70, '/api/ops/simulate/event')],
  }),
  rel('op:lib/opsApi#fetchOpsEvents', 'ep:GET /api/ops/events', 'http', {
    label: 'GET /api/ops/events?limit=50',
    summary: 'Recent simulated events, newest first.',
    protocol: HTTP,
    data: ['sh:operations#SimulatedEventDTO'],
    sources: [ops('lib/opsApi.ts', 72, 76, '/api/ops/events?limit=')],
  }),
  rel('op:lib/opsApi#reverseMovement', 'ep:POST /api/ops/movements/:requestId/reverse', 'http', {
    label: 'POST /api/ops/movements/:requestId/reverse',
    summary: 'Reverse an approved, posted money movement.',
    description: 'Body `{ reason }`. Via `apiRequest`: cookie, surface header, CSRF header. 400 `not_a_movement` and 409 `nothing_to_reverse` surface as `ApiError`.',
    protocol: HTTP,
    data: ['sh:money-movement#ReverseMovementRequest', 'sh:operations#OperationsRequestDTO'],
    sources: [ops('lib/opsApi.ts', 87, 96, '/reverse')],
  }),
  rel('op:lib/opsApi#fetchClock', 'ep:GET /api/clock', 'http', {
    label: 'GET /api/clock',
    summary: 'Current simulated time (any signed-in user).',
    protocol: HTTP,
    data: ['sh:clock#ClockResponse'],
    sources: [ops('lib/opsApi.ts', 105, 108, "'/api/clock'")],
  }),
  rel('op:lib/opsApi#advanceClock', 'ep:POST /api/ops/clock/advance', 'http', {
    label: 'POST /api/ops/clock/advance',
    summary: 'Move simulated time forward; fires due schedules and accrues interest.',
    description: 'Body `{ days?, hours?, minutes? }`. Via `apiRequest`: cookie, surface header, CSRF header. A non-forward or over-one-year advance is a 400 `ApiError`.',
    protocol: HTTP,
    data: ['sh:clock#AdvanceClockRequest', 'sh:schedules#AdvanceClockResponse'],
    sources: [ops('lib/opsApi.ts', 116, 121, "'/api/ops/clock/advance'")],
  }),
  rel('op:lib/opsApi#fetchSchedules', 'ep:GET /api/ops/schedules', 'http', {
    label: 'GET /api/ops/schedules',
    summary: 'Every customer’s payment schedules.',
    protocol: HTTP,
    data: ['sh:schedules#ScheduleDTO'],
    sources: [ops('lib/opsApi.ts', 123, 126, "'/api/ops/schedules'")],
  }),
  rel('op:lib/opsApi#fetchLending', 'ep:GET /api/ops/lending', 'http', {
    label: 'GET /api/ops/lending',
    summary: 'Every customer’s CDs and loans (read-only).',
    protocol: HTTP,
    data: ['sh:lending#LendingListResponse'],
    sources: [ops('lib/opsApi.ts', 134, 137, "'/api/ops/lending'")],
  }),
  rel('op:lib/adminApi#createAdminUser', 'ep:POST /api/admin/users', 'http', {
    label: 'POST /api/admin/users',
    summary: 'Provision a demo user (admin role only).',
    description: 'Body = `AdminCreateUserRequest`. Via `apiRequest`: cookie, surface header, CSRF header. 409 → “A user with that email already exists.” on the page; 403 for a non-admin.',
    protocol: HTTP,
    data: ['sh:onboarding#AdminCreateUserRequest', 'sh:onboarding#AdminCreateUserResponse'],
    sources: [ops('lib/adminApi.ts', 17, 22, "'/api/admin/users'")],
  }),

  // ---- Calls inside the client layer ---------------------------------------
  viaApiRequest('fetchOpsRequests', 37, 40, 'apiRequest<OperationsQueueResponse>', 'apiRequest(`/api/ops/requests${queryString(query)}`)'),
  viaApiRequest('fetchOpsRequestDetail', 43, 48, 'apiRequest<OperationsRequestDetailResponse>', 'apiRequest(`/api/ops/requests/${id}`)'),
  viaApiRequest('applyOpsAction', 51, 61, 'apiRequest<OperatorActionResponse>', "apiRequest(…, { method: 'POST', body })"),
  viaApiRequest('simulateEvent', 64, 70, 'apiRequest<SimulateEventResponse>', "apiRequest('/api/ops/simulate/event', { method: 'POST', body })"),
  viaApiRequest('fetchOpsEvents', 73, 76, 'apiRequest<SimulatedEventsResponse>', 'apiRequest(`/api/ops/events?limit=${limit}`)'),
  viaApiRequest('reverseMovement', 87, 96, 'apiRequest<{ request: OperationsRequestDTO }>', "apiRequest(…/reverse, { method: 'POST', body })"),
  viaApiRequest('fetchClock', 106, 108, 'apiRequest<ClockResponse>', "apiRequest('/api/clock')"),
  viaApiRequest('advanceClock', 116, 121, 'apiRequest<AdvanceClockResponse>', "apiRequest('/api/ops/clock/advance', { method: 'POST', body })"),
  viaApiRequest('fetchSchedules', 124, 126, 'apiRequest<{ schedules: ScheduleDTO[] }>', "apiRequest('/api/ops/schedules')"),
  viaApiRequest('fetchLending', 135, 137, 'apiRequest<LendingListResponse>', "apiRequest('/api/ops/lending')"),
  rel('op:lib/adminApi#createAdminUser', 'op:lib/api#apiRequest', 'calls', {
    label: "apiRequest('/api/admin/users', { method: 'POST', body })",
    sources: [ops('lib/adminApi.ts', 17, 22, 'apiRequest<AdminCreateUserResponse>')],
    detail: 5,
  }),
  rel('op:lib/api#apiRequest', 'op:lib/csrf#csrfHeaders', 'calls', {
    label: 'isMutating(init.method) ? csrfHeaders() : {}',
    summary: 'State-changing requests echo the CSRF cookie as a header.',
    sources: [ops('lib/api.ts', 151, 160, 'csrfHeaders()')],
    tags: ['security'],
  }),
  rel('op:lib/api#login', 'op:lib/csrf#csrfHeaders', 'calls', {
    label: 'csrfHeaders()',
    sources: [ops('lib/api.ts', 176, 181, 'csrfHeaders()')],
    tags: ['security'],
    detail: 5,
  }),
  rel('op:lib/api#logout', 'op:lib/csrf#csrfHeaders', 'calls', {
    label: 'csrfHeaders()',
    sources: [ops('lib/api.ts', 189, 193, 'csrfHeaders()')],
    tags: ['security'],
    detail: 5,
  }),
  rel('op:lib/api#apiRequest', 'op:lib/api#toApiError', 'calls', {
    label: 'if (!res.ok) throw await toApiError(res)',
    sources: [ops('lib/api.ts', 162, 163, 'toApiError(res)')],
    detail: 5,
  }),
  rel('op:lib/api#toApiError', 'op:lib/AuthContext#AuthProvider', 'triggers', {
    label: 'onSessionInvalid?.()',
    summary: 'A 401 with `unauthenticated` or `session_expired` signs the operator out in the UI.',
    description: 'The handler registered by `AuthProvider` sets `user = null` and `sessionEnded = true`, so the app gate re-renders the sign-in screen with the “session has ended” notice.',
    sources: [ops('lib/api.ts', 136, 138, 'onSessionInvalid?.()'), ops('lib/AuthContext.tsx', 38, 44, 'setSessionEnded(true)')],
    tags: ['auth', 'security'],
  }),
  rel('op:lib/api', 'sh:public-demo#resolveApiBaseUrl', 'calls', {
    label: 'resolveApiBaseUrl({ explicit, mode, origin, fallback })',
    summary: 'Same-origin in production builds, localhost in development.',
    sources: [ops('lib/api.ts', 18, 31, 'resolveApiBaseUrl')],
    tags: ['public-demo'],
  }),
  rel('op:lib/api#SURFACE_HEADERS', 'sh:auth#AUTH', 'uses-type', {
    label: 'AUTH.surfaceHeader',
    sources: [ops('lib/api.ts', 52, 52, 'AUTH.surfaceHeader')],
  }),
  rel('op:lib/csrf#csrfHeaders', 'sh:auth#AUTH', 'uses-type', {
    label: 'AUTH.csrfCookieName / AUTH.csrfHeader',
    sources: [ops('lib/csrf.ts', 18, 22, 'AUTH.csrfCookieName')],
  }),

  // ---- Socket ---------------------------------------------------------------
  rel('op:lib/useOpsSocket#useOpsSocket', 'be:realtime', 'websocket', {
    label: 'io(WS_URL, { withCredentials, path: "/socket.io", extraHeaders })',
    summary: 'One Socket.IO connection per signed-in console, carrying the operations cookie and surface header on the handshake.',
    description:
      'The connection starts with HTTP long-polling and upgrades to WebSocket. The cookie (`withCredentials`) and the `x-meridian-surface: operations` header (`extraHeaders`, polling handshake only) are what let the backend resolve the operations session and join a staff socket to the operators room. A socket that fails that check still connects — it just never receives `ops:*` events.',
    protocol: 'Socket.IO 4 (long-polling handshake → WebSocket)',
    bidirectional: true,
    sources: [ops('lib/useOpsSocket.ts', 36, 47, 'io(WS_URL')],
    tags: ['realtime', 'security'],
  }),
  rel('op:lib/useOpsSocket#useOpsSocket', 'ev:ops:request_changed', 'subscribes', {
    label: 'socket.on(SOCKET_EVENTS.opsRequestChanged)',
    summary: 'A request was created or updated by anyone → `onRequestChanged(payload)`.',
    data: ['sh:operations#OpsRequestChangedPayload'],
    sources: [ops('lib/useOpsSocket.ts', 51, 53, 'SOCKET_EVENTS.opsRequestChanged')],
    order: 1,
  }),
  rel('op:lib/useOpsSocket#useOpsSocket', 'ev:ops:external_event', 'subscribes', {
    label: 'socket.on(SOCKET_EVENTS.opsExternalEvent)',
    summary: 'A simulated external event was recorded → `onExternalEvent(payload)`.',
    data: ['sh:operations#OpsExternalEventPayload'],
    sources: [ops('lib/useOpsSocket.ts', 54, 56, 'SOCKET_EVENTS.opsExternalEvent')],
    order: 2,
  }),
  rel('op:lib/useOpsSocket#useOpsSocket', 'ev:sim:heartbeat', 'subscribes', {
    label: 'socket.on(SOCKET_EVENTS.heartbeat)',
    summary: 'Every 10 s: server time plus the simulated time → `onHeartbeat(payload)`.',
    data: ['sh:clock#SimHeartbeatPayload'],
    sources: [ops('lib/useOpsSocket.ts', 57, 59, 'SOCKET_EVENTS.heartbeat')],
    order: 3,
  }),
  rel('op:lib/useOpsSocket#useOpsSocket', 'sh:constants#SOCKET_EVENTS', 'uses-type', {
    label: 'SOCKET_EVENTS',
    summary: 'Event names come from the shared constant, so client and server cannot drift.',
    sources: [ops('lib/useOpsSocket.ts', 3, 9, 'SOCKET_EVENTS')],
  }),
  rel('op:lib/useOpsSocket#useOpsSocket', 'op:lib/api#API_URL', 'uses-type', {
    label: 'WS_URL',
    sources: [ops('lib/useOpsSocket.ts', 10, 10, 'WS_URL')],
    detail: 5,
  }),

  // ---- Live data provider ---------------------------------------------------
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/useOpsSocket#useOpsSocket', 'calls', {
    label: 'useOpsSocket({ onRequestChanged, onExternalEvent, onHeartbeat })',
    summary: 'Pushed events are merged into provider state.',
    sources: [ops('lib/OpsDataContext.tsx', 96, 102, 'useOpsSocket({')],
    order: 3,
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/OpsDataContext#refresh', 'calls', {
    label: 'void refresh()',
    summary: 'Initial load on mount.',
    sources: [ops('lib/OpsDataContext.tsx', 75, 77, 'void refresh()')],
    order: 1,
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/opsApi#fetchClock', 'calls', {
    label: 'fetchClock()',
    summary: 'One-shot seed of the simulated time before the first heartbeat.',
    sources: [ops('lib/OpsDataContext.tsx', 82, 94, 'fetchClock()')],
    order: 2,
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/OpsDataContext#upsertRequest', 'calls', {
    label: 'onRequestChanged: ({ request }) => upsertRequest(request)',
    summary: 'A pushed request change is merged by id.',
    sources: [ops('lib/OpsDataContext.tsx', 96, 98, 'upsertRequest(request)')],
    tags: ['realtime'],
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/OpsDataContext#prependEvent', 'calls', {
    label: 'onExternalEvent: ({ event }) => prependEvent(event)',
    summary: 'A pushed simulated event is prepended unless already present.',
    sources: [ops('lib/OpsDataContext.tsx', 96, 99, 'prependEvent(event)')],
    tags: ['realtime'],
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'sh:operations#countRequestsByStatus', 'calls', {
    label: 'countRequestsByStatus(requests)',
    summary: 'Status counts are derived from the live queue, never fetched separately.',
    sources: [ops('lib/OpsDataContext.tsx', 39, 39, 'countRequestsByStatus(requests)')],
  }),
  rel('op:lib/OpsDataContext#refresh', 'op:lib/opsApi#fetchOpsRequests', 'calls', {
    label: 'fetchOpsRequests()',
    sources: [ops('lib/OpsDataContext.tsx', 58, 62, 'fetchOpsRequests()')],
    order: 1,
  }),
  rel('op:lib/OpsDataContext#refresh', 'op:lib/opsApi#fetchOpsEvents', 'calls', {
    label: 'fetchOpsEvents()',
    sources: [ops('lib/OpsDataContext.tsx', 58, 62, 'fetchOpsEvents()')],
    order: 2,
  }),
  rel('op:lib/OpsDataContext#act', 'op:lib/opsApi#applyOpsAction', 'calls', {
    label: 'applyOpsAction(id, action, note)',
    sources: [ops('lib/OpsDataContext.tsx', 104, 108, 'applyOpsAction(id, action, note)')],
    order: 1,
  }),
  rel('op:lib/OpsDataContext#act', 'op:lib/OpsDataContext#upsertRequest', 'calls', {
    label: 'upsertRequest(updated)',
    sources: [ops('lib/OpsDataContext.tsx', 106, 108, 'upsertRequest(updated)')],
    order: 2,
  }),
  rel('op:lib/OpsDataContext#reverse', 'op:lib/opsApi#reverseMovement', 'calls', {
    label: 'reverseMovement(id, reason)',
    sources: [ops('lib/OpsDataContext.tsx', 113, 117, 'reverseMovement(id, reason)')],
    order: 1,
  }),
  rel('op:lib/OpsDataContext#reverse', 'op:lib/OpsDataContext#upsertRequest', 'calls', {
    label: 'upsertRequest(updated)',
    sources: [ops('lib/OpsDataContext.tsx', 115, 117, 'upsertRequest(updated)')],
    order: 2,
  }),
  rel('op:lib/OpsDataContext#simulate', 'op:lib/opsApi#simulateEvent', 'calls', {
    label: 'simulateEvent(input)',
    sources: [ops('lib/OpsDataContext.tsx', 122, 126, 'simulateEvent(input)')],
    order: 1,
  }),
  rel('op:lib/OpsDataContext#simulate', 'op:lib/OpsDataContext#prependEvent', 'calls', {
    label: 'prependEvent(event)',
    sources: [ops('lib/OpsDataContext.tsx', 124, 126, 'prependEvent(event)')],
    order: 2,
  }),
  rel('op:lib/OpsDataContext#OpsDataProvider', 'op:lib/ops-data-context#OpsDataValue', 'uses-type', {
    label: 'useMemo<OpsDataValue>',
    sources: [ops('lib/OpsDataContext.tsx', 131, 146, 'useMemo<OpsDataValue>')],
    detail: 5,
  }),
  rel('op:lib/OpsDataContext#upsertRequest', 'sh:operations#OperationsRequestDTO', 'uses-type', {
    label: 'OperationsRequestDTO',
    sources: [ops('lib/OpsDataContext.tsx', 41, 49, 'OperationsRequestDTO')],
  }),
  rel('op:lib/OpsDataContext#prependEvent', 'sh:operations#SimulatedEventDTO', 'uses-type', {
    label: 'SimulatedEventDTO',
    sources: [ops('lib/OpsDataContext.tsx', 51, 56, 'SimulatedEventDTO')],
  }),
  rel('op:lib/useOpsSummary', 'op:lib/api#fetchOpsSummary', 'calls', {
    label: 'fetchOpsSummary()',
    sources: [ops('lib/useOpsSummary.ts', 22, 27, 'fetchOpsSummary()')],
  }),
  rel('op:lib/useOpsSummary', 'op:lib/api#OpsSummary', 'uses-type', {
    label: 'OpsSummary',
    sources: [ops('lib/useOpsSummary.ts', 2, 9, 'OpsSummary')],
    detail: 5,
  }),
  rel('op:lib/useApiStatus', 'op:lib/api#fetchStatus', 'calls', {
    label: 'fetchStatus()',
    sources: [ops('lib/useApiStatus.ts', 14, 18, 'fetchStatus()')],
  }),
  rel('op:lib/public-demo', 'op:lib/useApiStatus', 'calls', {
    label: 'useApiStatus()',
    summary: 'The runtime half of the public-demo check: `/status → publicDemo`.',
    sources: [ops('lib/public-demo.ts', 13, 16, 'useApiStatus()')],
  }),

  // ---- Session --------------------------------------------------------------
  rel('op:lib/AuthContext#AuthProvider', 'op:lib/api#fetchMe', 'calls', {
    label: 'fetchMe()',
    summary: 'Session restore on mount.',
    sources: [ops('lib/AuthContext.tsx', 20, 31, 'fetchMe()')],
    order: 1,
  }),
  rel('op:lib/AuthContext#AuthProvider', 'op:lib/api#setSessionInvalidHandler', 'calls', {
    label: 'setSessionInvalidHandler(() => { setUser(null); setSessionEnded(true) })',
    sources: [ops('lib/AuthContext.tsx', 38, 44, 'setSessionInvalidHandler(')],
    order: 2,
  }),
  rel('op:lib/AuthContext#AuthProvider', 'op:lib/api#login', 'calls', {
    label: 'apiLogin(email, password)',
    sources: [ops('lib/AuthContext.tsx', 46, 51, 'apiLogin(email, password)')],
    order: 3,
  }),
  rel('op:lib/AuthContext#AuthProvider', 'op:lib/api#logout', 'calls', {
    label: 'apiLogout()',
    sources: [ops('lib/AuthContext.tsx', 53, 57, 'apiLogout()')],
    order: 4,
  }),
  rel('op:lib/AuthContext#AuthProvider', 'op:lib/auth-context#AuthContextValue', 'uses-type', {
    label: 'useMemo<AuthContextValue>',
    sources: [ops('lib/AuthContext.tsx', 64, 67, 'useMemo<AuthContextValue>')],
    detail: 5,
  }),
  rel('op:lib/auth-context#isOperatorRole', 'sh:types#UserRole', 'uses-type', {
    label: 'UserRole',
    sources: [ops('lib/auth-context.ts', 10, 15, 'UserRole')],
  }),

  // ---- Features -------------------------------------------------------------
  rel('op:lib/useOpsSocket#useOpsSocket', 'feat:realtime', 'implements', { label: 'client subscription', sources: [ops('lib/useOpsSocket.ts', 31, 35, 'useOpsSocket')] }),
  rel('op:lib/OpsDataContext#upsertRequest', 'feat:realtime', 'implements', { label: 'merge pushed changes by id', sources: [ops('lib/OpsDataContext.tsx', 41, 49, 'upsertRequest')] }),
  rel('op:lib/OpsDataContext#act', 'feat:ops-review', 'implements', { label: 'operator actions', sources: [ops('lib/OpsDataContext.tsx', 104, 111, 'const act')] }),
  rel('op:lib/OpsDataContext#simulate', 'feat:sim-messaging', 'implements', { label: 'simulated events', sources: [ops('lib/OpsDataContext.tsx', 122, 129, 'const simulate')] }),
  rel('op:lib/AuthContext#AuthProvider', 'feat:auth', 'implements', { label: 'operator session', sources: [ops('lib/AuthContext.tsx', 14, 17, 'AuthProvider')] }),
  rel('op:lib/auth-context#isOperatorRole', 'feat:rbac', 'implements', { label: 'staff-only console', sources: [ops('lib/auth-context.ts', 10, 15, 'isOperatorRole')] }),
  rel('op:lib/csrf#csrfHeaders', 'feat:csrf', 'implements', { label: 'double-submit header', sources: [ops('lib/csrf.ts', 18, 22, 'csrfHeaders')] }),
  rel('op:lib/adminApi#createAdminUser', 'feat:admin-users', 'implements', { label: 'create demo user', sources: [ops('lib/adminApi.ts', 17, 22, 'createAdminUser')] }),
  rel('op:lib/opsApi#advanceClock', 'feat:clock', 'implements', { label: 'advance the clock', sources: [ops('lib/opsApi.ts', 116, 121, 'advanceClock')] }),
];
