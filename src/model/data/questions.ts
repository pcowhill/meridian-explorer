import type { GuidedQuestion } from '../types';

/**
 * The representative questions the explorer is built to answer. Each one has a
 * prepared starting point in every mode, so the same question can be explored
 * spatially (Atlas), over time (Theater) and by construction (Studio).
 */
export const GUIDED_QUESTIONS: GuidedQuestion[] = [
  {
    id: 'q-transfer',
    question: 'What happens when a customer transfers money?',
    blurb: 'From the Move Money page through validation and the money service to two ledger entries that net to zero.',
    atlas: { select: 'be:money/movements#createTransfer', expand: ['meridian', 'customer', 'cu.portal', 'backend', 'be.http', 'be:routes/money', 'be.money', 'be:money/movements', 'db'] },
    theater: { scenario: 'transfer' },
    studio: { title: 'Money transfer path', entities: ['cu:pages/MoveMoney', 'cu:lib/money', 'ep:POST /api/transfers', 'sh:money-movement#validateTransfer', 'be:money/movements#createTransfer', 'sh:ledger#deriveBalances', 'db:LedgerEntry', 'db:AuditLog'] },
  },
  {
    id: 'q-approval',
    question: 'How does an operations employee approve a pending transaction?',
    blurb: 'The request queue, the operator action, and how approval flips a pending ledger entry to posted.',
    atlas: { select: 'be:ops/requests#applyOperatorAction', expand: ['meridian', 'operations', 'op.console', 'backend', 'be.http', 'be:routes/ops', 'be.ops', 'be:ops/requests', 'be.money', 'be:money/movements', 'db'] },
    theater: { scenario: 'ops-approval' },
    studio: { title: 'Operator approval', entities: ['role:ops_agent', 'op:pages/RequestQueues', 'op:components/RequestDetailPanel', 'ep:POST /api/ops/requests/:id/action', 'be:ops/requests#applyOperatorAction', 'be:money/movements#postApprovedMovement', 'db:OperationsRequest', 'db:LedgerEntry', 'ev:ops:request_changed'] },
  },
  {
    id: 'q-balances',
    question: 'How are account balances calculated?',
    blurb: 'Balances are never stored: current and available are derived from ledger entries by status.',
    atlas: { select: 'sh:ledger#deriveBalances', expand: ['meridian', 'shared', 'sh:ledger', 'db', 'backend', 'be.http', 'be:routes/accounts'] },
    theater: { scenario: 'account-balances' },
    studio: { title: 'Balance derivation', entities: ['db:Account', 'db:LedgerEntry', 'sh:ledger#deriveBalances', 'sh:ledger#DerivedBalances', 'ep:GET /api/accounts', 'cu:pages/Dashboard'] },
  },
  {
    id: 'q-clock',
    question: 'What happens when the simulation clock advances?',
    blurb: 'Advancing simulated time fires due scheduled payments and accrues interest.',
    atlas: { select: 'ep:POST /api/ops/clock/advance', expand: ['meridian', 'operations', 'op.console', 'backend', 'be.http', 'be:routes/clock', 'be.clock', 'be.lending', 'db'] },
    theater: { scenario: 'clock-advance' },
    studio: { title: 'Clock advance', entities: ['op:pages/SimulationClock', 'ep:POST /api/ops/clock/advance', 'be:clock/clock', 'be:scheduler/scheduler', 'be:lending/accrual', 'db:SimulationClock', 'db:PaymentSchedule', 'db:LedgerEntry'] },
  },
  {
    id: 'q-fraud',
    question: 'How does a fraud alert affect a customer’s card?',
    blurb: 'Confirming fraud reverses the suspicious charge and freezes the linked card.',
    atlas: { select: 'be:risk/fraud', expand: ['meridian', 'backend', 'be.risk', 'be:risk/fraud', 'be.cards', 'be.ops', 'db'] },
    theater: { scenario: 'fraud-alert' },
    studio: { title: 'Fraud alert → card', entities: ['cu:pages/Dashboard', 'ep:POST /api/fraud-alerts/:id/respond', 'be:risk/fraud', 'be:ops/requests#applyOperatorAction', 'be:money/movements#reverseLedgerEntries', 'db:OperationsRequest', 'db:LedgerEntry', 'db:Card'] },
  },
  {
    id: 'q-communication',
    question: 'How do the customer app, operations simulator and backend communicate?',
    blurb: 'HTTP with cookie sessions for everything; Socket.IO pushes live updates to staff only.',
    atlas: { select: 'backend', expand: ['meridian', 'backend', 'be.realtime'] },
    theater: { scenario: 'app-communication' },
    studio: { title: 'How the apps talk', entities: ['customer', 'operations', 'backend', 'be.realtime', 'ev:ops:request_changed', 'ev:sim:heartbeat', 'db'] },
  },
  {
    id: 'q-validation',
    question: 'How does transaction validation work?',
    blurb: 'Layered checks: client, CSRF, session, rate limit, shared validator, account access, funds.',
    atlas: { select: 'sh:money-movement#validateTransfer', expand: ['meridian', 'shared', 'sh:money-movement', 'backend', 'be.http', 'be:routes/money', 'be.auth', 'be.abuse', 'be.money'] },
    theater: { scenario: 'transaction-validation' },
    studio: { title: 'Validation layers', entities: ['cu:pages/MoveMoney', 'be:auth/csrf#csrfHook', 'be:auth/guards#requireAuth', 'be:abuse/rate-limit#rateLimit', 'ep:POST /api/transfers', 'sh:money-movement#validateTransfer', 'be:auth/access#getAccountRelationship', 'be:money/movements#createTransfer'] },
  },
  {
    id: 'q-integration',
    question: 'How could a new external payment service integrate with Meridian?',
    blurb: 'Find the existing seams, then sketch a hypothetical PayPal-like service against them.',
    atlas: { select: 'ep:POST /api/movements', expand: ['meridian', 'backend', 'be.http', 'be:routes/money', 'be.money', 'be.ops'] },
    theater: { scenario: 'external-movement' },
    studio: { title: 'External payment integration', entities: ['boundary:external', 'ep:POST /api/movements', 'sh:money-movement#validateExternalMovement', 'be:money/movements#createExternalMovement', 'db:LedgerEntry', 'db:OperationsRequest', 'be:ops/requests#applyOperatorAction', 'operations'] },
  },
];
