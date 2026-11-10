import type { Entity, Relation } from '../../types';
import { BE, SH, rel, src } from './helpers';

/** Test files that pin the platform, auth, abuse and realtime behaviour. */

interface TestDef {
  file: string;
  name: string;
  summary: string;
  description: string;
  tags: string[];
  tech?: string[];
  /** [start, end, symbol, note] */
  sources: [number, number, string, string?][];
  /** [target entity id, label, start, end, symbol] */
  pins: [string, string, number, number, string][];
}

const TESTS: TestDef[] = [
  {
    file: `${BE}/routes/auth.test.ts`,
    name: 'routes/auth.test.ts',
    summary: 'Drives login, lockout, the session lifecycle, login history and audit through the real server with `app.inject()`.',
    description:
      'Pins: a valid login returns the user without a password hash and sets an httpOnly cookie; the email is case-insensitive; a wrong password and an unknown email both return the same 401 `invalid_credentials`; a disabled account returns 403; five failures return 423 and even the correct password is then refused; locking writes an `account_locked` AuditLog row; `/api/auth/me` returns 401 `unauthenticated` without a cookie and 401 `session_expired` for a bogus one; logout revokes the session (also with an empty `application/json` body); an expired session is treated as logged out; every attempt appears in login history, newest first.',
    tags: ['tests', 'auth', 'security', 'audit'],
    sources: [
      [25, 40, 'accepts valid credentials, returns the user, and sets an httpOnly cookie', 'Login success'],
      [92, 113, 'locks the account after the configured number of failures', 'Lockout'],
      [155, 167, 'logout revokes the session so the cookie can no longer be used', 'Logout'],
      [201, 229, 'records every attempt and writes an audit row on success', 'History + audit'],
    ],
    pins: [
      ['ep:POST /api/auth/login', 'login outcomes: 200 / 400 / 401 / 403 / 423', 25, 90, "describe('login'"],
      ['be:auth/lockout', 'lock after AUTH.maxFailedAttempts failures', 92, 113, 'AUTH.maxFailedAttempts'],
      ['ep:GET /api/auth/me', '401 unauthenticated / session_expired / 200', 131, 153, 'GET /api/auth/me requires a session'],
      ['ep:POST /api/auth/logout', 'revokes the session; tolerates an empty JSON body', 155, 182, '/api/auth/logout'],
      ['be:auth/sessions#resolveSession', 'an expired session is logged out', 184, 198, 'treats an expired session as logged out'],
      ['ep:GET /api/auth/login-history', 'newest first, success + failure rows', 201, 229, '/api/auth/login-history'],
      ['be:auth/audit#writeAudit', "AuditLog rows for 'login' and 'account_locked'", 115, 128, "action: 'account_locked'"],
    ],
  },
  {
    file: `${BE}/routes/csrf.test.ts`,
    name: 'routes/csrf.test.ts',
    summary: 'Pins the double-submit CSRF hook: when a token is issued, when a mutating request is rejected, and what is exempt.',
    description:
      'A safe GET issues `mer_csrf` to a brand-new client; login seeds it too. An authenticated POST with no header, or a header that does not match the cookie, gets 403 `csrf_failed`; with a matching header it passes the gate. An unauthenticated POST is not gated (the auth guard answers 401), and logout and the public onboarding submit need no header.',
    tags: ['tests', 'security', 'auth'],
    sources: [[7, 14, 'CSRF protection (v1.0.0 / SEC-1)', 'What is pinned'], [43, 58, "expect(res.json().code).toBe('csrf_failed')", 'Rejections']],
    pins: [
      ['be:auth/csrf#csrfHook', 'issue on safe GET; 403 csrf_failed on missing / mismatched header; exemptions', 33, 82, 'csrf_failed'],
      ['be:auth/csrf#EXEMPT_PATHS', 'logout and public onboarding are not gated', 73, 82, 'does NOT gate exempt paths'],
    ],
  },
  {
    file: `${BE}/routes/rbac.test.ts`,
    name: 'routes/rbac.test.ts',
    summary: 'Pins role-based access: own-accounts scoping, per-account ownership checks and the staff-only endpoints.',
    description:
      'The owner sees all of their accounts with derived balances; a joint user sees only the shared account, marked `joint`; an operator sees no banking accounts. A joint user is refused (403 `forbidden`) on an account they were not granted, an operator is refused on a customer account, and an unknown id returns 404. `/api/ops/summary` allows ops and admin and refuses customers; `/api/admin/users` is admin-only and never returns password hashes.',
    tags: ['tests', 'rbac', 'security'],
    sources: [[29, 66, 'own-accounts scoping'], [68, 101, 'ownership checks'], [103, 136, 'role-gated endpoints']],
    pins: [
      ['be:auth/access#listAccessibleAccounts', 'owner sees all; joint sees only the shared account; operator sees none', 29, 66, 'own-accounts scoping'],
      ['be:auth/access#getAccessibleAccount', '200 / 403 forbidden / 404', 68, 101, 'ownership checks'],
      ['be:auth/guards#requireRole', 'ops + admin allowed, customer 403; admin-only route', 103, 136, "expect(denied.json().code).toBe('forbidden')"],
    ],
  },
  {
    file: `${BE}/routes/session-isolation.test.ts`,
    name: 'routes/session-isolation.test.ts',
    summary: 'Regression test for cross-app session bleed: the customer app and the operations console hold independent sessions in one browser.',
    description:
      'Drives the backend as two browser tabs would — both cookies present on every request. Each surface is issued a differently named cookie; the customer surface reads only `mer_session` and the operations surface only `mer_ops_session`; a customer logout leaves the operations session working, and an operations logout leaves the customer session working.',
    tags: ['tests', 'auth', 'security'],
    sources: [[7, 21, 'Cross-app session isolation'], [81, 94, 'reads only the customer cookie on the customer portal']],
    pins: [
      ['be:auth/cookies#sessionCookieNameForRequest', 'one cookie per surface; only the surface\'s own cookie is read', 69, 94, 'surface-specific cookie'],
      ['ep:POST /api/auth/logout', 'logout affects only the calling surface', 96, 142, 'independent lifecycles'],
      ['sh:auth#SESSION_AUDIENCES', 'customer vs operations cookies', 23, 26, "sessionCookieName('operations')"],
    ],
  },
  {
    file: `${BE}/routes/ops-session-origin.test.ts`,
    name: 'routes/ops-session-origin.test.ts',
    summary: 'Regression test for the v0.6.1 operator sign-in loop: an operations session must resolve on requests that carry no `Origin` header.',
    description:
      'Browsers omit `Origin` on same-origin GETs. With the cookie and the `x-meridian-surface: operations` header but no Origin, `/api/ops/requests` and `/api/auth/me` succeed. An explicit operations Origin without the header still works (fallback). With neither signal the request defaults to the customer surface and gets 401.',
    tags: ['tests', 'auth', 'security'],
    sources: [[7, 24, 'Operations session must resolve on requests that OMIT the `Origin` header'], [98, 104, 'documents the latent default']],
    pins: [
      ['be:auth/cookies#sessionAudienceForRequest', 'surface header trusted ahead of Origin; customer default without either', 65, 104, 'AUTH.surfaceHeader'],
      ['be:auth/guards#requireAuth', 'resolves the ops cookie only when the surface is declared', 65, 104, "url: '/api/ops/requests'"],
    ],
  },
  {
    file: `${BE}/auth/cookies.test.ts`,
    name: 'auth/cookies.test.ts',
    summary: 'Unit tests for surface resolution: the header, the Origin fallback and their precedence.',
    description: 'The header accepts only the exact values `customer` and `operations` (first value if repeated). The Origin fallback recognises the configured ops origin and any origin on the ops port, and defaults to `customer` for a missing or malformed Origin. The header wins over a conflicting Origin.',
    tags: ['tests', 'auth'],
    sources: [[28, 44, "describe('sessionAudienceFromHeader'"], [56, 79, "describe('sessionAudienceForRequest precedence'"]],
    pins: [
      ['be:auth/cookies#sessionAudienceFromHeader', 'exact-match values only', 28, 44, 'sessionAudienceFromHeader'],
      ['be:auth/cookies#sessionAudienceForOrigin', 'ops origin / ops port / customer default', 46, 54, 'sessionAudienceForOrigin'],
      ['be:auth/cookies#sessionAudienceForRequest', 'header ahead of Origin', 56, 79, 'trusts the surface header ahead of the Origin'],
    ],
  },
  {
    file: `${BE}/auth/cookie-security.test.ts`,
    name: 'auth/cookie-security.test.ts',
    summary: 'Pins cookie attributes in both postures: never `Secure` over local http, always `Secure` in production, with the httpOnly split intact.',
    description: 'The session cookie is httpOnly and the CSRF cookie is not, in both postures; both are `SameSite=Lax`, `Path=/` and share the 8-hour max-age. Logout clears the cookie with matching attributes.',
    tags: ['tests', 'security', 'auth'],
    sources: [[10, 18, 'Cookie attributes across BOTH deployment postures'], [101, 115, 'production posture: the SAME cookies gain Secure']],
    pins: [
      ['be:auth/cookies#sessionCookieOptions', 'httpOnly, lax, path /, Secure by posture', 18, 59, 'sessionCookieOptions(false)'],
      ['be:auth/csrf#csrfCookieOptions', 'NOT httpOnly; same base attributes', 18, 59, 'csrfCookieOptions(false)'],
      ['be:auth/cookies#clearedCookieOptions', 'logout clears with matching Secure', 117, 130, 'logout clears the cookie with matching Secure attributes'],
    ],
  },
  {
    file: `${BE}/auth/lockout.test.ts`,
    name: 'auth/lockout.test.ts',
    summary: 'Unit tests for the pure lockout maths: no lock before the threshold, a lock exactly at it for 15 minutes, and a clean slate after expiry.',
    description: 'Also pins that a success clears all state, that a single failure after an expired lock does not immediately re-lock, and that normalising a still-active lock returns the same object.',
    tags: ['tests', 'auth', 'security'],
    sources: [[14, 34, 'locks exactly at the threshold for the configured duration'], [44, 55, 'normalizing after the lock window starts a fresh attempt budget']],
    pins: [
      ['be:auth/lockout#registerFailure', 'locks exactly at AUTH.maxFailedAttempts', 15, 34, 'registerFailure(state, NOW)'],
      ['be:auth/lockout#isLocked', 'locked until lockedUntil, free after', 24, 34, 'isLocked(state, new Date(expectedUntil - 1))'],
      ['be:auth/lockout#registerSuccess', 'success clears all state', 36, 42, 'registerSuccess()'],
      ['be:auth/lockout#normalizeForAttempt', 'fresh budget after expiry; active lock untouched', 44, 61, 'normalizeForAttempt(state, afterExpiry)'],
    ],
  },
  {
    file: `${BE}/auth/tokens.test.ts`,
    name: 'auth/tokens.test.ts',
    summary: 'Unit tests for session tokens: 64 hex characters, unique each time, hashed deterministically to a SHA-256 hex digest.',
    description: 'Fifty generated tokens are all distinct; the hash never equals the raw token.',
    tags: ['tests', 'auth'],
    sources: [[5, 23, 'session tokens (pure)']],
    pins: [
      ['be:auth/tokens#generateSessionToken', 'hex, AUTH.sessionTokenBytes * 2 long, unique', 6, 16, 'generateSessionToken()'],
      ['be:auth/tokens#hashSessionToken', 'deterministic sha256 hex', 18, 27, 'hashSessionToken(token)'],
    ],
  },
  {
    file: `${BE}/auth/password.test.ts`,
    name: 'auth/password.test.ts',
    summary: 'Unit tests for bcrypt hashing: salted hashes, correct and wrong passwords, a missing hash, and the decoy hash.',
    description: 'A missing, undefined or empty hash is a failed verification rather than an exception; no real password matches the decoy.',
    tags: ['tests', 'auth'],
    sources: [[4, 32, 'password hashing (bcryptjs)']],
    pins: [
      ['be:auth/password#hashPassword', 'bcrypt hash, salted', 5, 15, 'hashPassword('],
      ['be:auth/password#verifyPassword', 'true / false / never throws on a missing hash', 17, 27, 'verifyPassword('],
      ['be:auth/password#DECOY_PASSWORD_HASH', 'no real password matches', 29, 32, 'DECOY_PASSWORD_HASH'],
    ],
  },
  {
    file: `${BE}/abuse/rate-limit.test.ts`,
    name: 'abuse/rate-limit.test.ts',
    summary: 'Unit tests for the fixed-window limiter: the budget, independent keys, window rollover, bounded memory and the sweep.',
    description: 'Allows `max` hits then blocks with a retry-after; a new window starts exactly when the old one has elapsed; the oldest keys are evicted past `maxKeys`; expired entries are swept every 256 hits; a rule with `max: 0` is rejected.',
    tags: ['tests', 'security', 'public-demo', 'rate-limit'],
    sources: [[4, 15, 'allows up to max hits in a window, then blocks with a retry-after'], [31, 46, 'memory is bounded']],
    pins: [['be:abuse/rate-limit#FixedWindowLimiter', 'budget, key independence, rollover, eviction, sweep, reset', 4, 58, 'new FixedWindowLimiter(']],
  },
  {
    file: `${BE}/routes/public-demo.test.ts`,
    name: 'routes/public-demo.test.ts',
    summary: 'Exercises `PUBLIC_DEMO=true` on the same built server: visitor privacy, the showcase-account lockout exemption, the rate limits and the advertised posture.',
    description:
      'Privacy: Session and LoginEvent rows carry the real IP and user-agent locally but only the `public-demo` placeholder in public-demo mode — on success and on failure. Lockout: with the flag on, looping wrong passwords cannot lock a seeded showcase account (still 401, failures still counted, no lock, no audit row) and a pre-existing lock is ignored, while a non-seeded account still locks. Rate limits: off locally; in public-demo mode login returns 429 with `Retry-After` after 20 attempts per IP, onboarding after 5, money movement is keyed per user, and operator mutations share one bucket. Posture: `/status` reports `publicDemo`, and a server built in the mode adds `X-Robots-Tag`.',
    tags: ['tests', 'public-demo', 'security', 'auth'],
    sources: [[19, 28, 'PUBLIC_DEMO=true behaviour'], [145, 167, 'cannot lock a showcase account'], [215, 235, 'login: 429 with Retry-After']],
    pins: [
      ['be:auth/guards#requestContext', 'placeholder instead of real IP / user-agent', 62, 121, 'PUBLIC_DEMO_PLACEHOLDER'],
      ['be:routes/auth#lockoutExempt', 'showcase accounts never lock in public-demo mode; others do', 123, 203, 'seeded showcase accounts vs the lockout policy'],
      ['be:abuse/rate-limit#rateLimit', '429 + Retry-After per bucket; keyed per IP or per user', 205, 331, "expect(blocked.json().code).toBe('rate_limited')"],
      ['ep:GET /status', 'reports publicDemo', 333, 344, "url: '/status'"],
      ['be:server#buildServer', 'X-Robots-Tag in public-demo mode', 347, 360, "'noindex, nofollow'"],
    ],
  },
  {
    file: `${BE}/routes/caps.test.ts`,
    name: 'routes/caps.test.ts',
    summary: 'Pins the growth bounds that hold in every mode: per-user and per-resource caps (409 `limit_reached`), the 64 KiB body ceiling (413) and login length bounds (400).',
    description: 'Each cap in `RESOURCE_CAPS` is filled to its limit and the next create is refused; cancelling frees capacity. A login body over `MAX_REQUEST_BODY_BYTES` is rejected with 413, and over-long login fields with 400.',
    tags: ['tests', 'security', 'validation', 'public-demo'],
    sources: [[8, 13, 'Server-side growth bounds that hold in EVERY mode'], [191, 198, 'rejects a request body over the ceiling with 413']],
    pins: [
      ['sh:public-demo#RESOURCE_CAPS', '409 limit_reached at each cap; cancelling frees capacity', 43, 68, 'RESOURCE_CAPS.activeSchedulesPerUser'],
      ['sh:public-demo#MAX_REQUEST_BODY_BYTES', '413 over the body ceiling', 191, 198, 'MAX_REQUEST_BODY_BYTES + 100'],
      ['ep:POST /api/auth/login', '400 for over-long fields', 200, 213, 'rejects over-long login fields cheaply with 400'],
    ],
  },
  {
    file: `${BE}/realtime.test.ts`,
    name: 'realtime.test.ts',
    summary: 'Integration test for socket-room RBAC with real Socket.IO clients: only an operator session receives operations events; everyone receives the welcome.',
    description:
      'Boots `attachRealtime` on an ephemeral port and connects three real `socket.io-client` sockets: an operator session from the ops origin, a customer session from the customer origin, and an anonymous socket from the ops origin. After `opsRealtime.requestChanged(\'updated\', …)` only the operator socket has the event; all three received `sim:welcome`.',
    tags: ['tests', 'realtime', 'security', 'rbac'],
    tech: ['socket.io-client'],
    sources: [[12, 20, 'Integration test for the socket-room RBAC'], [81, 121, 'scopes ops events to operator sockets only, while all sockets get welcome']],
    pins: [
      ['be:realtime#joinOpsRoomIfOperator', 'operator joins the room; customer-origin and anonymous sockets do not', 81, 114, 'Only the operator socket joined the ops room'],
      ['be:ops/realtime#SocketOpsRealtime', 'requestChanged reaches the ops room only', 107, 114, "opsRealtime.requestChanged('updated'"],
      ['ev:sim:welcome', 'all three sockets receive the welcome', 95, 117, 'SOCKET_EVENTS.welcome'],
      ['be:realtime#attachRealtime', 'attached to a real listening server', 40, 50, 'attachRealtime(app.server, prisma)'],
    ],
  },
  {
    file: `${BE}/config.test.ts`,
    name: 'config.test.ts',
    summary: 'Pins that deployment posture is decided by two independent flags, `NODE_ENV=production` and `PUBLIC_DEMO=true`, neither inferred from the other.',
    description: 'Local development: plain cookies, no public-demo behaviour, no rate limits, host 127.0.0.1. Production turns on Secure cookies only. `PUBLIC_DEMO=true` enables the limits; `COOKIE_SECURE` and `RATE_LIMITS` override; port and origin lists parse.',
    tags: ['tests', 'config', 'public-demo'],
    sources: [[4, 8, 'Deployment posture is decided by TWO independent flags'], [20, 35, 'NODE_ENV=production turns on Secure cookies but NOT public-demo mode']],
    pins: [
      ['be:config#resolveConfig', 'defaults, the two postures and the overrides', 9, 64, 'resolveConfig({'],
      ['be:config#overrideConfigForTests', 'patches and restores', 66, 74, 'overrideConfigForTests({ publicDemo: !before })'],
    ],
  },
  {
    file: `${BE}/server.test.ts`,
    name: 'server.test.ts',
    summary: 'Smoke tests for the built server: `/health`, `/status`, `/api/meta` and `/` answer with the expected shapes.',
    description: '`/status` reports `APP_VERSION`, the simulation flag and a null revision (not a packaged release).',
    tags: ['tests', 'platform'],
    sources: [[6, 24, 'GET /health returns ok and uptime without touching the database']],
    pins: [
      ['ep:GET /health', 'ok + numeric uptime', 18, 24, "url: '/health'"],
      ['ep:GET /status', 'version, isSimulation, revision null', 26, 36, "url: '/status'"],
      ['ep:GET /api/meta', 'simulation disclaimer', 38, 44, "url: '/api/meta'"],
      ['ep:GET /', 'advertises endpoints', 46, 51, "url: '/'"],
    ],
  },
  {
    file: `${BE}/revision.test.ts`,
    name: 'revision.test.ts',
    summary: 'Unit tests for the release `REVISION` reader: exactly one lowercase 40-character SHA is accepted; anything else, or a missing file, is `null`.',
    description: 'Also pins that `RELEASE_REVISION` is null in a development checkout.',
    tags: ['tests', 'platform', 'deployment'],
    sources: [[7, 12, 'The release `REVISION` file is written by the deployment pipeline']],
    pins: [
      ['be:revision#readRevisionFile', 'accepts one full SHA, rejects malformed / missing', 22, 33, 'readRevisionFile('],
      ['be:revision#RELEASE_REVISION', 'null in local development', 35, 37, 'expect(RELEASE_REVISION).toBeNull()'],
    ],
  },
  {
    file: `${SH}/public-demo.test.ts`,
    name: 'shared/public-demo.test.ts',
    summary: 'Unit tests for the shared public-demo policy: flag parsing, same-origin API resolution and sanity of the limits and caps.',
    description: 'Only explicit truthy spellings enable a flag. A production build uses the browser origin, development the localhost fallback, an explicit override wins, and a blank override means "not set". Every rate-limit rule and resource cap is a small positive number.',
    tags: ['tests', 'public-demo', 'config'],
    sources: [[16, 22, "describe('parseBooleanFlag'"], [24, 73, 'resolveApiBaseUrl (same-origin production routing)']],
    pins: [
      ['sh:public-demo#parseBooleanFlag', 'explicit truthy spellings only', 16, 22, 'parseBooleanFlag(v)'],
      ['sh:public-demo#resolveApiBaseUrl', 'override > production origin > fallback', 24, 73, 'resolveApiBaseUrl({'],
      ['sh:public-demo#PUBLIC_DEMO_RATE_LIMITS', 'every rule positive', 75, 81, 'PUBLIC_DEMO_RATE_LIMITS'],
      ['sh:public-demo#RESOURCE_CAPS', 'every cap a small positive integer', 82, 88, 'RESOURCE_CAPS'],
    ],
  },
];

export const entities: Entity[] = TESTS.map((t) => ({
  id: `test:${t.file}`,
  kind: 'test' as const,
  name: t.name,
  parent: 'tests',
  summary: t.summary,
  description: t.description,
  tags: t.tags,
  tech: t.tech ?? ['Vitest'],
  sources: t.sources.map(([start, end, symbol, note]) => src(t.file, start, end, symbol, note)),
}));

export const relations: Relation[] = TESTS.flatMap((t) =>
  t.pins.map(([target, label, start, end, symbol]) => rel(`test:${t.file}`, target, 'tests', { label, sources: [src(t.file, start, end, symbol)] })),
);
