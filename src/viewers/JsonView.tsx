/**
 * Interactive JSON tree: expand/collapse, highlight fields, hide irrelevant
 * ones, show field types from the model, and diff against another value.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react';
import type { FieldDef } from '@/model';
import { cn, Tip } from '@/ui/primitives';

type Path = string;

export interface JsonViewProps {
  data: unknown;
  /** Compare against this value: added/changed/removed keys are marked. */
  compareTo?: unknown;
  /** Dot-paths to emphasise, e.g. `amountMinor` or `accounts.0.balances`. */
  highlight?: string[];
  /** Field definitions used to annotate keys with their declared type. */
  fields?: FieldDef[];
  /** Depth expanded initially (default 2). */
  defaultDepth?: number;
  /** Allow hiding keys (eye icon on hover). */
  hideable?: boolean;
  /** Controlled hidden paths. */
  hidden?: string[];
  onHiddenChange?: (hidden: string[]) => void;
  /** Called when a key is clicked. */
  onPick?: (path: string, value: unknown) => void;
  /** Path currently picked (rendered with a ring). */
  picked?: string | null;
  showTypes?: boolean;
  showToolbar?: boolean;
  className?: string;
  /** Root label, e.g. a type name. */
  label?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeOfValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

function fieldAt(fields: FieldDef[] | undefined, path: string): FieldDef | undefined {
  if (!fields) return undefined;
  const parts = path.split('.').filter((p) => !/^\d+$/.test(p));
  let list: FieldDef[] | undefined = fields;
  let found: FieldDef | undefined;
  for (const part of parts) {
    found = list?.find((f) => f.name === part || f.name === `${part}?`);
    if (!found) return undefined;
    list = found.children;
  }
  return found;
}

type DiffMark = 'added' | 'changed' | 'removed' | undefined;

function diffMark(value: unknown, other: unknown, hasOther: boolean, compare: boolean): DiffMark {
  if (!compare) return undefined;
  if (!hasOther) return 'added';
  if (isObj(value) || Array.isArray(value)) return undefined; // containers are marked through their children
  return JSON.stringify(value) === JSON.stringify(other) ? undefined : 'changed';
}

const MARK_STYLE: Record<NonNullable<DiffMark>, string> = {
  added: 'bg-[color-mix(in_srgb,var(--ok)_16%,transparent)]',
  changed: 'bg-[color-mix(in_srgb,var(--warn)_18%,transparent)]',
  removed: 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] line-through opacity-70',
};

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-fg-subtle">null</span>;
  if (value === undefined) return <span className="text-fg-subtle">undefined</span>;
  if (typeof value === 'string') return <span className="break-all text-[color:var(--k-db)]">"{value}"</span>;
  if (typeof value === 'number') return <span className="text-[color:var(--k-app)]">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-[color:var(--k-event)]">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

interface NodeProps {
  name: string | null;
  value: unknown;
  other: unknown;
  hasOther: boolean;
  path: Path;
  depth: number;
  ctx: Ctx;
  removed?: boolean;
  last: boolean;
}

interface Ctx {
  compare: boolean;
  highlight: Set<string>;
  hidden: Set<string>;
  collapsed: Map<string, boolean>;
  toggle: (path: string, current: boolean) => void;
  toggleHidden: (path: string) => void;
  hideable: boolean;
  fields?: FieldDef[];
  showTypes: boolean;
  defaultDepth: number;
  onPick?: (path: string, value: unknown) => void;
  picked?: string | null;
}

const Node = memo(function Node({ name, value, other, hasOther, path, depth, ctx, removed, last }: NodeProps) {
  const container = isObj(value) || Array.isArray(value);
  const open = ctx.collapsed.has(path) ? !ctx.collapsed.get(path) : depth < ctx.defaultDepth;
  const mark: DiffMark = removed ? 'removed' : diffMark(value, other, hasOther, ctx.compare);
  const highlighted = ctx.highlight.has(path) || (name !== null && ctx.highlight.has(name));
  const field = name !== null ? fieldAt(ctx.fields, path) : undefined;
  const isHidden = ctx.hidden.has(path);
  if (isHidden && !ctx.hideable) return null;

  const keyEl =
    name !== null ? (
      <button
        type="button"
        onClick={() => ctx.onPick?.(path, value)}
        className={cn('rounded px-0.5 text-left font-medium text-fg hover:underline', highlighted && 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]', ctx.picked === path && 'ring-2 ring-accent')}
        title={field?.description ?? (ctx.onPick ? 'Click to trace this field' : undefined)}
        tabIndex={ctx.onPick ? 0 : -1}
      >
        {/^\d+$/.test(name) ? <span className="text-fg-subtle">{name}</span> : name}
      </button>
    ) : null;

  const typeHint =
    ctx.showTypes && (field || !container) ? (
      <span className="ml-2 select-none text-[10.5px] text-fg-subtle opacity-0 transition-opacity group-hover/row:opacity-100">{field?.type ?? typeOfValue(value)}</span>
    ) : null;

  const hideBtn =
    ctx.hideable && name !== null ? (
      <button
        type="button"
        aria-label={isHidden ? `Show ${name}` : `Hide ${name}`}
        onClick={() => ctx.toggleHidden(path)}
        className="ml-1 rounded p-0.5 text-fg-subtle opacity-0 hover:text-fg group-hover/row:opacity-100 focus-visible:opacity-100"
      >
        {isHidden ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
    ) : null;

  if (isHidden) {
    return (
      <div className="group/row flex items-center pl-4 text-fg-subtle" style={{ marginLeft: depth * 14 }}>
        <span className="italic">{name}: hidden</span>
        {hideBtn}
      </div>
    );
  }

  if (!container) {
    return (
      <div className={cn('group/row flex items-baseline rounded-sm pl-4', mark && MARK_STYLE[mark])} style={{ marginLeft: depth * 14 }} data-path={path} data-diff={mark}>
        {keyEl}
        {name !== null && <span className="mr-1 text-fg-subtle">:</span>}
        <Scalar value={value} />
        {!last && <span className="text-fg-subtle">,</span>}
        {mark === 'changed' && hasOther && (
          <span className="ml-2 text-[10.5px] text-fg-subtle">
            was <Scalar value={other} />
          </span>
        )}
        {typeHint}
        {hideBtn}
      </div>
    );
  }

  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value as Record<string, unknown>);
  const otherObj = isObj(other) || Array.isArray(other) ? (other as Record<string, unknown>) : undefined;
  const removedKeys = ctx.compare && otherObj && !Array.isArray(value) ? Object.keys(otherObj).filter((k) => !(k in (value as Record<string, unknown>))) : [];
  const [openBr, closeBr] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];

  return (
    <div data-path={path}>
      <div className={cn('group/row flex items-baseline rounded-sm', mark && MARK_STYLE[mark])} style={{ marginLeft: depth * 14 }}>
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => ctx.toggle(path, open)} className="mr-0.5 flex h-4 w-3.5 shrink-0 items-center justify-center text-fg-subtle hover:text-fg">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {keyEl}
        {name !== null && <span className="mr-1 text-fg-subtle">:</span>}
        <span className="text-fg-subtle">{openBr}</span>
        {!open && (
          <button type="button" onClick={() => ctx.toggle(path, open)} className="mx-1 rounded bg-surface-2 px-1 text-[10.5px] text-fg-subtle hover:text-fg">
            {entries.length} {Array.isArray(value) ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}
          </button>
        )}
        {!open && <span className="text-fg-subtle">{closeBr}{!last && ','}</span>}
        {typeHint}
        {hideBtn}
      </div>
      {open && (
        <>
          {entries.map(([k, v], i) => (
            <Node
              key={k}
              name={k}
              value={v}
              other={otherObj?.[k]}
              hasOther={!!otherObj && k in otherObj}
              path={path ? `${path}.${k}` : k}
              depth={depth + 1}
              ctx={ctx}
              last={i === entries.length - 1 && removedKeys.length === 0}
            />
          ))}
          {removedKeys.map((k, i) => (
            <Node key={`removed-${k}`} name={k} value={otherObj![k]} other={undefined} hasOther={false} path={path ? `${path}.${k}` : k} depth={depth + 1} ctx={ctx} removed last={i === removedKeys.length - 1} />
          ))}
          <div className="pl-4 text-fg-subtle" style={{ marginLeft: depth * 14 }}>
            {closeBr}
            {!last && ','}
          </div>
        </>
      )}
    </div>
  );
});

export function JsonView({
  data,
  compareTo,
  highlight,
  fields,
  defaultDepth = 2,
  hideable = false,
  hidden,
  onHiddenChange,
  onPick,
  picked,
  showTypes = true,
  showToolbar = false,
  className,
  label,
}: JsonViewProps) {
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(new Map());
  const [innerHidden, setInnerHidden] = useState<string[]>([]);
  const hiddenList = hidden ?? innerHidden;
  const [copied, setCopied] = useState(false);

  const toggle = useCallback((path: string, currentlyOpen: boolean) => {
    setCollapsed((m) => new Map(m).set(path, currentlyOpen));
  }, []);
  const toggleHidden = useCallback(
    (path: string) => {
      const next = hiddenList.includes(path) ? hiddenList.filter((p) => p !== path) : [...hiddenList, path];
      if (onHiddenChange) onHiddenChange(next);
      else setInnerHidden(next);
    },
    [hiddenList, onHiddenChange],
  );

  const ctx: Ctx = useMemo(
    () => ({
      compare: compareTo !== undefined,
      highlight: new Set(highlight ?? []),
      hidden: new Set(hiddenList),
      collapsed,
      toggle,
      toggleHidden,
      hideable,
      fields,
      showTypes,
      defaultDepth,
      onPick,
      picked,
    }),
    [compareTo, highlight, hiddenList, collapsed, toggle, toggleHidden, hideable, fields, showTypes, defaultDepth, onPick, picked],
  );

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (data === undefined) return <div className="text-[12px] italic text-fg-subtle">No example data.</div>;

  return (
    <div className={cn('relative rounded-md border border-line bg-surface-2/50 font-mono text-[11.5px] leading-[1.55]', className)} data-testid="json-view">
      {(showToolbar || label) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1 font-sans">
          <span className="truncate text-[11px] font-semibold text-fg-muted">{label}</span>
          <div className="flex items-center gap-1">
            {hiddenList.length > 0 && (
              <button type="button" className="rounded px-1 text-[10.5px] text-fg-subtle hover:text-fg" onClick={() => (onHiddenChange ? onHiddenChange([]) : setInnerHidden([]))}>
                Show {hiddenList.length} hidden
              </button>
            )}
            <button type="button" className="rounded px-1 text-[10.5px] text-fg-subtle hover:text-fg" onClick={() => setCollapsed(new Map([['', false]]))}>
              Reset
            </button>
            <Tip label={copied ? 'Copied' : 'Copy JSON'} side="top">
              <button type="button" aria-label="Copy JSON" onClick={copy} className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
                <Copy size={11} />
              </button>
            </Tip>
          </div>
        </div>
      )}
      <div className="overflow-x-auto p-2">
        <Node name={null} value={data} other={compareTo} hasOther={compareTo !== undefined} path="" depth={0} ctx={ctx} last />
      </div>
    </div>
  );
}
