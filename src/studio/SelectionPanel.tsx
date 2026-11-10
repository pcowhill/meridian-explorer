/** Floating panel for the current selection: actions, style, arrangement, entity shortcuts and edge facts. */
import { useMemo, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  EyeOff,
  FlaskConical,
  Frame,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { RELATION_VERB, type RelationKind } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { newId, useWorkspace } from '@/state/workspace';
import { KindIcon, entityColor } from '@/ui/kinds';
import { Button, cn, IconButton, inputClass, Segmented, Switch } from '@/ui/primitives';
import { addWidget, generate } from './commands';
import { STATUS_TEXT } from './edges/StudioEdge';
import { edgeStatus, entityOf } from './logic/modelEdges';
import { indexNodes } from './logic/geometry';
import { quickWidgets } from './logic/widgets';
import { expandIndirect } from './logic/build';
import { currentModel } from './model';
import { openWidget } from './Palette';
import { usePrefs } from './prefs';
import { useStudio } from './store';
import { formatKeys } from '@/shell/hotkeys';

const fk = (k: string) => formatKeys(k)[0];
import { COLOR_TOKENS, tokenCss } from './style';
import { NODE_TYPE_LABEL, type ArrowMode, type CalloutPointer, type ColorToken, type EdgeData, type NodeStyle, type Routing, type SEdge, type SNode, type StrokeStyle, type TextSize } from './types';

const STYLED = new Set(['shape', 'text', 'note', 'callout', 'frame', 'entity']);
const TEXTUAL = new Set(['shape', 'text', 'note', 'callout', 'frame', 'entity']);

export function SelectionPanel() {
  // Select only what the panel shows (id, type, data) so dragging the selection does not re-render it.
  const flat = useStudio(useShallow((s) => s.nodes.filter((n) => n.selected).flatMap((n) => [n.id, n.type, n.data] as unknown[])));
  const nodes = useMemo(() => {
    const out: SNode[] = [];
    for (let i = 0; i < flat.length; i += 3) out.push({ id: flat[i] as string, type: flat[i + 1] as SNode['type'], data: flat[i + 2] as SNode['data'], position: { x: 0, y: 0 } });
    return out;
  }, [flat]);
  const edges = useStudio(useShallow((s) => s.edges.filter((e) => e.selected)));
  const expanded = usePrefs((s) => s.panelExpanded);
  const setPrefs = usePrefs((s) => s.set);
  if (!nodes.length && !edges.length) return null;
  const title = nodes.length + edges.length > 1 ? `${nodes.length + edges.length} selected` : nodes.length ? NODE_TYPE_LABEL[nodes[0].type as keyof typeof NODE_TYPE_LABEL] : 'Connection';
  return (
    <div className="studio-overlay presenter-hide pointer-events-auto flex max-h-full w-[244px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop" aria-label="Selection" data-testid="selection-panel">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-2.5">
        <span className="truncate text-[12px] font-semibold">{title}</span>
        {(nodes.some((n) => STYLED.has(n.type ?? '')) || edges.length > 0 || nodes.length >= 2) && (
        <button type="button" aria-expanded={expanded} onClick={() => setPrefs({ panelExpanded: !expanded })} className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg">
          Style{nodes.length >= 2 ? ' & arrange' : ''} {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Actions nodes={nodes} edges={edges} />
        {nodes.length === 1 && nodes[0].type === 'entity' && !edges.length && <EntityShortcuts node={nodes[0]} />}
        {edges.length === 1 && <EdgeSection edge={edges[0]} expanded={expanded} />}
        {expanded && nodes.length > 0 && <NodeStyleSection nodes={nodes} />}
        {expanded && nodes.length >= 2 && <Arrange count={nodes.length} />}
        {expanded && edges.length > 1 && <EdgeStyle edges={edges} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-2.5 py-2 last:border-b-0">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{title}</div>
      {children}
    </div>
  );
}

function Actions({ nodes, edges }: { nodes: SNode[]; edges: SEdge[] }) {
  const s = useStudio.getState();
  const locked = nodes.length > 0 && nodes.every((n) => (n.data as { locked?: boolean }).locked);
  const anyFree = nodes.some((n) => n.type !== 'entity') || edges.length > 0;
  const proposed = [...nodes.filter((n) => n.type !== 'entity').map((n) => !!(n.data as { proposed?: boolean }).proposed), ...edges.map((e) => !!e.data?.proposed)];
  const allProposed = proposed.length > 0 && proposed.every(Boolean);
  return (
    <div className="flex flex-wrap border-b border-line px-1.5 py-1.5">
      {nodes.length > 0 && (
        <IconButton label="Duplicate" keys={fk('mod+D')} size="sm" onClick={() => s.duplicateSelection()}>
          <Copy size={14} />
        </IconButton>
      )}
      <IconButton label="Hide (show again from the hidden list)" keys="X" size="sm" onClick={() => s.hideSelection()}>
        <EyeOff size={14} />
      </IconButton>
      {nodes.length > 0 && (
        <>
          <IconButton label={locked ? 'Unlock' : 'Lock'} size="sm" active={locked} onClick={() => s.toggleLock()}>
            {locked ? <Unlock size={14} /> : <Lock size={14} />}
          </IconButton>
          <IconButton label="Bring to front" size="sm" onClick={() => s.zOrder('front')}>
            <ArrowUpToLine size={14} />
          </IconButton>
          <IconButton label="Send to back" size="sm" onClick={() => s.zOrder('back')}>
            <ArrowDownToLine size={14} />
          </IconButton>
          <IconButton label="Group into frame" keys={fk('mod+G')} size="sm" onClick={() => s.groupSelection()}>
            <Frame size={14} />
          </IconButton>
        </>
      )}
      {anyFree && (
        <IconButton label={allProposed ? 'Unmark as proposed' : 'Mark as proposed (hypothetical)'} size="sm" active={allProposed} onClick={() => s.toggleProposed()} className="text-hypo!">
          <FlaskConical size={14} />
        </IconButton>
      )}
      <IconButton label="Delete" keys="Del" size="sm" onClick={() => s.deleteSelection()}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function EntityShortcuts({ node }: { node: SNode }) {
  const model = useModel();
  const id = entityOf(node)!;
  const e = model.entity(id);
  const widgets = useMemo(() => quickWidgets(model, id), [model, id]);
  if (!e) return null;
  return (
    <Section title="Explain it">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: entityColor(e) }}>
        <KindIcon kind={e.kind} size={12} />
        <span className="truncate text-fg">{e.name}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {model.hasChildren(id) && (
          <Button size="sm" onClick={() => generate('children')}>
            Children
          </Button>
        )}
        <Button size="sm" onClick={() => generate('neighbours')}>
          Neighbours
        </Button>
        <Button size="sm" onClick={() => generate('dependency')}>
          Dependencies
        </Button>
      </div>
      {widgets.length > 0 && (
        <>
          <div className="mb-1 mt-2 text-[11px] text-fg-subtle">Attach a widget</div>
          <div className="flex flex-wrap gap-1">
            {widgets.map((w) => (
              <Button key={w.label} size="sm" variant="subtle" icon={<Plus size={11} />} onClick={() => addWidget(w.make(), node.id)} className="max-w-full">
                <span className="truncate">{w.label}</span>
              </Button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="mt-1.5 text-[11.5px] text-accent hover:underline" onClick={() => openWidget('code', node.id)}>
        Other widget…
      </button>
    </Section>
  );
}

function Swatches({ value, onChange, allowNone, label }: { value: ColorToken | 'none' | undefined; onChange: (v: ColorToken | 'none') => void; allowNone?: boolean; label: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === 'none'}
          aria-label="No fill"
          title="No fill"
          onClick={() => onChange('none')}
          className={cn('h-5 w-5 rounded border border-line bg-[linear-gradient(135deg,transparent_45%,var(--bad)_45%,var(--bad)_55%,transparent_55%)]', value === 'none' && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
        />
      )}
      {COLOR_TOKENS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.id)}
          className={cn('h-5 w-5 rounded border border-line', value === c.id && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
          style={{ background: c.id === 'default' ? 'var(--surface)' : tokenCss(c.id) }}
        />
      ))}
    </div>
  );
}

function NodeStyleSection({ nodes }: { nodes: SNode[] }) {
  const styled = nodes.filter((n) => STYLED.has(n.type ?? ''));
  if (!styled.length) return null;
  const ids = styled.map((n) => n.id);
  const first = (styled[0].data.style as NodeStyle | undefined) ?? {};
  const setStyle = (p: Partial<NodeStyle>) => useStudio.getState().setNodeStyle(ids, p);
  const callouts = nodes.filter((n) => n.type === 'callout');
  return (
    <Section title="Style">
      <div className="flex flex-col gap-2">
        <div>
          <div className="mb-1 text-[11px] text-fg-muted">Fill</div>
          <Swatches label="Fill colour" value={first.fill} onChange={(fill) => setStyle({ fill })} allowNone />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-fg-muted">Outline</div>
          <Swatches label="Outline colour" value={first.stroke} onChange={(stroke) => setStyle({ stroke: stroke === 'none' ? undefined : stroke })} />
        </div>
        <Segmented<StrokeStyle>
          size="sm"
          label="Outline style"
          value={first.strokeStyle ?? 'solid'}
          onChange={(strokeStyle) => setStyle({ strokeStyle })}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
          ]}
        />
        {styled.some((n) => TEXTUAL.has(n.type ?? '')) && (
          <Segmented<TextSize>
            size="sm"
            label="Text size"
            value={first.textSize ?? 'md'}
            onChange={(textSize) => setStyle({ textSize })}
            options={[
              { value: 'sm', label: 'S' },
              { value: 'md', label: 'M' },
              { value: 'lg', label: 'L' },
              { value: 'xl', label: 'XL' },
            ]}
          />
        )}
        {callouts.length > 0 && (
          <Segmented<CalloutPointer>
            size="sm"
            label="Pointer side"
            value={((callouts[0].data as { pointer?: CalloutPointer }).pointer ?? 'left') as CalloutPointer}
            onChange={(pointer) => useStudio.getState().commit((s) => ({ nodes: s.nodes.map((n) => (callouts.some((c) => c.id === n.id) ? { ...n, data: { ...n.data, pointer } } : n)) }))}
            options={[
              { value: 'left', label: '←' },
              { value: 'top', label: '↑' },
              { value: 'right', label: '→' },
              { value: 'bottom', label: '↓' },
            ]}
          />
        )}
      </div>
    </Section>
  );
}

function Arrange({ count }: { count: number }) {
  const s = useStudio.getState();
  return (
    <Section title="Arrange">
      <div className="flex flex-wrap gap-0.5">
        <IconButton label="Align left" size="sm" onClick={() => s.align('left')}>
          <AlignStartVertical size={14} />
        </IconButton>
        <IconButton label="Align centres horizontally" size="sm" onClick={() => s.align('center')}>
          <AlignCenterVertical size={14} />
        </IconButton>
        <IconButton label="Align right" size="sm" onClick={() => s.align('right')}>
          <AlignEndVertical size={14} />
        </IconButton>
        <IconButton label="Align top" size="sm" onClick={() => s.align('top')}>
          <AlignStartHorizontal size={14} />
        </IconButton>
        <IconButton label="Align middles" size="sm" onClick={() => s.align('middle')}>
          <AlignCenterHorizontal size={14} />
        </IconButton>
        <IconButton label="Align bottom" size="sm" onClick={() => s.align('bottom')}>
          <AlignEndHorizontal size={14} />
        </IconButton>
        <IconButton label="Distribute horizontally" size="sm" disabled={count < 3} onClick={() => s.distribute('x')}>
          <AlignHorizontalSpaceAround size={14} />
        </IconButton>
        <IconButton label="Distribute vertically" size="sm" disabled={count < 3} onClick={() => s.distribute('y')}>
          <AlignVerticalSpaceAround size={14} />
        </IconButton>
      </div>
    </Section>
  );
}

function EdgeStyle({ edges }: { edges: SEdge[] }) {
  const d: EdgeData = edges[0].data ?? {};
  const set = (p: Partial<EdgeData>) => {
    const ids = new Set(edges.map((e) => e.id));
    useStudio.getState().commit((s) => ({ edges: s.edges.map((e) => (ids.has(e.id) ? { ...e, data: { ...e.data, ...p } } : e)) }));
  };
  return (
    <Section title="Line">
      <div className="flex flex-col gap-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
            Colour
            {d.color && (
              <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => set({ color: undefined })}>
                Use channel colour
              </button>
            )}
          </div>
          <Swatches label="Line colour" value={d.color} onChange={(color) => set({ color: color === 'none' ? undefined : color })} />
        </div>
        <Segmented<StrokeStyle>
          size="sm"
          label="Line style"
          value={d.strokeStyle ?? 'solid'}
          onChange={(strokeStyle) => set({ strokeStyle })}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
          ]}
        />
        <Segmented<ArrowMode>
          size="sm"
          label="Arrowheads"
          value={d.arrow ?? 'end'}
          onChange={(arrow) => set({ arrow })}
          options={[
            { value: 'end', label: '→' },
            { value: 'start', label: '←' },
            { value: 'both', label: '↔' },
            { value: 'none', label: '—' },
          ]}
        />
        <Segmented<Routing>
          size="sm"
          label="Routing"
          value={d.routing ?? 'straight'}
          onChange={(routing) => set({ routing })}
          options={[
            { value: 'straight', label: 'Straight' },
            { value: 'curved', label: 'Curved' },
            { value: 'step', label: 'Elbow' },
          ]}
        />
        <div className="flex items-center justify-between gap-2">
          <Switch checked={!!d.animated} onChange={(animated) => set({ animated: animated || undefined })} label="Animated" className="text-[11.5px]!" />
          <label className="flex items-center gap-1 text-[11.5px] text-fg-muted">
            No.
            <input
              aria-label="Order number"
              type="number"
              min={0}
              className={cn(inputClass, 'h-6 w-14 px-1')}
              value={d.order ?? ''}
              onChange={(e) => set({ order: e.target.value === '' ? undefined : Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </div>
      </div>
    </Section>
  );
}

const HYPO_KINDS: RelationKind[] = ['calls', 'http', 'websocket', 'emits', 'subscribes', 'reads', 'writes', 'uses-type', 'triggers'];

function EdgeSection({ edge, expanded }: { edge: SEdge; expanded: boolean }) {
  const model = useModel();
  const nodes = useStudio((s) => s.nodes);
  const byId = useMemo(() => indexNodes(nodes), [nodes]);
  const a = entityOf(byId.get(edge.source));
  const b = entityOf(byId.get(edge.target));
  const status = edgeStatus(model, a, b, edge.data);
  const [kind, setKind] = useState<RelationKind>('calls');
  const [label, setLabel] = useState(edge.data?.label ?? '');
  const addHypoRelation = useWorkspace((s) => s.addHypoRelation);
  const record = () => {
    if (!a || !b) return;
    const id = `rel:${a}->${b}:${kind}:${newId('').slice(1, 6)}`;
    const ea = model.entity(a);
    const eb = model.entity(b);
    addHypoRelation({ id, from: a, to: b, kind, label: label.trim() || undefined, summary: `Proposed: ${ea?.name} ${RELATION_VERB[kind]} ${eb?.name}.`, confidence: 'hypothetical' });
    useStudio.getState().updateEdgeData(edge.id, { relationIds: [id], label: label.trim() || RELATION_VERB[kind], proposed: true });
    useApp.getState().toast('Recorded as a hypothetical relationship in your proposal layer', 'ok');
    useApp.getState().select({ type: 'relation', id });
  };
  return (
    <>
      <Section title="Connection">
        <div
          className="mb-2 rounded-md border px-2 py-1.5 text-[11.5px] leading-snug"
          style={
            status === 'known'
              ? { borderColor: 'color-mix(in srgb, var(--ok) 40%, var(--line))', background: 'color-mix(in srgb, var(--ok) 8%, var(--surface))' }
              : status === 'free' || status === 'indirect'
                ? { borderColor: 'var(--line)', borderStyle: status === 'indirect' ? 'dotted' : 'solid' }
                : { borderColor: 'var(--k-hypo)', borderStyle: 'dashed', background: 'color-mix(in srgb, var(--k-hypo) 8%, var(--surface))' }
          }
          data-testid="edge-status"
        >
          <b>{STATUS_TEXT[status]}.</b>{' '}
          {status === 'known' && `${edge.data?.relationIds?.length ?? 0} relationship${edge.data?.relationIds?.length === 1 ? '' : 's'} in the model — the inspector shows protocol, data and sources.`}
          {status === 'hypothetical' && 'Recorded in a hypothetical layer — not part of Meridian today.'}
          {status === 'unverified' && 'Meridian has no relationship between these two. This line is your sketch, not a fact.'}
          {status === 'free' && 'A drawn line between board elements.'}
          {status === 'indirect' && `Not a direct relationship: connected through ${model.entity(edge.data?.indirect?.via)?.name ?? 'an entity'}, which is not on the board.`}
        </div>
        {status === 'indirect' && edge.data?.indirect && model.has(edge.data.indirect.via) && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={12} />}
            data-testid="expand-indirect"
            className="h-auto! max-w-full py-1 text-left whitespace-normal"
            onClick={() => {
              let added: string | null = null;
              useStudio.getState().commit((s) => {
                const r = expandIndirect(currentModel(), s.nodes, s.edges, edge.id);
                if (!r) return {};
                added = r.added.id;
                return { nodes: r.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), edges: r.edges };
              });
              if (added) useStudio.getState().setSelection([added]);
            }}
          >
            <span className="break-words">Add {model.entity(edge.data.indirect.via)?.name} to the board</span>
          </Button>
        )}
        {status === 'unverified' && a && b && (
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-2">
            <div className="text-[11px] font-semibold text-fg-muted">Record as hypothetical relationship</div>
            <select aria-label="Relationship kind" className={cn(inputClass, 'h-7')} value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {HYPO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {model.entity(a)?.name} {RELATION_VERB[k]} {model.entity(b)?.name}
                </option>
              ))}
            </select>
            <input aria-label="Relationship label" className={cn(inputClass, 'h-7')} placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <Button size="sm" variant="primary" icon={<FlaskConical size={12} />} onClick={record} className="bg-hypo! text-white!">
              Record as hypothetical relationship
            </Button>
          </div>
        )}
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-fg-muted">Label (double-click the line to edit in place)</div>
          <input
            aria-label="Connection label"
            className={cn(inputClass, 'h-7')}
            defaultValue={edge.data?.label ?? ''}
            key={`${edge.id}:${edge.data?.label ?? ''}`}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => e.target.value !== (edge.data?.label ?? '') && useStudio.getState().updateEdgeData(edge.id, { label: e.target.value || undefined })}
          />
        </div>
      </Section>
      {expanded && <EdgeStyle edges={[edge]} />}
    </>
  );
}
