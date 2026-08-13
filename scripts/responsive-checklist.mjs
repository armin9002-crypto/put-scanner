import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const viewports = [
  ['iPhone SE portrait', 375, 667],
  ['iPhone SE landscape', 667, 375],
  ['iPhone 14 portrait', 390, 844],
  ['iPhone 14 landscape', 844, 390],
  ['iPhone Pro Max portrait', 430, 932],
  ['iPhone Pro Max landscape', 932, 430],
  ['iPad portrait', 768, 1024],
  ['iPad landscape', 1024, 768],
  ['Desktop', 1440, 900],
];

const routes = [
  '/',
  '/options/TQQQ',
  '/options/HIBL',
  '/screener',
  '/watchlist',
  '/portfolio',
  '/pulse',
  '/cockpit',
];

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sources = {
  app: read('src/App.tsx'),
  css: read('src/index.css'),
  responsive: read('src/lib/responsive.ts'),
  scanner: read('src/pages/HomePage.tsx'),
  options: read('src/pages/OptionsPage.tsx'),
  screener: read('src/pages/ScreenerPage.tsx'),
  watchlist: read('src/pages/WatchlistPage.tsx'),
  portfolio: read('src/pages/PortfolioPage.tsx'),
  pulse: read('src/pages/EtfPulsePage.tsx'),
  optionDetail: read('src/components/OptionDetailDrawer.tsx'),
  chart: read('src/components/InteractivePriceChartModal.tsx'),
  holdings: read('src/components/UnderlyingHoldingsModal.tsx'),
  mobileSheet: read('src/components/mobile/MobileBottomSheet.tsx'),
  mobileEtfRow: read('src/components/mobile/MobileEtfRow.tsx'),
  mobileOptionRow: read('src/components/mobile/MobileOptionRow.tsx'),
  mobilePositionRow: read('src/components/mobile/MobilePositionRow.tsx'),
};

const guardrails = [
  ['phone navigation uses contextual headers and real links', sources.app.includes('<MobilePageHeader') && sources.app.includes('<NavLink')],
  ['option workflow owns its compact header and hides the tab bar', sources.options.includes('mobile-option-header') && sources.app.includes("location.pathname.startsWith('/options/')")],
  ['safe areas, dynamic viewport units, and native phone font are present', sources.css.includes('safe-area-inset-bottom') && sources.css.includes('100dvh') && sources.css.includes('-apple-system')],
  ['phone-landscape semantic breakpoint remains explicit', sources.responsive.includes('viewportHeight <= 520') && sources.responsive.includes('viewportWidth <= 950')],
  ['shared bottom sheet locks scroll and restores focus', sources.mobileSheet.includes("document.body.style.overflow = 'hidden'") && sources.mobileSheet.includes('previousFocus?.focus()')],
  ['Scanner uses a purpose-built phone tree and dense shared ETF rows', sources.scanner.includes('if (isPhone)') && sources.scanner.includes('<MobileMarketStrip') && sources.scanner.includes('<MobileEtfRow')],
  ['Options use a purpose-built phone tree and dense shared option rows', sources.options.includes('if (isPhone)') && sources.options.includes('<MobileOptionRow')],
  ['Screener uses the shared option language and a filter sheet', sources.screener.includes('if (isPhone)') && sources.screener.includes('<MobileOptionRow') && sources.screener.includes('<MobileBottomSheet')],
  ['Watchlist uses the same shared option row language', sources.watchlist.includes('if (isPhone)') && sources.watchlist.includes('<MobileOptionRow')],
  ['Portfolio puts grouped position rows before one-at-a-time analytics', sources.portfolio.includes('if (isPhone)') && sources.portfolio.indexOf('<MobilePositionRow') < sources.portfolio.indexOf('Portfolio analytics')],
  ['ETF Pulse offers one-at-a-time List, Heatmap, and Momentum views', sources.pulse.includes("'list' | 'heatmap' | 'momentum'") && sources.pulse.includes('mobileVisual === \'heatmap\'') && sources.pulse.includes('mobileVisual === \'momentum\'')],
  ['option detail is a full-screen phone trade sheet', sources.optionDetail.includes('if (isPhone)') && sources.optionDetail.includes('mobile-trade-sheet absolute inset-0') && sources.css.includes('.mobile-trade-sheet')],
  ['phone chart prioritizes canvas and keeps vertical page panning available', sources.chart.includes('is-phone-chart') && sources.chart.includes('touch-pan-y select-none') && !sources.chart.includes('touch-none')],
  ['holdings modal replaces the phone-width table with compact rows', sources.holdings.includes('sm:hidden') && sources.holdings.includes('hidden overflow-x-auto rounded-xl sm:block')],
  ['shared financial rows meet requested density and touch sizing', sources.css.includes('.mobile-etf-row {\n  min-height: 108px') && sources.css.includes('.mobile-option-row {\n  min-height: 104px') && sources.css.includes('.mobile-position-row {') && sources.css.includes('min-height: 126px')],
];

const failedGuardrails = guardrails.filter(([, passed]) => !passed);

console.log('Automated responsive guardrails:');
for (const [label, passed] of guardrails) {
  console.log(`  ${passed ? 'PASS' : 'FAIL'} ${label}`);
}
if (failedGuardrails.length > 0) {
  console.error(`\n${failedGuardrails.length} responsive guardrail(s) failed.`);
  process.exitCode = 1;
}

console.log('Responsive / orientation QA matrix\n');
console.log('Viewports:');
for (const [label, width, height] of viewports) {
  console.log(`  - ${label}: ${width} x ${height}`);
}

console.log('\nRoutes:');
for (const route of routes) {
  console.log(`  - ${route}`);
}

console.log('\nBrowser setup:');
console.log("  localStorage.setItem('put_scanner_debug_layout', 'true')");
console.log("  localStorage.setItem('put_scanner_debug_network', 'true')");

console.log('\nConsole overflow snippet:');
console.log(`  (() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')]
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .slice(0, 20)
      .map(el => ({ tag: el.tagName, className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    return {
      pageOverflow: root.scrollWidth > root.clientWidth + 1,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      offenders,
    };
  })()`);

console.log('\nPass criteria: no page-level horizontal overflow; dense rows meet the requested above-the-fold targets; sheets trap the workflow safely; sorting/resizing/hovering creates zero API calls; only explicit refresh/load/scan actions fetch.');
