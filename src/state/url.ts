/**
 * Deep links. The location hash mirrors the meaningful view state:
 *
 *   #/atlas?sel=e:be:money/movements&x=meridian,backend&f=backend&aud=developer&d=4
 *   #/theater?s=transfer&v=insufficient-funds&i=5&view=sequence
 *   #/studio
 *
 * Hash routing keeps links working on static hosting (GitHub Pages) with no
 * server rewrite rules. Only navigational state goes in the URL — never
 * workspace content (boards, layers), which can be large or private.
 */
import { AUDIENCES, type AudienceId, type DetailLevel, type RelationChannel } from '@/model';
import type { AppData, ModeId, Selection, TheaterView } from './app';

const MODES: ModeId[] = ['atlas', 'theater', 'studio'];
const VIEWS: TheaterView[] = ['sequence', 'stage', 'timeline'];

export function encodeSelection(sel: Selection | null): string | null {
  if (!sel) return null;
  switch (sel.type) {
    case 'entity':
      return `e:${sel.id}`;
    case 'relation':
      return `r:${sel.id}`;
    case 'edge':
      return `g:${sel.a}|${sel.b}|${sel.channel}`;
    case 'machine':
      return `m:${sel.id}`;
    case 'term':
      return `t:${sel.term}`;
    case 'step':
      return `s:${sel.scenarioId}|${sel.stepId}`;
  }
}

export function decodeSelection(raw: string | null): Selection | null {
  if (!raw || raw.length < 3 || raw[1] !== ':') return null;
  const body = raw.slice(2);
  switch (raw[0]) {
    case 'e':
      return { type: 'entity', id: body };
    case 'r':
      return { type: 'relation', id: body };
    case 'g': {
      const [a, b, channel] = body.split('|');
      return a && b && channel ? { type: 'edge', a, b, channel: channel as RelationChannel } : null;
    }
    case 'm':
      return { type: 'machine', id: body };
    case 't':
      return { type: 'term', term: body };
    case 's': {
      const [scenarioId, stepId] = body.split('|');
      return scenarioId && stepId ? { type: 'step', scenarioId, stepId } : null;
    }
    default:
      return null;
  }
}

export interface UrlState {
  mode?: ModeId;
  selection?: Selection | null;
  audience?: AudienceId;
  detail?: DetailLevel;
  expanded?: string[];
  focus?: string | null;
  scenarioId?: string | null;
  variant?: string | null;
  stepIndex?: number;
  view?: TheaterView;
  layers?: string[];
}

export function parseHash(hash: string): UrlState {
  const clean = hash.replace(/^#\/?/, '');
  const [path, query = ''] = clean.split('?');
  const out: UrlState = {};
  if (MODES.includes(path as ModeId)) out.mode = path as ModeId;
  const p = new URLSearchParams(query);
  if (p.has('sel')) out.selection = decodeSelection(p.get('sel'));
  const aud = p.get('aud');
  if (aud && AUDIENCES.some((a) => a.id === aud)) out.audience = aud as AudienceId;
  const d = Number(p.get('d'));
  if (d >= 1 && d <= 5) out.detail = d as DetailLevel;
  if (p.has('x')) out.expanded = (p.get('x') ?? '').split(',').filter(Boolean);
  if (p.has('f')) out.focus = p.get('f') || null;
  if (p.has('s')) out.scenarioId = p.get('s') || null;
  if (p.has('v')) out.variant = p.get('v') || null;
  if (p.has('i')) out.stepIndex = Math.max(0, Number(p.get('i')) || 0);
  const view = p.get('view');
  if (view && VIEWS.includes(view as TheaterView)) out.view = view as TheaterView;
  if (p.has('layers')) out.layers = (p.get('layers') ?? '').split(',').filter(Boolean);
  return out;
}

export function buildHash(s: Pick<AppData, 'mode' | 'selection' | 'audience' | 'detail' | 'atlas' | 'theater'>, activeLayerIds: string[] = []): string {
  const p = new URLSearchParams();
  const sel = encodeSelection(s.selection);
  if (sel && s.selection?.type !== 'step') p.set('sel', sel);
  if (s.mode === 'atlas') {
    if (s.atlas.expanded.length) p.set('x', s.atlas.expanded.join(','));
    if (s.atlas.focus) p.set('f', s.atlas.focus);
  }
  if (s.mode === 'theater' && s.theater.scenarioId) {
    p.set('s', s.theater.scenarioId);
    if (s.theater.variant) p.set('v', s.theater.variant);
    if (s.theater.stepIndex) p.set('i', String(s.theater.stepIndex));
    if (s.theater.view !== 'sequence') p.set('view', s.theater.view);
  }
  p.set('aud', s.audience);
  p.set('d', String(s.detail));
  // Only the shipped example layers are addressable by link; user layers live in local storage.
  const shareable = activeLayerIds.filter((id) => id.startsWith('layer:'));
  if (shareable.length) p.set('layers', shareable.join(','));
  // Keep the hash readable: ids contain ':' '/' '#' which are safe inside a fragment.
  const query = p
    .toString()
    .replace(/%3A/g, ':')
    .replace(/%2F/g, '/')
    .replace(/%2C/g, ',')
    .replace(/%7C/g, '|');
  return `#/${s.mode}${query ? `?${query}` : ''}`;
}
