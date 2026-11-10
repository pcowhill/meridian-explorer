import type { Scenario, ScenarioStep, SourceRef } from '../../types';
import { baseState, IDS, NOW } from '../fixtures';

/**
 * "What happens when a customer reports a card lost or stolen?"
 *
 * Avery reports her debit card ••4821 (fixture card_debit) lost from the Wallet
 * page. The old card becomes terminal, its active travel notice is cancelled
 * and a replacement card is issued with a new simulated last four, all in one
 * transaction with one audit row. Card lifecycle never touches the ledger.
 */

// ---- Source files -----------------------------------------------------------
const F = {
  wallet: 'apps/customer/src/pages/Wallet.tsx',
  libCards: 'apps/customer/src/lib/cards.ts',
  routesCards: 'apps/backend/src/routes/cards.ts',
  cards: 'apps/backend/src/cards/cards.ts',
  shCards: 'packages/shared/src/cards.ts',
  access: 'apps/backend/src/auth/access.ts',
  testRoutes: 'apps/backend/src/routes/cards-risk.test.ts',
  testE2e: 'e2e/cards-fraud-disputes.spec.ts',
} as const;

const s = (file: string, start: number, end: number, symbol: string, note?: string): SourceRef =>
  note ? { file, start, end, symbol, note } : { file, start, end, symbol };

// ---- Lanes ------------------------------------------------------------------
const CUSTOMER = 'role:customer';
const WALLET = 'cu:pages/Wallet';
const LIB = 'cu:lib/cards';
const ROUTES = 'be:routes/cards';
const SERVICE = 'be:cards/cards';
const RULES = 'sh:cards';
const CARD = 'db:Card';
const NOTICE = 'db:CardTravelNotice';
const AUDIT = 'db:AuditLog';

// ---- Variants ---------------------------------------------------------------
const LOST = 'lost';
const NA = 'not-allowed';
const FU = 'freeze-unfreeze';
const REPORTED = [LOST, NA];

// ---- Example data -----------------------------------------------------------
const OLD = IDS.debitCard;
const NEW = 'card_repl';
const NEW_LAST4 = '7716';
const NOTICE_ID = 'ctn_lisbon';
const CARD_CREATED = '2026-08-01T12:00:00.000Z';
/** AuditLog.createdAt is the database default (wall clock), not the simulated time. */
const WALL = '2026-10-01T15:03:20.000Z';
const WALL2 = '2026-10-01T15:04:05.000Z';
const CSRF_HEADERS = { 'Content-Type': 'application/json', 'x-meridian-csrf': '<value of the mer_csrf cookie>' };

const NOTICE_DTO = {
  id: NOTICE_ID,
  cardId: OLD,
  destination: 'Lisbon, Portugal',
  startsOn: '2026-10-10T00:00:00.000Z',
  endsOn: '2026-10-20T00:00:00.000Z',
  note: 'Family holiday',
  status: 'active',
  createdAt: '2026-09-20T12:00:00.000Z',
};

const cardDto = (over: Record<string, unknown> = {}) => ({
  id: OLD,
  accountId: IDS.checking,
  accountName: 'Everyday Checking',
  cardholderName: 'Avery Customer',
  cardType: 'debit',
  network: 'visa',
  last4: '4821',
  expMonth: 9,
  expYear: 2030,
  status: 'active',
  replacesCardId: null as string | null,
  travelNotices: [NOTICE_DTO] as unknown[],
  createdAt: CARD_CREATED,
  updatedAt: CARD_CREATED,
  ...over,
});
const REPLACEMENT_DTO = cardDto({ id: NEW, last4: NEW_LAST4, expMonth: 10, expYear: 2030, replacesCardId: OLD, travelNotices: [], createdAt: NOW, updatedAt: NOW });

const steps: ScenarioStep[] = [
  {
    id: 'start',
    kind: 'note',
    title: 'Starting point: an active debit card with a travel notice',
    from: CARD,
    to: CARD,
    label: 'card_debit active · ••4821',
    narrative:
      'Avery holds one `active` Visa debit card ••4821 on Everyday Checking, with an active travel notice for Lisbon (10–20 October). A card row carries only a simulated last four, an expiry, a status and an optional `replacesCardId` — never a card number.',
    audience: {
      executive: 'A customer has one debit card on her checking account and has told the bank she will be travelling.',
      'end-user': 'You have a debit card ending 4821 and a travel notice for Lisbon.',
      dba: 'Card rows hold status as a string (active|frozen|lost|stolen|replaced|cancelled). replacesCardId is a self-link with no FK constraint.',
    },
    detail: 2,
    payload: { title: 'Card card_debit', format: 'row', data: { id: OLD, accountId: IDS.checking, userId: IDS.avery, cardType: 'debit', network: 'visa', last4: '4821', expMonth: 9, expYear: 2030, status: 'active', replacesCardId: null }, typeRef: 'db:Card', highlight: ['status', 'last4'] },
    sources: [s(F.shCards, 26, 36, 'CARD_STATUSES')],
  },
  {
    id: 'open-wallet',
    kind: 'request',
    title: 'The Wallet loads Avery’s cards',
    from: WALLET,
    to: ROUTES,
    label: 'GET /api/cards',
    narrative: 'Opening Cards (`/wallet`) calls `listCards()` → `GET /api/cards` (only `requireAuth`). The service collects every account Avery owns or has an access grant on and returns their cards newest first, each with its active travel notices.',
    detail: 3,
    payload: { title: 'Response (excerpt)', format: 'http-response', line: '200 OK', data: { cards: [cardDto()] }, typeRef: 'sh:cards#CardListResponse', highlight: ['cards.0.status'] },
    sources: [s(F.wallet, 663, 668, 'listCards()'), s(F.routesCards, 67, 70, "app.get('/api/cards'"), s(F.cards, 137, 149, 'export async function listCards')],
  },
  {
    id: 'wallet-shows',
    kind: 'ui',
    title: 'The card and its actions',
    from: WALLET,
    to: CUSTOMER,
    label: 'Freeze · Add travel notice · Report lost / stolen',
    narrative:
      'Each card shows its masked number, expiry, status badge and travel notices. Buttons are driven by the shared rules: "Freeze" when `canFreezeCard` (active), "Unfreeze" when `canUnfreezeCard` (frozen), "Add travel notice" and "Report lost / stolen" while the card is active or frozen. Terminal cards get no buttons.',
    audience: { 'end-user': 'Your card shows "Active" with buttons to freeze it, add a travel notice, or report it lost or stolen.' },
    detail: 2,
    sources: [s(F.wallet, 435, 480, 'Report lost / stolen'), s(F.shCards, 54, 72, 'export function canReportCard')],
  },
  {
    id: 'choice',
    kind: 'decision',
    title: 'What does Avery do?',
    from: CUSTOMER,
    to: WALLET,
    label: 'report / freeze',
    narrative: 'Reporting is permanent and issues a new card; freezing is a reversible lock on the same card. "Lost" and "Stolen" take exactly the same code path — the reason only becomes the old card\'s status and appears in the audit text.',
    detail: 2,
    decision: {
      question: 'What does the customer do with the card?',
      options: [
        { label: 'Report it lost', variant: LOST, description: 'The card becomes "Lost" and a replacement is issued.' },
        { label: 'Report it lost, then report it again from a stale tab', variant: NA, description: 'The second report is refused with 400 invalid_state.' },
        { label: 'Freeze it, then unfreeze it', variant: FU, description: 'Same card throughout; no replacement.' },
      ],
    },
    sources: [s(F.shCards, 38, 40, 'CARD_REPORT_REASONS'), s(F.cards, 277, 277, 'data: { status: reason, updatedAt: now }')],
  },

  // ---- Report lost ------------------------------------------------------------
  {
    id: 'r-form',
    kind: 'ui',
    title: 'Avery reports the card lost',
    from: CUSTOMER,
    to: WALLET,
    label: '"Report lost / stolen" → Lost → "Report & replace"',
    narrative: 'Avery clicks "Report lost / stolen". An inline form asks "What happened to this card?" with Lost / Stolen and warns that reporting terminates the card and issues a replacement. She chooses "Lost" and clicks "Report & replace".',
    audience: {
      executive: 'The customer reports her card lost from the Cards page.',
      'end-user': 'You click "Report lost / stolen", choose "Lost" and click "Report & replace".',
    },
    detail: 1,
    variants: REPORTED,
    sources: [s(F.wallet, 340, 368, 'Report & replace')],
  },
  {
    id: 'r-client',
    kind: 'client',
    title: 'Validate, then call the client helper',
    from: WALLET,
    to: LIB,
    label: "validateReportCard → reportCard(id, { reason: 'lost' })",
    narrative: '`ReportCardForm.handleSubmit` runs the shared `validateReportCard` (the reason must be `lost` or `stolen`), then `reportCard(cardId, check.value)`. The helper never throws: failures come back as `{ ok: false, code, message, fields }`.',
    detail: 4,
    variants: REPORTED,
    sources: [s(F.wallet, 319, 337, 'reportCard(cardId, check.value)'), s(F.shCards, 205, 212, 'export function validateReportCard')],
  },
  {
    id: 'r-request',
    kind: 'request',
    title: 'POST the report',
    from: LIB,
    to: ROUTES,
    label: 'POST /api/cards/:id/report',
    narrative: 'The request carries the customer session cookie and the CSRF double-submit header.',
    detail: 3,
    variants: REPORTED,
    payload: { title: 'Request', format: 'http-request', line: `POST /api/cards/${OLD}/report`, headers: CSRF_HEADERS, data: { reason: 'lost' }, typeRef: 'sh:cards#ReportCardRequest', highlight: ['reason'] },
    sources: [s(F.libCards, 164, 178, 'export function reportCard')],
  },
  {
    id: 'r-guards',
    kind: 'guard',
    title: 'CSRF, session, rate limit, body check',
    from: ROUTES,
    to: ROUTES,
    label: "csrfHook → requireAuth → rateLimit('cards') → validateReportCard",
    narrative: 'Global hooks check the CSRF header and, in public-demo mode, the mutation valve. `requireAuth` resolves the session; every card mutation shares the `cards` rate-limit bucket. The handler re-runs `validateReportCard`; an unknown reason is `400 invalid_request` with a `fields.reason` message.',
    detail: 4,
    variants: REPORTED,
    sources: [s(F.routesCards, 64, 64, "rateLimit('cards')"), s(F.routesCards, 124, 130, 'validateReportCard')],
  },
  {
    id: 'r-access',
    kind: 'db-read',
    title: 'Load the card and check access',
    from: SERVICE,
    to: CARD,
    label: 'requireOwnedCard → findUnique + relationship',
    narrative: "`reportCard(req.user, 'card_debit', 'lost', simulationNow)` starts with `requireOwnedCard`: load the card with its account name, holder name and travel notices (404 `not_found` if missing), then `getAccountRelationship` on the card's account — `owner`, `joint` or `authorized` may manage it (403 `forbidden` otherwise). The check is on the account, not the holder: Jordan, joint on Everyday Checking, could report Avery's card too.",
    audience: { dba: 'One Card read with joins to Account, User and CardTravelNotice, then one AccountAccess lookup.' },
    detail: 4,
    variants: REPORTED,
    sources: [s(F.cards, 124, 133, 'async function requireOwnedCard'), s(F.cards, 48, 48, 'CARD_RELATIONSHIPS'), s(F.access, 72, 88, 'export async function getAccountRelationship')],
  },
  {
    id: 'r-rule',
    kind: 'validate',
    title: 'Can this card still be reported?',
    from: SERVICE,
    to: RULES,
    label: "canReportCard('active') → true",
    narrative: '`canReportCard` allows only an in-service card (`active` or `frozen`). It passes. The service then draws the replacement\'s simulated last four (`randomInt(0, 10000)`, zero-padded) and an expiry four years from the simulated now (month 10, year 2030). Nothing compares the new last four with the old one.',
    detail: 4,
    variants: REPORTED,
    sources: [s(F.cards, 267, 272, 'canReportCard(card.status as CardStatus)'), s(F.shCards, 64, 67, 'export function canReportCard'), s(F.cards, 101, 109, 'function simulatedLast4')],
  },
  {
    id: 'r-terminal',
    kind: 'db-write',
    title: 'The old card is marked lost',
    from: SERVICE,
    to: CARD,
    label: "tx: card_debit status → 'lost'",
    narrative: "One `prisma.$transaction` holds the whole report. First statement: the old card's `status` becomes the reason itself (`'lost'`) and `updatedAt` the simulated time. `lost` is terminal: no later freeze, unfreeze, report or travel notice is accepted on it. (The `replaced` status exists in the shared list but no backend code writes it.)",
    audience: {
      executive: 'The lost card is permanently blocked.',
      'end-user': 'Your old card ending 4821 is marked "Lost" and can no longer be used.',
      dba: "UPDATE Card SET status = 'lost', updatedAt = <simulated now> WHERE id = 'card_debit', inside an interactive transaction.",
    },
    detail: 1,
    variants: REPORTED,
    effects: [{ op: 'update', table: 'Card', id: OLD, set: { status: 'lost', updatedAt: NOW } }],
    sources: [s(F.cards, 274, 279, 'data: { status: reason, updatedAt: now }'), s(F.shCards, 47, 52, 'TERMINAL_CARD_STATUSES')],
  },
  {
    id: 'r-notices',
    kind: 'db-write',
    title: 'Its travel notices are cancelled',
    from: SERVICE,
    to: NOTICE,
    label: "updateMany active → 'cancelled'",
    narrative: "Same transaction: every `active` travel notice on the old card becomes `cancelled`. They are not copied to the replacement — Avery would add the Lisbon notice again on the new card.",
    audience: { dba: "UPDATE CardTravelNotice SET status = 'cancelled' WHERE cardId = 'card_debit' AND status = 'active'. One row here." },
    detail: 3,
    variants: REPORTED,
    effects: [{ op: 'update', table: 'CardTravelNotice', id: NOTICE_ID, set: { status: 'cancelled' } }],
    sources: [s(F.cards, 280, 283, 'tx.cardTravelNotice.updateMany')],
  },
  {
    id: 'r-issue',
    kind: 'db-write',
    title: 'A replacement card is issued',
    from: SERVICE,
    to: CARD,
    label: "create card_repl ••7716, replacesCardId 'card_debit'",
    narrative: 'Same transaction: a new card on the same account and holder, same type and network, `active`, with the new last four and expiry, and `replacesCardId` pointing at the old card. It is not counted against the live-cards-per-account cap that `issueCard` enforces.',
    audience: {
      executive: 'A new card with a new number is issued straight away on the same account.',
      'end-user': 'You get a new active card ending 7716.',
      dba: 'INSERT Card with replacesCardId = card_debit (the only link between the two rows).',
    },
    detail: 1,
    variants: REPORTED,
    payload: { title: 'Card card_repl', format: 'row', data: { id: NEW, accountId: IDS.checking, userId: IDS.avery, cardType: 'debit', network: 'visa', last4: NEW_LAST4, expMonth: 10, expYear: 2030, status: 'active', replacesCardId: OLD }, typeRef: 'db:Card', highlight: ['last4', 'replacesCardId'] },
    effects: [
      {
        op: 'insert',
        table: 'Card',
        row: { id: NEW, accountId: IDS.checking, userId: IDS.avery, cardType: 'debit', network: 'visa', last4: NEW_LAST4, expMonth: 10, expYear: 2030, status: 'active', replacesCardId: OLD, createdAt: NOW, updatedAt: NOW },
      },
    ],
    sources: [s(F.cards, 284, 299, 'replacesCardId: cardId'), s(F.cards, 172, 180, 'RESOURCE_CAPS.liveCardsPerAccount')],
  },
  {
    id: 'r-audit',
    kind: 'db-write',
    title: 'One audit row, then commit',
    from: SERVICE,
    to: AUDIT,
    label: "writeAudit 'card_reported'",
    narrative: '`writeAudit` inserts `card_reported` against the old card, with both card ids and the reason in metadata. The transaction commits. There is no simulated event, no operations request and no real-time push: operators are not told.',
    audience: {
      executive: 'The report is recorded in the audit trail with who made it.',
      dba: 'One INSERT AuditLog, then COMMIT. The audit row is the only record that links the report to the replacement besides Card.replacesCardId.',
    },
    detail: 3,
    variants: REPORTED,
    effects: [
      {
        op: 'insert',
        table: 'AuditLog',
        row: {
          id: 'aud_card_reported',
          actorId: IDS.avery,
          actorRole: 'customer',
          action: 'card_reported',
          entity: 'card',
          entityId: OLD,
          reason: `Card ••4821 reported lost; replacement ••${NEW_LAST4} issued (simulated)`,
          metadata: JSON.stringify({ reason: 'lost', replacedCardId: OLD, replacementCardId: NEW, actorName: 'Avery Customer' }),
          createdAt: WALL,
        },
      },
    ],
    sources: [s(F.cards, 300, 310, "action: 'card_reported'")],
  },
  {
    id: 'r-no-ledger',
    kind: 'state',
    title: 'No money moved',
    from: SERVICE,
    to: SERVICE,
    label: 'LedgerEntry untouched',
    narrative: 'The card service states it outright: "MONEY DISCIPLINE: NONE of this touches the ledger." Card spend exists separately as `card`-origin ledger entries, and those stay as they are — the QuickFuel charge made with ••4821 stays posted. Everyday Checking still derives to $2,451.10 current / $2,331.10 available. The integration test asserts the ledger row count is unchanged by card lifecycle calls.',
    audience: {
      executive: 'Reporting a card changes no balance and cancels no past charge. Disputing a charge is a separate step.',
      'end-user': 'Your balance and past transactions are unchanged.',
      dba: 'The transaction touched Card, CardTravelNotice and AuditLog only.',
    },
    detail: 2,
    variants: REPORTED,
    sources: [s(F.cards, 26, 34, 'NONE of this touches the ledger'), s(F.routesCards, 28, 32, 'card lifecycle moves NO money'), s(F.testRoutes, 87, 88, 'Card lifecycle moves no money.')],
  },
  {
    id: 'r-response',
    kind: 'response',
    title: '201 — the replacement and the old card',
    from: ROUTES,
    to: LIB,
    label: '201 { card, replaced }',
    narrative: '`card` is the replacement and `replaced` the old card, both as `CardDTO`. The old card\'s DTO is read by the status update, which runs before the travel notices are cancelled, so its `travelNotices` still lists the Lisbon notice as active.',
    detail: 3,
    variants: REPORTED,
    confidence: 'inferred',
    payload: {
      title: 'Response',
      format: 'http-response',
      line: '201 Created',
      data: { card: REPLACEMENT_DTO, replaced: cardDto({ status: 'lost', updatedAt: NOW }) },
      typeRef: 'sh:cards#ReplaceCardResponse',
      highlight: ['card.last4', 'card.replacesCardId', 'replaced.status'],
    },
    sources: [s(F.routesCards, 131, 133, 'reply.code(201)'), s(F.cards, 312, 312, 'replaced: toCardDTO(result.replaced)'), s(F.testRoutes, 109, 124, 'reports a card lost and issues a replacement')],
  },
  {
    id: 'r-wallet',
    kind: 'ui',
    title: 'The Wallet shows the replacement',
    from: WALLET,
    to: CUSTOMER,
    label: '••7716 Active · ••4821 Lost',
    narrative: '`applyReplacement` swaps in the old card\'s DTO and prepends the replacement; the list sorts in-service cards first. The new card shows "Active", the note "Replacement card." and all its buttons. The old card is dimmed with a "Lost" badge and no buttons. Its stale Lisbon notice still renders (with a Cancel button) until the page reloads.',
    audience: {
      executive: 'The customer immediately sees her new card on the Cards page.',
      'end-user': 'Your new card ending 7716 appears at the top, marked "Replacement card." The old card shows "Lost".',
    },
    detail: 1,
    variants: REPORTED,
    confidence: 'inferred',
    sources: [s(F.wallet, 695, 711, 'function applyReplacement'), s(F.wallet, 425, 427, 'Replacement card.'), s(F.wallet, 388, 388, 'isTerminalCardStatus(card.status)'), s(F.wallet, 256, 259, "notices.filter((n) => n.status === 'active')")],
  },
  {
    id: 'again',
    kind: 'decision',
    title: 'Does anyone act on the old card again?',
    from: CUSTOMER,
    to: WALLET,
    label: 'done / stale tab',
    narrative: 'The Wallet hides every action on a terminal card, but a second browser tab opened earlier still shows ••4821 as active.',
    detail: 2,
    variants: REPORTED,
    decision: {
      question: 'Is the old card reported again?',
      options: [
        { label: 'No — done', variant: LOST },
        { label: 'Yes, from a stale tab', variant: NA, description: 'Refused: the card is already terminal.' },
      ],
    },
    sources: [s(F.wallet, 435, 435, '{!terminal && (')],
  },
  {
    id: 'na-click',
    kind: 'ui',
    title: 'A second report from a stale tab',
    from: CUSTOMER,
    to: WALLET,
    label: 'reports ••4821 stolen (stale page)',
    narrative: 'In a tab loaded before the report, ••4821 still reads "Active" — the Wallet does not refresh itself. Avery reports it again, this time as "Stolen".',
    detail: 1,
    variants: [NA],
    sources: [s(F.wallet, 663, 668, 'listCards()')],
  },
  {
    id: 'na-request',
    kind: 'request',
    title: 'POST the second report',
    from: LIB,
    to: ROUTES,
    label: 'POST /api/cards/:id/report',
    narrative: 'Same endpoint, same card id. It passes the CSRF check, `requireAuth`, the rate limit and `validateReportCard`.',
    detail: 3,
    variants: [NA],
    payload: { title: 'Request', format: 'http-request', line: `POST /api/cards/${OLD}/report`, headers: CSRF_HEADERS, data: { reason: 'stolen' }, typeRef: 'sh:cards#ReportCardRequest' },
    sources: [s(F.routesCards, 124, 137, "app.post('/api/cards/:id/report'")],
  },
  {
    id: 'na-check',
    kind: 'validate',
    title: 'The card is already terminal',
    from: SERVICE,
    to: RULES,
    label: "canReportCard('lost') → false",
    narrative: '`requireOwnedCard` still passes (access has not changed), but `canReportCard(\'lost\')` is false, so `reportCard` throws `CardError(\'invalid_state\')` before the transaction opens. No second replacement is issued and nothing is written. Freeze and unfreeze on the lost card are refused the same way.',
    audience: { executive: 'A card that has been reported cannot be reported again, so a duplicate replacement is never issued.' },
    detail: 2,
    variants: [NA],
    sources: [s(F.cards, 268, 270, 'That card can no longer be reported lost or stolen.'), s(F.testRoutes, 121, 123, 'The reported card can no longer be frozen.')],
  },
  {
    id: 'na-response',
    kind: 'response',
    title: '400 invalid_state',
    from: ROUTES,
    to: LIB,
    label: '400 { code: invalid_state }',
    narrative: '`handleCardError` maps `CardError` codes with `cardHttpStatus`: `not_found` → 404, `forbidden` → 403, `limit_reached` → 409, `inactive_account` and `invalid_state` → 400.',
    detail: 3,
    variants: [NA],
    payload: { title: 'Response', format: 'http-response', line: '400 Bad Request', data: { error: 'That card can no longer be reported lost or stolen.', code: 'invalid_state' }, highlight: ['code'] },
    sources: [s(F.routesCards, 36, 54, 'function cardHttpStatus')],
  },
  {
    id: 'na-banner',
    kind: 'state',
    title: 'The stale tab shows the refusal',
    from: WALLET,
    to: CUSTOMER,
    label: '"That card can no longer be reported lost or stolen."',
    narrative: 'The client passes the server\'s message through; `ReportCardForm` hands it to the card\'s error banner. Reloading shows the true state: ••4821 "Lost", ••7716 "Active".',
    audience: { 'end-user': 'You see "That card can no longer be reported lost or stolen." Your replacement card is unaffected.' },
    detail: 1,
    variants: [NA],
    sources: [s(F.wallet, 331, 335, 'onError(result.message)'), s(F.libCards, 100, 107, 'message: err?.error ?? messageForCode(code, fallback)')],
  },

  // ---- Freeze / unfreeze ------------------------------------------------------
  {
    id: 'fu-freeze-click',
    kind: 'ui',
    title: 'Avery freezes the card',
    from: CUSTOMER,
    to: WALLET,
    label: 'clicks "Freeze"',
    narrative: 'Not sure the card is gone, Avery clicks "Freeze". `toggleFreeze(\'freeze\')` calls `freezeCard(card.id)` from `lib/cards.ts` — a POST with no body.',
    audience: { executive: 'The customer temporarily locks her card instead.', 'end-user': 'You click "Freeze".' },
    detail: 1,
    variants: [FU],
    sources: [s(F.wallet, 390, 401, 'freezeCard(card.id)'), s(F.libCards, 146, 153, 'export function freezeCard')],
  },
  {
    id: 'fu-freeze-request',
    kind: 'request',
    title: 'POST freeze',
    from: LIB,
    to: ROUTES,
    label: 'POST /api/cards/:id/freeze',
    narrative: 'Same guards as every card mutation: CSRF, `requireAuth`, `rateLimit(\'cards\')`. The handler calls `freezeCard(req.user, id, simulationNow)`.',
    detail: 3,
    variants: [FU],
    payload: { title: 'Request', format: 'http-request', line: `POST /api/cards/${OLD}/freeze`, headers: { 'x-meridian-csrf': '<value of the mer_csrf cookie>' }, data: null },
    sources: [s(F.routesCards, 103, 111, "app.post('/api/cards/:id/freeze'")],
  },
  {
    id: 'fu-freeze-write',
    kind: 'db-write',
    title: 'Status → frozen, plus an audit row',
    from: SERVICE,
    to: CARD,
    label: "setCardStatus → 'frozen' + 'card_frozen'",
    narrative: "`freezeCard` is `setCardStatus` with `canFreezeCard` as the guard: `requireOwnedCard`, then `canFreezeCard('active')` (a non-active card is 400 `invalid_state`), then `card.update({ status: 'frozen' })` and a `card_frozen` audit row. These are two separate writes, not one transaction. No replacement, no notice change, no ledger write.",
    audience: {
      executive: 'The card is locked; it can be unlocked later.',
      'end-user': 'Your card shows "Frozen".',
      dba: "UPDATE Card SET status = 'frozen', then INSERT AuditLog — no surrounding transaction.",
    },
    detail: 2,
    variants: [FU],
    effects: [
      { op: 'update', table: 'Card', id: OLD, set: { status: 'frozen', updatedAt: NOW } },
      {
        op: 'insert',
        table: 'AuditLog',
        row: { id: 'aud_card_frozen', actorId: IDS.avery, actorRole: 'customer', action: 'card_frozen', entity: 'card', entityId: OLD, reason: 'Card ••4821 → Frozen (simulated)', metadata: JSON.stringify({ from: 'active', to: 'frozen', actorName: 'Avery Customer' }), createdAt: WALL },
      },
    ],
    sources: [s(F.cards, 213, 245, 'async function setCardStatus'), s(F.shCards, 54, 57, 'export function canFreezeCard')],
  },
  {
    id: 'fu-freeze-response',
    kind: 'response',
    title: '200 — card frozen',
    from: ROUTES,
    to: WALLET,
    label: "200 { card } status 'frozen'",
    narrative: '`upsertCard` replaces the card in the list: a "Frozen" badge, and "Unfreeze" in place of "Freeze". "Add travel notice" and "Report lost / stolen" remain, since a frozen card is still in service.',
    detail: 2,
    variants: [FU],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', data: { card: cardDto({ status: 'frozen', updatedAt: NOW }) }, typeRef: 'sh:cards#CardResponse', highlight: ['card.status'] },
    sources: [s(F.wallet, 682, 688, 'function upsertCard'), s(F.testE2e, 38, 50, 'a customer freezes a card in the wallet')],
  },
  {
    id: 'fu-unfreeze',
    kind: 'db-write',
    title: 'Avery unfreezes it',
    from: SERVICE,
    to: CARD,
    label: "POST /unfreeze → 'active' + 'card_unfrozen'",
    narrative: "Having found the card, Avery clicks \"Unfreeze\". `POST /api/cards/card_debit/unfreeze` runs `setCardStatus` with `canUnfreezeCard('frozen')`, sets `status: 'active'` and writes `card_unfrozen`. No staff approval is involved.",
    audience: { executive: 'The customer unlocks the card herself.', 'end-user': 'You click "Unfreeze" and the card is active again.' },
    detail: 1,
    variants: [FU],
    effects: [
      { op: 'update', table: 'Card', id: OLD, set: { status: 'active', updatedAt: NOW } },
      {
        op: 'insert',
        table: 'AuditLog',
        row: { id: 'aud_card_unfrozen', actorId: IDS.avery, actorRole: 'customer', action: 'card_unfrozen', entity: 'card', entityId: OLD, reason: 'Card ••4821 → Active (simulated)', metadata: JSON.stringify({ from: 'frozen', to: 'active', actorName: 'Avery Customer' }), createdAt: WALL2 },
      },
    ],
    sources: [s(F.routesCards, 113, 121, "app.post('/api/cards/:id/unfreeze'"), s(F.cards, 247, 249, 'export function unfreezeCard'), s(F.testRoutes, 91, 107, 'freezes then unfreezes a card')],
  },
  {
    id: 'fu-outcome',
    kind: 'state',
    title: 'Same card, same number, active again',
    from: WALLET,
    to: CUSTOMER,
    label: '••4821 Active',
    narrative: 'Freezing and unfreezing change only `Card.status` (plus two audit rows). The card keeps its id, last four and travel notice, and the ledger is untouched throughout.',
    audience: { executive: 'Outcome: a reversible lock with no new card and no effect on money.' },
    detail: 2,
    variants: [FU],
    payload: { title: 'Response', format: 'http-response', line: '200 OK', data: { card: cardDto({ status: 'active', updatedAt: NOW }) }, typeRef: 'sh:cards#CardResponse', highlight: ['card.status'] },
    sources: [s(F.cards, 26, 34, 'NONE of this touches the ledger')],
  },
];

const base = baseState();

export const scenario: Scenario = {
  id: 'card-lost',
  title: 'Reporting a card lost or stolen',
  question: 'What happens when a customer reports a card lost or stolen?',
  summary:
    'From the Wallet the customer reports a card lost or stolen. In one transaction the old card becomes terminal, its travel notices are cancelled and a replacement card with a new simulated last four is issued, linked by `replacesCardId`; one audit row records it. No money moves and operators are not notified. A terminal card cannot be reported again.',
  category: 'risk',
  tags: ['cards', 'risk', 'audit'],
  participants: [CUSTOMER, WALLET, LIB, ROUTES, SERVICE, RULES, CARD, NOTICE, AUDIT],
  related: [
    'feat:cards',
    'ep:POST /api/cards/:id/report',
    'ep:POST /api/cards/:id/freeze',
    'ep:POST /api/cards/:id/unfreeze',
    'be:routes/cards',
    'be:cards/cards',
    'be:cards/cards#reportCard',
    'be:cards/cards#requireOwnedCard',
    'be:cards/cards#setCardStatus',
    'sh:cards#canReportCard',
    'sh:cards#validateReportCard',
    'sh:cards#ReplaceCardResponse',
    'cu:pages/Wallet',
    'cu:lib/cards#reportCard',
    'db:Card',
    'db:CardTravelNotice',
  ],
  variants: [
    { id: LOST, label: 'Report lost → replacement issued', description: 'The old card becomes "lost" and a new active card replaces it. "Stolen" follows the identical path.', outcome: 'success' },
    { id: NA, label: 'Reporting an already-reported card', description: 'A second report of the terminal card is refused with 400 invalid_state.', outcome: 'rejected' },
    { id: FU, label: 'Freeze, then unfreeze', description: 'A reversible lock on the same card instead of a replacement.', outcome: 'info' },
  ],
  defaultVariant: LOST,
  initialState: {
    ...base,
    Card: [
      { id: OLD, accountId: IDS.checking, userId: IDS.avery, cardType: 'debit', network: 'visa', last4: '4821', expMonth: 9, expYear: 2030, status: 'active', replacesCardId: null, createdAt: CARD_CREATED, updatedAt: CARD_CREATED },
    ],
    CardTravelNotice: [
      { id: NOTICE_ID, cardId: OLD, destination: 'Lisbon, Portugal', startsOn: '2026-10-10T00:00:00.000Z', endsOn: '2026-10-20T00:00:00.000Z', note: 'Family holiday', status: 'active', createdAt: '2026-09-20T12:00:00.000Z' },
    ],
  },
  watchAccounts: [IDS.checking],
  steps,
  sources: [s(F.cards, 256, 313, 'export async function reportCard'), s(F.testRoutes, 109, 124, 'reports a card lost and issues a replacement')],
};
