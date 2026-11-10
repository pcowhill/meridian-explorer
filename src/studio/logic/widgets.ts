/**
 * Widget bindings: what each widget type can be bound to in the model (for the
 * quick binding picker), and the node data a binding produces. Pure.
 */
import {
  assembleTrace,
  sourceLabel,
  stateAfter,
  stateBefore,
  tokenize,
  variantSteps,
  visibleSteps,
  type Model,
  type Scenario,
  type SourceRef,
} from '@/model';
import { languageOf } from '@/viewers/CodeBlock';
import { DEFAULT_SIZE, type AnyNodeData, type JsonOrigin, type StudioNodeType } from '../types';

export type WidgetKind = Exclude<StudioNodeType, 'entity' | 'shape' | 'text' | 'note' | 'callout' | 'frame'>;

export interface BindingItem {
  key: string;
  label: string;
  sub?: string;
  /** Section heading in the picker. */
  group: string;
  /** Searchable text. */
  text: string;
  make: () => WidgetSpec;
}

export interface WidgetSpec {
  type: StudioNodeType;
  data: AnyNodeData;
  size: { w: number; h: number };
}

const pretty = (v: unknown) => JSON.stringify(v ?? null, null, 2);

const spec = (type: StudioNodeType, data: AnyNodeData, size?: { w: number; h: number }): WidgetSpec => ({ type, data, size: size ?? DEFAULT_SIZE[type] });

// ---- individual bindings -------------------------------------------------------

export function codeSpec(model: Model, entityId: string | undefined, source: SourceRef | undefined): WidgetSpec {
  if (!source) return spec('code', { language: 'typescript', code: '// Pseudocode\nfunction explain(input) {\n  const checked = validate(input);\n  return save(checked);\n}\n', label: 'Pseudocode' });
  const lines = (source.end ?? source.start ?? 0) - (source.start ?? 0) + 1;
  const h = Math.max(180, Math.min(520, 60 + lines * 18.4));
  return spec('code', { entityId, source, language: languageOf(source.file), label: entityId ? model.entity(entityId)?.name : undefined }, { w: 560, h });
}

export function jsonSpec(model: Model, origin: JsonOrigin, value?: unknown): WidgetSpec {
  let data: unknown = value;
  let typeRef: string | undefined;
  let highlight: string[] | undefined;
  if (origin.kind === 'entity') {
    const e = model.entity(origin.id);
    data = e?.example;
    typeRef = origin.id;
  } else if (origin.kind === 'request') {
    const c = model.contract(origin.id);
    data = c?.requestExample;
    typeRef = c?.bodyTypeRef;
  } else if (origin.kind === 'response') {
    const r = model.contract(origin.id)?.responses.find((x) => x.status === origin.status);
    data = r?.example;
    typeRef = r?.typeRef;
  } else if (origin.kind === 'payload') {
    const st = model.scenario(origin.scenarioId)?.steps.find((x) => x.id === origin.stepId);
    data = st?.payload?.data;
    typeRef = st?.payload?.typeRef;
    highlight = st?.payload?.highlight;
  }
  const json = pretty(data ?? {});
  const lines = json.split('\n').length;
  return spec('json', { json, origin, typeRef, highlight }, { w: 360, h: Math.max(140, Math.min(460, 70 + lines * 19)) });
}

export function sequenceSpec(scenarioId: string): WidgetSpec {
  return spec('sequence', { scenarioId, step: 0 });
}

export function traceSpec(endpointId: string): WidgetSpec {
  return spec('sequence', { traceEndpoint: endpointId, step: 0 });
}

/** A transformation bound to a function: if an endpoint's handler uses it, show that endpoint's request → response. */
export function transformSpec(model: Model, fnId?: string): WidgetSpec {
  const fn = fnId ? model.entity(fnId) : undefined;
  const c = fnId ? model.contractsUsing(fnId).find((x) => x.requestExample !== undefined || x.responses.some((r) => r.example !== undefined)) : undefined;
  if (fn && c) {
    const ok = c.responses.find((r) => r.status < 300 && r.example !== undefined) ?? c.responses.find((r) => r.example !== undefined);
    return spec('transform', { format: 'json', input: pretty(c.requestExample ?? {}), output: pretty(ok?.example ?? {}), fn: fn.name, entityId: fn.id, label: `${c.method} ${c.path}` });
  }
  return spec('transform', {
    format: 'json',
    input: pretty({ amount: '250.00', currency: 'USD' }),
    output: pretty({ amountMinor: 25000, currency: 'USD' }),
    fn: fn?.name ?? 'transform()',
    entityId: fn?.id,
    label: 'Transformation',
  });
}

/** A database row before and after a scenario step (from replaying the scenario's effects). */
export function rowCompareSpec(scenario: Scenario, stepId: string, table: string, rowId: string): WidgetSpec {
  const before = stateBefore(scenario, scenario.defaultVariant, stepId);
  const after = stateAfter(scenario, scenario.defaultVariant, stepId);
  const b = before[table]?.find((r) => r.id === rowId);
  const a = after[table]?.find((r) => r.id === rowId);
  const st = scenario.steps.find((s) => s.id === stepId);
  return spec('compare', { format: 'json', left: pretty(b ?? null), right: pretty(a ?? null), leftLabel: `Before: ${table}`, rightLabel: `After: ${st?.title ?? stepId}`, label: `${scenario.title} — ${table} ${rowId}` });
}

export function timelineFromScenario(scenario: Scenario): WidgetSpec {
  const steps = visibleSteps(scenario, scenario.defaultVariant, 1);
  return spec('timeline', { label: scenario.title, items: steps.slice(0, 12).map((s, i) => ({ id: `t${i}`, label: s.title, note: s.label })) }, { w: 320, h: Math.max(200, 70 + steps.slice(0, 12).length * 46) });
}

// ---- the picker catalogue ------------------------------------------------------

export function bindingItems(model: Model, kind: WidgetKind, customScenarios: Scenario[] = []): BindingItem[] {
  const out: BindingItem[] = [];
  const add = (it: Omit<BindingItem, 'text'> & { text?: string }) => out.push({ ...it, text: it.text ?? `${it.label} ${it.sub ?? ''}` });
  const scenarios = [...model.scenarios, ...customScenarios];
  switch (kind) {
    case 'code': {
      add({ key: 'free', label: 'Free-form pseudocode', sub: 'Type your own code', group: 'Free-form', make: () => codeSpec(model, undefined, undefined) });
      for (const e of model.entities.values()) {
        (e.sources ?? []).forEach((s, i) => {
          if (!s.start) return;
          add({ key: `${e.id}#${i}`, label: e.name, sub: `${sourceLabel(s)}${s.note ? ` — ${s.note}` : ''}`, group: 'Source excerpts', text: `${e.name} ${e.id} ${s.file} ${s.note ?? ''}`, make: () => codeSpec(model, e.id, s) });
        });
      }
      break;
    }
    case 'json': {
      add({ key: 'free', label: 'Empty JSON', sub: 'Type your own', group: 'Free-form', make: () => jsonSpec(model, { kind: 'free' }, { example: true }) });
      for (const c of model.contracts.values()) {
        if (c.requestExample !== undefined) add({ key: `req:${c.id}`, label: `${c.method} ${c.path}`, sub: 'Request example', group: 'Endpoint examples', make: () => jsonSpec(model, { kind: 'request', id: c.id }) });
        for (const r of c.responses) if (r.example !== undefined) add({ key: `res:${c.id}:${r.status}`, label: `${c.method} ${c.path}`, sub: `${r.status} response example`, group: 'Endpoint examples', make: () => jsonSpec(model, { kind: 'response', id: c.id, status: r.status }) });
      }
      for (const e of model.entities.values()) if (e.example !== undefined) add({ key: `ex:${e.id}`, label: e.name, sub: `Example ${e.kind === 'db-model' ? 'row' : 'value'}`, group: 'Type & table examples', text: `${e.name} ${e.id}`, make: () => jsonSpec(model, { kind: 'entity', id: e.id }) });
      for (const s of scenarios) {
        for (const st of s.steps) if (st.payload) add({ key: `pl:${s.id}:${st.id}`, label: st.payload.title || st.title, sub: `${s.title} · ${st.title}`, group: 'Scenario payloads', make: () => jsonSpec(model, { kind: 'payload', scenarioId: s.id, stepId: st.id }, st.payload!.data) });
      }
      break;
    }
    case 'table':
      for (const e of model.byKind('db-model')) add({ key: e.id, label: e.name, sub: e.summary, group: 'Database tables', make: () => spec('table', { entityId: e.id, view: 'columns' }, { w: 480, h: Math.max(180, Math.min(420, 70 + (e.fields?.length ?? 4) * 27)) }) });
      break;
    case 'class': {
      add({ key: 'free', label: 'Free-form type', sub: 'Name and members of your own', group: 'Free-form', make: () => spec('class', { label: 'NewType', members: 'id: string\namount: number\nvalidate(): Result' }) });
      for (const e of model.entities.values()) {
        if (!['type', 'class', 'constant', 'db-model'].includes(e.kind) || !(e.fields?.length || e.values?.length || e.kind === 'class')) continue;
        const n = (e.fields?.length ?? 0) + (e.values?.length ?? 0);
        add({ key: e.id, label: e.name, sub: `${e.kind} · ${n} member${n === 1 ? '' : 's'}`, group: 'Types & classes', text: `${e.name} ${e.id}`, make: () => spec('class', { entityId: e.id }, { w: 280, h: Math.max(130, Math.min(440, 80 + n * 19)) }) });
      }
      break;
    }
    case 'contract':
      for (const c of model.contracts.values()) add({ key: c.id, label: `${c.method} ${c.path}`, sub: c.summary, group: 'Endpoints', make: () => spec('contract', { contractId: c.id }) });
      break;
    case 'sequence':
      for (const s of scenarios) add({ key: s.id, label: s.title, sub: s.question, group: 'Scenarios', make: () => sequenceSpec(s.id) });
      for (const c of model.contracts.values()) add({ key: `trace:${c.id}`, label: `${c.method} ${c.path}`, sub: 'Assemble a trace from the contract flow', group: 'Endpoint traces', make: () => traceSpec(c.id) });
      break;
    case 'state':
      for (const m of model.stateMachines) add({ key: m.id, label: m.name, sub: m.summary, group: 'State machines', make: () => spec('state', { machineId: m.id }) });
      break;
    case 'timeline':
      add({ key: 'free', label: 'Blank timeline', sub: 'Add your own moments', group: 'Free-form', make: () => spec('timeline', { label: 'Timeline', items: [{ id: 't0', label: 'First' }, { id: 't1', label: 'Then' }, { id: 't2', label: 'Finally' }] }) });
      for (const s of scenarios) add({ key: s.id, label: s.title, sub: 'Business-level steps of the scenario', group: 'From a scenario', make: () => timelineFromScenario(s) });
      break;
    case 'compare': {
      add({ key: 'free', label: 'Blank before / after', sub: 'Two JSON panes', group: 'Free-form', make: () => spec('compare', { format: 'json', left: pretty({ status: 'pending' }), right: pretty({ status: 'posted' }), leftLabel: 'Before', rightLabel: 'After', label: 'Before / after' }) });
      add({ key: 'free-text', label: 'Blank text comparison', sub: 'Two text panes, changed lines marked', group: 'Free-form', make: () => spec('compare', { format: 'text', left: 'Existing behaviour', right: 'Proposed behaviour', leftLabel: 'Existing', rightLabel: 'Proposed', label: 'Before / after' }) });
      for (const s of scenarios) {
        const steps = variantSteps(s, s.defaultVariant);
        for (const st of steps) {
          for (const ef of st.effects ?? []) {
            if (ef.op !== 'update' || !ef.id) continue;
            add({ key: `${s.id}:${st.id}:${ef.table}:${ef.id}`, label: `${ef.table} ${ef.id}`, sub: `${s.title} · ${st.title}`, group: 'Row before / after a scenario step', make: () => rowCompareSpec(s, st.id, ef.table, ef.id!) });
          }
        }
      }
      break;
    }
    case 'transform': {
      add({ key: 'free', label: 'Free-form transformation', sub: 'Input → function → output', group: 'Free-form', make: () => transformSpec(model) });
      for (const e of model.byKind('function')) {
        if (!model.contractsUsing(e.id).some((c) => c.requestExample !== undefined)) continue;
        add({ key: e.id, label: e.name, sub: 'Request example → response example of the endpoint it serves', group: 'Functions behind endpoints', text: `${e.name} ${e.id}`, make: () => transformSpec(model, e.id) });
      }
      break;
    }
    case 'balance':
      add({ key: 'balance', label: 'Balance calculator', sub: 'Example ledger; balances derived live', group: 'Calculator', make: () => spec('balance', {}) });
      break;
  }
  return out;
}

/** Every query token must prefix-match some token of the item (camelCase-aware). */
export function matchItems(items: readonly BindingItem[], query: string, limit = 60): BindingItem[] {
  const q = tokenize(query);
  if (!q.length) return items.slice(0, limit);
  const scored: { it: BindingItem; score: number }[] = [];
  for (const it of items) {
    const toks = tokenize(it.text);
    let score = 0;
    let ok = true;
    for (const t of q) {
      const exact = toks.includes(t);
      if (!exact && !toks.some((x) => x.startsWith(t))) {
        ok = false;
        break;
      }
      score += exact ? 2 : 1;
    }
    if (ok) scored.push({ it, score: score + (it.label.toLowerCase().includes(query.toLowerCase().trim()) ? 3 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.it);
}

/** Widgets that can be attached directly to an entity node (for the selection's quick actions). */
export function quickWidgets(model: Model, entityId: string): { label: string; make: () => WidgetSpec }[] {
  const e = model.entity(entityId);
  if (!e) return [];
  const out: { label: string; make: () => WidgetSpec }[] = [];
  const src = (e.sources ?? []).find((s) => s.start);
  if (src) out.push({ label: 'Code', make: () => codeSpec(model, e.id, src) });
  const c = model.contract(e.id);
  if (c) {
    out.push({ label: 'Contract', make: () => spec('contract', { contractId: c.id }) });
    if (c.requestExample !== undefined) out.push({ label: 'Request JSON', make: () => jsonSpec(model, { kind: 'request', id: c.id }) });
    const ok = c.responses.find((r) => r.example !== undefined);
    if (ok) out.push({ label: 'Response JSON', make: () => jsonSpec(model, { kind: 'response', id: c.id, status: ok.status }) });
    out.push({ label: 'Trace', make: () => traceSpec(c.id) });
  }
  if (e.example !== undefined) out.push({ label: 'Example JSON', make: () => jsonSpec(model, { kind: 'entity', id: e.id }) });
  if (e.kind === 'db-model') out.push({ label: 'Table', make: () => bindingItems(model, 'table').find((x) => x.key === e.id)!.make() });
  if (['type', 'class', 'constant'].includes(e.kind) && (e.fields?.length || e.values?.length)) out.push({ label: 'Type card', make: () => bindingItems(model, 'class').find((x) => x.key === e.id)!.make() });
  for (const m of model.stateMachinesFor(e.id).slice(0, 2)) out.push({ label: m.name.replace(/ lifecycle$/i, '') + ' states', make: () => spec('state', { machineId: m.id }) });
  const sc = model.scenariosFor(e.id)[0];
  if (sc) out.push({ label: `Sequence: ${sc.title}`, make: () => sequenceSpec(sc.id) });
  if (e.kind === 'function' && model.contractsUsing(e.id).some((x) => x.requestExample !== undefined)) out.push({ label: 'Transformation', make: () => transformSpec(model, e.id) });
  return out;
}

/** Endpoint trace exists for an id (assembleTrace succeeds). */
export const canTrace = (model: Model, endpointId: string): boolean => !!assembleTrace(model, endpointId);

