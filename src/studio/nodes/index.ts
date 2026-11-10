import type { NodeTypes } from '@xyflow/react';
import { CalloutNode, EntityNode, FrameNode, NoteNode, ShapeNode, TextNode } from './basic';
import { BalanceNode, ClassNode, CodeNode, CompareNode, ContractNode, JsonNode, SequenceNode, StateNode, TableNode, TimelineNode, TransformNode } from './widgets';

/** React Flow node renderers by Studio node type (stable module-level object). */
export const nodeTypes = {
  entity: EntityNode,
  shape: ShapeNode,
  text: TextNode,
  note: NoteNode,
  callout: CalloutNode,
  frame: FrameNode,
  code: CodeNode,
  json: JsonNode,
  table: TableNode,
  class: ClassNode,
  contract: ContractNode,
  sequence: SequenceNode,
  state: StateNode,
  timeline: TimelineNode,
  compare: CompareNode,
  transform: TransformNode,
  balance: BalanceNode,
} as unknown as NodeTypes;
