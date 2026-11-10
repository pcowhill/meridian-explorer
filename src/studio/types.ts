/**
 * Explanation Studio — node and edge data shapes.
 *
 * The workspace stores boards as generic envelopes (`StudioNode` / `StudioEdge`
 * in state/workspace.ts); this file defines what the Studio puts in `data` for
 * each node/edge type. React Flow nodes in the live editor are the same objects
 * plus React Flow's own bookkeeping (selected, measured, draggable…).
 */
import type { Edge, Node } from '@xyflow/react';
import type { LedgerRow, RelationChannel, ScenarioStep, SourceRef } from '@/model';

export const NODE_TYPES = [
  'entity',
  'shape',
  'text',
  'note',
  'callout',
  'frame',
  'code',
  'json',
  'table',
  'class',
  'contract',
  'sequence',
  'state',
  'timeline',
  'compare',
  'transform',
  'balance',
] as const;
export type StudioNodeType = (typeof NODE_TYPES)[number];

/** Small palette of colour tokens; each maps to a design-token variable so it works in both themes. */
export type ColorToken = 'default' | 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'purple' | 'teal' | 'pink';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextSize = 'sm' | 'md' | 'lg' | 'xl';

export interface NodeStyle {
  fill?: ColorToken | 'none';
  stroke?: ColorToken;
  strokeStyle?: StrokeStyle;
  textSize?: TextSize;
}

/** Fields every node may carry. */
export interface BaseData {
  [key: string]: unknown;
  label?: string;
  style?: NodeStyle;
  locked?: boolean;
  /** Mark a free element as proposed / hypothetical (dashed purple). */
  proposed?: boolean;
}

export interface EntityData extends BaseData {
  entityId: string;
  /** Optional presenter caption shown under the summary. */
  caption?: string;
}

export type ShapeKind = 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'cylinder' | 'actor' | 'cloud';
export interface ShapeData extends BaseData {
  shape: ShapeKind;
}

export type CalloutPointer = 'left' | 'right' | 'top' | 'bottom';
export interface CalloutData extends BaseData {
  pointer: CalloutPointer;
}

export interface CodeData extends BaseData {
  /** Bound excerpt (from the model's SourceRefs) … */
  source?: SourceRef;
  entityId?: string;
  /** … or free-form code typed by the presenter. */
  code?: string;
  language: string;
  /** Highlighted lines, e.g. `3-5, 9` (absolute line numbers for bound excerpts). */
  highlight?: string;
}

export type JsonOrigin =
  | { kind: 'entity'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'response'; id: string; status: number }
  | { kind: 'payload'; scenarioId: string; stepId: string }
  | { kind: 'free' };

export interface JsonData extends BaseData {
  /** The JSON text (always valid JSON — invalid edits are rejected). */
  json: string;
  origin: JsonOrigin;
  highlight?: string[];
  hidden?: string[];
  typeRef?: string;
}

export interface TableData extends BaseData {
  entityId: string;
  view: 'columns' | 'rows';
}

export interface ClassData extends BaseData {
  entityId?: string;
  /** Free-form members, one per line: `name: type` for fields, `name(args): ret` for methods. */
  members?: string;
}

export interface ContractData extends BaseData {
  contractId: string;
  expanded?: boolean;
}

export interface SequenceData extends BaseData {
  scenarioId?: string;
  variant?: string;
  /** Endpoint id: a trace assembled from the contract's flow. */
  traceEndpoint?: string;
  /** Built from a chain of board nodes. */
  custom?: { participants: string[]; steps: ScenarioStep[] };
  step?: number;
}

export interface StateData extends BaseData {
  machineId: string;
  current?: string | null;
}

export interface TimelineItem {
  id: string;
  label: string;
  note?: string;
}
export interface TimelineData extends BaseData {
  items: TimelineItem[];
}

export interface CompareData extends BaseData {
  format: 'json' | 'text';
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}

export interface TransformData extends BaseData {
  format: 'json' | 'text';
  input: string;
  output: string;
  /** Function name shown in the middle pane; optionally bound to a model function. */
  fn: string;
  entityId?: string;
}

export interface BalanceData extends BaseData {
  entries?: LedgerRow[];
}

export type AnyNodeData =
  | EntityData
  | ShapeData
  | CalloutData
  | CodeData
  | JsonData
  | TableData
  | ClassData
  | ContractData
  | SequenceData
  | StateData
  | TimelineData
  | CompareData
  | TransformData
  | BalanceData
  | BaseData;

export type ArrowMode = 'end' | 'start' | 'both' | 'none';
export type Routing = 'straight' | 'curved' | 'step';

export interface EdgeData {
  [key: string]: unknown;
  label?: string;
  strokeStyle?: StrokeStyle;
  /** Explicit colour; when unset the channel colour (or neutral) is used. */
  color?: ColorToken;
  arrow?: ArrowMode;
  routing?: Routing;
  animated?: boolean;
  /** Number badge (sequence order). */
  order?: number;
  /** Model relations this edge stands for. */
  relationIds?: string[];
  channel?: RelationChannel;
  /** Marked proposed / hypothetical by the user or the request that created it. */
  proposed?: boolean;
}

export type SNode = Node<AnyNodeData, StudioNodeType>;
export type SEdge = Edge<EdgeData, 'studio'>;

/** Default box size per node type. */
export const DEFAULT_SIZE: Record<StudioNodeType, { w: number; h: number }> = {
  entity: { w: 232, h: 92 },
  shape: { w: 160, h: 96 },
  text: { w: 240, h: 44 },
  note: { w: 190, h: 150 },
  callout: { w: 210, h: 84 },
  frame: { w: 520, h: 340 },
  code: { w: 520, h: 320 },
  json: { w: 340, h: 300 },
  table: { w: 460, h: 280 },
  class: { w: 260, h: 230 },
  contract: { w: 380, h: 340 },
  sequence: { w: 680, h: 440 },
  state: { w: 640, h: 400 },
  timeline: { w: 300, h: 280 },
  compare: { w: 620, h: 320 },
  transform: { w: 760, h: 280 },
  balance: { w: 560, h: 420 },
};

export const NODE_TYPE_LABEL: Record<StudioNodeType, string> = {
  entity: 'Meridian component',
  shape: 'Shape',
  text: 'Text',
  note: 'Sticky note',
  callout: 'Callout',
  frame: 'Frame',
  code: 'Code',
  json: 'JSON',
  table: 'Database table',
  class: 'Class / type',
  contract: 'Endpoint contract',
  sequence: 'Sequence diagram',
  state: 'State machine',
  timeline: 'Timeline',
  compare: 'Before / after',
  transform: 'Transformation',
  balance: 'Balance calculator',
};

/** Node types whose label is edited inline. */
export const LABELLED: ReadonlySet<StudioNodeType> = new Set(['shape', 'text', 'note', 'callout', 'frame', 'entity', 'timeline', 'code', 'json', 'compare', 'transform', 'class']);
