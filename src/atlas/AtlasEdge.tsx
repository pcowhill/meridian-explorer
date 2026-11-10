/**
 * An aggregated Atlas edge. Geometry is precomputed by `routeEdges` (edges.ts)
 * and passed in `data`; this component only draws it and handles hover/click.
 */
import { memo, type MouseEvent } from 'react';
import { EdgeLabelRenderer, useStore, type Edge, type EdgeProps } from '@xyflow/react';
import { CHANNELS } from '@/model';
import { useApp } from '@/state/app';
import { CHANNEL_COLOR } from '@/ui/kinds';
import { cn } from '@/ui/primitives';
import { strokeWidth, type EdgeGeom, type EdgeSpec } from './edges';
import { NEAR_ZOOM, useAtlasLocal } from './store';

export interface AtlasEdgeData extends Record<string, unknown> {
  spec: EdgeSpec;
  geom: EdgeGeom;
}

export type AtlasFlowEdge = Edge<AtlasEdgeData, 'atlas'>;

const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.id, c.label]));

function AtlasEdgeImpl({ id, data }: EdgeProps<AtlasFlowEdge>) {
  const spec = data!.spec;
  const geom = data!.geom;
  const fx = useAtlasLocal((s) => s.edgeFx.get(id));
  const hoverSelf = useAtlasLocal((s) => s.hoverEdge === id);
  const hoverEnd = useAtlasLocal((s) => s.hoverNode === spec.a || s.hoverNode === spec.b);
  const labelOk = useAtlasLocal((s) => s.labelOk.has(id));
  const set = useAtlasLocal((s) => s.set);
  const near = useStore((s) => s.transform[2] >= NEAR_ZOOM);
  const selected = useApp(
    (s) => s.selection?.type === 'edge' && s.selection.channel === spec.channel && ((s.selection.a === spec.a && s.selection.b === spec.b) || (s.selection.a === spec.b && s.selection.b === spec.a)),
  );
  const color = spec.hypothetical ? 'var(--k-hypo)' : CHANNEL_COLOR[spec.channel];
  const realtime = spec.channel === 'realtime';
  const dash = spec.hypothetical ? '4 4' : realtime ? '7 5' : undefined;
  const base = strokeWidth(spec.count);
  const active = hoverSelf || selected;
  const width = active ? base + 1.5 : hoverEnd || fx === 'focus' ? base + 0.8 : base;
  const opacity = fx === 'dim' ? 0.1 : active || hoverEnd || fx === 'focus' ? 1 : 0.78;
  const showLabel = active || (near && labelOk && fx !== 'dim');

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    useApp.getState().select({ type: 'edge', a: spec.a, b: spec.b, channel: spec.channel });
  };
  const title = `${spec.label} · ${CHANNEL_LABEL[spec.channel]}${spec.hypothetical ? ' · hypothetical' : ''} — click for details`;

  return (
    <>
      <g className={cn('atlas-edge', active && 'atlas-edge-active')} style={{ opacity, transition: 'opacity 160ms' }}>
        {active && <path d={geom.path} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={width + 7} strokeLinecap="round" />}
        <path d={geom.path} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" className={cn(realtime && !spec.hypothetical && 'atlas-flow')} />
        {geom.arrowB && <polygon points={geom.arrowB} fill={color} />}
        {geom.arrowA && <polygon points={geom.arrowA} fill={color} />}
        <path
          d={geom.path}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          data-testid="atlas-edge"
          data-edge={`${spec.a}|${spec.b}|${spec.channel}`}
          data-channel={spec.channel}
          role="button"
          aria-label={title}
          style={{ pointerEvents: fx === 'dim' ? 'none' : 'stroke', cursor: 'pointer' }}
          onClick={onClick}
          onMouseEnter={() => set({ hoverEdge: id })}
          onMouseLeave={() => set({ hoverEdge: null })}
        >
          <title>{title}</title>
        </path>
      </g>
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={cn('atlas-edge-label nodrag nopan', active && 'is-active', spec.hypothetical && 'is-hypo')}
            style={{ transform: `translate(-50%, -50%) translate(${geom.mid.x}px, ${geom.mid.y}px)`, ['--edge' as string]: color }}
          >
            <span className="atlas-edge-swatch" style={{ borderTopStyle: dash ? 'dashed' : 'solid' }} />
            {spec.label}
            {spec.count > 1 && spec.label !== `${spec.count}` && !/^\d+ /.test(spec.label) && <span className="atlas-edge-count">{spec.count}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const AtlasEdge = memo(AtlasEdgeImpl, (a, b) => a.data === b.data);
