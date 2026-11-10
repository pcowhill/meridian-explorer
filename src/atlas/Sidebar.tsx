/**
 * The Atlas's left sidebar: the system tree (containment hierarchy, mirrors
 * the map's expand state), relationship filters, the feature lens and a
 * compact legend.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Search, Sparkles, X } from 'lucide-react';
import { CHANNELS, KIND_LABEL, type Entity, type EntityKind, type Model, type RelationChannel } from '@/model';
import { useApp } from '@/state/app';
import { CHANNEL_COLOR, CONFIDENCE_INFO, KIND_COLOR, KindIcon, entityColor } from '@/ui/kinds';
import { cn, inputClass, IconButton } from '@/ui/primitives';
import { collapse, setLens } from './actions';
import { useAtlasLocal } from './store';
import { mapChildren } from './visibility';

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface Row {
  entity: Entity;
  depth: number;
  container: boolean;
  open: boolean;
  /** Filter mode: the path shown under the name. */
  path?: string;
}

/** Rows of the tree: the hierarchy following `expanded`, or (with a filter) the matches. Pure, exported for tests. */
export function treeRows(model: Model, expanded: ReadonlySet<string>, filter: string, limit = 200): Row[] {
  const q = filter.trim().toLowerCase();
  if (q) {
    const out: Row[] = [];
    for (const e of model.entities.values()) {
      if (e.kind === 'feature') continue;
      if (e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.aliases?.some((a) => a.toLowerCase().includes(q))) {
        out.push({
          entity: e,
          depth: 0,
          container: mapChildren(model, e.id).length > 0,
          open: false,
          path: model
            .ancestors(e.id)
            .slice(1)
            .map((a) => a.name)
            .join(' › '),
        });
        if (out.length >= limit) break;
      }
    }
    return out.sort((a, b) => a.entity.name.length - b.entity.name.length || a.entity.name.localeCompare(b.entity.name));
  }
  const rows: Row[] = [];
  const walk = (id: string, depth: number) => {
    const e = model.entity(id);
    if (!e) return;
    const kids = mapChildren(model, id);
    const open = kids.length > 0 && expanded.has(id);
    rows.push({ entity: e, depth, container: kids.length > 0, open });
    if (open) for (const k of kids) walk(k.id, depth + 1);
  };
  walk(model.root, 0);
  return rows;
}

function SystemTree({ model, detail }: { model: Model; detail: number }) {
  const expandedList = useApp((s) => s.atlas.expanded);
  const focus = useApp((s) => s.atlas.focus);
  const selection = useApp((s) => s.selection);
  const filter = useAtlasLocal((s) => s.treeFilter);
  const setLocal = useAtlasLocal((s) => s.set);
  const expanded = useMemo(() => new Set([...expandedList, ...(focus ? [focus] : [])]), [expandedList, focus]);
  const rows = useMemo(() => treeRows(model, expanded, filter), [model, expanded, filter]);
  const selectedId = selection?.type === 'entity' ? selection.id : null;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tree-entity="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-3 pb-2">
        <Search size={13} className="pointer-events-none absolute left-5 top-2 text-fg-subtle" />
        <input
          className={cn(inputClass, 'h-7 pl-7 pr-7 text-[12px]')}
          placeholder="Filter the tree…"
          aria-label="Filter the system tree"
          value={filter}
          onChange={(e) => setLocal({ treeFilter: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setLocal({ treeFilter: '' });
            }
          }}
        />
        {filter && (
          <button type="button" aria-label="Clear the tree filter" onClick={() => setLocal({ treeFilter: '' })} className="absolute right-4 top-1.5 rounded p-0.5 text-fg-subtle hover:text-fg">
            <X size={13} />
          </button>
        )}
      </div>
      <div ref={listRef} role="tree" aria-label="System tree" data-testid="atlas-tree" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {rows.length === 0 && <div className="px-3 py-4 text-[12px] text-fg-subtle">Nothing matches “{filter}”.</div>}
        {rows.map((r) => {
          const e = r.entity;
          const hypo = e.confidence === 'hypothetical';
          const hiddenByDetail = model.detailOf(e) > detail && !hypo;
          const sel = e.id === selectedId;
          return (
            <div
              key={e.id}
              role="treeitem"
              aria-selected={sel}
              aria-expanded={r.container && !filter ? r.open : undefined}
              data-tree-entity={e.id}
              className={cn('group flex items-center gap-1 rounded-md pr-1.5 text-[12.5px]', sel ? 'bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] text-fg' : 'hover:bg-surface-2')}
              style={{ paddingLeft: 4 + r.depth * 12 }}
            >
              {r.container && !filter ? (
                <button
                  type="button"
                  aria-label={r.open ? `Hide the contents of ${e.name}` : `Show the contents of ${e.name}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg"
                  onClick={() => (r.open ? collapse(model, e.id) : useApp.getState().atlasExpand([e.id]))}
                >
                  {r.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] text-left"
                onClick={() => useApp.getState().atlasReveal(e.id)}
                title={`${KIND_LABEL[e.kind]} · ${e.summary}`}
              >
                <span className="shrink-0" style={{ color: entityColor(e) }}>
                  <KindIcon kind={e.kind} size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', hiddenByDetail && 'text-fg-subtle', hypo && 'italic text-hypo', model.isProposedRemoval(e.id) && 'line-through')}>{e.name}</span>
                  {r.path && <span className="block truncate text-[10.5px] text-fg-subtle">{r.path}</span>}
                </span>
                {hypo && <span className="shrink-0 rounded border border-dashed border-hypo px-1 text-[9.5px] font-semibold uppercase text-hypo">Hypo</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Section({ title, right, children, defaultOpen = true, testId }: { title: string; right?: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-line" data-testid={testId}>
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle hover:text-fg">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-2.5">{children}</div>}
    </section>
  );
}

function ChannelFilters({ counts }: { counts: Record<RelationChannel, number> }) {
  const channels = useApp((s) => s.atlas.channels);
  const toggle = useApp((s) => s.atlasToggleChannel);
  const setChannels = useApp((s) => s.atlasSetChannels);
  const all = channels.length === CHANNELS.length;
  return (
    <Section
      title="Relationships"
      right={
        <button type="button" className="text-[11px] text-fg-subtle hover:text-fg" onClick={() => setChannels(all ? [] : CHANNELS.map((c) => c.id))}>
          {all ? 'None' : 'All'}
        </button>
      }
    >
      <div className="flex flex-wrap gap-1">
        {CHANNELS.map((c) => {
          const on = channels.includes(c.id);
          const color = CHANNEL_COLOR[c.id];
          return (
            <button
              key={c.id}
              type="button"
              data-testid={`channel-${c.id}`}
              aria-pressed={on}
              title={`${c.description}. ${counts[c.id]} on the map right now.`}
              onClick={() => toggle(c.id)}
              className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium transition-colors', on ? 'text-fg' : 'border-line text-fg-subtle hover:text-fg')}
              style={on ? { background: `color-mix(in srgb, ${color} 14%, var(--surface))`, borderColor: `color-mix(in srgb, ${color} 45%, var(--line))` } : undefined}
            >
              <span className="inline-block w-3 border-t-2" style={{ borderColor: color, borderTopStyle: c.id === 'realtime' ? 'dashed' : 'solid', opacity: on ? 1 : 0.45 }} />
              {c.label}
              <span className={cn('rounded-full px-1 text-[10px] tabular-nums', on ? 'bg-surface text-fg-muted' : 'text-fg-subtle')}>{counts[c.id]}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function FeatureLens({ model }: { model: Model }) {
  const lens = useApp((s) => s.atlas.lens);
  const features = useMemo(
    () =>
      model
        .features()
        .map((f) => ({ f, n: model.implementersOf(f.id).filter((e) => e.kind !== 'feature').length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => a.f.name.localeCompare(b.f.name)),
    [model],
  );
  const active = lens ? model.entity(lens) : undefined;
  return (
    <Section
      title="Features lens"
      defaultOpen={!!lens}
      right={
        active && (
          <button type="button" className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg" onClick={() => setLens(model, null)} aria-label="Turn the feature lens off">
            <X size={11} /> Off
          </button>
        )
      }
    >
      <p className="m-0 mb-1.5 text-[11.5px] text-fg-subtle">Pick a capability to light up the parts of the system that implement it.</p>
      <div className="flex max-h-48 flex-col gap-px overflow-y-auto">
        {features.map(({ f, n }) => {
          const on = lens === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              data-feature={f.id}
              onClick={() => setLens(model, f.id)}
              title={f.summary}
              className={cn('flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px]', on ? 'bg-[color-mix(in_srgb,var(--k-feature)_16%,var(--surface))] font-semibold' : 'hover:bg-surface-2')}
            >
              <Sparkles size={11} className="shrink-0" style={{ color: 'var(--k-feature)' }} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-[10.5px] tabular-nums text-fg-subtle">{n}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

const LEGEND_KINDS: EntityKind[] = ['app', 'subsystem', 'module', 'route-group', 'endpoint', 'function', 'type', 'datastore', 'db-model', 'event', 'page', 'role', 'infra', 'external'];

function Legend() {
  return (
    <Section title="Legend" defaultOpen={false}>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {LEGEND_KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
            <span style={{ color: KIND_COLOR[k] }}>
              <KindIcon kind={k} size={12} />
            </span>
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {CHANNELS.map((c) => (
          <span key={c.id} className="flex items-center gap-2 text-[11.5px] text-fg-muted">
            <span className="inline-block w-6 border-t-2" style={{ borderColor: CHANNEL_COLOR[c.id], borderTopStyle: c.id === 'realtime' ? 'dashed' : 'solid' }} />
            {c.label}
          </span>
        ))}
        <span className="flex items-center gap-2 text-[11.5px] text-fg-muted">
          <span className="inline-block h-3 w-6 rounded-sm border border-dashed border-hypo hypothetical" />
          Hypothetical (proposed, not in Meridian)
        </span>
        <span className="text-[11px] text-fg-subtle">Arrows show direction · thicker lines aggregate more relations.</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {Object.entries(CONFIDENCE_INFO).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1 text-[11px] text-fg-muted" title={c.description}>
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </Section>
  );
}

export function Sidebar({ model, counts }: { model: Model; counts: Record<RelationChannel, number> }) {
  const detail = useApp((s) => s.detail);
  const setLocal = useAtlasLocal((s) => s.set);
  return (
    <aside className="presenter-hide flex w-[264px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Atlas sidebar">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">System tree</h2>
        <IconButton label="Hide the sidebar" keys="T" size="sm" onClick={() => setLocal({ sidebarOpen: false })}>
          <ChevronRight size={14} className="rotate-180" />
        </IconButton>
      </div>
      <SystemTree model={model} detail={detail} />
      <div className="max-h-[55%] shrink-0 overflow-y-auto">
        <ChannelFilters counts={counts} />
        <FeatureLens model={model} />
        <Legend />
      </div>
    </aside>
  );
}
