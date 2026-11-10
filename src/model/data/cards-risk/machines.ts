import type { GlossaryTerm, StateMachine } from '../../types';
import { F, s } from './helpers';

/** State machines and glossary for cards, fraud alerts and disputes. */

const BC = F.cards;
const BF = F.fraud;
const BD = F.disputes;
const APPLY = 'be:ops/requests#applyOperatorAction';

export const stateMachines: StateMachine[] = [
  {
    id: 'sm:card-status',
    name: 'Card status',
    summary: 'A card is in service (`active` or `frozen`) until it is reported lost or stolen, which is permanent and issues a replacement.',
    subject: 'db:Card',
    field: 'Card.status',
    initial: 'active',
    states: [
      { id: 'active', label: 'Active', description: 'Usable. Every card starts here: issued by `issueCard`, created as a replacement by `reportCard`, or seeded. Can be frozen, reported, and given travel notices.' },
      { id: 'frozen', label: 'Frozen', description: 'Temporarily locked. Set by the customer or by an operator confirming fraud — the row does not record which. Can be unfrozen by the customer, reported, and given travel notices.' },
      { id: 'lost', label: 'Lost', terminal: true, description: 'Reported lost. No further action is accepted; a replacement card exists whose `replacesCardId` points here.' },
      { id: 'stolen', label: 'Stolen', terminal: true, description: 'Reported stolen. Identical handling to `lost`; only the recorded reason differs.' },
      { id: 'replaced', label: 'Replaced', terminal: true, description: 'Declared in the shared status list and treated as terminal, but no code at this commit ever sets it. A card that has been replaced is `lost` or `stolen`.' },
      { id: 'cancelled', label: 'Cancelled', terminal: true, description: 'Declared and treated as terminal, but no code at this commit ever sets it on a card; there is no close-card endpoint.' },
    ],
    transitions: [
      { from: 'active', to: 'frozen', label: 'Customer freezes the card', by: 'be:cards/cards#freezeCard', description: 'POST /api/cards/:id/freeze. Guard `canFreezeCard`; audited as `card_frozen`.', source: s(BC, 243, 245, 'export function freezeCard') },
      { from: 'active', to: 'frozen', label: 'Operator confirms fraud on a linked alert', by: 'be:cards/cards#freezeCardById', description: 'Called by `confirmFraud` inside the operator’s transaction, with no access check. Skipped silently if the card is not active. Recorded only in the `fraud_confirmed` audit row (`cardFrozen: true`).', source: s(BC, 386, 395, 'export async function freezeCardById') },
      { from: 'frozen', to: 'active', label: 'Customer unfreezes the card', by: 'be:cards/cards#unfreezeCard', description: 'POST /api/cards/:id/unfreeze. Guard `canUnfreezeCard`; audited as `card_unfrozen`. Works the same whether the customer or a confirmed fraud froze it.', source: s(BC, 247, 249, 'export function unfreezeCard') },
      { from: 'active', to: 'lost', label: 'Reported lost → replacement issued', by: 'be:cards/cards#reportCard', description: 'POST /api/cards/:id/report with reason `lost`. One transaction: this card → lost, its travel notices cancelled, a new active card created.', source: s(BC, 275, 279, 'data: { status: reason') },
      { from: 'active', to: 'stolen', label: 'Reported stolen → replacement issued', by: 'be:cards/cards#reportCard', description: 'Same as lost, with reason `stolen`.', source: s(BC, 275, 279, 'data: { status: reason') },
      { from: 'frozen', to: 'lost', label: 'Reported lost while frozen', by: 'be:cards/cards#reportCard', description: '`canReportCard` allows a frozen card. The replacement is created `active`, not frozen.', source: s(F.shCards, 64, 67, 'canReportCard') },
      { from: 'frozen', to: 'stolen', label: 'Reported stolen while frozen', by: 'be:cards/cards#reportCard', description: 'Same as above, with reason `stolen`.', source: s(F.shCards, 64, 67, 'canReportCard') },
    ],
    sources: [s(F.shCards, 26, 36, 'CARD_STATUSES'), s(F.shCards, 47, 72, 'TERMINAL_CARD_STATUSES'), s(F.schema, 302, 302, 'active|frozen|lost|stolen|replaced|cancelled')],
  },
  {
    id: 'sm:travel-notice-status',
    name: 'Travel notice status',
    summary: 'A travel notice is `active` from creation until it is cancelled — by the customer, or automatically when its card is reported lost or stolen.',
    subject: 'db:CardTravelNotice',
    field: 'CardTravelNotice.status',
    initial: 'active',
    states: [
      { id: 'active', label: 'Active', description: 'Created by `addTravelNotice` on an in-service card. Included in the card DTO and counted against the cap of 10 per card. It does not expire: nothing compares `endsOn` with the simulated date.' },
      { id: 'cancelled', label: 'Cancelled', terminal: true, description: 'Kept in the table but left out of the card DTO. There is no way to reactivate it.' },
    ],
    transitions: [
      { from: 'active', to: 'cancelled', label: 'Customer cancels the notice', by: 'be:cards/cards#cancelTravelNotice', description: 'POST /api/cards/:id/travel-notices/:noticeId/cancel; audited as `card_travel_notice_cancelled`.', source: s(BC, 369, 369, "status: 'cancelled'") },
      { from: 'active', to: 'cancelled', label: 'Card reported lost / stolen', by: 'be:cards/cards#reportCard', description: 'All of the old card’s active notices are cancelled in the same transaction that issues the replacement.', source: s(BC, 280, 283, "data: { status: 'cancelled' }") },
    ],
    sources: [s(F.shCards, 42, 43, 'TRAVEL_NOTICE_STATUSES'), s(F.schema, 318, 330, 'model CardTravelNotice')],
  },
  {
    id: 'sm:fraud-alert',
    name: 'Fraud alert',
    summary: 'A fraud alert is an operations request: the customer’s answer is recorded on it without resolving it, and an operator’s approve or reject ends it as confirmed fraud or dismissed.',
    subject: 'db:OperationsRequest',
    field: 'OperationsRequest.status + payload.customerResponse + payload.resolution',
    initial: 'awaiting_customer',
    states: [
      { id: 'awaiting_customer', label: 'Pending · no response', description: '`status: pending`, `payload.customerResponse: null`. Listed on the customer’s dashboard with both buttons; shown to operators as "No response yet". An operator may already decide.' },
      { id: 'customer_reported', label: 'Pending · reported as fraud', description: '`status: pending`, `payload.customerResponse: "report_fraud"`. Still pending: no reversal, no freeze. Operators see "Reported as fraud".' },
      { id: 'customer_confirmed', label: 'Pending · "it was me"', description: '`status: pending`, `payload.customerResponse: "confirm_legit"`. Still pending — the alert is not closed automatically; an operator must still reject (dismiss) it.' },
      { id: 'parked', label: 'On hold / info requested', description: '`status: on_hold` or `info_requested` — the generic queue actions. The alert is no longer `pending`, so it vanishes from the customer’s list and a customer response is refused with 400 `invalid_state`. An operator can still approve or reject.' },
      { id: 'confirmed_fraud', label: 'Confirmed fraud', terminal: true, description: '`status: approved`, `payload.resolution: "confirmed_fraud"`, `payload.reversed` true if the linked entry was reversed. The linked card was frozen if it was active.' },
      { id: 'dismissed', label: 'Dismissed', terminal: true, description: '`status: rejected`, `payload.resolution: "dismissed"`, `payload.reversed: false`. The charge stands and the card is untouched.' },
    ],
    transitions: [
      { from: 'awaiting_customer', to: 'customer_reported', label: 'Customer: "Report fraud"', by: 'be:risk/fraud#respondToFraudAlert', description: 'POST /api/fraud-alerts/:id/respond { response: "report_fraud" }. Payload + audit + inbound simulated SMS; pushed to operators.', source: s(BF, 106, 113, 'customerResponse: response') },
      { from: 'awaiting_customer', to: 'customer_confirmed', label: 'Customer: "Confirm — it was me"', by: 'be:risk/fraud#respondToFraudAlert', description: 'Same call with `confirm_legit`.', source: s(BF, 106, 113, 'customerResponse: response') },
      { from: 'customer_reported', to: 'customer_confirmed', label: 'Customer answers again (server allows it)', by: 'be:risk/fraud#respondToFraudAlert', description: 'The service only requires `status === "pending"`; a second answer overwrites the first. The dashboard hides the buttons after an answer, so this needs a direct API call.', source: s(BF, 102, 107, "request.status !== 'pending'"), confidence: 'inferred' },
      { from: 'customer_confirmed', to: 'customer_reported', label: 'Customer answers again (server allows it)', by: 'be:risk/fraud#respondToFraudAlert', description: 'As above, in the other direction.', source: s(BF, 102, 107, "request.status !== 'pending'"), confidence: 'inferred' },
      { from: 'awaiting_customer', to: 'confirmed_fraud', label: 'Operator: Approve (no customer answer needed)', by: 'be:risk/fraud#confirmFraud', description: '`applyOperatorAction` sets `approved` and calls `confirmFraud` in one transaction: reverse the entry, freeze the card.', source: s(F.ops, 378, 387, "existing.type === 'fraud_alert'") },
      { from: 'customer_reported', to: 'confirmed_fraud', label: 'Operator: Approve = confirm fraud', by: 'be:risk/fraud#confirmFraud', description: 'The main path: reverse the linked charge (`posted` → `reversed`) and freeze the linked card.', source: s(BF, 153, 174, "resolution: 'confirmed_fraud'") },
      { from: 'customer_confirmed', to: 'confirmed_fraud', label: 'Operator: Approve (overrides "it was me")', by: 'be:risk/fraud#confirmFraud', description: '`confirmFraud` never reads `customerResponse`, so nothing prevents this.', source: s(BF, 153, 174, "resolution: 'confirmed_fraud'"), confidence: 'inferred' },
      { from: 'awaiting_customer', to: 'dismissed', label: 'Operator: Reject = dismiss', by: 'be:risk/fraud#dismissFraud', description: '`applyOperatorAction` sets `rejected` and calls `dismissFraud`: payload, audit and a simulated email only.', source: s(BF, 202, 213, "resolution: 'dismissed'") },
      { from: 'customer_reported', to: 'dismissed', label: 'Operator: Reject = dismiss', by: 'be:risk/fraud#dismissFraud', source: s(BF, 202, 213, "resolution: 'dismissed'") },
      { from: 'customer_confirmed', to: 'dismissed', label: 'Operator: Reject = dismiss as legitimate', by: 'be:risk/fraud#dismissFraud', description: 'The expected ending after the customer says the charge was theirs.', source: s(BF, 202, 213, "resolution: 'dismissed'") },
      { from: 'awaiting_customer', to: 'parked', label: 'Operator: Hold / Request info', by: APPLY, description: 'Falls through to the generic workflow branch: status changes, nothing else. The same applies from either answered state.', source: s(F.ops, 389, 393, 'All other decisions') },
      { from: 'customer_reported', to: 'parked', label: 'Operator: Hold / Request info', by: APPLY, source: s(F.ops, 389, 393, 'All other decisions') },
      { from: 'customer_confirmed', to: 'parked', label: 'Operator: Hold / Request info', by: APPLY, source: s(F.ops, 389, 393, 'All other decisions') },
      { from: 'parked', to: 'confirmed_fraud', label: 'Operator: Approve', by: 'be:risk/fraud#confirmFraud', description: 'Held and info-requested requests are still actionable.', source: s(F.shOps, 98, 106, 'TERMINAL_OPS_STATUSES') },
      { from: 'parked', to: 'dismissed', label: 'Operator: Reject', by: 'be:risk/fraud#dismissFraud', source: s(F.shOps, 98, 106, 'TERMINAL_OPS_STATUSES') },
    ],
    sources: [s(BF, 19, 30, 'Fraud-alert service'), s(F.shRisk, 39, 53, 'export interface FraudPayload'), s(BF, 59, 63, "status: 'pending'", 'Why a parked alert disappears from the customer’s list')],
  },
  {
    id: 'sm:dispute',
    name: 'Transaction dispute',
    summary: 'Filing a dispute flags the ledger entry `disputed` and opens a request; the operator’s approve reverses the entry (upheld) and reject restores it to `posted` (denied).',
    subject: 'db:OperationsRequest',
    field: 'OperationsRequest.status + payload.resolution, mirrored by LedgerEntry.status',
    initial: 'not_disputed',
    states: [
      { id: 'not_disputed', label: 'Posted, no dispute', description: 'The ledger entry is `posted` and no dispute request refers to it. Only this state can be disputed (and not if the entry is a transfer leg).' },
      { id: 'open', label: 'Open', description: 'Request `status: pending`; entry `status: disputed`. The entry still counts in balances exactly as before; the customer sees a "Disputed" badge.' },
      { id: 'parked', label: 'On hold / info requested', description: 'Request `on_hold` or `info_requested`; the entry stays `disputed`. The seeded Trattoria Romana dispute starts here (`info_requested`).' },
      { id: 'upheld', label: 'Upheld', terminal: true, description: 'Request `approved`, `payload.resolution: "upheld"`, `payload.reversed: true`; entry `reversed` — it no longer counts, so the amount is back in the balance. Shown to operators with a "Reversed" tag.' },
      { id: 'denied', label: 'Denied', terminal: true, description: 'Request `rejected`, `payload.resolution: "denied"`, `payload.reversed: false`; entry back to `posted`. The request is finished, but the entry is ordinary again and could be disputed anew.' },
    ],
    transitions: [
      { from: 'not_disputed', to: 'open', label: 'Customer files a dispute', by: 'be:risk/disputes#createDispute', description: 'POST /api/disputes. One transaction: entry → disputed, request created, audit, simulated email; pushed to operators.', source: s(BD, 106, 123, "status: 'disputed'") },
      { from: 'open', to: 'upheld', label: 'Operator: Approve = uphold', by: 'be:risk/disputes#upholdDispute', description: '`applyOperatorAction` sets `approved` and calls `upholdDispute`: `reverseLedgerEntries` flips the entry to `reversed`.', source: s(BD, 164, 181, "resolution: 'upheld'") },
      { from: 'open', to: 'denied', label: 'Operator: Reject = deny', by: 'be:risk/disputes#denyDispute', description: '`applyOperatorAction` sets `rejected` and calls `denyDispute`: the entry returns to `posted`.', source: s(BD, 212, 229, "resolution: 'denied'") },
      { from: 'open', to: 'parked', label: 'Operator: Hold / Request info', by: APPLY, description: 'Generic workflow branch: the request’s status changes; the entry stays `disputed`. Request info also records a simulated email.', source: s(F.ops, 389, 393, 'All other decisions') },
      { from: 'parked', to: 'upheld', label: 'Operator: Approve = uphold', by: 'be:risk/disputes#upholdDispute', source: s(F.ops, 359, 372, "existing.type === 'dispute'") },
      { from: 'parked', to: 'denied', label: 'Operator: Reject = deny', by: 'be:risk/disputes#denyDispute', source: s(F.ops, 359, 372, "existing.type === 'dispute'") },
    ],
    sources: [s(BD, 18, 28, 'Transaction-dispute service'), s(F.shRisk, 135, 149, 'export interface DisputePayload'), s(F.seedPlan, 623, 637, "key: 'dispute-trattoria'", 'A seeded dispute that starts in info_requested')],
  },
];

export const glossary: GlossaryTerm[] = [
  {
    term: 'Fraud alert',
    definition:
      'A flag on a suspicious charge. In Meridian it is an operations request of type `fraud_alert` addressed to a customer by email, with a JSON payload naming the merchant and amount and linking the ledger entry and the card. Nothing in the running system raises alerts — the demo’s one alert (QuickFuel, $48.90) is seeded.',
    related: ['be:risk/fraud', 'sh:risk#FraudPayload', 'db:OperationsRequest', 'feat:fraud'],
    aliases: ['security alert', 'suspicious charge', 'fraud_alert'],
  },
  {
    term: 'Customer response (it was me / report fraud)',
    definition:
      'The customer’s answer to a fraud alert: `confirm_legit` ("Confirm — it was me") or `report_fraud` ("Report fraud"). It is recorded on the alert and shown to operators, but it is advice only — it changes no money, does not freeze the card and does not close the alert.',
    related: ['sh:risk#FraudResponse', 'be:risk/fraud#respondToFraudAlert', 'ep:POST /api/fraud-alerts/:id/respond'],
    aliases: ['confirm_legit', 'report_fraud', 'it was me'],
  },
  {
    term: 'Confirm fraud vs dismiss',
    definition:
      'The operator’s two decisions on a fraud alert, made with the ordinary queue buttons. Approve = confirm fraud: the linked charge is reversed and the linked card is frozen. Reject = dismiss: the charge stands, the card is untouched, and the alert is recorded as legitimate activity.',
    related: ['be:risk/fraud#confirmFraud', 'be:risk/fraud#dismissFraud', 'be:ops/requests#applyOperatorAction'],
    aliases: ['approve fraud alert', 'reject fraud alert', 'confirmed_fraud', 'dismissed'],
  },
  {
    term: 'Dispute',
    definition:
      'A customer’s challenge to a posted transaction. Filing marks the ledger entry `disputed` — a flag that leaves balances unchanged — and opens an operations request of type `dispute` for an operator. Transfer legs and anything not yet posted cannot be disputed.',
    related: ['be:risk/disputes#createDispute', 'ep:POST /api/disputes', 'sh:risk#DisputePayload', 'feat:disputes'],
    aliases: ['chargeback', 'disputed transaction'],
  },
  {
    term: 'Uphold / deny',
    definition:
      'The operator’s two decisions on a dispute. Approve = uphold: the disputed entry is reversed, so the customer gets the money back. Reject = deny: the entry returns to `posted` and the charge stands.',
    related: ['be:risk/disputes#upholdDispute', 'be:risk/disputes#denyDispute'],
    aliases: ['upheld', 'denied', 'approve dispute', 'reject dispute'],
  },
  {
    term: 'Reversal',
    definition:
      'Undoing a settled ledger entry by changing its status to `reversed`. A reversed entry is ignored when balances are derived, so reversing a debit puts the money back. No balance is edited and no compensating entry is added. Confirmed fraud, upheld disputes and reversed money movements all use the same function.',
    related: ['be:money/movements#reverseLedgerEntries', 'db:LedgerEntry', 'feat:balances'],
    aliases: ['reversed', 'refund', 'reverse a charge'],
  },
  {
    term: 'Freeze',
    definition:
      'A reversible lock on a card: status `active` → `frozen`. The customer can freeze and unfreeze from the Cards page; an operator confirming fraud freezes the linked card as part of the same action. The card row does not record who froze it, so the customer can lift either kind of freeze.',
    related: ['be:cards/cards#freezeCard', 'be:cards/cards#freezeCardById', 'be:cards/cards#unfreezeCard'],
    aliases: ['frozen card', 'lock card', 'unfreeze'],
  },
  {
    term: 'Lost / stolen replacement',
    definition:
      'Reporting a card lost or stolen permanently retires it (status `lost` or `stolen`) and, in the same database transaction, creates a replacement card on the same account with a new last four digits. The replacement’s `replacesCardId` points back at the old card.',
    related: ['be:cards/cards#reportCard', 'ep:POST /api/cards/:id/report', 'sh:cards#ReplaceCardResponse'],
    aliases: ['report card', 'replacement card', 'replacesCardId'],
  },
  {
    term: 'Travel notice',
    definition:
      'A note on a card that the customer will be travelling: a destination, a start date and an end date. It is stored and shown back, and can be cancelled; no other part of Meridian reads it, and it never expires on its own.',
    related: ['be:cards/cards#addTravelNotice', 'db:CardTravelNotice'],
    aliases: ['travel plan', 'travel notification'],
  },
  {
    term: 'last4',
    definition:
      'The only "card number" Meridian stores: four digits generated at random when a card is issued or replaced (they may start with zero). The UI shows them after twelve dots. There is no full card number, CVV or PIN anywhere in the system.',
    related: ['db:Card', 'sh:cards#maskedCardNumber', 'be:cards/cards#issueCard'],
    aliases: ['last four', 'masked card number', 'PAN'],
  },
  {
    term: 'Simulated card',
    definition:
      'A card in Meridian is a database row with a type, a display-only network, a made-up last four and an expiry. It is connected to no card network or issuer. Managing it (issue, freeze, report, travel notice) never moves money; card spending appears separately as ledger entries with origin `card`, which exist only in the seeded data.',
    related: ['be:cards/cards', 'sh:cards', 'db:Card', 'feat:cards'],
    aliases: ['fake card', 'debit card', 'credit card'],
  },
  {
    term: 'Disputed (ledger status)',
    definition:
      'A ledger entry status meaning "posted, but under dispute". It counts in the current and available balance exactly like `posted`; the only difference is the badge. It ends as `reversed` (dispute upheld) or goes back to `posted` (dispute denied).',
    related: ['db:LedgerEntry', 'be:risk/disputes#createDispute'],
    aliases: ['disputed'],
  },
];
