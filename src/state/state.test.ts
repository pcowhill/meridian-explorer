import { beforeEach, describe, expect, it } from 'vitest';
import { baseModel } from '@/model';
import { useApp } from './app';
import { exportWorkspace, makeExport, parseImport } from './io';
import { buildHash, decodeSelection, encodeSelection, parseHash } from './url';
import { initialWorkspace, useWorkspace, type StudioBoard } from './workspace';

const resetStores = () => {
  useWorkspace.setState({ ...initialWorkspace() });
  useApp.setState({
    mode: 'atlas',
    selection: null,
    past: [],
    future: [],
    studioInbox: [],
    atlas: { expanded: [], focus: null, channels: ['http', 'realtime', 'data'], isolate: false, lens: null },
    theater: { scenarioId: null, variant: null, stepIndex: 0, view: 'sequence', speed: 1 },
  });
};

beforeEach(resetStores);

describe('deep links', () => {
  it('round-trips every selection type', () => {
    const selections = [
      { type: 'entity', id: 'be:money/movements#createTransfer' },
      { type: 'relation', id: 'rel:customer->backend:http' },
      { type: 'edge', a: 'customer', b: 'backend', channel: 'http' },
      { type: 'machine', id: 'sm:ledger-entry-status' },
      { type: 'term', term: 'Minor units' },
      { type: 'step', scenarioId: 'transfer', stepId: 's1' },
    ] as const;
    for (const s of selections) expect(decodeSelection(encodeSelection(s))).toEqual(s);
    expect(decodeSelection(null)).toBeNull();
    expect(decodeSelection('zz')).toBeNull();
  });

  it('builds a readable hash and parses it back', () => {
    useApp.getState().atlasSetExpanded(['meridian', 'backend']);
    useApp.getState().atlasFocus('backend');
    useApp.getState().select({ type: 'entity', id: 'be:money/movements#createTransfer' });
    const hash = buildHash(useApp.getState());
    expect(hash.startsWith('#/atlas?')).toBe(true);
    expect(hash).toContain('be:money/movements');
    const parsed = parseHash(hash);
    expect(parsed).toMatchObject({ mode: 'atlas', focus: 'backend', expanded: ['meridian', 'backend'], selection: { type: 'entity', id: 'be:money/movements#createTransfer' } });
  });

  it('encodes the theater position', () => {
    useApp.getState().openInTheater('transfer', 'insufficient-funds', 5);
    const parsed = parseHash(buildHash(useApp.getState()));
    expect(parsed).toMatchObject({ mode: 'theater', scenarioId: 'transfer', variant: 'insufficient-funds', stepIndex: 5 });
  });

  it('ignores junk and unknown values', () => {
    expect(parseHash('#/nowhere?aud=wizard&d=99&view=3d')).toEqual({});
    expect(parseHash('')).toEqual({});
  });

  it('shares only the shipped example layers by link', () => {
    const hash = buildHash(useApp.getState(), ['layer:simpay', 'layer_private123']);
    expect(parseHash(hash).layers).toEqual(['layer:simpay']);
  });
});

describe('session store', () => {
  it('reveals an entity by expanding its ancestors and selecting it', () => {
    useApp.getState().openInAtlas('be:money/movements#createTransfer');
    const s = useApp.getState();
    expect(s.mode).toBe('atlas');
    expect(s.selection).toEqual({ type: 'entity', id: 'be:money/movements#createTransfer' });
    expect(s.atlas.expanded).toEqual(expect.arrayContaining(['meridian', 'backend', 'be.money', 'be:money/movements']));
  });

  it('collapsing a container collapses what is inside it', () => {
    const a = useApp.getState();
    a.atlasSetExpanded(['meridian', 'backend', 'be.money', 'customer']);
    a.atlasToggle('backend');
    expect(useApp.getState().atlas.expanded).toEqual(['meridian', 'customer']);
    a.atlasToggle('backend');
    expect(useApp.getState().atlas.expanded).toContain('backend');
  });

  it('keeps the selection when switching modes and walks history across modes', () => {
    const a = useApp.getState();
    a.select({ type: 'entity', id: 'db:LedgerEntry' });
    a.setMode('theater');
    a.setMode('studio');
    expect(useApp.getState().selection).toEqual({ type: 'entity', id: 'db:LedgerEntry' });
    a.back();
    expect(useApp.getState().mode).toBe('theater');
    a.back();
    expect(useApp.getState().mode).toBe('atlas');
    a.forward();
    expect(useApp.getState().mode).toBe('theater');
  });

  it('sets detail and channels from the audience preset but allows manual override', () => {
    const a = useApp.getState();
    a.setAudience('executive');
    expect(useApp.getState().detail).toBe(1);
    a.setDetail(5);
    expect(useApp.getState()).toMatchObject({ audience: 'executive', detail: 5 });
    a.setAudience('developer');
    expect(useApp.getState().atlas.channels).toContain('call');
  });

  it('queues requests for the Studio and hands them over once', () => {
    useApp.getState().sendToStudio({ title: 't', source: 'inspector', entities: ['backend'] });
    expect(useApp.getState().mode).toBe('studio');
    expect(useApp.getState().consumeStudioInbox()).toHaveLength(1);
    expect(useApp.getState().consumeStudioInbox()).toHaveLength(0);
  });

  it('captures and restores a view', () => {
    const a = useApp.getState();
    a.openInAtlas('db:LedgerEntry');
    a.atlasFocus('db');
    const id = a.captureView('Ledger');
    a.atlasCollapseAll();
    a.setMode('theater');
    a.select(null);
    a.applyView(useWorkspace.getState().views.find((v) => v.id === id)!);
    expect(useApp.getState()).toMatchObject({ mode: 'atlas', selection: { type: 'entity', id: 'db:LedgerEntry' } });
    expect(useApp.getState().atlas.focus).toBe('db');
  });

  it('remembers recently selected entities', () => {
    useApp.getState().selectEntity('backend');
    useApp.getState().selectEntity('customer');
    expect(useWorkspace.getState().recents.slice(0, 2)).toEqual(['customer', 'backend']);
  });
});

describe('hypothetical layers in the workspace', () => {
  it('ships the SimPay example switched off', () => {
    const w = useWorkspace.getState();
    expect(w.layers.map((l) => l.id)).toContain('layer:simpay');
    expect(w.activeLayerIds).toEqual([]);
  });

  it('creates a personal layer on first edit and never edits a shipped one', () => {
    const w = useWorkspace.getState();
    w.addHypoEntity({ id: 'hypo:x', kind: 'external', name: 'X', parent: 'meridian', summary: 's' });
    const s = useWorkspace.getState();
    const mine = s.layers.find((l) => !l.builtIn)!;
    expect(mine.entities[0]).toMatchObject({ id: 'hypo:x', confidence: 'hypothetical' });
    expect(s.activeLayerIds).toContain(mine.id);
    expect(s.layers.find((l) => l.builtIn)!.entities.some((e) => e.id === 'hypo:x')).toBe(false);
  });

  it('removes a component together with its connections', () => {
    const w = useWorkspace.getState();
    w.addHypoEntity({ id: 'hypo:x', kind: 'external', name: 'X', parent: 'meridian', summary: 's' });
    w.addHypoRelation({ id: 'rel:x', from: 'hypo:x', to: 'backend', kind: 'http' });
    w.addModification({ id: 'm1', target: 'backend', op: 'change', summary: 'c' });
    w.removeHypoEntity('hypo:x');
    const mine = useWorkspace.getState().layers.find((l) => !l.builtIn)!;
    expect(mine.entities).toEqual([]);
    expect(mine.relations).toEqual([]);
    expect(mine.modifications).toHaveLength(1);
    w.removeModification('m1');
    expect(useWorkspace.getState().layers.find((l) => !l.builtIn)!.modifications).toEqual([]);
  });

  it('duplicates a shipped layer into an editable copy with fresh ids', () => {
    const id = useWorkspace.getState().duplicateLayer('layer:simpay')!;
    const copy = useWorkspace.getState().layers.find((l) => l.id === id)!;
    expect(copy.builtIn).toBe(false);
    expect(copy.entities.every((e) => !baseModel.has(e.id))).toBe(true);
    const original = new Set(useWorkspace.getState().layers.find((l) => l.id === 'layer:simpay')!.entities.map((e) => e.id));
    expect(copy.entities.some((e) => original.has(e.id))).toBe(false);
    const ids = new Set(copy.entities.map((e) => e.id));
    expect(copy.relations.every((r) => ids.has(r.from) || baseModel.has(r.from))).toBe(true);
  });

  it('discards user layers on reset and restores the examples', () => {
    const w = useWorkspace.getState();
    w.createLayer('Mine');
    w.resetLayers();
    expect(useWorkspace.getState().layers.every((l) => l.builtIn)).toBe(true);
    expect(useWorkspace.getState().activeLayerIds).toEqual([]);
  });
});

describe('import / export', () => {
  const board: StudioBoard = { id: 'b1', name: 'Board', nodes: [{ id: 'n1', type: 'entity', position: { x: 0, y: 0 }, data: { entityId: 'backend' } }], edges: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };

  it('round-trips a workspace without the shipped examples', () => {
    const w = useWorkspace.getState();
    w.saveBoard(board);
    w.toggleStar('backend');
    w.setRating('atlas:speed', 4);
    w.addHypoEntity({ id: 'hypo:x', kind: 'external', name: 'X', parent: 'meridian', summary: 's' });
    const text = exportWorkspace(useWorkspace.getState());
    expect(JSON.parse(text).payload.layers).toHaveLength(1);
    const result = parseImport(text);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== 'workspace') throw new Error('expected workspace');
    expect(result.data.boards[0].name).toBe('Board');
    expect(result.data.starred).toEqual(['backend']);
    expect(result.data.evaluation.ratings['atlas:speed']).toBe(4);
    expect(result.data.layers.filter((l) => l.builtIn)).toHaveLength(1);
    expect(result.data.layers.find((l) => !l.builtIn)!.entities[0].id).toBe('hypo:x');
  });

  it('rejects files that are not exports', () => {
    expect(parseImport('not json')).toMatchObject({ ok: false });
    expect(parseImport('{"hello":1}')).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ app: 'meridian-explorer', kind: 'workspace', version: 99, payload: {} }))).toMatchObject({ ok: false });
    const bad = parseImport(makeExport('board', { id: 'b', name: 'x', nodes: [{ id: 'n' }], edges: [], createdAt: '', updatedAt: '' }));
    expect(bad.ok).toBe(false);
  });

  it('never lets imported content pose as verified Meridian facts', () => {
    const layer = {
      id: 'layer_x',
      name: 'Imported',
      description: '',
      builtIn: true,
      entities: [
        { id: 'backend', kind: 'app', name: 'Fake backend', summary: 'collides', confidence: 'verified' },
        { id: 'hypo:new', kind: 'external', name: 'New', summary: 's', confidence: 'verified', parent: 'does-not-exist' },
      ],
      relations: [
        { id: 'r1', from: 'hypo:new', to: 'backend', kind: 'http', confidence: 'verified' },
        { id: 'r2', from: 'hypo:new', to: 'ghost', kind: 'http' },
      ],
    };
    const r = parseImport(makeExport('layer', layer));
    if (!r.ok || r.kind !== 'layer') throw new Error('expected layer');
    expect(r.data.builtIn).toBe(false);
    expect(r.data.entities.map((e) => e.id)).toEqual(['hypo:new']);
    expect(r.data.entities[0]).toMatchObject({ confidence: 'hypothetical', parent: 'meridian' });
    expect(r.data.relations).toHaveLength(1);
    expect(r.data.relations[0].confidence).toBe('hypothetical');
    expect(r.warnings.length).toBe(2);
  });

  it('imports a single board or scenario', () => {
    expect(parseImport(makeExport('board', board))).toMatchObject({ ok: true, kind: 'board' });
    const scenario = baseModel.scenario('transfer')!;
    const r = parseImport(makeExport('scenario', scenario));
    expect(r).toMatchObject({ ok: true, kind: 'scenario' });
    if (r.ok && r.kind === 'scenario') expect(r.data.custom).toBe(true);
  });

  it('warns when the export was made against another Meridian revision', () => {
    const text = JSON.stringify({ app: 'meridian-explorer', kind: 'board', version: 1, meridianSha: 'deadbeef', payload: board });
    const r = parseImport(text);
    expect(r.ok && r.warnings[0]).toMatch(/deadbee/);
  });
});
