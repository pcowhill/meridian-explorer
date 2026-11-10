/**
 * Comparative evaluation worksheet: the same hands-on scenarios in each mode,
 * a rubric to rate them, and an export of the observations. Stored with the
 * workspace (browser-local) and downloadable as Markdown or JSON.
 */
import { useEffect, useState } from 'react';
import { Clapperboard, Download, Map as MapIcon, PenTool, Play, RotateCcw, Square } from 'lucide-react';
import { MODES, useApp, type ModeId } from '@/state/app';
import { downloadText } from '@/state/io';
import { useWorkspace, type EvaluationState } from '@/state/workspace';
import { Button, cn, Dialog, SectionTitle, Tabs } from '@/ui/primitives';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { EVAL_CRITERIA, EVAL_SCENARIOS } from './evaluation';
import { runQuestion } from './questions';

const MODE_ICON: Record<ModeId, typeof MapIcon> = { atlas: MapIcon, theater: Clapperboard, studio: PenTool };
const short = (m: ModeId) => MODES.find((x) => x.id === m)!.label.split(' ')[1];

export function averageFor(evaluation: EvaluationState, mode: ModeId): number | null {
  const values = EVAL_CRITERIA.map((c) => evaluation.ratings[`${mode}:${c.id}`]).filter((v): v is number => typeof v === 'number' && v > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The worksheet as a Markdown document. */
export function evaluationMarkdown(e: EvaluationState): string {
  const lines: string[] = ['# Meridian Explorer — mode comparison', '', `Recorded ${new Date().toISOString().slice(0, 10)}.`, ''];
  lines.push('## Rubric (1 = poor, 5 = excellent)', '', `| Criterion | ${MODES.map((m) => m.label).join(' | ')} |`, `| --- | ${MODES.map(() => ':-:').join(' | ')} |`);
  for (const c of EVAL_CRITERIA) lines.push(`| ${c.label} | ${MODES.map((m) => e.ratings[`${m.id}:${c.id}`] || '–').join(' | ')} |`);
  lines.push(`| **Average** | ${MODES.map((m) => averageFor(e, m.id)?.toFixed(1) ?? '–').join(' | ')} |`, '');
  lines.push('## Scenarios', '');
  for (const s of EVAL_SCENARIOS) {
    lines.push(`### ${s.id}. ${s.title}`, '', s.goal, '');
    for (const m of MODES) {
      const note = e.notes[`${s.id}:${m.id}`]?.trim();
      const t = e.timings[`${s.id}:${m.id}`];
      lines.push(`- **${m.label}**${t ? ` (${formatSeconds(t)})` : ''}: ${note || '_no notes_'}`);
    }
    lines.push('');
  }
  lines.push('## Overall', '', `Preferred foundation: **${e.preferred ? MODES.find((m) => m.id === e.preferred)!.label : 'undecided'}**`, '', e.overall.trim() || '_no overall notes_', '');
  return lines.join('\n');
}

const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function Timer({ k }: { k: string }) {
  const saved = useWorkspace((s) => s.evaluation.timings[k]);
  const setTiming = useWorkspace((s) => s.setTiming);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const running = startedAt !== null;
  const elapsed = running ? (now - startedAt) / 1000 : (saved ?? 0);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={running ? 'Stop timer' : 'Start timer'}
        onClick={() => {
          if (running) {
            setTiming(k, Math.round((Date.now() - startedAt) / 1000));
            setStartedAt(null);
          } else {
            setStartedAt(Date.now());
            setNow(Date.now());
          }
        }}
        className={cn('inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[11px]', running ? 'border-bad text-bad' : 'border-line text-fg-muted hover:bg-surface-2')}
      >
        {running ? <Square size={9} fill="currentColor" /> : <Play size={9} fill="currentColor" />}
        {elapsed ? formatSeconds(elapsed) : 'time it'}
      </button>
    </span>
  );
}

export function EvaluationPanel({ onClose }: { onClose: () => void }) {
  const evaluation = useWorkspace((s) => s.evaluation);
  const setRating = useWorkspace((s) => s.setRating);
  const setNote = useWorkspace((s) => s.setNote);
  const setEvaluation = useWorkspace((s) => s.setEvaluation);
  const resetEvaluation = useWorkspace((s) => s.resetEvaluation);
  const setMode = useApp((s) => s.setMode);
  const [tab, setTab] = useState<'scenarios' | 'rubric'>('scenarios');
  const [scenarioId, setScenarioId] = useState('A');
  const scenario = EVAL_SCENARIOS.find((s) => s.id === scenarioId)!;

  const start = (mode: ModeId) => {
    const q = GUIDED_QUESTIONS.find((x) => x.id === scenario.question);
    onClose();
    if (q) runQuestion(q, mode);
    else setMode(mode);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Evaluation worksheet — compare the three modes"
      width={980}
      bodyClassName="p-0!"
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw size={12} />} onClick={resetEvaluation} className="mr-auto">
            Clear worksheet
          </Button>
          <Button icon={<Download size={13} />} onClick={() => downloadText('meridian-explorer-evaluation.json', JSON.stringify({ app: 'meridian-explorer', kind: 'evaluation', exportedAt: new Date().toISOString(), evaluation }, null, 2))}>
            JSON
          </Button>
          <Button variant="primary" icon={<Download size={13} />} onClick={() => downloadText('meridian-explorer-evaluation.md', evaluationMarkdown(evaluation), 'text/markdown')} data-testid="export-evaluation">
            Download as Markdown
          </Button>
        </>
      }
    >
      <Tabs
        label="Worksheet sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'scenarios', label: 'Hands-on scenarios', count: EVAL_SCENARIOS.length },
          { value: 'rubric', label: 'Rubric & verdict' },
        ]}
        className="px-3"
      />
      {tab === 'scenarios' ? (
        <div className="grid min-h-[440px] grid-cols-[230px_1fr]">
          <nav className="flex flex-col gap-0.5 border-r border-line bg-surface-2/50 p-2" aria-label="Scenarios">
            {EVAL_SCENARIOS.map((s) => {
              const done = MODES.filter((m) => evaluation.notes[`${s.id}:${m.id}`]?.trim()).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScenarioId(s.id)}
                  aria-current={s.id === scenarioId}
                  className={cn('flex items-start gap-2 rounded-md px-2 py-1.5 text-left', s.id === scenarioId ? 'bg-surface shadow-panel' : 'hover:bg-surface')}
                  data-testid={`eval-scenario-${s.id}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-3 text-[10.5px] font-bold">{s.id}</span>
                  <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug">{s.title}</span>
                  <span className="shrink-0 text-[10px] text-fg-subtle">{done}/3</span>
                </button>
              );
            })}
          </nav>
          <div className="min-w-0 p-4">
            <h3 className="m-0 text-[15px] font-semibold">
              Scenario {scenario.id}: {scenario.title}
            </h3>
            <p className="mb-2 mt-0.5 text-[12.5px] text-fg-muted">{scenario.goal}</p>
            <SectionTitle>Demonstrate</SectionTitle>
            <ul className="m-0 mb-3 grid list-none grid-cols-2 gap-x-4 gap-y-0.5 p-0 text-[12.5px]">
              {scenario.tasks.map((t) => (
                <li key={t} className="flex gap-1.5">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-subtle" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="grid gap-2.5 lg:grid-cols-3">
              {MODES.map((m) => {
                const Icon = MODE_ICON[m.id];
                const k = `${scenario.id}:${m.id}`;
                return (
                  <div key={m.id} className={cn(`mode-${m.id} flex flex-col rounded-lg border border-line bg-surface p-2.5`)}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <Icon size={13} className="text-accent" />
                      <span className="text-[12.5px] font-semibold">{m.label}</span>
                    </div>
                    <p className="m-0 mb-2 flex-1 text-[11.5px] leading-relaxed text-fg-muted">{scenario.start[m.id]}</p>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Button size="sm" variant="primary" onClick={() => start(m.id)} data-testid={`eval-start-${scenario.id}-${m.id}`}>
                        Go to {short(m.id)}
                      </Button>
                      <Timer k={k} />
                    </div>
                    <textarea
                      value={evaluation.notes[k] ?? ''}
                      onChange={(e) => setNote(k, e.target.value)}
                      placeholder="Observations…"
                      aria-label={`Observations for scenario ${scenario.id} in ${m.label}`}
                      rows={4}
                      className="w-full resize-y rounded-md border border-line bg-surface-2/60 p-1.5 text-[12px] focus:border-accent focus:outline-none"
                      data-testid={`eval-note-${scenario.id}-${m.id}`}
                    />
                  </div>
                );
              })}
            </div>
            <p className="mb-0 mt-2 text-[11.5px] text-fg-subtle">Notes save as you type. This dialog closes when you go to a mode; reopen it from ? → Evaluation worksheet.</p>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <table className="w-full border-collapse text-left text-[12.5px]" data-testid="rubric">
            <thead>
              <tr className="text-[11px] text-fg-subtle">
                <th className="py-1.5 pr-3 font-semibold">Criterion (1 = poor · 5 = excellent)</th>
                {MODES.map((m) => (
                  <th key={m.id} className={`mode-${m.id} w-[168px] py-1.5 text-center font-semibold text-accent`}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVAL_CRITERIA.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-[11.5px] text-fg-subtle">{c.question}</div>
                  </td>
                  {MODES.map((m) => {
                    const key = `${m.id}:${c.id}`;
                    const value = evaluation.ratings[key] ?? 0;
                    return (
                      <td key={m.id} className={`mode-${m.id} py-1.5 text-center`}>
                        <div role="radiogroup" aria-label={`${c.label} — ${m.label}`} className="inline-flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              role="radio"
                              aria-checked={value === n}
                              onClick={() => setRating(key, value === n ? 0 : n)}
                              className={cn('h-7 w-7 rounded-md border text-[12px] font-semibold transition-colors', value >= n ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg-subtle hover:border-accent')}
                              data-testid={`rate-${m.id}-${c.id}-${n}`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong font-semibold">
                <td className="py-2">Average</td>
                {MODES.map((m) => (
                  <td key={m.id} className="py-2 text-center text-[15px]" data-testid={`avg-${m.id}`}>
                    {averageFor(evaluation, m.id)?.toFixed(1) ?? '–'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_240px]">
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-fg-muted">Overall observations</span>
              <textarea value={evaluation.overall} onChange={(e) => setEvaluation({ overall: e.target.value })} rows={5} className="resize-y rounded-md border border-line bg-surface-2/60 p-2 text-[12.5px] focus:border-accent focus:outline-none" placeholder="What worked, what did not, what to combine…" />
            </label>
            <div>
              <div className="mb-1 text-[11.5px] font-semibold text-fg-muted">Preferred foundation</div>
              <div className="flex flex-col gap-1" role="radiogroup" aria-label="Preferred foundation">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={evaluation.preferred === m.id}
                    onClick={() => setEvaluation({ preferred: evaluation.preferred === m.id ? '' : m.id })}
                    className={cn(`mode-${m.id} rounded-md border px-2 py-1.5 text-left text-[12.5px] font-medium`, evaluation.preferred === m.id ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent' : 'border-line hover:bg-surface-2')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
