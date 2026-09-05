export type UiTextSize = 'small' | 'medium' | 'large';

export const UI_TEXT_SIZE_STORAGE_KEY = 'put_scanner_text_size';

export function normalizeUiTextSize(value: string | null): UiTextSize {
  return value === 'medium' || value === 'large' ? value : 'small';
}

export function nextUiTextSize(value: UiTextSize): UiTextSize {
  return value === 'small' ? 'medium' : value === 'medium' ? 'large' : 'small';
}

export function readUiTextSize(): UiTextSize {
  try {
    return normalizeUiTextSize(localStorage.getItem(UI_TEXT_SIZE_STORAGE_KEY));
  } catch {
    return 'small';
  }
}

/** CSS handles computed chart labels without subscribing charts to React state. */
export function uiTextCssPx(basePx: number): string {
  return `calc(${basePx}px * var(--ui-text-scale, 1))`;
}
