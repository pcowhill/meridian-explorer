/**
 * "New from endpoint": a searchable list of every API endpoint in the model.
 * Picking one opens an automatically assembled trace (`trace:<endpoint id>`).
 */
import { useMemo, useState } from 'react';
import type { Contract } from '@/model';
import { useModel } from '@/state/hooks';
import { cn, Dialog, inputClass } from '@/ui/primitives';
import { MethodBadge } from '@/ui/kinds';

export function endpointMatches(c: Contract, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = `${c.method} ${c.path} ${c.summary} ${c.id}`.toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}

export function EndpointPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (endpointId: string) => void }) {
  const model = useModel();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const all = useMemo(() => [...model.contracts.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)), [model]);
  const rows = useMemo(() => all.filter((c) => endpointMatches(c, q)), [all, q]);
  const pick = (id: string) => {
    onPick(id);
    setQ('');
    setActive(0);
  };
  return (
    <Dialog open={open} onClose={onClose} title="New scenario from an endpoint" width={640} bodyClassName="p-0!">
      <div className="border-b border-line p-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(rows.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && rows[active]) {
              e.preventDefault();
              pick(rows[active].id);
            }
          }}
          placeholder="Search endpoints — e.g. “transfers”, “POST ops”, “balance”"
          aria-label="Search endpoints"
          data-testid="endpoint-search"
          className={inputClass}
        />
        <div className="mt-1.5 text-[11.5px] text-fg-subtle">
          The trace is assembled from the endpoint’s contract — caller, request, guards, validation, calls, database work and response — and opens ready to present. Customize it to edit.
        </div>
      </div>
      <ul className="m-0 max-h-[52vh] list-none overflow-y-auto p-1" role="listbox" aria-label="Endpoints">
        {rows.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === active}>
            <button
              type="button"
              data-endpoint={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c.id)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === active ? 'bg-surface-2' : 'hover:bg-surface-2', c.confidence === 'hypothetical' && 'hypothetical border border-dashed border-hypo')}
            >
              <span className="w-[54px] shrink-0">
                <MethodBadge method={c.method} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] font-semibold text-fg">{c.path}</span>
                <span className="block truncate text-[11.5px] text-fg-muted">{c.summary}</span>
              </span>
              <span className="shrink-0 text-[10.5px] text-fg-subtle">{c.flow.length} flow steps</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-fg-subtle">No endpoint matches “{q}”.</li>}
      </ul>
    </Dialog>
  );
}
