import type { WorldState } from '../types';

/**
 * Canonical EXAMPLE database rows used by scenarios, data widgets and the
 * balance calculator. They are modelled on Meridian's seeded demo personas
 * (`apps/backend/src/seed-plan.ts`) but are illustrative: ids are shortened and
 * the ledger is trimmed to a handful of rows so every balance can be checked
 * by hand. All money is integer minor units (cents), exactly as Meridian stores it.
 *
 * Scenario authors: spread `baseState()` into `initialState` and add/override
 * rows — do not invent parallel personas.
 */

export const IDS = {
  avery: 'usr_avery',
  jordan: 'usr_jordan',
  sam: 'usr_sam',
  riley: 'usr_riley',
  checking: 'acc_checking',
  savings: 'acc_savings',
  debitCard: 'card_debit',
} as const;

export const NOW = '2026-10-01T15:00:00.000Z';

/** A fresh copy of the baseline example database. */
export function baseState(): WorldState {
  return {
    User: [
      { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer', status: 'active' },
      { id: IDS.jordan, email: 'jordan.joint@example.com', displayName: 'Jordan Joint', role: 'joint_customer', status: 'active' },
      { id: IDS.sam, email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent', status: 'active' },
      { id: IDS.riley, email: 'riley.admin@example.com', displayName: 'Riley Admin', role: 'admin', status: 'active' },
    ],
    Account: [
      { id: IDS.checking, userId: IDS.avery, type: 'checking', name: 'Everyday Checking', currency: 'USD', status: 'active' },
      { id: IDS.savings, userId: IDS.avery, type: 'savings', name: 'Goal Savings', currency: 'USD', status: 'active' },
    ],
    AccountAccess: [
      { id: 'acs_1', userId: IDS.avery, accountId: IDS.checking, relationship: 'owner' },
      { id: 'acs_2', userId: IDS.avery, accountId: IDS.savings, relationship: 'owner' },
      { id: 'acs_3', userId: IDS.jordan, accountId: IDS.checking, relationship: 'joint' },
    ],
    LedgerEntry: [
      { id: 'le_001', accountId: IDS.checking, amountMinor: 250000, direction: 'credit', status: 'posted', origin: 'seed', description: 'Opening deposit', postedAt: '2026-08-01T12:00:00.000Z' },
      { id: 'le_002', accountId: IDS.checking, amountMinor: 4890, direction: 'debit', status: 'posted', origin: 'card', description: 'QuickFuel', postedAt: '2026-09-09T12:00:00.000Z' },
      { id: 'le_003', accountId: IDS.checking, amountMinor: 12000, direction: 'debit', status: 'pending', origin: 'payment', description: 'Bill payment — City Power & Light', postedAt: null },
      { id: 'le_004', accountId: IDS.savings, amountMinor: 500000, direction: 'credit', status: 'posted', origin: 'seed', description: 'Opening deposit', postedAt: '2026-08-01T12:00:00.000Z' },
    ],
    Card: [
      { id: IDS.debitCard, accountId: IDS.checking, userId: IDS.avery, cardType: 'debit', network: 'visa', last4: '4821', status: 'active' },
    ],
    SimulationClock: [{ id: 'singleton', currentTime: NOW, speed: 1 }],
    OperationsRequest: [],
    SimulatedEvent: [],
    AuditLog: [],
    PaymentSchedule: [],
    LendingProduct: [],
    Session: [],
    LoginEvent: [],
  };
}
