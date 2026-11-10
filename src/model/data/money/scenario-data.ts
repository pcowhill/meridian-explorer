import type { ScenarioStep, StateEffect, StepKind } from '../../types';
import { IDS, NOW } from '../fixtures';

/**
 * Example values shared by the money scenarios. Everything here is consistent
 * with `fixtures.ts`: Avery's Everyday Checking starts at $2,451.10 current /
 * $2,331.10 available (a $120.00 bill payment is pending) and Goal Savings at
 * $5,000.00.
 */

export const CHK = IDS.checking;
export const SAV = IDS.savings;

/** The simulation clock's current time — what `simulationNow()` returns and what dates ledger rows. */
export const SIM_NOW = NOW;

/**
 * `AuditLog.createdAt` is not set by `writeAudit`, so it takes the column
 * default (the database's wall-clock now) rather than the simulated time.
 * The examples use a slightly different instant to make that visible.
 */
export const WALL_NOW = '2026-10-01T15:07:31.000Z';

export const AVERY = { id: IDS.avery, email: 'avery.customer@example.com', displayName: 'Avery Customer', role: 'customer' };
export const JORDAN = { id: IDS.jordan, email: 'jordan.joint@example.com', displayName: 'Jordan Joint', role: 'joint_customer' };
export const SAM = { id: IDS.sam, email: 'sam.operator@example.com', displayName: 'Sam Operator', role: 'ops_agent' };

/** Request headers as the customer app sends them on a mutating call. */
export const HEADERS_OK: Record<string, string> = {
  Cookie: 'mer_session=<session token>; mer_csrf=<csrf token>',
  'x-meridian-csrf': '<csrf token>',
  'Content-Type': 'application/json',
};

/** A request that rides the session cookie but cannot supply the CSRF header. */
export const HEADERS_NO_CSRF: Record<string, string> = {
  Cookie: 'mer_session=<session token>; mer_csrf=<csrf token>',
  'Content-Type': 'application/json',
};

/** A request from a browser whose session cookie is gone. */
export const HEADERS_NO_SESSION: Record<string, string> = {
  Cookie: 'mer_csrf=<csrf token>',
  'x-meridian-csrf': '<csrf token>',
  'Content-Type': 'application/json',
};

export interface BalancesExample {
  currentMinor: number;
  availableMinor: number;
  pendingCreditMinor: number;
  pendingDebitMinor: number;
  heldMinor: number;
}

export const bal = (currentMinor: number, availableMinor: number, pendingCreditMinor = 0, pendingDebitMinor = 0, heldMinor = 0): BalancesExample => ({
  currentMinor,
  availableMinor,
  pendingCreditMinor,
  pendingDebitMinor,
  heldMinor,
});

/** An `AccountSummary` example for one of Avery's two accounts. */
export function summaryOf(account: 'checking' | 'savings', balances: BalancesExample, relationship = 'owner') {
  return account === 'checking'
    ? { id: CHK, name: 'Everyday Checking', type: 'checking', status: 'active', currency: 'USD', relationship, balances }
    : { id: SAV, name: 'Goal Savings', type: 'savings', status: 'active', currency: 'USD', relationship, balances };
}

/** The three ledger columns `deriveBalances` reads, for the baseline checking entries. */
export const CHECKING_ENTRIES_LIKE = [
  { amountMinor: 250000, direction: 'credit', status: 'posted' },
  { amountMinor: 4890, direction: 'debit', status: 'posted' },
  { amountMinor: 12000, direction: 'debit', status: 'pending' },
];

/** A full `LedgerEntry` row as Prisma writes it (reason is only set for admin adjustments). */
export function ledgerRow(row: {
  id: string;
  accountId: string;
  amountMinor: number;
  direction: 'credit' | 'debit';
  status: string;
  origin: string;
  description: string;
  postedAt: string | null;
  createdAt?: string;
}): Record<string, unknown> {
  return { reason: null, createdAt: SIM_NOW, ...row };
}

/** A full `AuditLog` row as `writeAudit` writes it (metadata is a JSON string). */
export function auditRow(row: { id: string; actor: { id: string; role: string }; action: string; entity: string; entityId: string; reason: string | null; metadata: Record<string, unknown> }): Record<string, unknown> {
  return {
    id: row.id,
    actorId: row.actor.id,
    actorRole: row.actor.role,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    reason: row.reason,
    metadata: JSON.stringify(row.metadata),
    createdAt: WALL_NOW,
  };
}

/** The `MovementPayload` JSON and the four rows `createExternalMovement` writes for one movement. */
export function movementRows(m: {
  entryId: string;
  requestId: string;
  auditId: string;
  eventId: string;
  kind: 'bill_pay' | 'mobile_check_deposit' | 'wire' | 'external_ach';
  opsType: 'bill_pay' | 'deposit' | 'wire' | 'ach';
  label: string;
  amountMinor: number;
  amountText: string;
  direction: 'inbound' | 'outbound';
  counterparty: string | null;
  description: string;
  reference: string;
  accountId?: string;
}) {
  const accountId = m.accountId ?? CHK;
  const who = m.counterparty ? ` — ${m.counterparty}` : '';
  const summary = `${m.label}${who} (${m.amountText})`;
  const payload = {
    kind: m.kind,
    amountMinor: m.amountMinor,
    direction: m.direction,
    accountId,
    counterparty: m.counterparty,
    memo: null,
    ledgerEntryIds: [m.entryId],
    reference: m.reference,
  };
  const entry = ledgerRow({
    id: m.entryId,
    accountId,
    amountMinor: m.amountMinor,
    direction: m.direction === 'inbound' ? 'credit' : 'debit',
    status: 'pending',
    origin: m.direction === 'inbound' ? 'deposit' : 'payment',
    description: m.description,
    postedAt: null,
  });
  const request: Record<string, unknown> = {
    id: m.requestId,
    type: m.opsType,
    status: 'pending',
    priority: m.kind === 'wire' ? 'high' : 'normal',
    summary,
    detail: `A ${m.label.toLowerCase()} of ${m.amountText} ${m.direction === 'inbound' ? 'into' : 'from'} the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.`,
    subjectName: AVERY.displayName,
    subjectEmail: AVERY.email,
    payload: JSON.stringify(payload),
    lastAction: null,
    lastActorId: null,
    lastActorRole: null,
    lastActorName: null,
    lastActionNote: null,
    resolvedAt: null,
    createdAt: SIM_NOW,
    updatedAt: SIM_NOW,
  };
  const audit = auditRow({
    id: m.auditId,
    actor: AVERY,
    action: 'ops_request_created',
    entity: 'operations_request',
    entityId: m.requestId,
    reason: `${summary} — submitted by ${AVERY.displayName} (simulated)`,
    metadata: { reference: m.reference, kind: m.kind, ledgerEntryId: m.entryId },
  });
  const event: Record<string, unknown> = {
    id: m.eventId,
    channel: 'email',
    direction: 'outbound',
    kind: 'movement_received',
    status: 'sent',
    summary: `${m.label} received — under review (simulated)`,
    detail: `Simulated confirmation that ${m.reference} (${m.amountText}) was received and is awaiting operator review.`,
    requestId: m.requestId,
    metadata: null,
    createdAt: SIM_NOW,
  };
  return { payload, entry, request, audit, event, summary };
}

/** The DTO form of an OperationsRequest row (payload parsed, as `toOperationsRequestDTO` returns it). */
export function requestDTO(request: Record<string, unknown>, payload: Record<string, unknown>): Record<string, unknown> {
  const { lastActorId: _a, lastActorRole: _b, ...rest } = request;
  void _a;
  void _b;
  return { ...rest, payload };
}

/** The DTO form of a SimulatedEvent row (no metadata column, as `toSimulatedEventDTO` returns it). */
export function eventDTO(event: Record<string, unknown>): Record<string, unknown> {
  const { metadata: _m, ...rest } = event;
  void _m;
  return rest;
}

/**
 * Setup for the "limit reached" stories: Avery already has `count` $1.00 mobile
 * check deposits awaiting review — a pending operations request plus its
 * pending credit entry each (pending credits do not change any balance).
 */
export function pendingBacklog(count: number): StateEffect[] {
  const effects: StateEffect[] = [];
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, '0');
    const rows = movementRows({
      entryId: `le_b${n}`,
      requestId: `req_b${n}`,
      auditId: `aud_b${n}`,
      eventId: `evt_b${n}`,
      kind: 'mobile_check_deposit',
      opsType: 'deposit',
      label: 'Mobile check deposit',
      amountMinor: 100,
      amountText: '$1.00',
      direction: 'inbound',
      counterparty: null,
      description: 'Mobile check deposit',
      reference: `MOV-B000${n}`,
    });
    effects.push({ op: 'insert', table: 'LedgerEntry', row: rows.entry });
    effects.push({ op: 'insert', table: 'OperationsRequest', row: rows.request });
  }
  return effects;
}

/** Terse step constructor: `step(id, kind, from, to, title, label, narrative, extra)`. */
export function step(
  id: string,
  kind: StepKind,
  from: string,
  to: string,
  title: string,
  label: string,
  narrative: string,
  extra: Omit<Partial<ScenarioStep>, 'id' | 'kind' | 'from' | 'to' | 'title' | 'label' | 'narrative'> = {},
): ScenarioStep {
  return { id, kind, from, to, title, label, narrative, ...extra };
}
