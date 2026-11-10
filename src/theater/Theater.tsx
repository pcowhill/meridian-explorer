/**
 * Mode 2 — Scenario Theater: temporal and behavioural exploration.
 *
 * A presenter picks a scenario (or assembles one from any endpoint), then
 * steps through it; the audience sees the system-level flow (sequence, stage
 * or timeline view) and the detail of the current step side by side.
 *
 * Files (all in src/theater/):
 *   Theater.tsx        this entry: resolves the scenario, derives the visible
 *                      steps, owns playback / edit-mode / layout state,
 *                      declares the hotkeys and lays out the panels.
 *   context.tsx        TheaterCtx — the derived state shared with every panel
 *                      (scenario, variant, visible steps, clamped index, marks,
 *                      go(), switchVariant()) + step-kind icons/outcome colours.
 *   logic.ts           pure functions (unit-tested in logic.test.ts): scenario
 *                      resolution incl. `trace:<endpoint>`, step marks, variant
 *                      mapping, paths overview, playback pacing, stage layout,
 *                      editing operations, Studio hand-off.
 *   drafts.ts          zustand store of unsaved edits (sessionStorage-backed).
 *   Library.tsx        left rail (filter, categories, "Workflows involving …")
 *                      and the landing page.
 *   SequenceView.tsx   sequence diagram with sticky lane headers.
 *   StageView.tsx      animated architecture view (nodes grouped by app).
 *   TimelineView.tsx   storyboard of step cards.
 *   Transport.tsx      play controls, speed, scrubber, counter, outcome select,
 *                      paths overview.
 *   StepPanel.tsx      the current step: narrative, decision, payload,
 *                      database before/after, balances, code.
 *   Editor.tsx         edit mode: outline (reorder/duplicate/delete/insert,
 *                      participants, reusable steps) and the step form.
 *   EndpointPicker.tsx / EntityPicker.tsx   searchable pickers.
 *   useElementSize.ts  ResizeObserver hook; theater.css  the pulse keyframes.
 *   *.test.ts(x)       logic unit tests + component tests of the main flows.
 *
 * Data flow: `useApp().theater` (scenarioId, variant, stepIndex, view, speed)
 * is the single source of truth for what is shown — deep links and other modes
 * drive it. The scenario is resolved from drafts → workspace custom scenarios
 * → the model (incl. hypothetical layers) → `assembleTrace` for `trace:` ids.
 * Everything else (visible steps, marks, database states, layouts) is derived
 * and memoised. Playing/paused, edit mode, panel sizes are local.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeftRight,
  Eye,
  Link2,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenTool,
  Copy as CopyIcon,
  Download,
  SearchX,
  Network,
  Wand2,
} from 'lucide-react';
import { assembleTrace, stepDetail, variantSteps, visibleSteps, type DetailLevel, type Scenario } from '@/model';
import { useApp, type TheaterView } from '@/state/app';
import { useModel } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { downloadText, makeExport, parseImport, pickTextFile } from '@/state/io';
import { useHotkeys } from '@/shell/hotkeys';
import { Badge, Button, cn, Empty, IconButton, MenuItem, Popover, Tabs, Tip } from '@/ui/primitives';
import { ConfidenceBadge } from '@/ui/kinds';
import { TheaterCtx, useTheater, type TheaterData } from './context';
import { useDrafts } from './drafts';
import {
  blankScenario,
  clampIndex,
  customizeCopy,
  effectiveVariant,
  followStep,
  isTraceId,
  mapIndexOnVariantChange,
  nextInteresting,
  nextSpeed,
  resolveScenario,
  sanitiseImported,
  stepDuration,
  stepMarks,
  studioRequest,
  TRACE_PREFIX,
  uniqueImportId,
} from './logic';
import { Involving, Landing, Library } from './Library';
import { SequenceView } from './SequenceView';
import { StageView } from './StageView';
import { TimelineView } from './TimelineView';
import { Transport } from './Transport';
import { StepPanel } from './StepPanel';
import { Outline, StepForm, type EditorApi } from './Editor';
import { EndpointPicker } from './EndpointPicker';
import { useElementSize } from './useElementSize';
import './theater.css';

const VIEWS: { value: TheaterView; label: string; title: string }[] = [
  { value: 'sequence', label: 'Sequence', title: 'Sequence diagram — who talks to whom, in order' },
  { value: 'stage', label: 'Stage', title: 'Architecture stage — the path through the system' },
  { value: 'timeline', label: 'Timeline', title: 'Timeline — every step at a glance' },
];

const LIB_KEY = 'meridian-explorer:theater-library';
const readLib = (): boolean => {
  try {
    return localStorage.getItem(LIB_KEY) !== '0';
  } catch {
    return true;
  }
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'scenario';

export default function Theater() {
  const model = useModel();
  const custom = useWorkspace((s) => s.customScenarios);
  const saveCustom = useWorkspace((s) => s.saveCustomScenario);
  const deleteCustom = useWorkspace((s) => s.deleteCustomScenario);
  const drafts = useDrafts((s) => s.drafts);
  const setDraft = useDrafts((s) => s.setDraft);
  const clearDraft = useDrafts((s) => s.clearDraft);
  const theater = useApp(useShallow((s) => s.theater));
  const detail = useApp((s) => s.detail);
  const selection = useApp((s) => s.selection);
  const toast = useApp((s) => s.toast);
  const theaterOpen = useApp((s) => s.theaterOpen);
  const theaterSetStep = useApp((s) => s.theaterSetStep);
  const theaterSetView = useApp((s) => s.theaterSetView);
  const reduced = useReducedMotion() ?? false;

  const root = useRef<HTMLDivElement>(null);
  const { width: rootW } = useElementSize(root);
  const [libOpen, setLibOpenState] = useState(readLib);
  const setLibOpen = useCallback((v: boolean) => {
    setLibOpenState(v);
    try {
      localStorage.setItem(LIB_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  const [playing, setPlaying] = useState(false);
  const [pauseAtDecisions, setPauseAtDecisions] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [panelW, setPanelW] = useState(370);
  /** In narrow layouts the library floats over the stage and starts closed. */
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'edit' | 'preview'>('edit');

  // ---- Resolve -------------------------------------------------------------
  const id = theater.scenarioId;
  const assembled = useMemo(() => (isTraceId(id) ? assembleTrace(model, id!.slice(TRACE_PREFIX.length)) : undefined), [id, model]);
  const resolved = useMemo(() => resolveScenario(id, model, custom, drafts, assembled), [id, model, custom, drafts, assembled]);
  const scenario = resolved.scenario;
  const source = resolved.source;
  const variant = scenario ? effectiveVariant(scenario, theater.variant) : '';
  const steps = useMemo(() => (scenario ? visibleSteps(scenario, variant, detail) : []), [scenario, variant, detail]);
  const allCount = useMemo(() => (scenario ? variantSteps(scenario, variant).length : 0), [scenario, variant]);
  const index = clampIndex(theater.stepIndex, steps.length);
  const step = steps[index];
  const marks = useMemo(() => (scenario ? stepMarks(scenario, variant, steps) : []), [scenario, variant, steps]);
  const participants = useMemo(() => {
    if (!scenario) return [];
    const used = new Set(steps.flatMap((s) => [s.from, s.to]));
    const ordered = scenario.participants.filter((p) => used.has(p));
    for (const u of used) if (!ordered.includes(u)) ordered.push(u);
    return ordered;
  }, [scenario, steps]);
  const isSaved = !!scenario && custom.some((s) => s.id === scenario.id);
  const dirty = source === 'draft';

  // Keep the store's index in range.
  useEffect(() => {
    if (steps.length && index !== theater.stepIndex) theaterSetStep(index);
  }, [index, steps.length, theater.stepIndex, theaterSetStep]);

  // When the visible list changes (detail level, edits) but nobody moved the
  // presenter, stay on the same step instead of the same index.
  const last = useRef<{ sid: string; variant: string; stepId: string; index: number } | null>(null);
  useEffect(() => {
    if (!scenario) return;
    const prev = last.current;
    if (prev && prev.sid === scenario.id && prev.variant === variant && prev.index === theater.stepIndex && prev.stepId !== step?.id) {
      const j = followStep(scenario, variant, steps, prev.stepId);
      if (j !== null && j !== index) {
        theaterSetStep(j);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);
  useEffect(() => {
    if (scenario && step) last.current = { sid: scenario.id, variant, stepId: step.id, index: theater.stepIndex };
  }, [scenario, variant, step, theater.stepIndex]);

  // Leaving a scenario stops playback and edit mode.
  useEffect(() => {
    setPlaying(false);
    setEditing(false);
  }, [id]);

  const go = useCallback((i: number) => theaterSetStep(clampIndex(i, steps.length)), [theaterSetStep, steps.length]);
  const switchVariant = useCallback(
    (v: string) => {
      if (!scenario || v === variant) return;
      const j = mapIndexOnVariantChange(scenario, variant, v, detail, index);
      useApp.setState((s) => ({ theater: { ...s.theater, variant: v, stepIndex: j } }));
    },
    [scenario, variant, detail, index],
  );

  // ---- Playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing || !step) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      const next = index + 1;
      go(next);
      if (next >= steps.length - 1 || (pauseAtDecisions && marks[next]?.decision)) setPlaying(false);
    }, stepDuration(step, theater.speed));
    return () => window.clearTimeout(t);
  }, [playing, step, index, steps.length, theater.speed, pauseAtDecisions, marks, go]);

  const playPause = useCallback(() => {
    if (playing) return setPlaying(false);
    if (index >= steps.length - 1) go(0);
    setPlaying(true);
  }, [playing, index, steps.length, go]);

  // ---- Opening, creating, editing -----------------------------------------
  const open = useCallback(
    (sid: string) => {
      theaterOpen(sid);
      setOverlayOpen(false);
    },
    [theaterOpen],
  );

  const startEditingCopy = useCallback(
    (src: Scenario) => {
      const copy = customizeCopy(src, source === 'custom' || source === 'draft');
      saveCustom(copy);
      theaterOpen(copy.id, theater.variant, index);
      // The id change resets edit mode; re-enable it on the next tick.
      window.setTimeout(() => setEditing(true), 0);
      toast(`Editing your copy “${copy.title}” — the original is unchanged`, 'ok');
    },
    [saveCustom, theaterOpen, theater.variant, index, toast, source],
  );

  const toggleEdit = useCallback(() => {
    if (!scenario) return;
    if (editing) return setEditing(false);
    setPlaying(false);
    if (source === 'custom' || source === 'draft') setEditing(true);
    else startEditingCopy(scenario);
  }, [scenario, editing, source, startEditingCopy]);

  const newBlank = useCallback(() => {
    const role = model.byKind('role')[0]?.id;
    const app = model.byKind('app')[0]?.id;
    const sel = selection?.type === 'entity' && model.has(selection.id) ? selection.id : undefined;
    const a = role ?? app ?? model.root;
    const b = sel && sel !== a ? sel : (app ?? model.root);
    const s = blankScenario(a, b);
    saveCustom(s);
    theaterOpen(s.id);
    window.setTimeout(() => setEditing(true), 0);
  }, [model, selection, saveCustom, theaterOpen]);

  const doImport = useCallback(async () => {
    const text = await pickTextFile();
    if (!text) return;
    const r = parseImport(text);
    if (!r.ok) return toast(r.errors[0] ?? 'Could not import the file', 'warn');
    if (r.kind !== 'scenario') return toast(`That file holds a ${r.kind}, not a scenario — import it from the workspace panel.`, 'warn');
    const s = uniqueImportId(sanitiseImported(r.data), (x) => custom.some((c) => c.id === x) || !!model.scenario(x));
    saveCustom(s);
    theaterOpen(s.id);
    toast(`Imported “${s.title}”${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'})` : ''}`, 'ok');
  }, [custom, model, saveCustom, theaterOpen, toast]);

  const exportJson = useCallback(() => {
    if (!scenario) return;
    downloadText(`${slug(scenario.title)}.scenario.json`, makeExport('scenario', scenario));
    toast('Scenario exported', 'ok');
  }, [scenario, toast]);

  const save = useCallback(() => {
    const d = scenario && useDrafts.getState().drafts[scenario.id];
    if (!d) return;
    saveCustom(d);
    clearDraft(d.id);
    toast('Scenario saved to this browser', 'ok');
  }, [scenario, saveCustom, clearDraft, toast]);

  const editorApi: EditorApi = useMemo(
    () => ({
      edit: (fn) => {
        if (!scenario || (source !== 'custom' && source !== 'draft')) return;
        const base = useDrafts.getState().drafts[scenario.id] ?? scenario;
        setDraft(fn(base));
      },
      focusStep: (stepId) => {
        if (!scenario) return;
        const sc = useDrafts.getState().drafts[scenario.id] ?? scenario;
        const target = sc.steps.find((s) => s.id === stepId);
        if (!target) return;
        let d = detail;
        if (stepDetail(target) > d) {
          d = stepDetail(target) as DetailLevel;
          useApp.getState().setDetail(d);
        }
        const vis = visibleSteps(sc, variant, d);
        const j = vis.findIndex((s) => s.id === stepId);
        if (j >= 0) {
          last.current = { sid: sc.id, variant, stepId, index: j };
          theaterSetStep(j);
        }
      },
      save,
      discard: () => scenario && clearDraft(scenario.id),
      exportJson,
      remove: () => {
        if (!scenario) return;
        clearDraft(scenario.id);
        deleteCustom(scenario.id);
        setEditing(false);
        useApp.setState((s) => ({ theater: { ...s.theater, scenarioId: null, variant: null, stepIndex: 0 } }));
        toast('Scenario deleted');
      },
      done: () => setEditing(false),
    }),
    [scenario, source, setDraft, detail, variant, theaterSetStep, save, clearDraft, exportJson, deleteCustom, toast],
  );

  // Warn before closing the tab with unsaved drafts.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(useDrafts.getState().drafts).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // ---- Layout state used by hotkeys and panels ------------------------------
  const narrow = rootW > 0 && rootW < 1100;
  const railOverlay = narrow && !!scenario;
  const libVisible = railOverlay ? overlayOpen : libOpen;
  const toggleLib = () => (railOverlay ? setOverlayOpen(!overlayOpen) : setLibOpen(!libOpen));
  const showRail = !editing && libVisible;

  // ---- Hotkeys -------------------------------------------------------------
  const cycleView = () => {
    const i = VIEWS.findIndex((v) => v.value === theater.view);
    theaterSetView(VIEWS[(i + 1) % VIEWS.length].value);
  };
  const cycleOutcome = () => {
    if (!scenario || scenario.variants.length < 2) return;
    const i = scenario.variants.findIndex((v) => v.id === variant);
    switchVariant(scenario.variants[(i + 1) % scenario.variants.length].id);
  };
  const G = 'Scenario Theater' as const;
  useHotkeys([
    { id: 'th.library', keys: 'l', label: 'Show / hide the scenario library', group: G, run: toggleLib },
    { id: 'th.endpoint', keys: 'n', label: 'New scenario from an endpoint', group: G, run: () => setPickerOpen(true) },
  ]);
  useHotkeys(
    [
      { id: 'th.play', keys: 'space', label: 'Play / pause', group: G, run: playPause },
      { id: 'th.next', keys: 'ArrowRight', label: 'Next step', group: G, run: () => go(index + 1) },
      { id: 'th.prev', keys: 'ArrowLeft', label: 'Previous step', group: G, run: () => go(index - 1) },
      { id: 'th.nextmark', keys: 'shift+ArrowRight', label: 'Next decision or database change', group: G, run: () => go(nextInteresting(marks, index, 1)) },
      { id: 'th.prevmark', keys: 'shift+ArrowLeft', label: 'Previous decision or database change', group: G, run: () => go(nextInteresting(marks, index, -1)) },
      { id: 'th.home', keys: 'Home', label: 'Restart (first step)', group: G, run: () => go(0) },
      { id: 'th.end', keys: 'End', label: 'Last step', group: G, run: () => go(steps.length - 1) },
      { id: 'th.view', keys: 'v', label: 'Next view (sequence · stage · timeline)', group: G, run: cycleView },
      { id: 'th.slower', keys: ',', label: 'Slower', group: G, run: () => useApp.getState().theaterSetSpeed(nextSpeed(theater.speed, -1)) },
      { id: 'th.faster', keys: '.', label: 'Faster', group: G, run: () => useApp.getState().theaterSetSpeed(nextSpeed(theater.speed, 1)) },
      { id: 'th.outcome', keys: 'o', label: 'Next outcome', group: G, run: cycleOutcome },
      { id: 'th.edit', keys: 'e', label: 'Edit mode on / off (customises a copy first)', group: G, run: toggleEdit },
      { id: 'th.save', keys: 'mod+s', label: 'Save scenario', group: G, allowInInput: true, run: save },
    ],
    !!scenario,
  );

  // ---- Layout --------------------------------------------------------------

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = panelW;
    const move = (ev: PointerEvent) => setPanelW(Math.max(300, Math.min(680, w0 + (x0 - ev.clientX))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const panelWidth = Math.min(panelW, Math.max(300, Math.round((rootW || 1200) * 0.38)));

  const libraryActions = { onOpen: open, onNewFromEndpoint: () => setPickerOpen(true), onBlank: newBlank, onImport: doImport };

  const ctx: TheaterData | null = useMemo(
    () =>
      scenario && source
        ? { scenario, source, variant, steps, allCount, index, step, marks, participants, dirty, saved: isSaved, go, switchVariant, reduced }
        : null,
    [scenario, source, variant, steps, allCount, index, step, marks, participants, dirty, isSaved, go, switchVariant, reduced],
  );

  return (
    <div ref={root} className="relative flex h-full min-h-0 bg-bg" data-testid="theater-root">
      {/* Library rail / outline */}
      {editing && ctx ? (
        <aside className="presenter-hide flex w-[290px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Scenario outline">
          <TheaterCtx.Provider value={ctx}>
            <Outline api={editorApi} />
          </TheaterCtx.Provider>
        </aside>
      ) : (
        showRail &&
        scenario && (
          <aside
            className={cn('presenter-hide flex w-[280px] shrink-0 flex-col border-r border-line bg-surface', railOverlay && 'absolute inset-y-0 left-0 z-30 shadow-pop')}
            aria-label="Scenario library"
          >
            <Library currentId={id} {...libraryActions} />
          </aside>
        )
      )}
      {railOverlay && overlayOpen && !editing && <div className="presenter-hide absolute inset-0 z-20 bg-black/10" onMouseDown={() => setOverlayOpen(false)} aria-hidden />}
      {showRail && !scenario && id && (
        <aside className="presenter-hide flex w-[280px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Scenario library">
          <Library currentId={id} {...libraryActions} />
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!id ? (
          <Landing {...libraryActions} />
        ) : !ctx ? (
          <Unknown id={id} onLibrary={() => (railOverlay ? setOverlayOpen(true) : setLibOpen(true))} onNewFromEndpoint={() => setPickerOpen(true)} onImport={doImport} onOpen={open} />
        ) : (
          <TheaterCtx.Provider value={ctx}>
            <Header
              libOpen={libVisible}
              editing={editing}
              onToggleLib={toggleLib}
              onToggleEdit={toggleEdit}
              onCustomize={() => startEditingCopy(ctx.scenario)}
              onExport={exportJson}
            />
            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1">
                {theater.view === 'sequence' && <SequenceView />}
                {theater.view === 'stage' && <StageView />}
                {theater.view === 'timeline' && <TimelineView />}
              </div>
              <aside className="relative flex shrink-0 flex-col border-l border-line bg-surface" style={{ width: panelWidth }} aria-label="Current step">
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize step panel"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') setPanelW((w) => Math.min(680, w + 24));
                    if (e.key === 'ArrowRight') setPanelW((w) => Math.max(300, w - 24));
                  }}
                  className="presenter-hide absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
                />
                {editing ? (
                  <>
                    <Tabs
                      label="Step panel"
                      value={panelTab}
                      onChange={setPanelTab}
                      tabs={[
                        { value: 'edit', label: 'Edit step' },
                        { value: 'preview', label: 'Preview' },
                      ]}
                    />
                    {panelTab === 'edit' ? <StepForm api={editorApi} /> : <StepPanel />}
                  </>
                ) : (
                  <StepPanel />
                )}
              </aside>
            </div>
            <Transport playing={playing} onPlayPause={playPause} pauseAtDecisions={pauseAtDecisions} onPauseAtDecisions={setPauseAtDecisions} />
          </TheaterCtx.Provider>
        )}
      </div>

      <EndpointPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(epId) => {
          setPickerOpen(false);
          open(`${TRACE_PREFIX}${epId}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  libOpen,
  editing,
  onToggleLib,
  onToggleEdit,
  onCustomize,
  onExport,
}: {
  libOpen: boolean;
  editing: boolean;
  onToggleLib: () => void;
  onToggleEdit: () => void;
  onCustomize: () => void;
  onExport: () => void;
}) {
  const ctx = useTheater();
  const { scenario, source, steps, allCount, index, dirty } = ctx;
  const view = useApp((s) => s.theater.view);
  const presenting = useApp((s) => s.presenting);
  const setView = useApp((s) => s.theaterSetView);
  const detail = useApp((s) => s.detail);
  const setDetail = useApp((s) => s.setDetail);
  const sendToStudio = useApp((s) => s.sendToStudio);
  const toast = useApp((s) => s.toast);
  const editable = source === 'custom' || source === 'draft';
  const hidden = allCount - steps.length;
  const model = useModel();
  const selection = useApp((s) => s.selection);
  const selected = selection?.type === 'entity' ? model.entity(selection.id) : undefined;
  const involving = useMemo(() => (selected ? model.scenariosFor(selected.id).length : 0), [selected, model]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link to this step copied', 'ok');
    } catch {
      toast('Could not copy — the link is in the address bar', 'warn');
    }
  };

  return (
    <div className="shrink-0 border-b border-line bg-surface px-2 pb-1.5 pt-1.5">
    <div className="flex items-center gap-2">
      {!editing && (
        <IconButton label={libOpen ? 'Hide library' : 'Show library'} keys="L" onClick={onToggleLib} className="presenter-hide" size="sm">
          {libOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <h1 className={cn('m-0 truncate text-[14px] font-semibold', scenario.confidence === 'hypothetical' && 'text-hypo')} title={scenario.title} data-testid="scenario-title">
          {scenario.title}
        </h1>
        {source === 'trace' && (
          <Tip label="Assembled automatically from the endpoint's contract. Customize to edit it.">
            <Badge color="var(--info)">
              <Wand2 size={10} /> Auto-assembled
            </Badge>
          </Tip>
        )}
        {editable && <Badge color="var(--fg-muted)">Mine</Badge>}
        {dirty && (
          <Badge color="var(--warn)" title="Unsaved changes">
            Unsaved
          </Badge>
        )}
        {scenario.confidence && scenario.confidence !== 'verified' && <ConfidenceBadge confidence={scenario.confidence} />}
      </div>

      <div role="radiogroup" aria-label="View" data-testid="view-switch" className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5">
        {VIEWS.map((v) => (
          <Tip key={v.value} label={v.title} keys="V">
            <button
              type="button"
              role="radio"
              aria-checked={view === v.value}
              data-view={v.value}
              onClick={() => setView(v.value)}
              className={cn('h-6 rounded-[5px] px-2 text-[11.5px] font-medium transition-colors', view === v.value ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-fg-muted hover:text-fg')}
            >
              {v.label}
            </button>
          </Tip>
        ))}
      </div>

      <div className="presenter-hide flex items-center gap-0.5">
        {!editable && (
          <Tip label="Make an editable copy of this scenario" keys="E">
            <Button size="sm" icon={<CopyIcon size={13} />} onClick={onCustomize} data-testid="customize">
              Customize
            </Button>
          </Tip>
        )}
        <IconButton label="Edit scenario" keys="E" size="sm" active={editing} onClick={onToggleEdit}>
          {editing ? <Eye size={15} /> : <Pencil size={15} />}
        </IconButton>
        <Popover
          align="end"
          className="w-64"
          trigger={(p) => (
            <IconButton label="Send to Explanation Studio" size="sm" {...p}>
              <PenTool size={15} />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<ListTree size={13} />}
                hint={`Steps 1–${index + 1} as numbered connections`}
                onClick={() => {
                  close();
                  sendToStudio(studioRequest(scenario, steps, index));
                }}
              >
                Send the steps so far
              </MenuItem>
              <MenuItem
                icon={<ArrowLeftRight size={13} />}
                hint={`All ${steps.length} visible steps`}
                onClick={() => {
                  close();
                  sendToStudio(studioRequest(scenario, steps, null));
                }}
              >
                Send the whole scenario
              </MenuItem>
            </>
          )}
        </Popover>
        <IconButton label="Copy link to this step" size="sm" onClick={copyLink}>
          <Link2 size={15} />
        </IconButton>
        <IconButton label="Export scenario to a JSON file" size="sm" onClick={onExport}>
          <Download size={15} />
        </IconButton>
      </div>
    </div>
    <div className={cn('flex min-w-0 items-center gap-2 text-[11.5px] text-fg-muted', !editing && !presenting && 'pl-9')}>
      <span className="min-w-0 truncate" title={scenario.question}>
        {scenario.question}
      </span>
      {hidden > 0 && (
        <span className="presenter-hide shrink-0 whitespace-nowrap text-fg-subtle" data-testid="hidden-steps">
          · {steps.length} of {allCount} steps at this detail level{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setDetail(5 as DetailLevel)}>
            Show all
          </button>
        </span>
      )}
      {hidden === 0 && detail < 5 && allCount > 0 && <span className="presenter-hide shrink-0 whitespace-nowrap text-fg-subtle">· all {allCount} steps shown</span>}
      {selected && !libOpen && !editing && (involving > 0 || model.contract(selected.id)) && (
        <button type="button" onClick={onToggleLib} className="presenter-hide ml-auto shrink-0 truncate rounded-full border border-line px-2 py-px text-[11px] font-medium text-accent hover:bg-surface-2" data-testid="involving-chip">
          {involving > 0 ? `${involving} workflow${involving === 1 ? '' : 's'} involve ${selected.name}` : `Trace ${selected.name}`} →
        </button>
      )}
    </div>
    </div>
  );
}

function Unknown({
  id,
  onLibrary,
  onNewFromEndpoint,
  onImport,
  onOpen,
}: {
  id: string;
  onLibrary: () => void;
  onNewFromEndpoint: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
}) {
  const trace = isTraceId(id);
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-canvas p-6" data-testid="theater-unknown">
      <Empty title={trace ? 'This endpoint has no contract to trace' : 'This scenario is not in this browser'} icon={<SearchX size={26} />}>
        {trace ? (
          <>
            “{id.slice(TRACE_PREFIX.length)}” is not an endpoint with a contract in the model (it may belong to a hypothetical layer that is switched off).
          </>
        ) : (
          <>
            The link points to “<span className="font-mono">{id}</span>”. Scenarios you create are stored in your own browser, so a link to someone else’s custom scenario only works after they export it and you import the file.
          </>
        )}
      </Empty>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onLibrary}>
          Browse the library
        </Button>
        <Button icon={<Network size={13} />} onClick={onNewFromEndpoint} aria-label="New scenario from endpoint">
          Trace an endpoint
        </Button>
        {!trace && <Button onClick={onImport}>Import a scenario file…</Button>}
      </div>
      <Involving currentId={null} onOpen={onOpen} className="mt-6 w-[340px]" />
    </div>
  );
}
