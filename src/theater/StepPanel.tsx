/**
 * The current step in detail: kind, title, from → to, provenance, the
 * narrative for the current audience, the payload, the decision (one button
 * per outcome), database before/after, derived balances of the watched
 * accounts and the code behind it. Empty sections are omitted.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Database, Diamond, EyeOff, Map as MapIcon } from 'lucide-react';
import { accountBalances, diffStates, type Scenario, type ScenarioStep, type TableDiff, type WorldState } from '@/model';
import { useApp } from '@/state/app';
import { AUDIENCES } from '@/model';
import { Badge, Button, cn, renderInline, SectionTitle, Segmented, Switch } from '@/ui/primitives';
import { ConfidenceBadge } from '@/ui/kinds';
import { STEP_COLOR, STEP_LABEL } from '@/viewers/SequenceDiagram';
import { EntityChip } from '@/viewers/Fields';
import { JsonView } from '@/viewers/JsonView';
import { DbTable } from '@/viewers/DbTable';
import { BalancePill } from '@/viewers/BalanceCalculator';
import { SourceList } from '@/viewers/CodeBlock';
import { OUTCOME_COLOR, STEP_ICON, useTheater } from './context';
import { isHypoStep, statesAround, stepConfidence } from './logic';

export function StepPanel() {
  const { scenario, variant, steps, index, step, marks, switchVariant } = useTheater();
  const audience = useApp((s) => s.audience);
  const openInAtlas = useApp((s) => s.openInAtlas);
  const [showTech, setShowTech] = useState(false);

  if (!step) {
    return (
      <div className="p-4 text-[12.5px] text-fg-muted" data-testid="step-panel">
        This scenario has no steps in this outcome yet.
      </div>
    );
  }
  const hypo = isHypoStep(step);
  const color = hypo ? 'var(--k-hypo)' : STEP_COLOR[step.kind];
  const Icon = STEP_ICON[step.kind];
  const worded = step.audience?.[audience];
  const audienceLabel = AUDIENCES.find((a) => a.id === audience)?.label ?? audience;
  const mark = marks[index];
  const atlasTarget = step.to;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="step-panel" data-step={step.id}>
      <header className={cn('shrink-0 border-b border-line px-3 pb-2.5 pt-3', hypo && 'hypothetical border-b-hypo')}>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge color={color}>
            <Icon size={11} aria-hidden />
            {STEP_LABEL[step.kind]}
          </Badge>
          <ConfidenceBadge confidence={stepConfidence(step, scenario)} />
          {mark?.hiddenBefore ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-subtle" title="Steps hidden at this detail level whose effects are included here">
              <EyeOff size={11} aria-hidden /> +{mark.hiddenBefore} hidden
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[10.5px] text-fg-subtle">
            {index + 1}/{steps.length}
          </span>
        </div>
        <h2 className="m-0 text-[15px] font-semibold leading-snug" data-testid="step-title">
          {step.title}
        </h2>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          <EntityChip id={step.from} />
          {step.from !== step.to && (
            <>
              <ArrowRight size={12} className="shrink-0 text-fg-subtle" aria-hidden />
              <EntityChip id={step.to} />
            </>
          )}
          <Button size="sm" variant="ghost" className="presenter-hide ml-auto h-6! px-1.5! text-[11px]!" icon={<MapIcon size={12} />} onClick={() => openInAtlas(atlasTarget)} title="Show the target of this step in the Architecture Atlas">
            Show in Atlas
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-4">
          <section className="prose-sm">
            <p className="m-0 text-[13.5px] leading-relaxed text-fg" data-testid="step-narrative">
              {renderInline(worded ?? step.narrative)}
            </p>
            {worded && worded !== step.narrative && (
              <div className="mt-1.5">
                <button type="button" onClick={() => setShowTech((v) => !v)} className="text-left text-[11.5px] font-medium text-accent hover:underline" aria-expanded={showTech}>
                  {showTech ? 'Hide' : 'Show'} the technical description <span className="text-fg-subtle">(worded for {audienceLabel})</span>
                </button>
                {showTech && <p className="m-0 mt-1 border-l-2 border-line pl-2 text-[12.5px] leading-relaxed text-fg-muted">{renderInline(step.narrative)}</p>}
              </div>
            )}
          </section>

          {step.decision && (
            <section>
              <SectionTitle>
                <span className="inline-flex items-center gap-1">
                  <Diamond size={11} className="text-warn" aria-hidden /> Decision
                </span>
              </SectionTitle>
              <p className="m-0 mb-2 text-[12.5px] font-medium">{step.decision.question}</p>
              <div className="flex flex-col gap-1">
                {step.decision.options.map((o) => {
                  const v = scenario.variants.find((x) => x.id === o.variant);
                  const active = variant === o.variant;
                  const oc = v?.hypothetical ? 'var(--k-hypo)' : OUTCOME_COLOR[v?.outcome ?? 'info'];
                  return (
                    <button
                      key={o.variant}
                      type="button"
                      data-testid="decision-option"
                      data-variant={o.variant}
                      aria-pressed={active}
                      disabled={!v}
                      onClick={() => switchVariant(o.variant)}
                      className={cn(
                        'flex items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                        active ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))]' : 'border-line',
                        v?.hypothetical && 'border-dashed border-hypo',
                      )}
                    >
                      <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: oc }} />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold">
                          {o.label}
                          {active && <span className="ml-1.5 text-[10.5px] font-medium text-accent">showing</span>}
                        </span>
                        {o.description && <span className="block text-[11.5px] text-fg-muted">{o.description}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {step.payload && <PayloadSection step={step} />}

          {scenario.initialState && <DatabaseSection scenario={scenario} variant={variant} steps={steps} index={index} />}

          {step.sources?.length ? (
            <section>
              <SectionTitle>Code</SectionTitle>
              <SourceList sources={step.sources} openFirst limit={3} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PayloadSection({ step }: { step: ScenarioStep }) {
  const p = step.payload!;
  const http = p.format === 'http-request' || p.format === 'http-response';
  return (
    <section>
      <SectionTitle>{p.title}</SectionTitle>
      {p.typeRef && (
        <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-fg-subtle">
          Type <EntityChip id={p.typeRef} />
        </div>
      )}
      {http && (p.line || p.headers) && (
        <div className="mb-1.5 overflow-hidden rounded-md border border-line bg-surface-2 font-mono text-[11.5px]">
          {p.line && <div className="px-2 py-1 font-semibold text-fg">{p.line}</div>}
          {p.headers &&
            Object.entries(p.headers).map(([k, v]) => (
              <div key={k} className="flex gap-1 border-t border-line px-2 py-0.5">
                <span className="shrink-0 text-fg-muted">{k}:</span>
                <span className="min-w-0 break-all text-fg">{v}</span>
              </div>
            ))}
        </div>
      )}
      {p.data === null || p.data === undefined ? (
        <div className="text-[11.5px] italic text-fg-subtle">{http ? 'No body.' : 'No data.'}</div>
      ) : (
        <JsonView data={p.data} highlight={p.highlight} showToolbar defaultDepth={3} />
      )}
    </section>
  );
}

type DbMode = 'step' | 'all';

/** Put the id and the columns that changed first, so the change is visible without scrolling. */
function changedColumns(d: TableDiff): string[] {
  const cols = new Set<string>(['id']);
  for (const r of d.rows) if (r.change === 'changed') r.fields.forEach((f) => cols.add(f));
  return [...cols];
}

function DatabaseSection({ scenario, variant, steps, index }: { scenario: Scenario; variant: string; steps: ScenarioStep[]; index: number }) {
  const [mode, setMode] = useState<DbMode>('step');
  const [fromStart, setFromStart] = useState(false);
  const { start, before, after } = useMemo(() => statesAround(scenario, variant, steps, index), [scenario, variant, steps, index]);
  const base: WorldState = fromStart ? start : before;
  const diffs = useMemo(() => diffStates(base, after), [base, after]);
  const changed = diffs.filter((d) => d.changed);
  const shown = mode === 'step' ? changed : diffs.filter((d) => (after[d.table]?.length ?? 0) > 0 || d.changed);
  const watch = (scenario.watchAccounts ?? []).filter((id) => (after.Account ?? start.Account ?? []).some((a) => a.id === id) || (after.LedgerEntry ?? []).some((r) => r.accountId === id));

  const balances = useMemo(
    () =>
      watch.map((id) => {
        const acct = (after.Account ?? []).find((a) => a.id === id) ?? (start.Account ?? []).find((a) => a.id === id);
        return { id, label: String(acct?.name ?? id), was: accountBalances(base, id), now: accountBalances(after, id) };
      }),
    [watch, base, after, start],
  );

  return (
    <section data-testid="db-section">
      <SectionTitle
        right={
          <Segmented
            size="sm"
            label="Database view"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'step', label: 'Changes', title: fromStart ? 'Every change since the start' : "This step's changes" },
              { value: 'all', label: 'All tables', title: 'The whole example database so far' },
            ]}
          />
        }
      >
        <span className="inline-flex items-center gap-1">
          <Database size={11} aria-hidden /> Database
        </span>
      </SectionTitle>
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="min-w-0 text-[11.5px] text-fg-muted">
          {changed.length === 0 ? (fromStart ? 'Nothing has changed since the start.' : 'This step does not change the database.') : `${changed.length} table${changed.length === 1 ? '' : 's'} changed ${fromStart ? 'since the start' : 'by this step'}.`}
        </span>
        <Switch checked={fromStart} onChange={setFromStart} label="Since start" className="shrink-0 whitespace-nowrap text-[11.5px]!" />
      </div>
      {balances.length > 0 && (
        <div className="mb-2 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }} data-testid="balances">
          {balances.map((b) => (
            <BalancePill key={b.id} label={b.label} current={b.now.currentMinor} available={b.now.availableMinor} prevCurrent={b.was.currentMinor} prevAvailable={b.was.availableMinor} />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {shown.map((d) => (
          <DbTable key={d.table} table={d.table} diff={d} changedOnly={mode === 'step'} maxRows={mode === 'step' ? 12 : 30} columns={changedColumns(d)} compact />
        ))}
      </div>
    </section>
  );
}
