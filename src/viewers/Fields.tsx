/** Entity references and field tables — the building blocks of every inspector. */
import type { ReactNode } from 'react';
import { KeyRound, Link2 } from 'lucide-react';
import type { FieldDef } from '@/model';
import { useApp } from '@/state/app';
import { useModel } from '@/state/hooks';
import { cn, Tip } from '@/ui/primitives';
import { entityColor, KindIcon } from '@/ui/kinds';

/** A clickable reference to a model entity. Selecting it updates the shared selection. */
export function EntityChip({ id, label, onClick, className, showKind = true }: { id: string; label?: ReactNode; onClick?: (id: string) => void; className?: string; showKind?: boolean }) {
  const model = useModel();
  const selectEntity = useApp((s) => s.selectEntity);
  const e = model.entity(id);
  if (!e) {
    return (
      <span className={cn('inline-flex items-center rounded border border-dashed border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle', className)} title="Not in the model">
        {label ?? id}
      </span>
    );
  }
  const color = entityColor(e);
  return (
    <Tip label={e.summary} side="top">
      <button
        type="button"
        onClick={() => (onClick ? onClick(id) : selectEntity(id, { openInspector: true }))}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11.5px] font-medium transition-colors hover:brightness-95',
          e.confidence === 'hypothetical' && 'border-dashed',
          className,
        )}
        style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, var(--line))`, background: `color-mix(in srgb, ${color} 9%, var(--surface))` }}
        data-entity={id}
      >
        {showKind && <KindIcon kind={e.kind} size={11} className="shrink-0" />}
        <span className="truncate text-fg">{label ?? e.name}</span>
      </button>
    </Tip>
  );
}

interface FieldTableProps {
  fields: FieldDef[];
  /** Field names to emphasise. */
  highlight?: string[];
  /** Database presentation: show key/index markers and FK targets. */
  db?: boolean;
  onPick?: (field: FieldDef) => void;
  picked?: string | null;
  compact?: boolean;
  /** Fields proposed by a hypothetical layer (rendered dashed, purple). */
  proposed?: FieldDef[];
}

function Row({ f, depth, highlight, db, onPick, picked, proposed }: { f: FieldDef; depth: number; highlight?: string[]; db?: boolean; onPick?: (f: FieldDef) => void; picked?: string | null; proposed?: boolean }) {
  const hl = highlight?.includes(f.name);
  return (
    <>
      <tr
        className={cn('border-t border-line align-top', hl && 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]', picked === f.name && 'outline outline-2 -outline-offset-2 outline-accent', proposed && 'bg-[color-mix(in_srgb,var(--k-hypo)_9%,transparent)]')}
        data-field={f.name}
      >
        <td className="py-1.5 pl-2 pr-2" style={{ paddingLeft: 8 + depth * 14 }}>
          <button type="button" disabled={!onPick} onClick={() => onPick?.(f)} className={cn('flex items-center gap-1 text-left font-mono text-[11.5px] font-semibold text-fg', onPick && 'hover:underline')}>
            {db && f.primaryKey && (
              <Tip label="Primary key" side="top">
                <KeyRound size={11} className="text-[color:var(--k-event)]" />
              </Tip>
            )}
            {db && f.references && (
              <Tip label="Foreign key" side="top">
                <Link2 size={11} className="text-[color:var(--c-data)]" />
              </Tip>
            )}
            {f.name}
            {f.required === false && <span className="font-normal text-fg-subtle">?</span>}
            {proposed && <span className="ml-1 rounded border border-dashed border-hypo px-1 font-sans text-[9.5px] font-semibold uppercase text-hypo">proposed</span>}
          </button>
        </td>
        <td className="py-1.5 pr-2 font-mono text-[11px] text-[color:var(--k-type)]">
          <span className="break-words">{f.type}</span>
          {f.typeRef && (
            <div className="mt-0.5">
              <EntityChip id={f.typeRef} showKind={false} />
            </div>
          )}
          {f.references && (
            <div className="mt-0.5">
              <EntityChip id={f.references} />
            </div>
          )}
        </td>
        <td className="py-1.5 pr-2 text-[11.5px] text-fg-muted">
          {f.description}
          {f.values && (
            <div className="mt-1 flex flex-wrap gap-1">
              {f.values.map((v) => (
                <code key={v} className="rounded bg-surface-2 px-1 text-[10.5px] text-fg">
                  {v}
                </code>
              ))}
            </div>
          )}
          {f.rules && f.rules.length > 0 && (
            <ul className="mt-1 list-none space-y-0.5 p-0">
              {f.rules.map((r) => (
                <li key={r} className="flex gap-1.5 text-[11px] text-fg">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-warn" />
                  {r}
                </li>
              ))}
            </ul>
          )}
          {db && (f.unique || f.indexed) && (
            <div className="mt-1 flex gap-1">
              {f.unique && <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-fg-subtle">unique</span>}
              {f.indexed && <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-fg-subtle">indexed</span>}
            </div>
          )}
        </td>
      </tr>
      {f.children?.map((c) => <Row key={c.name} f={c} depth={depth + 1} highlight={highlight} db={db} onPick={onPick} picked={picked} />)}
    </>
  );
}

/** Typed field list for a request body, DTO, or database table. */
export function FieldTable({ fields, highlight, db, onPick, picked, proposed }: FieldTableProps) {
  if (!fields.length && !proposed?.length) return <div className="text-[12px] italic text-fg-subtle">No fields.</div>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-left" data-testid="field-table">
        <thead>
          <tr className="bg-surface-2 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            <th className="w-[30%] py-1 pl-2 pr-2">{db ? 'Column' : 'Field'}</th>
            <th className="w-[26%] py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Notes &amp; rules</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <Row key={f.name} f={f} depth={0} highlight={highlight} db={db} onPick={onPick} picked={picked} />
          ))}
          {proposed?.map((f) => <Row key={`p-${f.name}`} f={f} depth={0} db={db} proposed />)}
        </tbody>
      </table>
    </div>
  );
}
