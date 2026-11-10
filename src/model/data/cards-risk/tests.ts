import type { Entity, Relation } from '../../types';
import { F, rel, s } from './helpers';
import { EP } from './backend-cards';
import { RISK_EP } from './backend-risk';

/** Test files that pin the card, fraud and dispute behaviour. */

const TI = F.testRoutes;
const TC = F.testShCards;
const TR = F.testShRisk;
const TE = F.testE2e;

const T_INT = `test:${TI}`;
const T_SC = `test:${TC}`;
const T_SR = `test:${TR}`;
const T_E2E = `test:${TE}`;

export const testEntities: Entity[] = [
  {
    id: T_INT,
    kind: 'test',
    name: 'cards-risk.test.ts (backend integration)',
    parent: 'tests',
    summary: 'Vitest integration tests that drive the card, dispute and fraud endpoints through a real server and database and assert the ledger effects.',
    description:
      'Builds the server with a `RecordingOpsRealtime`, seeds the demo data and signs in as Avery (customer), Jordan (joint) and Sam (operator). Three groups:\n\n• Cards — issue, freeze / unfreeze (and the 400 on a double freeze), report → replacement, travel notice add / cancel, a 403 for a joint customer on an account they cannot reach, a 401 without a session; and that issuing a card leaves the ledger row count unchanged.\n• Disputes — filing flags the entry `disputed` and pushes a `created` change; operator approve reverses it and the settled total rises by exactly the amount; operator reject restores `posted`; 403 for another customer; 400 for a pending entry and for a transfer leg.\n• Fraud — listing; a response is recorded without resolving and pushes an inbound event; 403 for another customer; operator approve reverses the linked entry and freezes the linked card; operator reject on an unlinked alert leaves the settled total unchanged.',
    tech: ['Vitest', 'fastify.inject'],
    tags: ['tests', 'cards', 'risk', 'ledger'],
    sources: [s(TI, 8, 21, 'Integration tests for v0.8.0')],
  },
  {
    id: T_SC,
    kind: 'test',
    name: 'cards.test.ts (shared)',
    parent: 'tests',
    summary: 'Unit tests for the shared card contract: status guards, display helpers and the three validators.',
    description: 'Pins which statuses are terminal, that only an active card freezes and only a frozen one unfreezes, that reporting and travel notices need an in-service card, the masked-number and `MM/YY` formats, the visa default, and the travel-notice date rules.',
    tech: ['Vitest'],
    tags: ['tests', 'cards', 'validation'],
    sources: [s(TC, 15, 21, 'cards contract (v0.8.0)')],
  },
  {
    id: T_SR,
    kind: 'test',
    name: 'risk.test.ts (shared)',
    parent: 'tests',
    summary: 'Unit tests for the shared fraud and dispute contract: response guard, tolerant payload parsers, the dispute validator and the "reversed" flag helper.',
    tech: ['Vitest'],
    tags: ['tests', 'risk', 'validation'],
    sources: [s(TR, 10, 16, 'risk contract (v0.8.0)')],
  },
  {
    id: T_E2E,
    kind: 'test',
    name: 'cards-fraud-disputes.spec.ts (end-to-end)',
    parent: 'tests',
    summary: 'Playwright specs that click through both apps: freeze a card in the wallet, dispute a transaction, and have an operator confirm the seeded fraud alert and uphold the seeded dispute.',
    description: 'Runs serially against the seeded database. The two operator specs assert that after Approve the queue card shows both "Approved" and the "Reversed" tag — the visible sign that the linked ledger entry was reversed.',
    tech: ['Playwright'],
    tags: ['tests', 'cards', 'risk', 'ui'],
    sources: [s(TE, 3, 13, 'End-to-end coverage for v0.8.0')],
  },
];

const t = (from: string, to: string, label: string, file: string, start: number, end: number, symbol: string): Relation =>
  rel(from, to, 'tests', label, { sources: [s(file, start, end, symbol)] });

export const testRelations: Relation[] = [
  // ---- Backend integration --------------------------------------------------
  t(T_INT, EP.issue, 'issues a card, 201, and the ledger row count is unchanged', TI, 73, 89, 'issues a card, lists it, and writes NO ledger entry'),
  t(T_INT, EP.listCards, 'new card appears in the list; 401 without a session', TI, 84, 85, "get('/api/cards', customer.cookie)"),
  t(T_INT, EP.freeze, 'active → frozen; second freeze is 400 invalid_state', TI, 91, 107, 'freezes then unfreezes a card, and rejects an invalid transition'),
  t(T_INT, EP.unfreeze, 'frozen → active', TI, 104, 106, '/unfreeze'),
  t(T_INT, EP.report, 'old card lost, replacement active with replacesCardId and a different last4', TI, 109, 124, 'reports a card lost and issues a replacement'),
  t(T_INT, EP.addNotice, 'adds a notice (201, one notice on the card)', TI, 126, 144, 'adds and cancels a travel notice'),
  t(T_INT, EP.cancelNotice, 'cancels it (200, zero active notices)', TI, 141, 143, '/cancel'),
  t(T_INT, 'be:cards/cards#requireCardAccount', 'a joint customer gets 403 on an account they cannot access', TI, 146, 150, 'RBAC: a joint customer cannot manage cards'),
  t(T_INT, RISK_EP.dispute, 'files a dispute: entry disputed, request pending, pushed live', TI, 169, 183, 'files a dispute, flags the entry `disputed`'),
  t(T_INT, 'be:risk/disputes#upholdDispute', 'approve → entry reversed, settled total + amount, payload.reversed true', TI, 185, 207, 'operator UPHOLD reverses the disputed entry'),
  t(T_INT, 'be:risk/disputes#denyDispute', 'reject → entry posted again, resolution denied', TI, 209, 223, 'operator DENY restores the disputed entry to posted'),
  t(T_INT, 'be:risk/disputes#createDispute', '403 for another customer; 400 for a pending entry; 400 for a transfer leg', TI, 225, 250, 'rejects disputing an internal transfer leg'),
  t(T_INT, RISK_EP.alerts, 'lists at least the seeded alert with a merchant', TI, 260, 266, 'lists the customer’s pending fraud alerts'),
  t(T_INT, RISK_EP.respond, 'response recorded, request still pending, inbound event pushed; 403 for another customer', TI, 268, 283, 'without resolving the item'),
  t(T_INT, 'be:risk/fraud#confirmFraud', 'approve → entry reversed, settled total + amount, card frozen, payload.reversed true', TI, 285, 303, 'operator CONFIRM fraud reverses the suspicious entry and freezes the linked card'),
  t(T_INT, 'be:risk/fraud#dismissFraud', 'reject → settled total unchanged, resolution dismissed', TI, 305, 323, 'operator DISMISS leaves money untouched'),

  // ---- Shared cards ---------------------------------------------------------
  t(T_SC, 'sh:cards#isTerminalCardStatus', 'lost / stolen / replaced / cancelled are terminal', TC, 23, 29, 'marks lost/stolen/replaced/cancelled as terminal'),
  t(T_SC, 'sh:cards#canFreezeCard', 'only an active card freezes', TC, 31, 36, 'only freezes an active card'),
  t(T_SC, 'sh:cards#canUnfreezeCard', 'only a frozen card unfreezes', TC, 31, 36, 'canUnfreezeCard'),
  t(T_SC, 'sh:cards#canReportCard', 'active and frozen can be reported; lost cannot', TC, 38, 44, 'canReportCard'),
  t(T_SC, 'sh:cards#canAddTravelNotice', 'active yes, cancelled no', TC, 38, 44, 'canAddTravelNotice'),
  t(T_SC, 'sh:cards#maskedCardNumber', 'masks all but the last four', TC, 48, 50, 'masks all but the last four'),
  t(T_SC, 'sh:cards#formatCardExpiry', 'zero-pads MM/YY', TC, 51, 54, 'zero-pads MM/YY expiry'),
  t(T_SC, 'sh:cards#validateIssueCard', 'requires a valid type, defaults to visa, rejects unknown type / network', TC, 57, 71, "describe('validateIssueCard'"),
  t(T_SC, 'sh:cards#validateReportCard', 'accepts lost or stolen only', TC, 73, 79, "describe('validateReportCard'"),
  t(T_SC, 'sh:cards#validateTravelNotice', 'destination required, real dates, end not before start', TC, 81, 96, "describe('validateTravelNotice'"),

  // ---- Shared risk ----------------------------------------------------------
  t(T_SR, 'sh:risk#isFraudResponse', 'recognises exactly the two responses', TR, 18, 22, 'recognizes the two customer responses'),
  t(T_SR, 'sh:risk#asFraudPayload', 'parses known fields; garbage → {}', TR, 24, 36, 'parses a fraud payload tolerantly'),
  t(T_SR, 'sh:risk#validateDispute', 'requires entry id + known reason; trims details', TR, 40, 52, 'requires a ledger entry id and a known reason'),
  t(T_SR, 'sh:risk#asDisputePayload', 'null without a ledger entry id', TR, 54, 60, 'parses a dispute payload, requiring a ledger entry id'),
  t(T_SR, 'sh:operations#isRequestReversed', 'true only when payload.reversed === true', TR, 63, 70, 'isRequestReversed (R-03)'),

  // ---- End-to-end -----------------------------------------------------------
  t(T_E2E, EP.freeze, 'Freeze in the wallet → "Frozen" badge and an Unfreeze button', TE, 38, 50, 'a customer freezes a card in the wallet'),
  t(T_E2E, RISK_EP.dispute, 'Dispute → File dispute → "Disputed" badge on the row', TE, 52, 64, 'a customer disputes a posted transaction'),
  t(T_E2E, 'be:risk/fraud#confirmFraud', 'operator Approve on the seeded alert → "Approved" + "Reversed"', TE, 66, 86, 'an operator confirms the seeded fraud alert'),
  t(T_E2E, 'be:risk/disputes#upholdDispute', 'operator Approve on the seeded dispute → "Approved" + "Reversed"', TE, 88, 104, 'an operator upholds the seeded dispute'),
];
