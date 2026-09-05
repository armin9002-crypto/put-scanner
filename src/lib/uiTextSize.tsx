import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { nextUiTextSize, readUiTextSize, UI_TEXT_SIZE_STORAGE_KEY, type UiTextSize } from './uiTextSizePreference';
import { notifyLocalStorageFailure } from './storageFeedback';

const UiTextSizeContext = createContext<{ textSize: UiTextSize; cycleTextSize: () => void }>({
  textSize: 'small', cycleTextSize: () => {},
});

export function UiTextSizeProvider({ children }: { children: ReactNode }) {
  const [textSize, setTextSize] = useState<UiTextSize>(readUiTextSize);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-text-size', textSize);
    try {
      localStorage.setItem(UI_TEXT_SIZE_STORAGE_KEY, textSize);
    } catch {
      notifyLocalStorageFailure();
    }
  }, [textSize]);

  return (
    <UiTextSizeContext.Provider value={{ textSize, cycleTextSize: () => setTextSize(nextUiTextSize) }}>
      {children}
    </UiTextSizeContext.Provider>
  );
}

export function useUiTextSize() {
  return useContext(UiTextSizeContext);
}
