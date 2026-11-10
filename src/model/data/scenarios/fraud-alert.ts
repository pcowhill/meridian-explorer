import type { Scenario, ScenarioStep } from '../../types';
import { baseState, IDS, NOW } from '../fixtures';
import { F, s } from '../cards-risk/helpers';

/**
 * "How does a fraud alert affect a customer's card?"
 *
 * Starts from the seeded-style situation (a posted QuickFuel card debit, an
 * active debit card and a pending `fraud_alert` operations request linking
 * both) and follows it through the customer's answer and the operator's
 * decision.
 */

// ---- Lanes ------------------------------------------------------------------
const CUSTOMER = 'role:customer';
const DASH = 'cu:pages/Dashboard';
const WALLET = 'cu:pages/Wallet';
const ROUTES = 'be:routes/risk';
const FRAUD = 'be:risk/fraud';
const REQ = 'db:OperationsRequest';
const LEDGER = 'db:LedgerEntry';
const CARD = 'db:Card';
const APPLY = 'be:ops/requests#applyOperatorAction';
const QUEUES = 'op:pages/RequestQueues';

// ---- Variants ---------------------------------------------------------------
const CF = 'confirmed-fraud';
const CL = 'customer-confirms-legit';
const OD = 'operator-dismisses';
const AF = 'card-already-frozen';
const TL = 'responds-too-late';

// ---- Example data -----------------------------------------------------------
const ALERT_ID = 'req_fraud';
const ENTRY_ID = 'le_002';
const CARD_ID = IDS.debitCard;
const RAISED_AT = '2026-10-01T12:00:00.000Z';
const SUMMARY = 'Unusual card activity flagged — QuickFuel';
const DETAIL =
  'A fuel purchase fell outside the usual spending pattern and was flagged for review. The customer can confirm it was them or report fraud; an operator confirming fraud REVERSES the charge and FREEZES the card (simulated).';
const SIM_DETAIL = 'SIMULATION — no real money network or provider was contacted.';

/** The payload exactly as the seed writer stores it: plan payload + ledgerEntryId + accountId + cardId. */
const seededPayload = { merchant: 'QuickFuel', amountMinor: 4890, ledgerEntryId: ENTRY_ID, accountId: IDS.checking, cardId: CARD_ID };

type Response = 'report_fraud' | 'confirm_legit' | null;
type Resolution = 'confirmed_fraud' | 'dismissed' | null;

/** The payload after `asFraudPayload` has normalised it (seven keys; `accountId` is dropped). */
const fraudPayload = (customerResponse: Response, resolution: Resolution = null, reversed = false) => ({
  merchant: 'QuickFuel',
  amountMinor: 4890,
  ledgerEntryId: ENTRY_ID,
  cardId: CARD_ID,
  customerResponse,
  resolution,
  reversed,
});

const RESPONSE_LABEL = { report_fraud: 'Reported as fraud', confirm_legit: 'Confirmed — it was me' } as const;
const BUTTON_LABEL = { report_fraud: 'Report fraud', confirm_legit: 'Confirm — it was me' } as const;

const requestDto = (over: Record<string, unknown>) => ({
  id: ALERT_ID,
  type: 'fraud_alert',
  status: 'pending',
  priority: 'high',
  summary: SUMMARY,
  detail: DETAIL,
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: seededPayload as Record<string, unknown>,
  lastAction: null,
  lastActorName: null,
  lastActionNote: null,
  createdAt: RAISED_AT,
  updatedAt: RAISED_AT,
  resolvedAt: null,
  ...over,
});

// ---- Step builders ----------------------------------------------------------

/** The customer answers the alert (POST /api/fraud-alerts/:id/respond). */
function respondSteps(prefix: string, variants: string[], response: 'report_fraud' | 'confirm_legit'): ScenarioStep[] {
  const label = RESPONSE_LABEL[response];
  const after = fraudPayload(response);
  const isFraud = response === 'report_fraud';
  return [
    {
      id: `${prefix}-click`,
      kind: 'ui',
      title: isFraud ? 'Avery reports the charge as fraud' : 'Avery says the charge was hers',
      from: CUSTOMER,
      to: DASH,
      label: `clicks "${BUTTON_LABEL[response]}"`,
      narrative: `In the "Security alerts" card Avery clicks "${BUTTON_LABEL[response]}". \`FraudAlertsSection.respond()\` marks the row busy and calls the client helper \`respondToFraudAlert(alert.id, '${response}')\`.`,
      audience: {
        executive: isFraud ? 'The customer tells the bank she did not make this purchase.' : 'The customer tells the bank the purchase was hers.',
        'end-user': `You click "${BUTTON_LABEL[response]}".`,
      },
      detail: 1,
      variants,
      sources: [s(F.cuDashboard, 424, 439, 'respondToFraudAlert(id, response)'), s(F.cuDashboard, 491, 510, BUTTON_LABEL[response])],
    },
    {
      id: `${prefix}-request`,
      kind: 'request',
      title: 'POST the answer',
      from: DASH,
      to: ROUTES,
      label: 'POST /api/fraud-alerts/:id/respond',
      narrative: 'The customer client sends the answer with the session cookie and the CSRF double-submit header. The alert id in the URL is the operations request id.',
      detail: 3,
      variants,
      payload: {
        title: 'Request',
        format: 'http-request',
        line: `POST /api/fraud-alerts/${ALERT_ID}/respond`,
        headers: { 'Content-Type': 'application/json', 'x-meridian-csrf': '<value of the mer_csrf cookie>' },
        data: { response },
        typeRef: 'sh:risk#FraudResponseRequest',
        highlight: ['response'],
      },
      sources: [s(F.cuLibRisk, 134, 145, 'export async function respondToFraudAlert')],
    },
    {
      id: `${prefix}-guards`,
      kind: 'guard',
      title: 'CSRF, session, rate limit, body check',
      from: ROUTES,
      to: ROUTES,
      label: 'csrfHook → requireAuth → rateLimit(\'risk\') → isFraudResponse',
      narrative: 'The global hooks check the CSRF header (403 `csrf_failed`) and, in public-demo mode, the mutation valve. `requireAuth` resolves the session to Avery (401 otherwise); `rateLimit(\'risk\')` applies in public-demo mode only. The handler then requires `body.response` to be one of the two known values, else 400 `bad_request`.',
      detail: 4,
      variants,
      sources: [s(F.routesRisk, 37, 37, "rateLimit('risk')"), s(F.routesRisk, 78, 83, 'isFraudResponse(body.response)')],
    },
    {
      id: `${prefix}-load`,
      kind: 'db-read',
      title: 'Load the alert and check it is hers and still pending',
      from: FRAUD,
      to: REQ,
      label: 'respondToFraudAlert → findUnique + 3 checks',
      narrative: `The handler calls \`respondToFraudAlert(req.user, '${ALERT_ID}', '${response}', simulationNow)\`. It loads the request and checks, in order: it is a \`fraud_alert\` (else 404), its \`subjectEmail\` equals Avery's email ignoring case (else 403), and its status is \`pending\` (else 400 \`invalid_state\`). All three pass.`,
      audience: { dba: 'One primary-key read of OperationsRequest. Ownership is an email comparison against `subjectEmail`; there is no user foreign key on this table.' },
      detail: 4,
      variants,
      sources: [s(F.fraud, 95, 104, 'prisma.operationsRequest.findUnique')],
    },
    {
      id: `${prefix}-write`,
      kind: 'db-write',
      title: 'Record the answer on the alert',
      from: FRAUD,
      to: REQ,
      label: 'update payload.customerResponse',
      narrative: `Inside a transaction the request's \`payload\` is rewritten as the parsed payload plus \`customerResponse: '${response}'\`, and \`updatedAt\` is set to the simulated time. \`status\` is not part of the update — the alert stays \`pending\`. Because the payload is parsed through \`asFraudPayload\` and re-serialised, the seed's extra \`accountId\` key disappears here.`,
      audience: {
        executive: 'The bank records the customer’s answer on the alert. Nothing else happens yet.',
        dba: 'UPDATE OperationsRequest SET payload = <JSON>, updatedAt = <simulated now> WHERE id = ?. The status column is untouched.',
      },
      detail: 3,
      variants,
      payload: { title: 'OperationsRequest.payload (parsed)', format: 'row', data: after, typeRef: 'sh:risk#FraudPayload', highlight: ['customerResponse'] },
      effects: [{ op: 'update', table: 'OperationsRequest', id: ALERT_ID, set: { payload: JSON.stringify(after), updatedAt: NOW } }],
      sources: [s(F.fraud, 106, 113, 'customerResponse: response'), s(F.shRisk, 55, 69, 'export function asFraudPayload')],
    },
    {
      id: `${prefix}-trail`,
      kind: 'db-write',
      title: 'Audit row and inbound simulated SMS',
      from: FRAUD,
      to: FRAUD,
      label: 'writeAudit + recordSimEvent',
      narrative: `Same transaction: \`writeAudit\` inserts an \`AuditLog\` row (\`fraud_customer_response\`, actor Avery) and \`recordSimEvent\` inserts a \`SimulatedEvent\` modelled as the customer replying by SMS — \`direction: inbound\`, linked to the alert. No message is actually received from anywhere.`,
      audience: { dba: 'Two inserts. AuditLog.createdAt is the database default (wall-clock time); SimulatedEvent.createdAt is the simulated time passed in.' },
      detail: 4,
      variants,
      effects: [
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: 'aud_response',
            actorId: IDS.avery,
            actorRole: 'customer',
            action: 'fraud_customer_response',
            entity: 'operations_request',
            entityId: ALERT_ID,
            reason: `Customer response: ${label} (simulated)`,
            metadata: JSON.stringify({ response, actorName: 'Avery Customer' }),
          },
        },
        {
          op: 'insert',
          table: 'SimulatedEvent',
          row: {
            id: 'sev_response',
            channel: 'sms',
            direction: 'inbound',
            kind: 'fraud_response',
            status: 'delivered',
            summary: `Customer responded: ${label} (simulated)`,
            detail: SIM_DETAIL,
            requestId: ALERT_ID,
            createdAt: NOW,
          },
        },
      ],
      sources: [s(F.fraud, 114, 136, "action: 'fraud_customer_response'"), s(F.movements, 134, 161, 'export async function recordSimEvent')],
    },
    {
      id: `${prefix}-push`,
      kind: 'event',
      title: 'Operators are told immediately',
      from: ROUTES,
      to: QUEUES,
      label: 'ops:request_changed (updated) + ops:external_event',
      narrative: 'After the service returns, the handler calls `app.opsRealtime.requestChanged(\'updated\', request)` and `externalEvent(event)`. Both go to the Socket.IO `ops` room only. Every open operations console replaces its copy of the alert and prepends the inbound event to its feed.',
      audience: {
        executive: 'Bank staff see the customer’s answer appear on the alert straight away.',
        systems: 'Two Socket.IO emits to the staff-only `ops` room. Customer sockets are never in that room.',
      },
      detail: 2,
      variants,
      payload: {
        title: 'ops:request_changed',
        format: 'socket',
        line: 'ops:request_changed',
        data: { change: 'updated', request: requestDto({ payload: after, updatedAt: NOW }) },
        typeRef: 'sh:operations#OpsRequestChangedPayload',
        highlight: ['request.payload.customerResponse', 'request.status'],
      },
      sources: [s(F.routesRisk, 84, 88, "requestChanged('updated', result.request)"), s(F.opsRealtime, 42, 50, 'OPS_REALTIME_ROOM'), s(F.opData, 96, 99, 'onRequestChanged')],
    },
    {
      id: `${prefix}-response`,
      kind: 'response',
      title: '200 — answer recorded',
      from: ROUTES,
      to: DASH,
      label: '200 { request }',
      narrative: `The handler returns the updated operations request. The client helper ignores the body and reports success; the dashboard replaces the two buttons with the label "${label}".`,
      audience: { 'end-user': `The alert now reads "${label}".` },
      detail: 3,
      variants,
      payload: {
        title: 'Response',
        format: 'http-response',
        line: '200 OK',
        data: { request: requestDto({ payload: after, updatedAt: NOW }) },
        typeRef: 'sh:operations#OperationsRequestDTO',
        highlight: ['request.status', 'request.payload.customerResponse'],
      },
      sources: [s(F.routesRisk, 88, 88, 'reply.send({ request: result.request })'), s(F.cuDashboard, 483, 489, 'FRAUD_RESPONSE_LABELS[recorded]')],
    },
    {
      id: `${prefix}-nothing-yet`,
      kind: 'state',
      title: isFraud ? 'Nothing has moved yet' : 'The alert is still open',
      from: FRAUD,
      to: FRAUD,
      label: 'alert still pending',
      narrative: isFraud
        ? 'Reporting fraud is advisory. The QuickFuel entry is still `posted`, the card is still `active`, Everyday Checking still shows $2,451.10 current / $2,331.10 available, and the alert is still `pending` in the operators’ queue. Only an operator’s decision changes any of that.'
        : 'Saying "it was me" does not close the alert. It stays `pending` in the operators’ queue with the answer attached, and it stays on Avery’s dashboard (showing her answer) until an operator decides.',
      audience: {
        executive: isFraud ? 'At this point the customer has only been heard. The refund and the card lock wait for a member of staff.' : 'The alert stays open until a member of staff closes it.',
      },
      detail: 2,
      variants,
      sources: [s(F.fraud, 83, 88, 'it does NOT resolve'), s(F.testRoutes, 268, 277, "expect(request.status).toBe('pending')")],
    },
  ];
}

/** The operator's click and the shared part of `applyOperatorAction` (load, guard, status update, ops audit). */
function operatorDecisionSteps(prefix: string, variants: string[], action: 'approve' | 'reject'): ScenarioStep[] {
  const approve = action === 'approve';
  const toStatus = approve ? 'approved' : 'rejected';
  return [
    {
      id: `${prefix}-click`,
      kind: 'ui',
      title: approve ? 'Sam approves: confirm fraud' : 'Sam rejects: dismiss as legitimate',
      from: QUEUES,
      to: QUEUES,
      label: approve ? 'Sam clicks "Approve"' : 'Sam clicks "Reject"',
      narrative: `Sam Operator clicks ${approve ? 'Approve' : 'Reject'} on the alert. There is no fraud-specific button: it is the same action bar every queue item has, and the detail panel explains what it means for a fraud alert. \`runAction\` calls the data context's \`act(id, '${action}')\`.`,
      audience: {
        executive: approve ? 'A member of staff confirms the charge was fraud.' : 'A member of staff decides the charge was legitimate and dismisses the alert.',
        'end-user': approve ? 'A bank employee confirms the fraud.' : 'A bank employee dismisses the alert.',
      },
      detail: 1,
      variants,
      sources: [s(F.opQueues, 59, 73, 'await act(id, action)'), s(F.opDetail, 373, 376, 'Approve = confirm fraud')],
    },
    {
      id: `${prefix}-request`,
      kind: 'request',
      title: 'POST the operator action',
      from: QUEUES,
      to: APPLY,
      label: `POST /api/ops/requests/:id/action { ${action} }`,
      narrative: `\`applyOpsAction\` posts to the generic action endpoint with the operations session cookie. The route requires \`requireAuth\`, then role \`ops_agent\` or \`admin\`, then \`rateLimit('operations')\`, and calls \`applyOperatorAction(prisma, { id, action, note, actor }, simulationNow)\`.`,
      audience: { systems: 'A staff-only endpoint on the operations cookie surface. A customer session gets 403 here.' },
      detail: 3,
      variants,
      payload: {
        title: 'Request',
        format: 'http-request',
        line: `POST /api/ops/requests/${ALERT_ID}/action`,
        headers: { 'Content-Type': 'application/json', 'x-meridian-csrf': '<value of the mer_csrf cookie>' },
        data: { action },
        typeRef: 'sh:operations#OperatorActionRequest',
        highlight: ['action'],
      },
      sources: [s(F.opApi, 50, 61, 'export async function applyOpsAction'), s(F.routesOps, 122, 146, "app.post('/api/ops/requests/:id/action'"), s(F.routesOps, 56, 56, "rateLimit('operations')")],
    },
    {
      id: `${prefix}-load`,
      kind: 'db-read',
      title: 'Load the request; is it still actionable?',
      from: APPLY,
      to: REQ,
      label: 'findUnique + canApplyAction',
      narrative: `\`applyOperatorAction\` loads the request (404 \`not_found\` if missing) and checks \`canApplyAction(status, '${action}')\`: a decision is refused with 409 \`already_resolved\` once a request is approved or rejected. The alert is \`pending\`, so it proceeds. The row loaded here — \`existing\` — is what is later handed to the fraud service.`,
      detail: 4,
      variants,
      sources: [s(F.ops, 235, 239, 'prisma.operationsRequest.findUnique'), s(F.ops, 273, 279, 'canApplyAction(currentStatus, input.action)')],
    },
    {
      id: `${prefix}-status`,
      kind: 'db-write',
      title: `Transaction opens: request → ${toStatus}`,
      from: APPLY,
      to: REQ,
      label: `tx: status → '${toStatus}' + ops_${action} audit`,
      narrative: `Because the request's type is \`fraud_alert\` and the action is approve or reject, the fraud branch opens \`prisma.$transaction\`. First statement: set \`status: '${toStatus}'\`, the last-action bookkeeping and \`resolvedAt\`. Second: the generic \`ops_${action}\` audit row. Everything that follows is in the same transaction — if any later step throws, the status change rolls back too.`,
      audience: {
        dba: `UPDATE OperationsRequest (status, lastAction, lastActorId, lastActorRole, lastActorName, lastActionNote, resolvedAt, updatedAt) + INSERT AuditLog, both inside one interactive transaction that stays open for the following steps.`,
      },
      detail: 3,
      variants,
      effects: [
        {
          op: 'update',
          table: 'OperationsRequest',
          id: ALERT_ID,
          set: { status: toStatus, lastAction: action, lastActorId: IDS.sam, lastActorRole: 'ops_agent', lastActorName: 'Sam Operator', lastActionNote: null, resolvedAt: NOW, updatedAt: NOW },
        },
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: 'aud_ops_decision',
            actorId: IDS.sam,
            actorRole: 'ops_agent',
            action: `ops_${action}`,
            entity: 'operations_request',
            entityId: ALERT_ID,
            reason: null,
            metadata: JSON.stringify({ action, actorName: 'Sam Operator', fromStatus: 'pending', toStatus }),
          },
        },
      ],
      sources: [s(F.ops, 374, 387, "existing.type === 'fraud_alert'"), s(F.ops, 280, 290, 'const decisionData'), s(F.ops, 243, 256, 'const auditFor')],
    },
  ];
}

/** Approve path: `confirmFraud` — reverse the charge, freeze the card, mark the alert, audit + SMS. */
function confirmSteps(variants: string[], cardAlreadyFrozen: boolean): ScenarioStep[] {
  const pre = cardAlreadyFrozen ? 'af' : 'cf';
  const before = fraudPayload('report_fraud');
  const after = fraudPayload('report_fraud', 'confirmed_fraud', true);
  const cardFrozen = !cardAlreadyFrozen;
  const reason = `Fraud confirmed — reversed $48.90${cardFrozen ? ' + card frozen' : ''} (simulated)`;
  return [
    {
      id: `${pre}-freeze`,
      kind: cardFrozen ? 'db-write' : 'db-read',
      title: cardFrozen ? 'The card is frozen' : 'The card is already frozen — skipped',
      from: FRAUD,
      to: CARD,
      label: cardFrozen ? "freezeCardById → status 'frozen'" : 'freezeCardById → false (no write)',
      narrative: cardFrozen
        ? `The payload has a \`cardId\`, so \`freezeCardById(tx, '${CARD_ID}', now)\` runs. It reads the card's status, sees \`canFreezeCard('active')\` is true, sets \`status: 'frozen'\` and returns \`true\`. No access check is made — the caller is already a role-gated operator — and no separate \`card_frozen\` audit row is written.`
        : `\`freezeCardById(tx, '${CARD_ID}', now)\` reads the card's status. It is already \`frozen\`, so \`canFreezeCard\` is false: the function returns \`false\` and writes nothing. The operator's transaction carries on — an unfreezable card is not an error.`,
      audience: cardFrozen
        ? {
            executive: 'The card used for the purchase is locked so it cannot be used again.',
            'end-user': 'Your card is frozen.',
            dba: 'SELECT status FROM Card, then UPDATE Card SET status = \'frozen\', updatedAt = <simulated now>. Same transaction as the ledger reversal.',
          }
        : { executive: 'The card was already locked by the customer, so the bank leaves it as it is.' },
      detail: cardFrozen ? 1 : 2,
      variants,
      payload: { title: 'freezeCardById result', format: 'return', data: { cardFrozen } },
      effects: cardFrozen ? [{ op: 'update', table: 'Card', id: CARD_ID, set: { status: 'frozen', updatedAt: NOW } }] : [],
      sources: [s(F.fraud, 165, 168, 'freezeCardById(tx, payload.cardId, now)'), s(F.cards, 386, 395, 'export async function freezeCardById')],
    },
    {
      id: `${pre}-resolution`,
      kind: 'db-write',
      title: 'Mark the alert confirmed and reversed',
      from: FRAUD,
      to: REQ,
      label: "payload.resolution = 'confirmed_fraud', reversed = true",
      narrative: 'The request’s payload is rewritten with `resolution: \'confirmed_fraud\'` and `reversed: reversedCount > 0` — true here, because one entry was reversed. `payload.reversed` is what makes the operations console add a "Reversed" tag next to "Approved".',
      audience: { dba: 'A second UPDATE of the same OperationsRequest row in this transaction, changing only payload and updatedAt.' },
      detail: 3,
      variants,
      payload: { title: 'OperationsRequest.payload (parsed)', format: 'row', data: after, typeRef: 'sh:risk#FraudPayload', highlight: ['resolution', 'reversed'] },
      effects: [{ op: 'update', table: 'OperationsRequest', id: ALERT_ID, set: { payload: JSON.stringify(after), updatedAt: NOW } }],
      sources: [s(F.fraud, 170, 174, "resolution: 'confirmed_fraud'"), s(F.shOps, 344, 354, 'export function isRequestReversed')],
    },
    {
      id: `${pre}-trail`,
      kind: 'db-write',
      title: 'Audit row and simulated SMS',
      from: FRAUD,
      to: FRAUD,
      label: "writeAudit 'fraud_confirmed' + recordSimEvent",
      narrative: `\`writeAudit\` records \`fraud_confirmed\` with the reason "${reason}" and metadata holding the payload as it was before this decision plus \`reversedCount: 1\` and \`cardFrozen: ${cardFrozen}\`. \`recordSimEvent\` inserts an outbound SMS event, "Fraud confirmed — card protected and charge reversed (simulated)". No SMS is sent. The transaction then commits.`,
      audience: {
        executive: 'The decision, who made it and what it did are written to the audit trail, and a (simulated) text message to the customer is recorded.',
        dba: `Two inserts, then COMMIT. The audit row's metadata is the only place that records whether the card was actually frozen by this action (cardFrozen: ${cardFrozen}).`,
      },
      detail: 4,
      variants,
      effects: [
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: 'aud_fraud_confirmed',
            actorId: IDS.sam,
            actorRole: 'ops_agent',
            action: 'fraud_confirmed',
            entity: 'operations_request',
            entityId: ALERT_ID,
            reason,
            metadata: JSON.stringify({ ...before, reversedCount: 1, cardFrozen, actorName: 'Sam Operator' }),
          },
        },
        {
          op: 'insert',
          table: 'SimulatedEvent',
          row: {
            id: 'sev_fraud_confirmed',
            channel: 'sms',
            direction: 'outbound',
            kind: 'fraud_confirmed',
            status: 'delivered',
            summary: 'Fraud confirmed — card protected and charge reversed (simulated)',
            detail: SIM_DETAIL,
            requestId: ALERT_ID,
            createdAt: NOW,
          },
        },
      ],
      sources: [s(F.fraud, 176, 198, "action: 'fraud_confirmed'")],
    },
  ];
}

/** Reject path: `dismissFraud` — payload, audit and a simulated email only. */
function dismissSteps(prefix: string, variants: string[], customerResponse: Response): ScenarioStep[] {
  const before = fraudPayload(customerResponse);
  const after = fraudPayload(customerResponse, 'dismissed', false);
  return [
    {
      id: `${prefix}-resolution`,
      kind: 'db-write',
      title: 'Mark the alert dismissed',
      from: FRAUD,
      to: REQ,
      label: "payload.resolution = 'dismissed'",
      narrative:
        'The payload is rewritten with `resolution: \'dismissed\'` and `reversed: false`.' +
        (customerResponse === null ? ' This is the first time this alert’s payload is rewritten, so the seed’s extra `accountId` key is dropped here.' : ' The customer’s answer stays on the payload.'),
      detail: 3,
      variants,
      payload: { title: 'OperationsRequest.payload (parsed)', format: 'row', data: after, typeRef: 'sh:risk#FraudPayload', highlight: ['resolution', 'reversed', 'customerResponse'] },
      effects: [{ op: 'update', table: 'OperationsRequest', id: ALERT_ID, set: { payload: JSON.stringify(after), updatedAt: NOW } }],
      sources: [s(F.fraud, 208, 213, "resolution: 'dismissed'")],
    },
    {
      id: `${prefix}-trail`,
      kind: 'db-write',
      title: 'Audit row and simulated email',
      from: FRAUD,
      to: FRAUD,
      label: "writeAudit 'fraud_dismissed' + recordSimEvent",
      narrative: '`writeAudit` records `fraud_dismissed` ("Fraud alert dismissed as legitimate activity (simulated)") and `recordSimEvent` inserts an outbound email event. The transaction commits.',
      audience: { dba: 'Two inserts, then COMMIT. No LedgerEntry or Card statement appears anywhere in this transaction.' },
      detail: 4,
      variants,
      effects: [
        {
          op: 'insert',
          table: 'AuditLog',
          row: {
            id: 'aud_fraud_dismissed',
            actorId: IDS.sam,
            actorRole: 'ops_agent',
            action: 'fraud_dismissed',
            entity: 'operations_request',
            entityId: ALERT_ID,
            reason: 'Fraud alert dismissed as legitimate activity (simulated)',
            metadata: JSON.stringify({ ...before, actorName: 'Sam Operator' }),
          },
        },
        {
          op: 'insert',
          table: 'SimulatedEvent',
          row: {
            id: 'sev_fraud_dismissed',
            channel: 'email',
            direction: 'outbound',
            kind: 'fraud_dismissed',
            status: 'sent',
            summary: 'Fraud alert dismissed — activity confirmed legitimate (simulated)',
            detail: SIM_DETAIL,
            requestId: ALERT_ID,
            createdAt: NOW,
          },
        },
      ],
      sources: [s(F.fraud, 215, 237, "action: 'fraud_dismissed'")],
    },
    {
      id: `${prefix}-response`,
      kind: 'response',
      title: '200 — alert rejected; consoles updated',
      from: APPLY,
      to: QUEUES,
      label: '200 { request } + ops:request_changed',
      narrative: '`applyOperatorAction` returns the request DTO and the dismissal event. The route pushes `ops:request_changed` (`updated`) and `ops:external_event` to the operators’ room and replies 200. Sam’s queue card now reads "Rejected" with no "Reversed" tag; the detail panel shows "Resolution: Dismissed".',
      detail: 3,
      variants,
      payload: {
        title: 'Response',
        format: 'http-response',
        line: '200 OK',
        data: { request: requestDto({ status: 'rejected', payload: after, lastAction: 'reject', lastActorName: 'Sam Operator', updatedAt: NOW, resolvedAt: NOW }) },
        typeRef: 'sh:operations#OperatorActionResponse',
        highlight: ['request.status', 'request.payload.resolution', 'request.payload.reversed'],
      },
      sources: [s(F.routesOps, 147, 151, "requestChanged('updated', request)"), s(F.opDetail, 364, 371, 'Dismissed')],
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _RESPONDED = [CF, CL, AF];
const APPROVED = [CF, AF];
const REJECTED = [CL, OD, TL];

const steps: ScenarioStep[] = [
  // ---- Starting point -------------------------------------------------------
  {
    id: 'start',
    kind: 'note',
    title: 'Starting point: a flagged QuickFuel charge',
    from: REQ,
    to: REQ,
    label: 'pending fraud_alert request',
    narrative:
      'Three rows set the scene. A `posted` card debit of $48.90 at QuickFuel on Everyday Checking. Avery’s `active` Visa debit card ••4821. And a `pending`, high-priority operations request of type `fraud_alert` whose JSON payload names the merchant and amount and soft-links both the ledger entry and the card. The running backend has no fraud detection and no endpoint that raises alerts: this alert exists because the seed creates it.',
    audience: {
      executive: 'The bank has flagged a $48.90 fuel purchase on a customer’s debit card as unusual.',
      'end-user': 'The bank thinks a $48.90 charge at QuickFuel on your debit card looks unusual.',
      dba: 'No dedicated table: the alert is an OperationsRequest row. Its payload column is a JSON string; ledgerEntryId and cardId inside it are plain ids, not foreign keys.',
    },
    detail: 2,
    payload: { title: 'OperationsRequest.payload (as seeded)', format: 'row', data: seededPayload, typeRef: 'sh:risk#FraudPayload', highlight: ['ledgerEntryId', 'cardId'] },
    sources: [
      s(F.seedPlan, 494, 509, "key: 'fraud-card'"),
      s(F.seedPlan, 436, 437, "key: 'card-quickfuel'"),
      s(F.seedApply, 180, 193, 'ledgerEntryId: entryId', 'How the seed writer fills the two links (and adds accountId)'),
    ],
  },
  {
    id: 'open-dashboard',
    kind: 'request',
    title: 'The dashboard asks for Avery’s alerts',
    from: DASH,
    to: ROUTES,
    label: 'GET /api/fraud-alerts',
    narrative: 'Avery signs in. On mount, the dashboard’s `FraudAlertsSection` calls `listFraudAlerts()`, a plain GET with the session cookie. `requireAuth` is the only guard.',
    detail: 3,
    payload: { title: 'Request', format: 'http-request', line: 'GET /api/fraud-alerts', data: null },
    sources: [s(F.cuDashboard, 413, 422, 'listFraudAlerts()'), s(F.cuLibRisk, 120, 127, 'export function listFraudAlerts'), s(F.routesRisk, 72, 75, "app.get('/api/fraud-alerts'")],
  },
  {
    id: 'list-alerts',
    kind: 'db-read',
    title: 'Find pending alerts addressed to her',
    from: FRAUD,
    to: REQ,
    label: "findMany type='fraud_alert', status='pending', subjectEmail",
    narrative: '`listFraudAlertsForUser` runs one query: operations requests of type `fraud_alert`, in status `pending`, whose `subjectEmail` is the signed-in user’s email, newest first. Each row’s payload is parsed for the merchant, the amount and any recorded answer.',
    audience: { dba: 'SELECT … FROM OperationsRequest WHERE type = \'fraud_alert\' AND status = \'pending\' AND subjectEmail = ? ORDER BY createdAt DESC. status and type are indexed; subjectEmail is not.' },
    detail: 4,
    sources: [s(F.fraud, 59, 76, 'export async function listFraudAlertsForUser')],
  },
  {
    id: 'alerts-response',
    kind: 'response',
    title: '200 — one alert',
    from: ROUTES,
    to: DASH,
    label: '200 { alerts: [1] }',
    narrative: 'The response is a narrow summary of the request: no ledger-entry id, no card id, no operator fields.',
    detail: 3,
    payload: {
      title: 'Response',
      format: 'http-response',
      line: '200 OK',
      data: { alerts: [{ id: ALERT_ID, summary: SUMMARY, detail: DETAIL, merchant: 'QuickFuel', amountMinor: 4890, customerResponse: null, createdAt: RAISED_AT }] },
      typeRef: 'sh:risk#FraudAlertListResponse',
      highlight: ['alerts.0.merchant', 'alerts.0.amountMinor', 'alerts.0.customerResponse'],
    },
    sources: [s(F.routesRisk, 72, 75, 'FraudAlertListResponse'), s(F.shRisk, 169, 178, 'export interface FraudAlertSummary')],
  },
  {
    id: 'see-alert',
    kind: 'ui',
    title: 'Avery sees a security alert',
    from: DASH,
    to: CUSTOMER,
    label: '"Security alerts": QuickFuel · $48.90',
    narrative: 'The dashboard renders a "Security alerts" section with one amber card — the alert’s summary, "QuickFuel · $48.90" — and two buttons: "Confirm — it was me" and "Report fraud". The section renders nothing at all when there are no alerts.',
    audience: {
      executive: 'The customer sees the alert on her dashboard and is asked whether the purchase was hers.',
      'end-user': 'Your dashboard shows a security alert for the QuickFuel charge with two choices.',
    },
    detail: 1,
    sources: [s(F.cuDashboard, 441, 449, 'Security alerts'), s(F.cuDashboard, 491, 510, 'Report fraud')],
  },
  {
    id: 'customer-choice',
    kind: 'decision',
    title: 'What does Avery do?',
    from: CUSTOMER,
    to: DASH,
    label: 'report fraud / it was me / nothing',
    narrative: 'The customer can report the charge as fraud, confirm it was hers, or not answer at all. None of the three resolves the alert; they only change what the operator sees when deciding.',
    detail: 2,
    decision: {
      question: 'How does the customer respond to the alert?',
      options: [
        { label: 'Report fraud', variant: CF, description: 'The answer is recorded; an operator then confirms fraud.' },
        { label: 'Report fraud, then freeze the card herself', variant: AF, description: 'Same, but the card is already frozen when the operator confirms.' },
        { label: 'Confirm — it was me', variant: CL, description: 'The answer is recorded; the alert stays open until an operator dismisses it.' },
        { label: 'No answer', variant: OD, description: 'An operator dismisses the alert without hearing from the customer.' },
        { label: 'No answer — until after the bank has decided', variant: TL, description: 'The late answer is refused with 400 invalid_state.' },
      ],
    },
    sources: [s(F.shRisk, 21, 28, 'FRAUD_RESPONSES')],
  },

  // ---- Customer answers -----------------------------------------------------
  ...respondSteps('report', APPROVED, 'report_fraud'),
  ...respondSteps('legit', [CL], 'confirm_legit'),
  {
    id: 'no-answer',
    kind: 'note',
    title: 'Avery does not answer',
    from: CUSTOMER,
    to: DASH,
    label: 'no response',
    narrative: 'Avery leaves the alert alone. `payload.customerResponse` stays unset and the operators’ detail panel shows "Customer response: No response yet". Operators are not blocked: the action buttons work on any pending request.',
    detail: 2,
    variants: [OD, TL],
    sources: [s(F.opDetail, 356, 363, 'No response yet')],
  },

  // ---- card-already-frozen: the customer freezes the card herself -----------
  {
    id: 'af-self-freeze',
    kind: 'db-write',
    title: 'Avery freezes the card herself',
    from: WALLET,
    to: CARD,
    label: 'POST /api/cards/:id/freeze → frozen',
    narrative: 'Not waiting for the bank, Avery opens Cards and clicks "Freeze" on ••4821. `POST /api/cards/card_debit/freeze` runs `freezeCard`: access check on the card’s account, `canFreezeCard(\'active\')`, then `status: \'frozen\'` and a `card_frozen` audit row. This is the ordinary customer freeze and has no connection to the alert.',
    audience: { executive: 'The customer locks her own card straight away from the Cards page.', 'end-user': 'You freeze the card yourself from the Cards page.' },
    detail: 2,
    variants: [AF],
    confidence: 'simplified',
    effects: [
      { op: 'update', table: 'Card', id: CARD_ID, set: { status: 'frozen', updatedAt: NOW } },
      {
        op: 'insert',
        table: 'AuditLog',
        row: {
          id: 'aud_card_frozen',
          actorId: IDS.avery,
          actorRole: 'customer',
          action: 'card_frozen',
          entity: 'card',
          entityId: CARD_ID,
          reason: 'Card ••4821 → Frozen (simulated)',
          metadata: JSON.stringify({ from: 'active', to: 'frozen', actorName: 'Avery Customer' }),
        },
      },
    ],
    sources: [s(F.cuWallet, 390, 401, 'freezeCard(card.id)'), s(F.cards, 213, 245, 'async function setCardStatus')],
  },

  // ---- Operator review ------------------------------------------------------
  {
    id: 'ops-review',
    kind: 'ui',
    title: 'Sam reviews the alert in the queue',
    from: QUEUES,
    to: QUEUES,
    label: 'Sam opens the fraud alert',
    narrative: 'In the operations console’s Request queues, the alert sits in the "Fraud & disputes" lane with a High priority badge. Selecting it opens the detail panel: merchant, amount, "Customer response" (the recorded answer, or "No response yet"), the history from the audit trail, and the hint "Approve = confirm fraud (reverses the charge + freezes the card); Reject = dismiss as legitimate."',
    audience: {
      executive: 'A member of bank staff opens the alert and sees what the customer said, if anything.',
      'end-user': 'A bank employee reviews the alert.',
    },
    detail: 2,
    sources: [s(F.opDetail, 330, 378, 'Fraud-alert context'), s(F.shOps, 209, 209, "types: ['fraud_alert', 'dispute']")],
  },
  {
    id: 'ops-choice',
    kind: 'decision',
    title: 'Approve or reject?',
    from: QUEUES,
    to: APPLY,
    label: 'approve = confirm fraud · reject = dismiss',
    narrative: 'The operator’s decision is the one that matters. The code does not tie it to the customer’s answer: either button works whatever the customer said, or if she said nothing.',
    detail: 2,
    decision: {
      question: 'What does the operator decide?',
      options: [
        { label: 'Approve — confirm fraud', variant: CF, description: 'Charge reversed, card frozen.' },
        { label: 'Approve — the card is already frozen', variant: AF, description: 'Charge reversed; the freeze is skipped.' },
        { label: 'Reject — the customer said it was her', variant: CL, description: 'Dismissed; nothing moves.' },
        { label: 'Reject — no customer answer', variant: OD, description: 'Dismissed; nothing moves.' },
      ],
    },
    sources: [s(F.ops, 374, 387, 'Fraud resolution')],
  },

  // ---- Approve path ---------------------------------------------------------
  ...operatorDecisionSteps('approve', APPROVED, 'approve'),
  {
    id: 'confirm-call',
    kind: 'call',
    title: 'Hand over to the fraud service',
    from: APPLY,
    to: FRAUD,
    label: 'confirmFraud(tx, existing, actor, now)',
    narrative: 'Still inside the transaction, `applyOperatorAction` calls `confirmFraud` with the transaction client, the request row it loaded earlier, Sam as the actor and the simulated time. `confirmFraud` parses the payload: it finds `ledgerEntryId: \'le_002\'` and `cardId: \'card_debit\'`.',
    detail: 3,
    variants: APPROVED,
    payload: { title: 'Arguments', format: 'args', data: { request: { id: ALERT_ID, payload: fraudPayload('report_fraud') }, actor: { id: IDS.sam, role: 'ops_agent', displayName: 'Sam Operator' }, now: NOW }, highlight: ['request.payload.ledgerEntryId', 'request.payload.cardId'] },
    sources: [s(F.ops, 378, 386, 'confirmFraud(tx, existing, input.actor, now)'), s(F.fraud, 153, 159, 'export async function confirmFraud')],
  },
  {
    id: 'reverse-charge',
    kind: 'db-write',
    title: 'The charge is reversed',
    from: FRAUD,
    to: LEDGER,
    label: "reverseLedgerEntries(['le_002']) → 'reversed'",
    narrative:
      '`reverseLedgerEntries(tx, [\'le_002\'])` runs one `updateMany`: entries with that id whose status is `posted` or `disputed` become `reversed`. It returns 1. Nothing else about the entry changes and no compensating credit is inserted. Because derived balances ignore `reversed` entries, Everyday Checking goes from $2,451.10 to $2,500.00 current and from $2,331.10 to $2,380.00 available the next time anyone reads it.',
    audience: {
      executive: 'The $48.90 charge is cancelled and the money is back in the customer’s account.',
      'end-user': 'The QuickFuel charge is reversed — the $48.90 is back in your balance.',
      dba: 'UPDATE LedgerEntry SET status = \'reversed\' WHERE id IN (?) AND status IN (\'posted\',\'disputed\'). One row. No balance column exists to update; the row is kept for history.',
    },
    detail: 1,
    variants: APPROVED,
    payload: { title: 'LedgerEntry le_002', format: 'row', data: { id: ENTRY_ID, accountId: IDS.checking, amountMinor: 4890, direction: 'debit', status: 'reversed', origin: 'card', description: 'QuickFuel' }, highlight: ['status'] },
    effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY_ID, set: { status: 'reversed' } }],
    sources: [s(F.fraud, 161, 164, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])'), s(F.movements, 389, 404, 'export async function reverseLedgerEntries'), s(F.shLedger, 86, 87, 'failed / reversed: no effect on any balance')],
  },
  ...confirmSteps([CF], false),
  ...confirmSteps([AF], true),
  {
    id: 'approve-response',
    kind: 'response',
    title: '200 — "Approved" and "Reversed"',
    from: APPLY,
    to: QUEUES,
    label: '200 { request } + ops:request_changed',
    narrative: '`applyOperatorAction` returns the request DTO and the SMS event. The route pushes `ops:request_changed` (`updated`) and `ops:external_event` to the operators’ room, then replies 200. Sam’s queue card shows "Approved" plus a "Reversed" tag, because `isRequestReversed(payload)` is now true; the detail panel adds "Resolution: Confirmed fraud".',
    audience: { executive: 'Staff consoles show the alert as approved and the charge as reversed.', systems: 'HTTP 200 to the acting operator; Socket.IO broadcast to every console in the `ops` room. Nothing is pushed to the customer.' },
    detail: 3,
    variants: APPROVED,
    payload: {
      title: 'Response',
      format: 'http-response',
      line: '200 OK',
      data: { request: requestDto({ status: 'approved', payload: fraudPayload('report_fraud', 'confirmed_fraud', true), lastAction: 'approve', lastActorName: 'Sam Operator', updatedAt: NOW, resolvedAt: NOW }) },
      typeRef: 'sh:operations#OperatorActionResponse',
      highlight: ['request.status', 'request.payload.resolution', 'request.payload.reversed'],
    },
    sources: [s(F.routesOps, 147, 151, "requestChanged('updated', request)"), s(F.opQueueCard, 54, 57, 'isRequestReversed(request.payload)'), s(F.testE2e, 80, 85, "getByText('Reversed'")],
  },
  {
    id: 'wallet-open',
    kind: 'ui',
    title: 'Avery opens her cards',
    from: CUSTOMER,
    to: WALLET,
    label: 'opens /wallet',
    narrative: 'Nothing was pushed to the customer app: it holds a socket only for the status pill and is never in the operators’ room. Avery finds out when a page next loads. Opening Cards calls `listCards()` → `GET /api/cards`.',
    detail: 2,
    variants: APPROVED,
    sources: [s(F.cuWallet, 663, 668, 'listCards()')],
  },
  {
    id: 'wallet-frozen',
    kind: 'db-read',
    title: 'The card shows "Frozen"',
    from: WALLET,
    to: CARD,
    label: "GET /api/cards → status 'frozen'",
    narrative: 'The card service returns the card with `status: \'frozen\'`. The Wallet shows a "Frozen" badge; because `canFreezeCard` is now false and `canUnfreezeCard` is true, the Freeze button is replaced by "Unfreeze". "Add travel notice" and "Report lost / stolen" remain available.',
    audience: { 'end-user': 'On the Cards page your debit card now says "Frozen".' },
    detail: 2,
    variants: APPROVED,
    payload: { title: 'CardDTO (excerpt)', format: 'json', data: { id: CARD_ID, last4: '4821', cardType: 'debit', network: 'visa', status: 'frozen', accountName: 'Everyday Checking' }, typeRef: 'sh:cards#CardDTO', highlight: ['status'] },
    sources: [s(F.cards, 137, 149, 'export async function listCards'), s(F.cuWallet, 437, 458, 'canUnfreezeCard(card.status)')],
  },
  {
    id: 'customer-outcome',
    kind: 'state',
    title: 'Money back, card frozen, alert gone',
    from: DASH,
    to: CUSTOMER,
    label: '$2,500.00 current · card frozen',
    narrative: 'On the next dashboard load Everyday Checking reads $2,500.00 current and $2,380.00 available — the balance is re-derived from the ledger and the reversed QuickFuel entry no longer counts. In the account’s history the charge moves to the "Other — failed or reversed — no balance effect" group. The security alert has disappeared, because only `pending` alerts are listed.',
    audience: {
      executive: 'Outcome: the customer has her $48.90 back, her card is locked, and the alert is closed — all recorded in the audit trail.',
      'end-user': 'Your balance is back up by $48.90, the charge shows as Reversed, your card is frozen and the alert is gone.',
    },
    detail: 1,
    variants: APPROVED,
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: { currentMinor: 245110, availableMinor: 233110 }, after: { currentMinor: 250000, availableMinor: 238000 } }, highlight: ['after.currentMinor', 'after.availableMinor'] },
    sources: [s(F.shLedger, 78, 88, 'Derive current and available balances'), s(F.cuTxnList, 386, 394, 'Failed or reversed — no balance effect'), s(F.fraud, 59, 63, "status: 'pending'")],
  },
  {
    id: 'unfreeze-rules',
    kind: 'note',
    title: 'Afterwards: who can unfreeze?',
    from: CUSTOMER,
    to: WALLET,
    label: '"Unfreeze" is available to the customer',
    narrative:
      'A freeze applied by confirmed fraud is an ordinary `frozen` status: the card row does not record who froze it or why. So `POST /api/cards/:id/unfreeze` works for Avery exactly as after a self-freeze — `canUnfreezeCard(\'frozen\')` passes, the card returns to `active`, a `card_unfrozen` audit row is written, and no operator is asked. Unfreezing does not undo the reversal. She can also report the frozen card lost or stolen to get a replacement with a new number.',
    audience: {
      executive: 'Worth knowing: the customer can unlock the card herself. The system does not require staff approval or a replacement card after confirmed fraud.',
      'end-user': 'You can unfreeze the card yourself, or report it to get a replacement.',
    },
    detail: 2,
    variants: APPROVED,
    sources: [s(F.cards, 247, 249, 'export function unfreezeCard'), s(F.shCards, 59, 67, 'canUnfreezeCard')],
  },

  // ---- Reject path ----------------------------------------------------------
  ...operatorDecisionSteps('reject', REJECTED, 'reject'),
  {
    id: 'dismiss-call',
    kind: 'call',
    title: 'Hand over to the fraud service',
    from: APPLY,
    to: FRAUD,
    label: 'dismissFraud(tx, existing, actor, now)',
    narrative: 'Inside the transaction, `applyOperatorAction` calls `dismissFraud`. Unlike `confirmFraud` it never looks at `ledgerEntryId` or `cardId`.',
    detail: 3,
    variants: REJECTED,
    sources: [s(F.ops, 378, 386, 'dismissFraud(tx, existing, input.actor, now)'), s(F.fraud, 201, 208, 'export async function dismissFraud')],
  },
  ...dismissSteps('legit-dismiss', [CL], 'confirm_legit'),
  ...dismissSteps('silent-dismiss', [OD, TL], null),
  {
    id: 'dismiss-no-money',
    kind: 'state',
    title: 'No reversal, no freeze',
    from: LEDGER,
    to: LEDGER,
    label: 'entry stays posted · card stays active',
    narrative: 'The QuickFuel entry is still `posted`, the card is still `active` and Everyday Checking is unchanged at $2,451.10 current / $2,331.10 available. Dismissing an alert is workflow and audit only.',
    audience: {
      executive: 'Outcome: the charge stands, the card keeps working and the alert is closed.',
      'end-user': 'Nothing changes on your account or card.',
      dba: 'LedgerEntry and Card are not written. Only OperationsRequest, AuditLog and SimulatedEvent changed.',
    },
    detail: 1,
    variants: REJECTED,
    sources: [s(F.fraud, 201, 201, 'no money effect'), s(F.testRoutes, 305, 323, 'operator DISMISS leaves money untouched')],
  },
  {
    id: 'dismiss-customer-view',
    kind: 'state',
    title: 'The alert leaves the dashboard',
    from: DASH,
    to: CUSTOMER,
    label: 'alert no longer listed',
    narrative: 'The request is now `rejected`, so `GET /api/fraud-alerts` no longer returns it and the "Security alerts" section disappears on the next load. The customer app shows no outcome message: the "dismissed" email is a simulated event visible only in the operations console.',
    audience: { 'end-user': 'The alert disappears from your dashboard. You are not shown a message about the outcome.' },
    detail: 2,
    variants: [CL, OD],
    sources: [s(F.fraud, 59, 63, "status: 'pending'"), s(F.cuDashboard, 441, 442, 'state.data.length === 0')],
  },

  // ---- responds-too-late tail ----------------------------------------------
  {
    id: 'late-click',
    kind: 'ui',
    title: 'Avery answers on a stale page',
    from: CUSTOMER,
    to: DASH,
    label: 'clicks "Report fraud" (stale dashboard)',
    narrative: 'Avery still has the dashboard open from before the operator’s decision. The alert card and its buttons are still on screen — the page does not refresh itself — and she now clicks "Report fraud".',
    detail: 1,
    variants: [TL],
    sources: [s(F.cuDashboard, 424, 439, 'async function respond')],
  },
  {
    id: 'late-request',
    kind: 'request',
    title: 'POST the late answer',
    from: DASH,
    to: ROUTES,
    label: 'POST /api/fraud-alerts/:id/respond',
    narrative: 'The same request as an on-time answer. It passes the CSRF check, `requireAuth`, the rate limit and `isFraudResponse`.',
    detail: 3,
    variants: [TL],
    payload: { title: 'Request', format: 'http-request', line: `POST /api/fraud-alerts/${ALERT_ID}/respond`, data: { response: 'report_fraud' }, typeRef: 'sh:risk#FraudResponseRequest' },
    sources: [s(F.routesRisk, 78, 85, "app.post('/api/fraud-alerts/:id/respond'")],
  },
  {
    id: 'late-check',
    kind: 'db-read',
    title: 'The alert is no longer pending',
    from: FRAUD,
    to: REQ,
    label: "status 'rejected' ≠ 'pending' → FraudError",
    narrative: '`respondToFraudAlert` loads the request. The type and subject checks pass, but `request.status` is `rejected`, so it throws `FraudError(\'invalid_state\')` before the transaction opens. Nothing is written. The same refusal happens if an operator had only put the alert on hold or requested information, since those are not `pending` either.',
    detail: 3,
    variants: [TL],
    sources: [s(F.fraud, 102, 104, "request.status !== 'pending'")],
  },
  {
    id: 'late-response',
    kind: 'response',
    title: '400 invalid_state',
    from: ROUTES,
    to: DASH,
    label: '400 { code: invalid_state }',
    narrative: 'The route maps the error with `fraudHttpStatus`: `not_found` → 404, `forbidden` → 403, anything else → 400. No real-time event is emitted.',
    detail: 2,
    variants: [TL],
    payload: { title: 'Response', format: 'http-response', line: '400 Bad Request', data: { error: 'That fraud alert has already been resolved.', code: 'invalid_state' }, highlight: ['code'] },
    sources: [s(F.routesRisk, 89, 94, 'fraudHttpStatus(err.code)'), s(F.routesRisk, 31, 33, 'function fraudHttpStatus')],
  },
  {
    id: 'late-outcome',
    kind: 'state',
    title: 'The late answer is refused',
    from: DASH,
    to: CUSTOMER,
    label: '"That fraud alert has already been resolved."',
    narrative: 'The dashboard shows the server’s message in a red banner above the alerts and leaves the buttons in place. Reloading removes the alert. The dismissal stands: to contest the charge now, Avery would file a dispute on the transaction instead.',
    audience: {
      executive: 'Once staff have closed an alert, a late customer answer is turned away; the customer’s remaining route is a dispute.',
      'end-user': 'You see "That fraud alert has already been resolved." You can still dispute the transaction from the account page.',
    },
    detail: 1,
    variants: [TL],
    sources: [s(F.cuDashboard, 434, 437, 'setActionError(result.message)'), s(F.cuDashboard, 450, 457, 'actionError')],
  },
];

const base = baseState();

export const scenario: Scenario = {
  id: 'fraud-alert',
  title: 'A fraud alert, from flag to frozen card',
  question: 'How does a fraud alert affect a customer’s card?',
  summary:
    'A suspicious card charge is flagged as an operations request. The customer’s answer is recorded but changes nothing by itself; when an operator approves the alert, one transaction reverses the charge (the money returns to the balance) and freezes the linked card. Rejecting dismisses the alert with no money or card effect.',
  category: 'risk',
  tags: ['risk', 'fraud', 'cards', 'ledger', 'operations', 'realtime', 'audit'],
  participants: [CUSTOMER, DASH, WALLET, ROUTES, FRAUD, REQ, LEDGER, CARD, APPLY, QUEUES],
  related: [
    'feat:fraud',
    'be:risk/fraud',
    'be:risk/fraud#respondToFraudAlert',
    'be:risk/fraud#confirmFraud',
    'be:risk/fraud#dismissFraud',
    'be:cards/cards#freezeCardById',
    'be:money/movements#reverseLedgerEntries',
    'be:ops/requests#applyOperatorAction',
    'ep:GET /api/fraud-alerts',
    'ep:POST /api/fraud-alerts/:id/respond',
    'sh:risk#FraudPayload',
    'cu:pages/Dashboard',
    'cu:pages/Wallet',
    'op:pages/RequestQueues',
    'op:components/RequestDetailPanel',
    'db:OperationsRequest',
    'db:LedgerEntry',
    'db:Card',
  ],
  variants: [
    { id: CF, label: 'Customer reports fraud → operator confirms', description: 'The main path: the charge is reversed and the card is frozen.', outcome: 'success' },
    { id: CL, label: 'Customer says "it was me" → operator dismisses', description: 'The answer is recorded, the alert stays open, and an operator dismisses it. No money or card effect.', outcome: 'info' },
    { id: OD, label: 'No customer answer → operator dismisses', description: 'The operator rejects the alert without a customer response: no reversal, no freeze.', outcome: 'rejected' },
    { id: AF, label: 'Card already frozen when fraud is confirmed', description: 'The customer froze the card herself first; the charge is still reversed and the freeze step is skipped.', outcome: 'success' },
    { id: TL, label: 'Customer answers after the alert was resolved', description: 'The operator has already dismissed the alert; the late answer gets 400 invalid_state.', outcome: 'rejected' },
  ],
  defaultVariant: CF,
  initialState: {
    ...base,
    Card: [
      {
        id: CARD_ID,
        accountId: IDS.checking,
        userId: IDS.avery,
        cardType: 'debit',
        network: 'visa',
        last4: '4821',
        expMonth: 9,
        expYear: 2030,
        status: 'active',
        replacesCardId: null,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
    ],
    OperationsRequest: [
      {
        id: ALERT_ID,
        type: 'fraud_alert',
        status: 'pending',
        priority: 'high',
        summary: SUMMARY,
        detail: DETAIL,
        subjectName: 'Avery Customer',
        subjectEmail: 'avery.customer@example.com',
        payload: JSON.stringify(seededPayload),
        lastAction: null,
        lastActorId: null,
        lastActorRole: null,
        lastActorName: null,
        lastActionNote: null,
        resolvedAt: null,
        createdAt: RAISED_AT,
        updatedAt: RAISED_AT,
      },
    ],
    AuditLog: [
      { id: 'aud_seed_intake', actorId: null, actorRole: 'system', action: 'ops_request_created', entity: 'operations_request', entityId: ALERT_ID, reason: SUMMARY, metadata: null },
    ],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    s(F.fraud, 19, 30, 'Fraud-alert service'),
    s(F.ops, 374, 387, 'Fraud resolution'),
    s(F.testRoutes, 285, 303, 'operator CONFIRM fraud reverses the suspicious entry and freezes the linked card'),
    s(F.seedPlan, 494, 509, "key: 'fraud-card'"),
  ],
};
