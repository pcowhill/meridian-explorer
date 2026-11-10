/** Entity, shape, text, sticky-note, callout and frame nodes. */
import { memo, type CSSProperties } from 'react';
import type { NodeProps } from '@xyflow/react';
import { FolderTree, Share2 } from 'lucide-react';
import { KIND_LABEL } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { ConfidenceBadge, KindIcon, entityColor } from '@/ui/kinds';
import { cn } from '@/ui/primitives';
import { addChildren, addNeighbours } from '../logic/build';
import { currentModel } from '../model';
import { useStudio } from '../store';
import { boxStyle, dashArray, fillCss, TEXT_SIZE, tokenCss } from '../style';
import type { CalloutData, EntityData, NodeStyle, SNode, ShapeData } from '../types';
import { EditableText, NodeShell } from './common';

type P<T> = NodeProps<SNode> & { data: T };

const textSize = (style: NodeStyle | undefined, fallback: number) => (style?.textSize ? TEXT_SIZE[style.textSize] : fallback);

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

export const EntityNode = memo(function EntityNode({ id, data, selected }: P<EntityData>) {
  const model = useModel();
  const audience = useApp((s) => s.audience);
  const e = model.entity(data.entityId);
  if (!e) {
    return (
      <NodeShell id={id} type="entity" data={data} selected={selected} entityId={data.entityId} minWidth={140} minHeight={56}>
        <div className="flex h-full w-full flex-col justify-center rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 text-[12px] text-fg-muted">
          <div className="truncate font-mono text-[11px]">{data.entityId}</div>
          <div className="text-[11px] text-fg-subtle">Not in the model — its hypothetical layer may be switched off.</div>
        </div>
      </NodeShell>
    );
  }
  const color = entityColor(e);
  const hypo = model.isHypothetical(e.id);
  const removal = model.isProposedRemoval(e.id);
  const kids = model.childIds(e.id).length;
  const nbrs = model.neighbors(e.id).length;
  const style = data.style;
  const run = (fn: typeof addChildren) => {
    const s = useStudio.getState();
    const patch = fn(currentModel(), s.nodes, s.edges, id);
    if (patch) {
      s.applyPatch(patch);
      if (patch.message) useApp.getState().toast(patch.message, patch.nodes.length ? 'ok' : 'info');
    }
  };
  return (
    <NodeShell id={id} type="entity" data={data} selected={selected} entityId={e.id} minWidth={150} minHeight={60}>
      <div
        className={cn('tint group/entity flex h-full w-full flex-col overflow-hidden rounded-lg border-[1.5px] px-2.5 py-2 shadow-panel', hypo && 'hypothetical')}
        style={{ ['--tint' as string]: color, background: style?.fill ? fillCss(style.fill) : 'var(--tint-soft)', borderColor: style?.stroke ? tokenCss(style.stroke) : 'var(--tint-line)', borderStyle: hypo ? 'dashed' : style?.strokeStyle ?? 'solid' } as CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color }}>
          <KindIcon kind={e.kind} size={12} />
          <span className="truncate">{hypo ? `Hypothetical ${KIND_LABEL[e.kind].toLowerCase()}` : KIND_LABEL[e.kind]}</span>
          {e.confidence && e.confidence !== 'verified' && e.confidence !== 'hypothetical' && <ConfidenceBadge confidence={e.confidence} compact />}
        </div>
        <div className={cn('mt-0.5 line-clamp-2 font-semibold leading-snug text-fg', removal && 'proposed-removal')} style={{ fontSize: textSize(style, 13.5) }} title={e.name}>
          {e.name}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-muted">{model.summaryFor(e, audience)}</div>
        <EditableText id={id} value={data.caption} field="caption" placeholder="" className="mt-1 text-[11.5px] font-medium italic text-fg">
          {data.caption ? data.caption : null}
        </EditableText>
        {(kids > 0 || nbrs > 0) && (
          <div className={cn('absolute -bottom-3 right-2 flex gap-1 opacity-0 transition-opacity group-hover/entity:opacity-100', selected && 'opacity-100')}>
            {kids > 0 && (
              <button
                type="button"
                className="nodrag inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2 text-[10.5px] font-medium text-fg-muted shadow-panel hover:text-fg"
                title={`Add the ${kids} children of ${e.name}`}
                aria-label={`Add children of ${e.name}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  run(addChildren);
                }}
              >
                <FolderTree size={11} /> {kids}
              </button>
            )}
            {nbrs > 0 && (
              <button
                type="button"
                className="nodrag inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2 text-[10.5px] font-medium text-fg-muted shadow-panel hover:text-fg"
                title={`Add what ${e.name} connects to (${nbrs})`}
                aria-label={`Add neighbours of ${e.name}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  run(addNeighbours);
                }}
              >
                <Share2 size={11} /> {nbrs}
              </button>
            )}
          </div>
        )}
      </div>
    </NodeShell>
  );
});

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function ShapeSvg({ shape, fill, stroke, dash, hypo }: { shape: ShapeData['shape']; fill: string; stroke: string; dash?: string; hypo?: boolean }) {
  const common = { fill, stroke, strokeWidth: 1.5, strokeDasharray: dash, vectorEffect: 'non-scaling-stroke' as const };
  const hatch = hypo ? 'url(#studio-hatch)' : undefined;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {shape === 'ellipse' && <ellipse cx="50" cy="50" rx="49.2" ry="49.2" {...common} />}
      {shape === 'diamond' && <polygon points="50,0.8 99.2,50 50,99.2 0.8,50" {...common} />}
      {shape === 'cylinder' && (
        <>
          <path d="M0.8,12 L0.8,88 A49.2,11 0 0 0 99.2,88 L99.2,12" {...common} />
          <ellipse cx="50" cy="12" rx="49.2" ry="11" {...common} />
        </>
      )}
      {shape === 'cloud' && (
        <path
          d="M25,85 C8,85 2,70 10,60 C2,48 12,32 26,36 C28,18 50,10 62,24 C74,12 96,22 90,42 C100,50 98,72 82,78 C80,90 60,92 52,84 C44,92 30,92 25,85 Z"
          {...common}
        />
      )}
      {hatch && shape !== 'actor' && <rect x="0" y="0" width="100" height="100" fill={hatch} opacity={0.5} />}
    </svg>
  );
}

export const ShapeNode = memo(function ShapeNode({ id, data, selected }: P<ShapeData>) {
  const style = data.style;
  const hypo = !!data.proposed;
  const stroke = hypo ? 'var(--k-hypo)' : style?.stroke ? tokenCss(style.stroke) : 'var(--line-strong)';
  const strokeStyle = hypo ? 'dashed' : style?.strokeStyle;
  const fill = hypo ? 'color-mix(in srgb, var(--k-hypo) 8%, var(--surface))' : fillCss(style?.fill);
  const fs = textSize(style, 13);
  const label = <EditableText id={id} value={data.label} placeholder="Label" className="text-center font-medium leading-snug" style={{ fontSize: fs }} />;
  if (data.shape === 'rectangle' || data.shape === 'rounded') {
    return (
      <NodeShell id={id} type="shape" data={data} selected={selected}>
        <div
          className={cn('flex h-full w-full items-center justify-center border-[1.5px] p-2', data.shape === 'rounded' ? 'rounded-2xl' : 'rounded-[3px]', hypo && 'hypothetical')}
          style={{ background: fill, borderColor: stroke, borderStyle: strokeStyle ?? 'solid' }}
        >
          {label}
        </div>
      </NodeShell>
    );
  }
  if (data.shape === 'actor') {
    return (
      <NodeShell id={id} type="shape" data={data} selected={selected} minWidth={60} minHeight={70}>
        <div className="flex h-full w-full flex-col items-center">
          <svg className="min-h-0 w-full flex-1" viewBox="0 0 40 60" preserveAspectRatio="xMidYMid meet" aria-hidden>
            <g fill="none" stroke={stroke} strokeWidth={2.2} strokeDasharray={dashArray(strokeStyle, 1.4)} strokeLinecap="round">
              <circle cx="20" cy="11" r="8" fill={fill} />
              <path d="M20 19 V40 M6 27 H34 M20 40 L9 57 M20 40 L31 57" />
            </g>
          </svg>
          {label}
        </div>
      </NodeShell>
    );
  }
  return (
    <NodeShell id={id} type="shape" data={data} selected={selected}>
      <div className="relative flex h-full w-full items-center justify-center p-[14%]">
        <ShapeSvg shape={data.shape} fill={fill} stroke={stroke} dash={dashArray(strokeStyle, 1.5)} hypo={hypo} />
        <div className={cn('relative', data.shape === 'cylinder' && 'pt-[8%]')}>{label}</div>
      </div>
    </NodeShell>
  );
});

export const TextNode = memo(function TextNode({ id, data, selected }: P<{ label?: string; style?: NodeStyle; proposed?: boolean; locked?: boolean }>) {
  const style = data.style;
  const fs = textSize(style, 14);
  return (
    <NodeShell id={id} type="text" data={data} selected={selected} minWidth={40} minHeight={20}>
      <div
        className={cn('h-full w-full overflow-hidden rounded-sm px-1', data.proposed && 'text-hypo')}
        style={{
          background: style?.fill && style.fill !== 'none' && style.fill !== 'default' ? fillCss(style.fill) : undefined,
          color: data.proposed ? 'var(--k-hypo)' : style?.stroke && style.stroke !== 'default' ? tokenCss(style.stroke) : undefined,
        }}
      >
        <EditableText id={id} value={data.label} placeholder="Text" className={cn('leading-tight', fs >= 18 ? 'font-semibold tracking-tight' : 'font-medium')} style={{ fontSize: fs }} />
      </div>
    </NodeShell>
  );
});

export const NoteNode = memo(function NoteNode({ id, data, selected }: P<{ label?: string; style?: NodeStyle; proposed?: boolean; locked?: boolean }>) {
  const style = data.style;
  return (
    <NodeShell id={id} type="note" data={data} selected={selected} minWidth={90} minHeight={60}>
      <div
        className={cn('tint h-full w-full overflow-hidden rounded-[3px] border p-2.5 shadow-panel', data.proposed && 'hypothetical')}
        style={{ ...boxStyle(style, { fill: 'amber', stroke: 'amber' }), borderColor: `color-mix(in srgb, ${tokenCss(style?.stroke ?? 'amber')} 45%, var(--line))` }}
      >
        <EditableText id={id} value={data.label} placeholder="Note" className="leading-snug text-fg" style={{ fontSize: textSize(style, 13) }} />
      </div>
    </NodeShell>
  );
});

export const CalloutNode = memo(function CalloutNode({ id, data, selected }: P<CalloutData>) {
  const style = data.style;
  const stroke = data.proposed ? 'var(--k-hypo)' : tokenCss(style?.stroke ?? 'blue');
  const fill = data.proposed ? 'color-mix(in srgb, var(--k-hypo) 8%, var(--surface))' : fillCss(style?.fill ?? 'blue');
  const pointer = data.pointer ?? 'left';
  const tip: Record<string, CSSProperties> = {
    left: { left: -9, top: '50%', transform: 'translateY(-50%) rotate(45deg)', borderRight: 'none', borderTop: 'none' },
    right: { right: -9, top: '50%', transform: 'translateY(-50%) rotate(45deg)', borderLeft: 'none', borderBottom: 'none' },
    top: { top: -9, left: '50%', transform: 'translateX(-50%) rotate(45deg)', borderRight: 'none', borderBottom: 'none' },
    bottom: { bottom: -9, left: '50%', transform: 'translateX(-50%) rotate(45deg)', borderLeft: 'none', borderTop: 'none' },
  };
  const borderStyle = data.proposed ? 'dashed' : style?.strokeStyle ?? 'solid';
  return (
    <NodeShell id={id} type="callout" data={data} selected={selected} minWidth={80} minHeight={40}>
      <div className="relative h-full w-full">
        <span className="absolute h-4 w-4 border-[1.5px]" style={{ ...tip[pointer], background: fill, borderColor: stroke, borderStyle }} aria-hidden />
        <div className="relative flex h-full w-full items-center rounded-lg border-[1.5px] px-3 py-2" style={{ background: fill, borderColor: stroke, borderStyle }}>
          <EditableText id={id} value={data.label} placeholder="Callout" className="w-full leading-snug" style={{ fontSize: textSize(style, 13) }} />
        </div>
      </div>
    </NodeShell>
  );
});

export const FrameNode = memo(function FrameNode({ id, data, selected }: P<{ label?: string; style?: NodeStyle; proposed?: boolean; locked?: boolean }>) {
  const style = data.style;
  const hypo = !!data.proposed;
  const stroke = hypo ? 'var(--k-hypo)' : style?.stroke ? tokenCss(style.stroke) : 'var(--line-strong)';
  return (
    <NodeShell id={id} type="frame" data={data} selected={selected} minWidth={160} minHeight={100}>
      <div
        className={cn('h-full w-full rounded-xl border-[1.5px]', hypo && 'hypothetical')}
        style={{
          borderColor: stroke,
          borderStyle: hypo ? 'dashed' : style?.strokeStyle ?? 'solid',
          background: style?.fill ? fillCss(style.fill) : 'color-mix(in srgb, var(--surface-2) 45%, transparent)',
        }}
      >
        <div className="frame-handle flex h-8 cursor-grab items-center gap-2 rounded-t-xl px-3 active:cursor-grabbing" style={{ color: hypo ? 'var(--k-hypo)' : 'var(--fg-muted)' }}>
          <EditableText id={id} value={data.label} placeholder="Frame" multiline={false} className="min-w-0 flex-1 truncate font-semibold" style={{ fontSize: textSize(style, 13) }} />
          {hypo && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">Proposed</span>}
        </div>
      </div>
    </NodeShell>
  );
});
