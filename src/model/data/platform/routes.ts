import type { Contract, Entity, FlowStep, Relation } from '../../types';
import { BE, rel, src } from './helpers';

/**
 * `be.http` — the route registry, the health / status / meta / auth route
 * groups, their endpoints and full contracts.
 */

const INDEX = `${BE}/routes/index.ts`;
const HEALTH = `${BE}/routes/health.ts`;
const STATUS = `${BE}/routes/status.ts`;
const META = `${BE}/routes/meta.ts`;
const AUTHR = `${BE}/routes/auth.ts`;
const CSRF = `${BE}/auth/csrf.ts`;
const RATE = `${BE}/abuse/rate-limit.ts`;
const GUARDS = `${BE}/auth/guards.ts`;
const SESSIONS = `${BE}/auth/sessions.ts`;
const SERVER = `${BE}/server.ts`;

const SIM_NOTICE = 'Simulated banking environment for development and demos only. Not a real bank. No real money, accounts, or transactions.';
const AVERY = { id: 'usr_avery', email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' };

// ---- Flow steps reused by several contracts --------------------------------

const csrfSafeStep: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (safe method)',
  detail: 'GET is a safe method, so nothing is checked. If the request carries no `mer_csrf` cookie the hook sets a fresh one on the response.',
  source: src(CSRF, 86, 93, 'SAFE_METHODS.has(method)'),
};

const csrfExemptStep: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (exempt path)',
  detail: 'The path is on the CSRF exemption list, so no header is required. If the client has no `mer_csrf` cookie yet, one is seeded on this response.',
  source: src(CSRF, 95, 100, 'EXEMPT_PATHS.has(pathOf(req))'),
};

const valveStep: FlowStep = {
  kind: 'hook',
  target: 'be:abuse/rate-limit#mutationValveHook',
  label: 'mutationValveHook',
  detail: 'Public-demo mode only: counts this POST against the `mutations` bucket (200 per 5 minutes per IP). A no-op in local development.',
  rejects: [{ status: 429, code: 'rate_limited', when: 'Public-demo mode and this IP has made more than 200 state-changing requests in the window.' }],
  source: src(RATE, 178, 183, "limiterFor('mutations')"),
};

const requireAuthStep: FlowStep = {
  kind: 'guard',
  target: 'be:auth/guards#requireAuth',
  label: 'requireAuth',
  detail: 'Reads the session cookie for the request\'s surface (`mer_session`, or `mer_ops_session` when the request declares the operations surface) and resolves it to a user.',
  rejects: [
    { status: 401, code: 'unauthenticated', when: 'No session cookie for this surface.' },
    { status: 401, code: 'session_expired', when: 'The cookie does not resolve to a live session (unknown, revoked, expired, or the user is disabled). The dead cookie is cleared.' },
  ],
  source: src(GUARDS, 47, 66, 'export const requireAuth'),
};

const sessionReadStep: FlowStep = {
  kind: 'db-read',
  target: 'db:Session',
  label: 'session.findUnique({ tokenHash }) include user',
  detail: '`resolveSession` hashes the cookie token with SHA-256 and looks the session up by the unique `tokenHash`, joining its user.',
  source: src(SESSIONS, 56, 62, 'prisma.session.findUnique'),
};

const sessionSlideStep: FlowStep = {
  kind: 'db-write',
  target: 'db:Session',
  label: 'session.update({ lastSeenAt, expiresAt })',
  detail: 'Sliding idle timeout: every authenticated request sets `lastSeenAt = now` and `expiresAt = now + 8 hours`.',
  source: src(SESSIONS, 64, 68, 'prisma.session.update'),
};

export const entities: Entity[] = [
  // ---- routes/index.ts ------------------------------------------------------
  {
    id: 'be:routes/index',
    kind: 'module',
    name: 'routes/index.ts',
    parent: 'be.http',
    summary: 'The route registry: one function that registers all thirteen route plugins on the Fastify instance.',
    tags: ['api', 'routes'],
    sources: [src(INDEX, 16, 31, 'export async function registerRoutes')],
  },
  {
    id: 'be:routes/index#registerRoutes',
    kind: 'function',
    name: 'registerRoutes()',
    parent: 'be:routes/index',
    summary: 'Registers every route group, in order: meta, health, status, auth, accounts, ops, onboarding, money, cards, risk, schedules, clock, lending.',
    description: 'Called once by `buildServer()` after the global hooks are in place, so every route in every group runs behind the CSRF hook and the mutation valve. A new feature\'s route group is added here.',
    signature: 'export async function registerRoutes(app: FastifyInstance): Promise<void>',
    tags: ['api', 'routes'],
    sources: [src(INDEX, 16, 31, 'export async function registerRoutes')],
  },

  // ---- route groups ---------------------------------------------------------
  {
    id: 'be:routes/meta',
    kind: 'route-group',
    name: 'routes/meta.ts',
    parent: 'be.http',
    summary: 'Two public descriptors: `GET /` (what this server is) and `GET /api/meta` (static platform metadata).',
    tags: ['api', 'platform'],
    sources: [src(META, 4, 24, 'export async function metaRoutes')],
  },
  {
    id: 'be:routes/health',
    kind: 'route-group',
    name: 'routes/health.ts',
    parent: 'be.http',
    summary: 'The liveness probe, `GET /health`, which deliberately never touches the database.',
    tags: ['api', 'platform', 'deployment'],
    sources: [src(HEALTH, 4, 10, 'export async function healthRoutes')],
  },
  {
    id: 'be:routes/status',
    kind: 'route-group',
    name: 'routes/status.ts',
    parent: 'be.http',
    summary: 'The readiness probe, `GET /status`: version, posture flags, database connectivity and the release revision.',
    tags: ['api', 'platform', 'deployment', 'public-demo'],
    sources: [src(STATUS, 7, 28, 'export async function statusRoutes')],
  },
  {
    id: 'be:routes/auth',
    kind: 'route-group',
    name: 'routes/auth.ts',
    parent: 'be.http',
    summary: 'The authentication endpoints: login (with lockout, login history and audit), logout, the current-user probe and the login history.',
    description:
      'The handlers contain the orchestration themselves rather than delegating to one service: they call the pure lockout functions, the password verifier, the session functions and the two trail writers in sequence. Auth timestamps use the real clock, not the simulation clock.',
    tags: ['api', 'auth', 'security', 'audit'],
    aliases: ['login', 'logout', 'sign in', 'sign out', 'authRoutes'],
    sources: [src(AUTHR, 69, 78, 'export async function authRoutes')],
  },
  {
    id: 'be:routes/auth#lockoutExempt',
    kind: 'function',
    name: 'lockoutExempt()',
    parent: 'be:routes/auth',
    summary: 'True only in public-demo mode for a seeded showcase account, which is then never locked out.',
    description:
      'Module-private. The seeded demo logins have intentionally public passwords, so locking them after five bad guesses protects nothing; it would only let one visitor make the demo unusable for everyone. For those accounts in public-demo mode a failed attempt is still verified against the real bcrypt hash, still recorded and still counted — it just never sets `lockedUntil`, and an existing lock is ignored. Brute-force pressure is bounded by the `login` rate-limit bucket instead. Every other account keeps the normal lockout, and nothing changes when `PUBLIC_DEMO` is off.',
    signature: 'function lockoutExempt(email: string): boolean',
    tags: ['auth', 'security', 'public-demo'],
    sources: [src(AUTHR, 51, 67, 'function lockoutExempt')],
  },

  // ---- endpoints ------------------------------------------------------------
  {
    id: 'ep:GET /',
    kind: 'endpoint',
    name: 'GET /',
    parent: 'be:routes/meta',
    summary: 'Root descriptor: names the API, states that it is a simulation and lists the probe endpoints.',
    tags: ['api', 'platform'],
    sources: [src(META, 6, 13, "app.get('/'")],
  },
  {
    id: 'ep:GET /health',
    kind: 'endpoint',
    name: 'GET /health',
    parent: 'be:routes/health',
    summary: 'Liveness probe: returns `ok` and the process uptime without touching the database.',
    tags: ['api', 'platform', 'deployment'],
    aliases: ['liveness', 'healthcheck'],
    sources: [src(HEALTH, 6, 10, "app.get('/health'")],
  },
  {
    id: 'ep:GET /status',
    kind: 'endpoint',
    name: 'GET /status',
    parent: 'be:routes/status',
    summary: 'Readiness probe: version, simulation flag, environment, public-demo flag, database counts, release revision and server time.',
    audience: { 'end-user': 'What the "Backend online" pill and the shared-demo banner read when a page loads.' },
    tags: ['api', 'platform', 'deployment', 'public-demo'],
    aliases: ['readiness', 'status probe'],
    sources: [src(STATUS, 8, 27, "app.get('/status'")],
  },
  {
    id: 'ep:GET /api/meta',
    kind: 'endpoint',
    name: 'GET /api/meta',
    parent: 'be:routes/meta',
    summary: 'Static platform descriptor: bank name, version, milestone and the simulation disclaimer.',
    tags: ['api', 'platform'],
    sources: [src(META, 15, 23, "app.get('/api/meta'")],
  },
  {
    id: 'ep:POST /api/auth/login',
    kind: 'endpoint',
    name: 'POST /api/auth/login',
    parent: 'be:routes/auth',
    summary: 'Signs a user in with email and password, sets the session cookie for the calling surface and records the attempt.',
    audience: {
      executive: 'Sign-in: checks the password, protects against guessing, and records every attempt.',
      'end-user': 'What happens when you press "Continue" on the sign-in page.',
    },
    tags: ['api', 'auth', 'security', 'audit'],
    aliases: ['login', 'sign in'],
    sources: [src(AUTHR, 76, 98, "app.post('/api/auth/login'")],
  },
  {
    id: 'ep:POST /api/auth/logout',
    kind: 'endpoint',
    name: 'POST /api/auth/logout',
    parent: 'be:routes/auth',
    summary: 'Revokes the calling surface\'s session, clears its cookie and always answers 200.',
    tags: ['api', 'auth', 'security', 'audit'],
    aliases: ['logout', 'sign out'],
    sources: [src(AUTHR, 213, 235, "app.post('/api/auth/logout'")],
  },
  {
    id: 'ep:GET /api/auth/me',
    kind: 'endpoint',
    name: 'GET /api/auth/me',
    parent: 'be:routes/auth',
    summary: 'Returns the signed-in user for the calling surface, or 401 — the call each app makes on load to restore its session.',
    tags: ['api', 'auth'],
    aliases: ['current user', 'session hydration', 'whoami'],
    sources: [src(AUTHR, 237, 241, "app.get('/api/auth/me'")],
  },
  {
    id: 'ep:GET /api/auth/login-history',
    kind: 'endpoint',
    name: 'GET /api/auth/login-history',
    parent: 'be:routes/auth',
    summary: 'Returns the signed-in user\'s ten most recent sign-in attempts, newest first.',
    tags: ['api', 'auth', 'audit'],
    aliases: ['recent sign-in activity', 'login history'],
    sources: [src(AUTHR, 243, 260, "app.get('/api/auth/login-history'")],
  },
];

export const contracts: Contract[] = [
  {
    id: 'ep:GET /',
    method: 'GET',
    path: '/',
    summary: 'Root descriptor for anyone who opens the API origin directly.',
    auth: { required: false, notes: 'Public. No session, no CSRF, no rate limit.' },
    responses: [
      {
        status: 200,
        description: 'A small JSON descriptor.',
        fields: [
          { name: 'name', type: 'string', required: true, description: '`${BRAND.name} Simulated Banking API`.' },
          { name: 'isSimulation', type: 'true', required: true },
          { name: 'message', type: 'string', required: true, description: '`BRAND.simulationNotice`.' },
          { name: 'endpoints', type: 'string[]', required: true },
        ],
        example: { name: 'Meridian Simulated Banking API', isSimulation: true, message: SIM_NOTICE, endpoints: ['/health', '/status', '/api/meta'] },
      },
    ],
    flow: [
      csrfSafeStep,
      { kind: 'respond', target: 'sh:brand#BRAND', label: '200 { name, isSimulation, message, endpoints }', detail: 'Built from the shared `BRAND` tokens; no database access.', source: src(META, 6, 13, 'BRAND.simulationNotice') },
    ],
    mutates: false,
    integrationNotes: 'Not used by either app. In the public deployment the reverse proxy forwards only `/api/*`, `/health`, `/status` and `/socket.io/*`, so `/` on the public hostnames serves the SPA, not this descriptor.',
    sources: [src(META, 6, 13, "app.get('/'")],
  },
  {
    id: 'ep:GET /health',
    method: 'GET',
    path: '/health',
    summary: 'Liveness: is the process up?',
    description: 'Intentionally does not touch the database, so it stays fast and is safe for Playwright and CI to wait on before the database is seeded.',
    auth: { required: false, notes: 'Public.' },
    responses: [{ status: 200, description: 'The process is running.', typeRef: 'sh:types#HealthResponse', example: { status: 'ok', uptimeSeconds: 5321 } }],
    flow: [
      csrfSafeStep,
      { kind: 'respond', target: 'sh:types#HealthResponse', label: "200 { status: 'ok', uptimeSeconds }", detail: '`Math.round(process.uptime())`.', source: src(HEALTH, 7, 9, 'process.uptime()') },
    ],
    mutates: false,
    integrationNotes: 'Use for liveness checks. It says nothing about the database; use `/status` for readiness.',
    sources: [src(HEALTH, 4, 10, "app.get('/health'")],
  },
  {
    id: 'ep:GET /status',
    method: 'GET',
    path: '/status',
    summary: 'Readiness and posture: version, public-demo flag, database connectivity and release revision.',
    description:
      'Both apps fetch it once on load (cached for 15 seconds in the client) to drive the backend-status pill and to decide whether to show the shared-demo warning — the backend flag is authoritative even if a frontend was built without `VITE_PUBLIC_DEMO`. The deployment pipeline reads `revision` to prove the public site serves the release it shipped.',
    auth: { required: false, notes: 'Public. The apps call it without credentials.' },
    responses: [
      {
        status: 200,
        description: 'Always 200; `status` is `degraded` when the database probe failed.',
        typeRef: 'sh:types#StatusResponse',
        example: { status: 'ok', version: '1.0.0', milestone: 'v1.0.0', milestoneName: 'Polish, hardening, loans/CDs & interest', isSimulation: true, environment: 'development', publicDemo: false, database: { connected: true, users: 4, accounts: 4 }, revision: null, serverTime: '2026-10-01T15:00:00.000Z' },
      },
    ],
    flow: [
      csrfSafeStep,
      { kind: 'call', target: 'be:db#checkDatabase', label: 'checkDatabase()', detail: 'Never throws; a failed count becomes `connected: false`.', source: src(STATUS, 9, 10, 'checkDatabase()') },
      { kind: 'db-read', target: 'db:User', label: 'user.count()', source: src(`${BE}/db.ts`, 33, 36, 'prisma.user.count()') },
      { kind: 'db-read', target: 'db:Account', label: 'account.count()', source: src(`${BE}/db.ts`, 33, 36, 'prisma.account.count()') },
      { kind: 'respond', target: 'sh:types#StatusResponse', label: '200 StatusResponse', detail: 'Adds `PLATFORM_META`, `config.environment`, `config.publicDemo`, `RELEASE_REVISION` and the server time.', source: src(STATUS, 11, 26, 'revision: RELEASE_REVISION') },
    ],
    mutates: false,
    calledBy: ['cu:lib/api', 'op:lib/api'],
    integrationNotes: 'Poll this for readiness. `status: "degraded"` means the process is up but the database did not answer. In public-demo mode every API response, including this one, also carries `X-Robots-Tag: noindex, nofollow`.',
    sources: [src(STATUS, 7, 28, "app.get('/status'")],
  },
  {
    id: 'ep:GET /api/meta',
    method: 'GET',
    path: '/api/meta',
    summary: 'Static platform descriptor for clients.',
    auth: { required: false, notes: 'Public.' },
    responses: [
      { status: 200, description: 'Static metadata.', typeRef: 'sh:types#MetaResponse', example: { name: 'Meridian Bank (Simulated)', version: '1.0.0', milestone: 'v1.0.0', isSimulation: true, disclaimer: SIM_NOTICE } },
    ],
    flow: [
      csrfSafeStep,
      { kind: 'respond', target: 'sh:types#MetaResponse', label: '200 MetaResponse', detail: 'Built from `BRAND` and `PLATFORM_META`; no database access.', source: src(META, 15, 23, 'BRAND.legalName') },
    ],
    mutates: false,
    sources: [src(META, 15, 23, "app.get('/api/meta'")],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'ep:POST /api/auth/login',
    method: 'POST',
    path: '/api/auth/login',
    summary: 'Verify an email and password, apply the lockout policy, open a session and set its cookie.',
    description:
      'The same endpoint serves both apps. Which session cookie is set — `mer_session` or `mer_ops_session` — depends on the surface the request declares (`x-meridian-surface` header, else `Origin`, else customer). The endpoint does not check the user\'s role against the surface: a customer who signs in from the operations console gets a valid operations-surface session, and the console itself then signs them back out because their role is not a staff role. Staff-only endpoints remain role-gated regardless.\n\nEvery outcome after input validation writes a `LoginEvent` row. Unknown-email and wrong-password failures return the same generic 401 so the response does not reveal which emails exist, and an unknown email still runs a bcrypt comparison against a decoy hash so timing is similar.',
    auth: {
      required: false,
      surface: 'either',
      csrf: false,
      rateLimit: 'login',
      notes: 'Exempt from CSRF (it runs before a session exists and seeds the first token). In public-demo mode: 20 attempts per 5 minutes per IP, checked before any database or bcrypt work.',
    },
    bodyTypeRef: 'sh:auth#LoginRequest',
    body: [
      { name: 'email', type: 'string', required: true, rules: ['must be a non-empty string', 'trimmed and lower-cased before lookup', 'at most 254 characters (EMAIL_MAX_LENGTH)'] },
      { name: 'password', type: 'string', required: true, rules: ['must be a non-empty string', 'at most 200 characters (LOGIN_PASSWORD_MAX_LENGTH)'] },
    ],
    requestExample: { email: 'avery.customer@example.com', password: '<demo password>' },
    responses: [
      {
        status: 200,
        description: 'Signed in. `Set-Cookie` carries the httpOnly session cookie for the surface (max-age 8 hours) and, for a brand-new client, the readable `mer_csrf` cookie.',
        typeRef: 'sh:auth#AuthResponse',
        example: { user: AVERY },
      },
    ],
    errors: [
      { status: 400, code: 'invalid_request', when: 'Email or password is missing, empty or not a string.', example: { error: 'Email and password are required.', code: 'invalid_request' }, source: src(AUTHR, 79, 86, "code: 'invalid_request'") },
      { status: 400, code: 'invalid_request', when: 'Email longer than 254 characters or password longer than 200.', example: { error: 'Email or password is too long.', code: 'invalid_request' }, source: src(AUTHR, 87, 94, 'Email or password is too long.') },
      { status: 400, when: 'The body is not valid JSON (rejected by the content-type parser before the handler).', source: src(SERVER, 99, 112, 'Request body is not valid JSON.') },
      { status: 413, when: 'The body exceeds 64 KiB (Fastify `bodyLimit`).', source: src(SERVER, 57, 60, 'bodyLimit: MAX_REQUEST_BODY_BYTES') },
      { status: 401, code: 'invalid_credentials', when: 'No user has this email. A LoginEvent with `userId: null` is recorded.', example: { error: 'Invalid email or password.', code: 'invalid_credentials' }, source: src(AUTHR, 100, 112, "code: 'invalid_credentials'") },
      { status: 403, code: 'account_disabled', when: 'The user exists but `status` is not `active`. Checked before the password.', example: { error: 'This account is disabled.', code: 'account_disabled' }, source: src(AUTHR, 114, 125, "code: 'account_disabled'") },
      { status: 423, code: 'account_locked', when: 'The account has an unexpired lock. Even the correct password is refused; the password is not checked.', example: { error: 'This account is temporarily locked due to repeated failed logins. Try again later.', code: 'account_locked' }, source: src(AUTHR, 134, 146, "code: 'account_locked'") },
      { status: 401, code: 'invalid_credentials', when: 'Wrong password and the failure count is still below five. The counter is incremented.', example: { error: 'Invalid email or password.', code: 'invalid_credentials' }, source: src(AUTHR, 149, 182, "code: 'invalid_credentials'") },
      { status: 423, code: 'account_locked', when: 'Wrong password and this is the fifth consecutive failure: the account is locked for 15 minutes and an `account_locked` AuditLog row is written.', example: { error: 'Too many failed attempts — this account is now temporarily locked.', code: 'account_locked' }, source: src(AUTHR, 166, 180, 'this account is now temporarily locked') },
      { status: 429, code: 'rate_limited', when: 'Public-demo mode: the `login` bucket (20 / 5 min per IP) or the global `mutations` valve is exhausted. `Retry-After` header is set.', example: { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' }, source: src(RATE, 142, 150, "code: 'rate_limited'") },
    ],
    flow: [
      csrfExemptStep,
      valveStep,
      {
        kind: 'guard',
        target: 'be:abuse/rate-limit#rateLimit',
        label: "rateLimit('login')",
        detail: 'Runs before any database or bcrypt work so a scripted loop cannot burn CPU on hashing. Keyed by IP because no user is known yet. A no-op outside public-demo mode.',
        rejects: [{ status: 429, code: 'rate_limited', when: 'More than 20 login attempts from this IP in 5 minutes (public-demo mode).' }],
        source: src(AUTHR, 76, 78, "rateLimit('login')"),
      },
      {
        kind: 'validate',
        target: 'sh:auth#LoginRequest',
        label: 'email + password present',
        detail: 'Inline validation, not a shared validator: both must be non-empty strings; the email is trimmed and lower-cased.',
        rejects: [{ status: 400, code: 'invalid_request', when: 'Either field is missing or empty.' }],
        source: src(AUTHR, 79, 86, 'Email and password are required.'),
      },
      {
        kind: 'validate',
        target: 'sh:public-demo#LOGIN_PASSWORD_MAX_LENGTH',
        label: 'length bounds',
        detail: 'An over-long email cannot match a user and an over-long password cannot be a demo password, so reject without a lookup or a bcrypt compare.',
        rejects: [{ status: 400, code: 'invalid_request', when: 'email > 254 characters or password > 200 characters.' }],
        source: src(AUTHR, 87, 94, 'EMAIL_MAX_LENGTH'),
      },
      { kind: 'call', target: 'be:auth/guards#requestContext', label: 'requestContext(req)', detail: 'Client IP and user-agent for the Session and LoginEvent rows — the constant `public-demo` placeholder in public-demo mode.', source: src(AUTHR, 96, 97, 'requestContext(req)') },
      { kind: 'db-read', target: 'db:User', label: 'user.findUnique({ email })', detail: 'Lookup by the unique, normalised email.', source: src(AUTHR, 98, 98, 'prisma.user.findUnique({ where: { email } })') },
      {
        kind: 'decision',
        target: 'be:auth/password#DECOY_PASSWORD_HASH',
        label: 'unknown email?',
        detail: 'Still runs `verifyPassword(password, DECOY_PASSWORD_HASH)` so timing resembles a wrong password, records a LoginEvent with `userId: null`, and returns the generic 401.',
        rejects: [{ status: 401, code: 'invalid_credentials', when: 'No user with this email.' }],
        source: src(AUTHR, 100, 112, 'DECOY_PASSWORD_HASH'),
      },
      {
        kind: 'decision',
        target: 'db:User',
        label: "user.status !== 'active'?",
        detail: 'A disabled account is refused before the password is examined; a LoginEvent with reason `account_disabled` is recorded.',
        rejects: [{ status: 403, code: 'account_disabled', when: 'The user is disabled.' }],
        source: src(AUTHR, 114, 125, "user.status !== 'active'"),
      },
      { kind: 'call', target: 'be:auth/lockout#normalizeForAttempt', label: 'normalizeForAttempt(state, now)', detail: 'If a previous lock has expired, treat the counters as zero for this attempt.', source: src(AUTHR, 127, 133, 'normalizeForAttempt(') },
      {
        kind: 'decision',
        target: 'be:auth/lockout#isLocked',
        label: '!exempt && isLocked(state, now)?',
        detail: 'A live lock refuses the attempt without checking the password and records a LoginEvent with reason `account_locked`. Seeded showcase accounts in public-demo mode skip this (`lockoutExempt`).',
        rejects: [{ status: 423, code: 'account_locked', when: '`lockedUntil` is still in the future.' }],
        source: src(AUTHR, 134, 146, 'isLocked(state, now)'),
      },
      { kind: 'call', target: 'be:auth/password#verifyPassword', label: 'verifyPassword(password, user.passwordHash)', detail: 'bcrypt comparison; false when the user has no password hash.', source: src(AUTHR, 148, 148, 'verifyPassword(password, user.passwordHash)') },
      {
        kind: 'decision',
        target: 'be:auth/lockout#registerFailure',
        label: 'wrong password → registerFailure(state, now)',
        detail: 'Increments the counter (locking at five), persists `failedLoginAttempts` and `lockedUntil` on the User, and records a LoginEvent whose reason is `account_locked` if this failure caused the lock, else `invalid_credentials`. When it locks, an `account_locked` AuditLog row is written too.',
        rejects: [
          { status: 401, code: 'invalid_credentials', when: 'Wrong password, still under the threshold.' },
          { status: 423, code: 'account_locked', when: 'Wrong password and this failure reached the threshold.' },
        ],
        source: src(AUTHR, 149, 182, 'registerFailure(state, now)'),
      },
      { kind: 'db-write', target: 'db:User', label: 'user.update({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt })', detail: 'Success: `registerSuccess()` resets the lockout counters and the last-login time is stamped.', source: src(AUTHR, 184, 193, 'registerSuccess()') },
      { kind: 'call', target: 'be:auth/sessions#createSession', label: 'createSession(prisma, user.id, now, ctx)', detail: 'Generates a 32-byte random token and returns it raw; only its SHA-256 hash is stored.', source: src(AUTHR, 194, 194, 'createSession(prisma, user.id, now, ctx)') },
      { kind: 'db-write', target: 'db:Session', label: 'session.create({ userId, tokenHash, expiresAt = now + 8 h, ip, userAgent })', source: src(SESSIONS, 31, 41, 'prisma.session.create') },
      { kind: 'call', target: 'be:auth/cookies#sessionCookieOptions', label: 'reply.setCookie(sessionCookieNameForRequest(req), token, sessionCookieOptions())', detail: 'httpOnly, SameSite=Lax, Path=/, max-age 8 hours, Secure in production. The cookie NAME depends on the request\'s surface.', source: src(AUTHR, 195, 195, 'reply.setCookie(sessionCookieNameForRequest(req), token, sessionCookieOptions())') },
      { kind: 'db-write', target: 'db:LoginEvent', label: "recordLoginEvent({ success: true, reason: 'ok' })", source: src(AUTHR, 196, 202, "reason: 'ok'") },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit({ action: 'login', entity: 'session', entityId: user.id })", detail: 'Note that `entityId` is the USER id here, not the new session\'s id.', source: src(AUTHR, 203, 209, "action: 'login'") },
      { kind: 'respond', target: 'sh:auth#AuthResponse', label: '200 { user }', detail: '`toSessionUser(user)` — id, email, displayName, role; never the password hash.', source: src(AUTHR, 210, 210, 'toSessionUser(user)') },
    ],
    sideEffects: [
      'Inserts one LoginEvent row for every attempt that passes input validation (success or failure).',
      'On success: updates User (counters reset, lastLoginAt), inserts a Session row (token hash only) and an AuditLog row (`login`).',
      'On a wrong password: updates User.failedLoginAttempts (and lockedUntil at the fifth failure, with an `account_locked` AuditLog row).',
      'Sets the per-surface session cookie; seeds the `mer_csrf` cookie if the client has none.',
    ],
    mutates: true,
    calledBy: ['cu:lib/auth', 'op:lib/api'],
    integrationNotes:
      'Send JSON `{ email, password }` with credentials enabled so the browser stores the cookies. Declare the surface with `x-meridian-surface: operations` to obtain the operations cookie; without it (and without an operations Origin) you get the customer cookie. No CSRF header is needed for this call, but read the `mer_csrf` cookie afterwards and echo it as `x-meridian-csrf` on every later state-changing request. Branch on `code`, not on the message. A 200 means the credentials are valid, not that the user may use a given app.',
    sources: [src(AUTHR, 76, 98, "app.post('/api/auth/login'"), src(AUTHR, 184, 211, 'createSession(prisma, user.id, now, ctx)')],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'ep:POST /api/auth/logout',
    method: 'POST',
    path: '/api/auth/logout',
    summary: 'Revoke the session behind the calling surface\'s cookie and clear that cookie.',
    description:
      'Best-effort and idempotent: it never requires a valid session and always answers 200. Only the cookie for the request\'s surface is read and cleared, so logging out of the customer app leaves an operations session in the same browser untouched, and vice versa.',
    auth: { required: false, surface: 'either', csrf: false, notes: 'Exempt from CSRF (bodyless and harmless to forge). No route-specific rate limit; the global mutation valve still applies in public-demo mode.' },
    responses: [{ status: 200, description: 'Always. `Set-Cookie` clears the surface\'s session cookie with attributes matching those it was set with.', fields: [{ name: 'ok', type: 'true', required: true }], example: { ok: true } }],
    errors: [{ status: 429, code: 'rate_limited', when: 'Public-demo mode and the global `mutations` valve is exhausted for this IP.', source: src(RATE, 178, 183, 'mutationValveHook') }],
    flow: [
      csrfExemptStep,
      valveStep,
      { kind: 'call', target: 'be:auth/cookies#sessionCookieNameForRequest', label: 'sessionCookieNameForRequest(req)', detail: 'Selects `mer_session` or `mer_ops_session` and reads that cookie. With no cookie the handler skips straight to clearing and responding.', source: src(AUTHR, 213, 216, 'sessionCookieNameForRequest(req)') },
      { kind: 'db-read', target: 'db:Session', label: 'session.findUnique({ tokenHash }) include user', detail: 'Loaded only to know who to attribute the audit row to.', source: src(AUTHR, 217, 221, 'prisma.session.findUnique') },
      { kind: 'call', target: 'be:auth/sessions#revokeSession', label: 'revokeSession(prisma, token, now)', source: src(AUTHR, 222, 222, 'revokeSession(prisma, token, now)') },
      { kind: 'db-write', target: 'db:Session', label: 'session.updateMany({ revokedAt: now }) where revokedAt is null', source: src(SESSIONS, 81, 84, 'prisma.session.updateMany') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit({ action: 'logout', entity: 'session', entityId: session.id })", detail: 'Written only when the token matched a session row.', source: src(AUTHR, 223, 231, "action: 'logout'") },
      { kind: 'respond', target: 'be:auth/cookies#clearedCookieOptions', label: 'clearCookie + 200 { ok: true }', source: src(AUTHR, 233, 234, 'reply.clearCookie(cookieName, clearedCookieOptions())') },
    ],
    sideEffects: ['Sets Session.revokedAt for the matching live session.', 'Inserts an AuditLog row (`logout`) when a session row was found.', 'Clears the surface\'s session cookie.'],
    mutates: true,
    calledBy: ['cu:lib/auth', 'op:lib/api'],
    integrationNotes: 'Send it with credentials and the same surface signal used at login, otherwise the wrong cookie is read and the session stays live. A body is not needed; an empty body with `Content-Type: application/json` is accepted.',
    sources: [src(AUTHR, 213, 235, "app.post('/api/auth/logout'")],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'ep:GET /api/auth/me',
    method: 'GET',
    path: '/api/auth/me',
    summary: 'Who is signed in on this surface?',
    description:
      'Each app calls this once when it loads to restore the session from the cookie. Because it is a safe request made with credentials, it is also the call that hands a brand-new client its `mer_csrf` token cookie before any POST. Like every authenticated request, it slides the session\'s idle timeout forward.',
    auth: { required: true, surface: 'either', csrf: false, notes: 'Any signed-in role. The surface decides which cookie is read: the customer cookie by default, the operations cookie when the request sends `x-meridian-surface: operations` (or an operations Origin).' },
    responses: [{ status: 200, description: 'The session\'s user.', typeRef: 'sh:auth#AuthResponse', example: { user: AVERY } }],
    errors: [
      { status: 401, code: 'unauthenticated', when: 'No session cookie for this surface.', example: { error: 'Not authenticated.', code: 'unauthenticated' }, source: src(GUARDS, 48, 53, "code: 'unauthenticated'") },
      { status: 401, code: 'session_expired', when: 'The cookie does not resolve: unknown token, revoked, past `expiresAt`, or the user is disabled. The cookie is cleared.', example: { error: 'Your session has expired. Please log in again.', code: 'session_expired' }, source: src(GUARDS, 54, 59, "code: 'session_expired'") },
    ],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      sessionReadStep,
      sessionSlideStep,
      { kind: 'respond', target: 'sh:auth#AuthResponse', label: '200 { user: req.user }', detail: 'The handler only echoes what `requireAuth` put on the request.', source: src(AUTHR, 237, 241, 'reply.send({ user }') },
    ],
    sideEffects: ['Updates Session.lastSeenAt and Session.expiresAt (sliding timeout).', 'Sets the `mer_csrf` cookie if the client has none.'],
    mutates: false,
    calledBy: ['cu:lib/auth', 'op:lib/api'],
    integrationNotes: 'Call it on application start with credentials. Treat any 401 as "signed out". Afterwards read `mer_csrf` from `document.cookie` for later mutating calls.',
    sources: [src(AUTHR, 237, 241, "app.get('/api/auth/me'")],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'ep:GET /api/auth/login-history',
    method: 'GET',
    path: '/api/auth/login-history',
    summary: 'The caller\'s ten most recent sign-in attempts.',
    description: 'Only rows whose `userId` is the caller are returned, so attempts against an unknown email (stored with `userId: null`) never appear in anyone\'s history. In public-demo mode `ip` and `userAgent` are the constant `public-demo` placeholder because that is what was stored.',
    auth: { required: true, surface: 'either', csrf: false, notes: 'Any signed-in role; scoped to the caller\'s own rows.' },
    responses: [
      {
        status: 200,
        description: 'Newest first, at most `AUTH.loginHistoryLimit` (10) rows.',
        fields: [{ name: 'events', type: 'LoginEventDTO[]', required: true, typeRef: 'sh:auth#LoginEventDTO' }],
        example: {
          events: [
            { id: 'lev_2', success: true, reason: 'ok', ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (demo browser)', createdAt: '2026-10-01T15:00:00.000Z' },
            { id: 'lev_1', success: false, reason: 'invalid_credentials', ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (demo browser)', createdAt: '2026-10-01T14:59:30.000Z' },
          ],
        },
      },
    ],
    errors: [
      { status: 401, code: 'unauthenticated', when: 'No session cookie for this surface.', source: src(GUARDS, 48, 53, "code: 'unauthenticated'") },
      { status: 401, code: 'session_expired', when: 'The cookie does not resolve to a live session.', source: src(GUARDS, 54, 59, "code: 'session_expired'") },
    ],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      sessionReadStep,
      sessionSlideStep,
      { kind: 'db-read', target: 'db:LoginEvent', label: "loginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 })", source: src(AUTHR, 246, 250, 'prisma.loginEvent.findMany') },
      { kind: 'respond', target: 'sh:auth#LoginEventDTO', label: '200 { events }', detail: 'Rows are mapped to `LoginEventDTO` with `createdAt` as an ISO string; `email` and `userId` are not returned.', source: src(AUTHR, 251, 259, 'reply.send({ events: dto })') },
    ],
    sideEffects: ['Updates Session.lastSeenAt and Session.expiresAt (sliding timeout).'],
    mutates: false,
    calledBy: ['cu:lib/auth'],
    sources: [src(AUTHR, 243, 260, "app.get('/api/auth/login-history'")],
  },
];

const OTHER_GROUPS: [string, string, number][] = [
  ['be:routes/accounts', 'accountRoutes', 22],
  ['be:routes/ops', 'opsRoutes', 23],
  ['be:routes/onboarding', 'onboardingRoutes', 24],
  ['be:routes/money', 'moneyRoutes', 25],
  ['be:routes/cards', 'cardRoutes', 26],
  ['be:routes/risk', 'riskRoutes', 27],
  ['be:routes/schedules', 'scheduleRoutes', 28],
  ['be:routes/clock', 'clockRoutes', 29],
  ['be:routes/lending', 'lendingRoutes', 30],
];

export const relations: Relation[] = [
  // registry
  rel('be:routes/index#registerRoutes', 'be:routes/meta', 'calls', { label: 'app.register(metaRoutes)', order: 1, sources: [src(INDEX, 18, 18, 'app.register(metaRoutes)')] }),
  rel('be:routes/index#registerRoutes', 'be:routes/health', 'calls', { label: 'app.register(healthRoutes)', order: 2, sources: [src(INDEX, 19, 19, 'app.register(healthRoutes)')] }),
  rel('be:routes/index#registerRoutes', 'be:routes/status', 'calls', { label: 'app.register(statusRoutes)', order: 3, sources: [src(INDEX, 20, 20, 'app.register(statusRoutes)')] }),
  rel('be:routes/index#registerRoutes', 'be:routes/auth', 'calls', { label: 'app.register(authRoutes)', order: 4, sources: [src(INDEX, 21, 21, 'app.register(authRoutes)')] }),
  ...OTHER_GROUPS.map(([id, fn, line], i) => rel('be:routes/index#registerRoutes', id, 'calls', { label: `app.register(${fn})`, order: 5 + i, sources: [src(INDEX, line, line, `app.register(${fn})`)] })),

  // group → endpoint
  rel('be:routes/meta', 'ep:GET /', 'handles', { label: 'GET /', sources: [src(META, 6, 13, "app.get('/'")] }),
  rel('be:routes/meta', 'ep:GET /api/meta', 'handles', { label: 'GET /api/meta', sources: [src(META, 15, 23, "app.get('/api/meta'")] }),
  rel('be:routes/health', 'ep:GET /health', 'handles', { label: 'GET /health', sources: [src(HEALTH, 7, 9, "app.get('/health'")] }),
  rel('be:routes/status', 'ep:GET /status', 'handles', { label: 'GET /status', sources: [src(STATUS, 9, 27, "app.get('/status'")] }),
  rel('be:routes/auth', 'ep:POST /api/auth/login', 'handles', { label: 'POST /api/auth/login', sources: [src(AUTHR, 78, 78, "app.post('/api/auth/login'")] }),
  rel('be:routes/auth', 'ep:POST /api/auth/logout', 'handles', { label: 'POST /api/auth/logout', sources: [src(AUTHR, 213, 213, "app.post('/api/auth/logout'")] }),
  rel('be:routes/auth', 'ep:GET /api/auth/me', 'handles', { label: 'GET /api/auth/me', sources: [src(AUTHR, 237, 237, "app.get('/api/auth/me'")] }),
  rel('be:routes/auth', 'ep:GET /api/auth/login-history', 'handles', { label: 'GET /api/auth/login-history', sources: [src(AUTHR, 243, 243, "app.get('/api/auth/login-history'")] }),

  // meta / health / status
  rel('ep:GET /', 'sh:brand#BRAND', 'uses-type', { label: 'BRAND.name / simulationNotice', sources: [src(META, 6, 13, 'BRAND.simulationNotice')] }),
  rel('ep:GET /api/meta', 'sh:brand#BRAND', 'uses-type', { label: 'BRAND.legalName / simulationNotice', sources: [src(META, 15, 23, 'BRAND.legalName')] }),
  rel('ep:GET /api/meta', 'sh:version#PLATFORM_META', 'uses-type', { label: 'PLATFORM_META.version / milestone', sources: [src(META, 15, 23, 'PLATFORM_META.version')] }),
  rel('ep:GET /api/meta', 'sh:types#MetaResponse', 'uses-type', { label: 'returns MetaResponse', sources: [src(META, 15, 15, 'MetaResponse')] }),
  rel('ep:GET /health', 'sh:types#HealthResponse', 'uses-type', { label: 'returns HealthResponse', sources: [src(HEALTH, 7, 7, 'HealthResponse')] }),
  rel('ep:GET /status', 'be:db#checkDatabase', 'calls', { label: 'checkDatabase()', order: 1, sources: [src(STATUS, 10, 10, 'checkDatabase()')] }),
  rel('ep:GET /status', 'sh:version#PLATFORM_META', 'uses-type', { label: 'PLATFORM_META.version / milestone / milestoneName', sources: [src(STATUS, 11, 15, 'PLATFORM_META.version')] }),
  rel('ep:GET /status', 'be:config#config', 'uses-type', { label: 'config.environment / config.publicDemo', sources: [src(STATUS, 16, 20, 'config.publicDemo')] }),
  rel('ep:GET /status', 'be:revision#RELEASE_REVISION', 'uses-type', { label: 'revision: RELEASE_REVISION', sources: [src(STATUS, 22, 24, 'RELEASE_REVISION')] }),
  rel('ep:GET /status', 'sh:types#StatusResponse', 'uses-type', { label: 'returns StatusResponse', sources: [src(STATUS, 9, 9, 'StatusResponse')] }),

  // login
  rel('be:abuse/rate-limit#rateLimit', 'ep:POST /api/auth/login', 'guards', { label: "preHandler: rateLimit('login')", sources: [src(AUTHR, 76, 78, "rateLimit('login')")] }),
  rel('ep:POST /api/auth/login', 'sh:auth#LoginRequest', 'validates', { label: 'inline: email + password required, length-bounded', order: 1, sources: [src(AUTHR, 79, 94, 'Partial<LoginRequest>')] }),
  rel('ep:POST /api/auth/login', 'be:auth/guards#requestContext', 'calls', { label: 'requestContext(req)', order: 2, sources: [src(AUTHR, 96, 96, 'requestContext(req)')] }),
  rel('ep:POST /api/auth/login', 'db:User', 'reads', { label: 'findUnique by email', order: 3, sources: [src(AUTHR, 98, 98, 'prisma.user.findUnique')] }),
  rel('ep:POST /api/auth/login', 'be:auth/password#DECOY_PASSWORD_HASH', 'uses-type', { label: 'verifyPassword(password, DECOY_PASSWORD_HASH) for an unknown email', order: 4, sources: [src(AUTHR, 102, 103, 'DECOY_PASSWORD_HASH')] }),
  rel('ep:POST /api/auth/login', 'be:routes/auth#lockoutExempt', 'calls', { label: 'lockoutExempt(email)', order: 5, sources: [src(AUTHR, 127, 129, 'lockoutExempt(email)')] }),
  rel('ep:POST /api/auth/login', 'be:auth/lockout#normalizeForAttempt', 'calls', { label: 'normalizeForAttempt(state, now)', order: 6, sources: [src(AUTHR, 130, 133, 'normalizeForAttempt(')] }),
  rel('ep:POST /api/auth/login', 'be:auth/lockout#isLocked', 'calls', { label: 'isLocked(state, now)', order: 7, sources: [src(AUTHR, 134, 134, 'isLocked(state, now)')] }),
  rel('ep:POST /api/auth/login', 'be:auth/password#verifyPassword', 'calls', { label: 'verifyPassword(password, user.passwordHash)', order: 8, sources: [src(AUTHR, 148, 148, 'verifyPassword(password, user.passwordHash)')] }),
  rel('ep:POST /api/auth/login', 'be:auth/lockout#registerFailure', 'calls', { label: 'registerFailure(state, now)', order: 9, sources: [src(AUTHR, 149, 150, 'registerFailure(state, now)')] }),
  rel('ep:POST /api/auth/login', 'db:User', 'writes', { label: 'update failedLoginAttempts / lockedUntil (failure) or reset + lastLoginAt (success)', order: 10, sources: [src(AUTHR, 154, 157, 'prisma.user.update'), src(AUTHR, 186, 193, 'lastLoginAt: now')] }),
  rel('ep:POST /api/auth/login', 'be:auth/lockout#registerSuccess', 'calls', { label: 'registerSuccess()', order: 11, sources: [src(AUTHR, 184, 185, 'registerSuccess()')] }),
  rel('ep:POST /api/auth/login', 'be:auth/sessions#createSession', 'calls', { label: 'createSession(prisma, user.id, now, ctx)', order: 12, sources: [src(AUTHR, 194, 194, 'createSession(prisma, user.id, now, ctx)')] }),
  rel('ep:POST /api/auth/login', 'be:auth/cookies#sessionCookieNameForRequest', 'calls', { label: 'sessionCookieNameForRequest(req)', order: 13, sources: [src(AUTHR, 195, 195, 'sessionCookieNameForRequest(req)')] }),
  rel('ep:POST /api/auth/login', 'be:auth/cookies#sessionCookieOptions', 'calls', { label: 'sessionCookieOptions()', order: 14, sources: [src(AUTHR, 195, 195, 'sessionCookieOptions()')] }),
  rel('ep:POST /api/auth/login', 'be:auth/audit#recordLoginEvent', 'calls', { label: 'recordLoginEvent(prisma, { userId, email, success, reason, ctx })', summary: 'Called on every branch after validation: unknown email, disabled, locked, wrong password and success.', order: 15, sources: [src(AUTHR, 196, 202, 'recordLoginEvent(prisma'), src(AUTHR, 104, 110, 'recordLoginEvent(prisma')] }),
  rel('ep:POST /api/auth/login', 'be:auth/audit#writeAudit', 'calls', { label: "writeAudit({ action: 'login' | 'account_locked' })", order: 16, sources: [src(AUTHR, 203, 209, "action: 'login'"), src(AUTHR, 166, 175, "action: 'account_locked'")] }),
  rel('ep:POST /api/auth/login', 'sh:auth#AuthResponse', 'uses-type', { label: 'returns AuthResponse', sources: [src(AUTHR, 210, 210, 'AuthResponse')] }),
  rel('ep:POST /api/auth/login', 'feat:auth', 'implements', { label: 'password sign-in with lockout', sources: [src(AUTHR, 69, 78, 'Authentication endpoints')] }),
  rel('be:routes/auth#lockoutExempt', 'be:seed-plan#isSeededShowcaseEmail', 'calls', { label: 'config.publicDemo && isSeededShowcaseEmail(email)', sources: [src(AUTHR, 65, 67, 'isSeededShowcaseEmail(email)')] }),
  rel('be:routes/auth#lockoutExempt', 'be:config#config', 'uses-type', { label: 'config.publicDemo', sources: [src(AUTHR, 65, 67, 'config.publicDemo')] }),

  // logout
  rel('ep:POST /api/auth/logout', 'be:auth/cookies#sessionCookieNameForRequest', 'calls', { label: 'sessionCookieNameForRequest(req)', order: 1, sources: [src(AUTHR, 214, 214, 'sessionCookieNameForRequest(req)')] }),
  rel('ep:POST /api/auth/logout', 'db:Session', 'reads', { label: 'findUnique by tokenHash, include user', order: 2, sources: [src(AUTHR, 218, 221, 'prisma.session.findUnique')] }),
  rel('ep:POST /api/auth/logout', 'be:auth/tokens#hashSessionToken', 'calls', { label: 'hashSessionToken(token)', order: 2, sources: [src(AUTHR, 218, 221, 'hashSessionToken(token)')] }),
  rel('ep:POST /api/auth/logout', 'be:auth/sessions#revokeSession', 'calls', { label: 'revokeSession(prisma, token, now)', order: 3, sources: [src(AUTHR, 222, 222, 'revokeSession(prisma, token, now)')] }),
  rel('ep:POST /api/auth/logout', 'be:auth/audit#writeAudit', 'calls', { label: "writeAudit({ action: 'logout', entity: 'session', entityId: session.id })", order: 4, sources: [src(AUTHR, 223, 231, "action: 'logout'")] }),
  rel('ep:POST /api/auth/logout', 'be:auth/cookies#clearedCookieOptions', 'calls', { label: 'reply.clearCookie(cookieName, clearedCookieOptions())', order: 5, sources: [src(AUTHR, 233, 233, 'clearedCookieOptions()')] }),

  // me / login-history
  rel('be:auth/guards#requireAuth', 'ep:GET /api/auth/me', 'guards', { label: 'preHandler: requireAuth', sources: [src(AUTHR, 237, 237, 'preHandler: requireAuth')] }),
  rel('ep:GET /api/auth/me', 'sh:auth#AuthResponse', 'uses-type', { label: 'returns AuthResponse', sources: [src(AUTHR, 237, 241, 'AuthResponse')] }),
  rel('be:auth/guards#requireAuth', 'ep:GET /api/auth/login-history', 'guards', { label: 'preHandler: requireAuth', sources: [src(AUTHR, 243, 243, 'preHandler: requireAuth')] }),
  rel('ep:GET /api/auth/login-history', 'db:LoginEvent', 'reads', { label: 'findMany by userId, newest first, take 10', sources: [src(AUTHR, 246, 250, 'prisma.loginEvent.findMany')] }),
  rel('ep:GET /api/auth/login-history', 'sh:auth#LoginEventDTO', 'uses-type', { label: 'events: LoginEventDTO[]', sources: [src(AUTHR, 251, 258, 'LoginEventDTO[]')] }),
  rel('ep:GET /api/auth/login-history', 'sh:auth#AUTH', 'uses-type', { label: 'take: AUTH.loginHistoryLimit', sources: [src(AUTHR, 246, 250, 'AUTH.loginHistoryLimit')] }),
];
