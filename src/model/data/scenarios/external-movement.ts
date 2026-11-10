import type { Scenario, ScenarioStep, SourceRef } from '../../types';
import { IDS, baseState } from '../fixtures';
import { AVERY, CHK, HEADERS_OK, SIM_NOW, bal, eventDTO, movementRows, pendingBacklog, requestDTO, step } from '../money/scenario-data';

/**
 * "What happens when a customer submits a deposit, ACH, wire or bill payment?"
 *
 * Avery submits a reviewable external movement from the Move money page. The
 * default story is a $44.05 bill payment to Metro Water Services from Everyday
 * Checking (current $2,451.10, available $2,331.10 — the fixture's $120.00 City
 * Power & Light payment is already pending with its own queue item). The item
 * then waits for an operator; `ops-approval` continues from there.
 */

// ---- Lanes ------------------------------------------------------------------
const AVERY_ROLE = 'role:customer';
const PAGE = 'cu:pages/MoveMoney';
const CLIENT = 'cu:lib/money#createMovement';
const EP = 'ep:POST /api/movements';
const VALIDATE = 'sh:money-movement#validateExternalMovement';
const SERVICE = 'be:money/movements#createExternalMovement';
const DB = 'db';
const RT = 'be:ops/realtime#SocketOpsRealtime';
const CONSOLE = 'op:lib/OpsDataContext';

// ---- Sources ------------------------------------------------------------------
const F = {
  moveMoney: 'apps/customer/src/pages/MoveMoney.tsx',
  dashboard: 'apps/customer/src/pages/Dashboard.tsx',
  cuMoney: 'apps/customer/src/lib/money.ts',
  cuAuth: 'apps/customer/src/lib/auth.ts',
  routes: 'apps/backend/src/routes/money.ts',
  shMove: 'packages/shared/src/money-movement.ts',
  shDemo: 'packages/shared/src/public-demo.ts',
  shConst: 'packages/shared/src/constants.ts',
  movements: 'apps/backend/src/money/movements.ts',
  audit: 'apps/backend/src/auth/audit.ts',
  guards: 'apps/backend/src/auth/guards.ts',
  sessions: 'apps/backend/src/auth/sessions.ts',
  csrf: 'apps/backend/src/auth/csrf.ts',
  rateLimit: 'apps/backend/src/abuse/rate-limit.ts',
  server: 'apps/backend/src/server.ts',
  clock: 'apps/backend/src/clock/clock.ts',
  requests: 'apps/backend/src/ops/requests.ts',
  opsRealtime: 'apps/backend/src/ops/realtime.ts',
  socketServer: 'apps/backend/src/realtime.ts',
  opsSocket: 'apps/operations/src/lib/useOpsSocket.ts',
  opsData: 'apps/operations/src/lib/OpsDataContext.tsx',
  ledger: 'packages/shared/src/ledger.ts',
  moneyTest: 'apps/backend/src/routes/money.test.ts',
  capsTest: 'apps/backend/src/routes/caps.test.ts',
} as const;

const src = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

// ---- Variants -------------------------------------------------------------------
type V = 'outbound-bill-pay' | 'inbound-deposit' | 'insufficient-funds' | 'limit-reached';
const SUCCESS: V[] = ['outbound-bill-pay', 'inbound-deposit'];
const BILL: V[] = ['outbound-bill-pay', 'limit-reached'];
const PAST_FUNDS: V[] = ['outbound-bill-pay', 'inbound-deposit', 'limit-reached'];

// ---- Example values ---------------------------------------------------------------
const WALL_POST = '2026-10-01T15:07:30.000Z';
const plus8h = (iso: string) => new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString();

const SESSION_AVERY = {
  id: 'ses_avery',
  userId: IDS.avery,
  tokenHash: '<sha-256 of the mer_session token>',
  createdAt: '2026-10-01T14:30:00.000Z',
  lastSeenAt: '2026-10-01T15:05:12.000Z',
  expiresAt: '2026-10-01T23:05:12.000Z',
  revokedAt: null,
};

/** The queue item that already controls fixture row le_003 (as in `ops-approval`). */
const EXISTING_BILLPAY = (() => {
  const r = movementRows({
    entryId: 'le_003',
    requestId: 'req_billpay',
    auditId: 'aud_001',
    eventId: 'evt_001',
    kind: 'bill_pay',
    opsType: 'bill_pay',
    label: 'Bill payment',
    amountMinor: 12000,
    amountText: '$120.00',
    direction: 'outbound',
    counterparty: 'City Power & Light',
    description: 'Bill payment — City Power & Light',
    reference: 'MOV-4F9A2C',
  });
  return { ...r.request, createdAt: '2026-10-01T14:40:00.000Z', updatedAt: '2026-10-01T14:40:00.000Z' };
})();

interface Form {
  tab: string;
  kind: 'bill_pay' | 'mobile_check_deposit';
  typed: string;
  amountMinor: number;
  direction: 'inbound' | 'outbound';
  counterparty: string | null;
}
const BILL_FORM: Form = { tab: 'Pay a bill', kind: 'bill_pay', typed: '44.05', amountMinor: 4405, direction: 'outbound', counterparty: 'Metro Water Services' };
const BIG_FORM: Form = { ...BILL_FORM, typed: '2500.00', amountMinor: 250000 };
const DEP_FORM: Form = { tab: 'Deposit a check', kind: 'mobile_check_deposit', typed: '320.00', amountMinor: 32000, direction: 'inbound', counterparty: null };

const bodyOf = (f: Form) => ({ accountId: CHK, kind: f.kind, amountMinor: f.amountMinor, direction: f.direction, counterparty: f.counterparty, memo: null });

const BILL_ROWS = movementRows({
  entryId: 'le_005',
  requestId: 'req_mov1',
  auditId: 'aud_mov1',
  eventId: 'evt_mov1',
  kind: 'bill_pay',
  opsType: 'bill_pay',
  label: 'Bill payment',
  amountMinor: 4405,
  amountText: '$44.05',
  direction: 'outbound',
  counterparty: 'Metro Water Services',
  description: 'Bill payment — Metro Water Services',
  reference: 'MOV-7C21D4',
});
const DEP_ROWS = movementRows({
  entryId: 'le_005',
  requestId: 'req_mov1',
  auditId: 'aud_mov1',
  eventId: 'evt_mov1',
  kind: 'mobile_check_deposit',
  opsType: 'deposit',
  label: 'Mobile check deposit',
  amountMinor: 32000,
  amountText: '$320.00',
  direction: 'inbound',
  counterparty: null,
  description: 'Mobile check deposit',
  reference: 'MOV-3A90E1',
});
const ROWS: Record<'outbound-bill-pay' | 'inbound-deposit', typeof BILL_ROWS> = { 'outbound-bill-pay': { ...BILL_ROWS, audit: { ...BILL_ROWS.audit, createdAt: WALL_POST } }, 'inbound-deposit': { ...DEP_ROWS, audit: { ...DEP_ROWS.audit, createdAt: WALL_POST } } };

const BEFORE = bal(245110, 233110, 0, 12000);
const AFTER = { 'outbound-bill-pay': bal(245110, 228705, 0, 16405), 'inbound-deposit': bal(245110, 233110, 32000, 12000) };

// ---- Per-variant step builders ------------------------------------------------------

function formSteps(f: Form, variants: V[], suffix: string): ScenarioStep[] {
  const isBill = f.kind === 'bill_pay';
  const amountText = `$${(f.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  return [
    step(`fill-${suffix}`, 'ui', AVERY_ROLE, PAGE, isBill ? `Avery fills in Pay a bill (${amountText})` : 'Avery fills in Deposit a check ($320.00)', isBill ? `Submit payment: ${f.counterparty}, ${f.typed}` : `Submit deposit: ${f.typed}`,
      isBill
        ? `On the "${f.tab}" tab Avery chooses "Everyday Checking · Checking — $2,331.10 available" under Pay from, types "${f.counterparty}" as the Biller and "${f.typed}" as the amount, leaves the memo empty and presses Submit payment.${f.amountMinor > 233110 ? ' The amount is more than her available balance, but the form does not know that — it only checks shape.' : ''}`
        : 'On the "Deposit a check" tab Avery chooses Everyday Checking under Deposit into and types "320.00". There is no counterparty field: a mobile check deposit is the only kind that does not need one. She presses Submit deposit.',
      {
        audience: {
          executive: isBill ? `The customer asks the bank to pay a ${amountText} water bill.` : 'The customer deposits a $320.00 check from her phone.',
          'end-user': isBill ? `Avery enters the biller and ${amountText}, then presses Submit payment.` : 'Avery enters $320.00 and presses Submit deposit.',
        },
        detail: 1,
        variants,
        sources: isBill ? [src(F.moveMoney, 814, 856, 'id="bill-counterparty"')] : [src(F.moveMoney, 537, 569, 'id="deposit-amount"')],
      }),
    step(`client-validate-${suffix}`, 'validate', PAGE, VALIDATE, 'The form runs the shared validator', 'validateExternalMovement(form)', `\`handleSubmit\` converts the typed "${f.typed}" to ${f.amountMinor} minor units with \`toMinor\` and calls \`validateExternalMovement\` from the shared package — the same function the server runs. It resolves the direction (${isBill ? 'a bill payment is always outbound' : 'a mobile check deposit is always inbound'}), normalizes the empty memo to null${isBill ? ' and requires the biller name' : ''}. It passes, and the normalized value is what gets sent.`, {
      detail: 4,
      variants,
      payload: { title: 'Normalized value', format: 'return', data: { ok: true, errors: {}, value: bodyOf(f) }, typeRef: 'sh:money-movement#NormalizedExternalMovement', highlight: ['value.direction', 'value.amountMinor'] },
      sources: isBill
        ? [src(F.moveMoney, 776, 796, "kind: 'bill_pay'"), src(F.moveMoney, 262, 268, 'function parseAmountMinor')]
        : [src(F.moveMoney, 500, 518, "kind: 'mobile_check_deposit'"), src(F.moveMoney, 262, 268, 'function parseAmountMinor')],
    }),
    step(`request-${suffix}`, 'request', CLIENT, EP, 'POST /api/movements', 'POST /api/movements', `One JSON POST carrying the normalized movement. The browser attaches the httpOnly \`mer_session\` cookie (\`credentials: "include"\`) and the page copies the \`mer_csrf\` cookie into the \`x-meridian-csrf\` header. The customer app sends no \`x-meridian-surface\` header, so the backend reads the customer cookie. This is the whole interface: the endpoint authenticates with a signed-in customer's session cookie only — Meridian has no API key, service account, or webhook through which an outside payment service could submit or confirm a movement.`, {
      audience: {
        executive: 'The app sends the request to the bank\'s server under the customer\'s signed-in session.',
        systems: 'HTTPS POST, JSON body, cookie session + double-submit CSRF header. Accepted kinds: external_ach, wire, mobile_check_deposit, bill_pay. No machine-to-machine credential exists.',
      },
      detail: 2,
      variants,
      payload: { title: 'Movement request', format: 'http-request', line: 'POST /api/movements', headers: HEADERS_OK, data: bodyOf(f), typeRef: 'sh:money-movement#ExternalMovementRequest', highlight: ['kind', 'amountMinor', 'counterparty'] },
      sources: [src(F.cuMoney, 136, 144, 'export function createMovement'), src(F.cuMoney, 92, 94, 'async function postMoney'), src(F.cuMoney, 13, 17, 'x-meridian-surface')],
    }),
  ];
}

function serverValidateStep(f: Form, variants: V[], suffix: string): ScenarioStep {
  return step(`server-validate-${suffix}`, 'validate', EP, VALIDATE, 'The server re-validates the body', 'validateExternalMovement(body)', 'The handler never trusts the client\'s check. It copies only known fields — strings cut to 500 characters, `amountMinor` only if it is a JSON number, anything else dropped — and runs the shared validator again. The rules: `kind` must be one of `external_ach`, `wire`, `mobile_check_deposit`, `bill_pay` (`internal_transfer` is refused here; it has its own endpoint); `amountMinor` must be an integer from 1 to 5,000,000 ($0.01–$50,000.00); direction is fixed for wire and bill pay (outbound) and mobile check deposit (inbound), and must be sent as `inbound` or `outbound` for an external ACH; a counterparty (trimmed, at most 80 characters) is required for every kind except a mobile check deposit; the memo is optional (at most 140). Any failure answers 400 `invalid_request` with a per-field `fields` map.', {
    audience: { systems: 'Validation errors: 400 { error, code: "invalid_request", fields: { accountId | kind | amountMinor | direction | counterparty: message } }.' },
    detail: 3,
    variants,
    payload: { title: 'NormalizedExternalMovement', format: 'return', data: bodyOf(f), typeRef: 'sh:money-movement#NormalizedExternalMovement', highlight: ['direction', 'counterparty'] },
    sources: [
      src(F.routes, 92, 104, "app.post('/api/movements'"),
      src(F.shMove, 233, 285, 'export function validateExternalMovement'),
      src(F.shMove, 64, 70, 'MOVEMENT_FIXED_DIRECTION'),
      src(F.shMove, 99, 105, 'export const MOVEMENT_LIMITS'),
      src(F.routes, 55, 59, "code: 'invalid_request'"),
    ],
  });
}

function writeSteps(v: 'outbound-bill-pay' | 'inbound-deposit'): ScenarioStep[] {
  const r = ROWS[v];
  const out = v === 'outbound-bill-pay';
  const dto = requestDTO(r.request, r.payload);
  const evDto = eventDTO(r.event);
  return [
    step(`describe-${v}`, 'call', SERVICE, SERVICE, 'Reference, wording and ledger origin', `${r.payload.reference} · origin ${out ? 'payment' : 'deposit'}`, `\`generateMovementReference\` makes a short simulated code from three random bytes: ${r.payload.reference}. \`describeMovement\` builds the queue summary "${r.summary}", the ledger description "${r.entry.description}" and the operator detail text. \`movementLedgerOrigin\` picks the origin from the direction: ${out ? 'money going out is a `payment`' : 'money coming in is a bank-originated `deposit`'}.`, {
      detail: 4,
      variants: [v],
      payload: { title: 'Derived values', format: 'json', data: { reference: r.payload.reference, summary: r.summary, description: r.entry.description, origin: r.entry.origin } },
      sources: [src(F.movements, 69, 72, 'export function generateMovementReference'), src(F.movements, 241, 265, 'function describeMovement'), src(F.shMove, 91, 94, 'export function movementLedgerOrigin')],
    }),
    step(`write-entry-${v}`, 'db-write', SERVICE, DB, 'Insert the PENDING ledger entry', `INSERT LedgerEntry (pending ${out ? 'debit' : 'credit'})`, `A Prisma transaction opens. The first write is the ledger entry: ${out ? 'a debit' : 'a credit'} of ${r.payload.amountMinor} with \`status: "pending"\`, \`postedAt: null\` and \`createdAt\` at the simulated now. No money has moved: ${out ? 'a pending debit only reserves available' : 'a pending credit is not counted in available'}.`, {
      audience: {
        executive: out ? 'The bank records the payment as pending and sets the money aside.' : 'The bank records the deposit as pending; the money is not usable yet.',
        dba: `INSERT LedgerEntry ${r.entry.id} (${out ? 'debit' : 'credit'} ${r.payload.amountMinor}, status pending, origin ${r.entry.origin}, postedAt NULL, createdAt = SimulationClock.currentTime).`,
      },
      detail: 1,
      variants: [v],
      payload: { title: `LedgerEntry ${r.entry.id}`, format: 'row', data: r.entry, typeRef: 'db:LedgerEntry', highlight: ['status', 'direction', 'postedAt'] },
      effects: [{ op: 'insert', table: 'LedgerEntry', row: r.entry }],
      sources: [src(F.movements, 314, 328, 'tx.ledgerEntry.create')],
    }),
    step(`write-request-${v}`, 'db-write', SERVICE, DB, 'Insert the operations request with the movement payload', `INSERT OperationsRequest (${r.request.type})`, `The queue item: type \`${r.request.type}\` (mapped from the kind), status \`pending\`, priority \`${r.request.priority}\` (only a wire is \`high\`), Avery's name and email as the subject. Its \`payload\` is the \`MovementPayload\` as a JSON string, and \`ledgerEntryIds: ["${r.entry.id}"]\` is the only link to the ledger — a soft link, not a foreign key — that approval or rejection later follows to post or fail the entry.`, {
      audience: { dba: `INSERT OperationsRequest ${r.request.id}; payload is TEXT JSON. No FK to LedgerEntry: the link is payload.ledgerEntryIds.` },
      detail: 4,
      variants: [v],
      payload: { title: 'MovementPayload (stored as JSON text)', format: 'row', data: r.payload, typeRef: 'sh:money-movement#MovementPayload', highlight: ['ledgerEntryIds', 'reference'] },
      effects: [{ op: 'insert', table: 'OperationsRequest', row: r.request }],
      sources: [src(F.movements, 330, 354, 'tx.operationsRequest.create'), src(F.shMove, 289, 307, 'export interface MovementPayload'), src(F.shMove, 73, 78, 'REVIEWABLE_MOVEMENT_OPS_TYPE')],
    }),
    step(`write-audit-${v}`, 'db-write', SERVICE, DB, 'Insert the intake audit row', 'INSERT AuditLog (ops_request_created)', 'An `ops_request_created` audit row with Avery as actor, the request as entity and the reference, kind and ledger entry id in its metadata. The request-detail history shows this row as "Created". `writeAudit` sets no `createdAt`, so the column default (the database\'s wall clock) applies, not the simulated time.', {
      audience: { dba: 'INSERT AuditLog (actorId usr_avery, actorRole customer, action ops_request_created, entity operations_request, metadata JSON text); createdAt = now() wall clock.' },
      detail: 5,
      variants: [v],
      payload: { title: 'AuditLog row', format: 'row', data: r.audit, typeRef: 'db:AuditLog', highlight: ['action', 'metadata'] },
      effects: [{ op: 'insert', table: 'AuditLog', row: r.audit }],
      sources: [src(F.movements, 356, 365, "action: 'ops_request_created'"), src(F.audit, 44, 67, 'export async function writeAudit')],
    }),
    step(`write-event-${v}`, 'db-write', SERVICE, DB, 'Insert the simulated "received" email', 'INSERT SimulatedEvent (movement_received)', '`recordSimEvent` writes a clearly labelled simulated outbound email, "received — under review", linked to the request. No email is sent anywhere. The transaction commits: all four rows or none.', {
      audience: { executive: 'A confirmation is logged as if emailed — in this simulation nothing is actually sent.' },
      detail: 4,
      variants: [v],
      payload: { title: 'SimulatedEvent row', format: 'row', data: r.event, typeRef: 'db:SimulatedEvent', highlight: ['kind', 'summary'] },
      effects: [{ op: 'insert', table: 'SimulatedEvent', row: r.event }],
      sources: [src(F.movements, 367, 382, "kind: 'movement_received'"), src(F.movements, 134, 161, 'export async function recordSimEvent')],
    }),
    step(`emit-changed-${v}`, 'event', EP, RT, 'Push the new queue item to operators', `ops:request_changed (created)`, 'Back in the handler, after the commit, `app.opsRealtime.requestChanged("created", request)` emits `ops:request_changed` to the Socket.IO room `ops` only. Only sockets whose handshake resolved to a live operations session of an ops_agent or admin are in that room, so no customer socket receives it.', {
      audience: { executive: 'Bank staff see the new request appear immediately.', systems: 'Socket.IO emit to room "ops"; payload { change, request } with the request DTO (payload parsed, no lastActorId/Role).' },
      detail: 1,
      variants: [v],
      payload: { title: 'ops:request_changed', format: 'socket', data: { change: 'created', request: dto }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['change', 'request.status'] },
      sources: [src(F.routes, 107, 108, "requestChanged('created', created.request)"), src(F.opsRealtime, 42, 45, 'requestChanged(change: OpsRequestChange'), src(F.requests, 75, 93, 'export function toOperationsRequestDTO'), src(F.socketServer, 75, 85, 'joinOpsRoomIfOperator')],
    }),
    step(`emit-event-${v}`, 'event', EP, RT, 'Push the simulated email to the events feed', 'ops:external_event', 'Each event the service returned is emitted as `ops:external_event` to the same `ops` room, feeding the console\'s simulated-events list.', {
      detail: 4,
      variants: [v],
      payload: { title: 'ops:external_event', format: 'socket', data: { event: evDto }, typeRef: 'sh:operations#OpsExternalEventPayload' },
      sources: [src(F.routes, 109, 109, 'app.opsRealtime.externalEvent(event)'), src(F.opsRealtime, 47, 50, 'externalEvent(event: SimulatedEventDTO)'), src(F.shConst, 32, 37, "opsExternalEvent: 'ops:external_event'")],
    }),
    step(`console-receives-${v}`, 'event', RT, CONSOLE, 'The operations console updates live', 'upsertRequest · prependEvent', '`useOpsSocket` holds one Socket.IO connection (with the operations cookie and the `x-meridian-surface: operations` handshake header) and forwards both events. `OpsDataProvider` inserts the new request at the top of its in-memory queue (it is not yet known by id) and prepends the event to the feed, de-duplicated by id. Every open Request queues page shows the item as Pending without a reload.', {
      audience: { 'end-user': 'In the bank\'s console the new request appears at once in the pending queue.' },
      detail: 3,
      variants: [v],
      sources: [src(F.opsSocket, 40, 56, 'SOCKET_EVENTS.opsRequestChanged'), src(F.opsData, 41, 56, 'const upsertRequest'), src(F.opsData, 96, 98, 'onRequestChanged: ({ request }) => upsertRequest(request)')],
    }),
    step(`response-${v}`, 'response', EP, CLIENT, '201 pending_review', `201 { reference: ${r.payload.reference} }`, 'The handler answers 201 with the reference, the kind, `status: "pending_review"`, amount, direction and a message saying the movement waits for operator review. The ledger entry id and the request id are not returned.', {
      audience: { systems: 'The only correlation handle the caller gets is `reference`; the ledger entry and request ids stay server-side, and nothing calls the submitter back when the movement is decided.' },
      detail: 2,
      variants: [v],
      payload: {
        title: 'ExternalMovementResponse',
        format: 'http-response',
        line: '201 Created',
        data: {
          reference: r.payload.reference,
          kind: r.payload.kind,
          status: 'pending_review',
          amountMinor: r.payload.amountMinor,
          direction: r.payload.direction,
          message: 'Your simulated movement was submitted and is awaiting operator review. It will appear as “Pending” until an operator posts it. (SIMULATION — no real money network was contacted.)',
        },
        typeRef: 'sh:money-movement#ExternalMovementResponse',
        highlight: ['reference', 'status'],
      },
      sources: [src(F.routes, 111, 120, "status: 'pending_review'"), src(F.shMove, 343, 351, 'export interface ExternalMovementResponse')],
    }),
    step(`done-${v}`, 'ui', PAGE, AVERY_ROLE, 'Submitted for review', `Reference ${r.payload.reference}`, `The form is replaced by the amber "Submitted for review" panel: the server message, the reference ${r.payload.reference}, "${out ? 'Bill payment' : 'Mobile check deposit'}" with its amount, and the note that it appears as Pending until an operator posts it.`, {
      audience: { 'end-user': `Avery sees "Submitted for review" with reference ${r.payload.reference}.` },
      detail: 2,
      variants: [v],
      sources: [src(F.moveMoney, 328, 358, 'Submitted for review'), src(F.moveMoney, out ? 797 : 520, out ? 800 : 523, 'setDone(result.data)')],
    }),
    step(`balance-${v}`, 'state', DB, AVERY_ROLE, out ? 'Available drops; current is unchanged' : 'Pending credit; nothing to spend yet', out ? 'available $2,331.10 → $2,287.05' : 'pending credit $320.00; available unchanged', out
      ? 'The next time Avery\'s accounts load, `deriveBalances` applies the pending-debit rule to the new row: available falls by 4405 to 228705 and pending debits rise to 16405; current stays 245110. Her dashboard card reads "Includes $164.05 pending/held." and the transaction list shows the payment as Pending.'
      : 'The next time Avery\'s accounts load, `deriveBalances` puts the new row under pending credits (32000) and changes neither current (245110) nor available (233110). Avery cannot spend the deposit until an operator posts it. The transaction list shows it as Pending.', {
      audience: {
        executive: out ? 'The money is set aside immediately but has not left the account.' : 'The deposit is recorded but cannot be spent until staff approve it.',
        'end-user': out ? 'Avery\'s available balance drops to $2,287.05; her current balance is still $2,451.10.' : 'Avery sees the $320.00 deposit as pending; her available balance is still $2,331.10.',
        dba: out ? 'available = 245110 − (12000 + 4405) = 228705; current = 245110.' : 'pendingCredit = 32000; current = available-before-debits = 245110; available = 245110 − 12000 = 233110.',
      },
      detail: 1,
      variants: [v],
      payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: BEFORE, after: AFTER[v] }, typeRef: 'sh:ledger#DerivedBalances', highlight: out ? ['after.availableMinor', 'after.pendingDebitMinor'] : ['after.pendingCreditMinor'] },
      sources: [src(F.ledger, 111, 119, "case 'pending':"), out ? src(F.moneyTest, 189, 201, 'The pending debit immediately reserves available') : src(F.moneyTest, 147, 170, 'queues a mobile check deposit as a PENDING credit')],
    }),
  ];
}

// ---- Steps ----------------------------------------------------------------------
const steps: ScenarioStep[] = [
  step('setup-backlog', 'note', DB, DB, 'Setup: 25 movements already await review', '24 pending deposits + req_billpay', 'For this variant Avery already has 24 $1.00 mobile check deposits waiting in the queue, plus the City Power & Light payment — 25 pending movement requests in total. Each deposit is a pending queue item with a pending credit entry; pending credits change no balance.', {
    audience: { dba: '25 OperationsRequest rows with status pending, subjectEmail avery.customer@example.com and type in (ach, wire, deposit, bill_pay).' },
    detail: 2,
    variants: ['limit-reached'],
    effects: pendingBacklog(24),
    sources: [src(F.capsTest, 146, 162, 'movements awaiting review per user are capped')],
  }),
  step('open-move-money', 'ui', AVERY_ROLE, PAGE, 'Avery opens Move money', 'open /move-money', 'Avery, signed in to the customer app, follows a dashboard quick link to Move money (Bill pay passes `state: { tab: "bill" }`; Deposit a check is a tab on the same page). The page loads her accounts once with `GET /api/accounts` and offers only active accounts she does not merely view; each option shows the derived available balance.', {
    audience: { 'end-user': 'Avery opens the Move money page.' },
    detail: 2,
    sources: [src(F.moveMoney, 913, 921, 'void fetchAccounts().then((data) =>'), src(F.moveMoney, 70, 81, 'function movableAccounts'), src(F.dashboard, 585, 592, "state={{ tab: 'bill' }}")],
  }),
  ...formSteps(BILL_FORM, BILL, 'bill'),
  ...formSteps(DEP_FORM, ['inbound-deposit'], 'deposit'),
  ...formSteps(BIG_FORM, ['insufficient-funds'], 'big'),
  step('global-hooks', 'guard', EP, EP, 'Global hooks: CSRF and the mutation valve', 'csrfHook · mutationValveHook', 'Every request first passes two global `onRequest` hooks. `csrfHook`: this is a POST carrying a session cookie, so the `x-meridian-csrf` header must equal the `mer_csrf` cookie (constant-time compare) or the request ends with 403 `csrf_failed`. `mutationValveHook`: only when abuse protection is on (public demo or RATE_LIMITS=true), at most 200 state-changing requests per IP per 5 minutes, else 429 `rate_limited`.', {
    detail: 4,
    sources: [src(F.csrf, 102, 116, "code: 'csrf_failed'"), src(F.rateLimit, 178, 183, 'export async function mutationValveHook'), src(F.server, 77, 81, "app.addHook('onRequest', csrfHook)")],
  }),
  step('require-auth', 'guard', EP, EP, 'requireAuth: a signed-in customer session', 'requireAuth → req.user = Avery', 'The route\'s first preHandler resolves the `mer_session` cookie to a live session: no cookie answers 401 `unauthenticated`; an expired or revoked session or disabled user answers 401 `session_expired`. The session slides forward eight hours and `req.user` becomes Avery. A session cookie is the only credential this endpoint accepts, and no role check follows — what Avery may touch is decided per account by the service.', {
    audience: { dba: 'UPDATE Session SET lastSeenAt, expiresAt (wall clock) for ses_avery.', systems: 'Authentication = browser session cookie from POST /api/auth/login. No bearer token, API key or signature scheme exists.' },
    detail: 3,
    payload: { title: 'req.user', format: 'json', data: AVERY, typeRef: 'sh:auth#SessionUser' },
    effects: [{ op: 'update', table: 'Session', id: 'ses_avery', set: { lastSeenAt: WALL_POST, expiresAt: plus8h(WALL_POST) } }],
    sources: [src(F.guards, 47, 66, 'export const requireAuth'), src(F.sessions, 50, 72, 'Sliding idle timeout'), src(F.moneyTest, 215, 218, 'requires authentication (401)')],
  }),
  step('rate-limit', 'guard', EP, EP, "rateLimit('money')", "rateLimit('money')", 'The second preHandler is a no-op unless abuse protection is on. In the public demo it counts the request against the `money` bucket keyed by user id: 30 movements or transfers per 5 minutes, then 429 `rate_limited` with a `retry-after` header.', {
    detail: 4,
    sources: [src(F.routes, 64, 64, "rateLimit('money')"), src(F.rateLimit, 158, 168, 'export function rateLimit'), src(F.shDemo, 92, 92, 'money: { max: 30')],
  }),
  serverValidateStep(BILL_FORM, BILL, 'bill'),
  serverValidateStep(DEP_FORM, ['inbound-deposit'], 'deposit'),
  serverValidateStep(BIG_FORM, ['insufficient-funds'], 'big'),
  step('call-service', 'call', EP, SERVICE, 'Hand off to the movement service', 'createExternalMovement(user, value, simNow)', 'The handler reads the simulation clock (`simulationNow`) and calls `createExternalMovement` with the session user and the normalized value. Every row the service writes is dated with that simulated instant. A `MovementError` thrown inside is mapped to an HTTP status by `handleMovementError`.', {
    detail: 3,
    payload: { title: 'Arguments', format: 'args', data: { user: AVERY, now: SIM_NOW } },
    sources: [src(F.routes, 105, 106, 'createExternalMovement(req.user!, check.value, await simulationNow(prisma))'), src(F.clock, 57, 60, 'export async function simulationNow'), src(F.routes, 32, 53, 'function movementHttpStatus')],
  }),
  step('movable-account', 'db-read', SERVICE, DB, 'May Avery move money on this account?', 'requireMovableAccount(user.id, accountId)', '`requireMovableAccount` loads the account with its ledger rows and the caller\'s relationship. Unknown account → 404 `not_found`; no relationship, or a `viewer` one → 403 `forbidden` (owner, joint and authorized may move money); account not `active` → 400 `inactive_account`. Avery owns Everyday Checking, which is active.', {
    audience: { dba: 'SELECT Account + LedgerEntry(amountMinor, direction, status) by id; SELECT AccountAccess by (userId, accountId).' },
    detail: 4,
    sources: [src(F.movements, 114, 132, 'async function requireMovableAccount'), src(F.movements, 67, 67, 'MOVABLE_RELATIONSHIPS')],
  }),
  step('funds-check', 'decision', SERVICE, SERVICE, 'Funds check (outbound only)', 'available ≥ amount?', 'For an outbound movement the service derives available from the ledger rows it just loaded and refuses an amount above it. Available is 233110: current 245110 minus the pending $120.00 bill payment. An inbound movement skips the check — incoming money needs no funds.', {
    audience: { executive: 'For money going out, the bank checks the customer can afford it, counting payments already pending.' },
    detail: 1,
    payload: { title: 'Everyday Checking before', format: 'json', data: BEFORE, typeRef: 'sh:ledger#DerivedBalances', highlight: ['availableMinor'] },
    decision: {
      question: 'Is this an outbound movement larger than the available balance?',
      options: [
        { label: 'Outbound, $44.05 ≤ $2,331.10', variant: 'outbound-bill-pay', description: 'Passes; continue to the cap check.' },
        { label: 'Inbound — no funds check', variant: 'inbound-deposit', description: 'A deposit adds money; nothing to check.' },
        { label: 'Outbound, $2,500.00 > $2,331.10', variant: 'insufficient-funds', description: '400 insufficient_funds; nothing is written.' },
      ],
    },
    sources: [src(F.movements, 287, 291, 'availableMinor(account) < input.amountMinor'), src(F.movements, 81, 89, 'function availableMinor')],
  }),
  step('insufficient-response', 'response', EP, CLIENT, '400 insufficient_funds', '400 { code: insufficient_funds }', 'The service throws `MovementError("insufficient_funds")` before opening any transaction; `handleMovementError` maps it to 400. Nothing is written and nothing is pushed to operators.', {
    audience: { executive: 'The bank refuses the payment because there is not enough money available.' },
    detail: 2,
    variants: ['insufficient-funds'],
    payload: { title: 'Error', format: 'http-response', line: '400 Bad Request', data: { error: 'That movement exceeds the available balance.', code: 'insufficient_funds' }, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code'] },
    sources: [src(F.movements, 289, 291, "'insufficient_funds'"), src(F.routes, 41, 42, 'default:'), src(F.moneyTest, 203, 212, "toBe('insufficient_funds')")],
  }),
  step('insufficient-ui', 'ui', PAGE, AVERY_ROLE, 'The form shows the server\'s message', 'banner: exceeds the available balance', '`postMoney` returns `{ ok: false, code, message }` using the server\'s `error` text; the flow shows it in a red banner above the still-filled form. No per-field errors come back, so no input is highlighted.', {
    audience: { 'end-user': 'Avery sees "That movement exceeds the available balance." and can change the amount.' },
    detail: 1,
    variants: ['insufficient-funds'],
    sources: [src(F.cuMoney, 100, 107, 'message: err?.error ?? messageForCode(code, fallback)'), src(F.moveMoney, 801, 802, 'setBanner(result.message)')],
  }),
  step('insufficient-state', 'state', DB, AVERY_ROLE, 'Nothing changed', 'balances unchanged', 'No ledger entry, queue item, audit row or event exists for the refused payment. Avery\'s balances are still current $2,451.10 and available $2,331.10.', {
    detail: 2,
    variants: ['insufficient-funds'],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: BEFORE, typeRef: 'sh:ledger#DerivedBalances' },
    sources: [src(F.movements, 289, 314, 'prisma.$transaction', 'The funds check throws before the transaction that writes the rows opens')],
  }),
  step('cap-count-ok', 'db-read', SERVICE, DB, 'Count movements awaiting review', 'COUNT pending movement requests = 1', 'The always-on resource cap: count OperationsRequest rows with status `pending`, subject email Avery\'s, and a movement type (`ach`, `wire`, `deposit`, `bill_pay`). Only the City Power & Light payment matches — 1 of 25. Requests on hold or with information requested do not count.', {
    audience: { dba: "SELECT COUNT(*) FROM OperationsRequest WHERE status = 'pending' AND subjectEmail = ? AND type IN ('ach','wire','deposit','bill_pay') → 1." },
    detail: 4,
    variants: SUCCESS,
    payload: { title: 'Cap check', format: 'json', data: { awaitingReview: 1, cap: 25 }, typeRef: 'sh:public-demo#RESOURCE_CAPS' },
    sources: [src(F.movements, 293, 302, 'prisma.operationsRequest.count'), src(F.shDemo, 131, 131, 'pendingMovementsPerUser: 25')],
  }),
  step('cap-count-full', 'db-read', SERVICE, DB, 'Count movements awaiting review', 'COUNT pending movement requests = 25', 'The same count finds 25 pending movement requests for Avery — the 24 deposits plus the City Power & Light payment.', {
    audience: { dba: "SELECT COUNT(*) … → 25 (= RESOURCE_CAPS.pendingMovementsPerUser)." },
    detail: 4,
    variants: ['limit-reached'],
    payload: { title: 'Cap check', format: 'json', data: { awaitingReview: 25, cap: 25 }, typeRef: 'sh:public-demo#RESOURCE_CAPS' },
    sources: [src(F.movements, 293, 302, 'prisma.operationsRequest.count'), src(F.shDemo, 131, 131, 'pendingMovementsPerUser: 25')],
  }),
  step('cap-decision', 'decision', SERVICE, SERVICE, 'Under the pending-movements cap?', 'awaitingReview < 25?', 'At 25 or more pending movement requests the service refuses another. The cap applies in every mode, not only the public demo, and an operator decision frees capacity.', {
    detail: 3,
    variants: PAST_FUNDS,
    decision: {
      question: 'Does Avery already have 25 movements awaiting review?',
      options: [
        { label: 'No (1 of 25) — bill payment', variant: 'outbound-bill-pay', description: 'Write the pending movement.' },
        { label: 'No (1 of 25) — deposit', variant: 'inbound-deposit', description: 'Write the pending movement.' },
        { label: 'Yes (25 of 25)', variant: 'limit-reached', description: '409 limit_reached; nothing is written.' },
      ],
    },
    sources: [src(F.movements, 303, 308, "'limit_reached'"), src(F.shDemo, 119, 134, 'export const RESOURCE_CAPS')],
  }),
  step('limit-response', 'response', EP, CLIENT, '409 limit_reached', '409 { code: limit_reached }', 'The service throws `MovementError("limit_reached")`; `movementHttpStatus` maps it to 409. Nothing is written.', {
    detail: 2,
    variants: ['limit-reached'],
    payload: { title: 'Error', format: 'http-response', line: '409 Conflict', data: { error: 'You already have 25 movements awaiting operator review (the simulated maximum).', code: 'limit_reached' }, typeRef: 'sh:auth#ApiErrorResponse', highlight: ['code'] },
    sources: [src(F.movements, 303, 308, 'movements awaiting operator review'), src(F.routes, 38, 40, "case 'limit_reached':"), src(F.capsTest, 159, 161, "toBe('limit_reached')")],
  }),
  step('limit-ui', 'ui', PAGE, AVERY_ROLE, 'The form shows the cap message', 'banner: 25 awaiting review', 'The client has no special wording for `limit_reached`, so the banner shows the server\'s message verbatim. Avery can submit again once an operator approves or rejects one of her pending items.', {
    audience: { 'end-user': 'Avery is told she already has 25 movements awaiting review.' },
    detail: 1,
    variants: ['limit-reached'],
    sources: [src(F.cuMoney, 71, 85, 'function messageForCode'), src(F.moveMoney, 801, 802, 'setBanner(result.message)')],
  }),
  ...writeSteps('outbound-bill-pay'),
  ...writeSteps('inbound-deposit'),
  step('waits-for-operator', 'note', CONSOLE, AVERY_ROLE, 'Now it waits for an operator', 'pending until approve / reject', 'No external network is contacted and nothing calls back. The ledger entry stays pending until an operator acts on the request: `postApprovedMovement` and `failMovement` are called only from `applyOperatorAction`. Approve flips the linked entry to `posted` (a deposit becomes spendable; a payment leaves current); reject flips it to `failed` and releases any reserved funds; hold and request-info leave it pending. The `ops-approval` scenario continues this story.', {
    audience: {
      executive: 'Every external payment or deposit waits for a bank employee to approve it.',
      'end-user': 'Avery\'s item stays Pending until the bank reviews it.',
      systems: 'Settlement is a human decision in the operations console; Meridian exposes no endpoint through which an outside system could confirm or settle a movement.',
    },
    detail: 1,
    variants: SUCCESS,
    sources: [src(F.movements, 434, 451, 'export async function postApprovedMovement'), src(F.movements, 478, 493, 'export async function failMovement'), src(F.shMove, 16, 20, 'A reviewable movement is first written as a **pending** entry')],
  }),
];

export const scenario: Scenario = {
  id: 'external-movement',
  title: 'A customer submits an external movement',
  question: 'What happens when a customer submits a deposit, ACH, wire or bill payment?',
  summary:
    'Avery submits a bill payment (or a mobile check deposit) from Move money. POST /api/movements requires her session, re-validates the body with the shared validator, checks access, funds (outbound only) and the 25-pending cap, then in one transaction writes a PENDING ledger entry, an operations request whose payload links that entry, an audit row and a simulated email. Operators see it live; Avery gets a reference and sees it as Pending, with available reduced for a payment.',
  category: 'money',
  tags: ['money', 'ledger', 'validation', 'realtime', 'operations', 'integration', 'audit'],
  participants: [AVERY_ROLE, PAGE, CLIENT, EP, VALIDATE, SERVICE, DB, RT, CONSOLE],
  related: [
    'ep:POST /api/movements',
    'be:routes/money',
    'be:money/movements#createExternalMovement',
    'be:money/movements#requireMovableAccount',
    'be:money/movements#recordSimEvent',
    'be:money/movements#describeMovement',
    'be:money/movements#generateMovementReference',
    'be:money/movements#MovementError',
    'sh:money-movement#validateExternalMovement',
    'sh:money-movement#ExternalMovementRequest',
    'sh:money-movement#ExternalMovementResponse',
    'sh:money-movement#MovementPayload',
    'sh:money-movement#MOVEMENT_LIMITS',
    'sh:money-movement#MOVEMENT_FIXED_DIRECTION',
    'sh:public-demo#RESOURCE_CAPS',
    'cu:pages/MoveMoney',
    'cu:lib/money#createMovement',
    'be:ops/realtime#SocketOpsRealtime',
    'op:lib/useOpsSocket#useOpsSocket',
    'op:lib/OpsDataContext',
    'ev:ops:request_changed',
    'ev:ops:external_event',
    'db:LedgerEntry',
    'db:OperationsRequest',
    'db:AuditLog',
    'db:SimulatedEvent',
    'test:apps/backend/src/routes/money.test.ts',
    'feat:external-movements',
    'feat:ops-review',
    'feat:realtime',
  ],
  variants: [
    { id: 'outbound-bill-pay', label: 'Bill payment (outbound)', description: 'A $44.05 bill payment: the pending debit reserves available at once; current is unchanged.', outcome: 'pending' },
    { id: 'inbound-deposit', label: 'Mobile check deposit (inbound)', description: 'A $320.00 deposit: a pending credit that is tracked but not yet available.', outcome: 'pending' },
    { id: 'insufficient-funds', label: 'Insufficient funds', description: 'A $2,500.00 bill payment exceeds the $2,331.10 available: 400 insufficient_funds, nothing written.', outcome: 'rejected' },
    { id: 'limit-reached', label: 'Pending cap reached', description: 'Avery already has 25 movements awaiting review: 409 limit_reached, nothing written.', outcome: 'rejected' },
  ],
  defaultVariant: 'outbound-bill-pay',
  initialState: {
    ...baseState(),
    OperationsRequest: [EXISTING_BILLPAY],
    Session: [SESSION_AVERY],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    src(F.routes, 92, 124, "app.post('/api/movements'"),
    src(F.movements, 280, 385, 'export async function createExternalMovement'),
    src(F.shMove, 233, 285, 'export function validateExternalMovement'),
    src(F.moneyTest, 146, 219, 'POST /api/movements (external, reviewable)'),
  ],
};
