import type { Relation, RelationKind, SourceRef } from '../../types';

/** Repo-relative roots used by the operations-app slice. */
export const OPS_SRC = 'apps/operations/src';
export const DEPLOY = 'scripts/deploy';
export const DEPLOY_DOC = 'docs/PUBLIC_DEMO_DEPLOYMENT.md';
export const CI_YML = '.github/workflows/ci.yml';
export const RESET_YML = '.github/workflows/reset-demo.yml';

/** A source reference with a tight line range and a symbol the checker verifies. */
export function src(file: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return note ? { file, start, end, symbol, note } : { file, start, end, symbol };
}

/** A source reference into `apps/operations/src/<path>`. */
export function ops(path: string, start: number, end: number, symbol: string, note?: string): SourceRef {
  return src(`${OPS_SRC}/${path}`, start, end, symbol, note);
}

const usedRelationIds = new Set<string>();

/** Id prefixes owned by the operations-app slice. */
const OWN_PREFIXES = ['op:', 'infra:', 'be:seed-', 'be:prisma/', 'test:scripts/deploy/', 'test:apps/backend/src/baseline'];

/**
 * Build a relation with the conventional id `rel:<from>-><to>:<kind>`; a
 * numeric suffix is appended when the same pair/kind is used more than once.
 */
export function rel(
  from: string,
  to: string,
  kind: RelationKind,
  extra: Omit<Relation, 'id' | 'from' | 'to' | 'kind'> = {},
): Relation {
  // Relations that start in another slice's namespace (roles, shared e2e specs…)
  // get a slice suffix so they can never collide with that slice's own ids.
  const own = OWN_PREFIXES.some((prefix) => from.startsWith(prefix));
  const base = own ? `rel:${from}->${to}:${kind}` : `rel:${from}->${to}:${kind}:ops-app`;
  let id = base;
  let n = 2;
  while (usedRelationIds.has(id)) {
    id = `${base}:${n}`;
    n += 1;
  }
  usedRelationIds.add(id);
  return { id, from, to, kind, ...extra };
}
