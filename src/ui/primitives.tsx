/* eslint-disable react-refresh/only-export-components */
/**
 * Small, dependency-free UI primitives shared by every mode. All colours come
 * from the design tokens in styles/index.css.
 */
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TipProps {
  label: ReactNode;
  /** Keyboard shortcut shown after the label. */
  keys?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  className?: string;
}

/** Hover/focus tooltip rendered in a portal so it is never clipped. */
export function Tip({ label, keys, side = 'bottom', children, className }: TipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 8;
      if (side === 'top') setPos({ x: r.left + r.width / 2, y: r.top - gap });
      else if (side === 'left') setPos({ x: r.left - gap, y: r.top + r.height / 2 });
      else if (side === 'right') setPos({ x: r.right + gap, y: r.top + r.height / 2 });
      else setPos({ x: r.left + r.width / 2, y: r.bottom + gap });
    }, 350);
  }, [side]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const transform =
    side === 'top' ? 'translate(-50%, -100%)' : side === 'left' ? 'translate(-100%, -50%)' : side === 'right' ? 'translate(0, -50%)' : 'translate(-50%, 0)';

  return (
    <span ref={ref} className={cn('inline-flex', className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onMouseDown={hide}>
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1000] flex max-w-xs items-center gap-2 rounded-md bg-fg px-2 py-1 text-[11.5px] font-medium text-bg shadow-pop"
            style={{ left: Math.max(8, Math.min(pos.x, window.innerWidth - 8)), top: pos.y, transform }}
          >
            {label}
            {keys && <span className="rounded border border-bg/30 px-1 font-mono text-[10px] opacity-80">{keys}</span>}
          </span>,
          document.body,
        )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'subtle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  active?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  default: 'border border-line bg-surface text-fg hover:bg-surface-2 hover:border-line-strong',
  primary: 'border border-transparent bg-accent text-accent-fg hover:brightness-110',
  ghost: 'border border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  subtle: 'border border-transparent bg-surface-2 text-fg hover:bg-surface-3',
  danger: 'border border-transparent text-bad hover:bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', active, icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-2.5 text-[12.5px]',
        VARIANT[variant],
        active && 'border-accent! bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))]! text-accent!',
        className,
      )}
      aria-pressed={active}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  keys?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  tipSide?: TipProps['side'];
  variant?: 'ghost' | 'default';
}

/** Square icon-only button with an accessible label and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, keys, active, size = 'md', tipSide, variant = 'ghost', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <Tip label={label} keys={keys} side={tipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40',
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          variant === 'default' ? 'border border-line bg-surface hover:bg-surface-2' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          active && 'bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface))]! text-accent!',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
});

// ---------------------------------------------------------------------------
// Small display pieces
// ---------------------------------------------------------------------------

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function Badge({ children, color, title, className, style }: { children: ReactNode; color?: string; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <span
      title={title}
      className={cn('inline-flex h-[18px] shrink-0 items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold uppercase tracking-wide', className)}
      style={{
        color: color ?? 'var(--fg-muted)',
        background: `color-mix(in srgb, ${color ?? 'var(--fg-muted)'} 13%, transparent)`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-1.5 flex items-center justify-between gap-2', className)}>
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{children}</h3>
      {right}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <div className="text-[13px] font-semibold text-fg">{title}</div>
      {children && <div className="max-w-sm text-[12.5px] text-fg-muted">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control / tabs
// ---------------------------------------------------------------------------

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string; keys?: string }[];
  size?: 'sm' | 'md';
  label: string;
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
              value === o.value ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
        return o.title ? (
          <Tip key={o.value} label={o.title} keys={o.keys}>
            {btn}
          </Tip>
        ) : (
          btn
        );
      })}
    </div>
  );
}

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ value, onChange, tabs, label, className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex items-end gap-0.5 overflow-x-auto border-b border-line px-2', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px inline-flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-2 text-[12px] font-medium transition-colors',
            value === t.value ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-fg-subtle">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover / menu
// ---------------------------------------------------------------------------

interface PopoverProps {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog' }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Click-to-open popover anchored to its trigger; closes on outside click or Escape. */
export function Popover({ trigger, children, align = 'start', side = 'bottom', className, open: controlled, onOpenChange }: PopoverProps) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = useCallback(
    (v: boolean) => {
      setInner(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!r || !p) return;
      let left = align === 'end' ? r.right - p.width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
      let top = side === 'top' ? r.top - p.height - 6 : r.bottom + 6;
      if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 6);
      setStyle({ left, top, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen]);

  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            className={cn('animate-fade-in fixed z-[900] rounded-lg border border-line bg-surface p-1 text-fg shadow-pop', className)}
            style={style}
          >
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  children,
  onClick,
  icon,
  keys,
  danger,
  disabled,
  active,
  hint,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-40',
        danger ? 'text-bad hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]' : 'hover:bg-surface-2',
        active && 'bg-surface-2 font-semibold',
      )}
    >
      {icon && <span className="flex w-4 shrink-0 justify-center text-fg-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-[11px] font-normal text-fg-subtle">{hint}</span>}
      </span>
      {keys && <span className="font-mono text-[10.5px] text-fg-subtle">{keys}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  /** Extra classes for the body. */
  bodyClassName?: string;
}

export function Dialog({ open, onClose, title, children, footer, width = 560, bodyClassName }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus the first focusable control inside the dialog.
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-dialog-close])');
    (first ?? panel.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[950] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-fade-in flex max-h-[84vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop outline-none"
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-[14px] font-semibold">
            {title}
          </h2>
          <button type="button" data-dialog-close aria-label="Close" onClick={onClose} className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-3', bodyClassName)}>{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const inputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]';

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11.5px] font-semibold text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex items-center gap-2 text-[12.5px] text-fg', className)}
    >
      <span className={cn('relative h-[18px] w-8 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cn('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  );
}

/** A tiny chip button, used for filters. */
export function Chip({ active, onClick, children, color, title }: { active?: boolean; onClick?: () => void; children: ReactNode; color?: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium transition-colors',
        active ? 'border-transparent text-fg' : 'border-line text-fg-subtle hover:text-fg',
      )}
      style={active ? { background: `color-mix(in srgb, ${color ?? 'var(--accent)'} 16%, var(--surface))`, borderColor: `color-mix(in srgb, ${color ?? 'var(--accent)'} 50%, var(--line))` } : undefined}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: active ? 1 : 0.4 }} />}
      {children}
    </button>
  );
}
