/** Example database rows, with optional before/after diff highlighting. */
import { useMemo } from 'react';
import type { RowDiff, TableDiff } from '@/model';
import { cn } from '@/ui/primitives';
import { formatMinor } from '@/model';

const CHANGE_STYLE: Record<RowDiff['change'], string> = {
  added: 'bg-[color-mix(in_srgb,var(--ok)_13%,transparent)]',
  changed: 'bg-[color-mix(in_srgb,var(--warn)_10%,transparent)]',
  removed: 'bg-[color-mix(in_srgb,var(--bad)_11%,transparent)] line-through opacity-70',
  same: '',
};
const CHANGE_LABEL: Record<RowDiff['change'], string> = { added: 'new', changed: 'updated', removed: 'deleted', same: '' };

function cell(value: unknown, column: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && /Minor$/.test(column)) return `${value} (${formatMinor(value)})`;
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  // ISO timestamps: keep the date + minute.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace('T', ' ');
  return s;
}

interface DbTableProps {
  table: string;
  /** Plain rows (no diff) … */
  rows?: Record<string, unknown>[];
  /** … or a diff produced by `diffStates`. */
  diff?: TableDiff;
  /** Show only rows that changed (diff mode). */
  changedOnly?: boolean;
  /** Preferred column order; unknown columns follow. */
  columns?: string[];
  maxRows?: number;
  onPickTable?: (table: string) => void;
  highlightRowIds?: string[];
  compact?: boolean;
}

export function DbTable({ table, rows, diff, changedOnly, columns, maxRows = 12, onPickTable, highlightRowIds, compact }: DbTableProps) {
  const diffs: RowDiff[] = useMemo(() => {
    if (diff) return changedOnly ? diff.rows.filter((r) => r.change !== 'same') : diff.rows;
    return (rows ?? []).map((r) => ({ id: String(r.id), change: 'same' as const, after: r, fields: [] }));
  }, [diff, rows, changedOnly]);

  const cols = useMemo(() => {
    const seen = new Set<string>();
    for (const c of columns ?? []) seen.add(c);
    for (const d of diffs) for (const k of Object.keys(d.after ?? d.before ?? {})) seen.add(k);
    return [...seen];
  }, [diffs, columns]);

  const shown = diffs.slice(-maxRows);
  const hiddenCount = diffs.length - shown.length;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface" data-testid={`db-table-${table}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 py-1">
        <button type="button" disabled={!onPickTable} onClick={() => onPickTable?.(table)} className={cn('font-mono text-[11.5px] font-semibold text-[color:var(--k-db)]', onPickTable && 'hover:underline')}>
          {table}
        </button>
        <span className="text-[10.5px] text-fg-subtle">
          {diffs.length} row{diffs.length === 1 ? '' : 's'}
          {diff && diff.changed && <span className="ml-1.5 font-semibold text-warn">changed</span>}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="px-2 py-2 text-[11.5px] italic text-fg-subtle">{changedOnly ? 'No rows changed.' : 'Empty.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-fg-subtle">
                {diff && <th className="px-2 py-1 font-semibold" />}
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-1 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hiddenCount > 0 && (
                <tr className="border-t border-line">
                  <td colSpan={cols.length + (diff ? 1 : 0)} className="px-2 py-1 font-sans text-[10.5px] italic text-fg-subtle">
                    … {hiddenCount} earlier row{hiddenCount === 1 ? '' : 's'} not shown
                  </td>
                </tr>
              )}
              {shown.map((d) => {
                const row = d.after ?? d.before ?? {};
                return (
                  <tr key={d.id} className={cn('border-t border-line', CHANGE_STYLE[d.change], highlightRowIds?.includes(d.id) && 'outline outline-2 -outline-offset-2 outline-accent')} data-row={d.id} data-change={d.change}>
                    {diff && (
                      <td className="whitespace-nowrap px-2 py-1 font-sans text-[9.5px] font-bold uppercase" style={{ color: d.change === 'added' ? 'var(--ok)' : d.change === 'changed' ? 'var(--warn)' : d.change === 'removed' ? 'var(--bad)' : undefined }}>
                        {CHANGE_LABEL[d.change]}
                      </td>
                    )}
                    {cols.map((c) => {
                      const changed = d.change === 'changed' && d.fields.includes(c);
                      return (
                        <td key={c} className={cn('max-w-[220px] px-2 text-fg', compact ? 'py-0.5' : 'py-1', changed && 'font-bold')} title={String(row[c] ?? '')}>
                          {changed && d.before && (
                            <span className="mr-1 text-fg-subtle line-through">{cell(d.before[c], c)}</span>
                          )}
                          <span className={cn('inline-block max-w-full truncate align-bottom', changed && 'rounded bg-[color-mix(in_srgb,var(--warn)_28%,transparent)] px-1')}>{cell(row[c], c)}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
