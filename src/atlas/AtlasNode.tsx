/**
 * One Atlas map node: a collapsed card, an expanded container region (header
 * band + body; its children are separate nodes drawn on top), the collapsed
 * root, or a focus-mode stub. Content follows the zoom band (semantic zoom).
 */
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { ArrowUpRight, ChevronDown, ChevronRight, FlaskConical, PencilLine, Sparkles, Trash2 } from 'lucide-react';
import { KIND_LABEL, type Confidence, type EntityKind } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { cn } from '@/ui/primitives';
import { CONFIDENCE_INFO, KIND_COLOR, KindIcon } from '@/ui/kinds';
import { activateNode, revealHidden, toggleNode } from './actions';
import { useAtlasLocal, zoomBand } from './store';

export interface AtlasNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  kind: EntityKind;
  summary: string;
  tech: string[];
  /** Children in the model (map entities). */
  childCount: number;
  hiddenCount: number;
  /** Children currently drawn inside (expanded containers). */
  visibleChildren: number;
  isContainer: boolean;
  expanded: boolean;
  depth: number;
  isRoot: boolean;
  /** The focused container (cannot be collapsed while focused). */
  isFocusRoot: boolean;
  stub: boolean;
  confidence: Confidence;
  removal: boolean;
  modified: number;
  emphasis: boolean;
  featureCount: number;
  detail: number;
}

export type AtlasFlowNode = Node<AtlasNodeData, 'atlas'>;

const HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: 'none' as const,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
};

function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="target" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
    </>
  );
}

/** Break points for long identifiers: spaces, slashes, dots and camelCase humps. */
export function camelParts(name: string): string[] {
  return name.split(/[\s/.]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
}

/** The name with soft break opportunities at camelCase humps, slashes and dots. */
function breakable(name: string) {
  const parts = name.split(/(?<=[a-z])(?=[A-Z])|(?<=[/.])/);
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {p}
    </span>
  ));
}

/** Largest far-zoom font (flow px) at which the longest word of a name still fits a card's width. */
export function farMaxFont(name: string, inner = 190): number {
  const longest = Math.max(4, ...camelParts(name).map((w) => w.length));
  return Math.max(12, Math.min(24, Math.floor(inner / (longest * 0.62))));
}

function AtlasNodeImpl({ data }: NodeProps<AtlasFlowNode>) {
  const model = useModel();
  const band = useStore((s) => zoomBand(s.transform[2]));
  const fx = useAtlasLocal((s) => s.nodeFx.get(data.id));
  const setLocal = useAtlasLocal((s) => s.set);
  const selected = useApp((s) => s.selection?.type === 'entity' && s.selection.id === data.id);
  const hypo = data.confidence === 'hypothetical';
  const color = hypo ? 'var(--k-hypo)' : data.kind === 'system' ? 'var(--accent)' : KIND_COLOR[data.kind];

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    activateNode(model, data);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      activateNode(model, data);
    }
  };
  const common = {
    'data-testid': 'atlas-node',
    'data-entity': data.id,
    'data-expanded': data.isContainer ? String(data.expanded) : undefined,
    'data-selected': selected ? 'true' : undefined,
    role: 'button',
    tabIndex: 0,
    'aria-label': `${data.name} — ${KIND_LABEL[data.kind]}${data.isContainer ? (data.expanded ? ', expanded' : ', collapsed') : ''}`,
    onClick,
    onKeyDown: onKey,
    onMouseEnter: () => setLocal({ hoverNode: data.id }),
    onMouseLeave: () => setLocal({ hoverNode: null }),
    style: { '--tint': color } as React.CSSProperties,
  };
  const fxClass = cn(
    fx === 'dim' && 'atlas-dim',
    fx === 'focus' && 'atlas-fx-focus',
    fx === 'lens' && 'atlas-fx-lens',
    fx === 'lens-in' && 'atlas-fx-lens-in',
    selected && 'atlas-selected',
  );

  const toggle = data.isContainer && !data.isFocusRoot && (
    <button
      type="button"
      data-testid="node-toggle"
      aria-label={data.expanded ? `Hide what is inside ${data.name}` : `Show what is inside ${data.name}`}
      title={data.expanded ? 'Collapse (E)' : 'Expand (E)'}
      aria-expanded={data.expanded}
      className="atlas-toggle nodrag"
      onClick={(e) => {
        e.stopPropagation();
        toggleNode(model, data);
      }}
    >
      {data.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  );

  const markers = (
    <>
      {hypo && (
        <span className="atlas-marker atlas-marker-hypo" title="Hypothetical — not part of Meridian">
          <FlaskConical size={10} />
          {band !== 'far' && 'Hypothetical'}
        </span>
      )}
      {data.removal && (
        <span className="atlas-marker atlas-marker-bad" title="Proposed removal (hypothetical layer)">
          <Trash2 size={10} />
          {band !== 'far' && 'Removal'}
        </span>
      )}
      {data.modified > 0 && (
        <span className="atlas-marker atlas-marker-hypo" title={`${data.modified} proposed change${data.modified > 1 ? 's' : ''} (hypothetical layer)`}>
          <PencilLine size={10} />
          {band !== 'far' && 'Proposed change'}
        </span>
      )}
    </>
  );

  // ---- Stub (outside thing, focus mode) --------------------------------------
  if (data.stub) {
    return (
      <div {...common} className={cn('atlas-node atlas-stub tint', hypo && 'hypothetical', fxClass)} title={`Outside the focus: ${data.name}. Click to leave focus and show it.`}>
        <Handles />
        <KindIcon kind={data.kind} size={14} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Outside · {KIND_LABEL[data.kind]}</div>
          <div className="atlas-stub-name truncate font-semibold text-fg">{data.name}</div>
        </div>
        <ArrowUpRight size={14} className="shrink-0 text-fg-subtle" />
      </div>
    );
  }

  // ---- Expanded container region ------------------------------------------------
  if (data.expanded) {
    return (
      <div
        {...common}
        className={cn('atlas-node atlas-region tint', `atlas-depth-${Math.min(data.depth, 4)}`, hypo && 'hypothetical', data.removal && 'proposed-removal', fxClass)}
      >
        <Handles />
        <div className="atlas-region-header">
          {toggle}
          <span className="atlas-kind-dot">
            <KindIcon kind={data.kind} size={band === 'far' ? 18 : 14} />
          </span>
          <span className={cn('atlas-region-title', band === 'far' && 'atlas-far-title')} title={data.name}>
            {data.name}
          </span>
          {band !== 'far' && <span className="atlas-region-kind">{KIND_LABEL[data.kind]}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {markers}
            {data.hiddenCount > 0 && (
              <button
                type="button"
                data-testid="reveal-hidden"
                className="atlas-more nodrag"
                title={`${data.hiddenCount} more inside ${data.name} are hidden at detail level ${data.detail}. Click to show them here — or raise the detail level (+) to show more everywhere.`}
                onClick={(e) => {
                  e.stopPropagation();
                  revealHidden(data.id);
                }}
              >
                +{data.hiddenCount} more
              </button>
            )}
          </span>
        </div>
        {/* Children are positioned by the layout; an empty body explains itself. */}
        <EmptyBody data={data} />
      </div>
    );
  }

  // ---- Collapsed root -----------------------------------------------------------
  if (data.isRoot) {
    return (
      <div {...common} className={cn('atlas-node atlas-root-card tint', fxClass)}>
        <Handles />
        <div className="flex items-center gap-2.5">
          <span className="atlas-root-icon">
            <KindIcon kind={data.kind} size={22} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[22px] font-bold leading-tight tracking-tight text-fg">{data.name}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{KIND_LABEL[data.kind]}</div>
          </div>
        </div>
        <p className="m-0 line-clamp-2 text-[12px] leading-snug text-fg-muted">{data.summary}</p>
        <div className="atlas-root-cta">
          <ChevronRight size={13} /> Click to explore the system
        </div>
      </div>
    );
  }

  // ---- Collapsed card -----------------------------------------------------------
  const conf = data.confidence !== 'verified' && data.confidence !== 'hypothetical' ? CONFIDENCE_INFO[data.confidence] : null;
  return (
    <div
      {...common}
      className={cn(
        'atlas-node atlas-card tint',
        data.isContainer && 'atlas-card-container',
        data.emphasis && 'atlas-emphasis',
        hypo && 'hypothetical',
        data.removal && 'proposed-removal',
        fxClass,
      )}
      title={band === 'far' ? data.name : undefined}
    >
      <Handles />
      {band === 'far' ? (
        <div className="atlas-far-name" style={{ '--far-max': `${farMaxFont(data.name)}px` } as React.CSSProperties}>
          {breakable(data.name)}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-start gap-1.5">
            <span className="atlas-kind-dot mt-px">
              <KindIcon kind={data.kind} size={13} />
            </span>
            <span className="atlas-card-title" title={data.name}>
              {data.name}
            </span>
            {toggle}
          </div>
          <p className={cn('atlas-card-summary', band === 'near' ? 'line-clamp-1' : 'line-clamp-2')}>{data.summary}</p>
          {band === 'near' && (
            <div className="atlas-card-meta">
              <span className="atlas-kind-label">{KIND_LABEL[data.kind]}</span>
              {data.isContainer && <span className="atlas-meta-chip">{data.childCount} inside</span>}
              {data.tech.slice(0, 2).map((t) => (
                <span key={t} className="atlas-meta-chip">
                  {t}
                </span>
              ))}
              {data.featureCount > 0 && (
                <span className="atlas-meta-chip" title={`Implements ${data.featureCount} feature${data.featureCount > 1 ? 's' : ''}`}>
                  <Sparkles size={9} />
                  {data.featureCount}
                </span>
              )}
              {conf && (
                <span className="atlas-meta-chip" style={{ color: conf.color }} title={conf.description}>
                  {conf.label}
                </span>
              )}
            </div>
          )}
          {(hypo || data.removal || data.modified > 0) && <div className="atlas-card-markers">{markers}</div>}
        </>
      )}
    </div>
  );
}

function EmptyBody({ data }: { data: AtlasNodeData }) {
  if (data.visibleChildren > 0) return null;
  return (
    <div className="atlas-region-empty">
      {data.hiddenCount > 0
        ? `Nothing inside is shown at detail level ${data.detail}. Use “+${data.hiddenCount} more” or raise the detail level.`
        : 'Nothing inside matches the current view.'}
    </div>
  );
}

export const AtlasNode = memo(AtlasNodeImpl, (a, b) => a.data === b.data && a.width === b.width && a.height === b.height);
