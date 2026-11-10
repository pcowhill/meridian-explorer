import type { Scenario, ScenarioStep, StateEffect } from '../../types';
import { IDS, NOW, baseState } from '../fixtures';
import { FILES, src } from '../operations/helpers';

/**
 * "How does a new customer get an account?"
 *
 * A member of the public applies; nothing exists until an operator approves.
 */

// ---- Lanes ------------------------------------------------------------------
const PAT = 'role:customer';
const FORM = 'cu:pages/OpenAccount';
const R_ONB = 'be:routes/onboarding';
const SAM = 'role:ops_agent';
const CONSOLE = 'op:pages/RequestQueues';
const R_OPS = 'be:routes/ops';
const APPLY = 'be:ops/requests#applyOperatorAction';
const SVC = 'be:ops/onboarding';
const DB = 'db';

// ---- Example values ---------------------------------------------------------
const REQ = 'req_onb';
const APP = 'app_001';
const REFERENCE = 'MER-7C41D9';
const EMAIL = 'pat.applicant@example.com';
const JOINT_EMAIL = 'jordan.joint@example.com';
const USER = 'usr_pat';
const ACCOUNT = 'acc_pat_checking';
const FUNDING = 25000;
/** Wall-clock instants (AuditLog.createdAt, Session.lastSeenAt). Everything else is dated by the simulation clock. */
const WALL_SUBMIT = '2026-10-01T15:06:30.000Z';
const WALL_DECIDE = '2026-10-01T15:09:45.000Z';
const HASH = '<bcrypt hash of the chosen password>';

const OK = ['approved', 'rejected', 'with-joint-invite'];
const APPROVE = ['approved', 'with-joint-invite'];

const formBody = (joint: boolean) => ({
  fullName: 'Pat Applicant',
  email: EMAIL,
  password: '<chosen password, 8–200 chars>',
  product: 'checking',
  initialFundingMinor: FUNDING,
  jointInviteEmail: joint ? JOINT_EMAIL : null,
  consent: true,
});

const requestPayload = (joint: boolean) => ({ reference: REFERENCE, product: 'checking', initialFundingMinor: FUNDING, jointInviteEmail: joint ? JOINT_EMAIL : null });

const requestRow = (joint: boolean) => ({
  id: REQ,
  type: 'onboarding',
  status: 'pending',
  priority: 'normal',
  summary: 'New account application — Everyday Checking',
  detail: 'A prospective customer applied to open a Everyday Checking account (simulated). Approving this request provisions the account and posts any opening deposit.',
  subjectName: 'Pat Applicant',
  subjectEmail: EMAIL,
  payload: JSON.stringify(requestPayload(joint)),
  lastAction: null,
  lastActorId: null,
  lastActorRole: null,
  lastActorName: null,
  lastActionNote: null,
  resolvedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const requestDto = (joint: boolean, patch: Record<string, unknown> = {}) => ({
  id: REQ,
  type: 'onboarding',
  status: 'pending',
  priority: 'normal',
  summary: 'New account application — Everyday Checking',
  detail: 'A prospective customer applied to open a Everyday Checking account (simulated). Approving this request provisions the account and posts any opening deposit.',
  subjectName: 'Pat Applicant',
  subjectEmail: EMAIL,
  payload: requestPayload(joint),
  lastAction: null,
  lastActorName: null,
  lastActionNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
  ...patch,
});

const applicationRow = (joint: boolean) => ({
  id: APP,
  reference: REFERENCE,
  status: 'submitted',
  fullName: 'Pat Applicant',
  email: EMAIL,
  product: 'checking',
  initialFundingMinor: FUNDING,
  jointInviteEmail: joint ? JOINT_EMAIL : null,
  consentAt: NOW,
  passwordHash: HASH,
  requestId: REQ,
  provisionedUserId: null,
  provisionedAccountId: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const simEvent = (id: string, channel: string, kind: string, status: string, summary: string, detail = 'SIMULATION — no real message was sent to any provider.') => ({
  id,
  channel,
  direction: 'outbound',
  kind,
  status,
  summary,
  detail,
  requestId: REQ,
  metadata: null,
  createdAt: NOW,
});

const INTAKE_EVENTS = [
  simEvent('evt_101', 'email', 'application_received', 'sent', 'Application received — under review (simulated)', `Simulated email confirming application ${REFERENCE} was received.`),
  simEvent('evt_102', 'identity', 'verification', 'pending', 'Identity verification requested (simulated)', 'Simulated identity-verification step for a new account application.'),
  simEvent('evt_103', 'mfa', 'enrollment', 'pending', 'MFA enrollment offered (simulated)', 'Simulated multi-factor enrollment offered to the new applicant.'),
];
const OPENED_EVENT = simEvent('evt_104', 'identity', 'verification', 'approved', 'Identity verified — Everyday Checking opened (simulated)', `Simulated: application ${REFERENCE} approved; account opened and funded.`);
const INVITE_EVENT = simEvent('evt_105', 'email', 'invitation', 'sent', `Joint-owner invitation sent to ${JOINT_EMAIL} (simulated)`);
const DECLINED_EVENT = simEvent('evt_104', 'email', 'notification', 'sent', `Application ${REFERENCE} declined (simulated)`);

const REJECT_NOTE = 'Identity details could not be verified';

const decisionSet = (status: 'approved' | 'rejected') => ({
  status,
  lastAction: status === 'approved' ? 'approve' : 'reject',
  lastActorId: IDS.sam,
  lastActorRole: 'ops_agent',
  lastActorName: 'Sam Operator',
  lastActionNote: status === 'approved' ? null : REJECT_NOTE,
  resolvedAt: NOW,
  updatedAt: NOW,
});
const decisionAudit = (status: 'approved' | 'rejected') => ({
  id: 'aud_102',
  actorId: IDS.sam,
  actorRole: 'ops_agent',
  action: status === 'approved' ? 'ops_approve' : 'ops_reject',
  entity: 'operations_request',
  entityId: REQ,
  reason: status === 'approved' ? null : REJECT_NOTE,
  metadata: JSON.stringify({ action: status === 'approved' ? 'approve' : 'reject', actorName: 'Sam Operator', fromStatus: 'pending', toStatus: status }),
  createdAt: WALL_DECIDE,
});
const approvedDto = (joint: boolean) => requestDto(joint, { status: 'approved', lastAction: 'approve', lastActorName: 'Sam Operator', resolvedAt: NOW });
const rejectedDto = requestDto(false, { status: 'rejected', lastAction: 'reject', lastActorName: 'Sam Operator', lastActionNote: REJECT_NOTE, resolvedAt: NOW });

const USER_ROW = { id: USER, email: EMAIL, displayName: 'Pat Applicant', role: 'customer', status: 'active', passwordHash: HASH, passwordUpdatedAt: NOW };
const ACCOUNT_ROW = { id: ACCOUNT, userId: USER, type: 'checking', name: 'Everyday Checking', currency: 'USD', status: 'active', openedAt: NOW };
const ACCESS_ROW = { id: 'acs_4', userId: USER, accountId: ACCOUNT, relationship: 'owner' };
const FUNDING_ENTRY = { id: 'le_101', accountId: ACCOUNT, amountMinor: FUNDING, direction: 'credit', status: 'posted', origin: 'deposit', description: 'Opening deposit (simulated)', reason: null, postedAt: NOW, createdAt: NOW };
const FUNDING_AUDIT = {
  id: 'aud_103',
  actorId: IDS.sam,
  actorRole: 'ops_agent',
  action: 'onboarding_initial_funding',
  entity: 'ledger_entry',
  entityId: ACCOUNT,
  reason: `Initial funding for ${REFERENCE} (simulated bank-originated deposit)`,
  metadata: JSON.stringify({ amountMinor: FUNDING, origin: 'deposit', accountId: ACCOUNT }),
  createdAt: WALL_DECIDE,
};
const INVITATION_ROW = {
  id: 'inv_101',
  token: '<random 48-character hex token>',
  accountId: ACCOUNT,
  invitedById: USER,
  inviteeEmail: JOINT_EMAIL,
  relationship: 'joint',
  status: 'pending',
  acceptedById: null,
  respondedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const PROVISIONED_AUDIT = {
  id: 'aud_104',
  actorId: IDS.sam,
  actorRole: 'ops_agent',
  action: 'onboarding_provisioned',
  entity: 'onboarding_application',
  entityId: APP,
  reason: `Provisioned Everyday Checking for ${EMAIL} (simulated)`,
  metadata: JSON.stringify({ userId: USER, accountId: ACCOUNT, reference: REFERENCE }),
  createdAt: WALL_DECIDE,
};

// ---- Step builders for the parts that differ only by joint-invite ---------------

function submitRequestStep(variants: string[], joint: boolean): ScenarioStep {
  return {
    id: joint ? 'submit-request-joint' : 'submit-request',
    kind: 'request',
    title: 'Submit the application',
    from: FORM,
    to: R_ONB,
    label: 'POST /api/onboarding/applications',
    narrative:
      'The form calls the client helper `submitApplication` with the NORMALIZED value plus `consent: true`. It is a plain `fetch` with no credentials: the visitor has no session, and the endpoint is public. The password travels once, over HTTPS in production, and is never stored in plain text.',
    audience: {
      executive: 'The application is sent to the bank.',
      systems: 'Unauthenticated JSON POST. No cookie is required; the path is exempt from the CSRF check.',
    },
    detail: 2,
    variants,
    payload: {
      title: 'Open-account application',
      format: 'http-request',
      line: 'POST /api/onboarding/applications',
      headers: { 'Content-Type': 'application/json' },
      data: formBody(joint),
      typeRef: 'sh:onboarding#OpenAccountRequest',
      highlight: joint ? ['initialFundingMinor', 'jointInviteEmail'] : ['product', 'initialFundingMinor'],
    },
    sources: [src(FILES.openAccount, 183, 196, 'submitApplication({ ...result.value, consent: true })'), src(FILES.cuOnboarding, 54, 62, 'export async function submitApplication')],
  };
}

function queueInsertStep(variants: string[], joint: boolean): ScenarioStep {
  return {
    id: joint ? 'insert-request-joint' : 'insert-request',
    kind: 'db-write',
    title: 'Queue the application for staff',
    from: SVC,
    to: DB,
    label: "INSERT OperationsRequest (type 'onboarding', status 'pending')",
    narrative:
      'The application enters the same operations queue as payments and disputes: one OperationsRequest of type `onboarding`, status `pending`, priority `normal`. The applicant is recorded as the display-only subject (name and email — there is no User to point at yet) and the JSON payload carries what an operator needs to decide: the reference, the product, the opening deposit and any joint invitee.',
    audience: {
      executive: 'The application joins the staff work queue.',
      dba: 'INSERT OperationsRequest. subjectName / subjectEmail are plain strings, deliberately not a foreign key. `payload` is JSON text.',
    },
    detail: 1,
    variants,
    payload: { title: 'OperationsRequest row', format: 'row', data: requestRow(joint), highlight: ['type', 'status', 'payload'] },
    effects: [{ op: 'insert', table: 'OperationsRequest', row: requestRow(joint) }],
    sources: [src(FILES.onboarding, 131, 149, 'prisma.operationsRequest.create')],
  };
}

function applicationInsertStep(variants: string[], joint: boolean): ScenarioStep {
  return {
    id: joint ? 'insert-application-joint' : 'insert-application',
    kind: 'db-write',
    title: 'Store the application',
    from: SVC,
    to: DB,
    label: "INSERT OnboardingApplication (status 'submitted')",
    narrative:
      'The application row keeps what provisioning will need later: name, email, product, opening deposit, the consent timestamp and the bcrypt hash. It is linked one-to-one to the queue item through the unique `requestId`. No User, Account or LedgerEntry exists at this point.',
    audience: {
      executive: 'The application is on file. No account and no money exist yet.',
      dba: 'INSERT OnboardingApplication with requestId (unique) → OperationsRequest.id. passwordHash is the only password material stored anywhere.',
    },
    detail: 3,
    variants,
    payload: { title: 'OnboardingApplication row', format: 'row', data: applicationRow(joint), highlight: ['status', 'requestId', 'passwordHash'] },
    effects: [{ op: 'insert', table: 'OnboardingApplication', row: applicationRow(joint) }],
    sources: [src(FILES.onboarding, 151, 166, 'prisma.onboardingApplication.create'), src(FILES.schema, 248, 250, '@unique')],
  };
}

function createdEventStep(variants: string[], joint: boolean): ScenarioStep {
  return {
    id: joint ? 'emit-created-joint' : 'emit-created',
    kind: 'event',
    title: 'The application appears in every operator console',
    from: R_ONB,
    to: CONSOLE,
    label: 'ops:request_changed (created)',
    narrative:
      'Back in the route, `app.opsRealtime.requestChanged("created", request)` broadcasts the new queue item to the Socket.IO `ops` room, followed by one `ops:external_event` per simulated event. Each console\'s data context inserts the request at the top of its in-memory queue, so it shows up under "Onboarding & identity" without a refresh. The applicant\'s browser is not in that room and receives nothing.',
    audience: {
      executive: 'Staff see the new application appear on their screens immediately.',
      'end-user': 'Bank staff are notified straight away.',
      systems: 'Socket.IO broadcast to room `ops` only. Sockets from the customer origin are never joined to it.',
    },
    detail: 2,
    variants,
    payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed → room "ops"', data: { change: 'created', request: requestDto(joint) }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['change', 'request.type', 'request.payload'] },
    sources: [src(FILES.routesOnboarding, 73, 75, "app.opsRealtime.requestChanged('created', submitted.request)"), src(FILES.opsData, 41, 49, 'return [request, ...prev]'), src(FILES.onboardingTest, 103, 105, "c.change === 'created'")],
  };
}

function approveRequestSteps(variants: string[], joint: boolean): ScenarioStep[] {
  const suffix = joint ? '-joint' : '';
  return [
    {
      id: `update-request-approved${suffix}`,
      kind: 'db-write',
      title: 'Request → approved',
      from: APPLY,
      to: DB,
      label: "UPDATE OperationsRequest SET status = 'approved'",
      narrative:
        '`prisma.$transaction` opens. The request is marked approved with Sam as the last actor and `resolvedAt` set, and an `ops_approve` audit row is written. Everything from here to the commit succeeds or fails as one unit — if provisioning threw, the request would stay pending.',
      audience: { dba: 'First two statements of the transaction: UPDATE OperationsRequest; INSERT AuditLog (ops_approve).' },
      detail: 3,
      variants,
      payload: { title: 'OperationsRequest update', format: 'row', data: decisionSet('approved'), highlight: ['status', 'resolvedAt'] },
      effects: [
        { op: 'update', table: 'OperationsRequest', id: REQ, set: decisionSet('approved') },
        { op: 'insert', table: 'AuditLog', row: decisionAudit('approved') },
      ],
      sources: [src(FILES.requests, 297, 302, 'tx.operationsRequest.update'), src(FILES.requests, 281, 290, 'const decisionData')],
    },
    {
      id: `provision-call${suffix}`,
      kind: 'call',
      title: 'Provision the customer',
      from: APPLY,
      to: SVC,
      label: 'provisionApprovedOnboarding(tx, requestId, actor, now)',
      narrative:
        'The workflow service calls the onboarding service with the transaction client. It re-reads the application by `requestId` inside the transaction and continues only if it is still `submitted`.',
      detail: 3,
      variants,
      sources: [src(FILES.requests, 297, 302, 'provisionApprovedOnboarding(tx, input.id, input.actor, now)'), src(FILES.onboarding, 271, 281, 'export async function provisionApprovedOnboarding')],
    },
  ];
}

function approvedPushSteps(variants: string[], joint: boolean): ScenarioStep[] {
  const suffix = joint ? '-joint' : '';
  return [
    {
      id: `emit-approved${suffix}`,
      kind: 'event',
      title: 'Consoles see the approval',
      from: R_OPS,
      to: CONSOLE,
      label: 'ops:request_changed (updated)',
      narrative:
        'The transaction has committed. The route broadcasts the updated request to the `ops` room and then each simulated event returned by provisioning — "Identity verified — Everyday Checking opened"' +
        (joint ? ' and the joint-owner invitation email' : '') +
        '. The `provisioned` ids in the service result are not sent to the client.',
      audience: { executive: 'All staff screens show the application as approved.' },
      detail: 2,
      variants,
      payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed → room "ops"', data: { change: 'updated', request: approvedDto(joint) }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['request.status'] },
      sources: [src(FILES.routesOps, 147, 150, "app.opsRealtime.requestChanged('updated', request)"), src(FILES.requests, 303, 314, 'events: result.provision?.events ?? []')],
    },
    {
      id: `response-approved${suffix}`,
      kind: 'response',
      title: '200 with the approved request',
      from: R_OPS,
      to: CONSOLE,
      label: '200 { request }',
      narrative: 'Sam\'s console receives the updated request. The detail panel shows Approved, disables the decision buttons and offers only "Add note".',
      detail: 3,
      variants,
      payload: { title: 'Operator action response', format: 'http-response', line: '200 OK', data: { request: approvedDto(joint) }, typeRef: 'sh:operations#OperatorActionResponse', highlight: ['request.status'] },
      sources: [src(FILES.routesOps, 151, 151, 'reply.send({ request })'), src(FILES.e2eOnboarding, 86, 91, 'Resolved — you can still add an audit note')],
    },
  ];
}

const provisionEffectsCore: StateEffect[] = [
  { op: 'update', table: 'OnboardingApplication', id: APP, set: { status: 'provisioned', provisionedUserId: USER, provisionedAccountId: ACCOUNT, updatedAt: NOW } },
  { op: 'insert', table: 'AuditLog', row: PROVISIONED_AUDIT },
];

// ---- Steps ---------------------------------------------------------------------

const steps: ScenarioStep[] = [
  // ===== 1. The public application ===============================================
  {
    id: 'fill-form',
    kind: 'ui',
    title: 'A visitor fills in the open-account form',
    from: PAT,
    to: FORM,
    label: 'fill in "Open a simulated account"',
    narrative:
      'Pat Applicant is not a customer yet and has no session. On the public `/open-account` page Pat enters a name, an email, a password to use later, picks Everyday Checking, enters an opening deposit of $250.00 and ticks the consent box.',
    audience: {
      executive: 'A prospective customer applies for a checking account online, with a $250 opening deposit.',
      'end-user': 'Pat fills in the application form on the bank\'s website.',
    },
    detail: 1,
    variants: OK,
    sources: [src(FILES.openAccount, 198, 201, 'onSubmit={handleSubmit}'), src('apps/customer/src/App.tsx', 58, 58, '/open-account')],
  },
  {
    id: 'fill-form-joint',
    kind: 'ui',
    title: 'Pat also names a joint owner',
    from: PAT,
    to: FORM,
    label: 'joint owner: jordan.joint@example.com',
    narrative: 'In the optional "joint owner" field Pat enters Jordan Joint\'s email. It is only a request at this stage: an invitation will be created if and when the application is approved.',
    audience: { executive: 'The applicant asks for the account to be shared with a second person.' },
    detail: 2,
    variants: ['with-joint-invite'],
    sources: [src(FILES.shOnboarding, 163, 174, 'jointInviteEmail')],
  },
  {
    id: 'fill-form-invalid',
    kind: 'ui',
    title: 'A visitor submits an incomplete form',
    from: PAT,
    to: FORM,
    label: 'submit with a short password, no consent',
    narrative: 'Pat types a 5-character password, mistypes the email as "pat.applicant@example" and forgets the consent box, then presses submit.',
    audience: { executive: 'An applicant submits a form with mistakes.' },
    detail: 1,
    variants: ['invalid-application'],
    sources: [src(FILES.openAccount, 158, 161, 'async function handleSubmit')],
  },
  {
    id: 'client-validate',
    kind: 'decision',
    title: 'The form validates before sending',
    from: FORM,
    to: FORM,
    label: 'validateOpenAccount(form)',
    narrative:
      '`handleSubmit` converts the dollar amount to integer cents (250 → 25000) and runs the shared `validateOpenAccount`. It trims the name, lower-cases the email and checks every rule: name ≤ 80 characters, a plausible email, password 8–200 characters, product checking or savings, opening deposit a whole number of cents between $0 and $25,000, consent ticked, and any joint owner email valid and different from the applicant\'s.',
    audience: {
      executive: 'The form checks the application before sending it.',
      systems: 'The validator is shared source code: the browser and the server run the same function.',
    },
    detail: 3,
    decision: {
      question: 'Does the application pass validation?',
      options: [
        { label: 'Yes', variant: 'approved', description: 'The normalized application is submitted.' },
        { label: 'No — field errors', variant: 'invalid-application', description: 'Errors are shown next to the fields; nothing is sent.' },
      ],
    },
    sources: [src(FILES.openAccount, 163, 181, 'validateOpenAccount'), src(FILES.shOnboarding, 127, 191, 'export function validateOpenAccount')],
  },
  {
    id: 'invalid-client-errors',
    kind: 'ui',
    title: 'Field errors, nothing sent',
    from: FORM,
    to: PAT,
    label: 'show field errors',
    narrative: 'The validator returns `ok: false` with one message per failing field. The form shows them next to the inputs and returns before any network call.',
    audience: { 'end-user': 'Pat sees which fields to fix.' },
    detail: 1,
    variants: ['invalid-application'],
    payload: {
      title: 'Validation result',
      format: 'return',
      data: { ok: false, errors: { email: 'Enter a valid email address.', password: 'Choose a password of at least 8 characters.', consent: 'Please accept the simulated terms to continue.' } },
      typeRef: 'sh:onboarding#ValidationResult',
    },
    sources: [src(FILES.openAccount, 178, 181, 'setErrors(result.errors)'), src(FILES.shOnboarding, 142, 161, 'Please accept the simulated terms to continue.')],
  },
  {
    id: 'invalid-direct-post',
    kind: 'request',
    title: 'The same data sent straight to the API',
    from: PAT,
    to: R_ONB,
    label: 'POST /api/onboarding/applications',
    narrative:
      'The browser check is a convenience, not a control: the endpoint is public, so anyone can post to it without the form. Suppose the same invalid data is sent directly.',
    audience: { executive: 'What if someone skips the form and talks to the server directly?' },
    detail: 2,
    variants: ['invalid-application'],
    payload: {
      title: 'Invalid application',
      format: 'http-request',
      line: 'POST /api/onboarding/applications',
      headers: { 'Content-Type': 'application/json' },
      data: { fullName: 'Pat Applicant', email: 'pat.applicant@example', password: '<5 characters>', product: 'checking', initialFundingMinor: FUNDING, consent: false },
      typeRef: 'sh:onboarding#OpenAccountRequest',
      highlight: ['email', 'password', 'consent'],
    },
    sources: [src(FILES.onboardingTest, 108, 121, 'rejects an invalid application with 400 + field errors')],
  },
  submitRequestStep(['approved', 'rejected'], false),
  submitRequestStep(['with-joint-invite'], true),
  {
    id: 'public-guards',
    kind: 'guard',
    title: 'Public endpoint: no session, but rate-limited',
    from: R_ONB,
    to: R_ONB,
    label: "csrfHook (exempt) · rateLimit('onboarding')",
    narrative:
      'The global CSRF hook lets this path through — it is on the exempt list because there is no session to forge. The only preHandler is `rateLimit("onboarding")`: in public-demo mode each client IP gets 5 applications per 15 minutes (each one costs a bcrypt hash and several rows); in local development it does nothing. There is no `requireAuth`.',
    audience: {
      executive: 'Anyone may apply, but the server limits how fast one visitor can submit applications.',
      systems: 'Unauthenticated mutation protected by an in-memory fixed-window limiter keyed by IP (public-demo mode only).',
    },
    detail: 4,
    sources: [src(FILES.routesOnboarding, 44, 47, "rateLimit('onboarding')"), src(FILES.csrf, 30, 35, "'/api/onboarding/applications'"), src(FILES.shPublicDemo, 89, 90, 'onboarding: { max: 5')],
  },
  {
    id: 'server-validate',
    kind: 'validate',
    title: 'The server validates again',
    from: R_ONB,
    to: R_ONB,
    label: 'validateOpenAccount(body)',
    narrative:
      'The handler first coerces the raw body field by field — strings are cut to 500 characters, a non-number deposit is dropped, consent must be the literal `true` — and then runs the same `validateOpenAccount`. Only the normalized result is passed on.',
    audience: { executive: 'The server re-checks everything itself; it does not trust the browser.' },
    detail: 3,
    sources: [src(FILES.routesOnboarding, 48, 62, 'validateOpenAccount')],
  },
  {
    id: 'invalid-response',
    kind: 'response',
    title: '400 with per-field errors',
    from: R_ONB,
    to: PAT,
    label: '400 invalid_request',
    narrative: 'Validation fails, so the handler answers 400 with the per-field messages and returns. The service is never called.',
    audience: { executive: 'The server refuses the application and says why.' },
    detail: 1,
    variants: ['invalid-application'],
    payload: {
      title: 'Validation error',
      format: 'http-response',
      line: '400 Bad Request',
      data: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { email: 'Enter a valid email address.', password: 'Choose a password of at least 8 characters.', consent: 'Please accept the simulated terms to continue.' } },
      highlight: ['code', 'fields'],
    },
    sources: [src(FILES.routesOnboarding, 60, 62, 'Please correct the highlighted fields.'), src(FILES.routesOnboarding, 37, 41, "code: 'invalid_request'")],
  },
  {
    id: 'invalid-state',
    kind: 'state',
    title: 'Nothing was created',
    from: DB,
    to: PAT,
    label: 'no rows written',
    narrative: 'No application, no queue item, no audit row, no event. Operators never see an invalid application.',
    audience: { dba: 'Zero writes: the request ended before any Prisma call.' },
    detail: 2,
    variants: ['invalid-application'],
    confidence: 'inferred',
  },
  {
    id: 'sim-now-submit',
    kind: 'db-read',
    title: 'Read the simulated time',
    from: R_ONB,
    to: DB,
    label: 'simulationNow() → SimulationClock',
    narrative: 'The handler reads the simulation clock and passes it to the service, so the application and its queue item are dated by the simulated calendar.',
    detail: 5,
    variants: OK,
    sources: [src(FILES.routesOnboarding, 64, 66, 'simulationNow(prisma)')],
  },
  {
    id: 'call-submit',
    kind: 'call',
    title: 'Hand over to the onboarding service',
    from: R_ONB,
    to: SVC,
    label: 'submitApplication(value, now)',
    narrative: 'The route calls `submitApplication` with the normalized application. This half of the onboarding service only records and queues; it creates no user, no account and no money.',
    detail: 3,
    variants: OK,
    sources: [src(FILES.routesOnboarding, 64, 72, 'submitApplication(result.value'), src(FILES.onboarding, 110, 113, 'export async function submitApplication')],
  },
  {
    id: 'cap-check',
    kind: 'db-read',
    title: 'Check the per-email cap',
    from: SVC,
    to: DB,
    label: "COUNT OnboardingApplication WHERE email AND status = 'submitted'",
    narrative:
      'An email may have at most 3 applications awaiting review. This cap applies in every mode and, together with the rate limit, stops a script from filling the queue. Pat has none, so the service continues; at the cap it would throw `ApplicationLimitError` and the route would answer 409 `limit_reached`.',
    audience: { dba: 'COUNT on OnboardingApplication filtered by email (indexed) and status (indexed).' },
    detail: 4,
    variants: OK,
    sources: [src(FILES.onboarding, 114, 125, 'RESOURCE_CAPS.pendingApplicationsPerEmail'), src(FILES.routesOnboarding, 67, 71, 'err instanceof ApplicationLimitError')],
  },
  {
    id: 'hash-password',
    kind: 'call',
    title: 'Hash the password, mint a reference',
    from: SVC,
    to: SVC,
    label: 'hashPassword(password) · generateReference()',
    narrative:
      'The chosen password is hashed with bcrypt before any row is written; from here on only the hash exists on the server. `generateReference()` produces the short code the applicant will see: `MER-` plus six hex characters.',
    audience: {
      executive: 'The password is scrambled before it is stored; the bank never keeps the original.',
      systems: 'bcrypt hashing happens in the request path, which is why this endpoint has the tightest rate limit.',
    },
    detail: 3,
    variants: OK,
    payload: { title: 'Derived values', format: 'json', data: { reference: REFERENCE, passwordHash: HASH }, highlight: ['reference'] },
    sources: [src(FILES.onboarding, 127, 129, 'hashPassword(input.password)'), src(FILES.onboarding, 39, 42, 'export function generateReference')],
  },
  queueInsertStep(['approved', 'rejected'], false),
  queueInsertStep(['with-joint-invite'], true),
  applicationInsertStep(['approved', 'rejected'], false),
  applicationInsertStep(['with-joint-invite'], true),
  {
    id: 'intake-audit-events',
    kind: 'db-write',
    title: 'Audit the intake and record simulated checks',
    from: SVC,
    to: DB,
    label: 'INSERT AuditLog + 3 SimulatedEvent',
    narrative:
      'An `ops_request_created` audit row (actor role `system`) starts the request\'s history. Then three simulated events are recorded and linked to the request: an "application received" email, an identity-verification request and an MFA enrollment offer. A real bank would call an email provider and an identity service here; Meridian only records that it would have.',
    audience: {
      executive: 'The system notes that a confirmation email and an identity check would be triggered — nothing is actually sent.',
      systems: 'These rows mark the integration boundary for email, identity verification and MFA providers.',
      dba: 'INSERT AuditLog (createdAt = wall clock), then three INSERT SimulatedEvent. Together with the two previous inserts these are separate autocommit statements, not one transaction.',
    },
    detail: 4,
    variants: OK,
    payload: { title: 'SimulatedEvent rows', format: 'row', data: INTAKE_EVENTS, highlight: ['0.kind', '1.kind', '2.kind'] },
    effects: [
      {
        op: 'insert',
        table: 'AuditLog',
        row: { id: 'aud_101', actorId: null, actorRole: 'system', action: 'ops_request_created', entity: 'operations_request', entityId: REQ, reason: `Application ${REFERENCE} received (simulated)`, metadata: JSON.stringify({ reference: REFERENCE, product: 'checking' }), createdAt: WALL_SUBMIT },
      },
      ...INTAKE_EVENTS.map((row): StateEffect => ({ op: 'insert', table: 'SimulatedEvent', row })),
    ],
    sources: [src(FILES.onboarding, 168, 177, 'AUDIT_INTAKE_ACTION'), src(FILES.onboarding, 179, 224, "kind: 'application_received'")],
  },
  createdEventStep(['approved', 'rejected'], false),
  createdEventStep(['with-joint-invite'], true),
  {
    id: 'submit-response',
    kind: 'response',
    title: '201 with a reference',
    from: R_ONB,
    to: FORM,
    label: '201 { reference, status: "submitted" }',
    narrative: 'The response carries only the human reference, the status, the product and a message. No internal ids are exposed and nothing in it lets the applicant sign in yet.',
    detail: 2,
    variants: OK,
    payload: {
      title: 'Application accepted',
      format: 'http-response',
      line: '201 Created',
      data: {
        reference: REFERENCE,
        status: 'submitted',
        product: 'checking',
        message:
          'Your simulated application was received. A bank operator will review it; once approved, you can sign in with the email and password you chose. (SIMULATION — no real account, money, or identity check.)',
      },
      typeRef: 'sh:onboarding#OpenAccountResponse',
      highlight: ['reference', 'status'],
    },
    sources: [src(FILES.routesOnboarding, 77, 84, 'reply.code(201).send(response)')],
  },
  {
    id: 'confirmation',
    kind: 'ui',
    title: 'Pat sees "Application received"',
    from: FORM,
    to: PAT,
    label: `confirmation · ${REFERENCE}`,
    narrative: 'The form is replaced by a confirmation panel with the reference and the next steps: an operator reviews the application; once approved, sign in with the chosen email and password. It states that no account or money exists until then.',
    audience: { executive: 'The applicant is told the application is under review.', 'end-user': 'Pat gets a reference number and is told to wait for approval.' },
    detail: 2,
    variants: OK,
    sources: [src(FILES.openAccount, 77, 99, 'Application received (simulated)'), src(FILES.openAccount, 133, 136, 'no account or money exists until an operator approves')],
  },

  // ===== 2. The operator's decision ==============================================
  {
    id: 'operator-opens',
    kind: 'ui',
    title: 'Sam reviews the application',
    from: SAM,
    to: CONSOLE,
    label: 'open "New account application"',
    narrative:
      'Sam Operator opens the new item in the Request queues page. The detail panel reads the application context from the request payload — product Everyday Checking, opening deposit $250.00, any joint invitee — and notes that "Approving provisions the account and posts any opening deposit". The password hash is not part of anything the console receives.',
    audience: {
      executive: 'A bank employee reviews the application.',
      'end-user': 'A bank employee looks at Pat\'s application.',
    },
    detail: 2,
    variants: OK,
    sources: [src(FILES.detailPanel, 254, 284, 'Approving provisions the account and posts any opening deposit'), src(FILES.onboardingTest, 123, 131, "not.toContain('passwordHash')")],
  },
  {
    id: 'operator-decides',
    kind: 'decision',
    title: 'Approve or reject?',
    from: SAM,
    to: CONSOLE,
    label: 'choose an action',
    narrative: 'An onboarding request uses the same four decisions as any other request. Approve and reject are final; hold and request info keep it open.',
    detail: 2,
    variants: OK,
    decision: {
      question: 'What does the operator decide about the application?',
      options: [
        { label: 'Approve', variant: 'approved', description: 'The customer, the account and the opening deposit are created.' },
        { label: 'Approve (application named a joint owner)', variant: 'with-joint-invite', description: 'As above, plus a pending joint-owner invitation.' },
        { label: 'Reject', variant: 'rejected', description: 'The application is marked rejected; nothing is created.' },
      ],
    },
    sources: [src(FILES.shOperations, 24, 31, 'export const OPS_ACTIONS')],
  },
  {
    id: 'action-request-approve',
    kind: 'request',
    title: 'Sam clicks Approve',
    from: CONSOLE,
    to: R_OPS,
    label: `POST /api/ops/requests/${REQ}/action`,
    narrative: 'The console sends the decision with the operations session cookie, the surface header and the CSRF header — the same call as for any other request type.',
    audience: { executive: 'The employee approves the application.', 'end-user': 'Sam approves the application.' },
    detail: 1,
    variants: APPROVE,
    payload: {
      title: 'Operator action request',
      format: 'http-request',
      line: `POST /api/ops/requests/${REQ}/action`,
      headers: { Cookie: 'mer_ops_session=<opaque session token>; mer_csrf=<csrf token>', 'x-meridian-surface': 'operations', 'x-meridian-csrf': '<csrf token>', 'Content-Type': 'application/json' },
      data: { action: 'approve' },
      typeRef: 'sh:operations#OperatorActionRequest',
    },
    sources: [src(FILES.opsApi, 50, 61, 'export async function applyOpsAction')],
  },
  {
    id: 'action-request-reject',
    kind: 'request',
    title: 'Sam clicks Reject',
    from: CONSOLE,
    to: R_OPS,
    label: `POST /api/ops/requests/${REQ}/action`,
    narrative: 'Sam types a note explaining the decision and clicks Reject. The call is the same; only the action differs.',
    audience: { executive: 'The employee declines the application.', 'end-user': 'Sam rejects the application.' },
    detail: 1,
    variants: ['rejected'],
    payload: {
      title: 'Operator action request',
      format: 'http-request',
      line: `POST /api/ops/requests/${REQ}/action`,
      headers: { Cookie: 'mer_ops_session=<opaque session token>; mer_csrf=<csrf token>', 'x-meridian-surface': 'operations', 'x-meridian-csrf': '<csrf token>', 'Content-Type': 'application/json' },
      data: { action: 'reject', note: REJECT_NOTE },
      typeRef: 'sh:operations#OperatorActionRequest',
    },
    sources: [src(FILES.opsApi, 50, 61, 'export async function applyOpsAction')],
  },
  {
    id: 'staff-guards',
    kind: 'guard',
    title: 'Staff only: CSRF, session, role',
    from: R_OPS,
    to: R_OPS,
    label: 'csrfHook · requireAuth · requireRole · rateLimit',
    narrative:
      'Unlike the application endpoint, this one is fully guarded: the CSRF header must match the cookie, `requireAuth` resolves the operations session to Sam, `requireRole("ops_agent", "admin")` confirms Sam is staff, and the per-operator rate limit applies in public-demo mode. The handler then validates the action with `isOpsAction` and reads the simulated time. The "ops-approval" scenario walks through these steps one by one.',
    audience: { executive: 'The server confirms the decision comes from a signed-in member of staff.' },
    detail: 3,
    variants: OK,
    effects: [{ op: 'update', table: 'Session', id: 'ses_sam', set: { lastSeenAt: WALL_DECIDE, expiresAt: '2026-10-01T23:09:45.000Z' } }],
    sources: [src(FILES.routesOps, 53, 56, 'const opsMutation'), src(FILES.routesOps, 122, 146, 'isOpsAction(body.action)')],
  },
  {
    id: 'call-apply',
    kind: 'call',
    title: 'Apply the operator action',
    from: R_OPS,
    to: APPLY,
    label: 'applyOperatorAction(prisma, input, now)',
    narrative: 'The route calls the workflow service with the request id, the action, the note, Sam as actor and the simulated time.',
    detail: 3,
    variants: OK,
    sources: [src(FILES.routesOps, 138, 146, 'applyOperatorAction')],
  },
  {
    id: 'load-and-check',
    kind: 'db-read',
    title: 'Load the request and check it is still open',
    from: APPLY,
    to: DB,
    label: 'SELECT OperationsRequest · canApplyAction',
    narrative:
      'The service reads the request (status `pending`, type `onboarding`), confirms with `canApplyAction` that a decision is still allowed, and derives the target status from the action. Because the type is `onboarding`, the approve and reject branches below are the onboarding ones.',
    detail: 4,
    variants: OK,
    sources: [src(FILES.requests, 235, 240, 'prisma.operationsRequest.findUnique'), src(FILES.requests, 273, 291, "existing.type === 'onboarding'")],
  },

  // ----- approve ---------------------------------------------------------------------
  {
    id: 'approval-blocker',
    kind: 'validate',
    title: 'Pre-flight: can this application be provisioned?',
    from: APPLY,
    to: SVC,
    label: 'onboardingApprovalBlocker(existing)',
    narrative:
      'Before anything is written, the onboarding service checks two things: the linked application is still `submitted`, and no User already has the applicant\'s email (the public form never checked that). Both hold, so it returns null. If either failed it would return a reason, the service would throw `invalid_action`, the route would answer 400 and the request would stay pending for the operator to reject instead.',
    audience: {
      executive: 'The system checks the applicant is not already a customer before opening anything.',
      dba: 'Two reads outside the transaction: OnboardingApplication by requestId (unique) and User by email (unique).',
    },
    detail: 3,
    variants: APPROVE,
    sources: [src(FILES.requests, 293, 296, 'onboardingApprovalBlocker(existing)'), src(FILES.onboarding, 238, 259, 'export async function onboardingApprovalBlocker'), src(FILES.onboardingTest, 203, 216, 'blocks (and rolls back) approval')],
  },
  ...approveRequestSteps(['approved'], false),
  ...approveRequestSteps(['with-joint-invite'], true),
  {
    id: 'create-user',
    kind: 'db-write',
    title: 'Create the customer',
    from: SVC,
    to: DB,
    label: "INSERT User (role 'customer')",
    narrative:
      'The applicant becomes a real User: role `customer`, status `active`, and the bcrypt hash that was captured when the application was submitted. Nobody at the bank ever saw or re-entered the password.',
    audience: {
      executive: 'Pat becomes a customer of the bank.',
      'end-user': 'Pat\'s login is created.',
      dba: 'INSERT User. email is unique — the pre-flight check exists so this insert does not fail on it.',
    },
    detail: 2,
    variants: APPROVE,
    payload: { title: 'User row', format: 'row', data: USER_ROW, highlight: ['role', 'status'] },
    effects: [{ op: 'insert', table: 'User', row: USER_ROW }],
    sources: [src(FILES.onboarding, 283, 293, 'tx.user.create')],
  },
  {
    id: 'create-account',
    kind: 'db-write',
    title: 'Open the account and grant ownership',
    from: SVC,
    to: DB,
    label: "INSERT Account · INSERT AccountAccess ('owner')",
    narrative:
      'An Account of the chosen type is opened, named from `ONBOARDING_PRODUCT_LABELS` ("Everyday Checking"), with `openedAt` = the simulated now. A separate AccountAccess row with relationship `owner` is written as well: that row, not `Account.userId`, is what the access rules read when deciding which accounts a user can see.',
    audience: {
      executive: 'The checking account is opened in Pat\'s name.',
      dba: 'INSERT Account (userId → User.id); INSERT AccountAccess (unique on userId + accountId, relationship = owner).',
    },
    detail: 1,
    variants: APPROVE,
    payload: { title: 'Account + AccountAccess rows', format: 'row', data: { Account: ACCOUNT_ROW, AccountAccess: ACCESS_ROW }, highlight: ['Account.name', 'AccountAccess.relationship'] },
    effects: [
      { op: 'insert', table: 'Account', row: ACCOUNT_ROW },
      { op: 'insert', table: 'AccountAccess', row: ACCESS_ROW },
    ],
    sources: [src(FILES.onboarding, 295, 301, 'tx.accountAccess.create')],
  },
  {
    id: 'initial-funding',
    kind: 'db-write',
    title: 'Post the opening deposit',
    from: SVC,
    to: DB,
    label: "INSERT LedgerEntry (credit, posted, origin 'deposit')",
    narrative:
      'Because the application asked for $250.00, one ledger entry is appended: a credit, already `posted`, origin `deposit`, described "Opening deposit (simulated)" and dated at the simulated now. This bank-originated entry is the only way money enters the new account — no balance is stored. It is audited as `onboarding_initial_funding`. An application with a $0 deposit skips this step and the account opens empty.',
    audience: {
      executive: 'The $250 opening deposit is credited to the new account.',
      'end-user': 'The opening deposit lands in the account.',
      dba: 'INSERT LedgerEntry (amountMinor 25000, direction credit, status posted). INSERT AuditLog with entity `ledger_entry` — note its entityId is the ACCOUNT id, not the ledger entry id.',
    },
    detail: 1,
    variants: APPROVE,
    payload: { title: 'LedgerEntry row', format: 'row', data: FUNDING_ENTRY, highlight: ['amountMinor', 'status', 'origin'] },
    effects: [
      { op: 'insert', table: 'LedgerEntry', row: FUNDING_ENTRY },
      { op: 'insert', table: 'AuditLog', row: FUNDING_AUDIT },
    ],
    sources: [src(FILES.onboarding, 303, 327, "origin: 'deposit'"), src(FILES.onboardingTest, 156, 162, "origin: 'deposit', status: 'posted', direction: 'credit'"), src(FILES.onboardingTest, 174, 184, 'a zero-funding application opens an account with no ledger entry')],
  },
  {
    id: 'joint-invitation',
    kind: 'db-write',
    title: 'Create the joint-owner invitation',
    from: SVC,
    to: DB,
    label: "INSERT AccountInvitation ('pending') + SimulatedEvent",
    narrative:
      'The application named a joint owner, so `createInvitationRecord` inserts a pending invitation from Pat (the new user) to jordan.joint@example.com with relationship `joint`, on the same transaction. Its "delivery" is a simulated email event. Jordan gets no access yet.',
    audience: {
      executive: 'An invitation to share the account is created for the second person.',
      dba: 'INSERT AccountInvitation (accountId → Account, invitedById → User, unique random token); INSERT SimulatedEvent.',
    },
    detail: 2,
    variants: ['with-joint-invite'],
    payload: { title: 'AccountInvitation row', format: 'row', data: INVITATION_ROW, highlight: ['inviteeEmail', 'status'] },
    effects: [
      { op: 'insert', table: 'AccountInvitation', row: INVITATION_ROW },
      { op: 'insert', table: 'SimulatedEvent', row: INVITE_EVENT },
    ],
    sources: [src(FILES.onboarding, 329, 357, 'createInvitationRecord'), src(FILES.invitations, 63, 89, 'export async function createInvitationRecord'), src(FILES.onboardingTest, 186, 201, 'creates a joint invitation when the application requested one')],
  },
  {
    id: 'mark-provisioned',
    kind: 'db-write',
    title: 'Mark the application provisioned',
    from: SVC,
    to: DB,
    label: "UPDATE OnboardingApplication SET status = 'provisioned'",
    narrative:
      'The application records which user and account it produced and moves to `provisioned`; an `onboarding_provisioned` audit row names the operator. Finally a simulated identity event "Identity verified — Everyday Checking opened (simulated)" is recorded for the console feed.',
    audience: { dba: 'UPDATE OnboardingApplication (status, provisionedUserId, provisionedAccountId); INSERT AuditLog; INSERT SimulatedEvent. Then the transaction commits.' },
    detail: 3,
    variants: APPROVE,
    payload: { title: 'OnboardingApplication update', format: 'row', data: { status: 'provisioned', provisionedUserId: USER, provisionedAccountId: ACCOUNT, updatedAt: NOW }, highlight: ['status'] },
    effects: [...provisionEffectsCore, { op: 'insert', table: 'SimulatedEvent', row: OPENED_EVENT }],
    sources: [src(FILES.onboarding, 359, 372, 'onboarding_provisioned'), src(FILES.onboarding, 374, 393, 'Identity verified')],
  },
  ...approvedPushSteps(['approved'], false),
  ...approvedPushSteps(['with-joint-invite'], true),
  {
    id: 'can-sign-in',
    kind: 'state',
    title: 'Pat can sign in and sees the funded account',
    from: DB,
    to: PAT,
    label: 'sign in → Everyday Checking $250.00',
    narrative:
      'Nothing notifies Pat — the "email" was simulated. But the User row now exists with the hash of the password Pat chose, so signing in on the customer app works. The dashboard lists Everyday Checking through the owner grant, and its balance, derived from the single posted deposit, is $250.00 current and available.',
    audience: {
      executive: 'The new customer can log in and sees the account with the opening deposit.',
      'end-user': 'Pat signs in with the email and password from the application and sees the new account with $250.00.',
      dba: 'Balance = sum of posted LedgerEntry rows for the account = 25000. No balance column was written.',
    },
    detail: 1,
    variants: APPROVE,
    payload: { title: 'Everyday Checking (new) — derived balances', format: 'json', data: { accountId: ACCOUNT, currentMinor: FUNDING, availableMinor: FUNDING }, highlight: ['currentMinor'] },
    sources: [src(FILES.onboardingTest, 169, 171, 'expect(login.statusCode).toBe(200)'), src(FILES.ledger, 79, 119, 'export function deriveBalances')],
  },
  {
    id: 'joint-inbox',
    kind: 'state',
    title: 'Jordan finds the invitation',
    from: DB,
    to: PAT,
    label: 'pending invitation for jordan.joint@example.com',
    narrative:
      'Invitations are matched by email. The next time Jordan Joint signs in to the customer app, `GET /api/invitations` returns this pending invitation and the dashboard shows it with Accept and Decline. Accepting creates a `joint` AccountAccess row for Jordan on Pat\'s account; until then Jordan cannot see it.',
    audience: { executive: 'The invited person sees the invitation when they next log in and can accept or decline it.' },
    detail: 2,
    variants: ['with-joint-invite'],
    sources: [src(FILES.invitations, 168, 178, 'export async function listInvitationsForUser'), src(FILES.invitations, 202, 211, 'tx.accountAccess.upsert')],
    confidence: 'inferred',
  },

  // ----- reject ------------------------------------------------------------------------
  {
    id: 'update-request-rejected',
    kind: 'db-write',
    title: 'Request → rejected',
    from: APPLY,
    to: DB,
    label: "UPDATE OperationsRequest SET status = 'rejected'",
    narrative: 'A transaction opens. The request is marked rejected with Sam as the last actor, the note and `resolvedAt`; an `ops_reject` audit row carries the note as its reason. No pre-flight check is needed for a rejection.',
    audience: { dba: 'UPDATE OperationsRequest; INSERT AuditLog (ops_reject). Same transaction as the next step.' },
    detail: 3,
    variants: ['rejected'],
    payload: { title: 'OperationsRequest update', format: 'row', data: decisionSet('rejected'), highlight: ['status', 'lastActionNote'] },
    effects: [
      { op: 'update', table: 'OperationsRequest', id: REQ, set: decisionSet('rejected') },
      { op: 'insert', table: 'AuditLog', row: decisionAudit('rejected') },
    ],
    sources: [src(FILES.requests, 317, 326, 'tx.operationsRequest.update')],
  },
  {
    id: 'reject-application',
    kind: 'db-write',
    title: 'Mark the application rejected',
    from: SVC,
    to: DB,
    label: "UPDATE OnboardingApplication SET status = 'rejected'",
    narrative:
      '`rejectOnboardingApplication` runs on the same transaction: the application moves from `submitted` to `rejected` and a simulated "Application MER-7C41D9 declined" email is recorded. The application row, including the password hash, is kept; no User, Account or LedgerEntry is created.',
    audience: {
      executive: 'The application is declined. No account is opened and no money is involved.',
      dba: 'UPDATE OnboardingApplication; INSERT SimulatedEvent. The rejected application no longer counts toward the 3-per-email cap.',
    },
    detail: 1,
    variants: ['rejected'],
    payload: { title: 'SimulatedEvent row', format: 'row', data: DECLINED_EVENT, highlight: ['summary'] },
    effects: [
      { op: 'update', table: 'OnboardingApplication', id: APP, set: { status: 'rejected', updatedAt: NOW } },
      { op: 'insert', table: 'SimulatedEvent', row: DECLINED_EVENT },
    ],
    sources: [src(FILES.requests, 317, 326, 'rejectOnboardingApplication(tx, input.id, now)'), src(FILES.onboarding, 395, 421, 'export async function rejectOnboardingApplication')],
  },
  {
    id: 'emit-rejected',
    kind: 'event',
    title: 'Consoles see the rejection',
    from: R_OPS,
    to: CONSOLE,
    label: 'ops:request_changed (updated)',
    narrative: 'After the commit the route broadcasts the updated request and the simulated decline email to the `ops` room, then answers 200 with the request.',
    detail: 2,
    variants: ['rejected'],
    payload: { title: 'ops:request_changed', format: 'socket', line: 'ops:request_changed → room "ops"', data: { change: 'updated', request: rejectedDto }, typeRef: 'sh:operations#OpsRequestChangedPayload', highlight: ['request.status'] },
    sources: [src(FILES.routesOps, 147, 151, 'if (event) app.opsRealtime.externalEvent(event)')],
  },
  {
    id: 'cannot-sign-in',
    kind: 'state',
    title: 'No account exists',
    from: DB,
    to: PAT,
    label: 'no User, no Account',
    narrative:
      'There is still no User with Pat\'s email, so signing in fails like any unknown email. Pat is not told about the rejection by any real channel; the decline "email" exists only as a simulated event in the staff console. Pat may apply again.',
    audience: { executive: 'The applicant has no account and cannot log in.', 'end-user': 'Pat cannot sign in; no account was opened.' },
    detail: 1,
    variants: ['rejected'],
    sources: [src(FILES.onboardingTest, 218, 228, 'creates no user')],
    confidence: 'inferred',
  },
];

export const scenario: Scenario = {
  id: 'account-opening',
  title: 'A new customer opens an account',
  question: 'How does a new customer get an account?',
  summary:
    'A visitor submits the public open-account form. The server validates it, hashes the password and queues an application for staff — creating no user, account or money. When an operator approves the request, one transaction creates the User, the Account, the owner access grant and the opening deposit as a posted ledger entry; the applicant can then sign in. Rejecting creates nothing.',
  category: 'onboarding',
  tags: ['onboarding', 'operations', 'money', 'ledger', 'validation', 'security', 'realtime', 'audit'],
  participants: [PAT, FORM, R_ONB, SAM, CONSOLE, R_OPS, APPLY, SVC, DB],
  related: [
    'ep:POST /api/onboarding/applications',
    'ep:POST /api/ops/requests/:id/action',
    'be:ops/onboarding#submitApplication',
    'be:ops/onboarding#provisionApprovedOnboarding',
    'be:ops/onboarding#onboardingApprovalBlocker',
    'be:ops/onboarding#rejectOnboardingApplication',
    'be:ops/invitations#createInvitationRecord',
    APPLY,
    'sh:onboarding#validateOpenAccount',
    'sh:onboarding#OpenAccountRequest',
    'cu:pages/OpenAccount',
    'cu:lib/onboarding#submitApplication',
    'op:pages/RequestQueues',
    'op:components/RequestDetailPanel',
    'ev:ops:request_changed',
    'db:OnboardingApplication',
    'db:OperationsRequest',
    'db:User',
    'db:Account',
    'db:AccountAccess',
    'db:LedgerEntry',
    'db:AccountInvitation',
    'feat:onboarding',
    'feat:invitations',
    'feat:ops-review',
  ],
  variants: [
    { id: 'approved', label: 'Approved', description: 'The operator approves: user, account, owner grant and a $250.00 opening deposit are created.', outcome: 'success' },
    { id: 'with-joint-invite', label: 'Approved, with a joint owner', description: 'As approved, and a pending joint-owner invitation is created for the named email.', outcome: 'success' },
    { id: 'rejected', label: 'Rejected', description: 'The operator rejects: the application is marked rejected and nothing is created.', outcome: 'rejected' },
    { id: 'invalid-application', label: 'Invalid application', description: 'Validation fails in the form and again on the server (400 invalid_request); nothing is written.', outcome: 'failed' },
  ],
  defaultVariant: 'approved',
  initialState: {
    ...baseState(),
    OnboardingApplication: [],
    AccountInvitation: [],
    Session: [{ id: 'ses_sam', userId: IDS.sam, tokenHash: '<sha-256 of the mer_ops_session token>', createdAt: '2026-10-01T14:55:00.000Z', lastSeenAt: '2026-10-01T15:08:00.000Z', expiresAt: '2026-10-01T23:08:00.000Z', revokedAt: null }],
  },
  steps,
  sources: [
    src(FILES.routesOnboarding, 44, 85, "app.post('/api/onboarding/applications'"),
    src(FILES.onboarding, 19, 34, 'Onboarding & account-opening domain service'),
    src(FILES.requests, 293, 326, 'provisionApprovedOnboarding'),
    src(FILES.onboardingTest, 136, 172, 'operator approval provisions the account'),
  ],
};
