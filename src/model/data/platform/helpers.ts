import type { Relation, RelationKind, SourceRef } from '../../types';

/** Path prefixes inside the Meridian repository. */
export const BE = 'apps/backend/src';
export const SH = 'packages/shared/src';
export const CU = 'apps/customer/src';
export const OP = 'apps/operations/src';

/** A line-ranged source reference with the literal symbol the checker looks for. */
export function src(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

const usedRelationIds = new Set<string>();

/** Build a relation with the conventional id `rel:<from>-><to>:<kind>` (suffixing `:n` on repeats). */
export function rel(from: string, to: string, kind: RelationKind, extra: Partial<Omit<Relation, 'id' | 'from' | 'to' | 'kind'>> = {}): Relation {
  let id = `rel:${from}->${to}:${kind}`;
  if (usedRelationIds.has(id)) {
    let n = 2;
    while (usedRelationIds.has(`${id}:${n}`)) n += 1;
    id = `${id}:${n}`;
  }
  usedRelationIds.add(id);
  return { id, from, to, kind, ...extra };
}
