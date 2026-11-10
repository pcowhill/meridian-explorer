/**
 * Scenario Theater — pure logic (no React). Everything here is unit-tested in
 * logic.test.ts: scenario resolution, step marks, variant switching, playback
 * pacing, the paths overview, stage layout, editing operations and the
 * hand-off to the Studio.
 */
import {
  activeParticipants,
  type Confidence,
  stateAfter,
  variantSteps,
  visibleSteps,
  type DetailLevel,
  type Model,
  type ReusableStep,
  type Scenario,
  type ScenarioStep,
  type StateEffect,
  type StepKind,
  type WorldState,
} from '@/model';
import { assembleTrace } from '@/model';
import type { StudioImport } from '@/state/app';

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ScenarioSource = 'model' | 'custom' | 'trace' | 'draft';

export interface Resolved {
  scenario: Scenario | null;
  source: ScenarioSource | null;
  /** For `trace:` ids: the endpoint id asked for. */
  endpointId?: string;
}

export const TRACE_PREFIX = 'trace:';
/** Prefer line breaks after path separators rather than mid-word (inserts zero-width spaces). */
export const breakable = (name: string): string => name.replace(/([/#.:_])/g, '$1\u200b');

export const isTraceId = (id: string | null | undefined): boolean => !!id && id.startsWith(TRACE_PREFIX);

/**
 * Find the scenario a Theater id refers to: an unsaved draft first, then the
 * user's saved custom scenarios, then the model (incl. hypothetical layers),
 * then — for `trace:<endpoint id>` — an automatically assembled trace.
 */
export function resolveScenario(
  id: string | null | undefined,
  model: Model,
  custom: Scenario[],
  drafts: Record<string, Scenario> = {},
  /** A trace already assembled for this id (lets callers memoise assembly separately). */
  assembled?: Scenario | null,
): Resolved {
  if (!id) return { scenario: null, source: null };
  if (drafts[id]) return { scenario: drafts[id], source: 'draft' };
  const mine = custom.find((s) => s.id === id);
  if (mine) return { scenario: mine, source: 'custom' };
  const base = model.scenario(id);
  if (base) return { scenario: base, source: 'model' };
  if (isTraceId(id)) {
    const endpointId = id.slice(TRACE_PREFIX.length);
    const scenario = assembled !== undefined ? assembled : assembleTrace(model, endpointId);
    return { scenario, source: scenario ? 'trace' : null, endpointId };
  }
  return { scenario: null, source: null };
}

/** The variant actually shown: the requested one if it exists, else the default. */
export function effectiveVariant(scenario: Scenario, requested: string | null | undefined): string {
  if (requested && scenario.variants.some((v) => v.id === requested)) return requested;
  if (scenario.variants.some((v) => v.id === scenario.defaultVariant)) return scenario.defaultVariant;
  return scenario.variants[0]?.id ?? scenario.defaultVariant;
}

export const clampIndex = (index: number, length: number): number => (length <= 0 ? 0 : Math.max(0, Math.min(length - 1, Math.floor(index) || 0)));

// ---------------------------------------------------------------------------
// Step marks (decisions, database changes)
// ---------------------------------------------------------------------------

export const isDecision = (s: ScenarioStep): boolean => s.kind === 'decision' || !!s.decision;
export const isHypoStep = (s: ScenarioStep): boolean => !!s.hypothetical || s.confidence === 'hypothetical';

/**
 * The provenance shown for a step. In a user-made scenario a step with no
 * recorded confidence was written by the user, so it is not vouched for.
 */
export function stepConfidence(s: ScenarioStep, scenario: Scenario): Confidence {
  if (s.hypothetical) return 'hypothetical';
  if (s.confidence) return s.confidence;
  if (scenario.custom && !scenario.confidence) return 'hypothetical';
  return scenario.confidence ?? 'verified';
}

/** Imported scenarios: steps with no recorded provenance are treated as hypothetical. */
export function sanitiseImported(s: Scenario): Scenario {
  return { ...s, custom: true, steps: s.steps.map((st) => (st.confidence ? st : { ...st, confidence: 'hypothetical' as const })) };
}

export interface StepMark {
  decision: boolean;
  /** The step (or a hidden step folded into it) changes the example database. */
  db: boolean;
  /** Effects applied between the previous visible step and this one, inclusive. */
  effects: StateEffect[];
  /** How many hidden steps are folded into this one. */
  hiddenBefore: number;
  /** Tables touched by `effects`. */
  tables: string[];
}

/**
 * For each visible step: whether it is a decision point, and the database
 * effects that happen "at" it (its own plus any hidden steps since the previous
 * visible step — hiding a step never hides what it did).
 */
export function stepMarks(scenario: Scenario, variant: string, visible: ScenarioStep[]): StepMark[] {
  const all = variantSteps(scenario, variant);
  const pos = new Map(all.map((s, i) => [s.id, i]));
  let prev = -1;
  return visible.map((s) => {
    const at = pos.get(s.id) ?? prev + 1;
    const span = all.slice(prev + 1, at + 1);
    prev = at;
    const effects = span.flatMap((x) => x.effects ?? []);
    return {
      decision: isDecision(s),
      db: effects.length > 0 || s.kind === 'db-write',
      effects,
      hiddenBefore: Math.max(0, span.length - 1),
      tables: [...new Set(effects.map((e) => e.table))],
    };
  });
}

/** Next (dir = 1) or previous (dir = -1) index that is a decision or changes the database. */
export function nextInteresting(marks: StepMark[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < marks.length; i += dir) if (marks[i].decision || marks[i].db) return i;
  return from;
}

/**
 * The example database before and after a visible step, where "before" is the
 * state after the previous VISIBLE step (so hidden steps' effects show up at
 * the next visible one).
 */
export function statesAround(scenario: Scenario, variant: string, visible: ScenarioStep[], index: number): { start: WorldState; before: WorldState; after: WorldState } {
  const start = stateAfter(scenario, variant, null);
  const step = visible[index];
  if (!step) return { start, before: start, after: start };
  const before = index > 0 ? stateAfter(scenario, variant, visible[index - 1].id) : start;
  const after = stateAfter(scenario, variant, step.id);
  return { start, before, after };
}

/**
 * After the visible list changed (detail level, edits): the index of the step
 * that was current, or — if it is now hidden — of the nearest visible step
 * before it. Null when the step is not in this variant at all.
 */
export function followStep(scenario: Scenario, variant: string, visible: ScenarioStep[], stepId: string): number | null {
  const direct = visible.findIndex((s) => s.id === stepId);
  if (direct >= 0) return direct;
  const all = variantSteps(scenario, variant);
  const at = all.findIndex((s) => s.id === stepId);
  if (at < 0) return null;
  const shown = new Map(visible.map((s, i) => [s.id, i]));
  for (let i = at - 1; i >= 0; i--) {
    const j = shown.get(all[i].id);
    if (j !== undefined) return j;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/**
 * Where the presenter lands after switching variant: the same step if it is
 * also in the new variant, otherwise the last shared step before the
 * divergence, otherwise the start.
 */
export function mapIndexOnVariantChange(scenario: Scenario, from: string, to: string, detail: DetailLevel, index: number): number {
  const oldSteps = visibleSteps(scenario, from, detail);
  const newSteps = visibleSteps(scenario, to, detail);
  const newPos = new Map(newSteps.map((s, i) => [s.id, i]));
  for (let i = Math.min(index, oldSteps.length - 1); i >= 0; i--) {
    const j = newPos.get(oldSteps[i].id);
    if (j !== undefined) return j;
  }
  return 0;
}

export interface PathRow {
  variant: string;
  /** One cell per visible step of this variant: shared with the main path, or specific. */
  cells: { id: string; shared: boolean; hypothetical: boolean }[];
  /** Index of the first step that leaves the main path (-1 if none). */
  divergesAt: number;
}

/**
 * Where each outcome leaves the main path (the default variant). For the
 * main path itself, a step counts as shared when any other outcome has it too.
 */
export function pathsOverview(scenario: Scenario, detail: DetailLevel): PathRow[] {
  const per = scenario.variants.map((v) => ({ v, steps: visibleSteps(scenario, v.id, detail) }));
  const main = new Set(visibleSteps(scenario, scenario.defaultVariant, detail).map((s) => s.id));
  const others = new Map<string, number>();
  for (const p of per) if (p.v.id !== scenario.defaultVariant) for (const s of p.steps) others.set(s.id, (others.get(s.id) ?? 0) + 1);
  return per.map(({ v, steps }) => {
    const isMain = v.id === scenario.defaultVariant;
    const cells = steps.map((s) => ({ id: s.id, shared: isMain ? others.has(s.id) : main.has(s.id), hypothetical: isHypoStep(s) || !!v.hypothetical }));
    return { variant: v.id, cells, divergesAt: cells.findIndex((c) => !c.shared) };
  });
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export const SPEEDS = [0.5, 1, 2, 4] as const;

/** How long a step stays current while playing, in ms (scaled by speed). */
export function stepDuration(step: ScenarioStep, speed: number, narrativeLength = step.narrative.length): number {
  const base = step.kind === 'note' || step.kind === 'state' ? 2000 : 1400;
  const reading = Math.min(2200, narrativeLength * 8);
  const extra = step.kind === 'decision' ? 800 : step.effects?.length ? 600 : 0;
  return Math.round((base + reading + extra) / Math.max(0.25, speed));
}

export function nextSpeed(speed: number, dir: 1 | -1): number {
  const i = SPEEDS.findIndex((s) => s >= speed - 1e-9);
  const cur = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, cur + dir))];
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const CATEGORY_LABEL: Record<Scenario['category'], string> = {
  money: 'Money movement',
  operations: 'Operations',
  data: 'Data & balances',
  security: 'Security & access',
  risk: 'Cards & risk',
  time: 'Time & scheduling',
  realtime: 'Real-time',
  integration: 'Integration',
  onboarding: 'Onboarding',
  custom: 'Custom',
};

const CATEGORY_ORDER: Scenario['category'][] = ['money', 'data', 'operations', 'security', 'risk', 'onboarding', 'time', 'realtime', 'integration', 'custom'];

export function matchesFilter(s: Scenario, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = [s.title, s.question, s.summary, s.category, ...(s.tags ?? [])].join(' ').toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}

export function groupByCategory(scenarios: Scenario[]): { category: Scenario['category']; label: string; items: Scenario[] }[] {
  const groups = new Map<Scenario['category'], Scenario[]>();
  for (const s of scenarios) {
    const list = groups.get(s.category) ?? [];
    list.push(s);
    groups.set(s.category, list);
  }
  return [...groups.entries()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
    .map(([category, items]) => ({ category, label: CATEGORY_LABEL[category] ?? category, items }));
}

export const isHypoScenario = (s: Scenario): boolean => s.confidence === 'hypothetical';
export const hasHypoVariant = (s: Scenario): boolean => s.variants.some((v) => v.hypothetical) || s.steps.some(isHypoStep);

// ---------------------------------------------------------------------------
// Stage layout (deterministic: depends only on the visible steps, never on the current index)
// ---------------------------------------------------------------------------

export const NODE_W = 172;
export const NODE_H = 46;
const NODE_GAP = 14;
const GROUP_PAD = 12;
const GROUP_HEAD = 26;
const GROUP_GAP = 70;
const ROW_GAP = 64;

export interface StageNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  group: string;
}
export interface StageGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface StageLayout {
  nodes: Map<string, StageNode>;
  groups: StageGroup[];
  width: number;
  height: number;
}

/**
 * Participants grouped by their application/container. Groups are placed in
 * the order their first participant appears in the scenario's participant
 * list (the lane order: who starts it first), left → right, wrapping onto
 * further rows only when one row would have to shrink too much to fit the
 * viewport. Nodes inside a group keep participant order. Depends only on the
 * steps, participants and (quantised) viewport — never on the current step.
 */
export function stageLayout(
  steps: ScenarioStep[],
  participants: string[],
  groupOf: (id: string) => { id: string; label: string },
  viewport: { width: number; height: number } = { width: 1200, height: 700 },
): StageLayout {
  const order: string[] = [];
  const used = new Set(steps.flatMap((s) => [s.from, s.to]));
  for (const p of participants) if (!order.includes(p) && (used.size === 0 || used.has(p))) order.push(p);
  for (const s of steps) for (const id of [s.from, s.to]) if (!order.includes(id)) order.push(id);
  const groups = new Map<string, { label: string; ids: string[] }>();
  for (const id of order) {
    const g = groupOf(id);
    const entry = groups.get(g.id) ?? { label: g.label, ids: [] };
    entry.ids.push(id);
    groups.set(g.id, entry);
  }
  const list = [...groups.entries()].map(([id, g]) => ({ id, ...g, w: NODE_W + GROUP_PAD * 2, h: GROUP_HEAD + g.ids.length * NODE_H + (g.ids.length - 1) * NODE_GAP + GROUP_PAD }));

  const arrange = (rows: number) => {
    const perRow = Math.ceil(list.length / rows);
    const chunks: (typeof list)[] = [];
    for (let i = 0; i < list.length; i += perRow) chunks.push(list.slice(i, i + perRow));
    const widths = chunks.map((c) => c.reduce((a, g) => a + g.w, 0) + (c.length - 1) * GROUP_GAP);
    const heights = chunks.map((c) => Math.max(...c.map((g) => g.h)));
    const W = Math.max(0, ...widths);
    const H = heights.reduce((a, b) => a + b, 0) + (chunks.length - 1) * ROW_GAP;
    return { chunks, heights, W, H, scale: Math.min(viewport.width / Math.max(1, W), viewport.height / Math.max(1, H)) };
  };
  // Fewest rows that still show the stage at a readable size.
  let best = arrange(1);
  if (best.scale < 0.8) {
    for (let r = 2; r <= Math.min(4, list.length); r++) {
      const a = arrange(r);
      if (a.scale > best.scale) best = a;
      if (a.scale >= 0.8) break;
    }
  }

  const nodes = new Map<string, StageNode>();
  const out: StageGroup[] = [];
  let y0 = 0;
  best.chunks.forEach((chunk, ri) => {
    const rowH = best.heights[ri];
    let x = 0;
    for (const g of chunk) {
      const y = y0 + Math.round((rowH - g.h) / 2);
      out.push({ id: g.id, label: g.label, x, y, w: g.w, h: g.h });
      g.ids.forEach((id, i) => nodes.set(id, { id, x: x + GROUP_PAD, y: y + GROUP_HEAD + i * (NODE_H + NODE_GAP), w: NODE_W, h: NODE_H, group: g.id }));
      x += g.w + GROUP_GAP;
    }
    y0 += rowH + ROW_GAP;
  });
  return { nodes, groups: out, width: best.W, height: best.H };
}

/** SVG path between two stage nodes (or a loop for a self-step) and its midpoint. */
export function edgeGeometry(a: StageNode, b: StageNode, lane = 0): { d: string; mx: number; my: number } {
  if (a.id === b.id) {
    const x = a.x + a.w - 30;
    const y = a.y;
    return { d: `M ${x} ${y} C ${x - 4} ${y - 34}, ${x + 34} ${y - 34}, ${x + 26} ${y}`, mx: x + 14, my: y - 26 };
  }
  const off = lane * 8;
  const cubic = (x1: number, y1: number, c1x: number, c1y: number, c2x: number, c2y: number, x2: number, y2: number) => ({
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    mx: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    my: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
  });
  if (Math.abs(a.x - b.x) < 1) {
    // Same column (same group): a short arc out to the right.
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2 + off;
    const x2 = b.x + b.w;
    const y2 = b.y + b.h / 2 + off;
    const bulge = 30 + Math.min(40, Math.abs(y2 - y1) * 0.15) + Math.max(0, lane) * 10;
    return cubic(x1, y1, x1 + bulge, y1, x2 + bulge, y2, x2, y2);
  }
  const gap = b.x > a.x + a.w ? b.x - (a.x + a.w) : a.x > b.x + b.w ? a.x - (b.x + b.w) : -1;
  if (gap < 24) {
    // Columns overlap (different rows): connect bottom ↔ top, nearly straight.
    const down = b.y > a.y;
    const x1 = a.x + a.w / 2 + off;
    const x2 = b.x + b.w / 2 + off;
    const y1 = down ? a.y + a.h : a.y;
    const y2 = down ? b.y : b.y + b.h;
    const dy = Math.min(50, Math.abs(y2 - y1) * 0.35) * (down ? 1 : -1);
    return cubic(x1, y1, x1, y1 + dy, x2, y2 - dy, x2, y2);
  }
  // Side to side, with short horizontal tangents so long hops stay close to straight.
  const forward = b.x > a.x;
  const x1 = forward ? a.x + a.w : a.x;
  const x2 = forward ? b.x : b.x + b.w;
  const y1 = a.y + a.h / 2 + off;
  const y2 = b.y + b.h / 2 + off;
  const dx = Math.min(56, gap * 0.35) * (forward ? 1 : -1);
  return cubic(x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2);
}

/**
 * Where to put an edge label of the given size near (mx, my) so that it does
 * not cover a node: the midpoint if free, else the nearest free spot above or
 * below it.
 */
export function placeLabel(mx: number, my: number, w: number, h: number, nodes: Iterable<StageNode>): { x: number; y: number } {
  const boxes = [...nodes];
  const free = (x: number, y: number) =>
    boxes.every((n) => x + w / 2 < n.x - 4 || x - w / 2 > n.x + n.w + 4 || y + h / 2 < n.y - 4 || y - h / 2 > n.y + n.h + 4);
  for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const y = my + d * (h + 6);
    if (free(mx, y)) return { x: mx, y };
  }
  for (const dx of [-1, 1]) {
    const x = mx + dx * (w / 2 + 40);
    if (free(x, my)) return { x, y: my };
  }
  return { x: mx, y: my };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const rand = () => Math.random().toString(36).slice(2, 7);
export const newStepId = (): string => `s-${Date.now().toString(36)}${rand()}`;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'scenario';

export const COPY_TAG = 'copy-of:';

/** The user's existing editable copy of a scenario (saved or still a draft), if any. */
export function findCopy(sourceId: string, candidates: Scenario[]): Scenario | undefined {
  return candidates.find((s) => s.tags?.includes(`${COPY_TAG}${sourceId}`));
}

/** The scenario a copy was made from. */
export const copiedFrom = (s: Scenario): string | undefined => s.tags?.find((t) => t.startsWith(COPY_TAG))?.slice(COPY_TAG.length);

/** An editable copy of any scenario (built-in, assembled or custom). */
export function customizeCopy(source: Scenario, alreadyMine = !!source.custom): Scenario {
  const copy = structuredClone(source);
  // Pin each step's provenance so it survives in the copy (where a missing value means "user-made").
  copy.steps = copy.steps.map((st) => ({ ...st, confidence: st.confidence ?? source.confidence ?? 'verified' }));
  return {
    ...copy,
    id: `custom:${slug(source.title)}-${Date.now().toString(36)}${rand()}`,
    title: alreadyMine ? `${source.title} (copy)` : `${source.title} — my version`,
    custom: true,
    confidence: source.confidence === 'hypothetical' ? 'hypothetical' : copy.confidence,
    related: copy.related ?? [],
    tags: [...(copy.tags ?? []).filter((t) => !t.startsWith(COPY_TAG)), `${COPY_TAG}${source.id}`],
  };
}

/** A minimal scenario to improvise with: two participants and one step. */
export function blankScenario(a: string, b: string): Scenario {
  return {
    id: `custom:blank-${Date.now().toString(36)}${rand()}`,
    title: 'New scenario',
    question: 'What happens when…?',
    summary: 'A scenario sketched from scratch.',
    category: 'custom',
    participants: [a, b],
    related: [],
    variants: [{ id: 'main', label: 'Main path', outcome: 'info' }],
    defaultVariant: 'main',
    steps: [{ id: newStepId(), kind: 'request', title: 'First step', from: a, to: b, label: 'does something', narrative: 'Describe what happens here.', detail: 1, hypothetical: true }],
    custom: true,
  };
}

export function withParticipant(s: Scenario, id: string): Scenario {
  return s.participants.includes(id) ? s : { ...s, participants: [...s.participants, id] };
}

export function removeParticipant(s: Scenario, id: string): Scenario {
  if (s.steps.some((st) => st.from === id || st.to === id)) return s;
  return { ...s, participants: s.participants.filter((p) => p !== id) };
}

export function moveParticipant(s: Scenario, id: string, dir: 1 | -1): Scenario {
  const i = s.participants.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.participants.length) return s;
  const participants = [...s.participants];
  [participants[i], participants[j]] = [participants[j], participants[i]];
  return { ...s, participants };
}

export function updateStep(s: Scenario, stepId: string, patch: Partial<ScenarioStep>): Scenario {
  let next: Scenario = { ...s, steps: s.steps.map((st) => (st.id === stepId ? { ...st, ...patch, id: st.id } : st)) };
  if (patch.from) next = withParticipant(next, patch.from);
  if (patch.to) next = withParticipant(next, patch.to);
  return next;
}

export function deleteStep(s: Scenario, stepId: string): Scenario {
  return { ...s, steps: s.steps.filter((st) => st.id !== stepId) };
}

/** Insert `step` right after `afterId` in the full step list (first when null, last when not found). */
export function insertStepAfter(s: Scenario, afterId: string | null, step: ScenarioStep): Scenario {
  const steps = [...s.steps];
  const i = afterId ? steps.findIndex((st) => st.id === afterId) : -1;
  if (i < 0 && afterId !== null) steps.push(step);
  else steps.splice(i + 1, 0, step);
  return withParticipant(withParticipant({ ...s, steps }, step.from), step.to);
}

export function duplicateStep(s: Scenario, stepId: string): { scenario: Scenario; id: string } {
  const src = s.steps.find((st) => st.id === stepId);
  if (!src) return { scenario: s, id: stepId };
  const copy: ScenarioStep = { ...structuredClone(src), id: newStepId(), title: `${src.title} (copy)` };
  delete copy.decision;
  if (copy.kind === 'decision') copy.kind = 'note';
  return { scenario: insertStepAfter(s, stepId, copy), id: copy.id };
}

/**
 * Move a step one place up/down among the steps of `variant` (the order the
 * presenter sees), by swapping it with its neighbour in the full list.
 */
export function moveStep(s: Scenario, stepId: string, dir: 1 | -1, variant: string): Scenario {
  const inVariant = variantSteps(s, variant);
  const i = inVariant.findIndex((st) => st.id === stepId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= inVariant.length) return s;
  const a = s.steps.findIndex((st) => st.id === stepId);
  const b = s.steps.findIndex((st) => st.id === inVariant[j].id);
  const steps = [...s.steps];
  [steps[a], steps[b]] = [steps[b], steps[a]];
  return { ...s, steps };
}

/** Move a step so it sits directly before `beforeId` (or last when null). Used by drag-and-drop. */
export function moveStepBefore(s: Scenario, stepId: string, beforeId: string | null): Scenario {
  if (stepId === beforeId) return s;
  const step = s.steps.find((st) => st.id === stepId);
  if (!step) return s;
  const rest = s.steps.filter((st) => st.id !== stepId);
  const i = beforeId ? rest.findIndex((st) => st.id === beforeId) : -1;
  if (i < 0) rest.push(step);
  else rest.splice(i, 0, step);
  return { ...s, steps: rest };
}

/**
 * Who performs a reusable step inserted after `after`: the component acting
 * in the current step, unless that is a person, a screen or a table — then the
 * nearest endpoint/server-side participant.
 */
export function reusableCaller(after: ScenarioStep | undefined, participants: string[], kindOf: (id: string) => string | undefined): string {
  const passive = new Set(['role', 'page', 'component', 'db-model', 'datastore', 'event', 'type', 'external']);
  if (after) {
    if (!passive.has(kindOf(after.to) ?? '')) return after.to;
    if (!passive.has(kindOf(after.from) ?? '') && kindOf(after.from)) return after.from;
  }
  return participants.find((p) => kindOf(p) === 'endpoint') ?? after?.to ?? participants[0] ?? '';
}

/** A ready-made step from the reusable-step library. */
export function stepFromReusable(r: ReusableStep, from: string): ScenarioStep {
  return {
    id: newStepId(),
    kind: r.kind,
    title: r.label,
    from,
    to: r.target,
    label: r.label,
    narrative: r.detail ?? r.label,
    detail: 1,
    sources: r.flow.source ? [r.flow.source] : undefined,
    confidence: r.flow.confidence,
  };
}

/** A new hand-written step after the current one. */
export function newStep(after: ScenarioStep | undefined, participants: string[]): ScenarioStep {
  const from = after?.to ?? participants[0] ?? '';
  const to = after?.from && after.from !== from ? after.from : (participants.find((p) => p !== from) ?? from);
  return { id: newStepId(), kind: 'call', title: 'New step', from, to, label: 'new step', narrative: 'Describe what happens here.', detail: 1, hypothetical: true, variants: after?.variants };
}

/** Parse payload JSON typed by the presenter. Empty text clears the payload. */
export function parsePayload(text: string): { ok: true; data: unknown | undefined } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, data: undefined };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** Give an imported scenario an id that does not collide with anything already known. */
export function uniqueImportId(s: Scenario, taken: (id: string) => boolean): Scenario {
  if (!taken(s.id)) return s;
  return { ...s, id: `custom:${slug(s.title)}-${Date.now().toString(36)}${rand()}` };
}

// ---------------------------------------------------------------------------
// Cross-mode
// ---------------------------------------------------------------------------

/** What "Send to Studio" asks the Studio to draw: the participants in lane order and one edge per step. */
export function studioRequest(scenario: Scenario, steps: ScenarioStep[], uptoIndex: number | null): Omit<StudioImport, 'id'> {
  const shown = uptoIndex === null ? steps : steps.slice(0, uptoIndex + 1);
  const entities = activeParticipants(scenario, shown);
  const edges = shown
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.from !== s.to)
    .map(({ s, i }) => ({ from: s.from, to: s.to, label: s.label, order: i + 1, hypothetical: isHypoStep(s) || undefined, kind: s.kind }));
  return {
    title: uptoIndex === null ? scenario.title : `${scenario.title} — first ${shown.length} step${shown.length === 1 ? '' : 's'}`,
    source: 'theater',
    entities,
    edges,
    layout: 'sequence',
  };
}

export const STEP_KINDS: StepKind[] = ['ui', 'client', 'request', 'response', 'guard', 'validate', 'call', 'decision', 'db-read', 'db-write', 'event', 'state', 'note'];
