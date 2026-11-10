/** Dialog panels opened from the top bar and by shortcuts: tour, guided questions, shortcuts, glossary, views, workspace, about. */
import { useMemo, useState } from 'react';
import { Bookmark, Clapperboard, Download, ExternalLink, Map as MapIcon, PenTool, RotateCcw, Star, Trash2, Upload } from 'lucide-react';
import { baseModel, CHANNELS, KIND_LABEL, REPO, type EntityKind } from '@/model';
import { MODES, useApp, type ModeId } from '@/state/app';
import { useModel } from '@/state/hooks';
import { downloadText, exportWorkspace, parseImport, pickTextFile } from '@/state/io';
import { useWorkspace } from '@/state/workspace';
import { Badge, Button, cn, Dialog, Empty, inputClass, renderInline, SectionTitle } from '@/ui/primitives';
import { CHANNEL_COLOR, CONFIDENCE_INFO, ConfidenceBadge, entityColor, KIND_COLOR, KindIcon } from '@/ui/kinds';
import { EntityChip } from '@/viewers/Fields';
import { GUIDED_QUESTIONS } from '@/model/data/questions';
import { formatKeys, useRegisteredHotkeys, type HotkeyGroup } from './hotkeys';
import { runQuestion } from './questions';
import { EvaluationPanel } from './EvaluationPanel';
import { LayersPanel } from './LayersPanel';
import { Logo } from './TopBar';

const MODE_ICON: Record<ModeId, typeof MapIcon> = { atlas: MapIcon, theater: Clapperboard, studio: PenTool };

export function Panels() {
  const help = useApp((s) => s.help);
  const setHelp = useApp((s) => s.setHelp);
  const close = () => setHelp(null);
  switch (help) {
    case 'tour':
      return <Tour onClose={close} />;
    case 'questions':
      return <Questions onClose={close} />;
    case 'shortcuts':
      return <Shortcuts onClose={close} />;
    case 'glossary':
      return <Glossary onClose={close} />;
    case 'views':
      return <Views onClose={close} />;
    case 'workspace':
      return <Workspace onClose={close} />;
    case 'about':
      return <About onClose={close} />;
    case 'evaluation':
      return <EvaluationPanel onClose={close} />;
    case 'layers':
      return <LayersPanel onClose={close} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tour
// ---------------------------------------------------------------------------

const MODE_PITCH: Record<ModeId, { verb: string; body: string; try: string }> = {
  atlas: {
    verb: 'Explore where things are',
    body: 'A map of the system. Start at Meridian, click to open it up, and keep drilling: applications, subsystems, modules, endpoints, functions. Click any line to see what travels over it.',
    try: 'Click “Meridian”, then “Backend API”. Press F to focus on one part.',
  },
  theater: {
    verb: 'Watch what happens',
    body: 'Pick a question — “what happens when a customer transfers money?” — and step through it: who calls whom, the data on the wire, and the database before and after. Switch outcomes to see failures.',
    try: 'Press → to step, Space to play. Choose a different outcome at a decision.',
  },
  studio: {
    verb: 'Build an explanation',
    body: 'A canvas that already knows Meridian. Drop real components on it and their known connections appear. Add notes, data, code, a what-if component — whatever answers the question in front of you.',
    try: 'Press N to add a component. Drag from one box to another to connect them.',
  },
};

function Tour({ onClose }: { onClose: () => void }) {
  const setTourSeen = useWorkspace((s) => s.setTourSeen);
  const setMode = useApp((s) => s.setMode);
  const setHelp = useApp((s) => s.setHelp);
  const stats = useMemo(() => baseModel.stats(), []);
  const done = () => {
    setTourSeen(true);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={done}
      width={860}
      title={
        <span className="inline-flex items-center gap-2">
          <Logo size={20} /> Welcome to Meridian Explorer
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-fg-subtle">
            Reopen this from <b>?</b> → Quick tour. Press <kbd>/</kbd> anywhere to search.
          </span>
          <Button
            onClick={() => {
              setTourSeen(true);
              setHelp('questions');
            }}
          >
            Start from a question
          </Button>
          <Button variant="primary" onClick={done} data-testid="tour-done">
            Start exploring
          </Button>
        </>
      }
    >
      <p className="mb-3 mt-0 text-[13px] leading-relaxed text-fg-muted">
        Three ways to explore and explain <b className="text-fg">Meridian</b>, a simulated banking platform (customer app, operations simulator, backend API). Everything shown is drawn from one model of the real repository — {stats.entities.toLocaleString('en-US')} components, {stats.relations.toLocaleString('en-US')} relationships, {stats.contracts} API contracts and {stats.scenarios} step-by-step scenarios — each linked to the source lines it came from.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => {
          const Icon = MODE_ICON[m.id];
          const p = MODE_PITCH[m.id];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                done();
              }}
              className={cn(`mode-${m.id} group flex flex-col rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent`)}
              data-testid={`tour-${m.id}`}
            >
              <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
                <Icon size={18} />
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent">{p.verb}</span>
              <span className="mt-0.5 text-[14px] font-semibold">{m.label}</span>
              <span className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-fg-muted">{p.body}</span>
              <span className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-[11.5px] text-fg">
                <b>Try:</b> {p.try}
              </span>
              <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent">
                Open <kbd>{m.keys}</kbd>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid gap-2 text-[12px] text-fg-muted md:grid-cols-2">
        <div className="rounded-md border border-line p-2.5">
          <b className="text-fg">Shared across all three.</b> The same search, the same inspector (contract, data, code, relations, workflows, impact), audience presets with a detail dial, and saved views. Selecting something in one mode carries over to the others.
        </div>
        <div className="rounded-md border border-dashed border-hypo p-2.5">
          <b className="text-hypo">What-if without touching the baseline.</b> Add hypothetical components and changes in a separate layer. They are always drawn dashed and purple, and can be switched off or discarded.
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
        How sure is each fact?
        {(Object.keys(CONFIDENCE_INFO) as (keyof typeof CONFIDENCE_INFO)[]).map((c) => (
          <ConfidenceBadge key={c} confidence={c} />
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Guided questions
// ---------------------------------------------------------------------------

function Questions({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Start from a question" width={760}>
      <p className="mb-3 mt-0 text-[12.5px] text-fg-muted">Each question has a prepared starting point in every mode, so you can compare how the three approaches explain the same thing.</p>
      <div className="flex flex-col gap-2">
        {GUIDED_QUESTIONS.map((q, i) => (
          <div key={q.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-2.5" data-question={q.id}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-fg-muted">{i + 1}</span>
            <div className="min-w-[220px] flex-1">
              <div className="text-[13px] font-semibold">{q.question}</div>
              <div className="text-[12px] text-fg-muted">{q.blurb}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              {MODES.map((m) => {
                const Icon = MODE_ICON[m.id];
                return (
                  <Button
                    key={m.id}
                    size="sm"
                    className={`mode-${m.id}`}
                    icon={<Icon size={12} className="text-accent" />}
                    onClick={() => {
                      onClose();
                      runQuestion(q, m.id);
                    }}
                    data-testid={`question-${q.id}-${m.id}`}
                  >
                    {m.label.split(' ')[1]}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

const GROUP_ORDER: HotkeyGroup[] = ['Everywhere', 'Presenting', 'Architecture Atlas', 'Scenario Theater', 'Explanation Studio'];

function Shortcuts({ onClose }: { onClose: () => void }) {
  const hotkeys = useRegisteredHotkeys();
  const mode = useApp((s) => s.mode);
  const groups = GROUP_ORDER.map((g) => ({ group: g, items: hotkeys.filter((h) => h.group === g) })).filter((g) => g.items.length);
  const modeLabel = MODES.find((m) => m.id === mode)!.label;
  return (
    <Dialog open onClose={onClose} title="Keyboard shortcuts" width={760}>
      <p className="mb-3 mt-0 text-[12.5px] text-fg-muted">
        Every shortcut also has a button on screen. Shortcuts are off while you type in a field. This list shows what is active right now in <b className="text-fg">{modeLabel}</b>; other modes list theirs when open.
      </p>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2" data-testid="shortcut-list">
        {groups.map((g) => (
          <section key={g.group}>
            <SectionTitle>{g.group}</SectionTitle>
            <div className="flex flex-col">
              {g.items.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 border-b border-line py-1 text-[12.5px] last:border-b-0">
                  <span>{h.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {formatKeys(h.keys).map((k, i) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-[10px] text-fg-subtle">or</span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

function Glossary({ onClose }: { onClose: () => void }) {
  const model = useModel();
  const [q, setQ] = useState('');
  const terms = model.glossary.filter((g) => `${g.term} ${g.definition} ${(g.aliases ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  // Several slices may define the same term; keep the first.
  const unique = terms.filter((t, i) => terms.findIndex((x) => x.term.toLowerCase() === t.term.toLowerCase()) === i);
  return (
    <Dialog open onClose={onClose} title={`Glossary (${unique.length})`} width={720}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter terms…" aria-label="Filter glossary" className={cn(inputClass, 'mb-3')} />
      {unique.length === 0 && <Empty title="No term matches" />}
      <dl className="m-0 flex flex-col" data-testid="glossary-list">
        {unique.map((g) => (
          <div key={g.term} className="border-b border-line py-2 last:border-b-0">
            <dt className="text-[13px] font-semibold">{g.term}</dt>
            <dd className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{renderInline(g.definition)}</dd>
            {g.related && g.related.length > 0 && (
              <dd className="m-0 mt-1.5 flex flex-wrap gap-1" onClick={onClose}>
                {g.related
                  .filter((id) => model.has(id))
                  .slice(0, 5)
                  .map((id) => (
                    <EntityChip key={id} id={id} />
                  ))}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Saved views, bookmarks, recents
// ---------------------------------------------------------------------------

function Views({ onClose }: { onClose: () => void }) {
  const model = useModel();
  const views = useWorkspace((s) => s.views);
  const starred = useWorkspace((s) => s.starred);
  const recents = useWorkspace((s) => s.recents);
  const deleteView = useWorkspace((s) => s.deleteView);
  const renameView = useWorkspace((s) => s.renameView);
  const toggleStar = useWorkspace((s) => s.toggleStar);
  const captureView = useApp((s) => s.captureView);
  const applyView = useApp((s) => s.applyView);
  const mode = useApp((s) => s.mode);
  const selection = useApp((s) => s.selection);
  const toast = useApp((s) => s.toast);
  const selectEntity = useApp((s) => s.selectEntity);
  const openInAtlas = useApp((s) => s.openInAtlas);
  const selectedName = selection?.type === 'entity' ? model.entity(selection.id)?.name : undefined;
  const [label, setLabel] = useState(`${MODES.find((m) => m.id === mode)!.label.split(' ')[1]}${selectedName ? ` — ${selectedName}` : ''}`);

  const pick = (id: string) => {
    onClose();
    if (mode === 'atlas') openInAtlas(id);
    else selectEntity(id, { openInspector: true });
  };

  return (
    <Dialog open onClose={onClose} title="Saved views & bookmarks" width={640}>
      <section>
        <SectionTitle>Save what you are looking at</SectionTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            captureView(label.trim());
            toast('View saved', 'ok');
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} aria-label="View name" data-testid="view-name" />
          <Button variant="primary" type="submit" icon={<Bookmark size={13} />} data-testid="save-view">
            Save view
          </Button>
        </form>
        <p className="mb-0 mt-1 text-[11.5px] text-fg-subtle">Captures the mode, selection, audience, what is expanded or focused in the Atlas, the scenario and step in the Theater, and the active Studio board.</p>
      </section>

      <section className="mt-4">
        <SectionTitle>Saved views ({views.length})</SectionTitle>
        {views.length === 0 ? (
          <p className="m-0 text-[12.5px] italic text-fg-subtle">Nothing saved yet.</p>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-md border border-line" data-testid="saved-views">
            {views.map((v) => {
              const Icon = MODE_ICON[v.mode];
              return (
                <div key={v.id} className="flex items-center gap-2 border-t border-line px-2 py-1.5 first:border-t-0">
                  <Icon size={14} className={`mode-${v.mode} shrink-0 text-accent`} />
                  <input
                    defaultValue={v.label}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== v.label && renameView(v.id, e.target.value.trim())}
                    aria-label="Rename view"
                    className="min-w-0 flex-1 rounded bg-transparent px-1 text-[12.5px] font-medium outline-none hover:bg-surface-2 focus:bg-surface-2"
                  />
                  <span className="shrink-0 text-[10.5px] text-fg-subtle">{new Date(v.createdAt).toLocaleDateString()}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      applyView(v);
                      onClose();
                    }}
                    data-testid="open-view"
                  >
                    Open
                  </Button>
                  <button type="button" aria-label={`Delete view ${v.label}`} onClick={() => deleteView(v.id)} className="rounded p-1 text-fg-subtle hover:text-bad">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section>
          <SectionTitle>Bookmarked items ({starred.length})</SectionTitle>
          {starred.length === 0 && (
            <p className="m-0 text-[12.5px] italic text-fg-subtle">
              Use the <Star size={11} className="inline" /> in the inspector to bookmark a component.
            </p>
          )}
          <div className="flex flex-col gap-1">
            {starred.map((id) => {
              const e = model.entity(id);
              if (!e) return null;
              return (
                <div key={id} className="flex items-center gap-1.5">
                  <button type="button" onClick={() => pick(id)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-2">
                    <span style={{ color: entityColor(e) }}>
                      <KindIcon kind={e.kind} size={13} />
                    </span>
                    <span className="truncate">{e.name}</span>
                  </button>
                  <button type="button" aria-label={`Remove bookmark ${e.name}`} onClick={() => toggleStar(id)} className="rounded p-1 text-fg-subtle hover:text-bad">
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <SectionTitle>Recently viewed</SectionTitle>
          {recents.length === 0 && <p className="m-0 text-[12.5px] italic text-fg-subtle">Nothing yet.</p>}
          <div className="flex flex-col gap-1">
            {recents.slice(0, 10).map((id) => {
              const e = model.entity(id);
              if (!e) return null;
              return (
                <button key={id} type="button" onClick={() => pick(id)} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-2">
                  <span style={{ color: entityColor(e) }}>
                    <KindIcon kind={e.kind} size={13} />
                  </span>
                  <span className="truncate">{e.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Workspace: export / import / reset
// ---------------------------------------------------------------------------

function Workspace({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useApp((s) => s.toast);
  const [result, setResult] = useState<{ errors?: string[]; warnings?: string[]; message?: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const userLayers = ws.layers.filter((l) => !l.builtIn);

  const doExport = () => {
    downloadText(`meridian-explorer-workspace-${new Date().toISOString().slice(0, 10)}.json`, exportWorkspace(ws));
    toast('Workspace exported', 'ok');
  };
  const doImport = async (mode: 'merge' | 'replace') => {
    const text = await pickTextFile();
    if (text === null) return;
    const r = parseImport(text);
    if (!r.ok) return setResult({ errors: r.errors });
    switch (r.kind) {
      case 'workspace':
        if (mode === 'replace') ws.replaceWorkspace(r.data);
        else ws.mergeWorkspace(r.data);
        setResult({ warnings: r.warnings, message: `Workspace ${mode === 'replace' ? 'replaced' : 'merged'}: ${r.data.boards.length} boards, ${r.data.customScenarios.length} custom scenarios, ${r.data.layers.filter((l) => !l.builtIn).length} layers, ${r.data.views.length} views.` });
        break;
      case 'board':
        ws.saveBoard(r.data);
        setResult({ warnings: r.warnings, message: `Imported board “${r.data.name}”.` });
        break;
      case 'scenario':
        ws.saveCustomScenario(r.data);
        setResult({ warnings: r.warnings, message: `Imported scenario “${r.data.title}”.` });
        break;
      case 'layer':
        useWorkspace.setState((s) => ({ layers: [...s.layers.filter((l) => l.id !== r.data.id), r.data] }));
        setResult({ warnings: r.warnings, message: `Imported hypothetical layer “${r.data.name}” (switched off — enable it from What-if).` });
        break;
    }
  };

  return (
    <Dialog open onClose={onClose} title="Workspace: export, import & reset" width={600}>
      <p className="mb-3 mt-0 text-[12.5px] text-fg-muted">Everything you create is stored in this browser only. Export it to a file to keep it, move it to another machine or send it to someone.</p>
      <div className="mb-3 grid grid-cols-5 gap-2 text-center" data-testid="workspace-counts">
        {(
          [
            ['Boards', ws.boards.length],
            ['Scenarios', ws.customScenarios.length],
            ['What-if layers', userLayers.length],
            ['Saved views', ws.views.length],
            ['Bookmarks', ws.starred.length],
          ] as const
        ).map(([l, n]) => (
          <div key={l} className="rounded-md border border-line bg-surface-2 py-2">
            <div className="text-[16px] font-semibold">{n}</div>
            <div className="text-[10.5px] text-fg-subtle">{l}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Download size={13} />} onClick={doExport} data-testid="export-workspace">
          Export workspace (JSON)
        </Button>
        <Button icon={<Upload size={13} />} onClick={() => void doImport('merge')} data-testid="import-merge">
          Import & merge…
        </Button>
        <Button icon={<Upload size={13} />} onClick={() => void doImport('replace')}>
          Import & replace…
        </Button>
      </div>
      <p className="mb-0 mt-1.5 text-[11.5px] text-fg-subtle">Import accepts a whole workspace or a single exported board, scenario or layer. Files are validated; imported content is always treated as user-created, never as verified Meridian facts.</p>
      {result && (
        <div className="mt-3 rounded-md border border-line p-2.5 text-[12.5px]" role="status" data-testid="import-result">
          {result.message && <div className="font-medium text-ok">{result.message}</div>}
          {result.errors && (
            <div className="text-bad">
              <b>Import failed.</b>
              <ul className="mb-0 mt-1 pl-4">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mb-0 mt-1 pl-4 text-warn">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-5 rounded-md border border-line p-2.5">
        <div className="text-[12.5px] font-semibold">Reset</div>
        <p className="mb-2 mt-0.5 text-[12px] text-fg-muted">Deletes every board, custom scenario, hypothetical layer, saved view, bookmark and evaluation note stored in this browser. The Meridian model is unaffected.</p>
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              className="border-bad!"
              icon={<Trash2 size={13} />}
              onClick={() => {
                ws.resetWorkspace();
                setConfirmReset(false);
                setResult({ message: 'Workspace reset.' });
              }}
              data-testid="confirm-reset"
            >
              Yes, delete everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button icon={<RotateCcw size={13} />} onClick={() => setConfirmReset(true)} data-testid="reset-workspace">
            Reset workspace…
          </Button>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// About & coverage
// ---------------------------------------------------------------------------

function About({ onClose }: { onClose: () => void }) {
  const stats = useMemo(() => baseModel.stats(), []);
  const kinds = useMemo(() => {
    const m = new Map<EntityKind, number>();
    for (const e of baseModel.entities.values()) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);
  return (
    <Dialog open onClose={onClose} title="About Meridian Explorer & source coverage" width={760}>
      <div className="flex flex-col gap-4 text-[12.5px] leading-relaxed text-fg-muted">
        <p className="m-0">
          Meridian Explorer is an independent, static web app for explaining the{' '}
          <a href={REPO.url} target="_blank" rel="noreferrer noopener" className="font-medium text-accent">
            Meridian <ExternalLink size={10} className="inline" />
          </a>{' '}
          simulated banking platform. Meridian is a <b className="text-fg">simulation</b>: no real money, accounts, cards or financial integrations. The explorer contains no AI: search is a local index and every explanation is curated content.
        </p>
        <section>
          <SectionTitle>What the model is built from</SectionTitle>
          <p className="m-0">
            The repository <code>{REPO.owner}/{REPO.repo}</code> at commit{' '}
            <a href={`${REPO.url}/tree/${REPO.sha}`} target="_blank" rel="noreferrer noopener" className="font-mono text-accent">
              {REPO.sha.slice(0, 10)}
            </a>{' '}
            ({REPO.commitDate}, v{REPO.version}). Source links and code excerpts point at that exact revision. The model is static — it does not follow later changes to the repository.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center md:grid-cols-6" data-testid="about-stats">
            {(
              [
                ['Components', stats.entities],
                ['Relationships', stats.relations],
                ['API contracts', stats.contracts],
                ['Scenarios', stats.scenarios],
                ['State machines', stats.stateMachines],
                ['Source references', stats.sourceRefs],
              ] as const
            ).map(([l, n]) => (
              <div key={l} className="rounded-md border border-line bg-surface-2 py-2">
                <div className="text-[16px] font-semibold text-fg">{n.toLocaleString()}</div>
                <div className="text-[10.5px] text-fg-subtle">{l}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle>How much to trust each statement</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(CONFIDENCE_INFO) as (keyof typeof CONFIDENCE_INFO)[]).map((c) => (
              <div key={c} className="flex items-start gap-2">
                <span className="w-24 shrink-0">
                  <ConfidenceBadge confidence={c} />
                </span>
                <span>
                  {CONFIDENCE_INFO[c].description}
                  {c !== 'hypothetical' && <span className="text-fg-subtle"> ({stats.byConfidence[c]} components)</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-2">
            Every cited line range carries a short string that must appear inside it; a script checks all of them against a clone of the repository (<code>npm run model:verify</code>), so references cannot silently drift.
          </p>
        </section>
        <section>
          <SectionTitle>What is modelled</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map(([k, n]) => (
              <Badge key={k} color={KIND_COLOR[k]}>
                <KindIcon kind={k} size={11} /> {KIND_LABEL[k]} · {n}
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => (
              <Badge key={c.id} color={CHANNEL_COLOR[c.id]} title={c.description}>
                {c.label}
              </Badge>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle>Known gaps</SectionTitle>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
            <li>Private helpers and UI-only components are modelled selectively; follow the GitHub link on any module for the rest.</li>
            <li>Example data in scenarios is illustrative (modelled on the seeded demo personas), not a dump of the seed.</li>
            <li>The reverse proxy, service units and host live in a separate infrastructure repository and are described only as far as Meridian’s own documentation states.</li>
            <li>Marketing pages, styling and image assets are summarised, not detailed.</li>
          </ul>
          <p className="mb-0 mt-2">
            Full details are in <code>docs/SOURCE_COVERAGE.md</code> in the explorer’s repository.
          </p>
        </section>
        <section>
          <SectionTitle>Live demo</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <a href={REPO.live.customer} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-fg hover:bg-surface-2">
              Customer app <ExternalLink size={11} />
            </a>
            <a href={REPO.live.operations} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-fg hover:bg-surface-2">
              Operations simulator <ExternalLink size={11} />
            </a>
          </div>
          <p className="mb-0 mt-1.5 text-[11.5px] text-fg-subtle">A shared, disposable public demo that is periodically reset. The explorer never signs in for you and never sends state-changing requests.</p>
        </section>
      </div>
    </Dialog>
  );
}
