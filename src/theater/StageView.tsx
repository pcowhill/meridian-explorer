/**
 * Stage view: the participants as nodes grouped by application/container,
 * columns in the order they first take part. The layout depends only on the
 * visible steps, so nothing moves while stepping. Edges already used stay
 * faintly visible (the path taken accumulates); the current edge is drawn
 * bold with a travelling token; database writes pulse the table node.
 */
import { useMemo, useRef } from 'react';
import type { Entity } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { cn } from '@/ui/primitives';
import { entityColor, KindIcon } from '@/ui/kinds';
import { KIND_LABEL } from '@/model';
import { STEP_COLOR } from '@/viewers/SequenceDiagram';
import { useTheater } from './context';
import { breakable, edgeGeometry, isHypoStep, placeLabel, stageLayout } from './logic';
import { useElementSize } from './useElementSize';

const PAD = 48;

export function StageView() {
  const { steps, participants, index, reduced } = useTheater();
  const model = useModel();
  const selectEntity = useApp((s) => s.selectEntity);
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  // Quantised so tiny resizes do not re-flow the stage.
  const vw = size.width ? Math.round((size.width - PAD * 2 - 16) / 50) * 50 : 1200;
  const vh = size.height ? Math.round((size.height - PAD * 2 - 16) / 50) * 50 : 700;

  const layout = useMemo(
    () =>
      stageLayout(steps, participants, (id) => {
        const e = model.entity(id);
        if (!e) return { id: '?', label: 'Not in the model' };
        if (e.kind === 'role') return { id: 'people', label: 'People' };
        const app = model.appOf(id);
        if (!app || app.id === model.root) return { id: 'meridian', label: 'Meridian' };
        return { id: app.id, label: app.name };
      }, { width: vw, height: vh }),
    [steps, participants, model, vw, vh],
  );

  // One edge per ordered pair; both directions get their own lane.
  const edges = useMemo(() => {
    const first = new Map<string, number>();
    steps.forEach((s, i) => {
      const k = `${s.from}→${s.to}`;
      if (!first.has(k)) first.set(k, i);
    });
    return [...first.entries()].map(([k, i]) => {
      const s = steps[i];
      const reverse = first.has(`${s.to}→${s.from}`) && s.from !== s.to;
      const a = layout.nodes.get(s.from);
      const b = layout.nodes.get(s.to);
      const geo = a && b ? edgeGeometry(a, b, reverse ? (s.from < s.to ? -1 : 1) : 0) : null;
      return { key: k, from: s.from, to: s.to, geo };
    });
  }, [steps, layout]);

  const used = useMemo(() => {
    const set = new Map<string, { hypo: boolean; color: string }>();
    for (let i = 0; i < index; i++) {
      const s = steps[i];
      const hypo = isHypoStep(s);
      set.set(`${s.from}→${s.to}`, { hypo, color: hypo ? 'var(--k-hypo)' : STEP_COLOR[s.kind] });
    }
    return set;
  }, [steps, index]);

  const involved = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i <= index && i < steps.length; i++) set.add(steps[i].from).add(steps[i].to);
    return set;
  }, [steps, index]);

  const current = steps[index];
  const curKey = current ? `${current.from}→${current.to}` : '';
  const curEdge = edges.find((e) => e.key === curKey);
  const curColor = current ? (isHypoStep(current) ? 'var(--k-hypo)' : STEP_COLOR[current.kind]) : 'var(--accent)';

  const labelPos = useMemo(() => {
    if (!curEdge?.geo || !current) return null;
    const w = Math.min(260, current.label.length * 6.7 + 18);
    return { ...placeLabel(curEdge.geo.mx, curEdge.geo.my, w, 22, layout.nodes.values()), w };
  }, [curEdge, current, layout]);

  const cw = layout.width + PAD * 2;
  const ch = layout.height + PAD * 2;
  const scale = size.width && size.height ? Math.max(0.45, Math.min(1.2, (size.width - 16) / cw, (size.height - 16) / ch)) : 1;

  return (
    <div ref={box} className="relative h-full overflow-auto bg-canvas" data-testid="stage-view" style={{ backgroundImage: 'radial-gradient(var(--grid-dot) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <div className="flex min-h-full min-w-full items-center justify-center p-2">
        <div style={{ width: cw * scale, height: ch * scale }} className="relative shrink-0">
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: cw, height: ch, transform: `scale(${scale})` }}>
            {layout.groups.map((g) => (
              <div
                key={g.id}
                className="absolute rounded-xl border border-line bg-[color-mix(in_srgb,var(--surface)_70%,transparent)]"
                style={{ left: g.x + PAD, top: g.y + PAD, width: g.w, height: g.h }}
                data-group={g.id}
              >
                <div className="truncate px-3 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{g.label}</div>
              </div>
            ))}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={cw} height={ch} aria-hidden>
              <defs>
                <marker id="stage-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              <g transform={`translate(${PAD} ${PAD})`}>
                {edges.map((e) => {
                  const u = used.get(e.key);
                  if (!u || !e.geo || e.key === curKey) return null;
                  return <path key={e.key} d={e.geo.d} fill="none" stroke={u.color} strokeOpacity={0.3} strokeWidth={1.25} strokeDasharray={u.hypo ? '5 4' : undefined} markerEnd="url(#stage-arrow)" />;
                })}
                {curEdge?.geo && current && (
                  <g>
                    <path d={curEdge.geo.d} fill="none" stroke={curColor} strokeWidth={3.2} strokeDasharray={isHypoStep(current) ? '7 5' : undefined} markerEnd="url(#stage-arrow)" />
                    {!reduced && (
                      <>
                        <path d={curEdge.geo.d} fill="none" stroke="var(--canvas)" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="4 8" style={{ animation: 'dash-flow 0.7s linear infinite' }} />
                        <circle key={`tok-${current.id}`} r={6} fill={curColor} stroke="var(--canvas)" strokeWidth={2}>
                          <animateMotion dur="1.2s" repeatCount="indefinite" path={curEdge.geo.d} />
                        </circle>
                      </>
                    )}
                  </g>
                )}
              </g>
            </svg>
            {[...layout.nodes.values()].map((n) => (
              <StageNodeBox
                key={n.id}
                id={n.id}
                entity={model.entity(n.id)}
                x={n.x + PAD}
                y={n.y + PAD}
                w={n.w}
                h={n.h}
                active={!!current && (current.from === n.id || current.to === n.id)}
                target={!!current && current.to === n.id}
                involved={involved.has(n.id)}
                pulse={!!current && current.kind === 'db-write' && current.to === n.id && !reduced}
                onClick={() => selectEntity(n.id, { openInspector: true })}
              />
            ))}
            {labelPos && current && (
              <div
                className="pointer-events-none absolute z-10 truncate rounded-md border bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg shadow-panel"
                style={{ left: labelPos.x + PAD, top: labelPos.y + PAD, maxWidth: labelPos.w, transform: 'translate(-50%, -50%)', borderColor: curColor }}
                data-testid="stage-edge-label"
              >
                {current.label}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageNodeBox({
  id,
  entity,
  x,
  y,
  w,
  h,
  active,
  target,
  involved,
  pulse,
  onClick,
}: {
  id: string;
  entity: Entity | undefined;
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
  target: boolean;
  involved: boolean;
  pulse: boolean;
  onClick: () => void;
}) {
  const color = entity ? entityColor(entity) : 'var(--fg-subtle)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={entity ? `${entity.name} — ${entity.summary}` : `${id} (not in the model)`}
      aria-label={`${entity?.name ?? id} — select to inspect`}
      data-node={id}
      data-active={active || undefined}
      className={cn(
        'absolute z-[5] flex items-center gap-2 rounded-lg border px-2 text-left transition-[opacity,box-shadow] duration-200',
        (!entity || entity.confidence === 'hypothetical') && 'border-dashed',
        entity?.confidence === 'hypothetical' && 'hypothetical',
        pulse && 'th-pulse',
      )}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: involved ? 1 : 0.42,
        borderColor: active ? color : `color-mix(in srgb, ${color} 45%, var(--line))`,
        borderWidth: active ? 2 : 1,
        background: active ? `color-mix(in srgb, ${color} 18%, var(--surface))` : `color-mix(in srgb, ${color} 7%, var(--surface))`,
        boxShadow: target ? `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
      }}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
        {entity ? <KindIcon kind={entity.kind} size={13} /> : '?'}
      </span>
      <span className="min-w-0">
        <span className={cn('line-clamp-2 break-words text-[11.5px] font-semibold leading-tight', entity ? 'text-fg' : 'font-mono text-fg-subtle')}>{breakable(entity?.name ?? id)}</span>
        {entity && <span className="block truncate text-[9.5px] uppercase tracking-wide text-fg-subtle">{KIND_LABEL[entity.kind]}</span>}
      </span>
    </button>
  );
}
