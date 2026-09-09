import { useEffect, useRef, type RefObject } from 'react';

type ElementRef = RefObject<HTMLElement>;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  'area[href]',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden]')) return false;
  if (typeof window === 'undefined') return true;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function isFocusableElement(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || !isElementVisible(element)) return false;
  if (element.matches('[disabled], [aria-disabled="true"], [inert], [tabindex="-1"]')) return false;
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
  return element.matches(FOCUSABLE_SELECTOR) && element.tabIndex >= 0;
}

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isFocusableElement);
}

function focusElement(element: HTMLElement | null): void {
  if (!element || !element.isConnected) return;
  element.focus({ preventScroll: true });
}

function focusInitialElement(panel: HTMLElement, initialFocusRef?: ElementRef): void {
  const explicitTarget = initialFocusRef?.current;
  if (explicitTarget && explicitTarget.isConnected && (isFocusableElement(explicitTarget) || explicitTarget === panel)) {
    focusElement(explicitTarget);
    return;
  }

  // Prefer an existing control, but avoid unexpectedly opening a mobile keyboard
  // when a dialog contains only text-entry controls.
  const focusable = getFocusableElements(panel);
  const meaningful = focusable.find(element => !element.matches('input, textarea'));
  focusElement(meaningful ?? panel);
}

interface OverlayEntry {
  panelRef: ElementRef;
  overlayRef?: ElementRef;
  onEscapeRef: { current: (() => void) | undefined };
  escapeEnabledRef: { current: boolean };
  previousFocus: HTMLElement | null;
}

interface OriginalInertState {
  inert: boolean;
  ariaHidden: string | null;
}

const overlayStack: OverlayEntry[] = [];
const originalInertState = new Map<HTMLElement, OriginalInertState>();
const currentlyInert = new Set<HTMLElement>();

let bodyScrollLockCount = 0;
let previousBodyOverflow: string | null = null;

function activeElementRef(entry: OverlayEntry): HTMLElement | null {
  return entry.overlayRef?.current ?? entry.panelRef.current;
}

function rememberInertState(element: HTMLElement): void {
  if (!originalInertState.has(element)) {
    originalInertState.set(element, {
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    });
  }
}

function setInert(element: HTMLElement): void {
  rememberInertState(element);
  element.inert = true;
  element.setAttribute('aria-hidden', 'true');
  currentlyInert.add(element);
}

function restoreInert(): void {
  for (const element of currentlyInert) {
    const original = originalInertState.get(element);
    if (!original) continue;
    element.inert = original.inert;
    if (original.ariaHidden == null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', original.ariaHidden);
  }
  currentlyInert.clear();
  originalInertState.clear();
}

function inertBackgroundFor(topmost: OverlayEntry): void {
  const overlay = activeElementRef(topmost);
  if (!overlay || !overlay.isConnected) return;

  // Inert sibling branches on the path to the overlay. This keeps the overlay
  // itself (and its backdrop contract) active without hiding an ancestor that
  // contains the dialog.
  let current: HTMLElement | null = overlay;
  while (current?.parentElement) {
    const parent: HTMLElement = current.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== current && sibling instanceof HTMLElement) setInert(sibling);
    }
    if (parent === document.body) break;
    current = parent;
  }

  // A stacked overlay remains mounted but cannot compete with the topmost one.
  for (const entry of overlayStack) {
    if (entry === topmost) continue;
    const otherOverlay = activeElementRef(entry);
    if (!otherOverlay || otherOverlay === overlay || !otherOverlay.isConnected) continue;
    if (!otherOverlay.contains(overlay) && !overlay.contains(otherOverlay)) setInert(otherOverlay);
  }
}

function reconcileInertness(): void {
  restoreInert();
  const topmost = overlayStack[overlayStack.length - 1];
  if (topmost) inertBackgroundFor(topmost);
}

function acquireBodyScrollLock(): void {
  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockCount += 1;
}

function releaseBodyScrollLock(): void {
  if (bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow ?? '';
    previousBodyOverflow = null;
  }
}

function isTopmost(entry: OverlayEntry): boolean {
  return overlayStack[overlayStack.length - 1] === entry;
}

export interface BlockingOverlayBehaviorOptions {
  isOpen?: boolean;
  panelRef: ElementRef;
  overlayRef?: ElementRef;
  initialFocusRef?: ElementRef;
  onEscape?: () => void;
  escapeEnabled?: boolean;
  lockBodyScroll?: boolean;
}

/**
 * Shared lifecycle for blocking dialogs, drawers, and sheets. Visual surfaces
 * remain owned by their callers; this hook only coordinates interaction state.
 */
export function useBlockingOverlayBehavior({
  isOpen = true,
  panelRef,
  overlayRef,
  initialFocusRef,
  onEscape,
  escapeEnabled = true,
  lockBodyScroll = true,
}: BlockingOverlayBehaviorOptions): void {
  const onEscapeRef = useRef(onEscape);
  const escapeEnabledRef = useRef(escapeEnabled);
  onEscapeRef.current = onEscape;
  escapeEnabledRef.current = escapeEnabled;

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: OverlayEntry = { panelRef, overlayRef, onEscapeRef, escapeEnabledRef, previousFocus };
    overlayStack.push(entry);
    if (lockBodyScroll) acquireBodyScrollLock();
    reconcileInertness();
    if (panelRef.current) focusInitialElement(panelRef.current, initialFocusRef);

    const handleKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || !isTopmost(entry)) return;

      if (event.key === 'Escape') {
        if (!escapeEnabledRef.current || !onEscapeRef.current) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        focusElement(panel);
        return;
      }

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!active || !panel.contains(active)) {
        event.preventDefault();
        focusElement(event.shiftKey ? focusable[focusable.length - 1] : focusable[0]);
        return;
      }

      if (event.shiftKey && active === focusable[0]) {
        event.preventDefault();
        focusElement(focusable[focusable.length - 1]);
      } else if (!event.shiftKey && active === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusElement(focusable[0]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const index = overlayStack.indexOf(entry);
      if (index >= 0) overlayStack.splice(index, 1);
      reconcileInertness();
      if (lockBodyScroll) releaseBodyScrollLock();

      const previousFocus = entry.previousFocus;
      if (previousFocus && previousFocus.isConnected && isFocusableElement(previousFocus)) focusElement(previousFocus);
    };
  }, [initialFocusRef, isOpen, lockBodyScroll, overlayRef, panelRef]);
}
