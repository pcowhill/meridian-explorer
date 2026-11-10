/**
 * Interactive demonstration of how Meridian derives balances: edit the example
 * ledger entries and watch current / available recompute with the same rules
 * as `deriveBalances` (packages/shared/src/ledger.ts).
 */
import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { contributionOf, deriveBalances, formatMinor, type LedgerRow } from '@/model';
import { Button, cn, Tip } from '@/ui/primitives';

const STATUSES: LedgerRow['status'][] = ['posted', 'pending', 'held', 'disputed', 'failed', 'reversed'];

const STATUS_COLOR: Record<LedgerRow['status'], string> = {
  posted: 'var(--ok)',
  pending: 'var(--warn)',
  held: 'var(--c-call)',
  disputed: 'var(--c-security)',
  failed: 'var(--fg-subtle)',
  reversed: 'var(--fg-subtle)',
};

export const DEFAULT_LEDGER: LedgerRow[] = [
  { id: 'le_001', amountMinor: 250000, direction: 'credit', status: 'posted', origin: 'seed', description: 'Opening deposit' },
  { id: 'le_002', amountMinor: 4890, direction: 'debit', status: 'posted', origin: 'card', description: 'QuickFuel' },
  { id: 'le_003', amountMinor: 12000, direction: 'debit', status: 'pending', origin: 'payment', description: 'Bill payment — City Power & Light' },
  { id: 'le_005', amountMinor: 30000, direction: 'credit', status: 'pending', origin: 'deposit', description: 'Mobile check deposit' },
  { id: 'le_006', amountMinor: 4210, direction: 'debit', status: 'disputed', origin: 'card', description: 'Trattoria Romana' },
];

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-fg-subtle">—</span>;
  return <span style={{ color: value > 0 ? 'var(--ok)' : 'var(--bad)' }}>{value > 0 ? '+' : '−'}{formatMinor(Math.abs(value))}</span>;
}

interface Props {
  /** Initial entries (defaults to an example based on the seeded checking account). */
  entries?: LedgerRow[];
  /** Controlled mode: called on every edit. */
  onChange?: (entries: LedgerRow[]) => void;
  readOnly?: boolean;
  compact?: boolean;
  title?: string;
}

export function BalanceCalculator({ entries: initial = DEFAULT_LEDGER, onChange, readOnly, compact, title = 'Everyday Checking — example ledger' }: Props) {
  const [inner, setInner] = useState<LedgerRow[]>(initial);
  const entries = onChange ? initial : inner;
  const set = (next: LedgerRow[]) => (onChange ? onChange(next) : setInner(next));
  const balances = useMemo(() => deriveBalances(entries), [entries]);
  const [hover, setHover] = useState<number | null>(null);

  const update = (i: number, patch: Partial<LedgerRow>) => set(entries.map((e, k) => (k === i ? { ...e, ...patch } : e)));

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="balance-calculator">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5">
        <div className="text-[12px] font-semibold">{title}</div>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set([...entries, { id: `le_new${entries.length + 1}`, amountMinor: 5000, direction: 'debit', status: 'pending', origin: 'card', description: 'New entry' }])}>
              Add entry
            </Button>
            <Tip label="Reset the example" side="top">
              <button type="button" aria-label="Reset the example" onClick={() => set(DEFAULT_LEDGER)} className="rounded p-1 text-fg-muted hover:bg-surface-3">
                <RotateCcw size={12} />
              </button>
            </Tip>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-fg-subtle">
              <th className="px-2 py-1 font-semibold">Description</th>
              <th className="px-1 py-1 font-semibold">Direction</th>
              <th className="px-1 py-1 text-right font-semibold">amountMinor</th>
              <th className="px-1 py-1 font-semibold">Status</th>
              <th className="px-2 py-1 text-right font-semibold">→ Current</th>
              <th className="px-2 py-1 text-right font-semibold">→ Available</th>
              {!readOnly && <th className="w-6" />}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const c = contributionOf(e);
              const dead = e.status === 'failed' || e.status === 'reversed';
              return (
                <tr key={e.id ?? i} className={cn('border-t border-line', hover === i && 'bg-surface-2')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} data-entry={e.id}>
                  <td className={cn('max-w-[180px] truncate px-2 py-1', dead && 'text-fg-subtle line-through')} title={e.description}>
                    {readOnly ? e.description : <input aria-label="Description" className="w-full bg-transparent outline-none focus:underline" value={e.description ?? ''} onChange={(ev) => update(i, { description: ev.target.value })} />}
                    {!compact && e.origin && <span className="ml-1 rounded bg-surface-2 px-1 font-mono text-[9.5px] text-fg-subtle">{e.origin}</span>}
                  </td>
                  <td className="px-1 py-1">
                    {readOnly ? (
                      e.direction
                    ) : (
                      <select aria-label="Direction" className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[11px]" value={e.direction} onChange={(ev) => update(i, { direction: ev.target.value as LedgerRow['direction'] })}>
                        <option value="credit">credit</option>
                        <option value="debit">debit</option>
                      </select>
                    )}
                  </td>
                  <td className="px-1 py-1 text-right font-mono">
                    {readOnly ? (
                      e.amountMinor
                    ) : (
                      <input
                        aria-label="Amount in minor units"
                        type="number"
                        min={0}
                        step={100}
                        className="w-20 rounded border border-line bg-surface px-1 py-0.5 text-right font-mono text-[11px]"
                        value={e.amountMinor}
                        onChange={(ev) => update(i, { amountMinor: Math.max(0, Math.round(Number(ev.target.value) || 0)) })}
                      />
                    )}
                    <div className="text-[10px] text-fg-subtle">{formatMinor(e.amountMinor)}</div>
                  </td>
                  <td className="px-1 py-1">
                    {readOnly ? (
                      <span className="rounded px-1 font-mono text-[10.5px] font-semibold" style={{ color: STATUS_COLOR[e.status], background: `color-mix(in srgb, ${STATUS_COLOR[e.status]} 14%, transparent)` }}>
                        {e.status}
                      </span>
                    ) : (
                      <select
                        aria-label="Status"
                        className="rounded border px-1 py-0.5 font-mono text-[11px] font-semibold"
                        style={{ color: STATUS_COLOR[e.status], borderColor: `color-mix(in srgb, ${STATUS_COLOR[e.status]} 50%, var(--line))`, background: 'var(--surface)' }}
                        value={e.status}
                        onChange={(ev) => update(i, { status: ev.target.value as LedgerRow['status'] })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    <Delta value={c.current} />
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    <Delta value={c.available} />
                  </td>
                  {!readOnly && (
                    <td className="pr-1">
                      <button type="button" aria-label={`Remove ${e.description}`} onClick={() => set(entries.filter((_, k) => k !== i))} className="rounded p-0.5 text-fg-subtle hover:text-bad">
                        <Trash2 size={11} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold">
              <td className="px-2 py-1.5" colSpan={4}>
                Derived balances
              </td>
              <td className="px-2 py-1.5 text-right font-mono" data-testid="balance-current">
                {formatMinor(balances.currentMinor)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono" data-testid="balance-available">
                {formatMinor(balances.availableMinor)}
              </td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t border-line px-2.5 py-1.5 text-[11.5px] text-fg-muted" aria-live="polite">
        {hover !== null && entries[hover] ? (
          <span>
            <b className="text-fg">{entries[hover].description}:</b> {contributionOf(entries[hover]).rule}
          </span>
        ) : (
          <span>
            Current counts <b>posted</b> and <b>disputed</b> entries. Available also subtracts <b>pending debits</b> ({formatMinor(balances.pendingDebitMinor)}) and <b>holds</b> ({formatMinor(balances.heldMinor)}); pending credits ({formatMinor(balances.pendingCreditMinor)}) are not spendable yet.
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact current/available readout for one account, with change arrows. */
export function BalancePill({ label, current, available, prevCurrent, prevAvailable }: { label: string; current: number; available: number; prevCurrent?: number; prevAvailable?: number }) {
  const changed = (a: number, b?: number) => b !== undefined && a !== b;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-1.5" data-testid="balance-pill">
      <div className="truncate text-[11px] font-semibold text-fg-muted">{label}</div>
      <div className="mt-0.5 flex gap-4">
        {(
          [
            ['Current', current, prevCurrent],
            ['Available', available, prevAvailable],
          ] as const
        ).map(([name, value, prev]) => (
          <div key={name}>
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-fg-subtle">{name}</div>
            <div className={cn('font-mono text-[13px] font-semibold', changed(value, prev) && 'rounded bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] px-1')}>{formatMinor(value)}</div>
            {changed(value, prev) && (
              <div className="font-mono text-[10px]" style={{ color: value > prev! ? 'var(--ok)' : 'var(--bad)' }}>
                {value > prev! ? '▲' : '▼'} {formatMinor(Math.abs(value - prev!))} <span className="text-fg-subtle">from {formatMinor(prev!)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
