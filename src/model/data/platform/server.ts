import type { Entity, Relation } from '../../types';
import { BE, rel, src } from './helpers';

/**
 * `be.platform` — server assembly, runtime entry point, configuration, the
 * Prisma client and the release revision.
 */

const SERVER = `${BE}/server.ts`;
const INDEX = `${BE}/index.ts`;
const CONFIG = `${BE}/config.ts`;
const DB = `${BE}/db.ts`;
const REVISION = `${BE}/revision.ts`;

export const entities: Entity[] = [
  // ---- server.ts ------------------------------------------------------------
  {
    id: 'be:server',
    kind: 'module',
    name: 'server.ts',
    parent: 'be.platform',
    summary: 'Assembles the Fastify application — plugins, global hooks, the JSON body parser and every route — without opening a port.',
    description:
      'The file exports one function, `buildServer()`, plus its options type. It also augments Fastify\'s `FastifyInstance` type with `opsRealtime`, so route handlers can call `app.opsRealtime.requestChanged(...)` with full typing.\n\nKeeping construction separate from `listen()` is what lets every backend test drive the real application with `app.inject()` and no open ports; only `index.ts` starts listening and attaches Socket.IO.',
    tech: ['Fastify 5', '@fastify/cors', '@fastify/cookie'],
    tags: ['platform', 'security', 'public-demo'],
    aliases: ['buildServer', 'fastify app', 'server assembly'],
    sources: [src(SERVER, 27, 34, 'export async function buildServer', 'Doc comment + signature'), src(SERVER, 11, 16, 'opsRealtime: OpsRealtime', 'Fastify type augmentation')],
  },
  {
    id: 'be:server#buildServer',
    kind: 'function',
    name: 'buildServer()',
    parent: 'be:server',
    detail: 3,
    summary: 'Builds the fully configured Fastify instance — CORS, cookies, the CSRF hook, the mutation valve, the ops publisher and all routes — and returns it without listening.',
    description:
      'Order of assembly, which is also the order things run on a request:\n\n1. `Fastify({ logger, trustProxy: true, bodyLimit: MAX_REQUEST_BODY_BYTES })`. Logging is off under test. In public-demo mode the request serializer logs only method + URL, so visitor IPs never reach the log. `trustProxy` makes `req.ip` the forwarded client address (used only by the in-memory rate limiter). The body limit is 64 KiB; a larger body is rejected with 413 before any handler runs.\n2. `@fastify/cors` with `origin: config.corsOrigins, credentials: true`.\n3. `@fastify/cookie`, then `decorateRequest(\'user\', null)` so `req.cookies` and `req.user` exist everywhere.\n4. Global `onRequest` hook `csrfHook` (double-submit CSRF check).\n5. Global `onRequest` hook `mutationValveHook` (public-demo cap on all state-changing requests per IP).\n6. In public-demo mode only, an `onSend` hook adds `X-Robots-Tag: noindex, nofollow` to every response.\n7. `app.decorate(\'opsRealtime\', options.opsRealtime ?? noopOpsRealtime)` — routes publish operations events through this; it does nothing until the runtime binds a Socket.IO server.\n8. A replacement `application/json` parser that treats an EMPTY body as `{}` (so a bodyless logout POST that still declares JSON is not rejected) while malformed JSON still fails with 400.\n9. `registerRoutes` — the thirteen route plugins.',
    signature: 'export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance>',
    tags: ['platform', 'security', 'public-demo'],
    aliases: ['build server', 'app factory'],
    audience: {
      executive: 'The assembly line for the bank\'s server: it wires security checks and every API route together before the server starts.',
      systems: 'Fastify app factory: CORS allowlist with credentials, cookie parsing, two global onRequest hooks (CSRF, mutation valve), 64 KiB body limit, trustProxy on; no listen() and no Socket.IO here.',
    },
    sources: [
      src(SERVER, 34, 61, 'export async function buildServer', 'Fastify options: logger, trustProxy, bodyLimit'),
      src(SERVER, 63, 71, "app.decorateRequest('user', null)", 'CORS + cookie plugin'),
      src(SERVER, 73, 81, "app.addHook('onRequest', csrfHook)", 'Global hooks, in order'),
      src(SERVER, 83, 93, "app.decorate('opsRealtime'", 'Robots header + ops publisher'),
      src(SERVER, 95, 112, "addContentTypeParser('application/json'", 'Empty JSON body tolerated'),
      src(SERVER, 114, 116, 'app.register(registerRoutes)'),
    ],
  },
  {
    id: 'be:server#BuildServerOptions',
    kind: 'type',
    name: 'BuildServerOptions',
    parent: 'be:server',
    summary: 'Options for `buildServer()`: currently just the operations real-time publisher to inject.',
    description:
      'Defaults to a no-op publisher so tests and any socketless run work unchanged. The runtime passes a `SocketOpsRealtime`; tests that assert on emissions pass a `RecordingOpsRealtime`.',
    fields: [{ name: 'opsRealtime', type: 'OpsRealtime', required: false, typeRef: 'be:ops/realtime#OpsRealtime', description: 'Publisher that route handlers reach as `app.opsRealtime`. Default: `noopOpsRealtime`.' }],
    tags: ['platform', 'realtime'],
    sources: [src(SERVER, 18, 25, 'export interface BuildServerOptions')],
  },

  // ---- index.ts -------------------------------------------------------------
  {
    id: 'be:index',
    kind: 'module',
    name: 'index.ts',
    parent: 'be.platform',
    summary: 'The runtime entry point: builds the server, attaches Socket.IO, starts listening and shuts down cleanly on SIGINT/SIGTERM.',
    description:
      'Top-level code, no exports. It creates a `SocketOpsRealtime` publisher first, hands it to `buildServer({ opsRealtime })` so routes emit through it, attaches Socket.IO to `app.server` with `attachRealtime(app.server, prisma)`, and only then binds the publisher to the live Socket.IO server with `opsRealtime.bind(io)`.\n\nAfter `app.listen({ port, host })` it logs the deployment posture (NODE_ENV, PUBLIC_DEMO, secureCookies, rateLimits, DATABASE_URL) and warns when public-demo mode is on but `DATABASE_URL` is not an absolute `file:` URL. `shutdown()` closes Socket.IO, closes Fastify, disconnects Prisma and exits. Tests never import this file.',
    tech: ['Node.js', 'Fastify 5', 'Socket.IO 4'],
    tags: ['platform', 'realtime', 'deployment'],
    aliases: ['entrypoint', 'main', 'startup', 'shutdown'],
    sources: [
      src(INDEX, 7, 18, 'opsRealtime.bind(io)', 'Build → attach → bind'),
      src(INDEX, 20, 35, 'app.listen({ port: config.port, host: config.host })', 'Listen + posture log'),
      src(INDEX, 41, 50, 'async function shutdown', 'Graceful shutdown'),
    ],
  },

  // ---- config.ts ------------------------------------------------------------
  {
    id: 'be:config',
    kind: 'module',
    name: 'config.ts',
    parent: 'be.platform',
    summary: 'Reads runtime configuration from environment variables, with safe local defaults, into one shared `config` object.',
    description:
      'Two deployment postures are kept separate on purpose. `NODE_ENV=production` means "built and served over HTTPS" and turns on `Secure` cookies. `PUBLIC_DEMO=true` means "a shared, disposable public demo" and turns on the shared-demo warning, visitor privacy (no real IP / user-agent persisted), the seeded-account lockout exemption and the in-memory rate limits. Public-demo mode is never inferred from NODE_ENV.',
    tags: ['platform', 'config', 'public-demo', 'security'],
    aliases: ['environment', 'env vars', 'PUBLIC_DEMO', 'NODE_ENV', 'COOKIE_SECURE', 'RATE_LIMITS', 'CORS_ORIGINS'],
    sources: [src(CONFIG, 3, 18, 'PUBLIC_DEMO=true', 'The two postures')],
  },
  {
    id: 'be:config#RuntimeConfig',
    kind: 'type',
    name: 'RuntimeConfig',
    parent: 'be:config',
    summary: 'The shape of the backend configuration: listen address, environment flags, cookie and rate-limit switches, and the allowed origins.',
    fields: [
      { name: 'port', type: 'number', required: true, description: '`PORT`, default 3000 (`DEFAULT_PORTS.backend`). The public demo sets 8102.' },
      { name: 'host', type: 'string', required: true, description: '`HOST`, default `127.0.0.1` (loopback only).' },
      { name: 'environment', type: 'string', required: true, description: '`NODE_ENV`, default `development`. Echoed by GET /status.' },
      { name: 'isTest', type: 'boolean', required: true, description: 'True when NODE_ENV is `test`; turns the Fastify logger off.' },
      { name: 'isProduction', type: 'boolean', required: true, description: 'True when NODE_ENV is `production`.' },
      { name: 'publicDemo', type: 'boolean', required: true, description: 'Explicit opt-in shared-demo posture (`PUBLIC_DEMO=true`).' },
      { name: 'secureCookies', type: 'boolean', required: true, description: 'Add `Secure` to every cookie. Defaults to `isProduction`; `COOKIE_SECURE` overrides either way.' },
      { name: 'rateLimitsEnabled', type: 'boolean', required: true, description: 'Enforce the in-memory abuse limits. `publicDemo` implies it; `RATE_LIMITS=true` forces it on elsewhere.' },
      { name: 'corsOrigins', type: 'string[]', required: true, description: '`CORS_ORIGINS` (comma-separated). Default: the two localhost dev origins (5173, 5174). Used by both Fastify CORS and Socket.IO.' },
      { name: 'operationsOrigins', type: 'string[]', required: true, description: '`OPERATIONS_ORIGINS`. Origins treated as the operations console when a request sends no surface header. Default `http://localhost:5174`.' },
      { name: 'operationsPort', type: 'number', required: true, description: 'The ops dev port (5174), matched as a fallback so a LAN-hosted dev console still resolves as operations.' },
    ],
    example: { port: 3000, host: '127.0.0.1', environment: 'development', isTest: false, isProduction: false, publicDemo: false, secureCookies: false, rateLimitsEnabled: false, corsOrigins: ['http://localhost:5173', 'http://localhost:5174'], operationsOrigins: ['http://localhost:5174'], operationsPort: 5174 },
    tags: ['platform', 'config', 'public-demo'],
    sources: [src(CONFIG, 19, 35, 'export interface RuntimeConfig')],
  },
  {
    id: 'be:config#resolveConfig',
    kind: 'function',
    name: 'resolveConfig()',
    parent: 'be:config',
    summary: 'Pure function that turns an environment snapshot into a `RuntimeConfig`.',
    description:
      'Boolean flags go through the shared `parseBooleanFlag`, so only the explicit spellings `true`, `1`, `yes`, `on` enable anything. `secureCookies` uses `COOKIE_SECURE` when it is set and otherwise follows `isProduction`. `rateLimitsEnabled` is `publicDemo || RATE_LIMITS`. Origin lists are split on commas and trimmed.',
    signature: 'export function resolveConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig',
    tags: ['platform', 'config'],
    sources: [src(CONFIG, 44, 71, 'export function resolveConfig')],
  },
  {
    id: 'be:config#config',
    kind: 'constant',
    name: 'config',
    parent: 'be:config',
    summary: 'The live configuration object, resolved once at import and shared by every backend module.',
    description:
      'A single mutable object rather than a value re-read per request. Modules that must react to a posture change (cookie options, rate limits, request context) read it at call time, which is what lets tests flip `publicDemo` or `secureCookies` on an already-built server.',
    signature: 'export const config: RuntimeConfig = resolveConfig()',
    tags: ['platform', 'config'],
    sources: [src(CONFIG, 73, 78, 'export const config: RuntimeConfig')],
  },
  {
    id: 'be:config#overrideConfigForTests',
    kind: 'function',
    name: 'overrideConfigForTests()',
    parent: 'be:config',
    detail: 5,
    summary: 'Test-only helper that patches the live config and returns a function restoring the previous values.',
    signature: 'export function overrideConfigForTests(patch: Partial<RuntimeConfig>): () => void',
    tags: ['platform', 'config', 'tests'],
    sources: [src(CONFIG, 80, 95, 'export function overrideConfigForTests')],
  },

  // ---- db.ts ----------------------------------------------------------------
  {
    id: 'be:db',
    kind: 'module',
    name: 'db.ts',
    parent: 'be.platform',
    summary: 'Creates the one Prisma client the backend uses and offers a never-throwing database readiness probe.',
    description:
      'If `DATABASE_URL` is unset the module sets it to `file:./dev.db` before constructing the client. Prisma resolves a relative SQLite path against the schema directory for both the CLI and the generated client, so that default always means `apps/backend/prisma/dev.db` whatever the working directory. A deployment overrides it with an absolute `file:` URL.',
    tech: ['Prisma 5', 'SQLite'],
    tags: ['platform', 'data', 'database'],
    aliases: ['prisma client', 'DATABASE_URL', 'database connection'],
    sources: [src(DB, 11, 24, 'export const prisma = new PrismaClient()')],
  },
  {
    id: 'be:db#prisma',
    kind: 'constant',
    name: 'prisma',
    parent: 'be:db',
    detail: 3,
    summary: 'The single `PrismaClient` instance — the only database connection in the whole system.',
    description:
      'Route handlers and the realtime module import this instance and pass it into domain services as an argument; services never construct their own client. `index.ts` disconnects it during shutdown.',
    signature: 'export const prisma = new PrismaClient()',
    audience: { dba: 'The one connection to the SQLite file. Every query in the system goes through this Prisma client; there is no second writer.' },
    tags: ['data', 'database', 'platform'],
    aliases: ['PrismaClient', 'db client'],
    sources: [src(DB, 20, 24, 'export const prisma = new PrismaClient()')],
  },
  {
    id: 'be:db#DbClient',
    kind: 'type',
    name: 'DbClient',
    parent: 'be:db',
    summary: 'Either the full Prisma client or an interactive-transaction client, so one service function works both standalone and inside `prisma.$transaction`.',
    signature: 'export type DbClient = PrismaClient | Prisma.TransactionClient',
    tags: ['data', 'database'],
    aliases: ['transaction client', 'tx'],
    sources: [src(DB, 3, 9, 'export type DbClient')],
  },
  {
    id: 'be:db#checkDatabase',
    kind: 'function',
    name: 'checkDatabase()',
    parent: 'be:db',
    summary: 'Counts users and accounts to prove the database answers; returns `connected: false` instead of throwing.',
    signature: 'export async function checkDatabase(): Promise<DatabaseStatus>',
    tags: ['data', 'platform'],
    sources: [src(DB, 32, 40, 'export async function checkDatabase')],
  },
  {
    id: 'be:db#DatabaseStatus',
    kind: 'type',
    name: 'DatabaseStatus',
    parent: 'be:db',
    summary: 'Result of the readiness probe: whether the database answered, plus the user and account counts.',
    fields: [
      { name: 'connected', type: 'boolean', required: true },
      { name: 'users', type: 'number', required: true, description: '`prisma.user.count()`; 0 when not connected.' },
      { name: 'accounts', type: 'number', required: true, description: '`prisma.account.count()`; 0 when not connected.' },
    ],
    example: { connected: true, users: 4, accounts: 4 },
    tags: ['data', 'platform'],
    sources: [src(DB, 26, 30, 'export interface DatabaseStatus')],
  },

  // ---- revision.ts ----------------------------------------------------------
  {
    id: 'be:revision',
    kind: 'module',
    name: 'revision.ts',
    parent: 'be.platform',
    summary: 'Reads the release\'s `REVISION` file (a full commit SHA) once at start-up so GET /status can report which release is running.',
    tags: ['platform', 'deployment'],
    aliases: ['REVISION file', 'commit sha', 'release revision'],
    sources: [src(REVISION, 21, 32, 'export const RELEASE_REVISION')],
  },
  {
    id: 'be:revision#readRevisionFile',
    kind: 'function',
    name: 'readRevisionFile()',
    parent: 'be:revision',
    summary: 'Returns the file\'s content if it is exactly one lowercase 40-character hex SHA, otherwise `null`; never throws.',
    signature: 'export function readRevisionFile(path: string): string | null',
    tags: ['platform', 'deployment'],
    sources: [src(REVISION, 4, 19, 'export function readRevisionFile')],
  },
  {
    id: 'be:revision#RELEASE_REVISION',
    kind: 'constant',
    name: 'RELEASE_REVISION',
    parent: 'be:revision',
    summary: 'The deployed release\'s commit SHA, or `null` in local development where no `REVISION` file exists.',
    description:
      'In a packaged release the bundle is `<release>/backend/index.js`, so `../REVISION` resolves to `<release>/REVISION`. Node resolves the entry point\'s real path, so behind the `current` symlink this is the release actually running. Read once; a release is immutable.',
    signature: 'export const RELEASE_REVISION: string | null',
    example: null,
    tags: ['platform', 'deployment'],
    sources: [src(REVISION, 21, 32, 'export const RELEASE_REVISION')],
  },
];

export const relations: Relation[] = [
  rel('be:index', 'be:server#buildServer', 'calls', { label: 'buildServer({ opsRealtime })', order: 1, sources: [src(INDEX, 15, 16, 'buildServer({ opsRealtime })')] }),
  rel('be:index', 'be:realtime#attachRealtime', 'calls', { label: 'attachRealtime(app.server, prisma)', order: 2, sources: [src(INDEX, 17, 17, 'attachRealtime(app.server, prisma)')] }),
  rel('be:index', 'be:ops/realtime#SocketOpsRealtime', 'calls', {
    label: 'new SocketOpsRealtime() … opsRealtime.bind(io)',
    summary: 'Creates the publisher before the server is built and binds it to the Socket.IO server afterwards.',
    order: 3,
    sources: [src(INDEX, 15, 18, 'opsRealtime.bind(io)')],
  }),
  rel('be:index', 'be:db#prisma', 'imports', { label: 'prisma (attach + $disconnect on shutdown)', sources: [src(INDEX, 41, 47, 'prisma.$disconnect()')] }),
  rel('be:index', 'be:config#config', 'uses-type', { label: 'config.port / config.host / posture log', sources: [src(INDEX, 20, 30, 'config.port')] }),

  rel('be:server#buildServer', 'be:config#config', 'uses-type', { label: 'config.isTest / publicDemo / corsOrigins', sources: [src(SERVER, 35, 66, 'config.corsOrigins')] }),
  rel('be:server#buildServer', 'sh:public-demo#MAX_REQUEST_BODY_BYTES', 'uses-type', { label: 'bodyLimit: MAX_REQUEST_BODY_BYTES', sources: [src(SERVER, 57, 60, 'bodyLimit: MAX_REQUEST_BODY_BYTES')] }),
  rel('be:server#buildServer', 'be:auth/csrf#csrfHook', 'calls', {
    label: "app.addHook('onRequest', csrfHook)",
    summary: 'Registers the CSRF check as the first global hook on every request.',
    order: 1,
    sources: [src(SERVER, 73, 77, "app.addHook('onRequest', csrfHook)")],
  }),
  rel('be:server#buildServer', 'be:abuse/rate-limit#mutationValveHook', 'calls', {
    label: "app.addHook('onRequest', mutationValveHook)",
    summary: 'Registers the coarse mutation valve as the second global hook.',
    order: 2,
    sources: [src(SERVER, 79, 81, "app.addHook('onRequest', mutationValveHook)")],
  }),
  rel('be:server#buildServer', 'be:ops/realtime#noopOpsRealtime', 'uses-type', { label: 'options.opsRealtime ?? noopOpsRealtime', order: 3, sources: [src(SERVER, 92, 93, 'noopOpsRealtime')] }),
  rel('be:server#buildServer', 'be:routes/index#registerRoutes', 'calls', { label: 'app.register(registerRoutes)', order: 4, sources: [src(SERVER, 114, 114, 'app.register(registerRoutes)')] }),
  rel('be:server#buildServer', 'be:server#BuildServerOptions', 'uses-type', { label: 'options', sources: [src(SERVER, 34, 34, 'BuildServerOptions')] }),
  rel('be:server#BuildServerOptions', 'be:ops/realtime#OpsRealtime', 'uses-type', { label: 'opsRealtime?: OpsRealtime', sources: [src(SERVER, 18, 25, 'opsRealtime?: OpsRealtime')] }),

  rel('be:config#resolveConfig', 'sh:public-demo#parseBooleanFlag', 'calls', { label: 'parseBooleanFlag(env.PUBLIC_DEMO)', sources: [src(CONFIG, 48, 60, 'parseBooleanFlag(env.PUBLIC_DEMO)')] }),
  rel('be:config#resolveConfig', 'sh:constants#DEFAULT_PORTS', 'uses-type', { label: 'DEFAULT_PORTS.backend / .operations', sources: [src(CONFIG, 50, 69, 'DEFAULT_PORTS.backend')] }),
  rel('be:config#resolveConfig', 'be:config#RuntimeConfig', 'uses-type', { label: 'returns RuntimeConfig', sources: [src(CONFIG, 45, 45, 'RuntimeConfig')] }),
  rel('be:config#config', 'be:config#resolveConfig', 'calls', { label: 'resolveConfig()', sources: [src(CONFIG, 78, 78, 'resolveConfig()')] }),

  rel('be:db#checkDatabase', 'db:User', 'reads', { label: 'prisma.user.count()', sources: [src(DB, 33, 36, 'prisma.user.count()')] }),
  rel('be:db#checkDatabase', 'db:Account', 'reads', { label: 'prisma.account.count()', sources: [src(DB, 33, 36, 'prisma.account.count()')] }),
  rel('be:db#checkDatabase', 'be:db#DatabaseStatus', 'uses-type', { label: 'returns DatabaseStatus', sources: [src(DB, 33, 33, 'DatabaseStatus')] }),
  rel('be:db#prisma', 'db', 'writes', {
    label: 'PrismaClient → SQLite file',
    summary: 'The Prisma client is the only path to the SQLite file.',
    protocol: 'In-process Prisma Client',
    detail: 3,
    sources: [src(DB, 20, 24, 'new PrismaClient()')],
  }),

  rel('be:revision#RELEASE_REVISION', 'be:revision#readRevisionFile', 'calls', { label: "readRevisionFile('../REVISION')", sources: [src(REVISION, 30, 32, 'readRevisionFile(')] }),
  rel('be:revision#RELEASE_REVISION', 'feat:deploy', 'implements', { label: 'release revision on /status', sources: [src(REVISION, 21, 32, 'RELEASE_REVISION')] }),
];
