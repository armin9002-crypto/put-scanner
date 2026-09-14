import { useCallback, useEffect, useRef, type RefObject } from 'react';

type OverlayElementRef = RefObject<HTMLElement | null>;

const FALLBACK_EXIT_MS = 190;
const MAX_EXIT_MS = 190;

function exitDurationMs(value: string): number {
  value = value.trim();
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value);
  if (!match) return FALLBACK_EXIT_MS;
  const milliseconds = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.min(milliseconds + 50, MAX_EXIT_MS)
    : FALLBACK_EXIT_MS;
}

/**
 * Defers a user-requested overlay close until its CSS exit animation finishes.
 * The parent keeps ownership of mounting, focus management, and body locking.
 */
export function useOverlayDismiss(
  onClose: () => void,
  panelRef: OverlayElementRef,
  overlayRef: OverlayElementRef,
  identity?: unknown,
): () => void {
  const onCloseRef = useRef(onClose);
  const dismissingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  onCloseRef.current = onClose;

  const clearDismissal = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dismissingRef.current = false;
  }, []);

  useEffect(() => clearDismissal, [clearDismissal, identity]);

  const requestClose = useCallback(() => {
    if (dismissingRef.current) return;

    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay || typeof window === 'undefined') {
      onCloseRef.current();
      return;
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reducedMotion?.matches) {
      onCloseRef.current();
      return;
    }

    // Read compositor state before changing styles so an interrupted entrance
    // exits from its actual position. No geometry measurements are needed.
    const panelStyle = window.getComputedStyle(panel);
    const duration = exitDurationMs(panelStyle.getPropertyValue('--motion-exit'));
    const backdrop = overlay.querySelector<HTMLElement>(':scope > .motion-backdrop');
    const snapshots: [HTMLElement, string, string][] = [
      [panel, '--motion-exit-opacity', panelStyle.opacity],
      [panel, '--motion-exit-translate', panelStyle.translate],
      [panel, '--motion-exit-scale', panelStyle.scale],
      [overlay, '--motion-exit-backdrop-background', window.getComputedStyle(overlay).backgroundColor],
    ];
    if (backdrop) snapshots.push([backdrop, '--motion-exit-opacity', window.getComputedStyle(backdrop).opacity]);
    const originalStyles = snapshots.map(([element, property]) => [element, property, element.style.getPropertyValue(property)] as const);
    snapshots.forEach(([element, property, value]) => element.style.setProperty(property, value));

    dismissingRef.current = true;
    panel.setAttribute('data-motion-closing', 'true');
    overlay.setAttribute('data-motion-closing', 'true');

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      clearDismissal();
      onCloseRef.current();
    };
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target === panel && event.animationName.endsWith('-exit')) finish();
    };
    const onPreferenceChange = () => {
      if (reducedMotion?.matches) finish();
    };
    // Keep the trap intact, but a dismissed financial action must not execute
    // during its visual exit. Tab and Escape still reach the existing trap.
    const suppressInteraction = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.key === 'Tab' || event.key === 'Escape')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const guardedEvents = ['pointerdown', 'click', 'submit', 'keydown'] as const;
    guardedEvents.forEach(type => panel.addEventListener(type, suppressInteraction, true));
    const timeout = window.setTimeout(finish, duration);

    panel.addEventListener('animationend', onAnimationEnd);
    reducedMotion?.addEventListener?.('change', onPreferenceChange);
    cleanupRef.current = () => {
      window.clearTimeout(timeout);
      panel.removeEventListener('animationend', onAnimationEnd);
      reducedMotion?.removeEventListener?.('change', onPreferenceChange);
      guardedEvents.forEach(type => panel.removeEventListener(type, suppressInteraction, true));
      originalStyles.forEach(([element, property, value]) => {
        if (value) element.style.setProperty(property, value);
        else element.style.removeProperty(property);
      });
      panel.removeAttribute('data-motion-closing');
      overlay.removeAttribute('data-motion-closing');
    };
  }, [clearDismissal, overlayRef, panelRef]);

  return requestClose;
}
