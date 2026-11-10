import type { Entity, EntityKind, Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative paths of the Meridian files this slice models. */
export const P = {
  clock: 'apps/backend/src/clock/clock.ts',
  scheduler: 'apps/backend/src/scheduler/scheduler.ts',
  schedules: 'apps/backend/src/scheduler/schedules.ts',
  lending: 'apps/backend/src/lending/lending.ts',
  accrual: 'apps/backend/src/lending/accrual.ts',
  rClock: 'apps/backend/src/routes/clock.ts',
  rSchedules: 'apps/backend/src/routes/schedules.ts',
  rLending: 'apps/backend/src/routes/lending.ts',
  shClock: 'packages/shared/src/clock.ts',
  shSchedules: 'packages/shared/src/schedules.ts',
  shLending: 'packages/shared/src/lending.ts',
  movements: 'apps/backend/src/money/movements.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  realtime: 'apps/backend/src/realtime.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  publicDemo: 'packages/shared/src/public-demo.ts',
  schema: 'apps/backend/prisma/schema.prisma',
  tClockSchedules: 'apps/backend/src/routes/clock-schedules.test.ts',
  tLending: 'apps/backend/src/routes/lending.test.ts',
  tShClock: 'packages/shared/src/clock.test.ts',
  tShSchedules: 'packages/shared/src/schedules.test.ts',
  tShLending: 'packages/shared/src/lending.test.ts',
  e2eSchedules: 'e2e/scheduled-payments.spec.ts',
  e2eLending: 'e2e/lending.spec.ts',
  adr2: 'docs/process/decisions/ADR-0002-simulation-clock-and-scheduler.md',
  adr3: 'docs/process/decisions/ADR-0003-lending-and-simulated-date-everywhere.md',
  opsClockPage: 'apps/operations/src/pages/SimulationClock.tsx',
  opsApi: 'apps/operations/src/lib/opsApi.ts',
  opsApiBase: 'apps/operations/src/lib/api.ts',
  opsData: 'apps/operations/src/lib/OpsDataContext.tsx',
  cuSchedulesPage: 'apps/customer/src/pages/ScheduledPayments.tsx',
  cuSchedulesLib: 'apps/customer/src/lib/schedules.ts',
  cuLendingPage: 'apps/customer/src/pages/Lending.tsx',
  cuLendingLib: 'apps/customer/src/lib/lending.ts',
} as const;

/** A source reference with a verifiable symbol. */
export function src(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

/** Entity shorthand. */
export function ent(
  id: string,
  kind: EntityKind,
  name: string,
  parent: string,
  summary: string,
  extra: Partial<Entity> = {},
): Entity {
  return { id, kind, name, parent, summary, ...extra };
}

/** Relation shorthand; the id follows `rel:<from>-><to>:<kind>[:n]`. */
export function rel(
  from: string,
  to: string,
  kind: RelationKind,
  label: string,
  extra: Partial<Relation> & { n?: number } = {},
): Relation {
  const { n, ...rest } = extra;
  return { id: `rel:${from}->${to}:${kind}${n ? `:${n}` : ''}`, from, to, kind, label, ...rest };
}
