import type { Scenario, ScenarioStep, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';
import { FILES, src } from '../operations/helpers';

/**
 * "How does an operations employee approve a pending transaction?"
 *
 * Starts from fixture row le_003 — Avery's pending bill payment of $120.00 to
 * City Power & Light — and the operations request that controls it.
 */

// ---- Lanes ------------------------------------------------------------------
const SAM = 'role:ops_agent';
const PAGE = 'op:pages/RequestQueues';
const CTX = 'op:lib/OpsDataContext';
const ROUTES = 'be:routes/ops';
const AUTH = 'be.auth';
const APPLY = 'be:ops/requests#applyOperatorAction';
const MOVES = 'be:money/movements';
const DB = 'db';
const AVERY = 'role:customer';

// ---- Example values ---------------------------------------------------------
const REQ = 'req_billpay';
const ENTRY = 'le_003';
/** Simulated time of the request's creation (the clock has been advanced 20 minutes since). */
const CREATED = '2026-10-01T14:40:00.000Z';
/** Wall-clock instants — AuditLog.createdAt and Session.lastSeenAt use the real clock, not the simulated one. */
const WALL_DETAIL = '2026-10-01T15:04:05.000Z';
const WALL_ACTION = '2026-10-01T15:04:12.000Z';
const WALL_RILEY = '2026-10-01T15:04:11.000Z';
const plus8h = (iso: string) => new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString();

const PAYLOAD = {
  kind: 'bill_pay',
  amountMinor: 12000,
  direction: 'outbound',
  accountId: IDS.checking,
  counterparty: 'City Power & Light',
  memo: null,
  ledgerEntryIds: [ENTRY],
  reference: 'MOV-4F9A2C',
};
/** What `asMovementPayload` returns for PAYLOAD (it always materialises `reversed`). */
const NORMALIZED_PAYLOAD = { ...PAYLOAD, reversed: false };

const REQUEST_ROW = {
  id: REQ,
  type: 'bill_pay',
  status: 'pending',
  priority: 'normal',
  summary: 'Bill payment — City Power & Light ($120.00)',
  detail: "A bill payment of $120.00 from the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.",
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: JSON.stringify(PAYLOAD),
  lastAction: null,
  lastActorId: null,
  lastActorRole: null,
  lastActorName: null,
  lastActionNote: null,
  resolvedAt: null,
  createdAt: CREATED,
  updatedAt: CREATED,
};

const REQUEST_DTO = {
  id: REQ,
  type: 'bill_pay',
  status: 'pending',
  priority: 'normal',
  summary: REQUEST_ROW.summary,
  detail: REQUEST_ROW.detail,
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: PAYLOAD,
  lastAction: null as string | null,
  lastActorName: null as string | null,
  lastActionNote: null as string | null,
  createdAt: CREATED,
  updatedAt: CREATED,
  resolvedAt: null as string | null,
};

const RECEIVED_EVENT = {
  id: 'evt_001',
  channel: 'email',
  direction: 'outbound',
  kind: 'movement_received',
  status: 'sent',
  summary: 'Bill payment received — under review (simulated)',
  detail: 'Simulated confirmation that MOV-4F9A2C ($120.00) was received and is awaiting operator review.',
  requestId: REQ,
  metadata: null,
  createdAt: CREATED,
};

/** A SimulatedEvent row as its DTO (the `metadata` column is not exposed). */
function eventDto(row: Record<string, unknown>): Record<string, unknown> {
  const dto = { ...row };
  delete dto.metadata;
  return dto;
}
const RECEIVED_EVENT_DTO = eventDto(RECEIVED_EVENT);

// ---- The four decisions Sam can take ----------------------------------------
type ActionVariant = 'approve' | 'reject' | 'hold' | 'request-info';
interface ActionSpec {
  action: 'approve' | 'reject' | 'hold' | 'request_info';
  status: 'approved' | 'rejected' | 'on_hold' | 'info_requested';
  button: string;
  note: string | null;
  terminal: boolean;
  auditId: string;
}
const ACTIONS: Record<ActionVariant, ActionSpec> = {
  approve: { action: 'approve', status: 'approved', button: 'Approve', note: null, terminal: true, auditId: 'aud_002' },
  reject: { action: 'reject', status: 'rejected', button: 'Reject', note: 'Biller account could not be verified', terminal: true, auditId: 'aud_002' },
  hold: { action: 'hold', status: 'on_hold', button: 'Hold', note: 'Waiting for the biller to confirm the account', terminal: false, auditId: 'aud_002' },
  'request-info': { action: 'request_info', status: 'info_requested', button: 'Request info', note: 'Please confirm the biller account number', terminal: false, auditId: 'aud_002' },
};
const ACTION_VARIANTS = Object.keys(ACTIONS) as ActionVariant[];
const STAFF_VARIANTS = [...ACTION_VARIANTS, 'not-allowed'];

const requestUpdate = (v: ActionVariant) => {
  const a = ACTIONS[v];
  return {
    status: a.status,
    lastAction: a.action,
    lastActorId: IDS.sam,
    lastActorRole: 'ops_agent',
    lastActorName: 'Sam Operator',
    lastActionNote: a.note,
    resolvedAt: a.terminal ? NOW : null,
    updatedAt: NOW,
  };
};
const updatedDto = (v: ActionVariant) => {
  const a = ACTIONS[v];
  return { ...REQUEST_DTO, status: a.status, lastAction: a.action, lastActorName: 'Sam Operator', lastActionNote: a.note, updatedAt: NOW, resolvedAt: a.terminal ? NOW : null };
};
const opsAuditRow = (v: ActionVariant) => {
  const a = ACTIONS[v];
  return {
    id: a.auditId,
    actorId: IDS.sam,
    actorRole: 'ops_agent',
    action: `ops_${a.action}`,
    entity: 'operations_request',
    entityId: REQ,
    reason: a.note,
    metadata: JSON.stringify({ action: a.action, actorName: 'Sam Operator', fromStatus: 'pending', toStatus: a.status }),
    createdAt: WALL_ACTION,
  };
};

const POSTED_EVENT = {
  id: 'evt_002',
  channel: 'email',
  direction: 'outbound',
  kind: 'movement_posted',
  status: 'sent',
  summary: 'Bill payment posted — $120.00 (simulated)',
  detail: 'SIMULATION — no real money network or provider was contacted.',
  requestId: REQ,
  metadata: null,
  createdAt: NOW,
};
const FAILED_EVENT = { ...POSTED_EVENT, kind: 'movement_failed', summary: 'Bill payment failed — $120.00 (simulated)' };
const INFO_EVENT = {
  id: 'evt_002',
  channel: 'email',
  direction: 'outbound',
  kind: 'notification',
  status: 'sent',
  summary: 'Information request sent to Avery Customer (simulated)',
  detail: 'SIMULATION — no real message was sent to any provider.',
  requestId: REQ,
  metadata: null,
  createdAt: NOW,
};

// What Riley's earlier approval wrote in the `not-allowed` variant.
const RILEY_EFFECTS: StateEffect[] = [
  { op: 'update', table: 'OperationsRequest', id: REQ, set: { status: 'approved', lastAction: 'approve', lastActorId: IDS.riley, lastActorRole: 'admin', lastActorName: 'Riley Admin', lastActionNote: null, resolvedAt: NOW, updatedAt: NOW } },
  {
    op: 'insert',
    table: 'AuditLog',
    row: { id: 'aud_r01', actorId: IDS.riley, actorRole: 'admin', action: 'ops_approve', entity: 'operations_request', entityId: REQ, reason: null, metadata: JSON.stringify({ action: 'approve', actorName: 'Riley Admin', fromStatus: 'pending', toStatus: 'approved' }), createdAt: WALL_RILEY },
  },
  { op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'posted', postedAt: NOW } },
  {
    op: 'insert',
    table: 'AuditLog',
    row: { id: 'aud_r02', actorId: IDS.riley, actorRole: 'admin', action: 'movement_posted', entity: 'ledger_entry', entityId: ENTRY, reason: 'Posted Bill payment $120.00 (simulated)', metadata: JSON.stringify({ ...NORMALIZED_PAYLOAD, posted: 1, actorName: 'Riley Admin' }), createdAt: WALL_RILEY },
  },
  { op: 'insert', table: 'SimulatedEvent', row: { ...POSTED_EVENT, id: 'evt_r01' } },
];

// ---- Per-decision steps ------------------------------------------------------

function clickStep(v: ActionVariant | 'not-allowed'): ScenarioStep {
  const a = ACTIONS[v === 'not-allowed' ? 'approve' : v];
  const withNote = a.note ? ` after typing the note "${a.note}"` : '';
  return {
    id: `click-${v}`,
    kind: 'ui',
    title: `Sam clicks ${a.button}`,
    from: SAM,
    to: PAGE,
    label: `click ${a.button}`,
    narrative:
      v === 'not-allowed'
        ? 'Sam clicks Approve in the detail panel. His console still shows the request as Pending — the push announcing Riley\'s approval has not been rendered yet — so the button is still enabled. `handleAction("approve")` runs.'
        : `Sam clicks ${a.button} in the detail panel${withNote}. \`handleAction("${a.action}")\` sets the panel busy and calls \`act(requestId, action, note)\` from the live data context.`,
    audience: {
      executive: v === 'approve' ? 'The employee approves the payment.' : v === 'not-allowed' ? 'A second employee tries to approve the same payment.' : `The employee chooses "${a.button}".`,
      'end-user': `Sam presses ${a.button}.`,
    },
    detail: 1,
    variants: [v],
    sources: [src(FILES.detailPanel, 147, 162, 'const handleAction'), src(FILES.actionBar, 36, 49, 'OPS_ACTIONS.map')],
  };
}

function requestStep(v: ActionVariant | 'not-allowed'): ScenarioStep {
  const a = ACTIONS[v === 'not-allowed' ? 'approve' : v];
  const body = a.note ? { action: a.action, note: a.note } : { action: a.action };
  return {
    id: `request-${v}`,
    kind: 'request',
    title: 'POST the action',
    from: CTX,
    to: ROUTES,
    label: `POST /api/ops/requests/${REQ}/action`,
    narrative:
      '`act()` calls `applyOpsAction(id, action, note)`, which goes through `apiRequest`: a `fetch` with `credentials: "include"` (the httpOnly operations session cookie), the surface header that tells the backend which cookie to read, and — because the method is POST — the CSRF token read from the `mer_csrf` cookie and echoed in a header.',
    audience: {
      executive: 'The console sends the decision to the bank\'s server.',
      systems: 'One HTTPS POST with a JSON body, the operations session cookie, a surface header and a double-submit CSRF header.',
    },
    detail: 2,
    variants: [v],
    payload: {
      title: 'Operator action request',
      format: 'http-request',
      line: `POST /api/ops/requests/${REQ}/action`,
      headers: {
        Cookie: 'mer_ops_session=<opaque session token>; mer_csrf=<csrf token>',
        'x-meridian-surface': 'operations',
        'x-meridian-csrf': '<csrf token>',
        'Content-Type': 'application/json',
      },
      data: body,
      typeRef: 'sh:operations#OperatorActionRequest',
      highlight: ['action'],
    },
    sources: [src(FILES.opsData, 104, 111, 'applyOpsAction(id, action, note)'), src(FILES.opsApi, 50, 61, 'export async function applyOpsAction'), src(FILES.opsApiBase, 147, 164, 'csrfHeaders()')],
  };
}

function updateRequestStep(v: ActionVariant): ScenarioStep {
  const a = ACTIONS[v];
  const inTx = v === 'approve' || v === 'reject';
  return {
    id: `update-request-${v}`,
    kind: 'db-write',
    title: `Request → ${a.status}`,
    from: APPLY,
    to: DB,
    label: `UPDATE OperationsRequest SET status = '${a.status}'`,
    narrative: inTx
      ? `\`prisma.$transaction\` opens. First write: the request row gets status \`${a.status}\`, the last-action bookkeeping (action, Sam's id, role and name, the note) and \`updatedAt\` = the simulated now. Because \`${a.status}\` is terminal, \`resolvedAt\` is stamped too.`
      : `No transaction is opened for a ${a.button.toLowerCase()}: it is a single-row workflow change. The request row gets status \`${a.status}\`, the last-action bookkeeping and \`updatedAt\` = the simulated now. \`resolvedAt\` stays null because \`${a.status}\` is not terminal.`,
    audience: {
      dba: `UPDATE OperationsRequest WHERE id = '${REQ}': status, lastAction, lastActorId, lastActorRole, lastActorName, lastActionNote, resolvedAt, updatedAt.${inTx ? ' First statement of the transaction.' : ' Autocommit; not in a transaction.'}`,
    },
    detail: v === 'approve' || v === 'reject' ? 3 : 1,
    variants: [v],
    payload: { title: 'OperationsRequest update', format: 'row', data: requestUpdate(v), highlight: ['status', 'resolvedAt'] },
    effects: [{ op: 'update', table: 'OperationsRequest', id: REQ, set: requestUpdate(v) }],
    sources: [
      src(FILES.requests, 280, 290, 'const decisionData'),
      inTx ? src(FILES.requests, 334, 337, 'tx.operationsRequest.update') : src(FILES.requests, 389, 393, 'prisma.operationsRequest.update'),
    ],
  };
}

function auditStep(v: ActionVariant): ScenarioStep {
  const a = ACTIONS[v];
  return {
    id: `audit-${v}`,
    kind: 'db-write',
    title: 'Audit the action',
    from: APPLY,
    to: DB,
    label: `INSERT AuditLog 'ops_${a.action}'`,
    narrative: `\`writeAudit\` inserts the operator-action row: who (Sam, ops_agent), what (\`ops_${a.action}\` on \`operations_request\` ${REQ}), the note as \`reason\`, and metadata recording the transition pending → ${a.status}. This row is what the detail panel later shows in History.`,
    audience: {
      executive: 'The decision is logged with who made it and when.',
      dba: 'INSERT AuditLog. `metadata` is a JSON string. `createdAt` is the column default — the real clock — so it differs from the simulated timestamps on the other rows.',
    },
    detail: 4,
    variants: [v],
    payload: { title: 'AuditLog row', format: 'row', data: opsAuditRow(v), highlight: ['action', 'metadata'] },
    effects: [{ op: 'insert', table: 'AuditLog', row: opsAuditRow(v) }],
    sources: [src(FILES.requests, 242, 256, 'const auditFor'), src(FILES.audit, 44, 67, 'export async function writeAudit')],
  };
}

function returnStep(v: ActionVariant): ScenarioStep {
  const events = v === 'approve' ? [eventDto(POSTED_EVENT)] : undefined;
  const event = v === 'reject' ? eventDto(FAILED_EVENT) : v === 'request-info' ? eventDto(INFO_EVENT) : null;
  return {
    id: `return-${v}`,
    kind: 'call',
    title: v === 'approve' || v === 'reject' ? 'Commit and return' : 'Return the result',
    from: APPLY,
    to: ROUTES,
    label: 'return { request, event, events }',
    narrative:
      v === 'approve'
        ? 'The transaction callback returns, so the request update, both audit rows, the ledger change and the simulated event commit together. `applyOperatorAction` returns the updated request as a DTO plus the generated event in `events`.'
        : v === 'reject'
          ? 'The transaction commits the request update, the audit row, the failed ledger entry and the simulated event together. The result carries the updated request and the failure notice in `event`.'
          : v === 'hold'
            ? '`applyOperatorAction` returns the updated request; `event` is null because a hold generates no simulated message.'
            : '`applyOperatorAction` returns the updated request and the simulated email in `event`.',
    detail: 4,
    variants: [v],
    payload: {
      title: 'AppliedAction',
      format: 'return',
      data: { request: updatedDto(v), event, ...(events ? { events } : {}) },
      typeRef: 'be:ops/requests#AppliedAction',
      highlight: ['request.status'],
    },
    sources: [
      v === 'approve'
        ? src(FILES.requests, 341, 345, 'events: result.posted?.events')
        : v === 'reject'
          ? src(FILES.requests, 356, 356, 'event: result.failedEvent')
          : src(FILES.requests, 411, 411, 'return { request: toOperationsRequestDTO(updated), event }'),
    ],
  };
}

function emitChangedStep(v: ActionVariant): ScenarioStep {
  return {
    id: `emit-changed-${v}`,
    kind: 'event',
    title: 'Push the change to every console',
    from: ROUTES,
    to: CTX,
    label: 'ops:request_changed',
    narrative:
      'The route calls `app.opsRealtime.requestChanged("updated", request)`. The Socket.IO publisher emits `ops:request_changed` to the `ops` room — every connected operator console, including Sam\'s own. Each console\'s `useOpsSocket` hands the payload to `upsertRequest`, which replaces the queue item by id, so status chips, counts and open detail panels update without a refresh. Customer sockets are never in that room.',
    audience: {
      executive: 'Every other employee\'s screen updates instantly, so nobody works on a request that is already decided.',
      'end-user': 'Other staff see the request change status straight away.',
      systems: 'Socket.IO broadcast to room `ops` on the same server process; clients upsert by id, so the sender\'s own echo is harmless.',
    },
    detail: 2,
    variants: [v],
    payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed → room "ops"', data: { change: 'updated', request: updatedDto(v) }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['change', 'request.status'] },
    sources: [
      src(FILES.routesOps, 147, 148, "app.opsRealtime.requestChanged('updated', request)"),
      src(FILES.opsRealtime, 42, 45, 'SOCKET_EVENTS.opsRequestChanged'),
      src(FILES.opsSocket, 51, 53, 'SOCKET_EVENTS.opsRequestChanged'),
      src(FILES.opsData, 41, 49, 'const upsertRequest'),
    ],
  };
}

function emitEventStep(v: 'approve' | 'reject' | 'request-info'): ScenarioStep {
  const row = v === 'approve' ? POSTED_EVENT : v === 'reject' ? FAILED_EVENT : INFO_EVENT;
  return {
    id: `emit-event-${v}`,
    kind: 'event',
    title: 'Push the simulated event',
    from: ROUTES,
    to: CTX,
    label: 'ops:external_event',
    narrative:
      'The generated simulated event is published the same way with `app.opsRealtime.externalEvent(event)`. Consoles prepend it to their event feed, skipping it if that id is already present.',
    audience: { systems: 'A second Socket.IO message, `ops:external_event`, to the same room.' },
    detail: 4,
    variants: [v],
    payload: { title: 'ops:external_event', format: 'socket', line: 'ops:external_event → room "ops"', data: { event: eventDto(row) }, typeRef: 'sh:operations#OpsExternalEventPayload', highlight: ['event.summary'] },
    sources: [src(FILES.routesOps, 149, 150, 'app.opsRealtime.externalEvent(extra)'), src(FILES.opsRealtime, 47, 50, 'SOCKET_EVENTS.opsExternalEvent'), src(FILES.opsData, 51, 56, 'const prependEvent')],
  };
}

function responseStep(v: ActionVariant): ScenarioStep {
  return {
    id: `response-${v}`,
    kind: 'response',
    title: '200 with the updated request',
    from: ROUTES,
    to: CTX,
    label: '200 { request }',
    narrative:
      'The handler replies with the updated queue item only. `act()` upserts it into the in-memory queue — the same change the socket delivers, applied idempotently by id.',
    detail: 2,
    variants: [v],
    payload: { title: 'Operator action response', format: 'http-response', line: '200 OK', data: { request: updatedDto(v) }, typeRef: 'sh:operations#OperatorActionResponse', highlight: ['request.status', 'request.lastActorName'] },
    sources: [src(FILES.routesOps, 151, 151, 'reply.send({ request })'), src(FILES.opsData, 104, 111, 'upsertRequest(updated)')],
  };
}

function uiResultStep(v: ActionVariant): ScenarioStep {
  const a = ACTIONS[v];
  const text: Record<ActionVariant, string> = {
    approve:
      'The panel reloads the request detail (`load()`), so History now reads "Approve by Sam Operator". The status badge shows Approved, the four decision buttons are disabled, the hint "Resolved — you can still add an audit note" appears, and because this is an approved movement that is not reversed, a "Reverse movement" section is offered.',
    reject:
      'The panel reloads the request detail, so History now reads "Reject by Sam Operator" with the note. The badge shows Rejected and the decision buttons are disabled. No reverse option appears — it is only offered for approved movements.',
    hold: 'The panel reloads the request detail; History shows "Hold by Sam Operator" with the note. The badge reads On hold and all four decision buttons stay enabled — the request can still be approved or rejected later.',
    'request-info':
      'The panel reloads the request detail; History shows "Request info by Sam Operator" and the new simulated email appears under Linked simulated events. The badge reads Info requested and the decision buttons stay enabled.',
  };
  return {
    id: `ui-result-${v}`,
    kind: 'ui',
    title: `Console shows ${a.status === 'on_hold' ? 'On hold' : a.status === 'info_requested' ? 'Info requested' : a.status === 'approved' ? 'Approved' : 'Rejected'}`,
    from: PAGE,
    to: SAM,
    label: `badge: ${a.status}`,
    narrative: text[v],
    audience: { 'end-user': `Sam sees the request marked ${a.status.replace('_', ' ')}.` },
    detail: 2,
    variants: [v],
    sources: [src(FILES.detailPanel, 147, 162, 'await load(); // refresh history + status'), src(FILES.detailPanel, 201, 207, 'const canShowReverse')],
  };
}

// ---- Steps ---------------------------------------------------------------------

const steps: ScenarioStep[] = [
  // ===== Shared opening (staff variants) ========================================
  {
    id: 'open-queue',
    kind: 'ui',
    title: 'Sam opens Request queues',
    from: SAM,
    to: PAGE,
    label: 'open Request queues',
    narrative:
      'Sam Operator, signed in to the operations console as an `ops_agent`, opens the Request queues page. Avery\'s bill payment of $120.00 to City Power & Light is listed as Pending in the "Deposits & transfers" lane. On the customer side that payment already exists as a pending debit ledger entry that reserves $120.00 of Avery\'s available balance.',
    audience: {
      executive: 'A bank employee opens the work queue. A customer\'s $120 bill payment is waiting for review; the money is set aside but has not left the account.',
      'end-user': 'Sam opens the list of requests waiting for review and sees Avery\'s bill payment.',
      dba: 'Starting rows: LedgerEntry le_003 (debit, 12000, status pending, postedAt null) and OperationsRequest req_billpay whose JSON payload lists ledgerEntryIds ["le_003"].',
    },
    detail: 1,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.requestQueues, 43, 57, 'export function RequestQueues'), src(FILES.movements, 330, 354, 'ledgerEntryIds: [entry.id]', 'How the pending entry and the request were linked at submission')],
  },
  {
    id: 'queue-from-context',
    kind: 'client',
    title: 'The queue comes from the live data context',
    from: PAGE,
    to: CTX,
    label: 'useOpsData().requests',
    narrative:
      'The page does not fetch on navigation. `OpsDataProvider` loaded the queue once at console start (`GET /api/ops/requests` and `GET /api/ops/events`) and has kept it current since through one Socket.IO connection. The page filters that in-memory list by status chip and queue lane.',
    audience: { systems: 'One HTTP load at start-up, then socket-driven upserts; no polling.' },
    detail: 3,
    variants: STAFF_VARIANTS,
    payload: { title: 'Queue item in memory', format: 'json', data: { requests: [REQUEST_DTO], counts: { pending: 1, approved: 0, rejected: 0, on_hold: 0, info_requested: 0 } }, typeRef: 'sh:operations#OperationsQueueResponse', highlight: ['requests.0.status', 'requests.0.payload.ledgerEntryIds'] },
    sources: [src(FILES.opsData, 58, 73, 'fetchOpsRequests(), fetchOpsEvents()'), src(FILES.opsData, 96, 102, 'useOpsSocket'), src(FILES.requestQueues, 44, 57, 'useOpsData()')],
  },
  {
    id: 'select-request',
    kind: 'ui',
    title: 'Sam opens the request',
    from: SAM,
    to: PAGE,
    label: 'select the bill-pay card',
    narrative: 'Sam clicks the queue card. The page stores the selected id and renders `RequestDetailPanel` for it beside the list.',
    audience: { executive: 'The employee opens the request to review it.', 'end-user': 'Sam clicks the payment to see its details.' },
    detail: 2,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.requestQueues, 137, 152, 'onSelect={() => setSelectedId(request.id)}')],
  },
  {
    id: 'detail-request',
    kind: 'request',
    title: 'Load the request detail',
    from: PAGE,
    to: ROUTES,
    label: `GET /api/ops/requests/${REQ}`,
    narrative:
      'On mount the panel calls `fetchOpsRequestDetail(requestId)`. The request passes the same guards as every staff read — `requireAuth` then `requireRole("ops_agent", "admin")` — and, like every authenticated request, slides Sam\'s session forward.',
    audience: { dba: 'Side effect of authentication: UPDATE Session SET lastSeenAt, expiresAt for Sam\'s session (wall-clock time).' },
    detail: 3,
    variants: STAFF_VARIANTS,
    payload: { title: 'Request detail', format: 'http-request', line: `GET /api/ops/requests/${REQ}`, headers: { Cookie: 'mer_ops_session=<opaque session token>', 'x-meridian-surface': 'operations' }, data: null },
    effects: [{ op: 'update', table: 'Session', id: 'ses_sam', set: { lastSeenAt: WALL_DETAIL, expiresAt: plus8h(WALL_DETAIL) } }],
    sources: [src(FILES.detailPanel, 119, 133, 'fetchOpsRequestDetail(requestId)'), src(FILES.opsApi, 42, 48, 'export async function fetchOpsRequestDetail'), src(FILES.routesOps, 111, 120, "app.get('/api/ops/requests/:id'")],
  },
  {
    id: 'detail-read',
    kind: 'db-read',
    title: 'Read the request, its audit history and its events',
    from: ROUTES,
    to: DB,
    label: 'SELECT request + AuditLog + SimulatedEvent',
    narrative:
      '`getOperationsRequestDetail` reads the request row, then in parallel every AuditLog row with entity `operations_request` and this id (oldest first) and every SimulatedEvent linked to it (newest first). The history is the audit trail: the `ops_request_created` row written when Avery submitted the payment is shown as "Created".',
    audience: { dba: 'Three reads: OperationsRequest by primary key; AuditLog WHERE entity = \'operations_request\' AND entityId = ? ORDER BY createdAt; SimulatedEvent WHERE requestId = ? ORDER BY createdAt DESC.' },
    detail: 4,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.requests, 162, 182, 'export async function getOperationsRequestDetail')],
  },
  {
    id: 'detail-response',
    kind: 'response',
    title: 'Detail with history',
    from: ROUTES,
    to: PAGE,
    label: '200 { request, history, events }',
    narrative:
      'The panel now shows the money-movement context taken from the payload (Bill payment, $120.00, outgoing, City Power & Light), the History list with one "Created" entry, the linked simulated email, a note box and the four decision buttons. The hint under the note box reads "Approving posts this movement to the ledger (simulated); rejecting marks it failed."',
    audience: { 'end-user': 'Sam sees who is paying whom and how much, plus the request\'s history so far.' },
    detail: 3,
    variants: STAFF_VARIANTS,
    payload: {
      title: 'Request detail response',
      format: 'http-response',
      line: '200 OK',
      data: {
        request: {
          ...REQUEST_DTO,
          history: [{ id: 'aud_001', action: 'created', actorName: null, actorRole: 'customer', note: 'Bill payment — City Power & Light ($120.00) — submitted by Avery Customer (simulated)', createdAt: '2026-10-01T14:44:09.000Z' }],
          events: [RECEIVED_EVENT_DTO],
        },
      },
      typeRef: 'sh:operations#OperationsRequestDetailResponse',
      highlight: ['request.status', 'request.payload.amountMinor', 'request.history'],
    },
    sources: [src(FILES.routesOps, 119, 119, 'reply.send({ request })'), src(FILES.detailPanel, 286, 328, 'Money movement'), src(FILES.detailPanel, 444, 449, 'Approving posts this movement to the ledger')],
  },
  {
    id: 'decide',
    kind: 'decision',
    title: 'What does Sam decide?',
    from: SAM,
    to: PAGE,
    label: 'choose an action',
    narrative:
      'The action bar offers the four decisions from `OPS_ACTIONS`. All four are enabled because the request is not in a terminal status. Approve and reject settle the money one way or the other; hold and request info only change the workflow state.',
    detail: 2,
    variants: ACTION_VARIANTS,
    decision: {
      question: 'Which action does the operator take on the pending bill payment?',
      options: [
        { label: 'Approve', variant: 'approve', description: 'Post the payment: the pending ledger entry becomes posted.' },
        { label: 'Reject', variant: 'reject', description: 'Fail the payment: the pending entry becomes failed and the reserved funds are released.' },
        { label: 'Hold', variant: 'hold', description: 'Park the request; the ledger is untouched.' },
        { label: 'Request info', variant: 'request-info', description: 'Ask the customer for information; a simulated email is recorded.' },
      ],
    },
    sources: [src(FILES.actionBar, 24, 51, 'export function ActionBar'), src(FILES.shOperations, 24, 31, 'export const OPS_ACTIONS')],
  },
  {
    id: 'riley-first',
    kind: 'note',
    title: 'Meanwhile: Riley approves the same request',
    from: DB,
    to: DB,
    label: 'Riley Admin approves first',
    narrative:
      'In this variant another member of staff, Riley Admin, approves the same request from a different console a moment before Sam acts. Riley\'s transaction commits: the request is approved, the ledger entry is posted, two audit rows and a simulated event are written. The push to Sam\'s console is on its way but Sam\'s screen still shows Pending.',
    audience: {
      executive: 'Two employees look at the same request; one approves it a moment before the other.',
      dba: 'State before Sam\'s request arrives: OperationsRequest.status = approved, LedgerEntry le_003 status = posted.',
    },
    detail: 1,
    variants: ['not-allowed'],
    effects: RILEY_EFFECTS,
    confidence: 'simplified',
  },
  ...ACTION_VARIANTS.map(clickStep),
  clickStep('not-allowed'),
  {
    id: 'act-call',
    kind: 'client',
    title: 'The panel hands the action to the data context',
    from: PAGE,
    to: CTX,
    label: 'act(requestId, action, note)',
    narrative:
      '`act` is the single path for operator actions in the console, shared by the queue cards (quick actions, no note) and the detail panel (action plus the trimmed note, or undefined when the box is empty).',
    detail: 3,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.detailPanel, 147, 153, 'await act(requestId, action, note.trim() || undefined)'), src(FILES.opsData, 104, 111, 'const act')],
  },
  ...ACTION_VARIANTS.map(requestStep),
  requestStep('not-allowed'),

  // ===== forbidden-role: a customer session calls the endpoint ==================
  {
    id: 'forbidden-context',
    kind: 'note',
    title: 'A customer tries the staff endpoint',
    from: AVERY,
    to: AVERY,
    label: 'no console for customers',
    narrative:
      'The operations console never renders its pages for a non-staff user, so a customer cannot reach the Approve button. This variant shows what the server does if a signed-in customer calls the endpoint directly — for example Avery, hoping to approve her own pending bill payment.',
    audience: { executive: 'What stops a customer from approving their own payment? The server checks the caller\'s role on every staff request.' },
    detail: 1,
    variants: ['forbidden-role'],
    sources: [src(FILES.routesOps, 35, 39, 'Customers and')],
  },
  {
    id: 'forbidden-request',
    kind: 'request',
    title: 'POST with a customer session',
    from: AVERY,
    to: ROUTES,
    label: `POST /api/ops/requests/${REQ}/action`,
    narrative:
      'The request is well formed: a valid customer session cookie, a matching CSRF header and a valid body. Nothing about the URL or the body is secret, so the endpoint has to defend itself.',
    detail: 2,
    variants: ['forbidden-role'],
    payload: {
      title: 'Operator action request from a customer session',
      format: 'http-request',
      line: `POST /api/ops/requests/${REQ}/action`,
      headers: { Cookie: 'mer_session=<opaque session token>; mer_csrf=<csrf token>', 'x-meridian-csrf': '<csrf token>', 'Content-Type': 'application/json' },
      data: { action: 'approve' },
      typeRef: 'sh:operations#OperatorActionRequest',
    },
    sources: [src(FILES.opsTest, 238, 242, 'forbids a customer from acting')],
  },

  // ===== Server: hooks and guards (all variants) ================================
  {
    id: 'csrf',
    kind: 'guard',
    title: 'CSRF double-submit check',
    from: ROUTES,
    to: AUTH,
    label: 'csrfHook',
    narrative:
      'A global `onRequest` hook runs before any route code. The method is unsafe and a session cookie is present, so the `x-meridian-csrf` header must equal the `mer_csrf` cookie (compared in constant time). They match. Next, `mutationValveHook` would count this mutation against a per-IP bucket, but it is a no-op outside public-demo mode.',
    audience: {
      executive: 'The server first confirms the request really came from the bank\'s own page, not from a forged link.',
      systems: 'Double-submit cookie CSRF: a cross-site page can neither read the cookie nor set the custom header without a CORS preflight the allowlist refuses.',
    },
    detail: 4,
    sources: [src(FILES.csrf, 86, 116, 'export async function csrfHook'), src(FILES.server, 77, 81, "app.addHook('onRequest', csrfHook)"), src(FILES.rateLimit, 178, 183, 'export async function mutationValveHook')],
  },
  {
    id: 'require-auth-staff',
    kind: 'guard',
    title: 'Who is calling? — requireAuth',
    from: ROUTES,
    to: AUTH,
    label: 'requireAuth → req.user = Sam',
    narrative:
      'First preHandler. The surface header selects the `mer_ops_session` cookie; its token is hashed and looked up in the Session table. The session is live, so its idle timeout slides forward 8 hours and `req.user` becomes { id, email, displayName: "Sam Operator", role: "ops_agent" }.',
    audience: {
      executive: 'The server confirms the employee is signed in.',
      dba: 'SELECT Session by tokenHash (with its User), then UPDATE Session SET lastSeenAt = now, expiresAt = now + 8h. Wall-clock time.',
    },
    detail: 3,
    variants: STAFF_VARIANTS,
    payload: { title: 'req.user', format: 'json', data: { id: IDS.sam, email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent' }, highlight: ['role'] },
    effects: [{ op: 'update', table: 'Session', id: 'ses_sam', set: { lastSeenAt: WALL_ACTION, expiresAt: plus8h(WALL_ACTION) } }],
    sources: [src(FILES.guards, 47, 66, 'export const requireAuth'), src(FILES.routesOps, 55, 56, 'const opsMutation')],
  },
  {
    id: 'require-auth-customer',
    kind: 'guard',
    title: 'Who is calling? — requireAuth',
    from: ROUTES,
    to: AUTH,
    label: 'requireAuth → req.user = Avery',
    narrative:
      'With no surface header the customer cookie `mer_session` is read. It resolves to a live session, so authentication succeeds and `req.user` becomes Avery with role `customer`. Being signed in is not enough for this route.',
    detail: 3,
    variants: ['forbidden-role'],
    payload: { title: 'req.user', format: 'json', data: { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' }, highlight: ['role'] },
    effects: [{ op: 'update', table: 'Session', id: 'ses_avery', set: { lastSeenAt: WALL_ACTION, expiresAt: plus8h(WALL_ACTION) } }],
    sources: [src(FILES.guards, 47, 66, 'export const requireAuth')],
  },
  {
    id: 'require-role',
    kind: 'decision',
    title: 'Is the caller bank staff? — requireRole',
    from: ROUTES,
    to: AUTH,
    label: "requireRole('ops_agent', 'admin')",
    narrative:
      'Second preHandler. It reads `req.user.role` and continues only for `ops_agent` or `admin`. Every route in this plugin carries this guard, which is what makes the operations API staff-only regardless of which app or tool sends the request.',
    audience: {
      executive: 'Only bank staff may decide on requests. Customers are turned away here, whatever they send.',
      systems: 'Role-based access control as a Fastify preHandler; the role comes from the User row behind the session, never from the request.',
    },
    detail: 3,
    decision: {
      question: 'Is the signed-in user an ops_agent or admin?',
      options: [
        { label: 'Yes — Sam is an ops_agent', variant: 'approve', description: 'The request continues to validation and the service.' },
        { label: 'No — the caller is a customer', variant: 'forbidden-role', description: 'The request ends with 403 forbidden.' },
      ],
    },
    sources: [src(FILES.guards, 68, 86, 'export function requireRole'), src(FILES.routesOps, 53, 56, "requireRole('ops_agent', 'admin')")],
  },
  {
    id: 'forbidden-response',
    kind: 'response',
    title: '403 Forbidden',
    from: ROUTES,
    to: AVERY,
    label: '403 forbidden',
    narrative: '`requireRole` sends the response itself and the handler never runs. No validation, no service call, no database write beyond the session touch.',
    audience: { executive: 'The customer is refused. Nothing about the payment changes.', 'end-user': 'Avery gets an "access denied" answer.' },
    detail: 1,
    variants: ['forbidden-role'],
    payload: { title: 'Forbidden', format: 'http-response', line: '403 Forbidden', data: { error: 'You do not have access to this resource.', code: 'forbidden' }, highlight: ['code'] },
    sources: [src(FILES.guards, 78, 84, 'You do not have access to this resource.'), src(FILES.opsTest, 79, 89, "expect(denied.json().code).toBe('forbidden')")],
  },
  {
    id: 'forbidden-state',
    kind: 'state',
    title: 'Nothing changed',
    from: DB,
    to: AVERY,
    label: 'payment still pending',
    narrative: 'The request is still Pending in the staff queue and the ledger entry is still pending: Avery\'s current balance is $2,451.10 and her available balance $2,331.10, exactly as before.',
    audience: { dba: 'No OperationsRequest, LedgerEntry, AuditLog or SimulatedEvent row was written. The refusal itself is not audited.' },
    detail: 2,
    variants: ['forbidden-role'],
    confidence: 'inferred',
  },

  // ===== Server: handler (staff variants) =======================================
  {
    id: 'rate-limit',
    kind: 'guard',
    title: 'Per-operator rate limit',
    from: ROUTES,
    to: ROUTES,
    label: "rateLimit('operations')",
    narrative:
      'Third preHandler. In public-demo mode it allows 60 operator mutations per 5 minutes per user and answers 429 beyond that. In local development abuse protection is off and it returns immediately.',
    detail: 5,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.rateLimit, 158, 168, 'export function rateLimit'), src(FILES.shPublicDemo, 101, 102, 'operations: { max: 60')],
  },
  {
    id: 'validate-body',
    kind: 'validate',
    title: 'Validate the body',
    from: ROUTES,
    to: ROUTES,
    label: 'isOpsAction(body.action)',
    narrative:
      'The handler checks the action with the shared type guard `isOpsAction` (approve, reject, hold, request_info or note; anything else is 400 `bad_request`). A string note is cut to 500 characters. Whether this action is allowed for this request is not decided here — that needs the current status.',
    detail: 4,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.routesOps, 122, 136, 'isOpsAction(body.action)'), src(FILES.shOperations, 120, 125, 'export function isOpsAction')],
  },
  {
    id: 'sim-now',
    kind: 'db-read',
    title: 'Read the simulated time',
    from: ROUTES,
    to: DB,
    label: 'simulationNow() → SimulationClock',
    narrative:
      'The handler reads the SimulationClock singleton and passes that instant to the service as `now`. Money is dated by the simulated calendar, not the wall clock, so a payment approved "today" in the simulation posts on the simulated date even if the real date is different.',
    audience: {
      executive: 'The bank runs on its own simulated calendar; the payment will be dated by it.',
      dba: 'Upsert-as-read on SimulationClock (id = "singleton"); returns currentTime = 2026-10-01T15:00:00Z.',
    },
    detail: 4,
    variants: STAFF_VARIANTS,
    payload: { title: 'SimulationClock', format: 'row', data: { id: 'singleton', currentTime: NOW, speed: 1 }, highlight: ['currentTime'] },
    sources: [src(FILES.routesOps, 138, 146, 'await simulationNow(prisma)'), src(FILES.clock, 53, 60, 'export async function simulationNow')],
  },
  {
    id: 'call-apply',
    kind: 'call',
    title: 'Hand over to the workflow service',
    from: ROUTES,
    to: APPLY,
    label: 'applyOperatorAction(prisma, input, now)',
    narrative: 'The route passes the request id, the action, the note and the authenticated user (`req.user`, never anything from the body) to `applyOperatorAction`, the one function that applies operator actions.',
    audience: { executive: 'The request reaches the part of the system that owns the approval rules.' },
    detail: 3,
    variants: STAFF_VARIANTS,
    payload: {
      title: 'applyOperatorAction arguments',
      format: 'args',
      data: { input: { id: REQ, action: '<the chosen action>', note: '<the note, if any>', actor: { id: IDS.sam, email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent' } }, now: NOW },
      highlight: ['input.actor.role', 'now'],
    },
    sources: [src(FILES.routesOps, 138, 146, 'applyOperatorAction'), src(FILES.requests, 230, 234, 'export async function applyOperatorAction')],
  },
  {
    id: 'load-request',
    kind: 'db-read',
    title: 'Load the request',
    from: APPLY,
    to: DB,
    label: 'SELECT OperationsRequest WHERE id',
    narrative: 'The service reads the request row. An unknown id would throw `OpsActionError("not_found")`, which the route turns into 404. The row\'s current status is what the next check uses — the server never trusts the status the console was showing.',
    audience: { dba: 'operationsRequest.findUnique by primary key. This read is outside the transaction that follows.' },
    detail: 4,
    variants: STAFF_VARIANTS,
    sources: [src(FILES.requests, 235, 240, 'prisma.operationsRequest.findUnique')],
  },
  {
    id: 'can-apply',
    kind: 'decision',
    title: 'Is this action allowed in the current status?',
    from: APPLY,
    to: APPLY,
    label: 'canApplyAction(currentStatus, action)',
    narrative:
      'The shared rule `canApplyAction` allows a decision only while the request is not terminal — pending, on hold or info requested. `nextStatusForAction` then gives the target status from the fixed table approve → approved, reject → rejected, hold → on_hold, request_info → info_requested. The console uses the same functions to enable its buttons, but this check on the server is the one that counts.',
    audience: {
      executive: 'A request can be decided once. The server refuses a second decision.',
      systems: 'The state-machine guard lives in the shared package and is evaluated server-side against the freshly read row.',
    },
    detail: 3,
    variants: STAFF_VARIANTS,
    decision: {
      question: 'Is the request still open (pending, on hold or info requested)?',
      options: [
        { label: 'Yes — status is pending', variant: 'approve', description: 'The decision is applied.' },
        { label: 'No — it is already approved', variant: 'not-allowed', description: 'OpsActionError("already_resolved") → 409.' },
      ],
    },
    sources: [src(FILES.requests, 273, 280, 'canApplyAction(currentStatus, input.action)'), src(FILES.shOperations, 108, 116, 'export function canApplyAction'), src(FILES.shOperations, 79, 93, 'export const OPS_ACTION_RESULT')],
  },

  // ----- not-allowed --------------------------------------------------------------
  {
    id: 'already-resolved-throw',
    kind: 'call',
    title: 'Refused: already resolved',
    from: APPLY,
    to: ROUTES,
    label: "throw OpsActionError('already_resolved')",
    narrative:
      'The row Sam\'s request just read has status `approved`, so `canApplyAction` is false and the service throws before writing anything. The route\'s catch block maps the error code to an HTTP status: not_found → 404, already_resolved → 409, anything else → 400.',
    detail: 3,
    variants: ['not-allowed'],
    sources: [src(FILES.requests, 274, 279, "'already_resolved'"), src(FILES.routesOps, 152, 158, "err.code === 'already_resolved' ? 409")],
  },
  {
    id: 'already-resolved-response',
    kind: 'response',
    title: '409 Conflict',
    from: ROUTES,
    to: CTX,
    label: '409 already_resolved',
    narrative: '`apiRequest` turns the non-2xx response into an `ApiError` carrying the server\'s code and message; `act()` rethrows it to the panel. No socket event is emitted for a refused action.',
    audience: { executive: 'The second approval is refused; the payment is not posted twice.' },
    detail: 1,
    variants: ['not-allowed'],
    payload: { title: 'Already resolved', format: 'http-response', line: '409 Conflict', data: { error: 'That request has already been resolved and cannot be actioned again.', code: 'already_resolved' }, highlight: ['code'] },
    sources: [src(FILES.routesOps, 152, 156, 'reply.code(code).send'), src(FILES.opsTest, 230, 236, "toBe('already_resolved')"), src(FILES.opsApiBase, 131, 140, 'async function toApiError')],
  },
  {
    id: 'already-resolved-ui',
    kind: 'ui',
    title: 'Sam sees why',
    from: PAGE,
    to: SAM,
    label: 'error + Approved badge',
    narrative:
      'The panel shows the server\'s message, "That request has already been resolved and cannot be actioned again." When Riley\'s `ops:request_changed` push is applied, the live copy of the request flips to Approved (by Riley Admin), the buttons disable and the panel reloads its history.',
    audience: { 'end-user': 'Sam is told the request was already handled and sees that Riley approved it.' },
    detail: 2,
    variants: ['not-allowed'],
    sources: [src(FILES.detailPanel, 154, 159, "setError(err instanceof ApiError ? err.message : 'That action could not be completed.')"), src(FILES.detailPanel, 135, 145, 'live.updatedAt !== detail.updatedAt')],
  },
  {
    id: 'already-resolved-state',
    kind: 'state',
    title: 'Posted exactly once',
    from: DB,
    to: AVERY,
    label: 'one posted debit of $120.00',
    narrative:
      'The ledger holds one posted debit of $120.00 from Riley\'s approval; Sam\'s attempt wrote nothing. Even if the status check had been passed by two requests at once, the ledger update only touches entries whose status is still `pending`, so the second one would have changed zero rows.',
    audience: { executive: 'The customer is charged once.', dba: 'Defence in depth: `updateMany ... WHERE id IN (...) AND status = \'pending\'` is idempotent for an entry that is already posted.' },
    detail: 2,
    variants: ['not-allowed'],
    sources: [src(FILES.movements, 448, 451, "status: 'pending'")],
    confidence: 'inferred',
  },

  // ----- the four decisions ---------------------------------------------------------
  {
    id: 'movement-payload',
    kind: 'call',
    title: 'Is this request a linked money movement?',
    from: APPLY,
    to: MOVES,
    label: 'movementPayloadOf(existing)',
    narrative:
      'The service asks the money module whether the request controls ledger entries. `movementPayloadOf` accepts only the types deposit, ach, wire and bill_pay, parses the JSON payload and requires at least one id in `ledgerEntryIds`. Here it returns the bill-pay payload with ["le_003"]. That id list inside the JSON is the only link between the request and the ledger — there is no foreign key. Approve and reject act on it; hold and request info ignore it.',
    audience: {
      dba: 'A soft link: OperationsRequest.payload (JSON text) → LedgerEntry.id values. No FK constraint enforces it.',
    },
    detail: 4,
    variants: ACTION_VARIANTS,
    payload: { title: 'MovementPayload', format: 'return', data: NORMALIZED_PAYLOAD, typeRef: 'sh:money-movement#MovementPayload', highlight: ['ledgerEntryIds'] },
    sources: [src(FILES.requests, 328, 334, 'const movement = movementPayloadOf(existing)'), src(FILES.movements, 420, 426, 'export function movementPayloadOf')],
  },

  // approve
  updateRequestStep('approve'),
  auditStep('approve'),
  {
    id: 'post-movement-call',
    kind: 'call',
    title: 'Settle the money',
    from: APPLY,
    to: MOVES,
    label: 'postApprovedMovement(tx, existing, actor, now)',
    narrative: 'Still inside the transaction, the service calls `postApprovedMovement` with the transaction client, so the ledger change commits or rolls back together with the status change.',
    detail: 3,
    variants: ['approve'],
    sources: [src(FILES.requests, 334, 340, 'postApprovedMovement(tx, existing, input.actor, now)'), src(FILES.movements, 434, 446, 'export async function postApprovedMovement')],
  },
  {
    id: 'post-entry',
    kind: 'db-write',
    title: 'Pending entry becomes posted',
    from: MOVES,
    to: DB,
    label: "UPDATE LedgerEntry SET status = 'posted', postedAt = now",
    narrative:
      'The linked ledger entry is flipped from `pending` to `posted` and `postedAt` is set to the simulated now. No new row is written and no balance column exists to edit: the entry\'s status is the money. The `WHERE status = \'pending\'` precondition means an entry that is no longer pending is left alone.',
    audience: {
      executive: 'The payment goes through: $120.00 leaves the customer\'s account.',
      'end-user': 'The bill payment is now a completed transaction instead of a pending one.',
      dba: "ledgerEntry.updateMany WHERE id IN ('le_003') AND status = 'pending' SET status = 'posted', postedAt = '2026-10-01T15:00:00Z'. One row affected.",
    },
    detail: 1,
    variants: ['approve'],
    payload: { title: 'LedgerEntry update', format: 'row', data: { id: ENTRY, status: 'posted', postedAt: NOW }, highlight: ['status', 'postedAt'] },
    effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'posted', postedAt: NOW } }],
    sources: [src(FILES.movements, 448, 451, "data: { status: 'posted', postedAt: now }")],
  },
  {
    id: 'post-audit',
    kind: 'db-write',
    title: 'Audit the posting',
    from: MOVES,
    to: DB,
    label: "INSERT AuditLog 'movement_posted'",
    narrative:
      'A second audit row records the money event itself, against the ledger entry rather than the request: action `movement_posted`, the amount in the reason, and the whole movement payload plus the number of entries posted in the metadata. Because its entity is `ledger_entry`, it does not appear in the request\'s History list.',
    audience: { dba: 'INSERT AuditLog (entity = \'ledger_entry\', entityId = \'le_003\'). Two audit rows per approved movement: one for the decision, one for the money.' },
    detail: 4,
    variants: ['approve'],
    payload: {
      title: 'AuditLog row',
      format: 'row',
      data: { id: 'aud_003', actorId: IDS.sam, actorRole: 'ops_agent', action: 'movement_posted', entity: 'ledger_entry', entityId: ENTRY, reason: 'Posted Bill payment $120.00 (simulated)', metadata: JSON.stringify({ ...NORMALIZED_PAYLOAD, posted: 1, actorName: 'Sam Operator' }), createdAt: WALL_ACTION },
      highlight: ['action', 'entityId'],
    },
    effects: [
      {
        op: 'insert',
        table: 'AuditLog',
        row: { id: 'aud_003', actorId: IDS.sam, actorRole: 'ops_agent', action: 'movement_posted', entity: 'ledger_entry', entityId: ENTRY, reason: 'Posted Bill payment $120.00 (simulated)', metadata: JSON.stringify({ ...NORMALIZED_PAYLOAD, posted: 1, actorName: 'Sam Operator' }), createdAt: WALL_ACTION },
      },
    ],
    sources: [src(FILES.movements, 453, 461, "action: 'movement_posted'")],
  },
  {
    id: 'post-event',
    kind: 'db-write',
    title: 'Record the simulated notice',
    from: MOVES,
    to: DB,
    label: "INSERT SimulatedEvent 'movement_posted'",
    narrative:
      'Where a real bank would notify the customer or a payment network, Meridian records a SimulatedEvent: an outbound email "Bill payment posted — $120.00 (simulated)", linked to the request and carrying a disclaimer that nothing was sent.',
    audience: { executive: 'In place of a real notification, the system records that one would have been sent.', systems: 'This row marks the integration seam: no network call is made.' },
    detail: 4,
    variants: ['approve'],
    payload: { title: 'SimulatedEvent row', format: 'row', data: POSTED_EVENT, highlight: ['kind', 'summary'] },
    effects: [{ op: 'insert', table: 'SimulatedEvent', row: POSTED_EVENT }],
    sources: [src(FILES.movements, 463, 475, "kind: 'movement_posted'"), src(FILES.movements, 134, 161, 'export async function recordSimEvent')],
  },
  returnStep('approve'),

  // reject
  updateRequestStep('reject'),
  auditStep('reject'),
  {
    id: 'fail-movement-call',
    kind: 'call',
    title: 'Fail the movement',
    from: APPLY,
    to: MOVES,
    label: 'failMovement(tx, existing, now)',
    narrative: 'Inside the transaction the service calls `failMovement` with the transaction client.',
    detail: 3,
    variants: ['reject'],
    sources: [src(FILES.requests, 348, 357, 'failMovement(tx, existing, now)'), src(FILES.movements, 478, 486, 'export async function failMovement')],
  },
  {
    id: 'fail-entry',
    kind: 'db-write',
    title: 'Pending entry becomes failed',
    from: MOVES,
    to: DB,
    label: "UPDATE LedgerEntry SET status = 'failed'",
    narrative:
      'The linked entry is flipped from `pending` to `failed`. A failed entry counts toward no balance, so the $120.00 that the pending debit had reserved becomes available again. `postedAt` stays null — the payment never happened.',
    audience: {
      executive: 'The payment is declined and the $120.00 that was set aside is released back to the customer.',
      'end-user': 'The payment shows as failed and the money is available to spend again.',
      dba: "ledgerEntry.updateMany WHERE id IN ('le_003') AND status = 'pending' SET status = 'failed'. The row is kept, not deleted.",
    },
    detail: 1,
    variants: ['reject'],
    payload: { title: 'LedgerEntry update', format: 'row', data: { id: ENTRY, status: 'failed' }, highlight: ['status'] },
    effects: [{ op: 'update', table: 'LedgerEntry', id: ENTRY, set: { status: 'failed' } }],
    sources: [src(FILES.movements, 490, 493, "data: { status: 'failed' }"), src(FILES.ledger, 82, 89, 'failed / reversed: no effect on any balance')],
  },
  {
    id: 'fail-event',
    kind: 'db-write',
    title: 'Record the simulated notice',
    from: MOVES,
    to: DB,
    label: "INSERT SimulatedEvent 'movement_failed'",
    narrative: 'A simulated outbound email "Bill payment failed — $120.00 (simulated)" is recorded and linked to the request. Unlike the approve path, `failMovement` writes no second audit row; the `ops_reject` row is the only audit record of the rejection.',
    audience: { dba: 'INSERT SimulatedEvent. No ledger-level AuditLog row on this path.' },
    detail: 4,
    variants: ['reject'],
    payload: { title: 'SimulatedEvent row', format: 'row', data: FAILED_EVENT, highlight: ['kind', 'summary'] },
    effects: [{ op: 'insert', table: 'SimulatedEvent', row: FAILED_EVENT }],
    sources: [src(FILES.movements, 495, 505, "kind: 'movement_failed'")],
  },
  returnStep('reject'),

  // hold
  updateRequestStep('hold'),
  auditStep('hold'),
  {
    id: 'hold-ledger-untouched',
    kind: 'state',
    title: 'The ledger is untouched',
    from: APPLY,
    to: DB,
    label: 'LedgerEntry le_003 stays pending',
    narrative:
      'A hold falls through to the workflow-only branch: neither `postApprovedMovement` nor `failMovement` is called. The ledger entry stays `pending`, so the $120.00 remains reserved out of Avery\'s available balance for as long as the request is held.',
    audience: { executive: 'Putting a request on hold moves no money; the amount simply stays set aside.', dba: 'No LedgerEntry statement is issued.' },
    detail: 2,
    variants: ['hold'],
    sources: [src(FILES.requests, 389, 393, 'the pending ledger entry stays pending')],
  },
  returnStep('hold'),

  // request-info
  updateRequestStep('request-info'),
  auditStep('request-info'),
  {
    id: 'info-event',
    kind: 'db-write',
    title: 'Record the simulated email to the customer',
    from: APPLY,
    to: DB,
    label: 'INSERT SimulatedEvent + AuditLog',
    narrative:
      'For `request_info` the service calls `createSimulatedEvent`: it confirms the request exists, inserts an outbound email event "Information request sent to Avery Customer (simulated)" linked to the request, and audits that as `ops_simulate_event`. No email is sent; the customer app has no inbox for it. The ledger entry stays pending.',
    audience: {
      executive: 'The system records that the customer would be asked for more information; no real message goes out.',
      dba: 'INSERT SimulatedEvent, then INSERT AuditLog (entity = \'simulated_event\'). Not in a transaction with the request update.',
    },
    detail: 2,
    variants: ['request-info'],
    payload: { title: 'SimulatedEvent row', format: 'row', data: INFO_EVENT, highlight: ['summary'] },
    effects: [
      { op: 'insert', table: 'SimulatedEvent', row: INFO_EVENT },
      {
        op: 'insert',
        table: 'AuditLog',
        row: { id: 'aud_003', actorId: IDS.sam, actorRole: 'ops_agent', action: 'ops_simulate_event', entity: 'simulated_event', entityId: 'evt_002', reason: INFO_EVENT.summary, metadata: JSON.stringify({ channel: 'email', status: 'sent', requestId: REQ, actorName: 'Sam Operator' }), createdAt: WALL_ACTION },
      },
    ],
    sources: [src(FILES.requests, 395, 409, "input.action === 'request_info'"), src(FILES.requests, 434, 480, 'export async function createSimulatedEvent')],
  },
  returnStep('request-info'),

  // ===== Realtime + response (per decision) =====================================
  emitChangedStep('approve'),
  emitEventStep('approve'),
  responseStep('approve'),
  emitChangedStep('reject'),
  emitEventStep('reject'),
  responseStep('reject'),
  emitChangedStep('hold'),
  responseStep('hold'),
  emitChangedStep('request-info'),
  emitEventStep('request-info'),
  responseStep('request-info'),

  ...ACTION_VARIANTS.map(uiResultStep),

  // ===== Outcome for the customer ===============================================
  {
    id: 'balance-approve',
    kind: 'state',
    title: "Avery's balance reflects the payment",
    from: DB,
    to: AVERY,
    label: 'current $2,451.10 → $2,331.10',
    narrative:
      'Nothing is pushed to the customer app. The next time Avery\'s accounts are loaded, `deriveBalances` recomputes from the ledger: the entry now counts as posted, so the current balance drops from $2,451.10 to $2,331.10. The available balance was already $2,331.10 because the pending debit had reserved the money. In her transaction list the bill payment no longer reads Pending and carries the simulated posting date.',
    audience: {
      executive: 'The customer\'s balance now shows the payment as completed.',
      'end-user': 'Avery sees the bill payment as a completed transaction and her balance $120.00 lower.',
      dba: 'No balance is stored anywhere. Current = sum of posted entries: 250000 − 4890 − 12000 = 233110. The change is the status of one LedgerEntry row.',
    },
    detail: 1,
    variants: ['approve'],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: { currentMinor: 245110, availableMinor: 233110, pendingDebitMinor: 12000 }, after: { currentMinor: 233110, availableMinor: 233110, pendingDebitMinor: 0 } }, highlight: ['after.currentMinor'] },
    sources: [src(FILES.ledger, 79, 119, 'export function deriveBalances')],
  },
  {
    id: 'balance-reject',
    kind: 'state',
    title: "Avery's reserved funds are released",
    from: DB,
    to: AVERY,
    label: 'available $2,331.10 → $2,451.10',
    narrative:
      'On the next load of Avery\'s accounts the failed entry counts for nothing: the current balance is unchanged at $2,451.10 and the available balance rises from $2,331.10 back to $2,451.10. The transaction stays in her history marked Failed.',
    audience: {
      executive: 'The customer keeps her money; the payment shows as failed.',
      'end-user': 'Avery\'s $120.00 is available again and the bill payment is marked failed.',
      dba: 'Available = posted total − pending debits: 245110 − 0 = 245110.',
    },
    detail: 1,
    variants: ['reject'],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { before: { currentMinor: 245110, availableMinor: 233110, pendingDebitMinor: 12000 }, after: { currentMinor: 245110, availableMinor: 245110, pendingDebitMinor: 0 } }, highlight: ['after.availableMinor'] },
    sources: [src(FILES.ledger, 79, 119, 'export function deriveBalances')],
  },
  {
    id: 'balance-open',
    kind: 'state',
    title: 'The payment is still pending for Avery',
    from: DB,
    to: AVERY,
    label: 'still Pending; $120.00 still reserved',
    narrative:
      'For the customer nothing has changed: the bill payment still reads Pending, the current balance is $2,451.10 and the available balance $2,331.10. The request remains in the queue, where any operator can still approve or reject it.',
    audience: { executive: 'The payment waits; the customer\'s money stays set aside until staff decide.' },
    detail: 1,
    variants: ['hold', 'request-info'],
    payload: { title: 'Everyday Checking — derived balances', format: 'json', data: { currentMinor: 245110, availableMinor: 233110, pendingDebitMinor: 12000 } },
    sources: [src(FILES.ledger, 79, 119, 'export function deriveBalances')],
  },
];

export const scenario: Scenario = {
  id: 'ops-approval',
  title: 'An operator approves a pending payment',
  question: 'How does an operations employee approve a pending transaction?',
  summary:
    'Sam Operator opens a pending $120.00 bill payment in the request queue and decides on it. The server checks the session, the staff role and the request\'s current status, then — in one database transaction — marks the request, posts (or fails) the linked ledger entry, audits both and records a simulated notice. Every operator console updates over the socket, and the customer\'s balance changes because it is re-derived from the ledger.',
  category: 'operations',
  tags: ['operations', 'money', 'ledger', 'rbac', 'audit', 'realtime', 'security'],
  participants: [SAM, PAGE, CTX, ROUTES, AUTH, APPLY, MOVES, DB, AVERY],
  related: [
    'ep:POST /api/ops/requests/:id/action',
    'ep:GET /api/ops/requests/:id',
    'ep:GET /api/ops/requests',
    APPLY,
    'be:money/movements#postApprovedMovement',
    'be:money/movements#failMovement',
    'be:money/movements#movementPayloadOf',
    'sh:operations#canApplyAction',
    'sh:operations#OPS_ACTIONS',
    'be:auth/guards#requireRole',
    'be:auth/guards#requireAuth',
    'op:pages/RequestQueues',
    'op:components/RequestDetailPanel',
    'op:lib/OpsDataContext',
    'op:lib/opsApi#applyOpsAction',
    'op:lib/useOpsSocket',
    'ev:ops:request_changed',
    'ev:ops:external_event',
    'db:OperationsRequest',
    'db:LedgerEntry',
    'db:AuditLog',
    'db:SimulatedEvent',
    'feat:ops-review',
    'feat:external-movements',
    'feat:audit',
    'feat:realtime',
  ],
  variants: [
    { id: 'approve', label: 'Approve', description: 'The payment is posted: pending → posted, dated at the simulated now.', outcome: 'success' },
    { id: 'reject', label: 'Reject', description: 'The payment is failed: pending → failed, and the reserved funds are released.', outcome: 'rejected' },
    { id: 'hold', label: 'Hold', description: 'The request moves to on_hold; the ledger entry stays pending.', outcome: 'pending' },
    { id: 'request-info', label: 'Request info', description: 'The request moves to info_requested and a simulated email is recorded; the ledger entry stays pending.', outcome: 'pending' },
    { id: 'not-allowed', label: 'Already resolved', description: 'Another operator approved first; the second decision is refused with 409 already_resolved.', outcome: 'failed' },
    { id: 'forbidden-role', label: 'Customer session', description: 'A signed-in customer calls the staff endpoint and is refused with 403 forbidden.', outcome: 'rejected' },
  ],
  defaultVariant: 'approve',
  initialState: {
    ...baseState(),
    OperationsRequest: [REQUEST_ROW],
    AuditLog: [
      {
        id: 'aud_001',
        actorId: IDS.avery,
        actorRole: 'customer',
        action: 'ops_request_created',
        entity: 'operations_request',
        entityId: REQ,
        reason: 'Bill payment — City Power & Light ($120.00) — submitted by Avery Customer (simulated)',
        metadata: JSON.stringify({ reference: 'MOV-4F9A2C', kind: 'bill_pay', ledgerEntryId: ENTRY }),
        createdAt: '2026-10-01T14:44:09.000Z',
      },
    ],
    SimulatedEvent: [RECEIVED_EVENT],
    Session: [
      { id: 'ses_sam', userId: IDS.sam, tokenHash: '<sha-256 of the mer_ops_session token>', createdAt: '2026-10-01T14:55:00.000Z', lastSeenAt: '2026-10-01T15:03:50.000Z', expiresAt: '2026-10-01T23:03:50.000Z', revokedAt: null },
      { id: 'ses_avery', userId: IDS.avery, tokenHash: '<sha-256 of the mer_session token>', createdAt: '2026-10-01T14:30:00.000Z', lastSeenAt: '2026-10-01T14:41:00.000Z', expiresAt: '2026-10-01T22:41:00.000Z', revokedAt: null },
    ],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [
    src(FILES.routesOps, 122, 159, "app.post('/api/ops/requests/:id/action'"),
    src(FILES.requests, 212, 234, 'export async function applyOperatorAction'),
    src(FILES.movements, 434, 476, 'export async function postApprovedMovement'),
    src('apps/backend/src/routes/money.test.ts', 223, 316, 'operator approval posts the movement', 'Tests pinning approve → posted, reject → failed, hold → still pending'),
  ],
};
