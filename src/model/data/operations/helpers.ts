import type { Entity, FlowStep, Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative paths of the Meridian files this slice cites. */
export const FILES = {
  requests: 'apps/backend/src/ops/requests.ts',
  adminUsers: 'apps/backend/src/ops/admin-users.ts',
  onboarding: 'apps/backend/src/ops/onboarding.ts',
  invitations: 'apps/backend/src/ops/invitations.ts',
  routesOps: 'apps/backend/src/routes/ops.ts',
  routesOnboarding: 'apps/backend/src/routes/onboarding.ts',
  shOperations: 'packages/shared/src/operations.ts',
  shOnboarding: 'packages/shared/src/onboarding.ts',
  shTypes: 'packages/shared/src/types.ts',
  shPublicDemo: 'packages/shared/src/public-demo.ts',
  movements: 'apps/backend/src/money/movements.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  server: 'apps/backend/src/server.ts',
  opsTest: 'apps/backend/src/routes/ops.test.ts',
  onboardingTest: 'apps/backend/src/routes/onboarding.test.ts',
  shOperationsTest: 'packages/shared/src/operations.test.ts',
  shOnboardingTest: 'packages/shared/src/onboarding.test.ts',
  e2eOperations: 'e2e/operations.spec.ts',
  e2eOnboarding: 'e2e/onboarding.spec.ts',
  opsApi: 'apps/operations/src/lib/opsApi.ts',
  opsApiBase: 'apps/operations/src/lib/api.ts',
  opsData: 'apps/operations/src/lib/OpsDataContext.tsx',
  opsSocket: 'apps/operations/src/lib/useOpsSocket.ts',
  requestQueues: 'apps/operations/src/pages/RequestQueues.tsx',
  detailPanel: 'apps/operations/src/components/RequestDetailPanel.tsx',
  actionBar: 'apps/operations/src/components/ActionBar.tsx',
  openAccount: 'apps/customer/src/pages/OpenAccount.tsx',
  cuOnboarding: 'apps/customer/src/lib/onboarding.ts',
  schema: 'apps/backend/prisma/schema.prisma',
  ledger: 'packages/shared/src/ledger.ts',
} as const;

/** A line-ranged source reference with a symbol the checker verifies. */
export function src(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

const relationCounts = new Map<string, number>();

/** A relation with a deterministic id (`rel:<from>-><to>:<kind>`, `:<n>` appended on repeats). */
export function rel(
  from: string,
  to: string,
  kind: RelationKind,
  label: string,
  extra: Partial<Omit<Relation, 'id' | 'from' | 'to' | 'kind' | 'label'>> = {},
): Relation {
  const base = `rel:${from}->${to}:${kind}`;
  const n = (relationCounts.get(base) ?? 0) + 1;
  relationCounts.set(base, n);
  return { id: n === 1 ? base : `${base}:${n}`, from, to, kind, label, ...extra };
}

/** A symbol entity inside a file-level module (`<file id>#<name>`). */
export function sym(
  fileId: string,
  name: string,
  kind: Entity['kind'],
  summary: string,
  rest: Partial<Omit<Entity, 'id' | 'kind' | 'name' | 'parent' | 'summary'>> = {},
): Entity {
  return { id: `${fileId}#${name}`, kind, name, parent: fileId, summary, ...rest };
}

// ---- Flow steps shared by many contracts ------------------------------------

/** Global onRequest hook #1 on a mutating, session-carrying request. */
export const csrfStep: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (global onRequest)',
  detail:
    'Unsafe method with a session cookie present: the `x-meridian-csrf` header must equal the `mer_csrf` cookie (constant-time compare). A request with no session cookie is let through so the auth guard can answer 401.',
  rejects: [{ status: 403, code: 'csrf_failed', when: 'A session cookie is present but the CSRF header is missing or does not match the cookie.' }],
  source: src(FILES.csrf, 86, 116, 'export async function csrfHook'),
};

/** Global onRequest hook #1 on a safe (GET) request. */
export const csrfSafeStep: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (global onRequest)',
  detail: 'Safe method: nothing is checked. If the client has no `mer_csrf` cookie yet, one is issued on this response.',
  source: src(FILES.csrf, 90, 93, 'SAFE_METHODS.has(method)'),
};

/** Global onRequest hook #2 (only active in public-demo mode). */
export const valveStep: FlowStep = {
  kind: 'hook',
  target: 'be:abuse/rate-limit#mutationValveHook',
  label: 'mutationValveHook (global onRequest)',
  detail:
    'Only when abuse protection is on (public demo or RATE_LIMITS=true): counts this state-changing request against the per-IP `mutations` bucket (200 per 5 minutes).',
  rejects: [{ status: 429, code: 'rate_limited', when: 'The client IP exceeded the `mutations` bucket; a `retry-after` header is set.' }],
  source: src(FILES.rateLimit, 178, 183, 'export async function mutationValveHook'),
};

export const requireAuthStep: FlowStep = {
  kind: 'guard',
  target: 'be:auth/guards#requireAuth',
  label: 'requireAuth',
  detail:
    'Picks the session cookie for the declared surface (`x-meridian-surface`, else Origin), resolves it to a live session and sets `req.user` = { id, email, displayName, role }.',
  rejects: [
    { status: 401, code: 'unauthenticated', when: 'No session cookie for this surface.' },
    { status: 401, code: 'session_expired', when: 'The cookie does not resolve to a live session (expired, revoked or user disabled); the dead cookie is cleared.' },
  ],
  source: src(FILES.guards, 47, 66, 'export const requireAuth'),
};

export function requireRoleStep(roles: string[], file: string, start: number, end: number, symbol: string): FlowStep {
  return {
    kind: 'guard',
    target: 'be:auth/guards#requireRole',
    label: `requireRole(${roles.map((r) => `'${r}'`).join(', ')})`,
    detail: `Reads \`req.user.role\`; anything other than ${roles.join(' / ')} ends the request.`,
    rejects: [{ status: 403, code: 'forbidden', when: `The signed-in user's role is not ${roles.join(' or ')} (e.g. a customer or joint customer).` }],
    source: src(file, start, end, symbol),
  };
}

export function rateLimitStep(bucket: string, policy: string, file: string, start: number, end: number, symbol: string): FlowStep {
  return {
    kind: 'guard',
    target: 'be:abuse/rate-limit#rateLimit',
    label: `rateLimit('${bucket}')`,
    detail: `No-op unless abuse protection is enabled (public demo). Otherwise a fixed-window counter: ${policy}.`,
    rejects: [{ status: 429, code: 'rate_limited', when: `The \`${bucket}\` bucket is exhausted for this client key; a \`retry-after\` header is set.` }],
    source: src(file, start, end, symbol),
  };
}

export function simNowStep(file: string, start: number, end: number, symbol = 'simulationNow'): FlowStep {
  return {
    kind: 'db-read',
    target: 'be:clock/clock#simulationNow',
    label: 'simulationNow(prisma)',
    detail: 'Reads the SimulationClock singleton (creating it if missing). This simulated instant, not the wall clock, dates every row the service writes.',
    source: src(file, start, end, symbol),
  };
}

/** The two errors every staff endpoint shares, as contract error entries. */
export const AUTH_ERRORS = [
  { status: 401, code: 'unauthenticated', when: 'No operations session cookie was sent.', source: src(FILES.guards, 50, 53, 'unauthenticated') },
  { status: 401, code: 'session_expired', when: 'The session cookie no longer resolves to a live session.', source: src(FILES.guards, 55, 59, 'session_expired') },
];

export const FORBIDDEN_STAFF = {
  status: 403,
  code: 'forbidden',
  when: 'The signed-in user is not an ops_agent or admin (customers and joint customers are refused).',
  example: { error: 'You do not have access to this resource.', code: 'forbidden' },
  source: src(FILES.guards, 78, 84, "code: 'forbidden'"),
};

export const CSRF_ERROR = {
  status: 403,
  code: 'csrf_failed',
  when: 'A session cookie is present but `x-meridian-csrf` is missing or differs from the `mer_csrf` cookie.',
  example: { error: 'Missing or invalid CSRF token. Reload the page and try again.', code: 'csrf_failed' },
  source: src(FILES.csrf, 110, 115, 'csrf_failed'),
};

export const RATE_LIMITED = {
  status: 429,
  code: 'rate_limited',
  when: 'Public-demo mode only: the per-route bucket or the global `mutations` valve is exhausted.',
  example: { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' },
  source: src(FILES.rateLimit, 142, 150, 'rate_limited'),
};
