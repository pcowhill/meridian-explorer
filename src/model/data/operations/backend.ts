import type { Entity, Relation } from '../../types';
import { FILES, rel, src, sym } from './helpers';

const REQ = 'be:ops/requests';
const ADM = 'be:ops/admin-users';
const ONB = 'be:ops/onboarding';
const INV = 'be:ops/invitations';
const R = FILES.requests;
const A = FILES.adminUsers;
const O = FILES.onboarding;
const I = FILES.invitations;

// ---------------------------------------------------------------------------
// apps/backend/src/ops/requests.ts
// ---------------------------------------------------------------------------

const requestsEntities: Entity[] = [
  {
    id: REQ,
    kind: 'module',
    name: 'ops/requests.ts',
    parent: 'be.ops',
    summary:
      'The operations-queue service: lists and loads requests, applies operator actions (dispatching to the per-type money, onboarding, dispute and fraud effects) and records simulated events.',
    description:
      'The single place that reads and mutates `OperationsRequest` rows on behalf of operators, so the routes stay thin. Reads map rows to DTOs and sort the queue. `applyOperatorAction` is the state-machine driver: it validates the action against the current status with the shared predicates, writes the new status and an AuditLog row, and — depending on the request type — runs the domain effect inside the same database transaction.\n\nThe file header still carries the v0.5.0 note that an operator action "never writes a LedgerEntry". That is true of this file\'s own code, but since v0.7.0 approving or rejecting a money-movement request calls `postApprovedMovement` / `failMovement`, which re-status the linked ledger entries, and approving an onboarding request inserts a posted opening-deposit entry.',
    audience: {
      executive: 'Where a staff decision is recorded and turned into its real effect — a payment posting, an account opening, a refund.',
      'end-user': 'The part of the bank that applies what an employee decides about your request.',
      dba: 'Reads and updates OperationsRequest; inserts AuditLog and SimulatedEvent; delegates LedgerEntry, User, Account and Card writes to other services inside one transaction.',
    },
    tech: ['TypeScript', 'Prisma'],
    tags: ['operations', 'workflow', 'audit', 'money'],
    aliases: ['ops service', 'request queue service', 'operator actions'],
    sources: [src(R, 33, 42, 'Operations-simulator domain service', 'Header comment'), { file: R }],
  },
  sym(REQ, 'OpsActionError', 'class', 'Typed failure thrown by `applyOperatorAction`; the route maps its `code` to an HTTP status.', {
    description: 'Carries `code: OpsActionErrorCode`. The route turns `not_found` into 404, `already_resolved` into 409 and `invalid_action` into 400.',
    values: [
      { value: 'not_found', meaning: 'No OperationsRequest has that id → 404.' },
      { value: 'already_resolved', meaning: 'A decision was sent for a request that is already approved or rejected → 409.' },
      { value: 'invalid_action', meaning: 'An empty note, or an onboarding approval blocked by `onboardingApprovalBlocker` → 400.' },
    ],
    tags: ['operations', 'validation'],
    aliases: ['OpsActionErrorCode'],
    sources: [src(R, 50, 60, 'export class OpsActionError')],
  }),
  sym(REQ, 'toOperationsRequestDTO', 'function', 'Maps an OperationsRequest row to the DTO sent to consoles: parses the JSON payload and ISO-formats the dates.', {
    signature: 'toOperationsRequestDTO(row: OperationsRequest): OperationsRequestDTO',
    description:
      'The `payload` column is a JSON string; a private `parseJson` turns it into an object and tolerates null or malformed text (→ null). `lastActorId` and `lastActorRole` are dropped. Also imported by the money-movement, dispute, fraud and onboarding services, so every `ops:request_changed` push has the same shape.',
    tags: ['operations', 'types'],
    sources: [src(R, 75, 93, 'export function toOperationsRequestDTO'), src(R, 64, 73, 'function parseJson')],
  }),
  sym(REQ, 'toSimulatedEventDTO', 'function', 'Maps a SimulatedEvent row to its DTO (the `metadata` column is not exposed).', {
    signature: 'toSimulatedEventDTO(row: SimulatedEvent): SimulatedEventDTO',
    tags: ['operations', 'integration', 'types'],
    sources: [src(R, 95, 107, 'export function toSimulatedEventDTO')],
  }),
  sym(REQ, 'listOperationsRequests', 'function', 'Returns the queue, optionally filtered by status and type, sorted so the most pressing work comes first.', {
    signature: 'listOperationsRequests(prisma: PrismaClient, query: OperationsQueueQuery = {}): Promise<OperationsRequestDTO[]>',
    description:
      'One `findMany` with an optional `where`. Sorting happens in memory after mapping: still-actionable items before resolved ones, then priority high → normal → low, then newest `createdAt` first. There is no pagination.',
    tags: ['operations'],
    sources: [src(R, 133, 156, 'export async function listOperationsRequests'), src(R, 130, 131, 'PRIORITY_WEIGHT')],
  }),
  sym(REQ, 'getOperationsRequestDetail', 'function', 'Loads one request with its action history (from the audit trail) and its linked simulated events; null if unknown.', {
    signature: 'getOperationsRequestDetail(prisma: PrismaClient, id: string): Promise<OperationsRequestDetailDTO | null>',
    description:
      'History is every AuditLog row with `entity = "operations_request"` and `entityId = id`, oldest first. Each is mapped by a private `toOperatorActionLogDTO`: the `ops_` prefix is stripped from the action (`ops_request_created` becomes `created`), the actor name comes from the JSON metadata and the note from `reason`. Events are SimulatedEvent rows with that `requestId`, newest first.\n\nAudit rows that domain services write against other entities (for example `movement_posted` on `ledger_entry`) do not appear in this history.',
    tags: ['operations', 'audit'],
    sources: [src(R, 158, 182, 'export async function getOperationsRequestDetail'), src(R, 109, 126, 'function toOperatorActionLogDTO')],
  }),
  sym(REQ, 'listSimulatedEvents', 'function', 'Returns recent simulated events across all channels, newest first, with the limit clamped to 1–200.', {
    signature: 'listSimulatedEvents(prisma: PrismaClient, limit = 50): Promise<SimulatedEventDTO[]>',
    tags: ['operations', 'integration'],
    sources: [src(R, 184, 194, 'export async function listSimulatedEvents')],
  }),
  sym(REQ, 'AppliedAction', 'type', 'What `applyOperatorAction` returns: the updated request plus any simulated events the route should broadcast.', {
    fields: [
      { name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'event', type: 'SimulatedEventDTO | null', required: true, typeRef: 'sh:operations#SimulatedEventDTO', description: 'A single auto-generated event (request_info email, movement failed, application declined), or null.' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: false, description: 'Additional events from a domain effect (movement posted, account opened, joint invitation, dispute / fraud notices).' },
      { name: 'provisioned', type: '{ userId: string; accountId: string; fundingMinor: number } | null', required: false, description: 'Set when an onboarding approval created a user and account. The route does not return it to the client.' },
    ],
    tags: ['operations', 'types'],
    sources: [src(R, 198, 210, 'export interface AppliedAction')],
  }),
  sym(REQ, 'applyOperatorAction', 'function', "Applies one operator action to a request: validates it against the current status, records it, and runs the request type's approve / reject effect atomically.", {
    signature:
      'applyOperatorAction(prisma: PrismaClient, input: { id: string; action: OpsAction; note?: string | null; actor: SessionUser }, now: Date = new Date()): Promise<AppliedAction>',
    description:
      'Order of work:\n1. Load the request; unknown id → `OpsActionError("not_found")`.\n2. `note`: require non-empty text, touch `updatedAt` (so every console re-syncs), write an `ops_note` audit row, return. Allowed in any status.\n3. Decisions: `canApplyAction(currentStatus, action)` must hold, else `already_resolved`. The next status comes from `nextStatusForAction`; `resolvedAt` is set to `now` only for approved / rejected.\n4. Dispatch on request type and action. Each branch opens `prisma.$transaction`, updates the request, writes the `ops_<action>` audit row, then calls the domain effect with the transaction client:\n   • onboarding + approve → `onboardingApprovalBlocker` first (outside the transaction), then `provisionApprovedOnboarding`.\n   • onboarding + reject → `rejectOnboardingApplication`.\n   • a request with a movement payload + approve → `postApprovedMovement` (pending → posted).\n   • movement + reject → `failMovement` (pending → failed).\n   • dispute + approve / reject → `upholdDispute` / `denyDispute`.\n   • fraud_alert + approve / reject → `confirmFraud` / `dismissFraud`.\n5. Everything else (hold and request_info on any type; approve / reject on types with no effect) is workflow-only: update + audit without a transaction. `request_info` also records a simulated outbound email via `createSimulatedEvent`.\n\n`now` is supplied by the route as the SIMULATED time, so `resolvedAt`, `updatedAt` and the posted ledger entry are dated by the simulation clock. AuditLog rows take the database default (wall clock).',
    audience: {
      executive: 'The step where a staff decision takes effect: the request is marked, the action is logged, and the payment, account or refund happens in one all-or-nothing operation.',
      'end-user': 'When a bank employee approves or rejects your request, this is what makes it final.',
      dba: 'Updates one OperationsRequest row and inserts one AuditLog row per action; for approve / reject of typed requests the update, the audit insert and the domain writes share one transaction.',
    },
    detail: 3,
    tags: ['operations', 'workflow', 'audit', 'money', 'onboarding', 'risk'],
    aliases: ['approve request', 'reject request', 'operator action', 'state machine driver'],
    sources: [
      src(R, 212, 234, 'export async function applyOperatorAction', 'Doc comment + signature'),
      src(R, 235, 291, 'canApplyAction(currentStatus, input.action)', 'Lookup, note branch, transition guard, decision data'),
      src(R, 293, 357, 'postApprovedMovement(tx, existing, input.actor, now)', 'Onboarding and money-movement branches'),
      src(R, 359, 412, 'createSimulatedEvent', 'Dispute, fraud and workflow-only branches'),
    ],
  }),
  sym(REQ, 'createSimulatedEvent', 'function', 'Records a simulated external event (SMS, email, MFA or identity) and audits it. It never contacts a real provider.', {
    signature: 'createSimulatedEvent(prisma: DbClient, input: SimulateEventRequest, actor: SessionUser, now: Date = new Date()): Promise<SimulatedEventDTO>',
    description:
      'Fills defaults (outcome per channel: sms → delivered, email → sent, mfa / identity → pending; direction → outbound; summary → "Simulated <CHANNEL> <kind|message>"). A `requestId` is kept only if that request exists, which keeps the foreign key clean. Inserts the SimulatedEvent with the fixed detail "SIMULATION — no real message was sent to any provider." and writes an `ops_simulate_event` audit row.',
    tags: ['operations', 'integration', 'audit'],
    aliases: ['simulate event', 'fake SMS', 'fake email'],
    sources: [src(R, 429, 480, 'export async function createSimulatedEvent'), src(R, 414, 427, 'DEFAULT_OUTCOME')],
  }),
];

// ---------------------------------------------------------------------------
// apps/backend/src/ops/admin-users.ts
// ---------------------------------------------------------------------------

const adminEntities: Entity[] = [
  {
    id: ADM,
    kind: 'module',
    name: 'ops/admin-users.ts',
    parent: 'be.ops',
    summary: 'Admin-initiated user provisioning: create a user and optionally open and fund an account for them.',
    description:
      'Funding here is a bank-originated `adjustment` ledger entry, which by the project\'s money rules needs a reason and an audit row — enforced by the shared validator and again by what this service writes.',
    tech: ['TypeScript', 'Prisma', 'bcrypt'],
    tags: ['operations', 'security', 'audit', 'money'],
    aliases: ['admin create user', 'demo user provisioning'],
    sources: [src(A, 11, 17, 'Admin-initiated demo-user provisioning', 'Header comment'), { file: A }],
  },
  sym(ADM, 'AdminUserError', 'class', "Typed failure of `adminCreateUser`; its only code is `conflict` (the email is taken), mapped to 409.", {
    values: [{ value: 'conflict', meaning: 'A user with that email already exists → 409.' }],
    tags: ['operations', 'validation'],
    aliases: ['AdminUserErrorCode'],
    sources: [src(A, 19, 28, 'export class AdminUserError')],
  }),
  sym(ADM, 'adminCreateUser', 'function', 'Creates a user and, if asked, an account with an owner grant and an audited opening adjustment — all in one transaction.', {
    signature: 'adminCreateUser(input: NormalizedAdminCreateUser, actor: SessionUser, now: Date = new Date()): Promise<AdminCreateUserResponse>',
    description:
      'Checks the email is free (else `AdminUserError("conflict")`), hashes the password, then in one transaction: inserts the User; if a product was chosen inserts the Account and an `owner` AccountAccess row; if funding > 0 inserts a posted `adjustment` credit LedgerEntry carrying the reason plus an `admin_adjustment` audit row; finally writes an `admin_create_user` audit row. Returns the user, the account summary and the demo password.',
    tags: ['operations', 'security', 'audit', 'money'],
    sources: [src(A, 30, 60, 'export async function adminCreateUser'), src(A, 64, 96, "origin: 'adjustment'", 'Audited opening adjustment'), src(A, 98, 128, 'admin_create_user')],
  }),
];

// ---------------------------------------------------------------------------
// apps/backend/src/ops/onboarding.ts
// ---------------------------------------------------------------------------

const onboardingEntities: Entity[] = [
  {
    id: ONB,
    kind: 'module',
    name: 'ops/onboarding.ts',
    parent: 'be.onboarding',
    summary:
      'Account-opening service in two halves: a public submission that only queues an application, and provisioning that runs when an operator approves it.',
    description:
      '`submitApplication` records an OnboardingApplication and a linked `onboarding` OperationsRequest and emits simulated identity / MFA / email events. It creates no user, no account and no money.\n\n`provisionApprovedOnboarding` runs only from `applyOperatorAction` on approve, inside its transaction. It creates the User, the Account and the owner grant; if the applicant chose an opening deposit it posts a bank-originated `deposit` credit (audited). Money enters the system only through that entry.',
    audience: {
      executive: 'Applying is free and creates nothing; the account only exists once a member of staff approves the application.',
      'end-user': 'You apply online, a bank employee reviews it, and on approval your account is opened and you can sign in.',
      dba: 'Submit inserts OperationsRequest, OnboardingApplication, AuditLog and three SimulatedEvent rows. Approval inserts User, Account, AccountAccess, optionally LedgerEntry and AccountInvitation, and updates OnboardingApplication.',
    },
    tech: ['TypeScript', 'Prisma', 'bcrypt'],
    tags: ['onboarding', 'operations', 'money', 'audit'],
    aliases: ['account opening', 'application service', 'provisioning'],
    sources: [src(O, 19, 34, 'Onboarding & account-opening domain service', 'Header comment'), { file: O }],
  },
  sym(ONB, 'generateReference', 'function', 'Generates the short application reference shown to the applicant: `MER-` plus six upper-case hex characters.', {
    signature: 'generateReference(): string',
    example: 'MER-7C41D9',
    tags: ['onboarding'],
    sources: [src(O, 39, 42, 'export function generateReference')],
  }),
  sym(ONB, 'toOnboardingApplicationSummary', 'function', 'Maps an application row to the operator-facing summary, leaving out the password hash.', {
    signature: 'toOnboardingApplicationSummary(row: OnboardingApplication): OnboardingApplicationSummary',
    description: 'Exported but not called anywhere else at this commit; the console reads application context from the request payload instead.',
    detail: 5,
    tags: ['onboarding', 'types'],
    sources: [src(O, 44, 57, 'export function toOnboardingApplicationSummary')],
  }),
  sym(ONB, 'SubmittedApplication', 'type', 'Result of `submitApplication`: the reference, the queued request DTO and the simulated events to broadcast.', {
    fields: [
      { name: 'reference', type: 'string', required: true },
      { name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(O, 88, 93, 'export interface SubmittedApplication')],
  }),
  sym(ONB, 'ApplicationLimitError', 'class', "Thrown when an email already has the maximum number of unreviewed applications; code `limit_reached`, mapped to 409.", {
    values: [{ value: 'limit_reached', meaning: 'Three applications with status `submitted` already exist for this email → 409.' }],
    tags: ['onboarding', 'validation', 'public-demo'],
    sources: [src(O, 101, 108, 'export class ApplicationLimitError')],
  }),
  sym(ONB, 'submitApplication', 'function', 'Queues an account-opening application: hashes the password, writes the request, the application, an intake audit row and three simulated events.', {
    signature: 'submitApplication(input: NormalizedOpenAccount, now: Date = new Date()): Promise<SubmittedApplication>',
    description:
      'Steps, in order (not wrapped in a transaction):\n1. Count applications with this email and status `submitted`; at 3 (`RESOURCE_CAPS.pendingApplicationsPerEmail`) throw `ApplicationLimitError`.\n2. Generate the reference and bcrypt-hash the password.\n3. Insert an OperationsRequest: type `onboarding`, status `pending`, priority `normal`, subject = applicant, payload = { reference, product, initialFundingMinor, jointInviteEmail }.\n4. Insert the OnboardingApplication (status `submitted`, the hash, `consentAt`, `requestId`).\n5. Write an `ops_request_created` audit row with actorRole `system`.\n6. Record three simulated events linked to the request: email `application_received` (sent), identity `verification` (pending), mfa `enrollment` (pending).\n\nIt does not check whether the email already belongs to a user.',
    detail: 3,
    tags: ['onboarding', 'operations', 'audit', 'security'],
    aliases: ['apply for account', 'open account'],
    sources: [
      src(O, 110, 149, 'export async function submitApplication', 'Cap, hash, queue item'),
      src(O, 151, 177, 'prisma.onboardingApplication.create', 'Application row + intake audit'),
      src(O, 179, 227, "kind: 'application_received'", 'Simulated events'),
    ],
  }),
  sym(ONB, 'ProvisionResult', 'type', 'Result of provisioning: the new user and account ids, the funded amount, any invitation id and the simulated events.', {
    fields: [
      { name: 'userId', type: 'string', required: true },
      { name: 'accountId', type: 'string', required: true },
      { name: 'fundingMinor', type: 'number', required: true },
      { name: 'invitationId', type: 'string | null', required: true },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(O, 229, 236, 'export interface ProvisionResult')],
  }),
  sym(ONB, 'onboardingApprovalBlocker', 'function', 'Pre-flight check before an onboarding approval: returns a reason string if provisioning must not go ahead, else null.', {
    signature: "onboardingApprovalBlocker(request: Pick<OperationsRequest, 'id' | 'type'>): Promise<string | null>",
    description:
      'Blocks when the linked application is no longer `submitted` ("already been provisioned or rejected") or when a User with the applicant\'s email already exists. Returns null — approve as a plain workflow item — for a non-onboarding request or an onboarding request with no application row (a seeded item). It runs before the transaction, so a blocked approval changes nothing and the request stays actionable.',
    tags: ['onboarding', 'validation'],
    sources: [src(O, 238, 259, 'export async function onboardingApprovalBlocker')],
  }),
  sym(ONB, 'provisionApprovedOnboarding', 'function', 'Turns an approved application into a real customer: User, Account, owner grant, optional opening deposit and optional joint invitation.', {
    signature:
      'provisionApprovedOnboarding(tx: DbClient, requestId: string, actor: { id: string; role: string; displayName: string }, now: Date): Promise<ProvisionResult | null>',
    description:
      'Must be given a transaction client so it commits or rolls back with the request\'s status change. Returns null (no-op) when the request has no `submitted` application.\n1. Insert the User: role `customer`, status `active`, the bcrypt hash captured at apply time.\n2. Insert the Account (type = product, name from `ONBOARDING_PRODUCT_LABELS`, `openedAt = now`) and an `owner` AccountAccess row.\n3. If `initialFundingMinor > 0`: insert a LedgerEntry — credit, `posted`, origin `deposit`, "Opening deposit (simulated)", `postedAt = now` — and an `onboarding_initial_funding` audit row.\n4. If a joint invite email was given: `createInvitationRecord` (pending, relationship `joint`) and a simulated invitation email.\n5. Update the application to `provisioned` with the new user and account ids; write an `onboarding_provisioned` audit row.\n6. Record an identity `verification` event with status `approved` ("Identity verified — <account> opened"), placed first in the returned events.',
    audience: {
      executive: 'The moment a new customer comes into existence: login, account and opening balance are created together when staff approve.',
      dba: 'Inserts User, Account, AccountAccess; conditionally LedgerEntry (posted deposit credit) and AccountInvitation; updates OnboardingApplication; inserts 1–2 AuditLog and 1–2 SimulatedEvent rows — all on the caller\'s transaction.',
    },
    detail: 3,
    tags: ['onboarding', 'money', 'ledger', 'audit', 'rbac'],
    aliases: ['provisioning', 'open account on approval', 'initial funding'],
    sources: [
      src(O, 261, 301, 'export async function provisionApprovedOnboarding', 'User, account, owner grant'),
      src(O, 303, 327, "origin: 'deposit'", 'Bank-originated opening deposit + audit'),
      src(O, 329, 393, 'createInvitationRecord', 'Joint invitation, mark provisioned, account-opened event'),
    ],
  }),
  sym(ONB, 'rejectOnboardingApplication', 'function', 'Marks the linked application `rejected` and records a simulated "declined" email; no-op without a submitted application.', {
    signature: 'rejectOnboardingApplication(tx: DbClient, requestId: string, now: Date): Promise<SimulatedEventDTO | null>',
    tags: ['onboarding'],
    sources: [src(O, 395, 421, 'export async function rejectOnboardingApplication')],
  }),
];

// ---------------------------------------------------------------------------
// apps/backend/src/ops/invitations.ts
// ---------------------------------------------------------------------------

const invitationEntities: Entity[] = [
  {
    id: INV,
    kind: 'module',
    name: 'ops/invitations.ts',
    parent: 'be.onboarding',
    summary: 'Joint-account invitations: an owner invites someone by email; accepting creates the AccountAccess grant that lets the invitee see the account.',
    description:
      'The invitation is "delivered" only as a SimulatedEvent — no email is sent. Matching is by email address: an invitation belongs to whichever signed-in user has that email. Accepting writes the same `AccountAccess` row the access rules already read, so no other code changes for the invitee to see the account. Accepting moves no money.',
    audience: {
      executive: 'How an account owner shares an account with another person.',
      dba: 'Inserts and updates AccountInvitation; accept upserts AccountAccess on the unique (userId, accountId) pair.',
    },
    tech: ['TypeScript', 'Prisma'],
    tags: ['onboarding', 'rbac', 'audit'],
    aliases: ['joint invitations', 'share account'],
    sources: [src(I, 15, 21, 'Joint-account invitations', 'Header comment'), { file: I }],
  },
  sym(INV, 'InvitationError', 'class', 'Typed failure of the invitation functions; the route maps its `code` to 404, 403 or 409.', {
    values: [
      { value: 'not_found', meaning: 'No invitation with that id → 404.' },
      { value: 'forbidden', meaning: 'Declared and mapped to 403, but not thrown by this module at this commit.' },
      { value: 'wrong_invitee', meaning: "The invitation's email is not the signed-in user's email → 403." },
      { value: 'already_responded', meaning: 'The invitation is no longer pending → 409.' },
      { value: 'limit_reached', meaning: 'The account already has 10 pending invitations → 409.' },
    ],
    tags: ['onboarding', 'validation'],
    aliases: ['InvitationErrorCode'],
    sources: [src(I, 23, 37, 'export class InvitationError')],
  }),
  sym(INV, 'toInvitationDTO', 'function', 'Maps an AccountInvitation row (plus the account and inviter names) to its DTO; the token is left out.', {
    signature: 'toInvitationDTO(row: AccountInvitation, extra: { accountName: string | null; invitedByName: string | null }): AccountInvitationDTO',
    tags: ['onboarding', 'types'],
    sources: [src(I, 43, 61, 'export function toInvitationDTO')],
  }),
  sym(INV, 'createInvitationRecord', 'function', 'Inserts a pending AccountInvitation row with a random 48-hex-character token and a lower-cased invitee email.', {
    signature:
      'createInvitationRecord(db: DbClient, input: { accountId: string; invitedById: string; inviteeEmail: string; relationship: AccountRelationship }, now: Date): Promise<AccountInvitation>',
    description: 'The low-level writer shared by the customer invite route (`inviteJoint`) and onboarding provisioning, which calls it on its transaction client.',
    tags: ['onboarding'],
    sources: [src(I, 63, 89, 'export async function createInvitationRecord')],
  }),
  sym(INV, 'CreatedInvitation', 'type', 'Result of `inviteJoint`: the invitation DTO and the simulated "invitation sent" email.', {
    fields: [
      { name: 'invitation', type: 'AccountInvitationDTO', required: true, typeRef: 'sh:onboarding#AccountInvitationDTO' },
      { name: 'event', type: 'SimulatedEventDTO', required: true, typeRef: 'sh:operations#SimulatedEventDTO' },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(I, 91, 95, 'export interface CreatedInvitation')],
  }),
  sym(INV, 'inviteJoint', 'function', 'An owner invites a joint owner: enforce the pending-invitation cap, insert the invitation, record a simulated email and an audit row.', {
    signature:
      'inviteJoint(input: { accountId: string; accountName: string; inviter: SessionUser; inviteeEmail: string; relationship: AccountRelationship }, now: Date = new Date()): Promise<CreatedInvitation>',
    description:
      'The route has already confirmed the caller owns the account. Counts pending invitations on the account; at 10 (`RESOURCE_CAPS.pendingInvitationsPerAccount`) throws `InvitationError("limit_reached")`. The simulated email is not linked to any operations request. Audit action: `invitation_created`.',
    tags: ['onboarding', 'rbac', 'audit'],
    sources: [src(I, 97, 131, 'export async function inviteJoint'), src(I, 133, 166, 'invitation_created')],
  }),
  sym(INV, 'listInvitationsForUser', 'function', "Lists the pending invitations addressed to the signed-in user's email, newest first, with account and inviter names.", {
    signature: 'listInvitationsForUser(user: SessionUser): Promise<AccountInvitationDTO[]>',
    tags: ['onboarding'],
    sources: [src(I, 168, 178, 'export async function listInvitationsForUser')],
  }),
  sym(INV, 'acceptInvitation', 'function', 'Accepts an invitation addressed to this user: grants the access row and marks the invitation accepted, in one transaction.', {
    signature: 'acceptInvitation(invitationId: string, user: SessionUser, now: Date = new Date()): Promise<AccountInvitationDTO>',
    description:
      'Checks, in order: the invitation exists (`not_found`), its email equals the user\'s email case-insensitively (`wrong_invitee`), it is still pending (`already_responded`). Then in one transaction: upsert AccountAccess on (userId, accountId) — an existing grant is left as is — update the invitation to `accepted` with `acceptedById` and `respondedAt`, and write an `invitation_accepted` audit row.',
    detail: 3,
    tags: ['onboarding', 'rbac', 'audit'],
    sources: [src(I, 180, 227, 'export async function acceptInvitation')],
  }),
  sym(INV, 'declineInvitation', 'function', 'Declines an invitation addressed to this user: marks it declined and writes an audit row. No access is granted.', {
    signature: 'declineInvitation(invitationId: string, user: SessionUser, now: Date = new Date()): Promise<AccountInvitationDTO>',
    description: 'Same three checks as accept. The update and the `invitation_declined` audit row are separate statements, not a transaction.',
    tags: ['onboarding', 'audit'],
    sources: [src(I, 229, 263, 'export async function declineInvitation')],
  }),
];

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

const AOA = `${REQ}#applyOperatorAction`;
const SUBMIT = `${ONB}#submitApplication`;
const PROVISION = `${ONB}#provisionApprovedOnboarding`;

const relations: Relation[] = [
  // ---- requests.ts reads -----------------------------------------------------
  rel(`${REQ}#listOperationsRequests`, 'db:OperationsRequest', 'reads', 'findMany({ where: { status?, type? } })', {
    summary: 'One query for the (optionally filtered) queue; sorting is done in memory.',
    sources: [src(R, 142, 146, 'prisma.operationsRequest.findMany')],
  }),
  rel(`${REQ}#listOperationsRequests`, `${REQ}#toOperationsRequestDTO`, 'calls', 'rows.map(toOperationsRequestDTO)', { sources: [src(R, 147, 148, 'toOperationsRequestDTO')] }),
  rel(`${REQ}#listOperationsRequests`, 'sh:operations#isTerminalOpsStatus', 'calls', 'isTerminalOpsStatus(a.status)', {
    summary: 'Resolved items sort after actionable ones.',
    sources: [src(R, 149, 151, 'isTerminalOpsStatus(a.status)')],
  }),
  rel(`${REQ}#listOperationsRequests`, 'sh:operations#OperationsQueueQuery', 'uses-type', 'query: OperationsQueueQuery', { sources: [src(R, 138, 141, 'OperationsQueueQuery')] }),
  rel(`${REQ}#toOperationsRequestDTO`, 'sh:operations#OperationsRequestDTO', 'uses-type', 'returns OperationsRequestDTO', { sources: [src(R, 75, 76, 'OperationsRequestDTO')] }),
  rel(`${REQ}#toSimulatedEventDTO`, 'sh:operations#SimulatedEventDTO', 'uses-type', 'returns SimulatedEventDTO', { sources: [src(R, 95, 96, 'SimulatedEventDTO')] }),
  rel(`${REQ}#getOperationsRequestDetail`, 'db:OperationsRequest', 'reads', 'findUnique({ where: { id } })', { order: 1, sources: [src(R, 166, 167, 'prisma.operationsRequest.findUnique')] }),
  rel(`${REQ}#getOperationsRequestDetail`, 'db:AuditLog', 'reads', "findMany({ entity: 'operations_request', entityId: id }) oldest first", {
    order: 2,
    summary: 'The request history IS the audit trail filtered to this request.',
    sources: [src(R, 169, 173, 'prisma.auditLog.findMany')],
  }),
  rel(`${REQ}#getOperationsRequestDetail`, 'db:SimulatedEvent', 'reads', 'findMany({ requestId: id }) newest first', { order: 3, sources: [src(R, 174, 174, 'prisma.simulatedEvent.findMany')] }),
  rel(`${REQ}#getOperationsRequestDetail`, 'sh:operations#OperationsRequestDetailDTO', 'uses-type', 'returns OperationsRequestDetailDTO | null', { sources: [src(R, 162, 165, 'OperationsRequestDetailDTO')] }),
  rel(`${REQ}#listSimulatedEvents`, 'db:SimulatedEvent', 'reads', 'findMany({ orderBy: createdAt desc, take: 1–200 })', { sources: [src(R, 189, 192, 'prisma.simulatedEvent.findMany')] }),
  rel(`${REQ}#listSimulatedEvents`, `${REQ}#toSimulatedEventDTO`, 'calls', 'rows.map(toSimulatedEventDTO)', { sources: [src(R, 193, 193, 'toSimulatedEventDTO')] }),

  // ---- applyOperatorAction ---------------------------------------------------
  rel(AOA, 'db:OperationsRequest', 'reads', 'findUnique({ where: { id } })', {
    order: 1,
    summary: 'Loads the request; a missing row is the 404.',
    sources: [src(R, 235, 238, 'prisma.operationsRequest.findUnique')],
  }),
  rel(AOA, 'sh:operations#isDecisionAction', 'calls', '!isDecisionAction(input.action)', {
    order: 2,
    summary: 'Routes a `note` to the annotate-only branch.',
    sources: [src(R, 259, 271, 'isDecisionAction(input.action)')],
  }),
  rel(AOA, 'sh:operations#canApplyAction', 'calls', 'canApplyAction(currentStatus, input.action)', {
    order: 3,
    summary: 'The transition guard: a decision on an approved or rejected request throws `already_resolved` (409).',
    sources: [src(R, 273, 279, 'canApplyAction(currentStatus, input.action)')],
  }),
  rel(AOA, 'sh:operations#nextStatusForAction', 'calls', 'nextStatusForAction(input.action)', { order: 4, sources: [src(R, 280, 280, 'nextStatusForAction(input.action)')] }),
  rel(AOA, 'sh:operations#isTerminalOpsStatus', 'calls', 'isTerminalOpsStatus(nextStatus) ? now : null', {
    order: 5,
    summary: '`resolvedAt` is stamped only when the request becomes approved or rejected.',
    sources: [src(R, 281, 290, 'isTerminalOpsStatus(nextStatus)')],
  }),
  rel(AOA, 'db:OperationsRequest', 'writes', 'update: status, lastAction, lastActor*, lastActionNote, resolvedAt, updatedAt', {
    order: 6,
    summary: 'A decision rewrites the status and the last-action bookkeeping; a note only touches `updatedAt`.',
    sources: [src(R, 281, 290, 'lastAction: input.action'), src(R, 265, 268, 'data: { updatedAt: now }', 'Note branch')],
  }),
  rel(AOA, 'be:auth/audit#writeAudit', 'calls', 'writeAudit(tx, auditFor(nextStatus))', {
    order: 7,
    summary: 'One `ops_<action>` AuditLog row per action, with fromStatus / toStatus and the actor name in metadata and the note as `reason`.',
    sources: [src(R, 242, 256, 'const auditFor'), src(R, 337, 337, 'writeAudit(tx, auditFor(nextStatus))')],
  }),
  rel(AOA, 'db:AuditLog', 'writes', "insert action 'ops_<action>', entity 'operations_request'", { order: 7, sources: [src(R, 243, 256, 'entity: AUDIT_ENTITY_REQUEST')] }),
  rel(AOA, `${ONB}#onboardingApprovalBlocker`, 'calls', 'onboardingApprovalBlocker(existing)', {
    order: 8,
    summary: 'Onboarding approve only: a blocker string becomes `invalid_action` (400) before anything is written.',
    sources: [src(R, 294, 296, 'onboardingApprovalBlocker(existing)')],
  }),
  rel(AOA, PROVISION, 'calls', 'provisionApprovedOnboarding(tx, input.id, input.actor, now)', {
    order: 9,
    summary: 'Onboarding approve: provision the user, account and funding inside the approval transaction.',
    sources: [src(R, 297, 302, 'provisionApprovedOnboarding(tx, input.id, input.actor, now)')],
  }),
  rel(AOA, `${ONB}#rejectOnboardingApplication`, 'calls', 'rejectOnboardingApplication(tx, input.id, now)', {
    order: 10,
    summary: 'Onboarding reject: mark the application rejected and record the decline email.',
    sources: [src(R, 318, 326, 'rejectOnboardingApplication(tx, input.id, now)')],
  }),
  rel(AOA, 'be:money/movements#movementPayloadOf', 'calls', 'movementPayloadOf(existing)', {
    order: 11,
    summary: 'Decides whether this request is a linked money movement (deposit / ach / wire / bill_pay with at least one ledgerEntryId).',
    sources: [src(R, 333, 334, 'movementPayloadOf(existing)')],
  }),
  rel(AOA, 'be:money/movements#postApprovedMovement', 'calls', 'postApprovedMovement(tx, existing, input.actor, now)', {
    order: 12,
    summary: 'Movement approve: flip the linked pending ledger entries to posted, dated at the simulated now.',
    sources: [src(R, 334, 346, 'postApprovedMovement(tx, existing, input.actor, now)')],
  }),
  rel(AOA, 'be:money/movements#failMovement', 'calls', 'failMovement(tx, existing, now)', {
    order: 13,
    summary: 'Movement reject: flip the linked pending ledger entries to failed, releasing any reserved funds.',
    sources: [src(R, 349, 357, 'failMovement(tx, existing, now)')],
  }),
  rel(AOA, 'be:risk/disputes#upholdDispute', 'calls', 'upholdDispute(tx, existing, input.actor, now)', {
    order: 14,
    summary: 'Dispute approve: reverse the disputed entry.',
    sources: [src(R, 363, 372, 'upholdDispute(tx, existing, input.actor, now)')],
  }),
  rel(AOA, 'be:risk/disputes#denyDispute', 'calls', 'denyDispute(tx, existing, input.actor, now)', {
    order: 15,
    summary: 'Dispute reject: restore the entry to posted; the charge stands.',
    sources: [src(R, 363, 372, 'denyDispute(tx, existing, input.actor, now)')],
  }),
  rel(AOA, 'be:risk/fraud#confirmFraud', 'calls', 'confirmFraud(tx, existing, input.actor, now)', {
    order: 16,
    summary: 'Fraud alert approve: reverse the suspicious entry and freeze the linked card.',
    sources: [src(R, 378, 387, 'confirmFraud(tx, existing, input.actor, now)')],
  }),
  rel(AOA, 'be:risk/fraud#dismissFraud', 'calls', 'dismissFraud(tx, existing, input.actor, now)', {
    order: 17,
    summary: 'Fraud alert reject: dismiss as legitimate; no money effect.',
    sources: [src(R, 378, 387, 'dismissFraud(tx, existing, input.actor, now)')],
  }),
  rel(AOA, `${REQ}#createSimulatedEvent`, 'calls', "createSimulatedEvent(prisma, { channel: 'email', kind: 'notification', … })", {
    order: 18,
    summary: '`request_info` only: record the simulated "Information request sent" email linked to the request.',
    sources: [src(R, 395, 409, 'createSimulatedEvent')],
  }),
  rel(AOA, `${REQ}#toOperationsRequestDTO`, 'calls', 'toOperationsRequestDTO(updated)', { order: 19, sources: [src(R, 411, 411, 'toOperationsRequestDTO(updated)')] }),
  rel(AOA, `${REQ}#OpsActionError`, 'uses-type', 'throw new OpsActionError(code, message)', { sources: [src(R, 236, 238, "new OpsActionError('not_found'")] }),
  rel(AOA, `${REQ}#AppliedAction`, 'uses-type', 'returns AppliedAction', { sources: [src(R, 230, 234, 'Promise<AppliedAction>')] }),
  rel(AOA, 'feat:ops-review', 'implements', 'operator decisions', { summary: 'The function behind every Approve / Reject / Hold / Request info button.' }),
  rel(AOA, 'feat:audit', 'implements', 'ops_<action> audit rows', { summary: 'Every operator action leaves an AuditLog row.' }),
  rel(AOA, 'feat:external-movements', 'implements', 'approve → posted, reject → failed', { summary: 'Settles or fails a reviewable movement when staff decide.' }),

  // ---- createSimulatedEvent --------------------------------------------------
  rel(`${REQ}#createSimulatedEvent`, 'db:OperationsRequest', 'reads', 'findUnique({ id: input.requestId }, select id)', {
    order: 1,
    summary: 'A requestId that matches no request is dropped rather than failing.',
    sources: [src(R, 446, 454, 'prisma.operationsRequest.findUnique')],
  }),
  rel(`${REQ}#createSimulatedEvent`, 'db:SimulatedEvent', 'writes', 'insert 1 row (channel, direction, kind, status, summary, detail, requestId, createdAt)', { order: 2, sources: [src(R, 456, 467, 'prisma.simulatedEvent.create')] }),
  rel(`${REQ}#createSimulatedEvent`, 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'ops_simulate_event', … })", { order: 3, sources: [src(R, 469, 477, 'ops_simulate_event')] }),
  rel(`${REQ}#createSimulatedEvent`, 'db:AuditLog', 'writes', "insert action 'ops_simulate_event', entity 'simulated_event'", { order: 3, sources: [src(R, 469, 477, 'AUDIT_ENTITY_EVENT')] }),
  rel(`${REQ}#createSimulatedEvent`, 'sh:operations#SimulateEventRequest', 'uses-type', 'input: SimulateEventRequest', { sources: [src(R, 434, 439, 'SimulateEventRequest')] }),
  rel(`${REQ}#createSimulatedEvent`, `${REQ}#toSimulatedEventDTO`, 'calls', 'toSimulatedEventDTO(created)', { order: 4, sources: [src(R, 479, 479, 'toSimulatedEventDTO(created)')] }),
  rel(`${REQ}#createSimulatedEvent`, 'feat:sim-messaging', 'implements', 'simulated SMS / email / MFA / identity'),
  rel(`${REQ}#listOperationsRequests`, 'feat:ops-review', 'implements', 'the request queue'),

  // ---- admin-users.ts --------------------------------------------------------
  rel(`${ADM}#adminCreateUser`, 'db:User', 'reads', 'findUnique({ where: { email } })', { order: 1, summary: 'Duplicate email → AdminUserError("conflict").', sources: [src(A, 35, 38, 'prisma.user.findUnique')] }),
  rel(`${ADM}#adminCreateUser`, 'be:auth/password#hashPassword', 'calls', 'hashPassword(input.password)', { order: 2, sources: [src(A, 40, 40, 'hashPassword(input.password)')] }),
  rel(`${ADM}#adminCreateUser`, 'db:User', 'writes', 'insert 1 row (role from input, status active, passwordHash)', { order: 3, sources: [src(A, 43, 52, 'tx.user.create')] }),
  rel(`${ADM}#adminCreateUser`, 'db:Account', 'writes', 'insert 1 row when a product is chosen', { order: 4, sources: [src(A, 55, 59, 'tx.account.create')] }),
  rel(`${ADM}#adminCreateUser`, 'db:AccountAccess', 'writes', "insert owner grant { relationship: 'owner' }", { order: 5, sources: [src(A, 60, 62, 'tx.accountAccess.create')] }),
  rel(`${ADM}#adminCreateUser`, 'db:LedgerEntry', 'writes', "insert posted 'adjustment' credit with reason when funding > 0", {
    order: 6,
    summary: 'Admin funding is a bank-originated adjustment; the reason is stored on the entry.',
    sources: [src(A, 67, 80, 'tx.ledgerEntry.create')],
  }),
  rel(`${ADM}#adminCreateUser`, 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'admin_adjustment' | 'admin_create_user', … })", { order: 7, sources: [src(A, 81, 111, 'admin_create_user')] }),
  rel(`${ADM}#adminCreateUser`, 'db:AuditLog', 'writes', "insert 'admin_adjustment' (if funded) and 'admin_create_user'", { order: 7, sources: [src(A, 81, 94, 'admin_adjustment')] }),
  rel(`${ADM}#adminCreateUser`, 'sh:onboarding#NormalizedAdminCreateUser', 'uses-type', 'input: NormalizedAdminCreateUser', { sources: [src(A, 30, 34, 'NormalizedAdminCreateUser')] }),
  rel(`${ADM}#adminCreateUser`, 'sh:onboarding#AdminCreateUserResponse', 'uses-type', 'returns AdminCreateUserResponse', { sources: [src(A, 30, 34, 'AdminCreateUserResponse')] }),
  rel(`${ADM}#adminCreateUser`, 'sh:onboarding#ONBOARDING_PRODUCT_LABELS', 'uses-type', 'account name = ONBOARDING_PRODUCT_LABELS[product]', { sources: [src(A, 55, 57, 'ONBOARDING_PRODUCT_LABELS')] }),
  rel(`${ADM}#adminCreateUser`, `${ADM}#AdminUserError`, 'uses-type', "throw new AdminUserError('conflict', …)", { sources: [src(A, 36, 38, "new AdminUserError('conflict'")] }),
  rel(`${ADM}#adminCreateUser`, 'feat:admin-users', 'implements', 'create a user'),

  // ---- onboarding.ts ---------------------------------------------------------
  rel(SUBMIT, 'db:OnboardingApplication', 'reads', "count({ email, status: 'submitted' })", {
    order: 1,
    summary: 'Resource cap: at most 3 unreviewed applications per email.',
    sources: [src(O, 118, 125, 'prisma.onboardingApplication.count')],
  }),
  rel(SUBMIT, `${ONB}#generateReference`, 'calls', 'generateReference()', { order: 2, sources: [src(O, 127, 127, 'generateReference()')] }),
  rel(SUBMIT, 'be:auth/password#hashPassword', 'calls', 'hashPassword(input.password)', {
    order: 3,
    summary: 'The plain password is hashed with bcrypt before any row is written; only the hash is stored.',
    sources: [src(O, 128, 128, 'hashPassword(input.password)')],
  }),
  rel(SUBMIT, 'db:OperationsRequest', 'writes', "insert type 'onboarding', status 'pending', payload { reference, product, initialFundingMinor, jointInviteEmail }", {
    order: 4,
    sources: [src(O, 131, 149, 'prisma.operationsRequest.create')],
  }),
  rel(SUBMIT, 'db:OnboardingApplication', 'writes', "insert status 'submitted' with passwordHash and requestId", { order: 5, sources: [src(O, 151, 166, 'prisma.onboardingApplication.create')] }),
  rel(SUBMIT, 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { actorRole: 'system', action: 'ops_request_created', … })", {
    order: 6,
    summary: 'The intake audit row, so the request history starts with "created".',
    sources: [src(O, 168, 177, 'AUDIT_INTAKE_ACTION')],
  }),
  rel(SUBMIT, 'db:AuditLog', 'writes', "insert 'ops_request_created' (actorRole system)", { order: 6, sources: [src(O, 170, 177, "actorRole: 'system'")] }),
  rel(SUBMIT, 'db:SimulatedEvent', 'writes', 'insert 3 rows: email application_received, identity verification, mfa enrollment', { order: 7, sources: [src(O, 182, 224, "kind: 'enrollment'")] }),
  rel(SUBMIT, `${REQ}#toOperationsRequestDTO`, 'calls', 'toOperationsRequestDTO(request)', { order: 8, sources: [src(O, 226, 226, 'toOperationsRequestDTO(request)')] }),
  rel(SUBMIT, 'sh:onboarding#NormalizedOpenAccount', 'uses-type', 'input: NormalizedOpenAccount', { sources: [src(O, 110, 113, 'NormalizedOpenAccount')] }),
  rel(SUBMIT, 'sh:public-demo#RESOURCE_CAPS', 'uses-type', 'RESOURCE_CAPS.pendingApplicationsPerEmail', { sources: [src(O, 121, 124, 'RESOURCE_CAPS.pendingApplicationsPerEmail')] }),
  rel(SUBMIT, 'sh:onboarding#ONBOARDING_PRODUCT_LABELS', 'uses-type', 'ONBOARDING_PRODUCT_LABELS[input.product]', { sources: [src(O, 129, 129, 'ONBOARDING_PRODUCT_LABELS[input.product]')] }),
  rel(SUBMIT, `${ONB}#ApplicationLimitError`, 'uses-type', 'throw new ApplicationLimitError(…)', { sources: [src(O, 121, 125, 'new ApplicationLimitError')] }),
  rel(SUBMIT, `${ONB}#SubmittedApplication`, 'uses-type', 'returns SubmittedApplication', { sources: [src(O, 110, 113, 'SubmittedApplication')] }),
  rel(SUBMIT, 'feat:onboarding', 'implements', 'apply for an account'),

  rel(`${ONB}#onboardingApprovalBlocker`, 'db:OnboardingApplication', 'reads', 'findUnique({ where: { requestId } })', { order: 1, sources: [src(O, 247, 249, 'prisma.onboardingApplication.findUnique')] }),
  rel(`${ONB}#onboardingApprovalBlocker`, 'db:User', 'reads', 'findUnique({ where: { email: application.email } })', {
    order: 2,
    summary: 'An applicant whose email already belongs to a user cannot be provisioned.',
    sources: [src(O, 254, 257, 'prisma.user.findUnique')],
  }),

  rel(PROVISION, 'db:OnboardingApplication', 'reads', 'findUnique({ where: { requestId } })', { order: 1, sources: [src(O, 277, 278, 'tx.onboardingApplication.findUnique')] }),
  rel(PROVISION, 'db:User', 'writes', "insert role 'customer', status 'active', passwordHash from the application", { order: 2, sources: [src(O, 283, 293, 'tx.user.create')] }),
  rel(PROVISION, 'db:Account', 'writes', 'insert { userId, type: product, name, openedAt: now }', { order: 3, sources: [src(O, 295, 298, 'tx.account.create')] }),
  rel(PROVISION, 'db:AccountAccess', 'writes', "insert owner grant { relationship: 'owner' }", {
    order: 4,
    summary: 'The explicit grant the access rules read; without it the new customer would not see the account.',
    sources: [src(O, 299, 301, 'tx.accountAccess.create')],
  }),
  rel(PROVISION, 'db:LedgerEntry', 'writes', "insert posted 'deposit' credit when initialFundingMinor > 0", {
    order: 5,
    summary: 'The only way money enters a newly opened account: a bank-originated, posted deposit dated at the simulated now.',
    sources: [src(O, 303, 317, 'tx.ledgerEntry.create')],
  }),
  rel(PROVISION, 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'onboarding_initial_funding' | 'onboarding_provisioned', … })", { order: 6, sources: [src(O, 318, 326, 'onboarding_initial_funding'), src(O, 364, 372, 'onboarding_provisioned')] }),
  rel(PROVISION, 'db:AuditLog', 'writes', "insert 'onboarding_initial_funding' (if funded) and 'onboarding_provisioned'", { order: 6, sources: [src(O, 364, 372, "entity: 'onboarding_application'")] }),
  rel(PROVISION, `${INV}#createInvitationRecord`, 'calls', "createInvitationRecord(tx, { accountId, invitedById: user.id, inviteeEmail, relationship: 'joint' }, now)", {
    order: 7,
    summary: 'Only when the application named a joint invitee.',
    sources: [src(O, 332, 343, 'createInvitationRecord')],
  }),
  rel(PROVISION, 'db:OnboardingApplication', 'writes', "update status 'provisioned', provisionedUserId, provisionedAccountId", { order: 8, sources: [src(O, 359, 363, 'tx.onboardingApplication.update')] }),
  rel(PROVISION, 'db:SimulatedEvent', 'writes', 'insert identity "account opened" event (+ invitation email if any)', { order: 9, sources: [src(O, 374, 390, 'Identity verified')] }),
  rel(PROVISION, 'sh:onboarding#ONBOARDING_PRODUCT_LABELS', 'uses-type', 'accountName = ONBOARDING_PRODUCT_LABELS[product]', { sources: [src(O, 280, 281, 'ONBOARDING_PRODUCT_LABELS[product]')] }),
  rel(PROVISION, `${ONB}#ProvisionResult`, 'uses-type', 'returns ProvisionResult | null', { sources: [src(O, 271, 276, 'ProvisionResult')] }),
  rel(PROVISION, 'feat:onboarding', 'implements', 'provision on approval'),
  rel(PROVISION, 'feat:balances', 'implements', 'funding as a ledger entry', { summary: 'The opening balance is never stored; it is a posted deposit entry.', confidence: 'inferred' }),

  rel(`${ONB}#rejectOnboardingApplication`, 'db:OnboardingApplication', 'writes', "update status 'rejected'", { order: 1, sources: [src(O, 404, 409, 'tx.onboardingApplication.update')] }),
  rel(`${ONB}#rejectOnboardingApplication`, 'db:SimulatedEvent', 'writes', 'insert email "Application <ref> declined (simulated)"', { order: 2, sources: [src(O, 410, 420, 'declined (simulated)')] }),
  rel(`${ONB}#toOnboardingApplicationSummary`, 'sh:onboarding#OnboardingApplicationSummary', 'uses-type', 'returns OnboardingApplicationSummary', { sources: [src(O, 45, 47, 'OnboardingApplicationSummary')] }),

  // ---- invitations.ts --------------------------------------------------------
  rel(`${INV}#createInvitationRecord`, 'db:AccountInvitation', 'writes', "insert status 'pending' with random token", { sources: [src(I, 77, 88, 'db.accountInvitation.create')] }),
  rel(`${INV}#inviteJoint`, 'db:AccountInvitation', 'reads', "count({ accountId, status: 'pending' })", {
    order: 1,
    summary: 'Resource cap: at most 10 pending invitations per account.',
    sources: [src(I, 113, 121, 'prisma.accountInvitation.count')],
  }),
  rel(`${INV}#inviteJoint`, `${INV}#createInvitationRecord`, 'calls', 'createInvitationRecord(prisma, { … }, now)', { order: 2, sources: [src(I, 122, 131, 'createInvitationRecord')] }),
  rel(`${INV}#inviteJoint`, 'db:SimulatedEvent', 'writes', "insert email kind 'invitation', status 'sent' (no requestId)", { order: 3, sources: [src(I, 133, 143, 'prisma.simulatedEvent.create')] }),
  rel(`${INV}#inviteJoint`, 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'invitation_created', … })", { order: 4, sources: [src(I, 145, 157, 'invitation_created')] }),
  rel(`${INV}#inviteJoint`, 'db:AuditLog', 'writes', "insert 'invitation_created', entity 'account_invitation'", { order: 4, sources: [src(I, 145, 157, "entity: 'account_invitation'")] }),
  rel(`${INV}#inviteJoint`, 'sh:public-demo#RESOURCE_CAPS', 'uses-type', 'RESOURCE_CAPS.pendingInvitationsPerAccount', { sources: [src(I, 116, 120, 'RESOURCE_CAPS.pendingInvitationsPerAccount')] }),
  rel(`${INV}#inviteJoint`, `${INV}#toInvitationDTO`, 'calls', 'toInvitationDTO(row, { accountName, invitedByName })', { order: 5, sources: [src(I, 159, 165, 'toInvitationDTO')] }),
  rel(`${INV}#inviteJoint`, `${REQ}#toSimulatedEventDTO`, 'calls', 'toSimulatedEventDTO(eventRow)', { order: 6, sources: [src(I, 164, 164, 'toSimulatedEventDTO(eventRow)')] }),
  rel(`${INV}#inviteJoint`, 'feat:invitations', 'implements', 'invite a joint owner'),
  rel(`${INV}#toInvitationDTO`, 'sh:onboarding#AccountInvitationDTO', 'uses-type', 'returns AccountInvitationDTO', { sources: [src(I, 43, 49, 'AccountInvitationDTO')] }),
  rel(`${INV}#listInvitationsForUser`, 'db:AccountInvitation', 'reads', "findMany({ inviteeEmail: user.email, status: 'pending' }) + account name + inviter name", { sources: [src(I, 170, 174, 'prisma.accountInvitation.findMany')] }),
  rel(`${INV}#acceptInvitation`, 'db:AccountInvitation', 'reads', 'findUnique({ id }) + account name + inviter name', { order: 1, sources: [src(I, 190, 193, 'prisma.accountInvitation.findUnique')] }),
  rel(`${INV}#acceptInvitation`, 'db:AccountAccess', 'writes', 'upsert on (userId, accountId) with the invited relationship', {
    order: 2,
    summary: 'This grant is what makes the account visible to the invitee; an existing grant is left unchanged.',
    sources: [src(I, 203, 207, 'tx.accountAccess.upsert')],
  }),
  rel(`${INV}#acceptInvitation`, 'db:AccountInvitation', 'writes', "update status 'accepted', acceptedById, respondedAt", { order: 3, sources: [src(I, 208, 211, 'tx.accountInvitation.update')] }),
  rel(`${INV}#acceptInvitation`, 'be:auth/audit#writeAudit', 'calls', "writeAudit(tx, { action: 'invitation_accepted', … })", { order: 4, sources: [src(I, 212, 220, 'invitation_accepted')] }),
  rel(`${INV}#acceptInvitation`, 'db:AuditLog', 'writes', "insert 'invitation_accepted'", { order: 4, sources: [src(I, 212, 220, "action: 'invitation_accepted'")] }),
  rel(`${INV}#acceptInvitation`, `${INV}#InvitationError`, 'uses-type', 'throw new InvitationError(code, …)', { sources: [src(I, 194, 200, "new InvitationError('wrong_invitee'")] }),
  rel(`${INV}#acceptInvitation`, 'feat:invitations', 'implements', 'accept → joint access'),
  rel(`${INV}#acceptInvitation`, 'feat:rbac', 'implements', 'creates the AccountAccess grant', { confidence: 'inferred' }),
  rel(`${INV}#declineInvitation`, 'db:AccountInvitation', 'reads', 'findUnique({ id })', { order: 1, sources: [src(I, 235, 238, 'prisma.accountInvitation.findUnique')] }),
  rel(`${INV}#declineInvitation`, 'db:AccountInvitation', 'writes', "update status 'declined', respondedAt", { order: 2, sources: [src(I, 246, 249, 'prisma.accountInvitation.update')] }),
  rel(`${INV}#declineInvitation`, 'be:auth/audit#writeAudit', 'calls', "writeAudit(prisma, { action: 'invitation_declined', … })", { order: 3, sources: [src(I, 250, 258, 'invitation_declined')] }),
  rel(`${INV}#declineInvitation`, 'db:AuditLog', 'writes', "insert 'invitation_declined'", { order: 3, sources: [src(I, 250, 258, "action: 'invitation_declined'")] }),
];

export const backendEntities: Entity[] = [...requestsEntities, ...adminEntities, ...onboardingEntities, ...invitationEntities];
export const backendRelations: Relation[] = relations;
