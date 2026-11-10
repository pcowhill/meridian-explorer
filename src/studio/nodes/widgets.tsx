/**
 * Interactive technical widgets. Each binds to the model where it can (source
 * excerpts, examples, contracts, scenarios, state machines, tables, types) and
 * reuses the shared viewers; free-form variants are edited in place.
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Braces,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  FileCode2,
  GitCompareArrows,
  ListOrdered,
  Maximize2,
  Minimize2,
  Network,
  Pencil,
  Plus,
  Shapes,
  Table2,
  Trash2,
  Workflow,
} from 'lucide-react';
import { activeParticipants, assembleTrace, baseState, githubUrl, sourceLabel, visibleSteps, type Model } from '@/model';
import { useApp } from '@/state/app';
import { useModel, useScenario } from '@/state/hooks';
import { KindIcon, MethodBadge, entityColor, statusColor } from '@/ui/kinds';
import { Badge, Button, cn, Popover, Segmented } from '@/ui/primitives';
import { BalanceCalculator, DEFAULT_LEDGER } from '@/viewers/BalanceCalculator';
import { CodeBlock, languageOf, useSnippet } from '@/viewers/CodeBlock';
import { AuthSummary, ContractView } from '@/viewers/ContractView';
import { DbTable } from '@/viewers/DbTable';
import { FieldTable } from '@/viewers/Fields';
import { JsonView } from '@/viewers/JsonView';
import { SequenceDiagram } from '@/viewers/SequenceDiagram';
import { StateMachineView } from '@/viewers/StateMachineView';
import { useStudio } from '../store';
import type { BalanceData, ClassData, CodeData, CompareData, ContractData, JsonData, JsonOrigin, SNode, SequenceData, StateData, TableData, TimelineData, TransformData } from '../types';
import { EditableText, NodeButton, NodeShell, parseLines, WidgetBox, WidgetHeader } from './common';

type P<T> = NodeProps<SNode> & { data: T };

const update = (id: string, patch: Record<string, unknown>, coalesce?: string) => useStudio.getState().updateNodeData(id, patch, coalesce);

export const LANGUAGES = ['typescript', 'tsx', 'javascript', 'json', 'sql', 'bash', 'python', 'yaml', 'graphql', 'markdown'];

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** A popover with a textarea; `validate` rejects bad input (it is reported, not applied). */
function EditPopover({ label, value, onApply, validate, mono = true, extra }: { label: string; value: string; onApply: (v: string) => void; validate?: (v: string) => string | null; mono?: boolean; extra?: ReactNode }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setDraft(value);
          setError(null);
        }
      }}
      trigger={(p) => (
        <span className="nodrag inline-flex">
          <NodeButton label={label} onClick={p.onClick}>
            <Pencil size={12} />
          </NodeButton>
        </span>
      )}
      className="w-[420px] p-2"
      align="end"
    >
      {(close) => (
        <div className="flex flex-col gap-2" onKeyDown={(e) => e.stopPropagation()}>
          <div className="text-[11.5px] font-semibold text-fg-muted">{label}</div>
          {extra}
          <textarea
            aria-label={label}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            rows={14}
            className={cn('w-full resize-y rounded-md border border-line bg-surface-2 p-2 text-[12px] leading-[1.5] outline-none focus:border-accent', mono && 'font-mono')}
          />
          {error && (
            <div role="alert" className="rounded-md bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] px-2 py-1 text-[11.5px] text-bad">
              {error} — not applied.
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const err = validate?.(draft) ?? null;
                if (err) return setError(err);
                onApply(draft);
                close();
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

const jsonValidate = (v: string) => {
  const r = parseJson(v);
  return r.ok ? null : `Invalid JSON: ${r.error}`;
};

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

export const CodeNode = memo(function CodeNode({ id, data, selected }: P<CodeData>) {
  const model = useModel();
  const entity = model.entity(data.entityId);
  const sources = useMemo(() => (entity?.sources ?? []).filter((s) => s.start), [entity]);
  const snippet = useSnippet(data.source);
  const bound = !!data.source;
  const lines = parseLines(data.highlight);
  const title = data.label || entity?.name || (bound ? sourceLabel(data.source!) : 'Pseudocode');
  return (
    <NodeShell id={id} type="code" data={data} selected={selected} entityId={undefined} minWidth={220} minHeight={120}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed}
        header={
          <WidgetHeader
            icon={<FileCode2 size={14} />}
            color={entity ? entityColor(entity) : undefined}
            title={title}
            subtitle={bound ? sourceLabel(data.source!) : `${data.language} · free-form`}
            right={
              <>
                {bound && sources.length > 1 && (
                  <select
                    aria-label="Choose excerpt"
                    className="nodrag h-6 max-w-[150px] rounded border border-line bg-surface px-1 text-[11px]"
                    value={sources.findIndex((s) => s.file === data.source!.file && s.start === data.source!.start && s.end === data.source!.end)}
                    onChange={(e) => update(id, { source: sources[Number(e.target.value)], highlight: undefined })}
                  >
                    {sources.map((s, i) => (
                      <option key={i} value={i}>
                        {s.note ?? sourceLabel(s)}
                      </option>
                    ))}
                  </select>
                )}
                <EditPopover
                  label={bound ? 'Highlight lines' : 'Edit code'}
                  value={bound ? (data.highlight ?? '') : (data.code ?? '')}
                  mono
                  onApply={(v) => update(id, bound ? { highlight: v.trim() || undefined } : { code: v })}
                  extra={
                    !bound ? (
                      <div className="flex items-center gap-2 text-[11.5px]">
                        <label className="flex items-center gap-1">
                          Language
                          <select aria-label="Language" className="h-6 rounded border border-line bg-surface px-1" value={data.language} onChange={(e) => update(id, { language: e.target.value })}>
                            {LANGUAGES.map((l) => (
                              <option key={l}>{l}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-1 items-center gap-1">
                          Highlight
                          <input
                            aria-label="Highlighted lines"
                            className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 font-mono"
                            placeholder="e.g. 2-4, 7"
                            defaultValue={data.highlight ?? ''}
                            onBlur={(e) => update(id, { highlight: e.target.value.trim() || undefined })}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="text-[11px] text-fg-subtle">
                        Line numbers as in the file ({data.source!.start}–{data.source!.end}), e.g. <code>{data.source!.start}-{Math.min(data.source!.end ?? data.source!.start!, (data.source!.start ?? 1) + 2)}</code>
                      </div>
                    )
                  }
                />
                {bound && (
                  <a href={githubUrl(data.source!)} target="_blank" rel="noreferrer noopener" className="nodrag inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg" title="Open on GitHub at the pinned commit" aria-label="Open on GitHub">
                    <ExternalLink size={12} />
                  </a>
                )}
              </>
            }
          />
        }
      >
        {bound ? (
          snippet.text ? (
            <CodeBlock code={snippet.text} language={languageOf(data.source!.file)} startLine={data.source!.start} highlightLines={lines} maxHeight="none" className="rounded-none border-0" />
          ) : (
            <div className="p-3 text-[12px] text-fg-subtle">{snippet.loading ? 'Loading excerpt…' : 'Excerpt not bundled — open it on GitHub.'}</div>
          )
        ) : (
          <CodeBlock code={data.code || '// Edit to type pseudocode'} language={data.language} highlightLines={lines} maxHeight="none" className="rounded-none border-0" />
        )}
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function originLabel(model: Model, o: JsonOrigin): string {
  switch (o.kind) {
    case 'entity':
      return `Example ${model.entity(o.id)?.name ?? o.id}`;
    case 'request': {
      const c = model.contract(o.id);
      return c ? `${c.method} ${c.path} · request` : o.id;
    }
    case 'response': {
      const c = model.contract(o.id);
      return c ? `${c.method} ${c.path} · ${o.status} response` : o.id;
    }
    case 'payload': {
      const s = model.scenario(o.scenarioId);
      const st = s?.steps.find((x) => x.id === o.stepId);
      return s ? `${s.title} · ${st?.payload?.title ?? st?.title ?? o.stepId}` : o.scenarioId;
    }
    default:
      return 'Free-form JSON';
  }
}

export const JsonNode = memo(function JsonNode({ id, data, selected }: P<JsonData>) {
  const model = useModel();
  const parsed = useMemo(() => parseJson(data.json), [data.json]);
  const typeEntity = model.entity(data.typeRef);
  const highlight = data.highlight ?? [];
  return (
    <NodeShell id={id} type="json" data={data} selected={selected} minWidth={200} minHeight={110}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed}
        header={
          <WidgetHeader
            icon={<Braces size={14} />}
            color="var(--k-type)"
            title={data.label || originLabel(model, data.origin)}
            subtitle={typeEntity ? `${typeEntity.name} · click a key to highlight it` : 'Click a key to highlight it'}
            right={
              <>
                {highlight.length > 0 && (
                  <NodeButton label="Clear highlights" onClick={() => update(id, { highlight: [] })}>
                    <span className="text-[10.5px]">Clear</span>
                  </NodeButton>
                )}
                <EditPopover label="Edit JSON" value={data.json} validate={jsonValidate} onApply={(v) => update(id, { json: JSON.stringify(JSON.parse(v), null, 2) })} />
              </>
            }
          />
        }
        bodyClassName="p-1.5"
      >
        {parsed.ok ? (
          <JsonView
            data={parsed.value}
            highlight={highlight}
            fields={typeEntity?.fields}
            hideable
            hidden={data.hidden ?? []}
            onHiddenChange={(hidden) => update(id, { hidden })}
            onPick={(path) => update(id, { highlight: highlight.includes(path) ? highlight.filter((p) => p !== path) : [...highlight, path] })}
            defaultDepth={3}
            className="text-[11.5px]"
          />
        ) : (
          <div className="p-2 text-[12px] text-bad">Stored JSON is invalid: {parsed.error}</div>
        )}
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Table & class
// ---------------------------------------------------------------------------

export const TableNode = memo(function TableNode({ id, data, selected }: P<TableData>) {
  const model = useModel();
  const e = model.entity(data.entityId);
  const rows = useMemo(() => {
    if (!e) return [];
    const state = baseState() as Record<string, Record<string, unknown>[]>;
    const fromState = state[e.name];
    if (fromState?.length) return fromState;
    return e.example && typeof e.example === 'object' ? [e.example as Record<string, unknown>] : [];
  }, [e]);
  const view = data.view ?? 'columns';
  return (
    <NodeShell id={id} type="table" data={data} selected={selected} entityId={undefined} minWidth={220} minHeight={110}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed || (e && model.isHypothetical(e.id))}
        header={
          <WidgetHeader
            icon={<Table2 size={14} />}
            color="var(--k-db)"
            title={<span className="font-mono">{e?.name ?? data.entityId}</span>}
            subtitle={e ? `${e.fields?.length ?? 0} columns · ${rows.length} example row${rows.length === 1 ? '' : 's'}` : 'Not in the model'}
            onTitleClick={e ? () => useApp.getState().selectEntity(e.id) : undefined}
            right={
              <Segmented
                size="sm"
                label="Table view"
                value={view}
                onChange={(v) => update(id, { view: v })}
                options={[
                  { value: 'columns', label: 'Columns' },
                  { value: 'rows', label: 'Rows' },
                ]}
              />
            }
          />
        }
        bodyClassName="p-1.5"
      >
        {!e ? null : view === 'columns' ? (
          <FieldTable fields={e.fields ?? []} db proposed={model.modificationsFor(e.id).filter((m) => m.op === 'add-field' && m.field).map((m) => m.field!)} />
        ) : rows.length ? (
          <DbTable table={e.name} rows={rows} maxRows={30} compact />
        ) : (
          <div className="p-2 text-[12px] text-fg-subtle">No example rows are modelled for this table.</div>
        )}
      </WidgetBox>
    </NodeShell>
  );
});

export interface ClassMember {
  name: string;
  type: string;
  method: boolean;
  optional?: boolean;
}

/** Parse free-form members: `name: type` fields and `name(args): ret` methods, one per line. */
export function parseMembers(text: string | undefined): ClassMember[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const method = /^[\w$]+\s*\(/.test(l);
      const idx = method ? l.indexOf(')') + 1 : l.indexOf(':');
      const head = idx > 0 ? l.slice(0, idx) : l;
      const rest = idx > 0 ? l.slice(idx).replace(/^\s*:\s*/, '') : '';
      const optional = !method && head.trim().endsWith('?');
      return { name: head.trim().replace(/\?$/, ''), type: rest.trim(), method, optional };
    });
}

export const ClassNode = memo(function ClassNode({ id, data, selected }: P<ClassData>) {
  const model = useModel();
  const e = model.entity(data.entityId);
  const members: ClassMember[] = useMemo(() => {
    if (!e) return parseMembers(data.members);
    const fields = (e.fields ?? []).map((f) => ({ name: f.name.replace(/\?$/, ''), type: f.type, method: false, optional: !f.required && (f.required === false || f.name.endsWith('?')) }));
    const methods = model
      .children(e.id)
      .filter((c) => c.kind === 'function')
      .map((c) => ({ name: c.signature ? c.signature.replace(/^(export\s+)?(async\s+)?(function\s+)?/, '').slice(0, 80) : `${c.name}()`, type: '', method: true }));
    const values = (e.values ?? []).map((v) => ({ name: JSON.stringify(v.value), type: v.meaning ?? '', method: false }));
    return [...fields, ...values, ...methods, ...parseMembers(data.members)];
  }, [e, model, data.members]);
  const stereotype = e ? (e.kind === 'class' ? 'class' : e.kind === 'constant' ? 'constant' : 'type') : 'type';
  const name = e?.name ?? data.label ?? 'NewType';
  return (
    <NodeShell id={id} type="class" data={data} selected={selected} minWidth={160} minHeight={90}>
      <div className={cn('tint flex h-full w-full flex-col overflow-hidden rounded-md border-[1.5px] bg-surface shadow-panel', (data.proposed || (e && model.isHypothetical(e.id))) && 'hypothetical')} style={{ borderColor: e ? `color-mix(in srgb, ${entityColor(e)} 55%, var(--line))` : 'var(--line-strong)' }}>
        <div className="shrink-0 border-b border-line bg-surface-2 px-2 py-1.5 text-center">
          <div className="text-[10px] text-fg-subtle">«{stereotype}»</div>
          {e ? (
            <button type="button" className="nodrag max-w-full truncate font-mono text-[13px] font-semibold hover:underline" onClick={() => useApp.getState().selectEntity(e.id)} title="Inspect">
              {name}
            </button>
          ) : (
            <EditableText id={id} value={data.label} placeholder="TypeName" multiline={false} className="font-mono text-[13px] font-semibold" />
          )}
        </div>
        <div className={cn('min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[11.5px] leading-[1.6]', selected && 'nowheel')}>
          {members.filter((m) => !m.method).map((m, i) => (
            <div key={`f${i}`} className="flex gap-1 truncate">
              <span className="text-fg">{m.name}{m.optional ? '?' : ''}</span>
              {m.type && <span className="truncate text-fg-subtle">: {m.type}</span>}
            </div>
          ))}
          {members.some((m) => m.method) && <div className="my-1 border-t border-line" />}
          {members.filter((m) => m.method).map((m, i) => (
            <div key={`m${i}`} className="truncate text-[color:var(--k-function)]">
              {m.name}
              {m.type && <span className="text-fg-subtle">: {m.type}</span>}
            </div>
          ))}
          {!members.length && <div className="font-sans italic text-fg-subtle">No members — edit to add.</div>}
        </div>
        <div className="flex shrink-0 justify-end border-t border-line px-1 py-0.5">
          <EditPopover label={e ? 'Add extra members' : 'Edit members'} value={data.members ?? ''} onApply={(v) => update(id, { members: v })} extra={<div className="text-[11px] text-fg-subtle">One per line: <code>name: type</code> or <code>method(args): Result</code></div>} />
        </div>
      </div>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const ContractNode = memo(function ContractNode({ id, data, selected }: P<ContractData>) {
  const model = useModel();
  const c = model.contract(data.contractId);
  const toggle = () => {
    const expanded = !data.expanded;
    useStudio.getState().commit((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, width: expanded ? 600 : 380, height: expanded ? 620 : 300, data: { ...n.data, expanded } } : n)),
    }));
  };
  return (
    <NodeShell id={id} type="contract" data={data} selected={selected} minWidth={240} minHeight={120}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed || c?.confidence === 'hypothetical'}
        header={
          <WidgetHeader
            icon={<Network size={14} />}
            color="var(--k-endpoint)"
            title={c ? <span className="inline-flex items-center gap-1.5"><MethodBadge method={c.method} /><span className="truncate font-mono">{c.path}</span></span> : data.contractId}
            onTitleClick={c ? () => useApp.getState().selectEntity(c.id) : undefined}
            right={
              <NodeButton label={data.expanded ? 'Collapse to summary' : 'Show the full contract'} onClick={toggle}>
                {data.expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </NodeButton>
            }
          />
        }
        bodyClassName="p-2.5"
      >
        {!c ? (
          <div className="text-[12px] text-fg-subtle">Contract not found.</div>
        ) : data.expanded ? (
          <ContractView contract={c} compact />
        ) : (
          <div className="flex flex-col gap-2 text-[12px]">
            <p className="m-0 text-fg-muted">{c.summary}</p>
            <AuthSummary contract={c} />
            {(c.body?.length ?? 0) > 0 && (
              <div>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Request body</div>
                <div className="flex flex-col font-mono text-[11.5px]">
                  {c.body!.map((f) => (
                    <div key={f.name} className="truncate">
                      {f.name}
                      {f.required === false ? '?' : ''}
                      <span className="text-fg-subtle">: {f.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Responses</div>
              <div className="flex flex-wrap gap-1">
                {c.responses.map((r) => (
                  <Badge key={`r${r.status}`} color={statusColor(r.status)} title={r.description}>
                    {r.status}
                  </Badge>
                ))}
                {(c.errors ?? []).map((er, i) => (
                  <Badge key={`e${i}`} color={statusColor(er.status)} title={er.when}>
                    {er.status}
                    {er.code ? ` ${er.code}` : ''}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

export const SequenceNode = memo(function SequenceNode({ id, data, selected }: P<SequenceData>) {
  const model = useModel();
  const detail = useApp((s) => s.detail);
  const audience = useApp((s) => s.audience);
  const scenario = useScenario(data.scenarioId);
  const trace = useMemo(() => (data.traceEndpoint ? assembleTrace(model, data.traceEndpoint) : null), [model, data.traceEndpoint]);
  const source = scenario ?? trace;
  const variant = source ? (data.variant && source.variants.some((v) => v.id === data.variant) ? data.variant : source.defaultVariant) : 'main';
  const { steps, participants } = useMemo(() => {
    if (source) {
      const st = visibleSteps(source, variant, detail);
      return { steps: st, participants: activeParticipants(source, st) };
    }
    return { steps: data.custom?.steps ?? [], participants: data.custom?.participants ?? [] };
  }, [source, variant, detail, data.custom]);
  const index = Math.min(Math.max(0, data.step ?? 0), Math.max(0, steps.length - 1));
  const step = steps[index];
  const setStep = (i: number) => {
    update(id, { step: i }, 'step');
    if (scenario && steps[i]) useApp.getState().select({ type: 'step', scenarioId: scenario.id, stepId: steps[i].id });
  };
  const title = data.label || source?.title || 'Sequence';
  return (
    <NodeShell id={id} type="sequence" data={data} selected={selected} minWidth={320} minHeight={200}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed || source?.confidence === 'hypothetical'}
        header={
          <WidgetHeader
            icon={<Workflow size={14} />}
            color="var(--c-call)"
            title={title}
            subtitle={scenario ? scenario.question : trace ? 'Assembled from the endpoint contract' : 'Built from board elements'}
            right={
              <>
                {source && source.variants.length > 1 && (
                  <select aria-label="Variant" className="nodrag h-6 max-w-[140px] rounded border border-line bg-surface px-1 text-[11px]" value={variant} onChange={(e) => update(id, { variant: e.target.value, step: 0 })}>
                    {source.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
            }
          />
        }
        footer={
          steps.length > 0 && (
            <div className="shrink-0 border-t border-line bg-surface-2 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <NodeButton label="Previous step" onClick={() => setStep(Math.max(0, index - 1))} disabled={index === 0}>
                  <ChevronLeft size={13} />
                </NodeButton>
                <input
                  type="range"
                  aria-label="Step"
                  min={0}
                  max={Math.max(0, steps.length - 1)}
                  value={index}
                  onChange={(e) => setStep(Number(e.target.value))}
                  className="nodrag h-1 min-w-0 flex-1 accent-[var(--accent)]"
                />
                <NodeButton label="Next step" onClick={() => setStep(Math.min(steps.length - 1, index + 1))} disabled={index >= steps.length - 1}>
                  <ChevronRight size={13} />
                </NodeButton>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-fg-subtle">
                  {index + 1}/{steps.length}
                </span>
              </div>
              {step && (
                <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-fg-muted">
                  <b className="text-fg">{step.title}.</b> {step.audience?.[audience] ?? step.narrative}
                </div>
              )}
            </div>
          )
        }
        bodyClassName="p-1"
      >
        {steps.length ? (
          <SequenceDiagram
            participants={participants}
            steps={steps}
            activeIndex={index}
            onStepClick={setStep}
            onParticipantClick={(pid) => model.has(pid) && useApp.getState().selectEntity(pid)}
            laneWidth={128}
            rowHeight={36}
            compact
          />
        ) : (
          <div className="p-3 text-[12px] text-fg-subtle">No steps.</div>
        )}
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const StateNode = memo(function StateNode({ id, data, selected }: P<StateData>) {
  const model = useModel();
  const m = model.stateMachine(data.machineId);
  return (
    <NodeShell id={id} type="state" data={data} selected={selected} minWidth={260} minHeight={160}>
      <div className={cn('tint h-full w-full overflow-auto rounded-lg bg-surface shadow-panel', selected && 'nowheel', data.proposed && 'hypothetical')}>
        {m ? (
          <StateMachineView machine={m} current={data.current ?? null} compact onPickState={(s) => update(id, { current: data.current === s ? null : s })} />
        ) : (
          <div className="p-3 text-[12px] text-fg-subtle">State machine “{data.machineId}” not found.</div>
        )}
      </div>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

let itemSeq = 0;
const itemId = () => `t${Date.now().toString(36)}${itemSeq++}`;

export const TimelineNode = memo(function TimelineNode({ id, data, selected }: P<TimelineData>) {
  const items = data.items ?? [];
  const set = (next: TimelineData['items'], coalesce?: string) => update(id, { items: next }, coalesce);
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set(next);
  };
  return (
    <NodeShell id={id} type="timeline" data={data} selected={selected} minWidth={200} minHeight={120}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed}
        header={
          <WidgetHeader
            icon={<ListOrdered size={14} />}
            color="var(--c-realtime)"
            title={<EditableText id={id} value={data.label} placeholder="Timeline" multiline={false} />}
            right={
              <NodeButton label="Add a moment" onClick={() => set([...items, { id: itemId(), label: `Moment ${items.length + 1}` }])}>
                <Plus size={13} />
              </NodeButton>
            }
          />
        }
        bodyClassName="px-2.5 py-2"
      >
        <ol className="relative m-0 list-none p-0">
          <span className="absolute bottom-2 left-[9px] top-2 w-px bg-line-strong" aria-hidden />
          {items.map((it, i) => (
            <li key={it.id} className="group/item relative flex items-start gap-2 py-1">
              <span className="relative z-[1] mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--c-realtime)] bg-surface font-mono text-[9.5px] font-bold">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <input
                  aria-label={`Moment ${i + 1}`}
                  className="nodrag w-full rounded bg-transparent px-1 text-[12.5px] font-medium outline-none focus:bg-surface-2"
                  value={it.label}
                  onChange={(e) => set(items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)), `label:${it.id}`)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <input
                  aria-label={`Note for moment ${i + 1}`}
                  className="nodrag w-full rounded bg-transparent px-1 text-[11px] text-fg-muted outline-none placeholder:text-fg-subtle/60 focus:bg-surface-2"
                  value={it.note ?? ''}
                  placeholder="Add a detail…"
                  onChange={(e) => set(items.map((x) => (x.id === it.id ? { ...x, note: e.target.value || undefined } : x)), `note:${it.id}`)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                <NodeButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp size={11} />
                </NodeButton>
                <NodeButton label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                  <ArrowDown size={11} />
                </NodeButton>
                <NodeButton label="Remove moment" onClick={() => set(items.filter((x) => x.id !== it.id))}>
                  <Trash2 size={11} />
                </NodeButton>
              </div>
            </li>
          ))}
        </ol>
        {!items.length && <div className="text-[12px] text-fg-subtle">No moments yet — use + to add one.</div>}
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Compare & transform
// ---------------------------------------------------------------------------

/** Line-level diff marks for text mode: lines only in `a` / only in `b`. */
export function lineDiff(a: string, b: string): { left: ('removed' | 'same')[]; right: ('added' | 'same')[] } {
  const al = a.split('\n');
  const bl = b.split('\n');
  const bs = new Set(bl);
  const as = new Set(al);
  return { left: al.map((l) => (bs.has(l) ? 'same' : 'removed')), right: bl.map((l) => (as.has(l) ? 'same' : 'added')) };
}

function Pane({ label, value, format, compareTo, onLabel, onValue, marks, tone }: { label: string; value: string; format: 'json' | 'text'; compareTo?: string; onLabel: (v: string) => void; onValue: (v: string) => void; marks?: ('removed' | 'added' | 'same')[]; tone?: string }) {
  const parsed = useMemo(() => (format === 'json' ? parseJson(value) : null), [format, value]);
  const other = useMemo(() => (format === 'json' && compareTo !== undefined ? parseJson(compareTo) : null), [format, compareTo]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line px-2" style={tone ? { boxShadow: `inset 0 -2px 0 ${tone}` } : undefined}>
        <input aria-label="Pane label" className="nodrag min-w-0 flex-1 bg-transparent text-[11.5px] font-semibold outline-none" value={label} onChange={(e) => onLabel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <EditPopover label={`Edit ${label || 'pane'}`} value={value} validate={format === 'json' ? jsonValidate : undefined} onApply={(v) => onValue(format === 'json' ? JSON.stringify(JSON.parse(v), null, 2) : v)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5 text-[11.5px]">
        {format === 'json' ? (
          parsed?.ok ? (
            <JsonView data={parsed.value} compareTo={other?.ok ? other.value : undefined} defaultDepth={3} />
          ) : (
            <div className="text-bad">Invalid JSON</div>
          )
        ) : (
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6]">
            {value.split('\n').map((l, i) => (
              <div
                key={i}
                className={cn(
                  marks?.[i] === 'added' && 'bg-[color-mix(in_srgb,var(--ok)_16%,transparent)]',
                  marks?.[i] === 'removed' && 'bg-[color-mix(in_srgb,var(--bad)_13%,transparent)] line-through decoration-[color:var(--bad)]/50',
                )}
              >
                {l || ' '}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

export const CompareNode = memo(function CompareNode({ id, data, selected }: P<CompareData>) {
  const marks = useMemo(() => (data.format === 'text' ? lineDiff(data.left, data.right) : null), [data.format, data.left, data.right]);
  return (
    <NodeShell id={id} type="compare" data={data} selected={selected} minWidth={300} minHeight={140}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed}
        header={
          <WidgetHeader
            icon={<GitCompareArrows size={14} />}
            color="var(--warn)"
            title={<EditableText id={id} value={data.label} placeholder="Before / after" multiline={false} />}
            subtitle="Changes are marked on the right"
            right={
              <Segmented
                size="sm"
                label="Format"
                value={data.format}
                onChange={(v) => {
                  if (v === 'json' && (!parseJson(data.left).ok || !parseJson(data.right).ok)) {
                    useApp.getState().toast('Both panes must hold valid JSON to switch to JSON mode', 'warn');
                    return;
                  }
                  update(id, { format: v });
                }}
                options={[
                  { value: 'json', label: 'JSON' },
                  { value: 'text', label: 'Text' },
                ]}
              />
            }
          />
        }
        bodyClassName="flex divide-x divide-line overflow-hidden"
      >
        <Pane label={data.leftLabel} value={data.left} format={data.format} onLabel={(v) => update(id, { leftLabel: v }, 'll')} onValue={(v) => update(id, { left: v })} marks={marks?.left} tone="var(--fg-subtle)" />
        <Pane label={data.rightLabel} value={data.right} format={data.format} compareTo={data.left} onLabel={(v) => update(id, { rightLabel: v }, 'rl')} onValue={(v) => update(id, { right: v })} marks={marks?.right} tone="var(--ok)" />
      </WidgetBox>
    </NodeShell>
  );
});

export const TransformNode = memo(function TransformNode({ id, data, selected }: P<TransformData>) {
  const model = useModel();
  const fn = model.entity(data.entityId);
  return (
    <NodeShell id={id} type="transform" data={data} selected={selected} minWidth={420} minHeight={160}>
      <WidgetBox
        selected={selected}
        proposed={data.proposed}
        header={<WidgetHeader icon={<Shapes size={14} />} color="var(--c-call)" title={<EditableText id={id} value={data.label} placeholder="Transformation" multiline={false} />} subtitle="Input → function → output" />}
        bodyClassName="flex items-stretch overflow-hidden"
      >
        <Pane label="Input" value={data.input} format={data.format} onLabel={() => undefined} onValue={(v) => update(id, { input: v })} tone="var(--c-http)" />
        <div className="flex w-[170px] shrink-0 flex-col items-center justify-center gap-1.5 border-x border-line bg-surface-2 px-2 text-center">
          <ArrowRight size={14} className="text-fg-subtle" />
          <div className="w-full rounded-md border-[1.5px] border-[color:var(--k-function)] bg-surface px-2 py-1.5">
            {fn ? (
              <button type="button" className="nodrag inline-flex max-w-full items-center gap-1 truncate font-mono text-[12px] font-semibold text-[color:var(--k-function)] hover:underline" onClick={() => useApp.getState().selectEntity(fn.id)}>
                <KindIcon kind={fn.kind} size={12} />
                {fn.name}
              </button>
            ) : (
              <input
                aria-label="Function name"
                className="nodrag w-full bg-transparent text-center font-mono text-[12px] font-semibold text-[color:var(--k-function)] outline-none"
                value={data.fn}
                onChange={(e) => update(id, { fn: e.target.value }, 'fn')}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            {fn?.signature && <div className="mt-0.5 line-clamp-3 font-mono text-[10px] text-fg-subtle">{fn.signature}</div>}
          </div>
          <ArrowRight size={14} className="text-fg-subtle" />
          <Segmented
            size="sm"
            label="Format"
            value={data.format}
            onChange={(v) => {
              if (v === 'json' && (!parseJson(data.input).ok || !parseJson(data.output).ok)) {
                useApp.getState().toast('Input and output must be valid JSON to switch to JSON mode', 'warn');
                return;
              }
              update(id, { format: v });
            }}
            options={[
              { value: 'json', label: 'JSON' },
              { value: 'text', label: 'Text' },
            ]}
          />
        </div>
        <Pane label="Output" value={data.output} format={data.format} compareTo={data.input} onLabel={() => undefined} onValue={(v) => update(id, { output: v })} tone="var(--ok)" />
      </WidgetBox>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Balance calculator
// ---------------------------------------------------------------------------

export const BalanceNode = memo(function BalanceNode({ id, data, selected }: P<BalanceData>) {
  return (
    <NodeShell id={id} type="balance" data={data} selected={selected} minWidth={360} minHeight={220}>
      <div className={cn('h-full w-full overflow-auto rounded-lg shadow-panel', selected && 'nowheel')}>
        <div className="nodrag">
          <BalanceCalculator entries={data.entries ?? DEFAULT_LEDGER} onChange={(entries) => update(id, { entries }, 'entries')} title={data.label || undefined} />
        </div>
      </div>
    </NodeShell>
  );
});

export const WIDGET_ICON = { code: FileCode2, json: Braces, table: Table2, class: Columns2, contract: Network, sequence: Workflow, state: Workflow, timeline: ListOrdered, compare: GitCompareArrows, transform: Shapes, balance: Calculator };
