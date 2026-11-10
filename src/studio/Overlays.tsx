/** Canvas overlays: the empty-board start panel, the context carry-over prompt and the hypothetical legend. */
import { useMemo } from 'react';
import { FlaskConical, Globe, HelpCircle, LayoutTemplate, Plus, Search, Share2, X } from 'lucide-react';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { KindIcon, entityColor } from '@/ui/kinds';
import { Button, Kbd } from '@/ui/primitives';
import { addEntity, applyPatch, generate } from './commands';
import { addNeighbours, entityInstances } from './logic/build';
import { edgeStatus, entityOf } from './logic/modelEdges';
import { currentModel } from './model';
import { focusPaletteSearch } from './Palette';
import { usePrefs } from './prefs';
import { useStudio } from './store';
import { useStudioUi } from './ui';

export function EmptyState() {
  const empty = useStudio((s) => s.nodes.length === 0);
  const model = useModel();
  const setPrefs = usePrefs((s) => s.set);
  if (!empty) return null;
  return (
    <div className="studio-overlay pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-[560px] rounded-xl border border-line bg-surface p-5 shadow-pop" data-testid="studio-empty">
        <h2 className="m-0 text-[16px] font-semibold">Build an explanation</h2>
        <p className="mb-4 mt-1 text-[12.5px] text-fg-muted">
          This board is empty. Put real Meridian components on it — they arrive already connected by the relationships in the model — then add notes, code, data and diagrams around them.
        </p>
        <button
          type="button"
          onClick={focusPaletteSearch}
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-left text-[13px] text-fg-subtle hover:border-accent hover:text-fg"
        >
          <Search size={15} />
          <span className="flex-1">Search {model.entities.size} components, endpoints, tables…</span>
          <Kbd>N</Kbd>
        </button>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
              <HelpCircle size={12} /> From a question
            </div>
            <div className="flex flex-col">
              {GUIDED_QUESTIONS.map((q) => (
                <button key={q.id} type="button" onClick={() => generate('question', q.id)} className="truncate rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-surface-2" title={q.blurb}>
                  {q.question}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 sm:w-44">
            <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Or start with</div>
            <Button icon={<Globe size={13} />} onClick={() => generate('overview')} className="justify-start">
              System overview
            </Button>
            <Button icon={<LayoutTemplate size={13} />} onClick={() => setPrefs({ paletteOpen: true, paletteTab: 'templates' })} className="justify-start">
              Templates
            </Button>
            <Button icon={<FlaskConical size={13} />} onClick={() => useStudioUi.getState().set({ hypoOpen: true })} className="justify-start text-hypo!">
              Hypothetical component
            </Button>
          </div>
        </div>
        <p className="mb-0 mt-4 text-[11.5px] text-fg-subtle">
          Tip: from the Atlas or the Theater, “Add to Studio” sends what you are looking at here. Press <Kbd>?</Kbd> for all shortcuts.
        </p>
      </div>
    </div>
  );
}

/** When the shared selection is an entity that is not on the board, offer to add it. */
export function CarryOverPrompt() {
  const selection = useApp((s) => s.selection);
  const nodes = useStudio((s) => s.nodes);
  const dismissed = useStudioUi((s) => s.dismissedCarry);
  const model = useModel();
  const id = selection?.type === 'entity' ? selection.id : null;
  const onBoard = useMemo(() => (id ? entityInstances(nodes).has(id) : true), [id, nodes]);
  const e = id ? model.entity(id) : undefined;
  if (!e || onBoard || dismissed === id || id === model.root) return null;
  return (
    <div className="studio-overlay presenter-hide pointer-events-auto flex max-w-[520px] items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1 shadow-pop" data-testid="carry-over">
      <span style={{ color: entityColor(e) }}>
        <KindIcon kind={e.kind} size={13} />
      </span>
      <span className="min-w-0 truncate text-[12px] text-fg-muted">
        <b className="text-fg">{e.name}</b> is selected
      </span>
      <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => addEntity(e.id)}>
        Add {e.name.length > 24 ? 'it' : e.name} to the board
      </Button>
      <Button
        size="sm"
        icon={<Share2 size={12} />}
        onClick={() => {
          const nodeId = addEntity(e.id);
          if (!nodeId) return;
          const s = useStudio.getState();
          applyPatch(addNeighbours(currentModel(), s.nodes, s.edges, nodeId));
        }}
      >
        …and its neighbours
      </Button>
      <button type="button" aria-label="Dismiss" className="rounded-full p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" onClick={() => useStudioUi.getState().set({ dismissedCarry: e.id })}>
        <X size={13} />
      </button>
    </div>
  );
}

/** Shown whenever something hypothetical is on the board. */
export function HypoLegend() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const model = useModel();
  const any = useMemo(() => {
    if (nodes.some((n) => !n.hidden && ((n.data as { proposed?: boolean }).proposed || (n.type === 'entity' && model.isHypothetical(entityOf(n) ?? ''))))) return true;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges.some((e) => {
      if (e.hidden) return false;
      if (e.data?.proposed) return true;
      const st = edgeStatus(model, entityOf(byId.get(e.source)), entityOf(byId.get(e.target)), e.data);
      if (st === 'indirect') return (e.data?.indirect?.relationIds ?? []).some((rid) => model.relation(rid)?.confidence === 'hypothetical');
      return st === 'hypothetical' || st === 'unverified';
    });
  }, [nodes, edges, model]);
  if (!any) return null;
  return (
    <div
      className="studio-overlay pointer-events-auto inline-flex items-center gap-2 rounded-full border border-dashed px-2.5 py-1 text-[11.5px] shadow-panel"
      style={{ borderColor: 'var(--k-hypo)', background: 'color-mix(in srgb, var(--k-hypo) 9%, var(--surface))' }}
      data-testid="hypo-legend"
      title="Purple dashed elements are hypothetical: proposed or drawn by you, not part of Meridian today."
    >
      <svg width="26" height="8" aria-hidden>
        <line x1="1" y1="4" x2="25" y2="4" style={{ stroke: 'var(--k-hypo)' }} strokeWidth="2" strokeDasharray="5 3" />
      </svg>
      <span>
        <b style={{ color: 'var(--k-hypo)' }}>Purple dashed</b> = hypothetical / not in Meridian
      </span>
    </div>
  );
}
