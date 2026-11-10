import type { Entity, Relation } from '../../types';
import { F, rel, src } from './util';

/**
 * The backend half of the money slice: the money-movement domain service
 * (`apps/backend/src/money/movements.ts`) and the two customer route plugins
 * that front it (`routes/money.ts`, `routes/accounts.ts`). Endpoint contracts
 * live in `contracts.ts`.
 */

// ---------------------------------------------------------------------------
// apps/backend/src/money/movements.ts
// ---------------------------------------------------------------------------

const movementEntities: Entity[] = [
  {
    id: 'be:money/movements',
    kind: 'module',
    name: 'movements.ts',
    parent: 'be.money',
    summary: 'The one backend module where money moves — always by appending or re-statusing ledger entries, never by editing a balance.',
    description:
      'Every money-moving operation in Meridian ends up in this file:\n\n• `createTransfer` — IMMEDIATE. Posts a `transfer` debit and a matching `transfer` credit in one database transaction, so the pair nets to zero.\n• `createExternalMovement` — REVIEWABLE. Writes one PENDING entry (a `deposit` credit for money in, a `payment` debit for money out) plus a linked `OperationsRequest`, so the movement waits in the operations queue. A pending debit reserves available funds at once.\n• `postApprovedMovement` / `failMovement` — called from the operator approve / reject path (`applyOperatorAction`): pending → posted, or pending → failed.\n• `reverseMovement` and the shared primitive `reverseLedgerEntries` — flip settled entries to `reversed` (also used by disputes and fraud).\n\nThe file also owns the access-and-funds gate (`requireMovableAccount`, `availableMinor`), the typed `MovementError`, the reference-code generator and `recordSimEvent`. The customer routes, the scheduler (scheduled transfers and bill payments) and the operations workflow all call in here rather than writing ledger rows themselves.',
    audience: {
      executive: 'The engine room for moving money. Transfers happen instantly; anything involving the outside world waits for a member of staff to approve it.',
      'end-user': 'What actually happens when you transfer money, deposit a check or pay a bill.',
      systems: 'A domain service with no HTTP knowledge. Multi-row writes run inside `prisma.$transaction`; real-time publishing is left to the route that called it.',
      dba: 'Writes LedgerEntry (insert, and status updates via updateMany guarded by the current status), OperationsRequest, AuditLog and SimulatedEvent. Never updates a balance — there is none.',
    },
    tags: ['money', 'ledger', 'data', 'audit', 'operations'],
    aliases: ['money movement service', 'movements', 'ledger writes'],
    tech: ['TypeScript', 'Prisma'],
    sources: [src(F.movements, 28, 46, 'Money-movement domain service', 'Module header: the four operations and the discipline')],
  },
  {
    id: 'be:money/movements#MovementErrorCode',
    kind: 'type',
    name: 'MovementErrorCode',
    parent: 'be:money/movements',
    summary: 'The eight machine-readable reasons a money movement can be refused.',
    description: 'The service throws `MovementError` with one of these codes and knows nothing about HTTP. The customer routes translate a code to a status with `movementHttpStatus`; the operator reversal route has its own smaller mapping.',
    values: [
      { value: 'not_found', meaning: 'The account (or, for a reversal, the operations request) does not exist. → 404' },
      { value: 'forbidden', meaning: 'The caller is not owner, joint or authorized on the account. → 403' },
      { value: 'insufficient_funds', meaning: 'The amount exceeds the available balance. → 400' },
      { value: 'inactive_account', meaning: 'The account status is not `active`. → 400' },
      { value: 'invalid', meaning: 'Used by the scheduler for a schedule that can no longer fire (e.g. the biller is missing). → 400' },
      { value: 'not_a_movement', meaning: 'Reversal requested for a request that has no linked ledger entries. → 400' },
      { value: 'nothing_to_reverse', meaning: 'Reversal found no posted or disputed entry to flip. → 409' },
      { value: 'limit_reached', meaning: 'The caller already has 25 movements awaiting operator review. → 409' },
    ],
    tags: ['money', 'validation'],
    aliases: ['insufficient_funds', 'limit_reached', 'error codes'],
    sources: [src(F.movements, 48, 56, 'export type MovementErrorCode'), src(F.routesMoney, 32, 44, 'function movementHttpStatus', 'Code → HTTP status')],
  },
  {
    id: 'be:money/movements#MovementError',
    kind: 'class',
    name: 'MovementError',
    parent: 'be:money/movements',
    summary: 'The typed error the money service throws; it carries a `MovementErrorCode` and a customer-readable message.',
    description: 'Routes catch it with `instanceof MovementError` and send `{ error: err.message, code: err.code }`. Anything that is not a `MovementError` is re-thrown and becomes a 500.',
    signature: 'export class MovementError extends Error { readonly code: MovementErrorCode; constructor(code: MovementErrorCode, message: string) }',
    example: { code: 'insufficient_funds', message: 'That transfer exceeds the available balance.' },
    tags: ['money', 'validation'],
    sources: [src(F.movements, 58, 65, 'export class MovementError')],
  },
  {
    id: 'be:money/movements#generateMovementReference',
    kind: 'function',
    name: 'generateMovementReference',
    parent: 'be:money/movements',
    summary: 'Makes the short reference a customer is given for an external movement: `MOV-` plus six random hex characters.',
    description: 'Three random bytes from `node:crypto`, hex-encoded and upper-cased. The reference is stored in the request’s `MovementPayload`, in the intake audit row’s metadata and in the simulated "received" event, and returned in the 201 response. Uniqueness is not enforced — it is a display code, not a key.',
    signature: 'export function generateMovementReference(): string',
    example: 'MOV-7F3A9C',
    tags: ['money'],
    aliases: ['reference code', 'MOV-'],
    sources: [src(F.movements, 69, 72, 'export function generateMovementReference')],
  },
  {
    id: 'be:money/movements#availableMinor',
    kind: 'function',
    name: 'availableMinor',
    parent: 'be:money/movements',
    summary: 'Private helper: the available balance of an account that `requireMovableAccount` has just loaded, via the shared `deriveBalances`.',
    description:
      'Maps the loaded ledger rows to `LedgerEntryLike` and returns `deriveBalances(...).availableMinor`. Because it is the AVAILABLE figure, pending outbound movements and holds already count against the customer, and money still pending inward does not help. Both funds checks compare this number with the requested amount.',
    signature: 'function availableMinor(account: AccountForMovement): number',
    tags: ['money', 'ledger', 'validation'],
    aliases: ['funds check', 'available funds'],
    sources: [src(F.movements, 81, 89, 'function availableMinor')],
  },
  {
    id: 'be:money/movements#summarize',
    kind: 'function',
    name: 'summarize',
    parent: 'be:money/movements',
    summary: 'Private helper: re-reads one account with all its ledger entries and returns an `AccountSummary` with freshly derived balances.',
    description: 'Called twice at the end of `createTransfer`, after the transaction has committed, to build the `accounts` array of the response — so the numbers the customer sees are derived from what is really in the ledger, not predicted.',
    signature: 'async function summarize(db: DbClient, accountId: string, relationship: string): Promise<AccountSummary>',
    tags: ['money', 'ledger', 'data'],
    sources: [src(F.movements, 91, 112, 'async function summarize')],
  },
  {
    id: 'be:money/movements#requireMovableAccount',
    kind: 'function',
    name: 'requireMovableAccount',
    parent: 'be:money/movements',
    summary: 'Private gate: confirms the user may MOVE money on an account — it exists, they are owner, joint or authorized on it, and it is active.',
    description:
      'Three checks, in this order:\n\n1. Load the account (id, name, status and the amount/direction/status of every ledger entry). Missing → `MovementError("not_found")` → 404.\n2. `getAccountRelationship(prisma, userId, accountId)` — the `AccountAccess` grant, or `owner` if `Account.userId` matches. No relationship, or one outside `MOVABLE_RELATIONSHIPS = {owner, joint, authorized}` (i.e. `viewer`) → `MovementError("forbidden")` → 403.\n3. `account.status !== "active"` → `MovementError("inactive_account")` → 400.\n\nOn success it returns the relationship and the loaded account, whose ledger entries feed the funds check. `createTransfer` runs it for BOTH accounts; `createExternalMovement` runs it for the one account. Because the existence check comes first, a caller can tell "no such account" (404) from "not yours" (403).',
    audience: {
      executive: 'The check that you can only move money on accounts you are entitled to use.',
      dba: 'Reads Account by primary key with its LedgerEntry rows (three columns), then AccountAccess by the unique (userId, accountId) pair. Uses the plain client, outside the write transaction.',
    },
    signature: 'async function requireMovableAccount(userId: string, accountId: string): Promise<{ relationship: string; account: AccountForMovement }>',
    tags: ['security', 'rbac', 'money', 'validation'],
    aliases: ['account access check', 'ownership check', 'MOVABLE_RELATIONSHIPS'],
    sources: [
      src(F.movements, 114, 132, 'async function requireMovableAccount'),
      src(F.movements, 67, 67, 'MOVABLE_RELATIONSHIPS', 'owner, joint, authorized — not viewer'),
      src(F.tMoney, 121, 130, 'forbids transferring from an account the caller cannot access (403)', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#recordSimEvent',
    kind: 'function',
    name: 'recordSimEvent',
    parent: 'be:money/movements',
    summary: 'Writes one clearly-labelled SIMULATED event row (for example "Bill payment received — under review") and returns its DTO.',
    description:
      'Inserts a `SimulatedEvent` with the given channel, kind, status and summary, direction defaulting to `outbound`, detail defaulting to "SIMULATION — no real money network or provider was contacted.", and `createdAt` set to the simulated time passed in. Takes a `DbClient`, so it joins the caller’s transaction. Exported: disputes, fraud and the scheduler reuse it.',
    signature:
      "export async function recordSimEvent(db: DbClient, input: { channel: SimulatedEventDTO['channel']; kind: string; status: SimulatedEventDTO['status']; summary: string; detail?: string; direction?: SimulatedEventDTO['direction']; requestId: string | null }, now: Date): Promise<SimulatedEventDTO>",
    tags: ['operations', 'integration', 'data'],
    aliases: ['simulated event'],
    sources: [src(F.movements, 134, 161, 'export async function recordSimEvent')],
  },
  {
    id: 'be:money/movements#TransferResult',
    kind: 'type',
    name: 'TransferResult',
    parent: 'be:money/movements',
    summary: 'What `createTransfer` returns: the amount moved and both accounts with re-derived balances.',
    fields: [
      { name: 'amountMinor', type: 'number', required: true, typeRef: 'sh:money#Minor' },
      { name: 'accounts', type: 'AccountSummary[]', required: true, typeRef: 'sh:auth#AccountSummary', description: 'Source account first, destination second.' },
    ],
    tags: ['money', 'data'],
    detail: 5,
    sources: [src(F.movements, 165, 168, 'export interface TransferResult')],
  },
  {
    id: 'be:money/movements#createTransfer',
    kind: 'function',
    name: 'createTransfer',
    parent: 'be:money/movements',
    detail: 3,
    summary: 'Moves money between two accounts the caller can use by posting a debit on one and an equal credit on the other, atomically.',
    description:
      'Steps:\n\n1. `requireMovableAccount` for the source, then for the destination (exists → relationship is owner/joint/authorized → status active).\n2. Funds check: `availableMinor(from.account) < input.amountMinor` → `MovementError("insufficient_funds", "That transfer exceeds the available balance.")`.\n3. One `prisma.$transaction`: insert a `debit` on the source (`status: "posted"`, `origin: "transfer"`, description `Transfer to <destination name>` plus ` — <memo>` if there is one); insert the matching `credit` on the destination (`Transfer from <source name>`); write an `AuditLog` row with action `money_transfer`. Both entries carry the same `postedAt`/`createdAt` — the simulated time the route passed in.\n4. After the commit, `summarize` each account and return them with the amount.\n\nThe two legs are equal and opposite, so the system-wide settled total does not change — a transfer creates nothing. The access and funds checks read with the plain client BEFORE the transaction opens; only the three writes are inside it.\n\nCallers: `POST /api/transfers`, and the scheduler when a scheduled internal transfer falls due (passing the occurrence time as `now`).',
    audience: {
      executive: 'An instant transfer between a customer’s accounts: one account goes down, the other goes up by the same amount, both recorded together or not at all.',
      'end-user': 'Your transfer happens straight away; both accounts update together.',
      dba: 'One interactive transaction: INSERT LedgerEntry (debit, posted, transfer), INSERT LedgerEntry (credit, posted, transfer), INSERT AuditLog (money_transfer). No UPDATE of any kind. The preceding reads and the funds check are not inside it.',
    },
    signature: 'export async function createTransfer(user: SessionUser, input: NormalizedTransfer, now: Date = new Date()): Promise<TransferResult>',
    tags: ['money', 'ledger', 'audit', 'data'],
    aliases: ['internal transfer', 'transfer money', 'net to zero'],
    sources: [
      src(F.movements, 170, 237, 'export async function createTransfer'),
      src(F.movements, 183, 185, 'insufficient_funds', 'The available-funds check'),
      src(F.movements, 189, 228, 'prisma.$transaction', 'Debit leg, credit leg and audit row in one transaction'),
      src(F.tMoney, 74, 105, 'posts BOTH legs, nets to zero', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#describeMovement',
    kind: 'function',
    name: 'describeMovement',
    parent: 'be:money/movements',
    summary: 'Private helper: builds the three pieces of text stored for an external movement — the queue summary, the ledger description and the request detail.',
    description:
      'From the kind label, the formatted amount and the counterparty it produces: the operations-request `summary` (`Bill payment — Metro Water Services ($44.05)`), the `detail` paragraph operators read, and the ledger `description` the customer sees — `Mobile check deposit`, `ACH deposit from …` / `ACH payment to …`, `Wire transfer to …` or `Bill payment — …`.',
    signature: 'function describeMovement(input: NormalizedExternalMovement): { summary: string; description: string; detail: string }',
    tags: ['money', 'operations'],
    detail: 5,
    sources: [src(F.movements, 241, 265, 'function describeMovement')],
  },
  {
    id: 'be:money/movements#CreatedMovement',
    kind: 'type',
    name: 'CreatedMovement',
    parent: 'be:money/movements',
    summary: 'What `createExternalMovement` returns: the reference, the new operations request and the simulated events to publish.',
    fields: [
      { name: 'reference', type: 'string', required: true, description: 'e.g. MOV-7F3A9C' },
      { name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, typeRef: 'sh:operations#SimulatedEventDTO' },
    ],
    tags: ['money', 'operations', 'data'],
    detail: 5,
    sources: [src(F.movements, 267, 271, 'export interface CreatedMovement')],
  },
  {
    id: 'be:money/movements#createExternalMovement',
    kind: 'function',
    name: 'createExternalMovement',
    parent: 'be:money/movements',
    detail: 3,
    summary: 'Queues a deposit, ACH, wire or bill payment for operator review: one PENDING ledger entry plus a linked operations request.',
    description:
      'Steps:\n\n1. `requireMovableAccount` for the account.\n2. Outbound only — funds check: `availableMinor(account) < amountMinor` → `insufficient_funds` ("That movement exceeds the available balance."). Inbound movements skip it.\n3. Cap (all modes): count this user’s operations requests with `status: "pending"`, `subjectEmail` = the user’s email and a movement type (`ach`, `wire`, `deposit`, `bill_pay`). If the count is already `RESOURCE_CAPS.pendingMovementsPerUser` (25) → `limit_reached` → 409.\n4. Generate the reference, the texts (`describeMovement`) and the ledger origin (`movementLedgerOrigin`: inbound → `deposit`, outbound → `payment`).\n5. One `prisma.$transaction` writing four rows: (a) the `LedgerEntry` with `status: "pending"`, `postedAt: null`; (b) the `OperationsRequest` — type from `movementOpsType`, status `pending`, priority `high` for a wire and `normal` otherwise, `subjectName`/`subjectEmail` from the user, and the `MovementPayload` (including `ledgerEntryIds: [entry.id]`) serialized into `payload`; (c) an `AuditLog` row, action `ops_request_created`; (d) a `SimulatedEvent` "received — under review" via `recordSimEvent`.\n6. Return the reference, the request DTO and the event.\n\nNothing has settled: a pending credit is not spendable, and a pending debit lowers Available but not Current. The cap counts only requests still `pending`; one an operator has put on hold or asked for information on no longer counts, although its ledger entry is still pending.\n\nCallers: `POST /api/movements` (which then publishes the request and event to operators), and the scheduler when a scheduled bill payment falls due.',
    audience: {
      executive: 'Anything that involves the outside world — a check, a wire, a bill — is recorded as "pending" and handed to bank staff. No money moves until they approve.',
      'end-user': 'Your deposit or payment is submitted and shows as Pending. A payment sets the money aside straight away; a deposit cannot be spent until it is approved.',
      dba: 'One COUNT on OperationsRequest (status, subjectEmail, type IN …), then one transaction with four INSERTs: LedgerEntry (pending), OperationsRequest (payload JSON holds the ledger entry id), AuditLog, SimulatedEvent (FK requestId).',
    },
    signature: 'export async function createExternalMovement(user: SessionUser, input: NormalizedExternalMovement, now: Date = new Date()): Promise<CreatedMovement>',
    tags: ['money', 'ledger', 'operations', 'audit', 'data'],
    aliases: ['external movement', 'reviewable movement', 'deposit', 'bill pay', 'wire', 'ACH'],
    sources: [
      src(F.movements, 273, 385, 'export async function createExternalMovement'),
      src(F.movements, 287, 291, 'insufficient_funds', 'Funds check for outbound movements only'),
      src(F.movements, 293, 308, 'RESOURCE_CAPS.pendingMovementsPerUser', 'The pending-movement cap'),
      src(F.movements, 314, 382, 'prisma.$transaction', 'Pending entry + request + audit + simulated event'),
      src(F.tMoney, 147, 187, 'queues a mobile check deposit as a PENDING credit', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#reverseLedgerEntries',
    kind: 'function',
    name: 'reverseLedgerEntries',
    parent: 'be:money/movements',
    summary: 'Flips a set of settled ledger entries (posted or disputed) to `reversed`, removing their effect on balances, and returns how many changed.',
    description:
      'A single `updateMany` whose WHERE clause is `id IN (…) AND status IN ("posted", "disputed")`, so an entry that is pending, failed or already reversed is left alone and not counted. It is deliberately "pure ledger mechanics": the caller writes the audit row and any simulated event. Three callers share it — `reverseMovement` (a reversed money movement), `upholdDispute` (an upheld dispute) and `confirmFraud` (confirmed fraud).',
    audience: {
      dba: 'UPDATE LedgerEntry SET status = "reversed" WHERE id IN (…) AND status IN ("posted","disputed"). Rows are never deleted and amounts are never changed; the reversal is a status change.',
    },
    signature: 'export async function reverseLedgerEntries(tx: DbClient, entryIds: string[]): Promise<number>',
    tags: ['ledger', 'money', 'risk', 'data'],
    aliases: ['reversal', 'reverse entry'],
    sources: [src(F.movements, 387, 404, 'export async function reverseLedgerEntries')],
  },
  {
    id: 'be:money/movements#movementPayloadOf',
    kind: 'function',
    name: 'movementPayloadOf',
    parent: 'be:money/movements',
    summary: 'Returns the `MovementPayload` of an operations request, or null if the request is not a money movement with linked ledger entries.',
    description:
      'Null unless the request type is `deposit`, `ach`, `wire` or `bill_pay`, its `payload` parses as JSON, `asMovementPayload` accepts it, and `ledgerEntryIds` is not empty. This is the test the operations workflow uses to decide whether approving or rejecting a request has a ledger effect — a bare "deposit" queue item with no payload is approved as plain workflow and posts nothing.',
    signature: "export function movementPayloadOf(row: Pick<OperationsRequest, 'type' | 'payload'>): MovementPayload | null",
    tags: ['money', 'operations'],
    sources: [
      src(F.movements, 406, 426, 'export function movementPayloadOf'),
      src(F.tMoney, 318, 325, 'approving a deposit request with NO movement payload posts nothing', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#MovementLedgerResult',
    kind: 'type',
    name: 'MovementLedgerResult',
    parent: 'be:money/movements',
    summary: 'What `postApprovedMovement` returns: the amount and kind that posted, and the simulated event to publish.',
    fields: [
      { name: 'amountMinor', type: 'number', required: true },
      { name: 'kind', type: "MovementPayload['kind']", required: true, typeRef: 'sh:money-movement#MovementKind' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, typeRef: 'sh:operations#SimulatedEventDTO' },
    ],
    tags: ['money', 'data'],
    detail: 5,
    sources: [src(F.movements, 428, 432, 'export interface MovementLedgerResult')],
  },
  {
    id: 'be:money/movements#postApprovedMovement',
    kind: 'function',
    name: 'postApprovedMovement',
    parent: 'be:money/movements',
    summary: 'Settles an approved movement: flips its linked PENDING ledger entries to `posted` and stamps `postedAt`.',
    description:
      'Runs inside the transaction `applyOperatorAction` opens for an approve. Reads the payload with `movementPayloadOf` (returns null for a non-movement, so nothing happens). Then `updateMany` on the linked ids WHERE `status = "pending"` → `status: "posted", postedAt: now`; an audit row with action `movement_posted` (metadata includes the payload and the number of rows posted); and a simulated event "… posted — $amount (simulated)".\n\nThis is the moment money actually moves: a posted deposit credit raises both balances and the system’s settled total; a posted payment debit lowers Current (Available already fell when it was queued) and the settled total.',
    audience: {
      executive: 'What staff approval does: the pending item becomes final and the customer’s balance changes.',
      dba: 'UPDATE LedgerEntry SET status = "posted", postedAt = <sim now> WHERE id IN (payload.ledgerEntryIds) AND status = "pending"; plus INSERT AuditLog and INSERT SimulatedEvent — all in the operator-action transaction.',
    },
    signature: "export async function postApprovedMovement(tx: DbClient, request: Pick<OperationsRequest, 'id' | 'type' | 'payload'>, actor: SessionUser, now: Date): Promise<MovementLedgerResult | null>",
    tags: ['money', 'ledger', 'operations', 'audit'],
    aliases: ['post movement', 'approve movement', 'pending to posted'],
    sources: [
      src(F.movements, 434, 476, 'export async function postApprovedMovement'),
      src(F.opsRequests, 328, 346, 'postApprovedMovement(tx, existing, input.actor, now)', 'Called from the operator approve path'),
      src(F.tMoney, 224, 257, 'pending → posted, available updates (Q-01)', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#failMovement',
    kind: 'function',
    name: 'failMovement',
    parent: 'be:money/movements',
    summary: 'Fails a rejected movement: flips its linked PENDING ledger entries to `failed`, releasing any reserved funds.',
    description:
      'Runs inside the transaction `applyOperatorAction` opens for a reject. `updateMany` on the linked ids WHERE `status = "pending"` → `status: "failed"`, then a simulated event "… failed — $amount (simulated)". A failed entry has no balance effect, so the Available balance an outbound movement had reserved comes back by itself. Unlike `postApprovedMovement` it writes no audit row of its own — the operator action’s `ops_reject` audit row covers it.',
    signature: "export async function failMovement(tx: DbClient, request: Pick<OperationsRequest, 'id' | 'type' | 'payload'>, now: Date): Promise<SimulatedEventDTO | null>",
    tags: ['money', 'ledger', 'operations'],
    aliases: ['reject movement', 'pending to failed'],
    sources: [
      src(F.movements, 478, 506, 'export async function failMovement'),
      src(F.opsRequests, 348, 357, 'failMovement(tx, existing, now)', 'Called from the operator reject path'),
      src(F.tMoney, 279, 300, 'rejecting a movement marks the pending entry failed and restores reserved funds', 'Pinned by test'),
    ],
  },
  {
    id: 'be:money/movements#ReversedMovement',
    kind: 'type',
    name: 'ReversedMovement',
    parent: 'be:money/movements',
    summary: 'What `reverseMovement` returns: the updated operations request and the simulated events to publish.',
    fields: [
      { name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, typeRef: 'sh:operations#SimulatedEventDTO' },
    ],
    tags: ['money', 'data'],
    detail: 5,
    sources: [src(F.movements, 508, 511, 'export interface ReversedMovement')],
  },
  {
    id: 'be:money/movements#reverseMovement',
    kind: 'function',
    name: 'reverseMovement',
    parent: 'be:money/movements',
    summary: 'Reverses a settled money movement on an operator’s say-so: its posted entries become `reversed`, with a mandatory reason and an audit row.',
    description:
      'Loads the operations request (missing → `not_found`), reads its payload (`not_a_movement` if it has no linked entries), then in one transaction: `reverseLedgerEntries` on the linked ids (zero rows changed → `nothing_to_reverse`, which also rolls the transaction back); rewrite the request’s `payload` with `reversed: true`; write an audit row, action `movement_reversed`, whose `reason` is the operator’s text; record a simulated "… reversed" event. The request’s workflow status is not changed.\n\nCalled only by `POST /api/ops/movements/:requestId/reverse`, which requires a non-empty reason and publishes the result to operators.',
    signature: 'export async function reverseMovement(requestId: string, actor: SessionUser, reason: string, now: Date = new Date()): Promise<ReversedMovement>',
    tags: ['money', 'ledger', 'operations', 'audit'],
    aliases: ['reversal', 'reverse movement', 'posted to reversed'],
    sources: [
      src(F.movements, 513, 569, 'export async function reverseMovement'),
      src(F.routesOps, 195, 225, 'reverseMovement(', 'The operator endpoint that calls it'),
      src(F.tMoney, 345, 361, 'reverses a posted movement (posted → reversed)', 'Pinned by test'),
    ],
  },
];

// ---------------------------------------------------------------------------
// apps/backend/src/routes/money.ts and accounts.ts
// ---------------------------------------------------------------------------

const routeEntities: Entity[] = [
  {
    id: 'be:routes/money',
    kind: 'route-group',
    name: 'routes/money.ts',
    parent: 'be.http',
    summary: 'The two customer money endpoints: POST /api/transfers (immediate) and POST /api/movements (queued for operator review).',
    description:
      'A thin Fastify plugin (`moneyRoutes`). Both routes share the preHandler chain `[requireAuth, rateLimit("money")]`. Each handler coerces the JSON body field by field — a value of the wrong JavaScript type is replaced by `undefined`, and strings are cut to `MAX_FIELD = 500` characters — runs the shared validator, reads the simulated time, and delegates to the money service. A validation failure is answered by `invalid()` with 400 `invalid_request` and a `fields` map; a `MovementError` is translated by `handleMovementError`. The movements route additionally publishes the new request and its simulated event to the operators room.',
    tags: ['money', 'validation', 'security'],
    aliases: ['money routes', 'moneyRoutes', 'transfer endpoint', 'movement endpoint'],
    tech: ['Fastify'],
    sources: [
      src(F.routesMoney, 15, 28, 'Customer money-movement endpoints', 'File header'),
      src(F.routesMoney, 61, 64, 'export async function moneyRoutes', 'The plugin and its shared guards'),
      src(F.routesMoney, 30, 30, 'MAX_FIELD', 'String length cap applied before validation'),
    ],
  },
  {
    id: 'be:routes/money#movementHttpStatus',
    kind: 'function',
    name: 'movementHttpStatus',
    parent: 'be:routes/money',
    summary: 'Translates a `MovementErrorCode` into an HTTP status: 404, 403, 409 or 400.',
    description: '`not_found` → 404; `forbidden` → 403; `nothing_to_reverse` and `limit_reached` → 409; everything else (`insufficient_funds`, `inactive_account`, `invalid`, `not_a_movement`) → 400.',
    signature: 'function movementHttpStatus(code: MovementErrorCode): number',
    tags: ['money', 'validation'],
    aliases: ['error status mapping'],
    sources: [src(F.routesMoney, 32, 44, 'function movementHttpStatus')],
  },
  {
    id: 'be:routes/money#handleMovementError',
    kind: 'function',
    name: 'handleMovementError',
    parent: 'be:routes/money',
    summary: 'Turns a `MovementError` into a JSON error response `{ error, code }`; re-throws anything else.',
    signature: 'function handleMovementError(reply: FastifyReply, err: unknown): FastifyReply',
    example: { status: 400, body: { error: 'That transfer exceeds the available balance.', code: 'insufficient_funds' } },
    tags: ['money', 'validation'],
    detail: 5,
    sources: [src(F.routesMoney, 46, 53, 'function handleMovementError')],
  },
  {
    id: 'be:routes/accounts',
    kind: 'route-group',
    name: 'routes/accounts.ts',
    parent: 'be.http',
    summary: 'The four read-only account endpoints: list accounts, one account, its transactions and its statements — every one scoped to what the caller may see.',
    description:
      'A Fastify plugin (`accountRoutes`). All four routes run `requireAuth` and then delegate to the access-control service in `auth/access.ts`, which decides visibility from `AccountAccess` grants (with `Account.userId` as a fallback) and derives balances from the ledger. The single-account routes share one convention: the service reports `exists` and `summary` separately, so the route can answer 404 when there is no such account and 403 when it exists but the caller has no relationship to it. Nothing here writes to the database.',
    tags: ['money', 'ledger', 'rbac', 'data'],
    aliases: ['account routes', 'accountRoutes', 'balances endpoint'],
    tech: ['Fastify'],
    sources: [src(F.routesAccounts, 38, 44, 'Customer account endpoints', 'File header and plugin')],
  },
  {
    id: 'be:routes/accounts#parseTransactionQuery',
    kind: 'function',
    name: 'parseTransactionQuery',
    parent: 'be:routes/accounts',
    summary: 'Turns the raw `?q=&group=&origin=` query string into a safe `TransactionQuery`, dropping anything it does not recognise.',
    description:
      '`q` is trimmed and cut to `SEARCH_QUERY_MAX_LENGTH` (100) characters — the search runs in memory over the account’s rows, so the needle is bounded. `group` is kept only if it is `pending`, `posted` or `other`; `origin` only if it is one of `LEDGER_ORIGINS`. Unknown values are ignored rather than rejected, so a bad filter returns the unfiltered list instead of an error.',
    signature: 'function parseTransactionQuery(raw: { q?: string; group?: string; origin?: string }): TransactionQuery',
    tags: ['validation', 'data'],
    sources: [
      src(F.routesAccounts, 22, 36, 'function parseTransactionQuery'),
      src(F.tTransactions, 108, 114, 'ignores an unknown filter value rather than erroring', 'Pinned by test'),
    ],
  },
];

// ---------------------------------------------------------------------------
// Endpoint entities (contracts with the same ids are in contracts.ts)
// ---------------------------------------------------------------------------

const endpointEntities: Entity[] = [
  {
    id: 'ep:POST /api/transfers',
    kind: 'endpoint',
    name: 'POST /api/transfers',
    parent: 'be:routes/money',
    summary: 'Transfers money immediately between two accounts the signed-in customer can use; both ledger legs post in one transaction.',
    audience: {
      executive: 'The instant "move money between my accounts" operation.',
      'end-user': 'What the Transfer tab on the Move money page calls when you press "Transfer now".',
    },
    tags: ['money', 'ledger', 'validation', 'security'],
    aliases: ['transfer', 'internal transfer'],
    sources: [src(F.routesMoney, 66, 89, "app.post('/api/transfers'")],
  },
  {
    id: 'ep:POST /api/movements',
    kind: 'endpoint',
    name: 'POST /api/movements',
    parent: 'be:routes/money',
    summary: 'Submits a mobile check deposit, external ACH, wire or bill payment for operator review; writes a pending ledger entry and a queue item.',
    audience: {
      executive: 'Where deposits, wires and bill payments enter the bank — recorded as pending and sent to staff for approval.',
      'end-user': 'What the Deposit a check, Send money and Pay a bill tabs call when you submit.',
    },
    tags: ['money', 'ledger', 'operations', 'realtime', 'validation', 'security'],
    aliases: ['external movement', 'deposit', 'bill pay', 'wire', 'ACH'],
    sources: [src(F.routesMoney, 91, 124, "app.post('/api/movements'")],
  },
  {
    id: 'ep:GET /api/accounts',
    kind: 'endpoint',
    name: 'GET /api/accounts',
    parent: 'be:routes/accounts',
    summary: 'Lists every account the signed-in user may see, each with balances derived from its ledger at that moment.',
    audience: {
      executive: 'The request behind the customer’s account overview.',
      'end-user': 'What loads your accounts and balances on the dashboard and on the Move money page.',
    },
    tags: ['money', 'ledger', 'rbac', 'data'],
    aliases: ['list accounts', 'balances'],
    sources: [src(F.routesAccounts, 45, 50, "app.get('/api/accounts'")],
  },
  {
    id: 'ep:GET /api/accounts/:id',
    kind: 'endpoint',
    name: 'GET /api/accounts/:id',
    parent: 'be:routes/accounts',
    summary: 'Returns one account with derived balances — 404 if it does not exist, 403 if the caller has no relationship to it.',
    description: 'No client in the customer or operations app calls this endpoint at the pinned commit (the account page uses the transactions endpoint, which returns the same header). The backend test suites use it to read an account’s available balance.',
    tags: ['money', 'ledger', 'rbac', 'data'],
    sources: [src(F.routesAccounts, 52, 68, "app.get('/api/accounts/:id'")],
  },
  {
    id: 'ep:GET /api/accounts/:id/transactions',
    kind: 'endpoint',
    name: 'GET /api/accounts/:id/transactions',
    parent: 'be:routes/accounts',
    summary: 'Returns an account’s header and its ledger entries as a newest-first transaction list, with optional search and filters.',
    audience: { 'end-user': 'What loads the account page: your balances at the top and the activity list underneath.' },
    tags: ['ledger', 'rbac', 'data'],
    aliases: ['transaction history', 'activity'],
    sources: [src(F.routesAccounts, 70, 90, "app.get('/api/accounts/:id/transactions'")],
  },
  {
    id: 'ep:GET /api/accounts/:id/statements',
    kind: 'endpoint',
    name: 'GET /api/accounts/:id/statements',
    parent: 'be:routes/accounts',
    summary: 'Returns the last six monthly statement periods for an account, computed from the settled ledger as of the simulated date.',
    audience: { 'end-user': 'What loads the Statements page.' },
    tags: ['money', 'data', 'time', 'rbac'],
    aliases: ['statements'],
    sources: [src(F.routesAccounts, 92, 111, "app.get('/api/accounts/:id/statements'")],
  },
];

export const backendEntities: Entity[] = [...movementEntities, ...routeEntities, ...endpointEntities];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const TR = 'ep:POST /api/transfers';
const MV = 'ep:POST /api/movements';
const CT = 'be:money/movements#createTransfer';
const CEM = 'be:money/movements#createExternalMovement';
const RMA = 'be:money/movements#requireMovableAccount';

export const backendRelations: Relation[] = [
  // ---- POST /api/transfers --------------------------------------------------
  rel(TR, 'be:auth/guards#requireAuth', 'guards', {
    label: 'preHandler: requireAuth',
    summary: 'A valid session is required; otherwise 401.',
    order: 1,
    sources: [src(F.routesMoney, 64, 66, 'requireAuth')],
  }),
  rel(TR, 'be:abuse/rate-limit#rateLimit', 'guards', {
    label: "preHandler: rateLimit('money')",
    summary: 'Per-user limit of 30 money requests per 5 minutes, enforced only in public-demo mode.',
    order: 2,
    sources: [src(F.routesMoney, 63, 64, "rateLimit('money')")],
  }),
  rel(TR, 'sh:money-movement#validateTransfer', 'validates', {
    label: 'validateTransfer({ … })',
    summary: 'The coerced body is validated with the same function the form already ran.',
    order: 3,
    sources: [src(F.routesMoney, 67, 76, 'validateTransfer(')],
  }),
  rel(TR, 'be:clock/clock#simulationNow', 'calls', {
    label: 'await simulationNow(prisma)',
    summary: 'Ledger entries are dated with the simulation clock, not the wall clock.',
    order: 4,
    sources: [src(F.routesMoney, 78, 78, 'simulationNow(prisma)')],
  }),
  rel(TR, CT, 'calls', {
    label: 'createTransfer(req.user!, check.value, now)',
    summary: 'Delegates the access checks, funds check and ledger writes to the money service.',
    order: 5,
    sources: [src(F.routesMoney, 77, 88, 'createTransfer(req.user!, check.value')],
  }),
  rel(TR, 'be:routes/money#handleMovementError', 'calls', {
    label: 'handleMovementError(reply, err)',
    summary: 'A MovementError becomes 400 / 403 / 404 with `{ error, code }`.',
    order: 6,
    sources: [src(F.routesMoney, 86, 88, 'handleMovementError(reply, err)')],
  }),
  rel(TR, 'sh:money-movement#TransferResponse', 'uses-type', { label: '201 TransferResponse', sources: [src(F.routesMoney, 79, 85, 'TransferResponse')] }),
  rel(TR, 'sh:money-movement#TransferRequest', 'uses-type', { label: 'body: TransferRequest', sources: [src(F.shMovement, 128, 129, 'POST /api/transfers body')] }),
  rel(TR, 'feat:transfers', 'implements', { summary: 'The API of internal transfers.' }),

  // ---- POST /api/movements --------------------------------------------------
  rel(MV, 'be:auth/guards#requireAuth', 'guards', { label: 'preHandler: requireAuth', order: 1, sources: [src(F.routesMoney, 64, 64, 'requireAuth')] }),
  rel(MV, 'be:abuse/rate-limit#rateLimit', 'guards', {
    label: "preHandler: rateLimit('money')",
    summary: 'Shares the `money` bucket with transfers.',
    order: 2,
    sources: [src(F.routesMoney, 64, 64, "rateLimit('money')")],
  }),
  rel(MV, 'sh:money-movement#validateExternalMovement', 'validates', {
    label: 'validateExternalMovement({ … })',
    order: 3,
    sources: [src(F.routesMoney, 93, 104, 'validateExternalMovement(')],
  }),
  rel(MV, 'be:clock/clock#simulationNow', 'calls', { label: 'await simulationNow(prisma)', order: 4, sources: [src(F.routesMoney, 106, 106, 'simulationNow(prisma)')] }),
  rel(MV, CEM, 'calls', {
    label: 'createExternalMovement(req.user!, check.value, now)',
    summary: 'Writes the pending entry, the queue item, the audit row and the simulated event.',
    order: 5,
    sources: [src(F.routesMoney, 105, 106, 'createExternalMovement(req.user!, check.value')],
  }),
  rel(MV, 'be:ops/realtime#OpsRealtime', 'calls', {
    label: "app.opsRealtime.requestChanged('created', …) / externalEvent(event)",
    summary: 'Hands the new request and its simulated event to the real-time publisher (a no-op when no Socket.IO server is attached).',
    order: 6,
    sources: [src(F.routesMoney, 107, 109, "app.opsRealtime.requestChanged('created', created.request)")],
  }),
  rel(MV, 'ev:ops:request_changed', 'emits', {
    label: "ops:request_changed { change: 'created', request }",
    summary: 'The new queue item is pushed to every connected operator console.',
    protocol: 'Socket.IO (ops room)',
    order: 7,
    sources: [src(F.routesMoney, 107, 108, "requestChanged('created'"), src(F.opsRealtime, 42, 45, 'SOCKET_EVENTS.opsRequestChanged')],
  }),
  rel(MV, 'ev:ops:external_event', 'emits', {
    label: 'ops:external_event { event }',
    summary: 'The simulated "received — under review" event is pushed to the operators’ activity feed.',
    protocol: 'Socket.IO (ops room)',
    order: 8,
    sources: [src(F.routesMoney, 109, 109, 'app.opsRealtime.externalEvent(event)'), src(F.opsRealtime, 47, 50, 'SOCKET_EVENTS.opsExternalEvent')],
  }),
  rel(MV, 'be:routes/money#handleMovementError', 'calls', { label: 'handleMovementError(reply, err)', order: 9, sources: [src(F.routesMoney, 121, 123, 'handleMovementError(reply, err)')] }),
  rel(MV, 'sh:money-movement#ExternalMovementResponse', 'uses-type', { label: '201 ExternalMovementResponse', sources: [src(F.routesMoney, 111, 120, 'ExternalMovementResponse')] }),
  rel(MV, 'sh:money-movement#ExternalMovementRequest', 'uses-type', { label: 'body: ExternalMovementRequest', sources: [src(F.shMovement, 145, 146, 'POST /api/movements body')] }),
  rel(MV, 'feat:external-movements', 'implements', { summary: 'The API of reviewable external movements.' }),
  rel(MV, 'feat:realtime', 'implements', { summary: 'New movements appear in the operations console without polling.' }),

  // ---- route helpers --------------------------------------------------------
  rel('be:routes/money#handleMovementError', 'be:routes/money#movementHttpStatus', 'calls', { label: 'movementHttpStatus(err.code)', sources: [src(F.routesMoney, 46, 53, 'movementHttpStatus(err.code)')] }),
  rel('be:routes/money#handleMovementError', 'be:money/movements#MovementError', 'uses-type', { label: 'err instanceof MovementError', sources: [src(F.routesMoney, 46, 53, 'err instanceof MovementError')] }),
  rel('be:routes/money#movementHttpStatus', 'be:money/movements#MovementErrorCode', 'uses-type', { label: 'code: MovementErrorCode', sources: [src(F.routesMoney, 32, 33, 'MovementErrorCode')] }),

  // ---- createTransfer -------------------------------------------------------
  rel(CT, RMA, 'calls', {
    label: 'requireMovableAccount(user.id, input.fromAccountId) / (…, input.toAccountId)',
    summary: 'Both the source and the destination must exist, be usable by the caller and be active.',
    order: 1,
    sources: [src(F.movements, 180, 181, 'requireMovableAccount(user.id, input.fromAccountId)')],
  }),
  rel(CT, 'be:money/movements#availableMinor', 'calls', {
    label: 'availableMinor(from.account) < input.amountMinor',
    summary: 'The funds check uses the AVAILABLE balance, so pending debits and holds already count.',
    order: 2,
    sources: [src(F.movements, 183, 185, 'availableMinor(from.account)')],
  }),
  rel(CT, 'db:LedgerEntry', 'writes', {
    label: 'insert 2 posted rows (transfer debit + transfer credit)',
    summary: 'Same amount, same simulated instant, opposite directions — the pair nets to zero.',
    description: 'Both `tx.ledgerEntry.create` calls run inside one `prisma.$transaction`, so either both legs exist or neither does.',
    order: 3,
    sources: [src(F.movements, 189, 213, 'tx.ledgerEntry.create')],
  }),
  rel(CT, 'be:auth/audit#writeAudit', 'calls', {
    label: "writeAudit(tx, { action: 'money_transfer', … })",
    summary: 'The audit row is written in the same transaction as the two legs.',
    order: 4,
    sources: [src(F.movements, 214, 227, "action: 'money_transfer'")],
  }),
  rel(CT, 'db:AuditLog', 'writes', {
    label: 'insert money_transfer row (via writeAudit)',
    summary: 'entity `account`, entityId = source account, metadata = amount, both account ids, actor name.',
    order: 4,
    sources: [src(F.movements, 214, 227, "action: 'money_transfer'")],
  }),
  rel(CT, 'be:money/movements#summarize', 'calls', {
    label: 'summarize(prisma, accountId, relationship) ×2',
    summary: 'After the commit both accounts are re-read and their balances re-derived for the response.',
    order: 5,
    sources: [src(F.movements, 230, 236, 'await summarize(prisma, from.account.id, from.relationship)')],
  }),
  rel(CT, 'sh:money#formatMinor', 'calls', { label: 'formatMinor(input.amountMinor)', summary: 'Formats the amount for the audit reason text.', sources: [src(F.movements, 220, 220, 'formatMinor(input.amountMinor)')] }),
  rel(CT, 'sh:money-movement#NormalizedTransfer', 'uses-type', { label: 'input: NormalizedTransfer', sources: [src(F.movements, 175, 179, 'NormalizedTransfer')] }),
  rel(CT, 'be:money/movements#TransferResult', 'uses-type', { label: 'returns TransferResult', sources: [src(F.movements, 175, 179, 'TransferResult')] }),
  rel(CT, 'be:money/movements#MovementError', 'uses-type', { label: 'throws MovementError', sources: [src(F.movements, 183, 185, 'throw new MovementError')] }),
  rel(CT, 'feat:transfers', 'implements', { summary: 'Posts both legs of an internal transfer.' }),
  rel(CT, 'feat:audit', 'implements', { summary: 'Every transfer writes a `money_transfer` audit row.' }),

  // ---- requireMovableAccount / helpers --------------------------------------
  rel(RMA, 'db:Account', 'reads', {
    label: 'findUnique by id (id, name, status)',
    summary: 'Loads the account; a missing row is a 404.',
    order: 1,
    sources: [src(F.movements, 119, 123, 'prisma.account.findUnique')],
  }),
  rel(RMA, 'db:LedgerEntry', 'reads', {
    label: 'all entries of the account (amountMinor, direction, status)',
    summary: 'Loaded with the account so the caller can derive the available balance.',
    order: 1,
    sources: [src(F.movements, 119, 122, 'ledgerEntries: { select: { amountMinor: true, direction: true, status: true } }')],
  }),
  rel(RMA, 'be:auth/access#getAccountRelationship', 'calls', {
    label: 'getAccountRelationship(prisma, userId, accountId)',
    summary: 'Must be owner, joint or authorized — a viewer or a stranger gets 403.',
    order: 2,
    sources: [src(F.movements, 124, 127, 'getAccountRelationship(prisma, userId, accountId)')],
  }),
  rel(RMA, 'be:money/movements#MovementError', 'uses-type', { label: 'throws not_found / forbidden / inactive_account', sources: [src(F.movements, 123, 130, "new MovementError('forbidden'")] }),
  rel(RMA, 'feat:rbac', 'implements', { summary: 'Per-account access enforcement for money movement.' }),
  rel('be:money/movements#availableMinor', 'sh:ledger#deriveBalances', 'calls', {
    label: 'deriveBalances(entries).availableMinor',
    summary: 'The funds check reuses the one shared definition of "available".',
    sources: [src(F.movements, 81, 89, 'deriveBalances(')],
  }),
  rel('be:money/movements#summarize', 'db:Account', 'reads', { label: 'findUniqueOrThrow by id, include ledgerEntries', sources: [src(F.movements, 93, 96, 'db.account.findUniqueOrThrow')] }),
  rel('be:money/movements#summarize', 'db:LedgerEntry', 'reads', { label: 'all entries of the account', sources: [src(F.movements, 93, 96, 'include: { ledgerEntries: true }')] }),
  rel('be:money/movements#summarize', 'sh:ledger#deriveBalances', 'calls', { label: 'deriveBalances(account.ledgerEntries.map(…))', sources: [src(F.movements, 104, 110, 'deriveBalances(')] }),
  rel('be:money/movements#summarize', 'sh:auth#AccountSummary', 'uses-type', { label: 'returns AccountSummary', sources: [src(F.movements, 92, 92, 'Promise<AccountSummary>')] }),
  rel('be:money/movements#MovementError', 'be:money/movements#MovementErrorCode', 'uses-type', { label: 'readonly code: MovementErrorCode', sources: [src(F.movements, 58, 65, 'readonly code: MovementErrorCode')] }),
  rel('be:money/movements#generateMovementReference', 'sh:money-movement#MOVEMENT_REFERENCE_PREFIX', 'uses-type', { label: 'MOVEMENT_REFERENCE_PREFIX + 6 hex', sources: [src(F.movements, 70, 72, 'MOVEMENT_REFERENCE_PREFIX')] }),

  // ---- createExternalMovement ----------------------------------------------
  rel(CEM, RMA, 'calls', { label: 'requireMovableAccount(user.id, input.accountId)', order: 1, sources: [src(F.movements, 285, 285, 'requireMovableAccount(user.id, input.accountId)')] }),
  rel(CEM, 'be:money/movements#availableMinor', 'calls', {
    label: "direction === 'outbound' && availableMinor(account) < input.amountMinor",
    summary: 'Only outbound movements are checked against available funds.',
    order: 2,
    sources: [src(F.movements, 289, 291, 'availableMinor(account) < input.amountMinor')],
  }),
  rel(CEM, 'db:OperationsRequest', 'reads', {
    label: 'count pending movement requests for this user',
    summary: 'The per-user cap: status pending, subjectEmail = user, type in ach/wire/deposit/bill_pay.',
    order: 3,
    sources: [src(F.movements, 296, 302, 'prisma.operationsRequest.count')],
  }),
  rel(CEM, 'sh:public-demo#RESOURCE_CAPS', 'uses-type', {
    label: 'RESOURCE_CAPS.pendingMovementsPerUser (25)',
    summary: 'At most 25 movements awaiting review per user, in every mode.',
    order: 3,
    sources: [src(F.movements, 303, 308, 'RESOURCE_CAPS.pendingMovementsPerUser'), src(F.shPublicDemo, 130, 131, 'pendingMovementsPerUser: 25')],
  }),
  rel(CEM, 'sh:money-movement#REVIEWABLE_MOVEMENT_OPS_TYPE', 'uses-type', { label: 'Object.values(REVIEWABLE_MOVEMENT_OPS_TYPE)', summary: 'The request types that count toward the cap.', sources: [src(F.movements, 296, 302, 'Object.values(REVIEWABLE_MOVEMENT_OPS_TYPE)')] }),
  rel(CEM, 'be:money/movements#generateMovementReference', 'calls', { label: 'generateMovementReference()', order: 4, sources: [src(F.movements, 310, 310, 'generateMovementReference()')] }),
  rel(CEM, 'be:money/movements#describeMovement', 'calls', { label: 'describeMovement(input)', order: 4, sources: [src(F.movements, 311, 311, 'describeMovement(input)')] }),
  rel(CEM, 'sh:money-movement#movementLedgerOrigin', 'calls', { label: 'movementLedgerOrigin(input.kind, direction)', summary: 'Inbound → deposit, outbound → payment.', order: 4, sources: [src(F.movements, 312, 312, 'movementLedgerOrigin(input.kind, direction)')] }),
  rel(CEM, 'db:LedgerEntry', 'writes', {
    label: 'insert 1 pending row (deposit credit or payment debit)',
    summary: 'status pending, postedAt null — nothing has settled.',
    order: 5,
    sources: [src(F.movements, 315, 328, "status: 'pending'")],
  }),
  rel(CEM, 'sh:money-movement#movementOpsType', 'calls', { label: 'movementOpsType(input.kind)', order: 6, sources: [src(F.movements, 341, 343, 'movementOpsType(input.kind)')] }),
  rel(CEM, 'db:OperationsRequest', 'writes', {
    label: 'insert pending request with MovementPayload JSON',
    summary: 'The queue item; its payload carries `ledgerEntryIds` — the soft link back to the ledger entry.',
    order: 6,
    sources: [src(F.movements, 330, 354, 'tx.operationsRequest.create')],
  }),
  rel(CEM, 'sh:money-movement#MovementPayload', 'uses-type', { label: 'payload: MovementPayload', order: 6, sources: [src(F.movements, 331, 340, 'const payload: MovementPayload')] }),
  rel(CEM, 'be:auth/audit#writeAudit', 'calls', { label: "writeAudit(tx, { action: 'ops_request_created', … })", order: 7, sources: [src(F.movements, 356, 365, "action: 'ops_request_created'")] }),
  rel(CEM, 'db:AuditLog', 'writes', {
    label: 'insert ops_request_created row (via writeAudit)',
    summary: 'entity `operations_request`, entityId = the new request; metadata holds the reference, kind and ledger entry id.',
    order: 7,
    sources: [src(F.movements, 356, 365, "action: 'ops_request_created'")],
  }),
  rel(CEM, 'be:money/movements#recordSimEvent', 'calls', { label: "recordSimEvent(tx, { kind: 'movement_received', … }, now)", order: 8, sources: [src(F.movements, 367, 379, "kind: 'movement_received'")] }),
  rel(CEM, 'be:ops/requests#toOperationsRequestDTO', 'calls', { label: 'toOperationsRequestDTO(request)', order: 9, sources: [src(F.movements, 384, 384, 'toOperationsRequestDTO(request)')] }),
  rel(CEM, 'sh:money-movement#NormalizedExternalMovement', 'uses-type', { label: 'input: NormalizedExternalMovement', sources: [src(F.movements, 280, 284, 'NormalizedExternalMovement')] }),
  rel(CEM, 'be:money/movements#CreatedMovement', 'uses-type', { label: 'returns CreatedMovement', sources: [src(F.movements, 280, 284, 'CreatedMovement')] }),
  rel(CEM, 'be:money/movements#MovementError', 'uses-type', { label: 'throws insufficient_funds / limit_reached', sources: [src(F.movements, 303, 308, "'limit_reached'")] }),
  rel(CEM, 'feat:external-movements', 'implements', { summary: 'Queues the pending entry and the operations request.' }),
  rel(CEM, 'feat:audit', 'implements', { summary: 'Every queued movement writes an `ops_request_created` audit row.' }),
  rel(CEM, 'feat:sim-messaging', 'implements', { summary: 'Records the simulated "received — under review" confirmation.' }),
  rel('be:money/movements#describeMovement', 'sh:money-movement#MOVEMENT_KIND_LABELS', 'uses-type', { label: 'MOVEMENT_KIND_LABELS[input.kind]', sources: [src(F.movements, 241, 243, 'MOVEMENT_KIND_LABELS[input.kind]')] }),
  rel('be:money/movements#describeMovement', 'sh:money#formatMinor', 'calls', { label: 'formatMinor(input.amountMinor)', sources: [src(F.movements, 241, 243, 'formatMinor(input.amountMinor)')] }),

  // ---- recordSimEvent -------------------------------------------------------
  rel('be:money/movements#recordSimEvent', 'db:SimulatedEvent', 'writes', {
    label: 'insert 1 row (channel, kind, status, summary, requestId)',
    summary: 'A labelled stand-in for a message a real bank would send.',
    sources: [src(F.movements, 148, 159, 'db.simulatedEvent.create')],
  }),
  rel('be:money/movements#recordSimEvent', 'be:ops/requests#toSimulatedEventDTO', 'calls', { label: 'toSimulatedEventDTO(created)', sources: [src(F.movements, 160, 160, 'toSimulatedEventDTO(created)')] }),

  // ---- reversal primitive ---------------------------------------------------
  rel('be:money/movements#reverseLedgerEntries', 'db:LedgerEntry', 'writes', {
    label: "updateMany: posted | disputed → reversed",
    summary: 'A status change guarded by the current status; returns the number of rows changed.',
    sources: [src(F.movements, 397, 404, 'tx.ledgerEntry.updateMany')],
  }),
  rel('be:money/movements#movementPayloadOf', 'sh:money-movement#asMovementPayload', 'calls', { label: 'asMovementPayload(parseJson(row.payload))', sources: [src(F.movements, 421, 426, 'asMovementPayload(parseJson(row.payload))')] }),
  rel('be:money/movements#movementPayloadOf', 'sh:money-movement#MovementPayload', 'uses-type', { label: 'returns MovementPayload | null', sources: [src(F.movements, 421, 421, 'MovementPayload | null')] }),

  // ---- postApprovedMovement -------------------------------------------------
  rel('be:money/movements#postApprovedMovement', 'be:money/movements#movementPayloadOf', 'calls', { label: 'movementPayloadOf(request)', order: 1, sources: [src(F.movements, 445, 446, 'movementPayloadOf(request)')] }),
  rel('be:money/movements#postApprovedMovement', 'db:LedgerEntry', 'writes', {
    label: 'updateMany: pending → posted, postedAt = now',
    summary: 'The linked pending entries settle; this is when the money moves.',
    order: 2,
    sources: [src(F.movements, 448, 451, "data: { status: 'posted', postedAt: now }")],
  }),
  rel('be:money/movements#postApprovedMovement', 'be:auth/audit#writeAudit', 'calls', { label: "writeAudit(tx, { action: 'movement_posted', … })", order: 3, sources: [src(F.movements, 453, 461, "action: 'movement_posted'")] }),
  rel('be:money/movements#postApprovedMovement', 'db:AuditLog', 'writes', { label: 'insert movement_posted row (via writeAudit)', order: 3, sources: [src(F.movements, 453, 461, "action: 'movement_posted'")] }),
  rel('be:money/movements#postApprovedMovement', 'be:money/movements#recordSimEvent', 'calls', { label: "recordSimEvent(tx, { kind: 'movement_posted', … }, now)", order: 4, sources: [src(F.movements, 463, 473, "kind: 'movement_posted'")] }),
  rel('be:money/movements#postApprovedMovement', 'be:money/movements#MovementLedgerResult', 'uses-type', { label: 'returns MovementLedgerResult | null', sources: [src(F.movements, 439, 444, 'MovementLedgerResult | null')] }),
  rel('be:money/movements#postApprovedMovement', 'feat:ops-review', 'implements', { summary: 'The ledger effect of approving a money movement.' }),
  rel('be:money/movements#postApprovedMovement', 'feat:external-movements', 'implements', { summary: 'Pending → posted on approval.' }),

  // ---- failMovement ---------------------------------------------------------
  rel('be:money/movements#failMovement', 'be:money/movements#movementPayloadOf', 'calls', { label: 'movementPayloadOf(request)', order: 1, sources: [src(F.movements, 487, 488, 'movementPayloadOf(request)')] }),
  rel('be:money/movements#failMovement', 'db:LedgerEntry', 'writes', {
    label: 'updateMany: pending → failed',
    summary: 'The linked pending entries stop counting; reserved funds are released.',
    order: 2,
    sources: [src(F.movements, 490, 493, "data: { status: 'failed' }")],
  }),
  rel('be:money/movements#failMovement', 'be:money/movements#recordSimEvent', 'calls', { label: "recordSimEvent(tx, { kind: 'movement_failed', … }, now)", order: 3, sources: [src(F.movements, 495, 505, "kind: 'movement_failed'")] }),
  rel('be:money/movements#failMovement', 'feat:ops-review', 'implements', { summary: 'The ledger effect of rejecting a money movement.' }),

  // ---- reverseMovement ------------------------------------------------------
  rel('be:money/movements#reverseMovement', 'db:OperationsRequest', 'reads', { label: 'findUnique by id', order: 1, sources: [src(F.movements, 524, 525, 'prisma.operationsRequest.findUnique')] }),
  rel('be:money/movements#reverseMovement', 'be:money/movements#movementPayloadOf', 'calls', { label: 'movementPayloadOf(request)', order: 2, sources: [src(F.movements, 527, 528, 'movementPayloadOf(request)')] }),
  rel('be:money/movements#reverseMovement', 'be:money/movements#reverseLedgerEntries', 'calls', {
    label: 'reverseLedgerEntries(tx, payload.ledgerEntryIds)',
    summary: 'Zero rows reversed throws `nothing_to_reverse` and rolls the transaction back.',
    order: 3,
    sources: [src(F.movements, 530, 534, 'reverseLedgerEntries(tx, payload.ledgerEntryIds)')],
  }),
  rel('be:money/movements#reverseMovement', 'db:OperationsRequest', 'writes', {
    label: 'update payload → { …, reversed: true }',
    summary: 'Marks the stored movement context as reversed; the workflow status is untouched.',
    order: 4,
    sources: [src(F.movements, 536, 540, 'reversed: true')],
  }),
  rel('be:money/movements#reverseMovement', 'be:auth/audit#writeAudit', 'calls', { label: "writeAudit(tx, { action: 'movement_reversed', reason, … })", order: 5, sources: [src(F.movements, 542, 550, "action: 'movement_reversed'")] }),
  rel('be:money/movements#reverseMovement', 'db:AuditLog', 'writes', { label: 'insert movement_reversed row with the operator’s reason (via writeAudit)', order: 5, sources: [src(F.movements, 542, 550, "action: 'movement_reversed'")] }),
  rel('be:money/movements#reverseMovement', 'be:money/movements#recordSimEvent', 'calls', { label: "recordSimEvent(tx, { kind: 'movement_reversed', … }, now)", order: 6, sources: [src(F.movements, 552, 563, "kind: 'movement_reversed'")] }),
  rel('be:money/movements#reverseMovement', 'be:ops/requests#toOperationsRequestDTO', 'calls', { label: 'toOperationsRequestDTO(result.request)', order: 7, sources: [src(F.movements, 568, 568, 'toOperationsRequestDTO(result.request)')] }),
  rel('be:money/movements#reverseMovement', 'be:money/movements#ReversedMovement', 'uses-type', { label: 'returns ReversedMovement', sources: [src(F.movements, 518, 523, 'ReversedMovement')] }),
  rel('be:money/movements#reverseMovement', 'be:money/movements#MovementError', 'uses-type', { label: 'throws not_found / not_a_movement / nothing_to_reverse', sources: [src(F.movements, 524, 534, "'nothing_to_reverse'")] }),
  rel('be:money/movements#reverseMovement', 'feat:audit', 'implements', { summary: 'A reversal requires a reason and writes it to the audit trail.' }),

  // ---- account routes -------------------------------------------------------
  rel('ep:GET /api/accounts', 'be:auth/guards#requireAuth', 'guards', { label: 'preHandler: requireAuth', order: 1, sources: [src(F.routesAccounts, 45, 45, 'requireAuth')] }),
  rel('ep:GET /api/accounts', 'be:auth/access#listAccessibleAccounts', 'calls', {
    label: 'listAccessibleAccounts(prisma, user.id)',
    summary: 'Returns every account the user has a grant on (or owns), each with derived balances, sorted by name.',
    order: 2,
    sources: [src(F.routesAccounts, 48, 49, 'listAccessibleAccounts(prisma, user.id)')],
  }),
  rel('ep:GET /api/accounts', 'feat:accounts', 'implements', { summary: 'The account list.' }),
  rel('ep:GET /api/accounts', 'feat:balances', 'implements', { summary: 'Balances in the response are derived at request time.' }),

  rel('ep:GET /api/accounts/:id', 'be:auth/guards#requireAuth', 'guards', { label: 'preHandler: requireAuth', order: 1, sources: [src(F.routesAccounts, 52, 52, 'requireAuth')] }),
  rel('ep:GET /api/accounts/:id', 'be:auth/access#getAccessibleAccount', 'calls', {
    label: 'getAccessibleAccount(prisma, user.id, id)',
    summary: '`exists: false` → 404; `summary: null` → 403; otherwise the summary.',
    order: 2,
    sources: [src(F.routesAccounts, 57, 66, 'getAccessibleAccount(prisma, user.id, id)')],
  }),
  rel('ep:GET /api/accounts/:id', 'feat:rbac', 'implements', { summary: 'Per-account read access: 404 vs 403.' }),

  rel('ep:GET /api/accounts/:id/transactions', 'be:auth/guards#requireAuth', 'guards', { label: 'preHandler: requireAuth', order: 1, sources: [src(F.routesAccounts, 74, 74, 'requireAuth')] }),
  rel('ep:GET /api/accounts/:id/transactions', 'be:routes/accounts#parseTransactionQuery', 'calls', {
    label: 'parseTransactionQuery(req.query)',
    summary: 'Sanitises the search and filter parameters.',
    order: 2,
    sources: [src(F.routesAccounts, 78, 78, 'parseTransactionQuery(')],
  }),
  rel('ep:GET /api/accounts/:id/transactions', 'be:auth/access#listAccountTransactions', 'calls', {
    label: 'listAccountTransactions(prisma, user.id, id, query)',
    summary: 'Same access rules as the single-account read; returns the header and the derived transaction list.',
    order: 3,
    sources: [src(F.routesAccounts, 80, 89, 'listAccountTransactions(prisma, user.id, id, query)')],
  }),
  rel('ep:GET /api/accounts/:id/transactions', 'sh:transactions#AccountTransactionsResponse', 'uses-type', { label: '200 AccountTransactionsResponse', sources: [src(F.routesAccounts, 89, 89, 'AccountTransactionsResponse')] }),
  rel('ep:GET /api/accounts/:id/transactions', 'feat:accounts', 'implements', { summary: 'Transaction history with search and filters.' }),

  rel('ep:GET /api/accounts/:id/statements', 'be:auth/guards#requireAuth', 'guards', { label: 'preHandler: requireAuth', order: 1, sources: [src(F.routesAccounts, 95, 95, 'requireAuth')] }),
  rel('ep:GET /api/accounts/:id/statements', 'be:clock/clock#simulationNow', 'calls', {
    label: 'await simulationNow(prisma)',
    summary: 'Statement months end with the month containing the SIMULATED date.',
    order: 2,
    sources: [src(F.routesAccounts, 100, 100, 'simulationNow(prisma)')],
  }),
  rel('ep:GET /api/accounts/:id/statements', 'be:auth/access#getAccountStatements', 'calls', {
    label: 'getAccountStatements(prisma, user.id, id, now)',
    summary: 'Same access rules; returns six monthly periods derived from the settled ledger.',
    order: 3,
    sources: [src(F.routesAccounts, 101, 110, 'getAccountStatements(prisma, user.id, id, now)')],
  }),
  rel('ep:GET /api/accounts/:id/statements', 'sh:statements#AccountStatementsResponse', 'uses-type', { label: '200 AccountStatementsResponse', sources: [src(F.routesAccounts, 110, 110, 'AccountStatementsResponse')] }),
  rel('ep:GET /api/accounts/:id/statements', 'feat:statements', 'implements', { summary: 'Statement periods on demand.' }),

  rel('be:routes/accounts#parseTransactionQuery', 'sh:transactions#TransactionQuery', 'uses-type', { label: 'returns TransactionQuery', sources: [src(F.routesAccounts, 25, 26, 'TransactionQuery')] }),
  rel('be:routes/accounts#parseTransactionQuery', 'sh:ledger#LEDGER_ORIGINS', 'uses-type', { label: 'LEDGER_ORIGINS.includes(raw.origin)', summary: 'An unknown origin is dropped, not rejected.', sources: [src(F.routesAccounts, 32, 34, 'LEDGER_ORIGINS')] }),
  rel('be:routes/accounts#parseTransactionQuery', 'sh:transactions#TransactionGroup', 'uses-type', { label: "['pending', 'posted', 'other']", sources: [src(F.routesAccounts, 22, 31, 'TRANSACTION_GROUPS')] }),
];
