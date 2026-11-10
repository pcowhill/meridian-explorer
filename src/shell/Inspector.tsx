/**
 * The shared inspector. Whatever is selected in any mode — a component, a
 * relationship, an aggregated edge, a state machine, a scenario step — is
 * explained here with the same structure: what it is, its contract or data
 * shape, the code behind it, what it relates to, the workflows it takes part
 * in, and what a change to it would affect.
 */
import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  GitBranch,
  Map as MapIcon,
  PanelRightClose,
  PenTool,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  CHANNELS,
  channelOf,
  githubUrl,
  KIND_LABEL,
  RELATION_VERB,
  REPO,
  type Entity,
  type Model,
  type Relation,
  type RelationChannel,
} from '@/model';
import { useApp, type InspectorTab, type Selection } from '@/state/app';
import { useModel, useScenarios } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { Badge, Button, cn, Empty, IconButton, Prose, renderInline, SectionTitle, Tabs, Tip } from '@/ui/primitives';
import { CHANNEL_COLOR, ConfidenceBadge, entityColor, KindBadge, KindIcon, MethodBadge } from '@/ui/kinds';
import { EntityChip, FieldTable } from '@/viewers/Fields';
import { JsonView } from '@/viewers/JsonView';
import { SourceList } from '@/viewers/CodeBlock';
import { ContractView } from '@/viewers/ContractView';
import { StateMachineView } from '@/viewers/StateMachineView';
import { BalanceCalculator } from '@/viewers/BalanceCalculator';
import { STEP_COLOR, STEP_LABEL } from '@/viewers/SequenceDiagram';
import { ProposeChange } from './ProposeChange';

const Paragraphs = Prose;

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

function Breadcrumb({ model, entity }: { model: Model; entity: Entity }) {
  const selectEntity = useApp((s) => s.selectEntity);
  const path = model.ancestors(entity.id);
  if (!path.length) return null;
  return (
    <nav aria-label="Location" className="flex flex-wrap items-center gap-0.5 text-[11px] text-fg-subtle">
      {path.map((p, i) => (
        <span key={p.id} className="inline-flex items-center gap-0.5">
          {i > 0 && <ChevronRight size={10} />}
          <button type="button" className="rounded px-0.5 hover:bg-surface-2 hover:text-fg" onClick={() => selectEntity(p.id)}>
            {p.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function liveUrlFor(model: Model, e: Entity): string | null {
  if (!e.route || e.route.includes(':') || e.route === '*') return null;
  const app = model.appOf(e.id);
  if (app?.id === 'customer') return `${REPO.live.customer}${e.route}`;
  if (app?.id === 'operations') return `${REPO.live.operations}${e.route}`;
  return null;
}

function EntityActions({ model, entity }: { model: Model; entity: Entity }) {
  const mode = useApp((s) => s.mode);
  const openInAtlas = useApp((s) => s.openInAtlas);
  const openInTheater = useApp((s) => s.openInTheater);
  const sendToStudio = useApp((s) => s.sendToStudio);
  const setTab = useApp((s) => s.setInspectorTab);
  const scenarios = useRelatedScenarios(entity.id);
  const live = liveUrlFor(model, entity);
  const appLive = entity.id === 'customer' ? REPO.live.customer : entity.id === 'operations' ? REPO.live.operations : null;
  const isFeature = entity.kind === 'feature';
  return (
    <div className="contents" data-testid="entity-actions">
      {mode !== 'atlas' && !isFeature && (
        <Button size="sm" icon={<MapIcon size={12} />} onClick={() => openInAtlas(entity.id)}>
          Show in Atlas
        </Button>
      )}
      {scenarios.length > 0 && (
        <Button size="sm" icon={<Clapperboard size={12} />} onClick={() => (scenarios.length === 1 ? openInTheater(scenarios[0].id) : setTab('workflows'))} title={scenarios.length === 1 ? scenarios[0].title : undefined}>
          {scenarios.length === 1 ? 'Play workflow' : `Workflows (${scenarios.length})`}
        </Button>
      )}
      {!isFeature && (
        <Button
          size="sm"
          icon={<PenTool size={12} />}
          onClick={() => sendToStudio({ title: entity.name, source: 'inspector', entities: [entity.id] })}
        >
          {mode === 'studio' ? 'Add to board' : 'Add to Studio'}
        </Button>
      )}
      {(live ?? appLive) && (
        <a
          href={(live ?? appLive)!}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] font-medium hover:bg-surface-2"
          title="Opens the live public demo (a simulation) in a new tab"
        >
          Open live <ExternalLink size={11} />
        </a>
      )}
      {entity.sources?.[0] && (
        <a href={githubUrl(entity.sources[0])} target="_blank" rel="noreferrer noopener" className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] font-medium hover:bg-surface-2">
          GitHub <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function useRelatedScenarios(entityId: string) {
  const model = useModel();
  const all = useScenarios();
  return useMemo(() => {
    const ids = new Set(model.scenariosFor(entityId).map((s) => s.id));
    const custom = all.filter((s) => s.custom && (s.related.includes(entityId) || s.participants.includes(entityId)));
    return [...model.scenariosFor(entityId), ...custom.filter((c) => !ids.has(c.id))];
  }, [model, all, entityId]);
}

function OverviewTab({ model, entity }: { model: Model; entity: Entity }) {
  const audience = useApp((s) => s.audience);
  const selectEntity = useApp((s) => s.selectEntity);
  const children = model.children(entity.id);
  const features = entity.kind === 'feature' ? [] : model.featuresOf(entity.id);
  const implementers = entity.kind === 'feature' ? model.implementersOf(entity.id) : [];
  const mods = model.modificationsFor(entity.id);
  const audienceSummary = model.summaryFor(entity, audience);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="m-0 text-[13px] font-medium leading-snug text-fg">{renderInline(audienceSummary)}</p>
        {audienceSummary !== entity.summary && <p className="mb-0 mt-1.5 text-[12px] text-fg-subtle">Technically: {renderInline(entity.summary)}</p>}
      </div>
      <Paragraphs text={entity.description} />

      {mods.length > 0 && (
        <section className="rounded-md border border-dashed border-hypo bg-[color-mix(in_srgb,var(--k-hypo)_7%,transparent)] p-2">
          <SectionTitle>Proposed changes (hypothetical)</SectionTitle>
          <ModificationList ids={mods.map((m) => m.id)} />
        </section>
      )}

      {entity.signature && (
        <section>
          <SectionTitle>Signature</SectionTitle>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2 p-2 font-mono text-[11.5px] text-fg">{entity.signature}</pre>
        </section>
      )}

      {entity.route && (
        <section>
          <SectionTitle>Client route</SectionTitle>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">{entity.route}</code>
        </section>
      )}

      {(entity.tech?.length || entity.tags?.length) && (
        <section className="flex flex-wrap gap-1">
          {entity.tech?.map((t) => (
            <Badge key={t} color="var(--k-app)">
              {t}
            </Badge>
          ))}
          {entity.tags?.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </section>
      )}

      {features.length > 0 && (
        <section>
          <SectionTitle>Part of feature</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {features.map((f) => (
              <EntityChip key={f.id} id={f.id} />
            ))}
          </div>
        </section>
      )}

      {implementers.length > 0 && (
        <section>
          <SectionTitle>Implemented by</SectionTitle>
          <EntityRows entities={implementers} model={model} onPick={(id) => selectEntity(id)} />
        </section>
      )}

      {children.length > 0 && (
        <section>
          <SectionTitle>Contains ({children.length})</SectionTitle>
          <EntityRows entities={children} model={model} onPick={(id) => selectEntity(id)} />
        </section>
      )}

      <section>
        <SectionTitle>Evidence</SectionTitle>
        {entity.confidence === 'hypothetical' ? (
          <p className="m-0 text-[12px] text-fg-muted">This is a hypothetical addition. It does not exist in the Meridian repository.</p>
        ) : (
          <SourceList sources={entity.sources} limit={2} />
        )}
      </section>
    </div>
  );
}

function EntityRows({ entities, model, onPick, max = 14 }: { entities: Entity[]; model: Model; onPick: (id: string) => void; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? entities : entities.slice(0, max);
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line">
      {shown.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={cn('flex items-start gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2', model.isProposedRemoval(c.id) && 'proposed-removal')}
        >
          <span className="mt-0.5 shrink-0" style={{ color: entityColor(c) }}>
            <KindIcon kind={c.kind} size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-fg">{c.name}</span>
            <span className="block truncate text-[11.5px] text-fg-muted">{renderInline(c.summary)}</span>
          </span>
          <span className="shrink-0 text-[10px] uppercase text-fg-subtle">{KIND_LABEL[c.kind]}</span>
        </button>
      ))}
      {entities.length > max && !all && (
        <button type="button" onClick={() => setAll(true)} className="border-t border-line px-2 py-1 text-left text-[11.5px] font-medium text-accent hover:bg-surface-2">
          Show all {entities.length}
        </button>
      )}
    </div>
  );
}

function ModificationList({ ids }: { ids: string[] }) {
  const model = useModel();
  const removeModification = useWorkspace((s) => s.removeModification);
  const mods = model.modifications.filter((m) => ids.includes(m.id));
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {mods.map((m) => (
        <li key={m.id} className="flex items-start gap-2 text-[12px]">
          <Badge color="var(--k-hypo)">{m.op === 'add-field' ? 'add field' : m.op}</Badge>
          <span className="min-w-0 flex-1 text-fg">
            {m.summary}
            {m.field && (
              <code className="ml-1">
                {m.field.name}: {m.field.type}
              </code>
            )}
            {m.note && <span className="block text-[11.5px] text-fg-muted">{m.note}</span>}
          </span>
          <Tip label="Discard this proposed change" side="left">
            <button type="button" aria-label="Discard this proposed change" onClick={() => removeModification(m.id)} className="rounded p-0.5 text-fg-subtle hover:text-bad">
              <Trash2 size={12} />
            </button>
          </Tip>
        </li>
      ))}
    </ul>
  );
}

function DataTab({ model, entity }: { model: Model; entity: Entity }) {
  const machines = model.stateMachinesFor(entity.id).filter((m) => m.subject === entity.id);
  const proposed = model
    .modificationsFor(entity.id)
    .filter((m) => m.op === 'add-field' && m.field)
    .map((m) => m.field!);
  const showBalance = entity.id === 'db:LedgerEntry' || entity.id === 'sh:ledger#deriveBalances' || entity.id === 'feat:balances' || entity.id === 'sh:ledger';
  const writers = model.incoming(entity.id).filter((r) => r.kind === 'writes');
  const readers = model.incoming(entity.id).filter((r) => r.kind === 'reads');
  return (
    <div className="flex flex-col gap-4">
      {(entity.fields?.length || proposed.length > 0) && (
        <section>
          <SectionTitle>{entity.kind === 'db-model' ? 'Columns' : 'Fields'}</SectionTitle>
          <FieldTable fields={entity.fields ?? []} db={entity.kind === 'db-model'} proposed={proposed} />
        </section>
      )}
      {entity.values && entity.values.length > 0 && (
        <section>
          <SectionTitle>Allowed values</SectionTitle>
          <div className="overflow-hidden rounded-md border border-line">
            {entity.values.map((v) => (
              <div key={v.value} className="flex gap-2 border-t border-line px-2 py-1 text-[12px] first:border-t-0">
                <code className="shrink-0 font-semibold text-fg">{v.value}</code>
                <span className="text-fg-muted">{v.meaning}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {entity.example !== undefined && (
        <section>
          <SectionTitle>{entity.kind === 'db-model' ? 'Example row' : 'Example'}</SectionTitle>
          <JsonView data={entity.example} fields={entity.fields} showToolbar hideable label={entity.name} />
        </section>
      )}
      {showBalance && (
        <section>
          <SectionTitle>Try it: how entries become balances</SectionTitle>
          <BalanceCalculator compact />
        </section>
      )}
      {machines.map((m) => (
        <section key={m.id}>
          <SectionTitle>Lifecycle</SectionTitle>
          <StateMachineView machine={m} />
        </section>
      ))}
      {entity.kind === 'db-model' && (writers.length > 0 || readers.length > 0) && (
        <section>
          <SectionTitle>Who touches this table</SectionTitle>
          <div className="flex flex-col gap-2">
            {writers.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-fg-muted">Writes ({writers.length})</div>
                <RelationRows relations={writers} perspective={entity.id} />
              </div>
            )}
            {readers.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-fg-muted">Reads ({readers.length})</div>
                <RelationRows relations={readers} perspective={entity.id} />
              </div>
            )}
          </div>
        </section>
      )}
      {!entity.fields?.length && !entity.values?.length && entity.example === undefined && !showBalance && machines.length === 0 && (
        <Empty title="No data shape recorded">This entity has no fields, values or example data in the model.</Empty>
      )}
    </div>
  );
}

function RelationRows({ relations, perspective, max = 12 }: { relations: Relation[]; perspective?: string; max?: number }) {
  const model = useModel();
  const select = useApp((s) => s.select);
  const [all, setAll] = useState(false);
  const shown = all ? relations : relations.slice(0, max);
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line" data-testid="relation-rows">
      {shown.map((r) => {
        const outgoing = perspective ? r.from === perspective || model.isWithin(r.from, perspective) : true;
        const otherId = outgoing ? r.to : r.from;
        const other = model.entity(otherId);
        const mine = model.entity(outgoing ? r.from : r.to);
        const color = CHANNEL_COLOR[channelOf(r.kind)];
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => select({ type: 'relation', id: r.id })}
            className={cn('flex items-start gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2', r.confidence === 'hypothetical' && 'bg-[color-mix(in_srgb,var(--k-hypo)_7%,transparent)]')}
            data-relation={r.id}
          >
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-fg-muted">
                {perspective && mine && mine.id !== perspective && <span className="truncate font-medium text-fg">{mine.name}</span>}
                <span>{outgoing ? RELATION_VERB[r.kind] : `← ${RELATION_VERB[r.kind]} by`}</span>
                <span className="truncate font-semibold text-fg">{other?.name ?? otherId}</span>
              </span>
              {r.label && <span className="block truncate font-mono text-[11px] text-fg-subtle">{r.label}</span>}
            </span>
            {r.confidence && r.confidence !== 'verified' && <ConfidenceBadge confidence={r.confidence} compact />}
          </button>
        );
      })}
      {relations.length > max && !all && (
        <button type="button" onClick={() => setAll(true)} className="border-t border-line px-2 py-1 text-left text-[11.5px] font-medium text-accent hover:bg-surface-2">
          Show all {relations.length}
        </button>
      )}
    </div>
  );
}

function RelationsTab({ model, entity }: { model: Model; entity: Entity }) {
  const container = model.hasChildren(entity.id);
  const [scope, setScope] = useState<'own' | 'across'>(container ? 'across' : 'own');
  const relations = useMemo(() => (scope === 'across' ? model.relationsAcross(entity.id) : model.relationsOf(entity.id)), [model, entity.id, scope]);
  const groups = useMemo(() => {
    const m = new Map<RelationChannel, Relation[]>();
    for (const r of relations) {
      const c = channelOf(r.kind);
      m.set(c, [...(m.get(c) ?? []), r]);
    }
    return CHANNELS.filter((c) => m.has(c.id)).map((c) => ({ ...c, relations: m.get(c.id)! }));
  }, [relations]);
  return (
    <div className="flex flex-col gap-3">
      {container && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          Show
          <button type="button" aria-pressed={scope === 'across'} onClick={() => setScope('across')} className={cn('rounded px-1.5 py-0.5 font-medium', scope === 'across' ? 'bg-surface-3 text-fg' : 'hover:bg-surface-2')}>
            everything crossing its boundary
          </button>
          <button type="button" aria-pressed={scope === 'own'} onClick={() => setScope('own')} className={cn('rounded px-1.5 py-0.5 font-medium', scope === 'own' ? 'bg-surface-3 text-fg' : 'hover:bg-surface-2')}>
            its own only
          </button>
        </div>
      )}
      {groups.length === 0 && <Empty title="No relationships recorded">Nothing in the model connects to this {KIND_LABEL[entity.kind].toLowerCase()} directly. Try a containing component.</Empty>}
      {groups.map((g) => (
        <section key={g.id}>
          <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{g.relations.length}</span>}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOR[g.id] }} />
              {g.label}
            </span>
          </SectionTitle>
          <RelationRows relations={g.relations} perspective={entity.id} />
        </section>
      ))}
    </div>
  );
}

function WorkflowsTab({ entity }: { entity: Entity }) {
  const model = useModel();
  const openInTheater = useApp((s) => s.openInTheater);
  const scenarios = useRelatedScenarios(entity.id);
  const contract = model.contract(entity.id);
  const using = model.contractsUsing(entity.id).filter((c) => c.id !== entity.id);
  return (
    <div className="flex flex-col gap-4">
      {scenarios.length === 0 && !contract && using.length === 0 && (
        <Empty title="No related workflow">No scenario involves this entity yet. Pick an endpoint to auto-assemble a trace, or build one in Scenario Theater.</Empty>
      )}
      {scenarios.length > 0 && (
        <section>
          <SectionTitle>Scenarios involving this</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {scenarios.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openInTheater(s.id)}
                className={cn('rounded-md border border-line bg-surface p-2 text-left hover:border-accent hover:bg-surface-2', s.confidence === 'hypothetical' && 'border-dashed border-hypo')}
                data-scenario={s.id}
              >
                <div className="flex items-center gap-1.5">
                  <Clapperboard size={12} className="shrink-0 text-accent" />
                  <span className="truncate text-[12.5px] font-semibold">{s.title}</span>
                  {s.custom && <Badge>custom</Badge>}
                  {s.confidence === 'hypothetical' && <ConfidenceBadge confidence="hypothetical" compact />}
                </div>
                <div className="mt-0.5 text-[11.5px] text-fg-muted">{s.question}</div>
                <div className="mt-1 text-[10.5px] text-fg-subtle">
                  {s.steps.length} steps · {s.variants.length} outcome{s.variants.length === 1 ? '' : 's'}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {contract && (
        <section>
          <SectionTitle>Trace this endpoint</SectionTitle>
          <Button icon={<GitBranch size={12} />} onClick={() => openInTheater(`trace:${contract.id}`)}>
            Assemble a trace for {contract.method} {contract.path}
          </Button>
          <p className="mb-0 mt-1 text-[11.5px] text-fg-subtle">Builds a step-by-step scenario from the endpoint’s contract that you can edit and present.</p>
        </section>
      )}
      {using.length > 0 && (
        <section>
          <SectionTitle>Endpoints whose handling touches this ({using.length})</SectionTitle>
          <div className="flex flex-col overflow-hidden rounded-md border border-line">
            {using.slice(0, 20).map((c) => (
              <button key={c.id} type="button" onClick={() => openInTheater(`trace:${c.id}`)} className="flex items-center gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2">
                <MethodBadge method={c.method} />
                <code className="min-w-0 flex-1 truncate text-[11.5px]">{c.path}</code>
                <span className="shrink-0 text-[10.5px] text-accent">trace →</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ImpactTab({ model, entity }: { model: Model; entity: Entity }) {
  const selectEntity = useApp((s) => s.selectEntity);
  const sendToStudio = useApp((s) => s.sendToStudio);
  const [depth, setDepth] = useState(2);
  const items = useMemo(() => model.impactOf(entity.id, depth), [model, entity.id, depth]);
  const byDistance = [1, 2, 3].map((d) => items.filter((i) => i.distance === d)).filter((g) => g.length);
  return (
    <div className="flex flex-col gap-3" data-testid="impact-tab">
      <p className="m-0 text-[12px] text-fg-muted">
        If <b className="text-fg">{entity.name}</b> changed, these are the things that depend on it. Direct dependents come from relationships read in the repository; anything further out is a transitive inference.
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11.5px] text-fg-muted">
          Depth
          {[1, 2, 3].map((d) => (
            <button key={d} type="button" aria-pressed={depth === d} onClick={() => setDepth(d)} className={cn('h-6 w-6 rounded font-semibold', depth === d ? 'bg-accent text-accent-fg' : 'bg-surface-2 hover:bg-surface-3')}>
              {d}
            </button>
          ))}
        </div>
        {items.length > 0 && (
          <Button
            size="sm"
            icon={<PenTool size={12} />}
            onClick={() =>
              sendToStudio({
                title: `Impact of changing ${entity.name}`,
                source: 'inspector',
                entities: [entity.id, ...items.slice(0, 18).map((i) => i.entity.id)],
                edges: items.slice(0, 18).map((i) => ({ from: i.via.from, to: i.via.to, label: i.via.label ?? RELATION_VERB[i.via.kind], kind: i.via.kind })),
              })
            }
          >
            Diagram it
          </Button>
        )}
      </div>
      {items.length === 0 && <Empty title="No dependents recorded">Nothing in the model depends on this directly.</Empty>}
      {byDistance.map((group) => (
        <section key={group[0].distance}>
          <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{group.length}</span>}>
            {group[0].distance === 1 ? 'Directly affected' : `${group[0].distance} steps away`}
          </SectionTitle>
          <div className="flex flex-col overflow-hidden rounded-md border border-line">
            {group.map((i) => (
              <button key={i.entity.id} type="button" onClick={() => selectEntity(i.entity.id)} className="flex items-start gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2" data-impact={i.entity.id}>
                <span className="mt-0.5 shrink-0" style={{ color: entityColor(i.entity) }}>
                  <KindIcon kind={i.entity.kind} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{i.entity.name}</span>
                  <span className="block truncate text-[11px] text-fg-muted">
                    {RELATION_VERB[i.via.kind]} {model.entity(i.via.to)?.name}
                    {i.via.label ? ` · ${i.via.label}` : ''}
                  </span>
                </span>
                <ConfidenceBadge confidence={i.confidence} compact />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EntityInspector({ entity }: { entity: Entity }) {
  const model = useModel();
  const tab = useApp((s) => s.inspectorTab);
  const setTab = useApp((s) => s.setInspectorTab);
  const starred = useWorkspace((s) => s.starred.includes(entity.id));
  const toggleStar = useWorkspace((s) => s.toggleStar);
  const removeHypoEntity = useWorkspace((s) => s.removeHypoEntity);
  const select = useApp((s) => s.select);
  const contracts = model.contractsWithin(entity.id);
  const ownContract = model.contract(entity.id);
  const relationCount = model.hasChildren(entity.id) ? model.relationsAcross(entity.id).length : model.relationsOf(entity.id).length;
  const scenarios = useRelatedScenarios(entity.id);
  const hasData = !!(entity.fields?.length || entity.values?.length || entity.example !== undefined || model.stateMachinesFor(entity.id).some((m) => m.subject === entity.id) || ['db:LedgerEntry', 'sh:ledger#deriveBalances', 'feat:balances', 'sh:ledger'].includes(entity.id));
  const hypo = entity.confidence === 'hypothetical';
  // Items of a shipped example layer are read-only; only the user's own hypothetical items can be deleted.
  const editableHypo = useWorkspace((s) => s.layers.some((l) => !l.builtIn && l.entities.some((e) => e.id === entity.id)));

  const tabs: { value: InspectorTab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    ...(contracts.length ? [{ value: 'contract' as const, label: ownContract ? 'Contract' : 'API', count: ownContract ? undefined : contracts.length }] : []),
    ...(hasData ? [{ value: 'data' as const, label: 'Data' }] : []),
    { value: 'code', label: 'Code', count: entity.sources?.length || undefined },
    { value: 'relations', label: 'Relations', count: relationCount || undefined },
    { value: 'workflows', label: 'Workflows', count: scenarios.length || undefined },
    { value: 'impact', label: 'Impact' },
  ];
  const active = tabs.some((t) => t.value === tab) ? tab : 'overview';

  return (
    <>
      <header className={cn('shrink-0 border-b border-line px-3 pb-2.5 pt-3', hypo && 'bg-[color-mix(in_srgb,var(--k-hypo)_8%,transparent)]')}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <KindBadge entity={entity} />
          <ConfidenceBadge confidence={entity.confidence} />
          {model.isProposedRemoval(entity.id) && <Badge color="var(--bad)">proposed removal</Badge>}
          <span className="flex-1" />
          {hypo && !editableHypo ? null : hypo ? (
            <IconButton
              label="Delete this hypothetical item"
              size="sm"
              onClick={() => {
                removeHypoEntity(entity.id);
                select(null);
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          ) : (
            <IconButton label={starred ? 'Remove bookmark' : 'Bookmark this'} size="sm" active={starred} onClick={() => toggleStar(entity.id)}>
              <Star size={14} fill={starred ? 'currentColor' : 'none'} />
            </IconButton>
          )}
        </div>
        <h2 className={cn('m-0 break-words text-[16px] font-semibold leading-tight', entity.kind === 'function' || entity.kind === 'endpoint' || entity.kind === 'type' || entity.kind === 'constant' ? 'font-mono text-[14px]' : '')} data-testid="inspector-title">
          {entity.name}
        </h2>
        <div className="mt-1">
          <Breadcrumb model={model} entity={entity} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <EntityActions model={model} entity={entity} />
          {!hypo && entity.kind !== 'feature' && <ProposeChange entity={entity} />}
        </div>
      </header>
      <Tabs label="Inspector sections" value={active} onChange={setTab} tabs={tabs} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid={`inspector-tab-${active}`}>
        {active === 'overview' && <OverviewTab model={model} entity={entity} />}
        {active === 'contract' &&
          (ownContract ? (
            <ContractView contract={ownContract} />
          ) : (
            <ContractList model={model} entity={entity} />
          ))}
        {active === 'data' && <DataTab model={model} entity={entity} />}
        {active === 'code' && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[12px] text-fg-muted">
              Excerpts are from <code>{REPO.owner}/{REPO.repo}</code> at commit <code>{REPO.sha.slice(0, 7)}</code>.
            </p>
            <SourceList sources={entity.sources} openFirst />
          </div>
        )}
        {active === 'relations' && <RelationsTab model={model} entity={entity} />}
        {active === 'workflows' && <WorkflowsTab entity={entity} />}
        {active === 'impact' && <ImpactTab model={model} entity={entity} />}
      </div>
    </>
  );
}

function ContractList({ model, entity }: { model: Model; entity: Entity }) {
  const selectEntity = useApp((s) => s.selectEntity);
  const contracts = model.contractsWithin(entity.id);
  const [q, setQ] = useState('');
  const shown = contracts.filter((c) => `${c.method} ${c.path} ${c.summary}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${contracts.length} endpoints…`} aria-label="Filter endpoints" className="h-8 rounded-md border border-line bg-surface px-2 text-[12.5px] focus:border-accent focus:outline-none" />
      <div className="flex flex-col overflow-hidden rounded-md border border-line">
        {shown.map((c) => (
          <button key={c.id} type="button" onClick={() => selectEntity(c.id, { tab: 'contract' })} className="flex items-start gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2" data-endpoint={c.id}>
            <span className="mt-px w-11 shrink-0">
              <MethodBadge method={c.method} />
            </span>
            <span className="min-w-0 flex-1">
              <code className="block truncate text-[11.5px] font-semibold text-fg">{c.path}</code>
              <span className="block truncate text-[11.5px] text-fg-muted">{renderInline(c.summary)}</span>
            </span>
          </button>
        ))}
        {shown.length === 0 && <div className="px-2 py-3 text-[12px] italic text-fg-subtle">No endpoint matches.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relation / aggregated edge
// ---------------------------------------------------------------------------

function Ends({ from, to, bidirectional }: { from: string; to: string; bidirectional?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <EntityChip id={from} />
      {bidirectional ? <ArrowLeftRight size={14} className="text-fg-subtle" /> : <ArrowRight size={14} className="text-fg-subtle" />}
      <EntityChip id={to} />
    </div>
  );
}

function RelationInspector({ relation }: { relation: Relation }) {
  const model = useModel();
  const sendToStudio = useApp((s) => s.sendToStudio);
  const openInTheater = useApp((s) => s.openInTheater);
  const select = useApp((s) => s.select);
  const removeHypoRelation = useWorkspace((s) => s.removeHypoRelation);
  const channel = channelOf(relation.kind);
  const hypo = relation.confidence === 'hypothetical';
  const endpoint = [relation.to, relation.from].map((id) => model.contract(id)).find(Boolean);
  return (
    <>
      <header className={cn('shrink-0 border-b border-line px-3 pb-3 pt-3', hypo && 'bg-[color-mix(in_srgb,var(--k-hypo)_8%,transparent)]')}>
        <div className="mb-2 flex items-center gap-1.5">
          <Badge color={CHANNEL_COLOR[channel]}>{CHANNELS.find((c) => c.id === channel)?.label} relationship</Badge>
          <ConfidenceBadge confidence={relation.confidence} />
          <span className="flex-1" />
          {hypo && (
            <IconButton
              label="Delete this hypothetical relationship"
              size="sm"
              onClick={() => {
                removeHypoRelation(relation.id);
                select(null);
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
        <Ends from={relation.from} to={relation.to} bidirectional={relation.bidirectional} />
        <h2 className="mb-0 mt-2 text-[14px] font-semibold leading-snug" data-testid="inspector-title">
          {model.entity(relation.from)?.name} {RELATION_VERB[relation.kind]} {model.entity(relation.to)?.name}
        </h2>
        {relation.label && <div className="mt-1 break-words font-mono text-[12px] text-fg-muted">{relation.label}</div>}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button size="sm" icon={<PenTool size={12} />} onClick={() => sendToStudio({ title: relation.label ?? 'Relationship', source: 'inspector', entities: [relation.from, relation.to], edges: [{ from: relation.from, to: relation.to, label: relation.label ?? RELATION_VERB[relation.kind], kind: relation.kind, hypothetical: hypo }] })}>
            Add both to Studio
          </Button>
          {endpoint && (
            <Button size="sm" icon={<Clapperboard size={12} />} onClick={() => openInTheater(`trace:${endpoint.id}`)}>
              Show as sequence
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          {relation.summary && <p className="m-0 text-[13px] font-medium leading-snug">{renderInline(relation.summary)}</p>}
          <Paragraphs text={relation.description} />
          <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
            <dt className="text-fg-subtle">Direction</dt>
            <dd className="m-0">{relation.bidirectional ? 'Both ways' : `${model.entity(relation.from)?.name} → ${model.entity(relation.to)?.name}`}</dd>
            <dt className="text-fg-subtle">Kind</dt>
            <dd className="m-0">
              <code>{relation.kind}</code>
            </dd>
            {relation.protocol && (
              <>
                <dt className="text-fg-subtle">Protocol</dt>
                <dd className="m-0">{relation.protocol}</dd>
              </>
            )}
          </dl>
          {relation.data && relation.data.length > 0 && (
            <section>
              <SectionTitle>Data exchanged</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {relation.data.map((d) => (
                  <EntityChip key={d} id={d} />
                ))}
              </div>
            </section>
          )}
          {endpoint && (
            <section>
              <SectionTitle>Contract</SectionTitle>
              <ContractView contract={endpoint} compact />
            </section>
          )}
          <section>
            <SectionTitle>Evidence</SectionTitle>
            {hypo ? <p className="m-0 text-[12px] text-fg-muted">A hypothetical relationship — not present in the Meridian repository.</p> : <SourceList sources={relation.sources} openFirst />}
          </section>
        </div>
      </div>
    </>
  );
}

function EdgeInspector({ a, b, channel }: { a: string; b: string; channel: RelationChannel }) {
  const model = useModel();
  const sendToStudio = useApp((s) => s.sendToStudio);
  const selectEntity = useApp((s) => s.selectEntity);
  const all = useMemo(() => model.relationsBetween(a, b).filter((r) => channelOf(r.kind) === channel), [model, a, b, channel]);
  const forward = all.filter((r) => model.isWithin(r.from, a));
  const backward = all.filter((r) => !model.isWithin(r.from, a));
  const headline = all.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  const ea = model.entity(a);
  const eb = model.entity(b);
  const info = CHANNELS.find((c) => c.id === channel)!;
  const endpoints = useMemo(() => {
    const ids = new Set<string>();
    for (const r of all) for (const id of [r.to, r.from]) if (model.contract(id)) ids.add(id);
    return [...ids].map((id) => model.contract(id)!).sort((x, y) => x.path.localeCompare(y.path));
  }, [all, model]);
  const dataTypes = [...new Set(all.flatMap((r) => r.data ?? []))];
  const events = [...new Set(all.flatMap((r) => [r.from, r.to]).filter((id) => model.entity(id)?.kind === 'event'))];
  const hypothetical = all.length > 0 && all.every((r) => r.confidence === 'hypothetical');
  if (!ea || !eb) return <Empty title="This connection no longer exists" />;
  return (
    <>
      <header className={cn('shrink-0 border-b border-line px-3 pb-3 pt-3', hypothetical && 'bg-[color-mix(in_srgb,var(--k-hypo)_8%,transparent)]')}>
        <div className="mb-2 flex items-center gap-1.5">
          <Badge color={CHANNEL_COLOR[channel]}>{info.label}</Badge>
          <ConfidenceBadge confidence={hypothetical ? 'hypothetical' : headline?.confidence} />
          <span className="text-[11px] text-fg-subtle">
            {all.length} underlying relationship{all.length === 1 ? '' : 's'}
          </span>
        </div>
        <Ends from={forward.length || !backward.length ? a : b} to={forward.length || !backward.length ? b : a} bidirectional={(forward.length > 0 && backward.length > 0) || headline?.bidirectional} />
        <h2 className="mb-0 mt-2 text-[14px] font-semibold leading-snug" data-testid="inspector-title">
          {headline?.label ?? `${ea.name} ↔ ${eb.name}`}
        </h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            icon={<PenTool size={12} />}
            onClick={() =>
              sendToStudio({
                title: `${ea.name} ↔ ${eb.name}`,
                source: 'inspector',
                entities: [...new Set(all.slice(0, 16).flatMap((r) => [r.from, r.to]))],
                edges: all.slice(0, 16).map((r) => ({ from: r.from, to: r.to, label: r.label ?? RELATION_VERB[r.kind], kind: r.kind, hypothetical: r.confidence === 'hypothetical' })),
              })
            }
          >
            Diagram these connections
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[13px] font-medium leading-snug">{renderInline(headline?.summary ?? info.description)}</p>
          <Paragraphs text={headline?.description} />
          {headline?.protocol && (
            <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
              <dt className="text-fg-subtle">Protocol</dt>
              <dd className="m-0">{headline.protocol}</dd>
            </dl>
          )}
          {endpoints.length > 0 && (
            <section>
              <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{endpoints.length}</span>}>Endpoints used</SectionTitle>
              <div className="flex flex-col overflow-hidden rounded-md border border-line" data-testid="edge-endpoints">
                {endpoints.map((c) => (
                  <button key={c.id} type="button" onClick={() => selectEntity(c.id, { tab: 'contract' })} className="flex items-center gap-2 border-t border-line px-2 py-1.5 text-left first:border-t-0 hover:bg-surface-2">
                    <span className="w-11 shrink-0">
                      <MethodBadge method={c.method} />
                    </span>
                    <code className="min-w-0 flex-1 truncate text-[11.5px] font-semibold">{c.path}</code>
                    {c.mutates && <span className="shrink-0 text-[10px] font-semibold uppercase text-warn">writes</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {events.length > 0 && (
            <section>
              <SectionTitle>Events</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {events.map((id) => (
                  <EntityChip key={id} id={id} />
                ))}
              </div>
            </section>
          )}
          {dataTypes.length > 0 && (
            <section>
              <SectionTitle>Data exchanged</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {dataTypes.map((d) => (
                  <EntityChip key={d} id={d} />
                ))}
              </div>
            </section>
          )}
          {forward.length > 0 && (
            <section>
              <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{forward.length}</span>}>
                {ea.name} → {eb.name}
              </SectionTitle>
              <RelationRows relations={forward} />
            </section>
          )}
          {backward.length > 0 && (
            <section>
              <SectionTitle right={<span className="text-[10.5px] text-fg-subtle">{backward.length}</span>}>
                {eb.name} → {ea.name}
              </SectionTitle>
              <RelationRows relations={backward} />
            </section>
          )}
          {headline?.sources && (
            <section>
              <SectionTitle>Evidence</SectionTitle>
              <SourceList sources={headline.sources} limit={3} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Other selection types
// ---------------------------------------------------------------------------

function MachineInspector({ id }: { id: string }) {
  const model = useModel();
  const m = model.stateMachine(id);
  if (!m) return <Empty title="State machine not found" />;
  return (
    <>
      <header className="shrink-0 border-b border-line px-3 pb-3 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Badge color="var(--k-event)">State machine</Badge>
          <ConfidenceBadge confidence={m.confidence} />
        </div>
        <h2 className="m-0 text-[16px] font-semibold" data-testid="inspector-title">
          {m.name}
        </h2>
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-muted">
          Lifecycle of <EntityChip id={m.subject} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          <StateMachineView machine={m} />
          <section>
            <SectionTitle>Transitions</SectionTitle>
            <div className="overflow-hidden rounded-md border border-line">
              {m.transitions.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5 text-[11.5px] first:border-t-0">
                  <code>{t.from}</code>→<code>{t.to}</code>
                  <span className="text-fg-muted">{t.label}</span>
                  {t.by && <EntityChip id={t.by} />}
                </div>
              ))}
            </div>
          </section>
          <section>
            <SectionTitle>Evidence</SectionTitle>
            <SourceList sources={m.sources} limit={3} />
          </section>
        </div>
      </div>
    </>
  );
}

function TermInspector({ term }: { term: string }) {
  const model = useModel();
  const g = model.glossary.find((x) => x.term === term);
  if (!g) return <Empty title="Term not found" />;
  return (
    <>
      <header className="shrink-0 border-b border-line px-3 pb-3 pt-3">
        <Badge>Glossary</Badge>
        <h2 className="mb-0 mt-1.5 text-[16px] font-semibold" data-testid="inspector-title">
          {g.term}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="m-0 text-[13px] leading-relaxed">{renderInline(g.definition)}</p>
        {g.related && g.related.length > 0 && (
          <section className="mt-4">
            <SectionTitle>See it in the system</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {g.related.map((id) => (
                <EntityChip key={id} id={id} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function StepInspector({ scenarioId, stepId }: { scenarioId: string; stepId: string }) {
  const scenarios = useScenarios();
  const audience = useApp((s) => s.audience);
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const step = scenario?.steps.find((s) => s.id === stepId);
  if (!scenario || !step) return <Empty title="Step not found">Open a scenario in Scenario Theater to inspect its steps.</Empty>;
  const color = STEP_COLOR[step.kind];
  return (
    <>
      <header className="shrink-0 border-b border-line px-3 pb-3 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Badge color={color}>{STEP_LABEL[step.kind]}</Badge>
          <ConfidenceBadge confidence={step.hypothetical ? 'hypothetical' : step.confidence} />
        </div>
        <h2 className="m-0 text-[15px] font-semibold leading-snug" data-testid="inspector-title">
          {step.title}
        </h2>
        <div className="mt-1 text-[11.5px] text-fg-subtle">{scenario.title}</div>
        <div className="mt-2">
          <Ends from={step.from} to={step.to} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[13px] leading-relaxed">{renderInline(step.audience?.[audience] ?? step.narrative)}</p>
          {step.audience?.[audience] && <p className="m-0 text-[12px] text-fg-subtle">Technically: {renderInline(step.narrative)}</p>}
          {step.payload && (
            <section>
              <SectionTitle right={step.payload.typeRef && <EntityChip id={step.payload.typeRef} />}>{step.payload.title}</SectionTitle>
              {step.payload.line && <div className="mb-1 font-mono text-[11.5px] font-semibold">{step.payload.line}</div>}
              <JsonView data={step.payload.data} highlight={step.payload.highlight} showToolbar hideable />
            </section>
          )}
          {step.effects && step.effects.length > 0 && (
            <section>
              <SectionTitle>Database effects</SectionTitle>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
                {step.effects.map((ef, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <Badge color={ef.op === 'insert' ? 'var(--ok)' : ef.op === 'update' ? 'var(--warn)' : 'var(--bad)'}>{ef.op}</Badge>
                    <EntityChip id={`db:${ef.table}`} />
                    <code className="text-fg-muted">{ef.id ?? String(ef.row?.id ?? '')}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <SectionTitle>Evidence</SectionTitle>
            <SourceList sources={step.sources} openFirst />
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Body({ selection }: { selection: Selection | null }) {
  const model = useModel();
  if (!selection) {
    return (
      <Empty title="Nothing selected" icon={<MapIcon size={22} />}>
        Click a component, a connection or a step to see what it is, the data it exchanges and the code behind it. Press <kbd>/</kbd> to search.
      </Empty>
    );
  }
  switch (selection.type) {
    case 'entity': {
      const e = model.entity(selection.id);
      return e ? <EntityInspector key={e.id} entity={e} /> : <Empty title="Not found">“{selection.id}” is not in the model. It may belong to a hypothetical layer that is switched off.</Empty>;
    }
    case 'relation': {
      const r = model.relation(selection.id);
      return r ? <RelationInspector key={r.id} relation={r} /> : <Empty title="Relationship not found" />;
    }
    case 'edge':
      return <EdgeInspector key={`${selection.a}|${selection.b}|${selection.channel}`} a={selection.a} b={selection.b} channel={selection.channel} />;
    case 'machine':
      return <MachineInspector id={selection.id} />;
    case 'term':
      return <TermInspector term={selection.term} />;
    case 'step':
      return <StepInspector scenarioId={selection.scenarioId} stepId={selection.stepId} />;
  }
}

export function Inspector() {
  const selection = useApp((s) => s.selection);
  const open = useApp((s) => s.inspectorOpen);
  const setOpen = useApp((s) => s.setInspectorOpen);
  const select = useApp((s) => s.select);
  const [width, setWidth] = useState(400);

  // With nothing selected the panel gets out of the way, leaving the canvas the full width.
  if (!open || !selection) return null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(300, Math.min(760, startW + (startX - ev.clientX))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className="presenter-hide relative flex h-full shrink-0 flex-col border-l border-line bg-surface" style={{ width }} aria-label="Inspector" data-testid="inspector">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => Math.min(760, w + 24));
          if (e.key === 'ArrowRight') setWidth((w) => Math.max(300, w - 24));
        }}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
      />
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5">
        {selection && (
          <IconButton label="Clear selection" keys="Esc" size="sm" onClick={() => select(null)} tipSide="left">
            <X size={14} />
          </IconButton>
        )}
        <IconButton label="Hide inspector" keys="I" size="sm" onClick={() => setOpen(false)} tipSide="left">
          <PanelRightClose size={14} />
        </IconButton>
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', selection && '[&>header]:pr-16')}>
        <Body selection={selection} />
      </div>
    </aside>
  );
}
