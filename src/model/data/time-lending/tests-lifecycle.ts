import type { Entity, GlossaryTerm, Relation, StateMachine } from '../../types';
import { P, ent, rel, src } from './util';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const T = {
  clockSchedules: `test:${P.tClockSchedules}`,
  lending: `test:${P.tLending}`,
  shClock: `test:${P.tShClock}`,
  shSchedules: `test:${P.tShSchedules}`,
  shLending: `test:${P.tShLending}`,
  e2eSchedules: `test:${P.e2eSchedules}`,
  e2eLending: `test:${P.e2eLending}`,
};

export const testEntities: Entity[] = [
  ent(T.clockSchedules, 'test', 'routes/clock-schedules.test.ts', 'tests', 'Integration tests for the clock, schedule CRUD and firing on advance, driven through the real server with `app.inject()`.', {
    description:
      'Pins: any signed-in user can read the clock; a customer gets 403 on advance and on the ops schedule list; a zero or negative advance is 400; an hour\'s advance moves the clock by exactly an hour. Creating a schedule moves no money; a bill pay without a biller is 400 with `fields.counterparty`; scheduling on an account the caller cannot access is 403; cancel is owner-only and a second cancel is 409.\n\nFiring: a due internal transfer posts both legs and leaves the settled total unchanged; a due one-time bill pay queues a pending debit, ends `completed`, and posts only when an operator approves; an approved clock-fired bill pay is posted at the simulated date (the v0.9.0 regression); a weekly schedule catches up over a 21-day jump; an occurrence with insufficient funds is skipped with an audit row; a cancelled schedule never fires.',
    tech: ['Vitest'],
    tags: ['time', 'money', 'tests'],
    sources: [
      src(P.tClockSchedules, 8, 15, 'simulation clock + scheduler (v0.9.0)'),
      src(P.tClockSchedules, 195, 229, 'fires a due internal transfer', 'Both legs, nets to zero'),
      src(P.tClockSchedules, 343, 366, 'skips (does not fire) an occurrence with insufficient funds'),
    ],
  }),
  ent(T.lending, 'test', 'routes/lending.test.ts', 'tests', 'Integration tests for opening, paying and withdrawing lending products and for clock-driven interest accrual.', {
    description:
      'Pins: opening a CD or a loan leaves the system settled total unchanged; a new loan reports `balanceMinor` of minus the principal; a CD larger than the available balance is 400; an overpayment is capped at what is owed and ends in `paid_off` with the loan account `closed`.\n\nAccrual: a 35-day advance credits a CD and charges a loan exactly one month of interest; a further 5-day advance accrues nothing; savings accrue at the default APY. A CD cannot be withdrawn before maturity (400); after a 200-day advance a 6-month CD is `matured`, and withdrawing moves the whole balance and closes it. A customer cannot read the ops lending list (403).',
    tech: ['Vitest'],
    tags: ['lending', 'money', 'tests'],
    sources: [
      src(P.tLending, 9, 17, 'lending & interest accrual (v1.0.0)'),
      src(P.tLending, 157, 174, 'credits a CD and charges a loan one month of interest'),
      src(P.tLending, 197, 222, 'matures a CD past its term'),
    ],
  }),
  ent(T.shClock, 'test', 'shared/clock.test.ts', 'tests', 'Unit tests for the advance arithmetic and the forward-only, bounded validator.', {
    tech: ['Vitest'],
    tags: ['time', 'validation', 'tests'],
    sources: [src(P.tShClock, 21, 50, 'validateAdvance (forward-only, bounded)')],
  }),
  ent(T.shSchedules, 'test', 'shared/schedules.test.ts', 'tests', 'Unit tests for schedule kinds and labels, `addInterval` month clamping and leap years, and the create validator.', {
    tech: ['Vitest'],
    tags: ['time', 'validation', 'tests'],
    sources: [src(P.tShSchedules, 33, 59, 'addInterval (calendar-safe, UTC)'), src(P.tShSchedules, 61, 114, 'validateCreateSchedule')],
  }),
  ent(T.shLending, 'test', 'shared/lending.test.ts', 'tests', 'Unit tests for the interest and amortisation maths, calendar helpers, rate tables and lending validators.', {
    description: 'Includes a simulation that applies monthly interest and the level payment for the full term and checks the loan ends at or just below zero.',
    tech: ['Vitest'],
    tags: ['lending', 'validation', 'tests'],
    sources: [src(P.tShLending, 20, 104, 'lending math (v1.0.0)'), src(P.tShLending, 106, 142, 'lending validators (v1.0.0)')],
  }),
  ent(T.e2eSchedules, 'test', 'e2e/scheduled-payments.spec.ts', 'tests', 'Playwright journeys: a customer schedules and cancels a bill payment; an operator advances the clock and a seeded schedule fires.', {
    tech: ['Playwright'],
    tags: ['time', 'ui', 'tests'],
    sources: [src(P.e2eSchedules, 3, 13, 'the simulation clock + recurring/scheduled'), src(P.e2eSchedules, 78, 113, 'an operator advances the simulation clock and a due schedule fires')],
  }),
  ent(T.e2eLending, 'test', 'e2e/lending.spec.ts', 'tests', 'Playwright journeys: the lending portal lists seeded products, a customer opens a CD, and an operator sees the interest summary after an advance.', {
    tech: ['Playwright'],
    tags: ['lending', 'ui', 'tests'],
    sources: [src(P.e2eLending, 3, 21, 'loans, CDs & clock-driven interest accrual'), src(P.e2eLending, 93, 117, 'an operator advances the clock and sees the interest-accrual summary')],
  }),
];

export const testRelations: Relation[] = [
  // clock + schedules integration
  rel(T.clockSchedules, 'ep:GET /api/clock', 'tests', 'any signed-in user can read the simulated date', { sources: [src(P.tClockSchedules, 85, 90, 'any signed-in user can read the simulated date')] }),
  rel(T.clockSchedules, 'ep:POST /api/ops/clock/advance', 'tests', '403 for a customer; 400 for zero/negative; fires due schedules', {
    sources: [
      src(P.tClockSchedules, 92, 100, 'a customer cannot advance the clock'),
      src(P.tClockSchedules, 102, 108, 'advancing moves the clock strictly forward'),
    ],
  }),
  rel(T.clockSchedules, 'ep:GET /api/ops/schedules', 'tests', 'operator sees all; customer gets 403', { sources: [src(P.tClockSchedules, 156, 163, 'an operator sees all')] }),
  rel(T.clockSchedules, 'ep:POST /api/schedules', 'tests', 'create, field errors, account access', {
    sources: [
      src(P.tClockSchedules, 114, 133, 'creates an internal-transfer schedule (no money moves yet)'),
      src(P.tClockSchedules, 135, 154, 'rejects a bill-pay schedule with no biller'),
    ],
  }),
  rel(T.clockSchedules, 'ep:GET /api/schedules', 'tests', 'lists the caller\'s own schedules', { sources: [src(P.tClockSchedules, 156, 163, 'own schedules')] }),
  rel(T.clockSchedules, 'ep:POST /api/schedules/:id/cancel', 'tests', 'owner only; re-cancel is 409', { sources: [src(P.tClockSchedules, 165, 187, 're-cancel is 409')] }),
  rel(T.clockSchedules, 'be:scheduler/scheduler#runDueSchedules', 'tests', 'fires transfers and bill pays, catches up, never fires a cancelled schedule', {
    sources: [
      src(P.tClockSchedules, 231, 267, 'fires a due bill pay'),
      src(P.tClockSchedules, 321, 341, 'catches up multiple missed occurrences'),
      src(P.tClockSchedules, 368, 386, 'a cancelled schedule never fires'),
    ],
  }),
  rel(T.clockSchedules, 'be:scheduler/scheduler#fireSchedule', 'tests', 'insufficient funds → skipped + audited; one-time → completed', {
    sources: [src(P.tClockSchedules, 343, 366, 'schedule_payment_skipped'), src(P.tClockSchedules, 246, 249, "toBe('completed')")],
  }),
  rel(T.clockSchedules, 'be:clock/clock#simulationNow', 'tests', 'a clock-fired bill pay posts on the simulated date', {
    summary: 'Regression for the v0.9.0 review bug: approval must use the simulated date, not the wall clock.',
    sources: [src(P.tClockSchedules, 269, 319, 'posts it on the SIMULATED date')],
  }),

  // lending integration
  rel(T.lending, 'ep:POST /api/lending/cds', 'tests', 'net-zero open; 400 when over available', { sources: [src(P.tLending, 74, 104, 'moves the principal as a net-zero pair')] }),
  rel(T.lending, 'ep:POST /api/lending/loans', 'tests', 'net-zero disbursement; negative loan balance', { sources: [src(P.tLending, 106, 129, 'the loan account carries the negative owed balance')] }),
  rel(T.lending, 'ep:POST /api/lending/loans/:id/pay', 'tests', 'partial payment; overpay capped; paid_off + closed', { sources: [src(P.tLending, 131, 152, 'overpay is capped at what is owed')] }),
  rel(T.lending, 'ep:POST /api/lending/cds/:id/withdraw', 'tests', '400 before maturity; closes after', { sources: [src(P.tLending, 197, 222, 'Cannot withdraw before maturity')] }),
  rel(T.lending, 'ep:GET /api/lending', 'tests', 'lists the caller\'s products', { sources: [src(P.tLending, 226, 232, 'lists the caller’s products')] }),
  rel(T.lending, 'ep:GET /api/ops/lending', 'tests', '403 for a customer, 200 for staff', { sources: [src(P.tLending, 226, 232, '/api/ops/lending')] }),
  rel(T.lending, 'be:lending/accrual#runInterestAccrual', 'tests', 'one month per anniversary; idempotent; savings at default APY; CD maturity', {
    sources: [
      src(P.tLending, 157, 174, 'monthlyAccrualMinor(10_000_00, 450)'),
      src(P.tLending, 176, 183, 'is idempotent'),
      src(P.tLending, 185, 191, 'accrues savings interest at the default APY'),
    ],
  }),
  rel(T.lending, 'be:lending/lending#makeLoanPayment', 'tests', 'another customer cannot pay the loan (403/404)', { sources: [src(P.tLending, 234, 244, 'a customer cannot pay or withdraw another customer’s product')] }),

  // shared unit tests
  rel(T.shClock, 'sh:clock#validateAdvance', 'tests', 'rejects zero/negative and > 1 year; accepts the bounds', { sources: [src(P.tShClock, 21, 50, 'rejects a zero or negative (rewind) advance')] }),
  rel(T.shClock, 'sh:clock#advanceRequestMinutes', 'tests', 'sums units, truncates fractions', { sources: [src(P.tShClock, 9, 19, 'sums days, hours and minutes')] }),
  rel(T.shClock, 'sh:clock#advanceBy', 'tests', 'moves a date forward by whole minutes', { sources: [src(P.tShClock, 52, 57, 'moves a date forward by whole minutes')] }),
  rel(T.shSchedules, 'sh:schedules#addInterval', 'tests', 'weekly +7 days; monthly clamps month-end; once → null', { sources: [src(P.tShSchedules, 33, 59, 'clamps month-end')] }),
  rel(T.shSchedules, 'sh:schedules#validateCreateSchedule', 'tests', 'kind-specific destination rules, amount bounds, first-run window', { sources: [src(P.tShSchedules, 61, 114, 'requires a biller for a bill pay')] }),
  rel(T.shSchedules, 'sh:schedules#isActiveSchedule', 'tests', 'only active schedules are live', { sources: [src(P.tShSchedules, 21, 25, 'only active schedules are still live')] }),
  rel(T.shLending, 'sh:lending#monthlyAccrualMinor', 'tests', 'apy/12 rounded to the cent; uses magnitude; zero cases', { sources: [src(P.tShLending, 21, 35, 'is one month of apy/12 on the balance')] }),
  rel(T.shLending, 'sh:lending#amortizedPaymentMinor', 'tests', 'full-term simulation ends at or below zero', { sources: [src(P.tShLending, 37, 64, 'simulating the amortization drives the balance to zero')] }),
  rel(T.shLending, 'sh:lending#projectCdMaturityMinor', 'tests', 'compounds monthly', { sources: [src(P.tShLending, 66, 76, 'compounds monthly')] }),
  rel(T.shLending, 'sh:lending#addMonthsClamped', 'tests', 'clamps the day of month', { sources: [src(P.tShLending, 78, 83, 'addMonthsClamped clamps the day of month')] }),
  rel(T.shLending, 'sh:lending#monthsElapsed', 'tests', 'counts whole anniversaries, capped', { sources: [src(P.tShLending, 84, 89, 'monthsElapsed counts whole monthly anniversaries')] }),
  rel(T.shLending, 'sh:lending#validateOpenCd', 'tests', 'funding account, principal bounds, offered term', { sources: [src(P.tShLending, 107, 115, 'validateOpenCd requires')] }),
  rel(T.shLending, 'sh:lending#validateOpenLoan', 'tests', 'computes the amortized payment', { sources: [src(P.tShLending, 117, 123, 'validateOpenLoan computes the amortized payment')] }),
  rel(T.shLending, 'sh:lending#validateLoanPayment', 'tests', 'omitted amount = scheduled payment', { sources: [src(P.tShLending, 125, 130, 'validateLoanPayment treats omitted amount')] }),
  rel(T.shLending, 'sh:lending#validateWithdrawCd', 'tests', 'requires a destination', { sources: [src(P.tShLending, 132, 135, 'validateWithdrawCd requires a destination account')] }),

  // e2e
  rel(T.e2eSchedules, 'cu:pages/ScheduledPayments', 'tests', 'schedule a bill payment, see it listed, cancel it', { sources: [src(P.e2eSchedules, 38, 69, 'a customer schedules a bill payment')] }),
  rel(T.e2eSchedules, 'op:pages/SimulationClock', 'tests', '+1 week fires the seeded monthly transfer', { sources: [src(P.e2eSchedules, 78, 113, '+1 week')] }),
  rel(T.e2eLending, 'cu:pages/Lending', 'tests', 'lists seeded products; opens a 12-month CD', { sources: [src(P.e2eLending, 69, 91, 'a customer opens a new CD and sees it listed')] }),
  rel(T.e2eLending, 'op:pages/SimulationClock', 'tests', '62-day advance shows the interest summary', { sources: [src(P.e2eLending, 93, 117, 'interest accrued')] }),
];

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

export const stateMachines: StateMachine[] = [
  {
    id: 'sm:schedule-status',
    name: 'Scheduled payment status',
    summary: 'A schedule is active until its single occurrence is claimed (one-time) or its creator cancels it. Weekly and monthly schedules stay active and roll their next run date forward.',
    subject: 'db:PaymentSchedule',
    field: 'PaymentSchedule.status',
    initial: 'active',
    states: [
      { id: 'active', label: 'Active', description: 'Has a `nextRunAt`. Selected by the scheduler when the clock reaches it; can be cancelled.' },
      { id: 'completed', label: 'Completed', description: 'A one-time schedule whose occurrence has been claimed. `nextRunAt` is null.', terminal: true },
      { id: 'cancelled', label: 'Cancelled', description: 'Cancelled by its creator. `nextRunAt` is null; the scheduler never selects it.', terminal: true },
    ],
    transitions: [
      {
        from: 'active',
        to: 'active',
        label: 'weekly / monthly occurrence claimed',
        by: 'be:scheduler/scheduler#fireSchedule',
        description: 'For each due occurrence `nextRunAt` moves to `addInterval(occurrenceAt, frequency)` — +7 days or +1 calendar month (day clamped) — before the money moves. The status stays `active` whether the occurrence then fires or is skipped. `runCount` and `lastRunAt` change only on a successful fire.',
        source: src(P.scheduler, 138, 148, "following === null ? 'completed' : 'active'"),
      },
      {
        from: 'active',
        to: 'completed',
        label: 'one-time occurrence claimed',
        by: 'be:scheduler/scheduler#fireSchedule',
        description: '`addInterval` returns null for `once`, so the claim sets `status: \'completed\'` and `nextRunAt: null`. This happens at claim time: a one-time schedule whose only occurrence is then skipped for insufficient funds is still completed and will not retry.',
        source: src(P.scheduler, 138, 148, "following === null ? 'completed' : 'active'"),
      },
      {
        from: 'active',
        to: 'cancelled',
        label: 'creator cancels',
        by: 'be:scheduler/schedules#cancelSchedule',
        description: '`POST /api/schedules/:id/cancel` by the user who created it. Sets `nextRunAt: null`. A second cancel is refused with `already_inactive` (409).',
        source: src(P.schedules, 190, 198, "status: 'cancelled', nextRunAt: null"),
      },
    ],
    sources: [src(P.shSchedules, 31, 33, 'export const SCHEDULE_STATUSES'), src(P.schema, 356, 362, 'nextRunAt DateTime?')],
  },
  {
    id: 'sm:lending-product-status',
    name: 'Lending product status',
    summary: 'A CD goes active → matured → closed; a loan goes active → paid_off. Both terminal states also close the product\'s account.',
    subject: 'db:LendingProduct',
    field: 'LendingProduct.status',
    initial: 'active',
    states: [
      { id: 'active', label: 'Active', description: 'A CD earning interest, or a loan with a balance owed. Counts toward the 10-product cap and is visited by accrual.' },
      { id: 'matured', label: 'Matured', description: 'CD only. The term has elapsed; interest has stopped; the balance can be withdrawn.' },
      { id: 'paid_off', label: 'Paid off', description: 'Loan only. Nothing remains owed; the loan account is `closed`.', terminal: true },
      { id: 'closed', label: 'Closed', description: 'CD only. The proceeds were withdrawn; the CD account is `closed`.', terminal: true },
    ],
    transitions: [
      {
        from: 'active',
        to: 'matured',
        label: 'clock reaches maturesAt (CD)',
        by: 'be:lending/accrual#runInterestAccrual',
        description: 'During an advance whose new time is at or past `maturesAt`, accrual posts the remaining months of interest up to maturity, sets `status: \'matured\'` and `lastAccruedAt = maturesAt`, and audits `interest_accrued_cd_matured`.',
        source: src(P.accrual, 160, 183, "data.status = 'matured'"),
      },
      {
        from: 'matured',
        to: 'closed',
        label: 'customer withdraws (CD)',
        by: 'be:lending/lending#withdrawMaturedCd',
        description: 'The whole balance moves to the chosen account as a transfer pair; the product and its account are set to `closed`.',
        source: src(P.lending, 417, 430, "status: 'closed'"),
      },
      {
        from: 'active',
        to: 'closed',
        label: 'withdraw once now ≥ maturesAt (CD)',
        by: 'be:lending/lending#withdrawMaturedCd',
        description: 'The withdrawal check also accepts an `active` CD when the simulated now has reached `maturesAt`. In practice accrual marks the CD `matured` during the same advance that reaches maturity, so this path is only taken if that accrual step failed for the product.',
        source: src(P.lending, 406, 409, 'now.getTime() >= product.maturesAt.getTime()'),
        confidence: 'inferred',
      },
      {
        from: 'active',
        to: 'paid_off',
        label: 'payment clears the balance (loan)',
        by: 'be:lending/lending#makeLoanPayment',
        description: 'When a payment brings the amount owed to zero, the product becomes `paid_off` and the loan account `closed` in the same transaction.',
        source: src(P.lending, 372, 380, "paidOff ? 'paid_off' : 'active'"),
      },
      {
        from: 'active',
        to: 'active',
        label: 'partial payment / monthly accrual',
        by: 'be:lending/lending#makeLoanPayment',
        description: 'A payment that leaves something owed keeps the loan `active` (only `updatedAt` changes). Monthly accrual moves `lastAccruedAt` forward without changing the status.',
        source: src(P.lending, 372, 377, 'lendingProduct.update'),
      },
    ],
    sources: [src(P.shLending, 40, 42, 'export const LENDING_STATUSES'), src(P.schema, 382, 399, 'model LendingProduct')],
  },
  {
    id: 'sm:simulation-clock',
    name: 'Simulation clock',
    summary: 'The clock stands still until staff advance it; during an advance the new time is already in force while schedules fire and interest accrues. It never moves backwards.',
    subject: 'db:SimulationClock',
    field: 'SimulationClock.currentTime',
    initial: 'standing-still',
    states: [
      { id: 'standing-still', label: 'Standing still', description: '`currentTime` is constant. Every money and business timestamp written in this state equals it, however much real time passes.' },
      { id: 'advancing', label: 'Advance in progress', description: '`currentTime` has already been moved forward and audited; the same request is now firing due schedules and accruing interest over the window that elapsed.' },
    ],
    transitions: [
      {
        from: 'standing-still',
        to: 'advancing',
        label: 'staff advance by n minutes (1 … 527,040)',
        by: 'be:clock/clock#advanceClock',
        description: 'The only way the clock changes after seeding: `currentTime` becomes `currentTime + n minutes` and an audit row `clock_advanced` is written. A zero or negative n is rejected before anything is written.',
        source: src(P.clock, 67, 81, 'simulationClock.update'),
      },
      {
        from: 'advancing',
        to: 'standing-still',
        label: 'scheduler and accrual finish',
        by: 'ep:POST /api/ops/clock/advance',
        description: 'The route handler runs `runDueSchedules(to)` and `runInterestAccrual(to)`, broadcasts the results and responds. The clock then rests at the new time until the next advance.',
        source: src(P.rClock, 56, 66, 'runInterestAccrual(advanced.to)'),
      },
    ],
    sources: [src(P.clock, 5, 14, 'only ever moves'), src(P.schema, 149, 155, 'model SimulationClock')],
    confidence: 'simplified',
  },
];

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export const glossary: GlossaryTerm[] = [
  {
    term: 'Simulation clock',
    definition: 'The bank\'s simulated date and time: one database row (`SimulationClock`, id `singleton`). It is the date stamped on ledger entries, requests, schedules and lending products. It stands still until staff advance it.',
    related: ['be:clock/clock', 'db:SimulationClock', 'feat:clock', 'op:pages/SimulationClock'],
    aliases: ['simulated clock', 'sim clock'],
  },
  {
    term: 'Simulated now vs wall clock',
    definition: '"Simulated now" is `simulationNow()` — the clock row\'s `currentTime` — and is used for all money and business dating. The wall clock (`new Date()`) is still used for authentication and operations: session expiry, login lockout, login history, the heartbeat\'s `serverTime`, and the default `createdAt` of audit rows.',
    related: ['be:clock/clock#simulationNow', 'sh:clock#SimHeartbeatPayload'],
    aliases: ['simulated date', 'sim now', 'wall-clock time', 'real time'],
  },
  {
    term: 'Advance (fast-forward)',
    definition: 'A staff action that moves the simulation clock forward by a chosen number of days, hours and minutes — at least one minute, at most 366 days. It is the trigger for scheduled payments and interest; nothing time-based happens without it.',
    related: ['ep:POST /api/ops/clock/advance', 'be:clock/clock#advanceClock', 'sh:clock#validateAdvance'],
    aliases: ['fast-forward', 'advance the clock', 'time travel'],
  },
  {
    term: 'Forward-only',
    definition: 'The clock can never be moved backwards. The validator rejects a zero or negative advance and the service rejects it again. The reason: ledger entries are append-only and dated by the clock, so rewinding would make new entries pre-date old ones.',
    related: ['sh:clock#validateAdvance', 'be:clock/clock#ClockError', 'db:SimulationClock'],
    aliases: ['no rewind'],
  },
  {
    term: 'Fire (a schedule)',
    definition: 'To carry out one due occurrence of a scheduled payment. Firing an internal transfer posts both transfer legs; firing a bill pay writes a pending payment and queues it for operator review. Both go through the same money service a manual payment uses, with the schedule\'s owner as the acting user.',
    related: ['be:scheduler/scheduler#fireSchedule', 'be:scheduler/scheduler#runDueSchedules', 'be:money/movements#createTransfer', 'be:money/movements#createExternalMovement'],
    aliases: ['fired', 'firing'],
  },
  {
    term: 'Occurrence',
    definition: 'One due date of a schedule. A recurring schedule has one occurrence per period; if the clock jumps several periods at once, each missed occurrence is fired in turn (catch-up), dated at its own due instant, up to 60 per schedule per advance.',
    related: ['be:scheduler/scheduler#fireSchedule', 'sh:schedules#SCHEDULE_LIMITS'],
    aliases: ['catch-up', 'missed occurrence'],
  },
  {
    term: 'Skipped occurrence',
    definition: 'An occurrence that came due but could not be paid — most often insufficient available funds. No ledger entry is written. The skip is recorded as a simulated event (`schedule_skipped`) and an audit row (`schedule_payment_skipped`), and the schedule moves on to its next date. It is not retried.',
    related: ['be:scheduler/scheduler#fireSchedule', 'sh:schedules#ScheduleFireSummary'],
    aliases: ['skip', 'insufficient funds skip'],
  },
  {
    term: 'Frequency',
    definition: 'How often a schedule recurs: `once` (a single future-dated payment), `weekly` (every 7 days) or `monthly` (same day next month, clamped to the month\'s length).',
    related: ['sh:schedules#SCHEDULE_FREQUENCIES', 'sh:schedules#addInterval'],
  },
  {
    term: 'nextRunAt',
    definition: 'The simulated instant a schedule is next due. Set at creation to the simulated now plus `firstRunInDays`; moved forward by one period each time an occurrence is claimed; null once the schedule is completed or cancelled. The scheduler selects schedules whose `nextRunAt` is at or before the new clock time.',
    related: ['db:PaymentSchedule', 'sh:schedules#addInterval', 'be:scheduler/scheduler#fireSchedule'],
    aliases: ['next run date', 'due date'],
  },
  {
    term: 'Accrual',
    definition: 'Posting interest that has been earned or become owed. In Meridian accrual runs when the clock advances: for every whole month that has elapsed since a target\'s bookmark, one `interest` ledger entry is posted, dated at that month\'s anniversary.',
    related: ['be:lending/accrual#runInterestAccrual', 'sh:lending#monthlyAccrualMinor', 'feat:interest'],
    aliases: ['interest accrual', 'accrue'],
  },
  {
    term: 'APY / basis points',
    definition: 'Rates are stored as integer basis points (`apyBps`): 100 bps = 1%, so 450 means 4.50% a year. One month of interest is balance × apyBps ÷ 10,000 ÷ 12, rounded to the cent. Savings earn 150 bps; CD and loan rates come from fixed tables keyed by term.',
    related: ['sh:lending#DEFAULT_SAVINGS_APY_BPS', 'sh:lending#CD_RATE_TABLE_BPS', 'sh:lending#LOAN_RATE_TABLE_BPS', 'sh:lending#monthlyAccrualMinor'],
    aliases: ['bps', 'apyBps', 'annual percentage yield', 'interest rate'],
  },
  {
    term: 'CD (certificate of deposit)',
    definition: 'A deposit locked for a fixed term at a fixed rate. In Meridian it is its own account of type `cd`, funded by a transfer from another account, credited with interest monthly, and withdrawable in full only once it has matured.',
    related: ['be:lending/lending#openCd', 'be:lending/lending#withdrawMaturedCd', 'db:LendingProduct'],
    aliases: ['certificate of deposit', 'term deposit'],
  },
  {
    term: 'Maturity',
    definition: 'The end of a product\'s term: `maturesAt` = opening date plus the term in calendar months. When the clock reaches it a CD stops earning interest and becomes `matured`. For a loan `maturesAt` is informational — nothing happens to a loan on that date.',
    related: ['db:LendingProduct', 'sh:lending#addMonthsClamped', 'be:lending/accrual#runInterestAccrual'],
    aliases: ['maturesAt', 'matured'],
  },
  {
    term: 'Loan as negative balance',
    definition: 'A loan is an account of type `loan` whose derived balance is negative: the disbursement debits it by the principal, interest debits it further, and payments credit it back toward zero. The amount owed is simply minus the balance. No "amount owed" column exists.',
    related: ['be:lending/lending#openLoan', 'be:lending/lending#makeLoanPayment', 'sh:lending#LendingProductDTO', 'sh:ledger#deriveBalances'],
    aliases: ['amount owed', 'outstanding balance', 'outstandingMinor'],
  },
  {
    term: 'Level payment (amortization)',
    definition: 'The fixed monthly amount that would repay a loan, with interest, in exactly its term. Computed once when the loan is opened (`amortizedPaymentMinor`, rounded up to the cent) and stored as `paymentMinor`. It is the default payment amount; it is not collected automatically.',
    related: ['sh:lending#amortizedPaymentMinor', 'sh:lending#validateOpenLoan'],
    aliases: ['amortized payment', 'monthly payment', 'paymentMinor'],
  },
  {
    term: 'Bank-originated interest',
    definition: 'An `interest` ledger entry has no matching entry on another account: the bank creates it. That makes interest one of the few things allowed to change the system-wide total of settled money. Opening, paying and withdrawing lending products are transfer pairs and never change that total.',
    related: ['be:lending/accrual#postInterest', 'db:LedgerEntry', 'feat:interest'],
    aliases: ['interest entry', 'origin interest'],
  },
  {
    term: 'interestAccruedThrough / lastAccruedAt',
    definition: 'The accrual bookmarks: the simulated instant through which interest has already been posted. Savings accounts use `Account.interestAccruedThrough` (falling back to `openedAt`); CDs and loans use `LendingProduct.lastAccruedAt`. A bookmark only moves forward by whole months, which is what makes accrual safe to re-run and prevents partial months from accruing.',
    related: ['db:Account', 'db:LendingProduct', 'be:lending/accrual#planMonthlyAccrual'],
    aliases: ['accrual bookmark', 'bookmark'],
  },
];
