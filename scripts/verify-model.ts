/**
 * Verifies the Meridian knowledge model.
 *
 *   npx tsx scripts/verify-model.ts                 # everything
 *   npx tsx scripts/verify-model.ts --slice money   # only issues owned by one slice
 *   npx tsx scripts/verify-model.ts --no-sources    # skip the repository check
 *
 * Two kinds of checks:
 *  1. INTEGRITY — ids are unique and every reference (parent, relation endpoint,
 *     contract flow target, scenario participant, …) resolves.
 *  2. SOURCES — every SourceRef names a real file in a clone of Meridian at the
 *     pinned commit, its line range is inside the file, and its `symbol` text
 *     really appears inside that range. This is what keeps line references honest.
 *
 * The clone location comes from MERIDIAN_DIR (default: ../pcowhill/claude-banking-project
 * or ../claude-banking-project). If no clone is found the source check is skipped
 * with a warning (CI runs integrity only; the unit tests cover integrity too).
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SLICES as BASE_SLICES } from '../src/model/data/index';
import { simpayLayer } from '../src/state/layers/simpay';
import { REPO } from '../src/model/data/core';
import type { Contract, Entity, FieldDef, ModelSlice, Relation, Scenario, SourceRef, StateMachine } from '../src/model/types';

// Shipped example layers are checked like slices (their ids, references and cited sources must be real too).
const SLICES: Record<string, ModelSlice> = {
  ...BASE_SLICES,
  [simpayLayer.id]: { entities: simpayLayer.entities, relations: simpayLayer.relations, contracts: simpayLayer.contracts, scenarios: simpayLayer.scenarios },
};
const modificationTargets = simpayLayer.modifications.map((m) => m.target);

const args = process.argv.slice(2);
const sliceFilter = args.includes('--slice') ? args[args.indexOf('--slice') + 1] : null;
const skipSources = args.includes('--no-sources');

interface Issue {
  slice: string;
  level: 'error' | 'warn';
  where: string;
  message: string;
}
const issues: Issue[] = [];
const err = (slice: string, where: string, message: string) => issues.push({ slice, level: 'error', where, message });
const warn = (slice: string, where: string, message: string) => issues.push({ slice, level: 'warn', where, message });

// ---- Locate the clone -------------------------------------------------------
const candidates = [
  process.env.MERIDIAN_DIR,
  resolve(process.cwd(), '../pcowhill/claude-banking-project'),
  resolve(process.cwd(), '../claude-banking-project'),
].filter(Boolean) as string[];
const cloneDir = skipSources ? null : (candidates.find((d) => existsSync(resolve(d, 'package.json'))) ?? null);
if (cloneDir) {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: cloneDir }).toString().trim();
    if (head !== REPO.sha) {
      console.warn(`! Clone at ${cloneDir} is at ${head.slice(0, 10)}, but the model is pinned to ${REPO.sha.slice(0, 10)}. Line checks may be wrong.`);
    }
  } catch {
    /* not a git checkout — still usable */
  }
} else if (!skipSources) {
  console.warn('! No Meridian clone found (set MERIDIAN_DIR). Skipping source-reference checks.');
}

const fileCache = new Map<string, string[] | null>();
function linesOf(file: string): string[] | null {
  if (!cloneDir) return null;
  if (!fileCache.has(file)) {
    const p = resolve(cloneDir, file);
    fileCache.set(file, existsSync(p) ? readFileSync(p, 'utf8').split('\n') : null);
  }
  return fileCache.get(file) ?? null;
}

function checkSource(slice: string, where: string, ref: SourceRef | undefined): void {
  if (!ref) return;
  if (!ref.file) return err(slice, where, 'source has no file');
  if ((ref.start === undefined) !== (ref.end === undefined)) err(slice, where, `source ${ref.file}: give both start and end, or neither`);
  if (ref.start !== undefined && ref.end !== undefined && ref.end < ref.start) err(slice, where, `source ${ref.file}: end < start`);
  if (!cloneDir) return;
  const lines = linesOf(ref.file);
  if (!lines) return err(slice, where, `source file not found in Meridian: ${ref.file}`);
  if (ref.start !== undefined && ref.end !== undefined) {
    if (ref.start < 1 || ref.end > lines.length) return err(slice, where, `source ${ref.file}:${ref.start}-${ref.end} is outside the file (${lines.length} lines)`);
    if (ref.end - ref.start > 220) warn(slice, where, `source ${ref.file}:${ref.start}-${ref.end} spans ${ref.end - ref.start + 1} lines — narrow it`);
  }
  if (ref.symbol) {
    const text = (ref.start !== undefined && ref.end !== undefined ? lines.slice(ref.start - 1, ref.end) : lines).join('\n');
    if (!text.includes(ref.symbol)) {
      err(slice, where, `symbol ${JSON.stringify(ref.symbol)} not found in ${ref.file}${ref.start ? `:${ref.start}-${ref.end}` : ''}`);
    }
  } else if (ref.start !== undefined) {
    warn(slice, where, `source ${ref.file}:${ref.start}-${ref.end} has a line range but no symbol to verify it`);
  }
}

// ---- Collect ----------------------------------------------------------------
const entityOwner = new Map<string, string>();
const entities = new Map<string, Entity>();
const relationIds = new Map<string, string>();
const contractIds = new Map<string, string>();
const scenarioIds = new Map<string, string>();
const machineIds = new Map<string, string>();

for (const [name, slice] of Object.entries(SLICES) as [string, ModelSlice][]) {
  for (const e of slice.entities ?? []) {
    if (entities.has(e.id)) err(name, `entity ${e.id}`, `duplicate entity id (also in slice "${entityOwner.get(e.id)}")`);
    entities.set(e.id, e);
    entityOwner.set(e.id, name);
  }
  for (const r of slice.relations ?? []) {
    if (relationIds.has(r.id)) err(name, `relation ${r.id}`, `duplicate relation id (also in "${relationIds.get(r.id)}")`);
    relationIds.set(r.id, name);
  }
  for (const c of slice.contracts ?? []) {
    if (contractIds.has(c.id)) err(name, `contract ${c.id}`, 'duplicate contract id');
    contractIds.set(c.id, name);
  }
  for (const s of slice.scenarios ?? []) {
    if (scenarioIds.has(s.id)) err(name, `scenario ${s.id}`, 'duplicate scenario id');
    scenarioIds.set(s.id, name);
  }
  for (const m of slice.stateMachines ?? []) {
    if (machineIds.has(m.id)) err(name, `stateMachine ${m.id}`, 'duplicate state machine id');
    machineIds.set(m.id, name);
  }
}

const has = (id: string | undefined) => !!id && entities.has(id);
const need = (slice: string, where: string, what: string, id: string | undefined) => {
  if (id !== undefined && !has(id)) err(slice, where, `${what} → unknown entity "${id}"`);
};

function checkFields(slice: string, where: string, fields: FieldDef[] | undefined): void {
  for (const f of fields ?? []) {
    need(slice, `${where}.${f.name}`, 'typeRef', f.typeRef);
    need(slice, `${where}.${f.name}`, 'references', f.references);
    checkSource(slice, `${where}.${f.name}`, f.source);
    checkFields(slice, `${where}.${f.name}`, f.children);
  }
}

const ROOT_KINDS = new Set(['system', 'feature']);

for (const [name, slice] of Object.entries(SLICES) as [string, ModelSlice][]) {
  for (const e of slice.entities ?? []) {
    const where = `entity ${e.id}`;
    if (!e.name || !e.summary) err(name, where, 'missing name or summary');
    if (!e.parent && !ROOT_KINDS.has(e.kind)) err(name, where, 'has no parent (only system/feature entities may be parentless)');
    if (e.parent && !has(e.parent)) err(name, where, `parent → unknown entity "${e.parent}"`);
    if (e.parent === e.id) err(name, where, 'is its own parent');
    if (e.kind !== 'feature' && e.confidence !== 'hypothetical' && (!e.sources || e.sources.length === 0) && e.kind !== 'role') {
      warn(name, where, 'has no sources');
    }
    (e.sources ?? []).forEach((s) => checkSource(name, where, s));
    checkFields(name, where, e.fields);
    if (e.kind === 'endpoint' && !contractIds.has(e.id)) err(name, where, 'endpoint has no Contract with the same id');
  }

  for (const r of (slice.relations ?? []) as Relation[]) {
    const where = `relation ${r.id}`;
    need(name, where, 'from', r.from);
    need(name, where, 'to', r.to);
    if (r.from === r.to) err(name, where, 'from === to');
    (r.data ?? []).forEach((d) => need(name, where, 'data', d));
    (r.sources ?? []).forEach((s) => checkSource(name, where, s));
  }

  for (const c of (slice.contracts ?? []) as Contract[]) {
    const where = `contract ${c.id}`;
    const ent = entities.get(c.id);
    if (!ent) err(name, where, 'no endpoint entity with this id');
    else if (ent.kind !== 'endpoint') err(name, where, `entity kind is ${ent.kind}, expected endpoint`);
    if (c.id !== `ep:${c.method} ${c.path}`) err(name, where, `id should be "ep:${c.method} ${c.path}"`);
    if (!c.sources?.length && c.confidence !== 'hypothetical') err(name, where, 'contract has no sources');
    (c.sources ?? []).forEach((s) => checkSource(name, where, s));
    need(name, where, 'bodyTypeRef', c.bodyTypeRef);
    checkFields(name, `${where} body`, c.body);
    checkFields(name, `${where} query`, c.query);
    checkFields(name, `${where} pathParams`, c.pathParams);
    if (!c.responses?.length) err(name, where, 'contract has no responses');
    for (const r of c.responses ?? []) {
      need(name, `${where} response ${r.status}`, 'typeRef', r.typeRef);
      checkFields(name, `${where} response ${r.status}`, r.fields);
    }
    (c.errors ?? []).forEach((e) => checkSource(name, `${where} error ${e.status}`, e.source));
    if (!c.flow?.length) err(name, where, 'contract has no flow');
    (c.flow ?? []).forEach((f, i) => {
      need(name, `${where} flow[${i}]`, 'target', f.target);
      checkSource(name, `${where} flow[${i}]`, f.source);
    });
    (c.calledBy ?? []).forEach((id) => need(name, where, 'calledBy', id));
  }

  for (const s of (slice.scenarios ?? []) as Scenario[]) {
    const where = `scenario ${s.id}`;
    const variantIds = new Set(s.variants.map((v) => v.id));
    if (!variantIds.has(s.defaultVariant)) err(name, where, `defaultVariant "${s.defaultVariant}" is not a variant`);
    const participants = new Set(s.participants);
    s.participants.forEach((p) => need(name, where, 'participant', p));
    s.related.forEach((p) => need(name, where, 'related', p));
    (s.sources ?? []).forEach((x) => checkSource(name, where, x));
    const stepIds = new Set<string>();
    const tables = new Set(Object.keys(s.initialState ?? {}));
    for (const st of s.steps) {
      const sw = `${where} step ${st.id}`;
      if (stepIds.has(st.id)) err(name, sw, 'duplicate step id');
      stepIds.add(st.id);
      need(name, sw, 'from', st.from);
      need(name, sw, 'to', st.to);
      if (!participants.has(st.from)) err(name, sw, `from "${st.from}" is not listed in participants`);
      if (!participants.has(st.to)) err(name, sw, `to "${st.to}" is not listed in participants`);
      (st.variants ?? []).forEach((v) => {
        if (!variantIds.has(v)) err(name, sw, `unknown variant "${v}"`);
      });
      st.decision?.options.forEach((o) => {
        if (!variantIds.has(o.variant)) err(name, sw, `decision option → unknown variant "${o.variant}"`);
      });
      need(name, sw, 'payload.typeRef', st.payload?.typeRef);
      (st.sources ?? []).forEach((x) => checkSource(name, sw, x));
      for (const ef of st.effects ?? []) {
        if (s.initialState && !tables.has(ef.table)) err(name, sw, `effect on table "${ef.table}" which is missing from initialState (add it, even if empty)`);
        if (ef.op === 'insert' && typeof ef.row?.id !== 'string') err(name, sw, 'insert effect needs row.id');
        if (ef.op !== 'insert' && !ef.id) err(name, sw, `${ef.op} effect needs id`);
      }
    }
    for (const v of s.variants) {
      const visible = s.steps.filter((st) => !st.variants || st.variants.includes(v.id));
      if (visible.length < 3) warn(name, where, `variant "${v.id}" has only ${visible.length} steps`);
    }
    (s.watchAccounts ?? []).forEach((a) => {
      const rows = (s.initialState?.Account ?? []) as { id?: string }[];
      if (!rows.some((r) => r.id === a)) err(name, where, `watchAccounts "${a}" is not in initialState.Account`);
    });
  }

  for (const m of (slice.stateMachines ?? []) as StateMachine[]) {
    const where = `stateMachine ${m.id}`;
    need(name, where, 'subject', m.subject);
    const states = new Set(m.states.map((s) => s.id));
    if (!states.has(m.initial)) err(name, where, `initial "${m.initial}" is not a state`);
    for (const t of m.transitions) {
      if (!states.has(t.from)) err(name, where, `transition from unknown state "${t.from}"`);
      if (!states.has(t.to)) err(name, where, `transition to unknown state "${t.to}"`);
      need(name, where, 'transition.by', t.by);
      checkSource(name, where, t.source);
    }
    (m.sources ?? []).forEach((x) => checkSource(name, where, x));
  }

  for (const g of slice.glossary ?? []) {
    (g.related ?? []).forEach((id) => need(name, `glossary ${g.term}`, 'related', id));
  }
}

for (const t of modificationTargets) if (!entities.has(t)) err(simpayLayer.id, 'modification', `target → unknown entity "${t}"`);

// ---- Report -----------------------------------------------------------------
const shown = sliceFilter ? issues.filter((i) => i.slice === sliceFilter) : issues;
const errors = shown.filter((i) => i.level === 'error');
const warnings = shown.filter((i) => i.level === 'warn');

const counts = Object.entries(SLICES).map(([name, s]) => {
  const sl = s as ModelSlice;
  return `${name}: ${sl.entities?.length ?? 0} entities, ${sl.relations?.length ?? 0} relations, ${sl.contracts?.length ?? 0} contracts, ${sl.scenarios?.length ?? 0} scenarios, ${sl.stateMachines?.length ?? 0} state machines`;
});
console.log(counts.join('\n'));
console.log(`\nSource check: ${cloneDir ? `against ${cloneDir}` : 'SKIPPED'}`);

for (const i of warnings) console.log(`  warn  [${i.slice}] ${i.where}: ${i.message}`);
for (const i of errors) console.log(`  ERROR [${i.slice}] ${i.where}: ${i.message}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)${sliceFilter ? ` in slice "${sliceFilter}"` : ''}.`);
process.exit(errors.length ? 1 : 0);
