import type { Contract, FlowStep } from '../../types';
import {
  AUTH_ERRORS,
  CSRF_ERROR,
  FILES,
  FORBIDDEN_STAFF,
  RATE_LIMITED,
  csrfSafeStep,
  csrfStep,
  rateLimitStep,
  requireAuthStep,
  requireRoleStep,
  simNowStep,
  src,
  valveStep,
} from './helpers';
import { EP } from './routes';

const P = FILES.routesOps;
const R = FILES.requests;
const M = FILES.movements;

const staffRole = requireRoleStep(['ops_agent', 'admin'], P, 53, 54, 'const opsOnly');
const staffRoleMut = requireRoleStep(['ops_agent', 'admin'], P, 55, 56, 'const opsMutation');
const opsLimit = rateLimitStep('operations', '60 hits per 5 minutes per operator (keyed by user id)', P, 55, 56, "rateLimit('operations')");
const adminRole = requireRoleStep(['admin'], P, 229, 229, 'const adminOnly');
const adminRoleMut = requireRoleStep(['admin'], P, 230, 230, 'const adminMutation');

const staffReadAuth = {
  required: true,
  roles: ['ops_agent', 'admin'],
  surface: 'operations' as const,
  csrf: false,
  notes:
    'The console sends `x-meridian-surface: operations`, so the `mer_ops_session` cookie is read. The surface only selects which cookie is read; the role check is what protects the endpoint.',
};
const staffWriteAuth = {
  required: true,
  roles: ['ops_agent', 'admin'],
  surface: 'operations' as const,
  csrf: true,
  rateLimit: 'operations',
  notes:
    'Send the operations session cookie, `x-meridian-surface: operations` and `x-meridian-csrf` equal to the `mer_csrf` cookie. The rate limit (60 per 5 minutes per operator) applies only in public-demo mode.',
};

const billPayRequest = {
  id: 'req_billpay',
  type: 'bill_pay',
  status: 'pending',
  priority: 'normal',
  summary: 'Bill payment — City Power & Light ($120.00)',
  detail: "A bill payment of $120.00 from the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.",
  subjectName: 'Avery Customer',
  subjectEmail: 'avery.customer@example.com',
  payload: { kind: 'bill_pay', amountMinor: 12000, direction: 'outbound', accountId: 'acc_checking', counterparty: 'City Power & Light', memo: null, ledgerEntryIds: ['le_003'], reference: 'MOV-4F9A2C' },
  lastAction: null,
  lastActorName: null,
  lastActionNote: null,
  createdAt: '2026-10-01T14:40:00.000Z',
  updatedAt: '2026-10-01T14:40:00.000Z',
  resolvedAt: null,
};
const billPayApproved = {
  ...billPayRequest,
  status: 'approved',
  lastAction: 'approve',
  lastActorName: 'Sam Operator',
  updatedAt: '2026-10-01T15:00:00.000Z',
  resolvedAt: '2026-10-01T15:00:00.000Z',
};

const respond = (label: string, detail: string, file: string, start: number, end: number, symbol: string): FlowStep => ({
  kind: 'respond',
  label,
  detail,
  source: src(file, start, end, symbol),
});

export const opsContracts: Contract[] = [
  // -------------------------------------------------------------------------
  {
    id: EP.summary,
    method: 'GET',
    path: '/api/ops/summary',
    summary: 'Operational snapshot for the console dashboard.',
    description:
      'Four counts taken in parallel plus the per-status tally of the request queue. `lockedAccounts` compares `User.lockedUntil` with the real clock on purpose: account lockout is a real-time security window, not a simulated-world event.',
    auth: staffReadAuth,
    responses: [
      {
        status: 200,
        description: 'The counts.',
        fields: [
          { name: 'users', type: 'number', required: true, description: 'All User rows.' },
          { name: 'accounts', type: 'number', required: true, description: 'All Account rows.' },
          { name: 'pendingRequests', type: 'number', required: true, description: 'Requests with status `pending` (same as `requestCounts.pending`).' },
          { name: 'lockedAccounts', type: 'number', required: true, description: 'Users whose `lockedUntil` is in the (wall-clock) future.' },
          { name: 'requestCounts', type: 'OpsStatusCounts', required: true, typeRef: 'sh:operations#OpsStatusCounts' },
        ],
        example: { users: 4, accounts: 2, pendingRequests: 1, lockedAccounts: 0, requestCounts: { pending: 1, approved: 0, rejected: 0, on_hold: 0, info_requested: 0 } },
      },
    ],
    errors: [...AUTH_ERRORS, FORBIDDEN_STAFF],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      staffRole,
      { kind: 'db-read', target: 'db:User', label: 'prisma.user.count() ×2', detail: 'Total users, and users with `lockedUntil > new Date()` (wall clock).', source: src(P, 67, 77, 'lockedUntil: { gt: now }') },
      { kind: 'db-read', target: 'db:Account', label: 'prisma.account.count()', source: src(P, 72, 77, 'prisma.account.count()') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'operationsRequest.findMany({ select: { status } })', detail: 'Only the status column of every request.', source: src(P, 72, 77, 'prisma.operationsRequest.findMany') },
      { kind: 'call', target: 'sh:operations#countRequestsByStatus', label: 'countRequestsByStatus(requests)', detail: 'Tally with all five status keys present.', source: src(P, 78, 80, 'countRequestsByStatus') },
      respond('200 { users, accounts, pendingRequests, lockedAccounts, requestCounts }', 'Plain JSON; no DTO type is declared for it on the server.', P, 81, 87, 'pendingRequests: byStatus.pending'),
    ],
    mutates: false,
    calledBy: ['op:lib/api#fetchOpsSummary'],
    integrationNotes: 'Read-only and cheap. The console fetches it once when the dashboard mounts; live queue numbers on other pages come from the socket-fed in-memory queue instead.',
    sources: [src(P, 66, 88, "app.get('/api/ops/summary'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.list,
    method: 'GET',
    path: '/api/ops/requests',
    summary: 'The live operations queue plus status counts.',
    description:
      'Returns every matching request in priority order — there is no pagination. `counts` always describes the WHOLE queue, ignoring the filter, so the header chips do not change when a filter is applied.',
    auth: staffReadAuth,
    query: [
      { name: 'status', type: 'OpsRequestStatus', required: false, typeRef: 'sh:types#OPS_REQUEST_STATUSES', values: ['pending', 'approved', 'rejected', 'on_hold', 'info_requested'], rules: ['If present, must be one of OPS_REQUEST_STATUSES, else 400.'] },
      { name: 'type', type: 'OpsRequestType', required: false, typeRef: 'sh:types#OPS_REQUEST_TYPES', rules: ['If present, must be one of the twelve OPS_REQUEST_TYPES, else 400.'] },
    ],
    requestExample: 'GET /api/ops/requests?status=pending',
    responses: [
      {
        status: 200,
        description: 'The queue, sorted actionable-first, then by priority, then newest first.',
        typeRef: 'sh:operations#OperationsQueueResponse',
        example: { requests: [billPayRequest], counts: { pending: 1, approved: 0, rejected: 0, on_hold: 0, info_requested: 0 } },
      },
    ],
    errors: [
      { status: 400, code: 'bad_request', when: "The `status` or `type` query value is not a known value.", example: { error: "Unknown status filter 'bogus'.", code: 'bad_request' }, source: src(P, 94, 99, 'Unknown status filter') },
      ...AUTH_ERRORS,
      FORBIDDEN_STAFF,
    ],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      staffRole,
      {
        kind: 'validate',
        target: 'sh:types#OPS_REQUEST_STATUSES',
        label: 'check ?status and ?type against the shared value lists',
        rejects: [{ status: 400, code: 'bad_request', when: 'Unknown status or type filter.' }],
        source: src(P, 93, 99, 'OPS_REQUEST_TYPES.includes'),
      },
      { kind: 'call', target: 'be:ops/requests#listOperationsRequests', label: 'listOperationsRequests(prisma, query)', detail: 'One findMany with the optional filter, mapped to DTOs and sorted in memory.', source: src(P, 100, 104, 'listOperationsRequests(prisma, query)') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'operationsRequest.findMany({ select: { status } })', detail: 'A second, unfiltered read for the counts.', source: src(P, 105, 106, 'prisma.operationsRequest.findMany') },
      { kind: 'call', target: 'sh:operations#countRequestsByStatus', label: 'countRequestsByStatus(all)', source: src(P, 107, 107, 'countRequestsByStatus') },
      respond('200 { requests, counts }', 'OperationsQueueResponse.', P, 108, 108, 'reply.send({ requests, counts })'),
    ],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchOpsRequests'],
    integrationNotes: 'Load once, then keep the list current from the `ops:request_changed` socket event (upsert by id) — that is what the console does. The console filters client-side and does not use the query parameters for its main queue.',
    sources: [src(P, 92, 109, "app.get('/api/ops/requests'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.detail,
    method: 'GET',
    path: '/api/ops/requests/:id',
    summary: 'One request with its history and linked simulated events.',
    description: '`history` is the audit trail for this request (oldest first); `events` are the simulated events whose `requestId` is this request (newest first).',
    auth: staffReadAuth,
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'OperationsRequest id.' }],
    responses: [
      {
        status: 200,
        description: 'The request detail.',
        typeRef: 'sh:operations#OperationsRequestDetailResponse',
        example: {
          request: {
            ...billPayRequest,
            history: [{ id: 'aud_001', action: 'created', actorName: null, actorRole: 'customer', note: 'Bill payment — City Power & Light ($120.00) — submitted by Avery Customer (simulated)', createdAt: '2026-10-01T14:44:09.000Z' }],
            events: [
              {
                id: 'evt_001',
                channel: 'email',
                direction: 'outbound',
                kind: 'movement_received',
                status: 'sent',
                summary: 'Bill payment received — under review (simulated)',
                detail: 'Simulated confirmation that MOV-4F9A2C ($120.00) was received and is awaiting operator review.',
                requestId: 'req_billpay',
                createdAt: '2026-10-01T14:40:00.000Z',
              },
            ],
          },
        },
      },
    ],
    errors: [
      { status: 404, code: 'not_found', when: 'No request has that id.', example: { error: 'That operations request does not exist.', code: 'not_found' }, source: src(P, 114, 118, "code: 'not_found'") },
      ...AUTH_ERRORS,
      FORBIDDEN_STAFF,
    ],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      staffRole,
      { kind: 'call', target: 'be:ops/requests#getOperationsRequestDetail', label: 'getOperationsRequestDetail(prisma, id)', source: src(P, 112, 113, 'getOperationsRequestDetail(prisma, id)') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'operationsRequest.findUnique({ id })', rejects: [{ status: 404, code: 'not_found', when: 'The row does not exist (the service returns null).' }], source: src(R, 166, 167, 'prisma.operationsRequest.findUnique') },
      { kind: 'db-read', target: 'db:AuditLog', label: "auditLog.findMany({ entity: 'operations_request', entityId: id })", detail: 'Oldest first; each row becomes a history entry with the `ops_` prefix stripped from its action.', source: src(R, 169, 173, 'prisma.auditLog.findMany') },
      { kind: 'db-read', target: 'db:SimulatedEvent', label: 'simulatedEvent.findMany({ requestId: id })', detail: 'Newest first.', source: src(R, 174, 174, 'prisma.simulatedEvent.findMany') },
      respond('200 { request }', 'OperationsRequestDetailResponse.', P, 119, 119, 'reply.send({ request })'),
    ],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchOpsRequestDetail', 'op:components/RequestDetailPanel'],
    integrationNotes: 'The history only contains audit rows written against the request itself (created, approve, reject, hold, request_info, note). Ledger-level audit rows such as `movement_posted` or `movement_reversed` are stored against `ledger_entry` and do not appear here.',
    sources: [src(P, 111, 120, "app.get('/api/ops/requests/:id'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.action,
    method: 'POST',
    path: '/api/ops/requests/:id/action',
    summary: 'Apply an operator action to a request.',
    description:
      'A decision (approve / reject / hold / request_info) is allowed while the request is pending, on hold or info-requested, and moves it to approved / rejected / on_hold / info_requested. A `note` is allowed in any status and changes nothing but the audit trail and `updatedAt`.\n\nApprove and reject carry the domain effect of the request type, atomically with the status change: a money movement is posted or failed, an onboarding application is provisioned or rejected, a dispute is upheld or denied, a fraud alert is confirmed or dismissed. Hold and request_info never touch the ledger.',
    auth: staffWriteAuth,
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'OperationsRequest id.' }],
    body: [
      { name: 'action', type: 'OpsAction', required: true, typeRef: 'sh:operations#OpsAction', values: ['approve', 'reject', 'hold', 'request_info', 'note'], rules: ['Must satisfy isOpsAction, else 400 bad_request.'] },
      { name: 'note', type: 'string', required: false, rules: ['Non-strings are ignored.', 'Silently truncated to 500 characters.', 'Required and non-blank when action is `note`.'], description: 'Stored trimmed as the audit row\'s `reason` and, for decisions, as `lastActionNote`.' },
    ],
    bodyTypeRef: 'sh:operations#OperatorActionRequest',
    requestExample: { action: 'approve' },
    responses: [{ status: 200, description: 'The updated queue item. Generated simulated events are not in the response; they arrive on the socket and in the request detail.', typeRef: 'sh:operations#OperatorActionResponse', example: { request: billPayApproved } }],
    errors: [
      { status: 400, code: 'bad_request', when: 'The action is missing or not one of approve / reject / hold / request_info / note.', example: { error: 'A valid action (approve | reject | hold | request_info | note) is required.', code: 'bad_request' }, source: src(P, 125, 130, 'A valid action') },
      { status: 400, code: 'bad_request', when: 'The action is `note` and the note text is missing or blank.', example: { error: 'A note is required to add a note.', code: 'bad_request' }, source: src(P, 133, 136, 'A note is required to add a note.') },
      { status: 400, code: 'invalid_action', when: 'Approving an onboarding request whose application was already provisioned or rejected, or whose email already belongs to a user.', example: { error: 'A user with the email avery.customer@example.com already exists; cannot provision this application.', code: 'invalid_action' }, source: src(R, 294, 296, "new OpsActionError('invalid_action', blocker)") },
      { status: 404, code: 'not_found', when: 'No request has that id.', example: { error: 'That operations request does not exist.', code: 'not_found' }, source: src(R, 235, 238, "new OpsActionError('not_found'") },
      { status: 409, code: 'already_resolved', when: 'A decision was sent for a request that is already approved or rejected.', example: { error: 'That request has already been resolved and cannot be actioned again.', code: 'already_resolved' }, source: src(R, 274, 279, 'already_resolved') },
      CSRF_ERROR,
      ...AUTH_ERRORS,
      FORBIDDEN_STAFF,
      RATE_LIMITED,
    ],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      staffRoleMut,
      opsLimit,
      {
        kind: 'validate',
        target: 'sh:operations#isOpsAction',
        label: 'isOpsAction(body.action); bound the note',
        detail: 'The note is cut to 500 characters; a `note` action must carry non-blank text.',
        rejects: [
          { status: 400, code: 'bad_request', when: 'Unknown or missing action.' },
          { status: 400, code: 'bad_request', when: 'Action `note` without text.' },
        ],
        source: src(P, 123, 136, 'isOpsAction(body.action)'),
      },
      simNowStep(P, 142, 145),
      { kind: 'call', target: 'be:ops/requests#applyOperatorAction', label: 'applyOperatorAction(prisma, { id, action, note, actor: req.user }, now)', source: src(P, 138, 146, 'applyOperatorAction') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'operationsRequest.findUnique({ id })', rejects: [{ status: 404, code: 'not_found', when: 'Unknown request id.' }], source: src(R, 235, 238, 'prisma.operationsRequest.findUnique') },
      {
        kind: 'decision',
        target: 'sh:operations#canApplyAction',
        label: 'canApplyAction(currentStatus, action)',
        detail: 'A note skips this check. A decision is refused once the request is approved or rejected. The next status comes from nextStatusForAction.',
        rejects: [{ status: 409, code: 'already_resolved', when: 'A decision on a terminal request.' }],
        source: src(R, 273, 280, 'canApplyAction(currentStatus, input.action)'),
      },
      {
        kind: 'transaction',
        label: 'prisma.$transaction (approve / reject of a typed request)',
        detail: 'Money-movement, onboarding, dispute and fraud approve / reject run the three writes below on one transaction client. Hold, request_info, note, and approve / reject of types with no effect run the first two without a transaction.',
        source: src(R, 333, 340, 'prisma.$transaction'),
      },
      {
        kind: 'db-write',
        target: 'db:OperationsRequest',
        label: 'update status + last-action bookkeeping',
        detail: 'status, lastAction, lastActorId, lastActorRole, lastActorName, lastActionNote, updatedAt = now, resolvedAt = now only for approved / rejected.',
        source: src(R, 281, 290, 'resolvedAt: isTerminalOpsStatus(nextStatus) ? now : null'),
      },
      {
        kind: 'db-write',
        target: 'db:AuditLog',
        label: "writeAudit: action 'ops_<action>', entity 'operations_request'",
        detail: 'actorId and actorRole from the session, `reason` = the note, metadata = { action, actorName, fromStatus, toStatus }.',
        source: src(R, 242, 256, 'const auditFor'),
      },
      {
        kind: 'call',
        target: 'be:money/movements#postApprovedMovement',
        label: 'domain effect, e.g. postApprovedMovement(tx, existing, actor, now)',
        detail:
          'Movement approve: linked pending ledger entries → posted with postedAt = now, a `movement_posted` audit row and a simulated email. Movement reject → failMovement (entries → failed). Onboarding → provisionApprovedOnboarding / rejectOnboardingApplication. Dispute → upholdDispute / denyDispute. Fraud alert → confirmFraud / dismissFraud.',
        rejects: [{ status: 400, code: 'invalid_action', when: 'Onboarding approve only: onboardingApprovalBlocker returned a reason (checked before the transaction opens).' }],
        source: src(R, 334, 346, 'postApprovedMovement(tx, existing, input.actor, now)'),
      },
      {
        kind: 'db-write',
        target: 'db:SimulatedEvent',
        label: 'request_info: createSimulatedEvent (email, notification, sent)',
        detail: '"Information request sent to <subject> (simulated)", linked to the request and audited as `ops_simulate_event`.',
        source: src(R, 395, 409, "channel: 'email'"),
      },
      {
        kind: 'emit',
        target: 'ev:ops:request_changed',
        label: "opsRealtime.requestChanged('updated', request)",
        detail: 'To the Socket.IO `ops` room only. Sent for notes as well, so other consoles refresh their history.',
        source: src(P, 147, 148, "app.opsRealtime.requestChanged('updated', request)"),
      },
      {
        kind: 'emit',
        target: 'ev:ops:external_event',
        label: 'opsRealtime.externalEvent(event) for each generated event',
        detail: 'The single `event` and every item of `events` from the service result.',
        source: src(P, 149, 150, 'app.opsRealtime.externalEvent(extra)'),
      },
      respond('200 { request }', 'OperatorActionResponse. OpsActionError codes map to 404 / 409 / 400; anything else is rethrown as a 500.', P, 151, 158, 'reply.send({ request })'),
    ],
    sideEffects: [
      'Updates the OperationsRequest row (status and last-action fields; a note only touches updatedAt).',
      'Inserts one AuditLog row `ops_<action>` against the request.',
      'Approve / reject of a money movement: linked LedgerEntry rows go pending → posted (postedAt = simulated now) or pending → failed; a simulated email event is recorded; approve also writes a `movement_posted` audit row.',
      'Approve of an onboarding application: inserts User, Account, AccountAccess, optionally a posted deposit LedgerEntry and an AccountInvitation; marks the application provisioned.',
      'Approve / reject of a dispute or fraud alert: reverses or restores the linked ledger entry and may freeze a card (see the risk services).',
      'request_info: inserts a simulated outbound email and its audit row.',
      'Emits `ops:request_changed` (updated) and `ops:external_event` per generated event to the ops room.',
    ],
    mutates: true,
    calledBy: ['op:lib/opsApi#applyOpsAction', 'op:lib/OpsDataContext#act'],
    integrationNotes:
      'Send `{ "action": "approve" }` (optionally with `note`) as JSON with the staff session cookie and the CSRF header. Treat 409 `already_resolved` as "someone else got there first" and refresh. The response is the updated request only; to see the resulting history and events, refetch the detail or listen on the socket. The customer is not notified by any real channel — their balance simply changes the next time it is derived.',
    sources: [src(P, 122, 159, "app.post('/api/ops/requests/:id/action'"), src(R, 230, 234, 'export async function applyOperatorAction')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.simulate,
    method: 'POST',
    path: '/api/ops/simulate/event',
    summary: 'Generate a simulated external event.',
    description: 'Records a clearly labelled fake SMS / email / MFA / identity event and pushes it to the operators\' feed. No provider is ever contacted.',
    auth: staffWriteAuth,
    body: [
      { name: 'channel', type: 'SimEventChannel', required: true, typeRef: 'sh:operations#SIM_EVENT_CHANNELS', values: ['sms', 'email', 'mfa', 'identity'], rules: ['Must satisfy isSimEventChannel, else 400.'] },
      { name: 'kind', type: 'string', required: false, rules: ['Trimmed and cut to 64 characters; blank becomes undefined.'] },
      { name: 'requestId', type: 'string', required: false, rules: ['Cut to 64 characters.', 'Dropped (stored as null) if no such request exists.'] },
      { name: 'outcome', type: 'SimEventStatus', required: false, typeRef: 'sh:operations#SIM_EVENT_STATUSES', rules: ['If present, must be one of SIM_EVENT_STATUSES, else 400.', 'Default: sms → delivered, email → sent, mfa / identity → pending.'] },
      { name: 'direction', type: 'SimEventDirection', required: false, typeRef: 'sh:operations#SIM_EVENT_DIRECTIONS', rules: ['If present, must be outbound or inbound, else 400.', 'Default outbound.'] },
      { name: 'summary', type: 'string', required: false, rules: ['Cut to 500 characters.', 'Default "Simulated <CHANNEL> <kind or \'message\'>".'] },
    ],
    bodyTypeRef: 'sh:operations#SimulateEventRequest',
    requestExample: { channel: 'sms', kind: 'otp', outcome: 'delivered' },
    responses: [
      {
        status: 200,
        description: 'The recorded event.',
        typeRef: 'sh:operations#SimulateEventResponse',
        example: {
          event: { id: 'evt_301', channel: 'sms', direction: 'outbound', kind: 'otp', status: 'delivered', summary: 'Simulated SMS otp', detail: 'SIMULATION — no real message was sent to any provider.', requestId: null, createdAt: '2026-10-01T15:00:00.000Z' },
        },
      },
    ],
    errors: [
      { status: 400, code: 'bad_request', when: 'The channel is missing or unknown.', example: { error: 'A valid channel (sms | email | mfa | identity) is required.', code: 'bad_request' }, source: src(P, 165, 167, 'A valid channel') },
      { status: 400, code: 'bad_request', when: 'An unknown `outcome` or `direction` value.', example: { error: "Unknown outcome 'exploded'.", code: 'bad_request' }, source: src(P, 168, 173, 'Unknown outcome') },
      CSRF_ERROR,
      ...AUTH_ERRORS,
      FORBIDDEN_STAFF,
      RATE_LIMITED,
    ],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      staffRoleMut,
      opsLimit,
      { kind: 'validate', target: 'sh:operations#isSimEventChannel', label: 'isSimEventChannel(body.channel); check outcome and direction', rejects: [{ status: 400, code: 'bad_request', when: 'Unknown channel, outcome or direction.' }], source: src(P, 164, 173, 'isSimEventChannel(body.channel)') },
      simNowStep(P, 183, 183),
      { kind: 'call', target: 'be:ops/requests#createSimulatedEvent', label: 'createSimulatedEvent(prisma, input, req.user, now)', source: src(P, 175, 183, 'createSimulatedEvent') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'findUnique({ id: requestId }) if given', detail: 'A dangling requestId is dropped rather than failing.', source: src(R, 446, 454, 'prisma.operationsRequest.findUnique') },
      { kind: 'db-write', target: 'db:SimulatedEvent', label: 'simulatedEvent.create(…)', detail: 'createdAt = simulated now; detail = the fixed SIMULATION disclaimer.', source: src(R, 456, 467, 'prisma.simulatedEvent.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: action 'ops_simulate_event', entity 'simulated_event'", source: src(R, 469, 477, 'ops_simulate_event') },
      { kind: 'emit', target: 'ev:ops:external_event', label: 'opsRealtime.externalEvent(event)', source: src(P, 184, 184, 'app.opsRealtime.externalEvent(event)') },
      respond('200 { event }', 'SimulateEventResponse.', P, 185, 185, 'reply.send({ event })'),
    ],
    sideEffects: ['Inserts one SimulatedEvent row.', 'Inserts one AuditLog row `ops_simulate_event`.', 'Emits `ops:external_event` to the ops room.'],
    mutates: true,
    calledBy: ['op:lib/opsApi#simulateEvent'],
    integrationNotes: 'This is the seam where a real messaging or identity provider would attach: today the "send" is a database row and a socket push, nothing more.',
    sources: [src(P, 163, 186, "app.post('/api/ops/simulate/event'"), src(R, 434, 439, 'export async function createSimulatedEvent')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.events,
    method: 'GET',
    path: '/api/ops/events',
    summary: 'Recent simulated events, newest first.',
    auth: staffReadAuth,
    query: [{ name: 'limit', type: 'integer (string)', required: false, rules: ['Parsed with parseInt; a non-numeric value falls back to 50.', 'Clamped to 1–200 by the service.'], description: 'How many events to return. Default 50.' }],
    requestExample: 'GET /api/ops/events?limit=50',
    responses: [
      {
        status: 200,
        description: 'The feed across all channels.',
        typeRef: 'sh:operations#SimulatedEventsResponse',
        example: {
          events: [
            {
              id: 'evt_001',
              channel: 'email',
              direction: 'outbound',
              kind: 'movement_received',
              status: 'sent',
              summary: 'Bill payment received — under review (simulated)',
              detail: 'Simulated confirmation that MOV-4F9A2C ($120.00) was received and is awaiting operator review.',
              requestId: 'req_billpay',
              createdAt: '2026-10-01T14:40:00.000Z',
            },
          ],
        },
      },
    ],
    errors: [...AUTH_ERRORS, FORBIDDEN_STAFF],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      staffRole,
      { kind: 'call', target: 'be:ops/requests#listSimulatedEvents', label: 'listSimulatedEvents(prisma, limit)', source: src(P, 189, 191, 'listSimulatedEvents') },
      { kind: 'db-read', target: 'db:SimulatedEvent', label: 'simulatedEvent.findMany({ orderBy: createdAt desc, take })', source: src(R, 189, 192, 'prisma.simulatedEvent.findMany') },
      respond('200 { events }', 'SimulatedEventsResponse.', P, 192, 192, 'reply.send({ events })'),
    ],
    mutates: false,
    calledBy: ['op:lib/opsApi#fetchOpsEvents'],
    integrationNotes: 'Load once, then prepend from the `ops:external_event` socket event (de-duplicate by id).',
    sources: [src(P, 188, 193, "app.get('/api/ops/events'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.reverse,
    method: 'POST',
    path: '/api/ops/movements/:requestId/reverse',
    summary: 'Reverse a settled money movement.',
    description:
      'Flips the ledger entries linked to the request from `posted` (or `disputed`) to `reversed`, which removes their balance effect without editing any balance. The request keeps its status (normally `approved`); its payload gains `reversed: true`, which the console shows as a "Reversed" tag. A reason is mandatory and is stored on the audit row.\n\nThe handler does not check the request status itself: whether there is anything to reverse is decided by whether any linked entry is currently posted or disputed.',
    auth: staffWriteAuth,
    pathParams: [{ name: 'requestId', type: 'string', required: true, description: 'Id of the OperationsRequest that carries the movement payload.' }],
    body: [{ name: 'reason', type: 'string', required: true, rules: ['Must be a string; trimmed.', 'Cut to 280 characters (MOVEMENT_TEXT.reasonMaxLength).', 'Must not be empty after trimming.'], description: 'Why the movement is being reversed; recorded in the audit log.' }],
    requestExample: { reason: 'Customer reported a duplicate payment' },
    responses: [
      {
        status: 200,
        description: 'The updated request; `payload.reversed` is now true.',
        fields: [{ name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' }],
        example: { request: { ...billPayApproved, payload: { ...billPayRequest.payload, reversed: true }, updatedAt: '2026-10-01T15:00:00.000Z' } },
      },
    ],
    errors: [
      { status: 400, code: 'bad_request', when: 'The reason is missing, not a string, or blank.', example: { error: 'A reason is required to reverse a movement.', code: 'bad_request' }, source: src(P, 203, 207, 'A reason is required to reverse a movement.') },
      { status: 400, code: 'not_a_movement', when: 'The request is not a deposit / ach / wire / bill_pay with at least one linked ledger entry.', example: { error: 'That request is not a money movement.', code: 'not_a_movement' }, source: src(M, 527, 528, 'not_a_movement') },
      { status: 404, code: 'not_found', when: 'No request has that id.', example: { error: 'That operations request does not exist.', code: 'not_found' }, source: src(M, 524, 525, "new MovementError('not_found'") },
      { status: 409, code: 'nothing_to_reverse', when: 'None of the linked entries is posted or disputed — the movement is still pending, already failed or already reversed.', example: { error: 'There is no posted movement to reverse.', code: 'nothing_to_reverse' }, source: src(M, 531, 534, 'nothing_to_reverse') },
      CSRF_ERROR,
      ...AUTH_ERRORS,
      FORBIDDEN_STAFF,
      RATE_LIMITED,
    ],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      staffRoleMut,
      opsLimit,
      { kind: 'validate', label: 'reason: string, trimmed, ≤ 280 chars, non-empty', rejects: [{ status: 400, code: 'bad_request', when: 'Missing or blank reason.' }], source: src(P, 201, 207, 'MOVEMENT_TEXT.reasonMaxLength') },
      simNowStep(P, 209, 214),
      { kind: 'call', target: 'be:money/movements#reverseMovement', label: 'reverseMovement(requestId, req.user, reason, now)', source: src(P, 208, 214, 'reverseMovement(') },
      { kind: 'db-read', target: 'db:OperationsRequest', label: 'operationsRequest.findUnique({ id: requestId })', rejects: [{ status: 404, code: 'not_found', when: 'Unknown request id.' }], source: src(M, 524, 525, 'prisma.operationsRequest.findUnique') },
      { kind: 'validate', target: 'be:money/movements#movementPayloadOf', label: 'movementPayloadOf(request)', detail: 'The request must be a movement type whose payload lists ledgerEntryIds.', rejects: [{ status: 400, code: 'not_a_movement', when: 'No movement payload.' }], source: src(M, 527, 528, 'movementPayloadOf(request)') },
      { kind: 'transaction', label: 'prisma.$transaction', detail: 'The ledger update, the request update, the audit row and the simulated event commit together; a zero-row reversal throws inside and rolls back.', source: src(M, 530, 530, 'prisma.$transaction') },
      {
        kind: 'db-write',
        target: 'db:LedgerEntry',
        label: "updateMany({ id in ledgerEntryIds, status in ['posted','disputed'] }, { status: 'reversed' })",
        detail: 'reverseLedgerEntries returns how many rows changed.',
        rejects: [{ status: 409, code: 'nothing_to_reverse', when: 'Zero rows were updated.' }],
        source: src(M, 397, 404, "data: { status: 'reversed' }"),
      },
      { kind: 'db-write', target: 'db:OperationsRequest', label: 'update payload = { …payload, reversed: true }, updatedAt = now', detail: 'Status and resolvedAt are left as they were.', source: src(M, 536, 540, 'reversed: true') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: action 'movement_reversed', entity 'ledger_entry'", detail: 'entityId = the first ledger entry id; `reason` = the operator\'s reason; metadata = the payload plus reversedCount and actorName.', source: src(M, 542, 550, 'movement_reversed') },
      { kind: 'db-write', target: 'db:SimulatedEvent', label: 'recordSimEvent: email movement_reversed', detail: '"<Kind> reversed — <amount> (simulated)", detail "Simulated reversal: <reason>", linked to the request.', source: src(M, 552, 563, "kind: 'movement_reversed'") },
      { kind: 'emit', target: 'ev:ops:request_changed', label: "opsRealtime.requestChanged('updated', request)", source: src(P, 215, 215, "app.opsRealtime.requestChanged('updated', request)") },
      { kind: 'emit', target: 'ev:ops:external_event', label: 'opsRealtime.externalEvent(event)', source: src(P, 216, 216, 'app.opsRealtime.externalEvent(event)') },
      respond('200 { request }', 'MovementError codes map to 404 (not_found), 409 (nothing_to_reverse) and 400 (anything else).', P, 217, 224, 'reply.send({ request })'),
    ],
    sideEffects: [
      'LedgerEntry rows linked to the request: posted / disputed → reversed (balances change because they are re-derived).',
      'OperationsRequest.payload gains `reversed: true`; updatedAt is set.',
      'Inserts one AuditLog row `movement_reversed` carrying the reason.',
      'Inserts one SimulatedEvent row and emits `ops:request_changed` + `ops:external_event`.',
    ],
    mutates: true,
    calledBy: ['op:lib/opsApi#reverseMovement', 'op:lib/OpsDataContext#reverse'],
    integrationNotes:
      'A reversal is not a new offsetting entry: the original entry is re-statused, so it disappears from the current balance and shows as Reversed in history. Calling it twice returns 409 `nothing_to_reverse` the second time. The audit row is stored against the ledger entry, so it does not appear in the request\'s History list.',
    sources: [src(P, 195, 225, "app.post('/api/ops/movements/:requestId/reverse'"), src(M, 513, 523, 'export async function reverseMovement')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.adminList,
    method: 'GET',
    path: '/api/admin/users',
    summary: 'The full user roster (admin only).',
    description: 'Every user, oldest first. The Prisma `select` names nine columns explicitly, so the password hash is never read into the response.',
    auth: { required: true, roles: ['admin'], surface: 'operations', csrf: false, notes: 'An ops_agent session is refused with 403.' },
    responses: [
      {
        status: 200,
        description: 'All users.',
        fields: [
          {
            name: 'users',
            type: 'Array<…>',
            required: true,
            children: [
              { name: 'id', type: 'string', required: true },
              { name: 'email', type: 'string', required: true },
              { name: 'displayName', type: 'string', required: true },
              { name: 'role', type: 'string', required: true, values: ['customer', 'joint_customer', 'ops_agent', 'admin'] },
              { name: 'status', type: 'string', required: true, values: ['active', 'disabled'] },
              { name: 'lastLoginAt', type: 'string (ISO) | null', required: true },
              { name: 'failedLoginAttempts', type: 'number', required: true },
              { name: 'lockedUntil', type: 'string (ISO) | null', required: true },
              { name: 'createdAt', type: 'string (ISO)', required: true },
            ],
          },
        ],
        example: {
          users: [
            { id: 'usr_avery', email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer', status: 'active', lastLoginAt: '2026-10-01T14:30:00.000Z', failedLoginAttempts: 0, lockedUntil: null, createdAt: '2026-08-01T12:00:00.000Z' },
            { id: 'usr_sam', email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent', status: 'active', lastLoginAt: '2026-10-01T14:55:00.000Z', failedLoginAttempts: 0, lockedUntil: null, createdAt: '2026-08-01T12:00:00.000Z' },
          ],
        },
      },
    ],
    errors: [...AUTH_ERRORS, { ...FORBIDDEN_STAFF, when: 'The signed-in user is not an admin (an ops_agent is refused too).' }],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      adminRole,
      { kind: 'db-read', target: 'db:User', label: 'user.findMany({ orderBy: createdAt asc, select: … })', detail: 'id, email, displayName, role, status, lastLoginAt, failedLoginAttempts, lockedUntil, createdAt.', source: src(P, 233, 246, 'prisma.user.findMany') },
      respond('200 { users }', 'Dates are converted to ISO strings.', P, 247, 254, 'reply.send({'),
    ],
    mutates: false,
    integrationNotes: 'No paging or filtering. The session and role guards run first, so the list is never visible to operators who are not admins.',
    sources: [src(P, 227, 255, "app.get('/api/admin/users'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.adminCreate,
    method: 'POST',
    path: '/api/admin/users',
    summary: 'Admin creates a user, optionally with a funded account.',
    description:
      'Creates a user of any role. If `product` is given an account is opened with an owner grant; if `initialFundingMinor` > 0 the account is funded with a posted `adjustment` credit, which requires a `reason` and writes an `admin_adjustment` audit row. Everything is written in one transaction.',
    auth: { required: true, roles: ['admin'], surface: 'operations', csrf: true, rateLimit: 'adminUsers', notes: 'Rate limit (public-demo mode only): 10 per 15 minutes per admin — each call costs a bcrypt hash.' },
    body: [
      { name: 'email', type: 'string', required: true, rules: ['Cut to 500 characters before validation.', 'Trimmed and lower-cased.', 'Must pass isLikelyEmail (≤ 254 characters).', 'Must not belong to an existing user (409).'] },
      { name: 'displayName', type: 'string', required: true, rules: ['Trimmed; required.', 'At most 80 characters.'] },
      { name: 'role', type: 'UserRole', required: false, values: ['customer', 'joint_customer', 'ops_agent', 'admin'], rules: ['Defaults to customer.', 'Must be in ADMIN_CREATABLE_ROLES.'], typeRef: 'sh:onboarding#ADMIN_CREATABLE_ROLES' },
      { name: 'product', type: 'string | null', required: false, values: ['checking', 'savings'], rules: ['Blank / omitted = no account.', 'Otherwise must be checking or savings.', 'Required when initialFundingMinor > 0.'] },
      { name: 'initialFundingMinor', type: 'integer (minor units)', required: false, rules: ['Defaults to 0.', 'Non-negative integer.', 'At most 2,500,000 ($25,000).'] },
      { name: 'reason', type: 'string | null', required: false, rules: ['Cut to 500 characters, trimmed.', 'Required when initialFundingMinor > 0 (audited adjustment).'] },
      { name: 'password', type: 'string | null', required: false, rules: ['Shorter than 8 characters or omitted → the documented demo default is used.', 'Longer than 200 characters → error.'] },
    ],
    bodyTypeRef: 'sh:onboarding#AdminCreateUserRequest',
    requestExample: { email: 'casey.demo@example.com', displayName: 'Casey Demo', product: 'savings', initialFundingMinor: 50000, reason: 'Opening balance for a demo account' },
    responses: [
      {
        status: 201,
        description: 'The created user, the opened account (or null) and the non-secret demo password to share.',
        typeRef: 'sh:onboarding#AdminCreateUserResponse',
        example: {
          user: { id: 'usr_casey', email: 'casey.demo@example.com', displayName: 'Casey Demo', role: 'customer', status: 'active', createdAt: '2026-10-01T15:04:12.000Z' },
          account: { id: 'acc_casey_savings', type: 'savings', name: 'Goal Savings' },
          demoPassword: '<the demo password in effect>',
        },
      },
    ],
    errors: [
      {
        status: 400,
        code: 'invalid_request',
        when: 'validateAdminCreateUser found field errors (bad email, missing name, unknown role or product, funding without an account or without a reason, over-long password).',
        example: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { reason: 'A reason is required to fund a new account (audited adjustment).' } },
        source: src(P, 272, 278, 'invalid_request'),
      },
      { status: 409, code: 'conflict', when: 'A user with that email already exists.', example: { error: 'A user with the email avery.customer@example.com already exists.', code: 'conflict' }, source: src(FILES.adminUsers, 35, 38, "new AdminUserError('conflict'") },
      CSRF_ERROR,
      ...AUTH_ERRORS,
      { ...FORBIDDEN_STAFF, when: 'The signed-in user is not an admin (an ops_agent is refused too).' },
      RATE_LIMITED,
    ],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      adminRoleMut,
      rateLimitStep('adminUsers', '10 hits per 15 minutes per admin', P, 230, 230, "rateLimit('adminUsers')"),
      { kind: 'validate', target: 'sh:onboarding#validateAdminCreateUser', label: 'validateAdminCreateUser({ … })', detail: 'Each body field is type-checked and length-bounded first, then validated and normalized.', rejects: [{ status: 400, code: 'invalid_request', when: 'Any field error; the map is returned as `fields`.' }], source: src(P, 261, 278, 'validateAdminCreateUser') },
      simNowStep(P, 280, 280),
      { kind: 'call', target: 'be:ops/admin-users#adminCreateUser', label: 'adminCreateUser(check.value, req.user, now)', source: src(P, 279, 281, 'adminCreateUser(check.value') },
      { kind: 'db-read', target: 'db:User', label: 'user.findUnique({ email })', rejects: [{ status: 409, code: 'conflict', when: 'The email is already taken.' }], source: src(FILES.adminUsers, 35, 38, 'prisma.user.findUnique') },
      { kind: 'call', target: 'be:auth/password#hashPassword', label: 'hashPassword(input.password)', source: src(FILES.adminUsers, 40, 40, 'hashPassword(input.password)') },
      { kind: 'transaction', label: 'prisma.$transaction', source: src(FILES.adminUsers, 42, 42, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:User', label: 'user.create(…)', detail: 'role from the input, status active, passwordHash, passwordUpdatedAt = now.', source: src(FILES.adminUsers, 43, 52, 'tx.user.create') },
      { kind: 'db-write', target: 'db:Account', label: 'account.create(…) if product', detail: 'type = product, name from ONBOARDING_PRODUCT_LABELS, openedAt = now.', source: src(FILES.adminUsers, 55, 59, 'tx.account.create') },
      { kind: 'db-write', target: 'db:AccountAccess', label: "accountAccess.create({ relationship: 'owner' })", source: src(FILES.adminUsers, 60, 62, 'tx.accountAccess.create') },
      { kind: 'db-write', target: 'db:LedgerEntry', label: "ledgerEntry.create(posted 'adjustment' credit) if funding > 0", detail: 'description "Admin opening adjustment (simulated)", reason = the admin\'s reason, postedAt = now.', source: src(FILES.adminUsers, 67, 80, 'tx.ledgerEntry.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: 'admin_adjustment' (if funded) and 'admin_create_user'", source: src(FILES.adminUsers, 81, 111, 'admin_create_user') },
      respond('201 { user, account, demoPassword }', 'AdminCreateUserResponse. AdminUserError → 409.', P, 279, 287, 'reply.code(201).send(result)'),
    ],
    sideEffects: [
      'Inserts a User (with a bcrypt password hash).',
      'Optionally inserts an Account and an owner AccountAccess row.',
      'Optionally inserts a posted `adjustment` credit LedgerEntry with the reason.',
      'Inserts AuditLog rows `admin_adjustment` (if funded) and `admin_create_user`.',
    ],
    mutates: true,
    calledBy: ['op:lib/adminApi#createAdminUser'],
    integrationNotes: 'No socket event is emitted and no operations request is created — this bypasses the review queue by design, which is why funding demands an audited reason. The returned `demoPassword` is a non-secret simulation credential.',
    sources: [src(P, 257, 288, "app.post('/api/admin/users'"), src(FILES.adminUsers, 30, 34, 'export async function adminCreateUser')],
  },
];
