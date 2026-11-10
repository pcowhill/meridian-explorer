import type { Entity, Relation } from '../../types';
import { P, ent, rel, src } from './util';

/**
 * Simulation clock + scheduler: the backend services under `be.clock` and the
 * shared contracts `sh:clock` and `sh:schedules`.
 */

// ---------------------------------------------------------------------------
// Backend: clock/clock.ts
// ---------------------------------------------------------------------------

const clockEntities: Entity[] = [
  ent('be:clock/clock', 'module', 'clock/clock.ts', 'be.clock', 'The simulation-clock service: reads the single clock row and moves it forward, with an audit row for every advance.', {
    description:
      'The clock is one row in `SimulationClock` with the fixed id `singleton`. `simulationNow(db)` is what every money- and business-dating code path calls instead of `new Date()` (24 call sites across the route and service files), so advancing the clock moves the date stamped on ledger entries, requests, schedules and lending products with it.\n\nThe clock only moves when an operator or admin calls `advanceClock`; there is no background timer. It only moves forward: a non-positive or fractional minute count throws `ClockError(\'invalid_advance\')`. Running the scheduler and interest accrual after an advance is the route handler\'s job (`routes/clock.ts`), not this module\'s — `advanceClock` returns the `from`/`to` instants for that purpose.\n\nAuthentication timestamps (session expiry, lockout, login history) and the heartbeat\'s `serverTime` deliberately stay on the wall clock (ADR-0003 decision 2).',
    audience: {
      executive: 'The bank\'s calendar. Staff move it forward on purpose so that time-based behaviour — scheduled payments, interest — can be demonstrated in minutes.',
      'end-user': 'The simulated "today" shown in the app. It only changes when bank staff fast-forward it.',
      dba: 'Owns the single `SimulationClock` row (id `singleton`): one upsert on read, one update per advance, plus one `AuditLog` insert.',
    },
    tech: ['Prisma'],
    tags: ['time', 'audit', 'data'],
    aliases: ['simulation clock', 'clock service', 'simulated time'],
    sources: [
      src(P.clock, 5, 14, 'Simulation-clock service', 'Module header: authoritative time for money dating, forward-only, audited'),
      src(P.adr2, 20, 26, 'forward-only', 'ADR-0002 decision 1'),
      src(P.adr3, 21, 28, 'SINGLE authoritative "now"', 'ADR-0003 decision 1: every money/business timestamp reads the clock'),
    ],
  }),
  ent('be:clock/clock#ClockError', 'class', 'ClockError', 'be:clock/clock', 'Typed error thrown when an advance is not a positive whole number of minutes.', {
    description:
      'Carries `code: ClockErrorCode`, whose only value is `invalid_advance`. The advance route maps it to HTTP 400 with that code. Because the route validates with `validateAdvance` first, this is a second line of defence for callers that bypass the route.',
    values: [{ value: 'invalid_advance', meaning: '`minutes` is not an integer or is ≤ 0 — "The simulation clock can only move forward."' }],
    tags: ['time', 'validation'],
    sources: [src(P.clock, 16, 25, 'export class ClockError')],
  }),
  ent('be:clock/clock#getClockRow', 'function', 'getClockRow (private)', 'be:clock/clock', 'Reads the clock singleton, creating it at the current wall-clock time if the row is missing.', {
    description:
      'Implemented as a Prisma `upsert` with an empty `update`, so a database without the row heals itself on first read. The seed normally creates the row at seed time. Not exported; every public function in the module goes through it.',
    signature: 'async function getClockRow(db: DbClient, fallbackNow: Date = new Date()): Promise<ClockRow>',
    detail: 5,
    tags: ['time', 'data'],
    aliases: ['singleton row', 'clock row'],
    sources: [src(P.clock, 27, 42, 'async function getClockRow')],
  }),
  ent('be:clock/clock#getClockState', 'function', 'getClockState', 'be:clock/clock', 'Returns the clock as a DTO (`currentTime` ISO string + `speed`) for `GET /api/clock`.', {
    signature: 'export async function getClockState(db: DbClient): Promise<SimulationClockDTO>',
    tags: ['time'],
    sources: [src(P.clock, 44, 51, 'export async function getClockState')],
  }),
  ent('be:clock/clock#simulationNow', 'function', 'simulationNow', 'be:clock/clock', 'The authoritative simulated "now" as a `Date` — what the backend uses wherever it dates money or business events.', {
    description:
      'Reads `SimulationClock.currentTime`. Route handlers call it once per request and pass the result down as `now` to domain services (`createTransfer`, `createSchedule`, `openLoan`, …), which stamp it on `postedAt`, `createdAt`, `openedAt` and similar columns. Between advances the clock stands still, so several rows written in one sitting share an identical timestamp; transaction lists break the tie by id (ADR-0003 decision 3).',
    signature: 'export async function simulationNow(db: DbClient): Promise<Date>',
    detail: 3,
    tags: ['time', 'money'],
    aliases: ['simulated now', 'sim now', 'current simulated date'],
    sources: [
      src(P.clock, 53, 60, 'export async function simulationNow'),
      src(P.adr3, 38, 44, 'breaks ties by `id`', 'Same-instant ordering'),
    ],
  }),
  ent('be:clock/clock#advanceClock', 'function', 'advanceClock', 'be:clock/clock', 'Moves the clock forward by a whole number of minutes, writes the audit row and returns the window that just elapsed.', {
    description:
      'Steps: (1) reject anything that is not a positive integer with `ClockError(\'invalid_advance\')`; (2) read the current row; (3) compute `to = advanceBy(current, minutes)`; (4) `update` the singleton\'s `currentTime`; (5) write an `AuditLog` row `clock_advanced` on entity `simulation_clock` with `fromISO`, `toISO`, `minutes` and the actor\'s name in the metadata.\n\nThe update and the audit insert are two separate statements, not one transaction. The function does not fire schedules or accrue interest; it returns `{ clock, from, to }` so the route can run both over the elapsed window.',
    signature: 'export async function advanceClock(db: DbClient, minutes: number, actor: SessionUser): Promise<{ clock: SimulationClockDTO; from: Date; to: Date }>',
    detail: 3,
    tags: ['time', 'audit', 'operations'],
    aliases: ['advance clock', 'fast-forward', 'time travel'],
    example: {
      clock: { currentTime: '2026-10-31T15:00:00.000Z', speed: 1 },
      from: '2026-10-01T15:00:00.000Z',
      to: '2026-10-31T15:00:00.000Z',
    },
    sources: [
      src(P.clock, 62, 103, 'export async function advanceClock'),
      src(P.clock, 72, 74, 'invalid_advance', 'Forward-only guard'),
      src(P.clock, 83, 96, 'clock_advanced', 'Audit row'),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Backend: scheduler/scheduler.ts
// ---------------------------------------------------------------------------

const schedulerEntities: Entity[] = [
  ent('be:scheduler/scheduler', 'module', 'scheduler/scheduler.ts', 'be.clock', 'The due-schedule runner: when the clock advances, it fires every active schedule whose next run date has been passed.', {
    description:
      'There is no cron and no timer. `routes/clock.ts` calls `runDueSchedules(upTo)` right after the clock moves. Each due occurrence is fired by reusing the money service with the schedule owner as the acting user and the occurrence\'s due instant as `now`:\n\n• `internal_transfer` → `createTransfer` posts both `transfer` legs (nets to zero).\n• `bill_pay` → `createExternalMovement` writes a pending `payment` debit and a queued `OperationsRequest` an operator must approve.\n\nBecause the owner is the principal, the money service\'s own access and funds checks apply unchanged. An occurrence that fails them is skipped — recorded as a simulated event and an audit row — and the schedule still moves on. One schedule failing never stops the others.',
    audience: {
      executive: 'Recurring payments run automatically when their date arrives, under exactly the same rules as a payment the customer makes by hand.',
      'end-user': 'When the simulated date passes a scheduled payment\'s due date, the payment is made. If there is not enough money that occurrence is skipped and recorded.',
      dba: 'Reads due `PaymentSchedule` rows ordered by `nextRunAt`; per occurrence one claim update, then ledger/request writes via the money service, then a bookkeeping update. Skips write `SimulatedEvent` + `AuditLog` only.',
    },
    tech: ['Prisma'],
    tags: ['time', 'money', 'ledger', 'scheduler'],
    aliases: ['scheduler', 'due schedule runner', 'recurring payments engine'],
    sources: [
      src(P.scheduler, 25, 42, 'The clock-driven scheduler', 'Module header'),
      src(P.adr2, 45, 52, 'no wall-clock background timer', 'ADR-0002 decision 3'),
      src(P.adr2, 54, 62, 'reuses the v0.7.0 money service', 'ADR-0002 decision 4'),
    ],
  }),
  ent('be:scheduler/scheduler#SchedulerResult', 'type', 'SchedulerResult', 'be:scheduler/scheduler', 'What one scheduler run produced: per-schedule summaries plus the requests and events to broadcast.', {
    fields: [
      { name: 'fired', type: 'ScheduleFireSummary[]', required: true, description: 'One entry per schedule that ran or skipped at least one occurrence.', typeRef: 'sh:schedules#ScheduleFireSummary' },
      { name: 'requests', type: 'OperationsRequestDTO[]', required: true, description: 'Queue items created by fired bill pays; the route emits `ops:request_changed` for each.' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, description: 'Fired / skipped notices and movement events; the route emits `ops:external_event` for each.' },
    ],
    tags: ['time'],
    sources: [src(P.scheduler, 44, 51, 'export interface SchedulerResult')],
  }),
  ent('be:scheduler/scheduler#runDueSchedules', 'function', 'runDueSchedules', 'be:scheduler/scheduler', 'Finds every active schedule due at or before the new clock time and fires each in due-date order.', {
    description:
      'Query: `status = \'active\'` and `nextRunAt` not null and `<= upTo`, including the owning user, ordered by `nextRunAt` ascending. Schedules are processed one after another; each call to `fireSchedule` is wrapped in a try/catch that swallows unexpected errors so the remaining schedules still run. A summary is only added to `fired` when the schedule ran or skipped something.\n\nOrdering is per schedule, not per occurrence: if two schedules each have several missed occurrences, the first schedule catches up completely before the second starts.',
    signature: 'export async function runDueSchedules(upTo: Date): Promise<SchedulerResult>',
    detail: 3,
    tags: ['time', 'money', 'scheduler'],
    aliases: ['fire due schedules', 'scheduler run'],
    sources: [
      src(P.scheduler, 57, 80, 'export async function runDueSchedules'),
      src(P.scheduler, 59, 63, "status: 'active', nextRunAt", 'The due query'),
      src(P.scheduler, 66, 78, 'fireSchedule(schedule, upTo, result)', 'Per-schedule guard'),
    ],
  }),
  ent('be:scheduler/scheduler#fireSchedule', 'function', 'fireSchedule (private)', 'be:scheduler/scheduler', 'Fires one schedule\'s due occurrences one at a time — claim the occurrence, move the money, record the outcome.', {
    description:
      'Loops while `nextRunAt <= upTo` and the schedule is still active. For each occurrence:\n\n1. Compute `following = addInterval(occurrenceAt, frequency)` — `null` for `once`.\n2. CLAIM: update the row to `nextRunAt = following`, `status = \'completed\'` if there is no following occurrence else `\'active\'`, `updatedAt = upTo`. This happens before any money moves, so a crash can lose an occurrence but never charge it twice.\n3. FIRE with the owner as `SessionUser` and `occurrenceAt` as `now`: `createTransfer` for an internal transfer, `createExternalMovement` (kind `bill_pay`, direction `outbound`) for a bill pay.\n4. On success: increment `runCount`, set `lastRunAt = occurrenceAt`, record a `schedule_fired` simulated event.\n5. On any error: count a skip, record a `schedule_skipped` event (or `schedule_fire_errored` if it was not a `MovementError`) and an audit row `schedule_payment_skipped` with the error code and amount. The error is not rethrown.\n\nCatch-up is capped at `SCHEDULE_LIMITS.maxCatchUpRuns` (60) occurrences per schedule per advance. If the cap is hit the remaining due dates are stepped past `upTo` and an audit row `schedule_catchup_capped` is written.\n\nNote: the skip audit row uses the schedule owner as `actorId` but `actorRole: \'system\'`.',
    signature: 'async function fireSchedule(schedule: ScheduleWithUser, upTo: Date, sink: SchedulerResult): Promise<ScheduleFireSummary>',
    detail: 4,
    tags: ['time', 'money', 'ledger', 'audit', 'scheduler'],
    aliases: ['fire a schedule', 'occurrence', 'skipped occurrence', 'catch-up'],
    sources: [
      src(P.scheduler, 91, 101, 'async function fireSchedule', 'Doc comment + signature'),
      src(P.scheduler, 138, 148, 'CLAIM this occurrence first', 'Claim before money moves'),
      src(P.scheduler, 150, 187, 'createExternalMovement', 'The two fire paths'),
      src(P.scheduler, 189, 208, "kind: 'schedule_fired'", 'Success bookkeeping + event'),
      src(P.scheduler, 209, 246, 'schedule_payment_skipped', 'Skip handling'),
      src(P.scheduler, 116, 136, 'schedule_catchup_capped', 'Catch-up cap'),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Backend: scheduler/schedules.ts
// ---------------------------------------------------------------------------

const scheduleServiceEntities: Entity[] = [
  ent('be:scheduler/schedules', 'module', 'scheduler/schedules.ts', 'be.clock', 'The schedule CRUD service: create, list and cancel the payment instructions. No money moves here.', {
    description:
      'A `PaymentSchedule` row is an instruction, not a transaction. This module checks that the caller may move money on the accounts involved (the same owner / joint / authorized relationships the money service accepts), enforces the per-user cap on active schedules, computes the first due date from the simulated now, and audits create and cancel. Firing lives in `scheduler.ts`.',
    tech: ['Prisma'],
    tags: ['time', 'money', 'rbac', 'audit'],
    aliases: ['schedule service', 'scheduled payments service'],
    sources: [src(P.schedules, 19, 26, 'Scheduled-payment service')],
  }),
  ent('be:scheduler/schedules#ScheduleError', 'class', 'ScheduleError', 'be:scheduler/schedules', 'Typed error for schedule operations; its `code` decides the HTTP status.', {
    values: [
      { value: 'not_found', meaning: 'Account or schedule does not exist → 404' },
      { value: 'forbidden', meaning: 'Caller has no movable relationship to the account, or the schedule belongs to someone else → 403' },
      { value: 'inactive_account', meaning: 'Account status is not `active` → 400' },
      { value: 'invalid', meaning: 'Internal transfer without a destination, or source = destination → 400' },
      { value: 'already_inactive', meaning: 'Cancelling a schedule that is already completed or cancelled → 409' },
      { value: 'limit_reached', meaning: 'Caller already has 25 active schedules → 409' },
    ],
    tags: ['validation'],
    sources: [src(P.schedules, 28, 43, 'export class ScheduleError')],
  }),
  ent('be:scheduler/schedules#toScheduleDTO', 'function', 'toScheduleDTO', 'be:scheduler/schedules', 'Maps a `PaymentSchedule` row (with its from/to account names) to the client-facing `ScheduleDTO`.', {
    signature: 'export function toScheduleDTO(row: ScheduleWithAccounts): ScheduleDTO',
    tags: ['data'],
    sources: [src(P.schedules, 59, 77, 'export function toScheduleDTO')],
  }),
  ent('be:scheduler/schedules#requireSchedulableAccount', 'function', 'requireSchedulableAccount (private)', 'be:scheduler/schedules', 'Confirms the user may schedule payments on an account: it exists, they hold a non-viewer relationship, and it is active.', {
    description:
      'Checks run in this order: account exists (`not_found`), relationship from `getAccountRelationship` is `owner`, `joint` or `authorized` (`forbidden`), account status is `active` (`inactive_account`).',
    signature: 'async function requireSchedulableAccount(userId: string, accountId: string): Promise<void>',
    detail: 5,
    tags: ['rbac', 'security'],
    sources: [src(P.schedules, 79, 90, 'async function requireSchedulableAccount'), src(P.schedules, 45, 45, 'MOVABLE_RELATIONSHIPS')],
  }),
  ent('be:scheduler/schedules#createSchedule', 'function', 'createSchedule', 'be:scheduler/schedules', 'Creates a schedule after access and cap checks; the first due date is the simulated now plus `firstRunInDays`.', {
    description:
      'Order of work: access check on the source account; for an internal transfer also require a destination that differs from the source and pass the same access check; count the caller\'s active schedules against `RESOURCE_CAPS.activeSchedulesPerUser` (25); compute `nextRunAt = now + firstRunInDays × 24h`; insert the row with `status: \'active\'`, `createdAt` and `updatedAt` set to the simulated `now`; write an `AuditLog` row `schedule_created`.\n\n`toAccountId` is stored only for internal transfers and `counterparty` only for bill pays. There is no funds check at creation — funds are checked each time an occurrence fires.',
    signature: 'export async function createSchedule(user: SessionUser, input: NormalizedCreateSchedule, now: Date): Promise<ScheduleDTO>',
    detail: 3,
    tags: ['time', 'money', 'rbac', 'audit'],
    sources: [
      src(P.schedules, 92, 102, 'export async function createSchedule'),
      src(P.schedules, 103, 121, 'activeSchedulesPerUser', 'Access checks and the active-schedule cap'),
      src(P.schedules, 123, 141, 'input.firstRunInDays * DAY_MS', 'First due date + insert'),
      src(P.schedules, 143, 161, 'schedule_created', 'Audit row'),
    ],
  }),
  ent('be:scheduler/schedules#listSchedulesForUser', 'function', 'listSchedulesForUser', 'be:scheduler/schedules', 'Lists the caller\'s own schedules, ordered by status, then next run date, then newest.', {
    description:
      'Filters on `PaymentSchedule.userId` — the creator — not on account access, so a joint owner does not see schedules another owner created on a shared account. `status` sorts alphabetically, which puts `active` first.',
    signature: 'export async function listSchedulesForUser(userId: string): Promise<ScheduleDTO[]>',
    tags: ['time'],
    sources: [src(P.schedules, 166, 174, 'export async function listSchedulesForUser')],
  }),
  ent('be:scheduler/schedules#listAllSchedules', 'function', 'listAllSchedules', 'be:scheduler/schedules', 'Lists every customer\'s schedules for the operator view, in the same order.', {
    signature: 'export async function listAllSchedules(): Promise<ScheduleDTO[]>',
    tags: ['time', 'operations'],
    sources: [src(P.schedules, 176, 183, 'export async function listAllSchedules')],
  }),
  ent('be:scheduler/schedules#cancelSchedule', 'function', 'cancelSchedule', 'be:scheduler/schedules', 'Cancels an active schedule: only its creator may, and it clears the next run date so it can never fire again.', {
    description:
      'Checks: schedule exists (`not_found`), `userId` equals the caller (`forbidden` — "That is not your schedule."), status is `active` (`already_inactive`). Then one update sets `status: \'cancelled\'`, `nextRunAt: null`, `updatedAt: now` and an `AuditLog` row `schedule_cancelled` is written. Operators cannot cancel a customer\'s schedule through this function.',
    signature: 'export async function cancelSchedule(user: SessionUser, scheduleId: string, now: Date): Promise<ScheduleDTO>',
    detail: 3,
    tags: ['time', 'rbac', 'audit'],
    sources: [
      src(P.schedules, 185, 211, 'export async function cancelSchedule'),
      src(P.schedules, 194, 198, "status: 'cancelled', nextRunAt: null", 'The cancel update'),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Shared: packages/shared/src/clock.ts
// ---------------------------------------------------------------------------

const shClockEntities: Entity[] = [
  ent('sh:clock', 'module', 'clock.ts', 'shared', 'Shared clock contracts: the clock DTO, the advance request, its forward-only validation and the heartbeat payload.', {
    description:
      'Imported by the backend route and by the operations console, so the "may I advance by this much?" rule is the same function on both sides. `speed` exists on the DTO but is informational — nothing advances the clock automatically.',
    tags: ['time', 'validation'],
    aliases: ['clock contracts'],
    sources: [src(P.shClock, 1, 13, 'Simulation-clock contracts')],
  }),
  ent('sh:clock#SimulationClockDTO', 'type', 'SimulationClockDTO', 'sh:clock', 'The clock as clients see it: the simulated time and a speed multiplier.', {
    fields: [
      { name: 'currentTime', type: 'string', required: true, description: 'The current simulated time, ISO 8601.' },
      { name: 'speed', type: 'number', required: true, description: 'Informational multiplier (stored default 1); advancing is manual.' },
    ],
    example: { currentTime: '2026-10-01T15:00:00.000Z', speed: 1 },
    tags: ['time'],
    sources: [src(P.shClock, 16, 22, 'export interface SimulationClockDTO')],
  }),
  ent('sh:clock#ADVANCE_CLOCK_LIMITS', 'constant', 'ADVANCE_CLOCK_LIMITS', 'sh:clock', 'Bounds on a single advance: at least 1 minute, at most 366 days.', {
    description: 'The upper bound keeps the scheduler\'s catch-up loop and the accrual loop bounded: one advance can never span more than a leap year.',
    values: [
      { value: 'minMinutes: 1', meaning: 'Must move strictly forward' },
      { value: 'maxMinutes: 527040', meaning: '366 × 24 × 60 — one leap year per advance' },
    ],
    tags: ['time', 'validation'],
    sources: [src(P.shClock, 24, 30, 'export const ADVANCE_CLOCK_LIMITS')],
  }),
  ent('sh:clock#AdvanceClockRequest', 'type', 'AdvanceClockRequest', 'sh:clock', 'Body of the advance request: any combination of days, hours and minutes.', {
    fields: [
      { name: 'minutes', type: 'number', required: false },
      { name: 'hours', type: 'number', required: false },
      { name: 'days', type: 'number', required: false },
    ],
    example: { days: 30 },
    tags: ['time'],
    sources: [src(P.shClock, 34, 43, 'export interface AdvanceClockRequest')],
  }),
  ent('sh:clock#NormalizedAdvance', 'type', 'NormalizedAdvance', 'sh:clock', 'A validated advance reduced to whole minutes.', {
    fields: [{ name: 'minutes', type: 'number', required: true, description: 'Whole minutes to move forward (1 … 527040).' }],
    example: { minutes: 43200 },
    detail: 5,
    tags: ['time'],
    sources: [src(P.shClock, 45, 50, 'export interface NormalizedAdvance')],
  }),
  ent('sh:clock#advanceRequestMinutes', 'function', 'advanceRequestMinutes', 'sh:clock', 'Sums days, hours and minutes into total minutes, truncating fractions and treating anything non-numeric as 0.', {
    signature: 'export function advanceRequestMinutes(input: Partial<AdvanceClockRequest>): number',
    example: { input: { days: 1, hours: 2, minutes: 30 }, result: 1590 },
    tags: ['time'],
    sources: [src(P.shClock, 52, 56, 'export function advanceRequestMinutes')],
  }),
  ent('sh:clock#validateAdvance', 'function', 'validateAdvance', 'sh:clock', 'Validates a requested advance: the total must be at least one minute forward and at most one year.', {
    description:
      'Pure. Returns `{ ok, errors, value }`. The only error field is `amount`:\n• total < 1 minute → "Advance the clock forward by at least one minute (the simulation clock cannot rewind)."\n• total > 527040 minutes → "You can advance the clock by at most one year at a time (simulated)."\n\nThe operations console calls it before sending and to enable the submit button; the route calls it again on the server.',
    signature: 'export function validateAdvance(input: Partial<AdvanceClockRequest>): ValidationResult<NormalizedAdvance, AdvanceClockField>',
    detail: 3,
    tags: ['time', 'validation'],
    aliases: ['forward-only validation'],
    example: { input: { days: -1 }, result: { ok: false, errors: { amount: 'Advance the clock forward by at least one minute (the simulation clock cannot rewind).' } } },
    sources: [src(P.shClock, 58, 74, 'export function validateAdvance')],
  }),
  ent('sh:clock#advanceBy', 'function', 'advanceBy', 'sh:clock', 'Adds whole minutes to a date and returns the new date.', {
    signature: 'export function advanceBy(now: Date, minutes: number): Date',
    detail: 5,
    tags: ['time'],
    sources: [src(P.shClock, 76, 79, 'export function advanceBy')],
  }),
  ent('sh:clock#ClockResponse', 'type', 'ClockResponse', 'sh:clock', 'Success body of `GET /api/clock`.', {
    fields: [{ name: 'clock', type: 'SimulationClockDTO', required: true, typeRef: 'sh:clock#SimulationClockDTO' }],
    example: { clock: { currentTime: '2026-10-01T15:00:00.000Z', speed: 1 } },
    detail: 5,
    tags: ['time'],
    sources: [src(P.shClock, 81, 84, 'export interface ClockResponse')],
  }),
  ent('sh:clock#SimHeartbeatPayload', 'type', 'SimHeartbeatPayload', 'sh:clock', 'Payload of the `sim:heartbeat` socket event: wall-clock server time plus the simulated time.', {
    description:
      '`simulationTime` is optional: the heartbeat reads the clock row best-effort and omits the field if the read fails. The operations console uses it to keep the displayed simulated date live and to notice an advance made from another console.',
    fields: [
      { name: 'serverTime', type: 'string', required: true, description: 'Real server time (ISO).' },
      { name: 'simulationTime', type: 'string', required: false, description: 'Current `SimulationClock.currentTime` (ISO).' },
    ],
    example: { serverTime: '2026-11-10T09:30:10.000Z', simulationTime: '2026-10-31T15:00:00.000Z' },
    tags: ['time', 'realtime'],
    sources: [src(P.shClock, 86, 95, 'export interface SimHeartbeatPayload'), src(P.realtime, 52, 68, 'simulationTime', 'Where the heartbeat reads the clock')],
  }),
];

// ---------------------------------------------------------------------------
// Shared: packages/shared/src/schedules.ts
// ---------------------------------------------------------------------------

const shScheduleEntities: Entity[] = [
  ent('sh:schedules', 'module', 'schedules.ts', 'shared', 'Shared scheduled-payment contracts: kinds, frequencies, statuses, limits, next-run arithmetic, the create validator and DTOs.', {
    description:
      'The same `validateCreateSchedule` runs in the customer form and again on the server. The validator checks shape only; account access and funds need the database and live in the backend. The module also defines the advance response (`AdvanceClockResponse`) because that response reports what the scheduler fired.',
    tags: ['time', 'money', 'validation'],
    aliases: ['schedule contracts', 'recurring payment contracts'],
    sources: [src(P.shSchedules, 1, 15, 'Recurring / scheduled-payment contracts')],
  }),
  ent('sh:schedules#SCHEDULE_KINDS', 'constant', 'SCHEDULE_KINDS / ScheduleKind', 'sh:schedules', 'The two kinds of payment a customer can schedule.', {
    values: [
      { value: 'internal_transfer', meaning: 'Between two of the customer\'s own accounts; posts both legs when it fires' },
      { value: 'bill_pay', meaning: 'To a named biller; queues a pending payment for operator review when it fires' },
    ],
    tags: ['time', 'money'],
    aliases: ['ScheduleKind', 'isScheduleKind'],
    sources: [src(P.shSchedules, 23, 25, 'export const SCHEDULE_KINDS'), src(P.shSchedules, 35, 37, 'export function isScheduleKind')],
  }),
  ent('sh:schedules#SCHEDULE_FREQUENCIES', 'constant', 'SCHEDULE_FREQUENCIES / ScheduleFrequency', 'sh:schedules', 'How often a schedule fires.', {
    values: [
      { value: 'once', meaning: 'A single future-dated payment; the schedule completes after it' },
      { value: 'weekly', meaning: 'Every 7 × 24 hours' },
      { value: 'monthly', meaning: 'Same day of the next calendar month (UTC), clamped to the month\'s last day' },
    ],
    tags: ['time'],
    aliases: ['ScheduleFrequency', 'frequency', 'isScheduleFrequency'],
    sources: [src(P.shSchedules, 27, 29, 'export const SCHEDULE_FREQUENCIES'), src(P.shSchedules, 38, 40, 'export function isScheduleFrequency')],
  }),
  ent('sh:schedules#SCHEDULE_STATUSES', 'constant', 'SCHEDULE_STATUSES / ScheduleStatus', 'sh:schedules', 'Lifecycle of a schedule: active until it completes or is cancelled.', {
    values: [
      { value: 'active', meaning: 'Can still fire and can be cancelled' },
      { value: 'completed', meaning: 'A one-time schedule after its single occurrence was claimed — terminal' },
      { value: 'cancelled', meaning: 'Cancelled by its creator — terminal' },
    ],
    tags: ['time'],
    aliases: ['ScheduleStatus', 'isScheduleStatus'],
    sources: [src(P.shSchedules, 31, 33, 'export const SCHEDULE_STATUSES'), src(P.shSchedules, 41, 43, 'export function isScheduleStatus')],
  }),
  ent('sh:schedules#isActiveSchedule', 'function', 'isActiveSchedule', 'sh:schedules', 'True only for status `active` — the one state in which a schedule can fire or be cancelled.', {
    signature: 'export function isActiveSchedule(status: ScheduleStatus): boolean',
    detail: 5,
    tags: ['time'],
    sources: [src(P.shSchedules, 45, 48, 'export function isActiveSchedule')],
  }),
  ent('sh:schedules#SCHEDULE_LIMITS', 'constant', 'SCHEDULE_LIMITS', 'sh:schedules', 'Policy bounds for schedules: amount range, how far ahead the first run may be, and the catch-up cap.', {
    values: [
      { value: 'minMinor: 1', meaning: '$0.01 — reuses `MOVEMENT_LIMITS.minMinor`' },
      { value: 'maxMinor: 5000000', meaning: '$50,000.00 — reuses `MOVEMENT_LIMITS.maxMinor`, so a schedule can never move more than a manual payment' },
      { value: 'maxFirstRunInDays: 365', meaning: 'The first run may be placed at most a year ahead' },
      { value: 'maxCatchUpRuns: 60', meaning: 'Most occurrences one schedule may fire in a single clock advance' },
    ],
    tags: ['time', 'money', 'validation'],
    sources: [src(P.shSchedules, 52, 61, 'export const SCHEDULE_LIMITS')],
  }),
  ent('sh:schedules#SCHEDULE_KIND_LABELS', 'constant', 'Schedule label maps', 'sh:schedules', 'Display labels for schedule kinds, frequencies and statuses, with `scheduleKindLabel`, `scheduleFrequencyLabel` and `scheduleStatusLabel` lookups.', {
    description:
      'Three maps — `SCHEDULE_KIND_LABELS`, `SCHEDULE_FREQUENCY_LABELS`, `SCHEDULE_STATUS_LABELS` — and one lookup function for each. The backend also uses the kind label inside audit reasons and simulated-event summaries ("Scheduled bill payment — $65.00 (simulated)").',
    values: [
      { value: 'internal_transfer', meaning: 'Transfer between your accounts' },
      { value: 'bill_pay', meaning: 'Bill payment' },
      { value: 'once / weekly / monthly', meaning: 'One time / Weekly / Monthly' },
      { value: 'active / completed / cancelled', meaning: 'Active / Completed / Cancelled' },
    ],
    detail: 5,
    tags: ['ui'],
    aliases: ['SCHEDULE_FREQUENCY_LABELS', 'SCHEDULE_STATUS_LABELS', 'scheduleKindLabel', 'scheduleFrequencyLabel', 'scheduleStatusLabel'],
    sources: [src(P.shSchedules, 65, 88, 'export const SCHEDULE_KIND_LABELS')],
  }),
  ent('sh:schedules#addInterval', 'function', 'addInterval', 'sh:schedules', 'Computes the occurrence after a given one: +7 days for weekly, +1 calendar month for monthly, none for a one-time schedule.', {
    description:
      'Pure and UTC-based. `monthly` keeps the day of month and clamps it to the last day of the target month (Jan 31 → Feb 28, or Feb 29 in a leap year) — and because each step starts from the previous result, a schedule that was clamped to the 28th stays on the 28th afterwards. `once` returns `null`, which is how the scheduler knows to mark the schedule `completed`.',
    signature: 'export function addInterval(from: Date, frequency: ScheduleFrequency): Date | null',
    detail: 3,
    tags: ['time'],
    aliases: ['next run computation', 'nextRunAt', 'addOneMonthClamped'],
    example: { from: '2026-10-06T15:00:00.000Z', frequency: 'monthly', result: '2026-11-06T15:00:00.000Z' },
    sources: [src(P.shSchedules, 109, 122, 'export function addInterval'), src(P.shSchedules, 94, 107, 'function addOneMonthClamped', 'Month clamping')],
  }),
  ent('sh:schedules#ScheduleDTO', 'type', 'ScheduleDTO', 'sh:schedules', 'A schedule as returned to clients: the instruction, its status and its run bookkeeping. Never a balance.', {
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'kind', type: 'ScheduleKind', required: true, typeRef: 'sh:schedules#SCHEDULE_KINDS', values: ['internal_transfer', 'bill_pay'] },
      { name: 'amountMinor', type: 'number', required: true, description: 'Positive integer minor units.' },
      { name: 'fromAccountId', type: 'string', required: true },
      { name: 'fromAccountName', type: 'string | null', required: true },
      { name: 'toAccountId', type: 'string | null', required: true, description: 'Destination for an internal transfer; null for a bill pay.' },
      { name: 'toAccountName', type: 'string | null', required: true },
      { name: 'counterparty', type: 'string | null', required: true, description: 'Biller name for a bill pay.' },
      { name: 'memo', type: 'string | null', required: true },
      { name: 'frequency', type: 'ScheduleFrequency', required: true, typeRef: 'sh:schedules#SCHEDULE_FREQUENCIES', values: ['once', 'weekly', 'monthly'] },
      { name: 'status', type: 'ScheduleStatus', required: true, typeRef: 'sh:schedules#SCHEDULE_STATUSES', values: ['active', 'completed', 'cancelled'] },
      { name: 'nextRunAt', type: 'string | null', required: true, description: 'Next due date (ISO, simulated); null once completed or cancelled.' },
      { name: 'lastRunAt', type: 'string | null', required: true, description: 'Due date of the last occurrence that fired successfully.' },
      { name: 'runCount', type: 'number', required: true, description: 'Occurrences that fired successfully (skips are not counted).' },
      { name: 'createdAt', type: 'string', required: true },
    ],
    example: {
      id: 'sch_internet',
      kind: 'bill_pay',
      amountMinor: 6500,
      fromAccountId: 'acc_checking',
      fromAccountName: 'Everyday Checking',
      toAccountId: null,
      toAccountName: null,
      counterparty: 'Northside Internet',
      memo: 'Home internet',
      frequency: 'monthly',
      status: 'active',
      nextRunAt: '2026-10-06T15:00:00.000Z',
      lastRunAt: null,
      runCount: 0,
      createdAt: '2026-10-01T15:00:00.000Z',
    },
    detail: 3,
    tags: ['time', 'money', 'data'],
    sources: [src(P.shSchedules, 126, 148, 'export interface ScheduleDTO')],
  }),
  ent('sh:schedules#CreateScheduleRequest', 'type', 'CreateScheduleRequest', 'sh:schedules', 'Body of `POST /api/schedules`.', {
    fields: [
      { name: 'kind', type: 'ScheduleKind | string', required: true, values: ['internal_transfer', 'bill_pay'] },
      { name: 'fromAccountId', type: 'string', required: true },
      { name: 'toAccountId', type: 'string | null', required: false, description: 'Required for `internal_transfer`.' },
      { name: 'counterparty', type: 'string | null', required: false, description: 'Required for `bill_pay` — the biller.' },
      { name: 'memo', type: 'string | null', required: false },
      { name: 'amountMinor', type: 'number', required: true },
      { name: 'frequency', type: 'ScheduleFrequency | string', required: true, values: ['once', 'weekly', 'monthly'] },
      { name: 'firstRunInDays', type: 'number', required: false, description: 'Days from the simulated now until the first run; 0 = due immediately.' },
    ],
    example: { kind: 'bill_pay', fromAccountId: 'acc_checking', counterparty: 'Northside Internet', memo: 'Home internet', amountMinor: 6500, frequency: 'monthly', firstRunInDays: 5 },
    tags: ['time', 'money'],
    sources: [src(P.shSchedules, 150, 163, 'export interface CreateScheduleRequest')],
  }),
  ent('sh:schedules#NormalizedCreateSchedule', 'type', 'NormalizedCreateSchedule', 'sh:schedules', 'A validated create request: trimmed, with the irrelevant destination field nulled and `firstRunInDays` defaulted.', {
    fields: [
      { name: 'kind', type: 'ScheduleKind', required: true },
      { name: 'fromAccountId', type: 'string', required: true },
      { name: 'toAccountId', type: 'string | null', required: true, description: 'Null unless `internal_transfer`.' },
      { name: 'counterparty', type: 'string | null', required: true, description: 'Null unless `bill_pay`.' },
      { name: 'memo', type: 'string | null', required: true },
      { name: 'amountMinor', type: 'number', required: true },
      { name: 'frequency', type: 'ScheduleFrequency', required: true },
      { name: 'firstRunInDays', type: 'number', required: true },
    ],
    detail: 5,
    tags: ['time', 'validation'],
    sources: [src(P.shSchedules, 165, 174, 'export interface NormalizedCreateSchedule')],
  }),
  ent('sh:schedules#validateCreateSchedule', 'function', 'validateCreateSchedule', 'sh:schedules', 'Validates and normalises a new schedule; returns per-field error messages the form shows inline.', {
    description:
      'Rules, by field:\n• `kind` — must be `internal_transfer` or `bill_pay` ("Choose what to schedule.").\n• `fromAccountId` — non-empty after trimming.\n• `toAccountId` — for an internal transfer: required and different from the source ("Choose two different accounts."). Dropped for a bill pay.\n• `counterparty` — for a bill pay: required, trimmed, cut to 80 characters ("Enter the biller\'s name."). Dropped for a transfer.\n• `amountMinor` — an integer from 1 to 5,000,000 minor units ($0.01 – $50,000).\n• `frequency` — `once`, `weekly` or `monthly`.\n• `firstRunInDays` — optional; a whole number 0 … 365; defaults to 0.\n• `memo` — optional; trimmed, cut to 140 characters, empty becomes null.\n\nShape only: it cannot know whether the accounts exist, belong to the caller, or hold enough money.',
    signature: 'export function validateCreateSchedule(input: Partial<CreateScheduleRequest>): ValidationResult<NormalizedCreateSchedule, ScheduleField>',
    detail: 3,
    tags: ['validation', 'time', 'money'],
    sources: [
      src(P.shSchedules, 202, 271, 'export function validateCreateSchedule'),
      src(P.shSchedules, 218, 228, 'Choose two different accounts.', 'Destination rules depend on the kind'),
      src(P.shSchedules, 236, 249, 'firstRunInDays', 'First-run window'),
    ],
  }),
  ent('sh:schedules#ScheduleListResponse', 'type', 'ScheduleListResponse', 'sh:schedules', 'Body of the schedule list endpoints: `{ schedules: ScheduleDTO[] }`.', {
    fields: [{ name: 'schedules', type: 'ScheduleDTO[]', required: true, typeRef: 'sh:schedules#ScheduleDTO' }],
    detail: 5,
    sources: [src(P.shSchedules, 275, 277, 'export interface ScheduleListResponse')],
  }),
  ent('sh:schedules#CreateScheduleResponse', 'type', 'CreateScheduleResponse', 'sh:schedules', 'Body of a successful create: the new schedule and a confirmation message.', {
    fields: [
      { name: 'schedule', type: 'ScheduleDTO', required: true, typeRef: 'sh:schedules#ScheduleDTO' },
      { name: 'message', type: 'string', required: true },
    ],
    detail: 5,
    sources: [src(P.shSchedules, 278, 281, 'export interface CreateScheduleResponse')],
  }),
  ent('sh:schedules#CancelScheduleResponse', 'type', 'CancelScheduleResponse', 'sh:schedules', 'Body of a successful cancel: the updated schedule.', {
    fields: [{ name: 'schedule', type: 'ScheduleDTO', required: true, typeRef: 'sh:schedules#ScheduleDTO' }],
    detail: 5,
    sources: [src(P.shSchedules, 282, 284, 'export interface CancelScheduleResponse')],
  }),
  ent('sh:schedules#ScheduleFireSummary', 'type', 'ScheduleFireSummary', 'sh:schedules', 'What one schedule did during one clock advance: runs, money posted, money queued, skips and its status afterwards.', {
    fields: [
      { name: 'scheduleId', type: 'string', required: true },
      { name: 'kind', type: 'ScheduleKind', required: true },
      { name: 'runs', type: 'number', required: true, description: 'Occurrences that fired.' },
      { name: 'postedMinor', type: 'number', required: true, description: 'Total settled immediately (internal transfers).' },
      { name: 'queuedMinor', type: 'number', required: true, description: 'Total queued for operator review (bill pays).' },
      { name: 'skipped', type: 'number', required: true, description: 'Occurrences skipped, e.g. for insufficient funds.' },
      { name: 'status', type: 'ScheduleStatus', required: true, description: 'Status after the advance.' },
    ],
    example: { scheduleId: 'sch_savings', kind: 'internal_transfer', runs: 1, postedMinor: 20000, queuedMinor: 0, skipped: 0, status: 'active' },
    tags: ['time', 'operations'],
    sources: [src(P.shSchedules, 286, 303, 'export interface ScheduleFireSummary')],
  }),
  ent('sh:schedules#AdvanceClockResponse', 'type', 'AdvanceClockResponse', 'sh:schedules', 'Success body of the advance endpoint: the new clock, what each schedule did, and the interest accrued.', {
    fields: [
      { name: 'clock', type: 'SimulationClockDTO', required: true, typeRef: 'sh:clock#SimulationClockDTO' },
      { name: 'fired', type: 'ScheduleFireSummary[]', required: true, typeRef: 'sh:schedules#ScheduleFireSummary' },
      { name: 'accrued', type: 'InterestAccrualSummary', required: false, description: 'Optional in the type for compatibility with the v0.9.0 contract; the current server always sends it.', typeRef: 'sh:lending#InterestAccrualSummary' },
    ],
    example: {
      clock: { currentTime: '2026-10-31T15:00:00.000Z', speed: 1 },
      fired: [
        { scheduleId: 'sch_savings', kind: 'internal_transfer', runs: 1, postedMinor: 20000, queuedMinor: 0, skipped: 0, status: 'active' },
        { scheduleId: 'sch_internet', kind: 'bill_pay', runs: 1, postedMinor: 0, queuedMinor: 6500, skipped: 0, status: 'active' },
      ],
      accrued: { savingsAccountsAccrued: 1, cdsAccrued: 1, loansAccrued: 1, totalInterestCreditedMinor: 1400, totalInterestChargedMinor: 2000, cdsMatured: 0 },
    },
    detail: 3,
    tags: ['time', 'operations'],
    sources: [src(P.shSchedules, 305, 314, 'export interface AdvanceClockResponse')],
  }),
];

export const clockDomainEntities: Entity[] = [
  ...clockEntities,
  ...schedulerEntities,
  ...scheduleServiceEntities,
  ...shClockEntities,
  ...shScheduleEntities,
];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const clockDomainRelations: Relation[] = [
  // clock service
  rel('be:clock/clock#getClockRow', 'db:SimulationClock', 'writes', 'upsert singleton (create if missing)', {
    summary: 'Reads the clock row through an upsert with an empty update, so a missing row is created at the wall-clock time.',
    sources: [src(P.clock, 35, 42, 'simulationClock.upsert')],
  }),
  rel('be:clock/clock#getClockState', 'be:clock/clock#getClockRow', 'calls', 'getClockRow(db)', { sources: [src(P.clock, 49, 51, 'getClockRow')] }),
  rel('be:clock/clock#getClockState', 'sh:clock#SimulationClockDTO', 'uses-type', 'returns SimulationClockDTO', { sources: [src(P.clock, 44, 51, 'SimulationClockDTO')] }),
  rel('be:clock/clock#simulationNow', 'be:clock/clock#getClockRow', 'calls', 'getClockRow(db)', { sources: [src(P.clock, 57, 60, 'getClockRow')] }),
  rel('be:clock/clock#advanceClock', 'be:clock/clock#getClockRow', 'calls', 'getClockRow(db)', { order: 1, sources: [src(P.clock, 75, 75, 'getClockRow')] }),
  rel('be:clock/clock#advanceClock', 'sh:clock#advanceBy', 'calls', 'advanceBy(current.currentTime, minutes)', { order: 2, sources: [src(P.clock, 76, 76, 'advanceBy')] }),
  rel('be:clock/clock#advanceClock', 'db:SimulationClock', 'writes', 'update currentTime', {
    order: 3,
    summary: 'One update of the singleton row sets the new simulated time.',
    sources: [src(P.clock, 78, 81, 'simulationClock.update')],
  }),
  rel('be:clock/clock#advanceClock', 'be:auth/audit#writeAudit', 'calls', "writeAudit(db, { action: 'clock_advanced', … })", {
    order: 4,
    summary: 'Every advance is audited with the from/to instants, the minutes and the actor.',
    sources: [src(P.clock, 83, 96, 'clock_advanced')],
  }),
  rel('be:clock/clock#advanceClock', 'be:clock/clock#ClockError', 'uses-type', "throws ClockError('invalid_advance')", { sources: [src(P.clock, 72, 74, 'new ClockError')] }),
  rel('be:clock/clock#advanceClock', 'feat:clock', 'implements', 'forward-only advance'),
  rel('be:clock/clock#simulationNow', 'feat:clock', 'implements', 'authoritative simulated now'),
  rel('be:clock/clock#advanceClock', 'feat:audit', 'implements', 'audits every advance'),

  // scheduler
  rel('be:scheduler/scheduler#runDueSchedules', 'db:PaymentSchedule', 'reads', 'findMany active, nextRunAt <= upTo, order by nextRunAt', {
    order: 1,
    summary: 'Selects the due schedules together with their owning user.',
    sources: [src(P.scheduler, 59, 63, 'paymentSchedule.findMany')],
  }),
  rel('be:scheduler/scheduler#runDueSchedules', 'be:scheduler/scheduler#fireSchedule', 'calls', 'fireSchedule(schedule, upTo, result)', {
    order: 2,
    summary: 'Once per due schedule, inside a try/catch so one failure cannot stop the rest.',
    sources: [src(P.scheduler, 66, 78, 'fireSchedule(schedule, upTo, result)')],
  }),
  rel('be:scheduler/scheduler#runDueSchedules', 'be:scheduler/scheduler#SchedulerResult', 'uses-type', 'returns SchedulerResult', { sources: [src(P.scheduler, 58, 65, 'SchedulerResult')] }),
  rel('be:scheduler/scheduler#fireSchedule', 'sh:schedules#addInterval', 'calls', 'addInterval(occurrenceAt, frequency)', {
    order: 1,
    summary: 'Computes the following occurrence; null means the schedule completes.',
    sources: [src(P.scheduler, 138, 140, 'addInterval(occurrenceAt, frequency)')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'db:PaymentSchedule', 'writes', 'claim: update nextRunAt, status, updatedAt', {
    order: 2,
    summary: 'Advances the schedule before the money moves, so an interruption cannot double-fire an occurrence.',
    sources: [src(P.scheduler, 142, 148, 'paymentSchedule.update')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'be:money/movements#createTransfer', 'calls', 'createTransfer(owner, { fromAccountId, toAccountId, amountMinor, memo }, occurrenceAt)', {
    order: 3,
    summary: 'An internal-transfer occurrence posts both transfer legs, dated at the occurrence.',
    description: 'The owner is rebuilt as a `SessionUser` from the schedule\'s user row, so `createTransfer` re-checks account access and available funds exactly as it would for a request from that customer. A `MovementError` (e.g. `insufficient_funds`) is caught and recorded as a skip.',
    sources: [src(P.scheduler, 151, 165, 'createTransfer')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'be:money/movements#createExternalMovement', 'calls', "createExternalMovement(owner, { kind: 'bill_pay', direction: 'outbound', … }, occurrenceAt)", {
    order: 4,
    summary: 'A bill-pay occurrence writes a pending payment debit and a queued operations request.',
    description: 'Nothing posts until an operator approves the request. The returned request and events are collected in the `SchedulerResult` so the route can broadcast them to operator consoles.',
    sources: [src(P.scheduler, 166, 184, 'createExternalMovement')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'db:PaymentSchedule', 'writes', 'bookkeeping: runCount + 1, lastRunAt', {
    n: 2,
    order: 5,
    summary: 'After a successful fire the run counter and last-run date are updated.',
    sources: [src(P.scheduler, 189, 194, 'runCount: { increment: 1 }')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'be:money/movements#recordSimEvent', 'calls', "recordSimEvent(prisma, { kind: 'schedule_fired' | 'schedule_skipped' | 'schedule_fire_errored', … }, occurrenceAt)", {
    order: 6,
    summary: 'Each occurrence leaves a simulated email event: fired, skipped, or errored.',
    sources: [src(P.scheduler, 196, 207, 'schedule_fired'), src(P.scheduler, 220, 231, 'schedule_skipped')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'schedule_payment_skipped' | 'schedule_fire_errored' | 'schedule_catchup_capped', … })", {
    order: 7,
    summary: 'Skipped occurrences and a hit catch-up cap are written to the audit trail; a successful fire is audited by the money service itself.',
    sources: [src(P.scheduler, 233, 245, 'schedule_payment_skipped'), src(P.scheduler, 126, 134, 'schedule_catchup_capped')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'be:money/movements#MovementError', 'uses-type', 'err instanceof MovementError → expected skip', {
    sources: [src(P.scheduler, 217, 219, 'err instanceof MovementError')],
  }),
  rel('be:scheduler/scheduler#fireSchedule', 'sh:schedules#SCHEDULE_LIMITS', 'uses-type', 'SCHEDULE_LIMITS.maxCatchUpRuns', { sources: [src(P.scheduler, 115, 117, 'SCHEDULE_LIMITS.maxCatchUpRuns')] }),
  rel('be:scheduler/scheduler#fireSchedule', 'sh:schedules#ScheduleFireSummary', 'uses-type', 'returns ScheduleFireSummary', { sources: [src(P.scheduler, 252, 252, 'scheduleId: schedule.id')] }),
  rel('be:scheduler/scheduler#fireSchedule', 'sh:schedules#SCHEDULE_KIND_LABELS', 'uses-type', 'SCHEDULE_KIND_LABELS[kind]', { sources: [src(P.scheduler, 105, 105, 'SCHEDULE_KIND_LABELS')], detail: 5 }),
  rel('be:scheduler/scheduler#fireSchedule', 'sh:money#formatMinor', 'calls', 'formatMinor(schedule.amountMinor)', { sources: [src(P.scheduler, 202, 202, 'formatMinor')], detail: 5 }),
  rel('be:scheduler/scheduler#runDueSchedules', 'feat:schedules', 'implements', 'fires due schedules on clock advance'),
  rel('be:scheduler/scheduler#fireSchedule', 'feat:schedules', 'implements', 'one occurrence at a time, claim first'),

  // schedule service
  rel('be:scheduler/schedules#requireSchedulableAccount', 'db:Account', 'reads', 'findUnique by id (status)', { sources: [src(P.schedules, 81, 82, 'account.findUnique')] }),
  rel('be:scheduler/schedules#requireSchedulableAccount', 'be:auth/access#getAccountRelationship', 'calls', 'getAccountRelationship(prisma, userId, accountId)', {
    summary: 'The same relationship lookup the money service uses; viewers and strangers are refused.',
    sources: [src(P.schedules, 83, 86, 'getAccountRelationship')],
  }),
  rel('be:scheduler/schedules#createSchedule', 'be:scheduler/schedules#requireSchedulableAccount', 'calls', 'requireSchedulableAccount(user.id, accountId)', {
    order: 1,
    summary: 'Once for the source account and, for an internal transfer, once for the destination.',
    sources: [src(P.schedules, 103, 110, 'requireSchedulableAccount')],
  }),
  rel('be:scheduler/schedules#createSchedule', 'db:PaymentSchedule', 'reads', "count where userId, status 'active'", {
    order: 2,
    summary: 'Counts the caller\'s live schedules against the cap of 25.',
    sources: [src(P.schedules, 115, 121, 'paymentSchedule.count')],
  }),
  rel('be:scheduler/schedules#createSchedule', 'sh:public-demo#RESOURCE_CAPS', 'uses-type', 'RESOURCE_CAPS.activeSchedulesPerUser', { sources: [src(P.schedules, 115, 121, 'RESOURCE_CAPS.activeSchedulesPerUser')], detail: 5 }),
  rel('be:scheduler/schedules#createSchedule', 'db:PaymentSchedule', 'writes', "insert 1 row (status 'active', nextRunAt = now + firstRunInDays)", {
    n: 2,
    order: 3,
    sources: [src(P.schedules, 123, 141, 'paymentSchedule.create')],
  }),
  rel('be:scheduler/schedules#createSchedule', 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'schedule_created', … })", { order: 4, sources: [src(P.schedules, 143, 161, 'schedule_created')] }),
  rel('be:scheduler/schedules#createSchedule', 'be:scheduler/schedules#toScheduleDTO', 'calls', 'toScheduleDTO(created)', { order: 5, sources: [src(P.schedules, 163, 163, 'toScheduleDTO')], detail: 5 }),
  rel('be:scheduler/schedules#createSchedule', 'sh:schedules#NormalizedCreateSchedule', 'uses-type', 'input: NormalizedCreateSchedule', { sources: [src(P.schedules, 98, 102, 'NormalizedCreateSchedule')], detail: 5 }),
  rel('be:scheduler/schedules#createSchedule', 'be:scheduler/schedules#ScheduleError', 'uses-type', 'throws ScheduleError', { sources: [src(P.schedules, 103, 121, 'new ScheduleError')] }),
  rel('be:scheduler/schedules#toScheduleDTO', 'sh:schedules#ScheduleDTO', 'uses-type', 'returns ScheduleDTO', { sources: [src(P.schedules, 59, 60, 'ScheduleDTO')] }),
  rel('be:scheduler/schedules#listSchedulesForUser', 'db:PaymentSchedule', 'reads', 'findMany where userId (with account names)', { sources: [src(P.schedules, 167, 173, 'paymentSchedule.findMany')] }),
  rel('be:scheduler/schedules#listAllSchedules', 'db:PaymentSchedule', 'reads', 'findMany all (with account names)', { sources: [src(P.schedules, 177, 182, 'paymentSchedule.findMany')] }),
  rel('be:scheduler/schedules#cancelSchedule', 'db:PaymentSchedule', 'reads', 'findUnique by id', { order: 1, sources: [src(P.schedules, 187, 188, 'paymentSchedule.findUnique')] }),
  rel('be:scheduler/schedules#cancelSchedule', 'sh:schedules#isActiveSchedule', 'calls', 'isActiveSchedule(existing.status)', { order: 2, sources: [src(P.schedules, 190, 192, 'isActiveSchedule')], detail: 5 }),
  rel('be:scheduler/schedules#cancelSchedule', 'db:PaymentSchedule', 'writes', "update status 'cancelled', nextRunAt null", { n: 2, order: 3, sources: [src(P.schedules, 194, 198, 'paymentSchedule.update')] }),
  rel('be:scheduler/schedules#cancelSchedule', 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'schedule_cancelled', … })", { order: 4, sources: [src(P.schedules, 200, 208, 'schedule_cancelled')] }),
  rel('be:scheduler/schedules#cancelSchedule', 'be:scheduler/schedules#ScheduleError', 'uses-type', 'throws ScheduleError', { sources: [src(P.schedules, 187, 192, 'new ScheduleError')] }),
  rel('be:scheduler/schedules#createSchedule', 'feat:schedules', 'implements', 'create a schedule'),
  rel('be:scheduler/schedules#cancelSchedule', 'feat:schedules', 'implements', 'cancel a schedule'),
  rel('be:scheduler/schedules#requireSchedulableAccount', 'feat:rbac', 'implements', 'per-account access for scheduling'),

  // shared
  rel('sh:clock#validateAdvance', 'sh:clock#advanceRequestMinutes', 'calls', 'advanceRequestMinutes(input)', { sources: [src(P.shClock, 62, 66, 'advanceRequestMinutes(input)')] }),
  rel('sh:clock#validateAdvance', 'sh:clock#ADVANCE_CLOCK_LIMITS', 'uses-type', 'minMinutes / maxMinutes', { sources: [src(P.shClock, 67, 71, 'ADVANCE_CLOCK_LIMITS.maxMinutes')] }),
  rel('sh:clock#validateAdvance', 'sh:clock#AdvanceClockRequest', 'validates', 'validates AdvanceClockRequest', { sources: [src(P.shClock, 62, 64, 'AdvanceClockRequest')] }),
  rel('sh:clock#validateAdvance', 'sh:clock#NormalizedAdvance', 'uses-type', 'returns NormalizedAdvance', { sources: [src(P.shClock, 62, 64, 'NormalizedAdvance')], detail: 5 }),
  rel('sh:clock#validateAdvance', 'feat:clock', 'implements', 'forward-only, bounded advance'),
  rel('sh:clock#ClockResponse', 'sh:clock#SimulationClockDTO', 'uses-type', 'clock: SimulationClockDTO', { sources: [src(P.shClock, 82, 84, 'SimulationClockDTO')], detail: 5 }),
  rel('sh:schedules#validateCreateSchedule', 'sh:schedules#CreateScheduleRequest', 'validates', 'validates CreateScheduleRequest', { sources: [src(P.shSchedules, 207, 209, 'CreateScheduleRequest')] }),
  rel('sh:schedules#validateCreateSchedule', 'sh:schedules#NormalizedCreateSchedule', 'uses-type', 'returns NormalizedCreateSchedule', { sources: [src(P.shSchedules, 207, 209, 'NormalizedCreateSchedule')], detail: 5 }),
  rel('sh:schedules#validateCreateSchedule', 'sh:schedules#SCHEDULE_LIMITS', 'uses-type', 'amount range, maxFirstRunInDays', { sources: [src(P.shSchedules, 186, 193, 'SCHEDULE_LIMITS.minMinor'), src(P.shSchedules, 238, 246, 'SCHEDULE_LIMITS.maxFirstRunInDays')] }),
  rel('sh:schedules#validateCreateSchedule', 'sh:schedules#SCHEDULE_KINDS', 'uses-type', 'isScheduleKind(kind)', { sources: [src(P.shSchedules, 212, 213, 'isScheduleKind')], detail: 5 }),
  rel('sh:schedules#validateCreateSchedule', 'sh:schedules#SCHEDULE_FREQUENCIES', 'uses-type', 'isScheduleFrequency(frequency)', { sources: [src(P.shSchedules, 234, 234, 'isScheduleFrequency')], detail: 5 }),
  rel('sh:schedules#SCHEDULE_LIMITS', 'sh:money-movement#MOVEMENT_LIMITS', 'uses-type', 'reuses MOVEMENT_LIMITS.minMinor / maxMinor', {
    summary: 'A scheduled payment shares the amount bounds of a manual movement.',
    sources: [src(P.shSchedules, 52, 57, 'MOVEMENT_LIMITS.maxMinor')],
  }),
  rel('sh:schedules#AdvanceClockResponse', 'sh:schedules#ScheduleFireSummary', 'uses-type', 'fired: ScheduleFireSummary[]', { sources: [src(P.shSchedules, 306, 309, 'ScheduleFireSummary')], detail: 5 }),
  rel('sh:schedules#AdvanceClockResponse', 'sh:lending#InterestAccrualSummary', 'uses-type', 'accrued?: InterestAccrualSummary', { sources: [src(P.shSchedules, 309, 314, 'InterestAccrualSummary')], detail: 5 }),
  rel('sh:schedules#AdvanceClockResponse', 'sh:clock#SimulationClockDTO', 'uses-type', 'clock: SimulationClockDTO', { sources: [src(P.shSchedules, 306, 308, 'SimulationClockDTO')], detail: 5 }),
  rel('sh:schedules#validateCreateSchedule', 'feat:schedules', 'implements', 'one validator for form and server'),
  rel('sh:schedules#addInterval', 'feat:schedules', 'implements', 'weekly / monthly cadence'),
];
