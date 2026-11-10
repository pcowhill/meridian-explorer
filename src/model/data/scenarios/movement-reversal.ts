import type { Scenario, ScenarioStep, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';
import { FILES, src } from '../operations/helpers';

/**
 * "How does an operator undo a payment that already went through?"
 *
 * Continues from the `ops-approval` scenario: Avery's $120.00 bill payment
 * (ledger entry le_003) was approved and posted. A simulated day later Sam
 * reverses it.
 */

// ---- Lanes ------------------------------------------------------------------
const SAM = 'role:ops_agent';
const PANEL = 'op:components/RequestDetailPanel';
const CTX = 'op:lib/OpsDataContext';
const ROUTES = 'be:routes/ops';
const REVERSE = 'be:money/movements#reverseMovement';
const DB = 'db';
const AVERY = 'role:customer';

// ---- Example values ---------------------------------------------------------
const REQ = 'req_billpay';
const ENTRY = 'le_003';
const CREATED = '2026-10-01T14:40:00.000Z';
/** The simulation clock has been advanced one day since the approval. */
const SIM_NOW = '2026-10-02T15:00:00.000Z';
const WALL = '2026-10-01T15:20:31.000Z';
const WALL_RILEY = '2026-10-01T15:20:29.000Z';
const REASON = 'Customer reported a duplicate payment';

const STORED_PAYLOAD = {
  kind: 'bill_pay',
  amountMinor: 12000,
  direction: 'outbound',
  accountId: IDS.checking,
  counterparty: 'City Power & Light',
  memo: null,
  ledgerEntryIds: [ENTRY],
  reference: 'MOV-4F9A2C',
};
/** `asMovementPayload(STORED_PAYLOAD)` — key order as the function builds it. */
const NORMALIZED = { kind: 'bill_pay', amountMinor: 12000, direction: 'outbound', accountId: IDS.checking, counterparty: 'City Power & Light', memo: null, ledgerEntryIds: [ENTRY], reversed: false, reference: 'MOV-4F9A2C' };
const REVERSED_PAYLOAD = { ...NORMALIZED, reversed: true };

const REQUEST_DTO = {
  id: REQ,
  type: 'bill_pay',
  status: 'approved',
  priority: 'normal',
  summary: 'Bill payment — City Power & Light ($120.00)',
  detail: "A bill payment of $120.00 from the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.",
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: STORED_PAYLOAD as Record<string, unknown>,
  lastAction: 'approve',
  lastActorName: 'Sam Operator',
  lastActionNote: null,
  createdAt: CREATED,
  updatedAt: NOW,
  resolvedAt: NOW,
};
const REVERSED_DTO = { ...REQUEST_DTO, payload: REVERSED_PAYLOAD, updatedAt: SIM_NOW };

const reversalEvent = (id: string, reason: string) => ({
  id,
  channel: 'email',
  direction: 'outbound',
  kind: 'movement_reversed',
  status: 'sent',
  summary: 'Bill payment reversed — $120.00 (simulated)',
  detail: `Simulated reversal: ${reason}`,
  requestId: REQ,
  metadata: null,
  createdAt: SIM_NOW,
});
const reversalAudit = (id: string, actorId: string, actorRole: string, actorName: string, reason: string, createdAt: string) => ({
  id,
  actorId,
  actorRole,
  action: 'movement_reversed',
  entity: 'ledger_entry',
  entityId: ENTRY,
  reason,
  metadata: JSON.stringify({ ...NORMALIZED, reversedCount: 1, actorName }),
  createdAt,
});
const REVERSAL_EVENT = reversalEvent('evt_003', REASON);
const REVERSAL_AUDIT = reversalAudit('aud_004', IDS.sam, 'ops_agent', 'Sam Operator', REASON, WALL);

const RILEY_EFFECTS: StateEffect[] = [
  { op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'reversed' } },
  { op: 'update', table: 'OperationsRequest', id: REQ, set: { payload: JSON.stringify(REVERSED_PAYLOAD), updatedAt: SIM_NOW } },
  { op: 'insert', table: 'AuditLog', row: reversalAudit('aud_r01', IDS.riley, 'admin', 'Riley Admin', 'Duplicate of an earlier payment', WALL_RILEY) },
  { op: 'insert', table: 'SimulatedEvent', row: reversalEvent('evt_r01', 'Duplicate of an earlier payment') },
];

function loadMovementStep(variant: string, payload: Record<string, unknown>): ScenarioStep {
  return {
    id: `load-movement-${variant}`,
    kind: 'db-read',
    title: 'Load the request and find its ledger entries',
    from: REVERSE,
    to: DB,
    label: 'SELECT OperationsRequest · movementPayloadOf',
    narrative:
      "The service reads the request (unknown id → 404 `not_found`) and extracts its movement payload. A request that is not a deposit / ach / wire / bill_pay, or has no `ledgerEntryIds`, is refused with 400 `not_a_movement`. Neither the request's status nor the payload's `reversed` flag is checked here; what matters is the state of the ledger entries it points to.",
    audience: { dba: 'operationsRequest.findUnique by primary key, outside the transaction. The entry ids come from the JSON payload.' },
    detail: 4,
    variants: [variant],
    payload: { title: 'MovementPayload', format: 'return', data: payload, typeRef: 'sh:money-movement#MovementPayload', highlight: ['ledgerEntryIds', 'reversed'] },
    sources: [src(FILES.movements, 524, 528, 'movementPayloadOf(request)')],
  };
}

const steps: ScenarioStep[] = [
  {
    id: 'open-approved',
    kind: 'ui',
    title: 'Sam opens the approved payment',
    from: SAM,
    to: PANEL,
    label: 'open the approved bill payment',
    narrative:
      'Avery\'s $120.00 bill payment was approved yesterday (simulated time) and its ledger entry is posted. Sam opens the request again. Because it is an approved money movement whose payload is not marked reversed, the detail panel shows a separate "Reverse movement" section below the disabled decision buttons. Reversal is not a fifth decision: it is only offered after approval.',
    audience: {
      executive: 'A payment that already went through turns out to be a mistake. A bank employee opens it to undo it.',
      'end-user': 'Sam opens a payment that has already been completed.',
      dba: 'Starting rows: LedgerEntry le_003 status posted; OperationsRequest req_billpay status approved with payload.ledgerEntryIds ["le_003"].',
    },
    detail: 1,
    sources: [src(FILES.detailPanel, 205, 207, 'const canShowReverse'), src(FILES.detailPanel, 468, 502, 'Reverse movement')],
  },
  {
    id: 'riley-first',
    kind: 'note',
    title: 'Meanwhile: Riley reverses the same movement',
    from: DB,
    to: DB,
    label: 'Riley Admin reverses first',
    narrative:
      'In this variant Riley Admin reverses the same movement from another console a moment before Sam does. Riley\'s transaction commits: the entry is `reversed` and the request payload carries `reversed: true`. Sam\'s console has not rendered the push yet and still offers the Reverse button.',
    audience: { executive: 'Two employees try to undo the same payment; one gets there first.' },
    detail: 1,
    variants: ['nothing-to-reverse'],
    effects: RILEY_EFFECTS,
    confidence: 'simplified',
  },
  {
    id: 'click-reverse',
    kind: 'ui',
    title: 'Sam gives a reason and clicks Reverse movement',
    from: SAM,
    to: PANEL,
    label: 'reason + "Reverse movement"',
    narrative: `Sam types the reason "${REASON}" and clicks Reverse movement. The button stays disabled until the reason box contains text; the box allows at most 280 characters.`,
    audience: { executive: 'The employee must state why the payment is being undone.', 'end-user': 'Sam explains why and confirms the reversal.' },
    detail: 1,
    sources: [src(FILES.detailPanel, 182, 199, 'const handleReverse'), src(FILES.detailPanel, 483, 500, 'MOVEMENT_TEXT.reasonMaxLength')],
  },
  {
    id: 'reverse-request',
    kind: 'request',
    title: 'POST the reversal',
    from: CTX,
    to: ROUTES,
    label: `POST /api/ops/movements/${REQ}/reverse`,
    narrative:
      'The panel calls `reverse(requestId, reason)` on the data context, which calls the API client `reverseMovement`. Like every console mutation it goes through `apiRequest`: operations session cookie, surface header and CSRF header.',
    detail: 2,
    payload: {
      title: 'Reverse movement request',
      format: 'http-request',
      line: `POST /api/ops/movements/${REQ}/reverse`,
      headers: { Cookie: 'mer_ops_session=<opaque session token>; mer_csrf=<csrf token>', 'x-meridian-surface': 'operations', 'x-meridian-csrf': '<csrf token>', 'Content-Type': 'application/json' },
      data: { reason: REASON },
      typeRef: 'sh:money-movement#ReverseMovementRequest',
      highlight: ['reason'],
    },
    sources: [src(FILES.opsData, 113, 120, 'reverseMovement(id, reason)'), src(FILES.opsApi, 78, 96, 'export async function reverseMovement')],
  },
  {
    id: 'guards',
    kind: 'guard',
    title: 'Staff only, with a reason',
    from: ROUTES,
    to: ROUTES,
    label: 'csrfHook · requireAuth · requireRole · reason required',
    narrative:
      'The same chain as any operator mutation: CSRF double-submit check, `requireAuth` (the session resolves to Sam), `requireRole("ops_agent", "admin")` — a customer gets 403 — and the per-operator rate limit in public-demo mode. The handler then trims the reason, cuts it to 280 characters and answers 400 `bad_request` if nothing is left.',
    audience: { executive: 'Only staff can reverse a payment, and never without a recorded reason.' },
    detail: 3,
    effects: [{ op: 'update', table: 'Session', id: 'ses_sam', set: { lastSeenAt: WALL, expiresAt: '2026-10-01T23:20:31.000Z' } }],
    sources: [src(FILES.routesOps, 195, 207, 'A reason is required to reverse a movement.'), src(FILES.routesOps, 55, 56, 'const opsMutation'), src('apps/backend/src/routes/money.test.ts', 363, 366, 'requires a reason (400)')],
  },
  {
    id: 'call-reverse',
    kind: 'call',
    title: 'Hand over to the money module',
    from: ROUTES,
    to: REVERSE,
    label: 'reverseMovement(requestId, req.user, reason, now)',
    narrative: 'The route reads the simulated time and calls `reverseMovement`. Reversal lives in the money module, next to posting and failing, not in the request workflow service — the request\'s status does not change.',
    detail: 3,
    payload: { title: 'reverseMovement arguments', format: 'args', data: { requestId: REQ, actor: { id: IDS.sam, displayName: 'Sam Operator', role: 'ops_agent' }, reason: REASON, now: SIM_NOW }, highlight: ['reason'] },
    sources: [src(FILES.routesOps, 208, 214, 'reverseMovement('), src(FILES.movements, 513, 523, 'export async function reverseMovement')],
  },
  loadMovementStep('reversed', NORMALIZED),
  loadMovementStep('nothing-to-reverse', REVERSED_PAYLOAD),
  {
    id: 'anything-posted',
    kind: 'decision',
    title: 'Is there a settled entry to reverse?',
    from: REVERSE,
    to: REVERSE,
    label: 'reverseLedgerEntries(tx, ledgerEntryIds)',
    narrative:
      'Inside a transaction, `reverseLedgerEntries` runs one conditional update: set status `reversed` on the linked entries that are currently `posted` or `disputed`, and report how many rows changed. The count decides the outcome — zero means there was nothing settled to undo.',
    audience: {
      executive: 'The system undoes the payment only if it actually went through and has not been undone already.',
      dba: "ledgerEntry.updateMany WHERE id IN (...) AND status IN ('posted','disputed') SET status = 'reversed'. The affected-row count is the guard.",
    },
    detail: 3,
    decision: {
      question: 'How many linked ledger entries were posted (or disputed) and are now reversed?',
      options: [
        { label: 'One — the payment was posted', variant: 'reversed', description: 'The reversal proceeds.' },
        { label: 'Zero — already reversed (or never posted)', variant: 'nothing-to-reverse', description: 'MovementError("nothing_to_reverse") → 409; the transaction rolls back.' },
      ],
    },
    sources: [src(FILES.movements, 389, 404, 'export async function reverseLedgerEntries'), src(FILES.movements, 530, 534, 'reversedCount === 0')],
  },

  // ----- reversed ---------------------------------------------------------------
  {
    id: 'reverse-entry',
    kind: 'db-write',
    title: 'Posted entry becomes reversed',
    from: REVERSE,
    to: DB,
    label: "UPDATE LedgerEntry SET status = 'reversed'",
    narrative:
      'The original entry is re-statused from `posted` to `reversed`. No offsetting credit is written and no balance is edited: a reversed entry simply stops counting, so the $120.00 is back in every balance derived from the ledger. `postedAt` keeps the date it was originally posted.',
    audience: {
      executive: 'The payment is undone: the $120.00 returns to the customer\'s account.',
      'end-user': 'The payment is cancelled and the money is back in the account.',
      dba: 'One row updated. The ledger stays append-only in the sense that rows are never deleted or re-amounted; only `status` moves.',
    },
    detail: 1,
    variants: ['reversed'],
    payload: { title: 'LedgerEntry update', format: 'row', data: { id: ENTRY, status: 'reversed' }, highlight: ['status'] },
    effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'reversed' } }],
    sources: [src(FILES.movements, 397, 404, "data: { status: 'reversed' }"), src(FILES.ledger, 82, 89, 'failed / reversed: no effect on any balance')],
  },
  {
    id: 'mark-request',
    kind: 'db-write',
    title: 'Tag the request as reversed',
    from: REVERSE,
    to: DB,
    label: 'UPDATE OperationsRequest SET payload.reversed = true',
    narrative:
      'The request stays `approved` — the decision that was made is not rewritten. Instead its JSON payload is saved again with `reversed: true` and `updatedAt` is set to the simulated now. That flag is what the console reads to show the "Reversed" tag.',
    audience: { dba: 'UPDATE OperationsRequest SET payload = <JSON with reversed:true>, updatedAt. status and resolvedAt are unchanged.' },
    detail: 3,
    variants: ['reversed'],
    payload: { title: 'OperationsRequest.payload', format: 'json', data: REVERSED_PAYLOAD, typeRef: 'sh:money-movement#MovementPayload', highlight: ['reversed'] },
    effects: [{ op: 'update', table: 'OperationsRequest', id: REQ, set: { payload: JSON.stringify(REVERSED_PAYLOAD), updatedAt: SIM_NOW } }],
    sources: [src(FILES.movements, 536, 540, 'reversed: true')],
  },
  {
    id: 'audit-and-event',
    kind: 'db-write',
    title: 'Audit the reversal with its reason',
    from: REVERSE,
    to: DB,
    label: "INSERT AuditLog 'movement_reversed' + SimulatedEvent",
    narrative:
      'An audit row records who reversed what and why: action `movement_reversed` on the ledger entry, Sam as actor, the operator\'s reason verbatim. A simulated email "Bill payment reversed — $120.00" is recorded and linked to the request. Then the transaction commits all four writes together.',
    audience: {
      executive: 'The reversal and its reason are permanently logged.',
      dba: 'INSERT AuditLog (entity = \'ledger_entry\', entityId = \'le_003\'; metadata holds the payload as it was before the reversal plus reversedCount). INSERT SimulatedEvent. COMMIT.',
    },
    detail: 4,
    variants: ['reversed'],
    payload: { title: 'AuditLog row', format: 'row', data: REVERSAL_AUDIT, highlight: ['action', 'reason'] },
    effects: [
      { op: 'insert', table: 'AuditLog', row: REVERSAL_AUDIT },
      { op: 'insert', table: 'SimulatedEvent', row: REVERSAL_EVENT },
    ],
    sources: [src(FILES.movements, 542, 550, "action: 'movement_reversed'"), src(FILES.movements, 552, 566, "kind: 'movement_reversed'")],
  },
  {
    id: 'emit',
    kind: 'event',
    title: 'Every console shows the Reversed tag',
    from: ROUTES,
    to: CTX,
    label: 'ops:request_changed (updated)',
    narrative:
      'The route broadcasts the updated request to the `ops` room, then the simulated event as `ops:external_event`, then answers 200 with the request. Consoles upsert the request by id; `isRequestReversed(payload)` is now true, so queue cards and detail panels show a "Reversed" badge next to "Approved".',
    audience: { executive: 'All staff see that the payment was reversed.', systems: 'Socket.IO broadcast to room `ops`; the HTTP response carries the same request DTO.' },
    detail: 2,
    variants: ['reversed'],
    payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed → room "ops"', data: { change: 'updated', request: REVERSED_DTO }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['request.status', 'request.payload.reversed'] },
    sources: [src(FILES.routesOps, 215, 217, "app.opsRealtime.requestChanged('updated', request)"), src(FILES.shOperations, 345, 354, 'export function isRequestReversed')],
  },
  {
    id: 'ui-reversed',
    kind: 'ui',
    title: 'Sam sees Approved · Reversed',
    from: PANEL,
    to: SAM,
    label: 'badges: Approved + Reversed',
    narrative:
      'The panel clears the reason box and reloads the detail. The status badge still reads Approved, now with a Reversed badge beside it, and the Reverse movement section is gone. The reversal\'s audit row is stored against the ledger entry, so it is not in the request\'s History list; the simulated reversal email does appear under Linked simulated events.',
    audience: { 'end-user': 'Sam sees the payment marked as reversed.' },
    detail: 2,
    variants: ['reversed'],
    sources: [src(FILES.detailPanel, 185, 199, 'await reverse(requestId, reason)'), src(FILES.detailPanel, 231, 235, 'reversed && <ReversedBadge />')],
  },
  {
    id: 'balance-restored',
    kind: 'state',
    title: "Avery's $120.00 is back",
    from: DB,
    to: AVERY,
    label: 'current $2,331.10 → $2,451.10',
    narrative:
      'The next time Avery\'s accounts are loaded, the reversed entry counts for nothing: current and available balance are both $2,451.10 again. The bill payment remains in her transaction history, marked Reversed.',
    audience: {
      executive: 'The customer has the money back and can see the payment was reversed.',
      'end-user': 'Avery\'s balance is $120.00 higher and the payment shows as reversed.',
      dba: 'Current = sum of posted entries = 250000 − 4890 = 245110. No compensating row exists; the original row\'s status is the whole story.',
    },
    detail: 1,
    variants: ['reversed'],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: { currentMinor: 233110, availableMinor: 233110 }, after: { currentMinor: 245110, availableMinor: 245110 } }, highlight: ['after.currentMinor'] },
    sources: [src(FILES.ledger, 79, 119, 'export function deriveBalances'), src('apps/backend/src/routes/money.test.ts', 345, 361, "expect(entry.status).toBe('reversed')")],
  },

  // ----- nothing-to-reverse -------------------------------------------------------
  {
    id: 'nothing-throw',
    kind: 'call',
    title: 'Refused: nothing to reverse',
    from: REVERSE,
    to: ROUTES,
    label: "throw MovementError('nothing_to_reverse')",
    narrative:
      'The conditional update changed zero rows — the entry is already `reversed`. The service throws inside the transaction, which rolls back, so no audit row, event or payload change is written. The route maps the error code: not_found → 404, nothing_to_reverse → 409, anything else → 400.',
    detail: 3,
    variants: ['nothing-to-reverse'],
    sources: [src(FILES.movements, 530, 534, "new MovementError('nothing_to_reverse'"), src(FILES.routesOps, 218, 224, "err.code === 'nothing_to_reverse' ? 409")],
  },
  {
    id: 'nothing-response',
    kind: 'response',
    title: '409 Conflict',
    from: ROUTES,
    to: CTX,
    label: '409 nothing_to_reverse',
    narrative: 'No socket event is emitted. The API client raises an `ApiError`; the panel shows its message under the Reverse section.',
    audience: { executive: 'The second attempt is refused; a payment cannot be undone twice.' },
    detail: 1,
    variants: ['nothing-to-reverse'],
    payload: { title: 'Nothing to reverse', format: 'http-response', line: '409 Conflict', data: { error: 'There is no posted movement to reverse.', code: 'nothing_to_reverse' }, highlight: ['code'] },
    sources: [src(FILES.routesOps, 218, 222, 'reply.code(code).send'), src('apps/backend/src/routes/money.test.ts', 368, 380, 'toBe(409)')],
  },
  {
    id: 'nothing-state',
    kind: 'state',
    title: 'Reversed exactly once',
    from: DB,
    to: AVERY,
    label: 'one reversal; $120.00 returned once',
    narrative:
      'The ledger entry is `reversed` from Riley\'s action and Sam\'s attempt changed nothing. Avery\'s balance went up by $120.00 once. The same 409 is returned if someone tries to reverse a movement that is still pending or was rejected — there is no settled entry in either case.',
    audience: { dba: "The guard is the WHERE clause, not a status check on the request: only entries in 'posted' or 'disputed' can become 'reversed'." },
    detail: 2,
    variants: ['nothing-to-reverse'],
    sources: [src(FILES.movements, 397, 404, "status: { in: ['posted', 'disputed'] }")],
    confidence: 'inferred',
  },
];

const base = baseState();

export const scenario: Scenario = {
  id: 'movement-reversal',
  title: 'An operator reverses a posted payment',
  question: 'How does an operator undo a payment that has already gone through?',
  summary:
    'Sam reverses an approved bill payment and must give a reason. The linked ledger entry is re-statused from posted to reversed — no offsetting entry, no balance edit — the request keeps its Approved status but is tagged reversed, the reason is audited, and every console shows the Reversed tag. A second attempt is refused with 409.',
  category: 'money',
  tags: ['operations', 'money', 'ledger', 'audit', 'realtime'],
  participants: [SAM, PANEL, CTX, ROUTES, REVERSE, DB, AVERY],
  related: [
    'ep:POST /api/ops/movements/:requestId/reverse',
    REVERSE,
    'be:money/movements#reverseLedgerEntries',
    'sh:operations#isRequestReversed',
    'op:components/RequestDetailPanel',
    'op:components/RequestDetailPanel#handleReverse',
    'op:lib/opsApi#reverseMovement',
    'op:lib/OpsDataContext#reverse',
    'db:LedgerEntry',
    'db:OperationsRequest',
    'db:AuditLog',
    'feat:external-movements',
    'feat:audit',
    'feat:balances',
  ],
  variants: [
    { id: 'reversed', label: 'Reversed', description: 'The posted entry becomes reversed and the $120.00 returns to the customer\'s derived balance.', outcome: 'success' },
    { id: 'nothing-to-reverse', label: 'Nothing to reverse', description: 'Another operator already reversed it; the second attempt gets 409 nothing_to_reverse.', outcome: 'failed' },
  ],
  defaultVariant: 'reversed',
  initialState: {
    ...base,
    LedgerEntry: base.LedgerEntry.map((row) => (row.id === ENTRY ? { ...row, status: 'posted', postedAt: NOW } : row)),
    SimulationClock: [{ id: 'singleton', currentTime: SIM_NOW, speed: 1 }],
    OperationsRequest: [
      {
        id: REQ,
        type: 'bill_pay',
        status: 'approved',
        priority: 'normal',
        summary: REQUEST_DTO.summary,
        detail: REQUEST_DTO.detail,
        subjectName: 'Avery Customer',
        subjectEmail: 'avery.customer@example.com',
        payload: JSON.stringify(STORED_PAYLOAD),
        lastAction: 'approve',
        lastActorId: IDS.sam,
        lastActorRole: 'ops_agent',
        lastActorName: 'Sam Operator',
        lastActionNote: null,
        resolvedAt: NOW,
        createdAt: CREATED,
        updatedAt: NOW,
      },
    ],
    AuditLog: [
      { id: 'aud_001', actorId: IDS.avery, actorRole: 'customer', action: 'ops_request_created', entity: 'operations_request', entityId: REQ, reason: 'Bill payment — City Power & Light ($120.00) — submitted by Avery Customer (simulated)', metadata: JSON.stringify({ reference: 'MOV-4F9A2C', kind: 'bill_pay', ledgerEntryId: ENTRY }), createdAt: '2026-10-01T14:44:09.000Z' },
      { id: 'aud_002', actorId: IDS.sam, actorRole: 'ops_agent', action: 'ops_approve', entity: 'operations_request', entityId: REQ, reason: null, metadata: JSON.stringify({ action: 'approve', actorName: 'Sam Operator', fromStatus: 'pending', toStatus: 'approved' }), createdAt: '2026-10-01T15:04:12.000Z' },
      { id: 'aud_003', actorId: IDS.sam, actorRole: 'ops_agent', action: 'movement_posted', entity: 'ledger_entry', entityId: ENTRY, reason: 'Posted Bill payment $120.00 (simulated)', metadata: JSON.stringify({ ...NORMALIZED, posted: 1, actorName: 'Sam Operator' }), createdAt: '2026-10-01T15:04:12.000Z' },
    ],
    SimulatedEvent: [
      { id: 'evt_001', channel: 'email', direction: 'outbound', kind: 'movement_received', status: 'sent', summary: 'Bill payment received — under review (simulated)', detail: 'Simulated confirmation that MOV-4F9A2C ($120.00) was received and is awaiting operator review.', requestId: REQ, metadata: null, createdAt: CREATED },
      { id: 'evt_002', channel: 'email', direction: 'outbound', kind: 'movement_posted', status: 'sent', summary: 'Bill payment posted — $120.00 (simulated)', detail: 'SIMULATION — no real money network or provider was contacted.', requestId: REQ, metadata: null, createdAt: NOW },
    ],
    Session: [{ id: 'ses_sam', userId: IDS.sam, tokenHash: '<sha-256 of the mer_ops_session token>', createdAt: '2026-10-01T14:55:00.000Z', lastSeenAt: '2026-10-01T15:20:10.000Z', expiresAt: '2026-10-01T23:20:10.000Z', revokedAt: null }],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    src(FILES.routesOps, 195, 225, "app.post('/api/ops/movements/:requestId/reverse'"),
    src(FILES.movements, 513, 569, 'export async function reverseMovement'),
    src('apps/backend/src/routes/money.test.ts', 330, 395, "describe('POST /api/ops/movements/:requestId/reverse'"),
  ],
};
