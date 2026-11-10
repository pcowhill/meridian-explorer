/**
 * Sequence view: one lane per active participant, one row per visible step.
 * Lane headers are sticky (HTML) above an SVG body; the current row is
 * emphasised and auto-scrolled into view, and — unless the viewer prefers
 * reduced motion — a token travels along the current message.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import type { ScenarioStep } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { cn, Tip } from '@/ui/primitives';
import { entityColor, KindIcon } from '@/ui/kinds';
import { STEP_COLOR, STEP_LABEL } from '@/viewers/SequenceDiagram';
import { useTheater } from './context';
import { breakable, isHypoStep, type StepMark } from './logic';
import { useElementSize } from './useElementSize';

const HEAD = 58;

const ROW = 46;
const GUTTER = 40;

export function SequenceView() {
  const { steps, participants, index, go, reduced, marks } = useTheater();
  const scroller = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(scroller);
  const laneW = useMemo(() => {
    const avail = Math.max(0, width - GUTTER - 12);
    return Math.max(124, Math.min(210, participants.length ? avail / participants.length : 200));
  }, [width, participants.length]);
  const totalW = Math.max(width, GUTTER + participants.length * laneW + 12);

  // Keep the current row (and its arrow) in view.
  useEffect(() => {
    const el = scroller.current;
    const step = steps[index];
    if (!el || !step) return;
    const top = HEAD + index * ROW;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    let nextTop = el.scrollTop;
    if (top < el.scrollTop + HEAD || top + ROW > el.scrollTop + el.clientHeight) nextTop = Math.max(0, top - el.clientHeight / 3);
    const xs = [participants.indexOf(step.from), participants.indexOf(step.to)].map((i) => GUTTER + Math.max(0, i) * laneW + laneW / 2);
    const lo = Math.min(...xs) - laneW / 2;
    const hi = Math.max(...xs) + laneW / 2;
    let nextLeft = el.scrollLeft;
    if (lo < el.scrollLeft || hi > el.scrollLeft + el.clientWidth) nextLeft = Math.max(0, (lo + hi) / 2 - el.clientWidth / 2);
    if (nextTop !== el.scrollTop || nextLeft !== el.scrollLeft) el.scrollTo?.({ top: nextTop, left: nextLeft, behavior });
  }, [index, steps, participants, laneW, reduced]);

  return (
    <div ref={scroller} className="relative h-full overflow-auto bg-canvas" data-testid="sequence-view">
      <div style={{ width: totalW, minHeight: '100%' }} className="relative">
        <LaneHeaders participants={participants} laneW={laneW} current={steps[index]} />
        <Rows steps={steps} participants={participants} laneW={laneW} width={totalW} index={index} go={go} reduced={reduced} marks={marks} />
      </div>
    </div>
  );
}

function LaneHeaders({ participants, laneW, current }: { participants: string[]; laneW: number; current: ScenarioStep | undefined }) {
  const model = useModel();
  const selectEntity = useApp((s) => s.selectEntity);
  const selection = useApp((s) => s.selection);
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-[color-mix(in_srgb,var(--canvas)_92%,transparent)] backdrop-blur-sm" style={{ height: HEAD }}>
      {participants.map((id, i) => {
        const e = model.entity(id);
        const color = e ? entityColor(e) : 'var(--fg-subtle)';
        const active = current && (current.from === id || current.to === id);
        const selected = selection?.type === 'entity' && selection.id === id;
        return (
          <div key={id} className="absolute top-[7px]" style={{ left: GUTTER + i * laneW + 7, width: laneW - 14 }}>
          <Tip label={e ? `${e.name} — ${e.summary}` : `${id} (not in the model)`} side="bottom" className="w-full">
            <button
              type="button"
              onClick={() => selectEntity(id, { openInspector: true })}
              data-lane={id}
              aria-label={`${e?.name ?? id} — select to inspect`}
              className={cn(
                'flex h-[44px] w-full items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left transition-[box-shadow,border-color]',
                e?.confidence === 'hypothetical' && 'border-dashed',
                !e && 'border-dashed',
                active && 'shadow-[0_0_0_2px_var(--accent)]',
                selected && 'ring-2 ring-offset-1 ring-offset-canvas ring-fg-subtle',
              )}
              style={{
                borderColor: `color-mix(in srgb, ${color} 50%, var(--line))`,
                background: `color-mix(in srgb, ${color} 10%, var(--surface))`,
              }}
            >
              <span className="h-full w-[3px] shrink-0 rounded-full" style={{ background: color }} />
              {e && <KindIcon kind={e.kind} size={13} className="shrink-0" />}
              <span className={cn('line-clamp-2 min-w-0 break-words text-[11.5px] font-semibold leading-tight', e ? 'text-fg' : 'font-mono text-fg-subtle')}>{breakable(e?.name ?? id)}</span>
            </button>
          </Tip>
          </div>
        );
      })}
    </div>
  );
}

interface RowsProps {
  steps: ScenarioStep[];
  participants: string[];
  laneW: number;
  width: number;
  index: number;
  go: (i: number) => void;
  reduced: boolean;
  marks: StepMark[];
}

const Rows = memo(function Rows({ steps, participants, laneW, width, index, go, reduced, marks }: RowsProps) {
  const height = steps.length * ROW + 24;
  const xOf = (id: string) => GUTTER + Math.max(0, participants.indexOf(id)) * laneW + laneW / 2;
  return (
    <svg width={width} height={height} className="block" role="list" aria-label="Steps">
      <defs>
        <marker id="th-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
        </marker>
        <marker id="th-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" />
        </marker>
      </defs>
      {participants.map((id) => (
        <line key={id} x1={xOf(id)} x2={xOf(id)} y1={0} y2={height} stroke="var(--line-strong)" strokeDasharray="3 4" />
      ))}
      {steps.map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'future';
        const hypo = isHypoStep(s);
        const color = hypo ? 'var(--k-hypo)' : STEP_COLOR[s.kind];
        const yTop = i * ROW;
        const y = yTop + ROW * 0.62;
        const x1 = xOf(s.from);
        const x2 = xOf(s.to);
        const self = s.from === s.to;
        const dashed = s.kind === 'response' || s.kind === 'event' || hypo;
        const span = self ? laneW - 40 : Math.abs(x2 - x1) - 16;
        const maxChars = Math.max(12, Math.floor(span / 6.6));
        const label = s.label.length > maxChars ? `${s.label.slice(0, maxChars - 1)}…` : s.label;
        const active = state === 'active';
        return (
          <g
            key={s.id}
            role="listitem"
            tabIndex={-1}
            onClick={() => go(i)}
            className="cursor-pointer"
            opacity={state === 'future' ? 0.32 : 1}
            data-step={s.id}
            data-state={state}
            aria-current={active ? 'step' : undefined}
            aria-label={`Step ${i + 1}: ${s.title}`}
          >
            <title>{`${i + 1}. ${s.title} — ${STEP_LABEL[s.kind]}${s.label !== label ? `\n${s.label}` : ''}`}</title>
            <rect x={0} y={yTop} width={width} height={ROW} fill={active ? `color-mix(in srgb, ${color} 11%, transparent)` : 'transparent'} className={active ? undefined : 'hover:fill-[color-mix(in_srgb,var(--fg)_4%,transparent)]'} />
            {active && <rect x={0} y={yTop} width={3} height={ROW} fill={color} />}
            <text x={GUTTER - 10} y={y + 3.5} textAnchor="end" style={{ fontSize: 10, fontWeight: 700, fill: active ? color : 'var(--fg-subtle)' }}>
              {i + 1}
            </text>
            {self ? (
              <path
                d={`M ${x1} ${y - 9} h 22 a 7 7 0 0 1 7 7 v 4 a 7 7 0 0 1 -7 7 h -20`}
                fill="none"
                stroke={color}
                strokeWidth={active ? 2.4 : 1.5}
                strokeDasharray={dashed ? '5 4' : undefined}
                markerEnd="url(#th-arrow)"
              />
            ) : (
              <line
                x1={x1}
                y1={y}
                x2={x2 + (x2 > x1 ? -2 : 2)}
                y2={y}
                stroke={color}
                strokeWidth={active ? 2.6 : 1.5}
                strokeDasharray={dashed ? '6 4' : undefined}
                markerEnd={s.kind === 'response' ? 'url(#th-arrow-open)' : 'url(#th-arrow)'}
              />
            )}
            {marks[i]?.db && <rect x={x2 - 4} y={y - 4} width={8} height={8} rx={1.5} fill={STEP_COLOR['db-write']} stroke="var(--canvas)" strokeWidth={1.5} />}
            {marks[i]?.decision && <path d={`M ${x1 - 8} ${y} l 8 -8 l 8 8 l -8 8 z`} fill="var(--surface)" stroke={color} strokeWidth={1.8} />}
            <text
              x={self ? x1 + 34 : (x1 + x2) / 2}
              y={self ? y + 3 : y - 7}
              textAnchor={self ? 'start' : 'middle'}
              className="font-mono"
              style={{
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                fill: active ? 'var(--fg)' : 'var(--fg-muted)',
                paintOrder: 'stroke',
                stroke: 'var(--canvas)',
                strokeWidth: 4,
                strokeLinejoin: 'round',
              }}
            >
              {label}
            </text>
            {active && !reduced && !self && (
              <circle key={`tok-${s.id}`} r={5} fill={color} stroke="var(--canvas)" strokeWidth={1.5}>
                <animate attributeName="cx" from={x1} to={x2} dur="1.1s" repeatCount="indefinite" />
                <animate attributeName="cy" from={y} to={y} dur="1.1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur="1.1s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
});
