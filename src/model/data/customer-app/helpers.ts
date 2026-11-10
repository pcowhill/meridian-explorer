import type { Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative root of the customer app's source. */
export const CU = 'apps/customer/src/';

/** A SourceRef into `apps/customer/src/<file>`. */
export function cu(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file: CU + file, start, end, symbol, note } : { file: CU + file, start, end, symbol };
}

/** A whole-file SourceRef into `apps/customer/src/<file>` (symbol must appear somewhere in the file). */
export function cuFile(file: string, symbol: string, note?: string): SourceRef {
  return note ? { file: CU + file, symbol, note } : { file: CU + file, symbol };
}

/** A SourceRef anywhere else in the repository (repo-relative path). */
export function repo(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

type RelationExtra = Omit<Relation, 'id' | 'from' | 'to' | 'kind'>;

/** Build a relation with the conventional id `rel:<from>-><to>:<kind>[:n]`. */
export function rel(from: string, to: string, kind: RelationKind, extra: RelationExtra = {}, n?: number): Relation {
  return { id: `rel:${from}->${to}:${kind}${n ? `:${n}` : ''}`, from, to, kind, ...extra };
}
