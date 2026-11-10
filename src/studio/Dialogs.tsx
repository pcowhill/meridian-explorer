/** Studio dialogs: the widget binding picker and "save as template". */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useModel } from '@/state/hooks';
import { useWorkspace } from '@/state/workspace';
import { Button, cn, Dialog, inputClass } from '@/ui/primitives';
import { addWidget, saveTemplate } from './commands';
import { bindingItems, matchItems } from './logic/widgets';
import { WIDGETS } from './Palette';
import { useStudioUi } from './ui';

export function WidgetPicker() {
  const picker = useStudioUi((s) => s.picker);
  const set = useStudioUi((s) => s.set);
  const model = useModel();
  const custom = useWorkspace((s) => s.customScenarios);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(() => (picker ? bindingItems(model, picker.kind, custom) : []), [model, picker, custom]);
  const shown = useMemo(() => matchItems(items, q, 80), [items, q]);
  useEffect(() => {
    setQ('');
    setActive(0);
  }, [picker?.kind]);
  if (!picker) return null;
  const meta = WIDGETS.find((w) => w.kind === picker.kind);
  const close = () => set({ picker: null });
  const pick = (i: number) => {
    const it = shown[i];
    if (!it) return;
    addWidget(it.make(), picker.attachTo);
    close();
  };
  let lastGroup = '';
  return (
    <Dialog open onClose={close} title={`Add ${meta?.label.toLowerCase() ?? 'widget'}`} width={560} bodyClassName="p-0">
      <div className="border-b border-line p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            aria-label="Search bindings"
            data-testid="widget-picker-search"
            className={cn(inputClass, 'h-9 pl-8')}
            placeholder={`Search ${items.length} options…`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(active);
              }
            }}
          />
        </div>
        <p className="mb-0 mt-1.5 text-[11.5px] text-fg-subtle">{meta?.hint}. Enter adds the highlighted option.</p>
      </div>
      <div ref={list} className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox" aria-label="Options">
        {shown.length === 0 && <div className="p-6 text-center text-[12px] text-fg-subtle">Nothing matches “{q}”.</div>}
        {shown.map((it, i) => {
          const header = it.group !== lastGroup && !q.trim();
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {header && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{it.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                data-binding={it.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn('flex w-full flex-col rounded-md px-2.5 py-1.5 text-left', i === active ? 'bg-surface-2' : 'hover:bg-surface-2')}
              >
                <span className="truncate text-[12.5px] font-medium">{it.label}</span>
                {it.sub && <span className="truncate text-[11.5px] text-fg-subtle">{it.sub}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function TemplateDialog() {
  const scope = useStudioUi((s) => s.templateDialog);
  const set = useStudioUi((s) => s.set);
  const [name, setName] = useState('');
  if (!scope) return null;
  const close = () => {
    set({ templateDialog: null });
    setName('');
  };
  const save = () => {
    saveTemplate(name || (scope === 'board' ? 'Board template' : 'Selection template'), scope);
    close();
  };
  return (
    <Dialog
      open
      onClose={close}
      title={scope === 'board' ? 'Save the board as a template' : 'Save the selection as a template'}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save template
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-fg-muted">Name</span>
        <input
          autoFocus
          className={inputClass}
          value={name}
          placeholder="e.g. Request path skeleton"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <p className="mb-0 mt-2 text-[11.5px] text-fg-subtle">Templates live in your workspace and can be inserted on any board from the Templates tab.</p>
    </Dialog>
  );
}
