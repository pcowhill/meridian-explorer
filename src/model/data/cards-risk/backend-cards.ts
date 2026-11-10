import type { Entity, Relation } from '../../types';
import { F, rel, s } from './helpers';

/**
 * Backend card lifecycle: `apps/backend/src/cards/cards.ts` (service) and
 * `apps/backend/src/routes/cards.ts` (route plugin + its eight endpoints).
 */

const BC = F.cards;
const RC = F.routesCards;
const M = 'be:cards/cards';
const RG = 'be:routes/cards';

export const EP = {
  listCards: 'ep:GET /api/cards',
  listAccountCards: 'ep:GET /api/accounts/:id/cards',
  issue: 'ep:POST /api/accounts/:id/cards',
  freeze: 'ep:POST /api/cards/:id/freeze',
  unfreeze: 'ep:POST /api/cards/:id/unfreeze',
  report: 'ep:POST /api/cards/:id/report',
  addNotice: 'ep:POST /api/cards/:id/travel-notices',
  cancelNotice: 'ep:POST /api/cards/:id/travel-notices/:noticeId/cancel',
} as const;

export const cardBackendEntities: Entity[] = [
  // ---- Service module -------------------------------------------------------
  {
    id: M,
    kind: 'module',
    name: 'cards.ts (card lifecycle service)',
    parent: 'be.cards',
    summary: 'The card service: list, issue, freeze, unfreeze, report lost/stolen with a replacement, and travel notices — every change audited, none touching the ledger.',
    description:
      'All card reads and writes go through this file. Each customer-facing function first proves the caller may manage the card: the card’s ACCOUNT must grant them an `owner`, `joint` or `authorized` relationship (a read-only `viewer` is refused). Status changes are then gated by the shared `can*` guards, written with Prisma, and recorded with `writeAudit`.\n\nNothing here creates or changes a `LedgerEntry`. Card spend is modelled separately as ledger entries with `origin: "card"`; freezing a card does not block those entries from being created, because no code path creates card spend at runtime — it exists only in the seed.\n\nOne function, `freezeCardById`, deliberately skips the access check. It exists for the operator fraud flow, which is already role-gated and runs inside the operator’s transaction.',
    audience: {
      executive: 'The part of the bank that manages cards: issuing them, freezing them and replacing lost ones. It keeps a record of every change and never moves money.',
      'end-user': 'What runs when you freeze a card, report it lost or add a travel notice.',
      dba: 'Sole writer of `Card` and `CardTravelNotice`. Reads `Account` and `AccountAccess` for authorisation. Inserts one `AuditLog` row per change. Reporting a card is the only multi-row transaction.',
    },
    tech: ['Prisma', 'node:crypto'],
    tags: ['cards', 'domain', 'audit'],
    aliases: ['card service', 'apps/backend/src/cards/cards.ts'],
    sources: [s(BC, 26, 34, 'Card lifecycle service (v0.8.0)')],
  },
  {
    id: `${M}#CardErrorCode`,
    kind: 'type',
    name: 'CardErrorCode',
    parent: M,
    summary: 'The five failure codes the card service can raise.',
    values: [
      { value: 'not_found', meaning: 'No such account, card or travel notice → HTTP 404.' },
      { value: 'forbidden', meaning: 'The caller has no owner/joint/authorized relationship to the card’s account → HTTP 403.' },
      { value: 'inactive_account', meaning: 'The account exists and is accessible but its status is not `active` → HTTP 400.' },
      { value: 'invalid_state', meaning: 'The card’s current status does not allow the action (e.g. freezing a frozen card) → HTTP 400.' },
      { value: 'limit_reached', meaning: 'A resource cap was hit: 8 live cards per account or 10 active travel notices per card → HTTP 409.' },
    ],
    tags: ['cards'],
    sources: [s(BC, 36, 36, 'export type CardErrorCode')],
  },
  {
    id: `${M}#CardError`,
    kind: 'class',
    name: 'CardError',
    parent: M,
    summary: 'The typed error the card service throws; it carries a `CardErrorCode` that the route maps to an HTTP status.',
    signature: 'class CardError extends Error { readonly code: CardErrorCode }',
    tags: ['cards'],
    sources: [s(BC, 38, 45, 'export class CardError')],
  },
  {
    id: `${M}#toCardDTO`,
    kind: 'function',
    name: 'toCardDTO',
    parent: M,
    summary: 'Maps a `Card` row with its joins to the `CardDTO` the API returns.',
    description: 'Expects the row loaded with `CARD_INCLUDE` (account name, cardholder display name, travel notices). Filters travel notices to `status === "active"`, sorts them by start date and converts dates to ISO strings.',
    signature: 'toCardDTO(row: CardWithRelations): CardDTO',
    tags: ['cards'],
    detail: 5,
    sources: [s(BC, 71, 91, 'export function toCardDTO'), s(BC, 93, 97, 'CARD_INCLUDE', 'The joins every card query uses')],
  },
  {
    id: `${M}#requireCardAccount`,
    kind: 'function',
    name: 'requireCardAccount',
    parent: M,
    summary: 'Internal check that the caller may manage cards on an account: it exists, they are owner/joint/authorized, and it is active.',
    description: 'Not exported. Used by `listAccountCards` and `issueCard`. Order matters for the status code: unknown account → `not_found`; no qualifying relationship → `forbidden`; account not `active` → `inactive_account`.',
    signature: 'requireCardAccount(userId: string, accountId: string): Promise<void>',
    tags: ['cards', 'security', 'rbac'],
    sources: [s(BC, 111, 122, 'async function requireCardAccount'), s(BC, 47, 48, 'CARD_RELATIONSHIPS', 'owner | joint | authorized')],
  },
  {
    id: `${M}#requireOwnedCard`,
    kind: 'function',
    name: 'requireOwnedCard',
    parent: M,
    summary: 'Internal check that loads a card and proves the caller is owner/joint/authorized on the card’s account.',
    description:
      'Not exported. Every per-card action starts here. Unknown card → `not_found`; no qualifying relationship → `forbidden`.\n\nAccess is by ACCOUNT, not by cardholder: a joint owner of Everyday Checking can freeze or report a card whose `userId` is the other owner. Unlike `requireCardAccount` it does not check the account’s status.',
    signature: 'requireOwnedCard(userId: string, cardId: string): Promise<CardWithRelations>',
    tags: ['cards', 'security', 'rbac'],
    detail: 3,
    sources: [s(BC, 124, 133, 'async function requireOwnedCard')],
  },
  {
    id: `${M}#listCards`,
    kind: 'function',
    name: 'listCards',
    parent: M,
    summary: 'Returns every card on every account the user can reach, newest first.',
    description: 'Collects account ids from the user’s `AccountAccess` grants plus accounts they own directly (`Account.userId`), then loads all cards on those accounts. Unlike the per-card actions it does not exclude `viewer` grants, so a read-only viewer sees the cards but cannot act on them. Terminal cards are included.',
    signature: 'listCards(user: SessionUser): Promise<CardDTO[]>',
    tags: ['cards'],
    sources: [s(BC, 137, 149, 'export async function listCards')],
  },
  {
    id: `${M}#listAccountCards`,
    kind: 'function',
    name: 'listAccountCards',
    parent: M,
    summary: 'Returns the cards on one account, after the full manage-cards access check.',
    signature: 'listAccountCards(user: SessionUser, accountId: string): Promise<CardDTO[]>',
    tags: ['cards'],
    sources: [s(BC, 151, 160, 'export async function listAccountCards')],
  },
  {
    id: `${M}#issueCard`,
    kind: 'function',
    name: 'issueCard',
    parent: M,
    summary: 'Creates a new simulated card on an account: a random last-four, an expiry four years out, status `active`, and an audit row.',
    description:
      'After `requireCardAccount`, it counts the account’s LIVE cards (`active` or `frozen`); 8 or more → `limit_reached`. The last four comes from `crypto.randomInt(0, 10000)` zero-padded; the expiry is the current simulated month, four years ahead. The cardholder (`Card.userId`) is the caller.\n\nThe `Card` insert and the `card_issued` audit insert are two separate statements, not one transaction.',
    signature: 'issueCard(user: SessionUser, accountId: string, input: NormalizedIssueCard, now: Date = new Date()): Promise<CardDTO>',
    tags: ['cards', 'audit'],
    sources: [s(BC, 164, 211, 'export async function issueCard'), s(BC, 101, 109, 'simulatedLast4', 'How last4 and expiry are made up')],
  },
  {
    id: `${M}#setCardStatus`,
    kind: 'function',
    name: 'setCardStatus',
    parent: M,
    summary: 'Internal helper behind freeze and unfreeze: access check, status guard, update, audit.',
    description: 'Not exported. Takes the target status, the shared guard to apply to the CURRENT status, the message for a failed guard and the audit action name. Writes `Card.status` and `updatedAt`, then an `AuditLog` row whose metadata records `from` and `to`.',
    signature: 'setCardStatus(user, cardId, next: CardStatus, guard: (status: CardStatus) => boolean, guardMessage: string, auditAction: string, now: Date): Promise<CardDTO>',
    tags: ['cards', 'audit'],
    sources: [s(BC, 213, 241, 'async function setCardStatus')],
  },
  {
    id: `${M}#freezeCard`,
    kind: 'function',
    name: 'freezeCard',
    parent: M,
    summary: 'The customer freezes their own card: `active` → `frozen`, audited as `card_frozen`.',
    description: 'A one-line call to `setCardStatus` with the `canFreezeCard` guard. Any status other than `active` → `CardError("invalid_state", "Only an active card can be frozen.")`.',
    signature: 'freezeCard(user: SessionUser, cardId: string, now: Date = new Date()): Promise<CardDTO>',
    tags: ['cards'],
    detail: 3,
    sources: [s(BC, 243, 245, 'export function freezeCard')],
  },
  {
    id: `${M}#unfreezeCard`,
    kind: 'function',
    name: 'unfreezeCard',
    parent: M,
    summary: 'The customer unfreezes a card: `frozen` → `active`, audited as `card_unfrozen`.',
    description: 'A one-line call to `setCardStatus` with the `canUnfreezeCard` guard. It does not look at why the card was frozen, so it also lifts a freeze applied by an operator confirming fraud.',
    signature: 'unfreezeCard(user: SessionUser, cardId: string, now: Date = new Date()): Promise<CardDTO>',
    tags: ['cards'],
    detail: 3,
    sources: [s(BC, 247, 249, 'export function unfreezeCard')],
  },
  {
    id: `${M}#ReplaceCardResult`,
    kind: 'type',
    name: 'ReplaceCardResult',
    parent: M,
    summary: 'What `reportCard` returns: `card` (the replacement) and `replaced` (the old card, now terminal).',
    fields: [
      { name: 'card', type: 'CardDTO', required: true, typeRef: 'sh:cards#CardDTO', description: 'The replacement.' },
      { name: 'replaced', type: 'CardDTO', required: true, typeRef: 'sh:cards#CardDTO', description: 'The old card, now `lost` or `stolen`.' },
    ],
    tags: ['cards'],
    detail: 5,
    sources: [s(BC, 251, 254, 'export interface ReplaceCardResult')],
  },
  {
    id: `${M}#reportCard`,
    kind: 'function',
    name: 'reportCard',
    parent: M,
    summary: 'Reports a card lost or stolen: in one transaction the old card becomes terminal, its travel notices are cancelled, a replacement card is created and an audit row is written.',
    description:
      'Checks access (`requireOwnedCard`) and that the card is `active` or `frozen` (`canReportCard`); otherwise `invalid_state`. Then, inside `prisma.$transaction`:\n\n1. the old card’s `status` is set to the reason itself (`lost` or `stolen`);\n2. its `active` travel notices are set to `cancelled`;\n3. a new `Card` row is inserted — same account, same cardholder, same type and network, a NEW random last-four and expiry, `status: "active"`, `replacesCardId` pointing at the old card;\n4. one `AuditLog` row (`card_reported`) records both card ids.\n\nNo ledger entry is read or written. The replacement is always `active`, even when the reported card was `frozen`. Travel notices are cancelled, not copied to the replacement.',
    signature: 'reportCard(user: SessionUser, cardId: string, reason: CardReportReason, now: Date = new Date()): Promise<ReplaceCardResult>',
    tags: ['cards', 'audit'],
    aliases: ['lost card', 'stolen card', 'replacement card'],
    detail: 3,
    sources: [s(BC, 256, 313, 'export async function reportCard')],
  },
  {
    id: `${M}#addTravelNotice`,
    kind: 'function',
    name: 'addTravelNotice',
    parent: M,
    summary: 'Adds a travel notice to an in-service card (at most 10 active per card) and audits it.',
    description: 'Access check, then `canAddTravelNotice` (else `invalid_state`), then a count of the card’s active notices (10 or more → `limit_reached`). Inserts the `CardTravelNotice`, writes a `card_travel_notice_added` audit row, then re-reads the card to return it with the new notice. The notice is recorded only — nothing else in the system reads travel notices.',
    signature: 'addTravelNotice(user: SessionUser, cardId: string, input: NormalizedTravelNotice, now: Date = new Date()): Promise<CardDTO>',
    tags: ['cards', 'audit'],
    sources: [s(BC, 317, 357, 'export async function addTravelNotice')],
  },
  {
    id: `${M}#cancelTravelNotice`,
    kind: 'function',
    name: 'cancelTravelNotice',
    parent: M,
    summary: 'Cancels one travel notice on a card the caller can manage and audits it.',
    description: 'Access check on the card, then the notice must exist AND belong to that card, otherwise `not_found`. Sets the notice’s status to `cancelled` without checking its current status, so cancelling twice succeeds and writes a second audit row.',
    signature: 'cancelTravelNotice(user: SessionUser, cardId: string, noticeId: string): Promise<CardDTO>',
    tags: ['cards', 'audit'],
    sources: [s(BC, 359, 381, 'export async function cancelTravelNotice')],
  },
  {
    id: `${M}#freezeCardById`,
    kind: 'function',
    name: 'freezeCardById',
    parent: M,
    summary: 'Freezes a card by id with no access check — the hook the operator fraud flow uses — and reports whether it actually froze it.',
    description:
      'Takes a `DbClient` so it runs inside the caller’s transaction. Loads the card’s status; if the card is missing or `canFreezeCard` is false (already frozen, or terminal) it returns `false` and changes nothing. Otherwise it sets `status: "frozen"` and returns `true`.\n\nIt writes no audit row of its own: `confirmFraud` records the outcome (`cardFrozen`) in its `fraud_confirmed` audit row. There is therefore no `card_frozen` audit entry for a fraud freeze.',
    signature: 'freezeCardById(tx: DbClient, cardId: string, now: Date): Promise<boolean>',
    tags: ['cards', 'risk'],
    detail: 3,
    sources: [s(BC, 386, 395, 'export async function freezeCardById')],
  },

  // ---- Route group ----------------------------------------------------------
  {
    id: RG,
    kind: 'route-group',
    name: 'routes/cards.ts',
    parent: 'be.http',
    summary: 'The Fastify plugin for the eight customer card endpoints: two lists and six mutations.',
    description:
      'Handlers are thin: read the path parameter, validate the body with the shared validator, call the card service with the simulated "now", and translate a `CardError` into an HTTP status. The two GETs use `requireAuth` only; the six POSTs use `[requireAuth, rateLimit("cards")]`, one shared per-user bucket (30 per 5 minutes, enforced only in public-demo mode).\n\nNo endpoint here publishes a real-time event: operators are not told about card changes, and the customer app has no live channel for them either.',
    tech: ['Fastify'],
    tags: ['cards', 'api', 'routes'],
    aliases: ['cardRoutes'],
    sources: [s(RC, 62, 64, 'export async function cardRoutes'), s(RC, 28, 32, 'Customer card-lifecycle endpoints'), s(F.routesIndex, 26, 26, 'cardRoutes', 'Registration')],
  },
  {
    id: `${RG}#cardHttpStatus`,
    kind: 'function',
    name: 'cardHttpStatus',
    parent: RG,
    summary: 'Maps a card service error code to an HTTP status: not_found 404, forbidden 403, limit_reached 409, everything else 400.',
    description: '`handleCardError` uses it to reply `{ error, code }` for a `CardError` and re-throws anything else (which Fastify turns into a 500).',
    signature: 'cardHttpStatus(code: CardErrorCode): number',
    tags: ['cards', 'api'],
    aliases: ['handleCardError'],
    detail: 5,
    sources: [s(RC, 36, 47, 'function cardHttpStatus'), s(RC, 49, 54, 'function handleCardError')],
  },

  // ---- Endpoints ------------------------------------------------------------
  {
    id: EP.listCards,
    kind: 'endpoint',
    name: 'GET /api/cards',
    parent: RG,
    summary: 'Lists every card on the accounts the signed-in user can reach.',
    tags: ['cards', 'api'],
    sources: [s(RC, 67, 70, "app.get('/api/cards'")],
  },
  {
    id: EP.listAccountCards,
    kind: 'endpoint',
    name: 'GET /api/accounts/:id/cards',
    parent: RG,
    summary: 'Lists the cards on one account the caller is allowed to manage.',
    tags: ['cards', 'api'],
    sources: [s(RC, 73, 81, "app.get('/api/accounts/:id/cards'")],
  },
  {
    id: EP.issue,
    kind: 'endpoint',
    name: 'POST /api/accounts/:id/cards',
    parent: RG,
    summary: 'Issues a new simulated card on an account.',
    tags: ['cards', 'api'],
    sources: [s(RC, 84, 100, "app.post('/api/accounts/:id/cards'")],
  },
  {
    id: EP.freeze,
    kind: 'endpoint',
    name: 'POST /api/cards/:id/freeze',
    parent: RG,
    summary: 'Freezes an active card.',
    tags: ['cards', 'api'],
    sources: [s(RC, 103, 111, "app.post('/api/cards/:id/freeze'")],
  },
  {
    id: EP.unfreeze,
    kind: 'endpoint',
    name: 'POST /api/cards/:id/unfreeze',
    parent: RG,
    summary: 'Unfreezes a frozen card.',
    tags: ['cards', 'api'],
    sources: [s(RC, 113, 121, "app.post('/api/cards/:id/unfreeze'")],
  },
  {
    id: EP.report,
    kind: 'endpoint',
    name: 'POST /api/cards/:id/report',
    parent: RG,
    summary: 'Reports a card lost or stolen and returns its replacement.',
    tags: ['cards', 'api'],
    detail: 3,
    sources: [s(RC, 124, 137, "app.post('/api/cards/:id/report'")],
  },
  {
    id: EP.addNotice,
    kind: 'endpoint',
    name: 'POST /api/cards/:id/travel-notices',
    parent: RG,
    summary: 'Adds a travel notice to a card.',
    tags: ['cards', 'api'],
    sources: [s(RC, 140, 158, "app.post('/api/cards/:id/travel-notices'")],
  },
  {
    id: EP.cancelNotice,
    kind: 'endpoint',
    name: 'POST /api/cards/:id/travel-notices/:noticeId/cancel',
    parent: RG,
    summary: 'Cancels one travel notice on a card.',
    tags: ['cards', 'api'],
    sources: [s(RC, 160, 168, "app.post('/api/cards/:id/travel-notices/:noticeId/cancel'")],
  },
];

const AUTH = 'be:auth/guards#requireAuth';
const RATE = 'be:abuse/rate-limit#rateLimit';
const NOW = 'be:clock/clock#simulationNow';
const AUDIT = 'be:auth/audit#writeAudit';
const REL = 'be:auth/access#getAccountRelationship';

const mutatingEndpoints = [EP.issue, EP.freeze, EP.unfreeze, EP.report, EP.addNotice, EP.cancelNotice];
const allEndpoints = [EP.listCards, EP.listAccountCards, ...mutatingEndpoints];

export const cardBackendRelations: Relation[] = [
  // ---- Guards ---------------------------------------------------------------
  ...allEndpoints.map((ep) =>
    rel(ep, AUTH, 'guards', 'preHandler: requireAuth', {
      summary: 'A valid session is required; otherwise 401.',
      sources: [mutatingEndpoints.includes(ep as (typeof mutatingEndpoints)[number]) ? s(RC, 63, 64, 'requireAuth') : s(RC, 67, 73, 'preHandler: requireAuth')],
      order: 1,
    }),
  ),
  ...mutatingEndpoints.map((ep) =>
    rel(ep, RATE, 'guards', "rateLimit('cards')", {
      summary: 'All six card mutations share one per-user bucket (30 per 5 minutes; public-demo mode only).',
      sources: [s(RC, 63, 64, "rateLimit('cards')"), s(F.shDemo, 95, 96, 'cards:', 'The bucket size')],
      order: 2,
    }),
  ),

  // ---- Endpoint → validator / service --------------------------------------
  rel(EP.listCards, `${M}#listCards`, 'calls', 'listCards(req.user!)', { sources: [s(RC, 67, 70, 'listCards(req.user!)')], order: 3 }),
  rel(EP.listAccountCards, `${M}#listAccountCards`, 'calls', 'listAccountCards(req.user!, id)', { sources: [s(RC, 73, 81, 'listAccountCards(req.user!, id)')], order: 3 }),
  rel(EP.issue, 'sh:cards#validateIssueCard', 'validates', 'validateIssueCard({ cardType, network })', { sources: [s(RC, 86, 93, 'validateIssueCard')], order: 3 }),
  rel(EP.issue, NOW, 'calls', 'await simulationNow(prisma)', { summary: 'The card’s createdAt/updatedAt and expiry are based on simulated time.', sources: [s(RC, 95, 95, 'simulationNow(prisma)')], order: 4 }),
  rel(EP.issue, `${M}#issueCard`, 'calls', 'issueCard(req.user!, id, check.value, now)', { sources: [s(RC, 94, 99, 'issueCard(req.user!, id, check.value')], order: 5 }),
  rel(EP.freeze, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RC, 106, 106, 'simulationNow(prisma)')], order: 3 }),
  rel(EP.freeze, `${M}#freezeCard`, 'calls', 'freezeCard(req.user!, id, now)', { sources: [s(RC, 103, 111, 'freezeCard(req.user!, id')], order: 4 }),
  rel(EP.unfreeze, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RC, 116, 116, 'simulationNow(prisma)')], order: 3 }),
  rel(EP.unfreeze, `${M}#unfreezeCard`, 'calls', 'unfreezeCard(req.user!, id, now)', { sources: [s(RC, 113, 121, 'unfreezeCard(req.user!, id')], order: 4 }),
  rel(EP.report, 'sh:cards#validateReportCard', 'validates', 'validateReportCard({ reason })', { sources: [s(RC, 126, 130, 'validateReportCard')], order: 3 }),
  rel(EP.report, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RC, 132, 132, 'simulationNow(prisma)')], order: 4 }),
  rel(EP.report, `${M}#reportCard`, 'calls', 'reportCard(req.user!, id, check.value.reason, now)', { sources: [s(RC, 131, 136, 'reportCard(req.user!, id, check.value.reason')], order: 5 }),
  rel(EP.addNotice, 'sh:cards#validateTravelNotice', 'validates', 'validateTravelNotice({ destination, startsOn, endsOn, note })', { sources: [s(RC, 142, 151, 'validateTravelNotice')], order: 3 }),
  rel(EP.addNotice, NOW, 'calls', 'await simulationNow(prisma)', { sources: [s(RC, 153, 153, 'simulationNow(prisma)')], order: 4 }),
  rel(EP.addNotice, `${M}#addTravelNotice`, 'calls', 'addTravelNotice(req.user!, id, check.value, now)', { sources: [s(RC, 152, 157, 'addTravelNotice(req.user!, id, check.value')], order: 5 }),
  rel(EP.cancelNotice, `${M}#cancelTravelNotice`, 'calls', 'cancelTravelNotice(req.user!, id, noticeId)', { sources: [s(RC, 160, 168, 'cancelTravelNotice(req.user!, id, noticeId)')], order: 3 }),

  // ---- Endpoint → response / request types ---------------------------------
  rel(EP.listCards, 'sh:cards#CardListResponse', 'uses-type', 'responds CardListResponse', { sources: [s(RC, 69, 69, 'CardListResponse')] }),
  rel(EP.listAccountCards, 'sh:cards#CardListResponse', 'uses-type', 'responds CardListResponse', { sources: [s(RC, 77, 77, 'CardListResponse')] }),
  rel(EP.issue, 'sh:cards#CardResponse', 'uses-type', 'responds CardResponse (201)', { sources: [s(RC, 96, 96, 'CardResponse')] }),
  rel(EP.freeze, 'sh:cards#CardResponse', 'uses-type', 'responds CardResponse', { sources: [s(RC, 107, 107, 'CardResponse')] }),
  rel(EP.unfreeze, 'sh:cards#CardResponse', 'uses-type', 'responds CardResponse', { sources: [s(RC, 117, 117, 'CardResponse')] }),
  rel(EP.report, 'sh:cards#ReplaceCardResponse', 'uses-type', 'responds ReplaceCardResponse (201)', { sources: [s(RC, 133, 133, 'ReplaceCardResponse')] }),
  rel(EP.addNotice, 'sh:cards#CardResponse', 'uses-type', 'responds CardResponse (201)', { sources: [s(RC, 154, 154, 'CardResponse')] }),
  rel(EP.cancelNotice, 'sh:cards#CardResponse', 'uses-type', 'responds CardResponse', { sources: [s(RC, 164, 164, 'CardResponse')] }),
  rel(RG, `${RG}#cardHttpStatus`, 'calls', 'handleCardError → cardHttpStatus(err.code)', { sources: [s(RC, 49, 54, 'cardHttpStatus(err.code)')] }),
  rel(`${RG}#cardHttpStatus`, `${M}#CardErrorCode`, 'uses-type', 'switch (code)', { sources: [s(RC, 36, 47, 'CardErrorCode')] }),

  // ---- Service internals ----------------------------------------------------
  rel(`${M}#requireCardAccount`, 'db:Account', 'reads', 'findUnique by id (select status)', { sources: [s(BC, 113, 114, 'prisma.account.findUnique')], order: 1 }),
  rel(`${M}#requireCardAccount`, REL, 'calls', 'getAccountRelationship(prisma, userId, accountId)', {
    summary: 'The relationship must be owner, joint or authorized; a viewer or a stranger is refused.',
    sources: [s(BC, 115, 118, 'getAccountRelationship(prisma, userId, accountId)')],
    order: 2,
  }),
  rel(`${M}#requireOwnedCard`, 'db:Card', 'reads', 'findUnique by id (include account name, cardholder, travel notices)', { sources: [s(BC, 126, 127, 'prisma.card.findUnique')], order: 1 }),
  rel(`${M}#requireOwnedCard`, REL, 'calls', 'getAccountRelationship(prisma, userId, card.accountId)', {
    summary: 'Authorisation is by the card’s ACCOUNT, not by who the cardholder is.',
    sources: [s(BC, 128, 131, 'getAccountRelationship(prisma, userId, card.accountId)')],
    order: 2,
  }),

  rel(`${M}#listCards`, 'db:AccountAccess', 'reads', 'findMany by userId (accountId only)', { sources: [s(BC, 139, 139, 'prisma.accountAccess.findMany')], order: 1 }),
  rel(`${M}#listCards`, 'db:Account', 'reads', 'findMany owned by userId (id only)', { sources: [s(BC, 140, 140, 'prisma.account.findMany')], order: 2 }),
  rel(`${M}#listCards`, 'db:Card', 'reads', 'findMany where accountId in (…), newest first', { sources: [s(BC, 143, 147, 'prisma.card.findMany')], order: 3 }),
  rel(`${M}#listCards`, `${M}#toCardDTO`, 'calls', 'cards.map(toCardDTO)', { sources: [s(BC, 148, 148, 'toCardDTO')], order: 4 }),
  rel(`${M}#listAccountCards`, `${M}#requireCardAccount`, 'calls', 'requireCardAccount(user.id, accountId)', { sources: [s(BC, 153, 153, 'requireCardAccount')], order: 1 }),
  rel(`${M}#listAccountCards`, 'db:Card', 'reads', 'findMany by accountId, newest first', { sources: [s(BC, 154, 158, 'prisma.card.findMany')], order: 2 }),
  rel(`${M}#toCardDTO`, 'sh:cards#CardDTO', 'uses-type', 'returns CardDTO', { sources: [s(BC, 71, 72, 'CardDTO')] }),

  rel(`${M}#issueCard`, `${M}#requireCardAccount`, 'calls', 'requireCardAccount(user.id, accountId)', { sources: [s(BC, 171, 171, 'requireCardAccount')], order: 1 }),
  rel(`${M}#issueCard`, 'db:Card', 'reads', "count where accountId and status in ('active','frozen')", {
    summary: 'The live-card cap: 8 or more → limit_reached (409).',
    sources: [s(BC, 172, 180, 'RESOURCE_CAPS.liveCardsPerAccount'), s(F.shDemo, 124, 125, 'liveCardsPerAccount: 8')],
    order: 2,
  }),
  rel(`${M}#issueCard`, 'db:Card', 'writes', "insert 1 row (status 'active', random last4, expiry +4 years)", { sources: [s(BC, 184, 198, 'prisma.card.create')], order: 3 }),
  rel(`${M}#issueCard`, AUDIT, 'calls', "writeAudit(prisma, { action: 'card_issued', entity: 'card', … })", { sources: [s(BC, 200, 208, "action: 'card_issued'")], order: 4 }),
  rel(`${M}#issueCard`, 'sh:cards#NormalizedIssueCard', 'uses-type', 'input: NormalizedIssueCard', { sources: [s(BC, 165, 170, 'NormalizedIssueCard')] }),

  rel(`${M}#freezeCard`, `${M}#setCardStatus`, 'calls', "setCardStatus(user, cardId, 'frozen', canFreezeCard, …, 'card_frozen', now)", { sources: [s(BC, 243, 245, "'card_frozen'")] }),
  rel(`${M}#unfreezeCard`, `${M}#setCardStatus`, 'calls', "setCardStatus(user, cardId, 'active', canUnfreezeCard, …, 'card_unfrozen', now)", { sources: [s(BC, 247, 249, "'card_unfrozen'")] }),
  rel(`${M}#freezeCard`, 'sh:cards#canFreezeCard', 'validates', 'guard: canFreezeCard', { summary: 'Only an active card can be frozen; otherwise invalid_state (400).', sources: [s(BC, 243, 245, 'canFreezeCard')] }),
  rel(`${M}#unfreezeCard`, 'sh:cards#canUnfreezeCard', 'validates', 'guard: canUnfreezeCard', { summary: 'Only a frozen card can be unfrozen; otherwise invalid_state (400).', sources: [s(BC, 247, 249, 'canUnfreezeCard')] }),
  rel(`${M}#setCardStatus`, `${M}#requireOwnedCard`, 'calls', 'requireOwnedCard(user.id, cardId)', { sources: [s(BC, 222, 222, 'requireOwnedCard')], order: 1 }),
  rel(`${M}#setCardStatus`, 'db:Card', 'writes', 'update status + updatedAt by id', { sources: [s(BC, 226, 230, 'prisma.card.update')], order: 2 }),
  rel(`${M}#setCardStatus`, AUDIT, 'calls', 'writeAudit(prisma, { action: auditAction, metadata: { from, to } })', { sources: [s(BC, 231, 239, 'action: auditAction')], order: 3 }),
  rel(`${M}#setCardStatus`, 'sh:cards#cardStatusLabel', 'calls', 'cardStatusLabel(next)', { summary: 'Builds the audit reason text.', sources: [s(BC, 237, 237, 'cardStatusLabel(next)')], detail: 5 }),

  rel(`${M}#reportCard`, `${M}#requireOwnedCard`, 'calls', 'requireOwnedCard(user.id, cardId)', { sources: [s(BC, 267, 267, 'requireOwnedCard')], order: 1 }),
  rel(`${M}#reportCard`, 'sh:cards#canReportCard', 'validates', 'canReportCard(card.status)', { summary: 'Only an active or frozen card can be reported; otherwise invalid_state (400).', sources: [s(BC, 268, 270, 'canReportCard')], order: 2 }),
  rel(`${M}#reportCard`, 'db:Card', 'writes', "tx: update old card status → reason ('lost' | 'stolen')", { sources: [s(BC, 275, 279, 'data: { status: reason')], order: 3 }),
  rel(`${M}#reportCard`, 'db:CardTravelNotice', 'writes', "tx: updateMany active notices of the card → 'cancelled'", { sources: [s(BC, 280, 283, 'tx.cardTravelNotice.updateMany')], order: 4 }),
  rel(`${M}#reportCard`, 'db:Card', 'writes', "tx: insert replacement (status 'active', new last4, replacesCardId = old id)", { sources: [s(BC, 284, 299, 'replacesCardId: cardId')], order: 5 }),
  rel(`${M}#reportCard`, AUDIT, 'calls', "writeAudit(tx, { action: 'card_reported', … })", { sources: [s(BC, 300, 308, "action: 'card_reported'")], order: 6 }),
  rel(`${M}#reportCard`, `${M}#ReplaceCardResult`, 'uses-type', 'returns ReplaceCardResult', { sources: [s(BC, 261, 266, 'ReplaceCardResult')] }),
  rel(`${M}#reportCard`, 'sh:cards#CardReportReason', 'uses-type', 'reason: CardReportReason', { sources: [s(BC, 261, 266, 'CardReportReason')] }),

  rel(`${M}#addTravelNotice`, `${M}#requireOwnedCard`, 'calls', 'requireOwnedCard(user.id, cardId)', { sources: [s(BC, 323, 323, 'requireOwnedCard')], order: 1 }),
  rel(`${M}#addTravelNotice`, 'sh:cards#canAddTravelNotice', 'validates', 'canAddTravelNotice(card.status)', { sources: [s(BC, 324, 326, 'canAddTravelNotice')], order: 2 }),
  rel(`${M}#addTravelNotice`, 'db:CardTravelNotice', 'reads', "count where cardId and status 'active'", {
    summary: 'The per-card cap: 10 or more active notices → limit_reached (409).',
    sources: [s(BC, 327, 334, 'RESOURCE_CAPS.activeTravelNoticesPerCard'), s(F.shDemo, 126, 127, 'activeTravelNoticesPerCard: 10')],
    order: 3,
  }),
  rel(`${M}#addTravelNotice`, 'db:CardTravelNotice', 'writes', "insert 1 row (status 'active')", { sources: [s(BC, 335, 345, 'prisma.cardTravelNotice.create')], order: 4 }),
  rel(`${M}#addTravelNotice`, AUDIT, 'calls', "writeAudit(prisma, { action: 'card_travel_notice_added', … })", { sources: [s(BC, 346, 354, "action: 'card_travel_notice_added'")], order: 5 }),
  rel(`${M}#addTravelNotice`, 'db:Card', 'reads', 'findUniqueOrThrow by id (re-read with notices)', { sources: [s(BC, 355, 355, 'prisma.card.findUniqueOrThrow')], order: 6 }),
  rel(`${M}#addTravelNotice`, 'sh:cards#NormalizedTravelNotice', 'uses-type', 'input: NormalizedTravelNotice', { sources: [s(BC, 317, 322, 'NormalizedTravelNotice')] }),

  rel(`${M}#cancelTravelNotice`, `${M}#requireOwnedCard`, 'calls', 'requireOwnedCard(user.id, cardId)', { sources: [s(BC, 364, 364, 'requireOwnedCard')], order: 1 }),
  rel(`${M}#cancelTravelNotice`, 'db:CardTravelNotice', 'reads', 'findUnique by noticeId; must belong to cardId', { sources: [s(BC, 365, 368, 'prisma.cardTravelNotice.findUnique')], order: 2 }),
  rel(`${M}#cancelTravelNotice`, 'db:CardTravelNotice', 'writes', "update status → 'cancelled'", { sources: [s(BC, 369, 369, 'prisma.cardTravelNotice.update')], order: 3 }),
  rel(`${M}#cancelTravelNotice`, AUDIT, 'calls', "writeAudit(prisma, { action: 'card_travel_notice_cancelled', … })", { sources: [s(BC, 370, 378, "action: 'card_travel_notice_cancelled'")], order: 4 }),
  rel(`${M}#cancelTravelNotice`, 'db:Card', 'reads', 'findUniqueOrThrow by id (re-read)', { sources: [s(BC, 379, 379, 'prisma.card.findUniqueOrThrow')], order: 5 }),

  rel(`${M}#freezeCardById`, 'db:Card', 'reads', 'tx: findUnique by id (select status)', { sources: [s(BC, 391, 391, 'tx.card.findUnique')], order: 1 }),
  rel(`${M}#freezeCardById`, 'sh:cards#canFreezeCard', 'validates', 'canFreezeCard(card.status)', {
    summary: 'A missing, already-frozen or terminal card is skipped (returns false) instead of failing the operator’s transaction.',
    sources: [s(BC, 392, 392, 'canFreezeCard')],
    order: 2,
  }),
  rel(`${M}#freezeCardById`, 'db:Card', 'writes', "tx: update status → 'frozen'", { sources: [s(BC, 393, 393, "status: 'frozen'")], order: 3 }),
  rel(`${M}#CardError`, `${M}#CardErrorCode`, 'uses-type', 'readonly code: CardErrorCode', { sources: [s(BC, 38, 45, 'CardErrorCode')] }),

  // ---- Features -------------------------------------------------------------
  rel(M, 'feat:cards', 'implements', 'card lifecycle', { sources: [s(BC, 26, 34, 'Card lifecycle service')] }),
  rel(RG, 'feat:cards', 'implements', 'card endpoints', { sources: [s(RC, 28, 32, 'Customer card-lifecycle endpoints')] }),
  rel('sh:cards', 'feat:cards', 'implements', 'card contract', { sources: [s(F.shCards, 1, 14, 'Card contracts')] }),
  rel(`${M}#freezeCardById`, 'feat:fraud', 'implements', 'freeze on confirmed fraud', { sources: [s(BC, 386, 389, 'operator fraud flow')] }),
  rel(M, 'feat:audit', 'implements', 'audits every card change', { sources: [s(BC, 200, 208, 'writeAudit')] }),
  rel(`${M}#requireOwnedCard`, 'feat:rbac', 'implements', 'per-account card access', { sources: [s(BC, 124, 133, 'requireOwnedCard')] }),
];
