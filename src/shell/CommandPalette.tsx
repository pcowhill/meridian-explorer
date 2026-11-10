/**
 * Global search + command palette (press `/` or ⌘K). Results come from the
 * local MiniSearch index; choosing one navigates to it in the active mode.
 */
import { Command } from 'cmdk';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Clapperboard, CornerDownLeft, FlaskConical, GitBranch, Map as MapIcon, PenTool, Search, Workflow } from 'lucide-react';
import type { SearchResult } from '@/model';
import { MODES, useApp, type ModeId } from '@/state/app';
import { useModel, useScenarios, useSearchIndex } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { entityColor, KindIcon } from '@/ui/kinds';
import { cn, Tip } from '@/ui/primitives';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { runQuestion } from './questions';

const ENTER_HINT: Record<ModeId, string> = {
  atlas: 'reveal on the map',
  theater: 'play its workflow',
  studio: 'add to the board',
};

type Filter = 'all' | 'entity' | 'endpoint' | 'data' | 'scenario' | 'term';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'entity', label: 'Components' },
  { id: 'endpoint', label: 'Endpoints' },
  { id: 'data', label: 'Data & types' },
  { id: 'scenario', label: 'Scenarios' },
  { id: 'term', label: 'Glossary' },
];

export function CommandPalette() {
  const open = useApp((s) => s.commandOpen);
  const setOpen = useApp((s) => s.setCommandOpen);
  if (!open) return null;
  return createPortal(<Palette onClose={() => setOpen(false)} />, document.body);
}

function Palette({ onClose }: { onClose: () => void }) {
  const model = useModel();
  const index = useSearchIndex();
  const scenarios = useScenarios();
  const mode = useApp((s) => s.mode);
  const app = useApp;
  const recents = useWorkspace((s) => s.recents);
  const starred = useWorkspace((s) => s.starred);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const keep = (r: SearchResult): boolean => {
      if (filter === 'all') return true;
      if (filter === 'scenario') return r.type === 'scenario';
      if (filter === 'term') return r.type === 'term' || r.type === 'machine';
      if (r.type !== 'entity') return false;
      const kind = model.entity(r.id)?.kind;
      if (filter === 'endpoint') return kind === 'endpoint';
      if (filter === 'data') return kind === 'db-model' || kind === 'type' || kind === 'constant' || kind === 'datastore' || kind === 'event';
      return kind !== 'endpoint' && kind !== 'db-model' && kind !== 'type' && kind !== 'constant';
    };
    const found = index.search(query, 40, keep);
    // Custom scenarios are not in the model index; match them by title.
    const q = query.toLowerCase();
    const custom: SearchResult[] =
      filter === 'all' || filter === 'scenario'
        ? scenarios
            .filter((s) => s.custom && `${s.title} ${s.question}`.toLowerCase().includes(q))
            .map((s) => ({ key: `scenario:${s.id}`, type: 'scenario' as const, id: s.id, title: s.title, subtitle: s.question, kind: 'Custom scenario', score: 1 }))
        : [];
    return [...custom, ...found];
  }, [query, filter, index, model, scenarios]);

  /** Navigate to a result in the given mode (defaults to the active one). */
  const go = (r: SearchResult, target: ModeId = mode) => {
    const s = app.getState();
    onClose();
    if (r.type === 'scenario') return s.openInTheater(r.id);
    if (r.type === 'term') return s.select({ type: 'term', term: r.id }, { openInspector: true });
    if (r.type === 'machine') return s.select({ type: 'machine', id: r.id }, { openInspector: true });
    const entity = model.entity(r.id);
    if (!entity) return;
    if (entity.kind === 'feature') {
      s.select({ type: 'entity', id: r.id }, { openInspector: true });
      if (target === 'atlas') {
        s.atlasLens(r.id);
        s.setMode('atlas');
      }
      return;
    }
    if (target === 'atlas') return s.openInAtlas(r.id);
    if (target === 'studio') {
      s.select({ type: 'entity', id: r.id }, { openInspector: true });
      return s.sendToStudio({ title: entity.name, source: 'search', entities: [r.id] });
    }
    // Theater: play the most relevant workflow; otherwise assemble a trace for an endpoint; otherwise just select.
    s.select({ type: 'entity', id: r.id }, { openInspector: true, tab: 'workflows' });
    const best = model.scenariosFor(r.id)[0];
    if (best) return s.openInTheater(best.id);
    if (model.contract(r.id)) return s.openInTheater(`trace:${r.id}`);
    s.setMode('theater');
  };

  const idle = !query.trim();
  const recentEntities = recents.map((id) => model.entity(id)).filter((e) => !!e).slice(0, 6);
  const starredEntities = starred.map((id) => model.entity(id)).filter((e) => !!e).slice(0, 6);
  const toResult = (id: string): SearchResult => {
    const e = model.entity(id)!;
    return { key: `entity:${id}`, type: 'entity', id, title: e.name, subtitle: e.summary, kind: e.kind, score: 0 };
  };

  return (
    <div className="fixed inset-0 z-[960] flex items-start justify-center bg-black/40 p-4 pt-[9vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Command shouldFilter={false} label="Search Meridian" loop className="animate-fade-in flex max-h-[76vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop" data-testid="command-palette">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={16} className="shrink-0 text-fg-subtle" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search components, endpoints, types, tables, scenarios, terms…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none! placeholder:text-fg-subtle"
            data-testid="command-input"
          />
          <kbd>Esc</kbd>
        </div>
        {!idle && (
          <div className="flex items-center gap-1 border-b border-line px-3 py-1.5" role="group" aria-label="Filter results">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn('h-6 rounded-full px-2 text-[11.5px] font-medium', filter === f.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-surface-2')}>
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-fg-subtle">
              {results.length} result{results.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
        <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-fg-subtle">
          {!idle && results.length === 0 && <Command.Empty className="px-3 py-8 text-center text-[13px] text-fg-muted">Nothing matches “{query}”. Try a file name, an endpoint path or a plain word like “balance”.</Command.Empty>}

          {!idle && results.length > 0 && (
            <Command.Group heading="Results">
              {results.map((r) => (
                <ResultRow key={r.key} result={r} onGo={go} />
              ))}
            </Command.Group>
          )}

          {idle && (
            <>
              <Command.Group heading="Start from a question">
                {GUIDED_QUESTIONS.map((q) => (
                  <Command.Item
                    key={q.id}
                    value={`question ${q.id}`}
                    onSelect={() => {
                      onClose();
                      runQuestion(q, mode);
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] data-[selected=true]:bg-surface-2"
                  >
                    <Workflow size={14} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">{q.question}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {starredEntities.length > 0 && (
                <Command.Group heading="Bookmarked">
                  {starredEntities.map((e) => (
                    <ResultRow key={`star-${e.id}`} result={toResult(e.id)} onGo={go} />
                  ))}
                </Command.Group>
              )}
              {recentEntities.length > 0 && (
                <Command.Group heading="Recent">
                  {recentEntities.map((e) => (
                    <ResultRow key={`recent-${e.id}`} result={toResult(e.id)} onGo={go} />
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Go to">
                {MODES.map((m) => (
                  <Command.Item
                    key={m.id}
                    value={`mode ${m.id}`}
                    onSelect={() => {
                      onClose();
                      app.getState().setMode(m.id);
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] data-[selected=true]:bg-surface-2"
                  >
                    {m.id === 'atlas' ? <MapIcon size={14} /> : m.id === 'theater' ? <Clapperboard size={14} /> : <PenTool size={14} />}
                    <span className="flex-1">{m.label}</span>
                    <span className="text-[11.5px] text-fg-subtle">{m.tagline}</span>
                    <kbd>{m.keys}</kbd>
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line bg-surface-2 px-3 py-1.5 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>{' '}
            {ENTER_HINT[mode]}
          </span>
          <span className="ml-auto">Local index of {index.size} items · no network, no AI</span>
        </div>
      </Command>
    </div>
  );
}

function ResultRow({ result, onGo }: { result: SearchResult; onGo: (r: SearchResult, mode?: ModeId) => void }) {
  const model = useModel();
  const entity = result.type === 'entity' ? model.entity(result.id) : undefined;
  const hypo = entity?.confidence === 'hypothetical' || result.kind.startsWith('Hypothetical');
  const icon =
    result.type === 'scenario' ? (
      <Clapperboard size={14} className="text-[color:var(--c-call)]" />
    ) : result.type === 'term' ? (
      <BookOpen size={14} className="text-fg-muted" />
    ) : result.type === 'machine' ? (
      <GitBranch size={14} className="text-[color:var(--k-event)]" />
    ) : entity ? (
      <span style={{ color: entityColor(entity) }}>
        <KindIcon kind={entity.kind} size={14} />
      </span>
    ) : null;
  return (
    <Command.Item value={result.key} onSelect={() => onGo(result)} className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 data-[selected=true]:bg-surface-2" data-result={result.key}>
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[12.5px] font-semibold text-fg', entity && ['function', 'endpoint', 'type', 'constant'].includes(entity.kind) && 'font-mono text-[12px]')}>{result.title}</span>
          {hypo && <FlaskConical size={11} className="shrink-0 text-hypo" />}
        </span>
        <span className="block truncate text-[11.5px] text-fg-muted">{result.subtitle}</span>
      </span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{entity ? result.kind.replace(/-/g, ' ') : result.kind}</span>
      {result.type === 'entity' && entity?.kind !== 'feature' && (
        <span className="hidden shrink-0 items-center gap-0.5 group-data-[selected=true]:flex">
          {(
            [
              ['atlas', MapIcon, 'Reveal in Atlas'],
              ['theater', Clapperboard, 'Play workflow in Theater'],
              ['studio', PenTool, 'Add to Studio board'],
            ] as const
          ).map(([m, Icon, label]) => (
            <Tip key={m} label={label} side="top">
              <button
                type="button"
                aria-label={label}
                onClick={(e) => {
                  e.stopPropagation();
                  onGo(result, m);
                }}
                className="rounded p-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <Icon size={13} />
              </button>
            </Tip>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
