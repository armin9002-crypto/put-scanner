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
  '/options/NVDA',
  '/options/HIBL',
  '/screener',
  '/watchlist',
  '/portfolio',
  '/pulse',
  '/cockpit',
];

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const sources = {
  app: read('src/App.tsx'),
  account: read('src/components/AccountControl.tsx'),
  mobileAccount: read('src/components/MobileAccountSheet.tsx'),
  accountStatus: read('src/components/CloudSyncSection.tsx'),
  css: read('src/index.css'),
  responsive: read('src/lib/responsive.ts'),
  optionQuoteDisplay: read('src/lib/optionQuoteDisplay.ts'),
  scanner: read('src/pages/HomePage.tsx'),
  analyzeTicker: read('src/components/AnalyzeTickerForm.tsx'),
  etfCard: read('src/components/ETFCard.tsx'),
  options: read('src/pages/OptionsPage.tsx'),
  screener: read('src/pages/ScreenerPage.tsx'),
  watchlist: read('src/pages/WatchlistPage.tsx'),
  portfolio: read('src/pages/PortfolioPage.tsx'),
  dataBackup: read('src/components/DataBackupModal.tsx'),
  pulse: read('src/pages/EtfPulsePage.tsx'),
  optionDetail: read('src/components/OptionDetailDrawer.tsx'),
  chart: read('src/components/InteractivePriceChartModal.tsx'),
  holdings: read('src/components/UnderlyingHoldingsModal.tsx'),
  mobileSheet: read('src/components/mobile/MobileBottomSheet.tsx'),
  mobileEtfRow: read('src/components/mobile/MobileEtfRow.tsx'),
  mobileOptionRow: read('src/components/mobile/MobileOptionRow.tsx'),
  mobilePositionRow: read('src/components/mobile/MobilePositionRow.tsx'),
};
const portfolioScheduleStart = sources.portfolio.indexOf('Schedule of Positions');
const portfolioSchedule = sources.portfolio.slice(
  portfolioScheduleStart,
  sources.portfolio.indexOf('<ArchiveHistorySection', portfolioScheduleStart),
);

const guardrails = [
  ['phone navigation uses contextual headers and real links', sources.app.includes('<MobilePageHeader') && sources.app.includes('<NavLink')],
  ['Account stays in utility controls with a 44px mobile target and no sixth tab', sources.app.includes('<AccountControl />') && sources.account.includes('h-11 w-11 min-h-11 min-w-11') && sources.account.includes('aria-haspopup="dialog"') && !sources.app.includes("to: '/account'")],
  ['mobile Account uses a body portal above header and bottom navigation stacking contexts', sources.account.includes('<MobileAccountSheet') && sources.mobileAccount.includes('createPortal(sheet, document.body)') && sources.mobileAccount.includes('z-[110]')],
  ['mobile Account uses dynamic viewport, safe-area, scroll, focus, and iOS body-lock safeguards', sources.css.includes('.mobile-account-sheet') && sources.css.includes('100dvh') && sources.css.includes('scroll-padding-bottom') && sources.mobileAccount.includes('document.documentElement.style.overflow') && sources.mobileAccount.includes('window.scrollTo(0, scrollY)')],
  ['cloud conflict recovery stays concise and touch-safe', sources.account.includes('AccountPanel') && sources.accountStatus.includes('Reload Latest Cloud Data') && sources.accountStatus.includes('min-h-11 w-full')],
  ['Account remains compact and internally scrollable on small screens', sources.account.includes('max-h-[calc(100dvh-2rem)]') && sources.account.includes('overflow-y-auto') && sources.accountStatus.includes('rounded-xl border p-3')],
  ['option workflow owns its compact header and hides the tab bar', sources.options.includes('mobile-option-header') && sources.app.includes("location.pathname.startsWith('/options/')")],
  ['mobile ETF option header keeps the shared Account trigger available', sources.options.includes("import AccountControl from '../components/AccountControl'") && sources.options.includes('<AccountControl />')],
  ['safe areas, dynamic viewport units, and native phone font are present', sources.css.includes('safe-area-inset-bottom') && sources.css.includes('100dvh') && sources.css.includes('-apple-system')],
  ['phone-landscape semantic breakpoint remains explicit', sources.responsive.includes('viewportHeight <= 520') && sources.responsive.includes('viewportWidth <= 950')],
  ['shared bottom sheet locks scroll and restores focus', sources.mobileSheet.includes("document.body.style.overflow = 'hidden'") && sources.mobileSheet.includes('previousFocus?.focus()')],
  ['Scanner uses a purpose-built phone tree and dense shared ETF rows', sources.scanner.includes('if (isPhone)') && sources.scanner.includes('<MobileMarketStrip') && sources.scanner.includes('<MobileEtfRow')],
  ['Scanner mobile discovery rows preserve identity, four-period performance, IV60, liquidity, and assets', sources.mobileEtfRow.includes('mobile-etf-row__main') && sources.mobileEtfRow.includes("['5D'") && sources.mobileEtfRow.includes("['52W'") && sources.mobileEtfRow.includes('IV60') && sources.mobileEtfRow.includes('formatFundAssets') && sources.css.includes('.mobile-etf-row__performance')],
  ['Analyze Ticker is present in both Scanner layouts with touch-safe, no-zoom controls', (sources.scanner.match(/<AnalyzeTickerForm/g) ?? []).length === 2 && sources.analyzeTicker.includes('min-h-11') && sources.analyzeTicker.includes('text-base') && sources.analyzeTicker.includes('grid-cols-[minmax(0,1fr)_auto]')],
  ['desktop Scanner filters remain compact without changing mini-chart dimensions', sources.scanner.includes('scanner-desktop-controls') && sources.scanner.includes('width={150}') && sources.scanner.includes('height={48}')],
  ['desktop ETF cards render daily move percentage without a visible dollar move', sources.etfCard.includes('formatScannerDailyChangePercent') && !sources.etfCard.includes('{formatCurrency(change)}')],
  ['Options use a purpose-built phone tree and dense shared option rows', sources.options.includes('if (isPhone && !isPhoneLandscape)') && sources.options.includes('<MobileOptionRow') && sources.options.includes('mobile-option-chain-header')],
  ['Options keep Last Trade immediately after Strike without changing dense table sizing', sources.options.indexOf("{ field: 'lastTradeDate'") > sources.options.indexOf("{ field: 'strike'") && sources.options.includes('formatOptionLastTradeDate') && sources.options.includes('table-fixed text-xs')],
  ['Options hide Nominal Yield by default and expose it without changing row density', sources.options.includes('useState(readShowNominalYield)') && sources.options.includes('visibleYieldFields.map') && sources.optionQuoteDisplay.includes("'nomYieldLast'") && sources.optionQuoteDisplay.includes("'annYieldAsk'") && !sources.mobileOptionRow.includes('props.showNominalYield') && sources.css.includes('mobile-option-chain-row')],
  ['Screener uses the shared option language and a filter sheet', sources.screener.includes('if (isPhone)') && sources.screener.includes('<MobileOptionRow') && sources.screener.includes('<MobileBottomSheet')],
  ['Screener phone state exposes structural scope drift and fatal retry feedback', sources.screener.includes('ETF or expiration changed since the last Load') && sources.screener.includes('loadError') && sources.screener.includes('Retry')],
  ['Screener phone states use a compact, explicit state surface', sources.screener.includes('screener-mobile-state--ready') && sources.screener.includes('screener-mobile-state--error') && sources.css.includes('.screener-mobile-state')],
  ['Watchlist uses the same shared option row language', sources.watchlist.includes('if (isPhone)') && sources.watchlist.includes('<MobileOptionRow')],
  ['Shared option identity keeps ticker, strike, expiry, and watch control legible in phone landscape', sources.mobileOptionRow.includes('mobile-option-chain-cell__identity') && sources.mobileOptionRow.includes('mobile-option-chain-cell__ticker') && sources.css.includes('grid-template-columns: minmax(7rem, 1.45fr)')],
  ['Watchlist phone refresh failure preserves a visible retry path', sources.watchlist.includes('refreshError') && sources.watchlist.includes('Tap refresh to retry')],
  ['Portfolio puts grouped position rows before one-at-a-time analytics', sources.portfolio.includes('if (isPhone && !isPhoneLandscape)') && sources.portfolio.indexOf('<MobilePositionRow') < sources.portfolio.indexOf('Portfolio analytics')],
  ['Portfolio Analytics is collapsed by default with touch-safe controls in both layouts', sources.portfolio.includes('useState(false)') && (sources.portfolio.match(/aria-controls="portfolio-analytics-content"/g) ?? []).length === 2 && (sources.portfolio.match(/aria-expanded=\{analyticsExpanded\}/g) ?? []).length === 2 && sources.portfolio.includes('min-h-11')],
  ['Schedule removes the Net Capital at Risk display column without removing its calculations', !portfolioSchedule.includes("sortButton('netCapitalRisk', 'Net Capital at Risk')") && !portfolioSchedule.includes('formatCurrency(group.netCapitalAtRisk, 0)') && sources.portfolio.includes('calculateNetCapitalAtRisk')],
  ['Portfolio exposes persistent Expiry/Underlying/None grouping and VIX-first schedule data', sources.portfolio.includes("['expiration', 'Expiry']") && sources.portfolio.includes("['none', 'None']") && sources.portfolio.includes("groupMode === 'none'") && sources.portfolio.includes('VIX @ Entry') && sources.portfolio.includes('Show OI / Volume') && sources.portfolio.includes('Realized IRR')],
  ['Portfolio Close Candidate reasons are visible without hover', sources.portfolio.includes("candidate.reasons.join(' · ')")],
  ['Portfolio backup stays in utility actions and uses a phone-safe cloud confirmation sheet', sources.portfolio.includes('Data Backup') && sources.dataBackup.includes('max-h-[94dvh]') && sources.dataBackup.includes('Replace Account Data') && sources.dataBackup.includes('Download Current Recovery Backup')],
  ['Portfolio phone landscape removes the repeated title while retaining the action toolbar', sources.css.includes('.portfolio-page .page-header__title') && sources.css.includes('padding-top: 0.45rem') && sources.portfolio.includes('Import Screenshot') && sources.portfolio.includes('Portfolio Maintenance')],
  ['ETF Pulse offers one-at-a-time List, Heatmap, and Momentum views', sources.pulse.includes("'list' | 'heatmap' | 'momentum'") && sources.pulse.includes('mobileVisual === \'heatmap\'') && sources.pulse.includes('mobileVisual === \'momentum\'')],
  ['ETF Pulse mobile List uses compact flow rows while preserving loading, empty, and visual branches', sources.pulse.includes('mobile-pulse-list-item') && sources.pulse.includes('pulse-mobile-skeleton') && sources.pulse.includes('pulse-mobile-empty-state') && sources.css.includes('.mobile-pulse-list-item') && sources.css.includes('max-width: 950px')],
  ['option detail is a full-screen phone trade sheet', sources.optionDetail.includes('if (isPhone)') && sources.optionDetail.includes('mobile-trade-sheet absolute inset-0') && sources.css.includes('.mobile-trade-sheet')],
  ['option detail shows canonical yield/risk metrics without removed return rows', sources.optionDetail.includes('Nominal Yield') && sources.optionDetail.includes('Annualized Yield') && !sources.optionDetail.includes('Net-Risk Return')],
  ['phone chart prioritizes canvas and keeps vertical page panning available', sources.chart.includes('is-phone-chart') && sources.chart.includes('touch-pan-y select-none') && !sources.chart.includes('touch-none')],
  ['holdings modal replaces the phone-width table with compact rows', sources.holdings.includes('sm:hidden') && sources.holdings.includes('hidden overflow-x-auto rounded-xl sm:block')],
  ['shared financial rows meet requested density and touch sizing', sources.css.includes('.mobile-option-chain-row {') && sources.css.includes('min-height: 48px') && sources.css.includes('.mobile-position-row {') && sources.css.includes('min-height: 54px')],
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
