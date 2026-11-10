/**
 * Transport bar: restart / previous / play-pause / next, speed, pause-at-
 * decisions, a scrubber with one tick per visible step (decision and
 * database ticks are distinguishable), the step counter, the outcome
 * selector and the paths overview.
 */
import { useCallback, useMemo, useRef } from 'react';
import { Diamond, GitBranch, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useApp } from '@/state/app';
import { cn, IconButton, Popover, Segmented } from '@/ui/primitives';
import { OUTCOME_COLOR, OUTCOME_LABEL, useTheater } from './context';
import { pathsOverview, SPEEDS } from './logic';
import { useElementSize } from './useElementSize';

interface Props {
  playing: boolean;
  onPlayPause: () => void;
  pauseAtDecisions: boolean;
  onPauseAtDecisions: (v: boolean) => void;
}

export function Transport({ playing, onPlayPause, pauseAtDecisions, onPauseAtDecisions }: Props) {
  const { steps, index, go, scenario, variant, switchVariant } = useTheater();
  const speed = useApp((s) => s.theater.speed);
  const setSpeed = useApp((s) => s.theaterSetSpeed);
  const last = steps.length - 1;
  const current = scenario.variants.find((v) => v.id === variant);
  const bar = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(bar);
  // Narrow: controls + counter + outcome on one row, the scrubber on its own full-width row.
  const twoRows = width > 0 && width < 960;

  const speedControls = (
      <div className="flex items-center gap-1.5">
        <Segmented
          size="sm"
          label="Playback speed"
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, title: s === 1 ? 'Normal speed' : s < 1 ? 'Slower' : 'Faster', keys: ', .' }))}
        />
        <IconButton label={pauseAtDecisions ? 'Pausing at decisions — click to play through' : 'Playing through decisions — click to pause at them'} tipSide="top" size="sm" active={pauseAtDecisions} onClick={() => onPauseAtDecisions(!pauseAtDecisions)}>
          <Diamond size={13} />
        </IconButton>
      </div>
  );

  return (
    <div ref={bar} className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-surface px-3 py-2', twoRows && 'gap-x-2')} data-testid="transport">
      <div className="flex items-center gap-0.5">
        <IconButton label="Restart" keys="Home" tipSide="top" onClick={() => go(0)} disabled={index === 0}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Previous step" keys="←" tipSide="top" onClick={() => go(index - 1)} disabled={index === 0}>
          <SkipBack size={15} />
        </IconButton>
        <IconButton label={playing ? 'Pause' : 'Play'} keys="Space" tipSide="top" variant="default" className="h-9! w-9! border-accent! bg-accent! text-accent-fg! hover:brightness-110" onClick={onPlayPause}>
          {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-[1px]" />}
        </IconButton>
        <IconButton label="Next step" keys="→" tipSide="top" onClick={() => go(index + 1)} disabled={index >= last}>
          <SkipForward size={15} />
        </IconButton>
      </div>

      {!twoRows && speedControls}

      {!twoRows && <Scrubber />}

      <div className={cn('flex min-w-0 items-center gap-2', twoRows && 'ml-auto')}>
        <span className="whitespace-nowrap font-mono text-[12px] font-semibold tabular-nums text-fg" data-testid="step-counter" aria-live="polite">
          Step {Math.min(index + 1, steps.length)} of {steps.length}
        </span>
        {scenario.variants.length > 1 && (
          <>
            <label className="sr-only" htmlFor="th-variant">
              Outcome
            </label>
            <select
              id="th-variant"
              data-testid="variant-select"
              value={variant}
              onChange={(e) => switchVariant(e.target.value)}
              title="Outcome (O cycles)"
              className={cn(
                'h-7 min-w-0 max-w-[320px] rounded-md border bg-surface pl-1.5 pr-6 text-[12px] font-medium text-fg focus:border-accent focus:outline-none',
                current?.hypothetical ? 'border-dashed border-hypo text-hypo' : 'border-line',
              )}
              style={{ borderLeft: `3px solid ${current?.hypothetical ? 'var(--k-hypo)' : OUTCOME_COLOR[current?.outcome ?? 'info']}` }}
            >
              {scenario.variants.map((v) => (
                <option key={v.id} value={v.id} data-variant={v.id}>
                  {optionText(v.label, v.outcome, v.hypothetical)}
                </option>
              ))}
            </select>
            <PathsButton />
          </>
        )}
      </div>
      {twoRows && (
        <div className="flex basis-full items-center gap-2">
          {speedControls}
          <Scrubber />
        </div>
      )}
    </div>
  );
}

/** "Label — outcome", without repeating the outcome when the label already says it. */
function optionText(label: string, outcome: string | undefined, hypothetical: boolean | undefined): string {
  const o = outcome ? OUTCOME_LABEL[outcome] : '';
  const stem = o.slice(0, 5).toLowerCase();
  const suffix = o && !label.toLowerCase().includes(stem) ? ` — ${o}` : '';
  return `${label}${suffix}${hypothetical ? ' (hypothetical)' : ''}`;
}

function Scrubber() {
  const { steps, index, go, marks } = useTheater();
  const track = useRef<HTMLDivElement>(null);
  const n = steps.length;
  const toIndex = useCallback(
    (clientX: number) => {
      const r = track.current?.getBoundingClientRect();
      if (!r || n === 0) return 0;
      return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
    },
    [n],
  );
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    go(toIndex(e.clientX));
    const move = (ev: PointerEvent) => go(toIndex(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = n > 1 ? (index + 0.5) / n : 0.5;
  return (
    <div className="min-w-[160px] flex-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Scrub through the steps"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={index + 1}
        aria-valuetext={steps[index] ? `Step ${index + 1}: ${steps[index].title}` : undefined}
        onPointerDown={onDown}
        className="th-scrubber relative h-7 cursor-pointer select-none rounded-md"
        data-testid="scrubber"
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-surface-3" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent" style={{ width: `${pct * 100}%` }} />
        {steps.map((s, i) => {
          const m = marks[i];
          const left = `${((i + 0.5) / n) * 100}%`;
          const done = i <= index;
          return (
            <span key={s.id} className="pointer-events-none absolute top-1/2" style={{ left }} data-tick={i} data-decision={m?.decision || undefined} data-db={m?.db || undefined}>
              {m?.decision ? (
                <span className="absolute -translate-x-1/2 -translate-y-1/2 rotate-45 border-[1.5px] border-warn" style={{ width: 8, height: 8, background: done ? 'var(--warn)' : 'var(--surface)' }} />
              ) : (
                <span className={cn('absolute h-[9px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full', done ? 'bg-accent' : 'bg-line-strong')} />
              )}
              {m?.db && <span className="absolute h-[5px] w-[5px] -translate-x-1/2 translate-y-[7px] rounded-[1px] bg-[color:var(--c-data)]" />}
            </span>
          );
        })}
        <span
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow"
          style={{ left: `${pct * 100}%`, transition: 'left 150ms ease-out' }}
        />
      </div>
    </div>
  );
}

function PathsButton() {
  const { scenario, variant, switchVariant } = useTheater();
  const detail = useApp((s) => s.detail);
  const rows = useMemo(() => pathsOverview(scenario, detail), [scenario, detail]);
  const max = Math.max(1, ...rows.map((r) => r.cells.length));
  return (
    <Popover
      side="top"
      align="end"
      className="w-[420px] max-w-[92vw] p-2"
      trigger={(p) => (
        <IconButton label="Paths: where the outcomes diverge" tipSide="top" size="sm" {...p}>
          <GitBranch size={14} />
        </IconButton>
      )}
    >
      {(close) => (
        <div data-testid="paths-overview">
          <div className="mb-1.5 px-1 text-[11.5px] text-fg-muted">

            Grey steps follow the main path (“{scenario.variants.find((v) => v.id === scenario.defaultVariant)?.label}”); coloured ones are where an outcome goes its own way. Click a row to switch.
          </div>
          <div className="flex flex-col gap-0.5">
            {rows.map((r) => {
              const v = scenario.variants.find((x) => x.id === r.variant)!;
              const color = v.hypothetical ? 'var(--k-hypo)' : OUTCOME_COLOR[v.outcome ?? 'info'];
              return (
                <button
                  key={r.variant}
                  type="button"
                  onClick={() => {
                    switchVariant(r.variant);
                    close();
                  }}
                  className={cn('flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2', r.variant === variant && 'bg-surface-2', v.hypothetical && 'border border-dashed border-hypo')}
                >
                  <span className="w-[120px] shrink-0 truncate text-[11.5px] font-medium" style={{ color: v.hypothetical ? 'var(--k-hypo)' : undefined }}>
                    {v.label}
                  </span>
                  <span className="flex h-3 min-w-0 flex-1 items-center gap-[1px]">
                    {r.cells.map((c) => (
                      <span
                        key={c.id}
                        className="h-full rounded-[1px]"
                        style={{
                          width: `${100 / max}%`,
                          background: c.shared ? 'var(--line-strong)' : c.hypothetical ? 'var(--k-hypo)' : color,
                          opacity: c.shared ? 0.7 : 1,
                        }}
                      />
                    ))}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[10.5px] text-fg-subtle">{r.cells.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}
