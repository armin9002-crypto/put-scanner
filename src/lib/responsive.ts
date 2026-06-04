import { useEffect, useState } from 'react';

export interface ResponsiveMode {
  viewportWidth: number;
  viewportHeight: number;
  isPhone: boolean;
  isPhoneLandscape: boolean;
  isTablet: boolean;
  isTabletLandscape: boolean;
  isDesktop: boolean;
}

const DEFAULT_MODE: ResponsiveMode = {
  viewportWidth: 1024,
  viewportHeight: 768,
  isPhone: false,
  isPhoneLandscape: false,
  isTablet: true,
  isTabletLandscape: true,
  isDesktop: false,
};

function readMode(): ResponsiveMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || DEFAULT_MODE.viewportWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || DEFAULT_MODE.viewportHeight;
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? viewportWidth > viewportHeight;
  const isPhoneLandscape = landscape && viewportHeight <= 520 && viewportWidth <= 950;
  const isPhone = viewportWidth < 768 || isPhoneLandscape;
  const isTablet = !isPhone && viewportWidth < 1200;
  const isTabletLandscape = isTablet && landscape;

  return {
    viewportWidth,
    viewportHeight,
    isPhone,
    isPhoneLandscape,
    isTablet,
    isTabletLandscape,
    isDesktop: !isPhone && !isTablet,
  };
}

export function useResponsiveMode(): ResponsiveMode {
  const [mode, setMode] = useState<ResponsiveMode>(() => readMode());

  useEffect(() => {
    const update = () => setMode(readMode());
    const media = window.matchMedia?.('(orientation: landscape)');
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update);
    media?.addEventListener?.('change', update);
    update();

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      media?.removeEventListener?.('change', update);
    };
  }, []);

  return mode;
}
