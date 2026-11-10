/** State-machine diagram (SVG) with clickable states and transitions. */
import { useMemo, useState } from 'react';
import type { StateMachine } from '@/model';
import { cn } from '@/ui/primitives';
import { ConfidenceBadge } from '@/ui/kinds';
import { EntityChip } from './Fields';
import { SourceView } from './CodeBlock';

interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
  terminal?: boolean;
}

const W = 112;
const H = 34;
const GAP_X = 78;
const GAP_Y = 26;

/** Layered left-to-right layout: column = shortest distance from the initial state. */
function layout(machine: StateMachine): { nodes: Placed[]; width: number; height: number } {
  const dist = new Map<string, number>([[machine.initial, 0]]);
  let frontier = [machine.initial];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier) {
      for (const t of machine.transitions) {
        if (t.from === s && !dist.has(t.to)) {
          dist.set(t.to, dist.get(s)! + 1);
          next.push(t.to);
        }
      }
    }
    frontier = next;
  }
  const maxCol = Math.max(0, ...dist.values());
  for (const s of machine.states) if (!dist.has(s.id)) dist.set(s.id, maxCol + 1);
  const cols = new Map<number, string[]>();
  for (const s of machine.states) {
    const c = dist.get(s.id)!;
    cols.set(c, [...(cols.get(c) ?? []), s.id]);
  }
  const tallest = Math.max(...[...cols.values()].map((c) => c.length));
  const height = tallest * H + (tallest - 1) * GAP_Y + 48;
  const nodes: Placed[] = [];
  for (const [c, ids] of cols) {
    const colH = ids.length * H + (ids.length - 1) * GAP_Y;
    ids.forEach((id, i) => {
      const st = machine.states.find((s) => s.id === id)!;
      nodes.push({ id, label: st.label ?? id, x: 16 + c * (W + GAP_X), y: (height - colH) / 2 + i * (H + GAP_Y), terminal: st.terminal });
    });
  }
  const width = 32 + (Math.max(...cols.keys()) + 1) * W + Math.max(...cols.keys()) * GAP_X;
  return { nodes, width, height };
}

interface Props {
  machine: StateMachine;
  /** Highlight a state (e.g. the current status of an example row). */
  current?: string | null;
  compact?: boolean;
  onPickState?: (state: string) => void;
}

export function StateMachineView({ machine, current, compact, onPickState }: Props) {
  const { nodes, width, height } = useMemo(() => layout(machine), [machine]);
  const [picked, setPicked] = useState<number | null>(null);
  const [pickedState, setPickedState] = useState<string | null>(null);
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const transition = picked !== null ? machine.transitions[picked] : null;
  const stateInfo = pickedState ? machine.states.find((s) => s.id === pickedState) : null;

  // Offset parallel/opposite transitions between the same pair so labels do not overlap.
  const pairCount = new Map<string, number>();

  return (
    <div className="rounded-lg border border-line bg-surface" data-testid="state-machine">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">{machine.name}</div>
          {machine.field && <div className="truncate font-mono text-[10.5px] text-fg-subtle">{machine.field}</div>}
        </div>
        <ConfidenceBadge confidence={machine.confidence} compact />
      </div>
      <div className="overflow-x-auto p-2">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${machine.name} state diagram`} className="mx-auto block">
          <defs>
            <marker id={`sm-arrow-${machine.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--fg-muted)" />
            </marker>
            <marker id={`sm-arrow-on-${machine.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
            </marker>
          </defs>
          {machine.transitions.map((t, i) => {
            const a = at(t.from);
            const b = at(t.to);
            if (!a || !b) return null;
            const key = [t.from, t.to].sort().join('|');
            const n = pairCount.get(key) ?? 0;
            pairCount.set(key, n + 1);
            const on = picked === i;
            let d: string;
            let lx: number;
            let ly: number;
            if (t.from === t.to) {
              const cx = a.x + W / 2;
              d = `M ${cx - 16} ${a.y} C ${cx - 30} ${a.y - 30}, ${cx + 30} ${a.y - 30}, ${cx + 16} ${a.y}`;
              lx = cx;
              ly = a.y - 24;
            } else {
              const forward = b.x >= a.x;
              const x1 = forward ? a.x + W : a.x;
              const x2 = forward ? b.x : b.x + W;
              const sameCol = Math.abs(a.x - b.x) < 1;
              const y1 = a.y + H / 2 + (sameCol ? 0 : (n % 2 === 0 ? -1 : 1) * Math.ceil(n / 2) * 7);
              const y2 = b.y + H / 2 + (sameCol ? 0 : (n % 2 === 0 ? -1 : 1) * Math.ceil(n / 2) * 7);
              if (sameCol) {
                const sx = a.x + W;
                const bend = 34 + n * 14;
                d = `M ${sx} ${a.y + H / 2} C ${sx + bend} ${a.y + H / 2}, ${sx + bend} ${b.y + H / 2}, ${sx} ${b.y + H / 2}`;
                lx = sx + bend * 0.78;
                ly = (a.y + b.y) / 2 + H / 2;
              } else {
                const bow = (forward ? -1 : 1) * (10 + n * 12) * (Math.abs(y1 - y2) < 2 ? 1 : 0.4);
                const mx = (x1 + x2) / 2;
                d = `M ${x1} ${y1} C ${mx} ${y1 + bow}, ${mx} ${y2 + bow}, ${x2} ${y2}`;
                lx = mx;
                ly = (y1 + y2) / 2 + bow * 0.75 - 4;
              }
            }
            const hypo = t.confidence === 'hypothetical';
            return (
              <g key={i} className="cursor-pointer" onClick={() => { setPicked(on ? null : i); setPickedState(null); }} role="button" tabIndex={0} aria-label={`${t.from} to ${t.to}: ${t.label}`} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(on ? null : i)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                <path d={d} fill="none" stroke={on ? 'var(--accent)' : hypo ? 'var(--k-hypo)' : 'var(--fg-muted)'} strokeWidth={on ? 2.2 : 1.3} strokeDasharray={hypo ? '5 4' : undefined} markerEnd={`url(#sm-arrow-${on ? 'on-' : ''}${machine.id})`} />
                {!compact && (
                  <text x={lx} y={ly} textAnchor="middle" className="select-none" style={{ fontSize: 9.5, fontWeight: on ? 700 : 500, fill: on ? 'var(--accent)' : 'var(--fg-muted)', paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}>
                    {t.label.length > 22 ? `${t.label.slice(0, 21)}…` : t.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const isCurrent = current === n.id;
            const isInitial = machine.initial === n.id;
            const isPicked = pickedState === n.id;
            return (
              <g
                key={n.id}
                className="cursor-pointer"
                onClick={() => {
                  setPickedState(isPicked ? null : n.id);
                  setPicked(null);
                  onPickState?.(n.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={`State ${n.label}`}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPickedState(isPicked ? null : n.id)}
                data-state={n.id}
              >
                {isInitial && <circle cx={n.x - 8} cy={n.y + H / 2} r={3.5} fill="var(--fg)" />}
                <rect
                  x={n.x}
                  y={n.y}
                  width={W}
                  height={H}
                  rx={H / 2}
                  fill={isCurrent ? 'color-mix(in srgb, var(--accent) 20%, var(--surface))' : 'var(--surface)'}
                  stroke={isCurrent || isPicked ? 'var(--accent)' : 'var(--line-strong)'}
                  strokeWidth={isCurrent || isPicked ? 2 : 1.2}
                />
                {n.terminal && <rect x={n.x + 3} y={n.y + 3} width={W - 6} height={H - 6} rx={(H - 6) / 2} fill="none" stroke={isCurrent ? 'var(--accent)' : 'var(--line-strong)'} strokeWidth={1} />}
                <text x={n.x + W / 2} y={n.y + H / 2 + 4} textAnchor="middle" className="select-none font-mono" style={{ fontSize: 11, fontWeight: 600, fill: 'var(--fg)' }}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={cn('border-t border-line px-2.5 py-2 text-[12px]', !transition && !stateInfo && 'text-fg-subtle')} aria-live="polite">
        {transition ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="font-semibold">{transition.from}</code>
              <span className="text-fg-subtle">→</span>
              <code className="font-semibold">{transition.to}</code>
              <span className="text-fg-muted">· {transition.label}</span>
              <ConfidenceBadge confidence={transition.confidence} compact />
            </div>
            {transition.description && <p className="m-0 text-fg-muted">{transition.description}</p>}
            {transition.by && (
              <div className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
                performed by <EntityChip id={transition.by} />
              </div>
            )}
            {transition.source && <SourceView source={transition.source} />}
          </div>
        ) : stateInfo ? (
          <div>
            <code className="font-semibold text-fg">{stateInfo.id}</code>
            {stateInfo.terminal && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-fg-subtle">terminal</span>}
            {machine.initial === stateInfo.id && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-fg-subtle">initial</span>}
            <p className="m-0 mt-1 text-fg-muted">{stateInfo.description ?? 'No description recorded.'}</p>
          </div>
        ) : (
          machine.summary
        )}
      </div>
    </div>
  );
}
