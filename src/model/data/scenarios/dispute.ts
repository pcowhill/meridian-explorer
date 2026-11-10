import type { Scenario, ScenarioStep, SourceRef } from '../../types';
import { baseState, IDS, NOW } from '../fixtures';

/**
 * "What happens when a customer disputes a charge?"
 *
 * Avery disputes the posted $48.90 QuickFuel card charge (fixture row le_002) on
 * Everyday Checking from the account's transaction list. Filing flags the entry
 * `disputed` and opens a `dispute` operations request; Sam then upholds
 * (the entry is reversed) or denies (the entry returns to `posted`). A third
 * variant shows the rule that refuses an internal-transfer leg.
 */

// ---- Source files -----------------------------------------------------------
const F = {
  txnList: 'apps/customer/src/components/TransactionList.tsx',
  accountDetail: 'apps/customer/src/pages/AccountDetail.tsx',
  libRisk: 'apps/customer/src/lib/risk.ts',
  routesRisk: 'apps/backend/src/routes/risk.ts',
  shRisk: 'packages/shared/src/risk.ts',
  disputes: 'apps/backend/src/risk/disputes.ts',
  access: 'apps/backend/src/auth/access.ts',
  movements: 'apps/backend/src/money/movements.ts',
  shLedger: 'packages/shared/src/ledger.ts',
  shTxn: 'packages/shared/src/transactions.ts',
  ops: 'apps/backend/src/ops/requests.ts',
  routesOps: 'apps/backend/src/routes/ops.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  opApi: 'apps/operations/src/lib/opsApi.ts',
  opData: 'apps/operations/src/lib/OpsDataContext.tsx',
  opQueues: 'apps/operations/src/pages/RequestQueues.tsx',
  opDetail: 'apps/operations/src/components/RequestDetailPanel.tsx',
  opQueueCard: 'apps/operations/src/components/QueueRequestCard.tsx',
  shOps: 'packages/shared/src/operations.ts',
  testRoutes: 'apps/backend/src/routes/cards-risk.test.ts',
  testE2e: 'e2e/cards-fraud-disputes.spec.ts',
} as const;

const s = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

// ---- Lanes ------------------------------------------------------------------
const CUSTOMER = 'role:customer';
const TXN = 'cu:components/TransactionList';
const ROUTES = 'be:routes/risk';
const DISPUTES = 'be:risk/disputes';
const LEDGER = 'db:LedgerEntry';
const REQ = 'db:OperationsRequest';
const QUEUES = 'op:pages/RequestQueues';
const APPLY = 'be:ops/requests#applyOperatorAction';

// ---- Variants ---------------------------------------------------------------
const UP = 'upheld';
const DN = 'denied';
const ND = 'not-disputable';
const FILED = [UP, DN];

// ---- Example data -----------------------------------------------------------
const ENTRY = 'le_002';
const TRANSFER_LEG = 'le_005';
const REQ_ID = 'req_dispute';
/** AuditLog.createdAt is the database default (wall clock), not the simulated time. */
const WALL_FILED = '2026-10-01T15:02:10.000Z';
const WALL_DECIDED = '2026-10-01T15:09:42.000Z';
const SIM_DETAIL = 'SIMULATION — no real money network or provider was contacted.';

const DETAILS = 'I was not driving that day.';
const SUMMARY = 'Disputed transaction — QuickFuel ($48.90)';
const DETAIL = `Customer disputes "QuickFuel" ($48.90): I don't recognize this charge. Notes: ${DETAILS} Resolving APPROVE reverses the charge; REJECT lets it stand (simulated).`;

/** The payload exactly as `createDispute` stores it. */
const FILED_PAYLOAD = {
  ledgerEntryId: ENTRY,
  accountId: IDS.checking,
  amountMinor: 4890,
  reason: 'not_recognized',
  details: DETAILS,
  description: 'QuickFuel',
};
/** What `disputePayloadOf` → `asDisputePayload` returns (it adds `resolution` and `reversed`). */
const PARSED_PAYLOAD = { ...FILED_PAYLOAD, resolution: null as string | null, reversed: false };
const resolvedPayload = (resolution: 'upheld' | 'denied') => ({ ...FILED_PAYLOAD, resolution, reversed: resolution === 'upheld' });

const requestDto = (over: Record<string, unknown> = {}) => ({
  id: REQ_ID,
  type: 'dispute',
  status: 'pending',
  priority: 'normal',
  summary: SUMMARY,
  detail: DETAIL,
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: FILED_PAYLOAD as Record<string, unknown>,
  lastAction: null,
  lastActorName: null,
  lastActionNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
  ...over,
});

const CSRF_HEADERS = { 'Content-Type': 'application/json', 'x-meridian-csrf': '<value of the mer_csrf cookie>' };

// ---- Operator decision (shared shape for uphold / deny) ---------------------

function decisionSteps(variant: typeof UP | typeof DN): ScenarioStep[] {
  const up = variant === UP;
  const action = up ? 'approve' : 'reject';
  const toStatus = up ? 'approved' : 'rejected';
  const p = up ? 'u' : 'd';
  const after = resolvedPayload(up ? 'upheld' : 'denied');
  const amount = '$48.90';
  const auditReason = up ? `Dispute upheld — reversed ${amount} (simulated)` : `Dispute denied — charge stands ${amount} (simulated)`;
  const eventSummary = up ? `Dispute upheld — ${amount} refunded (simulated)` : `Dispute denied — charge stands ${amount} (simulated)`;
  const v = [variant];

  const steps: ScenarioStep[] = [
    {
      id: `${p}-click`,
      kind: 'ui',
      title: up ? 'Sam approves: uphold the dispute' : 'Sam rejects: deny the dispute',
      from: QUEUES,
      to: QUEUES,
      label: up ? 'Sam clicks "Approve"' : 'Sam clicks "Reject"',
      narrative: `Sam Operator clicks ${up ? 'Approve' : 'Reject'} on the dispute card. It is the generic action bar every queue item has; \`runAction\` calls the data context's \`act('${REQ_ID}', '${action}')\`, which calls \`applyOpsAction\`.`,
      audience: {
        executive: up ? 'A member of staff agrees with the customer and upholds the dispute.' : 'A member of staff decides the charge was valid and denies the dispute.',
        'end-user': up ? 'A bank employee upholds your dispute.' : 'A bank employee denies your dispute.',
      },
      detail: 1,
      variants: v,
      sources: [s(F.opQueues, 59, 73, 'await act(id, action)'), s(F.opData, 104, 111, 'applyOpsAction(id, action, note)')],
    },
    {
      id: `${p}-request`,
      kind: 'request',
      title: 'POST the operator action',
      from: QUEUES,
      to: APPLY,
      label: `POST /api/ops/requests/:id/action { ${action} }`,
      narrative: `The operations console posts to the generic action endpoint with the operations session cookie and the CSRF header. The route runs \`requireAuth\`, \`requireRole('ops_agent', 'admin')\` and \`rateLimit('operations')\`, checks \`isOpsAction(body.action)\`, then calls \`applyOperatorAction(prisma, { id, action, note, actor }, simulationNow)\`.`,
      audience: { systems: 'A staff-only endpoint on the operations cookie surface. A customer session gets 403 here.' },
      detail: 3,
      variants: v,
      payload: {
        title: 'Request',
        format: 'http-request',
        line: `POST /api/ops/requests/${REQ_ID}/action`,
        headers: CSRF_HEADERS,
        data: { action },
        typeRef: 'sh:operations#OperatorActionRequest',
        highlight: ['action'],
      },
      sources: [s(F.opApi, 50, 61, 'export async function applyOpsAction'), s(F.routesOps, 122, 146, "app.post('/api/ops/requests/:id/action'"), s(F.routesOps, 56, 56, "rateLimit('operations')")],
    },
    {
      id: `${p}-load`,
      kind: 'db-read',
      title: 'Load the request; is it still actionable?',
      from: APPLY,
      to: REQ,
      label: 'findUnique + canApplyAction',
      narrative: `\`applyOperatorAction\` loads the request (404 \`not_found\` if missing) and checks \`canApplyAction('pending', '${action}')\` — a decision on an approved or rejected request is refused with 409 \`already_resolved\`. The row loaded here (\`existing\`) is what the dispute service later reads the payload from.`,
      detail: 4,
      variants: v,
      sources: [s(F.ops, 235, 239, 'prisma.operationsRequest.findUnique'), s(F.ops, 274, 279, 'canApplyAction(currentStatus, input.action)')],
    },
    {
      id: `${p}-status`,
      kind: 'db-write',
      title: `Transaction opens: request → ${toStatus}`,
      from: APPLY,
      to: REQ,
      label: `tx: status → '${toStatus}' + ops_${action} audit`,
      narrative: `The request's type is \`dispute\` and the action is ${action}, so the dispute branch opens \`prisma.$transaction\`. It first writes the decision bookkeeping (\`status: '${toStatus}'\`, last-action fields, \`resolvedAt\`) and the generic \`ops_${action}\` audit row. Everything that follows runs in the same transaction.`,
      audience: {
        dba: 'UPDATE OperationsRequest (status, lastAction, lastActorId, lastActorRole, lastActorName, lastActionNote, resolvedAt, updatedAt) + INSERT AuditLog, inside one interactive transaction that stays open for the next steps.',
      },
      detail: 3,
      variants: v,
      effects: [
        {
          op: 'update',
          table: 'OperationsRequest',
          id: REQ_ID,
          set: { status: toStatus, lastAction: action, lastActorId: IDS.sam, lastActorRole: 'ops_agent', lastActorName: 'Sam Operator', lastActionNote: null, resolvedAt: NOW, updatedAt: NOW },
        },
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: `aud_ops_${action}`,
            actorId: IDS.sam,
            actorRole: 'ops_agent',
            action: `ops_${action}`,
            entity: 'operations_request',
            entityId: REQ_ID,
            reason: null,
            metadata: JSON.stringify({ action, actorName: 'Sam Operator', fromStatus: 'pending', toStatus }),
            createdAt: WALL_DECIDED,
          },
        },
      ],
      sources: [s(F.ops, 359, 372, "existing.type === 'dispute'"), s(F.ops, 280, 290, 'const decisionData'), s(F.ops, 243, 256, 'const auditFor')],
    },
    {
      id: `${p}-call`,
      kind: 'call',
      title: 'Hand over to the dispute service',
      from: APPLY,
      to: DISPUTES,
      label: up ? 'upholdDispute(tx, existing, actor, now)' : 'denyDispute(tx, existing, actor, now)',
      narrative: `Still inside the transaction, \`applyOperatorAction\` calls \`${up ? 'upholdDispute' : 'denyDispute'}\`. It parses the payload with \`disputePayloadOf\` (type must be \`dispute\`, payload must carry a \`ledgerEntryId\`; otherwise the decision is workflow-only and nothing else is written). Here it finds \`ledgerEntryId: '${ENTRY}'\`.`,
      detail: 3,
      variants: v,
      payload: {
        title: 'Parsed payload',
        format: 'args',
        data: { request: { id: REQ_ID, payload: PARSED_PAYLOAD }, actor: { id: IDS.sam, role: 'ops_agent', displayName: 'Sam Operator' }, now: NOW },
        typeRef: 'sh:risk#DisputePayload',
        highlight: ['request.payload.ledgerEntryId'],
      },
      sources: up
        ? [s(F.disputes, 164, 174, 'export async function upholdDispute'), s(F.disputes, 44, 53, 'export function disputePayloadOf'), s(F.shRisk, 151, 165, 'export function asDisputePayload')]
        : [s(F.disputes, 212, 219, 'export async function denyDispute'), s(F.disputes, 44, 53, 'export function disputePayloadOf')],
    },
    up
      ? {
          id: 'u-reverse',
          kind: 'db-write',
          title: 'The charge is reversed',
          from: DISPUTES,
          to: LEDGER,
          label: "reverseLedgerEntries(['le_002']) → 'reversed'",
          narrative:
            "`reverseLedgerEntries(tx, ['le_002'])` runs one `updateMany`: entries with that id whose status is `posted` or `disputed` become `reversed`. It returns 1. No compensating credit is written and no balance is edited — derived balances ignore `reversed` entries, so the $48.90 stops counting the next time Everyday Checking is read.",
          audience: {
            executive: 'The $48.90 charge is cancelled and the money is back in the customer’s account.',
            'end-user': 'The QuickFuel charge is reversed — the $48.90 is back in your balance.',
            dba: "UPDATE LedgerEntry SET status = 'reversed' WHERE id IN ('le_002') AND status IN ('posted','disputed'). One row. The row is kept for history.",
          },
          detail: 1,
          variants: v,
          payload: { title: 'LedgerEntry le_002', format: 'row', data: { id: ENTRY, accountId: IDS.checking, amountMinor: 4890, direction: 'debit', status: 'reversed', origin: 'card', description: 'QuickFuel' }, typeRef: 'db:LedgerEntry', highlight: ['status'] },
          effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'reversed' } }],
          sources: [s(F.disputes, 176, 176, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])'), s(F.movements, 389, 404, 'export async function reverseLedgerEntries'), s(F.shLedger, 125, 128, "case 'reversed'")],
        }
      : {
          id: 'd-restore',
          kind: 'db-write',
          title: 'The charge stands: entry back to posted',
          from: DISPUTES,
          to: LEDGER,
          label: "updateMany disputed → 'posted'",
          narrative:
            "`denyDispute` runs `updateMany({ where: { id: 'le_002', status: 'disputed' }, data: { status: 'posted' } })`. The `status: 'disputed'` filter makes it a no-op if the entry has meanwhile left `disputed`. `postedAt` is not touched, so the entry keeps its original settlement date. Balances do not move: `disputed` already counted as posted.",
          audience: {
            executive: 'The charge stands. The transaction simply loses its "under dispute" flag.',
            'end-user': 'The QuickFuel charge stays on your account.',
            dba: "UPDATE LedgerEntry SET status = 'posted' WHERE id = 'le_002' AND status = 'disputed'. One row; postedAt unchanged.",
          },
          detail: 1,
          variants: v,
          payload: { title: 'LedgerEntry le_002', format: 'row', data: { id: ENTRY, accountId: IDS.checking, amountMinor: 4890, direction: 'debit', status: 'posted', origin: 'card', description: 'QuickFuel', postedAt: '2026-09-09T12:00:00.000Z' }, typeRef: 'db:LedgerEntry', highlight: ['status'] },
          effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'posted' } }],
          sources: [s(F.disputes, 221, 224, "where: { id: payload.ledgerEntryId, status: 'disputed' }")],
        },
    {
      id: `${p}-payload`,
      kind: 'db-write',
      title: up ? 'Mark the request upheld and reversed' : 'Mark the request denied',
      from: DISPUTES,
      to: REQ,
      label: up ? "payload.resolution = 'upheld', reversed = true" : "payload.resolution = 'denied', reversed = false",
      narrative: up
        ? "The request's payload is rewritten as the parsed payload plus `resolution: 'upheld'` and `reversed: reversedCount > 0` (true). `payload.reversed` is what makes the operations console add a \"Reversed\" tag next to \"Approved\"."
        : "The request's payload is rewritten with `resolution: 'denied'` and `reversed: false`. No \"Reversed\" tag will appear.",
      audience: { dba: 'A second UPDATE of the same OperationsRequest row in this transaction, changing only payload and updatedAt.' },
      detail: 3,
      variants: v,
      payload: { title: 'OperationsRequest.payload', format: 'row', data: after, typeRef: 'sh:risk#DisputePayload', highlight: ['resolution', 'reversed'] },
      effects: [{ op: 'update', table: 'OperationsRequest', id: REQ_ID, set: { payload: JSON.stringify(after), updatedAt: NOW } }],
      sources: up ? [s(F.disputes, 177, 181, "resolution: 'upheld'"), s(F.shOps, 345, 354, 'export function isRequestReversed')] : [s(F.disputes, 225, 229, "resolution: 'denied'")],
    },
    {
      id: `${p}-trail`,
      kind: 'db-write',
      title: 'Audit row and simulated email',
      from: DISPUTES,
      to: DISPUTES,
      label: `writeAudit '${up ? 'dispute_upheld' : 'dispute_denied'}' + recordSimEvent`,
      narrative: `\`writeAudit\` records \`${up ? 'dispute_upheld' : 'dispute_denied'}\` ("${auditReason}") against the LEDGER ENTRY (\`entity: 'ledger_entry'\`, \`entityId: '${ENTRY}'\`), with the parsed payload${up ? ' plus `reversedCount: 1`' : ''} as metadata. \`recordSimEvent\` inserts an outbound email event, "${eventSummary}". No email is sent. The transaction commits.`,
      audience: {
        executive: 'The decision and who made it are written to the audit trail; a (simulated) email to the customer is recorded.',
        dba: 'Two inserts, then COMMIT. Because the audit row is keyed to the ledger entry, not the request, it does not appear in the request’s History in the console.',
      },
      detail: 4,
      variants: v,
      effects: [
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: up ? 'aud_dispute_upheld' : 'aud_dispute_denied',
            actorId: IDS.sam,
            actorRole: 'ops_agent',
            action: up ? 'dispute_upheld' : 'dispute_denied',
            entity: 'ledger_entry',
            entityId: ENTRY,
            reason: auditReason,
            metadata: JSON.stringify(up ? { ...PARSED_PAYLOAD, reversedCount: 1, actorName: 'Sam Operator' } : { ...PARSED_PAYLOAD, actorName: 'Sam Operator' }),
            createdAt: WALL_DECIDED,
          },
        },
        {
          op: 'insert',
          table: 'SimulatedEvent',
          row: {
            id: up ? 'sev_dispute_upheld' : 'sev_dispute_denied',
            channel: 'email',
            direction: 'outbound',
            kind: up ? 'dispute_upheld' : 'dispute_denied',
            status: 'sent',
            summary: eventSummary,
            detail: SIM_DETAIL,
            requestId: REQ_ID,
            metadata: null,
            createdAt: NOW,
          },
        },
      ],
      sources: up
        ? [s(F.disputes, 183, 203, "action: 'dispute_upheld'"), s(F.movements, 134, 161, 'export async function recordSimEvent')]
        : [s(F.disputes, 231, 251, "action: 'dispute_denied'"), s(F.movements, 134, 161, 'export async function recordSimEvent')],
    },
    {
      id: `${p}-response`,
      kind: 'response',
      title: up ? '200 — "Approved" and "Reversed"' : '200 — "Rejected"',
      from: APPLY,
      to: QUEUES,
      label: '200 { request } + ops:request_changed',
      narrative: up
        ? '`applyOperatorAction` returns the request as rewritten by `upholdDispute` and the email event. The route pushes `ops:request_changed` (`updated`) and `ops:external_event` to the operators’ room, then replies 200. The queue card shows "Approved" plus a "Reversed" tag (`isRequestReversed(payload)` is true); the detail panel adds "Resolution: Upheld".'
        : '`applyOperatorAction` returns the request as rewritten by `denyDispute` and the email event. The route pushes `ops:request_changed` and `ops:external_event` to the operators’ room and replies 200. The queue card reads "Rejected" with no "Reversed" tag; the detail panel shows "Resolution: Denied".',
      audience: { systems: 'HTTP 200 to the acting operator; Socket.IO broadcast to every console in the `ops` room. Nothing is pushed to the customer app.' },
      detail: 3,
      variants: v,
      payload: {
        title: 'Response',
        format: 'http-response',
        line: '200 OK',
        data: { request: requestDto({ status: toStatus, payload: after, lastAction: action, lastActorName: 'Sam Operator', resolvedAt: NOW }) },
        typeRef: 'sh:operations#OperatorActionResponse',
        highlight: ['request.status', 'request.payload.resolution', 'request.payload.reversed'],
      },
      sources: up
        ? [s(F.ops, 371, 371, 'events: result.events'), s(F.routesOps, 147, 151, "requestChanged('updated', request)"), s(F.opQueueCard, 54, 57, 'isRequestReversed(request.payload)'), s(F.testE2e, 88, 104, 'an operator upholds the seeded dispute')]
        : [s(F.ops, 371, 371, 'events: result.events'), s(F.routesOps, 147, 151, "requestChanged('updated', request)"), s(F.opDetail, 414, 421, "'Upheld' : 'Denied'")],
    },
  ];
  return steps;
}

// ---- Steps -------------------------------------------------------------------

const steps: ScenarioStep[] = [
  {
    id: 'start',
    kind: 'note',
    title: 'Starting point: a posted QuickFuel charge',
    from: LEDGER,
    to: LEDGER,
    label: 'le_002 posted · card · $48.90',
    narrative:
      'Everyday Checking holds a `posted` card debit of $48.90 at QuickFuel (`origin: card`), a $200.00 transfer to Goal Savings (a `transfer` leg, posted) and a `pending` $120.00 bill payment. Derived balances: $2,251.10 current and $2,131.10 available (the pending bill payment is reserved out of available).',
    audience: {
      executive: 'A customer sees a $48.90 fuel charge she does not recognise on her checking account.',
      'end-user': 'You see a $48.90 QuickFuel charge you don’t recognise.',
      dba: 'No balance column exists anywhere: balances are summed from LedgerEntry rows by status on every read.',
    },
    detail: 2,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { currentMinor: 225110, availableMinor: 213110, pendingDebitMinor: 12000 }, typeRef: 'sh:ledger#DerivedBalances', highlight: ['currentMinor', 'availableMinor'] },
    sources: [s(F.shLedger, 79, 90, 'export function deriveBalances')],
  },
  {
    id: 'open-account',
    kind: 'ui',
    title: 'Avery opens Everyday Checking',
    from: CUSTOMER,
    to: TXN,
    label: 'transaction list with "Dispute" links',
    narrative:
      'The account page renders `TransactionList` with the rows from `GET /api/accounts/:id/transactions`. Each row offers a "Dispute" link only when `txn.status === \'posted\'` and the row is not already disputed — so the QuickFuel charge and the transfer leg both show it, the pending bill payment does not.',
    audience: { 'end-user': 'On the account page each settled transaction has a small "Dispute" link.' },
    detail: 2,
    sources: [s(F.accountDetail, 276, 279, '<TransactionList'), s(F.txnList, 170, 171, "const canDispute = txn.status === 'posted' && !disputed"), s(F.txnList, 205, 213, 'Dispute')],
  },
  {
    id: 'which-entry',
    kind: 'decision',
    title: 'Which transaction does Avery dispute?',
    from: CUSTOMER,
    to: TXN,
    label: 'card charge / transfer leg',
    narrative: 'The browser only hides the link on non-posted rows. The server applies the full rules: the caller must have customer access to the account, the entry must be `posted`, and it must not be an internal `transfer` leg.',
    detail: 2,
    decision: {
      question: 'Which row does the customer dispute?',
      options: [
        { label: 'The QuickFuel card charge', variant: UP, description: 'Filed; an operator later upholds it (the charge is reversed).' },
        { label: 'The QuickFuel card charge (operator denies)', variant: DN, description: 'Filed; an operator later denies it (the charge stands).' },
        { label: 'The "Transfer to Goal Savings" leg', variant: ND, description: 'Refused with 400 invalid_state: an internal transfer cannot be disputed.' },
      ],
    },
    sources: [s(F.disputes, 79, 90, "entry.origin === 'transfer'")],
  },

  // ---- Filing (upheld / denied) ---------------------------------------------
  {
    id: 'f-form',
    kind: 'ui',
    title: 'Avery files the dispute',
    from: CUSTOMER,
    to: TXN,
    label: 'reason + details → "File dispute"',
    narrative:
      'Avery clicks "Dispute" on the QuickFuel row. An inline form opens with a reason select built from the shared `DISPUTE_REASONS` and an optional details box capped at 280 characters. She picks "I don\'t recognize this charge", adds a note and clicks "File dispute".',
    audience: {
      executive: 'The customer disputes the charge from her transaction history, choosing a reason.',
      'end-user': 'You click "Dispute", choose "I don\'t recognize this charge", add a note and click "File dispute".',
    },
    detail: 1,
    variants: FILED,
    sources: [s(F.txnList, 106, 119, 'DISPUTE_REASONS.map'), s(F.txnList, 126, 135, 'DISPUTE_TEXT.detailsMaxLength'), s(F.shRisk, 74, 95, 'DISPUTE_REASON_LABELS')],
  },
  {
    id: 'f-client',
    kind: 'client',
    title: 'Validate in the browser, then call the client helper',
    from: TXN,
    to: TXN,
    label: 'validateDispute → fileDispute(check.value)',
    narrative:
      '`DisputeForm.handleSubmit` runs the same shared `validateDispute` the server uses (a non-empty `ledgerEntryId`, a reason from the list; details trimmed and cut to 280 characters, or `null`). On success it calls `fileDispute(check.value)` from `lib/risk.ts`, which never throws — failures come back as `{ ok: false, code, message, fields }`.',
    detail: 4,
    variants: FILED,
    payload: { title: 'validateDispute → value', format: 'return', data: { ok: true, errors: {}, value: { ledgerEntryId: ENTRY, reason: 'not_recognized', details: DETAILS } }, typeRef: 'sh:risk#NormalizedDispute' },
    sources: [s(F.txnList, 67, 86, 'validateDispute({ ledgerEntryId, reason, details })'), s(F.shRisk, 112, 133, 'export function validateDispute')],
  },
  {
    id: 'f-request',
    kind: 'request',
    title: 'POST the dispute',
    from: TXN,
    to: ROUTES,
    label: 'POST /api/disputes',
    narrative: 'The client sends the normalized dispute as JSON with the customer session cookie (`credentials: \'include\'`) and the CSRF double-submit header.',
    detail: 3,
    variants: FILED,
    payload: {
      title: 'Request',
      format: 'http-request',
      line: 'POST /api/disputes',
      headers: CSRF_HEADERS,
      data: { ledgerEntryId: ENTRY, reason: 'not_recognized', details: DETAILS },
      typeRef: 'sh:risk#DisputeRequest',
      highlight: ['ledgerEntryId', 'reason'],
    },
    sources: [s(F.libRisk, 111, 118, 'export function fileDispute'), s(F.libRisk, 31, 38, 'csrfHeaders()')],
  },
  {
    id: 'f-guards',
    kind: 'guard',
    title: 'CSRF, session, rate limit, body check',
    from: ROUTES,
    to: ROUTES,
    label: "csrfHook → requireAuth → rateLimit('risk') → validateDispute",
    narrative:
      'The global hooks check the CSRF header (403) and, in public-demo mode, the mutation valve. `requireAuth` resolves the session to Avery (401 otherwise) and `rateLimit(\'risk\')` applies only when abuse limits are on. The handler cuts `ledgerEntryId` and `details` to 400 characters and runs `validateDispute` again; a failure is `400 invalid_request` with per-field messages.',
    detail: 4,
    variants: FILED,
    sources: [s(F.routesRisk, 37, 52, "rateLimit('risk')"), s(F.routesRisk, 26, 26, 'MAX_FIELD = 400')],
  },
  {
    id: 'f-load',
    kind: 'db-read',
    title: 'Load the entry and check it can be disputed',
    from: DISPUTES,
    to: LEDGER,
    label: 'findUnique + access + posted + not transfer',
    narrative:
      "`createDispute(req.user, value, simulationNow)` loads the entry (404 `not_found` if missing), then `getAccountRelationship` for Avery on its account: `owner`, `joint` or `authorized` pass, anything else is 403 `forbidden`. The entry must be `posted` and its origin must not be `transfer` (both 400 `invalid_state`). Nothing checks direction or any other origin, so a posted credit — for example the opening deposit — passes these checks too. The QuickFuel debit passes.",
    audience: { dba: 'One primary-key read of LedgerEntry and one AccountAccess lookup by (userId, accountId), falling back to Account.userId.' },
    detail: 4,
    variants: FILED,
    sources: [
      s(F.disputes, 64, 90, 'export async function createDispute'),
      s(F.disputes, 41, 41, 'CUSTOMER_RELATIONSHIPS'),
      s(F.access, 72, 88, 'export async function getAccountRelationship'),
    ],
  },
  {
    id: 'f-flag',
    kind: 'db-write',
    title: 'The entry is flagged disputed',
    from: DISPUTES,
    to: LEDGER,
    label: "tx: le_002 status → 'disputed'",
    narrative:
      "One `prisma.$transaction` holds every write of the filing. First: `ledgerEntry.update({ status: 'disputed' })`. The money does not move — `deriveBalances` treats `disputed` exactly like `posted`, so current and available stay $2,251.10 / $2,131.10, and the shared `groupForStatus` keeps the row in the Posted group.",
    audience: {
      executive: 'The bank flags the transaction as under dispute. The money stays where it is until someone decides.',
      'end-user': 'The charge is marked "Disputed". Your balance does not change yet.',
      dba: "UPDATE LedgerEntry SET status = 'disputed' WHERE id = 'le_002'. Same row, same amount; no balance column exists to touch.",
    },
    detail: 1,
    variants: FILED,
    payload: { title: 'LedgerEntry le_002', format: 'row', data: { id: ENTRY, accountId: IDS.checking, amountMinor: 4890, direction: 'debit', status: 'disputed', origin: 'card', description: 'QuickFuel' }, typeRef: 'db:LedgerEntry', highlight: ['status'] },
    effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'disputed' } }],
    sources: [s(F.disputes, 106, 108, "data: { status: 'disputed' }"), s(F.shLedger, 103, 110, "case 'disputed'"), s(F.shTxn, 60, 64, "status === 'disputed'")],
  },
  {
    id: 'f-case',
    kind: 'db-write',
    title: 'A dispute request joins the operations queue',
    from: DISPUTES,
    to: REQ,
    label: "create OperationsRequest type 'dispute'",
    narrative:
      "Same transaction: a `pending`, `normal`-priority OperationsRequest of type `dispute`. Its summary and detail are built from the entry's description, the formatted amount and the reason label; the subject is Avery (name and email, not a foreign key). The JSON payload soft-links the entry: `ledgerEntryId`, `accountId`, `amountMinor`, `reason`, `details`, `description`. `createdAt`/`updatedAt` are the simulated time.",
    audience: {
      executive: 'A case is opened in the operations team’s queue.',
      dba: 'INSERT OperationsRequest. payload is a JSON string; ledgerEntryId inside it is not a foreign key.',
    },
    detail: 3,
    variants: FILED,
    payload: { title: 'OperationsRequest.payload', format: 'row', data: FILED_PAYLOAD, typeRef: 'sh:risk#DisputePayload', highlight: ['ledgerEntryId', 'reason'] },
    effects: [
      {
        op: 'insert',
        table: 'OperationsRequest',
        row: {
          id: REQ_ID,
          type: 'dispute',
          status: 'pending',
          priority: 'normal',
          summary: SUMMARY,
          detail: DETAIL,
          subjectName: 'Avery Customer',
          subjectEmail: 'avery.customer@example.com',
          payload: JSON.stringify(FILED_PAYLOAD),
          lastAction: null,
          lastActorId: null,
          lastActorRole: null,
          lastActorName: null,
          lastActionNote: null,
          resolvedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    ],
    sources: [s(F.disputes, 92, 104, 'const payload: DisputePayload'), s(F.disputes, 110, 123, 'tx.operationsRequest.create')],
  },
  {
    id: 'f-trail',
    kind: 'db-write',
    title: 'Intake audit row and simulated email',
    from: DISPUTES,
    to: DISPUTES,
    label: "writeAudit 'ops_request_created' + recordSimEvent",
    narrative:
      '`writeAudit` inserts the intake row (`ops_request_created` on the request, actor Avery) — the console\'s History shows it as "Created". `recordSimEvent` inserts an outbound email event "Dispute received — under review (simulated)". The transaction commits; `createDispute` returns the request DTO and the event.',
    audience: { dba: 'Two inserts, then COMMIT. AuditLog.createdAt is the database default (wall clock); SimulatedEvent.createdAt is the simulated time passed in.' },
    detail: 4,
    variants: FILED,
    effects: [
      {
        op: 'insert',
        table: 'AuditLog',
        row: {
          id: 'aud_dispute_created',
          actorId: IDS.avery,
          actorRole: 'customer',
          action: 'ops_request_created',
          entity: 'operations_request',
          entityId: REQ_ID,
          reason: `${SUMMARY} — filed by Avery Customer (simulated)`,
          metadata: JSON.stringify({ ledgerEntryId: ENTRY, reason: 'not_recognized' }),
          createdAt: WALL_FILED,
        },
      },
      {
        op: 'insert',
        table: 'SimulatedEvent',
        row: {
          id: 'sev_dispute_received',
          channel: 'email',
          direction: 'outbound',
          kind: 'dispute_received',
          status: 'sent',
          summary: 'Dispute received — under review (simulated)',
          detail: 'Simulated confirmation that a dispute for $48.90 was received and is under review.',
          requestId: REQ_ID,
          metadata: null,
          createdAt: NOW,
        },
      },
    ],
    sources: [s(F.disputes, 125, 151, "action: 'ops_request_created'")],
  },
  {
    id: 'f-push',
    kind: 'event',
    title: 'Operators see the new case immediately',
    from: ROUTES,
    to: QUEUES,
    label: 'ops:request_changed (created) + ops:external_event',
    narrative:
      "The handler calls `app.opsRealtime.requestChanged('created', request)` and `externalEvent(event)`. Both go only to the Socket.IO `ops` room. Every open operations console upserts the new request — it lands in the \"Fraud & disputes\" lane as a \"Transaction dispute\" — and prepends the email event to its feed.",
    audience: {
      executive: 'The case appears on the operations team’s screens straight away.',
      systems: 'Two Socket.IO emits to the staff-only `ops` room; customer sockets are never in that room.',
    },
    detail: 2,
    variants: FILED,
    payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed', data: { change: 'created', request: requestDto() }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['change', 'request.type'] },
    sources: [s(F.routesRisk, 55, 56, "requestChanged('created', created.request)"), s(F.opsRealtime, 42, 45, 'OPS_REALTIME_ROOM'), s(F.opData, 96, 98, 'onRequestChanged'), s(F.shOps, 209, 209, "types: ['fraud_alert', 'dispute']")],
  },
  {
    id: 'f-response',
    kind: 'response',
    title: '201 — dispute filed',
    from: ROUTES,
    to: TXN,
    label: '201 { ok, message, requestId }',
    narrative: 'The customer gets a short confirmation with the request id. The client wraps it as `{ ok: true, data }`; the form closes and tells the list the entry was disputed.',
    detail: 3,
    variants: FILED,
    payload: {
      title: 'Response',
      format: 'http-response',
      line: '201 Created',
      data: { ok: true, message: 'Your dispute was filed (simulated). The transaction is now flagged as disputed and is under operator review.', requestId: REQ_ID },
      typeRef: 'sh:risk#DisputeResponse',
      highlight: ['requestId'],
    },
    sources: [s(F.routesRisk, 57, 62, 'reply.code(201)'), s(F.testRoutes, 169, 183, 'files a dispute, flags the entry `disputed`')],
  },
  {
    id: 'f-badge',
    kind: 'state',
    title: 'The row shows "Disputed"; the balance does not change',
    from: TXN,
    to: CUSTOMER,
    label: '"Disputed" badge · $2,251.10 unchanged',
    narrative:
      'The list does not refetch: `markDisputed` adds the id to a local set, so the row immediately shows a red "Disputed" badge and drops the "Dispute" link. It stays in the Posted group, and Everyday Checking still reads $2,251.10 current / $2,131.10 available.',
    audience: {
      executive: 'The customer sees the charge marked as disputed. Her balance is unchanged while the case is open.',
      'end-user': 'The charge now shows "Disputed". Your balance is the same.',
    },
    detail: 2,
    variants: FILED,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { currentMinor: 225110, availableMinor: 213110 }, typeRef: 'sh:ledger#DerivedBalances' },
    sources: [s(F.txnList, 280, 288, 'markDisputed'), s(F.txnList, 188, 188, 'status="disputed"'), s(F.testE2e, 52, 64, 'a customer disputes a posted transaction')],
  },

  // ---- not-disputable --------------------------------------------------------
  {
    id: 'n-form',
    kind: 'ui',
    title: 'Avery disputes the transfer to savings',
    from: CUSTOMER,
    to: TXN,
    label: '"Dispute" on "Transfer to Goal Savings"',
    narrative: 'The $200.00 transfer leg is `posted`, so the browser offers "Dispute" on it. Avery opens the form, picks "I don\'t recognize this charge" and clicks "File dispute". Browser validation passes: it only checks the fields.',
    audience: { 'end-user': 'You try to dispute your own transfer to savings.' },
    detail: 1,
    variants: [ND],
    sources: [s(F.txnList, 170, 171, "const canDispute = txn.status === 'posted' && !disputed")],
  },
  {
    id: 'n-request',
    kind: 'request',
    title: 'POST the dispute',
    from: TXN,
    to: ROUTES,
    label: 'POST /api/disputes',
    narrative: 'Same request shape, now naming the transfer leg. It passes the CSRF check, `requireAuth`, the rate limit and `validateDispute`.',
    detail: 3,
    variants: [ND],
    payload: { title: 'Request', format: 'http-request', line: 'POST /api/disputes', headers: CSRF_HEADERS, data: { ledgerEntryId: TRANSFER_LEG, reason: 'not_recognized', details: null }, typeRef: 'sh:risk#DisputeRequest', highlight: ['ledgerEntryId'] },
    sources: [s(F.routesRisk, 39, 54, "app.post('/api/disputes'")],
  },
  {
    id: 'n-check',
    kind: 'validate',
    title: 'An internal transfer cannot be disputed',
    from: DISPUTES,
    to: LEDGER,
    label: "origin 'transfer' → DisputeError('invalid_state')",
    narrative:
      "`createDispute` loads the entry; access passes and its status is `posted`, but `entry.origin === 'transfer'`. A transfer posts both legs and must net to zero, and reversing one leg would unbalance it, so the service throws `invalid_state` before the transaction opens. Nothing is written and nothing is pushed. A `pending` entry would be refused at the previous check with the same code (\"Only a posted transaction can be disputed.\").",
    audience: {
      executive: 'Disputes are for outside merchants. A customer cannot dispute money she moved between her own accounts.',
      dba: 'Read-only: one LedgerEntry read and one access lookup. No transaction is opened.',
    },
    detail: 2,
    variants: [ND],
    sources: [s(F.disputes, 85, 90, 'An internal transfer cannot be disputed.'), s(F.testRoutes, 240, 250, 'rejects disputing an internal transfer leg'), s(F.testRoutes, 232, 238, 'rejects disputing a non-posted')],
  },
  {
    id: 'n-response',
    kind: 'response',
    title: '400 invalid_state',
    from: ROUTES,
    to: TXN,
    label: '400 { code: invalid_state }',
    narrative: 'The route maps `DisputeError` codes with `disputeHttpStatus`: `not_found` → 404, `forbidden` → 403, anything else → 400.',
    detail: 3,
    variants: [ND],
    payload: { title: 'Response', format: 'http-response', line: '400 Bad Request', data: { error: 'An internal transfer cannot be disputed.', code: 'invalid_state' }, highlight: ['code'] },
    sources: [s(F.routesRisk, 63, 68, 'disputeHttpStatus(err.code)'), s(F.routesRisk, 28, 30, 'function disputeHttpStatus')],
  },
  {
    id: 'n-banner',
    kind: 'state',
    title: 'The form shows the refusal',
    from: TXN,
    to: CUSTOMER,
    label: '"An internal transfer cannot be disputed."',
    narrative: 'The client passes the server\'s `error` text through as the message. The form stays open with a red banner; the row keeps its "Dispute" link, the entry stays `posted` and no operations request exists.',
    audience: {
      executive: 'Outcome: the request is turned away with a clear message; nothing changes.',
      'end-user': 'You see "An internal transfer cannot be disputed." Nothing changes.',
    },
    detail: 1,
    variants: [ND],
    sources: [s(F.txnList, 79, 84, 'setBanner(result.message)'), s(F.libRisk, 88, 95, "message: err?.error ?? messageForCode(code, fallback)")],
  },

  // ---- Operator review --------------------------------------------------------
  {
    id: 'ops-review',
    kind: 'ui',
    title: 'Sam reviews the dispute',
    from: QUEUES,
    to: QUEUES,
    label: 'Sam opens "Disputed transaction — QuickFuel"',
    narrative:
      'In Request queues the item sits in the "Fraud & disputes" lane. Its detail panel shows a "Disputed transaction" section — transaction, amount, reason label, the customer\'s details — and the hint "Approve = uphold (reverses the charge); Reject = deny (the charge stands)."',
    audience: {
      executive: 'A member of staff reviews the case: what was charged, and why the customer disputes it.',
      'end-user': 'A bank employee reviews your dispute.',
    },
    detail: 2,
    variants: FILED,
    sources: [s(F.opDetail, 380, 428, 'Disputed transaction'), s(F.shOps, 142, 142, "dispute: 'Transaction dispute'")],
  },
  {
    id: 'ops-choice',
    kind: 'decision',
    title: 'Uphold or deny?',
    from: QUEUES,
    to: APPLY,
    label: 'approve = uphold · reject = deny',
    narrative: 'There is no dispute-specific button. Approve and Reject on a `dispute` request are routed to the dispute service; Hold and Request info only change the workflow status and leave the entry `disputed`.',
    detail: 2,
    decision: {
      question: 'What does the operator decide?',
      options: [
        { label: 'Approve — uphold', variant: UP, description: 'The disputed entry is reversed; the money returns.' },
        { label: 'Reject — deny', variant: DN, description: 'The entry returns to posted; the charge stands.' },
      ],
    },
    variants: FILED,
    sources: [s(F.ops, 359, 372, 'Dispute resolution'), s(F.ops, 389, 393, 'All other decisions')],
  },
  ...decisionSteps(UP),
  {
    id: 'u-outcome',
    kind: 'state',
    title: 'Money back; the charge moves to "Other"',
    from: TXN,
    to: CUSTOMER,
    label: '$2,300.00 current · "Reversed"',
    narrative:
      'Nothing is pushed to the customer app. The next time Avery opens Everyday Checking, balances are re-derived without the reversed entry: $2,300.00 current, $2,180.00 available. The QuickFuel row moves to the "Other — failed or reversed — no balance effect" group with a "Reversed" badge and no "Dispute" link.',
    audience: {
      executive: 'Outcome: the customer has her $48.90 back and the case is closed, with an audit trail of who decided.',
      'end-user': 'Your balance is back up by $48.90 and the charge shows as "Reversed".',
    },
    detail: 1,
    variants: [UP],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: { currentMinor: 225110, availableMinor: 213110 }, after: { currentMinor: 230000, availableMinor: 218000 } }, typeRef: 'sh:ledger#DerivedBalances', highlight: ['after.currentMinor', 'after.availableMinor'] },
    sources: [s(F.shLedger, 125, 128, "case 'reversed'"), s(F.txnList, 386, 394, 'Failed or reversed — no balance effect'), s(F.testRoutes, 185, 207, 'operator UPHOLD reverses the disputed entry')],
  },
  ...decisionSteps(DN),
  {
    id: 'd-outcome',
    kind: 'state',
    title: 'The charge stands — and can be disputed again',
    from: TXN,
    to: CUSTOMER,
    label: 'posted again · "Dispute" offered again',
    narrative:
      'Balances never changed: $2,251.10 current / $2,131.10 available throughout. On the next load the QuickFuel row is plain `posted` again, without a badge — and because the list offers "Dispute" on any posted, non-disputed row and `createDispute` keeps no record of earlier disputes, Avery could file a second dispute on the same charge.',
    audience: {
      executive: 'Outcome: the charge stands and the case is closed. Nothing in the system stops the customer from disputing it again.',
      'end-user': 'The charge stays on your account. The "Disputed" label disappears.',
    },
    detail: 1,
    variants: [DN],
    confidence: 'inferred',
    sources: [s(F.testRoutes, 209, 223, 'operator DENY restores the disputed entry to posted'), s(F.txnList, 170, 171, 'const canDispute'), s(F.disputes, 79, 84, "entry.status !== 'posted'")],
  },
  {
    id: 'history-note',
    kind: 'note',
    title: 'Where the decision is recorded',
    from: REQ,
    to: REQ,
    label: 'History shows Created → decision only',
    narrative:
      'The request detail\'s History is read from AuditLog rows with `entity: \'operations_request\'` for that request id. It therefore lists "Created" (Avery) and Sam\'s decision, but not the `dispute_upheld` / `dispute_denied` row, which is keyed to the ledger entry. The email event does appear under "Linked simulated events" because it carries `requestId`.',
    audience: { dba: "Two audit rows per decision: ops_<action> on operations_request/<id> and dispute_<outcome> on ledger_entry/le_002. Query both entities to see the whole story." },
    detail: 4,
    variants: FILED,
    sources: [s(F.ops, 169, 175, 'entity: AUDIT_ENTITY_REQUEST, entityId: id'), s(F.disputes, 183, 191, "entity: 'ledger_entry'")],
  },
];

const base = baseState();

export const scenario: Scenario = {
  id: 'dispute',
  title: 'Disputing a card charge',
  question: 'What happens when a customer disputes a charge?',
  summary:
    'The customer disputes a posted card charge from her transaction list. The entry is flagged `disputed` (it still counts in her balance) and a `dispute` request joins the operations queue. An operator upholding it reverses the entry, so the money returns; denying it puts the entry back to `posted`. Internal transfer legs cannot be disputed.',
  category: 'risk',
  tags: ['risk', 'disputes', 'ledger', 'operations', 'realtime', 'audit'],
  participants: [CUSTOMER, TXN, ROUTES, DISPUTES, LEDGER, REQ, QUEUES, APPLY],
  related: [
    'feat:disputes',
    'ep:POST /api/disputes',
    'ep:POST /api/ops/requests/:id/action',
    'be:routes/risk',
    'be:risk/disputes',
    'be:risk/disputes#createDispute',
    'be:risk/disputes#upholdDispute',
    'be:risk/disputes#denyDispute',
    'be:risk/disputes#disputePayloadOf',
    'be:money/movements#reverseLedgerEntries',
    'be:ops/requests#applyOperatorAction',
    'sh:risk#validateDispute',
    'sh:risk#DisputePayload',
    'sh:ledger#deriveBalances',
    'cu:components/TransactionList',
    'cu:lib/risk#fileDispute',
    'op:pages/RequestQueues',
    'op:components/RequestDetailPanel',
    'db:LedgerEntry',
    'db:OperationsRequest',
  ],
  variants: [
    { id: UP, label: 'Operator upholds the dispute', description: 'The disputed entry is reversed and the $48.90 returns to the balance.', outcome: 'success' },
    { id: DN, label: 'Operator denies the dispute', description: 'The entry returns to posted; the charge stands.', outcome: 'rejected' },
    { id: ND, label: 'Disputing an internal transfer leg', description: 'The server refuses with 400 invalid_state; nothing is written.', outcome: 'rejected' },
  ],
  defaultVariant: UP,
  initialState: {
    ...base,
    LedgerEntry: [
      ...base.LedgerEntry,
      { id: TRANSFER_LEG, accountId: IDS.checking, amountMinor: 20000, direction: 'debit', status: 'posted', origin: 'transfer', description: 'Transfer to Goal Savings', postedAt: '2026-09-15T12:00:00.000Z' },
      { id: 'le_006', accountId: IDS.savings, amountMinor: 20000, direction: 'credit', status: 'posted', origin: 'transfer', description: 'Transfer from Everyday Checking', postedAt: '2026-09-15T12:00:00.000Z' },
    ],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    s(F.disputes, 18, 28, 'Transaction-dispute service'),
    s(F.ops, 359, 372, 'Dispute resolution'),
    s(F.testRoutes, 158, 251, "describe('disputes'"),
  ],
};
