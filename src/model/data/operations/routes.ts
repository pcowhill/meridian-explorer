import type { Entity, Relation } from '../../types';
import { FILES, rel, src } from './helpers';

const RO = 'be:routes/ops';
const RB = 'be:routes/onboarding';
const P = FILES.routesOps;
const Q = FILES.routesOnboarding;

function endpoint(group: string, method: string, path: string, summary: string, rest: Partial<Entity>): Entity {
  return { id: `ep:${method} ${path}`, kind: 'endpoint', name: `${method} ${path}`, parent: group, summary, ...rest };
}

export const EP = {
  summary: 'ep:GET /api/ops/summary',
  list: 'ep:GET /api/ops/requests',
  detail: 'ep:GET /api/ops/requests/:id',
  action: 'ep:POST /api/ops/requests/:id/action',
  simulate: 'ep:POST /api/ops/simulate/event',
  events: 'ep:GET /api/ops/events',
  reverse: 'ep:POST /api/ops/movements/:requestId/reverse',
  adminList: 'ep:GET /api/admin/users',
  adminCreate: 'ep:POST /api/admin/users',
  apply: 'ep:POST /api/onboarding/applications',
  invite: 'ep:POST /api/accounts/:id/invitations',
  invitations: 'ep:GET /api/invitations',
  accept: 'ep:POST /api/invitations/:id/accept',
  decline: 'ep:POST /api/invitations/:id/decline',
} as const;

const entities: Entity[] = [
  {
    id: RO,
    kind: 'route-group',
    name: 'routes/ops.ts',
    parent: 'be.http',
    summary: 'The staff-only route plugin: queue reads, operator actions, simulated events, movement reversal and admin user management.',
    description:
      'Registers nine endpoints. Two reusable option objects carry the guards: `opsOnly` = [requireAuth, requireRole(ops_agent, admin)] for reads and `opsMutation` = the same plus rateLimit("operations") for writes; the two admin routes use `requireRole("admin")`, with rateLimit("adminUsers") on create. Customers and joint customers get 403 from every route here.\n\nHandlers are thin: they validate the body with shared type guards, read the simulated time, call one service function, publish the result to operator consoles through `app.opsRealtime`, and map typed service errors to HTTP status codes. Malformed input is answered with `{ error, code: "bad_request" }`.\n\nThe summary and admin-list handlers query Prisma directly; everything else goes through `ops/requests.ts`, `ops/admin-users.ts` or `money/movements.ts`.',
    audience: {
      executive: 'The back-office entrance to the bank: only staff get through, and everything they do is checked and recorded.',
      systems: 'Nine JSON endpoints under /api/ops/* and /api/admin/*, role-gated per route; mutations additionally rate-limited in public-demo mode and pushed to the Socket.IO `ops` room.',
    },
    tech: ['Fastify'],
    tags: ['operations', 'rbac', 'security', 'realtime'],
    aliases: ['ops routes', 'opsRoutes', '/api/ops', '/api/admin'],
    sources: [src(P, 35, 49, 'Operations & admin endpoints', 'Header comment'), src(P, 51, 65, 'export async function opsRoutes', 'Guards and the plugin function')],
  },
  {
    id: RB,
    kind: 'route-group',
    name: 'routes/onboarding.ts',
    parent: 'be.http',
    summary: 'The route plugin for account-opening applications (public) and joint-owner invitations (signed-in customers).',
    description:
      'Registers five endpoints. The application endpoint needs no session: it is one of the three paths on the CSRF exempt list (with login and logout) and is guarded only by rateLimit("onboarding"), keyed by client IP. The invitation mutations use [requireAuth, rateLimit("risk")]; the invitation list needs only requireAuth.\n\nValidation failures are answered with `{ error, code: "invalid_request", fields }`. `InvitationError` codes are mapped by `handleInvitationError`: not_found → 404, wrong_invitee / forbidden → 403, already_responded / limit_reached → 409.',
    audience: {
      executive: 'Where new customers apply and where existing customers share an account with someone.',
      systems: 'One public POST (IP rate-limited) feeding the staff queue and the ops socket room, plus four session-authenticated invitation endpoints.',
    },
    tech: ['Fastify'],
    tags: ['onboarding', 'rbac', 'validation', 'public-demo'],
    aliases: ['onboarding routes', 'onboardingRoutes', 'invitation routes'],
    sources: [src(Q, 23, 43, 'Onboarding & joint-invitation endpoints', 'Header comment + plugin function'), src(Q, 164, 175, 'function handleInvitationError')],
  },

  endpoint(RO, 'GET', '/api/ops/summary', 'Counts for the console dashboard: users, accounts, pending requests, locked accounts and requests by status.', {
    tags: ['operations', 'rbac'],
    aliases: ['ops summary', 'dashboard counts'],
    sources: [src(P, 66, 88, "app.get('/api/ops/summary'")],
  }),
  endpoint(RO, 'GET', '/api/ops/requests', 'The operations queue (optionally filtered by status and type) plus whole-queue status counts.', {
    tags: ['operations', 'rbac'],
    aliases: ['request queue', 'list requests'],
    sources: [src(P, 92, 109, "app.get('/api/ops/requests'")],
  }),
  endpoint(RO, 'GET', '/api/ops/requests/:id', 'One request with its operator-action history and linked simulated events.', {
    tags: ['operations', 'rbac', 'audit'],
    aliases: ['request detail'],
    sources: [src(P, 111, 120, "app.get('/api/ops/requests/:id'")],
  }),
  endpoint(RO, 'POST', '/api/ops/requests/:id/action', 'Apply an operator action — approve, reject, hold, request_info or note — to a request.', {
    description:
      'The endpoint behind every decision button in the console. For money-movement, onboarding, dispute and fraud requests an approve or reject also performs the domain effect in the same transaction.',
    audience: {
      executive: 'The single door through which every staff decision enters the system.',
      'end-user': 'What happens when a bank employee clicks Approve or Reject on your request.',
    },
    tags: ['operations', 'rbac', 'audit', 'money', 'realtime'],
    aliases: ['approve', 'reject', 'hold', 'request info', 'operator action endpoint'],
    sources: [src(P, 122, 159, "app.post('/api/ops/requests/:id/action'")],
  }),
  endpoint(RO, 'POST', '/api/ops/simulate/event', 'Record a simulated external event (SMS, email, MFA or identity) and push it to operator consoles.', {
    tags: ['operations', 'integration', 'realtime'],
    aliases: ['simulate event'],
    sources: [src(P, 163, 186, "app.post('/api/ops/simulate/event'")],
  }),
  endpoint(RO, 'GET', '/api/ops/events', 'The recent simulated-event feed, newest first.', {
    tags: ['operations', 'integration'],
    aliases: ['event feed'],
    sources: [src(P, 188, 193, "app.get('/api/ops/events'")],
  }),
  endpoint(RO, 'POST', '/api/ops/movements/:requestId/reverse', 'Reverse an already-posted money movement, with a mandatory audited reason.', {
    description: 'A post-decision capability, separate from the four decisions: the request stays `approved`, its ledger entries become `reversed` and its payload gains `reversed: true`.',
    tags: ['operations', 'money', 'ledger', 'audit', 'realtime'],
    aliases: ['reverse movement', 'reversal'],
    sources: [src(P, 195, 225, "app.post('/api/ops/movements/:requestId/reverse'")],
  }),
  endpoint(RO, 'GET', '/api/admin/users', 'The full user roster for admins — no password hashes or tokens.', {
    tags: ['operations', 'rbac', 'security'],
    aliases: ['admin users', 'user roster'],
    sources: [src(P, 229, 255, "app.get('/api/admin/users'")],
  }),
  endpoint(RO, 'POST', '/api/admin/users', 'Admin creates a user, optionally opening and funding an account with an audited adjustment.', {
    tags: ['operations', 'rbac', 'security', 'audit', 'money'],
    aliases: ['create demo user'],
    sources: [src(P, 257, 288, "app.post('/api/admin/users'")],
  }),

  endpoint(RB, 'POST', '/api/onboarding/applications', 'Public: submit an account-opening application. Queues it for staff review; creates no user, account or money.', {
    audience: {
      executive: 'The front door for new customers: anyone can apply, nothing is opened until staff approve.',
      'end-user': 'Where the "Open an account" form sends your application.',
    },
    tags: ['onboarding', 'public-demo', 'validation', 'realtime'],
    aliases: ['open account', 'apply', 'application endpoint'],
    sources: [src(Q, 44, 85, "app.post('/api/onboarding/applications'")],
  }),
  endpoint(RB, 'POST', '/api/accounts/:id/invitations', 'An account owner invites another person, by email, to share the account.', {
    tags: ['onboarding', 'rbac'],
    aliases: ['invite joint owner'],
    sources: [src(Q, 87, 135, "app.post('/api/accounts/:id/invitations'")],
  }),
  endpoint(RB, 'GET', '/api/invitations', "The signed-in user's pending invitations (matched by email).", {
    tags: ['onboarding', 'rbac'],
    aliases: ['my invitations', 'invitation inbox'],
    sources: [src(Q, 137, 141, "app.get('/api/invitations'")],
  }),
  endpoint(RB, 'POST', '/api/invitations/:id/accept', 'Accept an invitation addressed to you; you gain access to the account.', {
    tags: ['onboarding', 'rbac'],
    aliases: ['accept invitation'],
    sources: [src(Q, 143, 151, "app.post('/api/invitations/:id/accept'")],
  }),
  endpoint(RB, 'POST', '/api/invitations/:id/decline', 'Decline an invitation addressed to you.', {
    tags: ['onboarding', 'rbac'],
    aliases: ['decline invitation'],
    sources: [src(Q, 153, 161, "app.post('/api/invitations/:id/decline'")],
  }),
];

const AUTH = 'be:auth/guards#requireAuth';
const ROLE = 'be:auth/guards#requireRole';
const LIMIT = 'be:abuse/rate-limit#rateLimit';
const SIMNOW = 'be:clock/clock#simulationNow';
const RT = 'be:ops/realtime#OpsRealtime';

const opsOnlySrc = src(P, 53, 54, 'const opsOnly');
const opsMutationSrc = src(P, 55, 56, 'const opsMutation');
const adminOnlySrc = src(P, 229, 229, 'const adminOnly');
const adminMutationSrc = src(P, 230, 230, 'const adminMutation');
const guardedSrc = src(Q, 88, 88, 'const guarded');

const staffRead = [EP.summary, EP.list, EP.detail, EP.events];
const staffWrite = [EP.action, EP.simulate, EP.reverse];

const relations: Relation[] = [
  // ---- Guards ----------------------------------------------------------------
  ...staffRead.flatMap((ep) => [
    rel(ep, AUTH, 'guards', 'preHandler: requireAuth', { sources: [opsOnlySrc] }),
    rel(ep, ROLE, 'guards', "requireRole('ops_agent', 'admin')", { summary: 'Customers and joint customers receive 403 `forbidden`.', sources: [opsOnlySrc] }),
  ]),
  ...staffWrite.flatMap((ep) => [
    rel(ep, AUTH, 'guards', 'preHandler: requireAuth', { sources: [opsMutationSrc] }),
    rel(ep, ROLE, 'guards', "requireRole('ops_agent', 'admin')", { summary: 'Customers and joint customers receive 403 `forbidden`.', sources: [opsMutationSrc] }),
    rel(ep, LIMIT, 'guards', "rateLimit('operations')", { summary: 'Public-demo mode only: 60 mutations per 5 minutes per operator.', sources: [opsMutationSrc] }),
  ]),
  rel(EP.adminList, AUTH, 'guards', 'preHandler: requireAuth', { sources: [adminOnlySrc] }),
  rel(EP.adminList, ROLE, 'guards', "requireRole('admin')", { summary: 'An ops_agent is refused with 403.', sources: [adminOnlySrc] }),
  rel(EP.adminCreate, AUTH, 'guards', 'preHandler: requireAuth', { sources: [adminMutationSrc] }),
  rel(EP.adminCreate, ROLE, 'guards', "requireRole('admin')", { summary: 'An ops_agent is refused with 403.', sources: [adminMutationSrc] }),
  rel(EP.adminCreate, LIMIT, 'guards', "rateLimit('adminUsers')", { summary: 'Public-demo mode only: 10 per 15 minutes per admin.', sources: [adminMutationSrc] }),
  rel(EP.apply, LIMIT, 'guards', "rateLimit('onboarding')", {
    summary: 'The only guard on the public application endpoint: 5 per 15 minutes per client IP, public-demo mode only.',
    sources: [src(Q, 45, 47, "rateLimit('onboarding')")],
  }),
  ...[EP.invite, EP.accept, EP.decline].flatMap((ep) => [
    rel(ep, AUTH, 'guards', 'preHandler: requireAuth', { sources: [guardedSrc] }),
    rel(ep, LIMIT, 'guards', "rateLimit('risk')", { summary: 'Public-demo mode only: 20 per 5 minutes per user.', sources: [guardedSrc] }),
  ]),
  rel(EP.invitations, AUTH, 'guards', 'preHandler: requireAuth', { sources: [src(Q, 138, 138, 'preHandler: requireAuth')] }),

  // ---- GET /api/ops/summary --------------------------------------------------
  rel(EP.summary, 'db:User', 'reads', 'count() and count({ lockedUntil > wall-clock now })', {
    summary: 'Lockout is compared against the real clock, not the simulated one.',
    sources: [src(P, 67, 77, 'prisma.user.count()')],
  }),
  rel(EP.summary, 'db:Account', 'reads', 'count()', { sources: [src(P, 72, 76, 'prisma.account.count()')] }),
  rel(EP.summary, 'db:OperationsRequest', 'reads', 'findMany({ select: { status } })', { sources: [src(P, 72, 76, 'prisma.operationsRequest.findMany')] }),
  rel(EP.summary, 'sh:operations#countRequestsByStatus', 'calls', 'countRequestsByStatus(requests)', { sources: [src(P, 78, 80, 'countRequestsByStatus')] }),

  // ---- GET /api/ops/requests -------------------------------------------------
  rel(EP.list, 'sh:types#OPS_REQUEST_STATUSES', 'validates', 'OPS_REQUEST_STATUSES.includes(status)', { summary: 'An unknown status filter is a 400.', sources: [src(P, 93, 96, 'OPS_REQUEST_STATUSES.includes')] }),
  rel(EP.list, 'sh:types#OPS_REQUEST_TYPES', 'validates', 'OPS_REQUEST_TYPES.includes(type)', { summary: 'An unknown type filter is a 400.', sources: [src(P, 97, 99, 'OPS_REQUEST_TYPES.includes')] }),
  rel(EP.list, 'be:ops/requests#listOperationsRequests', 'calls', 'listOperationsRequests(prisma, query)', { order: 1, sources: [src(P, 104, 104, 'listOperationsRequests(prisma, query)')] }),
  rel(EP.list, 'db:OperationsRequest', 'reads', 'findMany({ select: { status } }) for whole-queue counts', {
    order: 2,
    summary: 'Counts ignore the filter so the header chips stay stable.',
    sources: [src(P, 105, 107, 'prisma.operationsRequest.findMany')],
  }),
  rel(EP.list, 'sh:operations#countRequestsByStatus', 'calls', 'countRequestsByStatus(all)', { order: 3, sources: [src(P, 107, 107, 'countRequestsByStatus')] }),
  rel(EP.list, 'sh:operations#OperationsQueueResponse', 'uses-type', 'responds { requests, counts }', { sources: [src(P, 108, 108, 'reply.send({ requests, counts })')] }),

  // ---- GET /api/ops/requests/:id ---------------------------------------------
  rel(EP.detail, 'be:ops/requests#getOperationsRequestDetail', 'calls', 'getOperationsRequestDetail(prisma, id)', { sources: [src(P, 112, 114, 'getOperationsRequestDetail(prisma, id)')] }),
  rel(EP.detail, 'sh:operations#OperationsRequestDetailResponse', 'uses-type', 'responds { request }', { sources: [src(P, 119, 119, 'reply.send({ request })')] }),

  // ---- POST /api/ops/requests/:id/action -------------------------------------
  rel(EP.action, 'sh:operations#isOpsAction', 'validates', 'isOpsAction(body.action)', { order: 1, summary: 'Anything but approve / reject / hold / request_info / note is a 400.', sources: [src(P, 124, 130, 'isOpsAction(body.action)')] }),
  rel(EP.action, 'sh:operations#OperatorActionRequest', 'uses-type', 'body: { action, note? }', { sources: [src(P, 124, 124, 'action?: unknown; note?: unknown')] }),
  rel(EP.action, SIMNOW, 'calls', 'await simulationNow(prisma)', {
    order: 2,
    summary: 'The simulated instant is passed as `now`, so a posted ledger entry is dated by the simulation clock, not the wall clock.',
    sources: [src(P, 142, 145, 'simulationNow(prisma)')],
  }),
  rel(EP.action, 'be:ops/requests#applyOperatorAction', 'calls', 'applyOperatorAction(prisma, { id, action, note, actor: req.user }, now)', { order: 3, sources: [src(P, 138, 146, 'applyOperatorAction')] }),
  rel(EP.action, RT, 'calls', "app.opsRealtime.requestChanged('updated', request)", { order: 4, summary: 'Publishes through the injected realtime capability (a no-op in tests).', sources: [src(P, 147, 150, "app.opsRealtime.requestChanged('updated', request)")] }),
  rel(EP.action, 'ev:ops:request_changed', 'emits', "requestChanged('updated', request)", {
    order: 4,
    summary: 'Every open operator console receives the updated queue item.',
    data: ['sh:operations#OpsRequestChangedPayload'],
    sources: [src(P, 148, 148, "requestChanged('updated', request)")],
  }),
  rel(EP.action, 'ev:ops:external_event', 'emits', 'externalEvent(event) for each generated event', {
    order: 5,
    summary: 'The single `event` and every entry of `events` returned by the service are pushed to the feed.',
    data: ['sh:operations#OpsExternalEventPayload'],
    sources: [src(P, 149, 150, 'app.opsRealtime.externalEvent(extra)')],
  }),
  rel(EP.action, 'be:ops/requests#OpsActionError', 'uses-type', 'err.code → 404 / 409 / 400', { sources: [src(P, 152, 156, 'err instanceof OpsActionError')] }),
  rel(EP.action, 'feat:ops-review', 'implements', 'approve / reject / hold / request info'),
  rel(EP.action, 'feat:realtime', 'implements', 'pushes the change to consoles'),

  // ---- POST /api/ops/simulate/event ------------------------------------------
  rel(EP.simulate, 'sh:operations#isSimEventChannel', 'validates', 'isSimEventChannel(body.channel)', { order: 1, sources: [src(P, 164, 167, 'isSimEventChannel(body.channel)')] }),
  rel(EP.simulate, 'sh:operations#SIM_EVENT_STATUSES', 'validates', 'SIM_EVENT_STATUSES.includes(body.outcome)', { order: 2, sources: [src(P, 168, 170, 'SIM_EVENT_STATUSES.includes')] }),
  rel(EP.simulate, 'sh:operations#SIM_EVENT_DIRECTIONS', 'validates', 'SIM_EVENT_DIRECTIONS.includes(body.direction)', { order: 3, sources: [src(P, 171, 173, 'SIM_EVENT_DIRECTIONS.includes')] }),
  rel(EP.simulate, 'sh:operations#SimulateEventRequest', 'uses-type', 'input: SimulateEventRequest', { sources: [src(P, 175, 182, 'SimulateEventRequest')] }),
  rel(EP.simulate, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 4, sources: [src(P, 183, 183, 'simulationNow(prisma)')] }),
  rel(EP.simulate, 'be:ops/requests#createSimulatedEvent', 'calls', 'createSimulatedEvent(prisma, input, req.user, now)', { order: 5, sources: [src(P, 183, 183, 'createSimulatedEvent')] }),
  rel(EP.simulate, 'ev:ops:external_event', 'emits', 'app.opsRealtime.externalEvent(event)', { order: 6, data: ['sh:operations#OpsExternalEventPayload'], sources: [src(P, 184, 184, 'app.opsRealtime.externalEvent(event)')] }),
  rel(EP.simulate, 'feat:sim-messaging', 'implements', 'simulate an external event'),

  // ---- GET /api/ops/events ---------------------------------------------------
  rel(EP.events, 'be:ops/requests#listSimulatedEvents', 'calls', 'listSimulatedEvents(prisma, limit)', { sources: [src(P, 189, 192, 'listSimulatedEvents')] }),
  rel(EP.events, 'sh:operations#SimulatedEventsResponse', 'uses-type', 'responds { events }', { sources: [src(P, 192, 192, 'reply.send({ events })')] }),

  // ---- POST /api/ops/movements/:requestId/reverse ----------------------------
  rel(EP.reverse, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 1, sources: [src(P, 209, 214, 'simulationNow(prisma)')] }),
  rel(EP.reverse, 'be:money/movements#reverseMovement', 'calls', 'reverseMovement(requestId, req.user, reason, now)', {
    order: 2,
    summary: 'Flips the posted ledger entries to reversed, marks the payload reversed, audits with the reason.',
    sources: [src(P, 208, 214, 'reverseMovement(')],
  }),
  rel(EP.reverse, 'ev:ops:request_changed', 'emits', "requestChanged('updated', request)", { order: 3, data: ['sh:operations#OpsRequestChangedPayload'], sources: [src(P, 215, 215, "app.opsRealtime.requestChanged('updated', request)")] }),
  rel(EP.reverse, 'ev:ops:external_event', 'emits', 'externalEvent(event) for the reversal notice', { order: 4, data: ['sh:operations#OpsExternalEventPayload'], sources: [src(P, 216, 216, 'app.opsRealtime.externalEvent(event)')] }),

  // ---- Admin -----------------------------------------------------------------
  rel(EP.adminList, 'db:User', 'reads', 'findMany({ orderBy: createdAt asc, select: 9 safe columns })', {
    summary: 'The select list names the columns explicitly, so `passwordHash` can never leak.',
    sources: [src(P, 232, 246, 'prisma.user.findMany')],
  }),
  rel(EP.adminList, 'feat:admin-users', 'implements', 'list users'),
  rel(EP.adminCreate, 'sh:onboarding#validateAdminCreateUser', 'validates', 'validateAdminCreateUser({ … })', { order: 1, sources: [src(P, 261, 278, 'validateAdminCreateUser')] }),
  rel(EP.adminCreate, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 2, sources: [src(P, 280, 280, 'simulationNow(prisma)')] }),
  rel(EP.adminCreate, 'be:ops/admin-users#adminCreateUser', 'calls', 'adminCreateUser(check.value, req.user, now)', { order: 3, sources: [src(P, 279, 281, 'adminCreateUser(check.value')] }),
  rel(EP.adminCreate, 'be:ops/admin-users#AdminUserError', 'uses-type', 'err.code conflict → 409', { sources: [src(P, 282, 285, 'err instanceof AdminUserError')] }),

  // ---- POST /api/onboarding/applications -------------------------------------
  rel(EP.apply, 'sh:onboarding#validateOpenAccount', 'validates', 'validateOpenAccount({ … })', {
    order: 1,
    summary: 'The same validator the customer form already ran; the server never trusts the client copy.',
    sources: [src(Q, 48, 62, 'validateOpenAccount')],
  }),
  rel(EP.apply, 'sh:onboarding#OpenAccountRequest', 'uses-type', 'body: OpenAccountRequest', { sources: [src(Q, 49, 59, 'jointInviteEmail')] }),
  rel(EP.apply, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 2, sources: [src(Q, 66, 66, 'simulationNow(prisma)')] }),
  rel(EP.apply, 'be:ops/onboarding#submitApplication', 'calls', 'submitApplication(result.value, now)', { order: 3, sources: [src(Q, 64, 72, 'submitApplication(result.value')] }),
  rel(EP.apply, 'be:ops/onboarding#ApplicationLimitError', 'uses-type', 'limit_reached → 409', { sources: [src(Q, 67, 71, 'err instanceof ApplicationLimitError')] }),
  rel(EP.apply, 'ev:ops:request_changed', 'emits', "requestChanged('created', submitted.request)", {
    order: 4,
    summary: 'The new application appears in every open operator console without a refresh.',
    data: ['sh:operations#OpsRequestChangedPayload'],
    sources: [src(Q, 73, 74, "app.opsRealtime.requestChanged('created', submitted.request)")],
  }),
  rel(EP.apply, 'ev:ops:external_event', 'emits', 'externalEvent(event) × 3 intake events', { order: 5, data: ['sh:operations#OpsExternalEventPayload'], sources: [src(Q, 75, 75, 'app.opsRealtime.externalEvent(event)')] }),
  rel(EP.apply, 'sh:onboarding#OpenAccountResponse', 'uses-type', 'responds OpenAccountResponse (201)', { sources: [src(Q, 77, 84, 'OpenAccountResponse')] }),
  rel(EP.apply, 'feat:onboarding', 'implements', 'submit an application'),

  // ---- Invitations -----------------------------------------------------------
  rel(EP.invite, 'db:Account', 'reads', 'findUnique({ id }, select id + name)', { order: 1, sources: [src(Q, 94, 94, 'prisma.account.findUnique')] }),
  rel(EP.invite, 'be:auth/access#getAccountRelationship', 'calls', 'getAccountRelationship(prisma, user.id, id)', {
    order: 2,
    summary: "Only the `owner` relationship may invite; a joint owner gets 403.",
    sources: [src(Q, 95, 105, 'getAccountRelationship')],
  }),
  rel(EP.invite, 'sh:onboarding#validateInvitation', 'validates', 'validateInvitation({ inviteeEmail, relationship }, user.email)', { order: 3, sources: [src(Q, 107, 117, 'validateInvitation')] }),
  rel(EP.invite, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 4, sources: [src(Q, 128, 128, 'simulationNow(prisma)')] }),
  rel(EP.invite, 'be:ops/invitations#inviteJoint', 'calls', 'inviteJoint({ accountId, accountName, inviter, inviteeEmail, relationship }, now)', { order: 5, sources: [src(Q, 119, 129, 'inviteJoint(')] }),
  rel(EP.invite, 'ev:ops:external_event', 'emits', 'app.opsRealtime.externalEvent(event)', {
    order: 6,
    summary: 'The simulated "invitation sent" email shows up in the operators\' event feed.',
    data: ['sh:operations#OpsExternalEventPayload'],
    sources: [src(Q, 130, 130, 'app.opsRealtime.externalEvent(event)')],
  }),
  rel(EP.invite, 'feat:invitations', 'implements', 'invite a joint owner'),
  rel(EP.invitations, 'be:ops/invitations#listInvitationsForUser', 'calls', 'listInvitationsForUser(req.user)', { sources: [src(Q, 138, 141, 'listInvitationsForUser')] }),
  rel(EP.accept, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 1, sources: [src(Q, 146, 146, 'simulationNow(prisma)')] }),
  rel(EP.accept, 'be:ops/invitations#acceptInvitation', 'calls', 'acceptInvitation(id, req.user, now)', { order: 2, sources: [src(Q, 143, 150, 'acceptInvitation(id')] }),
  rel(EP.accept, 'be:ops/invitations#InvitationError', 'uses-type', 'handleInvitationError → 404 / 403 / 409', { sources: [src(Q, 164, 175, 'err instanceof InvitationError')] }),
  rel(EP.accept, 'feat:invitations', 'implements', 'accept an invitation'),
  rel(EP.decline, SIMNOW, 'calls', 'await simulationNow(prisma)', { order: 1, sources: [src(Q, 156, 156, 'simulationNow(prisma)')] }),
  rel(EP.decline, 'be:ops/invitations#declineInvitation', 'calls', 'declineInvitation(id, req.user, now)', { order: 2, sources: [src(Q, 153, 160, 'declineInvitation(id')] }),
  rel(EP.decline, 'be:ops/invitations#InvitationError', 'uses-type', 'handleInvitationError → 404 / 403 / 409', { sources: [src(Q, 164, 175, 'err instanceof InvitationError')] }),
];

export const routeEntities: Entity[] = entities;
export const routeRelations: Relation[] = relations;
