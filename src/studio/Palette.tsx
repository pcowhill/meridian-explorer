/** Left panel: Meridian components (search + browse by kind), shapes & notes, widgets, templates. */
import { memo, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  Database,
  Diamond,
  Frame,
  HelpCircle,
  LayoutTemplate,
  MessageSquare,
  Plus,
  RectangleHorizontal,
  Search,
  Square,
  StickyNote,
  Trash2,
  Type,
  User,
} from 'lucide-react';
import { KIND_LABEL, type EntityKind } from '@/model';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { useModel, useSearchIndex } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { KindIcon, entityColor } from '@/ui/kinds';
import { Button, cn, IconButton, Switch, Tabs, Tip } from '@/ui/primitives';
import { addEntity, addFree, addWidget, generate, insertTemplate } from './commands';
import { DRAG_MIME, type DragPayload } from './Canvas';
import { entityInstances } from './logic/build';
import { bindingItems, type WidgetKind } from './logic/widgets';
import { WIDGET_ICON } from './nodes/widgets';
import { currentModel } from './model';
import { usePrefs, type PaletteTab } from './prefs';
import { useStudio } from './store';
import { useStudioUi } from './ui';
import type { ShapeKind, StudioNodeType } from './types';

const KIND_ORDER: EntityKind[] = ['app', 'datastore', 'role', 'external', 'package', 'subsystem', 'page', 'component', 'route-group', 'endpoint', 'function', 'class', 'type', 'constant', 'db-model', 'event', 'feature', 'module', 'infra', 'test', 'doc'];
const PLURAL: Partial<Record<EntityKind, string>> = { 'db-model': 'Tables', class: 'Classes', 'route-group': 'Route groups', datastore: 'Databases', app: 'Applications', package: 'Libraries' };
const plural = (k: EntityKind) => PLURAL[k] ?? `${KIND_LABEL[k]}s`;

const setDrag = (e: DragEvent, payload: DragPayload) => {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
};

export const PALETTE_SEARCH_ID = 'studio-palette-search';

export function focusPaletteSearch(): void {
  usePrefs.getState().set({ paletteOpen: true, paletteTab: 'meridian' });
  window.setTimeout(() => {
    const el = document.getElementById(PALETTE_SEARCH_ID) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, 30);
}

export function Palette() {
  const tab = usePrefs((s) => s.paletteTab);
  const set = usePrefs((s) => s.set);
  return (
    <aside className="presenter-hide flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Studio palette" data-testid="studio-palette">
      <Tabs<PaletteTab>
        label="Palette"
        value={tab}
        onChange={(v) => set({ paletteTab: v })}
        tabs={[
          { value: 'meridian', label: 'Meridian' },
          { value: 'shapes', label: 'Shapes' },
          { value: 'widgets', label: 'Widgets' },
          { value: 'templates', label: 'Templates' },
        ]}
        className="shrink-0"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'meridian' && <MeridianTab />}
        {tab === 'shapes' && <ShapesTab />}
        {tab === 'widgets' && <WidgetsTab />}
        {tab === 'templates' && <TemplatesTab />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Meridian components
// ---------------------------------------------------------------------------

function MeridianTab() {
  const model = useModel();
  const index = useSearchIndex();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const autoConnect = usePrefs((s) => s.autoConnect);
  const setPrefs = usePrefs((s) => s.set);
  const nodes = useStudio((s) => s.nodes);
  const onBoard = useMemo(() => new Set(entityInstances(nodes).keys()), [nodes]);
  const results = useMemo(() => (q.trim() ? index.search(q, 40) : []), [index, q]);
  const entities = results.filter((r) => r.type === 'entity');
  const others = results.filter((r) => r.type === 'scenario' || r.type === 'machine').slice(0, 6);
  const listRef = useRef<HTMLDivElement>(null);

  const addOther = (type: 'scenario' | 'machine', id: string) => {
    const kind: WidgetKind = type === 'scenario' ? 'sequence' : 'state';
    const item = bindingItems(model, kind).find((x) => x.key === id);
    if (item) addWidget(item.make());
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[1] border-b border-line bg-surface p-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            id={PALETTE_SEARCH_ID}
            data-testid="palette-search"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(entities.length - 1, i + 1));
                listRef.current?.querySelectorAll('[data-palette-entity]')[Math.min(entities.length - 1, active + 1)]?.scrollIntoView({ block: 'nearest' });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && entities[active]) {
                e.preventDefault();
                addEntity(entities[active].id);
              } else if (e.key === 'Escape') {
                if (q) {
                  e.stopPropagation();
                  setQ('');
                } else (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search components…  (N)"
            aria-label="Search Meridian components"
            className="h-8 w-full rounded-md border border-line bg-surface-2 pl-7 pr-2 text-[12.5px] outline-none placeholder:text-fg-subtle focus:border-accent focus:bg-surface"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Switch checked={autoConnect} onChange={(v) => setPrefs({ autoConnect: v })} label="Auto-connect known relationships" className="text-[11.5px]!" />
        </div>
      </div>
      <div ref={listRef} className="p-1.5">
        {q.trim() ? (
          <>
            {entities.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-fg-subtle">No components match “{q}”.</div>}
            {entities.map((r, i) => (
              <EntityRow key={r.id} id={r.id} title={r.title} subtitle={r.subtitle} onBoard={onBoard.has(r.id)} active={i === active} onHover={() => setActive(i)} />
            ))}
            {others.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">As widgets</div>
                {others.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => addOther(r.type as 'scenario' | 'machine', r.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                    title={r.type === 'scenario' ? 'Add as a sequence diagram' : 'Add as a state machine'}
                  >
                    <span className="flex w-4 justify-center text-[color:var(--c-call)]">{r.type === 'scenario' ? <WIDGET_ICON.sequence size={13} /> : <ArrowRightLeft size={13} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{r.title}</span>
                      <span className="block truncate text-[11px] text-fg-subtle">{r.kind}</span>
                    </span>
                    <Plus size={12} className="text-fg-subtle" />
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <Browse onBoard={onBoard} />
        )}
      </div>
    </div>
  );
}

const EntityRow = memo(function EntityRow({ id, title, subtitle, onBoard, active, onHover }: { id: string; title: string; subtitle?: string; onBoard: boolean; active?: boolean; onHover?: () => void }) {
  const model = useModel();
  const e = model.entity(id);
  if (!e) return null;
  return (
    <button
      type="button"
      data-palette-entity={id}
      draggable
      onDragStart={(ev) => setDrag(ev, { kind: 'entity', id })}
      onClick={() => addEntity(id)}
      onMouseEnter={onHover}
      className={cn('group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2', active && 'bg-surface-2', e.confidence === 'hypothetical' && 'text-hypo')}
      title={onBoard ? `${e.name} is on the board — click to select it` : `Add ${e.name} (or drag it onto the board)`}
    >
      <span className="flex w-4 shrink-0 justify-center" style={{ color: entityColor(e) }}>
        <KindIcon kind={e.kind} size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-fg-subtle">{subtitle ?? KIND_LABEL[e.kind]}</span>
      </span>
      {onBoard ? <Check size={12} className="shrink-0 text-ok" aria-label="On the board" /> : <Plus size={12} className="shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100" />}
    </button>
  );
});

function Browse({ onBoard }: { onBoard: Set<string> }) {
  const model = useModel();
  const recents = useWorkspace((s) => s.recents);
  const [open, setOpen] = useState<Set<EntityKind>>(() => new Set(['app', 'datastore']));
  const [all, setAll] = useState<Set<EntityKind>>(new Set());
  const groups = useMemo(() => {
    const m = new Map<EntityKind, { id: string; name: string }[]>();
    for (const e of model.entities.values()) {
      if (e.id === model.root) continue;
      m.set(e.kind, [...(m.get(e.kind) ?? []), { id: e.id, name: e.name }]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return KIND_ORDER.filter((k) => m.has(k)).map((k) => ({ kind: k, items: m.get(k)! }));
  }, [model]);
  const recent = recents.filter((id) => model.has(id)).slice(0, 6);
  return (
    <div className="flex flex-col">
      {recent.length > 0 && (
        <div className="mb-1">
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Recently inspected</div>
          {recent.map((id) => (
            <EntityRow key={id} id={id} title={model.entity(id)!.name} onBoard={onBoard.has(id)} />
          ))}
        </div>
      )}
      <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Browse by kind</div>
      {groups.map(({ kind, items }) => {
        const isOpen = open.has(kind);
        const shown = all.has(kind) ? items : items.slice(0, 40);
        return (
          <div key={kind}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((s) => (s.has(kind) ? new Set([...s].filter((x) => x !== kind)) : new Set([...s, kind])))}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium hover:bg-surface-2"
            >
              {isOpen ? <ChevronDown size={12} className="text-fg-subtle" /> : <ChevronRight size={12} className="text-fg-subtle" />}
              <span style={{ color: entityColor({ kind }) }}>
                <KindIcon kind={kind} size={12} />
              </span>
              <span className="flex-1">{plural(kind)}</span>
              <span className="text-[10.5px] text-fg-subtle">{items.length}</span>
            </button>
            {isOpen && (
              <div className="ml-3 border-l border-line pl-1">
                {shown.map((it) => (
                  <EntityRow key={it.id} id={it.id} title={it.name} subtitle={model.appOf(it.id)?.name} onBoard={onBoard.has(it.id)} />
                ))}
                {shown.length < items.length && (
                  <button type="button" className="px-2 py-1 text-[11.5px] text-accent hover:underline" onClick={() => setAll((s) => new Set([...s, kind]))}>
                    Show all {items.length}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shapes & notes
// ---------------------------------------------------------------------------

const SHAPES: { shape: ShapeKind; label: string; icon: ReactNode }[] = [
  { shape: 'rectangle', label: 'Rectangle', icon: <Square size={16} /> },
  { shape: 'rounded', label: 'Rounded box', icon: <RectangleHorizontal size={16} /> },
  { shape: 'ellipse', label: 'Ellipse', icon: <Circle size={16} /> },
  { shape: 'diamond', label: 'Decision', icon: <Diamond size={16} /> },
  { shape: 'cylinder', label: 'Database', icon: <Database size={16} /> },
  { shape: 'actor', label: 'Person', icon: <User size={16} /> },
  { shape: 'cloud', label: 'Cloud', icon: <Cloud size={16} /> },
];

const FREE: { type: StudioNodeType; label: string; icon: ReactNode; keys?: string; hint: string; data?: Record<string, unknown> }[] = [
  { type: 'text', label: 'Text', icon: <Type size={16} />, keys: 'T', hint: 'A heading or a line of text' },
  { type: 'note', label: 'Sticky note', icon: <StickyNote size={16} />, keys: 'M', hint: 'A note to remember or to explain' },
  { type: 'callout', label: 'Callout', icon: <MessageSquare size={16} />, hint: 'Text with a pointer; connect it to what it explains' },
  { type: 'frame', label: 'Frame', icon: <Frame size={16} />, keys: 'F', hint: 'A titled container that moves its contents' },
];

function Tile({ label, icon, keys, onClick, payload, hint }: { label: string; icon: ReactNode; keys?: string; onClick: () => void; payload: DragPayload; hint?: string }) {
  return (
    <Tip label={hint ?? label} keys={keys} side="right">
      <button
        type="button"
        draggable
        onDragStart={(e) => setDrag(e, payload)}
        onClick={onClick}
        aria-label={`Add ${label.toLowerCase()}`}
        className="flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-md border border-line bg-surface text-fg-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
      >
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </button>
    </Tip>
  );
}

function ShapesTab() {
  return (
    <div className="p-2.5">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Text & notes</div>
      <div className="grid grid-cols-2 gap-1.5 [&>span]:w-full">
        {FREE.map((f) => (
          <Tile key={f.type} label={f.label} icon={f.icon} keys={f.keys} hint={f.hint} onClick={() => addFree(f.type)} payload={{ kind: 'free', type: f.type }} />
        ))}
      </div>
      <div className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Shapes</div>
      <div className="grid grid-cols-3 gap-1.5 [&>span]:w-full">
        {SHAPES.map((s) => (
          <Tile key={s.shape} label={s.label} icon={s.icon} keys={s.shape === 'rectangle' ? 'R' : undefined} onClick={() => addFree('shape', { shape: s.shape })} payload={{ kind: 'free', type: 'shape', data: { shape: s.shape } }} />
        ))}
      </div>
      <p className="mt-4 text-[11.5px] leading-snug text-fg-subtle">
        Click to add at the centre of the view, or drag onto the board. Mark any shape or line as <span className="font-semibold text-hypo">proposed</span> from the selection panel.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

export const WIDGETS: { kind: WidgetKind; label: string; hint: string; keys?: string }[] = [
  { kind: 'code', label: 'Code', hint: 'A source excerpt (with GitHub link) or your own pseudocode', keys: 'K' },
  { kind: 'json', label: 'JSON', hint: 'An example payload you can highlight, hide and edit', keys: 'J' },
  { kind: 'table', label: 'Database table', hint: 'Columns and example rows of a table' },
  { kind: 'class', label: 'Class / type', hint: 'A UML-style card for a type, or your own' },
  { kind: 'contract', label: 'Endpoint contract', hint: 'Method, path, auth, request and responses' },
  { kind: 'sequence', label: 'Sequence diagram', hint: 'A scenario or an endpoint trace with a step slider' },
  { kind: 'state', label: 'State machine', hint: 'States and transitions of a lifecycle' },
  { kind: 'timeline', label: 'Timeline', hint: 'An editable ordered list of moments' },
  { kind: 'compare', label: 'Before / after', hint: 'Two panes with the differences marked' },
  { kind: 'transform', label: 'Transformation', hint: 'Input → function → output' },
  { kind: 'balance', label: 'Balance calculator', hint: 'Derive current and available balances from ledger entries' },
];

export function openWidget(kind: WidgetKind, attachTo?: string): void {
  if (kind === 'balance') {
    const it = bindingItems(currentModel(), 'balance')[0];
    addWidget(it.make(), attachTo);
    return;
  }
  useStudioUi.getState().set({ picker: { kind, attachTo } });
}


function WidgetsTab() {
  return (
    <div className="flex flex-col gap-1 p-2">
      {WIDGETS.map((w) => {
        const Icon = WIDGET_ICON[w.kind];
        return (
          <button key={w.kind} type="button" onClick={() => openWidget(w.kind)} className="flex items-start gap-2.5 rounded-md border border-transparent px-2 py-2 text-left hover:border-line hover:bg-surface-2" aria-label={`Add ${w.label} widget`}>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent">
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                {w.label}
                {w.keys && <kbd>{w.keys}</kbd>}
              </span>
              <span className="block text-[11.5px] leading-snug text-fg-subtle">{w.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplatesTab() {
  const templates = useWorkspace((s) => s.templates);
  const deleteTemplate = useWorkspace((s) => s.deleteTemplate);
  const hasSelection = useStudio((s) => s.nodes.some((n) => n.selected));
  const hasNodes = useStudio((s) => s.nodes.length > 0);
  const setUi = useStudioUi((s) => s.set);
  return (
    <div className="flex flex-col p-2">
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Starting points</div>
      <TemplateButton icon={<LayoutTemplate size={13} />} title="System overview" hint="Apps, database, external parties and people, connected" onClick={() => generate('overview')} />
      <TemplateButton
        icon={<Frame size={13} />}
        title="Existing / proposed frames"
        hint="Two empty frames side by side for a before/after"
        onClick={() => {
          const a = addFree('frame', { label: 'Existing' }, { edit: false });
          const s = useStudio.getState();
          const fa = s.nodes.find((n) => n.id === a)!;
          addFree('frame', { label: 'Proposed', proposed: true, style: { stroke: 'purple', strokeStyle: 'dashed' } }, { edit: false, at: { x: fa.position.x + (fa.width ?? 520) * 1.5 + 64, y: fa.position.y + (fa.height ?? 340) / 2 } });
        }}
      />
      <div className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">From a question</div>
      {GUIDED_QUESTIONS.map((q) => (
        <TemplateButton key={q.id} icon={<HelpCircle size={13} />} title={q.question} hint={q.studio.title} onClick={() => generate('question', q.id)} />
      ))}
      <div className="flex items-center justify-between px-1 pb-1 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">My templates</span>
      </div>
      <div className="flex gap-1.5 px-1 pb-2">
        <Button size="sm" disabled={!hasSelection} onClick={() => setUi({ templateDialog: 'selection' })}>
          Save selection
        </Button>
        <Button size="sm" disabled={!hasNodes} onClick={() => setUi({ templateDialog: 'board' })}>
          Save board
        </Button>
      </div>
      {templates.length === 0 && <div className="px-1 text-[11.5px] text-fg-subtle">Save a selection or the whole board to reuse it on any board.</div>}
      {templates.map((t) => (
        <div key={t.id} className="group flex items-center gap-1 rounded-md hover:bg-surface-2">
          <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => insertTemplate(t)} title="Insert on the board">
            <span className="block truncate text-[12.5px] font-medium">{t.name}</span>
            <span className="block text-[11px] text-fg-subtle">{t.nodes.length} items</span>
          </button>
          <IconButton label={`Delete template ${t.name}`} size="sm" onClick={() => deleteTemplate(t.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
            <Trash2 size={12} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function TemplateButton({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-snug">{title}</span>
        <span className="block truncate text-[11px] text-fg-subtle">{hint}</span>
      </span>
    </button>
  );
}
