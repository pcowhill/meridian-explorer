/**
 * Architecture Atlas — spatial exploration of the Meridian system.
 *
 * Internal architecture (all under src/atlas/):
 *   visibility.ts  which entities are on the map: expanded containers show the
 *                  children that pass the detail dial (or are hypothetical,
 *                  selected, revealed, lens implementers); focus stubs;
 *                  neighbourhood isolation.                              (pure)
 *   layout.ts      deterministic nested-rows layout, sized bottom-up.     (pure)
 *   scene.ts       node sizes + model → LayoutNode tree.                 (pure)
 *   edges.ts       lifted relations → edge specs, side/port routing, label
 *                  collision plan, z-order.                              (pure)
 *   emphasis.ts    highlight-dependencies / spotlight / lens effects.    (pure)
 *   nav.ts         arrow-key navigation; viewport.ts fit/ensure-visible. (pure)
 *   useScene.ts    memoised pipeline: useApp atlas state + local state →
 *                  visible tree → model.liftRelations → layout → node data;
 *                  plus the 200 ms rect tween used for expand/collapse.
 *   store.ts       local zustand store (sidebar, hover, effects, "+N more"
 *                  reveals, zoom band helper). Nodes/edges subscribe to single
 *                  values so hover and effects never rebuild the graph.
 *   actions.ts     click/toggle/reveal/lens/reset behaviour shared by nodes,
 *                  tree, toolbar and shortcuts.
 *   AtlasNode.tsx / AtlasEdge.tsx   React Flow node + edge renderers
 *                  (semantic zoom by band; edges draw precomputed geometry).
 *   Sidebar.tsx    system tree, relationship filters, features lens, legend.
 *   Atlas.tsx      (this file) composition: React Flow canvas, breadcrumbs,
 *                  canvas controls, floating selection toolbar, banners,
 *                  viewport following, keyboard shortcuts.
 *
 * Data flow: shared state (`useApp().atlas`, selection, detail, audience) and
 * the model with active hypothetical layers (`useModel`) → useScene → target
 * rects → tween → React Flow nodes/edges. Interactions call useApp actions
 * (atlasExpand, atlasFocus, select…) so other modes and deep links can drive
 * the map and history (`back`/`forward`) works.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MiniMap, ReactFlow, useReactFlow, useStore, type EdgeTypes, type NodeTypes } from '@xyflow/react';
import {
  ArrowUp,
  Crosshair,
  FlaskConical,
  Focus,
  Layers,
  ListTree,
  Maximize,
  Minimize2,
  Minus,
  Plus,
  Presentation,
  RotateCcw,
  Scan,
  Share2,
  Sparkles,
  Spline,
  X,
  Clapperboard,
  ChevronRight,
  Home,
} from 'lucide-react';
import { CHANNELS, KIND_LABEL, type Model } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { useHotkeys } from '@/shell/hotkeys';
import { HypotheticalComponentDialog } from '@/shell/ProposeChange';
import { Button, cn, IconButton, MenuItem, MenuLabel, Popover, Tip } from '@/ui/primitives';
import { KIND_COLOR, KindIcon, entityColor } from '@/ui/kinds';
import { AtlasEdge, type AtlasFlowEdge } from './AtlasEdge';
import { AtlasNode, type AtlasFlowNode } from './AtlasNode';
import { collapse, resetMap, setLens, toggleExpand } from './actions';
import { edgeZ, nodeZ, routeEdges } from './edges';
import { computeEmphasis, lensVisibleCount } from './emphasis';
import { boundsOf, type Rect } from './layout';
import { navigate, type Direction } from './nav';
import { Sidebar } from './Sidebar';
import { useAtlasLocal } from './store';
import { prefersReducedMotion, useScene, useTweenedRects, type Scene } from './useScene';
import { ensureVisible, fitRect, MAX_ZOOM, MIN_ZOOM, type Viewport } from './viewport';
import { isContainer } from './visibility';
import './atlas.css';

/** Giving React Flow a node handler keeps node pointer events on (clicks are handled inside AtlasNode). */
const NOOP = () => undefined;
const nodeTypes: NodeTypes = { atlas: AtlasNode };
const edgeTypes: EdgeTypes = { atlas: AtlasEdge };
const HYPO_PARENT_KINDS = ['system', 'app', 'subsystem', 'package', 'datastore', 'infra'];

const duration = (ms: number) => (prefersReducedMotion() ? 0 : ms);

export default function Atlas() {
  const model = useModel();
  const scene = useScene(model);
  const sidebarOpen = useAtlasLocal((s) => s.sidebarOpen);
  return (
    <div className="atlas flex h-full min-h-0" data-testid="atlas-root">
      {sidebarOpen && <Sidebar model={model} counts={scene.channelCounts} />}
      <AtlasCanvas model={model} scene={scene} />
    </div>
  );
}

function AtlasCanvas({ model, scene }: { model: Model; scene: Scene }) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const selection = useApp((s) => s.selection);
  const highlight = useAtlasLocal((s) => s.highlight);
  const spotlight = useAtlasLocal((s) => s.spotlight);
  const [hypoOpen, setHypoOpen] = useState(false);

  // ---- Geometry: tween → React Flow nodes / edges --------------------------------
  const shown = useTweenedRects(scene.rects);
  const rfNodes = useMemo<AtlasFlowNode[]>(() => {
    const out: AtlasFlowNode[] = [];
    for (const id of scene.tree.order) {
      const r = shown.get(id);
      const data = scene.nodeData.get(id);
      if (!r || !data) continue;
      out.push({ id, type: 'atlas', position: { x: r.x, y: r.y }, width: r.w, height: r.h, data, zIndex: nodeZ(data.depth), draggable: false, selectable: false, connectable: false, focusable: false });
    }
    return out;
  }, [scene.tree, scene.nodeData, shown]);

  const geoms = useMemo(() => routeEdges(scene.specs, shown), [scene.specs, shown]);
  const rfEdges = useMemo<AtlasFlowEdge[]>(() => {
    const out: AtlasFlowEdge[] = [];
    for (const s of scene.specs) {
      const geom = geoms.get(s.id);
      if (!geom) continue;
      const da = scene.nodeData.get(s.a)?.depth ?? 1;
      const db = scene.nodeData.get(s.b)?.depth ?? 1;
      out.push({ id: s.id, source: s.a, target: s.b, type: 'atlas', data: { spec: s, geom }, zIndex: edgeZ(da, db), selectable: false, focusable: false });
    }
    return out;
  }, [scene.specs, geoms, scene.nodeData]);

  // ---- Effects (highlight / spotlight / lens) → local store ------------------------
  useEffect(() => {
    const representative = (id: string) => {
      let cur: string | undefined = id;
      while (cur && !scene.tree.nodes.has(cur)) cur = model.entity(cur)?.parent;
      return cur;
    };
    const fx = computeEmphasis({ tree: scene.tree, edges: scene.specs, selected: scene.selectedOnMap, highlight, spotlight, lens: scene.lensIds, representative });
    useAtlasLocal.getState().set({ nodeFx: fx.nodeFx, edgeFx: fx.edgeFx, labelOk: scene.labelOk });
  }, [scene.tree, scene.specs, scene.selectedOnMap, scene.lensIds, scene.labelOk, highlight, spotlight, model]);

  // ---- Viewport ---------------------------------------------------------------------
  const canvas = useMemo(() => ({ width, height }), [width, height]);
  const go = useCallback((vp: Viewport | null, ms = 320) => vp && rf.setViewport(vp, { duration: duration(ms) }), [rf]);
  const fitAll = useCallback(
    (ms = 320) => {
      const b = boundsOf(scene.rects.values());
      if (b && width && height) go(fitRect(b, canvas, { maxZoom: 1.15 }), ms);
    },
    [scene.rects, width, height, canvas, go],
  );
  const zoomToSelection = useCallback(() => {
    const r = scene.selectedOnMap ? scene.rects.get(scene.selectedOnMap) : undefined;
    if (r && width) go(fitRect(r, canvas, { maxZoom: 1.6, padding: 0.12 }));
  }, [scene.selectedOnMap, scene.rects, width, canvas, go]);

  // First fit once the canvas has a size; refit when the frame changes (focus / isolation).
  const fitted = useRef(false);
  const frameKey = `${scene.focus ?? ''}|${scene.isolating}`;
  const lastFrame = useRef(frameKey);
  const lastSel = useRef<string | null>(scene.selectedOnMap);
  const lastSelRect = useRef<Rect | undefined>(undefined);
  useEffect(() => {
    if (!width || !height || scene.rects.size === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      lastFrame.current = frameKey;
      fitAll(0);
      // A deep link that selects something: make sure it is in view after the first fit.
      const sel = scene.selectedOnMap ? scene.rects.get(scene.selectedOnMap) : undefined;
      lastSel.current = scene.selectedOnMap;
      lastSelRect.current = sel;
      if (sel) {
        const b = boundsOf(scene.rects.values())!;
        const vp = fitRect(b, canvas, { maxZoom: 1.15 });
        const next = ensureVisible(sel, vp, canvas);
        if (next) go(next, 0);
      }
      return;
    }
    if (lastFrame.current !== frameKey) {
      lastFrame.current = frameKey;
      lastSel.current = scene.selectedOnMap;
      lastSelRect.current = scene.selectedOnMap ? scene.rects.get(scene.selectedOnMap) : undefined;
      fitAll();
      return;
    }
    // Follow the selection: frame a container that was just opened, otherwise just keep it in view.
    const id = scene.selectedOnMap;
    const r = id ? scene.rects.get(id) : undefined;
    const prevRect = lastSelRect.current;
    const changed = id !== lastSel.current;
    const resized = !!r && !!prevRect && (r.w !== prevRect.w || r.h !== prevRect.h);
    lastSel.current = id;
    lastSelRect.current = r;
    if (!id || !r || (!changed && !resized)) return;
    const vp = rf.getViewport();
    const node = scene.tree.nodes.get(id);
    if (node?.expanded && (changed || resized) && node.children.length > 0 && (changed || !ensureVisibleNoop(r, vp, canvas))) {
      go(fitRect(r, canvas, { maxZoom: Math.max(1, vp.zoom), padding: 0.06 }));
    } else go(ensureVisible(r, vp, canvas));
  }, [scene.rects, scene.selectedOnMap, scene.tree, frameKey, width, height, canvas, fitAll, go, rf]);

  // Semantic-zoom font scaling without React renders.
  const onMove = useCallback((_: unknown, vp: Viewport) => {
    wrapRef.current?.style.setProperty('--atlas-inv', String(1 / vp.zoom));
  }, []);

  // ---- Selection-derived values ------------------------------------------------------
  const selId = selection?.type === 'entity' ? selection.id : null;
  const selEntity = selId ? model.entity(selId) : undefined;
  const selOnMap = scene.selectedOnMap;
  const selNode = selOnMap ? scene.tree.nodes.get(selOnMap) : undefined;

  const doFocus = useCallback(() => {
    const app = useApp.getState();
    if (!selOnMap) return;
    const target = isContainer(model, selOnMap) ? selOnMap : model.parentOf(selOnMap)?.id;
    if (!target || target === model.root) {
      if (scene.focus) app.atlasFocus(null);
      return;
    }
    if (target === scene.focus) app.atlasFocus(null);
    else app.atlasFocus(target);
  }, [selOnMap, model, scene.focus]);

  const upOneLevel = useCallback(() => {
    const app = useApp.getState();
    if (scene.focus && (!selOnMap || selOnMap === scene.focus || scene.tree.nodes.get(selOnMap)?.stub)) {
      const parent = model.parentOf(scene.focus)?.id;
      app.atlasFocus(!parent || parent === model.root ? null : parent);
      app.selectEntity(scene.focus);
      return;
    }
    if (selOnMap) {
      const p = scene.tree.nodes.get(selOnMap)?.parent;
      if (p) app.selectEntity(p);
    }
  }, [scene.focus, selOnMap, model, scene.tree]);

  const relatedWorkflows = useMemo(() => (selEntity ? model.scenariosFor(selEntity.id) : []), [selEntity, model]);
  const openWorkflow = useCallback(() => {
    if (relatedWorkflows[0]) useApp.getState().openInTheater(relatedWorkflows[0].id);
  }, [relatedWorkflows]);

  const addToStudio = useCallback(() => {
    if (!selEntity) return;
    const neighbours = new Set<string>();
    for (const e of scene.specs) {
      if (e.a === selEntity.id) neighbours.add(e.b);
      if (e.b === selEntity.id) neighbours.add(e.a);
    }
    useApp.getState().sendToStudio({ title: selEntity.name, source: 'atlas', entities: [selEntity.id, ...[...neighbours].slice(0, 11)], note: `From the Architecture Atlas: ${selEntity.name} and what it connects to.` });
  }, [selEntity, scene.specs]);

  const hypoParent = useMemo(() => {
    if (!selEntity) return model.root;
    for (const e of [...model.path(selEntity.id)].reverse()) if (HYPO_PARENT_KINDS.includes(e.kind) && isContainer(model, e.id)) return e.id;
    return model.root;
  }, [selEntity, model]);
  const hypoConnect = selEntity && !isContainer(model, selEntity.id) ? selEntity.id : undefined;

  const toggleLocal = (key: 'highlight' | 'spotlight') => {
    const s = useAtlasLocal.getState();
    s.set({ [key]: !s[key], ...(key === 'highlight' ? { spotlight: false } : { highlight: false }) });
  };
  const arrow = (dir: Direction) => {
    const next = navigate(scene.tree, scene.rects, selOnMap, dir);
    if (next) useApp.getState().selectEntity(next);
  };

  useHotkeys([
    { id: 'atlas.expand', keys: 'e', label: 'Expand / collapse the selected container', group: 'Architecture Atlas', run: () => selOnMap && toggleExpand(model, selOnMap) },
    { id: 'atlas.focus', keys: 'f', label: 'Focus on the selected container (again to leave)', group: 'Architecture Atlas', run: doFocus },
    { id: 'atlas.up', keys: 'u', label: 'Up one level / leave focus', group: 'Architecture Atlas', run: upOneLevel },
    { id: 'atlas.fit', keys: '0', label: 'Zoom to fit', group: 'Architecture Atlas', run: () => fitAll() },
    { id: 'atlas.zoomsel', keys: 'z', label: 'Zoom to selection', group: 'Architecture Atlas', run: zoomToSelection },
    { id: 'atlas.deps', keys: 'd', label: 'Highlight dependencies of the selection', group: 'Architecture Atlas', run: () => toggleLocal('highlight') },
    { id: 'atlas.isolate', keys: 'n', label: 'Isolate the neighbourhood of the selection', group: 'Architecture Atlas', run: () => useApp.getState().atlasIsolate(!useApp.getState().atlas.isolate) },
    { id: 'atlas.spotlight', keys: 's', label: 'Spotlight the selection (for presenting)', group: 'Architecture Atlas', run: () => toggleLocal('spotlight') },
    { id: 'atlas.sidebar', keys: 't', label: 'Show / hide the sidebar', group: 'Architecture Atlas', run: () => useAtlasLocal.getState().set({ sidebarOpen: !useAtlasLocal.getState().sidebarOpen }) },
    { id: 'atlas.nav.up', keys: 'ArrowUp', label: 'Select the parent', group: 'Architecture Atlas', run: () => arrow('up') },
    { id: 'atlas.nav.down', keys: 'ArrowDown', label: 'Select the first child', group: 'Architecture Atlas', run: () => arrow('down') },
    { id: 'atlas.nav.left', keys: 'ArrowLeft', label: 'Select the previous sibling', group: 'Architecture Atlas', run: () => arrow('left') },
    { id: 'atlas.nav.right', keys: 'ArrowRight', label: 'Select the next sibling', group: 'Architecture Atlas', run: () => arrow('right') },
    { id: 'atlas.home', keys: 'Home', label: 'Collapse everything (back to the overview)', group: 'Architecture Atlas', run: resetMap },
    { id: 'atlas.workflow', keys: 'w', label: 'Open the related workflow in the Theater', group: 'Architecture Atlas', run: openWorkflow },
    { id: 'atlas.hypo', keys: 'shift+h', label: 'Add a hypothetical component', group: 'Architecture Atlas', run: () => setHypoOpen(true) },
  ]);

  const lensEntity = useApp((s) => (s.atlas.lens ? model.entity(s.atlas.lens) : undefined));
  const lensOnMap = scene.lensIds ? lensVisibleCount(scene.tree, scene.lensIds) : 0;
  const shownEdges = rfEdges.length;

  return (
    <div ref={wrapRef} className="atlas-canvas relative min-w-0 flex-1" style={{ ['--atlas-inv' as string]: '1' }}>
      <ReactFlow<AtlasFlowNode, AtlasFlowEdge>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onPaneClick={() => useApp.getState().select(null)}
        onNodeClick={NOOP}
        onMove={onMove}
        onInit={(inst) => onMove(null, inst.getViewport())}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        zIndexMode="manual"
        attributionPosition="bottom-center"
        aria-label="Architecture map"
      >
        <MiniMap
          className="presenter-hide atlas-minimap"
          pannable
          zoomable
          ariaLabel="Mini map"
          nodeBorderRadius={6}
          nodeColor={(n) => {
            const d = (n as AtlasFlowNode).data;
            if (d.expanded) return 'transparent';
            return d.confidence === 'hypothetical' ? 'var(--k-hypo)' : d.kind === 'system' ? 'var(--accent)' : KIND_COLOR[d.kind];
          }}
          nodeStrokeColor={(n) => ((n as AtlasFlowNode).data.expanded ? 'var(--line-strong)' : 'transparent')}
          nodeStrokeWidth={3}
          maskColor="color-mix(in srgb, var(--bg) 62%, transparent)"
        />
      </ReactFlow>

      <Breadcrumbs model={model} scene={scene} onUp={upOneLevel} />

      <div className="presenter-hide absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <Tip label="Add a hypothetical component (dashed, purple) — it never changes Meridian" keys="Shift+H">
          <button type="button" aria-label="Add hypothetical component" className="atlas-chrome-btn text-hypo" onClick={() => setHypoOpen(true)}>
            <FlaskConical size={14} />
            <span className="hidden lg:inline">What if…</span>
          </button>
        </Tip>
        <Tip label="Collapse everything — back to the single Meridian node" keys="Home">
          <button type="button" aria-label="Reset the map" className="atlas-chrome-btn" onClick={resetMap}>
            <RotateCcw size={14} />
          </button>
        </Tip>
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-line bg-surface p-1 shadow-panel">
        <IconButton label="Zoom in" size="sm" tipSide="right" onClick={() => rf.zoomIn({ duration: duration(180) })}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Zoom out" size="sm" tipSide="right" onClick={() => rf.zoomOut({ duration: duration(180) })}>
          <Minus size={14} />
        </IconButton>
        <IconButton label="Zoom to fit" keys="0" size="sm" tipSide="right" onClick={() => fitAll()}>
          <Maximize size={14} />
        </IconButton>
        <IconButton label="Zoom to selection" keys="Z" size="sm" tipSide="right" disabled={!selOnMap} onClick={zoomToSelection}>
          <Scan size={14} />
        </IconButton>
      </div>

      <Banners model={model} scene={scene} lensName={lensEntity?.name} lensOnMap={lensOnMap} shownEdges={shownEdges} />

      {selOnMap && selNode && selEntity && (
        <SelectionToolbar
          rect={scene.rects.get(selOnMap)}
          name={selEntity.name}
          kind={selEntity.kind}
          color={entityColor(selEntity)}
          container={selNode.isContainer}
          expanded={selNode.expanded}
          isFocusRoot={selOnMap === scene.focus}
          canFocus={selOnMap !== model.root && (selNode.isContainer || (!!model.parentOf(selOnMap) && model.parentOf(selOnMap)!.id !== model.root))}
          stub={!!selNode.stub}
          highlight={highlight}
          spotlight={spotlight}
          isolate={scene.isolating}
          workflows={relatedWorkflows.map((s) => ({ id: s.id, title: s.title }))}
          onToggle={() => toggleExpand(model, selOnMap)}
          onFocus={doFocus}
          onUp={upOneLevel}
          onStudio={addToStudio}
        />
      )}

      {hypoOpen && (
        <HypotheticalComponentDialog
          open
          parent={hypoParent}
          connectTo={hypoConnect}
          onClose={() => setHypoOpen(false)}
          onCreated={(id) => {
            // Reveal it on the map: expand the chain down to its parent.
            const app = useApp.getState();
            const chain = [...model.ancestorIds(hypoParent), hypoParent];
            app.atlasExpand(chain);
            app.selectEntity(id);
          }}
        />
      )}
    </div>
  );
}

/** Pure check wrapper so the effect reads clearly. */
function ensureVisibleNoop(r: Rect, vp: Viewport, canvas: { width: number; height: number }): boolean {
  return ensureVisible(r, vp, canvas) === null;
}

// ---------------------------------------------------------------------------
// Breadcrumbs (focus path) + sidebar toggle
// ---------------------------------------------------------------------------

function Breadcrumbs({ model, scene, onUp }: { model: Model; scene: Scene; onUp: () => void }) {
  const sidebarOpen = useAtlasLocal((s) => s.sidebarOpen);
  const setLocal = useAtlasLocal((s) => s.set);
  const selection = useApp((s) => s.selection);
  const focusPath = scene.focus ? model.path(scene.focus) : [];
  const selPath = selection?.type === 'entity' && model.has(selection.id) ? model.path(selection.id) : [];
  // Within focus: crumbs below the focus follow the selection.
  const inner = scene.focus ? (selPath.some((e) => e.id === scene.focus) ? selPath.slice(selPath.findIndex((e) => e.id === scene.focus) + 1) : []) : selPath.slice(1);
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-200px)] items-center gap-1.5">
      {!sidebarOpen && (
        <Tip label="Show the sidebar (tree, filters, lens, legend)" keys="T">
          <button type="button" aria-label="Show the sidebar" className="atlas-chrome-btn presenter-hide" onClick={() => setLocal({ sidebarOpen: true })}>
            <ListTree size={14} />
          </button>
        </Tip>
      )}
      <nav aria-label="Map location" data-testid="atlas-breadcrumb" className={cn('atlas-crumbs', scene.focus && 'is-focused')}>
        <button
          type="button"
          data-crumb={model.root}
          className="atlas-crumb"
          onClick={() => {
            if (scene.focus) useApp.getState().atlasFocus(null);
            else useApp.getState().selectEntity(model.root);
          }}
          title={scene.focus ? 'Back to the whole system' : 'Select the whole system'}
        >
          <Home size={12} /> {scene.focus ? 'Whole system' : model.entity(model.root)?.name}
        </button>
        {focusPath.slice(1).map((e) => (
          <span key={e.id} className="contents">
            <ChevronRight size={12} className="shrink-0 text-fg-subtle" />
            <button
              type="button"
              data-crumb={e.id}
              className={cn('atlas-crumb', e.id === scene.focus && 'is-current')}
              onClick={() => (e.id === scene.focus ? useApp.getState().selectEntity(e.id) : useApp.getState().atlasFocus(e.id))}
              title={e.id === scene.focus ? `Focused on ${e.name}` : `Focus on ${e.name}`}
            >
              {e.id === scene.focus && <Crosshair size={12} />}
              <span className="truncate">{e.name}</span>
            </button>
          </span>
        ))}
        {inner.map((e) => (
          <span key={e.id} className="contents">
            <ChevronRight size={12} className="shrink-0 text-fg-subtle" />
            <button type="button" data-crumb={e.id} className="atlas-crumb is-inner" onClick={() => useApp.getState().atlasReveal(e.id)}>
              <span className="truncate">{e.name}</span>
            </button>
          </span>
        ))}
      </nav>
      {scene.focus && (
        <>
          <Tip label="Up one level" keys="U">
            <button type="button" aria-label="Up one level" className="atlas-chrome-btn" onClick={onUp}>
              <ArrowUp size={14} />
            </button>
          </Tip>
          <Tip label="Leave focus — back to the whole system">
            <button type="button" aria-label="Leave focus" className="atlas-chrome-btn" onClick={() => useApp.getState().atlasFocus(null)}>
              <Minimize2 size={14} />
              <span className="hidden md:inline">Whole system</span>
            </button>
          </Tip>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banners (empty states and active modes)
// ---------------------------------------------------------------------------

function Banners({ model, scene, lensName, lensOnMap, shownEdges }: { model: Model; scene: Scene; lensName?: string; lensOnMap: number; shownEdges: number }) {
  const highlight = useAtlasLocal((s) => s.highlight);
  const spotlight = useAtlasLocal((s) => s.spotlight);
  const setLocal = useAtlasLocal((s) => s.set);
  const items: ReactNode[] = [];
  if (scene.allFiltered) {
    items.push(
      <Banner key="filtered" icon={<Spline size={13} />} action={<Button size="sm" variant="ghost" onClick={() => useApp.getState().atlasSetChannels(CHANNELS.map((c) => c.id))}>Show all</Button>}>
        Every relationship on the map is hidden by the relationship filters.
      </Banner>,
    );
  } else if (shownEdges === 0 && scene.tree.order.length > 1 && !scene.isolating) {
    items.push(
      <Banner key="noedges" icon={<Spline size={13} />}>
        No relationships between the things shown here. Expand a container or switch on more relationship types in the sidebar.
      </Banner>,
    );
  }
  if (scene.lensIds && lensName) {
    items.push(
      <Banner key="lens" tone="feature" icon={<Sparkles size={13} />} action={<Button size="sm" variant="ghost" onClick={() => setLens(model, null)}>Turn off</Button>}>
        {lensOnMap > 0 ? (
          <>
            Lens: <b>{lensName}</b> — {lensOnMap} of {scene.lensIds.size} implementing part{scene.lensIds.size === 1 ? '' : 's'} on the map.
          </>
        ) : (
          <>
            Lens: <b>{lensName}</b> — none of its {scene.lensIds.size} implementing parts is visible in this view{scene.focus ? ' (they are outside the focus)' : ''}.
          </>
        )}
      </Banner>,
    );
  }
  if (scene.isolating) {
    items.push(
      <Banner key="iso" icon={<Share2 size={13} />} action={<Button size="sm" variant="ghost" onClick={() => useApp.getState().atlasIsolate(false)}>Show everything</Button>}>
        Showing only the selection, its neighbours and where they live.
      </Banner>,
    );
  }
  if (spotlight || highlight) {
    items.push(
      <Banner key="fx" icon={spotlight ? <Presentation size={13} /> : <Share2 size={13} />} action={<Button size="sm" variant="ghost" onClick={() => setLocal({ spotlight: false, highlight: false })}>Turn off</Button>}>
        {spotlight ? 'Spotlight on the selection.' : 'Highlighting the selection’s dependencies.'}
        {!scene.selectedOnMap && ' Select something on the map.'}
      </Banner>,
    );
  }
  if (!items.length) return null;
  return <div className="pointer-events-none absolute left-1/2 top-14 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">{items}</div>;
}

function Banner({ children, action, icon, tone }: { children: ReactNode; action?: ReactNode; icon?: ReactNode; tone?: 'feature' }) {
  return (
    <div role="status" className={cn('atlas-banner pointer-events-auto', tone === 'feature' && 'is-feature')}>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating selection toolbar
// ---------------------------------------------------------------------------

interface ToolbarProps {
  rect: Rect | undefined;
  name: string;
  kind: Parameters<typeof KindIcon>[0]['kind'];
  color: string;
  container: boolean;
  expanded: boolean;
  isFocusRoot: boolean;
  canFocus: boolean;
  stub: boolean;
  highlight: boolean;
  spotlight: boolean;
  isolate: boolean;
  workflows: { id: string; title: string }[];
  onToggle: () => void;
  onFocus: () => void;
  onUp: () => void;
  onStudio: () => void;
}

function SelectionToolbar(p: ToolbarProps) {
  const transform = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const set = useAtlasLocal((s) => s.set);
  if (!p.rect || p.stub || !width) return null;
  const [tx, ty, zoom] = transform;
  const half = 190;
  const x = Math.max(half + 8, Math.min(width - half - 8, tx + (p.rect.x + p.rect.w / 2) * zoom));
  const yTop = ty + p.rect.y * zoom - 10;
  const below = yTop < 96;
  const y = below ? Math.min(height - 60, Math.max(96, ty + (p.rect.y + p.rect.h) * zoom + 10)) : yTop;
  if (y < 0 || y > height + 40) return null;
  return (
    <div
      role="toolbar"
      aria-label={`Actions for ${p.name}`}
      data-testid="atlas-selection-toolbar"
      className="atlas-seltool presenter-keep"
      style={{ left: x, top: y, transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="atlas-seltool-name" title={`${p.name} · ${KIND_LABEL[p.kind]}`}>
        <span style={{ color: p.color }}>
          <KindIcon kind={p.kind} size={12} />
        </span>
        <span className="truncate">{p.name}</span>
      </span>
      <span className="atlas-seltool-sep" />
      {p.container && !p.isFocusRoot && (
        <IconButton label={p.expanded ? 'Collapse' : 'Expand'} keys="E" size="sm" tipSide="top" onClick={p.onToggle}>
          {p.expanded ? <Minimize2 size={14} /> : <Layers size={14} />}
        </IconButton>
      )}
      {p.canFocus && !p.isFocusRoot && (
        <IconButton label="Focus" keys="F" size="sm" tipSide="top" onClick={p.onFocus}>
          <Focus size={14} />
        </IconButton>
      )}
      <IconButton label="Up one level" keys="U" size="sm" tipSide="top" onClick={p.onUp}>
        <ArrowUp size={14} />
      </IconButton>
      <IconButton
        label="Highlight dependencies"
        keys="D"
        size="sm"
        tipSide="top"
        active={p.highlight}
        onClick={() => set({ highlight: !p.highlight, spotlight: false })}
      >
        <Share2 size={14} />
      </IconButton>
      <IconButton label="Isolate neighbourhood" keys="N" size="sm" tipSide="top" active={p.isolate} onClick={() => useApp.getState().atlasIsolate(!p.isolate)}>
        <Crosshair size={14} />
      </IconButton>
      <IconButton label="Spotlight" keys="S" size="sm" tipSide="top" active={p.spotlight} onClick={() => set({ spotlight: !p.spotlight, highlight: false })}>
        <Presentation size={14} />
      </IconButton>
      {p.workflows.length > 0 && (
        <Popover
          side="top"
          align="end"
          className="w-72"
          trigger={(t) => (
            <Tip label={`Related workflows (${p.workflows.length}) — W opens the best match`} keys="W" side="top">
              <button type="button" aria-label="Related workflows" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" {...t}>
                <Clapperboard size={14} />
              </button>
            </Tip>
          )}
        >
          {(close) => (
            <div role="menu">
              <MenuLabel>Workflows involving {p.name}</MenuLabel>
              {p.workflows.slice(0, 8).map((w, i) => (
                <MenuItem
                  key={w.id}
                  icon={<Clapperboard size={13} />}
                  keys={i === 0 ? 'W' : undefined}
                  onClick={() => {
                    close();
                    useApp.getState().openInTheater(w.id);
                  }}
                >
                  {w.title}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
      )}
      <IconButton label="Add to Studio" size="sm" tipSide="top" onClick={p.onStudio}>
        <X size={14} className="rotate-45" />
      </IconButton>
    </div>
  );
}

export { collapse };
