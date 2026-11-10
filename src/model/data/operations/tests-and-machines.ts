import type { Entity, GlossaryTerm, Relation, StateMachine } from '../../types';
import { FILES, rel, src } from './helpers';
import { EP } from './routes';

const T_OPS = `test:${FILES.opsTest}`;
const T_ONB = `test:${FILES.onboardingTest}`;
const T_SH_OPS = `test:${FILES.shOperationsTest}`;
const T_SH_ONB = `test:${FILES.shOnboardingTest}`;
const T_E2E_OPS = `test:${FILES.e2eOperations}`;
const T_E2E_ONB = `test:${FILES.e2eOnboarding}`;

const AOA = 'be:ops/requests#applyOperatorAction';

export const testEntities: Entity[] = [
  {
    id: T_OPS,
    kind: 'test',
    name: 'routes/ops.test.ts',
    parent: 'tests',
    summary: 'Integration tests for the operations endpoints: role gating, queue reads and filters, every action transition, the audit trail, real-time emissions and simulated events.',
    description:
      'Drives the server with `app.inject()` and a `RecordingOpsRealtime`, so socket emissions are asserted without a socket. Pins: 401 without a session and 403 for customer / joint_customer on every staff route; approve / reject / hold / request_info each land in the expected status, set lastAction and lastActorName, write an `ops_<action>` audit row and emit an `updated` change; `resolvedAt` is set only for terminal statuses; request_info creates a linked simulated email; unknown action → 400 with no emission; unknown id → 404; a second decision on a resolved request → 409 `already_resolved`; a dangling requestId on simulate-event is dropped; approving a request with no movement payload creates no ledger entries.',
    tech: ['Vitest', 'Fastify inject'],
    tags: ['tests', 'operations', 'rbac', 'realtime', 'audit'],
    sources: [src(FILES.opsTest, 9, 16, 'Integration tests for the v0.5.0 operations endpoints'), { file: FILES.opsTest }],
  },
  {
    id: T_ONB,
    kind: 'test',
    name: 'routes/onboarding.test.ts',
    parent: 'tests',
    summary: 'Integration tests for onboarding: public submission, approval that provisions a funded account, rejection, joint invitations, admin-created users and the note action.',
    description:
      'Pins: a valid application returns 201 with a `MER-` reference, queues a pending onboarding request and creates no user or ledger entry; invalid input → 400 with field errors; the password hash never appears in the request detail; approval creates a customer User, an Account and exactly one posted `deposit` credit, moving the system-wide settled total by exactly the funding amount, and the applicant can then log in; zero funding writes no ledger entry; a requested joint invite becomes a pending invitation; approval is blocked with 400 (request stays pending) when the email already belongs to a user; rejection marks the application rejected. Also the `note` action (allowed after a decision, 400 when blank), invitation ownership / wrong-invitee rules, and admin create-user funding rules.',
    tech: ['Vitest', 'Fastify inject'],
    tags: ['tests', 'onboarding', 'money', 'rbac', 'audit'],
    sources: [src(FILES.onboardingTest, 8, 15, 'Integration tests for onboarding & account opening'), { file: FILES.onboardingTest }],
  },
  {
    id: T_SH_OPS,
    kind: 'test',
    name: 'shared/operations.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the shared operations rules: the transition table, terminal statuses, canApplyAction, type guards, labels, queue lanes, the note action and status counts.',
    description:
      'Pins that every decision maps to a known status, that only approved and rejected are terminal, that decisions are allowed from pending / on_hold / info_requested and blocked from terminal statuses, that `note` is not one of the four decisions yet is always allowed and never changes status, and that every request type belongs to exactly one queue lane.',
    tech: ['Vitest'],
    tags: ['tests', 'operations', 'validation'],
    sources: [src(FILES.shOperationsTest, 30, 84, "describe('canApplyAction'"), { file: FILES.shOperationsTest }],
  },
  {
    id: T_SH_ONB,
    kind: 'test',
    name: 'shared/onboarding.test.ts',
    parent: 'tests',
    summary: 'Unit tests for the shared onboarding validators: email and product guards, open-account rules, invitation rules and admin create-user rules.',
    description:
      'Pins email lower-casing, the required fields, the $25,000 opening-deposit cap, the "cannot invite yourself" rule, the default `joint` relationship, the default demo password, and that admin funding needs both a reason and an account.',
    tech: ['Vitest'],
    tags: ['tests', 'onboarding', 'validation'],
    sources: [src(FILES.shOnboardingTest, 35, 60, "describe('validateOpenAccount'"), { file: FILES.shOnboardingTest }],
  },
  {
    id: T_E2E_OPS,
    kind: 'test',
    name: 'e2e/operations.spec.ts',
    parent: 'tests',
    summary: 'Playwright specs for the operations console: live dashboard, approving a queue item and seeing it move to Approved without a reload, and a simulated event appearing in the feed.',
    description: 'Also covers console session behaviour: returning to sign-in when the ops session is rejected, surviving Origin-less API requests, and navigation on a narrow window.',
    tech: ['Playwright'],
    tags: ['tests', 'operations', 'ui', 'realtime'],
    sources: [src(FILES.e2eOperations, 17, 48, 'an operator can action a queue item and it updates live'), { file: FILES.e2eOperations }],
  },
  {
    id: T_E2E_ONB,
    kind: 'test',
    name: 'e2e/onboarding.spec.ts',
    parent: 'tests',
    summary: 'Playwright specs for account opening: a visitor submits the form and gets a MER- reference; an operator sees the application context, approves it and adds a note afterwards.',
    description: 'Also checks that only an admin sees the Create demo user page and that a customer sees a pending joint-owner invitation with Accept and Decline buttons.',
    tech: ['Playwright'],
    tags: ['tests', 'onboarding', 'ui'],
    sources: [src(FILES.e2eOnboarding, 34, 51, 'a visitor can submit a simulated open-account application'), { file: FILES.e2eOnboarding }],
  },
];

export const testRelations: Relation[] = [
  // ops.test.ts
  rel(T_OPS, EP.action, 'tests', 'transitions, audit, emissions, 400 / 404 / 409 / 403', {
    summary: 'Each decision lands in its status, is audited and emitted; a second decision on a resolved request is 409 `already_resolved`.',
    sources: [src(FILES.opsTest, 161, 243, '409s when acting on an already-resolved request')],
  }),
  rel(T_OPS, AOA, 'tests', 'state transitions + resolvedAt + request_info email', { sources: [src(FILES.opsTest, 192, 216, 'sets resolvedAt only for terminal statuses')] }),
  rel(T_OPS, EP.list, 'tests', 'seeded queue, counts, status / type filters, 400 on unknown filter', { sources: [src(FILES.opsTest, 101, 135, "describe('GET /api/ops/requests'")] }),
  rel(T_OPS, EP.detail, 'tests', 'history includes "created"; linked events; 404', { sources: [src(FILES.opsTest, 137, 157, "describe('GET /api/ops/requests/:id'")] }),
  rel(T_OPS, EP.simulate, 'tests', 'creates, audits, emits; unknown channel 400; dangling requestId dropped', { sources: [src(FILES.opsTest, 247, 282, "describe('POST /api/ops/simulate/event'")] }),
  rel(T_OPS, EP.events, 'tests', 'newest-first ordering', { sources: [src(FILES.opsTest, 284, 293, "describe('GET /api/ops/events'")] }),
  rel(T_OPS, EP.summary, 'tests', '401 unauthenticated', { sources: [src(FILES.opsTest, 65, 77, '/api/ops/summary')] }),
  rel(T_OPS, 'be:auth/guards#requireRole', 'tests', 'customer and joint_customer get 403 on staff routes', { sources: [src(FILES.opsTest, 79, 89, 'forbids customer and joint_customer roles with 403')] }),
  rel(T_OPS, 'feat:ops-review', 'tests', 'operator workflow end to end (API level)'),

  // onboarding.test.ts
  rel(T_ONB, EP.apply, 'tests', '201 + queued + emitted; no user / account / money; 400 field errors', { sources: [src(FILES.onboardingTest, 73, 132, "describe('POST /api/onboarding/applications (public)'")] }),
  rel(T_ONB, 'be:ops/onboarding#submitApplication', 'tests', 'creates request + application, hash not plain text', { sources: [src(FILES.onboardingTest, 74, 106, 'creates no user/account/money')] }),
  rel(T_ONB, 'be:ops/onboarding#provisionApprovedOnboarding', 'tests', 'user + account + one posted deposit; settled total moves by the funding only', {
    summary: 'The money-discipline test: approval moves the system-wide settled total by exactly the opening deposit.',
    sources: [src(FILES.onboardingTest, 136, 201, 'settled total moves only by the funding')],
  }),
  rel(T_ONB, 'be:ops/onboarding#onboardingApprovalBlocker', 'tests', 'approval blocked with 400 when the email is taken; request stays pending', { sources: [src(FILES.onboardingTest, 203, 216, 'blocks (and rolls back) approval')] }),
  rel(T_ONB, 'be:ops/onboarding#rejectOnboardingApplication', 'tests', 'reject → application rejected, no user', { sources: [src(FILES.onboardingTest, 218, 228, 'rejecting an onboarding request marks the application rejected')] }),
  rel(T_ONB, EP.action, 'tests', 'note action: no status change, allowed after a decision, 400 when blank', { sources: [src(FILES.onboardingTest, 233, 278, "describe('note action (B-02)'")] }),
  rel(T_ONB, EP.invite, 'tests', 'owner can invite; non-owner 403; unauthenticated 401', { sources: [src(FILES.onboardingTest, 288, 308, 'lets an owner invite a joint owner')] }),
  rel(T_ONB, EP.accept, 'tests', 'accept grants joint access; wrong invitee 403', { sources: [src(FILES.onboardingTest, 310, 342, 'accepting an invitation grants joint access')] }),
  rel(T_ONB, 'be:ops/invitations#acceptInvitation', 'tests', 'AccountAccess row with relationship joint exists after accept', { sources: [src(FILES.onboardingTest, 322, 330, "expect(grant!.relationship).toBe('joint')")] }),
  rel(T_ONB, EP.invitations, 'tests', 'lists my pending invitations', { sources: [src(FILES.onboardingTest, 344, 361, 'lists my pending invitations and lets me decline')] }),
  rel(T_ONB, EP.decline, 'tests', 'decline → status declined', { sources: [src(FILES.onboardingTest, 344, 361, "toBe('declined')")] }),
  rel(T_ONB, EP.adminCreate, 'tests', 'plain user; funded account via audited adjustment; reason required; duplicate 409; ops_agent 403', { sources: [src(FILES.onboardingTest, 366, 422, "describe('admin create demo user'")] }),
  rel(T_ONB, 'be:ops/admin-users#adminCreateUser', 'tests', "posted 'adjustment' entry with reason + admin_adjustment audit", { sources: [src(FILES.onboardingTest, 377, 398, 'AUDITED bank-originated adjustment')] }),
  rel(T_ONB, 'feat:onboarding', 'tests', 'account opening end to end (API level)'),
  rel(T_ONB, 'feat:invitations', 'tests', 'joint invitations end to end (API level)'),

  // shared unit tests
  rel(T_SH_OPS, 'sh:operations#nextStatusForAction', 'tests', 'each action maps to its status', { sources: [src(FILES.shOperationsTest, 30, 49, "describe('nextStatusForAction'")] }),
  rel(T_SH_OPS, 'sh:operations#isTerminalOpsStatus', 'tests', 'approved / rejected terminal; others actionable', { sources: [src(FILES.shOperationsTest, 51, 68, "describe('isTerminalOpsStatus'")] }),
  rel(T_SH_OPS, 'sh:operations#canApplyAction', 'tests', 'allowed while unresolved; blocked once terminal; note always allowed', { sources: [src(FILES.shOperationsTest, 70, 83, "describe('canApplyAction'"), src(FILES.shOperationsTest, 153, 178, "describe('note action (v0.6.0)'")] }),
  rel(T_SH_OPS, 'sh:operations#isOpsAction', 'tests', 'accepts known actions only', { sources: [src(FILES.shOperationsTest, 85, 100, "describe('type guards'")] }),
  rel(T_SH_OPS, 'sh:operations#queueForType', 'tests', 'every type maps to exactly one lane', { sources: [src(FILES.shOperationsTest, 132, 144, "describe('queues'")] }),
  rel(T_SH_OPS, 'sh:operations#countRequestsByStatus', 'tests', 'full record with zeros; tallies', { sources: [src(FILES.shOperationsTest, 180, 205, "describe('countRequestsByStatus'")] }),
  rel(T_SH_ONB, 'sh:onboarding#validateOpenAccount', 'tests', 'normalizes; required fields; deposit cap; joint invite rules', { sources: [src(FILES.shOnboardingTest, 35, 101, "describe('validateOpenAccount'")] }),
  rel(T_SH_ONB, 'sh:onboarding#validateInvitation', 'tests', 'defaults to joint; rejects self-invite', { sources: [src(FILES.shOnboardingTest, 103, 115, "describe('validateInvitation'")] }),
  rel(T_SH_ONB, 'sh:onboarding#validateAdminCreateUser', 'tests', 'default password; funding needs reason and account', { sources: [src(FILES.shOnboardingTest, 117, 171, "describe('validateAdminCreateUser'")] }),
  rel(T_SH_ONB, 'sh:onboarding#isLikelyEmail', 'tests', 'accepts plausible addresses, rejects junk', { sources: [src(FILES.shOnboardingTest, 14, 23, "describe('isLikelyEmail'")] }),

  // e2e
  rel(T_E2E_OPS, 'op:pages/RequestQueues', 'tests', 'approve from a queue card; item appears under Approved without reload', { sources: [src(FILES.e2eOperations, 28, 48, 'an operator can action a queue item and it updates live')] }),
  rel(T_E2E_OPS, 'feat:ops-review', 'tests', 'approve in the browser'),
  rel(T_E2E_OPS, 'feat:sim-messaging', 'tests', 'simulated SMS appears in the feed', { sources: [src(FILES.e2eOperations, 50, 64, 'a simulated external event appears live in the messaging feed')] }),
  rel(T_E2E_ONB, 'cu:pages/OpenAccount', 'tests', 'submit the open-account form → confirmation with MER- reference', { sources: [src(FILES.e2eOnboarding, 35, 51, 'a visitor can submit a simulated open-account application')] }),
  rel(T_E2E_ONB, 'op:components/RequestDetailPanel', 'tests', 'onboarding context shown; panel reacts to approval; note after decision', { sources: [src(FILES.e2eOnboarding, 53, 97, 'an operator sees onboarding context, approves it (B-01), and can note after (B-02)')] }),
  rel(T_E2E_ONB, 'feat:onboarding', 'tests', 'apply and approve in the browser'),
];

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

const R = FILES.requests;
const SO = FILES.shOperations;
const O = FILES.onboarding;
const I = FILES.invitations;

const OPEN_STATES = ['pending', 'on_hold', 'info_requested'] as const;
const openLabel = (s: string) => (s === 'pending' ? 'Pending' : s === 'on_hold' ? 'On hold' : 'Info requested');

export const stateMachines: StateMachine[] = [
  {
    id: 'sm:ops-request-status',
    name: 'Operations request status',
    summary:
      'A request starts pending and can be put on hold or sent back for information any number of times; approving or rejecting it is final. Every decision is allowed from every non-terminal status.',
    subject: 'db:OperationsRequest',
    field: 'OperationsRequest.status',
    initial: 'pending',
    states: [
      { id: 'pending', label: 'Pending', description: 'Newly queued and waiting for an operator. Every intake path creates requests in this status.' },
      { id: 'on_hold', label: 'On hold', description: 'Parked by an operator. Still actionable; a linked pending ledger entry stays pending (a pending debit keeps reserving funds).' },
      { id: 'info_requested', label: 'Info requested', description: 'The operator asked the subject for more information (a simulated email was recorded). Still actionable.' },
      { id: 'approved', label: 'Approved', terminal: true, description: 'Resolved in favour; `resolvedAt` is set and the type-specific effect has run. No further decision is accepted; notes and (for movements) a reversal still are.' },
      { id: 'rejected', label: 'Rejected', terminal: true, description: 'Resolved against; `resolvedAt` is set. No further decision is accepted; notes still are.' },
    ],
    transitions: [
      ...OPEN_STATES.map((from) => ({
        from,
        to: 'approved',
        label: 'approve',
        by: AOA,
        description:
          from === 'pending'
            ? 'Sets status approved and resolvedAt. With the status change, atomically: a money movement is posted, an onboarding application is provisioned, a dispute is upheld, a fraud alert is confirmed.'
            : `${openLabel(from)} → Approved: same effect as approving a pending request.`,
        source: src(SO, 79, 85, "approve: 'approved'"),
      })),
      ...OPEN_STATES.map((from) => ({
        from,
        to: 'rejected',
        label: 'reject',
        by: AOA,
        description:
          from === 'pending'
            ? 'Sets status rejected and resolvedAt. With the status change, atomically: a money movement is failed, an onboarding application is rejected, a dispute is denied, a fraud alert is dismissed.'
            : `${openLabel(from)} → Rejected: same effect as rejecting a pending request.`,
        source: src(SO, 79, 85, "reject: 'rejected'"),
      })),
      { from: 'pending', to: 'on_hold', label: 'hold', by: AOA, description: 'Workflow only: status and last-action bookkeeping change, an audit row is written, the ledger is untouched.', source: src(SO, 79, 85, "hold: 'on_hold'") },
      { from: 'info_requested', to: 'on_hold', label: 'hold', by: AOA, description: 'An info-requested item can be parked.', source: src(SO, 79, 85, "hold: 'on_hold'") },
      { from: 'on_hold', to: 'on_hold', label: 'hold (repeat)', by: AOA, description: 'Not prevented: the guard only checks that the current status is not terminal, so holding a held request rewrites the bookkeeping and adds another audit row.', source: src(SO, 113, 116, 'return !isTerminalOpsStatus(status)'), confidence: 'inferred' },
      { from: 'pending', to: 'info_requested', label: 'request_info', by: AOA, description: 'Workflow only, plus a simulated outbound email "Information request sent to <subject>" linked to the request.', source: src(R, 395, 409, "input.action === 'request_info'") },
      { from: 'on_hold', to: 'info_requested', label: 'request_info', by: AOA, description: 'A held item can be sent back for information.', source: src(SO, 79, 85, "request_info: 'info_requested'") },
      { from: 'info_requested', to: 'info_requested', label: 'request_info (repeat)', by: AOA, description: 'Not prevented; each repeat records another simulated email and audit row.', source: src(SO, 113, 116, 'return !isTerminalOpsStatus(status)'), confidence: 'inferred' },
    ],
    sources: [
      src(SO, 77, 116, 'export function canApplyAction', 'Transition table, terminal statuses and the guard'),
      src(R, 273, 290, 'canApplyAction(currentStatus, input.action)', 'Where the guard and the transition are applied'),
      src(FILES.shTypes, 36, 43, 'OPS_REQUEST_STATUSES', 'The five status values'),
      src(FILES.shOperationsTest, 70, 83, 'blocks every action once the request is terminal'),
    ],
  },
  {
    id: 'sm:onboarding-application-status',
    name: 'Onboarding application status',
    summary: 'An application is submitted by the public form and then, by an operator decision on its linked request, either provisioned into a real account or rejected.',
    subject: 'db:OnboardingApplication',
    field: 'OnboardingApplication.status',
    initial: 'submitted',
    states: [
      { id: 'submitted', label: 'Submitted', description: 'Queued for review. No user, account or money exists. Counts toward the 3-per-email cap.' },
      { id: 'provisioned', label: 'Provisioned', terminal: true, description: 'Approved: the User, Account, owner grant and any opening deposit were created; `provisionedUserId` and `provisionedAccountId` are set.' },
      { id: 'rejected', label: 'Rejected', terminal: true, description: 'Declined by an operator; nothing was created and a simulated decline email was recorded.' },
    ],
    transitions: [
      {
        from: 'submitted',
        to: 'provisioned',
        label: 'operator approves the request',
        by: 'be:ops/onboarding#provisionApprovedOnboarding',
        description: 'Runs inside the approval transaction of applyOperatorAction, after onboardingApprovalBlocker has confirmed the application is still submitted and the email is free.',
        source: src(O, 359, 363, "status: 'provisioned'"),
      },
      {
        from: 'submitted',
        to: 'rejected',
        label: 'operator rejects the request',
        by: 'be:ops/onboarding#rejectOnboardingApplication',
        description: 'Runs inside the rejection transaction of applyOperatorAction.',
        source: src(O, 404, 409, "status: 'rejected'"),
      },
    ],
    sources: [src(FILES.shOnboarding, 37, 39, 'ONBOARDING_STATUSES'), src(O, 151, 155, "status: 'submitted'", 'Initial status at submission'), src(FILES.schema, 235, 239, 'submitted | provisioned | rejected')],
  },
  {
    id: 'sm:invitation-status',
    name: 'Joint invitation status',
    summary: 'An invitation is pending until the invitee accepts (gaining access to the account) or declines.',
    subject: 'db:AccountInvitation',
    field: 'AccountInvitation.status',
    initial: 'pending',
    states: [
      { id: 'pending', label: 'Pending', description: 'Created by an owner (or by onboarding provisioning). Counts toward the 10-per-account cap.' },
      { id: 'accepted', label: 'Accepted', terminal: true, description: 'The invitee holds an AccountAccess grant; `acceptedById` and `respondedAt` are set.' },
      { id: 'declined', label: 'Declined', terminal: true, description: 'The invitee declined; `respondedAt` is set, no grant exists.' },
      { id: 'revoked', label: 'Revoked', terminal: true, description: 'Listed in INVITATION_STATUSES, but no endpoint or service at this commit moves an invitation here.' },
    ],
    transitions: [
      { from: 'pending', to: 'accepted', label: 'invitee accepts', by: 'be:ops/invitations#acceptInvitation', description: 'In one transaction: upsert the AccountAccess grant, mark accepted, audit.', source: src(I, 202, 211, "status: 'accepted'") },
      { from: 'pending', to: 'declined', label: 'invitee declines', by: 'be:ops/invitations#declineInvitation', description: 'Mark declined and audit; no access change.', source: src(I, 246, 249, "status: 'declined'") },
    ],
    sources: [src(FILES.shOnboarding, 41, 43, 'INVITATION_STATUSES'), src(I, 77, 88, "status: 'pending'", 'Initial status'), src(FILES.schema, 265, 276, 'pending | accepted | declined | revoked')],
  },
];

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export const glossary: GlossaryTerm[] = [
  {
    term: 'Operations request',
    definition:
      'A work item for bank staff, stored as one `OperationsRequest` row. It has a type (onboarding, deposit, ach, wire, bill_pay, fraud_alert, dispute…), a status, a priority, a human summary, a display-only subject (name and email, not a foreign key) and a JSON payload with type-specific context. Customers create them indirectly — by applying for an account, submitting a reviewable payment or disputing a charge.',
    related: ['db:OperationsRequest', 'sh:operations#OperationsRequestDTO', 'be:ops/requests', EP.list],
    aliases: ['request', 'queue item', 'work item', 'ops request'],
  },
  {
    term: 'Queue (lane)',
    definition:
      'A display grouping of request types in the operations console: Onboarding & identity, Deposits & transfers, Fraud & disputes, Support. There is one table and one list endpoint; the lane is computed on the client from the request type with `queueForType`.',
    related: ['sh:operations#OPS_QUEUES', 'sh:operations#queueForType', 'op:pages/RequestQueues'],
    aliases: ['request queue', 'lane', 'work queue'],
  },
  {
    term: 'Operator action',
    definition:
      'What a staff member does to a request. Four are decisions that change its status — approve (→ approved), reject (→ rejected), hold (→ on_hold), request info (→ info_requested) — and one, note, only adds an audit entry. Decisions are allowed while the request is pending, on hold or info-requested; a note is allowed at any time. Every action writes an `ops_<action>` AuditLog row.',
    related: ['sh:operations#OPS_ACTIONS', 'sh:operations#OPS_NOTE_ACTION', 'sh:operations#canApplyAction', AOA, EP.action],
    aliases: ['approve', 'reject', 'hold', 'request info', 'note', 'decision'],
  },
  {
    term: 'Terminal status',
    definition:
      'A request status from which no further decision is possible: `approved` or `rejected`. Reaching one stamps `resolvedAt`. A decision sent afterwards is refused with 409 `already_resolved`; notes are still accepted, and an approved money movement can still be reversed.',
    related: ['sh:operations#TERMINAL_OPS_STATUSES', 'sh:operations#isTerminalOpsStatus', 'be:ops/requests#OpsActionError'],
    aliases: ['resolved', 'already resolved'],
  },
  {
    term: 'Payload / soft link (ledgerEntryIds)',
    definition:
      'The `payload` column of an operations request is a JSON string of context. For money movements it is a `MovementPayload` whose `ledgerEntryIds` array names the pending LedgerEntry rows the request controls. There is no foreign key between the two tables — the ids inside the JSON are the only link — so approving, rejecting or reversing works by `updateMany` on those ids with a status precondition.',
    related: ['db:OperationsRequest', 'db:LedgerEntry', 'be:money/movements#movementPayloadOf', 'be:money/movements#postApprovedMovement'],
    aliases: ['MovementPayload', 'ledgerEntryIds', 'soft link', 'payload'],
  },
  {
    term: 'Simulated event',
    definition:
      'A `SimulatedEvent` row standing in for a message to or from the outside world — an email, SMS, MFA challenge or identity check. Nothing is ever sent; the row carries a "SIMULATION" disclaimer and is shown in the operations console feed, pushed live as `ops:external_event`. Events are created automatically by workflows (application received, movement posted, invitation sent) or by hand from the console.',
    related: ['db:SimulatedEvent', 'sh:operations#SimulatedEventDTO', 'be:ops/requests#createSimulatedEvent', EP.simulate, 'ev:ops:external_event'],
    aliases: ['external event', 'simulated email', 'simulated SMS', 'simulated messaging'],
  },
  {
    term: 'Provisioning',
    definition:
      'What happens when an operator approves an onboarding request: in one transaction the applicant becomes a real `User` (role customer, with the password hash captured at application time), an `Account` is opened with an `owner` AccountAccess grant, and any opening deposit is posted as a bank-originated `deposit` ledger entry. Before approval none of these exist.',
    related: ['be:ops/onboarding#provisionApprovedOnboarding', 'be:ops/onboarding#onboardingApprovalBlocker', 'db:OnboardingApplication', 'feat:onboarding'],
    aliases: ['account opening', 'onboarding approval', 'initial funding', 'opening deposit'],
  },
  {
    term: 'Joint invitation',
    definition:
      'An `AccountInvitation` from an account owner to another person, identified by email. It is matched to whichever signed-in user has that email. Accepting it creates an `AccountAccess` row (normally relationship `joint`), which is all the access rules need for the invitee to see and use the account.',
    related: ['db:AccountInvitation', 'db:AccountAccess', 'be:ops/invitations#inviteJoint', 'be:ops/invitations#acceptInvitation', EP.invite, 'feat:invitations'],
    aliases: ['joint owner invitation', 'invite', 'shared account'],
  },
  {
    term: 'Reversal tag',
    definition:
      'The secondary "Reversed" badge the console shows next to a request\'s status when `payload.reversed === true`. A reversed movement, an upheld dispute and a confirmed fraud all keep the request in its terminal status and set that flag, while the linked ledger entry is re-statused to `reversed` and stops counting toward any balance.',
    related: ['sh:operations#isRequestReversed', EP.reverse, 'be:money/movements#reverseMovement', 'op:components/RequestDetailPanel'],
    aliases: ['Reversed badge', 'reversed', 'reverse movement'],
  },
];
