/**
 * The one Studio edge type: floating (attaches to the nearest point of each
 * node's box), with line style, arrowheads, channel/explicit colour, number
 * badge, editable label, parallel-edge offsets and the path-animation token.
 * Whether a line between two entities is a known fact, hypothetical or
 * not-in-Meridian is computed live from the model, never trusted from data.
 */
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode, useStore, type EdgeProps, type InternalNode } from '@xyflow/react';
import { useModel } from '@/state/hooks';
import { cn } from '@/ui/primitives';
import { edgeStatus, type EdgeStatus } from '../logic/modelEdges';
import { useStudio } from '../store';
import { dashArray, edgeColor } from '../style';
import type { EdgeData, SEdge, SNode } from '../types';
import { selectEdge } from '../interactions';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(n: InternalNode<SNode>): Box {
  const p = n.internals.positionAbsolute;
  return { x: p.x, y: p.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 };
}

/** Where the line from the box centre towards `p` leaves the box. */
export function borderPoint(b: Box, p: { x: number; y: number }, pad = 2): { x: number; y: number; side: Position } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy, side: Position.Right };
  const hw = b.w / 2 + pad;
  const hh = b.h / 2 + pad;
  const s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  const x = cx + dx * s;
  const y = cy + dy * s;
  const side = Math.abs(dx) / hw > Math.abs(dy) / hh ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x, y, side };
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const STATUS_TEXT: Record<EdgeStatus, string> = {
  known: 'Known relationship',
  hypothetical: 'Hypothetical',
  unverified: 'Not in Meridian',
  free: 'Annotation',
};

export const StudioEdge = memo(function StudioEdge({ id, source, target, data, selected }: EdgeProps<SEdge>) {
  const model = useModel();
  const sn = useInternalNode<SNode>(source);
  const tn = useInternalNode<SNode>(target);
  const d: EdgeData = data ?? {};
  const parallel = useStore((s) => {
    const sibs = s.edges.filter((e) => !e.hidden && ((e.source === source && e.target === target) || (e.source === target && e.target === source)));
    return `${sibs.findIndex((e) => e.id === id)}|${sibs.length}|${sibs.findIndex((e) => e.id === id) >= 0 && sibs[0].source === source ? 1 : -1}`;
  });
  const dim = useStudio((s) => (s.focus ? !s.focus.edgeIds.includes(id) : false));
  const emphasised = useStudio((s) => s.focus?.mode === 'path' && s.focus.edgeIds.includes(id));
  const editing = useStudio((s) => s.editingEdgeId === id);
  const hop = useStudio((s) => {
    const a = s.anim;
    if (!a || a.index < 1) return null;
    if (a.edges[a.index - 1] !== id) return null;
    return { key: a.index, reverse: a.nodes[a.index - 1] !== source };
  });
  const visited = useStudio((s) => !!s.anim && s.anim.edges.slice(0, s.anim.index).includes(id));

  const ea = sn?.type === 'entity' ? (sn.data as { entityId?: string }).entityId : undefined;
  const eb = tn?.type === 'entity' ? (tn.data as { entityId?: string }).entityId : undefined;
  const status = useMemo(() => edgeStatus(model, ea, eb, data), [model, ea, eb, data]);

  if (!sn || !tn || sn.hidden || tn.hidden) return null;

  const [idxS, countS, dirS] = parallel.split('|').map(Number);
  const offset = countS > 1 ? (idxS - (countS - 1) / 2) * 34 * dirS : 0;
  const a = boxOf(sn);
  const b = boxOf(tn);
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const len = Math.hypot(bc.x - ac.x, bc.y - ac.y) || 1;
  const nx = -(bc.y - ac.y) / len;
  const ny = (bc.x - ac.x) / len;
  const routing = d.routing ?? 'straight';
  const bend = routing === 'curved' ? offset || len * 0.18 : offset;
  const ctrl = { x: (ac.x + bc.x) / 2 + nx * bend * 2, y: (ac.y + bc.y) / 2 + ny * bend * 2 };

  let path: string;
  let lx: number;
  let ly: number;
  if (routing === 'step') {
    const sp = borderPoint(a, bc, 0);
    const tp = borderPoint(b, ac, 0);
    [path, lx, ly] = getSmoothStepPath({ sourceX: sp.x, sourceY: sp.y, sourcePosition: sp.side, targetX: tp.x, targetY: tp.y, targetPosition: tp.side, borderRadius: 10, offset: 18 + Math.abs(offset) });
  } else if (bend) {
    const sp = borderPoint(a, ctrl);
    const tp = borderPoint(b, ctrl);
    path = `M ${sp.x} ${sp.y} Q ${ctrl.x} ${ctrl.y} ${tp.x} ${tp.y}`;
    lx = 0.25 * sp.x + 0.5 * ctrl.x + 0.25 * tp.x;
    ly = 0.25 * sp.y + 0.5 * ctrl.y + 0.25 * tp.y;
  } else {
    const sp = borderPoint(a, bc);
    const tp = borderPoint(b, ac);
    path = `M ${sp.x} ${sp.y} L ${tp.x} ${tp.y}`;
    lx = (sp.x + tp.x) / 2;
    ly = (sp.y + tp.y) / 2;
  }

  const hypo = status === 'hypothetical' || status === 'unverified' || !!d.proposed;
  const color = hypo ? 'var(--k-hypo)' : edgeColor(d.color, status === 'known' ? d.channel : undefined);
  const width = emphasised ? 3.2 : selected ? 2.4 : 1.6;
  const style = hypo && (!d.strokeStyle || d.strokeStyle === 'solid') ? 'dashed' : d.strokeStyle;
  const dash = d.animated && (!style || style === 'solid') ? `${width * 4} ${width * 3}` : dashArray(style, width);
  const arrow = d.arrow ?? 'end';
  const markerId = `sm-${id}`;
  const showChip = status === 'unverified' || status === 'hypothetical' || (d.proposed && status !== 'free');
  const label = d.label;

  return (
    <g data-testid="studio-edge" data-edge-id={id} data-status={status} className={cn('transition-opacity duration-200', dim && 'opacity-[0.12]')}>
      <defs>
        <marker id={`${markerId}-end`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0 L10 5 L0 10 z" style={{ fill: color }} transform="scale(1)" />
        </marker>
      </defs>
      {(selected || emphasised || visited) && <path d={path} fill="none" style={{ stroke: emphasised || visited ? color : 'var(--accent)', strokeOpacity: 0.22, strokeWidth: width + 7 }} />}
      <path d={path} fill="none" className="react-flow__edge-interaction" style={{ strokeOpacity: 0, strokeWidth: 20 }} />
      <path
        d={path}
        fill="none"
        className="react-flow__edge-path"
        style={{ stroke: color, strokeWidth: width, strokeDasharray: dash, animation: d.animated ? 'dash-flow 0.7s linear infinite' : undefined }}
        markerEnd={arrow === 'end' || arrow === 'both' ? `url(#${markerId}-end)` : undefined}
        markerStart={arrow === 'start' || arrow === 'both' ? `url(#${markerId}-end)` : undefined}
      />
      {hop && <Token key={hop.key} path={path} reverse={hop.reverse} color={color} />}
      {(label || d.order !== undefined || showChip || editing) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex max-w-[200px] items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all', opacity: dim ? 0.15 : 1, zIndex: selected ? 5 : 1 }}
            onClick={(e) => {
              e.stopPropagation();
              selectEdge(id, e.shiftKey);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              useStudio.getState().setEditingEdge(id);
            }}
            data-testid="studio-edge-label"
          >
            {d.order !== undefined && (
              <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold text-white shadow-panel" style={{ background: color }}>
                {d.order}
              </span>
            )}
            {editing ? (
              <EdgeLabelEditor id={id} value={label ?? ''} />
            ) : (
              label && (
                <span
                  className={cn('truncate rounded border bg-surface px-1.5 py-[1px] text-[11px] font-medium leading-[1.4] text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]', selected && 'ring-2 ring-accent/40')}
                  style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--line))` }}
                  title={label}
                >
                  {label}
                </span>
              )
            )}
            {showChip && (
              <span
                className="shrink-0 rounded border border-dashed px-1 text-[9.5px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--k-hypo)', borderColor: 'var(--k-hypo)', background: 'color-mix(in srgb, var(--k-hypo) 10%, var(--surface))' }}
                title={status === 'unverified' ? 'You drew this line; Meridian has no such relationship. Select it to record it as a hypothetical relationship.' : 'Hypothetical — not part of Meridian today'}
              >
                {status === 'unverified' ? 'Not in Meridian' : 'Proposed'}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
});

function Token({ path, reverse, color }: { path: string; reverse: boolean; color: string }) {
  const reduced = prefersReducedMotion();
  const ref = useRef<SVGPathElement>(null);
  const end = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!reduced || !ref.current) return;
    const total = ref.current.getTotalLength();
    end.current = ref.current.getPointAtLength(reverse ? 0 : total);
  }, [reduced, reverse, path]);
  if (reduced) {
    return <path ref={ref} d={path} fill="none" style={{ stroke: color, strokeWidth: 6, strokeOpacity: 0.35 }} />;
  }
  return (
    <g>
      <circle r={7} style={{ fill: color, opacity: 0.25 }}>
        <animateMotion dur="0.9s" fill="freeze" path={path} keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
      </circle>
      <circle r={4.5} style={{ fill: color, stroke: 'var(--surface)', strokeWidth: 1.5 }}>
        <animateMotion dur="0.9s" fill="freeze" path={path} keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
      </circle>
    </g>
  );
}

function EdgeLabelEditor({ id, value }: { id: string; value: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    const s = useStudio.getState();
    if (s.editingEdgeId !== id) return;
    s.setEditingEdge(null);
    const next = ref.current?.value ?? '';
    if (commit && next !== value) s.updateEdgeData(id, { label: next || undefined });
  };
  return (
    <input
      ref={ref}
      aria-label="Edge label"
      defaultValue={value}
      className="nodrag h-6 w-44 rounded border border-accent bg-surface px-1.5 text-[11px] outline-none ring-2 ring-accent/30"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') {
          cancelled.current = true;
          finish(false);
        }
      }}
      onBlur={() => finish(!cancelled.current)}
    />
  );
}

export const edgeTypes = { studio: StudioEdge };
