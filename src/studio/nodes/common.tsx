/** Shared pieces of every Studio node: the wrapper (test ids, resizer, handles, dimming), inline text editing, widget chrome. */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { Lock } from 'lucide-react';
import { cn } from '@/ui/primitives';
import { useStudio } from '../store';
import type { BaseData, StudioNodeType } from '../types';

const HANDLES: { id: string; pos: Position }[] = [
  { id: 't', pos: Position.Top },
  { id: 'r', pos: Position.Right },
  { id: 'b', pos: Position.Bottom },
  { id: 'l', pos: Position.Left },
];

/** One connectable handle per side (connection mode is loose, so any side connects to any side). */
export function SideHandles() {
  return (
    <>
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.pos} className="studio-handle" />
      ))}
    </>
  );
}

/** Animation role of a node in the running path animation. */
function useAnimRole(id: string): 'current' | 'visited' | 'upcoming' | null {
  return useStudio((s) => {
    if (!s.anim) return null;
    const i = s.anim.nodes.indexOf(id);
    if (i < 0) return null;
    return i === s.anim.index ? 'current' : i < s.anim.index ? 'visited' : 'upcoming';
  });
}

interface ShellProps {
  id: string;
  type: StudioNodeType;
  data: BaseData;
  selected?: boolean;
  entityId?: string;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Draw the selection ring on the shell (off for shapes that draw their own outline). */
  ring?: boolean;
}

/** The wrapper of every canvas node. Carries the selectors e2e tests rely on. */
export function NodeShell({ id, type, data, selected, entityId, minWidth = 60, minHeight = 30, resizable = true, className, style, children, ring = true }: ShellProps) {
  const dim = useStudio((s) => (s.focus ? !s.focus.nodeIds.includes(id) : false));
  const lit = useStudio((s) => (s.focus?.mode === 'path' ? s.focus.nodeIds.includes(id) : false));
  const connectSource = useStudio((s) => s.connectMode && s.connectFrom === id);
  const anim = useAnimRole(id);
  const locked = !!data.locked;
  return (
    <div
      data-testid="studio-node"
      data-node-type={type}
      data-entity={entityId}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'studio-node relative h-full w-full transition-opacity duration-200',
        dim && 'studio-dim',
        ring && selected && 'studio-selected',
        (lit || anim === 'visited') && 'studio-lit',
        anim === 'current' && 'studio-anim-current',
        connectSource && 'studio-connect-source',
        className,
      )}
      style={style}
    >
      {resizable && !locked && (
        <NodeResizer
          isVisible={!!selected}
          minWidth={minWidth}
          minHeight={minHeight}
          color="var(--accent)"
          handleClassName="studio-resize-handle"
          lineClassName="studio-resize-line"
          onResizeStart={() => useStudio.getState().checkpoint()}
        />
      )}
      <SideHandles />
      {children}
      {locked && (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle shadow-panel" title="Locked">
          <Lock size={9} />
        </span>
      )}
    </div>
  );
}

interface EditableProps {
  id: string;
  value: string | undefined;
  /** Data field written on commit. */
  field?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  multiline?: boolean;
  /** Render when not editing (defaults to the value). */
  children?: ReactNode;
}

/**
 * Text that becomes a textarea while the node is being edited (double-click or
 * Enter). Enter commits (Shift+Enter inserts a newline), Escape cancels.
 */
export function EditableText({ id, value, field = 'label', placeholder = 'Double-click to edit', className, style, multiline = true, children }: EditableProps) {
  const editing = useStudio((s) => s.editingId === id);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    if (!editing || !ref.current) return;
    cancelled.current = false;
    ref.current.focus();
    ref.current.select();
  }, [editing]);
  if (!editing) {
    return (
      <div className={cn('min-w-0 whitespace-pre-wrap break-words', className)} style={style}>
        {children ?? (value ? value : <span className="text-fg-subtle/80 italic">{placeholder}</span>)}
      </div>
    );
  }
  const finish = (commit: boolean) => {
    const st = useStudio.getState();
    if (st.editingId !== id) return;
    const next = ref.current?.value ?? '';
    st.setEditing(null);
    if (commit && next !== (value ?? '')) st.updateNodeData(id, { [field]: next });
  };
  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      defaultValue={value ?? ''}
      rows={multiline ? Math.max(1, (value ?? '').split('\n').length) : 1}
      className={cn('nodrag nowheel block w-full resize-none rounded-sm bg-surface/90 outline-none ring-2 ring-accent', className)}
      style={style}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (!e.shiftKey || !multiline)) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          finish(false);
        }
      }}
      onBlur={() => finish(!cancelled.current)}
    />
  );
}

/** Header bar of a widget node (the drag area). */
export function WidgetHeader({ icon, title, subtitle, right, color, onTitleClick }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; color?: string; onTitleClick?: () => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2.5" style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
      <span className="flex shrink-0 items-center" style={{ color: color ?? 'var(--fg-muted)' }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={cn('truncate text-[12.5px] font-semibold', onTitleClick && 'cursor-pointer hover:underline')} onClick={onTitleClick}>
          {title}
        </div>
        {subtitle && <div className="truncate text-[10.5px] text-fg-subtle">{subtitle}</div>}
      </div>
      {right && <div className="nodrag flex shrink-0 items-center gap-0.5">{right}</div>}
    </div>
  );
}

/** Standard widget box: header + scrollable body that only captures the wheel once the node is selected. */
export function WidgetBox({ selected, proposed, header, children, bodyClassName, footer }: { selected?: boolean; proposed?: boolean; header: ReactNode; children: ReactNode; bodyClassName?: string; footer?: ReactNode }) {
  return (
    <div className={cn('tint flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-panel', proposed && 'hypothetical')}>
      {header}
      <div className={cn('min-h-0 flex-1 overflow-auto', selected && 'nowheel', bodyClassName)}>{children}</div>
      {footer}
    </div>
  );
}

/** Small icon button for use inside nodes. */
export function NodeButton({ label, onClick, children, active, disabled }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn('nodrag inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40', active && 'bg-surface-3 text-accent')}
    >
      {children}
    </button>
  );
}

/** Parse `3-5, 9` into line numbers. */
export function parseLines(spec: string | undefined): number[] {
  if (!spec) return [];
  const out: number[] = [];
  for (const part of spec.split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 2000; i++) out.push(i);
  }
  return out;
}
