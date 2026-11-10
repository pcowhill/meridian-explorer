/** Pick any model entity: the scenario's participants first, then full-text search over the model. */
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModel, useSearchIndex } from '@/state/hooks';
import { cn, inputClass, Popover } from '@/ui/primitives';
import { entityColor, KindIcon } from '@/ui/kinds';
import { KIND_LABEL } from '@/model';

interface Props {
  value?: string;
  onPick: (id: string) => void;
  /** Offered first, before searching. */
  suggestions: string[];
  label: string;
  /** Render a compact "add" button instead of the current value. */
  trigger?: (p: { onClick: () => void; 'aria-expanded': boolean }) => React.ReactNode;
}

export function EntityPicker({ value, onPick, suggestions, label, trigger }: Props) {
  const model = useModel();
  const index = useSearchIndex();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q.trim()) return suggestions.map((id) => ({ id, title: model.entity(id)?.name ?? id, kind: model.entity(id) ? KIND_LABEL[model.entity(id)!.kind] : 'Not in the model' }));
    return index.search(q, 14, (r) => r.type === 'entity').map((r) => ({ id: r.id, title: r.title, kind: r.kind }));
  }, [q, suggestions, index, model]);
  const current = model.entity(value);
  return (
    <Popover
      className="w-[340px] p-1.5"
      trigger={(p) =>
        trigger ? (
          trigger(p)
        ) : (
          <button
            type="button"
            {...p}
            aria-label={`${label}: ${current?.name ?? value ?? 'none'} — change`}
            className={cn(inputClass, 'flex items-center gap-1.5 text-left')}
          >
            {current ? <KindIcon kind={current.kind} size={12} className="shrink-0" /> : null}
            <span className={cn('min-w-0 flex-1 truncate', !current && 'font-mono text-fg-subtle')} style={current ? { color: entityColor(current) } : undefined}>
              {current?.name ?? value ?? 'Choose…'}
            </span>
            <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
          </button>
        )
      }
    >
      {(close) => (
        <div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                onPick(results[0].id);
                setQ('');
                close();
              }
            }}
            placeholder="Search components, functions, tables…"
            aria-label={`Search for ${label.toLowerCase()}`}
            className={cn(inputClass, 'mb-1 h-7')}
            data-testid="entity-picker-search"
          />
          {!q.trim() && suggestions.length > 0 && <div className="px-1.5 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">In this scenario</div>}
          <ul className="m-0 max-h-[280px] list-none overflow-y-auto p-0">
            {results.map((r) => {
              const e = model.entity(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    data-pick={r.id}
                    onClick={() => {
                      onPick(r.id);
                      setQ('');
                      close();
                    }}
                    className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2', r.id === value && 'bg-surface-2')}
                  >
                    {e ? <KindIcon kind={e.kind} size={12} className="shrink-0" /> : <span className="w-3" />}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{r.title}</span>
                    <span className="shrink-0 text-[10.5px] text-fg-subtle">{r.kind}</span>
                  </button>
                </li>
              );
            })}
            {results.length === 0 && <li className="px-2 py-3 text-center text-[11.5px] text-fg-subtle">{q.trim() ? 'Nothing found.' : 'Type to search the model.'}</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}
