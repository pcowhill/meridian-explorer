/**
 * Non-destructive "what if" tools. Everything created here goes into a
 * hypothetical layer in the workspace — never into the Meridian baseline — and
 * is rendered as hypothetical in every mode.
 */
import { useMemo, useState } from 'react';
import { FlaskConical, Plus } from 'lucide-react';
import { KIND_LABEL, RELATION_VERB, type Entity, type EntityKind, type RelationKind } from '@/model';
import { useApp } from '@/state/app';
import { useModel, useSearchIndex } from '@/state/hooks';
import { newId, useWorkspace } from '@/state/workspace';
import { Button, Dialog, Field, inputClass, MenuItem, MenuLabel, Popover } from '@/ui/primitives';
import { EntityChip } from '@/viewers/Fields';

/** Inspector menu: propose a change to an existing (real) entity. */
export function ProposeChange({ entity }: { entity: Entity }) {
  const addModification = useWorkspace((s) => s.addModification);
  const toast = useApp((s) => s.toast);
  const [dialog, setDialog] = useState<null | 'field' | 'change' | 'connect'>(null);
  const model = useModel();
  const alreadyRemoved = model.isProposedRemoval(entity.id);
  const canHaveFields = !!entity.fields || entity.kind === 'endpoint' || entity.kind === 'type' || entity.kind === 'db-model';

  return (
    <>
      <Popover
        trigger={(p) => (
          <Button size="sm" variant="ghost" icon={<FlaskConical size={12} />} className="text-hypo!" {...p}>
            What if…
          </Button>
        )}
        className="w-64"
      >
        {(close) => (
          <div role="menu">
            <MenuLabel>Hypothetical changes — the baseline is never modified</MenuLabel>
            <MenuItem
              onClick={() => {
                close();
                setDialog('connect');
              }}
              hint="Add a proposed component that talks to this"
            >
              Connect a new component…
            </MenuItem>
            {canHaveFields && (
              <MenuItem
                onClick={() => {
                  close();
                  setDialog('field');
                }}
                hint="See what a new field would touch"
              >
                Add a field…
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                close();
                setDialog('change');
              }}
              hint="Describe a proposed modification"
            >
              Note a change…
            </MenuItem>
            <MenuItem
              disabled={alreadyRemoved}
              danger
              onClick={() => {
                addModification({ id: newId('mod'), target: entity.id, op: 'remove', summary: `Remove ${entity.name}` });
                toast(`Marked ${entity.name} as a proposed removal`, 'ok');
                close();
              }}
            >
              Propose removing this
            </MenuItem>
          </div>
        )}
      </Popover>
      {dialog === 'field' && <AddFieldDialog entity={entity} onClose={() => setDialog(null)} />}
      {dialog === 'change' && <NoteChangeDialog entity={entity} onClose={() => setDialog(null)} />}
      {dialog === 'connect' && <HypotheticalComponentDialog open connectTo={entity.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function AddFieldDialog({ entity, onClose }: { entity: Entity; onClose: () => void }) {
  const addModification = useWorkspace((s) => s.addModification);
  const setTab = useApp((s) => s.setInspectorTab);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const [type, setType] = useState('string');
  const [required, setRequired] = useState(false);
  const [note, setNote] = useState('');
  const valid = /^[A-Za-z_][\w]*$/.test(name);
  const submit = () => {
    if (!valid) return;
    addModification({ id: newId('mod'), target: entity.id, op: 'add-field', summary: `Add field to ${entity.name}`, field: { name, type, required, description: note || undefined }, note: note || undefined });
    toast(`Proposed field “${name}” on ${entity.name}. See Impact for what depends on it.`, 'ok');
    setTab('impact');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Propose a new field on ${entity.name}`}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Add proposed field
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="m-0 text-[12.5px] text-fg-muted">The field is recorded as a hypothetical change and shown, marked “proposed”, wherever this structure appears. The Impact tab then lists everything that uses it.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Field name">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="externalReference" />
          </Field>
          <Field label="Type">
            <input className={inputClass} value={type} onChange={(e) => setType(e.target.value)} placeholder="string" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        <Field label="Why (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Carries the external provider’s transaction id" />
        </Field>
      </form>
    </Dialog>
  );
}

function NoteChangeDialog({ entity, onClose }: { entity: Entity; onClose: () => void }) {
  const addModification = useWorkspace((s) => s.addModification);
  const toast = useApp((s) => s.toast);
  const [summary, setSummary] = useState('');
  const submit = () => {
    if (!summary.trim()) return;
    addModification({ id: newId('mod'), target: entity.id, op: 'change', summary: summary.trim() });
    toast('Proposed change recorded', 'ok');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Propose a change to ${entity.name}`}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!summary.trim()} onClick={submit}>
            Record change
          </Button>
        </>
      }
    >
      <Field label="What would change?">
        <textarea autoFocus rows={3} className={`${inputClass} h-auto py-1.5`} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Accept movements submitted by an external service on behalf of a customer" />
      </Field>
    </Dialog>
  );
}

const HYPO_KINDS: EntityKind[] = ['external', 'app', 'subsystem', 'module', 'endpoint', 'function', 'type', 'db-model', 'event', 'page'];
const HYPO_RELATIONS: RelationKind[] = ['http', 'calls', 'websocket', 'emits', 'subscribes', 'reads', 'writes', 'uses-type', 'triggers'];

interface HypoDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select an existing entity to connect the new component to. */
  connectTo?: string;
  /** Default parent container. */
  parent?: string;
  /** Called with the new entity id after creation. */
  onCreated?: (id: string) => void;
}

/** Create a hypothetical component and (optionally) connect it to an existing one. Used by all three modes. */
export function HypotheticalComponentDialog({ open, onClose, connectTo, parent, onCreated }: HypoDialogProps) {
  const model = useModel();
  const index = useSearchIndex();
  const addHypoEntity = useWorkspace((s) => s.addHypoEntity);
  const addHypoRelation = useWorkspace((s) => s.addHypoRelation);
  const ensureEditingLayer = useWorkspace((s) => s.ensureEditingLayer);
  const layers = useWorkspace((s) => s.layers);
  const select = useApp((s) => s.select);
  const toast = useApp((s) => s.toast);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind>('external');
  const [summary, setSummary] = useState('');
  const [parentId, setParentId] = useState(parent ?? 'meridian');
  const [target, setTarget] = useState<string | null>(connectTo ?? null);
  const [targetQuery, setTargetQuery] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [relKind, setRelKind] = useState<RelationKind>('http');
  const [label, setLabel] = useState('');

  const containers = useMemo(() => [...model.entities.values()].filter((e) => ['system', 'app', 'subsystem', 'package', 'datastore', 'infra'].includes(e.kind)), [model]);
  const results = useMemo(() => (targetQuery ? index.search(targetQuery, 6, (r) => r.type === 'entity') : []), [index, targetQuery]);

  const submit = () => {
    if (!name.trim()) return;
    const layerId = ensureEditingLayer();
    const id = `hypo:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${newId('').slice(1, 6)}`;
    addHypoEntity(
      { id, kind, name: name.trim(), parent: parentId, summary: summary.trim() || `A proposed ${KIND_LABEL[kind].toLowerCase()} — not part of Meridian today.`, confidence: 'hypothetical', tags: ['hypothetical'] },
      layerId,
    );
    if (target) {
      const from = direction === 'out' ? id : target;
      const to = direction === 'out' ? target : id;
      addHypoRelation({ id: `rel:${from}->${to}:${relKind}:${newId('').slice(1, 5)}`, from, to, kind: relKind, label: label.trim() || undefined, summary: `Proposed: ${direction === 'out' ? name.trim() : model.entity(target)?.name} ${RELATION_VERB[relKind]} ${direction === 'out' ? model.entity(target)?.name : name.trim()}.`, confidence: 'hypothetical' }, layerId);
    }
    const layerName = layers.find((l) => l.id === layerId)?.name ?? 'My proposal';
    toast(`Added “${name.trim()}” to the hypothetical layer “${layerName}”`, 'ok');
    select({ type: 'entity', id }, { openInspector: true });
    onCreated?.(id);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <FlaskConical size={15} className="text-hypo" /> Add a hypothetical component
        </span>
      }
      width={520}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-fg-subtle">Saved to a hypothetical layer. Meridian’s baseline is untouched.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Plus size={13} />} disabled={!name.trim()} onClick={submit}>
            Add component
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <Field label="Name">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="SimPay gateway" aria-label="Component name" />
          </Field>
          <Field label="Kind">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as EntityKind)} aria-label="Component kind">
              {HYPO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="What is it? (optional)">
          <input className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="An external wallet that submits payments on a customer’s behalf" />
        </Field>
        <Field label="Lives inside">
          <select className={inputClass} value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Parent container">
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {model
                  .path(c.id)
                  .map((p) => p.name)
                  .join(' › ')}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="m-0 rounded-md border border-line p-2.5">
          <legend className="px-1 text-[11.5px] font-semibold text-fg-muted">Connect it to something that exists (optional)</legend>
          {target ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="rounded border border-dashed border-hypo px-1.5 py-0.5 font-medium text-hypo">{name || 'New component'}</span>
                <select className="h-7 rounded-md border border-line bg-surface px-1 text-[12px]" value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')} aria-label="Direction">
                  <option value="out">→</option>
                  <option value="in">←</option>
                </select>
                <select className="h-7 rounded-md border border-line bg-surface px-1 text-[12px]" value={relKind} onChange={(e) => setRelKind(e.target.value as RelationKind)} aria-label="Relationship kind">
                  {HYPO_RELATIONS.map((k) => (
                    <option key={k} value={k}>
                      {RELATION_VERB[k]}
                    </option>
                  ))}
                </select>
                <EntityChip id={target} onClick={() => undefined} />
                <button type="button" className="text-[11.5px] text-fg-subtle underline" onClick={() => setTarget(null)}>
                  change
                </button>
              </div>
              <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. POST /api/movements (kind: external_ach)" aria-label="Relationship label" />
            </div>
          ) : (
            <div>
              <input className={inputClass} value={targetQuery} onChange={(e) => setTargetQuery(e.target.value)} placeholder="Search Meridian: movements, ledger, POST /api/transfers…" aria-label="Search for a component to connect to" />
              {results.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-md border border-line">
                  {results.map((r) => (
                    <button key={r.key} type="button" onClick={() => setTarget(r.id)} className="flex w-full items-center gap-2 border-t border-line px-2 py-1 text-left text-[12px] first:border-t-0 hover:bg-surface-2">
                      <span className="w-20 shrink-0 text-[10px] uppercase text-fg-subtle">{r.kind}</span>
                      <span className="truncate font-medium">{r.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
