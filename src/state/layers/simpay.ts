import type { Contract, Entity, HypotheticalLayer, HypotheticalModification, Relation, Scenario, ScenarioStep } from '../../model/types';
import { baseState, IDS } from '../../model/data/fixtures';

/**
 * EXAMPLE HYPOTHETICAL LAYER — "SimPay", a PayPal-like external wallet.
 *
 * Nothing in this file exists in Meridian. It is a worked example of planning
 * an integration against the real system:
 *
 *  - Today the only way to submit an external money movement is
 *    `POST /api/movements`, which requires a signed-in CUSTOMER session cookie
 *    and a CSRF header. There is no machine-to-machine interface, no API key,
 *    no webhook. So an external service cannot integrate without new surface.
 *  - The proposal adds the smallest surface that reuses what exists: a partner
 *    endpoint that authenticates the service, then calls the SAME shared
 *    validator and the SAME `createExternalMovement` service — so the movement
 *    still becomes a pending ledger entry plus an operator review item — and a
 *    notifier that tells the partner the outcome once an operator decides.
 *
 * Every entity, relation, contract and step here renders as hypothetical. The
 * scenario's steps that pass through existing Meridian code cite the real
 * source lines, so the boundary between "exists" and "proposed" stays visible.
 */

const SIMPAY = 'hypo:simpay';
const GATEWAY = 'hypo:be.partner';
const ROUTES = 'hypo:be:routes/partner';
const EP = 'ep:POST /api/partner/movements';
const PARTNER_AUTH = 'hypo:be:partner/auth#requirePartner';
const NOTIFIER = 'hypo:be:partner/notifier#notifyPartner';
const CREDENTIAL = 'hypo:db:PartnerCredential';
const LINK = 'hypo:db:PartnerLink';
const WEBHOOK = 'hypo:ev:partner.movement.settled';

const hypo = (e: Omit<Entity, 'confidence'>): Entity => ({ ...e, confidence: 'hypothetical', tags: [...(e.tags ?? []), 'hypothetical', 'integration'] });

const entities: Entity[] = [
  hypo({
    id: SIMPAY,
    kind: 'external',
    name: 'SimPay (external wallet)',
    parent: 'boundary:external',
    summary: 'A PayPal-like external payment service that moves money into and out of a customer’s Meridian account on the customer’s behalf.',
    description:
      'Proposed. SimPay would be the first real external party: a separate system that calls Meridian over the network with its own credentials instead of a customer’s browser session.\n\nIt needs three things Meridian does not have today: a way to authenticate as a partner, a way to act on a specific customer’s account with that customer’s consent, and a way to learn the outcome of a movement that waits for operator review.',
    audience: {
      executive: 'A proposed partner payment service (think PayPal) that customers could link to their Meridian account.',
      'end-user': 'A payment app you could link to your bank account to pay and get paid.',
    },
    detail: 1,
    aliases: ['PayPal', 'external payment service', 'wallet', 'payment provider', 'third-party'],
    layout: { row: 0, order: 0 },
  }),
  hypo({
    id: GATEWAY,
    kind: 'subsystem',
    name: 'Partner Gateway',
    parent: 'backend',
    summary: 'Proposed backend subsystem: authenticates partner services and translates their requests into existing money-movement calls.',
    description:
      'Proposed. A thin adapter, deliberately without money logic of its own. It verifies the partner’s credential, resolves which customer account the partner is linked to, then hands a normalised movement to the existing `createExternalMovement` service. Keeping it thin means the ledger discipline, the available-funds check, the pending-movement cap and operator review all apply unchanged.',
    detail: 2,
    layout: { row: 2, order: 3 },
  }),
  hypo({
    id: ROUTES,
    kind: 'route-group',
    name: 'routes/partner.ts',
    parent: GATEWAY,
    summary: 'Proposed route plugin exposing the partner-facing endpoint.',
    detail: 3,
  }),
  hypo({
    id: EP,
    kind: 'endpoint',
    name: 'POST /api/partner/movements',
    parent: ROUTES,
    summary: 'Proposed: a partner submits a reviewable movement for a linked customer account.',
    detail: 3,
  }),
  hypo({
    id: PARTNER_AUTH,
    kind: 'function',
    name: 'requirePartner',
    parent: GATEWAY,
    summary: 'Proposed guard: verifies the partner’s API key and request signature, then loads the customer link.',
    signature: 'requirePartner(req, reply): Promise<void>',
    description:
      'Proposed. Plays the role `requireAuth` plays for browser sessions, but for a service: no cookie, no CSRF (CSRF protects cookie-authenticated browsers; a signed server-to-server call has no ambient credential to forge). It would need its own rate-limit bucket.',
    detail: 4,
  }),
  hypo({
    id: NOTIFIER,
    kind: 'function',
    name: 'notifyPartner',
    parent: GATEWAY,
    summary: 'Proposed: after an operator posts or fails a partner movement, send the outcome to the partner.',
    signature: 'notifyPartner(request: OperationsRequest, outcome: "posted" | "failed" | "reversed"): Promise<void>',
    description:
      'Proposed. Today the outcome of a reviewable movement is only visible to the customer on their next page load and to operators over Socket.IO. A partner cannot poll with a customer session, so the gateway would call the partner back.',
    detail: 4,
  }),
  hypo({
    id: WEBHOOK,
    kind: 'event',
    name: 'partner.movement.settled',
    parent: GATEWAY,
    summary: 'Proposed outbound webhook: tells the partner a movement was posted, failed or reversed.',
    fields: [
      { name: 'reference', type: 'string', required: true, description: 'Meridian’s movement reference (MOV-…).' },
      { name: 'externalReference', type: 'string', required: true, description: 'The partner’s own id, echoed back.' },
      { name: 'outcome', type: '"posted" | "failed" | "reversed"', required: true },
      { name: 'amountMinor', type: 'number', required: true },
      { name: 'settledAt', type: 'string (ISO, simulated clock)', required: true },
    ],
    example: { reference: 'MOV-7F3A9C', externalReference: 'SP-20261001-88412', outcome: 'posted', amountMinor: 4405, settledAt: '2026-10-01T15:20:00.000Z' },
    detail: 3,
  }),
  hypo({
    id: CREDENTIAL,
    kind: 'db-model',
    name: 'PartnerCredential',
    parent: 'db',
    summary: 'Proposed table: one row per partner service with a hashed API key and signing secret.',
    fields: [
      { name: 'id', type: 'String @id', required: true, primaryKey: true },
      { name: 'name', type: 'String', required: true, description: 'e.g. "SimPay".' },
      { name: 'keyHash', type: 'String @unique', required: true, description: 'SHA-256 of the API key — same approach as Session.tokenHash.' },
      { name: 'status', type: 'String @default("active")', required: true },
      { name: 'createdAt', type: 'DateTime', required: true },
    ],
    example: { id: 'pc_simpay', name: 'SimPay', keyHash: '4c1e…(sha-256)', status: 'active' },
    layout: { row: 5, order: 0 },
  }),
  hypo({
    id: LINK,
    kind: 'db-model',
    name: 'PartnerLink',
    parent: 'db',
    summary: 'Proposed table: a customer’s consent for a partner to act on one of their accounts.',
    description: 'Proposed. The equivalent of an `AccountAccess` grant, but for a service rather than a person — it bounds what the partner may touch to accounts the customer explicitly linked.',
    fields: [
      { name: 'id', type: 'String @id', required: true, primaryKey: true },
      { name: 'partnerId', type: 'String', required: true, references: CREDENTIAL },
      { name: 'userId', type: 'String', required: true, references: 'db:User' },
      { name: 'accountId', type: 'String', required: true, references: 'db:Account' },
      { name: 'status', type: 'String @default("active")', required: true, description: 'active | revoked' },
      { name: 'createdAt', type: 'DateTime', required: true },
    ],
    example: { id: 'pl_1', partnerId: 'pc_simpay', userId: IDS.avery, accountId: IDS.checking, status: 'active' },
    layout: { row: 5, order: 1 },
  }),
];

const rel = (r: Omit<Relation, 'confidence'>): Relation => ({ ...r, confidence: 'hypothetical' });

const relations: Relation[] = [
  rel({
    id: 'rel:hypo:simpay->partner-endpoint:http',
    from: SIMPAY,
    to: EP,
    kind: 'http',
    label: 'POST /api/partner/movements (API key + signature)',
    summary: 'Proposed: SimPay submits a movement for a linked account over HTTPS with its own credential.',
    protocol: 'HTTPS JSON, server-to-server; no cookies, no CSRF',
    data: ['sh:money-movement#ExternalMovementRequest'],
  }),
  rel({ id: 'rel:hypo:partner-routes->endpoint:handles', from: ROUTES, to: EP, kind: 'handles', label: 'registers', summary: 'Proposed route registration.' }),
  rel({ id: 'rel:hypo:partner-auth->endpoint:guards', from: PARTNER_AUTH, to: EP, kind: 'guards', label: 'preHandler', summary: 'Proposed: every partner call passes the partner guard first.' }),
  rel({ id: 'rel:hypo:partner-auth->credential:reads', from: PARTNER_AUTH, to: CREDENTIAL, kind: 'reads', label: 'findUnique by keyHash', summary: 'Proposed: look the partner up by the hash of its API key.' }),
  rel({ id: 'rel:hypo:partner-auth->link:reads', from: PARTNER_AUTH, to: LINK, kind: 'reads', label: 'active link for accountId', summary: 'Proposed: confirm the customer linked this account to the partner.' }),
  rel({ id: 'rel:hypo:link->user:references', from: LINK, to: 'db:User', kind: 'references', label: 'userId → User.id', summary: 'Proposed foreign key.' }),
  rel({ id: 'rel:hypo:link->account:references', from: LINK, to: 'db:Account', kind: 'references', label: 'accountId → Account.id', summary: 'Proposed foreign key.' }),
  rel({ id: 'rel:hypo:link->credential:references', from: LINK, to: CREDENTIAL, kind: 'references', label: 'partnerId → PartnerCredential.id', summary: 'Proposed foreign key.' }),
  rel({
    id: 'rel:hypo:endpoint->validateExternalMovement:validates',
    from: EP,
    to: 'sh:money-movement#validateExternalMovement',
    kind: 'validates',
    label: 'validateExternalMovement(body)',
    summary: 'Proposed reuse: the same shared validator the customer endpoint uses, so the rules cannot drift.',
  }),
  rel({
    id: 'rel:hypo:endpoint->createExternalMovement:calls',
    from: EP,
    to: 'be:money/movements#createExternalMovement',
    kind: 'calls',
    label: 'createExternalMovement(linkedUser, input, now)',
    summary: 'Proposed reuse: the existing service writes the pending ledger entry and the operator review item.',
  }),
  rel({ id: 'rel:hypo:endpoint->simulationNow:calls', from: EP, to: 'be:clock/clock#simulationNow', kind: 'calls', label: 'simulationNow(prisma)', summary: 'Proposed reuse: partner movements are dated on the simulated clock like every other money event.' }),
  rel({
    id: 'rel:hypo:applyOperatorAction->notifier:calls',
    from: 'be:ops/requests#applyOperatorAction',
    to: NOTIFIER,
    kind: 'calls',
    label: 'notifyPartner(request, outcome)',
    summary: 'Proposed change: after approve/reject of a partner movement, tell the partner.',
  }),
  rel({ id: 'rel:hypo:notifier->webhook:emits', from: NOTIFIER, to: WEBHOOK, kind: 'emits', label: 'partner.movement.settled', summary: 'Proposed outbound webhook.' }),
  rel({
    id: 'rel:hypo:notifier->simpay:http',
    from: NOTIFIER,
    to: SIMPAY,
    kind: 'http',
    label: 'POST <partner webhook URL> (signed)',
    summary: 'Proposed: Meridian calls the partner back with the outcome.',
    protocol: 'HTTPS JSON, signed; retried on failure',
    data: [WEBHOOK],
  }),
];

const contract: Contract = {
  id: EP,
  method: 'POST',
  path: '/api/partner/movements',
  summary: 'PROPOSED — a partner service submits a reviewable money movement on behalf of a customer who linked their account.',
  description:
    'Mirrors `POST /api/movements` so that everything downstream is unchanged. The differences are who is calling (a service, not a browser) and two extra fields that let both systems reconcile.',
  auth: {
    required: true,
    surface: 'either',
    csrf: false,
    rateLimit: 'partner (proposed)',
    notes: 'Proposed: API key in `authorization: Bearer …` plus an HMAC signature header over the body. No session cookie, therefore no CSRF token. The account must have an active PartnerLink for this partner.',
  },
  body: [
    { name: 'accountId', type: 'string', required: true, rules: ['Must be an account the customer linked to this partner (proposed PartnerLink)', 'Existing rule: account must be active'] },
    { name: 'kind', type: 'string', required: true, rules: ['Existing rule: one of external_ach, wire, mobile_check_deposit, bill_pay', 'Proposal: partner movements use `external_ach`; a dedicated kind would touch every consumer of MovementKind'] },
    { name: 'amountMinor', type: 'number', required: true, rules: ['Existing rule: integer, ≥ 1 and ≤ 5,000,000', 'Existing rule (outbound): must not exceed the AVAILABLE balance'] },
    { name: 'direction', type: 'string', required: true, rules: ['Existing rule for external_ach: "inbound" or "outbound"'] },
    { name: 'counterparty', type: 'string', required: true, rules: ['Existing rule: required for external_ach; cut to 80 characters'] },
    { name: 'memo', type: 'string | null', required: false, rules: ['Existing rule: cut to 140 characters'] },
    { name: 'externalReference', type: 'string', required: true, description: 'PROPOSED field: the partner’s own transaction id.', rules: ['Proposed: unique per partner — a repeat is answered with the original result (idempotency)'] },
  ],
  bodyTypeRef: 'sh:money-movement#ExternalMovementRequest',
  requestExample: { accountId: IDS.checking, kind: 'external_ach', amountMinor: 4405, direction: 'outbound', counterparty: 'SimPay — Corner Books', memo: 'Order 88412', externalReference: 'SP-20261001-88412' },
  responses: [
    {
      status: 201,
      description: 'Accepted for operator review — same shape as the customer endpoint, plus the echoed external reference.',
      typeRef: 'sh:money-movement#ExternalMovementResponse',
      example: { reference: 'MOV-7F3A9C', externalReference: 'SP-20261001-88412', kind: 'external_ach', status: 'pending_review', amountMinor: 4405, direction: 'outbound' },
    },
  ],
  errors: [
    { status: 401, code: 'partner_unauthenticated', when: 'the API key or signature is missing or wrong (proposed)' },
    { status: 403, code: 'not_linked', when: 'the customer has not linked this account to the partner, or revoked the link (proposed)' },
    { status: 400, code: 'invalid_request', when: 'the shared validator rejects the body (existing behaviour)' },
    { status: 400, code: 'insufficient_funds', when: 'an outbound amount exceeds the available balance (existing behaviour)' },
    { status: 409, code: 'limit_reached', when: 'the customer already has the maximum number of movements awaiting review (existing behaviour)' },
    { status: 429, code: 'rate_limited', when: 'the partner exceeds its request budget (proposed bucket)' },
  ],
  flow: [
    { kind: 'guard', target: PARTNER_AUTH, label: 'requirePartner', detail: 'Proposed: verify the API key hash and the body signature; load the PartnerLink for accountId.', rejects: [{ status: 401, code: 'partner_unauthenticated', when: 'the credential is invalid' }, { status: 403, code: 'not_linked', when: 'there is no active link' }], confidence: 'hypothetical' },
    { kind: 'validate', target: 'sh:money-movement#validateExternalMovement', label: 'validateExternalMovement(body)', detail: 'Existing shared validator, reused unchanged.', rejects: [{ status: 400, code: 'invalid_request', when: 'a field fails validation' }], confidence: 'hypothetical' },
    { kind: 'call', target: 'be:clock/clock#simulationNow', label: 'simulationNow(prisma)', detail: 'Existing: date the movement on the simulated clock.', confidence: 'hypothetical' },
    { kind: 'call', target: 'be:money/movements#createExternalMovement', label: 'createExternalMovement(linkedUser, input, now)', detail: 'Existing service, called with the LINKED customer as the acting user so access can never exceed what that customer holds.', rejects: [{ status: 400, code: 'insufficient_funds', when: 'outbound exceeds available' }, { status: 409, code: 'limit_reached', when: 'too many movements await review' }], confidence: 'hypothetical' },
    { kind: 'db-write', target: 'db:LedgerEntry', label: 'insert PENDING entry', detail: 'Existing behaviour: nothing posts until an operator approves.', confidence: 'hypothetical' },
    { kind: 'db-write', target: 'db:OperationsRequest', label: 'insert review item (payload carries externalReference)', detail: 'Existing behaviour plus the proposed payload field.', confidence: 'hypothetical' },
    { kind: 'emit', target: 'ev:ops:request_changed', label: 'ops:request_changed → operators', detail: 'Existing behaviour: the item appears live in the operator queue.', confidence: 'hypothetical' },
    { kind: 'respond', label: '201 pending_review', confidence: 'hypothetical' },
  ],
  sideEffects: ['Same as POST /api/movements: one PENDING LedgerEntry, one OperationsRequest, one AuditLog row, one SimulatedEvent', 'Proposed: the request payload records the partner and its externalReference'],
  mutates: true,
  integrationNotes:
    'PROPOSED CONTRACT — not implemented. It shows what an integrator would send if Meridian exposed a partner surface. Note what does NOT change: the movement is still pending until a human operator approves it, so a partner must treat 201 as “accepted for review”, not “paid”, and wait for the settled webhook.',
  sources: [],
  confidence: 'hypothetical',
};

const modifications: HypotheticalModification[] = [
  {
    id: 'mod:simpay:external-reference',
    target: 'sh:money-movement#ExternalMovementRequest',
    op: 'add-field',
    summary: 'Carry the partner’s transaction id',
    field: { name: 'externalReference', type: 'string', required: false, description: 'The external service’s own id, for reconciliation and idempotency.' },
    note: 'Optional so the existing customer flow keeps working. Check the Impact tab: the validator, the route, the customer client and the tests all use this type.',
  },
  {
    id: 'mod:simpay:payload-partner',
    target: 'sh:money-movement#MovementPayload',
    op: 'add-field',
    summary: 'Remember which partner originated the movement',
    field: { name: 'partner', type: '{ id: string; externalReference: string } | undefined', required: false, description: 'Lets the operator console show the origin and lets the notifier find the callback.' },
    note: 'MovementPayload is stored as JSON in OperationsRequest.payload and parsed by asMovementPayload — both need to tolerate the new field.',
  },
  {
    id: 'mod:simpay:notify',
    target: 'be:ops/requests#applyOperatorAction',
    op: 'change',
    summary: 'After approving or rejecting a partner movement, call notifyPartner outside the DB transaction',
    note: 'The callback must not run inside prisma.$transaction: a slow partner must not hold the ledger write open.',
  },
  {
    id: 'mod:simpay:console',
    target: 'op:components/RequestDetailPanel',
    op: 'change',
    summary: 'Show the originating partner and its reference on the request detail',
  },
];

// ---- Proposed flow -------------------------------------------------------------

const AVERY = 'role:customer';
const SAM = 'role:ops_agent';
const CREATE = 'be:money/movements#createExternalMovement';
const VALIDATE = 'sh:money-movement#validateExternalMovement';
const APPLY = 'be:ops/requests#applyOperatorAction';
const POST_APPROVED = 'be:money/movements#postApprovedMovement';
const LEDGER = 'db:LedgerEntry';
const OPS_REQ = 'db:OperationsRequest';

const H = true;
const steps: ScenarioStep[] = [
  {
    id: 'sp-1',
    kind: 'ui',
    title: 'Avery pays with SimPay',
    from: AVERY,
    to: SIMPAY,
    label: 'pay $44.05 at Corner Books',
    narrative: 'Avery checks out at a shop using SimPay, having earlier linked Everyday Checking to SimPay. This happens entirely outside Meridian.',
    audience: { executive: 'A customer pays a merchant using the partner app, funded from their Meridian account.' },
    detail: 1,
    hypothetical: H,
  },
  {
    id: 'sp-2',
    kind: 'request',
    title: 'SimPay submits the movement',
    from: SIMPAY,
    to: EP,
    label: 'POST /api/partner/movements',
    narrative: 'SimPay calls the proposed partner endpoint server-to-server. It authenticates with an API key and a body signature — not a customer cookie, so no CSRF token applies.',
    detail: 2,
    hypothetical: H,
    payload: {
      title: 'Proposed request',
      format: 'http-request',
      line: 'POST /api/partner/movements',
      headers: { authorization: 'Bearer <partner API key>', 'x-partner-signature': 'sha256=<hmac of body>', 'content-type': 'application/json' },
      data: contract.requestExample,
      typeRef: 'sh:money-movement#ExternalMovementRequest',
      highlight: ['externalReference'],
    },
  },
  {
    id: 'sp-3',
    kind: 'guard',
    title: 'Authenticate the partner and check the link',
    from: EP,
    to: PARTNER_AUTH,
    label: 'requirePartner',
    narrative: 'The proposed guard hashes the API key, finds the PartnerCredential, verifies the signature, and confirms an active PartnerLink for this account. The linked customer becomes the acting user.',
    audience: { dba: 'Two reads: PartnerCredential by keyHash (unique), PartnerLink by (partnerId, accountId).' },
    detail: 3,
    hypothetical: H,
  },
  {
    id: 'sp-4',
    kind: 'decision',
    title: 'Is the account linked to this partner?',
    from: PARTNER_AUTH,
    to: PARTNER_AUTH,
    label: 'active PartnerLink?',
    narrative: 'The customer’s consent is the access check. Without an active link the request ends here.',
    detail: 3,
    hypothetical: H,
    decision: {
      question: 'Did the customer link this account to SimPay?',
      options: [
        { label: 'Yes — linked', variant: 'accepted', description: 'Continue to validation.' },
        { label: 'No — not linked or revoked', variant: 'not-linked', description: '403 not_linked.' },
      ],
    },
  },
  {
    id: 'sp-4b',
    kind: 'response',
    title: 'Refused: not linked',
    from: EP,
    to: SIMPAY,
    label: '403 not_linked',
    narrative: 'Nothing is written. A partner can only ever touch accounts a customer explicitly linked.',
    detail: 2,
    variants: ['not-linked'],
    hypothetical: H,
    payload: { title: 'Proposed response', format: 'http-response', line: '403 Forbidden', data: { error: 'This account is not linked to SimPay.', code: 'not_linked' } },
  },
  {
    id: 'sp-5',
    kind: 'validate',
    title: 'Validate with the existing shared rules',
    from: EP,
    to: VALIDATE,
    label: 'validateExternalMovement(body)',
    narrative: 'EXISTING CODE, reused: the same validator the customer endpoint calls. Kind must be reviewable, the amount an integer between 1 and 5,000,000 minor units, and `external_ach` needs a direction and a counterparty.',
    detail: 3,
    variants: ['accepted', 'insufficient-funds'],
    sources: [{ file: 'packages/shared/src/money-movement.ts', symbol: 'export function validateExternalMovement' }],
  },
  {
    id: 'sp-6',
    kind: 'call',
    title: 'Hand over to the existing money service',
    from: EP,
    to: CREATE,
    label: 'createExternalMovement(linkedUser, input, now)',
    narrative: 'EXISTING CODE, reused: called with the linked customer as the acting user. It re-checks that this user may move money on the account and that the account is active.',
    detail: 3,
    variants: ['accepted', 'insufficient-funds'],
    sources: [{ file: 'apps/backend/src/money/movements.ts', start: 280, end: 291, symbol: 'export async function createExternalMovement' }],
  },
  {
    id: 'sp-7',
    kind: 'decision',
    title: 'Enough available funds?',
    from: CREATE,
    to: CREATE,
    label: 'availableMinor(account) ≥ amount?',
    narrative: 'EXISTING CODE: an outbound movement must not exceed the AVAILABLE balance (current minus pending debits and holds). Avery has $2,331.10 available.',
    detail: 3,
    variants: ['accepted', 'insufficient-funds'],
    sources: [{ file: 'apps/backend/src/money/movements.ts', start: 287, end: 291, symbol: 'insufficient_funds' }],
    decision: {
      question: 'Does the amount fit in the available balance?',
      options: [
        { label: 'Yes', variant: 'accepted' },
        { label: 'No', variant: 'insufficient-funds', description: '400 insufficient_funds — the partner must decline the purchase.' },
      ],
    },
  },
  {
    id: 'sp-7b',
    kind: 'response',
    title: 'Refused: insufficient funds',
    from: EP,
    to: SIMPAY,
    label: '400 insufficient_funds',
    narrative: 'The existing error, surfaced to the partner unchanged. Nothing is written.',
    detail: 2,
    variants: ['insufficient-funds'],
    hypothetical: H,
    payload: { title: 'Response', format: 'http-response', line: '400 Bad Request', data: { error: 'That movement exceeds the available balance.', code: 'insufficient_funds' } },
  },
  {
    id: 'sp-8',
    kind: 'db-write',
    title: 'Write the PENDING ledger entry',
    from: CREATE,
    to: LEDGER,
    label: 'insert pending payment debit',
    narrative: 'EXISTING CODE: a pending `payment` debit. Money has not moved, but the pending debit immediately reserves $44.05 out of the available balance.',
    audience: { executive: 'The payment is recorded as pending; the customer’s spendable balance drops straight away.', dba: 'INSERT LedgerEntry (status pending, origin payment, postedAt NULL).' },
    detail: 2,
    variants: ['accepted'],
    sources: [{ file: 'apps/backend/src/money/movements.ts', start: 314, end: 328, symbol: "status: 'pending'" }],
    effects: [
      { op: 'insert', table: 'LedgerEntry', row: { id: 'le_sp1', accountId: IDS.checking, amountMinor: 4405, direction: 'debit', status: 'pending', origin: 'payment', description: 'ACH payment to SimPay — Corner Books', postedAt: null } },
    ],
  },
  {
    id: 'sp-9',
    kind: 'db-write',
    title: 'Queue it for operator review',
    from: CREATE,
    to: OPS_REQ,
    label: 'insert OperationsRequest (+ partner reference)',
    narrative: 'EXISTING CODE writes the review item whose payload links the ledger entry. PROPOSED: the payload also records the partner and its external reference.',
    detail: 3,
    variants: ['accepted'],
    hypothetical: H,
    sources: [{ file: 'apps/backend/src/money/movements.ts', start: 330, end: 354, symbol: 'ledgerEntryIds: [entry.id]' }],
    payload: {
      title: 'OperationsRequest.payload (proposed addition highlighted)',
      format: 'row',
      data: { kind: 'external_ach', amountMinor: 4405, direction: 'outbound', accountId: IDS.checking, counterparty: 'SimPay — Corner Books', memo: 'Order 88412', ledgerEntryIds: ['le_sp1'], reference: 'MOV-7F3A9C', partner: { id: 'pc_simpay', externalReference: 'SP-20261001-88412' } },
      typeRef: 'sh:money-movement#MovementPayload',
      highlight: ['partner'],
    },
    effects: [
      { op: 'insert', table: 'OperationsRequest', row: { id: 'req_sp1', type: 'ach', status: 'pending', priority: 'normal', summary: 'External ACH — SimPay — Corner Books ($44.05)', subjectName: 'Avery Customer', subjectEmail: 'avery.customer@example.com' } },
    ],
  },
  {
    id: 'sp-10',
    kind: 'response',
    title: 'Accepted for review',
    from: EP,
    to: SIMPAY,
    label: '201 pending_review',
    narrative: 'The partner learns the movement was accepted — not that it was paid. It must wait for the outcome.',
    audience: { executive: 'The partner is told the payment is awaiting the bank’s review.' },
    detail: 1,
    variants: ['accepted'],
    hypothetical: H,
    payload: { title: 'Proposed response', format: 'http-response', line: '201 Created', data: contract.responses[0].example },
  },
  {
    id: 'sp-11',
    kind: 'call',
    title: 'An operator approves it',
    from: SAM,
    to: APPLY,
    label: 'approve (existing review flow)',
    narrative: 'EXISTING BEHAVIOUR: Sam sees the item appear live in the queue and approves it, exactly like a customer-submitted movement. See the “operations approval” scenario for the detail.',
    audience: { executive: 'A bank employee reviews and approves the payment.' },
    detail: 1,
    variants: ['accepted'],
    sources: [{ file: 'apps/backend/src/ops/requests.ts', symbol: 'applyOperatorAction' }],
    effects: [{ op: 'update', table: 'OperationsRequest', id: 'req_sp1', set: { status: 'approved', lastAction: 'approve', lastActorName: 'Sam Operator' } }],
  },
  {
    id: 'sp-12',
    kind: 'db-write',
    title: 'The pending entry is posted',
    from: POST_APPROVED,
    to: LEDGER,
    label: 'status pending → posted',
    narrative: 'EXISTING CODE: approval flips the linked ledger entry to `posted`. Now the current balance reflects the payment too.',
    audience: { dba: 'UPDATE LedgerEntry SET status = posted, postedAt = <simulated now> WHERE id IN (payload.ledgerEntryIds) AND status = pending.' },
    detail: 2,
    variants: ['accepted'],
    sources: [{ file: 'apps/backend/src/money/movements.ts', start: 439, end: 451, symbol: 'export async function postApprovedMovement' }],
    effects: [{ op: 'update', table: 'LedgerEntry', id: 'le_sp1', set: { status: 'posted', postedAt: '2026-10-01T15:20:00.000Z' } }],
  },
  {
    id: 'sp-13',
    kind: 'call',
    title: 'Notify the partner',
    from: APPLY,
    to: NOTIFIER,
    label: 'notifyPartner(request, "posted")',
    narrative: 'PROPOSED: once the transaction has committed, the gateway looks up the partner on the request payload and prepares the callback.',
    detail: 3,
    variants: ['accepted'],
    hypothetical: H,
  },
  {
    id: 'sp-14',
    kind: 'event',
    title: 'Webhook: movement settled',
    from: NOTIFIER,
    to: SIMPAY,
    label: 'partner.movement.settled',
    narrative: 'PROPOSED: Meridian calls SimPay’s webhook with the outcome and both references, so SimPay can complete the purchase.',
    audience: { executive: 'The partner is told the payment went through and completes the purchase.' },
    detail: 1,
    variants: ['accepted'],
    hypothetical: H,
    payload: { title: 'Proposed webhook body', format: 'socket', line: 'POST https://simpay.example/webhooks/meridian', data: { reference: 'MOV-7F3A9C', externalReference: 'SP-20261001-88412', outcome: 'posted', amountMinor: 4405, settledAt: '2026-10-01T15:20:00.000Z' }, typeRef: WEBHOOK },
  },
];

const scenario: Scenario = {
  id: 'simpay-payment',
  title: 'Proposed: a SimPay payment',
  question: 'How could a new external payment service integrate with Meridian?',
  summary: 'A hypothetical partner wallet submits a payment through a proposed partner endpoint that reuses Meridian’s existing validator, money service and operator review.',
  category: 'integration',
  tags: ['hypothetical', 'integration', 'paypal'],
  participants: [AVERY, SIMPAY, EP, PARTNER_AUTH, VALIDATE, CREATE, LEDGER, OPS_REQ, SAM, APPLY, POST_APPROVED, NOTIFIER],
  related: [SIMPAY, EP, GATEWAY, 'ep:POST /api/movements', 'boundary:external'],
  variants: [
    { id: 'accepted', label: 'Accepted, approved and settled', outcome: 'success', hypothetical: true },
    { id: 'not-linked', label: 'Account not linked to the partner', outcome: 'rejected', hypothetical: true },
    { id: 'insufficient-funds', label: 'Insufficient available funds', outcome: 'rejected', hypothetical: true },
  ],
  defaultVariant: 'accepted',
  initialState: baseState(),
  watchAccounts: [IDS.checking],
  steps,
  confidence: 'hypothetical',
};

export const simpayLayer: HypotheticalLayer = {
  id: 'layer:simpay',
  name: 'SimPay — external payment service',
  description:
    'A worked example of integration planning: a PayPal-like wallet that moves money for customers who link their account. It proposes a partner endpoint, a partner guard, two tables, an outcome webhook, and four changes to existing code — and reuses the existing validator, money service and operator review unchanged. Entirely hypothetical.',
  entities,
  relations,
  contracts: [contract],
  modifications,
  scenarios: [scenario],
  builtIn: true,
};
