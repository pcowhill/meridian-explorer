import { lazy, Suspense, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AUDIENCES, type DetailLevel } from '@/model';
import { useApp } from '@/state/app';
import { useWorkspace } from '@/state/workspace';
import { buildHash, parseHash } from '@/state/url';
import { cn } from '@/ui/primitives';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { CommandPalette } from './CommandPalette';
import { Panels } from './Panels';
import { Toasts } from './Toasts';
import { useHotkeys } from './hotkeys';

const Atlas = lazy(() => import('@/atlas/Atlas'));
const Theater = lazy(() => import('@/theater/Theater'));
const Studio = lazy(() => import('@/studio/Studio'));

/** Apply whatever a deep link specifies on top of the restored session. */
function applyHash(hash: string): void {
  const u = parseHash(hash);
  const app = useApp.getState();
  const patch: Partial<ReturnType<typeof useApp.getState>> = {};
  if (u.mode) patch.mode = u.mode;
  if (u.selection !== undefined) patch.selection = u.selection;
  if (u.audience) patch.audience = u.audience;
  if (u.detail) patch.detail = u.detail;
  if (u.expanded || u.focus !== undefined) patch.atlas = { ...app.atlas, expanded: u.expanded ?? app.atlas.expanded, focus: u.focus !== undefined ? u.focus : app.atlas.focus };
  if (u.scenarioId !== undefined || u.variant !== undefined || u.stepIndex !== undefined || u.view) {
    patch.theater = {
      ...app.theater,
      scenarioId: u.scenarioId !== undefined ? u.scenarioId : app.theater.scenarioId,
      variant: u.variant !== undefined ? u.variant : app.theater.variant,
      stepIndex: u.stepIndex ?? (u.scenarioId !== undefined ? 0 : app.theater.stepIndex),
      view: u.view ?? app.theater.view,
    };
  }
  if (Object.keys(patch).length) useApp.setState(patch);
  if (u.layers) {
    const ws = useWorkspace.getState();
    for (const id of u.layers) if (ws.layers.some((l) => l.id === id)) ws.setLayerActive(id, true);
  }
}

function useUrlSync(): void {
  useEffect(() => {
    if (window.location.hash.length > 2) applyHash(window.location.hash);
    let lastWritten = '';
    const write = () => {
      const hash = buildHash(useApp.getState(), useWorkspace.getState().activeLayerIds);
      if (hash !== window.location.hash) {
        lastWritten = hash;
        window.history.replaceState(null, '', hash);
      }
    };
    write();
    const unsubA = useApp.subscribe(write);
    const unsubW = useWorkspace.subscribe(write);
    const onHash = () => {
      if (window.location.hash !== lastWritten) applyHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      unsubA();
      unsubW();
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
}

function useGlobalHotkeys(): void {
  const app = useApp;
  useHotkeys([
    { id: 'g.search', keys: '/ mod+k', label: 'Search everything / command palette', group: 'Everywhere', allowInInput: true, run: (e) => { if (e.key === '/' && (e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable=true]')) return; app.getState().setCommandOpen(true); } },
    { id: 'g.atlas', keys: '1', label: 'Switch to Architecture Atlas', group: 'Everywhere', run: () => app.getState().setMode('atlas') },
    { id: 'g.theater', keys: '2', label: 'Switch to Scenario Theater', group: 'Everywhere', run: () => app.getState().setMode('theater') },
    { id: 'g.studio', keys: '3', label: 'Switch to Explanation Studio', group: 'Everywhere', run: () => app.getState().setMode('studio') },
    { id: 'g.back', keys: '[', label: 'Back to the previous view', group: 'Everywhere', run: () => app.getState().back() },
    { id: 'g.forward', keys: ']', label: 'Forward', group: 'Everywhere', run: () => app.getState().forward() },
    { id: 'g.inspector', keys: 'i', label: 'Show / hide the inspector', group: 'Everywhere', run: () => app.getState().setInspectorOpen(!app.getState().inspectorOpen) },
    { id: 'g.shortcuts', keys: '?', label: 'Keyboard shortcut reference', group: 'Everywhere', run: () => app.getState().setHelp(app.getState().help === 'shortcuts' ? null : 'shortcuts') },
    { id: 'g.glossary', keys: 'g', label: 'Glossary', group: 'Everywhere', run: () => app.getState().setHelp('glossary') },
    { id: 'g.views', keys: 'b', label: 'Saved views and bookmarks', group: 'Everywhere', run: () => app.getState().setHelp('views') },
    { id: 'g.layers', keys: 'h', label: 'Hypothetical layers', group: 'Everywhere', run: () => app.getState().setHelp('layers') },
    {
      id: 'g.audience',
      keys: 'a',
      label: 'Next audience preset',
      group: 'Everywhere',
      run: () => {
        const s = app.getState();
        const i = AUDIENCES.findIndex((x) => x.id === s.audience);
        const next = AUDIENCES[(i + 1) % AUDIENCES.length];
        s.setAudience(next.id);
        s.toast(`Audience: ${next.label}`);
      },
    },
    { id: 'g.less', keys: '-', label: 'Less detail', group: 'Everywhere', run: () => app.getState().setDetail(Math.max(1, app.getState().detail - 1) as DetailLevel) },
    { id: 'g.more', keys: '= +', label: 'More detail', group: 'Everywhere', run: () => app.getState().setDetail(Math.min(5, app.getState().detail + 1) as DetailLevel) },
    { id: 'p.present', keys: 'p', label: 'Presenter mode on / off', group: 'Presenting', run: () => app.getState().setPresenting(!app.getState().presenting) },
    {
      id: 'g.escape',
      keys: 'Escape',
      label: 'Close dialog · leave presenter mode · clear selection',
      group: 'Everywhere',
      run: () => {
        const s = app.getState();
        if (s.help) s.setHelp(null);
        else if (s.presenting) s.setPresenting(false);
        else if (s.selection) s.select(null);
      },
    },
  ]);
}

export function App() {
  const mode = useApp((s) => s.mode);
  const theme = useApp((s) => s.theme);
  const presenting = useApp((s) => s.presenting);
  const tourSeen = useWorkspace((s) => s.tourSeen);

  useUrlSync();
  useGlobalHotkeys();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Dialogs, popovers and tooltips render in portals under <body>; give them the active mode's accent too.
  useEffect(() => {
    document.body.classList.remove('mode-atlas', 'mode-theater', 'mode-studio');
    document.body.classList.add(`mode-${mode}`);
  }, [mode]);

  // First visit: offer the short tour (unless a deep link brought the visitor to something specific).
  useEffect(() => {
    if (!tourSeen && !/[?&](sel|s)=/.test(window.location.hash)) useApp.getState().setHelp('tour');
  }, [tourSeen]);

  return (
    <ReactFlowProvider>
      <div className={cn(`mode-${mode} relative flex h-full flex-col bg-bg text-fg`, presenting && 'presenting')} data-mode={mode} data-testid="app">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1" aria-label={mode}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-fg-subtle">Loading…</div>}>
              {mode === 'atlas' && <Atlas />}
              {mode === 'theater' && <Theater />}
              {mode === 'studio' && <Studio />}
            </Suspense>
          </main>
          <Inspector />
        </div>
        <CommandPalette />
        <Panels />
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}
