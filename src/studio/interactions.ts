/** Bridges between board elements and the shared selection (so the inspector explains what was clicked). */
import { channelOf } from '@/model';
import { useApp } from '@/state/app';
import { edgeStatus, entityOf } from './logic/modelEdges';
import { indexNodes } from './logic/geometry';
import { currentModel } from './model';
import { selectedEdgeIds, selectedNodeIds, useStudio } from './store';
import type { SNode } from './types';

/** Shared-selection target for a node: the entity it shows or is bound to. */
export function sharedSelectionForNode(n: SNode): Parameters<ReturnType<typeof useApp.getState>['select']>[0] | null {
  const d = n.data as Record<string, unknown>;
  const model = currentModel();
  if (n.type === 'entity' && typeof d.entityId === 'string') return { type: 'entity', id: d.entityId };
  if ((n.type === 'table' || n.type === 'class' || n.type === 'code' || n.type === 'transform') && typeof d.entityId === 'string' && model.has(d.entityId)) return { type: 'entity', id: d.entityId };
  if (n.type === 'contract' && typeof d.contractId === 'string' && model.has(d.contractId)) return { type: 'entity', id: d.contractId };
  if (n.type === 'state' && typeof d.machineId === 'string') return { type: 'machine', id: d.machineId };
  return null;
}

/** Shared selection for an edge: the relation (one) or the aggregated edge (several). */
export function sharedSelectionForEdge(edgeId: string): Parameters<ReturnType<typeof useApp.getState>['select']>[0] | null {
  const s = useStudio.getState();
  const e = s.edges.find((x) => x.id === edgeId);
  if (!e) return null;
  const byId = indexNodes(s.nodes);
  const a = entityOf(byId.get(e.source));
  const b = entityOf(byId.get(e.target));
  const model = currentModel();
  const status = edgeStatus(model, a, b, e.data);
  if (!a || !b || status === 'unverified') return null;
  const rels = (e.data?.relationIds ?? []).map((id) => model.relation(id)).filter((r) => !!r);
  if (rels.length === 1) return { type: 'relation', id: rels[0]!.id };
  const channel = e.data?.channel ?? (rels[0] ? channelOf(rels[0].kind) : undefined);
  if (!channel) return null;
  return { type: 'edge', a, b, channel };
}

export function selectEdge(id: string, additive = false): void {
  const s = useStudio.getState();
  if (additive) s.setSelection(selectedNodeIds(s), [...new Set([...selectedEdgeIds(s), id])]);
  else s.setSelection([], [id]);
  const sel = sharedSelectionForEdge(id);
  if (sel) useApp.getState().select(sel);
}
