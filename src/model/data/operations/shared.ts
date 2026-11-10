import type { Entity, Relation } from '../../types';
import { FILES, rel, src, sym } from './helpers';

const OPS = 'sh:operations';
const ONB = 'sh:onboarding';
const F = FILES.shOperations;
const G = FILES.shOnboarding;

// ---------------------------------------------------------------------------
// packages/shared/src/operations.ts
// ---------------------------------------------------------------------------

const operationsEntities: Entity[] = [
  {
    id: OPS,
    kind: 'module',
    name: 'operations.ts (shared)',
    parent: 'shared',
    summary:
      'The operations-queue rulebook shared by the backend and the console: the action set, the status transition rule, queue lanes, labels and every DTO / socket payload shape.',
    description:
      'Pure and dependency-free, so the request state machine is defined once and unit-tested without a database. The backend imports the predicates (`isOpsAction`, `canApplyAction`, `nextStatusForAction`, `isTerminalOpsStatus`) to validate and apply operator actions; the operations console imports the same predicates to decide which buttons to enable, plus the label maps and queue lanes for display.\n\nThe request TYPE and STATUS value lists themselves live in `types.ts` (`OPS_REQUEST_TYPES`, `OPS_REQUEST_STATUSES`) and are imported here, not re-exported.\n\nThe header comment still describes v0.5.0 ("an operator action never posts to the ledger"). Since v0.7.0 the backend service does post or fail linked ledger entries on approve / reject; this module itself stays free of money logic.',
    audience: {
      executive: 'The single rulebook for how staff requests move from pending to approved or rejected.',
      systems: 'Source-only TypeScript bundled into the backend and the operations SPA; no runtime of its own.',
    },
    tech: ['TypeScript'],
    tags: ['operations', 'validation', 'realtime', 'types'],
    aliases: ['ops contracts', 'operations DTOs', 'ops state machine'],
    sources: [src(F, 1, 20, 'Operations-simulator contracts', 'Header comment'), { file: F }],
  },
  sym(OPS, 'OPS_ACTIONS', 'constant', 'The four DECISION actions an operator can take on a request; this tuple drives the console action bar.', {
    description:
      'Exported with the derived type `OpsDecisionAction`. Every decision is allowed from any non-terminal status (`pending`, `on_hold`, `info_requested`) and from no terminal one — see `canApplyAction`. Where each one leads is `OPS_ACTION_RESULT`. `note` is deliberately not in this tuple so it never renders as a fifth decision button.',
    values: [
      { value: 'approve', meaning: 'Allowed from pending / on_hold / info_requested → `approved` (terminal). Triggers the per-type effect: post a movement, provision an account, uphold a dispute, confirm fraud.' },
      { value: 'reject', meaning: 'Allowed from pending / on_hold / info_requested → `rejected` (terminal). Per-type effect: fail a movement, reject an application, deny a dispute, dismiss a fraud alert.' },
      { value: 'hold', meaning: 'Allowed from pending / on_hold / info_requested → `on_hold` (still actionable). Workflow only; a linked ledger entry stays pending.' },
      { value: 'request_info', meaning: 'Allowed from pending / on_hold / info_requested → `info_requested` (still actionable). Also records a simulated outbound email.' },
    ],
    example: ['approve', 'reject', 'hold', 'request_info'],
    detail: 3,
    tags: ['operations', 'validation'],
    aliases: ['OpsDecisionAction', 'operator actions', 'approve reject hold request info'],
    sources: [src(F, 24, 31, 'export const OPS_ACTIONS')],
  }),
  sym(OPS, 'OPS_NOTE_ACTION', 'constant', "The non-decision action `'note'`: write an audit note without changing the request's status.", {
    description: 'Allowed at any time, including on an approved or rejected request, so an operator can annotate a decision afterwards. It posts nothing to the ledger.',
    values: [{ value: 'note', meaning: 'Audit note only; status and decision bookkeeping are untouched.' }],
    tags: ['operations', 'audit'],
    sources: [src(F, 33, 40, "export const OPS_NOTE_ACTION = 'note'")],
  }),
  sym(OPS, 'OpsAction', 'type', 'Any action the action endpoint accepts: one of the four decisions or `note`.', {
    signature: 'type OpsAction = OpsDecisionAction | typeof OPS_NOTE_ACTION',
    values: [{ value: 'approve' }, { value: 'reject' }, { value: 'hold' }, { value: 'request_info' }, { value: 'note' }],
    tags: ['operations'],
    sources: [src(F, 42, 43, 'export type OpsAction')],
  }),
  sym(OPS, 'isDecisionAction', 'function', 'Type guard: true for the four workflow decisions, false for `note`.', {
    signature: 'isDecisionAction(action: OpsAction): action is OpsDecisionAction',
    tags: ['operations', 'validation'],
    sources: [src(F, 45, 48, 'export function isDecisionAction')],
  }),
  sym(OPS, 'OPS_REQUEST_PRIORITIES', 'constant', 'Triage priority of a queue item (`OpsRequestPriority`).', {
    values: [
      { value: 'low' },
      { value: 'normal', meaning: 'Default for most intake paths.' },
      { value: 'high', meaning: 'Sorted first among actionable items; wires are queued as high.' },
    ],
    tags: ['operations'],
    aliases: ['OpsRequestPriority'],
    sources: [src(F, 50, 52, 'export const OPS_REQUEST_PRIORITIES')],
  }),
  sym(OPS, 'SIM_EVENT_CHANNELS', 'constant', 'Channels of a simulated external event (`SimEventChannel`). None of them reaches a real provider.', {
    values: [
      { value: 'sms', meaning: 'Default outcome `delivered`.' },
      { value: 'email', meaning: 'Default outcome `sent`. Used for every automatic notice (movement posted, application received, invitation sent…).' },
      { value: 'mfa', meaning: 'Default outcome `pending`.' },
      { value: 'identity', meaning: 'Default outcome `pending`. Used for onboarding identity checks.' },
    ],
    tags: ['operations', 'integration'],
    aliases: ['SimEventChannel'],
    sources: [src(F, 54, 60, 'export const SIM_EVENT_CHANNELS')],
  }),
  sym(OPS, 'SIM_EVENT_DIRECTIONS', 'constant', 'Direction of a simulated event relative to the bank (`SimEventDirection`).', {
    values: [{ value: 'outbound', meaning: 'Default for every channel.' }, { value: 'inbound' }],
    tags: ['operations', 'integration'],
    aliases: ['SimEventDirection'],
    sources: [src(F, 62, 64, 'export const SIM_EVENT_DIRECTIONS')],
  }),
  sym(OPS, 'SIM_EVENT_STATUSES', 'constant', 'Outcome recorded on a simulated event (`SimEventStatus`).', {
    values: [{ value: 'sent' }, { value: 'delivered' }, { value: 'failed' }, { value: 'pending' }, { value: 'approved' }, { value: 'rejected' }],
    tags: ['operations', 'integration'],
    aliases: ['SimEventStatus'],
    sources: [src(F, 66, 75, 'export const SIM_EVENT_STATUSES')],
  }),
  sym(OPS, 'OPS_ACTION_RESULT', 'constant', 'The status a request lands in after each decision — the transition table of the request state machine.', {
    fields: [
      { name: 'approve', type: "'approved'" },
      { name: 'reject', type: "'rejected'" },
      { name: 'hold', type: "'on_hold'" },
      { name: 'request_info', type: "'info_requested'" },
    ],
    example: { approve: 'approved', reject: 'rejected', hold: 'on_hold', request_info: 'info_requested' },
    detail: 3,
    tags: ['operations', 'validation'],
    sources: [src(F, 79, 85, 'export const OPS_ACTION_RESULT')],
  }),
  sym(OPS, 'nextStatusForAction', 'function', 'Returns the status an action leads to, or `null` for a `note` (no status change).', {
    signature: 'nextStatusForAction(action: OpsAction): OpsRequestStatus | null',
    description: 'A lookup in `OPS_ACTION_RESULT`. The target status does not depend on the current status; whether the action is allowed at all is `canApplyAction`.',
    tags: ['operations', 'validation'],
    sources: [src(F, 87, 93, 'export function nextStatusForAction')],
  }),
  sym(OPS, 'TERMINAL_OPS_STATUSES', 'constant', 'The two resolved statuses: `approved` and `rejected`. A request in either accepts no further decision.', {
    values: [{ value: 'approved' }, { value: 'rejected' }],
    tags: ['operations', 'validation'],
    aliases: ['terminal status', 'resolved'],
    sources: [src(F, 95, 101, 'export const TERMINAL_OPS_STATUSES')],
  }),
  sym(OPS, 'isTerminalOpsStatus', 'function', 'True when a status is `approved` or `rejected`.', {
    signature: 'isTerminalOpsStatus(status: OpsRequestStatus): boolean',
    description: 'Used by the backend to set `resolvedAt` and to sort resolved items last, and by the console to disable the action bar.',
    tags: ['operations', 'validation'],
    sources: [src(F, 103, 106, 'export function isTerminalOpsStatus')],
  }),
  sym(OPS, 'canApplyAction', 'function', 'Whether an action is allowed for a request in a given status: a note always, a decision only while the request is not terminal.', {
    signature: 'canApplyAction(status: OpsRequestStatus, action: OpsAction): boolean',
    description:
      'The single guard of the request state machine. It does not restrict which decision follows which: a held request can be approved, an info-requested one can be put on hold, and repeating the same decision (hold on an on_hold request) is also allowed.',
    detail: 3,
    tags: ['operations', 'validation'],
    sources: [src(F, 108, 116, 'export function canApplyAction')],
  }),
  sym(OPS, 'isOpsAction', 'function', 'Type guard used by the action endpoint: the value is one of the four decisions or `note`.', {
    signature: 'isOpsAction(value: unknown): value is OpsAction',
    tags: ['operations', 'validation'],
    sources: [src(F, 120, 125, 'export function isOpsAction')],
  }),
  sym(OPS, 'isSimEventChannel', 'function', 'Type guard used by the simulate-event endpoint: the value is sms, email, mfa or identity.', {
    signature: 'isSimEventChannel(value: unknown): value is SimEventChannel',
    tags: ['operations', 'validation'],
    sources: [src(F, 127, 129, 'export function isSimEventChannel')],
  }),
  sym(OPS, 'OPS_REQUEST_TYPE_LABELS', 'constant', 'Display label for each of the twelve request types.', {
    fields: [
      { name: 'onboarding', type: "'New account application'" },
      { name: 'identity_verification', type: "'Identity verification'" },
      { name: 'mfa', type: "'MFA challenge'" },
      { name: 'deposit', type: "'Deposit review'" },
      { name: 'ach', type: "'ACH transfer'" },
      { name: 'wire', type: "'Wire transfer'" },
      { name: 'bill_pay', type: "'Bill payment'" },
      { name: 'fraud_alert', type: "'Fraud alert'" },
      { name: 'dispute', type: "'Transaction dispute'" },
      { name: 'support_message', type: "'Support message'" },
      { name: 'password_reset', type: "'Password reset'" },
      { name: 'external_account_verification', type: "'External account verification'" },
    ],
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 133, 146, 'export const OPS_REQUEST_TYPE_LABELS')],
  }),
  sym(OPS, 'OPS_REQUEST_STATUS_LABELS', 'constant', 'Display label for each request status (Pending, Approved, Rejected, On hold, Info requested).', {
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 148, 154, 'export const OPS_REQUEST_STATUS_LABELS')],
  }),
  sym(OPS, 'OPS_ACTION_LABELS', 'constant', 'Button / history label for each action (Approve, Reject, Hold, Request info, Add note).', {
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 156, 162, 'export const OPS_ACTION_LABELS')],
  }),
  sym(OPS, 'OPS_PRIORITY_LABELS', 'constant', 'Display label for each priority (Low, Normal, High).', {
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 164, 168, 'export const OPS_PRIORITY_LABELS')],
  }),
  sym(OPS, 'SIM_EVENT_CHANNEL_LABELS', 'constant', 'Display label for each simulated-event channel (SMS, Email, MFA, Identity).', {
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 170, 175, 'export const SIM_EVENT_CHANNEL_LABELS')],
  }),
  sym(OPS, 'opsTypeLabel', 'function', 'Label for a request type, falling back to the raw value.', {
    signature: 'opsTypeLabel(type: OpsRequestType): string',
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 177, 179, 'export function opsTypeLabel')],
  }),
  sym(OPS, 'opsStatusLabel', 'function', 'Label for a request status, falling back to the raw value.', {
    signature: 'opsStatusLabel(status: OpsRequestStatus): string',
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 180, 182, 'export function opsStatusLabel')],
  }),
  sym(OPS, 'opsActionLabel', 'function', 'Label for an operator action, falling back to the raw value.', {
    signature: 'opsActionLabel(action: OpsAction): string',
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 183, 185, 'export function opsActionLabel')],
  }),
  sym(OPS, 'channelLabel', 'function', 'Label for a simulated-event channel, falling back to the raw value.', {
    signature: 'channelLabel(channel: SimEventChannel): string',
    detail: 5,
    tags: ['operations', 'ui'],
    sources: [src(F, 186, 188, 'export function channelLabel')],
  }),
  sym(OPS, 'OpsQueueDef', 'type', 'One queue lane: a key, a label and the request types that roll up into it.', {
    fields: [
      { name: 'key', type: 'string', required: true },
      { name: 'label', type: 'string', required: true },
      { name: 'types', type: 'OpsRequestType[]', required: true, typeRef: 'sh:types#OPS_REQUEST_TYPES' },
    ],
    tags: ['operations', 'ui'],
    sources: [src(F, 192, 196, 'export interface OpsQueueDef')],
  }),
  sym(OPS, 'OPS_QUEUES', 'constant', 'How the twelve request types are grouped into the four queue lanes the console filters by.', {
    description: 'A queue is a display grouping only: there is one `OperationsRequest` table and the lane is derived from `type` on the client. The backend never stores or filters by lane.',
    values: [
      { value: 'identity', meaning: 'Onboarding & identity — onboarding, identity_verification, mfa, password_reset, external_account_verification.' },
      { value: 'money', meaning: 'Deposits & transfers — deposit, ach, wire, bill_pay.' },
      { value: 'risk', meaning: 'Fraud & disputes — fraud_alert, dispute.' },
      { value: 'support', meaning: 'Support — support_message.' },
    ],
    detail: 3,
    tags: ['operations', 'ui'],
    aliases: ['queue lanes', 'queues'],
    sources: [src(F, 198, 211, 'export const OPS_QUEUES')],
  }),
  sym(OPS, 'queueForType', 'function', "Returns the lane key a request type belongs to, or `'other'` if unmapped.", {
    signature: 'queueForType(type: OpsRequestType): string',
    tags: ['operations', 'ui'],
    sources: [src(F, 213, 216, 'export function queueForType')],
  }),
  sym(OPS, 'OperationsRequestDTO', 'type', 'A queue work item as the API and the socket expose it to the operations console.', {
    description:
      'Produced only by `toOperationsRequestDTO` from an `OperationsRequest` row. `payload` is the row\'s JSON string column parsed into an object (or null); its shape depends on the request type — a `MovementPayload` for deposit / ach / wire / bill_pay, application context for onboarding, a fraud or dispute payload for those types. `lastActorId` and `lastActorRole` are stored on the row but not exposed.',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'type', type: 'OpsRequestType', required: true, typeRef: 'sh:types#OPS_REQUEST_TYPES' },
      { name: 'status', type: 'OpsRequestStatus', required: true, typeRef: 'sh:types#OPS_REQUEST_STATUSES', values: ['pending', 'approved', 'rejected', 'on_hold', 'info_requested'] },
      { name: 'priority', type: 'OpsRequestPriority', required: true, typeRef: 'sh:operations#OPS_REQUEST_PRIORITIES', values: ['low', 'normal', 'high'] },
      { name: 'summary', type: 'string', required: true },
      { name: 'detail', type: 'string | null', required: true },
      { name: 'subjectName', type: 'string | null', required: true, description: 'The customer or applicant concerned. Display only — not a foreign key (an applicant is not yet a User).' },
      { name: 'subjectEmail', type: 'string | null', required: true },
      { name: 'payload', type: 'Record<string, unknown> | null', required: true, description: 'Parsed JSON simulation context. For money movements it carries `ledgerEntryIds` (the soft link to the ledger) and, after a reversal, `reversed: true`.' },
      { name: 'lastAction', type: 'OpsAction | null', required: true, typeRef: 'sh:operations#OpsAction', description: 'The most recent DECISION; a note does not change it.' },
      { name: 'lastActorName', type: 'string | null', required: true },
      { name: 'lastActionNote', type: 'string | null', required: true },
      { name: 'createdAt', type: 'string (ISO)', required: true },
      { name: 'updatedAt', type: 'string (ISO)', required: true, description: 'The console compares this with the loaded detail to know when to refetch history.' },
      { name: 'resolvedAt', type: 'string (ISO) | null', required: true, description: 'Set when the item reaches approved or rejected.' },
    ],
    example: {
      id: 'req_billpay',
      type: 'bill_pay',
      status: 'pending',
      priority: 'normal',
      summary: 'Bill payment — City Power & Light ($120.00)',
      detail: "A bill payment of $120.00 from the customer's account is awaiting operator review (simulated). Approving posts it to the ledger; rejecting marks it failed.",
      subjectName: 'Avery Customer',
      subjectEmail: 'avery.customer@example.com',
      payload: { kind: 'bill_pay', amountMinor: 12000, direction: 'outbound', accountId: 'acc_checking', counterparty: 'City Power & Light', memo: null, ledgerEntryIds: ['le_003'], reference: 'MOV-4F9A2C' },
      lastAction: null,
      lastActorName: null,
      lastActionNote: null,
      createdAt: '2026-10-01T14:40:00.000Z',
      updatedAt: '2026-10-01T14:40:00.000Z',
      resolvedAt: null,
    },
    detail: 3,
    tags: ['operations', 'types', 'realtime'],
    aliases: ['queue item', 'ops request DTO', 'work item'],
    sources: [src(F, 220, 241, 'export interface OperationsRequestDTO')],
  }),
  sym(OPS, 'OperatorActionLogDTO', 'type', "One entry in a request's history, derived from an AuditLog row.", {
    fields: [
      { name: 'id', type: 'string', required: true, description: 'The AuditLog row id.' },
      { name: 'action', type: "OpsAction | 'created' | string", required: true, description: "The audit action with its `ops_` prefix stripped; the intake row `ops_request_created` becomes `'created'`." },
      { name: 'actorName', type: 'string | null', required: true, description: 'Read from the audit metadata (`actorName`), not joined from User.' },
      { name: 'actorRole', type: 'string | null', required: true },
      { name: 'note', type: 'string | null', required: true, description: 'The audit row\'s `reason`.' },
      { name: 'createdAt', type: 'string (ISO)', required: true },
    ],
    example: { id: 'aud_101', action: 'approve', actorName: 'Sam Operator', actorRole: 'ops_agent', note: null, createdAt: '2026-10-01T15:04:12.000Z' },
    tags: ['operations', 'audit', 'types'],
    sources: [src(F, 243, 252, 'export interface OperatorActionLogDTO')],
  }),
  sym(OPS, 'SimulatedEventDTO', 'type', 'A simulated external event (SMS, email, MFA or identity) as exposed to the console. Never a real message.', {
    description: 'Produced only by `toSimulatedEventDTO` from a `SimulatedEvent` row. The row\'s `metadata` column is not exposed.',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'channel', type: 'SimEventChannel', required: true, typeRef: 'sh:operations#SIM_EVENT_CHANNELS', values: ['sms', 'email', 'mfa', 'identity'] },
      { name: 'direction', type: 'SimEventDirection', required: true, typeRef: 'sh:operations#SIM_EVENT_DIRECTIONS', values: ['outbound', 'inbound'] },
      { name: 'kind', type: 'string | null', required: true, description: 'Free-form sub-kind, e.g. `otp`, `notification`, `movement_posted`, `invitation`.' },
      { name: 'status', type: 'SimEventStatus', required: true, typeRef: 'sh:operations#SIM_EVENT_STATUSES' },
      { name: 'summary', type: 'string', required: true },
      { name: 'detail', type: 'string | null', required: true, description: 'Always carries a "SIMULATION — …" disclaimer unless the caller supplies its own text.' },
      { name: 'requestId', type: 'string | null', required: true, description: 'The queue item that triggered it, if any.' },
      { name: 'createdAt', type: 'string (ISO)', required: true },
    ],
    example: {
      id: 'evt_201',
      channel: 'email',
      direction: 'outbound',
      kind: 'movement_posted',
      status: 'sent',
      summary: 'Bill payment posted — $120.00 (simulated)',
      detail: 'SIMULATION — no real money network or provider was contacted.',
      requestId: 'req_billpay',
      createdAt: '2026-10-01T15:00:00.000Z',
    },
    detail: 3,
    tags: ['operations', 'integration', 'types', 'realtime'],
    aliases: ['simulated event', 'external event'],
    sources: [src(F, 254, 265, 'export interface SimulatedEventDTO')],
  }),
  sym(OPS, 'OperationsRequestDetailDTO', 'type', 'A queue item plus its action history and the simulated events linked to it.', {
    fields: [
      { name: '…OperationsRequestDTO', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO', description: 'All fields of the queue item.' },
      { name: 'history', type: 'OperatorActionLogDTO[]', required: true, typeRef: 'sh:operations#OperatorActionLogDTO', description: 'Oldest first.' },
      { name: 'events', type: 'SimulatedEventDTO[]', required: true, typeRef: 'sh:operations#SimulatedEventDTO', description: 'Newest first.' },
    ],
    tags: ['operations', 'types'],
    sources: [src(F, 267, 271, 'export interface OperationsRequestDetailDTO')],
  }),
  sym(OPS, 'OpsStatusCounts', 'type', 'A count per request status, with every status key always present.', {
    signature: 'type OpsStatusCounts = Record<OpsRequestStatus, number>',
    example: { pending: 4, approved: 2, rejected: 1, on_hold: 1, info_requested: 0 },
    tags: ['operations', 'types'],
    sources: [src(F, 275, 276, 'export type OpsStatusCounts')],
  }),
  sym(OPS, 'OperationsQueueResponse', 'type', 'Success payload of GET /api/ops/requests: the (filtered) queue plus whole-queue status counts.', {
    fields: [
      { name: 'requests', type: 'OperationsRequestDTO[]', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
      { name: 'counts', type: 'OpsStatusCounts', required: true, typeRef: 'sh:operations#OpsStatusCounts' },
    ],
    tags: ['operations', 'types'],
    sources: [src(F, 278, 282, 'export interface OperationsQueueResponse')],
  }),
  sym(OPS, 'OperationsRequestDetailResponse', 'type', 'Success payload of GET /api/ops/requests/:id.', {
    fields: [{ name: 'request', type: 'OperationsRequestDetailDTO', required: true, typeRef: 'sh:operations#OperationsRequestDetailDTO' }],
    tags: ['operations', 'types'],
    sources: [src(F, 284, 287, 'export interface OperationsRequestDetailResponse')],
  }),
  sym(OPS, 'OperationsQueueQuery', 'type', 'Optional status / type filter for the queue list.', {
    fields: [
      { name: 'status', type: 'OpsRequestStatus', required: false, typeRef: 'sh:types#OPS_REQUEST_STATUSES' },
      { name: 'type', type: 'OpsRequestType', required: false, typeRef: 'sh:types#OPS_REQUEST_TYPES' },
    ],
    tags: ['operations', 'types'],
    sources: [src(F, 289, 293, 'export interface OperationsQueueQuery')],
  }),
  sym(OPS, 'OperatorActionRequest', 'type', 'Body of POST /api/ops/requests/:id/action.', {
    fields: [
      { name: 'action', type: 'OpsAction', required: true, typeRef: 'sh:operations#OpsAction', values: ['approve', 'reject', 'hold', 'request_info', 'note'] },
      { name: 'note', type: 'string', required: false, description: 'Optional context for a decision; mandatory text for `note`.' },
    ],
    example: { action: 'approve' },
    tags: ['operations', 'types'],
    sources: [src(F, 295, 299, 'export interface OperatorActionRequest')],
  }),
  sym(OPS, 'OperatorActionResponse', 'type', 'Success payload of the action endpoint: the updated queue item.', {
    fields: [{ name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' }],
    tags: ['operations', 'types'],
    sources: [src(F, 301, 304, 'export interface OperatorActionResponse')],
  }),
  sym(OPS, 'SimulateEventRequest', 'type', 'Body of POST /api/ops/simulate/event, and the input of `createSimulatedEvent`.', {
    fields: [
      { name: 'channel', type: 'SimEventChannel', required: true, typeRef: 'sh:operations#SIM_EVENT_CHANNELS', values: ['sms', 'email', 'mfa', 'identity'] },
      { name: 'kind', type: 'string', required: false, description: 'Sub-kind label such as `otp`, `notification`, `verification`.' },
      { name: 'requestId', type: 'string', required: false, description: 'Relate the event to a queue item; silently dropped if no such request exists.' },
      { name: 'outcome', type: 'SimEventStatus', required: false, typeRef: 'sh:operations#SIM_EVENT_STATUSES', description: 'Defaults per channel.' },
      { name: 'direction', type: 'SimEventDirection', required: false, typeRef: 'sh:operations#SIM_EVENT_DIRECTIONS', description: 'Defaults to outbound.' },
      { name: 'summary', type: 'string', required: false, description: 'Overrides the generated summary line.' },
    ],
    example: { channel: 'sms', kind: 'otp', outcome: 'delivered' },
    tags: ['operations', 'integration', 'types'],
    sources: [src(F, 306, 318, 'export interface SimulateEventRequest')],
  }),
  sym(OPS, 'SimulateEventResponse', 'type', 'Success payload of the simulate-event endpoint.', {
    fields: [{ name: 'event', type: 'SimulatedEventDTO', required: true, typeRef: 'sh:operations#SimulatedEventDTO' }],
    tags: ['operations', 'types'],
    sources: [src(F, 320, 323, 'export interface SimulateEventResponse')],
  }),
  sym(OPS, 'SimulatedEventsResponse', 'type', 'Success payload of GET /api/ops/events: recent simulated events, newest first.', {
    fields: [{ name: 'events', type: 'SimulatedEventDTO[]', required: true, typeRef: 'sh:operations#SimulatedEventDTO' }],
    tags: ['operations', 'types'],
    sources: [src(F, 325, 328, 'export interface SimulatedEventsResponse')],
  }),
  sym(OPS, 'OpsRequestChange', 'type', "Whether a pushed request is new or changed: `'created' | 'updated'`.", {
    values: [
      { value: 'created', meaning: 'Sent when a route queues a new request: an onboarding application, a reviewable money movement, a dispute, or a scheduled payment fired by a clock advance.' },
      { value: 'updated', meaning: 'Sent after an operator action or a movement reversal.' },
    ],
    tags: ['operations', 'realtime', 'types'],
    sources: [src(F, 332, 332, 'export type OpsRequestChange')],
  }),
  sym(OPS, 'OpsRequestChangedPayload', 'type', 'Payload of the `ops:request_changed` socket event: the change kind and the full queue item.', {
    fields: [
      { name: 'change', type: 'OpsRequestChange', required: true, typeRef: 'sh:operations#OpsRequestChange', values: ['created', 'updated'] },
      { name: 'request', type: 'OperationsRequestDTO', required: true, typeRef: 'sh:operations#OperationsRequestDTO' },
    ],
    description: 'Consoles upsert the request by id, so receiving the echo of your own action is harmless.',
    detail: 3,
    tags: ['operations', 'realtime', 'types'],
    sources: [src(F, 334, 338, 'export interface OpsRequestChangedPayload')],
  }),
  sym(OPS, 'OpsExternalEventPayload', 'type', 'Payload of the `ops:external_event` socket event: one simulated event.', {
    fields: [{ name: 'event', type: 'SimulatedEventDTO', required: true, typeRef: 'sh:operations#SimulatedEventDTO' }],
    detail: 3,
    tags: ['operations', 'realtime', 'types'],
    sources: [src(F, 340, 343, 'export interface OpsExternalEventPayload')],
  }),
  sym(OPS, 'isRequestReversed', 'function', "True when a request's payload carries `reversed: true` — its money effect was undone after approval.", {
    signature: 'isRequestReversed(payload: Record<string, unknown> | null | undefined): boolean',
    description:
      'A reversed movement, an upheld dispute and a confirmed fraud all leave the request in its terminal status and set `payload.reversed = true`. The console shows a secondary "Reversed" tag next to the status badge wherever this returns true, so a reversed item does not read only "Approved".',
    tags: ['operations', 'money', 'ui'],
    aliases: ['reversal tag', 'Reversed badge'],
    sources: [src(F, 345, 354, 'export function isRequestReversed')],
  }),
  sym(OPS, 'countRequestsByStatus', 'function', 'Tallies requests by status, always returning all five status keys (zero when absent).', {
    signature: "countRequestsByStatus(requests: readonly Pick<OperationsRequestDTO, 'status'>[]): OpsStatusCounts",
    description: 'Pure. The backend uses it for the queue and summary responses; the console recomputes the same counts from its live in-memory queue.',
    tags: ['operations'],
    sources: [src(F, 356, 370, 'export function countRequestsByStatus')],
  }),
];

// ---------------------------------------------------------------------------
// packages/shared/src/onboarding.ts
// ---------------------------------------------------------------------------

const onboardingEntities: Entity[] = [
  {
    id: ONB,
    kind: 'module',
    name: 'onboarding.ts (shared)',
    parent: 'shared',
    summary:
      'Shapes, limits and validators for account-opening applications, joint-owner invitations and admin-created users — the same functions run in the browser form and on the server.',
    description:
      'Dependency-free. `validateOpenAccount` is called by the customer open-account form before submitting and again by the backend route, so the field rules cannot drift. `validateInvitation` and `validateAdminCreateUser` do the same for their endpoints.\n\nNo DTO in this file carries a password hash, and the open-account response carries no internal ids — only the human reference.',
    audience: {
      executive: 'The rules for who can apply for an account and with how much opening deposit.',
    },
    tech: ['TypeScript'],
    tags: ['onboarding', 'validation', 'types'],
    aliases: ['onboarding contracts', 'open account validation'],
    sources: [src(G, 1, 19, 'Onboarding & account-opening contracts', 'Header comment'), { file: G }],
  },
  sym(ONB, 'ONBOARDING_PRODUCTS', 'constant', 'Products a public applicant can open through self-service onboarding (`OnboardingProduct`).', {
    description: 'A subset of the account types: credit cards, loans, CDs and external accounts are not self-serve.',
    values: [{ value: 'checking' }, { value: 'savings' }],
    tags: ['onboarding'],
    aliases: ['OnboardingProduct'],
    sources: [src(G, 23, 29, 'export const ONBOARDING_PRODUCTS')],
  }),
  sym(ONB, 'ONBOARDING_PRODUCT_LABELS', 'constant', 'The account name given to a newly opened account, per product.', {
    fields: [
      { name: 'checking', type: "'Everyday Checking'" },
      { name: 'savings', type: "'Goal Savings'" },
    ],
    description: 'Used as the provisioned `Account.name` and inside the queue item summary ("New account application — Everyday Checking").',
    tags: ['onboarding'],
    sources: [src(G, 31, 35, 'export const ONBOARDING_PRODUCT_LABELS')],
  }),
  sym(ONB, 'ONBOARDING_STATUSES', 'constant', 'Lifecycle of an account-opening application (`OnboardingStatus`).', {
    values: [
      { value: 'submitted', meaning: 'Received and waiting for an operator decision.' },
      { value: 'provisioned', meaning: 'Approved: the user, account and any funding now exist.' },
      { value: 'rejected', meaning: 'Declined by an operator; nothing was created.' },
    ],
    detail: 3,
    tags: ['onboarding'],
    aliases: ['OnboardingStatus'],
    sources: [src(G, 37, 39, 'export const ONBOARDING_STATUSES')],
  }),
  sym(ONB, 'INVITATION_STATUSES', 'constant', 'Lifecycle of a joint-owner invitation (`InvitationStatus`).', {
    values: [
      { value: 'pending', meaning: 'Sent; waiting for the invitee.' },
      { value: 'accepted', meaning: 'The invitee accepted and holds an AccountAccess grant.' },
      { value: 'declined', meaning: 'The invitee declined.' },
      { value: 'revoked', meaning: 'Declared in the type, but no code at this commit sets it.' },
    ],
    detail: 3,
    tags: ['onboarding', 'rbac'],
    aliases: ['InvitationStatus'],
    sources: [src(G, 41, 43, 'export const INVITATION_STATUSES')],
  }),
  sym(ONB, 'ONBOARDING_FUNDING', 'constant', 'Bounds on the simulated opening deposit, in integer minor units: 0 to 2,500,000 ($25,000.00).', {
    fields: [
      { name: 'minMinor', type: '0', description: 'An applicant may open with nothing and fund later.' },
      { name: 'maxMinor', type: '2500000', description: '$25,000.00.' },
    ],
    example: { minMinor: 0, maxMinor: 2500000 },
    tags: ['onboarding', 'money', 'validation'],
    sources: [src(G, 47, 54, 'export const ONBOARDING_FUNDING')],
  }),
  sym(ONB, 'ONBOARDING_PASSWORD', 'constant', 'New-applicant password length policy: 8 to 200 characters.', {
    fields: [
      { name: 'minLength', type: '8' },
      { name: 'maxLength', type: '200' },
    ],
    tags: ['onboarding', 'validation', 'security'],
    sources: [src(G, 56, 57, 'export const ONBOARDING_PASSWORD')],
  }),
  sym(ONB, 'ONBOARDING_TEXT', 'constant', 'Free-text length caps: names 80 characters, reasons 280.', {
    fields: [
      { name: 'nameMaxLength', type: '80' },
      { name: 'reasonMaxLength', type: '280' },
    ],
    tags: ['onboarding', 'validation'],
    sources: [src(G, 59, 60, 'export const ONBOARDING_TEXT')],
  }),
  sym(ONB, 'DEMO_DEFAULT_PASSWORD', 'constant', 'The documented, non-secret demo password given to admin-created users when the admin does not supply one.', {
    description: 'Simulation only. It is echoed back in the admin create response as `demoPassword` so the admin can share the demo credential.',
    tags: ['onboarding', 'security', 'public-demo'],
    sources: [src(G, 62, 67, 'export const DEMO_DEFAULT_PASSWORD')],
  }),
  sym(ONB, 'isLikelyEmail', 'function', 'A loose email check (something@something.tld, no whitespace) that also caps the length at 254 characters.', {
    signature: 'isLikelyEmail(value: unknown): value is string',
    tags: ['onboarding', 'validation'],
    sources: [src(G, 71, 81, 'export function isLikelyEmail')],
  }),
  sym(ONB, 'isOnboardingProduct', 'function', 'Type guard: the value is `checking` or `savings`.', {
    signature: 'isOnboardingProduct(value: unknown): value is OnboardingProduct',
    tags: ['onboarding', 'validation'],
    sources: [src(G, 83, 85, 'export function isOnboardingProduct')],
  }),
  sym(ONB, 'ValidationResult', 'type', 'What every validator in this module returns: an ok flag, a per-field error map and the normalized value when valid.', {
    signature: 'interface ValidationResult<T, K extends string>',
    fields: [
      { name: 'ok', type: 'boolean', required: true },
      { name: 'errors', type: 'Partial<Record<K, string>>', required: true, description: 'Field name → human message. The routes return this map as `fields` in a 400 body.' },
      { name: 'value', type: 'T', required: false, description: 'Present only when ok.' },
    ],
    tags: ['validation', 'types'],
    sources: [src(G, 87, 92, 'export interface ValidationResult')],
  }),
  sym(ONB, 'OpenAccountRequest', 'type', 'Raw open-account form input — the body of POST /api/onboarding/applications.', {
    fields: [
      { name: 'fullName', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'password', type: 'string', required: true },
      { name: 'product', type: 'OnboardingProduct | string', required: true, typeRef: 'sh:onboarding#ONBOARDING_PRODUCTS' },
      { name: 'initialFundingMinor', type: 'number', required: true, description: 'Opening deposit in integer cents.' },
      { name: 'consent', type: 'boolean', required: true },
      { name: 'jointInviteEmail', type: 'string | null', required: false, description: 'Invite a second person as joint owner once approved.' },
    ],
    example: {
      fullName: 'Pat Applicant',
      email: 'pat.applicant@example.com',
      password: '<chosen password, 8–200 chars>',
      product: 'checking',
      initialFundingMinor: 25000,
      consent: true,
      jointInviteEmail: null,
    },
    detail: 3,
    tags: ['onboarding', 'types'],
    sources: [src(G, 105, 115, 'export interface OpenAccountRequest')],
  }),
  sym(ONB, 'NormalizedOpenAccount', 'type', 'The trusted application the server acts on after validation: trimmed name, lower-cased emails, a known product.', {
    fields: [
      { name: 'fullName', type: 'string', required: true },
      { name: 'email', type: 'string', required: true, description: 'Trimmed and lower-cased.' },
      { name: 'password', type: 'string', required: true, description: 'Plain text in memory only; the service hashes it before anything is stored.' },
      { name: 'product', type: 'OnboardingProduct', required: true, typeRef: 'sh:onboarding#ONBOARDING_PRODUCTS' },
      { name: 'initialFundingMinor', type: 'number', required: true },
      { name: 'jointInviteEmail', type: 'string | null', required: true },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(G, 117, 125, 'export interface NormalizedOpenAccount')],
  }),
  sym(ONB, 'validateOpenAccount', 'function', 'Validates and normalizes an open-account application; the customer form and the backend route both call it.', {
    signature: 'validateOpenAccount(input: Partial<OpenAccountRequest>): ValidationResult<NormalizedOpenAccount, OpenAccountField>',
    description:
      'Rules, each producing a per-field message:\n• fullName — required after trim, at most 80 characters.\n• email — required, lower-cased, must pass `isLikelyEmail`.\n• password — 8 to 200 characters.\n• product — `checking` or `savings`.\n• initialFundingMinor — an integer between 0 and 2,500,000.\n• consent — must be exactly `true`.\n• jointInviteEmail — optional; if given it must be a valid email and differ from the applicant\'s own.\n\nIt does not check whether the email already belongs to a user; that is discovered when an operator tries to approve.',
    detail: 3,
    tags: ['onboarding', 'validation'],
    aliases: ['OpenAccountField', 'application validation'],
    sources: [src(G, 127, 191, 'export function validateOpenAccount'), src(G, 96, 103, 'export type OpenAccountField')],
  }),
  sym(ONB, 'OpenAccountResponse', 'type', 'Success payload of the application endpoint: the human reference, status, product and a message. No internal ids.', {
    fields: [
      { name: 'reference', type: 'string', required: true, description: '`MER-` + six hex characters.' },
      { name: 'status', type: 'OnboardingStatus', required: true, typeRef: 'sh:onboarding#ONBOARDING_STATUSES', description: "Always `'submitted'` on this response." },
      { name: 'product', type: 'OnboardingProduct', required: true, typeRef: 'sh:onboarding#ONBOARDING_PRODUCTS' },
      { name: 'message', type: 'string', required: true },
    ],
    example: {
      reference: 'MER-7C41D9',
      status: 'submitted',
      product: 'checking',
      message:
        'Your simulated application was received. A bank operator will review it; once approved, you can sign in with the email and password you chose. (SIMULATION — no real account, money, or identity check.)',
    },
    tags: ['onboarding', 'types'],
    sources: [src(G, 193, 200, 'export interface OpenAccountResponse')],
  }),
  sym(ONB, 'OnboardingApplicationSummary', 'type', 'Operator-facing view of an application: everything needed for a decision, never the password hash.', {
    fields: [
      { name: 'reference', type: 'string', required: true },
      { name: 'fullName', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'product', type: 'OnboardingProduct', required: true, typeRef: 'sh:onboarding#ONBOARDING_PRODUCTS' },
      { name: 'initialFundingMinor', type: 'number', required: true },
      { name: 'jointInviteEmail', type: 'string | null', required: true },
      { name: 'status', type: 'OnboardingStatus', required: true, typeRef: 'sh:onboarding#ONBOARDING_STATUSES' },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(G, 202, 214, 'export interface OnboardingApplicationSummary')],
  }),
  sym(ONB, 'AccountInvitationDTO', 'type', 'A joint-owner invitation as exposed to clients. The secret `token` column is not included.', {
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'accountId', type: 'string', required: true },
      { name: 'accountName', type: 'string | null', required: true },
      { name: 'inviteeEmail', type: 'string', required: true },
      { name: 'invitedByName', type: 'string | null', required: true },
      { name: 'relationship', type: 'AccountRelationship', required: true, values: ['joint', 'authorized'], description: 'The access level the invitee receives on acceptance.' },
      { name: 'status', type: 'InvitationStatus', required: true, typeRef: 'sh:onboarding#INVITATION_STATUSES' },
      { name: 'createdAt', type: 'string (ISO)', required: true },
      { name: 'respondedAt', type: 'string (ISO) | null', required: true },
    ],
    example: {
      id: 'inv_301',
      accountId: 'acc_savings',
      accountName: 'Goal Savings',
      inviteeEmail: 'jordan.joint@example.com',
      invitedByName: 'Avery Customer',
      relationship: 'joint',
      status: 'pending',
      createdAt: '2026-10-01T15:00:00.000Z',
      respondedAt: null,
    },
    detail: 3,
    tags: ['onboarding', 'rbac', 'types'],
    aliases: ['joint invitation', 'invitation DTO'],
    sources: [src(G, 218, 229, 'export interface AccountInvitationDTO')],
  }),
  sym(ONB, 'CreateInvitationRequest', 'type', 'Body of POST /api/accounts/:id/invitations.', {
    fields: [
      { name: 'inviteeEmail', type: 'string', required: true },
      { name: 'relationship', type: 'AccountRelationship', required: false, description: "Defaults to `joint`; only `'authorized'` is honoured as an alternative." },
    ],
    example: { inviteeEmail: 'jordan.joint@example.com' },
    tags: ['onboarding', 'types'],
    sources: [src(G, 231, 236, 'export interface CreateInvitationRequest')],
  }),
  sym(ONB, 'InvitationListResponse', 'type', 'Success payload of GET /api/invitations.', {
    fields: [{ name: 'invitations', type: 'AccountInvitationDTO[]', required: true, typeRef: 'sh:onboarding#AccountInvitationDTO' }],
    tags: ['onboarding', 'types'],
    sources: [src(G, 238, 240, 'export interface InvitationListResponse')],
  }),
  sym(ONB, 'InvitationActionResponse', 'type', 'Success payload of creating, accepting or declining an invitation.', {
    fields: [{ name: 'invitation', type: 'AccountInvitationDTO', required: true, typeRef: 'sh:onboarding#AccountInvitationDTO' }],
    tags: ['onboarding', 'types'],
    sources: [src(G, 242, 244, 'export interface InvitationActionResponse')],
  }),
  sym(ONB, 'validateInvitation', 'function', "Validates a joint invitation: a plausible email that is not the inviter's own; returns it lower-cased with the relationship.", {
    signature:
      "validateInvitation(input: Partial<CreateInvitationRequest>, inviterEmail: string): ValidationResult<{ inviteeEmail: string; relationship: AccountRelationship }, 'inviteeEmail'>",
    description: "The relationship is `'authorized'` only when the input says exactly that; anything else becomes `'joint'`.",
    tags: ['onboarding', 'validation'],
    sources: [src(G, 246, 261, 'export function validateInvitation')],
  }),
  sym(ONB, 'ADMIN_CREATABLE_ROLES', 'constant', 'Roles an admin may assign when creating a user: all four.', {
    values: [{ value: 'customer' }, { value: 'joint_customer' }, { value: 'ops_agent' }, { value: 'admin' }],
    tags: ['onboarding', 'rbac'],
    sources: [src(G, 274, 280, 'export const ADMIN_CREATABLE_ROLES')],
  }),
  sym(ONB, 'AdminCreateUserRequest', 'type', 'Body of POST /api/admin/users.', {
    fields: [
      { name: 'email', type: 'string', required: true },
      { name: 'displayName', type: 'string', required: true },
      { name: 'role', type: 'UserRole', required: false, description: 'Defaults to `customer`.' },
      { name: 'product', type: 'OnboardingProduct | string | null', required: false, description: 'Optionally open an account for the new user.' },
      { name: 'initialFundingMinor', type: 'number', required: false, description: 'Requires `product` and `reason` when greater than zero.' },
      { name: 'reason', type: 'string | null', required: false, description: 'The audited admin-adjustment reason.' },
      { name: 'password', type: 'string | null', required: false, description: 'Optional non-secret demo password.' },
    ],
    example: { email: 'casey.demo@example.com', displayName: 'Casey Demo', product: 'savings', initialFundingMinor: 50000, reason: 'Opening balance for a demo account' },
    tags: ['onboarding', 'types'],
    sources: [src(G, 282, 295, 'export interface AdminCreateUserRequest')],
  }),
  sym(ONB, 'NormalizedAdminCreateUser', 'type', 'The validated admin create-user input the service acts on.', {
    fields: [
      { name: 'email', type: 'string', required: true },
      { name: 'displayName', type: 'string', required: true },
      { name: 'role', type: 'UserRole', required: true },
      { name: 'product', type: 'OnboardingProduct | null', required: true },
      { name: 'initialFundingMinor', type: 'number', required: true },
      { name: 'reason', type: 'string | null', required: true },
      { name: 'password', type: 'string', required: true },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(G, 297, 305, 'export interface NormalizedAdminCreateUser')],
  }),
  sym(ONB, 'validateAdminCreateUser', 'function', 'Validates an admin create-user request, enforcing that funding needs both an account and a reason.', {
    signature: 'validateAdminCreateUser(input: Partial<AdminCreateUserRequest>): ValidationResult<NormalizedAdminCreateUser, AdminCreateUserField>',
    description:
      'Rules:\n• email — required, valid, lower-cased.\n• displayName — required, at most 80 characters.\n• role — defaults to `customer`; must be one of `ADMIN_CREATABLE_ROLES`.\n• product — blank, or `checking` / `savings`.\n• initialFundingMinor — defaults to 0; a non-negative integer no greater than 2,500,000.\n• If funding > 0: `product` is required ("Open an account to fund") and `reason` is required ("audited adjustment").\n• password — a missing or shorter-than-8 value silently falls back to the demo default; longer than 200 is an error.',
    tags: ['onboarding', 'validation', 'audit'],
    aliases: ['AdminCreateUserField'],
    sources: [src(G, 307, 373, 'export function validateAdminCreateUser'), src(G, 265, 272, 'export type AdminCreateUserField')],
  }),
  sym(ONB, 'AdminCreatedUser', 'type', 'The user returned by admin create: id, email, name, role, status and creation time.', {
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'displayName', type: 'string', required: true },
      { name: 'role', type: 'UserRole', required: true },
      { name: 'status', type: 'string', required: true },
      { name: 'createdAt', type: 'string (ISO)', required: true },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(G, 375, 383, 'export interface AdminCreatedUser')],
  }),
  sym(ONB, 'AdminCreateUserResponse', 'type', 'Success payload of POST /api/admin/users: the user, the opened account (or null) and the demo password to share.', {
    fields: [
      { name: 'user', type: 'AdminCreatedUser', required: true, typeRef: 'sh:onboarding#AdminCreatedUser' },
      { name: 'account', type: '{ id: string; type: string; name: string } | null', required: true },
      { name: 'demoPassword', type: 'string', required: true, description: 'Non-secret simulation credential, echoed so the admin can pass it on.' },
    ],
    tags: ['onboarding', 'types'],
    sources: [src(G, 385, 390, 'export interface AdminCreateUserResponse')],
  }),
];

const relations: Relation[] = [
  rel(OPS, 'sh:types#OPS_REQUEST_STATUSES', 'imports', 'OPS_REQUEST_STATUSES, OpsRequestStatus, OpsRequestType', {
    summary: 'The request type and status value lists live in types.ts and are imported, not redefined.',
    sources: [src(F, 20, 20, "from './types'")],
  }),
  rel(`${OPS}#nextStatusForAction`, `${OPS}#OPS_ACTION_RESULT`, 'uses-type', 'OPS_ACTION_RESULT[action]', { sources: [src(F, 91, 93, 'OPS_ACTION_RESULT[action]')] }),
  rel(`${OPS}#nextStatusForAction`, `${OPS}#isDecisionAction`, 'calls', 'isDecisionAction(action)', { sources: [src(F, 91, 93, 'isDecisionAction(action)')] }),
  rel(`${OPS}#isTerminalOpsStatus`, `${OPS}#TERMINAL_OPS_STATUSES`, 'uses-type', 'TERMINAL_OPS_STATUSES.includes(status)', { sources: [src(F, 104, 106, 'TERMINAL_OPS_STATUSES.includes')] }),
  rel(`${OPS}#canApplyAction`, `${OPS}#isTerminalOpsStatus`, 'calls', '!isTerminalOpsStatus(status)', { sources: [src(F, 113, 116, 'isTerminalOpsStatus(status)')] }),
  rel(`${OPS}#canApplyAction`, `${OPS}#isDecisionAction`, 'calls', 'isDecisionAction(action)', { sources: [src(F, 113, 116, 'isDecisionAction(action)')] }),
  rel(`${OPS}#isOpsAction`, `${OPS}#OPS_ACTIONS`, 'uses-type', 'OPS_ACTIONS.includes(value)', { sources: [src(F, 120, 125, 'OPS_ACTIONS')] }),
  rel(`${OPS}#queueForType`, `${OPS}#OPS_QUEUES`, 'uses-type', 'OPS_QUEUES.find(...)', { sources: [src(F, 214, 216, 'OPS_QUEUES.find')] }),
  rel(`${OPS}#countRequestsByStatus`, 'sh:types#OPS_REQUEST_STATUSES', 'uses-type', 'OPS_REQUEST_STATUSES.map(s => [s, 0])', {
    summary: 'Seeds a zero for every status so the result always has all five keys.',
    sources: [src(F, 362, 370, 'OPS_REQUEST_STATUSES.map')],
  }),
  rel(`${OPS}#OpsRequestChangedPayload`, `${OPS}#OperationsRequestDTO`, 'uses-type', 'request: OperationsRequestDTO', { sources: [src(F, 335, 338, 'request: OperationsRequestDTO')] }),
  rel(`${OPS}#OpsExternalEventPayload`, `${OPS}#SimulatedEventDTO`, 'uses-type', 'event: SimulatedEventDTO', { sources: [src(F, 341, 343, 'event: SimulatedEventDTO')] }),
  rel(`${OPS}#OperationsRequestDetailDTO`, `${OPS}#OperationsRequestDTO`, 'extends', 'extends OperationsRequestDTO', { sources: [src(F, 268, 271, 'extends OperationsRequestDTO')] }),

  rel(`${ONB}#validateOpenAccount`, `${ONB}#OpenAccountRequest`, 'validates', 'Partial<OpenAccountRequest> → NormalizedOpenAccount', { sources: [src(G, 132, 134, 'Partial<OpenAccountRequest>')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#NormalizedOpenAccount`, 'uses-type', 'returns NormalizedOpenAccount', { sources: [src(G, 132, 134, 'NormalizedOpenAccount')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#isLikelyEmail`, 'calls', 'isLikelyEmail(email)', { sources: [src(G, 142, 144, 'isLikelyEmail(email)')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#isOnboardingProduct`, 'calls', 'isOnboardingProduct(input.product)', { sources: [src(G, 152, 152, 'isOnboardingProduct(input.product)')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#ONBOARDING_FUNDING`, 'uses-type', 'funding within [minMinor, maxMinor]', { sources: [src(G, 154, 159, 'ONBOARDING_FUNDING.maxMinor')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#ONBOARDING_PASSWORD`, 'uses-type', 'password length 8–200', { sources: [src(G, 146, 150, 'ONBOARDING_PASSWORD.minLength')] }),
  rel(`${ONB}#validateOpenAccount`, `${ONB}#ONBOARDING_TEXT`, 'uses-type', 'fullName ≤ nameMaxLength', { sources: [src(G, 137, 140, 'ONBOARDING_TEXT.nameMaxLength')] }),
  rel(`${ONB}#validateInvitation`, `${ONB}#CreateInvitationRequest`, 'validates', 'Partial<CreateInvitationRequest>', { sources: [src(G, 247, 250, 'Partial<CreateInvitationRequest>')] }),
  rel(`${ONB}#validateInvitation`, `${ONB}#isLikelyEmail`, 'calls', 'isLikelyEmail(email)', { sources: [src(G, 252, 256, 'isLikelyEmail(email)')] }),
  rel(`${ONB}#validateAdminCreateUser`, `${ONB}#AdminCreateUserRequest`, 'validates', 'Partial<AdminCreateUserRequest> → NormalizedAdminCreateUser', { sources: [src(G, 312, 314, 'Partial<AdminCreateUserRequest>')] }),
  rel(`${ONB}#validateAdminCreateUser`, `${ONB}#ADMIN_CREATABLE_ROLES`, 'uses-type', 'ADMIN_CREATABLE_ROLES.includes(role)', { sources: [src(G, 326, 329, 'ADMIN_CREATABLE_ROLES')] }),
  rel(`${ONB}#validateAdminCreateUser`, `${ONB}#ONBOARDING_FUNDING`, 'uses-type', 'funding ≤ maxMinor', { sources: [src(G, 337, 345, 'ONBOARDING_FUNDING.maxMinor')] }),
  rel(`${ONB}#validateAdminCreateUser`, `${ONB}#DEMO_DEFAULT_PASSWORD`, 'uses-type', 'password defaults to DEMO_DEFAULT_PASSWORD', { sources: [src(G, 357, 363, 'DEMO_DEFAULT_PASSWORD')] }),
  rel(`${ONB}#AccountInvitationDTO`, `${ONB}#INVITATION_STATUSES`, 'uses-type', 'status: InvitationStatus', { sources: [src(G, 219, 229, 'status: InvitationStatus')] }),
];

export const sharedEntities: Entity[] = [...operationsEntities, ...onboardingEntities];
export const sharedRelations: Relation[] = relations;
