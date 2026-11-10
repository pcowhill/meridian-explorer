import type { Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative paths of the Meridian files this slice models or cites. */
export const F = {
  cards: 'apps/backend/src/cards/cards.ts',
  fraud: 'apps/backend/src/risk/fraud.ts',
  disputes: 'apps/backend/src/risk/disputes.ts',
  routesCards: 'apps/backend/src/routes/cards.ts',
  routesRisk: 'apps/backend/src/routes/risk.ts',
  routesOps: 'apps/backend/src/routes/ops.ts',
  routesIndex: 'apps/backend/src/routes/index.ts',
  shCards: 'packages/shared/src/cards.ts',
  shRisk: 'packages/shared/src/risk.ts',
  shOps: 'packages/shared/src/operations.ts',
  shDemo: 'packages/shared/src/public-demo.ts',
  shLedger: 'packages/shared/src/ledger.ts',
  ops: 'apps/backend/src/ops/requests.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  movements: 'apps/backend/src/money/movements.ts',
  access: 'apps/backend/src/auth/access.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  server: 'apps/backend/src/server.ts',
  seedPlan: 'apps/backend/src/seed-plan.ts',
  seedApply: 'apps/backend/src/seed-apply.ts',
  schema: 'apps/backend/prisma/schema.prisma',
  testRoutes: 'apps/backend/src/routes/cards-risk.test.ts',
  testShCards: 'packages/shared/src/cards.test.ts',
  testShRisk: 'packages/shared/src/risk.test.ts',
  testE2e: 'e2e/cards-fraud-disputes.spec.ts',
  cuWallet: 'apps/customer/src/pages/Wallet.tsx',
  cuDashboard: 'apps/customer/src/pages/Dashboard.tsx',
  cuLibCards: 'apps/customer/src/lib/cards.ts',
  cuLibRisk: 'apps/customer/src/lib/risk.ts',
  cuTxnList: 'apps/customer/src/components/TransactionList.tsx',
  opQueues: 'apps/operations/src/pages/RequestQueues.tsx',
  opDetail: 'apps/operations/src/components/RequestDetailPanel.tsx',
  opQueueCard: 'apps/operations/src/components/QueueRequestCard.tsx',
  opApi: 'apps/operations/src/lib/opsApi.ts',
  opData: 'apps/operations/src/lib/OpsDataContext.tsx',
  opSocket: 'apps/operations/src/lib/useOpsSocket.ts',
} as const;

/** Build a SourceRef: `s(F.cards, 243, 245, 'freezeCard', 'optional note')`. */
export function s(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

const seen = new Map<string, number>();

/**
 * Build a Relation with the conventional id `rel:<from>-><to>:<kind>`; a
 * numeric suffix is appended when the same triple is used more than once.
 */
export function rel(
  from: string,
  to: string,
  kind: RelationKind,
  label: string,
  extra: Omit<Partial<Relation>, 'id' | 'from' | 'to' | 'kind' | 'label'> = {},
): Relation {
  const base = `rel:${from}->${to}:${kind}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return { id: n === 1 ? base : `${base}:${n}`, from, to, kind, label, ...extra };
}
