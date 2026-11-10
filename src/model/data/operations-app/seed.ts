import type { Entity, Relation } from '../../types';
import { DEPLOY_DOC, rel, src } from './helpers';

/**
 * Seed & baseline (parent `be.seed`): the pure seed plan, the writer that
 * applies it, the seed entry script and the pristine-baseline builder.
 */

const PLAN = 'apps/backend/src/seed-plan.ts';
const APPLY = 'apps/backend/src/seed-apply.ts';
const SEED = 'apps/backend/prisma/seed.ts';
const BASELINE = 'apps/backend/prisma/baseline.mjs';
const PLAN_TEST = 'apps/backend/src/seed-plan.test.ts';
const BASELINE_TEST = 'apps/backend/src/baseline.test.ts';

const assert = (
  name: string,
  start: number,
  end: number,
  summary: string,
  description: string,
  tags: string[],
): Entity => ({
  id: `be:seed-plan#${name}`,
  kind: 'function',
  name,
  parent: 'be:seed-plan',
  summary,
  description,
  signature: `export function ${name}(plan: SeedPlan): void`,
  tags: ['seed', 'validation', ...tags],
  sources: [src(PLAN, start, end, `export function ${name}`)],
});

export const seedEntities: Entity[] = [
  {
    id: 'be:seed-plan',
    kind: 'module',
    name: 'seed-plan.ts',
    parent: 'be.seed',
    summary: 'A pure, database-free description of the demo data — who exists, what they own, and every ledger entry — plus the rules that data must satisfy.',
    description:
      'Nothing in this file touches the database: `buildSeedPlan()` returns plain objects that reference each other by stable keys (`avery-checking`, `card-debit`, `pending-billpay`…), and eight `assertSeed…` functions throw if the plan is inconsistent. Keeping the plan pure is what lets the money rules be unit-tested without a database, and the same assertions run again every time the plan is written.\n\nWhat is seeded:\n• 4 users, one per role — Avery Customer (customer), Jordan Joint (joint_customer), Sam Operator (ops_agent), Riley Admin (admin). Only Avery owns accounts: Everyday Checking and Goal Savings. Jordan has a `joint` grant on the checking account only.\n• 58 ledger entries dated across the previous 90 days: opening deposits, six payrolls, rent, groceries, utilities, subscriptions, card spending, a fee, a refund, four balanced internal transfers and three interest credits — 52 posted, 1 disputed, 4 pending, 1 held. Planned balances: checking $10,596.36 current, savings $5,462.57.\n• 11 operations requests, none terminal: nine `pending`, one `on_hold` (outbound ACH) and one `info_requested` (the Trattoria dispute). Three are reviewable money movements each linked to a pending ledger entry (mobile check deposit $320.00, outbound ACH $450.00, bill payment $75.50); the fraud alert is linked to the QuickFuel $48.90 charge and the debit card; the dispute is linked to the disputed Trattoria Romana $42.10 charge.\n• 4 simulated events, 1 onboarding application (Taylor Prospect, checking, $250.00 opening deposit) backing the onboarding request, 1 pending joint invitation (Avery invites Jordan to Goal Savings), 2 cards (debit and credit, on checking), 2 monthly schedules due 3 and 5 days after seed time, 2 lending products (a $2,000 6-month CD and a $6,000 24-month loan) and 3 fictional sign-in events using documentation-range IP addresses.\n\nEvery user and the seeded applicant carries a NON-SECRET demo password (published in the README so reviewers can sign in). It is hashed with bcrypt before it is stored; the plaintext exists only in this file.',
    audience: {
      executive: 'The script for the demo: a ready-made customer with three months of believable history and a queue of work for the back office.',
      dba: 'The source of truth for seeded rows. Keys in the plan are resolved to generated ids at write time; no ids, hashes or timestamps are fixed here except relative offsets (`daysAgo`, `minutesAgo`, `firstRunInDays`).',
    },
    example: {
      users: [
        { email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer', accounts: ['Everyday Checking', 'Goal Savings'] },
        { email: 'jordan.joint@example.com', displayName: 'Jordan Joint', role: 'joint_customer', accounts: [], access: 'joint on Everyday Checking only' },
        { email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent', accounts: [] },
        { email: 'riley.admin@example.com', displayName: 'Riley Admin', role: 'admin', accounts: [] },
      ],
      applicant: { email: 'taylor.prospect@example.com', fullName: 'Taylor Prospect', product: 'checking', initialFundingMinor: 25000 },
      note: 'Each persona has a public demo password in the repository README; passwords are deliberately not reproduced here.',
    },
    tech: ['TypeScript'],
    tags: ['seed', 'data', 'ledger', 'money'],
    aliases: ['demo data', 'personas', 'seed data', 'fixtures'],
    sources: [
      src(PLAN, 48, 53, 'The seed PLAN is a pure description of the demo data'),
      src(PLAN, 299, 339, 'export function buildSeedPlan', 'Personas + access grant'),
      src(PLAN, 389, 464, 'Opening deposit (seed funding)', 'Ledger history'),
      src(PLAN, 466, 472, 'Operations queue (v0.5.0)'),
    ],
  },
  {
    id: 'be:seed-plan#SeedPlan',
    kind: 'type',
    name: 'SeedPlan',
    parent: 'be:seed-plan',
    summary: 'The whole demo dataset as eleven lists of plain objects.',
    fields: [
      { name: 'users', type: 'SeedUser[]', required: true, description: 'Email, display name, role, demo password and owned accounts (`key`, `type`, `name`).' },
      { name: 'entries', type: 'SeedLedgerEntry[]', required: true, description: 'Every ledger entry, addressed to an account key.', typeRef: 'be:seed-plan#SeedLedgerEntry' },
      { name: 'access', type: 'SeedAccess[]', required: true, description: 'Non-owner grants (user email, account key, relationship).' },
      { name: 'cards', type: 'SeedCard[]', required: true, description: 'Simulated cards: account key, cardholder email, type, network, fake last4.' },
      { name: 'operationsRequests', type: 'SeedOperationsRequest[]', required: true, description: 'Queue items for the operations console.', typeRef: 'be:seed-plan#SeedOperationsRequest' },
      { name: 'simulatedEvents', type: 'SeedSimulatedEvent[]', required: true, description: 'Fake SMS / email / identity events, optionally linked to a request key.' },
      { name: 'onboardingApplications', type: 'SeedOnboardingApplication[]', required: true, description: 'Applications backing an `onboarding` request 1:1.' },
      { name: 'invitations', type: 'SeedInvitation[]', required: true, description: 'Joint-owner invitations.' },
      { name: 'schedules', type: 'SeedSchedule[]', required: true, description: 'Scheduled payments due `firstRunInDays` after seed time.' },
      { name: 'lending', type: 'SeedLending[]', required: true, description: 'CDs and loans, each on a new account funded by a net-zero transfer pair.' },
      { name: 'loginEvents', type: 'SeedLoginEvent[]', required: true, description: 'Fictional sign-in history (RFC 5737 addresses only).' },
    ],
    tags: ['seed', 'data'],
    sources: [src(PLAN, 263, 275, 'export interface SeedPlan')],
  },
  {
    id: 'be:seed-plan#SeedLedgerEntry',
    kind: 'type',
    name: 'SeedLedgerEntry',
    parent: 'be:seed-plan',
    summary: 'One planned ledger entry: which account, how much, which direction, what status and origin, and how many days ago.',
    fields: [
      { name: 'accountKey', type: 'string', required: true, description: 'Plan key of the account (`avery-checking`).' },
      { name: 'amountMinor', type: 'number', required: true, description: 'Positive integer cents.' },
      { name: 'direction', type: 'LedgerDirection', required: true, values: ['credit', 'debit'] },
      { name: 'status', type: 'LedgerStatus', required: true, description: 'Seeded values: `posted`, `disputed`, `pending`, `held`.' },
      { name: 'origin', type: 'LedgerOrigin', required: true, description: 'Seeded values: `seed`, `deposit`, `payment`, `card`, `fee`, `transfer`, `interest`.' },
      { name: 'description', type: 'string', required: true },
      { name: 'daysAgo', type: 'number', description: 'Days before seed time; becomes `createdAt` (and `postedAt` when settled). Default 0.' },
      { name: 'key', type: 'string', description: 'Optional stable key so a queue item can link to this entry (`pending-mobilecheck`, `card-quickfuel`). Must be unique.' },
    ],
    example: { accountKey: 'avery-checking', amountMinor: 32000, direction: 'credit', status: 'pending', origin: 'deposit', description: 'Mobile check deposit', daysAgo: 1, key: 'pending-mobilecheck' },
    tags: ['seed', 'ledger', 'money'],
    sources: [src(PLAN, 54, 74, 'export interface SeedLedgerEntry'), src(PLAN, 459, 464, 'pending-mobilecheck', 'The three reviewable pending entries')],
  },
  {
    id: 'be:seed-plan#SeedOperationsRequest',
    kind: 'type',
    name: 'SeedOperationsRequest',
    parent: 'be:seed-plan',
    summary: 'One planned queue item for the operations console, with optional links to the ledger entry and card it concerns.',
    fields: [
      { name: 'key', type: 'string', required: true, description: 'Stable key (`deposit-mobilecheck`) that simulated events and applications reference.' },
      { name: 'type', type: 'OpsRequestType', required: true },
      { name: 'status', type: 'OpsRequestStatus', description: 'Default `pending`.' },
      { name: 'priority', type: 'OpsRequestPriority', description: 'Default `normal`.' },
      { name: 'summary', type: 'string', required: true },
      { name: 'detail', type: 'string' },
      { name: 'subjectName / subjectEmail', type: 'string' },
      { name: 'payload', type: 'Record<string, unknown>', description: 'Type-specific context; link ids are filled in by the writer.' },
      { name: 'linkLedgerEntryKeys', type: 'string[]', description: 'Money movements: keys of the PENDING entries to post on approval → merged into `payload.ledgerEntryIds`.' },
      { name: 'linkLedgerEntryKey', type: 'string', description: 'Fraud / dispute: the one entry concerned → `payload.ledgerEntryId` (+ `accountId`).' },
      { name: 'linkCardKey', type: 'string', description: 'Fraud: the card to freeze → `payload.cardId`.' },
      { name: 'daysAgo', type: 'number', description: 'Days before seed time the request was raised.' },
    ],
    example: {
      key: 'deposit-mobilecheck',
      type: 'deposit',
      summary: 'Mobile check deposit awaiting review ($320.00)',
      subjectName: 'Avery Customer',
      subjectEmail: 'avery.customer@example.com',
      payload: { kind: 'mobile_check_deposit', amountMinor: 32000, direction: 'inbound', accountId: '', counterparty: null, memo: null, ledgerEntryIds: [], reference: 'MOV-SEED01' },
      linkLedgerEntryKeys: ['pending-mobilecheck'],
      daysAgo: 1,
    },
    tags: ['seed', 'operations'],
    sources: [src(PLAN, 120, 155, 'export interface SeedOperationsRequest'), src(PLAN, 510, 533, 'deposit-mobilecheck', 'Example: the seeded mobile check deposit')],
  },
  {
    id: 'be:seed-plan#buildSeedPlan',
    kind: 'function',
    name: 'buildSeedPlan',
    parent: 'be:seed-plan',
    summary: 'Builds and returns the complete demo dataset; calling it twice gives the same content.',
    description:
      'Ledger entries are created through small local helpers so they cannot be inconsistent by construction: `credit` / `debit` post a settled entry; `transfer(from, to, amount, daysAgo, …)` always pushes BOTH legs (a debit and a matching credit, origin `transfer`, same date); `unsettled` adds a pending or held entry, optionally with a key. Amounts are written in dollars and converted with the shared `toMinor`.\n\nThe lending rates are not hard-coded: the CD’s APY comes from the shared `cdApyForTerm(6)` (350 bps), the loan’s from `loanApyForTerm(24)` (1,050 bps), and the loan’s monthly payment from `amortizedPaymentMinor` ($278.26).',
    signature: 'export function buildSeedPlan(): SeedPlan',
    detail: 3,
    tags: ['seed', 'data', 'ledger'],
    sources: [
      src(PLAN, 299, 301, 'export function buildSeedPlan'),
      src(PLAN, 341, 387, 'const transfer', 'Paired helpers keep transfers balanced'),
      src(PLAN, 763, 793, 'amortizedPaymentMinor', 'Lending products'),
      src(PLAN, 824, 837, 'loginEvents'),
    ],
  },
  assert(
    'assertSeedInvariants',
    839,
    870,
    'The money rule: across the settled seed entries, transfers must net to zero and every credit must come from the bank or be one leg of a transfer.',
    'Looks only at settled entries (`posted` or `disputed`). (1) Summing `transfer`-origin entries (credits positive, debits negative) must give exactly 0 — moving money creates none. (2) Any settled credit whose origin is neither `transfer` nor one of the shared `BANK_ORIGINATED_ORIGINS` throws “a credit appeared from a non-bank, non-transfer origin”. This is the seed-time form of “money cannot appear from nowhere”.',
    ['ledger', 'money'],
  ),
  assert(
    'assertSeedAccessIntegrity',
    872,
    914,
    'Users must have unique emails and a demo password of at least 8 characters, and every access grant must point at a declared user and account.',
    'Also checks each grant’s relationship against the shared `ACCOUNT_RELATIONSHIPS`. The access-control tests rely on this fixture being sound (Jordan sees checking, not savings).',
    ['rbac', 'auth'],
  ),
  assert(
    'assertSeedOpsIntegrity',
    916,
    956,
    'Queue items must have unique keys and known type, status and priority; simulated events must use known values and link only to existing request keys.',
    'Validates against the shared value lists (`OPS_REQUEST_TYPES`, `OPS_REQUEST_STATUSES`, `OPS_REQUEST_PRIORITIES`, `SIM_EVENT_CHANNELS`, `SIM_EVENT_DIRECTIONS`, `SIM_EVENT_STATUSES`).',
    ['operations'],
  ),
  assert(
    'assertSeedOnboardingIntegrity',
    958,
    1017,
    'Each application must back a real `onboarding` request with a known product, a non-negative integer deposit, a unique reference and an email no seeded user already has.',
    'The duplicate-email check prevents seeding an application that could never be approved (provisioning refuses an existing email). Invitations must reference a declared account and inviter and use known relationship and status values.',
    ['onboarding'],
  ),
  assert(
    'assertSeedMovementIntegrity',
    1019,
    1063,
    'Every queue item that links ledger entries must be a money-movement type, and each linked entry must exist and be `pending`.',
    'Ledger-entry keys must be unique. A request with `linkLedgerEntryKeys` must have a type from the shared `REVIEWABLE_MOVEMENT_OPS_TYPE` (deposit, ach, wire, bill_pay). This is what makes the seeded deposit, ACH and bill-pay items approvable end to end: approval posts exactly the entry the plan linked.',
    ['money', 'ledger', 'operations'],
  ),
  assert(
    'assertSeedCardIntegrity',
    1065,
    1111,
    'Cards must have unique keys, a declared account and cardholder, and known type, network and status; a request’s card or ledger link must point at something declared.',
    'Covers the single links used by the fraud alert (`linkCardKey`, `linkLedgerEntryKey`) and the dispute (`linkLedgerEntryKey`).',
    ['cards', 'risk'],
  ),
  assert(
    'assertSeedScheduleIntegrity',
    1113,
    1158,
    'Schedules must have a declared owner and source account, a known kind and frequency, an in-range amount and first-run offset, and the right destination for their kind.',
    'An internal transfer needs a declared destination account different from the source; a bill pay needs a biller. Bounds come from the shared `SCHEDULE_LIMITS`.',
    ['time'],
  ),
  assert(
    'assertSeedLendingIntegrity',
    1160,
    1213,
    'Lending products must have unique keys and account keys, a declared owner and counterparty account, in-range principal, rate and term, and a payment only if they are loans.',
    'Bounds come from the shared `LENDING_LIMITS`. A loan must carry a positive monthly payment; a CD must carry none. Unlike the other seven assertions, this one has no dedicated negative test in `seed-plan.test.ts` — it is exercised only through `applySeedPlan`.',
    ['lending'],
  ),
  {
    id: 'be:seed-plan#seededShowcaseEmails',
    kind: 'function',
    name: 'seededShowcaseEmails',
    parent: 'be:seed-plan',
    summary: 'Returns the lower-cased emails of every seeded account whose password is public: the four demo users plus the seeded applicant.',
    description: 'Derived from the plan itself so the list can never drift from the seed. Used by the login route’s public-demo lockout exemption.',
    signature: 'export function seededShowcaseEmails(plan: SeedPlan = buildSeedPlan()): Set<string>',
    example: ['avery.customer@example.com', 'jordan.joint@example.com', 'sam.operator@example.com', 'riley.admin@example.com', 'taylor.prospect@example.com'],
    tags: ['seed', 'auth', 'public-demo'],
    sources: [src(PLAN, 277, 289, 'export function seededShowcaseEmails')],
  },
  {
    id: 'be:seed-plan#isSeededShowcaseEmail',
    kind: 'function',
    name: 'isSeededShowcaseEmail',
    parent: 'be:seed-plan',
    summary: 'True when an email belongs to one of the seeded showcase accounts.',
    description:
      'Trims and lower-cases the email and looks it up in a module-level cache built on first use. The login route calls it (only when `PUBLIC_DEMO` is on) to decide that a failed attempt must not set `lockedUntil` — the passwords are public, so a lock would only let one visitor disable the demo for everyone.',
    signature: 'export function isSeededShowcaseEmail(email: string): boolean',
    tags: ['seed', 'auth', 'security', 'public-demo'],
    sources: [src(PLAN, 291, 297, 'export function isSeededShowcaseEmail')],
  },

  // ---- seed-apply -----------------------------------------------------------
  {
    id: 'be:seed-apply',
    kind: 'module',
    name: 'seed-apply.ts',
    parent: 'be.seed',
    summary: 'The one writer that turns a seed plan into database rows — used by the seed script and by the backend’s test fixtures alike.',
    description:
      'Extracted from the seed script so tests seed through the real path rather than a parallel copy (`apps/backend/src/test/fixtures.ts` calls `applySeedPlan(prisma, buildSeedPlan())`). It is re-runnable: it empties the domain tables first.',
    tags: ['seed', 'data'],
    sources: [src(APPLY, 17, 24, 'Apply a seed PLAN to the database')],
  },
  {
    id: 'be:seed-apply#applySeedPlan',
    kind: 'function',
    name: 'applySeedPlan',
    parent: 'be:seed-apply',
    summary: 'Checks the plan, wipes the domain tables, then inserts everything — resolving plan keys to real ids as it goes — and resets the simulation clock to the seed instant.',
    description:
      'Order of work:\n1. Run all eight `assertSeed…` checks; any violation throws before a single row is touched.\n2. `deleteMany()` on fifteen tables, children before parents (login events, sessions, lending products, schedules, invitations, travel notices, cards, access grants, ledger entries, applications, accounts, simulated events, requests, audit log, users).\n3. Users (bcrypt-hash the demo password; status `active`), their accounts, and an `owner` access grant per account; then the extra grants.\n4. Ledger entries: `createdAt = now − daysAgo`; `postedAt` set only for `posted` / `disputed`. Ids are remembered by plan key.\n5. Cards (expiry = now + 4 years by default).\n6. Operations requests: link keys are resolved and merged into the JSON payload (`ledgerEntryIds`; or `ledgerEntryId` + `accountId`; `cardId`); each request also gets an `ops_request_created` audit row (actor role `system`) so its history starts with “Created”.\n7. Simulated events, onboarding applications (password hashed, status `submitted`), invitations (random 24-byte token).\n8. Schedules (`nextRunAt = now + firstRunInDays`).\n9. Lending: a new `cd` / `loan` account + owner grant, a posted `transfer` debit and credit of the principal (CD: checking → CD; loan: loan account → checking, leaving the loan account negative), and the `LendingProduct` row.\n10. Fictional login events; `interestAccruedThrough = now` on savings accounts; upsert the `SimulationClock` singleton to `now`, speed 1; one `seed_database` audit row.\nReturns row counts. It does not use a transaction — it is meant for an empty or disposable database.',
    signature: 'export async function applySeedPlan(prisma: PrismaClient, plan: SeedPlan, now: Date = new Date()): Promise<SeedResult>',
    audience: {
      dba: 'Clears 15 tables, then inserts sequentially without a transaction. With the default plan it yields 4 users, 4 accounts (two created for the lending products), 62 ledger entries, 5 access grants, 11 requests, 12 audit rows, 4 events, 1 application, 1 invitation, 2 cards, 2 schedules, 2 lending products, 3 login events and the clock singleton.',
    },
    detail: 3,
    tags: ['seed', 'data', 'ledger'],
    sources: [
      src(APPLY, 40, 52, 'export async function applySeedPlan'),
      src(APPLY, 54, 68, 'prisma.loginEvent.deleteMany()', 'Wipe, children before parents'),
      src(APPLY, 108, 131, 'postedAt: isSettled ? occurredAt : null', 'Ledger entries'),
      src(APPLY, 161, 220, 'ledgerEntryIds', 'Requests: link resolution + intake audit row'),
      src(APPLY, 314, 359, 'Loan principal (amount financed)', 'Lending as a net-zero transfer pair'),
      src(APPLY, 378, 399, "action: 'seed_database'", 'Accrual bookmark, clock reset, audit row'),
    ],
  },
  {
    id: 'be:seed-apply#SeedResult',
    kind: 'type',
    name: 'SeedResult',
    parent: 'be:seed-apply',
    summary: 'Row counts read back from the database after seeding.',
    example: { users: 4, accounts: 4, entries: 62, grants: 5, opsRequests: 11, simulatedEvents: 4, onboardingApplications: 1, invitations: 1, cards: 2, schedules: 2, lending: 2, loginEvents: 3 },
    detail: 5,
    tags: ['seed'],
    sources: [src(APPLY, 25, 38, 'export interface SeedResult')],
  },

  // ---- Entry scripts --------------------------------------------------------
  {
    id: 'be:prisma/seed',
    kind: 'module',
    name: 'prisma/seed.ts',
    parent: 'be.seed',
    summary: 'The command-line entry point that seeds whichever database `DATABASE_URL` points at.',
    description:
      'Run by `npm run db:seed` (and by `npm run db:reset` after `prisma migrate reset`). It calls `applySeedPlan(prisma, buildSeedPlan(), now)` and prints the row counts.\n\n`now` is the SEED INSTANT: every seeded timestamp is derived from it. By default it is the wall clock; setting `SEED_NOW` to an ISO-8601 instant pins it, and an unparseable value throws. Row ids and bcrypt salts stay random, so the content of two runs is identical but the file bytes are not.',
    tech: ['tsx', 'Prisma'],
    tags: ['seed', 'data'],
    aliases: ['db:seed', 'SEED_NOW', 'seed instant'],
    sources: [
      src(SEED, 5, 30, 'function seedInstant()'),
      src(SEED, 32, 43, 'applySeedPlan(prisma, buildSeedPlan(), now)'),
      src('apps/backend/package.json', 17, 18, '"db:seed": "tsx prisma/seed.ts"'),
    ],
  },
  {
    id: 'be:prisma/baseline',
    kind: 'module',
    name: 'prisma/baseline.mjs',
    parent: 'be.seed',
    summary: 'Builds a brand-new, fully migrated and seeded SQLite file — the pristine copy the public demo is reset onto.',
    description:
      '`npm run db:baseline [-- --out <file>]`. Target precedence: `--out`, then a `file:` `DATABASE_URL`, then `apps/backend/prisma/baseline/meridian-baseline.db` — so it never writes to the development `dev.db` unless pointed there.\n\nSteps: delete any existing file at the target plus its `-journal`, `-wal` and `-shm` side files → `prisma migrate deploy` (the committed migrations — never `migrate dev` or `db push`) → `tsx prisma/seed.ts` → open the result with the Prisma client and require at least one user, account and ledger entry and the clock singleton.\n\nThe release build runs it with `SEED_NOW` set to the commit’s committer timestamp, so rebuilding the same commit gives the same simulated instant and content. The resulting file is shipped inside the release as `baseline/meridian-baseline.db`; the server never migrates — it only copies this file.',
    audience: {
      dba: 'The unit of reset is the whole database file. The baseline is produced by `migrate deploy` + seed on the build machine; production never runs a migration.',
    },
    tech: ['Node.js', 'Prisma'],
    tags: ['seed', 'data', 'deployment', 'public-demo'],
    aliases: ['db:baseline', 'baseline database', 'pristine baseline'],
    sources: [
      src(BASELINE, 1, 20, 'Build a PRISTINE, SEEDED SQLite baseline'),
      src(BASELINE, 73, 99, "['migrate', 'deploy']", 'Target resolution, cleanup, migrate, seed'),
      src(BASELINE, 101, 121, 'Baseline verification failed', 'Self-check'),
      src(DEPLOY_DOC, 251, 290, 'replace the whole database', 'Whole-database reset philosophy'),
    ],
  },

  // ---- Tests ----------------------------------------------------------------
  {
    id: 'test:apps/backend/src/baseline.test.ts',
    kind: 'test',
    name: 'baseline.test.ts',
    parent: 'tests',
    summary: 'Runs the real baseline command against a temp directory and checks the result is complete, pinned to `SEED_NOW`, and repeatable.',
    description:
      'Test 1 executes `baseline.mjs --out <tmp>/nested/meridian.db` with `SEED_NOW=2026-09-01T00:00:00.000Z` and an empty `DATABASE_URL`, then opens the file: user and login-event counts equal the plan’s, the clock is exactly `SEED_NOW`, every seeded login IP is in an RFC 5737 documentation range, and at least one migration is recorded as finished. Test 2 runs it again over the same target and checks the oldest ledger entry is dated at or before the pinned instant — idempotent and deterministic. It also proves the backend’s tooling works with an absolute `file:` URL outside the repository.',
    tech: ['Vitest'],
    tags: ['tests', 'seed', 'data', 'deployment'],
    sources: [
      src(BASELINE_TEST, 10, 21, 'The pristine-baseline command deployment automation will use'),
      src(BASELINE_TEST, 31, 60, 'creates a pristine seeded database at the requested absolute path'),
      src(BASELINE_TEST, 62, 79, 'idempotent + deterministic'),
    ],
  },
];

const writes = (model: string, label: string, start: number, end: number, symbol: string, order: number): Relation =>
  rel('be:seed-apply#applySeedPlan', `db:${model}`, 'writes', {
    label,
    sources: [src(APPLY, start, end, symbol)],
    order,
  });

const check = (name: string, line: number, order: number): Relation =>
  rel('be:seed-apply#applySeedPlan', `be:seed-plan#${name}`, 'calls', {
    label: `${name}(plan)`,
    sources: [src(APPLY, line, line, `${name}(plan)`)],
    order,
    detail: 5,
  });

export const seedRelations: Relation[] = [
  // ---- applySeedPlan → assertions -------------------------------------------
  check('assertSeedInvariants', 45, 1),
  check('assertSeedAccessIntegrity', 46, 2),
  check('assertSeedOpsIntegrity', 47, 3),
  check('assertSeedOnboardingIntegrity', 48, 4),
  check('assertSeedMovementIntegrity', 49, 5),
  check('assertSeedCardIntegrity', 50, 6),
  check('assertSeedScheduleIntegrity', 51, 7),
  check('assertSeedLendingIntegrity', 52, 8),
  rel('be:seed-apply#applySeedPlan', 'be:auth/password#hashPassword', 'calls', {
    label: 'hashPassword(u.password)',
    summary: 'Demo passwords are bcrypt-hashed before they reach the database.',
    sources: [src(APPLY, 73, 84, 'hashPassword(u.password)'), src(APPLY, 242, 246, 'hashPassword(app.password)')],
    order: 9,
  }),
  rel('be:seed-apply#applySeedPlan', 'be:seed-plan#SeedPlan', 'uses-type', {
    label: 'plan: SeedPlan',
    sources: [src(APPLY, 40, 44, 'plan: SeedPlan')],
    detail: 5,
  }),

  // ---- applySeedPlan → tables -----------------------------------------------
  writes('User', 'deleteMany; create 4 (role, status active, bcrypt passwordHash)', 73, 85, 'prisma.user.create', 10),
  writes('Account', 'deleteMany; create 2 owned + 2 lending accounts; set savings interestAccruedThrough', 87, 91, 'prisma.account.create', 11),
  writes('AccountAccess', 'deleteMany; create an owner grant per account + 1 joint grant', 92, 106, 'prisma.accountAccess.create', 12),
  writes('LedgerEntry', 'deleteMany; create 58 dated entries + 4 lending transfer legs', 112, 131, 'prisma.ledgerEntry.create', 13),
  writes('Card', 'deleteMany; create 2 active cards', 138, 159, 'prisma.card.create', 14),
  writes('OperationsRequest', 'deleteMany; create 11 with resolved payload links', 166, 209, 'prisma.operationsRequest.create', 15),
  writes('AuditLog', 'deleteMany; create ops_request_created per request + 1 seed_database', 210, 219, 'prisma.auditLog.create', 16),
  writes('SimulatedEvent', 'deleteMany; create 4 linked to request ids', 223, 237, 'prisma.simulatedEvent.create', 17),
  writes('OnboardingApplication', 'deleteMany; create 1 (status submitted, hashed password)', 242, 262, 'prisma.onboardingApplication.create', 18),
  writes('AccountInvitation', 'deleteMany; create 1 pending with a random token', 265, 282, 'prisma.accountInvitation.create', 19),
  writes('PaymentSchedule', 'deleteMany; create 2 active with nextRunAt = now + N days', 287, 312, 'prisma.paymentSchedule.create', 20),
  writes('LendingProduct', 'deleteMany; create 1 CD + 1 loan (maturesAt = now + term)', 345, 358, 'prisma.lendingProduct.create', 21),
  writes('LoginEvent', 'deleteMany; create 3 fictional sign-ins', 362, 376, 'prisma.loginEvent.create', 22),
  writes('SimulationClock', 'upsert singleton: currentTime = seed instant, speed 1', 383, 389, 'prisma.simulationClock.upsert', 23),
  writes('Session', 'deleteMany only (a fresh seed holds no sessions)', 54, 55, 'prisma.session.deleteMany()', 24),
  writes('CardTravelNotice', 'deleteMany only', 59, 59, 'prisma.cardTravelNotice.deleteMany()', 25),

  // ---- Entry scripts --------------------------------------------------------
  rel('be:prisma/seed', 'be:seed-plan#buildSeedPlan', 'calls', {
    label: 'buildSeedPlan()',
    sources: [src(SEED, 32, 35, 'buildSeedPlan()')],
    order: 1,
  }),
  rel('be:prisma/seed', 'be:seed-apply#applySeedPlan', 'calls', {
    label: 'applySeedPlan(prisma, buildSeedPlan(), now)',
    summary: '`now` is the seed instant — the wall clock, or `SEED_NOW` when set.',
    sources: [src(SEED, 32, 35, 'applySeedPlan(prisma, buildSeedPlan(), now)')],
    order: 2,
  }),
  rel('be:prisma/baseline', 'be:prisma/seed', 'calls', {
    label: 'tsx prisma/seed.ts (after prisma migrate deploy)',
    summary: 'The baseline builder seeds a freshly migrated file through the normal seed script.',
    sources: [src(BASELINE, 97, 99, 'seeding demo data (prisma/seed.ts)')],
  }),
  rel('be:prisma/baseline', 'db', 'writes', {
    label: 'creates a new SQLite file: migrate deploy + seed',
    summary: 'Produces the pristine baseline database that a reset copies over the live one.',
    sources: [src(BASELINE, 87, 99, 'applying committed migrations (prisma migrate deploy)')],
    detail: 3,
  }),
  rel('be:seed-plan#isSeededShowcaseEmail', 'be:seed-plan#seededShowcaseEmails', 'calls', {
    label: 'showcaseEmailCache ??= seededShowcaseEmails()',
    sources: [src(PLAN, 294, 297, 'seededShowcaseEmails()')],
    detail: 5,
  }),
  rel('be:seed-plan#seededShowcaseEmails', 'be:seed-plan#buildSeedPlan', 'calls', {
    label: 'plan: SeedPlan = buildSeedPlan()',
    sources: [src(PLAN, 284, 284, 'buildSeedPlan()')],
    detail: 5,
  }),
  rel('be:seed-plan#buildSeedPlan', 'be:seed-plan#SeedPlan', 'uses-type', {
    label: 'returns SeedPlan',
    sources: [src(PLAN, 299, 299, 'SeedPlan')],
    detail: 5,
  }),
  rel('be:seed-plan#buildSeedPlan', 'sh:money#toMinor', 'calls', {
    label: 'toMinor(major)',
    summary: 'Dollar literals in the plan become integer minor units.',
    sources: [src(PLAN, 350, 359, 'toMinor(major)')],
  }),
  rel('be:seed-plan#assertSeedInvariants', 'sh:ledger#BANK_ORIGINATED_ORIGINS', 'uses-type', {
    label: 'BANK_ORIGINATED_ORIGINS.includes(e.origin)',
    summary: 'The list of origins allowed to create money is the shared one the live ledger rules use.',
    sources: [src(PLAN, 859, 864, 'BANK_ORIGINATED_ORIGINS.includes(e.origin)')],
  }),

  // ---- Features -------------------------------------------------------------
  rel('be:prisma/baseline', 'feat:deploy', 'implements', { label: 'pristine baseline', sources: [src(BASELINE, 18, 20, 'the whole database is the unit of')] }),
  rel('be:seed-plan#assertSeedInvariants', 'feat:balances', 'implements', { label: 'no money from nowhere', sources: [src(PLAN, 839, 848, 'Money never')] }),

  // ---- Tests ----------------------------------------------------------------
  rel('test:apps/backend/src/baseline.test.ts', 'be:prisma/baseline', 'tests', {
    label: 'db:baseline builds a pinned, pristine database',
    sources: [src(BASELINE_TEST, 31, 48, 'expect(clock.currentTime.toISOString()).toBe(SEED_NOW)')],
  }),
  rel('test:apps/backend/src/baseline.test.ts', 'be:prisma/seed', 'tests', {
    label: 'SEED_NOW pins the seed instant',
    sources: [src(BASELINE_TEST, 62, 79, 'dated relative to the pinned instant')],
  }),
  rel('test:apps/backend/src/baseline.test.ts', 'be:seed-plan#buildSeedPlan', 'tests', {
    label: 'row counts equal the plan',
    sources: [src(BASELINE_TEST, 42, 46, 'plan.users.length')],
    detail: 5,
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedInvariants', 'tests', {
    label: 'rejects a tampered plan that conjures money',
    summary: 'A plan with an extra credit from a non-bank origin must throw; the real plan must pass and its transfers must net to zero.',
    sources: [src(PLAN_TEST, 38, 72, 'rejects a tampered plan that conjures money from nowhere')],
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#buildSeedPlan', 'tests', {
    label: 'plan shape: one user per role, actionable queue, linked movements',
    sources: [src(PLAN_TEST, 74, 99, 'provides one demo user for every role'), src(PLAN_TEST, 145, 156, 'never seeds a terminal (approved/rejected) request')],
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedAccessIntegrity', 'tests', {
    label: 'rejects grants to unknown users / accounts',
    sources: [src(PLAN_TEST, 100, 123, 'rejects an access grant that references an unknown account')],
    detail: 5,
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedOpsIntegrity', 'tests', {
    label: 'rejects unknown types and dangling event links',
    sources: [src(PLAN_TEST, 165, 189, 'rejects a simulated event that references an unknown request key')],
    detail: 5,
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedOnboardingIntegrity', 'tests', {
    label: 'rejects an application on a non-onboarding request',
    sources: [src(PLAN_TEST, 212, 240, 'rejects an application linked to a non-onboarding request')],
    detail: 5,
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedMovementIntegrity', 'tests', {
    label: 'each reviewable movement links a PENDING entry',
    sources: [src(PLAN_TEST, 245, 285, 'wires each reviewable money-movement request to a PENDING ledger entry')],
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedCardIntegrity', 'tests', {
    label: 'rejects cards / links to unknown keys',
    sources: [src(PLAN_TEST, 311, 327, 'rejects a card on an unknown account')],
    detail: 5,
  }),
  rel('test:apps/backend/src/seed-plan.test.ts', 'be:seed-plan#assertSeedScheduleIntegrity', 'tests', {
    label: 'rejects malformed schedules',
    sources: [src(PLAN_TEST, 351, 374, 'rejects a bill-pay schedule without a biller')],
    detail: 5,
  }),
  rel('test:apps/backend/src/routes/public-demo.test.ts', 'be:seed-plan#seededShowcaseEmails', 'tests', {
    label: 'the showcase list is derived from the seed plan',
    sources: [src('apps/backend/src/routes/public-demo.test.ts', 123, 129, 'the showcase list is derived from the seed plan')],
  }),
];
