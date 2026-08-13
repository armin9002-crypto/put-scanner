import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface MobileBottomSheetProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export default function MobileBottomSheet({
  title,
  description,
  onClose,
  children,
  footer,
  className = '',
}: MobileBottomSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="mobile-sheet-layer fixed inset-0 z-[95] flex items-end justify-center">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label={`Close ${title}`} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`mobile-sheet-panel relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-t-[22px] outline-none ${className}`}
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <div className="flex-none px-4 pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
          <div className="flex min-h-11 items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
              {description && <p id={descriptionId} className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="pressable -mr-2 flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label={`Close ${title}`}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="mobile-sheet-footer flex-none border-t px-4 pt-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>{footer}</div>}
      </div>
    </div>
  );
}
