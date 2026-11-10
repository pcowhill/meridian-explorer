/**
 * The scenario library (left rail) and the landing page. Both list the same
 * scenarios — model, hypothetical-layer and the user's own — as questions.
 * When something is selected elsewhere, "Workflows involving …" carries that
 * context over (and endpoints get a one-click trace).
 */
import { useMemo, useState } from 'react';
import { Clapperboard, FilePlus2, GitBranch, Search, Sparkles, Upload, Wand2, Network, Trash2 } from 'lucide-react';
import { visibleSteps, variantSteps, type Scenario } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { Button, cn, IconButton, inputClass, Popover, SectionTitle } from '@/ui/primitives';
import { KindIcon } from '@/ui/kinds';
import { OUTCOME_COLOR } from './context';
import { CATEGORY_LABEL, groupByCategory, hasHypoVariant, isHypoScenario, matchesFilter, TRACE_PREFIX } from './logic';

export interface LibraryActions {
  onOpen: (id: string) => void;
  onNewFromEndpoint: () => void;
  onBlank: () => void;
  onImport: () => void;
}

function useLibraryScenarios() {
  const model = useModel();
  const custom = useWorkspace((s) => s.customScenarios);
  return { model, builtIn: model.scenarios, custom };
}

export function Library({ currentId, onOpen, onNewFromEndpoint, onBlank, onImport }: LibraryActions & { currentId: string | null }) {
  const { builtIn, custom } = useLibraryScenarios();
  const [q, setQ] = useState('');
  const groups = useMemo(() => groupByCategory(builtIn.filter((s) => matchesFilter(s, q))), [builtIn, q]);
  const mine = useMemo(() => custom.filter((s) => matchesFilter(s, q)), [custom, q]);

  return (
    <nav className="flex h-full min-h-0 flex-col" aria-label="Scenario library" data-testid="library">
      <div className="shrink-0 space-y-2 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" className="flex-1" icon={<Network size={13} />} onClick={onNewFromEndpoint} aria-label="New scenario from endpoint" title="Assemble a trace from any API endpoint (N)">
            From endpoint
          </Button>
          <IconButton label="Blank scenario" size="sm" variant="default" onClick={onBlank}>
            <FilePlus2 size={14} />
          </IconButton>
          <IconButton label="Import a scenario file" size="sm" variant="default" onClick={onImport}>
            <Upload size={14} />
          </IconButton>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter scenarios" aria-label="Filter scenarios" className={cn(inputClass, 'h-7 pl-7')} data-testid="library-filter" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Involving currentId={currentId} onOpen={onOpen} />
        {mine.length > 0 && (
          <div className="mb-3">
            <SectionTitle className="px-1">My scenarios</SectionTitle>
            {mine.map((s) => (
              <LibraryItem key={s.id} scenario={s} active={s.id === currentId} onOpen={onOpen} custom />
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.category} className="mb-3">
            <SectionTitle className="px-1">{g.label}</SectionTitle>
            {g.items.map((s) => (
              <LibraryItem key={s.id} scenario={s} active={s.id === currentId} onOpen={onOpen} />
            ))}
          </div>
        ))}
        {groups.length === 0 && mine.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-fg-subtle">No scenario matches “{q}”.</div>}
      </div>
    </nav>
  );
}

/** "Workflows involving <selected entity>" — how context carries over from the other modes. */
export function Involving({ currentId, onOpen, className }: { currentId: string | null; onOpen: (id: string) => void; className?: string }) {
  const { model, custom } = useLibraryScenarios();
  const selection = useApp((s) => s.selection);
  const selected = selection?.type === 'entity' ? model.entity(selection.id) : undefined;
  const involving = useMemo(() => {
    if (!selected) return [];
    const fromModel = model.scenariosFor(selected.id);
    const fromMine = custom.filter((s) => s.participants.includes(selected.id) || s.related.includes(selected.id) || s.steps.some((st) => st.from === selected.id || st.to === selected.id));
    return [...fromMine, ...fromModel].slice(0, 8);
  }, [selected, model, custom]);
  if (!selected) return null;
  const isEndpoint = !!model.contract(selected.id);
  return (
    <div className={cn('mb-3 rounded-lg border border-line bg-surface-2 p-2', className)} data-testid="involving">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted">
        <KindIcon kind={selected.kind} size={12} />
        <span className="min-w-0 truncate">Workflows involving {selected.name}</span>
      </div>
      {isEndpoint && (
        <Button size="sm" className="mb-1 w-full justify-start! whitespace-nowrap text-[11.5px]!" icon={<Wand2 size={12} />} onClick={() => onOpen(`${TRACE_PREFIX}${selected.id}`)} data-testid="assemble-trace">
          Assemble a trace for this endpoint
        </Button>
      )}
      {involving.length === 0 && !isEndpoint && <div className="px-1 text-[11.5px] text-fg-subtle">No scenario involves it yet.</div>}
      {involving.map((s) => (
        <LibraryItem key={`inv-${s.id}`} scenario={s} active={s.id === currentId} onOpen={onOpen} custom={custom.includes(s)} compact />
      ))}
    </div>
  );
}

function LibraryItem({ scenario: s, active, onOpen, custom, compact }: { scenario: Scenario; active: boolean; onOpen: (id: string) => void; custom?: boolean; compact?: boolean }) {
  const detail = useApp((st) => st.detail);
  const del = useWorkspace((st) => st.deleteCustomScenario);
  const steps = useMemo(() => variantSteps(s, s.defaultVariant).length, [s]);
  const shown = useMemo(() => visibleSteps(s, s.defaultVariant, detail).length, [s, detail]);
  const hypo = isHypoScenario(s);
  return (
    <div className={cn('group relative mb-0.5 rounded-md', active && 'bg-[color-mix(in_srgb,var(--accent)_11%,var(--surface))]', hypo && 'hypothetical border border-dashed border-hypo')}>
      <button type="button" data-scenario={compact ? undefined : s.id} data-involving={compact ? s.id : undefined} onClick={() => onOpen(s.id)} aria-current={active ? 'true' : undefined} className={cn('block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2', active && 'hover:bg-transparent', custom && 'pr-7')}>
        <span className="flex items-center gap-1.5">
          <span className={cn('min-w-0 flex-1 truncate text-[12.5px] font-semibold', active ? 'text-accent' : 'text-fg')}>{s.title}</span>
          {custom && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9.5px] font-bold uppercase tracking-wide text-fg-muted">mine</span>}
          {hypo && <span className="shrink-0 rounded border border-dashed border-hypo px-1 text-[9.5px] font-bold uppercase tracking-wide text-hypo">hypothetical</span>}
          {!hypo && hasHypoVariant(s) && (
            <span title="Includes hypothetical behaviour" className="shrink-0 text-hypo">
              <Sparkles size={11} aria-label="Includes hypothetical behaviour" />
            </span>
          )}
        </span>
        {!compact && <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-fg-muted">{s.question}</span>}
        <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-fg-subtle">
          <span title={`${shown} of ${steps} steps shown at detail ${detail} (default outcome)`}>{shown === steps ? `${steps} steps` : `${shown}/${steps} steps`}</span>
          <span className="inline-flex items-center gap-0.5">
            <GitBranch size={10} aria-hidden /> {s.variants.length} outcome{s.variants.length === 1 ? '' : 's'}
          </span>
          <span className="flex gap-[2px]" aria-hidden>
            {s.variants.slice(0, 8).map((v) => (
              <span key={v.id} className="h-1.5 w-1.5 rounded-full" style={{ background: v.hypothetical ? 'var(--k-hypo)' : OUTCOME_COLOR[v.outcome ?? 'info'] }} />
            ))}
          </span>
        </span>
      </button>
      {custom && (
        <Popover
          align="end"
          className="w-56 p-2"
          trigger={(p) => (
            <IconButton label={`Delete ${s.title}`} size="sm" className="absolute right-0.5 top-1 h-6! w-6! opacity-0 focus:opacity-100 group-hover:opacity-100" {...p}>
              <Trash2 size={12} />
            </IconButton>
          )}
        >
          {(close) => (
            <div className="text-[12px]">
              <p className="m-0 mb-2">Delete “{s.title}” from this browser? This cannot be undone (export it first to keep a copy).</p>
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-bad!"
                  onClick={() => {
                    del(s.id);
                    close();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

/** Landing: no scenario open. Every scenario as a question, one click to start. */
export function Landing({ onOpen, onNewFromEndpoint, onBlank, onImport }: LibraryActions) {
  const { builtIn, custom } = useLibraryScenarios();
  const groups = useMemo(() => groupByCategory(builtIn), [builtIn]);
  return (
    <div className="h-full overflow-y-auto bg-canvas" data-testid="theater-landing">
      <div className="mx-auto max-w-[920px] px-6 py-8">
        <div className="mb-1 flex items-center gap-2 text-accent">
          <Clapperboard size={18} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Scenario Theater</span>
        </div>
        <h1 className="m-0 text-[22px] font-semibold tracking-tight">What happens, step by step</h1>
        <p className="m-0 mt-1.5 max-w-[640px] text-[13px] text-fg-muted">
          Pick a question to watch the system answer it: who starts the operation, which components take part, what they send each other, how the data changes, and what happens when something goes wrong.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Network size={14} />} onClick={onNewFromEndpoint} aria-label="New scenario from endpoint">
            Trace any API endpoint…
          </Button>
          <Button icon={<FilePlus2 size={14} />} onClick={onBlank}>
            Start a blank scenario
          </Button>
          <Button icon={<Upload size={14} />} onClick={onImport}>
            Import…
          </Button>
        </div>
        <Involving currentId={null} onOpen={onOpen} className="mt-5 max-w-[420px]" />
        {custom.length > 0 && <LandingGroup label="My scenarios" items={custom} onOpen={onOpen} />}
        {groups.map((g) => (
          <LandingGroup key={g.category} label={CATEGORY_LABEL[g.category]} items={g.items} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function LandingGroup({ label, items, onOpen }: { label: string; items: Scenario[]; onOpen: (id: string) => void }) {
  return (
    <section className="mt-6">
      <SectionTitle>{label}</SectionTitle>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
        {items.map((s) => {
          const hypo = isHypoScenario(s);
          return (
            <button
              key={s.id}
              type="button"
              data-scenario={s.id}
              onClick={() => onOpen(s.id)}
              className={cn('group flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-left shadow-panel transition-colors hover:border-accent', hypo && 'hypothetical border-hypo')}
            >
              <span className="text-[13.5px] font-semibold leading-snug text-fg group-hover:text-accent">{s.question}</span>
              <span className="line-clamp-2 text-[11.5px] text-fg-muted">{s.summary}</span>
              <span className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                {s.variants.slice(0, 5).map((v) => (
                  <span
                    key={v.id}
                    className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 text-[10.5px] text-fg-muted', v.hypothetical ? 'border-dashed border-hypo text-hypo' : 'border-line')}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.hypothetical ? 'var(--k-hypo)' : OUTCOME_COLOR[v.outcome ?? 'info'] }} />
                    {v.label}
                  </span>
                ))}
                {s.variants.length > 5 && <span className="text-[10.5px] text-fg-subtle">+{s.variants.length - 5}</span>}
                {hypo && <span className="rounded border border-dashed border-hypo px-1 text-[9.5px] font-bold uppercase text-hypo">hypothetical</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
