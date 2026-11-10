/* eslint-disable react-refresh/only-export-components */
/** Visual vocabulary shared by every mode: one colour + icon per entity kind and relation channel. */
import {
  Activity,
  AppWindow,
  BookOpen,
  Box,
  Boxes,
  Braces,
  Cloud,
  Component,
  Database,
  FileCode2,
  FlaskConical,
  FunctionSquare,
  Globe,
  Layers,
  LayoutTemplate,
  Network,
  Radio,
  Route,
  Server,
  Sparkles,
  Table2,
  Tag,
  User,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Confidence, Entity, EntityKind, RelationChannel } from '@/model';
import { KIND_LABEL } from '@/model';
import { Badge, Tip } from './primitives';

export const KIND_COLOR: Record<EntityKind, string> = {
  system: 'var(--k-system)',
  app: 'var(--k-app)',
  package: 'var(--k-package)',
  datastore: 'var(--k-datastore)',
  subsystem: 'var(--k-subsystem)',
  module: 'var(--k-module)',
  'route-group': 'var(--k-route)',
  endpoint: 'var(--k-endpoint)',
  function: 'var(--k-function)',
  class: 'var(--k-function)',
  type: 'var(--k-type)',
  constant: 'var(--k-type)',
  'db-model': 'var(--k-db)',
  event: 'var(--k-event)',
  page: 'var(--k-page)',
  component: 'var(--k-page)',
  feature: 'var(--k-feature)',
  role: 'var(--k-role)',
  external: 'var(--k-external)',
  infra: 'var(--k-infra)',
  test: 'var(--k-test)',
  doc: 'var(--k-test)',
};

export const KIND_ICON: Record<EntityKind, LucideIcon> = {
  system: Globe,
  app: AppWindow,
  package: Boxes,
  datastore: Database,
  subsystem: Layers,
  module: FileCode2,
  'route-group': Route,
  endpoint: Network,
  function: FunctionSquare,
  class: Box,
  type: Braces,
  constant: Tag,
  'db-model': Table2,
  event: Radio,
  page: LayoutTemplate,
  component: Component,
  feature: Sparkles,
  role: User,
  external: Cloud,
  infra: Server,
  test: FlaskConical,
  doc: BookOpen,
};

export const CHANNEL_COLOR: Record<RelationChannel, string> = {
  http: 'var(--c-http)',
  realtime: 'var(--c-realtime)',
  call: 'var(--c-call)',
  data: 'var(--c-data)',
  type: 'var(--c-type)',
  security: 'var(--c-security)',
  ops: 'var(--c-ops)',
  structure: 'var(--c-structure)',
};

export const CHANNEL_ICON: Record<RelationChannel, LucideIcon> = {
  http: Network,
  realtime: Radio,
  call: Workflow,
  data: Database,
  type: Braces,
  security: Activity,
  ops: User,
  structure: FlaskConical,
};

/** Colour for an entity, honouring the hypothetical override. */
export function entityColor(e: Pick<Entity, 'kind' | 'confidence'>): string {
  return e.confidence === 'hypothetical' ? 'var(--k-hypo)' : KIND_COLOR[e.kind];
}

export function KindIcon({ kind, size = 14, className }: { kind: EntityKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} className={className} aria-hidden />;
}

export function KindBadge({ entity }: { entity: Pick<Entity, 'kind' | 'confidence'> }) {
  const color = entityColor(entity);
  return (
    <Badge color={color}>
      <KindIcon kind={entity.kind} size={11} />
      {KIND_LABEL[entity.kind]}
    </Badge>
  );
}

const CONFIDENCE: Record<Confidence, { label: string; color: string; description: string }> = {
  verified: { label: 'Verified', color: 'var(--conf-verified)', description: 'Read directly from the Meridian repository at the pinned commit.' },
  simplified: { label: 'Simplified', color: 'var(--conf-simplified)', description: 'A deliberate simplification of verified behaviour.' },
  inferred: { label: 'Inferred', color: 'var(--conf-inferred)', description: 'A reasonable reading that no single source line states outright.' },
  hypothetical: { label: 'Hypothetical', color: 'var(--conf-hypothetical)', description: 'Not in Meridian — a proposed or user-created addition.' },
};

export const CONFIDENCE_INFO = CONFIDENCE;

/** Provenance marker shown on every inspectable fact. */
export function ConfidenceBadge({ confidence = 'verified', compact }: { confidence?: Confidence; compact?: boolean }) {
  const c = CONFIDENCE[confidence];
  return (
    <Tip label={c.description} side="top">
      <span
        className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
        style={{ color: c.color, background: `color-mix(in srgb, ${c.color} 13%, transparent)`, border: confidence === 'hypothetical' ? `1px dashed ${c.color}` : undefined }}
        data-confidence={confidence}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
        {!compact && c.label}
      </span>
    </Tip>
  );
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--ok)',
  POST: 'var(--info)',
  PUT: 'var(--warn)',
  PATCH: 'var(--warn)',
  DELETE: 'var(--bad)',
};

export function MethodBadge({ method }: { method: string }) {
  const color = METHOD_COLOR[method] ?? 'var(--fg-muted)';
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 font-mono text-[10.5px] font-bold" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {method}
    </span>
  );
}

export function statusColor(status: number): string {
  if (status >= 500) return 'var(--bad)';
  if (status >= 400) return 'var(--warn)';
  if (status >= 300) return 'var(--info)';
  return 'var(--ok)';
}
