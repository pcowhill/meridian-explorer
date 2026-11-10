/**
 * The Atlas's purely local view state (never shared with other modes): zoom
 * band, hover, presentation effects, per-container "+N more" reveals, the
 * sidebar, and the per-node / per-edge visual effects derived from them.
 * Node and edge components subscribe to single primitive values here so a
 * hover or a highlight re-renders only the elements whose look changes.
 */
import { create } from 'zustand';

export const NEAR_MID = 0.68;
export const NEAR_ZOOM = 1.2;

export type ZoomBand = 'far' | 'mid' | 'near';

/** far: name only · mid: icon + name + summary · near: + badges, counts, markers. */
export function zoomBand(zoom: number): ZoomBand {
  if (zoom < NEAR_MID) return 'far';
  if (zoom < NEAR_ZOOM) return 'mid';
  return 'near';
}

/** Per-node look: `dim` = faded, `focus` = emphasised, `lens` = implements the active feature, `lens-in` = contains an implementer. */
export type NodeFx = 'dim' | 'focus' | 'lens' | 'lens-in' | undefined;
export type EdgeFx = 'dim' | 'focus' | undefined;

export interface CameraIntent {
  kind: 'expand' | 'select' | 'fit';
  id?: string;
  seq: number;
}

export interface AtlasLocal {
  sidebarOpen: boolean;
  /** Highlight dependencies of the selection. */
  highlight: boolean;
  /** Dim everything except the selection and its contents. */
  spotlight: boolean;
  /** Containers whose detail-hidden children are shown. */
  revealAll: string[];
  /** Entities kept visible regardless of the detail dial (visited / revealed). */
  pinned: string[];
  hoverNode: string | null;
  hoverEdge: string | null;
  nodeFx: Map<string, NodeFx>;
  edgeFx: Map<string, EdgeFx>;
  /** Edge ids whose labels fit without collisions at close zoom. */
  labelOk: Set<string>;
  treeFilter: string;
  /**
   * What the last on-map interaction wants from the camera: `expand` keeps the
   * clicked header in place, `select` only keeps the node in view, `fit` shows
   * everything. Selections without an intent (deep link, search, tree…) are
   * framed at a readable zoom.
   */
  camera: CameraIntent | null;
  set: (patch: Partial<Omit<AtlasLocal, 'set'>>) => void;
}

export const useAtlasLocal = create<AtlasLocal>((set) => ({
  sidebarOpen: true,
  highlight: false,
  spotlight: false,
  revealAll: [],
  pinned: [],
  hoverNode: null,
  hoverEdge: null,
  nodeFx: new Map(),
  edgeFx: new Map(),
  labelOk: new Set(),
  treeFilter: '',
  camera: null,
  set: (patch) => set(patch),
}));

let cameraSeq = 0;
export function requestCamera(kind: CameraIntent['kind'], id?: string): void {
  useAtlasLocal.getState().set({ camera: { kind, id, seq: ++cameraSeq } });
}
