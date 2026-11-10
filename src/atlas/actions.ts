/**
 * Atlas interactions that change shared (`useApp`) or local state. Kept out of
 * components so the node, the tree, the toolbar and the shortcuts all behave
 * identically.
 */
import type { Model } from '@/model';
import { useApp } from '@/state/app';
import { useAtlasLocal } from './store';
import { isContainer } from './visibility';

interface NodeRef {
  id: string;
  stub?: boolean;
  isContainer: boolean;
  expanded: boolean;
}

/** Click on a map node: stubs leave focus; collapsed containers select + expand; everything else selects. */
export function activateNode(_model: Model, d: NodeRef): void {
  const app = useApp.getState();
  if (d.stub) {
    app.atlasFocus(null);
    app.atlasReveal(d.id);
    return;
  }
  app.selectEntity(d.id);
  if (d.isContainer && !d.expanded) app.atlasExpand([d.id]);
}

/** The header chevron: expand, or collapse (moving the selection out of the collapsed contents). */
export function toggleNode(model: Model, d: NodeRef): void {
  if (d.expanded) collapse(model, d.id);
  else useApp.getState().atlasExpand([d.id]);
}

export function collapse(model: Model, id: string): void {
  const app = useApp.getState();
  app.atlasCollapse(id);
  const sel = app.selection;
  if (sel?.type === 'entity' && sel.id !== id && model.isWithin(sel.id, id)) app.selectEntity(id);
  const local = useAtlasLocal.getState();
  local.set({ revealAll: local.revealAll.filter((x) => x !== id && !model.isWithin(x, id)) });
}

export function toggleExpand(model: Model, id: string): void {
  const app = useApp.getState();
  if (!isContainer(model, id)) return;
  if (app.atlas.expanded.includes(id) || app.atlas.focus === id) {
    if (app.atlas.focus === id) return;
    collapse(model, id);
  } else app.atlasExpand([id]);
}

/** "+N more": show this container's detail-hidden children (local to the Atlas). */
export function revealHidden(id: string): void {
  const local = useAtlasLocal.getState();
  if (!local.revealAll.includes(id)) local.set({ revealAll: [...local.revealAll, id] });
}

/** Home: back to the single Meridian node. */
export function resetMap(): void {
  useApp.getState().atlasCollapseAll();
  useApp.getState().atlasLens(null);
  useAtlasLocal.getState().set({ revealAll: [], pinned: [], highlight: false, spotlight: false });
}

/** Feature lens: highlight implementers and expand their ancestors so they are on the map. */
export function setLens(model: Model, featureId: string | null): void {
  const app = useApp.getState();
  if (!featureId || app.atlas.lens === featureId) {
    app.atlasLens(null);
    return;
  }
  const ancestors = new Set<string>();
  for (const e of model.implementersOf(featureId)) {
    if (e.kind === 'feature') continue;
    for (const a of model.ancestorIds(e.id)) ancestors.add(a);
  }
  app.atlasLens(featureId);
  if (app.atlas.focus && ![...ancestors].includes(app.atlas.focus)) app.atlasFocus(null);
  app.atlasExpand([...ancestors]);
}
