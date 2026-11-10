/**
 * Session state shared by all three modes: which mode is showing, who the
 * audience is, what is selected, and each mode's view state that other modes
 * need to drive (so "open this in the Atlas" works from anywhere).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AUDIENCES, baseModel, type AudienceId, type DetailLevel, type RelationChannel } from '@/model';
import { useWorkspace, type SavedView } from './workspace';

export type ModeId = 'atlas' | 'theater' | 'studio';
export const MODES: { id: ModeId; label: string; tagline: string; keys: string }[] = [
  { id: 'atlas', label: 'Architecture Atlas', tagline: 'Where things are and how they connect', keys: '1' },
  { id: 'theater', label: 'Scenario Theater', tagline: 'What happens, step by step', keys: '2' },
  { id: 'studio', label: 'Explanation Studio', tagline: 'Build any explanation on a canvas', keys: '3' },
];

export type Selection =
  | { type: 'entity'; id: string }
  | { type: 'relation'; id: string }
  /** An aggregated edge between two visible nodes. */
  | { type: 'edge'; a: string; b: string; channel: RelationChannel }
  | { type: 'step'; scenarioId: string; stepId: string }
  | { type: 'machine'; id: string }
  | { type: 'term'; term: string };

export type TheaterView = 'sequence' | 'stage' | 'timeline';
export type InspectorTab = 'overview' | 'contract' | 'data' | 'code' | 'relations' | 'workflows' | 'impact';
export type HelpPanel = null | 'shortcuts' | 'glossary' | 'questions' | 'tour' | 'about' | 'evaluation' | 'workspace' | 'layers' | 'views';

/** A request for the Studio to place things on the board (from another mode or the inspector). */
export interface StudioImport {
  id: string;
  title: string;
  source: 'atlas' | 'theater' | 'inspector' | 'search' | 'question';
  entities: string[];
  /** Explicit edges; when omitted the Studio connects known relations itself. */
  edges?: { from: string; to: string; label?: string; kind?: string; hypothetical?: boolean; order?: number }[];
  /** `sequence` asks the Studio to lay entities left→right in order and number the edges. */
  layout?: 'auto' | 'sequence';
  note?: string;
}

interface NavPoint {
  mode: ModeId;
  selection: Selection | null;
  atlas: { expanded: string[]; focus: string | null };
  theater: { scenarioId: string | null; variant: string | null; stepIndex: number };
}

export interface AppData {
  mode: ModeId;
  audience: AudienceId;
  detail: DetailLevel;
  theme: 'light' | 'dark';
  presenting: boolean;
  selection: Selection | null;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  commandOpen: boolean;
  help: HelpPanel;
  atlas: {
    expanded: string[];
    focus: string | null;
    channels: RelationChannel[];
    /** Show only the selected node, its neighbours and their ancestors. */
    isolate: boolean;
    /** Highlight a feature's implementers. */
    lens: string | null;
  };
  theater: {
    scenarioId: string | null;
    variant: string | null;
    stepIndex: number;
    view: TheaterView;
    speed: number;
  };
  studioInbox: StudioImport[];
  past: NavPoint[];
  future: NavPoint[];
  toasts: { id: number; message: string; tone: 'info' | 'ok' | 'warn' }[];
}

interface AppActions {
  setMode: (mode: ModeId) => void;
  setAudience: (audience: AudienceId) => void;
  setDetail: (detail: DetailLevel) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setPresenting: (on: boolean) => void;
  select: (selection: Selection | null, opts?: { openInspector?: boolean; tab?: InspectorTab }) => void;
  selectEntity: (id: string, opts?: { openInspector?: boolean; tab?: InspectorTab }) => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setCommandOpen: (open: boolean) => void;
  setHelp: (panel: HelpPanel) => void;
  // atlas
  atlasToggle: (id: string) => void;
  atlasExpand: (ids: string[]) => void;
  atlasCollapse: (id: string) => void;
  atlasCollapseAll: () => void;
  atlasSetExpanded: (ids: string[]) => void;
  atlasFocus: (id: string | null) => void;
  atlasToggleChannel: (channel: RelationChannel) => void;
  atlasSetChannels: (channels: RelationChannel[]) => void;
  atlasIsolate: (on: boolean) => void;
  atlasLens: (featureId: string | null) => void;
  /** Make an entity visible in the Atlas (expand its ancestors) and select it. */
  atlasReveal: (id: string) => void;
  // theater
  theaterOpen: (scenarioId: string, variant?: string | null, stepIndex?: number) => void;
  theaterSetStep: (index: number) => void;
  theaterSetVariant: (variant: string) => void;
  theaterSetView: (view: TheaterView) => void;
  theaterSetSpeed: (speed: number) => void;
  // cross-mode
  openInAtlas: (entityId: string) => void;
  openInTheater: (scenarioId: string, variant?: string | null, stepIndex?: number) => void;
  sendToStudio: (request: Omit<StudioImport, 'id'>) => void;
  consumeStudioInbox: () => StudioImport[];
  // history
  back: () => void;
  forward: () => void;
  // views
  captureView: (label: string, note?: string) => string;
  applyView: (view: SavedView) => void;
  // toasts
  toast: (message: string, tone?: 'info' | 'ok' | 'warn') => void;
  dismissToast: (id: number) => void;
}

export type AppState = AppData & AppActions;

const DEFAULT_AUDIENCE: AudienceId = 'systems';
const preset = (id: AudienceId) => AUDIENCES.find((a) => a.id === id) ?? AUDIENCES[2];

let toastSeq = 0;

function navPoint(s: AppData): NavPoint {
  return {
    mode: s.mode,
    selection: s.selection,
    atlas: { expanded: s.atlas.expanded, focus: s.atlas.focus },
    theater: { scenarioId: s.theater.scenarioId, variant: s.theater.variant, stepIndex: s.theater.stepIndex },
  };
}

const sameNav = (a: NavPoint, b: NavPoint) => JSON.stringify(a) === JSON.stringify(b);

/** Record the current place in history before a significant navigation. */
function remember(s: AppData): Pick<AppData, 'past' | 'future'> {
  const point = navPoint(s);
  const last = s.past[s.past.length - 1];
  if (last && sameNav(last, point)) return { past: s.past, future: [] };
  return { past: [...s.past, point].slice(-60), future: [] };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      mode: 'atlas',
      audience: DEFAULT_AUDIENCE,
      detail: preset(DEFAULT_AUDIENCE).detail,
      theme: 'light',
      presenting: false,
      selection: null,
      inspectorOpen: true,
      inspectorTab: 'overview',
      commandOpen: false,
      help: null,
      atlas: { expanded: [], focus: null, channels: preset(DEFAULT_AUDIENCE).channels, isolate: false, lens: null },
      theater: { scenarioId: null, variant: null, stepIndex: 0, view: 'sequence', speed: 1 },
      studioInbox: [],
      past: [],
      future: [],
      toasts: [],

      setMode: (mode) => set((s) => (s.mode === mode ? s : { ...remember(s), mode })),
      setAudience: (audience) => {
        const p = preset(audience);
        set((s) => ({ audience, detail: p.detail, atlas: { ...s.atlas, channels: p.channels } }));
      },
      setDetail: (detail) => set({ detail }),
      setTheme: (theme) => set({ theme }),
      setPresenting: (presenting) => set({ presenting }),
      select: (selection, opts) => {
        set((s) => ({
          selection,
          inspectorOpen: opts?.openInspector === undefined ? s.inspectorOpen : opts.openInspector,
          inspectorTab: opts?.tab ?? (selection?.type !== s.selection?.type ? 'overview' : s.inspectorTab),
        }));
        if (selection?.type === 'entity') useWorkspace.getState().pushRecent(selection.id);
      },
      selectEntity: (id, opts) => get().select({ type: 'entity', id }, opts),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab, inspectorOpen: true }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setHelp: (help) => set({ help }),

      atlasToggle: (id) =>
        set((s) => {
          const open = s.atlas.expanded.includes(id);
          if (!open) return { atlas: { ...s.atlas, expanded: [...s.atlas.expanded, id] } };
          // Collapsing a container also collapses everything inside it.
          const inside = new Set(baseModel.descendants(id).map((d) => d.id));
          return { atlas: { ...s.atlas, expanded: s.atlas.expanded.filter((x) => x !== id && !inside.has(x)) } };
        }),
      atlasExpand: (ids) => set((s) => ({ atlas: { ...s.atlas, expanded: [...new Set([...s.atlas.expanded, ...ids])] } })),
      atlasCollapse: (id) =>
        set((s) => {
          const inside = new Set(baseModel.descendants(id).map((d) => d.id));
          return { atlas: { ...s.atlas, expanded: s.atlas.expanded.filter((x) => x !== id && !inside.has(x)) } };
        }),
      atlasCollapseAll: () => set((s) => ({ ...remember(s), atlas: { ...s.atlas, expanded: [], focus: null, isolate: false } })),
      atlasSetExpanded: (ids) => set((s) => ({ atlas: { ...s.atlas, expanded: [...new Set(ids)] } })),
      atlasFocus: (id) => set((s) => ({ ...remember(s), atlas: { ...s.atlas, focus: id, expanded: id ? [...new Set([...s.atlas.expanded, id])] : s.atlas.expanded } })),
      atlasToggleChannel: (channel) =>
        set((s) => ({ atlas: { ...s.atlas, channels: s.atlas.channels.includes(channel) ? s.atlas.channels.filter((c) => c !== channel) : [...s.atlas.channels, channel] } })),
      atlasSetChannels: (channels) => set((s) => ({ atlas: { ...s.atlas, channels } })),
      atlasIsolate: (isolate) => set((s) => ({ atlas: { ...s.atlas, isolate } })),
      atlasLens: (lens) => set((s) => ({ atlas: { ...s.atlas, lens } })),
      atlasReveal: (id) => {
        const s = get();
        // Hypothetical entities are not in baseModel; their parents are, and ancestors come from there.
        const ws = useWorkspace.getState();
        const hypo = ws.layers.flatMap((l) => l.entities).find((e) => e.id === id);
        const start = hypo?.parent ?? id;
        const chain = hypo?.parent ? [...baseModel.ancestorIds(start), start] : baseModel.ancestorIds(id);
        const focus = s.atlas.focus && (chain.includes(s.atlas.focus) || s.atlas.focus === id) ? s.atlas.focus : null;
        set((st) => ({
          ...remember(st),
          selection: { type: 'entity', id },
          atlas: { ...st.atlas, expanded: [...new Set([...st.atlas.expanded, ...chain])], focus, isolate: false },
        }));
        ws.pushRecent(id);
      },

      theaterOpen: (scenarioId, variant = null, stepIndex = 0) =>
        set((s) => ({ ...remember(s), theater: { ...s.theater, scenarioId, variant, stepIndex } })),
      theaterSetStep: (stepIndex) => set((s) => ({ theater: { ...s.theater, stepIndex: Math.max(0, stepIndex) } })),
      theaterSetVariant: (variant) => set((s) => ({ theater: { ...s.theater, variant } })),
      theaterSetView: (view) => set((s) => ({ theater: { ...s.theater, view } })),
      theaterSetSpeed: (speed) => set((s) => ({ theater: { ...s.theater, speed } })),

      openInAtlas: (entityId) => {
        get().atlasReveal(entityId);
        set({ mode: 'atlas' });
      },
      openInTheater: (scenarioId, variant = null, stepIndex = 0) =>
        set((s) => ({ ...remember(s), mode: 'theater', theater: { ...s.theater, scenarioId, variant, stepIndex } })),
      sendToStudio: (request) =>
        set((s) => ({ ...remember(s), mode: 'studio', studioInbox: [...s.studioInbox, { ...request, id: `imp_${Date.now().toString(36)}${s.studioInbox.length}` }] })),
      consumeStudioInbox: () => {
        const items = get().studioInbox;
        if (items.length) set({ studioInbox: [] });
        return items;
      },

      back: () =>
        set((s) => {
          const prev = s.past[s.past.length - 1];
          if (!prev) return s;
          return {
            past: s.past.slice(0, -1),
            future: [navPoint(s), ...s.future].slice(0, 60),
            mode: prev.mode,
            selection: prev.selection,
            atlas: { ...s.atlas, ...prev.atlas },
            theater: { ...s.theater, ...prev.theater },
          };
        }),
      forward: () =>
        set((s) => {
          const next = s.future[0];
          if (!next) return s;
          return {
            past: [...s.past, navPoint(s)].slice(-60),
            future: s.future.slice(1),
            mode: next.mode,
            selection: next.selection,
            atlas: { ...s.atlas, ...next.atlas },
            theater: { ...s.theater, ...next.theater },
          };
        }),

      captureView: (label, note) => {
        const s = get();
        const ws = useWorkspace.getState();
        return ws.saveView({
          label,
          note,
          mode: s.mode,
          selection: s.selection,
          audience: s.audience,
          detail: s.detail,
          atlas: { expanded: s.atlas.expanded, focus: s.atlas.focus, channels: s.atlas.channels },
          theater: { scenarioId: s.theater.scenarioId, variant: s.theater.variant, stepIndex: s.theater.stepIndex, view: s.theater.view },
          studio: { boardId: ws.activeBoardId },
        });
      },
      applyView: (view) => {
        set((s) => ({
          ...remember(s),
          mode: view.mode,
          selection: view.selection,
          audience: (view.audience as AudienceId) ?? s.audience,
          detail: (view.detail as DetailLevel) ?? s.detail,
          atlas: view.atlas
            ? { ...s.atlas, expanded: view.atlas.expanded, focus: view.atlas.focus, channels: (view.atlas.channels as RelationChannel[]) ?? s.atlas.channels, isolate: false }
            : s.atlas,
          theater: view.theater ? { ...s.theater, scenarioId: view.theater.scenarioId, variant: view.theater.variant, stepIndex: view.theater.stepIndex, view: (view.theater.view as TheaterView) ?? s.theater.view } : s.theater,
        }));
        if (view.studio?.boardId) useWorkspace.getState().setActiveBoard(view.studio.boardId);
      },

      toast: (message, tone = 'info') => {
        const id = ++toastSeq;
        set((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-4) }));
        window.setTimeout(() => get().dismissToast(id), 3800);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'meridian-explorer:session:v1',
      version: 1,
      partialize: (s) => ({
        mode: s.mode,
        audience: s.audience,
        detail: s.detail,
        theme: s.theme,
        inspectorOpen: s.inspectorOpen,
        atlas: s.atlas,
        theater: s.theater,
      }),
    },
  ),
);
