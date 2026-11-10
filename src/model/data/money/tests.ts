import type { Entity, Relation } from '../../types';
import { F, rel, src } from './util';

/** The test files that pin money and ledger behaviour, and what each one pins. */

const t = (file: string) => `test:${file}`;

export const testEntities: Entity[] = [
  {
    id: t(F.tMoney),
    kind: 'test',
    name: 'routes/money.test.ts',
    parent: 'tests',
    summary: 'Integration tests for money movement: transfers, external movements, operator approval / rejection / hold, reversal — and the money-conservation invariants.',
    description:
      'Drives a real Fastify instance with `app.inject()` against a seeded database, with a `RecordingOpsRealtime` double to assert emissions. It checks the system-wide settled total before and after each operation: unchanged by a transfer, unchanged by queuing a movement, up by exactly the amount when a deposit is approved, down by the amount when an outbound movement is approved, and back down when a posted deposit is reversed.\n\nCases: transfer posts both legs and is audited; over-available transfer → 400 `insufficient_funds` and no rows; joint user cannot pull from an account they have no grant on → 403; same-account and missing fields → 400; no session → 401; a check deposit queues a pending credit, an operations request with the soft link, and a `created` emission; an outbound bill pay reserves available funds; approval posts (pending → posted); rejection fails (pending → failed) and releases the reservation; hold leaves the entry pending; a deposit request with no payload posts nothing; reversal needs a reason (400), 409 when nothing is posted, 400 `not_a_movement`, 403 for a customer.',
    tags: ['money', 'ledger', 'operations', 'tests'],
    tech: ['Vitest', 'Fastify inject', 'Prisma'],
    sources: [src(F.tMoney, 8, 17, 'Integration tests for v0.7.0 money movement', 'File header: what is covered')],
  },
  {
    id: t(F.tTransactions),
    kind: 'test',
    name: 'routes/transactions.test.ts',
    parent: 'tests',
    summary: 'Integration tests for GET /api/accounts/:id/transactions: access scoping, ordering, running balance and server-side filters.',
    description:
      'Cases: 401 without a session; the owner gets the header plus more than ten seeded transactions, newest first, with a running balance on posted rows and null on pending ones; a joint user can read the shared checking account but gets 403 on savings; an operator gets 403; an unknown id gets 404; `?group=pending` returns only pending and held rows; `?q=simmons` matches case-insensitively; `?origin=interest` returns nothing for checking; unknown filter values are ignored.',
    tags: ['ledger', 'rbac', 'data', 'tests'],
    tech: ['Vitest', 'Fastify inject'],
    sources: [src(F.tTransactions, 8, 14, 'GET /api/accounts/:id/transactions', 'File header')],
  },
  {
    id: t(F.tShLedger),
    kind: 'test',
    name: 'shared/ledger.test.ts',
    parent: 'tests',
    summary: 'Unit tests for `deriveBalances` and the conservation rule: an internal transfer leaves the system’s settled total unchanged.',
    description:
      'Cases: an empty ledger derives all zeroes; posted credits and debits count in both current and available; a pending debit and a hold reduce available but not current, while a pending credit is only tracked; failed and reversed entries are ignored; a negative amount throws; debiting account A and crediting account B by the same amount leaves `settledTotalMinor` over both accounts unchanged.',
    tags: ['ledger', 'money', 'tests'],
    tech: ['Vitest'],
    sources: [src(F.tShLedger, 1, 14, "describe('deriveBalances'"), src(F.tShLedger, 56, 81, 'ledger invariant: money does not appear or vanish')],
  },
  {
    id: t(F.tShMoney),
    kind: 'test',
    name: 'shared/money.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the minor-unit helpers: conversion without float drift, integer assertion, summing and formatting.',
    tags: ['money', 'tests'],
    tech: ['Vitest'],
    sources: [src(F.tShMoney, 4, 24, "describe('money'")],
  },
  {
    id: t(F.tShMovement),
    kind: 'test',
    name: 'shared/money-movement.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the movement contract: kind mappings, both validators’ rules, and parsing of the stored payload.',
    description:
      'Cases: only `internal_transfer` is not reviewable; kinds map to the right ops type and ledger origin; `validateTransfer` normalizes the memo, requires two different accounts, and enforces integer amounts between the min and max; `validateExternalMovement` accepts a check deposit with no counterparty, requires a biller for a bill payment, forces a wire outbound, makes an ACH declare a direction, rejects `internal_transfer` and unknown kinds, and enforces the amount bounds; `asMovementPayload` parses a good payload, returns null for a non-movement payload, and defaults a missing `ledgerEntryIds` to an empty array.',
    tags: ['money', 'validation', 'tests'],
    tech: ['Vitest'],
    sources: [src(F.tShMovement, 14, 20, 'The money-movement contract is pure and shared')],
  },
  {
    id: t(F.tShTransactions),
    kind: 'test',
    name: 'shared/transactions.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the transaction view: signed amounts, status grouping, newest-first ordering, running balance and filtering.',
    tags: ['ledger', 'data', 'tests'],
    tech: ['Vitest'],
    sources: [src(F.tShTransactions, 63, 106, "describe('toTransactionDTOs'"), src(F.tShTransactions, 108, 142, "describe('filterTransactions'")],
  },
  {
    id: t(F.tShStatements),
    kind: 'test',
    name: 'shared/statements.test.ts',
    parent: 'tests',
    summary: 'Unit tests for statement periods: month boundaries, clamping, and opening / credits / debits / closing from settled entries only.',
    tags: ['money', 'data', 'time', 'tests'],
    tech: ['Vitest'],
    sources: [src(F.tShStatements, 6, 26, 'buildStatementPeriods'), src(F.tShStatements, 28, 68, 'summarizeStatementPeriod')],
  },
  {
    id: t(F.tSeedPlan),
    kind: 'test',
    name: 'seed-plan.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the demo seed plan — above all the money-conservation invariant: no seeded money comes from nowhere.',
    description:
      'The money-related cases: every seeded amount is a positive integer; posted `transfer` entries net to zero across accounts; every settled credit is either a transfer leg or carries a bank-originated origin; a tampered plan with a posted `card` credit is rejected by `assertSeedInvariants`; each seeded reviewable movement request is wired to a PENDING ledger entry, and a non-movement request may not link one. The file also covers seed users, access grants, the operations queue, onboarding, cards and schedules (owned by other parts of the model).',
    tags: ['ledger', 'money', 'data', 'tests'],
    aliases: ['money conservation', 'seed invariants'],
    tech: ['Vitest'],
    sources: [
      src(F.tSeedPlan, 21, 72, "describe('seed plan invariants'", 'The money-integrity cases'),
      src(F.tSeedPlan, 242, 284, "describe('seed plan money movements (v0.7.0)'", 'Movement ↔ pending-entry wiring'),
    ],
  },
];

export const testRelations: Relation[] = [
  // routes/money.test.ts
  rel(t(F.tMoney), 'ep:POST /api/transfers', 'tests', {
    label: '201 both legs; 400 insufficient_funds; 403; 400 invalid; 401',
    summary: 'Pins the transfer endpoint end to end, including that the settled total is unchanged.',
    sources: [src(F.tMoney, 73, 142, "describe('POST /api/transfers (internal, immediate)'")],
  }),
  rel(t(F.tMoney), 'be:money/movements#createTransfer', 'tests', {
    label: 'posts BOTH legs, nets to zero, audited',
    sources: [src(F.tMoney, 74, 105, 'posts BOTH legs, nets to zero')],
  }),
  rel(t(F.tMoney), 'ep:POST /api/movements', 'tests', {
    label: '201 pending_review; reserves funds; 400 insufficient_funds; 401',
    summary: 'Pins the external-movement endpoint: pending entry, linked request, live emission.',
    sources: [src(F.tMoney, 146, 219, "describe('POST /api/movements (external, reviewable)'")],
  }),
  rel(t(F.tMoney), 'be:money/movements#createExternalMovement', 'tests', {
    label: 'pending credit + deposit request; pending debit reserves available',
    sources: [src(F.tMoney, 147, 213, 'queues a mobile check deposit as a PENDING credit')],
  }),
  rel(t(F.tMoney), 'be:money/movements#requireMovableAccount', 'tests', {
    label: 'joint user cannot pull from an ungranted account (403)',
    sources: [src(F.tMoney, 121, 130, 'forbids transferring from an account the caller cannot access (403)')],
  }),
  rel(t(F.tMoney), 'be:money/movements#postApprovedMovement', 'tests', {
    label: 'approve: pending → posted; balances and settled total move',
    sources: [src(F.tMoney, 223, 277, "describe('operator approval posts the movement'")],
  }),
  rel(t(F.tMoney), 'be:money/movements#failMovement', 'tests', {
    label: 'reject: pending → failed; reserved funds released',
    sources: [src(F.tMoney, 279, 300, 'rejecting a movement marks the pending entry failed')],
  }),
  rel(t(F.tMoney), 'be:money/movements#movementPayloadOf', 'tests', {
    label: 'a deposit request with no payload posts nothing',
    sources: [src(F.tMoney, 318, 325, 'approving a deposit request with NO movement payload posts nothing')],
  }),
  rel(t(F.tMoney), 'be:money/movements#reverseMovement', 'tests', {
    label: 'posted → reversed with reason + audit; 400 / 409 / 403 cases',
    sources: [src(F.tMoney, 330, 395, "describe('POST /api/ops/movements/:requestId/reverse'")],
  }),
  rel(t(F.tMoney), 'feat:balances', 'tests', {
    label: 'settled total changes only by posted deposits and debits',
    summary: 'Checks the money-conservation invariant against the live database after every operation.',
    sources: [src(F.tMoney, 49, 56, 'async function settledTotal')],
  }),

  // routes/transactions.test.ts
  rel(t(F.tTransactions), 'ep:GET /api/accounts/:id/transactions', 'tests', {
    label: '401 / 403 / 404; ordering; running balance; filters',
    sources: [src(F.tTransactions, 14, 115, "describe('account transactions endpoint'")],
  }),
  rel(t(F.tTransactions), 'be:routes/accounts#parseTransactionQuery', 'tests', {
    label: 'unknown group/origin values are ignored',
    sources: [src(F.tTransactions, 108, 114, 'ignores an unknown filter value rather than erroring')],
  }),

  // shared/ledger.test.ts
  rel(t(F.tShLedger), 'sh:ledger#deriveBalances', 'tests', {
    label: 'one case per status rule',
    summary: 'Empty, posted, pending/held, failed/reversed and the negative-amount guard.',
    sources: [src(F.tShLedger, 4, 54, "describe('deriveBalances'")],
  }),
  rel(t(F.tShLedger), 'sh:ledger#settledTotalMinor', 'tests', {
    label: 'a transfer conserves the system’s settled total',
    sources: [src(F.tShLedger, 56, 81, 'an internal transfer conserves total settled value across accounts')],
  }),

  // shared/money.test.ts
  rel(t(F.tShMoney), 'sh:money#toMinor', 'tests', { label: 'toMinor(10.99) === 1099', sources: [src(F.tShMoney, 5, 9, 'toMinor(10.99)')] }),
  rel(t(F.tShMoney), 'sh:money#assertMinor', 'tests', { label: 'rejects 10.5', sources: [src(F.tShMoney, 11, 13, 'assertMinor(10.5)')] }),
  rel(t(F.tShMoney), 'sh:money#sumMinor', 'tests', { label: 'sums and validates each', sources: [src(F.tShMoney, 15, 18, 'sumMinor([100, 250, -50])')] }),
  rel(t(F.tShMoney), 'sh:money#formatMinor', 'tests', { label: "'$1,234.56', '-$50.00'", sources: [src(F.tShMoney, 20, 23, 'formatMinor(123456)')] }),

  // shared/money-movement.test.ts
  rel(t(F.tShMovement), 'sh:money-movement#validateTransfer', 'tests', {
    label: 'memo normalized; two different accounts; amount bounds',
    sources: [src(F.tShMovement, 53, 74, "describe('validateTransfer'")],
  }),
  rel(t(F.tShMovement), 'sh:money-movement#validateExternalMovement', 'tests', {
    label: 'fixed directions; counterparty rules; kind and amount checks',
    sources: [src(F.tShMovement, 76, 112, "describe('validateExternalMovement'")],
  }),
  rel(t(F.tShMovement), 'sh:money-movement#asMovementPayload', 'tests', { label: 'parses, rejects non-movement payloads, defaults ledgerEntryIds', sources: [src(F.tShMovement, 114, 139, "describe('asMovementPayload'")] }),
  rel(t(F.tShMovement), 'sh:money-movement#movementLedgerOrigin', 'tests', { label: 'transfer / deposit (in) / payment (out)', sources: [src(F.tShMovement, 37, 44, 'derives the ledger origin')] }),
  rel(t(F.tShMovement), 'sh:money-movement#movementOpsType', 'tests', { label: 'kind → ops request type', sources: [src(F.tShMovement, 30, 35, 'maps reviewable kinds to their ops request type')] }),
  rel(t(F.tShMovement), 'sh:money-movement#isReviewableMovement', 'tests', { label: 'everything but internal_transfer', sources: [src(F.tShMovement, 22, 28, 'treats every kind except internal_transfer as reviewable')] }),

  // shared/transactions.test.ts
  rel(t(F.tShTransactions), 'sh:transactions#toTransactionDTOs', 'tests', {
    label: 'newest-first; running balance over settled rows only',
    sources: [src(F.tShTransactions, 63, 106, "describe('toTransactionDTOs'")],
  }),
  rel(t(F.tShTransactions), 'sh:transactions#filterTransactions', 'tests', { label: 'q, group, origin, combined with AND', sources: [src(F.tShTransactions, 108, 142, "describe('filterTransactions'")] }),
  rel(t(F.tShTransactions), 'sh:transactions#groupForStatus', 'tests', { label: 'pending+held / posted+disputed / other', sources: [src(F.tShTransactions, 35, 53, 'groupForStatus')] }),
  rel(t(F.tShTransactions), 'sh:transactions#signedMinor', 'tests', { label: 'credit +, debit −', sources: [src(F.tShTransactions, 28, 33, "describe('signedMinor'")] }),

  // shared/statements.test.ts
  rel(t(F.tShStatements), 'sh:statements#buildStatementPeriods', 'tests', { label: 'count, order, month bounds, clamping', sources: [src(F.tShStatements, 6, 26, 'buildStatementPeriods')] }),
  rel(t(F.tShStatements), 'sh:statements#summarizeStatementPeriod', 'tests', {
    label: 'opening / credits / debits / closing; settled entries only',
    sources: [src(F.tShStatements, 28, 68, 'summarizeStatementPeriod')],
  }),

  // seed-plan.test.ts
  rel(t(F.tSeedPlan), 'sh:ledger#BANK_ORIGINATED_ORIGINS', 'tests', {
    label: 'every settled credit is bank-originated or a transfer leg',
    summary: 'The conservation invariant applied to the demo data; a tampered plan must be rejected.',
    sources: [src(F.tSeedPlan, 49, 71, 'every settled credit is bank-originated or a transfer leg')],
  }),
  rel(t(F.tSeedPlan), 'sh:money-movement#REVIEWABLE_MOVEMENT_OPS_TYPE', 'tests', {
    label: 'movement requests link PENDING ledger entries',
    summary: 'Each seeded reviewable movement is wired to a pending entry; other request types may not link one.',
    sources: [src(F.tSeedPlan, 242, 284, 'wires each reviewable money-movement request to a PENDING ledger entry')],
  }),
  rel(t(F.tSeedPlan), 'feat:balances', 'tests', {
    label: 'seeded transfers net to zero',
    sources: [src(F.tSeedPlan, 42, 47, 'internal transfers net to zero across accounts')],
  }),
];
