/**
 * Edit mode: the scenario as an editable outline (left) and a compact form for
 * the current step (right). Every change goes to an unsaved draft (drafts.ts)
 * and shows on the stage immediately; Save writes it to the workspace.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  EyeOff,
  GripVertical,
  Library as LibraryIcon,
  Plus,
  Save,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from 'lucide-react';
import { reusableSteps, stepDetail, variantSteps, type DetailLevel, type Scenario, type ScenarioStep, type StepKind } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { Button, cn, Field, IconButton, inputClass, Popover, SectionTitle, Segmented, Switch } from '@/ui/primitives';
import { entityColor, KindIcon } from '@/ui/kinds';
import { STEP_COLOR, STEP_LABEL } from '@/viewers/SequenceDiagram';
import { STEP_ICON, useTheater } from './context';
import { EntityPicker } from './EntityPicker';
import {
  deleteStep,
  duplicateStep,
  insertStepAfter,
  isHypoStep,
  moveParticipant,
  moveStep,
  moveStepBefore,
  newStep,
  parsePayload,
  removeParticipant,
  reusableCaller,
  STEP_KINDS,
  stepFromReusable,
  updateStep,
  withParticipant,
} from './logic';

export interface EditorApi {
  edit: (fn: (s: Scenario) => Scenario) => void;
  /** Make a (possibly hidden) step current, raising the detail level if needed. */
  focusStep: (stepId: string) => void;
  save: () => void;
  discard: () => void;
  exportJson: () => void;
  remove: () => void;
  done: () => void;
}

export function Outline({ api }: { api: EditorApi }) {
  const { scenario, variant, steps, step, dirty, saved } = useTheater();
  const detail = useApp((s) => s.detail);
  const model = useModel();
  const all = useMemo(() => variantSteps(scenario, variant), [scenario, variant]);
  const visibleIds = useMemo(() => new Set(steps.map((s) => s.id)), [steps]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);

  const insertAfterCurrent = (s: ScenarioStep) => {
    api.edit((sc) => insertStepAfter(sc, step?.id ?? sc.steps[sc.steps.length - 1]?.id ?? null, s));
    api.focusStep(s.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="outline">
      <div className="shrink-0 space-y-2 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', dirty ? 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn' : 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok')} data-testid="save-state">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <span className="flex-1" />
          <IconButton label={saved ? "Discard unsaved changes" : "Discard this unsaved copy"} size="sm" disabled={!dirty} onClick={api.discard}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton label="Export to a JSON file" size="sm" onClick={api.exportJson}>
            <Download size={14} />
          </IconButton>
          <Popover
            align="end"
            className="w-60 p-2"
            trigger={(p) => (
              <IconButton label="Delete this scenario" size="sm" {...p}>
                <Trash2 size={14} />
              </IconButton>
            )}
          >
            {(close) => (
              <div className="text-[12px]">
                <p className="m-0 mb-2">Delete “{scenario.title}” from this browser?</p>
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-bad!"
                    onClick={() => {
                      close();
                      api.remove();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </Popover>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="primary" className="flex-1" icon={<Save size={13} />} onClick={api.save} disabled={!dirty} aria-label="Save scenario" title="Save to this browser's workspace (mod+S)">
            Save
          </Button>
          <Button size="sm" icon={<X size={13} />} onClick={api.done} title="Leave edit mode (E)">
            Done
          </Button>
        </div>
        <Field label="Title">
          <input className={cn(inputClass, 'h-7')} value={scenario.title} onChange={(e) => api.edit((s) => ({ ...s, title: e.target.value }))} data-testid="edit-title" />
        </Field>
        <Field label="Question it answers">
          <input className={cn(inputClass, 'h-7')} value={scenario.question} onChange={(e) => api.edit((s) => ({ ...s, question: e.target.value }))} />
        </Field>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <SectionTitle
          right={
            <EntityPicker
              label="Add participant"
              suggestions={[]}
              onPick={(id) => {
                api.edit((s) => withParticipant(s, id));
                setShowParticipants(true);
              }}
              trigger={(p) => (
                <Button size="sm" variant="ghost" className="h-6! px-1.5!" icon={<UserPlus size={12} />} {...p} aria-label="Add participant">
                  Add
                </Button>
              )}
            />
          }
        >
          <button type="button" onClick={() => setShowParticipants((v) => !v)} aria-expanded={showParticipants} className="uppercase hover:text-fg">
            Participants ({scenario.participants.length}) {showParticipants ? '▾' : '▸'}
          </button>
        </SectionTitle>
        <ul className={cn('m-0 mb-3 list-none space-y-0.5 p-0', !showParticipants && 'hidden')}>
          {scenario.participants.map((id, i) => {
            const e = model.entity(id);
            const used = scenario.steps.some((s) => s.from === id || s.to === id);
            return (
              <li key={id} className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2">
                {e ? <KindIcon kind={e.kind} size={12} className="shrink-0" /> : <span className="w-3" />}
                <span className={cn('min-w-0 flex-1 truncate text-[12px]', !e && 'font-mono text-fg-subtle')} style={e ? { color: entityColor(e) } : undefined} title={id}>
                  {e?.name ?? id}
                </span>
                <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label="Move left in the lanes" size="sm" className="h-5! w-5!" disabled={i === 0} onClick={() => api.edit((s) => moveParticipant(s, id, -1))}>
                    <ArrowUp size={11} />
                  </IconButton>
                  <IconButton label="Move right in the lanes" size="sm" className="h-5! w-5!" disabled={i === scenario.participants.length - 1} onClick={() => api.edit((s) => moveParticipant(s, id, 1))}>
                    <ArrowDown size={11} />
                  </IconButton>
                  <IconButton label={used ? 'Used by a step — cannot remove' : 'Remove participant'} size="sm" className="h-5! w-5!" disabled={used} onClick={() => api.edit((s) => removeParticipant(s, id))}>
                    <X size={11} />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>

        <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{all.length} in this outcome</span>}>Steps</SectionTitle>
        <ol className="m-0 list-none space-y-0.5 p-0" onDragLeave={() => setOverId(null)}>
          {all.map((s, i) => {
            const Icon = STEP_ICON[s.kind];
            const visible = visibleIds.has(s.id);
            const current = step?.id === s.id;
            return (
              <li
                key={s.id}
                draggable
                onDragStart={(e) => {
                  setDragId(s.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', s.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverId(s.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== s.id) api.edit((sc) => moveStepBefore(sc, dragId, s.id));
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className={cn(
                  'group flex items-center gap-1 rounded-md border px-1 py-1',
                  current ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))]' : 'border-transparent hover:bg-surface-2',
                  isHypoStep(s) && 'hypothetical border-hypo',
                  overId === s.id && dragId !== s.id && 'shadow-[inset_0_2px_0_var(--accent)]',
                  dragId === s.id && 'opacity-50',
                )}
                data-outline-step={s.id}
              >
                <span className="cursor-grab text-fg-subtle" aria-hidden title="Drag to reorder">
                  <GripVertical size={12} />
                </span>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => api.focusStep(s.id)} aria-current={current ? 'step' : undefined}>
                  <span className="w-5 shrink-0 text-right font-mono text-[10px] text-fg-subtle">{i + 1}</span>
                  <Icon size={12} className="shrink-0" style={{ color: isHypoStep(s) ? 'var(--k-hypo)' : STEP_COLOR[s.kind] }} aria-hidden />
                  <span className={cn('min-w-0 flex-1 truncate text-[12px]', !visible && 'text-fg-subtle italic')}>{s.title}</span>
                  {!visible && (
                    <span title={`Hidden at detail ${detail} (shown from ${stepDetail(s)})`} className="shrink-0 text-fg-subtle">
                      <EyeOff size={11} aria-label="hidden at this detail level" />
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label="Move up" size="sm" className="h-5! w-5!" disabled={i === 0} onClick={() => api.edit((sc) => moveStep(sc, s.id, -1, variant))}>
                    <ArrowUp size={11} />
                  </IconButton>
                  <IconButton label="Move down" size="sm" className="h-5! w-5!" disabled={i === all.length - 1} onClick={() => api.edit((sc) => moveStep(sc, s.id, 1, variant))}>
                    <ArrowDown size={11} />
                  </IconButton>
                  <IconButton
                    label="Duplicate step"
                    size="sm"
                    className="h-5! w-5!"
                    onClick={() => {
                      let id = s.id;
                      api.edit((sc) => {
                        const r = duplicateStep(sc, s.id);
                        id = r.id;
                        return r.scenario;
                      });
                      api.focusStep(id);
                    }}
                  >
                    <Copy size={11} />
                  </IconButton>
                  <IconButton label="Delete step" size="sm" className="h-5! w-5! hover:text-bad!" disabled={scenario.steps.length <= 1} onClick={() => api.edit((sc) => deleteStep(sc, s.id))}>
                    <Trash2 size={11} />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" className="flex-1" icon={<Plus size={13} />} onClick={() => insertAfterCurrent(newStep(step, scenario.participants))} aria-label="Insert a step after the current one">
            New step
          </Button>
          <ReusablePicker onPick={insertAfterCurrent} after={step} />
        </div>
      </div>
    </div>
  );
}

function ReusablePicker({ onPick, after }: { onPick: (s: ScenarioStep) => void; after: ScenarioStep | undefined }) {
  const model = useModel();
  const library = useMemo(() => reusableSteps(model), [model]);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = query
      ? library.filter((r) => {
          const hay = `${r.label} ${r.kind} ${r.target} ${model.entity(r.target)?.name ?? ''} ${r.detail ?? ''}`.toLowerCase();
          return query.split(/\s+/).every((w) => hay.includes(w));
        })
      : library;
    return list.slice(0, 60);
  }, [library, q, model]);
  const { scenario } = useTheater();
  const from = reusableCaller(after, scenario.participants, (id) => model.entity(id)?.kind);
  return (
    <Popover
      align="end"
      className="w-[380px] p-1.5"
      trigger={(p) => (
        <Button size="sm" icon={<LibraryIcon size={13} />} {...p} aria-label="Insert a reusable step" data-testid="reusable-steps">
          Reusable…
        </Button>
      )}
    >
      {(close) => (
        <div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guards, validators, writes, emits…" aria-label="Search reusable steps" className={cn(inputClass, 'mb-1 h-7')} data-testid="reusable-search" />
          <div className="px-1.5 pb-1 text-[10.5px] text-fg-subtle">Harvested from every endpoint’s server flow. Inserted after the current step, called from {model.entity(from)?.name ?? 'the current component'}.</div>
          <ul className="m-0 max-h-[320px] list-none overflow-y-auto p-0">
            {rows.map((r) => {
              const Icon = STEP_ICON[r.kind];
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    data-reusable={r.key}
                    onClick={() => {
                      onPick(stepFromReusable(r, from || r.target));
                      close();
                    }}
                    className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2"
                  >
                    <Icon size={12} className="mt-[3px] shrink-0" style={{ color: STEP_COLOR[r.kind] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11.5px] font-semibold">{r.label}</span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {STEP_LABEL[r.kind]} · {model.entity(r.target)?.name ?? r.target}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-fg-subtle" title={`Used by ${r.usedBy} endpoint${r.usedBy === 1 ? '' : 's'}`}>
                      ×{r.usedBy}
                    </span>
                  </button>
                </li>
              );
            })}
            {rows.length === 0 && <li className="px-2 py-3 text-center text-[11.5px] text-fg-subtle">Nothing matches.</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}

/** Compact form for the current step. */
export function StepForm({ api }: { api: EditorApi }) {
  const { scenario, step } = useTheater();
  if (!step) return <div className="p-4 text-[12.5px] text-fg-muted">No step selected.</div>;
  return <StepFormInner key={step.id} api={api} scenario={scenario} step={step} />;
}

function StepFormInner({ api, scenario, step }: { api: EditorApi; scenario: Scenario; step: ScenarioStep }) {
  const set = (patch: Partial<ScenarioStep>) => api.edit((s) => updateStep(s, step.id, patch));
  const [payloadText, setPayloadText] = useState(() => (step.payload ? JSON.stringify(step.payload.data, null, 2) : ''));
  const parsed = parsePayload(payloadText);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="step-form">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        <Field label="Title">
          <input className={inputClass} value={step.title} onChange={(e) => set({ title: e.target.value })} data-testid="form-title" />
        </Field>
        <Field label="Arrow label">
          <input className={cn(inputClass, 'font-mono')} value={step.label} onChange={(e) => set({ label: e.target.value })} data-testid="form-label" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <select className={inputClass} value={step.kind} onChange={(e) => set({ kind: e.target.value as StepKind })} data-testid="form-kind">
              {STEP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {STEP_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-fg-muted">Detail level</span>
            <Segmented
              size="sm"
              label="Detail level"
              value={String(step.detail ?? 2)}
              onChange={(v) => set({ detail: Number(v) as DetailLevel })}
              options={[1, 2, 3, 4, 5].map((d) => ({ value: String(d), label: String(d), title: d === 1 ? 'Business outline' : d === 5 ? 'Source level' : `Detail ${d}` }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-fg-muted">From</span>
            <EntityPicker label="From" value={step.from} suggestions={scenario.participants} onPick={(id) => set({ from: id })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-fg-muted">To</span>
            <EntityPicker label="To" value={step.to} suggestions={scenario.participants} onPick={(id) => set({ to: id })} />
          </div>
        </div>
        <Field label="Narrative" hint="Use `backticks` for code.">
          <textarea className={cn(inputClass, 'h-24 resize-y py-1.5 leading-snug')} value={step.narrative} onChange={(e) => set({ narrative: e.target.value })} data-testid="form-narrative" />
        </Field>
        <Switch checked={!!step.hypothetical} onChange={(v) => set({ hypothetical: v || undefined })} label="Hypothetical (not in Meridian)" />
        <Field
          label="Payload (JSON, optional)"
          hint={!parsed.ok ? <span className="text-bad">Not valid JSON: {parsed.error}</span> : payloadText.trim() ? 'Valid JSON — shown in the step panel.' : 'Leave empty for no payload.'}
        >
          <textarea
            className={cn(inputClass, 'h-28 resize-y py-1.5 font-mono text-[11.5px] leading-snug', !parsed.ok && 'border-bad!')}
            value={payloadText}
            spellCheck={false}
            aria-invalid={!parsed.ok}
            data-testid="form-payload"
            onChange={(e) => {
              const text = e.target.value;
              setPayloadText(text);
              const r = parsePayload(text);
              if (!r.ok) return;
              set({ payload: r.data === undefined ? undefined : { ...(step.payload ?? { title: 'Payload', format: 'json' }), data: r.data } });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
