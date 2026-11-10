import type { Contract, ContractError, FieldDef, FlowStep } from '../../types';
import { F, src } from './util';

/**
 * Contracts for the six endpoints registered by `routes/money.ts` and
 * `routes/accounts.ts`. Field rules come from the route coercion plus the
 * shared validators; error lists cover the global hooks, the guards, the
 * handler and the services it calls.
 */

const AMOUNT_ERROR = 'Enter an amount between $0.01 and $50,000 (simulated).';

// ---- Example values (consistent with fixtures.ts) ---------------------------

const checkingSummary = {
  id: 'acc_checking',
  name: 'Everyday Checking',
  type: 'checking',
  status: 'active',
  currency: 'USD',
  relationship: 'owner',
  balances: { currentMinor: 245110, availableMinor: 233110, pendingCreditMinor: 0, pendingDebitMinor: 12000, heldMinor: 0 },
};

const savingsSummary = {
  id: 'acc_savings',
  name: 'Goal Savings',
  type: 'savings',
  status: 'active',
  currency: 'USD',
  relationship: 'owner',
  balances: { currentMinor: 500000, availableMinor: 500000, pendingCreditMinor: 0, pendingDebitMinor: 0, heldMinor: 0 },
};

const accountSummaryFields: FieldDef[] = [
  { name: 'id', type: 'string', required: true },
  { name: 'name', type: 'string', required: true },
  { name: 'type', type: 'AccountType', required: true, values: ['checking', 'savings', 'cd', 'loan'] },
  { name: 'status', type: 'AccountStatus', required: true },
  { name: 'currency', type: 'string', required: true },
  { name: 'relationship', type: 'AccountRelationship', required: true, values: ['owner', 'joint', 'authorized', 'viewer'], description: 'The CALLER’s relationship to the account.' },
  { name: 'balances', type: 'DerivedBalances', required: true, typeRef: 'sh:ledger#DerivedBalances', description: 'Derived from the ledger at request time; never stored.' },
];

// ---- Shared flow steps and errors -------------------------------------------

const csrfMutating: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (global onRequest)',
  detail:
    'For a POST that carries a session cookie, the `x-meridian-csrf` header must equal the `mer_csrf` cookie (constant-time compare). A request with NO session cookie is let through so the auth guard can answer 401.',
  rejects: [{ status: 403, code: 'csrf_failed', when: 'a session cookie is present and the CSRF header is missing or does not match the cookie' }],
  source: src(F.csrf, 86, 116, 'export async function csrfHook'),
};

const csrfSafe: FlowStep = {
  kind: 'hook',
  target: 'be:auth/csrf#csrfHook',
  label: 'csrfHook (global onRequest)',
  detail: 'GET is a safe method: nothing is checked. If the client has no `mer_csrf` cookie yet, the hook sets one on the response.',
  source: src(F.csrf, 90, 93, 'SAFE_METHODS.has(method)'),
};

const valveMutating: FlowStep = {
  kind: 'hook',
  target: 'be:abuse/rate-limit#mutationValveHook',
  label: 'mutationValveHook (global onRequest)',
  detail: 'Public-demo mode only: counts every state-changing request per client IP against the `mutations` bucket (200 per 5 minutes). A no-op otherwise.',
  rejects: [{ status: 429, code: 'rate_limited', when: 'abuse protection is on and this IP has made more than 200 mutating requests in 5 minutes' }],
  source: src(F.rateLimit, 172, 183, 'export async function mutationValveHook'),
};

const valveSafe: FlowStep = {
  kind: 'hook',
  target: 'be:abuse/rate-limit#mutationValveHook',
  label: 'mutationValveHook (global onRequest)',
  detail: 'Returns immediately for GET, HEAD and OPTIONS.',
  source: src(F.rateLimit, 178, 183, 'SAFE_METHODS.has(req.method.toUpperCase())'),
};

const requireAuthStep: FlowStep = {
  kind: 'guard',
  target: 'be:auth/guards#requireAuth',
  label: 'requireAuth (preHandler)',
  detail: 'Reads the session cookie for the request’s surface, resolves it to a session and user, and sets `req.user`.',
  rejects: [
    { status: 401, code: 'unauthenticated', when: 'there is no session cookie' },
    { status: 401, code: 'session_expired', when: 'the cookie does not resolve to a live session (the cookie is cleared)' },
  ],
  source: src(F.guards, 43, 66, 'export const requireAuth'),
};

const moneyRateLimitStep: FlowStep = {
  kind: 'guard',
  target: 'be:abuse/rate-limit#rateLimit',
  label: "rateLimit('money') (preHandler)",
  detail: 'Public-demo mode only: 30 money requests per 5 minutes per signed-in user (it runs after requireAuth, so the key is the user id). A no-op otherwise.',
  rejects: [{ status: 429, code: 'rate_limited', when: 'abuse protection is on and this user has made more than 30 money requests in 5 minutes' }],
  source: src(F.rateLimit, 152, 168, 'export function rateLimit'),
};

const authErrors: ContractError[] = [
  { status: 401, code: 'unauthenticated', when: 'No session cookie was sent.', example: { error: 'Not authenticated.', code: 'unauthenticated' }, source: src(F.guards, 47, 53, "code: 'unauthenticated'") },
  {
    status: 401,
    code: 'session_expired',
    when: 'The session cookie does not resolve to a live session; the server also clears the cookie.',
    example: { error: 'Your session has expired. Please log in again.', code: 'session_expired' },
    source: src(F.guards, 54, 59, "code: 'session_expired'"),
  },
];

const mutationErrors: ContractError[] = [
  {
    status: 403,
    code: 'csrf_failed',
    when: 'A session cookie is present but the `x-meridian-csrf` header is missing or differs from the `mer_csrf` cookie. Checked before authentication.',
    example: { error: 'Missing or invalid CSRF token. Reload the page and try again.', code: 'csrf_failed' },
    source: src(F.csrf, 110, 115, "code: 'csrf_failed'"),
  },
  ...authErrors,
  {
    status: 429,
    code: 'rate_limited',
    when: 'Public-demo mode only: the per-user `money` bucket (30 per 5 minutes) or the per-IP `mutations` valve (200 per 5 minutes) is exhausted. The response carries a `retry-after` header in seconds.',
    example: { error: 'Too many requests for this shared demo — please slow down and try again in a moment.', code: 'rate_limited' },
    source: src(F.rateLimit, 142, 150, "code: 'rate_limited'"),
  },
  {
    status: 400,
    when: 'The body is not valid JSON (the server’s JSON content-type parser). An EMPTY body is accepted as `{}` and then fails field validation instead.',
    source: src(F.server, 95, 112, 'Request body is not valid JSON.'),
  },
  {
    status: 413,
    when: 'The body is larger than 64 KiB (`MAX_REQUEST_BODY_BYTES`, set as Fastify’s `bodyLimit`).',
    source: src(F.server, 57, 60, 'bodyLimit: MAX_REQUEST_BODY_BYTES'),
  },
];

const accountServiceErrors: ContractError[] = [
  {
    status: 404,
    code: 'not_found',
    when: 'An account id in the body does not exist.',
    example: { error: 'That account was not found.', code: 'not_found' },
    source: src(F.movements, 119, 123, "new MovementError('not_found'"),
  },
  {
    status: 403,
    code: 'forbidden',
    when: 'The caller has no relationship to an account, or only `viewer` access.',
    example: { error: 'You cannot move money on that account.', code: 'forbidden' },
    source: src(F.movements, 124, 127, "new MovementError('forbidden'"),
  },
  {
    status: 400,
    code: 'inactive_account',
    when: 'An account’s status is not `active`.',
    example: { error: 'That account is not active.', code: 'inactive_account' },
    source: src(F.movements, 128, 130, "new MovementError('inactive_account'"),
  },
];

const accountReadErrors: ContractError[] = [
  ...authErrors,
  { status: 404, code: 'not_found', when: 'No account has this id.', example: { error: 'Account not found.', code: 'not_found' } },
  { status: 403, code: 'forbidden', when: 'The account exists but the caller has no relationship to it (no AccountAccess grant and not the owner).', example: { error: 'You do not have access to this account.', code: 'forbidden' } },
];

const accountIdParam: FieldDef[] = [{ name: 'id', type: 'string', required: true, description: 'The account id (a cuid).', references: 'db:Account' }];

// ---------------------------------------------------------------------------
// POST /api/transfers
// ---------------------------------------------------------------------------

const postTransfers: Contract = {
  id: 'ep:POST /api/transfers',
  method: 'POST',
  path: '/api/transfers',
  summary: 'Transfer money immediately between two accounts the caller can move money on.',
  description:
    'Posts a `transfer` debit on the source and a `transfer` credit on the destination in one database transaction, writes an audit row, and returns both accounts with re-derived balances. There is no operator review. The handler is deliberately thin: coerce → validate (shared validator) → read the simulated time → `createTransfer`.',
  auth: {
    required: true,
    surface: 'customer',
    csrf: true,
    rateLimit: 'money',
    notes:
      'Any signed-in user passes the guard (there is no role check); what limits the call is per-account access — the caller must be owner, joint or authorized on BOTH accounts. Staff users have no account grants, so their calls end in 403/404.',
  },
  bodyTypeRef: 'sh:money-movement#TransferRequest',
  body: [
    {
      name: 'fromAccountId',
      type: 'string',
      required: true,
      description: 'Account to debit.',
      references: 'db:Account',
      rules: [
        'Route: a non-string is treated as missing; a string is cut to 500 characters',
        'Validator: trimmed; empty → fields.fromAccountId = "Choose the account to transfer from."',
        'Service: must exist (404), caller must be owner/joint/authorized (403), status must be active (400)',
      ],
      source: src(F.routesMoney, 68, 73, 'body.fromAccountId.slice(0, MAX_FIELD)'),
    },
    {
      name: 'toAccountId',
      type: 'string',
      required: true,
      description: 'Account to credit.',
      references: 'db:Account',
      rules: [
        'Route: a non-string is treated as missing; a string is cut to 500 characters',
        'Validator: trimmed; empty → "Choose the account to transfer to."',
        'Validator: equal to fromAccountId → "Choose two different accounts."',
        'Service: same existence, access and active checks as the source',
      ],
      source: src(F.shMovement, 208, 210, 'Choose two different accounts.'),
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      typeRef: 'sh:money#Minor',
      description: 'Amount in integer cents.',
      rules: [
        'Route: anything that is not a JavaScript number (e.g. the string "250") is treated as missing',
        'Validator: must be an integer, ≥ 1 and ≤ 5,000,000',
        `Validator: any failure → fields.amountMinor = "${AMOUNT_ERROR}"`,
        'Service: must not exceed the source account’s AVAILABLE balance (400 insufficient_funds)',
      ],
      source: src(F.shMovement, 176, 185, 'function validAmount'),
    },
    {
      name: 'memo',
      type: 'string | null',
      required: false,
      description: 'Appended to both ledger descriptions as " — <memo>".',
      rules: ['Route: a non-string is ignored; a string is cut to 500 characters', 'Validator: trimmed; empty → null; cut to 140 characters; never an error'],
      source: src(F.shMovement, 187, 192, 'function normalizeText'),
    },
  ],
  requestExample: { fromAccountId: 'acc_checking', toAccountId: 'acc_savings', amountMinor: 25000, memo: 'Move to savings' },
  responses: [
    {
      status: 201,
      description: 'Both legs posted. Returns the source and destination accounts with balances re-derived after the commit.',
      typeRef: 'sh:money-movement#TransferResponse',
      fields: [
        { name: 'ok', type: 'true', required: true },
        { name: 'message', type: 'string', required: true },
        { name: 'amountMinor', type: 'number', required: true },
        { name: 'accounts', type: 'AccountSummary[]', required: true, typeRef: 'sh:auth#AccountSummary', description: 'Source first, destination second.', children: accountSummaryFields },
      ],
      example: {
        ok: true,
        message: 'Transfer posted (simulated). Both accounts have been updated.',
        amountMinor: 25000,
        accounts: [
          { ...checkingSummary, balances: { currentMinor: 220110, availableMinor: 208110, pendingCreditMinor: 0, pendingDebitMinor: 12000, heldMinor: 0 } },
          { ...savingsSummary, balances: { currentMinor: 525000, availableMinor: 525000, pendingCreditMinor: 0, pendingDebitMinor: 0, heldMinor: 0 } },
        ],
      },
    },
  ],
  errors: [
    {
      status: 400,
      code: 'invalid_request',
      when: 'The shared validator rejected the body. `fields` maps each offending field to its message.',
      example: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { toAccountId: 'Choose two different accounts.', amountMinor: AMOUNT_ERROR } },
      source: src(F.routesMoney, 74, 76, 'Please correct the highlighted fields.'),
    },
    {
      status: 400,
      code: 'insufficient_funds',
      when: 'The amount is greater than the source account’s available balance (current minus pending debits and holds).',
      example: { error: 'That transfer exceeds the available balance.', code: 'insufficient_funds' },
      source: src(F.movements, 183, 185, 'That transfer exceeds the available balance.'),
    },
    ...accountServiceErrors,
    ...mutationErrors,
  ],
  flow: [
    csrfMutating,
    valveMutating,
    requireAuthStep,
    moneyRateLimitStep,
    {
      kind: 'validate',
      target: 'be:routes/money',
      label: 'coerce body fields',
      detail: 'Each field is kept only if it has the expected JavaScript type (strings for ids and memo, number for the amount); strings are cut to 500 characters. Everything else becomes `undefined`.',
      source: src(F.routesMoney, 67, 73, 'slice(0, MAX_FIELD)'),
    },
    {
      kind: 'validate',
      target: 'sh:money-movement#validateTransfer',
      label: 'validateTransfer(body)',
      detail: 'Ids present and different, amount an integer between 1 and 5,000,000 cents, memo normalized. Produces a NormalizedTransfer.',
      rejects: [{ status: 400, code: 'invalid_request', when: 'any field fails; the response includes a per-field `fields` map' }],
      source: src(F.routesMoney, 68, 76, 'validateTransfer('),
    },
    {
      kind: 'call',
      target: 'be:clock/clock#simulationNow',
      label: 'simulationNow(prisma)',
      detail: 'Reads the simulation clock singleton (creating it if missing). The returned instant dates both ledger entries.',
      source: src(F.routesMoney, 78, 78, 'simulationNow(prisma)'),
    },
    {
      kind: 'call',
      target: 'be:money/movements#createTransfer',
      label: 'createTransfer(req.user, value, now)',
      detail: 'The domain service: access checks, funds check, the write transaction and the response summaries.',
      source: src(F.movements, 175, 181, 'export async function createTransfer'),
    },
    {
      kind: 'call',
      target: 'be:money/movements#requireMovableAccount',
      label: 'requireMovableAccount ×2 (source, then destination)',
      detail: 'Each account must exist, the caller must be owner, joint or authorized on it, and it must be active.',
      rejects: [
        { status: 404, code: 'not_found', when: 'an account id does not exist' },
        { status: 403, code: 'forbidden', when: 'the caller has no (or only viewer) access to an account' },
        { status: 400, code: 'inactive_account', when: 'an account is not active' },
      ],
      source: src(F.movements, 115, 132, 'async function requireMovableAccount'),
    },
    {
      kind: 'db-read',
      target: 'db:Account',
      label: 'account + its ledger entries; AccountAccess grant',
      detail: 'Per account: `account.findUnique` selecting id, name, status and every entry’s amount/direction/status, then `accountAccess.findUnique` on (userId, accountId) inside getAccountRelationship.',
      source: src(F.movements, 119, 124, 'prisma.account.findUnique'),
    },
    {
      kind: 'decision',
      target: 'be:money/movements#availableMinor',
      label: 'available balance ≥ amount?',
      detail: '`deriveBalances` over the source account’s entries; the AVAILABLE figure is compared with the amount.',
      rejects: [{ status: 400, code: 'insufficient_funds', when: 'available balance < amountMinor' }],
      source: src(F.movements, 183, 185, 'availableMinor(from.account) < input.amountMinor'),
    },
    {
      kind: 'transaction',
      target: 'be:money/movements#createTransfer',
      label: 'prisma.$transaction — 3 writes',
      detail: 'The two ledger inserts and the audit insert commit together or not at all.',
      source: src(F.movements, 189, 228, 'await prisma.$transaction(async (tx) => {'),
    },
    {
      kind: 'db-write',
      target: 'db:LedgerEntry',
      label: 'insert debit leg (source) + credit leg (destination)',
      detail: 'Both rows: status `posted`, origin `transfer`, same amountMinor, postedAt = createdAt = simulated now. Descriptions "Transfer to <dest>" / "Transfer from <source>" plus the memo.',
      source: src(F.movements, 190, 213, "origin: 'transfer'"),
    },
    {
      kind: 'db-write',
      target: 'db:AuditLog',
      label: 'insert audit row: money_transfer',
      detail: 'actor = the customer, entity `account`, entityId = source account id, reason "Transfer $250.00 to Goal Savings (simulated)", metadata with the amount and both account ids.',
      source: src(F.movements, 214, 227, "action: 'money_transfer'"),
    },
    {
      kind: 'call',
      target: 'be:money/movements#summarize',
      label: 'summarize ×2 → re-derived balances',
      detail: 'After the commit each account is re-read with all its entries and `deriveBalances` is applied, so the response reflects the ledger as stored.',
      source: src(F.movements, 230, 236, 'await summarize('),
    },
    {
      kind: 'respond',
      label: '201 TransferResponse',
      detail: '`{ ok: true, message, amountMinor, accounts: [source, destination] }`.',
      source: src(F.routesMoney, 79, 85, 'reply.code(201).send(response)'),
    },
  ],
  sideEffects: [
    'Inserts two posted LedgerEntry rows (a transfer debit and a transfer credit) — the system-wide settled total is unchanged.',
    'Inserts one AuditLog row with action `money_transfer`.',
    'Emits no real-time event and creates no operations request.',
  ],
  mutates: true,
  calledBy: ['cu:lib/money#createTransfer'],
  integrationNotes:
    'Send JSON with `credentials: "include"` (the customer session cookie) and echo the `mer_csrf` cookie in the `x-meridian-csrf` header. `amountMinor` must be a JSON number of whole cents — "250.00" or 250.5 is rejected. A 201 means the transfer is final: both balances in the response are already updated. Treat 400 `invalid_request` as form errors (`fields`), 400 `insufficient_funds` as a business refusal, and note that the check uses the AVAILABLE balance, which can be lower than the current balance when payments are pending.',
  sources: [
    src(F.routesMoney, 66, 89, "app.post('/api/transfers'", 'The handler'),
    src(F.movements, 170, 237, 'export async function createTransfer', 'The service it delegates to'),
    src(F.tMoney, 73, 142, "describe('POST /api/transfers (internal, immediate)'", 'Integration tests'),
  ],
};

// ---------------------------------------------------------------------------
// POST /api/movements
// ---------------------------------------------------------------------------

const movementResponseExample = {
  reference: 'MOV-7F3A9C',
  kind: 'bill_pay',
  status: 'pending_review',
  amountMinor: 4405,
  direction: 'outbound',
  message:
    'Your simulated movement was submitted and is awaiting operator review. It will appear as “Pending” until an operator posts it. (SIMULATION — no real money network was contacted.)',
};

const postMovements: Contract = {
  id: 'ep:POST /api/movements',
  method: 'POST',
  path: '/api/movements',
  summary: 'Submit a mobile check deposit, external ACH, wire or bill payment for operator review.',
  description:
    'Writes a PENDING ledger entry and a linked operations request (plus an audit row and a simulated "received" event) in one transaction, then publishes the new request and event to the operators’ Socket.IO room. Nothing posts until an operator approves. For an outbound movement the pending debit reserves the customer’s available balance immediately.',
  auth: {
    required: true,
    surface: 'customer',
    csrf: true,
    rateLimit: 'money',
    notes: 'No role check; the caller must be owner, joint or authorized on the account. Shares the `money` rate-limit bucket with POST /api/transfers.',
  },
  bodyTypeRef: 'sh:money-movement#ExternalMovementRequest',
  body: [
    {
      name: 'accountId',
      type: 'string',
      required: true,
      references: 'db:Account',
      rules: [
        'Route: a non-string is treated as missing; a string is cut to 500 characters',
        'Validator: trimmed; empty → "Choose the account for this movement."',
        'Service: must exist (404), caller must be owner/joint/authorized (403), status must be active (400)',
      ],
      source: src(F.shMovement, 238, 239, 'Choose the account for this movement.'),
    },
    {
      name: 'kind',
      type: 'string',
      required: true,
      typeRef: 'sh:money-movement#ReviewableMovementKind',
      values: ['external_ach', 'wire', 'mobile_check_deposit', 'bill_pay'],
      rules: ['Route: a non-string is treated as missing', 'Validator: must be one of the four reviewable kinds; `internal_transfer` or anything else → "Choose a valid movement type."'],
      source: src(F.shMovement, 241, 243, 'Choose a valid movement type.'),
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      typeRef: 'sh:money#Minor',
      rules: [
        'Route: anything that is not a JavaScript number is treated as missing',
        'Validator: integer, ≥ 1 and ≤ 5,000,000',
        `Validator: any failure → "${AMOUNT_ERROR}"`,
        'Service, outbound only: must not exceed the account’s AVAILABLE balance (400 insufficient_funds)',
      ],
      source: src(F.shMovement, 245, 245, 'validAmount(input.amountMinor)'),
    },
    {
      name: 'direction',
      type: 'string',
      required: false,
      typeRef: 'sh:money-movement#MovementDirection',
      values: ['inbound', 'outbound'],
      description: 'Only meaningful for `external_ach`.',
      rules: [
        'wire and bill_pay are always outbound; mobile_check_deposit is always inbound — any value sent is ignored',
        'external_ach: must be "inbound" or "outbound", else "Choose whether the money comes in or goes out."',
      ],
      source: src(F.shMovement, 247, 258, 'Choose whether the money comes in or goes out.'),
    },
    {
      name: 'counterparty',
      type: 'string | null',
      required: false,
      description: 'Biller, recipient or source account label. Display only.',
      rules: [
        'Route: a non-string is ignored; a string is cut to 500 characters',
        'Validator: trimmed; empty → null; cut to 80 characters',
        'Required for bill_pay → "Enter the biller’s name."',
        'Required for wire and external_ach → "Enter the other account or recipient."',
        'Not required for mobile_check_deposit',
      ],
      source: src(F.shMovement, 260, 265, 'Enter the biller’s name.'),
    },
    {
      name: 'memo',
      type: 'string | null',
      required: false,
      rules: ['Route: a non-string is ignored; a string is cut to 500 characters', 'Validator: trimmed; empty → null; cut to 140 characters; never an error'],
      source: src(F.shMovement, 267, 267, 'MOVEMENT_TEXT.memoMaxLength'),
    },
  ],
  requestExample: { accountId: 'acc_checking', kind: 'bill_pay', amountMinor: 4405, direction: 'outbound', counterparty: 'Metro Water Services', memo: null },
  responses: [
    {
      status: 201,
      description: 'The movement is queued. `status` is always `pending_review`; the reference identifies it to the customer.',
      typeRef: 'sh:money-movement#ExternalMovementResponse',
      fields: [
        { name: 'reference', type: 'string', required: true, description: 'MOV- plus six hex characters.' },
        { name: 'kind', type: 'MovementKind', required: true, typeRef: 'sh:money-movement#MovementKind' },
        { name: 'status', type: "'pending_review'", required: true },
        { name: 'amountMinor', type: 'number', required: true },
        { name: 'direction', type: 'MovementDirection', required: true, typeRef: 'sh:money-movement#MovementDirection', description: 'The RESOLVED direction (fixed by kind, or as chosen for ACH).' },
        { name: 'message', type: 'string', required: true },
      ],
      example: movementResponseExample,
    },
  ],
  errors: [
    {
      status: 400,
      code: 'invalid_request',
      when: 'The shared validator rejected the body. `fields` maps each offending field to its message.',
      example: { error: 'Please correct the highlighted fields.', code: 'invalid_request', fields: { counterparty: 'Enter the biller’s name.' } },
      source: src(F.routesMoney, 102, 104, 'Please correct the highlighted fields.'),
    },
    {
      status: 400,
      code: 'insufficient_funds',
      when: 'An OUTBOUND movement is larger than the account’s available balance. Inbound movements are never checked.',
      example: { error: 'That movement exceeds the available balance.', code: 'insufficient_funds' },
      source: src(F.movements, 289, 291, 'That movement exceeds the available balance.'),
    },
    {
      status: 409,
      code: 'limit_reached',
      when: 'The caller already has 25 movement requests in status `pending` (RESOURCE_CAPS.pendingMovementsPerUser). Enforced in every mode; an operator decision frees capacity.',
      example: { error: 'You already have 25 movements awaiting operator review (the simulated maximum).', code: 'limit_reached' },
      source: src(F.movements, 293, 308, "'limit_reached'"),
    },
    ...accountServiceErrors,
    ...mutationErrors,
  ],
  flow: [
    csrfMutating,
    valveMutating,
    requireAuthStep,
    moneyRateLimitStep,
    {
      kind: 'validate',
      target: 'be:routes/money',
      label: 'coerce body fields',
      detail: 'Keeps each field only if it has the expected JavaScript type; cuts accountId, counterparty and memo to 500 characters.',
      source: src(F.routesMoney, 93, 101, 'slice(0, MAX_FIELD)'),
    },
    {
      kind: 'validate',
      target: 'sh:money-movement#validateExternalMovement',
      label: 'validateExternalMovement(body)',
      detail: 'Account present, reviewable kind, amount in range, direction resolved (fixed by kind or chosen for ACH), counterparty where required. Produces a NormalizedExternalMovement.',
      rejects: [{ status: 400, code: 'invalid_request', when: 'any field fails; the response includes a per-field `fields` map' }],
      source: src(F.routesMoney, 94, 104, 'validateExternalMovement('),
    },
    {
      kind: 'call',
      target: 'be:clock/clock#simulationNow',
      label: 'simulationNow(prisma)',
      detail: 'The simulated instant that dates the pending entry, the request and the simulated event.',
      source: src(F.routesMoney, 106, 106, 'simulationNow(prisma)'),
    },
    {
      kind: 'call',
      target: 'be:money/movements#createExternalMovement',
      label: 'createExternalMovement(req.user, value, now)',
      detail: 'The domain service: access check, funds check (outbound), cap check and the write transaction.',
      source: src(F.movements, 280, 285, 'export async function createExternalMovement'),
    },
    {
      kind: 'call',
      target: 'be:money/movements#requireMovableAccount',
      label: 'requireMovableAccount(user.id, accountId)',
      detail: 'The account must exist, the caller must be owner, joint or authorized, and it must be active.',
      rejects: [
        { status: 404, code: 'not_found', when: 'the account id does not exist' },
        { status: 403, code: 'forbidden', when: 'the caller has no (or only viewer) access' },
        { status: 400, code: 'inactive_account', when: 'the account is not active' },
      ],
      source: src(F.movements, 115, 132, 'async function requireMovableAccount'),
    },
    {
      kind: 'decision',
      target: 'be:money/movements#availableMinor',
      label: 'outbound: available balance ≥ amount?',
      detail: 'Skipped for inbound movements. For outbound ones the amount is compared with the derived AVAILABLE balance.',
      rejects: [{ status: 400, code: 'insufficient_funds', when: 'direction is outbound and available balance < amountMinor' }],
      source: src(F.movements, 287, 291, "direction === 'outbound' && availableMinor(account) < input.amountMinor"),
    },
    {
      kind: 'db-read',
      target: 'db:OperationsRequest',
      label: 'count pending movement requests for this user',
      detail: 'WHERE status = "pending" AND subjectEmail = the user’s email AND type IN (ach, wire, deposit, bill_pay).',
      rejects: [{ status: 409, code: 'limit_reached', when: 'the count is already 25' }],
      source: src(F.movements, 296, 308, 'prisma.operationsRequest.count'),
    },
    {
      kind: 'transaction',
      target: 'be:money/movements#createExternalMovement',
      label: 'prisma.$transaction — 4 writes',
      detail: 'The pending entry, the request, the audit row and the simulated event commit together or not at all.',
      source: src(F.movements, 314, 317, 'await prisma.$transaction(async (tx) => {'),
    },
    {
      kind: 'db-write',
      target: 'db:LedgerEntry',
      label: 'insert PENDING entry',
      detail: 'credit + origin `deposit` for inbound, debit + origin `payment` for outbound; status `pending`, postedAt null, createdAt = simulated now.',
      source: src(F.movements, 317, 328, 'tx.ledgerEntry.create'),
    },
    {
      kind: 'db-write',
      target: 'db:OperationsRequest',
      label: 'insert pending request with MovementPayload',
      detail: 'type from the kind (deposit / ach / wire / bill_pay), priority `high` for a wire else `normal`, subject = the customer, payload JSON including `ledgerEntryIds: [entry.id]` and the reference.',
      source: src(F.movements, 330, 354, 'tx.operationsRequest.create'),
    },
    {
      kind: 'db-write',
      target: 'db:AuditLog',
      label: 'insert audit row: ops_request_created',
      detail: 'entity `operations_request`, entityId = the request id; this becomes the first line ("created") of the request’s history in the console.',
      source: src(F.movements, 356, 365, "action: 'ops_request_created'"),
    },
    {
      kind: 'db-write',
      target: 'db:SimulatedEvent',
      label: 'insert simulated event: movement_received',
      detail: 'channel `email`, status `sent`, summary "<Kind label> received — under review (simulated)", linked to the request.',
      source: src(F.movements, 367, 379, "kind: 'movement_received'"),
    },
    {
      kind: 'emit',
      target: 'ev:ops:request_changed',
      label: "opsRealtime.requestChanged('created', request)",
      detail: 'After the commit, the new request DTO is broadcast to the operators room only.',
      source: src(F.routesMoney, 107, 108, "app.opsRealtime.requestChanged('created', created.request)"),
    },
    {
      kind: 'emit',
      target: 'ev:ops:external_event',
      label: 'opsRealtime.externalEvent(event)',
      detail: 'The simulated event is broadcast to the operators’ activity feed.',
      source: src(F.routesMoney, 109, 109, 'app.opsRealtime.externalEvent(event)'),
    },
    {
      kind: 'respond',
      label: '201 ExternalMovementResponse',
      detail: '`{ reference, kind, status: "pending_review", amountMinor, direction, message }`.',
      source: src(F.routesMoney, 111, 120, "status: 'pending_review'"),
    },
  ],
  sideEffects: [
    'Inserts one PENDING LedgerEntry (deposit credit or payment debit). A pending debit lowers the available balance at once; a pending credit is not spendable.',
    'Inserts one OperationsRequest (status pending) whose JSON payload links the ledger entry.',
    'Inserts one AuditLog row (`ops_request_created`) and one SimulatedEvent (`movement_received`).',
    'Emits `ops:request_changed` (change "created") and `ops:external_event` to the operators’ Socket.IO room.',
    'The settled total does not change until an operator approves.',
  ],
  mutates: true,
  calledBy: ['cu:lib/money#createMovement'],
  integrationNotes:
    'Send JSON with the session cookie and the `x-meridian-csrf` header. A 201 does NOT mean money has moved: the movement is `pending_review` and an operator must approve it (POST /api/ops/requests/:id/action). There is no customer endpoint to poll a movement by reference — the customer sees it as a Pending line in GET /api/accounts/:id/transactions and in the account’s balances. For outbound kinds, expect 400 `insufficient_funds` against the AVAILABLE balance. Expect 409 `limit_reached` once 25 of the caller’s movements are awaiting review.',
  sources: [
    src(F.routesMoney, 91, 124, "app.post('/api/movements'", 'The handler'),
    src(F.movements, 273, 385, 'export async function createExternalMovement', 'The service it delegates to'),
    src(F.tMoney, 146, 219, "describe('POST /api/movements (external, reviewable)'", 'Integration tests'),
    src(F.tCaps, 146, 162, 'movements awaiting review per user are capped', 'The cap, tested'),
  ],
};

// ---------------------------------------------------------------------------
// GET /api/accounts
// ---------------------------------------------------------------------------

const getAccounts: Contract = {
  id: 'ep:GET /api/accounts',
  method: 'GET',
  path: '/api/accounts',
  summary: 'List the accounts the signed-in user may see, each with balances derived from its ledger.',
  description:
    'Visibility comes from `AccountAccess` grants (owner, joint, authorized, viewer), with accounts whose `Account.userId` is the caller added as a fallback. For each account the service loads every ledger entry and runs `deriveBalances`; no balance is read from a column because none exists. The list is sorted by account name. A user with no accounts (for example an operator) gets an empty list, not an error.',
  auth: { required: true, surface: 'customer', csrf: false, notes: 'No role check. Read-only, so no CSRF header and no rate-limit bucket.' },
  responses: [
    {
      status: 200,
      description: 'The caller’s accounts, sorted by name.',
      fields: [{ name: 'accounts', type: 'AccountSummary[]', required: true, typeRef: 'sh:auth#AccountSummary', children: accountSummaryFields }],
      example: { accounts: [checkingSummary, savingsSummary] },
    },
  ],
  errors: authErrors,
  flow: [
    csrfSafe,
    valveSafe,
    requireAuthStep,
    {
      kind: 'call',
      target: 'be:auth/access#listAccessibleAccounts',
      label: 'listAccessibleAccounts(prisma, user.id)',
      detail: 'Merges explicit grants with owned accounts, derives balances for each, sorts by name.',
      source: src(F.access, 107, 140, 'export async function listAccessibleAccounts'),
    },
    {
      kind: 'db-read',
      target: 'db:AccountAccess',
      label: 'grants for the user, including each account and its ledger entries',
      detail: '`accountAccess.findMany({ where: { userId }, include: { account: { include: { ledgerEntries: true } } } })`.',
      source: src(F.access, 112, 115, 'prisma.accountAccess.findMany'),
    },
    {
      kind: 'db-read',
      target: 'db:Account',
      label: 'accounts owned by the user (fallback), with ledger entries',
      detail: '`account.findMany({ where: { userId }, include: { ledgerEntries: true } })` — adds any owned account that lacks an explicit grant, as `owner`.',
      source: src(F.access, 125, 135, 'prisma.account.findMany'),
    },
    {
      kind: 'db-read',
      target: 'db:LedgerEntry',
      label: 'every ledger entry of each account',
      detail: 'Loaded through the `ledgerEntries` include on both queries above; all statuses, no filter.',
      source: src(F.access, 112, 129, 'include: { ledgerEntries: true }'),
    },
    {
      kind: 'call',
      target: 'sh:ledger#deriveBalances',
      label: 'deriveBalances(entries) per account',
      detail: 'Inside `toSummary`: rows are mapped to amount/direction/status and folded into current, available, pending in, pending out and held.',
      source: src(F.access, 38, 65, 'deriveBalances('),
    },
    { kind: 'respond', label: '200 { accounts }', detail: 'An array of AccountSummary.', source: src(F.routesAccounts, 48, 49, 'reply.send({ accounts })') },
  ],
  sideEffects: ['None on business data. If the client has no `mer_csrf` cookie the global CSRF hook sets one on the response.'],
  mutates: false,
  calledBy: ['cu:lib/auth#fetchAccounts'],
  integrationNotes:
    'Send the session cookie. Every `…Minor` value is integer cents. `availableMinor` is what the customer can spend now (it already subtracts pending outgoing payments and holds and excludes pending incoming money); `currentMinor` is the settled balance. Balances are computed per request, so two calls either side of a transfer or an operator approval return different numbers with no cache to invalidate.',
  sources: [
    src(F.routesAccounts, 45, 50, "app.get('/api/accounts'", 'The handler'),
    src(F.access, 107, 140, 'export async function listAccessibleAccounts', 'The service it delegates to'),
    src(F.tRbac, 29, 66, "describe('GET /api/accounts (own-accounts scoping)'", 'Integration tests'),
  ],
};

// ---------------------------------------------------------------------------
// GET /api/accounts/:id
// ---------------------------------------------------------------------------

const getAccount: Contract = {
  id: 'ep:GET /api/accounts/:id',
  method: 'GET',
  path: '/api/accounts/:id',
  summary: 'Read one account with derived balances.',
  description:
    'The service reports existence and access separately so the route can distinguish 404 (no such account) from 403 (exists, but the caller has no relationship to it). A `viewer` relationship is enough to READ an account; it is not enough to move money on it. No frontend calls this endpoint at the pinned commit; the backend tests use it to read available balances.',
  auth: { required: true, surface: 'customer', csrf: false, notes: 'No role check; access is per account. An operator session is authenticated but gets 403 for a customer account.' },
  pathParams: accountIdParam,
  responses: [
    {
      status: 200,
      description: 'The account summary.',
      fields: [{ name: 'account', type: 'AccountSummary', required: true, typeRef: 'sh:auth#AccountSummary', children: accountSummaryFields }],
      example: { account: checkingSummary },
    },
  ],
  errors: accountReadErrors.map((e) =>
    e.code === 'not_found'
      ? { ...e, source: src(F.routesAccounts, 57, 60, "code: 'not_found'") }
      : e.code === 'forbidden'
        ? { ...e, source: src(F.routesAccounts, 61, 66, "code: 'forbidden'") }
        : e,
  ),
  flow: [
    csrfSafe,
    valveSafe,
    requireAuthStep,
    {
      kind: 'call',
      target: 'be:auth/access#getAccessibleAccount',
      label: 'getAccessibleAccount(prisma, user.id, id)',
      detail: 'Returns `{ summary, exists }`.',
      source: src(F.access, 90, 105, 'export async function getAccessibleAccount'),
    },
    {
      kind: 'db-read',
      target: 'db:Account',
      label: 'findUnique by id, include ledgerEntries',
      rejects: [{ status: 404, code: 'not_found', when: 'no account has this id' }],
      source: src(F.access, 96, 100, 'prisma.account.findUnique'),
    },
    {
      kind: 'db-read',
      target: 'db:AccountAccess',
      label: 'grant for (userId, accountId)',
      detail: 'Inside getAccountRelationship: the unique grant row, falling back to `owner` when Account.userId is the caller.',
      rejects: [{ status: 403, code: 'forbidden', when: 'there is no grant and the caller is not the owner' }],
      source: src(F.access, 72, 88, 'prisma.accountAccess.findUnique'),
    },
    {
      kind: 'call',
      target: 'sh:ledger#deriveBalances',
      label: 'deriveBalances(entries)',
      detail: 'Inside `toSummary`.',
      source: src(F.access, 49, 55, 'deriveBalances('),
    },
    { kind: 'respond', label: '200 { account }', source: src(F.routesAccounts, 67, 67, 'reply.send({ account: summary })') },
  ],
  sideEffects: ['None.'],
  mutates: false,
  integrationNotes: 'A 404 and a 403 are deliberately different: the response reveals whether an account id exists. Balances are derived per request.',
  sources: [
    src(F.routesAccounts, 52, 68, "app.get('/api/accounts/:id'", 'The handler'),
    src(F.access, 90, 105, 'export async function getAccessibleAccount', 'The service it delegates to'),
    src(F.tRbac, 68, 101, "describe('GET /api/accounts/:id (ownership checks)'", 'Integration tests'),
  ],
};

// ---------------------------------------------------------------------------
// GET /api/accounts/:id/transactions
// ---------------------------------------------------------------------------

const getTransactions: Contract = {
  id: 'ep:GET /api/accounts/:id/transactions',
  method: 'GET',
  path: '/api/accounts/:id/transactions',
  summary: 'Read an account’s header and its transaction history, newest first, with optional search and filters.',
  description:
    'A transaction is a ledger entry exposed for display. The service loads the account with all its entries, applies the same access rules as the single-account read, builds the full newest-first list with signed amounts and a running settled balance (`toTransactionDTOs`), and only then applies the query (`filterTransactions`) — so a filtered row still shows its true running balance. Invalid filter values are ignored, not rejected.',
  auth: { required: true, surface: 'customer', csrf: false, notes: 'No role check; access is per account (404 / 403 as for the single-account read).' },
  pathParams: accountIdParam,
  query: [
    { name: 'q', type: 'string', required: false, description: 'Case-insensitive substring search over the description.', rules: ['Trimmed; ignored if empty', 'Cut to 100 characters (SEARCH_QUERY_MAX_LENGTH)'], source: src(F.routesAccounts, 27, 28, 'SEARCH_QUERY_MAX_LENGTH') },
    {
      name: 'group',
      type: 'string',
      required: false,
      typeRef: 'sh:transactions#TransactionGroup',
      values: ['pending', 'posted', 'other'],
      description: 'pending = pending or held; posted = posted or disputed; other = failed or reversed.',
      rules: ['Any other value is silently ignored'],
      source: src(F.routesAccounts, 29, 31, 'TRANSACTION_GROUPS'),
    },
    {
      name: 'origin',
      type: 'string',
      required: false,
      typeRef: 'sh:ledger#LedgerOrigin',
      values: ['seed', 'interest', 'fee', 'adjustment', 'transfer', 'payment', 'deposit', 'card'],
      rules: ['Any other value is silently ignored'],
      source: src(F.routesAccounts, 32, 34, 'LEDGER_ORIGINS'),
    },
  ],
  responses: [
    {
      status: 200,
      description: 'The account header and the (filtered) transactions, newest first.',
      typeRef: 'sh:transactions#AccountTransactionsResponse',
      fields: [
        { name: 'account', type: 'AccountSummary', required: true, typeRef: 'sh:auth#AccountSummary', children: accountSummaryFields },
        { name: 'transactions', type: 'TransactionDTO[]', required: true, typeRef: 'sh:transactions#TransactionDTO' },
      ],
      example: {
        account: checkingSummary,
        transactions: [
          {
            id: 'le_003',
            accountId: 'acc_checking',
            amountMinor: 12000,
            direction: 'debit',
            status: 'pending',
            origin: 'payment',
            description: 'Bill payment — City Power & Light',
            postedAt: null,
            createdAt: '2026-10-01T15:00:00.000Z',
            signedAmountMinor: -12000,
            runningBalanceMinor: null,
          },
          {
            id: 'le_002',
            accountId: 'acc_checking',
            amountMinor: 4890,
            direction: 'debit',
            status: 'posted',
            origin: 'card',
            description: 'QuickFuel',
            postedAt: '2026-09-09T12:00:00.000Z',
            createdAt: '2026-09-09T12:00:00.000Z',
            signedAmountMinor: -4890,
            runningBalanceMinor: 245110,
          },
          {
            id: 'le_001',
            accountId: 'acc_checking',
            amountMinor: 250000,
            direction: 'credit',
            status: 'posted',
            origin: 'seed',
            description: 'Opening deposit',
            postedAt: '2026-08-01T12:00:00.000Z',
            createdAt: '2026-08-01T12:00:00.000Z',
            signedAmountMinor: 250000,
            runningBalanceMinor: 250000,
          },
        ],
      },
    },
  ],
  errors: accountReadErrors.map((e) =>
    e.code === 'not_found'
      ? { ...e, source: src(F.routesAccounts, 80, 83, "code: 'not_found'") }
      : e.code === 'forbidden'
        ? { ...e, source: src(F.routesAccounts, 84, 88, "code: 'forbidden'") }
        : e,
  ),
  flow: [
    csrfSafe,
    valveSafe,
    requireAuthStep,
    {
      kind: 'validate',
      target: 'be:routes/accounts#parseTransactionQuery',
      label: 'parseTransactionQuery(req.query)',
      detail: 'Keeps a trimmed `q` (max 100 characters), a known `group`, a known `origin`; drops everything else.',
      source: src(F.routesAccounts, 24, 36, 'function parseTransactionQuery'),
    },
    {
      kind: 'call',
      target: 'be:auth/access#listAccountTransactions',
      label: 'listAccountTransactions(prisma, user.id, id, query)',
      detail: 'Returns `{ exists, summary, transactions }`.',
      source: src(F.access, 170, 199, 'export async function listAccountTransactions'),
    },
    {
      kind: 'db-read',
      target: 'db:Account',
      label: 'findUnique by id, include ledgerEntries',
      rejects: [{ status: 404, code: 'not_found', when: 'no account has this id' }],
      source: src(F.access, 186, 190, 'prisma.account.findUnique'),
    },
    {
      kind: 'db-read',
      target: 'db:AccountAccess',
      label: 'grant for (userId, accountId)',
      rejects: [{ status: 403, code: 'forbidden', when: 'the caller has no relationship to the account' }],
      source: src(F.access, 192, 193, 'getAccountRelationship(prisma, userId, accountId)'),
    },
    {
      kind: 'call',
      target: 'sh:ledger#deriveBalances',
      label: 'deriveBalances(entries) for the header',
      source: src(F.access, 195, 195, 'toSummary(account, relationship)'),
    },
    {
      kind: 'call',
      target: 'sh:transactions#toTransactionDTOs',
      label: 'toTransactionDTOs(rows)',
      detail: 'Newest first; signed amounts; running settled balance for posted and disputed rows, null for the rest.',
      source: src(F.access, 196, 196, 'toTransactionDTOs(account.ledgerEntries.map(toRawLedgerRow))'),
    },
    {
      kind: 'call',
      target: 'sh:transactions#filterTransactions',
      label: 'filterTransactions(all, query)',
      detail: 'Group, origin and text search combined with AND.',
      source: src(F.access, 197, 197, 'filterTransactions(all, query)'),
    },
    { kind: 'respond', label: '200 { account, transactions }', source: src(F.routesAccounts, 89, 89, 'reply.send({ account: summary, transactions }') },
  ],
  sideEffects: ['None.'],
  mutates: false,
  calledBy: ['cu:lib/auth#fetchAccountTransactions'],
  integrationNotes:
    'There is no pagination: the full (filtered) history is returned. `runningBalanceMinor` is null for anything that has not settled. Entries created at the same simulated instant are ordered by id, so the order is stable. An unknown `group` or `origin` returns the unfiltered list rather than a 400.',
  sources: [
    src(F.routesAccounts, 70, 90, "app.get('/api/accounts/:id/transactions'", 'The handler'),
    src(F.access, 170, 199, 'export async function listAccountTransactions', 'The service it delegates to'),
    src(F.tTransactions, 14, 115, "describe('account transactions endpoint'", 'Integration tests'),
  ],
};

// ---------------------------------------------------------------------------
// GET /api/accounts/:id/statements
// ---------------------------------------------------------------------------

const period = (key: string, label: string, startISO: string, endISO: string, startMs: number, endMs: number, openingMinor: number, creditsMinor: number, debitsMinor: number, count: number) => ({
  key,
  label,
  startISO,
  endISO,
  startMs,
  endMs,
  openingMinor,
  closingMinor: openingMinor + creditsMinor - debitsMinor,
  creditsMinor,
  debitsMinor,
  count,
});

const getStatements: Contract = {
  id: 'ep:GET /api/accounts/:id/statements',
  method: 'GET',
  path: '/api/accounts/:id/statements',
  summary: 'Read the last six monthly statement periods of an account, as of the simulated date.',
  description:
    'Nothing is stored: each call reads the simulation clock, builds six UTC calendar-month windows ending with the month that contains the simulated "now", and summarizes the account’s SETTLED entries (posted or disputed) into opening balance, credits, debits, count and closing balance for each window. Pending, held, failed and reversed entries never appear. The number of months (6) is the service’s default and cannot be changed by the client.',
  auth: { required: true, surface: 'customer', csrf: false, notes: 'No role check; access is per account (404 / 403 as for the single-account read).' },
  pathParams: accountIdParam,
  responses: [
    {
      status: 200,
      description: 'Six periods, newest first.',
      typeRef: 'sh:statements#AccountStatementsResponse',
      fields: [
        { name: 'accountId', type: 'string', required: true },
        { name: 'asOf', type: 'string', required: true, description: 'The simulated time used, ISO 8601.' },
        { name: 'periods', type: 'StatementPeriodDTO[]', required: true, typeRef: 'sh:statements#StatementPeriodDTO' },
      ],
      example: {
        accountId: 'acc_checking',
        asOf: '2026-10-01T15:00:00.000Z',
        periods: [
          period('2026-10', 'October 2026', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 1790812800000, 1793491200000, 245110, 0, 0, 0),
          period('2026-09', 'September 2026', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1788220800000, 1790812800000, 250000, 0, 4890, 1),
          period('2026-08', 'August 2026', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1785542400000, 1788220800000, 0, 250000, 0, 1),
          period('2026-07', 'July 2026', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1782864000000, 1785542400000, 0, 0, 0, 0),
          period('2026-06', 'June 2026', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 1780272000000, 1782864000000, 0, 0, 0, 0),
          period('2026-05', 'May 2026', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 1777593600000, 1780272000000, 0, 0, 0, 0),
        ],
      },
    },
  ],
  errors: accountReadErrors.map((e) =>
    e.code === 'not_found'
      ? { ...e, source: src(F.routesAccounts, 101, 104, "code: 'not_found'") }
      : e.code === 'forbidden'
        ? { ...e, source: src(F.routesAccounts, 105, 109, "code: 'forbidden'") }
        : e,
  ),
  flow: [
    csrfSafe,
    valveSafe,
    requireAuthStep,
    {
      kind: 'call',
      target: 'be:clock/clock#simulationNow',
      label: 'simulationNow(prisma)',
      detail: 'Statements are "as of" the simulated date, so advancing the clock into a new month adds a new period.',
      source: src(F.routesAccounts, 100, 100, 'simulationNow(prisma)'),
    },
    {
      kind: 'call',
      target: 'be:auth/access#getAccountStatements',
      label: 'getAccountStatements(prisma, user.id, id, now)',
      detail: 'Returns `{ exists, summary, periods }`; `monthsBack` defaults to 6.',
      source: src(F.access, 201, 236, 'export async function getAccountStatements'),
    },
    {
      kind: 'db-read',
      target: 'db:Account',
      label: 'findUnique by id, include ledgerEntries',
      rejects: [{ status: 404, code: 'not_found', when: 'no account has this id' }],
      source: src(F.access, 215, 219, 'prisma.account.findUnique'),
    },
    {
      kind: 'db-read',
      target: 'db:AccountAccess',
      label: 'grant for (userId, accountId)',
      rejects: [{ status: 403, code: 'forbidden', when: 'the caller has no relationship to the account' }],
      source: src(F.access, 221, 222, 'getAccountRelationship(prisma, userId, accountId)'),
    },
    {
      kind: 'call',
      target: 'sh:statements#buildStatementPeriods',
      label: 'buildStatementPeriods(now, 6)',
      detail: 'Six UTC month windows, newest first.',
      source: src(F.access, 231, 234, 'buildStatementPeriods(now, monthsBack)'),
    },
    {
      kind: 'call',
      target: 'sh:statements#summarizeStatementPeriod',
      label: 'summarizeStatementPeriod(entries, bounds) per period',
      detail: 'Each entry is dated by `postedAt ?? createdAt`; only posted and disputed entries count.',
      source: src(F.access, 225, 234, 'summarizeStatementPeriod(entries, bounds)'),
    },
    { kind: 'respond', label: '200 { accountId, asOf, periods }', source: src(F.routesAccounts, 110, 110, 'asOf: now.toISOString()') },
  ],
  sideEffects: ['None on business data (reading the clock creates the SimulationClock singleton row if it is missing).'],
  mutates: false,
  calledBy: ['cu:lib/schedules#fetchAccountStatements'],
  integrationNotes:
    'Periods are UTC calendar months. `asOf` is SIMULATED time, which only moves when an operator advances the clock — do not compare it with the wall clock. There is no document to download; the figures are recomputed on every call.',
  sources: [
    src(F.routesAccounts, 92, 111, "app.get('/api/accounts/:id/statements'", 'The handler'),
    src(F.access, 201, 236, 'export async function getAccountStatements', 'The service it delegates to'),
    src(F.tClockSchedules, 391, 407, "describe('statement cycles derived from the clock'", 'Integration tests'),
  ],
};

export const contracts: Contract[] = [postTransfers, postMovements, getAccounts, getAccount, getTransactions, getStatements];
