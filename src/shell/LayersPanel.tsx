/** Manage hypothetical layers and compare a proposal with the baseline. */
import { useState } from 'react';
import { Copy, Download, FlaskConical, Map as MapIcon, PenTool, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { baseModel, RELATION_VERB, type HypotheticalLayer } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { downloadText, makeExport } from '@/state/io';
import { useWorkspace } from '@/state/workspace';
import { Badge, Button, cn, Dialog, Empty, inputClass, SectionTitle, Switch } from '@/ui/primitives';
import { EntityChip } from '@/viewers/Fields';
import { HypotheticalComponentDialog } from './ProposeChange';

/** Baseline entities a layer touches: endpoints of its connections and targets of its changes. */
export function touchedBaseline(layer: HypotheticalLayer): string[] {
  const own = new Set(layer.entities.map((e) => e.id));
  const ids = new Set<string>();
  for (const r of layer.relations) for (const id of [r.from, r.to]) if (!own.has(id) && baseModel.has(id)) ids.add(id);
  for (const m of layer.modifications) if (baseModel.has(m.target)) ids.add(m.target);
  return [...ids];
}

export function LayersPanel({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const model = useModel();
  const app = useApp;
  const [selectedId, setSelectedId] = useState<string | null>(ws.editingLayerId ?? ws.activeLayerIds[0] ?? ws.layers[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const layer = ws.layers.find((l) => l.id === selectedId) ?? null;
  const active = layer ? ws.activeLayerIds.includes(layer.id) : false;
  const touched = layer ? touchedBaseline(layer) : [];

  const showInAtlas = () => {
    if (!layer) return;
    ws.setLayerActive(layer.id, true);
    const first = layer.entities[0];
    const s = app.getState();
    const expand = new Set<string>(['meridian']);
    for (const id of [...touched, ...layer.entities.map((e) => e.parent ?? 'meridian')]) for (const a of [...baseModel.ancestorIds(id)]) expand.add(a);
    s.atlasExpand([...expand]);
    if (first) s.select({ type: 'entity', id: first.id }, { openInspector: true });
    s.setMode('atlas');
    onClose();
  };

  const diagram = () => {
    if (!layer) return;
    ws.setLayerActive(layer.id, true);
    app.getState().sendToStudio({
      title: `${layer.name} — proposed vs. existing`,
      source: 'inspector',
      entities: [...new Set([...layer.entities.map((e) => e.id), ...touched])],
      edges: layer.relations.map((r) => ({ from: r.from, to: r.to, label: r.label ?? RELATION_VERB[r.kind], kind: r.kind, hypothetical: true })),
      note: layer.description,
    });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={900}
      title={
        <span className="inline-flex items-center gap-2">
          <FlaskConical size={15} className="text-hypo" /> Hypothetical layers
        </span>
      }
      bodyClassName="p-0!"
    >
      <div className="grid min-h-[420px] grid-cols-[260px_1fr]">
        <div className="flex flex-col border-r border-line bg-surface-2/50 p-2">
          <p className="mx-1 mb-2 mt-0 text-[11.5px] text-fg-muted">A layer holds proposed components, connections and changes. Switch it on to draw it over the real system in every mode. The Meridian baseline is never modified.</p>
          <div className="flex flex-col gap-1" data-testid="layer-list">
            {ws.layers.map((l) => (
              <div key={l.id} className={cn('flex items-start gap-2 rounded-md border px-2 py-1.5', l.id === selectedId ? 'border-hypo bg-surface' : 'border-transparent hover:bg-surface')}>
                <Switch checked={ws.activeLayerIds.includes(l.id)} onChange={(v) => ws.setLayerActive(l.id, v)} label="" className="mt-0.5" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(l.id)}>
                  <span className="block truncate text-[12.5px] font-semibold">{l.name}</span>
                  <span className="block text-[10.5px] text-fg-subtle">
                    {l.builtIn ? 'Example' : ws.editingLayerId === l.id ? 'Receiving new items' : 'Yours'} · {l.entities.length + l.relations.length + l.modifications.length} items
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <Button
              size="sm"
              icon={<Plus size={12} />}
              onClick={() => {
                const id = ws.createLayer(`Proposal ${ws.layers.filter((l) => !l.builtIn).length + 1}`, '');
                setSelectedId(id);
              }}
              data-testid="new-layer"
            >
              New layer
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => ws.resetLayers()} title="Delete your layers and restore the shipped examples">
              Discard all my layers
            </Button>
          </div>
        </div>

        <div className="min-w-0 p-4">
          {!layer ? (
            <Empty title="No layer selected" />
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {layer.builtIn ? (
                    <h3 className="m-0 text-[15px] font-semibold">{layer.name}</h3>
                  ) : (
                    <input value={layer.name} onChange={(e) => ws.updateLayer(layer.id, { name: e.target.value })} aria-label="Layer name" className={cn(inputClass, 'text-[14px] font-semibold')} />
                  )}
                  <Badge color="var(--k-hypo)">{active ? 'On' : 'Off'}</Badge>
                </div>
                {layer.builtIn ? (
                  <p className="mb-0 mt-1 text-[12.5px] text-fg-muted">{layer.description}</p>
                ) : (
                  <textarea value={layer.description} onChange={(e) => ws.updateLayer(layer.id, { description: e.target.value })} placeholder="What is this proposal about?" aria-label="Layer description" rows={2} className={cn(inputClass, 'mt-1.5 h-auto py-1.5')} />
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" icon={<MapIcon size={12} />} onClick={showInAtlas} disabled={!layer.entities.length && !touched.length} data-testid="layer-show-atlas">
                  Show on the map
                </Button>
                <Button size="sm" icon={<PenTool size={12} />} onClick={diagram} disabled={!layer.entities.length && !touched.length}>
                  Diagram proposed vs. existing
                </Button>
                {layer.scenarios[0] && (
                  <Button
                    size="sm"
                    onClick={() => {
                      ws.setLayerActive(layer.id, true);
                      app.getState().openInTheater(layer.scenarios[0].id);
                      onClose();
                    }}
                  >
                    Play proposed flow
                  </Button>
                )}
                {!layer.builtIn && (
                  <Button
                    size="sm"
                    icon={<Plus size={12} />}
                    onClick={() => {
                      ws.setEditingLayer(layer.id);
                      setAdding(true);
                    }}
                  >
                    Add component…
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy size={12} />}
                  onClick={() => {
                    const id = ws.duplicateLayer(layer.id);
                    if (id) setSelectedId(id);
                  }}
                  title={layer.builtIn ? 'Make an editable copy of this example' : 'Duplicate'}
                >
                  {layer.builtIn ? 'Copy to edit' : 'Duplicate'}
                </Button>
                <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => downloadText(`${layer.name.replace(/[^\w]+/g, '-').toLowerCase()}.layer.json`, makeExport('layer', layer))}>
                  Export
                </Button>
                {!layer.builtIn && (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 size={12} />}
                    onClick={() => {
                      ws.deleteLayer(layer.id);
                      setSelectedId(ws.layers.find((l) => l.id !== layer.id)?.id ?? null);
                    }}
                  >
                    Delete layer
                  </Button>
                )}
              </div>

              <section>
                <SectionTitle>Compared with the baseline</SectionTitle>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {(
                    [
                      ['New components', layer.entities.length],
                      ['New connections', layer.relations.length],
                      ['Changes to existing', layer.modifications.length],
                      ['Existing parts touched', touched.length],
                    ] as const
                  ).map(([l, n]) => (
                    <div key={l} className="rounded-md border border-dashed border-hypo py-1.5">
                      <div className="text-[15px] font-semibold text-hypo">{n}</div>
                      <div className="text-[10.5px] text-fg-subtle">{l}</div>
                    </div>
                  ))}
                </div>
              </section>

              {touched.length > 0 && (
                <section>
                  <SectionTitle>Existing Meridian parts this proposal touches</SectionTitle>
                  <div className="flex flex-wrap gap-1" onClick={onClose}>
                    {touched.map((id) => (
                      <EntityChip key={id} id={id} />
                    ))}
                  </div>
                  <p className="mb-0 mt-1 text-[11.5px] text-fg-subtle">Open any of them and use the Impact tab to see what depends on it.</p>
                </section>
              )}

              {layer.entities.length > 0 && (
                <section>
                  <SectionTitle>Proposed components</SectionTitle>
                  <div className="overflow-hidden rounded-md border border-line">
                    {layer.entities.map((e) => (
                      <div key={e.id} className="flex items-start gap-2 border-t border-line px-2 py-1.5 first:border-t-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold">{e.name}</div>
                          <div className="text-[11.5px] text-fg-muted">{e.summary}</div>
                        </div>
                        {!layer.builtIn && (
                          <button type="button" aria-label={`Delete ${e.name}`} onClick={() => ws.removeHypoEntity(e.id)} className="rounded p-1 text-fg-subtle hover:text-bad">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {layer.relations.length > 0 && (
                <section>
                  <SectionTitle>Proposed connections</SectionTitle>
                  <div className="overflow-hidden rounded-md border border-line">
                    {layer.relations.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 border-t border-line px-2 py-1.5 text-[12px] first:border-t-0">
                        <span className="min-w-0 flex-1">
                          <b>{model.entity(r.from)?.name ?? layer.entities.find((e) => e.id === r.from)?.name ?? r.from}</b> <span className="text-fg-muted">{RELATION_VERB[r.kind]}</span>{' '}
                          <b>{model.entity(r.to)?.name ?? layer.entities.find((e) => e.id === r.to)?.name ?? r.to}</b>
                          {r.label && <span className="ml-1.5 font-mono text-[11px] text-fg-subtle">{r.label}</span>}
                        </span>
                        {!layer.builtIn && (
                          <button type="button" aria-label="Delete connection" onClick={() => ws.removeHypoRelation(r.id)} className="rounded p-1 text-fg-subtle hover:text-bad">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {layer.modifications.length > 0 && (
                <section>
                  <SectionTitle>Proposed changes to existing parts</SectionTitle>
                  <div className="overflow-hidden rounded-md border border-line">
                    {layer.modifications.map((m) => (
                      <div key={m.id} className="flex items-start gap-2 border-t border-line px-2 py-1.5 text-[12px] first:border-t-0">
                        <Badge color="var(--k-hypo)">{m.op === 'add-field' ? 'add field' : m.op}</Badge>
                        <span className="min-w-0 flex-1">
                          <b>{baseModel.entity(m.target)?.name ?? m.target}</b>: {m.summary}
                          {m.field && (
                            <code className="ml-1">
                              {m.field.name}: {m.field.type}
                            </code>
                          )}
                          {m.note && <span className="block text-[11.5px] text-fg-muted">{m.note}</span>}
                        </span>
                        {!layer.builtIn && (
                          <button type="button" aria-label="Discard change" onClick={() => ws.removeModification(m.id)} className="rounded p-1 text-fg-subtle hover:text-bad">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {layer.entities.length + layer.relations.length + layer.modifications.length === 0 && (
                <Empty title="This layer is empty">Add a component here, or use “What if…” in the inspector on any real component to propose a connection, a new field, a change or a removal.</Empty>
              )}
            </div>
          )}
        </div>
      </div>
      {adding && <HypotheticalComponentDialog open onClose={() => setAdding(false)} />}
    </Dialog>
  );
}
