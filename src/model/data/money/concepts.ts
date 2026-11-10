import type { GlossaryTerm, StateMachine } from '../../types';
import { F, src } from './util';

/** The ledger-entry lifecycle and the vocabulary of money in Meridian. */

export const stateMachines: StateMachine[] = [
  {
    id: 'sm:ledger-entry-status',
    name: 'Ledger entry status',
    summary: 'How a ledger entry is born (pending or posted) and how its status — never its amount — changes afterwards.',
    subject: 'db:LedgerEntry',
    field: 'LedgerEntry.status',
    initial: 'new',
    states: [
      {
        id: 'new',
        label: '(inserted)',
        description:
          'Not a stored value: the moment a row is appended. Every entry is INSERTed with its first real status — there is no draft state — and from then on only `status` and `postedAt` are ever updated.',
      },
      {
        id: 'pending',
        label: 'pending',
        description:
          'Known but not settled. A pending CREDIT is tracked as "pending in" and is not spendable; a pending DEBIT is subtracted from the available balance at once. Does not affect the current balance or the settled total.',
      },
      {
        id: 'posted',
        label: 'posted',
        description: 'Settled. Counts in both the current and the available balance and in the system’s settled total. `postedAt` is set.',
      },
      {
        id: 'held',
        label: 'held',
        description:
          'An authorization hold: reduces the available balance only. At the pinned commit only seed data creates held entries, and no code path moves an entry into or out of this status.',
      },
      {
        id: 'disputed',
        label: 'disputed',
        description: 'A posted entry the customer has disputed. Treated exactly like posted for balances until an operator upholds or denies the dispute.',
      },
      { id: 'failed', label: 'failed', description: 'The movement never happened (an operator rejected it). No balance effect; a reserved outbound amount is released.', terminal: true },
      { id: 'reversed', label: 'reversed', description: 'A settled entry that was undone. No balance effect. The row and its amount remain as history.', terminal: true },
    ],
    transitions: [
      {
        from: 'new',
        to: 'posted',
        label: 'internal transfer (both legs)',
        by: 'be:money/movements#createTransfer',
        description: 'A transfer inserts its debit and its credit already `posted`, with `postedAt` = the simulated now. There is no pending phase and no operator review.',
        source: src(F.movements, 189, 213, "status: 'posted'"),
      },
      {
        from: 'new',
        to: 'pending',
        label: 'external movement queued',
        by: 'be:money/movements#createExternalMovement',
        description: 'A deposit, ACH, wire or bill payment is inserted `pending` with `postedAt: null`, linked from a pending operations request.',
        source: src(F.movements, 315, 328, "status: 'pending'"),
      },
      {
        from: 'new',
        to: 'posted',
        label: 'bank-originated postings',
        by: 'be:ops/onboarding#provisionApprovedOnboarding',
        description:
          'Other services also insert entries directly as `posted`: the opening deposit when an onboarding application is approved (origin `deposit`, shown here), admin opening adjustments (origin `adjustment`), interest accrual (origin `interest`) and the loan / CD transfer pairs in the lending service (origin `transfer`).',
        source: src('apps/backend/src/ops/onboarding.ts', 303, 317, "status: 'posted'"),
        confidence: 'simplified',
      },
      {
        from: 'new',
        to: 'held',
        label: 'seed data only',
        description: 'The demo seed plan contains one held entry (a rental-car hold) and a few pending and disputed ones, written as-is by the seed writer. No request handler creates a held entry.',
        source: src(F.seedPlan, 455, 457, "'held'"),
        confidence: 'simplified',
      },
      {
        from: 'pending',
        to: 'posted',
        label: 'operator approves',
        by: 'be:money/movements#postApprovedMovement',
        description:
          'Inside the operator-action transaction: `updateMany` on the request’s linked entry ids WHERE status = pending → `posted`, `postedAt` = simulated now. Reached through `applyOperatorAction` with action `approve`.',
        source: src(F.movements, 448, 451, "data: { status: 'posted', postedAt: now }"),
      },
      {
        from: 'pending',
        to: 'failed',
        label: 'operator rejects',
        by: 'be:money/movements#failMovement',
        description: 'Inside the operator-action transaction: `updateMany` on the linked ids WHERE status = pending → `failed`. Reached through `applyOperatorAction` with action `reject`. Hold and request-info leave the entry pending.',
        source: src(F.movements, 490, 493, "data: { status: 'failed' }"),
      },
      {
        from: 'posted',
        to: 'reversed',
        label: 'operator reverses a movement',
        by: 'be:money/movements#reverseMovement',
        description: 'Through the shared primitive `reverseLedgerEntries` (WHERE status IN posted, disputed). Requires a reason; writes a `movement_reversed` audit row.',
        source: src(F.movements, 397, 404, "data: { status: 'reversed' }"),
      },
      {
        from: 'posted',
        to: 'reversed',
        label: 'fraud confirmed',
        by: 'be:risk/fraud#confirmFraud',
        description: 'An operator confirms a fraud alert: the linked charge is reversed with the same primitive (and the card is frozen).',
        source: src(F.fraud, 153, 164, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])'),
      },
      {
        from: 'posted',
        to: 'disputed',
        label: 'customer disputes a charge',
        by: 'be:risk/disputes#createDispute',
        description: 'Only a `posted` entry can be disputed, and never a `transfer` leg (reversing one leg would break net-to-zero). Balances do not change at this point.',
        source: src(F.disputes, 106, 108, "data: { status: 'disputed' }"),
      },
      {
        from: 'disputed',
        to: 'reversed',
        label: 'dispute upheld',
        by: 'be:risk/disputes#upholdDispute',
        description: 'An operator approves the dispute: the entry is reversed with `reverseLedgerEntries`, which refunds the customer by removing the charge’s effect.',
        source: src(F.disputes, 164, 177, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])'),
      },
      {
        from: 'disputed',
        to: 'posted',
        label: 'dispute denied',
        by: 'be:risk/disputes#denyDispute',
        description: 'An operator rejects the dispute: the entry returns to `posted` and the charge stands.',
        source: src(F.disputes, 212, 224, "data: { status: 'posted' }"),
      },
    ],
    sources: [
      src(F.shLedger, 20, 28, 'LEDGER_STATUSES', 'The six stored values'),
      src(F.movements, 28, 46, 'always by appending ledger entries and never by editing a balance', 'The discipline'),
    ],
  },
];

export const glossary: GlossaryTerm[] = [
  {
    term: 'Minor units',
    definition:
      'The smallest unit of the currency — cents. Meridian stores and transmits every amount as an integer number of minor units (`amountMinor: 4405` is $44.05) so no floating-point rounding can occur. Dollars appear only when a form converts typed input (`toMinor`) and when the UI formats a value (`formatMinor`).',
    related: ['sh:money', 'sh:money#Minor', 'sh:money#toMinor', 'sh:money#formatMinor'],
    aliases: ['cents', 'amountMinor', 'integer money'],
  },
  {
    term: 'Ledger entry',
    definition:
      'One row of the append-only `LedgerEntry` table: an account, a positive amount, a direction, a status, an origin, a description and timestamps. It is the only place money is recorded. What customers call a "transaction" is a ledger entry shown in a list.',
    related: ['db:LedgerEntry', 'sh:ledger', 'sh:transactions#TransactionDTO'],
    aliases: ['transaction', 'entry', 'posting'],
  },
  {
    term: 'Direction (credit / debit)',
    definition: 'Whether an entry adds value to the account (credit) or removes it (debit). The amount is always positive; the direction supplies the sign.',
    related: ['sh:ledger#LEDGER_DIRECTIONS', 'sh:transactions#signedMinor'],
    aliases: ['credit', 'debit'],
  },
  {
    term: 'Status (ledger)',
    definition:
      'The state of a ledger entry — pending, posted, held, failed, reversed or disputed. The status alone decides whether the entry counts toward the current balance, the available balance, both or neither. Money "moves" by an entry being inserted or by its status changing.',
    related: ['sh:ledger#LEDGER_STATUSES', 'sh:ledger#deriveBalances', 'db:LedgerEntry'],
    aliases: ['ledger status'],
  },
  {
    term: 'Origin',
    definition:
      'Why an entry exists: seed, interest, fee, adjustment, transfer, payment, deposit or card. Used to label transactions for customers and to check that money is conserved.',
    related: ['sh:ledger#LEDGER_ORIGINS', 'sh:money-movement#movementLedgerOrigin', 'sh:transactions#TRANSACTION_ORIGIN_LABELS'],
    aliases: ['ledger origin', 'category'],
  },
  {
    term: 'Bank-originated',
    definition:
      'An origin through which the bank itself puts value into (or takes it out of) the system: seed, interest, fee, adjustment and deposit. A settled credit must be bank-originated or be one leg of a transfer; otherwise money would have appeared from nowhere.',
    related: ['sh:ledger#BANK_ORIGINATED_ORIGINS', 'test:apps/backend/src/seed-plan.test.ts'],
  },
  {
    term: 'Current balance',
    definition: 'The settled balance of an account: the signed sum of its posted and disputed entries. Shown as "Current". Pending items and holds do not change it.',
    related: ['sh:ledger#DerivedBalances', 'sh:ledger#deriveBalances', 'feat:balances'],
    aliases: ['ledger balance', 'settled balance', 'currentMinor'],
  },
  {
    term: 'Available balance',
    definition:
      'What the customer can spend right now: the current balance minus pending outgoing entries and minus holds. Pending incoming money is NOT included. Shown as "Available", and it is the figure every funds check uses.',
    related: ['sh:ledger#DerivedBalances', 'sh:ledger#deriveBalances', 'be:money/movements#availableMinor', 'feat:balances'],
    aliases: ['spendable balance', 'availableMinor'],
  },
  {
    term: 'Derived balance',
    definition:
      'A balance that is computed from ledger entries every time it is needed instead of being stored. Meridian has no balance column: `deriveBalances` recomputes current and available on every account read and every funds check, so a balance can never drift from the transactions behind it.',
    related: ['sh:ledger#deriveBalances', 'feat:balances', 'ep:GET /api/accounts'],
    aliases: ['computed balance', 'no stored balance'],
  },
  {
    term: 'Pending',
    definition:
      'An entry that is known but has not settled — for example a bill payment or a check deposit waiting for an operator. A pending debit is set aside from the available balance immediately; a pending credit is shown but cannot be spent. Either way the current balance does not move until the entry posts.',
    related: ['sh:ledger#LEDGER_STATUSES', 'be:money/movements#createExternalMovement', 'sh:transactions#groupForStatus'],
  },
  {
    term: 'Hold',
    definition:
      'An entry with status `held`: funds reserved by an authorization (the seed data has a rental-car hold). It reduces the available balance only. In the customer UI holds are grouped with pending items and shown as "On hold".',
    related: ['sh:ledger#LEDGER_STATUSES', 'sh:ledger#deriveBalances'],
    aliases: ['held', 'authorization hold'],
  },
  {
    term: 'Posted',
    definition: 'Settled and final. A posted entry counts in both balances and in the system’s settled total. Internal transfers are inserted posted; external movements become posted when an operator approves them.',
    related: ['sh:ledger#LEDGER_STATUSES', 'be:money/movements#postApprovedMovement', 'be:money/movements#createTransfer'],
    aliases: ['settled'],
  },
  {
    term: 'Reversed',
    definition:
      'A settled entry that has been undone by changing its status to `reversed`. Its amount stays in the table as history but stops counting toward any balance. Used for an operator’s movement reversal, an upheld dispute and confirmed fraud — there are no offsetting "refund" entries.',
    related: ['be:money/movements#reverseLedgerEntries', 'be:money/movements#reverseMovement'],
    aliases: ['reversal', 'refund'],
  },
  {
    term: 'Disputed',
    definition: 'A posted entry the customer has challenged. It keeps counting as posted while an operator decides: upholding the dispute reverses it, denying the dispute returns it to posted.',
    related: ['sh:ledger#LEDGER_STATUSES', 'feat:disputes'],
  },
  {
    term: 'Money conservation (settled total)',
    definition:
      'The rule that customer activity cannot create or destroy money. The settled total — the signed sum of all posted and disputed entries across every account — is unchanged by an internal transfer, rises only when a bank-originated credit posts, and falls only when a debit posts. `settledTotalMinor` computes it; the seed-plan and money tests assert it.',
    related: ['sh:ledger#settledTotalMinor', 'sh:ledger#BANK_ORIGINATED_ORIGINS', 'test:apps/backend/src/routes/money.test.ts', 'test:apps/backend/src/seed-plan.test.ts'],
    aliases: ['settled total', 'money supply', 'conservation invariant'],
  },
  {
    term: 'Net to zero',
    definition: 'An internal transfer writes a debit and an equal credit at the same instant, so the two legs cancel out across the system. The source balance falls and the destination rises by the same amount; the total is unchanged.',
    related: ['be:money/movements#createTransfer', 'sh:ledger#settledTotalMinor'],
    aliases: ['double entry', 'both legs'],
  },
  {
    term: 'Internal transfer',
    definition: 'A movement between two accounts the same customer can move money on. It is immediate — both legs post in one database transaction — and needs no operator.',
    related: ['feat:transfers', 'ep:POST /api/transfers', 'be:money/movements#createTransfer', 'sh:money-movement#validateTransfer'],
    aliases: ['transfer'],
  },
  {
    term: 'External movement',
    definition:
      'Money entering or leaving the bank: a mobile check deposit, an external ACH, a wire or a bill payment. No real network is contacted; the movement is written as a pending entry and an operator plays the outside world by approving or rejecting it.',
    related: ['feat:external-movements', 'ep:POST /api/movements', 'be:money/movements#createExternalMovement', 'sh:money-movement#MOVEMENT_KINDS'],
    aliases: ['deposit', 'ACH', 'wire', 'bill pay'],
  },
  {
    term: 'Reviewable movement',
    definition: 'Any movement kind that must be approved by an operator before it posts — every kind except the internal transfer. It raises an operations request of type deposit, ach, wire or bill_pay.',
    related: ['sh:money-movement#ReviewableMovementKind', 'sh:money-movement#REVIEWABLE_MOVEMENT_OPS_TYPE', 'feat:ops-review'],
  },
  {
    term: 'Reference code',
    definition: 'The short code given to a customer for an external movement, e.g. MOV-7F3A9C: the prefix `MOV-` and six random hex characters. It is for display; the system links the movement by ids, not by this code.',
    related: ['be:money/movements#generateMovementReference', 'sh:money-movement#MOVEMENT_REFERENCE_PREFIX', 'sh:money-movement#ExternalMovementResponse'],
    aliases: ['movement reference', 'MOV-'],
  },
  {
    term: 'Soft link (ledgerEntryIds)',
    definition:
      'How an operations request points at the ledger entries it controls: an array of ids inside the request’s JSON `payload`, not a foreign key. Approval, rejection and reversal look the entries up through it.',
    related: ['sh:money-movement#MovementPayload', 'be:money/movements#movementPayloadOf', 'db:OperationsRequest'],
    aliases: ['movement payload'],
  },
];
