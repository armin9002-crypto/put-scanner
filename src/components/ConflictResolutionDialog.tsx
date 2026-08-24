import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ConflictResolutionChoice } from '../lib/cloudState/conflictRecovery.ts';

interface ConflictResolutionDialogProps {
  label: string;
  choice: ConflictResolutionChoice;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConflictResolutionDialog({
  label,
  choice,
  busy,
  onCancel,
  onConfirm,
}: ConflictResolutionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
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
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
  }, [busy, onCancel]);

  if (typeof document === 'undefined') return null;
  const keepDevice = choice === 'keep_this_device';
  const title = keepDevice ? `Keep this device's ${label}?` : 'Use the account copy?';
  const explanation = keepDevice
    ? `The ${label} currently saved to your account will be replaced with the version on this device.`
    : `The ${label} on this device will be replaced with the version currently saved to your account.`;
  const confirmLabel = keepDevice ? 'Keep This Device' : 'Use Account Copy';

  return createPortal(
    <div className="conflict-confirmation-layer fixed inset-0 z-[120] flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Cancel conflict resolution" onClick={busy ? undefined : onCancel} />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-confirmation-title"
        aria-describedby="conflict-confirmation-description"
        className="conflict-confirmation-dialog relative z-10 w-full max-w-md overflow-y-auto rounded-t-2xl border p-4 shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" style={{ color: 'var(--yellow)' }} aria-hidden="true" />
            <div>
              <h3 id="conflict-confirmation-title" className="text-base font-bold" style={{ color: 'var(--text)' }}>{title}</h3>
              <div id="conflict-confirmation-description" className="mt-2 space-y-2 text-sm leading-5" style={{ color: 'var(--text-muted)' }}>
                <p>{explanation}</p>
                <p>Your recovery backup will remain available.</p>
              </div>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="pressable flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-full disabled:opacity-50" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }} aria-label="Cancel conflict resolution">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="pressable min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="pressable flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: keepDevice ? 'var(--red)' : 'var(--accent)' }}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
