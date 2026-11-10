/**
 * Mode 3 — Explanation Studio: an infinite, software-aware whiteboard.
 *
 * Architecture (all under src/studio/):
 *   types.ts            node/edge `data` shapes per type; default sizes
 *   store.ts            zustand store: live nodes/edges (React Flow objects), selection,
 *                       undo/redo (snapshot stack; drags/resizes = one checkpoint), focus
 *                       (spotlight / highlight path), path animation, fit requests
 *   logic/              pure functions, unit-tested:
 *     geometry.ts         sizes, absolute rects, free-spot search, align/distribute
 *     layout.ts           layered left→right layout (cycle-breaking + barycentre), row, grid
 *     modelEdges.ts       what a line between entities means (known / hypothetical /
 *                         not-in-Meridian), labels, auto-connect via liftRelations
 *     build.ts            generators (dependency diagram, connections, children, neighbours,
 *                         question, overview, inbox import, before/after, sequence from a
 *                         chain) and structural edits (clone, frames, remove, auto-layout),
 *                         board ⇄ StudioNode/StudioEdge conversion
 *     widgets.ts          widget bindings (picker catalogue + node data from the model)
 *   commands.ts         UI commands (add, generate, clipboard, boards, export/import, PNG)
 *   Canvas.tsx          React Flow wiring → store; clicks → shared selection (inspector)
 *   nodes/, edges/      renderers (entity, shapes, text, note, callout, frame + 11 widgets;
 *                       one floating edge type whose status is computed live from the model)
 *   Palette, Toolbar, SelectionPanel, Overlays, Dialogs, hotkeys.ts
 *
 * Data flow: workspace board → store.load() → React Flow (controlled) → onNodesChange /
 * commands → store.commit() (history) → debounced autosave → workspace.saveBoard().
 * Cross-mode requests arrive through useApp().studioInbox and are placed by planImport().
 */
import { useEffect } from 'react';
import { useApp } from '@/state/app';
import { useWorkspace } from '@/state/workspace';
import { HypotheticalComponentDialog } from '@/shell/ProposeChange';
import { addEntity, applyPatch, copySelection, paste, saveNow } from './commands';
import { Canvas } from './Canvas';
import { TemplateDialog, WidgetPicker } from './Dialogs';
import { useStudioHotkeys } from './hotkeys';
import { planImport } from './logic/build';
import { entityOf } from './logic/modelEdges';
import { currentModel } from './model';
import { CarryOverPrompt, EmptyState, HypoLegend } from './Overlays';
import { Palette } from './Palette';
import { usePrefs } from './prefs';
import { SelectionPanel } from './SelectionPanel';
import { newBoard, selectedNodeIds, useStudio } from './store';
import { AnimationBar, TopToolbar, ViewBar } from './Toolbar';
import { useStudioUi } from './ui';
import './studio.css';

/** updatedAt of the last board version this session wrote, to detect outside replacement. */
let lastSaved: { id: string; at: string } | null = null;

function syncFromWorkspace(): void {
  const ws = useWorkspace.getState();
  let b = ws.boards.find((x) => x.id === ws.activeBoardId) ?? ws.boards[0];
  if (!b) {
    b = newBoard('Board 1');
    ws.saveBoard(b);
    b = useWorkspace.getState().boards.find((x) => x.id === b!.id)!;
  }
  if (ws.activeBoardId !== b.id) useWorkspace.getState().setActiveBoard(b.id);
  const s = useStudio.getState();
  // Keep the live store (and its undo history) when it is the latest version of this board.
  if (s.boardId === b.id && lastSaved?.id === b.id && lastSaved.at === b.updatedAt) return;
  s.load(b);
  lastSaved = { id: b.id, at: b.updatedAt };
}

function save(): void {
  saveNow();
  const id = useStudio.getState().boardId;
  const b = useWorkspace.getState().boards.find((x) => x.id === id);
  if (b) lastSaved = { id: b.id, at: b.updatedAt };
}

function useBoardLifecycle(): void {
  useEffect(() => {
    syncFromWorkspace();
    // Autosave (debounced) whenever the content or viewport changes.
    let timer: number | undefined;
    const unsub = useStudio.subscribe((s, prev) => {
      if (s.boardId !== prev.boardId) {
        const b = useWorkspace.getState().boards.find((x) => x.id === s.boardId);
        if (b) lastSaved = { id: b.id, at: b.updatedAt };
        return;
      }
      if (s.revision === prev.revision && s.viewport === prev.viewport) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 350);
    });
    // Another part of the app changed the active board (saved view, workspace import, deletion).
    const unsubWs = useWorkspace.subscribe((ws, prev) => {
      if (ws.activeBoardId !== prev.activeBoardId && ws.activeBoardId !== useStudio.getState().boardId) syncFromWorkspace();
      else if (!ws.boards.some((b) => b.id === useStudio.getState().boardId)) syncFromWorkspace();
    });
    const flush = () => {
      window.clearTimeout(timer);
      save();
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      flush();
      unsub();
      unsubWs();
      window.removeEventListener('beforeunload', flush);
    };
  }, []);
}

/** Place requests sent from other modes / the inspector. */
function useInbox(): void {
  const inbox = useApp((s) => s.studioInbox);
  useEffect(() => {
    if (!inbox.length || !useStudio.getState().boardId) return;
    const items = useApp.getState().consumeStudioInbox();
    for (const req of items) {
      const s = useStudio.getState();
      const patch = planImport(currentModel(), s.nodes, s.edges, req);
      applyPatch(patch);
    }
  }, [inbox]);
}

function useClipboard(): void {
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el?.closest?.('input, textarea, select, [contenteditable=true]');
    };
    const hasTextSelection = () => {
      const sel = window.getSelection();
      return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    };
    const onCopy = (e: ClipboardEvent) => {
      if (typing(e.target) || hasTextSelection()) return;
      const json = copySelection();
      if (!json) return;
      e.clipboardData?.setData('text/plain', json);
      e.preventDefault();
      useApp.getState().toast(`Copied ${selectedNodeIds(useStudio.getState()).length} item(s) — paste on any board`, 'info');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      if (paste(e.clipboardData?.getData('text/plain'))) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}

/** Escape leaves connect mode / stops an animation before the global Escape (presenter, selection) runs. */
function useEscape(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useStudio.getState();
      if (s.connectMode) {
        s.setConnectMode(false);
        e.preventDefault();
      } else if (s.anim) {
        s.setAnim(null);
        e.preventDefault();
      } else if (s.focus && !useApp.getState().presenting) {
        s.setFocus(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function useAnimationClock(): void {
  const playing = useStudio((s) => !!s.anim?.playing);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => useStudio.getState().stepAnim(1), 1150);
    return () => window.clearInterval(t);
  }, [playing]);
}

function ConnectBanner() {
  const on = useStudio((s) => s.connectMode);
  const from = useStudio((s) => s.connectFrom);
  if (!on) return null;
  return (
    <div className="studio-overlay pointer-events-auto rounded-full border border-accent bg-surface px-3 py-1 text-[12px] shadow-pop" role="status">
      <b className="text-accent">Connect mode</b> — {from ? 'now click the target (Shift-click to fan out from the same source)' : 'click the source node'} · <kbd>Esc</kbd> or <kbd>C</kbd> to finish
    </div>
  );
}

export default function Studio() {
  useBoardLifecycle();
  useInbox();
  useClipboard();
  useEscape();
  useAnimationClock();
  useStudioHotkeys();
  const paletteOpen = usePrefs((s) => s.paletteOpen);
  const hypoOpen = useStudioUi((s) => s.hypoOpen);
  const setUi = useStudioUi((s) => s.set);
  const connectTo = useStudio((s) => {
    const sel = s.nodes.filter((n) => n.selected);
    return sel.length === 1 ? entityOf(sel[0]) : undefined;
  });

  return (
    <div className="flex h-full flex-col" data-testid="studio-root">
      <TopToolbar />
      <div className="flex min-h-0 flex-1">
        {paletteOpen && <Palette />}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <Canvas />
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
            <HypoLegend />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <ConnectBanner />
          </div>
          <div className="pointer-events-none absolute bottom-16 right-3 top-3 z-10 flex flex-col items-end">
            <SelectionPanel />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-end justify-between gap-2">
            <ViewBar />
            <div className="flex min-w-0 flex-col items-end gap-2">
              <AnimationBar />
              <CarryOverPrompt />
            </div>
          </div>
          <EmptyState />
        </div>
      </div>
      <WidgetPicker />
      <TemplateDialog />
      {hypoOpen && (
        <HypotheticalComponentDialog
          open
          connectTo={connectTo}
          onClose={() => setUi({ hypoOpen: false })}
          onCreated={(id) => {
            // Defer until the dialog has written the new entity (and relation) to the layer.
            window.setTimeout(() => addEntity(id), 0);
          }}
        />
      )}
    </div>
  );
}
