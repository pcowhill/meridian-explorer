import type { Contract, ContractError, FlowStep } from '../../types';
import { AUTH_ERRORS, CSRF_ERROR, FILES, RATE_LIMITED, csrfSafeStep, csrfStep, rateLimitStep, requireAuthStep, simNowStep, src, valveStep } from './helpers';
import { EP } from './routes';

const Q = FILES.routesOnboarding;
const O = FILES.onboarding;
const I = FILES.invitations;

const riskLimit = rateLimitStep('risk', '20 hits per 5 minutes per user', Q, 88, 88, "rateLimit('risk')");

const customerAuth = {
  required: true,
  surface: 'customer' as const,
  csrf: true,
  rateLimit: 'risk',
  notes: 'Any signed-in user. The customer app sends the `mer_session` cookie and the CSRF header. Rate limit (public-demo mode only): 20 per 5 minutes per user.',
};

const customerAuthErrors: ContractError[] = AUTH_ERRORS.map((e) => ({ ...e, when: e.when.replace('operations session', 'session') }));

const invitationExample = {
  id: 'inv_301',
  accountId: 'acc_savings',
  accountName: 'Goal Savings',
  inviteeEmail: 'jordan.joint@example.com',
  invitedByName: 'Avery Customer',
  relationship: 'joint',
  status: 'pending',
  createdAt: '2026-10-01T15:00:00.000Z',
  respondedAt: null,
};

const invitationErrors: ContractError[] = [
  { status: 404, code: 'not_found', when: 'No invitation has that id.', example: { error: 'That invitation does not exist.', code: 'not_found' }, source: src(I, 194, 194, "new InvitationError('not_found'") },
  { status: 403, code: 'wrong_invitee', when: "The invitation's email is not the signed-in user's email (compared case-insensitively).", example: { error: 'That invitation was sent to a different email address.', code: 'wrong_invitee' }, source: src(I, 195, 197, 'wrong_invitee') },
  { status: 409, code: 'already_responded', when: 'The invitation is no longer pending.', example: { error: 'That invitation has already been responded to.', code: 'already_responded' }, source: src(I, 198, 200, 'already_responded') },
];

const respond = (label: string, detail: string, start: number, end: number, symbol: string): FlowStep => ({ kind: 'respond', label, detail, source: src(Q, start, end, symbol) });

const invitationChecks = (fnStart: number, fnEnd: number, symbol: string): FlowStep[] => [
  {
    kind: 'db-read',
    target: 'db:AccountInvitation',
    label: 'accountInvitation.findUnique({ id }) + account name + inviter name',
    rejects: [{ status: 404, code: 'not_found', when: 'Unknown invitation id.' }],
    source: src(I, fnStart, fnEnd, symbol),
  },
  {
    kind: 'decision',
    label: 'addressed to this user? still pending?',
    detail: "`row.inviteeEmail` must equal the session user's email (lower-cased both sides), and `row.status` must be `pending`.",
    rejects: [
      { status: 403, code: 'wrong_invitee', when: 'The invitation was sent to a different email.' },
      { status: 409, code: 'already_responded', when: 'Status is accepted, declined or revoked.' },
    ],
    source: src(I, fnStart, fnEnd, 'wrong_invitee'),
  },
];

export const onboardingContracts: Contract[] = [
  // -------------------------------------------------------------------------
  {
    id: EP.apply,
    method: 'POST',
    path: '/api/onboarding/applications',
    summary: 'Submit an account-opening application (public).',
    description:
      'No session is needed. The body is validated with the same `validateOpenAccount` the form already ran, the password is bcrypt-hashed, and an OnboardingApplication plus a linked `onboarding` OperationsRequest are stored. Operators see the new request immediately over the socket. Nothing else exists yet: no User, no Account, no ledger entry. Those are created only when an operator approves the request.',
    auth: {
      required: false,
      csrf: false,
      rateLimit: 'onboarding',
      notes:
        'Unauthenticated and on the CSRF exempt list (there is no victim session to forge). In public-demo mode it is limited to 5 applications per 15 minutes per client IP, plus the global mutation valve. In every mode an email may have at most 3 applications awaiting review.',
    },
    body: [
      { name: 'fullName', type: 'string', required: true, rules: ['Cut to 500 characters before validation.', 'Required after trimming.', 'At most 80 characters.'] },
      { name: 'email', type: 'string', required: true, rules: ['Trimmed and lower-cased.', 'Must look like an email and be at most 254 characters.', 'At most 3 unreviewed applications per email (409).'] },
      { name: 'password', type: 'string', required: true, rules: ['8 to 200 characters.', 'Hashed with bcrypt before storage; never stored or echoed in plain text.'] },
      { name: 'product', type: 'OnboardingProduct', required: true, values: ['checking', 'savings'], typeRef: 'sh:onboarding#ONBOARDING_PRODUCTS', rules: ['Must be checking or savings.'] },
      { name: 'initialFundingMinor', type: 'integer (minor units)', required: true, rules: ['Must be a JSON number and an integer.', 'Between 0 and 2,500,000 ($25,000.00).'], description: 'Simulated opening deposit, posted only on approval.' },
      { name: 'consent', type: 'boolean', required: true, rules: ['Must be exactly true.'] },
      { name: 'jointInviteEmail', type: 'string | null', required: false, rules: ['Optional; blank is treated as absent.', 'Must be a valid email.', "Must differ from the applicant's email."], description: 'If set, a joint-owner invitation is created when the application is approved.' },
    ],
    bodyTypeRef: 'sh:onboarding#OpenAccountRequest',
    requestExample: {
      fullName: 'Pat Applicant',
      email: 'pat.applicant@example.com',
      password: '<chosen password, 8–200 chars>',
      product: 'checking',
      initialFundingMinor: 25000,
      consent: true,
    },
    responses: [
      {
        status: 201,
        description: 'The application was queued. Only the human reference is returned — no internal ids.',
        typeRef: 'sh:onboarding#OpenAccountResponse',
        example: {
          reference: 'MER-7C41D9',
          status: 'submitted',
          product: 'checking',
          message:
            'Your simulated application was received. A bank operator will review it; once approved, you can sign in with the email and password you chose. (SIMULATION — no real account, money, or identity check.)',
        },
      },
    ],
    errors: [
      {
        status: 400,
        code: 'invalid_request',
        when: 'validateOpenAccount found one or more field errors.',
        example: {
          error: 'Please correct the highlighted fields.',
          code: 'invalid_request',
          fields: { email: 'Enter a valid email address.', password: 'Choose a password of at least 8 characters.', consent: 'Please accept the simulated terms to continue.' },
        },
        source: src(Q, 60, 62, 'Please correct the highlighted fields.'),
      },
      {
        status: 409,
        code: 'limit_reached',
        when: 'The email already has 3 applications with status `submitted`.',
        example: { error: 'That e-mail already has 3 applications awaiting review (the simulated maximum). Please wait for an operator decision.', code: 'limit_reached' },
        source: src(O, 118, 125, 'ApplicationLimitError'),
      },
      RATE_LIMITED,
    ],
    flow: [
      {
        kind: 'hook',
        target: 'be:auth/csrf#csrfHook',
        label: 'csrfHook (global onRequest) — exempt path',
        detail: '`/api/onboarding/applications` is on the exempt list, so no token is required; a `mer_csrf` cookie is seeded if the client has none.',
        source: src(FILES.csrf, 30, 35, "'/api/onboarding/applications'"),
      },
      valveStep,
      rateLimitStep('onboarding', '5 hits per 15 minutes, keyed by client IP because there is no user', Q, 45, 47, "rateLimit('onboarding')"),
      {
        kind: 'validate',
        target: 'sh:onboarding#validateOpenAccount',
        label: 'validateOpenAccount({ … })',
        detail: 'The handler first coerces each field (strings cut to 500 characters, non-number funding dropped, consent must be literally true), then validates and normalizes.',
        rejects: [{ status: 400, code: 'invalid_request', when: 'Any field error; the per-field map is returned as `fields`.' }],
        source: src(Q, 48, 62, 'validateOpenAccount'),
      },
      simNowStep(Q, 66, 66),
      { kind: 'call', target: 'be:ops/onboarding#submitApplication', label: 'submitApplication(result.value, now)', source: src(Q, 64, 72, 'submitApplication(result.value') },
      {
        kind: 'db-read',
        target: 'db:OnboardingApplication',
        label: "onboardingApplication.count({ email, status: 'submitted' })",
        detail: 'The per-email cap on unreviewed applications, enforced in every mode.',
        rejects: [{ status: 409, code: 'limit_reached', when: 'Three or more are already awaiting review.' }],
        source: src(O, 118, 125, 'prisma.onboardingApplication.count'),
      },
      { kind: 'call', target: 'be:auth/password#hashPassword', label: 'hashPassword(input.password)', detail: 'bcrypt. From here on only the hash exists server-side.', source: src(O, 127, 128, 'hashPassword(input.password)') },
      {
        kind: 'db-write',
        target: 'db:OperationsRequest',
        label: "operationsRequest.create({ type: 'onboarding', status: 'pending', … })",
        detail: 'priority normal; subjectName / subjectEmail = the applicant; payload = { reference, product, initialFundingMinor, jointInviteEmail }; createdAt = updatedAt = simulated now.',
        source: src(O, 131, 149, 'prisma.operationsRequest.create'),
      },
      {
        kind: 'db-write',
        target: 'db:OnboardingApplication',
        label: "onboardingApplication.create({ status: 'submitted', passwordHash, requestId, … })",
        detail: 'Linked 1:1 to the request through the unique `requestId`.',
        source: src(O, 151, 166, 'prisma.onboardingApplication.create'),
      },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: 'ops_request_created', actorRole 'system'", detail: 'The intake row that the request history later shows as "Created".', source: src(O, 168, 177, 'AUDIT_INTAKE_ACTION') },
      {
        kind: 'db-write',
        target: 'db:SimulatedEvent',
        label: 'recordSimEvent ×3',
        detail: 'email application_received (sent), identity verification (pending), mfa enrollment (pending) — all linked to the request.',
        source: src(O, 182, 224, "kind: 'application_received'"),
      },
      { kind: 'emit', target: 'ev:ops:request_changed', label: "opsRealtime.requestChanged('created', submitted.request)", detail: 'To the ops room only; the applicant\'s browser is not in it.', source: src(Q, 73, 74, "app.opsRealtime.requestChanged('created', submitted.request)") },
      { kind: 'emit', target: 'ev:ops:external_event', label: 'opsRealtime.externalEvent(event) ×3', source: src(Q, 75, 75, 'app.opsRealtime.externalEvent(event)') },
      respond('201 { reference, status: "submitted", product, message }', 'OpenAccountResponse.', 77, 84, 'reply.code(201).send(response)'),
    ],
    sideEffects: [
      'Inserts one OperationsRequest (type onboarding, pending) and one OnboardingApplication (submitted, with the bcrypt hash).',
      'Inserts one AuditLog row `ops_request_created` and three SimulatedEvent rows.',
      'Emits `ops:request_changed` (created) and three `ops:external_event` messages to the ops room.',
      'Creates no User, Account or LedgerEntry.',
    ],
    mutates: true,
    calledBy: ['cu:lib/onboarding#submitApplication', 'cu:pages/OpenAccount'],
    integrationNotes:
      'Post JSON without credentials. `initialFundingMinor` must be a JSON number in cents — a numeric string is dropped and fails validation. A 201 means "queued", not "opened": the applicant can sign in only after an operator approves. The endpoint does not tell the applicant whether the email is already registered; that conflict surfaces to the operator at approval time. The four writes are not wrapped in a transaction.',
    sources: [src(Q, 44, 85, "app.post('/api/onboarding/applications'"), src(O, 110, 113, 'export async function submitApplication')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.invite,
    method: 'POST',
    path: '/api/accounts/:id/invitations',
    summary: 'Invite a joint owner to an account you own.',
    description:
      'Only the `owner` relationship may invite. The invitation is stored as pending and "delivered" as a simulated email that appears in the operators\' event feed. The invitee finds it by signing in with that email.',
    auth: customerAuth,
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'Account id.' }],
    body: [
      { name: 'inviteeEmail', type: 'string', required: true, rules: ['Cut to 500 characters; trimmed and lower-cased.', 'Must look like an email.', "Must not be the inviter's own email."] },
      { name: 'relationship', type: 'AccountRelationship', required: false, values: ['joint', 'authorized'], rules: ["Only the literal 'authorized' is honoured; anything else (including omitted) becomes 'joint'."] },
    ],
    bodyTypeRef: 'sh:onboarding#CreateInvitationRequest',
    requestExample: { inviteeEmail: 'jordan.joint@example.com' },
    responses: [{ status: 201, description: 'The pending invitation.', typeRef: 'sh:onboarding#InvitationActionResponse', example: { invitation: invitationExample } }],
    errors: [
      { status: 404, code: 'not_found', when: 'No account has that id.', example: { error: 'That account was not found.', code: 'not_found' }, source: src(Q, 94, 100, "'not_found'") },
      { status: 403, code: 'forbidden', when: 'The account exists but the caller has no access to it. The message still reads "That account was not found."', example: { error: 'That account was not found.', code: 'forbidden' }, source: src(Q, 96, 100, 'That account was not found.') },
      { status: 403, code: 'forbidden', when: 'The caller has access but is not the owner (for example a joint owner).', example: { error: 'Only the account owner can invite a joint owner.', code: 'forbidden' }, source: src(Q, 101, 105, 'Only the account owner can invite a joint owner.') },
      { status: 400, code: 'invalid_request', when: 'The invitee email is missing, invalid, or the inviter\'s own.', example: { error: 'Please enter a valid email to invite.', code: 'invalid_request', fields: { inviteeEmail: 'You already have access to this account.' } }, source: src(Q, 115, 117, 'Please enter a valid email to invite.') },
      { status: 409, code: 'limit_reached', when: 'The account already has 10 pending invitations.', example: { error: 'This account already has 10 pending invitations (the simulated maximum).', code: 'limit_reached' }, source: src(I, 113, 121, 'limit_reached') },
      CSRF_ERROR,
      ...customerAuthErrors,
      RATE_LIMITED,
    ],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      riskLimit,
      { kind: 'db-read', target: 'db:Account', label: 'account.findUnique({ id }, select id + name)', rejects: [{ status: 404, code: 'not_found', when: 'No such account.' }], source: src(Q, 94, 100, 'prisma.account.findUnique') },
      {
        kind: 'guard',
        target: 'be:auth/access#getAccountRelationship',
        label: "getAccountRelationship(prisma, user.id, id) === 'owner'",
        detail: 'Reads the caller\'s AccountAccess relationship for this account.',
        rejects: [
          { status: 403, code: 'forbidden', when: 'No relationship at all.' },
          { status: 403, code: 'forbidden', when: 'A relationship other than owner.' },
        ],
        source: src(Q, 95, 105, 'getAccountRelationship'),
      },
      { kind: 'validate', target: 'sh:onboarding#validateInvitation', label: 'validateInvitation({ inviteeEmail, relationship }, user.email)', rejects: [{ status: 400, code: 'invalid_request', when: 'Missing, invalid or self-addressed email.' }], source: src(Q, 107, 117, 'validateInvitation') },
      simNowStep(Q, 128, 128),
      { kind: 'call', target: 'be:ops/invitations#inviteJoint', label: 'inviteJoint({ accountId, accountName, inviter, inviteeEmail, relationship }, now)', source: src(Q, 119, 129, 'inviteJoint(') },
      { kind: 'db-read', target: 'db:AccountInvitation', label: "accountInvitation.count({ accountId, status: 'pending' })", rejects: [{ status: 409, code: 'limit_reached', when: 'Ten or more pending invitations on this account.' }], source: src(I, 113, 121, 'prisma.accountInvitation.count') },
      { kind: 'db-write', target: 'db:AccountInvitation', label: "accountInvitation.create({ status: 'pending', token, … })", detail: 'A random 48-hex-character token is stored but never returned.', source: src(I, 77, 88, 'db.accountInvitation.create') },
      { kind: 'db-write', target: 'db:SimulatedEvent', label: 'simulatedEvent.create(email, invitation, sent)', detail: '"Joint-owner invitation sent to <email> (simulated)"; not linked to any request.', source: src(I, 133, 143, 'prisma.simulatedEvent.create') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: 'invitation_created', entity 'account_invitation'", source: src(I, 145, 157, 'invitation_created') },
      { kind: 'emit', target: 'ev:ops:external_event', label: 'opsRealtime.externalEvent(event)', detail: 'Operators see the simulated email in their feed; the invitee receives nothing in real time.', source: src(Q, 130, 130, 'app.opsRealtime.externalEvent(event)') },
      respond('201 { invitation }', 'InvitationError → handleInvitationError (409 for the cap).', 131, 134, 'reply.code(201).send({ invitation })'),
    ],
    sideEffects: ['Inserts one pending AccountInvitation.', 'Inserts one SimulatedEvent and one AuditLog row `invitation_created`.', 'Emits `ops:external_event` to the ops room.'],
    mutates: true,
    calledBy: ['cu:lib/invitations#createInvitation'],
    integrationNotes: 'The invitee does not need to exist as a user yet; the invitation is matched later by email. Nothing prevents inviting someone who already has access — accepting then leaves their existing grant unchanged. The insert, event and audit row are separate statements, not one transaction.',
    sources: [src(Q, 87, 135, "app.post('/api/accounts/:id/invitations'"), src(I, 101, 110, 'export async function inviteJoint')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.invitations,
    method: 'GET',
    path: '/api/invitations',
    summary: "The signed-in user's pending invitations.",
    description: 'Invitations whose `inviteeEmail` equals the session user\'s email (lower-cased) and whose status is `pending`, newest first.',
    auth: { required: true, surface: 'customer', csrf: false, notes: 'Any signed-in user; no rate limit.' },
    responses: [{ status: 200, description: 'Pending invitations with the account name and the inviter\'s display name.', typeRef: 'sh:onboarding#InvitationListResponse', example: { invitations: [invitationExample] } }],
    errors: [...customerAuthErrors],
    flow: [
      csrfSafeStep,
      requireAuthStep,
      { kind: 'call', target: 'be:ops/invitations#listInvitationsForUser', label: 'listInvitationsForUser(req.user)', source: src(Q, 138, 140, 'listInvitationsForUser') },
      { kind: 'db-read', target: 'db:AccountInvitation', label: "accountInvitation.findMany({ inviteeEmail, status: 'pending' }, include account.name + invitedBy.displayName)", source: src(I, 170, 174, 'prisma.accountInvitation.findMany') },
      respond('200 { invitations }', 'InvitationListResponse.', 140, 140, 'reply.send({ invitations })'),
    ],
    mutates: false,
    calledBy: ['cu:lib/invitations#fetchInvitations'],
    integrationNotes: 'Matching is by email only, so an invitation sent before the invitee had an account shows up as soon as a user with that email signs in.',
    sources: [src(Q, 137, 141, "app.get('/api/invitations'")],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.accept,
    method: 'POST',
    path: '/api/invitations/:id/accept',
    summary: 'Accept an invitation addressed to you.',
    description:
      'Creates the `AccountAccess` grant (relationship from the invitation, normally `joint`) and marks the invitation accepted, in one transaction. From the next request on, the access rules let the invitee see and use the account. No money moves.',
    auth: customerAuth,
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'AccountInvitation id.' }],
    requestExample: {},
    responses: [{ status: 200, description: 'The invitation, now accepted.', typeRef: 'sh:onboarding#InvitationActionResponse', example: { invitation: { ...invitationExample, status: 'accepted', respondedAt: '2026-10-01T15:00:00.000Z' } } }],
    errors: [...invitationErrors, CSRF_ERROR, ...customerAuthErrors, RATE_LIMITED],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      riskLimit,
      simNowStep(Q, 146, 146),
      { kind: 'call', target: 'be:ops/invitations#acceptInvitation', label: 'acceptInvitation(id, req.user, now)', source: src(Q, 143, 150, 'acceptInvitation(id') },
      ...invitationChecks(190, 200, 'prisma.accountInvitation.findUnique'),
      { kind: 'transaction', label: 'prisma.$transaction', source: src(I, 202, 202, 'prisma.$transaction') },
      { kind: 'db-write', target: 'db:AccountAccess', label: 'accountAccess.upsert({ userId_accountId }, create { relationship })', detail: 'If the user already has a grant on this account it is left unchanged.', source: src(I, 203, 207, 'tx.accountAccess.upsert') },
      { kind: 'db-write', target: 'db:AccountInvitation', label: "accountInvitation.update({ status: 'accepted', acceptedById, respondedAt })", source: src(I, 208, 211, 'tx.accountInvitation.update') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: 'invitation_accepted'", source: src(I, 212, 220, 'invitation_accepted') },
      respond('200 { invitation }', 'InvitationError → 404 / 403 / 409 via handleInvitationError.', 147, 150, 'reply.send({ invitation }'),
    ],
    sideEffects: ['Upserts an AccountAccess row for (user, account).', 'Updates the AccountInvitation to accepted.', 'Inserts one AuditLog row `invitation_accepted`.'],
    mutates: true,
    calledBy: ['cu:lib/invitations#acceptInvitation'],
    integrationNotes: 'No body is needed and no socket event is emitted. The user\'s `role` is not changed — access comes from the AccountAccess row alone.',
    sources: [src(Q, 143, 151, "app.post('/api/invitations/:id/accept'"), src(I, 185, 189, 'export async function acceptInvitation')],
  },

  // -------------------------------------------------------------------------
  {
    id: EP.decline,
    method: 'POST',
    path: '/api/invitations/:id/decline',
    summary: 'Decline an invitation addressed to you.',
    description: 'Marks the invitation declined and audits it. No access is granted.',
    auth: customerAuth,
    pathParams: [{ name: 'id', type: 'string', required: true, description: 'AccountInvitation id.' }],
    requestExample: {},
    responses: [{ status: 200, description: 'The invitation, now declined.', typeRef: 'sh:onboarding#InvitationActionResponse', example: { invitation: { ...invitationExample, status: 'declined', respondedAt: '2026-10-01T15:00:00.000Z' } } }],
    errors: [...invitationErrors, CSRF_ERROR, ...customerAuthErrors, RATE_LIMITED],
    flow: [
      csrfStep,
      valveStep,
      requireAuthStep,
      riskLimit,
      simNowStep(Q, 156, 156),
      { kind: 'call', target: 'be:ops/invitations#declineInvitation', label: 'declineInvitation(id, req.user, now)', source: src(Q, 153, 160, 'declineInvitation(id') },
      ...invitationChecks(235, 245, 'prisma.accountInvitation.findUnique'),
      { kind: 'db-write', target: 'db:AccountInvitation', label: "accountInvitation.update({ status: 'declined', respondedAt })", source: src(I, 246, 249, 'prisma.accountInvitation.update') },
      { kind: 'db-write', target: 'db:AuditLog', label: "writeAudit: 'invitation_declined'", source: src(I, 250, 258, 'invitation_declined') },
      respond('200 { invitation }', 'InvitationError → 404 / 403 / 409 via handleInvitationError.', 157, 160, 'reply.send({ invitation }'),
    ],
    sideEffects: ['Updates the AccountInvitation to declined.', 'Inserts one AuditLog row `invitation_declined`.'],
    mutates: true,
    calledBy: ['cu:lib/invitations#declineInvitation'],
    integrationNotes: 'Declining frees one slot under the 10-pending-invitations cap for that account.',
    sources: [src(Q, 153, 161, "app.post('/api/invitations/:id/decline'"), src(I, 230, 234, 'export async function declineInvitation')],
  },
];
