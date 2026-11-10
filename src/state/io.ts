/**
 * Portable export / import of user-created content. Imports are validated with
 * zod and then sanitised: anything inside a layer is forced to `hypothetical`,
 * built-in flags are dropped, and relations whose endpoints do not exist are
 * discarded with a warning — an imported file can never masquerade as
 * repository-verified Meridian content.
 */
import { z } from 'zod';
import { baseModel, REPO, type HypotheticalLayer, type Scenario } from '@/model';
import { WORKSPACE_VERSION, initialWorkspace, type StudioBoard, type WorkspaceData } from './workspace';

const sourceRef = z.looseObject({ file: z.string(), start: z.number().optional(), end: z.number().optional(), symbol: z.string().optional(), note: z.string().optional() });

const entity = z.looseObject({
  id: z.string().min(1).max(200),
  kind: z.string().min(1),
  name: z.string().min(1).max(200),
  parent: z.string().optional(),
  summary: z.string().max(2000),
  description: z.string().max(8000).optional(),
  sources: z.array(sourceRef).optional(),
});

const relation = z.looseObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().max(300).optional(),
  summary: z.string().max(2000).optional(),
});

const step = z.looseObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string(),
  narrative: z.string(),
});

const scenario = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  question: z.string(),
  summary: z.string(),
  category: z.string(),
  participants: z.array(z.string()),
  related: z.array(z.string()),
  variants: z.array(z.looseObject({ id: z.string(), label: z.string() })).min(1),
  defaultVariant: z.string(),
  steps: z.array(step),
});

const contract = z.looseObject({
  id: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  summary: z.string(),
  auth: z.looseObject({ required: z.boolean() }),
  responses: z.array(z.looseObject({ status: z.number(), description: z.string() })),
  flow: z.array(z.looseObject({ kind: z.string(), label: z.string() })),
  mutates: z.boolean(),
  sources: z.array(sourceRef),
});

const layer = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(4000),
  entities: z.array(entity),
  relations: z.array(relation),
  contracts: z.array(contract).default([]),
  modifications: z.array(z.looseObject({ id: z.string(), target: z.string(), op: z.enum(['add-field', 'change', 'remove']), summary: z.string() })).default([]),
  scenarios: z.array(scenario).default([]),
});

const node = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()),
});
const edge = z.looseObject({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1) });

const board = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  nodes: z.array(node),
  edges: z.array(edge),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const template = z.looseObject({ id: z.string().min(1), name: z.string().min(1), nodes: z.array(node), edges: z.array(edge), createdAt: z.string() });

const view = z.looseObject({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  mode: z.enum(['atlas', 'theater', 'studio']),
  selection: z.unknown().nullable(),
  createdAt: z.string(),
});

const evaluation = z.looseObject({
  ratings: z.record(z.string(), z.number().min(0).max(5)).default({}),
  notes: z.record(z.string(), z.string().max(10000)).default({}),
  timings: z.record(z.string(), z.number()).default({}),
  overall: z.string().max(20000).default(''),
  preferred: z.enum(['', 'atlas', 'theater', 'studio']).default(''),
});

const workspace = z.looseObject({
  layers: z.array(layer).default([]),
  activeLayerIds: z.array(z.string()).default([]),
  views: z.array(view).default([]),
  starred: z.array(z.string()).default([]),
  customScenarios: z.array(scenario).default([]),
  boards: z.array(board).default([]),
  activeBoardId: z.string().nullable().default(null),
  templates: z.array(template).default([]),
  evaluation: evaluation.optional(),
});

const envelope = z.object({
  app: z.literal('meridian-explorer'),
  kind: z.enum(['workspace', 'board', 'scenario', 'layer']),
  version: z.number(),
  exportedAt: z.string().optional(),
  meridianSha: z.string().optional(),
  payload: z.unknown(),
});

export type ExportKind = z.infer<typeof envelope>['kind'];

export function makeExport(kind: ExportKind, payload: unknown): string {
  return JSON.stringify({ app: 'meridian-explorer', kind, version: WORKSPACE_VERSION, exportedAt: new Date().toISOString(), meridianSha: REPO.sha, payload }, null, 2);
}

export function exportWorkspace(data: WorkspaceData): string {
  const { layers, activeLayerIds, views, starred, customScenarios, boards, activeBoardId, templates, evaluation } = data;
  // Shipped example layers are part of the app, not the user's content.
  return makeExport('workspace', { layers: layers.filter((l) => !l.builtIn), activeLayerIds, views, starred, customScenarios, boards, activeBoardId, templates, evaluation });
}

export type ImportResult =
  | { ok: true; kind: 'workspace'; data: WorkspaceData; warnings: string[] }
  | { ok: true; kind: 'board'; data: StudioBoard; warnings: string[] }
  | { ok: true; kind: 'scenario'; data: Scenario; warnings: string[] }
  | { ok: true; kind: 'layer'; data: HypotheticalLayer; warnings: string[] }
  | { ok: false; errors: string[] };

const issues = (error: z.ZodError): string[] => error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

function sanitiseLayer(raw: z.infer<typeof layer>, warnings: string[]): HypotheticalLayer {
  const l = raw as unknown as HypotheticalLayer;
  const ids = new Set(l.entities.map((e) => e.id));
  const exists = (id: string) => ids.has(id) || baseModel.has(id);
  const entities = l.entities
    .filter((e) => {
      if (baseModel.has(e.id)) {
        warnings.push(`Layer "${l.name}": entity "${e.id}" collides with a real Meridian entity and was skipped.`);
        return false;
      }
      return true;
    })
    .map((e) => ({ ...e, confidence: 'hypothetical' as const, parent: e.parent && exists(e.parent) ? e.parent : 'meridian' }));
  const relations = l.relations
    .filter((r) => {
      const ok = exists(r.from) && exists(r.to) && r.from !== r.to;
      if (!ok) warnings.push(`Layer "${l.name}": relation "${r.id}" points at something that does not exist and was dropped.`);
      return ok;
    })
    .map((r) => ({ ...r, confidence: 'hypothetical' as const }));
  return {
    ...l,
    builtIn: false,
    entities,
    relations,
    contracts: (l.contracts ?? []).map((c) => ({ ...c, confidence: 'hypothetical' as const })),
    modifications: l.modifications ?? [],
    scenarios: (l.scenarios ?? []).map((s) => ({ ...s, confidence: 'hypothetical' as const })),
  };
}

/** Parse and validate an exported file. Never throws. */
export function parseImport(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  const env = envelope.safeParse(json);
  if (!env.success) return { ok: false, errors: ['This is not a Meridian Explorer export.', ...issues(env.error)] };
  if (env.data.version > WORKSPACE_VERSION) return { ok: false, errors: [`The file was written by a newer version (v${env.data.version}); this build reads up to v${WORKSPACE_VERSION}.`] };

  const warnings: string[] = [];
  if (env.data.meridianSha && env.data.meridianSha !== REPO.sha) {
    warnings.push(`Exported against Meridian ${env.data.meridianSha.slice(0, 7)}; this build models ${REPO.sha.slice(0, 7)}. References may have moved.`);
  }

  switch (env.data.kind) {
    case 'workspace': {
      const r = workspace.safeParse(env.data.payload);
      if (!r.success) return { ok: false, errors: issues(r.error) };
      const base = initialWorkspace();
      const userLayers = r.data.layers.filter((l) => !(l as { builtIn?: boolean }).builtIn).map((l) => sanitiseLayer(l, warnings));
      const layerIds = new Set([...base.layers, ...userLayers].map((l) => l.id));
      const data: WorkspaceData = {
        ...base,
        layers: [...base.layers, ...userLayers],
        activeLayerIds: r.data.activeLayerIds.filter((id) => layerIds.has(id)),
        views: r.data.views as unknown as WorkspaceData['views'],
        starred: r.data.starred,
        customScenarios: (r.data.customScenarios as unknown as Scenario[]).map((s) => ({ ...s, custom: true })),
        boards: r.data.boards as unknown as StudioBoard[],
        activeBoardId: r.data.boards.some((b) => b.id === r.data.activeBoardId) ? r.data.activeBoardId : null,
        templates: r.data.templates as unknown as WorkspaceData['templates'],
        evaluation: { ...base.evaluation, ...(r.data.evaluation ?? {}) } as WorkspaceData['evaluation'],
        tourSeen: true,
      };
      return { ok: true, kind: 'workspace', data, warnings };
    }
    case 'board': {
      const r = board.safeParse(env.data.payload);
      if (!r.success) return { ok: false, errors: issues(r.error) };
      return { ok: true, kind: 'board', data: r.data as unknown as StudioBoard, warnings };
    }
    case 'scenario': {
      const r = scenario.safeParse(env.data.payload);
      if (!r.success) return { ok: false, errors: issues(r.error) };
      return { ok: true, kind: 'scenario', data: { ...(r.data as unknown as Scenario), custom: true }, warnings };
    }
    case 'layer': {
      const r = layer.safeParse(env.data.payload);
      if (!r.success) return { ok: false, errors: issues(r.error) };
      return { ok: true, kind: 'layer', data: sanitiseLayer(r.data, warnings), warnings };
    }
  }
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the chosen file's text (or null if cancelled). */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
