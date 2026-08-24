import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface MobileAccountSheetProps {
  id?: string;
  identity?: string | null;
  status?: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function MobileAccountSheet({
  id,
  identity,
  status,
  description,
  onClose,
  children,
}: MobileAccountSheetProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const previousRootOverflow = root.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
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
      window.removeEventListener('keydown', handleKeyDown);
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      window.scrollTo(0, scrollY);
      previousFocus?.focus();
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const sheet = (
    <div className="mobile-account-sheet-layer fixed inset-0 z-[110] flex items-end justify-center" data-account-overlay="mobile">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close Account"
        onClick={onClose}
      />
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={generatedTitleId}
        aria-describedby={description ? generatedDescriptionId : undefined}
        tabIndex={-1}
        className="mobile-account-sheet relative z-10 flex w-full flex-col overflow-hidden rounded-t-[24px] border outline-none"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <header className="mobile-account-sheet__header flex-none border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>
          <div className="mx-auto mb-1.5 h-1 w-10 rounded-full" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
          <div className="flex min-h-12 items-start justify-between gap-3">
            <div className="min-w-0 py-0.5">
              <h2 id={generatedTitleId} className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text)' }}>Account</h2>
              {identity && <p className="mt-0.5 break-all text-sm font-semibold" style={{ color: 'var(--text)' }}>{identity}</p>}
              {status && <p className="mt-0.5 text-xs font-semibold" style={{ color: 'var(--green)' }}>{status}</p>}
              {description && <p id={generatedDescriptionId} className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="pressable -mr-1 flex h-11 w-11 min-h-11 min-w-11 flex-none items-center justify-center rounded-full"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}
              aria-label="Close Account"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="mobile-account-sheet__content min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );

  // AccountControl lives inside a sticky, backdrop-filtered header. Portaling is
  // required so this fixed layer uses the viewport rather than that header as its
  // containing block and can sit above the mobile navigation stacking context.
  return createPortal(sheet, document.body);
}
