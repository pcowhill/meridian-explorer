/**
 * The workspace: everything a user CREATES — hypothetical layers, bookmarks /
 * saved views, custom scenarios, studio boards and templates, evaluation notes.
 * Persisted to localStorage and portable through export/import (see io.ts).
 *
 * The Meridian baseline model is never written here; hypothetical layers sit
 * on top of it and can be switched off or discarded at any time.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Entity, HypotheticalLayer, HypotheticalModification, Relation, Scenario } from '@/model';
import { BUILT_IN_LAYERS } from './builtinLayers';
import type { Selection } from './app';

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_STORAGE_KEY = 'meridian-explorer:workspace:v1';

// ---- Studio board shapes (generic envelope; node/edge `data` is owned by the Studio) ----

export interface StudioNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;
  zIndex?: number;
  hidden?: boolean;
  data: Record<string, unknown>;
}

export interface StudioEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  data?: Record<string, unknown>;
}

export interface StudioBoard {
  id: string;
  name: string;
  description?: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

export interface StudioTemplate {
  id: string;
  name: string;
  description?: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  createdAt: string;
}

// ---- Bookmarks / saved views -------------------------------------------------

export interface SavedView {
  id: string;
  label: string;
  note?: string;
  mode: 'atlas' | 'theater' | 'studio';
  selection: Selection | null;
  audience?: string;
  detail?: number;
  atlas?: { expanded: string[]; focus: string | null; channels?: string[] };
  theater?: { scenarioId: string | null; variant: string | null; stepIndex: number; view?: string };
  studio?: { boardId: string | null };
  createdAt: string;
}

// ---- Evaluation worksheet ----------------------------------------------------

export interface EvaluationState {
  /** `${mode}:${criterionId}` → 1..5 */
  ratings: Record<string, number>;
  /** `${scenarioId}:${mode}` → free-text observation */
  notes: Record<string, string>;
  /** `${scenarioId}:${mode}` → seconds taken */
  timings: Record<string, number>;
  overall: string;
  preferred: '' | 'atlas' | 'theater' | 'studio';
}

const emptyEvaluation = (): EvaluationState => ({ ratings: {}, notes: {}, timings: {}, overall: '', preferred: '' });

// ---- Store ---------------------------------------------------------------------

export interface WorkspaceData {
  version: number;
  layers: HypotheticalLayer[];
  activeLayerIds: string[];
  /** The layer new hypothetical items are added to. */
  editingLayerId: string | null;
  views: SavedView[];
  starred: string[];
  recents: string[];
  customScenarios: Scenario[];
  boards: StudioBoard[];
  activeBoardId: string | null;
  templates: StudioTemplate[];
  evaluation: EvaluationState;
  tourSeen: boolean;
}

interface WorkspaceActions {
  // layers
  createLayer: (name: string, description?: string) => string;
  updateLayer: (id: string, patch: Partial<Pick<HypotheticalLayer, 'name' | 'description'>>) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => string | null;
  setLayerActive: (id: string, active: boolean) => void;
  setEditingLayer: (id: string | null) => void;
  /** Returns the id of the layer that edits go to, creating "My proposal" if needed. */
  ensureEditingLayer: () => string;
  addHypoEntity: (entity: Entity, layerId?: string) => void;
  updateHypoEntity: (id: string, patch: Partial<Entity>) => void;
  removeHypoEntity: (id: string) => void;
  addHypoRelation: (relation: Relation, layerId?: string) => void;
  updateHypoRelation: (id: string, patch: Partial<Relation>) => void;
  removeHypoRelation: (id: string) => void;
  addModification: (mod: HypotheticalModification, layerId?: string) => void;
  removeModification: (id: string) => void;
  /** Discard every user layer and restore the shipped examples (inactive). */
  resetLayers: () => void;
  // views / stars / recents
  saveView: (view: Omit<SavedView, 'id' | 'createdAt'>) => string;
  renameView: (id: string, label: string) => void;
  deleteView: (id: string) => void;
  toggleStar: (entityId: string) => void;
  pushRecent: (entityId: string) => void;
  // scenarios
  saveCustomScenario: (scenario: Scenario) => void;
  deleteCustomScenario: (id: string) => void;
  // boards
  saveBoard: (board: StudioBoard) => void;
  deleteBoard: (id: string) => void;
  setActiveBoard: (id: string | null) => void;
  saveTemplate: (template: StudioTemplate) => void;
  deleteTemplate: (id: string) => void;
  // evaluation
  setRating: (key: string, value: number) => void;
  setNote: (key: string, value: string) => void;
  setTiming: (key: string, seconds: number) => void;
  setEvaluation: (patch: Partial<EvaluationState>) => void;
  resetEvaluation: () => void;
  // whole workspace
  setTourSeen: (seen: boolean) => void;
  replaceWorkspace: (data: WorkspaceData) => void;
  mergeWorkspace: (data: WorkspaceData) => void;
  resetWorkspace: () => void;
}

export type WorkspaceState = WorkspaceData & WorkspaceActions;

export const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

export function initialWorkspace(): WorkspaceData {
  return {
    version: WORKSPACE_VERSION,
    layers: BUILT_IN_LAYERS.map((l) => structuredClone(l)),
    activeLayerIds: [],
    editingLayerId: null,
    views: [],
    starred: [],
    recents: [],
    customScenarios: [],
    boards: [],
    activeBoardId: null,
    templates: [],
    evaluation: emptyEvaluation(),
    tourSeen: false,
  };
}

const touch = (layer: HypotheticalLayer): HypotheticalLayer => ({ ...layer, updatedAt: now() });

function mapLayer(layers: HypotheticalLayer[], id: string, fn: (l: HypotheticalLayer) => HypotheticalLayer): HypotheticalLayer[] {
  return layers.map((l) => (l.id === id ? touch(fn(l)) : l));
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...initialWorkspace(),

      createLayer: (name, description = '') => {
        const id = newId('layer');
        const layer: HypotheticalLayer = { id, name, description, entities: [], relations: [], contracts: [], modifications: [], scenarios: [], createdAt: now(), updatedAt: now() };
        set((s) => ({ layers: [...s.layers, layer], activeLayerIds: [...s.activeLayerIds, id], editingLayerId: id }));
        return id;
      },
      updateLayer: (id, patch) => set((s) => ({ layers: mapLayer(s.layers, id, (l) => ({ ...l, ...patch })) })),
      deleteLayer: (id) =>
        set((s) => ({
          layers: s.layers.filter((l) => l.id !== id),
          activeLayerIds: s.activeLayerIds.filter((x) => x !== id),
          editingLayerId: s.editingLayerId === id ? null : s.editingLayerId,
        })),
      duplicateLayer: (id) => {
        const src = get().layers.find((l) => l.id === id);
        if (!src) return null;
        const copyId = newId('layer');
        const suffix = copyId.slice(-4);
        // Hypothetical ids must stay unique across layers, so re-key the copy.
        const remap = new Map(src.entities.map((e) => [e.id, `${e.id}~${suffix}`]));
        const re = (x: string) => remap.get(x) ?? x;
        const copy: HypotheticalLayer = {
          ...structuredClone(src),
          id: copyId,
          name: `${src.name} (copy)`,
          builtIn: false,
          entities: src.entities.map((e) => ({ ...structuredClone(e), id: re(e.id), parent: e.parent ? re(e.parent) : e.parent })),
          relations: src.relations.map((r) => ({ ...structuredClone(r), id: `${r.id}~${suffix}`, from: re(r.from), to: re(r.to) })),
          contracts: src.contracts.map((c) => ({ ...structuredClone(c), id: re(c.id) })),
          modifications: src.modifications.map((m) => ({ ...structuredClone(m), id: `${m.id}~${suffix}` })),
          scenarios: src.scenarios.map((sc) => ({
            ...structuredClone(sc),
            id: `${sc.id}~${suffix}`,
            participants: sc.participants.map(re),
            related: sc.related.map(re),
            steps: sc.steps.map((st) => ({ ...structuredClone(st), from: re(st.from), to: re(st.to) })),
          })),
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({ layers: [...s.layers, copy], editingLayerId: copyId }));
        return copyId;
      },
      setLayerActive: (id, active) =>
        set((s) => ({ activeLayerIds: active ? [...new Set([...s.activeLayerIds, id])] : s.activeLayerIds.filter((x) => x !== id) })),
      setEditingLayer: (id) => set({ editingLayerId: id }),
      ensureEditingLayer: () => {
        const s = get();
        const current = s.layers.find((l) => l.id === s.editingLayerId && !l.builtIn);
        if (current) {
          if (!s.activeLayerIds.includes(current.id)) set({ activeLayerIds: [...s.activeLayerIds, current.id] });
          return current.id;
        }
        const mine = s.layers.find((l) => !l.builtIn);
        if (mine) {
          set({ editingLayerId: mine.id, activeLayerIds: [...new Set([...s.activeLayerIds, mine.id])] });
          return mine.id;
        }
        return get().createLayer('My proposal', 'Hypothetical changes sketched in this workspace.');
      },
      addHypoEntity: (entity, layerId) => {
        const id = layerId ?? get().ensureEditingLayer();
        set((s) => ({ layers: mapLayer(s.layers, id, (l) => ({ ...l, entities: [...l.entities.filter((e) => e.id !== entity.id), { ...entity, confidence: 'hypothetical' }] })) }));
      },
      updateHypoEntity: (id, patch) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.entities.some((e) => e.id === id) ? touch({ ...l, entities: l.entities.map((e) => (e.id === id ? { ...e, ...patch, id, confidence: 'hypothetical' } : e)) }) : l)),
        })),
      removeHypoEntity: (id) =>
        set((s) => ({
          layers: s.layers.map((l) =>
            l.entities.some((e) => e.id === id)
              ? touch({
                  ...l,
                  entities: l.entities.filter((e) => e.id !== id && e.parent !== id),
                  relations: l.relations.filter((r) => r.from !== id && r.to !== id),
                  contracts: l.contracts.filter((c) => c.id !== id),
                })
              : l,
          ),
        })),
      addHypoRelation: (relation, layerId) => {
        const id = layerId ?? get().ensureEditingLayer();
        set((s) => ({ layers: mapLayer(s.layers, id, (l) => ({ ...l, relations: [...l.relations.filter((r) => r.id !== relation.id), { ...relation, confidence: 'hypothetical' }] })) }));
      },
      updateHypoRelation: (id, patch) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.relations.some((r) => r.id === id) ? touch({ ...l, relations: l.relations.map((r) => (r.id === id ? { ...r, ...patch, id, confidence: 'hypothetical' } : r)) }) : l)),
        })),
      removeHypoRelation: (id) =>
        set((s) => ({ layers: s.layers.map((l) => (l.relations.some((r) => r.id === id) ? touch({ ...l, relations: l.relations.filter((r) => r.id !== id) }) : l)) })),
      addModification: (mod, layerId) => {
        const id = layerId ?? get().ensureEditingLayer();
        set((s) => ({ layers: mapLayer(s.layers, id, (l) => ({ ...l, modifications: [...l.modifications.filter((m) => m.id !== mod.id), mod] })) }));
      },
      removeModification: (id) =>
        set((s) => ({ layers: s.layers.map((l) => (l.modifications.some((m) => m.id === id) ? touch({ ...l, modifications: l.modifications.filter((m) => m.id !== id) }) : l)) })),
      resetLayers: () => set({ layers: BUILT_IN_LAYERS.map((l) => structuredClone(l)), activeLayerIds: [], editingLayerId: null }),

      saveView: (view) => {
        const id = newId('view');
        set((s) => ({ views: [{ ...view, id, createdAt: now() }, ...s.views] }));
        return id;
      },
      renameView: (id, label) => set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, label } : v)) })),
      deleteView: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
      toggleStar: (entityId) => set((s) => ({ starred: s.starred.includes(entityId) ? s.starred.filter((x) => x !== entityId) : [entityId, ...s.starred] })),
      pushRecent: (entityId) => set((s) => (s.recents[0] === entityId ? s : { recents: [entityId, ...s.recents.filter((x) => x !== entityId)].slice(0, 20) })),

      saveCustomScenario: (scenario) =>
        set((s) => ({ customScenarios: [{ ...scenario, custom: true }, ...s.customScenarios.filter((x) => x.id !== scenario.id)] })),
      deleteCustomScenario: (id) => set((s) => ({ customScenarios: s.customScenarios.filter((x) => x.id !== id) })),

      saveBoard: (board) =>
        set((s) => ({
          boards: s.boards.some((b) => b.id === board.id) ? s.boards.map((b) => (b.id === board.id ? { ...board, updatedAt: now() } : b)) : [...s.boards, { ...board, updatedAt: now() }],
        })),
      deleteBoard: (id) => set((s) => ({ boards: s.boards.filter((b) => b.id !== id), activeBoardId: s.activeBoardId === id ? null : s.activeBoardId })),
      setActiveBoard: (id) => set({ activeBoardId: id }),
      saveTemplate: (template) => set((s) => ({ templates: [template, ...s.templates.filter((t) => t.id !== template.id)] })),
      deleteTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      setRating: (key, value) => set((s) => ({ evaluation: { ...s.evaluation, ratings: { ...s.evaluation.ratings, [key]: value } } })),
      setNote: (key, value) => set((s) => ({ evaluation: { ...s.evaluation, notes: { ...s.evaluation.notes, [key]: value } } })),
      setTiming: (key, seconds) => set((s) => ({ evaluation: { ...s.evaluation, timings: { ...s.evaluation.timings, [key]: seconds } } })),
      setEvaluation: (patch) => set((s) => ({ evaluation: { ...s.evaluation, ...patch } })),
      resetEvaluation: () => set({ evaluation: emptyEvaluation() }),

      setTourSeen: (seen) => set({ tourSeen: seen }),
      replaceWorkspace: (data) => set({ ...data, version: WORKSPACE_VERSION }),
      mergeWorkspace: (data) =>
        set((s) => {
          const byId = <T extends { id: string }>(mine: T[], theirs: T[]) => [...mine.filter((m) => !theirs.some((t) => t.id === m.id)), ...theirs];
          return {
            layers: byId(s.layers, data.layers),
            views: byId(s.views, data.views),
            customScenarios: byId(s.customScenarios, data.customScenarios),
            boards: byId(s.boards, data.boards),
            templates: byId(s.templates, data.templates),
            starred: [...new Set([...s.starred, ...data.starred])],
          };
        }),
      resetWorkspace: () => set({ ...initialWorkspace(), tourSeen: true }),
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      version: WORKSPACE_VERSION,
      partialize: (s): WorkspaceData => ({
        version: s.version,
        layers: s.layers,
        activeLayerIds: s.activeLayerIds,
        editingLayerId: s.editingLayerId,
        views: s.views,
        starred: s.starred,
        recents: s.recents,
        customScenarios: s.customScenarios,
        boards: s.boards,
        activeBoardId: s.activeBoardId,
        templates: s.templates,
        evaluation: s.evaluation,
        tourSeen: s.tourSeen,
      }),
      // Shipped example layers are refreshed from code on load, so content fixes reach existing users.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspaceData>;
        const userLayers = (p.layers ?? []).filter((l) => !l.builtIn);
        return {
          ...current,
          ...p,
          layers: [...BUILT_IN_LAYERS.map((l) => structuredClone(l)), ...userLayers],
          evaluation: { ...emptyEvaluation(), ...(p.evaluation ?? {}) },
        };
      },
    },
  ),
);

/** Select the active layers (stable reference while nothing changes). */
export function selectActiveLayers(s: WorkspaceData): HypotheticalLayer[] {
  return s.layers.filter((l) => s.activeLayerIds.includes(l.id));
}
