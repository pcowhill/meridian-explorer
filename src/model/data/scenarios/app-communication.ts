import type { Scenario, ScenarioStep } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';
import { BE, CU, OP, SH, src } from '../platform/helpers';
import { EXAMPLE_REQUEST_DTO } from '../platform/abuse-realtime';

/**
 * "How do the customer application, operations simulator and backend
 * communicate?" — a tour of the transports: the status probe, cookie sessions
 * with per-surface cookies, the double-submit CSRF token, and Socket.IO with a
 * staff-only room.
 */

const CSRF = `${BE}/auth/csrf.ts`;
const COOKIES = `${BE}/auth/cookies.ts`;
const GUARDS = `${BE}/auth/guards.ts`;
const SESSIONS = `${BE}/auth/sessions.ts`;
const RT = `${BE}/realtime.ts`;
const OPSRT = `${BE}/ops/realtime.ts`;
const RT_TEST = `${BE}/realtime.test.ts`;
const STATUS = `${BE}/routes/status.ts`;
const AUTHR = `${BE}/routes/auth.ts`;
const OPS_ROUTES = `${BE}/routes/ops.ts`;
const MONEY_ROUTES = `${BE}/routes/money.ts`;
const RATE = `${BE}/abuse/rate-limit.ts`;
const OP_API = `${OP}/lib/api.ts`;
const OP_OPSAPI = `${OP}/lib/opsApi.ts`;
const OP_SOCKET = `${OP}/lib/useOpsSocket.ts`;
const OP_DATA = `${OP}/lib/OpsDataContext.tsx`;
const OP_APP = `${OP}/App.tsx`;
const OP_AUTHCTX = `${OP}/lib/AuthContext.tsx`;
const CU_API = `${CU}/lib/api.ts`;
const CU_AUTH = `${CU}/lib/auth.ts`;
const CU_MONEY = `${CU}/lib/money.ts`;
const CU_PROVIDER = `${CU}/lib/AuthProvider.tsx`;
const CU_CSRF = `${CU}/lib/csrf.ts`;

// Participants
const CUSTOMER = 'customer';
const OPERATIONS = 'operations';
const OPS_SOCKET = 'op:lib/useOpsSocket';
const CSRF_HOOK = 'be:auth/csrf#csrfHook';
const REQUIRE_AUTH = 'be:auth/guards#requireAuth';
const ROUTES = 'be.http';
const SOCKET_SERVER = 'be:realtime#attachRealtime';
const PUBLISHER = 'be:ops/realtime#SocketOpsRealtime';
const OPS_EVENT = 'ev:ops:request_changed';

// Variants
const OPS = 'operations-console';
const CUST = 'customer-app';

// Example values
const CSRF_TOKEN = '8be2…04af';
const SAM = { id: IDS.sam, email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent' };
const AVERY = { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' };
const STATUS_BODY = {
  status: 'ok',
  version: '1.0.0',
  milestone: 'v1.0.0',
  milestoneName: 'Polish, hardening, loans/CDs & interest',
  isSimulation: true,
  environment: 'development',
  publicDemo: false,
  database: { connected: true, users: 4, accounts: 2 },
  revision: null,
  serverTime: NOW,
};
const OPS_SESSION_HASH = 'a7e0…19c3 (SHA-256 of the operations token)';
const CUST_SESSION_HASH = 'c1d4…77b0 (SHA-256 of the customer token)';
const LOGGED_IN_AT = '2026-10-01T14:30:00.000Z';
const SLID_EXPIRES = '2026-10-01T23:00:00.000Z';

const steps: ScenarioStep[] = [
  // ---- 1. Page load + status probe -------------------------------------------
  {
    id: 'load-ops',
    kind: 'ui',
    title: 'Sam reloads the operations console',
    from: OPERATIONS,
    to: OPERATIONS,
    label: 'page load',
    narrative:
      'The browser fetches the operations SPA as static files and React mounts `AuthProvider` around the console. Sam signed in half an hour ago, so the browser holds the httpOnly `mer_ops_session` cookie. Everything else on screen will come from the backend over two channels: `fetch` calls and one Socket.IO connection.',
    audience: {
      executive: 'A member of bank staff opens the back-office console.',
      'end-user': 'A bank employee opens the operations console.',
      systems: 'Static SPA. In production it is served from `banking-ops.cowhill.dev`, and the same hostname reverse-proxies `/api/*`, `/health`, `/status` and `/socket.io/*` to the backend on loopback.',
    },
    detail: 1,
    variants: [OPS],
    sources: [src(OP_APP, 62, 75, 'export function App()'), src(OP_API, 11, 31, 'resolveApiBaseUrl', 'Where the console sends API + socket traffic')],
  },
  {
    id: 'load-customer',
    kind: 'ui',
    title: 'Avery reloads the customer app',
    from: CUSTOMER,
    to: CUSTOMER,
    label: 'page load',
    narrative:
      'The browser fetches the customer SPA and React mounts `AuthProvider` around the routes. Avery signed in earlier, so the browser holds the httpOnly `mer_session` cookie. Every piece of data on screen will come from `fetch` calls to the backend; this app opens no socket.',
    audience: {
      executive: 'A customer opens the banking website.',
      'end-user': 'You open the banking website.',
      systems: 'Static SPA. In production it is served from `banking.cowhill.dev`, which reverse-proxies `/api/*`, `/health`, `/status` and `/socket.io/*` to the same backend.',
    },
    detail: 1,
    variants: [CUST],
    sources: [src(CU_API, 3, 21, 'resolveApiBaseUrl', 'Where the app sends API traffic'), src(CU_PROVIDER, 7, 17, 'export function AuthProvider')],
  },
  {
    id: 'status-ops',
    kind: 'request',
    title: 'Probe the backend: GET /status',
    from: OPERATIONS,
    to: ROUTES,
    label: 'GET /status',
    narrative:
      '`fetchStatus()` makes a plain `fetch` with no credentials option and no custom headers; the result is shared by every component that asks within 15 seconds. It never throws: an unreachable backend yields `null` and the shell still renders.',
    audience: { executive: 'The console first checks that the bank\'s server is up.' },
    detail: 2,
    variants: [OPS],
    payload: { title: 'Request', format: 'http-request', line: 'GET /status', data: null },
    sources: [src(OP_API, 54, 69, 'export async function fetchStatus')],
  },
  {
    id: 'status-customer',
    kind: 'request',
    title: 'Probe the backend: GET /status',
    from: CUSTOMER,
    to: ROUTES,
    label: 'GET /status',
    narrative:
      '`fetchStatus()` makes a plain `fetch` with no credentials option and no custom headers; the result is cached for 15 seconds so the banner, the status pill and the sign-in page share one request. An unreachable backend yields `null` and the public site still renders.',
    audience: { executive: 'The website first checks that the bank\'s server is up.' },
    detail: 2,
    variants: [CUST],
    payload: { title: 'Request', format: 'http-request', line: 'GET /status', data: null },
    sources: [src(CU_API, 35, 55, 'export async function fetchStatus')],
  },
  {
    id: 'status-res-ops',
    kind: 'response',
    title: '200 — version, posture and database readiness',
    from: ROUTES,
    to: OPERATIONS,
    label: '200 StatusResponse',
    narrative:
      'The status handler counts users and accounts to prove the database answers and adds the version, `publicDemo`, the release revision and the server time. The console uses `publicDemo` to decide whether to show the shared-demo warning.',
    detail: 3,
    variants: [OPS],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', data: STATUS_BODY, typeRef: 'sh:types#StatusResponse', highlight: ['status', 'publicDemo', 'database.connected'] },
    sources: [src(STATUS, 8, 27, "app.get('/status'")],
  },
  {
    id: 'status-res-customer',
    kind: 'response',
    title: '200 — version, posture and database readiness',
    from: ROUTES,
    to: CUSTOMER,
    label: '200 StatusResponse',
    narrative:
      'The status handler counts users and accounts to prove the database answers and adds the version, `publicDemo`, the release revision and the server time. The status pill reads `version` and `database.connected`; the banner reads `publicDemo`.',
    detail: 3,
    variants: [CUST],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', data: STATUS_BODY, typeRef: 'sh:types#StatusResponse', highlight: ['status', 'publicDemo', 'database.connected'] },
    sources: [src(STATUS, 8, 27, "app.get('/status'"), src(`${CU}/components/BackendStatusPill.tsx`, 9, 17, 'Backend online')],
  },

  // ---- 2. Session hydration via cookie ----------------------------------------
  {
    id: 'me-ops',
    kind: 'request',
    title: 'Restore the session: GET /api/auth/me',
    from: OPERATIONS,
    to: CSRF_HOOK,
    label: 'GET /api/auth/me  (x-meridian-surface: operations)',
    narrative:
      'On mount the provider calls `fetchMe()`: `credentials: \'include\'` so the browser attaches its cookies, plus the header `x-meridian-surface: operations`. The console sends that header on every API call because browsers omit `Origin` on same-origin GETs, and without a surface signal the backend would read the customer cookie.',
    audience: {
      executive: 'The console asks the server whether this browser is already signed in.',
      systems: 'Cookie-authenticated GET. The surface header — not the hostname or Origin — is what selects the operations session cookie.',
    },
    detail: 2,
    variants: [OPS],
    payload: {
      title: 'Request',
      format: 'http-request',
      line: 'GET /api/auth/me',
      headers: { 'x-meridian-surface': 'operations', Cookie: 'mer_ops_session=<operations token>' },
      data: null,
      highlight: ['x-meridian-surface'],
    },
    sources: [src(OP_API, 196, 212, 'export async function fetchMe'), src(OP_API, 45, 52, 'const SURFACE_HEADERS'), src(OP_AUTHCTX, 19, 31, 'fetchMe().then')],
  },
  {
    id: 'me-customer',
    kind: 'request',
    title: 'Restore the session: GET /api/auth/me',
    from: CUSTOMER,
    to: CSRF_HOOK,
    label: 'GET /api/auth/me  (no surface header)',
    narrative:
      'On mount the provider calls `fetchMe()`: `credentials: \'include\'` so the browser attaches its cookies. The customer app deliberately sends NO `x-meridian-surface` header — the backend\'s default surface is the customer one.',
    audience: {
      executive: 'The website asks the server whether this browser is already signed in.',
      systems: 'Cookie-authenticated GET with no surface header; the backend falls back to Origin and then to the customer default.',
    },
    detail: 2,
    variants: [CUST],
    payload: { title: 'Request', format: 'http-request', line: 'GET /api/auth/me', headers: { Cookie: 'mer_session=<customer token>' }, data: null },
    sources: [src(CU_AUTH, 101, 114, 'export async function fetchMe'), src(CU_PROVIDER, 24, 34, 'authApi.fetchMe()'), src(CU_MONEY, 13, 17, 'does NOT send the', 'The convention, stated in the client code')],
  },
  {
    id: 'csrf-issue',
    kind: 'guard',
    title: 'CSRF hook: a safe request is where the token is issued',
    from: CSRF_HOOK,
    to: CSRF_HOOK,
    label: 'safe method → Set-Cookie: mer_csrf',
    narrative:
      'The global `onRequest` hook runs before any route. GET is a safe method, so nothing is checked — but if the request carries no `mer_csrf` cookie the hook mints a 32-byte random token and sets it on the response. In this run the browser\'s previous token cookie — minted on an earlier visit, with an 8-hour max-age — has lapsed, so a new one is issued; a brand-new browser gets its first token the same way. The cookie is deliberately NOT httpOnly: page script must be able to read it.',
    audience: {
      executive: 'The server hands the page a one-off token it will later use to prove that requests really come from the bank\'s own site.',
      systems: '`mer_csrf`: readable (not httpOnly), SameSite=Lax, Path=/, Max-Age 8 h, Secure in production. Issued on any safe request that lacks it, and on login.',
    },
    detail: 3,
    payload: { title: 'Set-Cookie', format: 'json', data: { name: 'mer_csrf', value: CSRF_TOKEN, httpOnly: false, sameSite: 'lax', path: '/', maxAge: 28800, secure: false }, highlight: ['httpOnly'] },
    sources: [src(CSRF, 86, 93, 'generateCsrfToken()'), src(CSRF, 47, 59, 'httpOnly: false'), src(`${BE}/routes/csrf.test.ts`, 33, 36, 'a safe GET issues a mer_csrf token cookie to a brand-new client', 'Pinned by test')],
  },
  {
    id: 'surface-ops',
    kind: 'guard',
    title: 'Which cookie? The operations surface reads mer_ops_session',
    from: CSRF_HOOK,
    to: REQUIRE_AUTH,
    label: "sessionCookieNameForRequest(req) → 'mer_ops_session'",
    narrative:
      '`requireAuth` first decides which surface the request belongs to: the `x-meridian-surface` header if it is exactly `customer` or `operations`, else the `Origin` header (a configured ops origin or the ops dev port), else `customer`. Here the header says `operations`, so only `mer_ops_session` is read. A `mer_session` cookie in the same browser is ignored — a customer session can never authenticate an operations request.',
    audience: {
      executive: 'Staff and customer sign-ins are kept completely separate, even in the same browser.',
      systems: 'Two cookie names, one backend. In local development both apps are on `localhost`, so the browser sends both cookies to the API; the surface decides which is read. In production the two hostnames separate them as well.',
    },
    detail: 2,
    variants: [OPS],
    payload: { title: 'Surface resolution', format: 'return', data: { header: 'operations', origin: null, audience: 'operations', cookieName: 'mer_ops_session' }, typeRef: 'sh:auth#SESSION_AUDIENCES', highlight: ['cookieName'] },
    sources: [src(COOKIES, 71, 86, 'export function sessionAudienceForRequest'), src(GUARDS, 47, 53, 'sessionCookieNameForRequest(req)'), src(`${BE}/routes/session-isolation.test.ts`, 81, 94, 'reads only the customer cookie on the customer portal', 'Isolation pinned by test')],
  },
  {
    id: 'surface-customer',
    kind: 'guard',
    title: 'Which cookie? The customer surface reads mer_session',
    from: CSRF_HOOK,
    to: REQUIRE_AUTH,
    label: "sessionCookieNameForRequest(req) → 'mer_session'",
    narrative:
      '`requireAuth` first decides which surface the request belongs to: the `x-meridian-surface` header if present, else the `Origin` header, else `customer`. There is no header here; in development the Origin is `http://localhost:5173` (not an operations origin) and in production a same-origin GET has no Origin at all — both resolve to `customer`, so only `mer_session` is read. An operations cookie in the same browser is ignored.',
    audience: {
      executive: 'Staff and customer sign-ins are kept completely separate, even in the same browser.',
      systems: 'The customer surface is the least-privileged default. Staff endpoints stay role-gated regardless of which cookie is read.',
    },
    detail: 2,
    variants: [CUST],
    payload: { title: 'Surface resolution', format: 'return', data: { header: null, origin: 'http://localhost:5173', audience: 'customer', cookieName: 'mer_session' }, typeRef: 'sh:auth#SESSION_AUDIENCES', highlight: ['cookieName'] },
    sources: [src(COOKIES, 34, 53, 'export function sessionAudienceForOrigin'), src(COOKIES, 71, 86, 'export function sessionCookieNameForRequest'), src(GUARDS, 47, 53, 'sessionCookieNameForRequest(req)')],
  },
  {
    id: 'resolve-session',
    kind: 'guard',
    title: 'Resolve the token to a live session',
    from: REQUIRE_AUTH,
    to: REQUIRE_AUTH,
    label: 'resolveSession(prisma, token, now)',
    narrative:
      'The cookie value is hashed with SHA-256 and looked up in `Session` by `tokenHash`, joined to its user. The session must not be revoked or past `expiresAt`, and the user must be active. On success the idle timeout slides: `lastSeenAt = now`, `expiresAt = now + 8 hours`, and `req.user` is set. Otherwise the answer is 401 `unauthenticated` (no cookie) or 401 `session_expired` (cookie cleared).',
    audience: { dba: 'One unique-index read on `Session.tokenHash` joined to `User`, then one `Session` update — on every authenticated HTTP request.' },
    detail: 4,
    payload: { title: 'Session update', format: 'row', data: { lastSeenAt: NOW, expiresAt: SLID_EXPIRES }, highlight: ['expiresAt'] },
    sources: [src(SESSIONS, 50, 72, 'export async function resolveSession'), src(GUARDS, 54, 65, 'req.user = {')],
  },
  {
    id: 'me-res-ops',
    kind: 'response',
    title: '200 — the browser is recognised as Sam Operator',
    from: ROUTES,
    to: OPERATIONS,
    label: '200 { user }',
    narrative:
      'The handler echoes `req.user`. The response also carries the new `mer_csrf` cookie. The session token itself never appears in a response body and cannot be read by page script.',
    audience: { executive: 'The server recognises the browser: Sam Operator, operations agent. No password needed again.', 'end-user': 'You are still signed in.' },
    detail: 1,
    variants: [OPS],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', headers: { 'Set-Cookie': `mer_csrf=${CSRF_TOKEN}; Max-Age=28800; Path=/; SameSite=Lax` }, data: { user: SAM }, typeRef: 'sh:auth#AuthResponse', highlight: ['user.role'] },
    effects: [{ op: 'update', table: 'Session', id: 'ses_ops', set: { lastSeenAt: NOW, expiresAt: SLID_EXPIRES } }],
    sources: [src(AUTHR, 237, 241, "app.get('/api/auth/me'")],
  },
  {
    id: 'me-res-customer',
    kind: 'response',
    title: '200 — the browser is recognised as Avery Customer',
    from: ROUTES,
    to: CUSTOMER,
    label: '200 { user }',
    narrative:
      'The handler echoes `req.user`. The response also carries the new `mer_csrf` cookie. The session token itself never appears in a response body and cannot be read by page script.',
    audience: { executive: 'The server recognises the browser: Avery Customer. No password needed again.', 'end-user': 'You are still signed in.' },
    detail: 1,
    variants: [CUST],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', headers: { 'Set-Cookie': `mer_csrf=${CSRF_TOKEN}; Max-Age=28800; Path=/; SameSite=Lax` }, data: { user: AVERY }, typeRef: 'sh:auth#AuthResponse' },
    effects: [{ op: 'update', table: 'Session', id: 'ses_cust', set: { lastSeenAt: NOW, expiresAt: SLID_EXPIRES } }],
    sources: [src(AUTHR, 237, 241, "app.get('/api/auth/me'")],
  },
  {
    id: 'gate-ops',
    kind: 'client',
    title: 'Staff gate passes; the live-data provider mounts',
    from: OPERATIONS,
    to: OPERATIONS,
    label: 'isOperatorRole(user.role) → <OpsDataProvider>',
    narrative:
      'The console admits only `ops_agent` and `admin`; anyone else sees the operator login. With Sam admitted, `OpsDataProvider` mounts: it loads the queue and event feed over HTTP and calls `useOpsSocket`, which opens the one Socket.IO connection.',
    detail: 3,
    variants: [OPS],
    sources: [src(OP_APP, 34, 60, 'isOperatorRole(user.role)'), src(OP_DATA, 23, 30, 'export function OpsDataProvider'), src(OP_DATA, 96, 102, 'useOpsSocket({')],
  },
  {
    id: 'gate-customer',
    kind: 'client',
    title: 'The provider caches the user; protected pages render',
    from: CUSTOMER,
    to: CUSTOMER,
    label: 'setUser(me); setLoading(false)',
    narrative:
      'The provider stores the user in React state and clears `loading`, so `RequireAuth` renders the requested page instead of redirecting to `/login`. Each page then fetches its own data with the same cookie.',
    detail: 3,
    variants: [CUST],
    sources: [src(CU_PROVIDER, 24, 34, 'setLoading(false)'), src(`${CU}/components/RequireAuth.tsx`, 11, 32, 'export function RequireAuth')],
  },

  // ---- 3. Socket.IO (operations console) ----------------------------------------
  {
    id: 'socket-connect',
    kind: 'request',
    title: 'Open the Socket.IO connection',
    from: OPS_SOCKET,
    to: SOCKET_SERVER,
    label: "io(WS_URL, { withCredentials, path: '/socket.io' })",
    narrative:
      '`useOpsSocket` connects once per mounted console. `withCredentials: true` makes the handshake carry the browser\'s cookies, and `extraHeaders` adds `x-meridian-surface: operations` to the HTTP long-polling handshake. Socket.IO shares the backend\'s HTTP server and port, with the same CORS allowlist as the API.',
    audience: {
      executive: 'The console opens a live line to the server so updates can be pushed to it.',
      systems: 'Socket.IO 4 at `/socket.io` on the API origin: HTTP long-polling handshake, then a WebSocket upgrade (the reverse proxy must allow it). Cookies and the surface header ride the handshake.',
    },
    detail: 2,
    variants: [OPS],
    payload: {
      title: 'Handshake',
      format: 'http-request',
      line: 'GET /socket.io/?EIO=4&transport=polling',
      headers: { 'x-meridian-surface': 'operations', Cookie: `mer_ops_session=<operations token>; mer_csrf=${CSRF_TOKEN}` },
      data: null,
    },
    sources: [src(OP_SOCKET, 36, 47, 'extraHeaders: { [AUTH.surfaceHeader]: \'operations\' }'), src(RT, 28, 32, "path: '/socket.io'"), src(OP_API, 25, 31, 'const WS_URL')],
  },
  {
    id: 'welcome',
    kind: 'event',
    title: 'sim:welcome — the server greets the socket',
    from: SOCKET_SERVER,
    to: OPS_SOCKET,
    label: 'sim:welcome',
    narrative:
      'The connection handler immediately emits `sim:welcome` to this socket: the platform metadata plus the server time. Every socket gets it, authenticated or not. The console registers no listener for it; its own `connect` handler is what flips the "Live" indicator.',
    detail: 3,
    variants: [OPS],
    payload: {
      title: 'sim:welcome',
      format: 'socket',
      data: { version: '1.0.0', milestone: 'v1.0.0', milestoneName: 'Polish, hardening, loans/CDs & interest', isSimulation: true, serverTime: NOW },
      typeRef: 'ev:sim:welcome',
    },
    sources: [src(RT, 34, 38, 'socket.emit(SOCKET_EVENTS.welcome'), src(OP_SOCKET, 49, 50, "socket.on('connect', () => setConnected(true))")],
  },
  {
    id: 'room-decision',
    kind: 'decision',
    title: 'Room decision at the handshake: staff session → join "ops"',
    from: SOCKET_SERVER,
    to: SOCKET_SERVER,
    label: 'joinOpsRoomIfOperator(socket, prisma)',
    narrative:
      'Still inside the connection handler, the server decides room membership — the client never asks. It resolves the surface from the handshake headers exactly as the REST guards do, parses the raw `Cookie` header, takes `mer_ops_session`, resolves it with `resolveSession` and checks the role. Sam is an `ops_agent`, so the socket is joined to the room `ops`. Any failure along the way just leaves the socket out of the room.',
    audience: {
      executive: 'Only signed-in bank staff are admitted to the live staff channel.',
      systems: 'Server-side room RBAC, evaluated once at connect: surface = operations AND valid `mer_ops_session` AND role in {ops_agent, admin}. A socket that connected before login must reconnect to be admitted.',
    },
    detail: 1,
    variants: [OPS],
    decision: {
      question: 'Does the handshake carry a valid operations session for a staff role?',
      options: [
        { label: 'Yes — ops_agent or admin on the operations surface', variant: OPS, description: 'socket.join(\'ops\')' },
        { label: 'No — customer surface, no cookie, or a non-staff role', variant: CUST, description: 'Connected, but never in the ops room.' },
      ],
    },
    payload: { title: 'Decision', format: 'return', data: { audience: 'operations', cookie: 'mer_ops_session', user: { id: IDS.sam, role: 'ops_agent' }, joined: 'ops' }, typeRef: 'sh:constants#OPS_REALTIME_ROOM', highlight: ['joined'] },
    sources: [src(RT, 75, 99, 'await socket.join(OPS_REALTIME_ROOM)'), src(OPSRT, 67, 93, 'export function isOperatorRole'), src(RT_TEST, 81, 114, 'Only the operator socket joined the ops room', 'Pinned by test')],
  },
  {
    id: 'heartbeat',
    kind: 'event',
    title: 'sim:heartbeat every 10 seconds',
    from: SOCKET_SERVER,
    to: OPS_SOCKET,
    label: 'sim:heartbeat',
    narrative:
      'A server-side interval broadcasts `sim:heartbeat` to every connected socket every 10 seconds: the real server time and the current simulation-clock time, read best-effort from the `SimulationClock` row. The console\'s data provider uses `simulationTime` to keep the displayed simulated date live.',
    audience: { executive: 'Every ten seconds the server tells connected consoles the current simulated date.', dba: 'One `SimulationClock.findUnique({ id: \'singleton\' })` every 10 seconds, regardless of how many sockets are connected.' },
    detail: 2,
    variants: [OPS],
    payload: { title: 'sim:heartbeat', format: 'socket', data: { serverTime: '2026-10-01T15:00:10.000Z', simulationTime: NOW }, typeRef: 'ev:sim:heartbeat', highlight: ['simulationTime'] },
    sources: [src(RT, 43, 47, '10_000'), src(RT, 59, 68, 'io.emit(SOCKET_EVENTS.heartbeat'), src(OP_DATA, 96, 102, 'onHeartbeat')],
  },

  // ---- 4. A state-changing request: CSRF echo ---------------------------------------
  {
    id: 'action-request',
    kind: 'request',
    title: 'Sam approves a deposit: a mutating request echoes the CSRF token',
    from: OPERATIONS,
    to: CSRF_HOOK,
    label: 'POST /api/ops/requests/:id/action  (x-meridian-csrf)',
    narrative:
      '`applyOpsAction` goes through `apiRequest`, which adds the surface header to every call and — because POST is a mutating method — reads `mer_csrf` from `document.cookie` and copies it into the `x-meridian-csrf` header. The browser attaches the cookies itself.',
    audience: {
      executive: 'A staff member approves a customer\'s deposit; the console attaches the token that proves the request came from the bank\'s own page.',
      'end-user': 'The bank employee presses Approve.',
    },
    detail: 1,
    variants: [OPS],
    payload: {
      title: 'Request',
      format: 'http-request',
      line: 'POST /api/ops/requests/req_dep_1/action',
      headers: { 'Content-Type': 'application/json', 'x-meridian-surface': 'operations', 'x-meridian-csrf': CSRF_TOKEN, Cookie: `mer_ops_session=<operations token>; mer_csrf=${CSRF_TOKEN}` },
      data: { action: 'approve' },
      highlight: ['x-meridian-csrf'],
    },
    sources: [src(OP_API, 142, 164, 'isMutating(init.method) ? csrfHeaders() : {}'), src(OP_OPSAPI, 50, 61, 'export async function applyOpsAction'), src(`${OP}/lib/csrf.ts`, 13, 22, 'export function csrfHeaders')],
  },
  {
    id: 'mutation-customer',
    kind: 'request',
    title: 'Avery moves money: a mutating request echoes the CSRF token',
    from: CUSTOMER,
    to: CSRF_HOOK,
    label: 'POST /api/transfers  (x-meridian-csrf)',
    narrative:
      'Every customer API client builds its requests with a `jsonInit` helper that sets `credentials: \'include\'` and spreads `csrfHeaders()`, which reads `mer_csrf` from `document.cookie` and returns it as the `x-meridian-csrf` header. Still no surface header.',
    audience: {
      executive: 'When the customer does something that changes data, the website attaches the token that proves the request came from the bank\'s own page.',
      'end-user': 'You submit a transfer.',
    },
    detail: 1,
    variants: [CUST],
    payload: {
      title: 'Request',
      format: 'http-request',
      line: 'POST /api/transfers',
      headers: { 'Content-Type': 'application/json', 'x-meridian-csrf': CSRF_TOKEN, Cookie: `mer_session=<customer token>; mer_csrf=${CSRF_TOKEN}` },
      data: { fromAccountId: IDS.checking, toAccountId: IDS.savings, amountMinor: 5000 },
      highlight: ['x-meridian-csrf'],
    },
    sources: [src(CU_MONEY, 34, 47, 'const jsonInit'), src(CU_CSRF, 34, 42, 'export function csrfHeaders')],
  },
  {
    id: 'csrf-check',
    kind: 'guard',
    title: 'CSRF hook: header must equal cookie',
    from: CSRF_HOOK,
    to: CSRF_HOOK,
    label: 'x-meridian-csrf === mer_csrf ?',
    narrative:
      'POST is unsafe and the path is not exempt. The request carries a session cookie, so the hook requires the `x-meridian-csrf` header to equal the `mer_csrf` cookie, compared in constant time. A missing or different value ends the request with 403 `csrf_failed`. Another website can make the browser send the cookies, but it can neither read `mer_csrf` nor add a custom header without a CORS preflight the allowlist refuses. The mutation valve hook runs next (public-demo mode only).',
    audience: {
      executive: 'The server checks the proof-of-origin token before doing anything; a forged request from another website fails here.',
      systems: 'Double-submit cookie. Applies to POST/PUT/PATCH/DELETE that carry either session cookie; login, logout and public onboarding are exempt. 403 `csrf_failed` on mismatch.',
    },
    detail: 2,
    payload: { title: 'Comparison', format: 'return', data: { cookie: CSRF_TOKEN, header: CSRF_TOKEN, match: true }, highlight: ['match'] },
    sources: [src(CSRF, 102, 116, "code: 'csrf_failed'"), src(CSRF, 73, 78, 'timingSafeEqual'), src(RATE, 178, 183, 'export async function mutationValveHook')],
  },
  {
    id: 'action-guards',
    kind: 'guard',
    title: 'Session, then role, then the operator rate limit',
    from: CSRF_HOOK,
    to: REQUIRE_AUTH,
    label: "requireAuth → requireRole('ops_agent', 'admin') → rateLimit('operations')",
    narrative:
      'The route\'s preHandler chain: `requireAuth` resolves `mer_ops_session` to Sam; `requireRole` allows only staff roles (a customer session would get 403 `forbidden` here even if it reached this far); `rateLimit(\'operations\')` counts the action per user in public-demo mode.',
    audience: { executive: 'The server confirms the request comes from a signed-in member of staff.' },
    detail: 3,
    variants: [OPS],
    payload: { title: 'req.user', format: 'return', data: SAM, typeRef: 'sh:auth#SessionUser', highlight: ['role'] },
    sources: [src(OPS_ROUTES, 53, 56, "requireRole('ops_agent', 'admin'), rateLimit('operations')"), src(GUARDS, 68, 86, 'export function requireRole')],
  },
  {
    id: 'guards-customer',
    kind: 'guard',
    title: 'Session, then the money rate limit',
    from: CSRF_HOOK,
    to: REQUIRE_AUTH,
    label: "requireAuth → rateLimit('money')",
    narrative: 'The route\'s preHandler chain: `requireAuth` resolves `mer_session` to Avery, then `rateLimit(\'money\')` counts the request per user in public-demo mode. No role check — what Avery may do is decided per account inside the service.',
    detail: 3,
    variants: [CUST],
    payload: { title: 'req.user', format: 'return', data: AVERY, typeRef: 'sh:auth#SessionUser' },
    sources: [src(MONEY_ROUTES, 61, 66, "rateLimit('money')")],
  },
  {
    id: 'response-customer',
    kind: 'response',
    title: 'The handler runs and answers over the same HTTP request',
    from: ROUTES,
    to: CUSTOMER,
    label: '201 Created',
    narrative:
      'The money route validates the body and calls the transfer service (the transfer scenario covers that path). The result returns as the HTTP response — the only way the customer app ever learns about a change. Failures use the uniform `{ error, code }` body.',
    audience: { executive: 'The server does the work and replies; the website shows the result.' },
    detail: 2,
    variants: [CUST],
    sources: [src(MONEY_ROUTES, 61, 70, "app.post('/api/transfers'")],
    confidence: 'simplified',
  },
  {
    id: 'action-handler',
    kind: 'call',
    title: 'The handler applies the action',
    from: REQUIRE_AUTH,
    to: ROUTES,
    label: 'applyOperatorAction(prisma, { id, action, note, actor }, simulationNow)',
    narrative:
      'The operations route validates the action and calls the request workflow service, which updates the request and performs its consequences (for a deposit approval, posting the pending ledger entry) and returns the updated request plus any simulated events. The operations scenarios cover that path in detail.',
    detail: 3,
    variants: [OPS],
    sources: [src(OPS_ROUTES, 122, 146, 'applyOperatorAction(')],
    confidence: 'simplified',
  },
  {
    id: 'publish',
    kind: 'call',
    title: 'Publish the change through app.opsRealtime',
    from: ROUTES,
    to: PUBLISHER,
    label: "app.opsRealtime.requestChanged('updated', request)",
    narrative:
      'After the database work succeeds the handler calls the publisher that `buildServer` decorated onto the Fastify instance. At runtime that is the `SocketOpsRealtime` created in `index.ts` and bound to the Socket.IO server; in tests it is a no-op or a recording double.',
    detail: 3,
    variants: [OPS],
    payload: { title: 'Arguments', format: 'args', data: { change: 'updated', request: EXAMPLE_REQUEST_DTO }, typeRef: 'sh:operations#OperationsRequestDTO' },
    sources: [src(OPS_ROUTES, 147, 151, "app.opsRealtime.requestChanged('updated', request)"), src(`${BE}/index.ts`, 15, 18, 'opsRealtime.bind(io)')],
  },
  {
    id: 'emit-room',
    kind: 'event',
    title: 'Broadcast to the "ops" room only',
    from: PUBLISHER,
    to: OPS_EVENT,
    label: "io.to('ops').emit('ops:request_changed', { change, request })",
    narrative:
      'The publisher wraps the arguments in `{ change, request }` and emits `ops:request_changed` to the room `ops` — not to all sockets. Only sockets the server itself joined to that room at connect receive it.',
    audience: {
      executive: 'The server pushes the change to staff consoles — and only to staff consoles.',
      systems: 'Room-scoped Socket.IO broadcast. No per-client subscription and no acknowledgement; a console that is offline catches up from `GET /api/ops/requests` on its next load.',
    },
    detail: 2,
    variants: [OPS],
    payload: { title: 'ops:request_changed', format: 'socket', data: { change: 'updated', request: EXAMPLE_REQUEST_DTO }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['change', 'request.status'] },
    sources: [src(OPSRT, 42, 45, 'to(OPS_REALTIME_ROOM).emit(SOCKET_EVENTS.opsRequestChanged'), src(`${SH}/constants.ts`, 40, 47, "export const OPS_REALTIME_ROOM = 'ops'")],
  },
  {
    id: 'action-response',
    kind: 'response',
    title: '200 — the acting console also gets the HTTP response',
    from: ROUTES,
    to: OPERATIONS,
    label: '200 { request }',
    narrative: 'The same updated request returns to Sam\'s console as the HTTP response, and the data provider upserts it into its queue state straight away.',
    detail: 3,
    variants: [OPS],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', data: { request: EXAMPLE_REQUEST_DTO }, typeRef: 'sh:operations#OperationsRequestDTO' },
    sources: [src(OPS_ROUTES, 147, 151, 'return reply.send({ request })'), src(OP_DATA, 104, 111, 'upsertRequest(updated)')],
  },
  {
    id: 'deliver',
    kind: 'event',
    title: 'Every operator console in the room receives it',
    from: OPS_EVENT,
    to: OPS_SOCKET,
    label: 'ops:request_changed',
    narrative:
      'Sam\'s socket — and the socket of every other signed-in operator — receives the event. `useOpsSocket` forwards the payload to the latest `onRequestChanged` handler, held in a ref so that changing handlers never reconnects the socket.',
    audience: {
      executive: 'Every member of staff with the console open sees the queue change at once, without refreshing.',
      'end-user': 'Other bank employees see the request change on their screens immediately.',
    },
    detail: 1,
    variants: [OPS],
    payload: { title: 'ops:request_changed', format: 'socket', data: { change: 'updated', request: EXAMPLE_REQUEST_DTO }, typeRef: 'sh:operations#OpsRequestChangedPayload' },
    sources: [src(OP_SOCKET, 51, 53, 'socket.on(SOCKET_EVENTS.opsRequestChanged'), src(OP_SOCKET, 31, 34, 'handlersRef.current = handlers')],
  },
  {
    id: 'upsert',
    kind: 'client',
    title: 'The console upserts the request by id',
    from: OPS_SOCKET,
    to: OPERATIONS,
    label: 'onRequestChanged → upsertRequest(request)',
    narrative:
      'The data provider replaces the request with the same id, or prepends it if new. For Sam this is an echo of the change already applied from the HTTP response, so it is idempotent; for other operators it is how the change arrives. Queue counts are recomputed from the list.',
    detail: 2,
    variants: [OPS],
    sources: [src(OP_DATA, 41, 49, 'const upsertRequest'), src(OP_DATA, 96, 102, 'onRequestChanged: ({ request }) => upsertRequest(request)')],
  },

  // ---- 5. Customer app and the socket server ----------------------------------------
  {
    id: 'customer-no-socket',
    kind: 'note',
    title: 'The customer app opens no socket',
    from: CUSTOMER,
    to: CUSTOMER,
    label: 'HTTP only',
    narrative:
      'At this commit nothing under `apps/customer/src` imports `socket.io-client`. The package is listed in the app\'s dependencies and `lib/api.ts` resolves and exports a `WS_URL`, but no code uses it. Customers therefore see an operator\'s decision the next time a page fetches data, not by push.',
    audience: {
      executive: 'The customer website does not use the live channel; it asks the server for fresh data when a page loads.',
      systems: 'No WebSocket from the customer origin in practice. The backend is nonetheless written — and tested — to be safe if one connects.',
    },
    detail: 2,
    variants: [CUST],
    sources: [src(CU_API, 23, 29, 'const WS_URL', 'Resolved and exported, never imported elsewhere'), src('apps/customer/package.json', 14, 22, 'socket.io-client', 'Declared dependency')],
    confidence: 'inferred',
  },
  {
    id: 'customer-origin-socket',
    kind: 'guard',
    title: 'What the server does with a customer-origin socket',
    from: SOCKET_SERVER,
    to: SOCKET_SERVER,
    label: "audience !== 'operations' → no room",
    narrative:
      'The integration test connects a real socket from the customer origin with a valid customer session cookie. It receives `sim:welcome` and would receive every `sim:heartbeat`, but `joinOpsRoomIfOperator` returns at its first check — the surface is not `operations` — so the socket is never in the `ops` room. The same holds for an anonymous socket, and for a customer-role session presented on the operations surface.',
    audience: { executive: 'Even if a customer\'s browser connected to the live channel, it would receive nothing but a greeting and the clock.' },
    detail: 3,
    variants: [CUST],
    payload: { title: 'Decision', format: 'return', data: { audience: 'customer', joined: null, receives: ['sim:welcome', 'sim:heartbeat'] }, highlight: ['joined'] },
    sources: [src(RT, 81, 85, "if (audience !== 'operations') return"), src(RT, 16, 27, 'NEVER joins the ops room'), src(RT_TEST, 81, 117, 'expect(custEvents).toHaveLength(0)', 'Pinned by test')],
  },
  {
    id: 'meanwhile-emit',
    kind: 'event',
    title: 'Meanwhile: an operations event goes to the ops room only',
    from: PUBLISHER,
    to: OPS_EVENT,
    label: "io.to('ops').emit('ops:request_changed', …)",
    narrative:
      'When an operator acts on Avery\'s request, the publisher emits `ops:request_changed` to the room `ops`. No customer or anonymous socket is ever in that room, so operator-facing payloads — which include customer names and email addresses — cannot reach a customer browser, even though both apps share one Socket.IO server.',
    audience: {
      executive: 'Staff updates are pushed only to staff. Customer browsers never receive back-office data.',
      systems: 'Isolation is by server-side room membership, not by separate servers or namespaces.',
    },
    detail: 1,
    variants: [CUST],
    payload: { title: 'ops:request_changed (ops room only)', format: 'socket', data: { change: 'updated', request: EXAMPLE_REQUEST_DTO }, typeRef: 'sh:operations#OpsRequestChangedPayload' },
    sources: [src(OPSRT, 12, 26, 'never receives operator-facing data'), src(OPSRT, 42, 45, 'to(OPS_REALTIME_ROOM)')],
  },
];

export const scenario: Scenario = {
  id: 'app-communication',
  title: 'How the apps and the backend talk',
  question: 'How do the customer application, operations simulator and backend communicate?',
  summary:
    'Both apps are static single-page apps that talk to one backend. Over HTTP they probe `/status`, restore a cookie session (each app has its own session cookie, chosen by a surface header), and echo a CSRF token on every state-changing request. The operations console also holds one Socket.IO connection: the server greets it, decides at the handshake whether to join it to the staff-only `ops` room, sends a heartbeat every 10 seconds, and pushes operations events to that room alone. The customer app uses HTTP only.',
  category: 'integration',
  tags: ['realtime', 'security', 'auth', 'integration'],
  participants: [CUSTOMER, OPERATIONS, OPS_SOCKET, CSRF_HOOK, REQUIRE_AUTH, ROUTES, SOCKET_SERVER, PUBLISHER, OPS_EVENT],
  related: [
    'customer',
    'operations',
    'backend',
    'be.realtime',
    'be:realtime#attachRealtime',
    'be:realtime#joinOpsRoomIfOperator',
    'be:ops/realtime#SocketOpsRealtime',
    'be:ops/realtime#OpsRealtime',
    'be:auth/csrf#csrfHook',
    'be:auth/guards#requireAuth',
    'be:auth/cookies#sessionAudienceForRequest',
    'ep:GET /status',
    'ep:GET /api/auth/me',
    'ev:sim:welcome',
    'ev:sim:heartbeat',
    'ev:ops:request_changed',
    'ev:ops:external_event',
    'sh:constants#SOCKET_EVENTS',
    'sh:constants#OPS_REALTIME_ROOM',
    'sh:public-demo#resolveApiBaseUrl',
    'op:lib/useOpsSocket',
    'op:lib/api',
    'op:lib/OpsDataContext',
    'cu:lib/api',
    'cu:lib/auth',
    'cu:lib/csrf',
    'cu:lib/AuthProvider',
    'feat:realtime',
    'feat:csrf',
  ],
  variants: [
    { id: OPS, label: 'Operations console', description: 'A staff session: HTTP with the surface header and CSRF echo, plus a socket that is joined to the `ops` room and receives `ops:request_changed`.', outcome: 'info' },
    { id: CUST, label: 'Customer app', description: 'A customer session: HTTP only, default surface, CSRF echo. No socket is opened, and a customer-origin socket would never join the `ops` room.', outcome: 'info' },
  ],
  defaultVariant: OPS,
  initialState: {
    ...baseState(),
    Session: [
      { id: 'ses_ops', userId: IDS.sam, tokenHash: OPS_SESSION_HASH, createdAt: LOGGED_IN_AT, lastSeenAt: '2026-10-01T14:45:00.000Z', expiresAt: '2026-10-01T22:45:00.000Z', revokedAt: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (demo browser)' },
      { id: 'ses_cust', userId: IDS.avery, tokenHash: CUST_SESSION_HASH, createdAt: LOGGED_IN_AT, lastSeenAt: '2026-10-01T14:50:00.000Z', expiresAt: '2026-10-01T22:50:00.000Z', revokedAt: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (demo browser)' },
    ],
  },
  steps,
  sources: [
    src(RT, 16, 27, 'Room RBAC'),
    src(CSRF, 7, 28, 'a double-submit token'),
    src(COOKIES, 6, 29, 'each surface has its OWN session cookie'),
    src('docs/PUBLIC_DEMO_DEPLOYMENT.md', 62, 71, '/socket.io/*', 'Reverse-proxy path prefixes'),
  ],
};
