/**
 * Timeline view: the whole flow as a storyboard of compact step cards, in
 * reading order. Decision points and database changes are called out, the
 * current card is highlighted, and any card jumps to its step.
 */
import { useEffect, useRef } from 'react';
import { ArrowRight, Database, Diamond, EyeOff } from 'lucide-react';
import { useModel } from '@/state/hooks';
import { cn } from '@/ui/primitives';
import { STEP_COLOR, STEP_LABEL } from '@/viewers/SequenceDiagram';
import { STEP_ICON, useTheater } from './context';
import { isHypoStep } from './logic';

export function TimelineView() {
  const { steps, index, go, marks, reduced } = useTheater();
  const model = useModel();
  const list = useRef<HTMLOListElement>(null);
  const name = (id: string) => model.entity(id)?.name ?? id;

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [index, reduced]);

  return (
    <div className="h-full overflow-y-auto bg-canvas p-3" data-testid="timeline-view">
      <ol ref={list} className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))' }}>
        {steps.map((s, i) => {
          const Icon = STEP_ICON[s.kind];
          const hypo = isHypoStep(s);
          const color = hypo ? 'var(--k-hypo)' : STEP_COLOR[s.kind];
          const state = i < index ? 'done' : i === index ? 'active' : 'future';
          const m = marks[i];
          return (
            <li key={s.id} data-index={i}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={state === 'active' ? 'step' : undefined}
                data-step={s.id}
                data-state={state}
                className={cn(
                  'relative flex h-full w-full flex-col gap-1 rounded-lg border bg-surface p-2 pl-3 text-left transition-[opacity,box-shadow,border-color] duration-150 hover:border-line-strong',
                  hypo && 'hypothetical',
                  state === 'future' && 'opacity-55',
                  state === 'active' ? 'border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]' : 'border-line',
                )}
              >
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: color }} />
                <span className="flex items-center gap-1.5 text-[10.5px] font-semibold">
                  <span className="font-mono text-fg-subtle">{i + 1}</span>
                  <span className="inline-flex items-center gap-1 uppercase tracking-wide" style={{ color }}>
                    <Icon size={11} aria-hidden />
                    {STEP_LABEL[s.kind]}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {m?.hiddenBefore ? (
                      <span className="inline-flex items-center gap-0.5 text-fg-subtle" title={`${m.hiddenBefore} hidden step${m.hiddenBefore === 1 ? '' : 's'} folded in`}>
                        <EyeOff size={10} aria-hidden />
                        {m.hiddenBefore}
                      </span>
                    ) : null}
                    {m?.decision && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] px-1 text-warn" title="Decision point">
                        <Diamond size={10} aria-hidden /> decision
                      </span>
                    )}
                    {m?.effects.length ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-[color-mix(in_srgb,var(--c-data)_14%,transparent)] px-1 text-[color:var(--c-data)]" title={`Changes ${m.tables.join(', ')}`}>
                        <Database size={10} aria-hidden /> {m.tables.length > 1 ? `${m.tables.length} tables` : m.tables[0]}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-fg">{s.title}</span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-fg-muted">
                  <span className="truncate">{name(s.from)}</span>
                  {s.from !== s.to && (
                    <>
                      <ArrowRight size={11} className="shrink-0 text-fg-subtle" aria-hidden />
                      <span className="truncate">{name(s.to)}</span>
                    </>
                  )}
                </span>
                {s.decision && <span className="line-clamp-2 text-[11px] italic text-warn">{s.decision.question}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
