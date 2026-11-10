/**
 * Sequence diagram (SVG): one lane per participant, one row per step. Used at
 * full size by Scenario Theater and as a compact widget elsewhere.
 */
import { memo, useMemo } from 'react';
import type { ScenarioStep, StepKind } from '@/model';
import { useModel } from '@/state/hooks';
import { entityColor } from '@/ui/kinds';

export const STEP_COLOR: Record<StepKind, string> = {
  ui: 'var(--k-page)',
  client: 'var(--k-page)',
  request: 'var(--c-http)',
  response: 'var(--c-http)',
  guard: 'var(--c-security)',
  validate: 'var(--warn)',
  call: 'var(--c-call)',
  decision: 'var(--warn)',
  'db-read': 'var(--c-data)',
  'db-write': 'var(--c-data)',
  event: 'var(--c-realtime)',
  state: 'var(--k-feature)',
  note: 'var(--fg-subtle)',
};

export const STEP_LABEL: Record<StepKind, string> = {
  ui: 'User action',
  client: 'Client code',
  request: 'HTTP request',
  response: 'HTTP response',
  guard: 'Guard',
  validate: 'Validation',
  call: 'Call',
  decision: 'Decision',
  'db-read': 'DB read',
  'db-write': 'DB write',
  event: 'Real-time event',
  state: 'Outcome',
  note: 'Note',
};

export interface SequenceDiagramProps {
  participants: string[];
  steps: ScenarioStep[];
  /** Index of the current step; steps after it are drawn faded. -1 = nothing run yet. Omit to draw everything solid. */
  activeIndex?: number;
  onStepClick?: (index: number) => void;
  onParticipantClick?: (id: string) => void;
  /** Lane width in px (default 150). */
  laneWidth?: number;
  rowHeight?: number;
  compact?: boolean;
  /** Entity ids to spotlight; others fade. */
  spotlight?: string[];
  className?: string;
}

const HEAD_H = 46;

function wrapName(name: string, max: number): string[] {
  if (name.length <= max) return [name];
  const words = name.split(/(?<=[\s/.#:])/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > max && cur) {
      lines.push(cur.trim());
      cur = w;
    } else cur += w;
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > 2) return [lines[0], `${lines.slice(1).join('').slice(0, max - 1)}…`];
  return lines;
}

export const SequenceDiagram = memo(function SequenceDiagram({
  participants,
  steps,
  activeIndex,
  onStepClick,
  onParticipantClick,
  laneWidth = 150,
  rowHeight = 44,
  compact,
  spotlight,
  className,
}: SequenceDiagramProps) {
  const model = useModel();
  const lanes = useMemo(() => participants.map((id) => ({ id, entity: model.entity(id) })), [participants, model]);
  const xOf = (id: string) => {
    const i = participants.indexOf(id);
    return (i < 0 ? 0 : i) * laneWidth + laneWidth / 2;
  };
  const width = Math.max(laneWidth, participants.length * laneWidth);
  const height = HEAD_H + steps.length * rowHeight + 26;
  const boxW = Math.min(laneWidth - 14, 136);
  const fontSize = compact ? 10 : 11;
  const hasActive = activeIndex !== undefined;
  const spot = spotlight?.length ? new Set(spotlight) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Sequence diagram"
      className={className}
      data-testid="sequence-diagram"
      style={{ display: 'block' }}
    >
      <defs>
        <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
        </marker>
        <marker id="seq-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" />
        </marker>
      </defs>

      {/* Lifelines */}
      {lanes.map(({ id, entity }) => {
        const x = xOf(id);
        const color = entity ? entityColor(entity) : 'var(--fg-subtle)';
        const dim = spot && !spot.has(id);
        const hypo = entity?.confidence === 'hypothetical';
        const lines = wrapName(entity?.name ?? id, Math.floor(boxW / (fontSize * 0.56)));
        return (
          <g key={id} opacity={dim ? 0.3 : 1} data-lane={id}>
            <line x1={x} y1={HEAD_H} x2={x} y2={height - 8} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 4" />
            <g
              className={onParticipantClick ? 'cursor-pointer' : undefined}
              onClick={() => onParticipantClick?.(id)}
              role={onParticipantClick ? 'button' : undefined}
              tabIndex={onParticipantClick ? 0 : undefined}
              aria-label={entity?.name ?? id}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onParticipantClick?.(id)}
            >
              <rect
                x={x - boxW / 2}
                y={4}
                width={boxW}
                height={HEAD_H - 10}
                rx={7}
                fill={`color-mix(in srgb, ${color} 11%, var(--surface))`}
                stroke={`color-mix(in srgb, ${color} 55%, var(--line))`}
                strokeWidth={1.2}
                strokeDasharray={hypo ? '5 3' : undefined}
              />
              <rect x={x - boxW / 2} y={4} width={4} height={HEAD_H - 10} rx={2} fill={color} />
              {lines.map((l, i) => (
                <text key={i} x={x + 2} y={(lines.length === 1 ? 26 : 19) + i * 12} textAnchor="middle" style={{ fontSize, fontWeight: 600, fill: 'var(--fg)' }}>
                  {l}
                </text>
              ))}
            </g>
          </g>
        );
      })}

      {/* Messages */}
      {steps.map((s, i) => {
        const y = HEAD_H + i * rowHeight + rowHeight * 0.62;
        const x1 = xOf(s.from);
        const x2 = xOf(s.to);
        const self = s.from === s.to;
        const color = s.hypothetical || s.confidence === 'hypothetical' ? 'var(--k-hypo)' : STEP_COLOR[s.kind];
        const state = !hasActive ? 'done' : i < activeIndex! ? 'done' : i === activeIndex ? 'active' : 'future';
        const dim = (spot && !spot.has(s.from) && !spot.has(s.to)) || state === 'future';
        const dashed = s.kind === 'response' || s.kind === 'event' || s.hypothetical || s.confidence === 'hypothetical';
        const label = s.label.length > (compact ? 26 : 44) ? `${s.label.slice(0, compact ? 25 : 43)}…` : s.label;
        const midX = self ? x1 + 30 : (x1 + x2) / 2;
        const textAnchor = self ? 'start' : 'middle';
        return (
          <g
            key={s.id}
            opacity={dim ? 0.28 : 1}
            className={onStepClick ? 'cursor-pointer' : undefined}
            onClick={() => onStepClick?.(i)}
            role={onStepClick ? 'button' : undefined}
            tabIndex={onStepClick ? 0 : undefined}
            aria-label={`Step ${i + 1}: ${s.title}`}
            aria-current={state === 'active' ? 'step' : undefined}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onStepClick?.(i)}
            data-step={s.id}
            data-state={state}
          >
            <rect x={0} y={HEAD_H + i * rowHeight} width={width} height={rowHeight} fill={state === 'active' ? `color-mix(in srgb, ${color} 9%, transparent)` : 'transparent'} />
            <text x={6} y={y + 3} style={{ fontSize: 9.5, fontWeight: 700, fill: state === 'active' ? color : 'var(--fg-subtle)' }}>
              {i + 1}
            </text>
            {self ? (
              <path
                d={`M ${x1} ${y - 9} h 22 a 7 7 0 0 1 7 7 v 4 a 7 7 0 0 1 -7 7 h -20`}
                fill="none"
                stroke={color}
                strokeWidth={state === 'active' ? 2.4 : 1.5}
                strokeDasharray={dashed ? '5 4' : undefined}
                markerEnd="url(#seq-arrow)"
              />
            ) : (
              <line
                x1={x1}
                y1={y}
                x2={x2 + (x2 > x1 ? -2 : 2)}
                y2={y}
                stroke={color}
                strokeWidth={state === 'active' ? 2.4 : 1.5}
                strokeDasharray={dashed ? '6 4' : undefined}
                markerEnd={s.kind === 'response' ? 'url(#seq-arrow-open)' : 'url(#seq-arrow)'}
              />
            )}
            {(s.kind === 'db-write' || s.kind === 'db-read') && !self && <circle cx={x2} cy={y} r={3.5} fill={color} />}
            {s.kind === 'decision' && <path d={`M ${x1 - 7} ${y} l 7 -7 l 7 7 l -7 7 z`} fill="var(--surface)" stroke={color} strokeWidth={1.6} />}
            <text
              x={midX}
              y={self ? y + 2 : y - 6}
              textAnchor={textAnchor}
              style={{ fontSize, fontWeight: state === 'active' ? 700 : 500, fill: state === 'active' ? 'var(--fg)' : 'var(--fg-muted)', paintOrder: 'stroke', stroke: 'var(--canvas)', strokeWidth: 3.5, strokeLinejoin: 'round' }}
              className="font-mono"
            >
              {label}
            </text>
            {state === 'active' && !self && (
              <circle r={4.5} fill={color}>
                <animate attributeName="cx" from={x1} to={x2} dur="0.9s" repeatCount="indefinite" />
                <animate attributeName="cy" from={y} to={y} dur="0.9s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="0.9s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
});
