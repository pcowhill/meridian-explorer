import { describe, expect, it } from 'vitest';
import { baseModel, reusableSteps, stateAfter, variantSteps, visibleSteps, type Scenario } from '@/model';
import {
  blankScenario,
  breakable,
  clampIndex,
  customizeCopy,
  deleteStep,
  duplicateStep,
  edgeGeometry,
  effectiveVariant,
  followStep,
  groupByCategory,
  insertStepAfter,
  mapIndexOnVariantChange,
  matchesFilter,
  moveStep,
  moveStepBefore,
  newStep,
  nextInteresting,
  nextSpeed,
  parsePayload,
  pathsOverview,
  removeParticipant,
  resolveScenario,
  reusableCaller,
  stageLayout,
  statesAround,
  stepDuration,
  stepFromReusable,
  stepMarks,
  studioRequest,
  uniqueImportId,
  updateStep,
} from './logic';

const ops = baseModel.scenario('ops-approval')!;

/** A small hand-made scenario with two variants and a hidden step that writes. */
const tiny: Scenario = {
  id: 'tiny',
  title: 'Tiny',
  question: 'What happens?',
  summary: '',
  category: 'money',
  participants: ['a', 'b', 'c'],
  related: [],
  variants: [
    { id: 'yes', label: 'Yes', outcome: 'success' },
    { id: 'no', label: 'No', outcome: 'rejected', hypothetical: true },
  ],
  defaultVariant: 'yes',
  initialState: { T: [{ id: 'r1', v: 1 }] },
  steps: [
    { id: 's1', kind: 'request', title: 'one', from: 'a', to: 'b', label: 'one', narrative: 'n', detail: 1 },
    { id: 's2', kind: 'db-write', title: 'hidden write', from: 'b', to: 'c', label: 'w', narrative: 'n', detail: 4, effects: [{ op: 'update', table: 'T', id: 'r1', set: { v: 2 } }] },
    { id: 's3', kind: 'decision', title: 'decide', from: 'b', to: 'b', label: 'd', narrative: 'n', detail: 1, decision: { question: 'q', options: [{ label: 'Y', variant: 'yes' }, { label: 'N', variant: 'no' }] } },
    { id: 's4', kind: 'response', title: 'yes path', from: 'b', to: 'a', label: 'ok', narrative: 'n', detail: 1, variants: ['yes'] },
    { id: 's5', kind: 'response', title: 'no path', from: 'b', to: 'a', label: 'no', narrative: 'n', detail: 1, variants: ['no'], hypothetical: true },
    { id: 's6', kind: 'state', title: 'end', from: 'a', to: 'a', label: 'end', narrative: 'n', detail: 1 },
  ],
};

describe('resolution', () => {
  it('finds drafts first, then custom, then the model, then assembles traces', () => {
    const custom = { ...tiny, id: 'ops-approval', title: 'mine' };
    expect(resolveScenario('ops-approval', baseModel, []).source).toBe('model');
    expect(resolveScenario('ops-approval', baseModel, [custom]).scenario?.title).toBe('mine');
    expect(resolveScenario('ops-approval', baseModel, [custom], { 'ops-approval': { ...custom, title: 'draft' } }).source).toBe('draft');
    const trace = resolveScenario('trace:ep:POST /api/transfers', baseModel, []);
    expect(trace.source).toBe('trace');
    expect(trace.scenario?.steps.length).toBeGreaterThan(3);
    expect(trace.endpointId).toBe('ep:POST /api/transfers');
  });
  it('returns nothing for unknown ids and unknown endpoints', () => {
    expect(resolveScenario('nope', baseModel, []).scenario).toBeNull();
    expect(resolveScenario('trace:ep:GET /nope', baseModel, []).scenario).toBeNull();
    expect(resolveScenario(null, baseModel, []).source).toBeNull();
  });
  it('falls back to the default variant and clamps indexes', () => {
    expect(effectiveVariant(tiny, null)).toBe('yes');
    expect(effectiveVariant(tiny, 'missing')).toBe('yes');
    expect(effectiveVariant(tiny, 'no')).toBe('no');
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(4, 0)).toBe(0);
  });
});

describe('marks and database states', () => {
  it('folds hidden steps (and their effects) into the next visible step', () => {
    const vis = visibleSteps(tiny, 'yes', 2);
    expect(vis.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's6']);
    const marks = stepMarks(tiny, 'yes', vis);
    expect(marks[1]).toMatchObject({ decision: true, db: true, hiddenBefore: 1, tables: ['T'] });
    expect(marks[0].db).toBe(false);
    const { before, after } = statesAround(tiny, 'yes', vis, 1);
    expect(before.T[0].v).toBe(1);
    expect(after.T[0].v).toBe(2);
  });
  it('jumps to the next/previous decision or database change', () => {
    const vis = variantSteps(tiny, 'yes');
    const marks = stepMarks(tiny, 'yes', vis);
    expect(nextInteresting(marks, 0, 1)).toBe(1);
    expect(nextInteresting(marks, 1, 1)).toBe(2);
    expect(nextInteresting(marks, 2, -1)).toBe(1);
    expect(nextInteresting(marks, 3, 1)).toBe(3);
  });
  it('replays the ops-approval ledger flip from pending to posted', () => {
    const vis = visibleSteps(ops, 'approve', 3);
    const i = vis.findIndex((s) => (s.effects ?? []).some((e) => e.table === 'LedgerEntry'));
    expect(i).toBeGreaterThan(0);
    const { before, after } = statesAround(ops, 'approve', vis, i);
    const row = (st: typeof before) => st.LedgerEntry.find((r) => r.id === 'le_003');
    expect(row(before)?.status).toBe('pending');
    expect(row(after)?.status).toBe('posted');
  });
});

describe('variants', () => {
  it('keeps the same step when it exists in the new variant, else the last shared step', () => {
    // At the decision (index 1 at detail 2) both variants share it.
    expect(mapIndexOnVariantChange(tiny, 'yes', 'no', 2, 1)).toBe(1);
    // At "yes path" (index 2) → "no" lacks it → last shared step = decision.
    expect(mapIndexOnVariantChange(tiny, 'yes', 'no', 2, 2)).toBe(1);
    // The shared ending is found again.
    expect(mapIndexOnVariantChange(tiny, 'yes', 'no', 2, 3)).toBe(3);
  });
  it('maps ops-approval decisions between approve and reject', () => {
    const vis = visibleSteps(ops, 'approve', 3);
    const d = vis.findIndex((s) => s.decision);
    const j = mapIndexOnVariantChange(ops, 'approve', 'reject', 3, d);
    expect(visibleSteps(ops, 'reject', 3)[j].id).toBe(vis[d].id);
  });
  it('summarises shared and divergent paths', () => {
    const rows = pathsOverview(tiny, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].divergesAt).toBe(2);
    expect(rows[1].cells[2]).toMatchObject({ id: 's5', shared: false, hypothetical: true });
    expect(rows[0].cells[0].shared).toBe(true);
  });
  it('follows the current step across detail changes', () => {
    const at5 = visibleSteps(tiny, 'yes', 5);
    const at2 = visibleSteps(tiny, 'yes', 2);
    expect(followStep(tiny, 'yes', at2, 's3')).toBe(1);
    expect(followStep(tiny, 'yes', at2, 's2')).toBe(0); // hidden → previous visible
    expect(followStep(tiny, 'yes', at5, 's5')).toBeNull(); // not in this variant
  });
});

describe('playback', () => {
  it('scales step duration with speed', () => {
    const s = tiny.steps[0];
    expect(stepDuration(s, 2)).toBeLessThan(stepDuration(s, 1));
    expect(stepDuration(s, 0.5)).toBe(stepDuration(s, 1) * 2);
  });
  it('steps through the speed ladder', () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(4, 1)).toBe(4);
    expect(nextSpeed(1, -1)).toBe(0.5);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
  });
});

describe('library', () => {
  it('filters on title, question and tags; groups by category in a stable order', () => {
    expect(matchesFilter(ops, 'approve pending')).toBe(true);
    expect(matchesFilter(ops, 'zebra')).toBe(false);
    const groups = groupByCategory(baseModel.scenarios);
    expect(groups[0].category).toBe('money');
    expect(groups.flatMap((g) => g.items)).toHaveLength(baseModel.scenarios.length);
  });
});

describe('stage layout', () => {
  const steps = visibleSteps(ops, 'approve', 3);
  const parts = [...new Set(steps.flatMap((s) => [s.from, s.to]))];
  const groupOf = (id: string) => {
    const app = baseModel.appOf(id);
    return { id: app?.id ?? '?', label: app?.name ?? '?' };
  };
  it('is deterministic and places every participant once without overlap', () => {
    const a = stageLayout(steps, parts, groupOf, 1.5);
    const b = stageLayout(steps, parts, groupOf, 1.5);
    expect([...a.nodes.entries()]).toEqual([...b.nodes.entries()]);
    expect(a.nodes.size).toBe(parts.length);
    const boxes = [...a.nodes.values()];
    for (const n of boxes) for (const m of boxes) if (n !== m) expect(n.x + n.w <= m.x || m.x + m.w <= n.x || n.y + n.h <= m.y || m.y + m.h <= n.y).toBe(true);
  });
  it('wraps groups into rows for tall viewports', () => {
    const wide = stageLayout(steps, parts, groupOf, 4);
    const tall = stageLayout(steps, parts, groupOf, 0.6);
    expect(tall.height).toBeGreaterThan(wide.height);
  });
  it('draws curves (and loops) between nodes', () => {
    const n = { id: 'a', x: 0, y: 0, w: 100, h: 40, group: 'g' };
    const m = { id: 'b', x: 300, y: 100, w: 100, h: 40, group: 'g' };
    expect(edgeGeometry(n, m).d.startsWith('M 100 20 C')).toBe(true);
    expect(edgeGeometry(n, n).my).toBeLessThan(0);
  });
});

describe('editing', () => {
  it('customises a copy with a new id and keeps the original intact', () => {
    const copy = customizeCopy(ops);
    expect(copy.id).not.toBe(ops.id);
    expect(copy.custom).toBe(true);
    expect(copy.title).toContain('my version');
    copy.steps[0].title = 'changed';
    expect(ops.steps[0].title).not.toBe('changed');
    expect(customizeCopy(copy).title).toContain('(copy)');
  });
  it('inserts, duplicates, deletes and reorders steps', () => {
    const s = newStep(tiny.steps[0], tiny.participants);
    let sc = insertStepAfter(tiny, 's1', s);
    expect(sc.steps[1].id).toBe(s.id);
    const dup = duplicateStep(sc, 's3');
    expect(dup.scenario.steps[dup.scenario.steps.findIndex((x) => x.id === 's3') + 1].id).toBe(dup.id);
    expect(dup.scenario.steps.find((x) => x.id === dup.id)?.decision).toBeUndefined();
    sc = deleteStep(sc, s.id);
    expect(sc.steps.map((x) => x.id)).toEqual(tiny.steps.map((x) => x.id));
    // In variant "no", s5 follows s3 (s4 is not in it): moving s5 up swaps it with s3.
    const moved = moveStep(tiny, 's5', -1, 'no');
    expect(variantSteps(moved, 'no').map((x) => x.id)).toEqual(['s1', 's2', 's5', 's3', 's6']);
    expect(moveStep(tiny, 's1', -1, 'yes')).toBe(tiny);
    expect(moveStepBefore(tiny, 's6', 's1').steps[0].id).toBe('s6');
    expect(moveStepBefore(tiny, 's1', null).steps.at(-1)?.id).toBe('s1');
  });
  it('adds participants when steps point at new entities and refuses to remove used ones', () => {
    const sc = updateStep(tiny, 's1', { to: 'd' });
    expect(sc.participants).toContain('d');
    expect(removeParticipant(sc, 'a')).toBe(sc);
    const extra = { ...sc, participants: [...sc.participants, 'unused'] };
    expect(removeParticipant(extra, 'unused').participants).not.toContain('unused');
  });
  it('validates payload JSON', () => {
    expect(parsePayload('')).toEqual({ ok: true, data: undefined });
    expect(parsePayload('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
    expect(parsePayload('{a:1}').ok).toBe(false);
  });
  it('builds blank scenarios and steps from the reusable library', () => {
    const blank = blankScenario('role:customer', 'customer');
    expect(blank.steps).toHaveLength(1);
    expect(blank.participants).toEqual(['role:customer', 'customer']);
    const r = reusableSteps(baseModel)[0];
    const step = stepFromReusable(r, 'ep:POST /api/transfers');
    expect(step).toMatchObject({ kind: r.kind, to: r.target, from: 'ep:POST /api/transfers' });
  });
  it('picks a sensible caller for reusable steps', () => {
    const kindOf = (id: string) => baseModel.entity(id)?.kind;
    const trace = resolveScenario('trace:ep:GET /api/accounts', baseModel, []).scenario!;
    // After the first (UI) step — a person on a page — the caller is the endpoint.
    expect(trace.steps[0].kind).toBe('ui');
    expect(reusableCaller(trace.steps[0], trace.participants, kindOf)).toBe('ep:GET /api/accounts');
    const guard = trace.steps.find((s) => s.kind === 'guard')!;
    expect(reusableCaller(guard, trace.participants, kindOf)).toBe(guard.to);
  });
  it('renames imports that collide', () => {
    expect(uniqueImportId(tiny, () => false).id).toBe('tiny');
    expect(uniqueImportId(tiny, (id) => id === 'tiny').id).not.toBe('tiny');
  });
});

describe('cross-mode', () => {
  it('sends participants in order and one numbered edge per step to the Studio', () => {
    const vis = visibleSteps(tiny, 'no', 2);
    const req = studioRequest(tiny, vis, 1);
    expect(req.layout).toBe('sequence');
    expect(req.source).toBe('theater');
    expect(req.entities).toEqual(['a', 'b']);
    expect(req.edges).toEqual([{ from: 'a', to: 'b', label: 'one', order: 1, hypothetical: undefined, kind: 'request' }]);
    const all = studioRequest(tiny, vis, null);
    expect(all.edges?.find((e) => e.label === 'no')?.hypothetical).toBe(true);
  });
  it('inserts break opportunities after path separators', () => {
    expect(breakable('a/b#c')).toBe('a/​b#​c');
  });
  it('replays effects the same way as the shared engine', () => {
    expect(stateAfter(tiny, 'yes', 's6').T[0].v).toBe(2);
  });
});
