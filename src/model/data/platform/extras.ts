import type { GlossaryTerm, StateMachine } from '../../types';
import { BE, src } from './helpers';

const SESSIONS = `${BE}/auth/sessions.ts`;
const LOCKOUT = `${BE}/auth/lockout.ts`;
const AUTHR = `${BE}/routes/auth.ts`;

export const stateMachines: StateMachine[] = [
  {
    id: 'sm:session',
    name: 'Session lifecycle',
    summary: 'A session row is live from login until it is revoked by logout or left idle for eight hours; there is no status column — the state is derived. (The browser cookie is set once, at login, with an 8-hour max-age and is not re-issued when the server-side expiry slides.)',
    subject: 'db:Session',
    field: 'Session.revokedAt / Session.expiresAt (derived)',
    initial: 'none',
    states: [
      { id: 'none', label: 'No session', description: 'No row. The browser has no session cookie for this surface, or one that matches nothing.' },
      { id: 'active', label: 'Active', description: '`revokedAt` is null, `expiresAt` is in the future and the user\'s status is `active`. Each authenticated request pushes `expiresAt` to now + 8 hours.' },
      { id: 'expired', label: 'Expired', description: '`expiresAt` has passed. Nothing writes this state; `resolveSession` simply stops accepting the token and the guard clears the cookie.', terminal: true },
      { id: 'revoked', label: 'Revoked', description: '`revokedAt` is set. The token can never be used again.', terminal: true },
    ],
    transitions: [
      {
        from: 'none',
        to: 'active',
        label: 'login succeeds',
        by: 'be:auth/sessions#createSession',
        description: 'Inserts the row with `tokenHash = sha256(token)`, `createdAt = lastSeenAt = now`, `expiresAt = now + 8 h`; the raw token goes only into the cookie.',
        source: src(SESSIONS, 24, 43, 'export async function createSession'),
      },
      {
        from: 'active',
        to: 'active',
        label: 'authenticated request (slide)',
        by: 'be:auth/sessions#resolveSession',
        description: 'Updates `lastSeenAt = now` and `expiresAt = now + 8 h` on every request that passes `requireAuth`, and on an operator\'s Socket.IO handshake.',
        source: src(SESSIONS, 64, 68, 'Sliding idle timeout'),
      },
      {
        from: 'active',
        to: 'expired',
        label: '8 hours with no request',
        by: 'be:auth/sessions#resolveSession',
        description: 'Passive: time passes. The next `resolveSession` sees `expiresAt <= now`, returns null, and `requireAuth` answers 401 `session_expired`.',
        source: src(SESSIONS, 60, 62, 'session.expiresAt.getTime() <= now.getTime()'),
        confidence: 'simplified',
      },
      {
        from: 'active',
        to: 'revoked',
        label: 'logout',
        by: 'be:auth/sessions#revokeSession',
        description: '`updateMany` sets `revokedAt = now` where the token hash matches and `revokedAt` is null (idempotent).',
        source: src(SESSIONS, 74, 85, 'export async function revokeSession'),
      },
    ],
    sources: [src(SESSIONS, 5, 9, 'Server-side session lifecycle'), src(SESSIONS, 60, 62, "session.user.status !== 'active'", 'A disabled user\'s sessions stop resolving without any row change')],
  },
  {
    id: 'sm:login-lockout',
    name: 'Login lockout',
    summary: 'Five failed sign-ins in a row lock an account for fifteen minutes; a success, or the lock expiring, clears the count.',
    subject: 'db:User',
    field: 'User.failedLoginAttempts / User.lockedUntil',
    initial: 'clear',
    states: [
      { id: 'clear', label: 'Clear', description: '`failedLoginAttempts = 0`, `lockedUntil = null`.' },
      { id: 'counting', label: 'Counting failures', description: '1–4 consecutive failures recorded, no lock. (A seeded showcase account in public-demo mode stays here however high the count goes.)' },
      { id: 'locked', label: 'Locked', description: '`lockedUntil` is in the future. Every attempt — even with the correct password — is refused with 423 and recorded in login history.' },
      { id: 'lock-expired', label: 'Lock expired', description: '`lockedUntil` has passed but the row still holds the old count. The next attempt is processed as if the counters were zero.' },
    ],
    transitions: [
      { from: 'clear', to: 'counting', label: 'wrong password', by: 'be:auth/lockout#registerFailure', description: 'Counter becomes 1; persisted on the User row by the login handler.', source: src(LOCKOUT, 34, 44, 'export function registerFailure') },
      { from: 'counting', to: 'counting', label: 'wrong password (count < 5)', by: 'be:auth/lockout#registerFailure', source: src(LOCKOUT, 34, 44, 'failedLoginAttempts + 1') },
      {
        from: 'counting',
        to: 'locked',
        label: '5th wrong password',
        by: 'be:auth/lockout#registerFailure',
        description: 'Sets `lockedUntil = now + 15 min`. The handler records the LoginEvent with reason `account_locked`, writes an `account_locked` AuditLog row and answers 423.',
        source: src(AUTHR, 158, 180, 'justLocked'),
      },
      { from: 'counting', to: 'clear', label: 'correct password', by: 'be:auth/lockout#registerSuccess', description: 'Counters reset and `lastLoginAt` stamped.', source: src(AUTHR, 184, 193, 'registerSuccess()') },
      { from: 'locked', to: 'locked', label: 'any attempt while locked', by: 'be:auth/lockout#isLocked', description: 'Refused before the password is checked; no change to the User row.', source: src(AUTHR, 134, 146, 'isLocked(state, now)') },
      { from: 'locked', to: 'lock-expired', label: '15 minutes pass', by: 'be:auth/lockout#isLocked', description: 'Passive: nothing is written when the lock expires.', source: src(LOCKOUT, 17, 20, 'export function isLocked'), confidence: 'simplified' },
      { from: 'lock-expired', to: 'counting', label: 'wrong password', by: 'be:auth/lockout#normalizeForAttempt', description: 'The expired lock is normalised to zero first, so this failure is counted as the first of a new window — it does not re-lock.', source: src(LOCKOUT, 22, 32, 'export function normalizeForAttempt') },
      { from: 'lock-expired', to: 'clear', label: 'correct password', by: 'be:auth/lockout#registerSuccess', source: src(LOCKOUT, 46, 49, 'export function registerSuccess') },
    ],
    sources: [src(LOCKOUT, 3, 11, 'Policy'), src(AUTHR, 51, 67, 'lockoutExempt', 'Public-demo exemption for seeded showcase accounts')],
  },
];

export const glossary: GlossaryTerm[] = [
  {
    term: 'Surface (session audience)',
    definition:
      'Which front-end app a request belongs to: `customer` or `operations`. Each surface has its own session cookie (`mer_session`, `mer_ops_session`) because the two apps share one backend and browser cookies are not isolated by port. The backend picks the surface from the `x-meridian-surface` header, then the `Origin` header, defaulting to `customer`. A surface only selects which cookie is read; it never grants access.',
    related: ['sh:auth#SESSION_AUDIENCES', 'be:auth/cookies#sessionAudienceForRequest', 'sh:auth#AUTH', 'be:auth/guards#requireAuth'],
    aliases: ['session audience', 'session cookie audience', 'surface header', 'x-meridian-surface', 'mer_session', 'mer_ops_session'],
  },
  {
    term: 'Session',
    definition:
      'A signed-in browser. The browser holds an opaque random token in an httpOnly cookie; the database holds only the SHA-256 hash of it in a `Session` row. On the server a session stays live while it is used at least once every eight hours and ends when the user logs out (revoked) or goes idle (expired). The cookie itself is set only at login with an 8-hour max-age, so a browser stops sending it eight hours after sign-in.',
    related: ['db:Session', 'be:auth/sessions#createSession', 'be:auth/sessions#resolveSession', 'be:auth/sessions#revokeSession', 'be:auth/tokens#hashSessionToken'],
    aliases: ['session cookie', 'idle timeout', 'sliding expiry'],
  },
  {
    term: 'Double-submit CSRF token',
    definition:
      'A defence against another website making a signed-in browser perform actions. The backend sets a readable cookie (`mer_csrf`); the app copies its value into the `x-meridian-csrf` header on every state-changing request; the backend rejects the request with 403 `csrf_failed` unless header and cookie match. An attacker\'s site can neither read the cookie nor set the header. Login, logout and the public account application are exempt.',
    related: ['be:auth/csrf#csrfHook', 'be:auth/csrf#EXEMPT_PATHS', 'sh:auth#AUTH', 'feat:csrf'],
    aliases: ['CSRF', 'double submit', 'mer_csrf', 'x-meridian-csrf', 'csrf_failed'],
  },
  {
    term: 'Lockout',
    definition:
      'After five failed sign-ins in a row an account is locked for fifteen minutes: every attempt, even with the right password, gets HTTP 423 `account_locked`. A successful sign-in or an expired lock resets the count. In public-demo mode the seeded showcase accounts are exempt, because their passwords are public and a lock would only let one visitor deny the demo to everyone.',
    related: ['be:auth/lockout', 'be:auth/lockout#registerFailure', 'be:routes/auth#lockoutExempt', 'ep:POST /api/auth/login', 'db:User'],
    aliases: ['account locked', 'failed attempts', '423'],
  },
  {
    term: 'Public-demo mode',
    definition:
      'An explicit, opt-in posture (`PUBLIC_DEMO=true`) for running Meridian as a shared, disposable demo on the public internet. It turns on a shared-demo warning in both apps, stops real visitor IPs and user-agents being stored (a constant `public-demo` placeholder is written instead), exempts seeded accounts from lockout, enables in-memory rate limits and adds `X-Robots-Tag`. It is never inferred from `NODE_ENV=production`.',
    related: ['be:config#RuntimeConfig', 'sh:public-demo', 'be:abuse/rate-limit#rateLimit', 'be:auth/guards#requestContext', 'sh:public-demo#PUBLIC_DEMO_PLACEHOLDER', 'feat:rate-limits'],
    aliases: ['PUBLIC_DEMO', 'shared demo', 'public demo'],
  },
  {
    term: 'Rate-limit bucket',
    definition:
      'A named budget of requests per time window per client — for example `login`: 20 per 5 minutes. Anonymous routes are counted per IP, authenticated routes per user id. Counters live only in the server\'s memory. When a budget is spent the API answers HTTP 429 `rate_limited` with a `Retry-After` header. Active only in public-demo mode.',
    related: ['sh:public-demo#PUBLIC_DEMO_RATE_LIMITS', 'be:abuse/rate-limit#rateLimit', 'be:abuse/rate-limit#mutationValveHook', 'be:abuse/rate-limit#FixedWindowLimiter'],
    aliases: ['rate limit', '429', 'rate_limited', 'mutation valve'],
  },
  {
    term: 'Resource cap',
    definition:
      'A ceiling on how many live rows of something one user or resource may have at once — 25 active schedules per user, 8 live cards per account, and so on. Enforced in every mode; exceeding one returns HTTP 409 `limit_reached`. Cancelling or resolving an item frees capacity.',
    related: ['sh:public-demo#RESOURCE_CAPS'],
    aliases: ['limit_reached', 'cap', 'quota'],
  },
  {
    term: 'Ops room',
    definition:
      'The Socket.IO room named `ops`. A socket is joined to it by the server, at connect time, only when its handshake carries a valid operations session for an `ops_agent` or `admin`. Operations events are broadcast to this room alone, which is what keeps staff data off customer and anonymous sockets that share the same Socket.IO server.',
    related: ['sh:constants#OPS_REALTIME_ROOM', 'be:realtime#joinOpsRoomIfOperator', 'be:ops/realtime#SocketOpsRealtime', 'ev:ops:request_changed', 'ev:ops:external_event'],
    aliases: ['operators room', 'OPS_REALTIME_ROOM', 'socket room'],
  },
  {
    term: 'Heartbeat',
    definition:
      'The `sim:heartbeat` Socket.IO event the server broadcasts to every connected socket every 10 seconds, carrying the real server time and the current simulated date. The operations console uses it to keep the displayed simulation date live without polling.',
    related: ['ev:sim:heartbeat', 'be:realtime#emitHeartbeat', 'db:SimulationClock'],
    aliases: ['sim:heartbeat', 'tick'],
  },
  {
    term: 'RBAC (role-based access control)',
    definition:
      'Access decided by the user\'s role. Meridian has four roles — `customer`, `joint_customer`, `ops_agent`, `admin`. `requireRole` gates staff endpoints (`/api/ops/*` for ops_agent and admin, `/api/admin/*` for admin only) and the same staff roles gate the Socket.IO ops room. What a customer may see within the customer endpoints is decided separately, per account, by account relationships.',
    related: ['sh:types#USER_ROLES', 'be:auth/guards#requireRole', 'be:ops/realtime#isOperatorRole', 'feat:rbac'],
    aliases: ['roles', 'authorization', 'forbidden'],
  },
  {
    term: 'Account relationship',
    definition:
      'How a user is connected to an account they may access: `owner`, `joint`, `authorized` or `viewer`. Stored as an `AccountAccess` row per (user, account); the owner is also recorded on `Account.userId`. A user with no relationship to an account gets 403 for it, or 404 if it does not exist.',
    related: ['sh:auth#ACCOUNT_RELATIONSHIPS', 'be:auth/access#getAccountRelationship', 'db:AccountAccess', 'sh:auth#AccountSummary'],
    aliases: ['owner', 'joint', 'authorized', 'viewer', 'account access'],
  },
  {
    term: 'Audit log',
    definition:
      'The `AuditLog` table: one row per sensitive or money-moving action, recording the actor, their role, the action, the entity it touched, an optional reason and JSON metadata. Sign-in, sign-out and account lock-outs are written here by the auth routes; every other domain uses the same `writeAudit` function.',
    related: ['be:auth/audit#writeAudit', 'db:AuditLog', 'feat:audit'],
    aliases: ['audit trail', 'AuditLog'],
  },
  {
    term: 'Login history',
    definition:
      'The `LoginEvent` table: one row per sign-in attempt, successful or not, with the reason (`ok`, `invalid_credentials`, `account_locked`, `account_disabled`). A customer sees their ten most recent rows as "recent sign-in activity". Attempts against an unknown email are stored with no user id.',
    related: ['be:auth/audit#recordLoginEvent', 'db:LoginEvent', 'ep:GET /api/auth/login-history', 'sh:auth#LOGIN_REASONS'],
    aliases: ['LoginEvent', 'recent sign-in activity'],
  },
  {
    term: 'Same-origin API',
    definition:
      'In a production build each app sends API and Socket.IO traffic to the hostname it was served from; a reverse proxy on that host forwards `/api/*`, `/health`, `/status` and `/socket.io/*` to the backend, which listens only on loopback. There is no separate public API hostname. In local development the apps call `http://localhost:3000` instead.',
    related: ['sh:public-demo#resolveApiBaseUrl', 'be:config#RuntimeConfig', 'be:server#buildServer'],
    aliases: ['reverse proxy', 'API base URL', 'VITE_API_URL'],
  },
];
