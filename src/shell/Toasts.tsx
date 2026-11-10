import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useApp } from '@/state/app';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed left-1/2 top-1.5 z-[980] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="animate-fade-in pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border border-line bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg shadow-pop" data-testid="toast">
          {t.tone === 'ok' ? <CircleCheck size={14} /> : t.tone === 'warn' ? <TriangleAlert size={14} /> : <Info size={14} />}
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="ml-1 rounded p-0.5 opacity-70 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
