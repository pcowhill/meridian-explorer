import type { Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative paths of the Meridian files the money slice cites. */
export const F = {
  movements: 'apps/backend/src/money/movements.ts',
  routesMoney: 'apps/backend/src/routes/money.ts',
  routesAccounts: 'apps/backend/src/routes/accounts.ts',
  routesOps: 'apps/backend/src/routes/ops.ts',
  access: 'apps/backend/src/auth/access.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  server: 'apps/backend/src/server.ts',
  opsRequests: 'apps/backend/src/ops/requests.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  disputes: 'apps/backend/src/risk/disputes.ts',
  fraud: 'apps/backend/src/risk/fraud.ts',
  scheduler: 'apps/backend/src/scheduler/scheduler.ts',
  seedPlan: 'apps/backend/src/seed-plan.ts',
  schema: 'apps/backend/prisma/schema.prisma',
  shMoney: 'packages/shared/src/money.ts',
  shLedger: 'packages/shared/src/ledger.ts',
  shMovement: 'packages/shared/src/money-movement.ts',
  shTransactions: 'packages/shared/src/transactions.ts',
  shStatements: 'packages/shared/src/statements.ts',
  shPublicDemo: 'packages/shared/src/public-demo.ts',
  shAuth: 'packages/shared/src/auth.ts',
  cuMoveMoney: 'apps/customer/src/pages/MoveMoney.tsx',
  cuMoney: 'apps/customer/src/lib/money.ts',
  cuCsrf: 'apps/customer/src/lib/csrf.ts',
  cuAuth: 'apps/customer/src/lib/auth.ts',
  cuDashboard: 'apps/customer/src/pages/Dashboard.tsx',
  cuAccountDetail: 'apps/customer/src/pages/AccountDetail.tsx',
  tMoney: 'apps/backend/src/routes/money.test.ts',
  tTransactions: 'apps/backend/src/routes/transactions.test.ts',
  tRbac: 'apps/backend/src/routes/rbac.test.ts',
  tCaps: 'apps/backend/src/routes/caps.test.ts',
  tCsrf: 'apps/backend/src/routes/csrf.test.ts',
  tClockSchedules: 'apps/backend/src/routes/clock-schedules.test.ts',
  tSeedPlan: 'apps/backend/src/seed-plan.test.ts',
  tShLedger: 'packages/shared/src/ledger.test.ts',
  tShMoney: 'packages/shared/src/money.test.ts',
  tShMovement: 'packages/shared/src/money-movement.test.ts',
  tShTransactions: 'packages/shared/src/transactions.test.ts',
  tShStatements: 'packages/shared/src/statements.test.ts',
} as const;

/** A line-range source reference whose `symbol` must appear inside the range. */
export function src(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

/** Build a relation with the conventional id `rel:<from>-><to>:<kind>[:n]`. */
export function rel(
  from: string,
  to: string,
  kind: RelationKind,
  extra: Omit<Partial<Relation>, 'id' | 'from' | 'to' | 'kind'> = {},
  n?: number,
): Relation {
  return { id: `rel:${from}->${to}:${kind}${n ? `:${n}` : ''}`, from, to, kind, ...extra };
}
