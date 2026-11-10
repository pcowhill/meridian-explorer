import type { Entity, Relation } from '../../types';
import { F, rel, s } from './helpers';

/**
 * Backend fraud alerts and disputes: `apps/backend/src/risk/fraud.ts`,
 * `apps/backend/src/risk/disputes.ts` and `apps/backend/src/routes/risk.ts`.
 */

const BF = F.fraud;
const BD = F.disputes;
const RR = F.routesRisk;
const MF = 'be:risk/fraud';
const MD = 'be:risk/disputes';
const RG = 'be:routes/risk';

export const RISK_EP = {
  dispute: 'ep:POST /api/disputes',
  alerts: 'ep:GET /api/fraud-alerts',
  respond: 'ep:POST /api/fraud-alerts/:id/respond',
} as const;

export const riskBackendEntities: Entity[] = [
  // ---- Fraud service --------------------------------------------------------
  {
    id: MF,
    kind: 'module',
    name: 'fraud.ts (fraud-alert service)',
    parent: 'be.risk',
    summary: 'Fraud alerts: listing a customer’s alerts, recording their answer, and the two operator outcomes — confirm fraud (reverse the charge, freeze the card) or dismiss.',
    description:
      'A fraud alert is not its own table. It is an `OperationsRequest` row with `type: "fraud_alert"`, addressed to a customer by `subjectEmail`, whose JSON `payload` (`FraudPayload`) names the merchant and amount and soft-links the suspicious ledger entry and the card.\n\nTwo parties act on it. The CUSTOMER answers "it was me" or "report fraud"; that answer is written into the payload and never resolves the alert. An OPERATOR then decides through the ordinary request-queue action: Approve calls `confirmFraud`, Reject calls `dismissFraud`, both inside the transaction `applyOperatorAction` opens.\n\nNothing in the running backend RAISES a fraud alert: there is no detection logic and no endpoint that creates one. The only alert in a fresh database is the seeded QuickFuel one; tests insert their own rows directly.',
    audience: {
      executive: 'Handles suspicious charges: the customer says whether a charge was theirs, and bank staff either confirm fraud — refunding the charge and locking the card — or dismiss the alert.',
      'end-user': 'Behind the "Security alerts" box on your dashboard and what happens after you tap "Report fraud".',
      dba: 'Reads and updates `OperationsRequest` (type `fraud_alert`, JSON `payload`). On confirm: `LedgerEntry.status` → `reversed` and `Card.status` → `frozen` via helpers. Inserts `AuditLog` and `SimulatedEvent` rows. No table of its own.',
    },
    tech: ['Prisma'],
    tags: ['risk', 'fraud', 'domain', 'operations', 'audit'],
    aliases: ['fraud service', 'apps/backend/src/risk/fraud.ts'],
    sources: [s(BF, 19, 30, 'Fraud-alert service (v0.8.0)'), s(F.seedPlan, 494, 509, "key: 'fraud-card'", 'The only fraud alert that exists without a test: the seeded QuickFuel alert')],
  },
  {
    id: `${MF}#FraudErrorCode`,
    kind: 'type',
    name: 'FraudErrorCode',
    parent: MF,
    summary: 'The three failure codes of a customer fraud response.',
    values: [
      { value: 'not_found', meaning: 'No request with that id, or it is not a `fraud_alert` → HTTP 404.' },
      { value: 'forbidden', meaning: 'The alert’s `subjectEmail` is not the caller’s email → HTTP 403.' },
      { value: 'invalid_state', meaning: 'The request’s status is no longer `pending` → HTTP 400.' },
    ],
    aliases: ['FraudError'],
    tags: ['risk'],
    sources: [s(BF, 32, 32, 'export type FraudErrorCode'), s(BF, 34, 41, 'export class FraudError')],
  },
  {
    id: `${MF}#FraudError`,
    kind: 'class',
    name: 'FraudError',
    parent: MF,
    summary: 'The typed error `respondToFraudAlert` throws; the route maps its code to 404, 403 or 400.',
    signature: 'class FraudError extends Error { readonly code: FraudErrorCode }',
    tags: ['risk'],
    detail: 5,
    sources: [s(BF, 34, 41, 'export class FraudError')],
  },
  {
    id: `${MF}#fraudPayloadOf`,
    kind: 'function',
    name: 'fraudPayloadOf',
    parent: MF,
    summary: 'Internal helper: parses a request’s `payload` JSON string and narrows it to a `FraudPayload`, tolerating null or malformed JSON.',
    description: 'Not exported. Every function in this file reads the payload through it, then writes back `JSON.stringify({ ...payload, <changes> })` — so each write normalises the stored JSON to exactly the seven `FraudPayload` keys.',
    signature: "fraudPayloadOf(row: Pick<OperationsRequest, 'payload'>): FraudPayload",
    tags: ['risk'],
    detail: 5,
    sources: [s(BF, 43, 51, 'function fraudPayloadOf')],
  },
  {
    id: `${MF}#listFraudAlertsForUser`,
    kind: 'function',
    name: 'listFraudAlertsForUser',
    parent: MF,
    summary: 'Returns the customer’s open fraud alerts: `fraud_alert` requests in status `pending` whose subject email is theirs.',
    description:
      'One query: `type = "fraud_alert" AND status = "pending" AND subjectEmail = user.email`, newest first, mapped to `FraudAlertSummary`.\n\nTwo consequences of the `pending` filter: an alert disappears from the customer’s dashboard as soon as an operator approves or rejects it, and ALSO if an operator puts it on hold or requests information (status `on_hold` / `info_requested`). An alert the customer has already answered stays listed, with `customerResponse` set, until the operator decides.',
    signature: 'listFraudAlertsForUser(user: SessionUser): Promise<FraudAlertSummary[]>',
    tags: ['risk'],
    sources: [s(BF, 55, 76, 'export async function listFraudAlertsForUser')],
  },
  {
    id: `${MF}#FraudResponseResult`,
    kind: 'type',
    name: 'FraudResponseResult',
    parent: MF,
    summary: 'What `respondToFraudAlert` returns: the updated request DTO and the simulated events to broadcast.',
    fields: [
      { name: 'request', type: 'OperationsRequestDTO', required: true, description: 'The alert after the response was recorded (still `pending`).' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, description: 'One inbound `fraud_response` event.' },
    ],
    tags: ['risk'],
    detail: 5,
    sources: [s(BF, 78, 81, 'export interface FraudResponseResult')],
  },
  {
    id: `${MF}#respondToFraudAlert`,
    kind: 'function',
    name: 'respondToFraudAlert',
    parent: MF,
    summary: 'Records the customer’s answer to a fraud alert on the request’s payload, with an audit row and an inbound simulated SMS — without resolving the alert.',
    description:
      'Checks, in order: the request exists and is a `fraud_alert` (else `not_found`); its `subjectEmail` equals the caller’s email, case-insensitively (else `forbidden`); its status is `pending` (else `invalid_state`, "That fraud alert has already been resolved.").\n\nThen in one transaction: update the request’s `payload` (adding `customerResponse`) and `updatedAt`; write an `AuditLog` row `fraud_customer_response`; insert a `SimulatedEvent` (`channel: sms`, `direction: inbound`, `kind: fraud_response`, `status: delivered`).\n\nThe request’s `status` is NOT changed, no ledger entry is touched and the card is not frozen — even when the answer is `report_fraud`. There is also no "already answered" check: while the alert is pending a second call overwrites the first answer (the dashboard hides the buttons once an answer is recorded, but the server would accept it).',
    signature: 'respondToFraudAlert(user: SessionUser, requestId: string, response: FraudResponse, now: Date = new Date()): Promise<FraudResponseResult>',
    tags: ['risk', 'audit'],
    aliases: ['it was me', 'report fraud', 'customer response'],
    detail: 3,
    sources: [s(BF, 83, 139, 'export async function respondToFraudAlert')],
  },
  {
    id: `${MF}#ResolvedFraud`,
    kind: 'type',
    name: 'ResolvedFraud',
    parent: MF,
    summary: 'What `confirmFraud` and `dismissFraud` return to `applyOperatorAction`: the updated request row and the simulated events to broadcast.',
    fields: [
      { name: 'request', type: 'OperationsRequest', required: true, description: 'The Prisma row after the payload update (already carrying the new workflow status).' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true },
    ],
    tags: ['risk'],
    detail: 5,
    sources: [s(BF, 143, 146, 'export interface ResolvedFraud')],
  },
  {
    id: `${MF}#confirmFraud`,
    kind: 'function',
    name: 'confirmFraud',
    parent: MF,
    summary: 'The operator’s Approve on a fraud alert: reverse the linked charge, freeze the linked card, mark the alert `confirmed_fraud`, audit it and record a simulated SMS.',
    description:
      'Runs inside the transaction opened by `applyOperatorAction`, which has already set the request to `approved`. Steps:\n\n1. If `payload.ledgerEntryId` is set, call `reverseLedgerEntries(tx, [id])`. That flips the entry to `reversed` only if it is currently `posted` or `disputed`, and returns how many rows changed. A reversed entry no longer counts in any balance, so the money reappears in both the current and available balance.\n2. If `payload.cardId` is set, call `freezeCardById(tx, cardId, now)`, which freezes the card only if it is `active` and returns whether it did.\n3. Rewrite the payload with `resolution: "confirmed_fraud"` and `reversed: reversedCount > 0`.\n4. Write an `AuditLog` row `fraud_confirmed` whose reason reads e.g. "Fraud confirmed — reversed $48.90 + card frozen (simulated)" and whose metadata carries `reversedCount` and `cardFrozen`.\n5. Insert a `SimulatedEvent` (`sms`, outbound, `fraud_confirmed`, `delivered`).\n\nBoth links are optional and both helpers are no-ops when there is nothing to do, so confirming never fails because the entry was already reversed or the card already frozen. The customer’s answer is not consulted: an operator can confirm fraud on an alert the customer said was legitimate, or on one they never answered.',
    signature: 'confirmFraud(tx: DbClient, request: OperationsRequest, actor: SessionUser, now: Date): Promise<ResolvedFraud>',
    tags: ['risk', 'money', 'ledger', 'cards', 'audit', 'operations'],
    aliases: ['confirm fraud', 'approve fraud alert'],
    detail: 3,
    sources: [s(BF, 148, 199, 'export async function confirmFraud')],
  },
  {
    id: `${MF}#dismissFraud`,
    kind: 'function',
    name: 'dismissFraud',
    parent: MF,
    summary: 'The operator’s Reject on a fraud alert: mark it `dismissed` as legitimate activity, audit it and record a simulated email — no ledger or card change.',
    description: 'Runs inside the `applyOperatorAction` transaction (request already `rejected`). Rewrites the payload with `resolution: "dismissed"`, `reversed: false`; writes an `AuditLog` row `fraud_dismissed`; inserts a `SimulatedEvent` (`email`, outbound, `fraud_dismissed`, `sent`). The charge stays `posted` and the card keeps whatever status it had.',
    signature: 'dismissFraud(tx: DbClient, request: OperationsRequest, actor: SessionUser, now: Date): Promise<ResolvedFraud>',
    tags: ['risk', 'audit', 'operations'],
    aliases: ['dismiss fraud alert', 'reject fraud alert'],
    detail: 3,
    sources: [s(BF, 201, 238, 'export async function dismissFraud')],
  },

  // ---- Dispute service ------------------------------------------------------
  {
    id: MD,
    kind: 'module',
    name: 'disputes.ts (transaction-dispute service)',
    parent: 'be.risk',
    summary: 'Disputes: a customer flags a posted transaction, which opens a queue item; an operator upholds it (the charge is reversed) or denies it (the charge stands).',
    description:
      'Filing a dispute does two things atomically: it changes the ledger entry’s status from `posted` to `disputed`, and it creates an `OperationsRequest` of type `dispute` whose payload (`DisputePayload`) carries the entry id.\n\n`disputed` is a flag, not a hold: the shared balance maths treats a disputed entry exactly like a posted one, so filing changes no balance. Money only moves at resolution, and only as a status change — uphold flips the entry to `reversed` (it stops counting, which is the refund), deny flips it back to `posted`.\n\nThe operator’s decision arrives through `applyOperatorAction` (Approve → `upholdDispute`, Reject → `denyDispute`).',
    audience: {
      executive: 'Lets a customer challenge a charge. Staff then either refund it or let it stand, and every step is recorded.',
      'end-user': 'What happens when you click "Dispute" next to a transaction, and what the bank does next.',
      dba: 'Updates `LedgerEntry.status` (posted → disputed → reversed | posted) and inserts/updates `OperationsRequest` (type `dispute`). Inserts `AuditLog` and `SimulatedEvent`. Never inserts a compensating ledger row.',
    },
    tech: ['Prisma'],
    tags: ['risk', 'disputes', 'domain', 'ledger', 'money', 'audit'],
    aliases: ['dispute service', 'chargeback', 'apps/backend/src/risk/disputes.ts'],
    sources: [s(BD, 18, 28, 'Transaction-dispute service (v0.8.0)')],
  },
  {
    id: `${MD}#DisputeErrorCode`,
    kind: 'type',
    name: 'DisputeErrorCode',
    parent: MD,
    summary: 'The three failure codes of filing a dispute.',
    values: [
      { value: 'not_found', meaning: 'No ledger entry with that id → HTTP 404.' },
      { value: 'forbidden', meaning: 'The caller is not owner/joint/authorized on the entry’s account → HTTP 403.' },
      { value: 'invalid_state', meaning: 'The entry is not `posted`, or it is a `transfer` leg → HTTP 400.' },
    ],
    tags: ['risk'],
    sources: [s(BD, 30, 30, 'export type DisputeErrorCode')],
  },
  {
    id: `${MD}#DisputeError`,
    kind: 'class',
    name: 'DisputeError',
    parent: MD,
    summary: 'The typed error `createDispute` throws; the route maps its code to 404, 403 or 400.',
    signature: 'class DisputeError extends Error { readonly code: DisputeErrorCode }',
    tags: ['risk'],
    detail: 5,
    sources: [s(BD, 32, 39, 'export class DisputeError')],
  },
  {
    id: `${MD}#disputePayloadOf`,
    kind: 'function',
    name: 'disputePayloadOf',
    parent: MD,
    summary: 'Returns a request’s `DisputePayload`, or null when it is not a dispute or carries no ledger entry id.',
    description: 'Null means "workflow only": `upholdDispute` and `denyDispute` return immediately without touching the ledger, the payload, the audit log or the event feed.',
    signature: "disputePayloadOf(row: Pick<OperationsRequest, 'type' | 'payload'>): DisputePayload | null",
    tags: ['risk'],
    detail: 5,
    sources: [s(BD, 43, 53, 'export function disputePayloadOf')],
  },
  {
    id: `${MD}#CreatedDispute`,
    kind: 'type',
    name: 'CreatedDispute',
    parent: MD,
    summary: 'What `createDispute` returns: the new request DTO and the simulated events to broadcast.',
    fields: [
      { name: 'request', type: 'OperationsRequestDTO', required: true },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, description: 'One outbound `dispute_received` email event.' },
    ],
    tags: ['risk'],
    detail: 5,
    sources: [s(BD, 55, 58, 'export interface CreatedDispute')],
  },
  {
    id: `${MD}#createDispute`,
    kind: 'function',
    name: 'createDispute',
    parent: MD,
    summary: 'Files a dispute: after four checks it flags the ledger entry `disputed` and opens a pending `dispute` request, with an audit row and a simulated confirmation email, in one transaction.',
    description:
      'Checks, in order:\n\n1. the ledger entry exists (else `not_found`);\n2. the caller’s relationship to the entry’s account is `owner`, `joint` or `authorized` (else `forbidden`);\n3. the entry’s status is exactly `posted` (else `invalid_state`, "Only a posted transaction can be disputed.") — this rejects pending, held, failed, reversed and already-disputed entries;\n4. the entry’s origin is not `transfer` (else `invalid_state`, "An internal transfer cannot be disputed.") — reversing one leg of a two-leg transfer would break the rule that a transfer nets to zero.\n\nThere is no check on direction, origin beyond `transfer`, amount or age: a posted credit, a fee or a two-year-old charge can all be disputed.\n\nThen, in `prisma.$transaction`: update the entry to `disputed`; insert the `OperationsRequest` (`type: dispute`, `status: pending`, `priority: normal`, subject = the caller, payload = entry id, account id, amount, reason, details, description); write `AuditLog` `ops_request_created`; insert a `SimulatedEvent` (`email`, `dispute_received`, `sent`).',
    signature: 'createDispute(user: SessionUser, input: NormalizedDispute, now: Date = new Date()): Promise<CreatedDispute>',
    tags: ['risk', 'ledger', 'audit'],
    aliases: ['file a dispute', 'dispute a charge'],
    detail: 3,
    sources: [s(BD, 60, 152, 'export async function createDispute'), s(BD, 85, 90, 'An internal transfer posts BOTH legs', 'Why transfer legs are excluded')],
  },
  {
    id: `${MD}#ResolvedDispute`,
    kind: 'type',
    name: 'ResolvedDispute',
    parent: MD,
    summary: 'What `upholdDispute` and `denyDispute` return to `applyOperatorAction`: the request row and the simulated events to broadcast.',
    fields: [
      { name: 'request', type: 'OperationsRequest', required: true },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true },
    ],
    tags: ['risk'],
    detail: 5,
    sources: [s(BD, 154, 157, 'export interface ResolvedDispute')],
  },
  {
    id: `${MD}#upholdDispute`,
    kind: 'function',
    name: 'upholdDispute',
    parent: MD,
    summary: 'The operator’s Approve on a dispute: reverse the disputed entry (the refund), mark the request `upheld`, audit it and record a simulated email.',
    description:
      'Runs inside the `applyOperatorAction` transaction (request already `approved`). Calls `reverseLedgerEntries(tx, [payload.ledgerEntryId])`, which flips the entry from `disputed` to `reversed`; rewrites the payload with `resolution: "upheld"` and `reversed: reversedCount > 0`; writes `AuditLog` `dispute_upheld` against the LEDGER ENTRY (`entity: "ledger_entry"`); inserts a `SimulatedEvent` (`email`, `dispute_upheld`, `sent`).\n\nNo credit entry is created. The refund is the original debit ceasing to count.\n\nFor a dispute request with no linked entry it returns the request row it was given, untouched. That row was loaded before the status update, so in that edge case the API response and the real-time push still show the pre-decision status even though the database row is `approved`.',
    signature: 'upholdDispute(tx: DbClient, request: OperationsRequest, actor: SessionUser, now: Date): Promise<ResolvedDispute>',
    tags: ['risk', 'money', 'ledger', 'audit', 'operations'],
    aliases: ['uphold', 'approve dispute', 'refund'],
    detail: 3,
    sources: [s(BD, 159, 206, 'export async function upholdDispute')],
  },
  {
    id: `${MD}#denyDispute`,
    kind: 'function',
    name: 'denyDispute',
    parent: MD,
    summary: 'The operator’s Reject on a dispute: return the entry from `disputed` to `posted` (the charge stands), mark the request `denied`, audit it and record a simulated email.',
    description: 'Runs inside the `applyOperatorAction` transaction (request already `rejected`). `updateMany` sets the entry to `posted` only where it is currently `disputed`; rewrites the payload with `resolution: "denied"`, `reversed: false`; writes `AuditLog` `dispute_denied` against the ledger entry; inserts a `SimulatedEvent` (`email`, `dispute_denied`, `sent`). Balances do not change, because `disputed` already counted as posted. Once back to `posted`, the entry can be disputed again.',
    signature: 'denyDispute(tx: DbClient, request: OperationsRequest, actor: SessionUser, now: Date): Promise<ResolvedDispute>',
    tags: ['risk', 'ledger', 'audit', 'operations'],
    aliases: ['deny', 'reject dispute'],
    detail: 3,
    sources: [s(BD, 208, 254, 'export async function denyDispute')],
  },

  // ---- Route group + endpoints ---------------------------------------------
  {
    id: RG,
    kind: 'route-group',
    name: 'routes/risk.ts',
    parent: 'be.http',
    summary: 'The Fastify plugin for the three customer risk endpoints: file a dispute, list fraud alerts, respond to a fraud alert.',
    description:
      'The two POSTs use `[requireAuth, rateLimit("risk")]` (20 per 5 minutes per user, public-demo mode only); the GET uses `requireAuth`. Both POSTs publish to the operators’ Socket.IO room after the service call succeeds: the dispute sends `requestChanged("created", …)`, the fraud response sends `requestChanged("updated", …)`, and each sends one `externalEvent` per simulated event. That is how a new dispute or a customer’s fraud answer appears in an open operations console without a refresh.\n\n`DisputeError` and `FraudError` codes map to HTTP the same way: `not_found` 404, `forbidden` 403, anything else 400.\n\nThe operator’s side of both flows is NOT here — it is the generic `POST /api/ops/requests/:id/action` endpoint.',
    tech: ['Fastify'],
    tags: ['risk', 'api', 'routes', 'realtime'],
    aliases: ['riskRoutes'],
    sources: [s(RR, 35, 37, 'export async function riskRoutes'), s(RR, 16, 24, 'Customer fraud + dispute endpoints'), s(RR, 28, 33, 'disputeHttpStatus', 'Error code → HTTP status'), s(F.routesIndex, 27, 27, 'riskRoutes', 'Registration')],
  },
  {
    id: RISK_EP.dispute,
    kind: 'endpoint',
    name: 'POST /api/disputes',
    parent: RG,
    summary: 'Files a dispute against a posted transaction and queues it for operator review.',
    tags: ['risk', 'api', 'ledger'],
    detail: 3,
    sources: [s(RR, 39, 69, "app.post('/api/disputes'")],
  },
  {
    id: RISK_EP.alerts,
    kind: 'endpoint',
    name: 'GET /api/fraud-alerts',
    parent: RG,
    summary: 'Lists the signed-in customer’s pending fraud alerts.',
    tags: ['risk', 'api'],
    sources: [s(RR, 72, 75, "app.get('/api/fraud-alerts'")],
  },
  {
    id: RISK_EP.respond,
    kind: 'endpoint',
    name: 'POST /api/fraud-alerts/:id/respond',
    parent: RG,
    summary: 'Records the customer’s answer to a fraud alert — "it was me" or "report fraud".',
    tags: ['risk', 'api'],
    detail: 3,
    sources: [s(RR, 78, 95, "app.post('/api/fraud-alerts/:id/respond'")],
  },
];

const AUTH = 'be:auth/guards#requireAuth';
const RATE = 'be:abuse/rate-limit#rateLimit';
const NOW = 'be:clock/clock#simulationNow';
const AUDIT = 'be:auth/audit#writeAudit';
const REL = 'be:auth/access#getAccountRelationship';
const REVERSE = 'be:money/movements#reverseLedgerEntries';
const SIM = 'be:money/movements#recordSimEvent';
const TO_DTO = 'be:ops/requests#toOperationsRequestDTO';
const REALTIME = 'be:ops/realtime#OpsRealtime';
const EV_REQ = 'ev:ops:request_changed';
const EV_EXT = 'ev:ops:external_event';

export const riskBackendRelations: Relation[] = [
  // ---- Guards ---------------------------------------------------------------
  rel(RISK_EP.dispute, AUTH, 'guards', 'preHandler: requireAuth', { sources: [s(RR, 37, 39, 'requireAuth')], order: 1 }),
  rel(RISK_EP.respond, AUTH, 'guards', 'preHandler: requireAuth', { sources: [s(RR, 37, 37, 'requireAuth')], order: 1 }),
  rel(RISK_EP.alerts, AUTH, 'guards', 'preHandler: requireAuth', { sources: [s(RR, 72, 72, 'preHandler: requireAuth')], order: 1 }),
  rel(RISK_EP.dispute, RATE, 'guards', "rateLimit('risk')", {
    summary: 'Disputes and fraud responses share one per-user bucket (20 per 5 minutes; public-demo mode only).',
    sources: [s(RR, 37, 37, "rateLimit('risk')"), s(F.shDemo, 99, 100, 'risk:', 'The bucket size')],
    order: 2,
  }),
  rel(RISK_EP.respond, RATE, 'guards', "rateLimit('risk')", { sources: [s(RR, 37, 37, "rateLimit('risk')")], order: 2 }),

  // ---- POST /api/disputes ---------------------------------------------------
  rel(RISK_EP.dispute, 'sh:risk#validateDispute', 'validates', 'validateDispute({ ledgerEntryId, reason, details })', { sources: [s(RR, 40, 52, 'validateDispute')], order: 3 }),
  rel(RISK_EP.dispute, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RR, 54, 54, 'simulationNow(prisma)')], order: 4 }),
  rel(RISK_EP.dispute, `${MD}#createDispute`, 'calls', 'createDispute(req.user!, check.value, now)', { sources: [s(RR, 53, 55, 'createDispute(req.user!, check.value')], order: 5 }),
  rel(RISK_EP.dispute, REALTIME, 'calls', "app.opsRealtime.requestChanged('created', created.request)", { sources: [s(RR, 55, 56, "requestChanged('created'")], order: 6 }),
  rel(RISK_EP.dispute, EV_REQ, 'emits', "ops:request_changed { change: 'created', request }", {
    summary: 'The new dispute appears in every open operations console.',
    sources: [s(RR, 55, 55, "requestChanged('created', created.request)"), s(F.opsRealtime, 42, 45, 'opsRequestChanged')],
    order: 7,
  }),
  rel(RISK_EP.dispute, EV_EXT, 'emits', 'ops:external_event { event } (dispute_received)', { sources: [s(RR, 56, 56, 'externalEvent(event)'), s(F.opsRealtime, 47, 50, 'opsExternalEvent')], order: 8 }),
  rel(RISK_EP.dispute, 'sh:risk#DisputeResponse', 'uses-type', 'responds DisputeResponse (201)', { sources: [s(RR, 57, 62, 'DisputeResponse')] }),
  rel(RISK_EP.dispute, 'sh:risk#DisputeRequest', 'uses-type', 'body: DisputeRequest', { sources: [s(F.shRisk, 97, 102, 'POST /api/disputes body')] }),

  // ---- GET /api/fraud-alerts ------------------------------------------------
  rel(RISK_EP.alerts, `${MF}#listFraudAlertsForUser`, 'calls', 'listFraudAlertsForUser(req.user!)', { sources: [s(RR, 72, 75, 'listFraudAlertsForUser(req.user!)')], order: 2 }),
  rel(RISK_EP.alerts, 'sh:risk#FraudAlertListResponse', 'uses-type', 'responds FraudAlertListResponse', { sources: [s(RR, 74, 74, 'FraudAlertListResponse')] }),

  // ---- POST /api/fraud-alerts/:id/respond -----------------------------------
  rel(RISK_EP.respond, 'sh:risk#isFraudResponse', 'validates', 'isFraudResponse(body.response)', { sources: [s(RR, 81, 83, 'isFraudResponse(body.response)')], order: 3 }),
  rel(RISK_EP.respond, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RR, 85, 85, 'simulationNow(prisma)')], order: 4 }),
  rel(RISK_EP.respond, `${MF}#respondToFraudAlert`, 'calls', 'respondToFraudAlert(req.user!, id, body.response, now)', { sources: [s(RR, 84, 86, 'respondToFraudAlert(req.user!, id, body.response')], order: 5 }),
  rel(RISK_EP.respond, REALTIME, 'calls', "app.opsRealtime.requestChanged('updated', result.request)", { sources: [s(RR, 86, 87, "requestChanged('updated'")], order: 6 }),
  rel(RISK_EP.respond, EV_REQ, 'emits', "ops:request_changed { change: 'updated', request }", {
    summary: 'Operators see the customer’s answer on the alert immediately.',
    sources: [s(RR, 86, 86, "requestChanged('updated', result.request)")],
    order: 7,
  }),
  rel(RISK_EP.respond, EV_EXT, 'emits', 'ops:external_event { event } (inbound fraud_response)', { sources: [s(RR, 87, 87, 'externalEvent(event)')], order: 8 }),
  rel(RISK_EP.respond, 'sh:risk#FraudResponseRequest', 'uses-type', 'body: FraudResponseRequest', { sources: [s(F.shRisk, 34, 37, 'POST /api/fraud-alerts/:id/respond body')] }),

  // ---- Fraud service internals ---------------------------------------------
  rel(`${MF}#fraudPayloadOf`, 'sh:risk#asFraudPayload', 'calls', 'asFraudPayload(parsed)', { sources: [s(BF, 43, 51, 'asFraudPayload(parsed)')] }),
  rel(`${MF}#fraudPayloadOf`, 'sh:risk#FraudPayload', 'uses-type', 'returns FraudPayload', { sources: [s(BF, 43, 43, 'FraudPayload')] }),
  rel(`${MF}#listFraudAlertsForUser`, 'db:OperationsRequest', 'reads', "findMany where type 'fraud_alert', status 'pending', subjectEmail = user.email", { sources: [s(BF, 60, 63, 'prisma.operationsRequest.findMany')], order: 1 }),
  rel(`${MF}#listFraudAlertsForUser`, `${MF}#fraudPayloadOf`, 'calls', 'fraudPayloadOf(row)', { sources: [s(BF, 65, 65, 'fraudPayloadOf(row)')], order: 2, detail: 5 }),
  rel(`${MF}#listFraudAlertsForUser`, 'sh:risk#FraudAlertSummary', 'uses-type', 'returns FraudAlertSummary[]', { sources: [s(BF, 59, 59, 'FraudAlertSummary')] }),

  rel(`${MF}#respondToFraudAlert`, 'db:OperationsRequest', 'reads', 'findUnique by id', {
    summary: 'Then three checks: type is fraud_alert (404), subjectEmail matches the caller (403), status is pending (400).',
    sources: [s(BF, 95, 104, 'prisma.operationsRequest.findUnique')],
    order: 1,
  }),
  rel(`${MF}#respondToFraudAlert`, `${MF}#fraudPayloadOf`, 'calls', 'fraudPayloadOf(request)', { sources: [s(BF, 106, 107, 'fraudPayloadOf(request)')], order: 2, detail: 5 }),
  rel(`${MF}#respondToFraudAlert`, 'db:OperationsRequest', 'writes', 'tx: update payload (+ customerResponse) and updatedAt — status unchanged', { sources: [s(BF, 110, 113, 'tx.operationsRequest.update')], order: 3 }),
  rel(`${MF}#respondToFraudAlert`, AUDIT, 'calls', "writeAudit(tx, { action: 'fraud_customer_response', … })", { sources: [s(BF, 114, 122, "action: 'fraud_customer_response'")], order: 4 }),
  rel(`${MF}#respondToFraudAlert`, SIM, 'calls', "recordSimEvent(tx, { channel: 'sms', kind: 'fraud_response', direction: 'inbound', … }, now)", { sources: [s(BF, 123, 134, "kind: 'fraud_response'")], order: 5 }),
  rel(`${MF}#respondToFraudAlert`, TO_DTO, 'calls', 'toOperationsRequestDTO(updated)', { sources: [s(BF, 138, 138, 'toOperationsRequestDTO(updated)')], order: 6, detail: 5 }),
  rel(`${MF}#respondToFraudAlert`, 'sh:risk#FraudResponse', 'uses-type', 'response: FraudResponse', { sources: [s(BF, 89, 94, 'FraudResponse')] }),
  rel(`${MF}#respondToFraudAlert`, `${MF}#FraudError`, 'uses-type', 'throws FraudError', { sources: [s(BF, 96, 104, 'new FraudError')] }),
  rel(`${MF}#respondToFraudAlert`, `${MF}#FraudResponseResult`, 'uses-type', 'returns FraudResponseResult', { sources: [s(BF, 89, 94, 'FraudResponseResult')], detail: 5 }),
  rel(`${MF}#FraudError`, `${MF}#FraudErrorCode`, 'uses-type', 'readonly code: FraudErrorCode', { sources: [s(BF, 34, 41, 'FraudErrorCode')] }),

  rel(`${MF}#confirmFraud`, `${MF}#fraudPayloadOf`, 'calls', 'fraudPayloadOf(request)', { sources: [s(BF, 159, 159, 'fraudPayloadOf(request)')], order: 1, detail: 5 }),
  rel(`${MF}#confirmFraud`, REVERSE, 'calls', 'reverseLedgerEntries(tx, [payload.ledgerEntryId])', {
    summary: 'Flips the suspicious entry to `reversed` if it is posted or disputed; the charge stops counting in every balance.',
    sources: [s(BF, 161, 164, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])'), s(F.movements, 389, 404, 'export async function reverseLedgerEntries')],
    order: 2,
    detail: 3,
  }),
  rel(`${MF}#confirmFraud`, 'db:LedgerEntry', 'writes', "status → 'reversed' on the linked entry (via reverseLedgerEntries)", { sources: [s(F.movements, 399, 402, "status: 'reversed'")], order: 3, confidence: 'simplified' }),
  rel(`${MF}#confirmFraud`, 'be:cards/cards#freezeCardById', 'calls', 'freezeCardById(tx, payload.cardId, now)', {
    summary: 'Freezes the linked card if it is active; a missing, frozen or terminal card is skipped.',
    sources: [s(BF, 165, 168, 'freezeCardById(tx, payload.cardId, now)')],
    order: 4,
    detail: 3,
  }),
  rel(`${MF}#confirmFraud`, 'db:OperationsRequest', 'writes', "tx: update payload (resolution 'confirmed_fraud', reversed) and updatedAt", { sources: [s(BF, 170, 174, "resolution: 'confirmed_fraud'")], order: 5 }),
  rel(`${MF}#confirmFraud`, AUDIT, 'calls', "writeAudit(tx, { action: 'fraud_confirmed', metadata: { …payload, reversedCount, cardFrozen } })", { sources: [s(BF, 176, 184, "action: 'fraud_confirmed'")], order: 6 }),
  rel(`${MF}#confirmFraud`, SIM, 'calls', "recordSimEvent(tx, { channel: 'sms', kind: 'fraud_confirmed', status: 'delivered', … }, now)", { sources: [s(BF, 186, 196, "kind: 'fraud_confirmed'")], order: 7 }),
  rel(`${MF}#confirmFraud`, `${MF}#ResolvedFraud`, 'uses-type', 'returns ResolvedFraud', { sources: [s(BF, 153, 158, 'ResolvedFraud')], detail: 5 }),

  rel(`${MF}#dismissFraud`, `${MF}#fraudPayloadOf`, 'calls', 'fraudPayloadOf(request)', { sources: [s(BF, 208, 208, 'fraudPayloadOf(request)')], order: 1, detail: 5 }),
  rel(`${MF}#dismissFraud`, 'db:OperationsRequest', 'writes', "tx: update payload (resolution 'dismissed', reversed false) and updatedAt", { sources: [s(BF, 209, 213, "resolution: 'dismissed'")], order: 2 }),
  rel(`${MF}#dismissFraud`, AUDIT, 'calls', "writeAudit(tx, { action: 'fraud_dismissed', … })", { sources: [s(BF, 215, 223, "action: 'fraud_dismissed'")], order: 3 }),
  rel(`${MF}#dismissFraud`, SIM, 'calls', "recordSimEvent(tx, { channel: 'email', kind: 'fraud_dismissed', status: 'sent', … }, now)", { sources: [s(BF, 225, 235, "kind: 'fraud_dismissed'")], order: 4 }),
  rel(`${MF}#dismissFraud`, `${MF}#ResolvedFraud`, 'uses-type', 'returns ResolvedFraud', { sources: [s(BF, 202, 207, 'ResolvedFraud')], detail: 5 }),

  // ---- Dispute service internals -------------------------------------------
  rel(`${MD}#disputePayloadOf`, 'sh:risk#asDisputePayload', 'calls', 'asDisputePayload(parsed)', { sources: [s(BD, 44, 53, 'asDisputePayload(parsed)')] }),
  rel(`${MD}#disputePayloadOf`, 'sh:risk#DisputePayload', 'uses-type', 'returns DisputePayload | null', { sources: [s(BD, 44, 44, 'DisputePayload')] }),
  rel(`${MD}#DisputeError`, `${MD}#DisputeErrorCode`, 'uses-type', 'readonly code: DisputeErrorCode', { sources: [s(BD, 32, 39, 'DisputeErrorCode')] }),

  rel(`${MD}#createDispute`, 'db:LedgerEntry', 'reads', 'findUnique by input.ledgerEntryId', { sources: [s(BD, 69, 73, 'prisma.ledgerEntry.findUnique')], order: 1 }),
  rel(`${MD}#createDispute`, REL, 'calls', 'getAccountRelationship(prisma, user.id, entry.accountId)', {
    summary: 'The caller must be owner, joint or authorized on the entry’s account; otherwise forbidden (403).',
    sources: [s(BD, 75, 78, 'getAccountRelationship(prisma, user.id, entry.accountId)'), s(BD, 41, 41, 'CUSTOMER_RELATIONSHIPS')],
    order: 2,
  }),
  rel(`${MD}#createDispute`, 'db:LedgerEntry', 'writes', "tx: update status 'posted' → 'disputed'", {
    summary: 'A flag only: a disputed entry still counts in balances exactly like a posted one.',
    sources: [s(BD, 106, 108, "status: 'disputed'"), s(F.shLedger, 87, 88, 'disputed: treated like posted', 'Balance rule')],
    order: 3,
  }),
  rel(`${MD}#createDispute`, 'db:OperationsRequest', 'writes', "tx: insert 1 row (type 'dispute', status 'pending', priority 'normal', payload = DisputePayload)", { sources: [s(BD, 110, 123, 'tx.operationsRequest.create')], order: 4 }),
  rel(`${MD}#createDispute`, AUDIT, 'calls', "writeAudit(tx, { action: 'ops_request_created', entity: 'operations_request', … })", { sources: [s(BD, 125, 133, "action: 'ops_request_created'")], order: 5 }),
  rel(`${MD}#createDispute`, SIM, 'calls', "recordSimEvent(tx, { channel: 'email', kind: 'dispute_received', status: 'sent', … }, now)", { sources: [s(BD, 135, 146, "kind: 'dispute_received'")], order: 6 }),
  rel(`${MD}#createDispute`, TO_DTO, 'calls', 'toOperationsRequestDTO(request)', { sources: [s(BD, 151, 151, 'toOperationsRequestDTO(request)')], order: 7, detail: 5 }),
  rel(`${MD}#createDispute`, 'sh:risk#NormalizedDispute', 'uses-type', 'input: NormalizedDispute', { sources: [s(BD, 64, 68, 'NormalizedDispute')] }),
  rel(`${MD}#createDispute`, 'sh:risk#DisputePayload', 'uses-type', 'builds DisputePayload', { sources: [s(BD, 97, 104, 'const payload: DisputePayload')] }),
  rel(`${MD}#createDispute`, 'sh:risk#DISPUTE_REASON_LABELS', 'uses-type', 'DISPUTE_REASON_LABELS[input.reason]', { summary: 'The reason sentence goes into the request’s `detail` text.', sources: [s(BD, 92, 95, 'DISPUTE_REASON_LABELS[input.reason]')], detail: 5 }),
  rel(`${MD}#createDispute`, `${MD}#DisputeError`, 'uses-type', 'throws DisputeError', { sources: [s(BD, 73, 90, 'new DisputeError')] }),
  rel(`${MD}#createDispute`, `${MD}#CreatedDispute`, 'uses-type', 'returns CreatedDispute', { sources: [s(BD, 64, 68, 'CreatedDispute')], detail: 5 }),

  rel(`${MD}#upholdDispute`, `${MD}#disputePayloadOf`, 'calls', 'disputePayloadOf(request)', { sources: [s(BD, 170, 174, 'disputePayloadOf(request)')], order: 1, detail: 5 }),
  rel(`${MD}#upholdDispute`, REVERSE, 'calls', 'reverseLedgerEntries(tx, [payload.ledgerEntryId])', {
    summary: 'Flips the disputed entry to `reversed`; the charge stops counting, which is the refund.',
    sources: [s(BD, 176, 177, 'reverseLedgerEntries(tx, [payload.ledgerEntryId])')],
    order: 2,
    detail: 3,
  }),
  rel(`${MD}#upholdDispute`, 'db:LedgerEntry', 'writes', "status 'disputed' → 'reversed' (via reverseLedgerEntries)", { sources: [s(F.movements, 399, 402, "status: 'reversed'")], order: 3, confidence: 'simplified' }),
  rel(`${MD}#upholdDispute`, 'db:OperationsRequest', 'writes', "tx: update payload (resolution 'upheld', reversed) and updatedAt", { sources: [s(BD, 177, 181, "resolution: 'upheld'")], order: 4 }),
  rel(`${MD}#upholdDispute`, AUDIT, 'calls', "writeAudit(tx, { action: 'dispute_upheld', entity: 'ledger_entry', … })", { sources: [s(BD, 183, 191, "action: 'dispute_upheld'")], order: 5 }),
  rel(`${MD}#upholdDispute`, SIM, 'calls', "recordSimEvent(tx, { channel: 'email', kind: 'dispute_upheld', status: 'sent', … }, now)", { sources: [s(BD, 193, 203, "kind: 'dispute_upheld'")], order: 6 }),
  rel(`${MD}#upholdDispute`, `${MD}#ResolvedDispute`, 'uses-type', 'returns ResolvedDispute', { sources: [s(BD, 164, 169, 'ResolvedDispute')], detail: 5 }),

  rel(`${MD}#denyDispute`, `${MD}#disputePayloadOf`, 'calls', 'disputePayloadOf(request)', { sources: [s(BD, 218, 219, 'disputePayloadOf(request)')], order: 1, detail: 5 }),
  rel(`${MD}#denyDispute`, 'db:LedgerEntry', 'writes', "tx: updateMany status 'disputed' → 'posted' for the linked entry", { sources: [s(BD, 221, 224, "data: { status: 'posted' }")], order: 2 }),
  rel(`${MD}#denyDispute`, 'db:OperationsRequest', 'writes', "tx: update payload (resolution 'denied', reversed false) and updatedAt", { sources: [s(BD, 225, 229, "resolution: 'denied'")], order: 3 }),
  rel(`${MD}#denyDispute`, AUDIT, 'calls', "writeAudit(tx, { action: 'dispute_denied', entity: 'ledger_entry', … })", { sources: [s(BD, 231, 239, "action: 'dispute_denied'")], order: 4 }),
  rel(`${MD}#denyDispute`, SIM, 'calls', "recordSimEvent(tx, { channel: 'email', kind: 'dispute_denied', status: 'sent', … }, now)", { sources: [s(BD, 241, 251, "kind: 'dispute_denied'")], order: 5 }),
  rel(`${MD}#denyDispute`, `${MD}#ResolvedDispute`, 'uses-type', 'returns ResolvedDispute', { sources: [s(BD, 212, 217, 'ResolvedDispute')], detail: 5 }),

  // ---- Features -------------------------------------------------------------
  rel(MF, 'feat:fraud', 'implements', 'fraud alerts', { sources: [s(BF, 19, 30, 'Fraud-alert service')] }),
  rel(MD, 'feat:disputes', 'implements', 'transaction disputes', { sources: [s(BD, 18, 28, 'Transaction-dispute service')] }),
  rel(RG, 'feat:fraud', 'implements', 'customer fraud endpoints', { sources: [s(RR, 71, 78, '/api/fraud-alerts')] }),
  rel(RG, 'feat:disputes', 'implements', 'customer dispute endpoint', { sources: [s(RR, 36, 39, '/api/disputes')] }),
  rel('sh:risk', 'feat:fraud', 'implements', 'fraud payload + responses', { sources: [s(F.shRisk, 19, 23, 'FRAUD_RESPONSES')] }),
  rel('sh:risk', 'feat:disputes', 'implements', 'dispute payload + validator', { sources: [s(F.shRisk, 71, 81, 'DISPUTE_REASONS')] }),
  rel(RG, 'feat:realtime', 'implements', 'pushes disputes and fraud answers to operators', { sources: [s(RR, 55, 56, 'app.opsRealtime')] }),
  rel(MF, 'feat:audit', 'implements', 'audits every fraud step', { sources: [s(BF, 176, 184, 'writeAudit')] }),
  rel(MD, 'feat:audit', 'implements', 'audits every dispute step', { sources: [s(BD, 183, 191, 'writeAudit')] }),
  rel(MF, 'feat:sim-messaging', 'implements', 'simulated fraud SMS / email events', { sources: [s(BF, 186, 196, 'recordSimEvent')] }),
  rel(`${MF}#confirmFraud`, 'feat:balances', 'implements', 'refund by status change, never a balance edit', { sources: [s(BF, 28, 29, 'reverses via a ledger STATUS change')], confidence: 'simplified' }),
];
