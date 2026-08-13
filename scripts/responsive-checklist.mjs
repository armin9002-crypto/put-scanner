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
};

const guardrails = [
  ['portrait phone uses real-link bottom navigation', sources.app.includes('mobile-bottom-nav') && sources.app.includes('<NavLink')],
  ['option workflow does not show the bottom tab bar', sources.app.includes("location.pathname.startsWith('/options/')")],
  ['safe areas and dynamic viewport units are present', sources.css.includes('safe-area-inset-bottom') && sources.css.includes('100dvh')],
  ['phone-landscape semantic breakpoint remains explicit', sources.responsive.includes('viewportHeight <= 520') && sources.responsive.includes('viewportWidth <= 950')],
  ['Scanner has compact filters and a touch-scroll market strip', sources.scanner.includes('scanner-filter-controls') && sources.scanner.includes('scanner-market-strip')],
  ['Options retain dedicated phone cards', sources.options.includes('option-mobile-chain') && sources.options.includes('MobileOptionCard')],
  ['Screener renders phone cards instead of requiring its table', sources.screener.includes("key={`mobile-${row.ticker}") && sources.screener.includes('hidden rounded-xl overflow-hidden max-w-full md:block')],
  ['Watchlist retains dedicated phone cards', sources.watchlist.includes('md:hidden space-y-2')],
  ['Portfolio has mobile analytics and schedule cards', sources.portfolio.includes('mobileAnalytics') && sources.portfolio.includes('md:hidden space-y-2 mb-4')],
  ['ETF Pulse has phone cards and responsive visuals', sources.pulse.includes("key={`mobile-${row.ticker}") && !sources.pulse.includes('className="w-full min-w-[520px]"')],
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

console.log('\nPass criteria: no page-level horizontal overflow; sorting/resizing/hovering creates zero API calls; only explicit refresh/load/scan actions fetch.');
