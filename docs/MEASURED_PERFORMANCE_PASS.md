# Measured performance pass — September 2026

Baseline: `b02822d` on `main`, after retired Portfolio OCR removal. Measurements were collected September 21; final visual/build checks resumed September 26 after an execution usage limit. Unrelated local documentation changes were preserved.

## Scope and method

Four hot paths now reuse fixed `Intl.DateTimeFormat` instances. No dates, quotes, derived financial values, account state, or API results are cached by this change. Locale/timezone/options, input validation, current-time evaluation, and calculations remain the same.

The production Vite build was profiled with local Chrome 152.0.7977.83, Node 24.15.0, a 1440×900 viewport, 4× CPU throttling, 60 ms network latency, and 1.5 MB/s download throughput. Each route started in a fresh browser context on Scanner; three before and three after samples were collected per lazy route. Market and cloud endpoints used the existing fabricated fixtures; all other external traffic was blocked. Benchmark builds used source maps for CPU attribution and a fake account endpoint, with the production React runtime and no visual-fixture feature flag. Release builds omit source maps/instrumentation.

Populations: 40 open Portfolio lots plus 202 archived entries; 80 Option Chain contracts; 80 Watchlist entries; 672 loaded Screener rows; 86 Pulse rows. Portfolio profiling includes opening/closing Analytics and expanding History. Screener uses All scanned dates and disables Recent Trades Only in the test so the historical fabricated quotes remain represented. These are test actions, not changes to application defaults. The Options fixture includes an expired chain; the measurement covers row rendering and unavailable-value handling, not live-market latency.

Navigation timing is click-to-visible route content plus two animation frames, including browser automation observation overhead. It is not an isolated React commit duration or a guarantee that every data request has completed. CPU profiles and long-task observation cover the subsequent loaded-table work. Three samples on one workstation are descriptive, not a statistical performance SLA.

An exploratory fake-clock run was discarded: Playwright's clock wraps `Intl.DateTimeFormat` and distorted its cost. Only `native-before` and `native-after` artifacts support the tables below. Earlier empty-table fixture runs were also excluded.

## Retained optimizations

Median sampled self CPU in milliseconds across matching three-run interaction sequences:

| Hot path | Representative profile | Before | After | Change |
| --- | --- | ---: | ---: | --- |
| `shared/marketDate.js`: `usMarketDateIso` | Pulse | 22,623 | 787 | Reuse exact New York date formatter |
| `src/lib/portfolioQuoteFreshness.ts`: `marketDateKey` | Portfolio | 11,693 | 619 | Reuse exact date/weekday formatter |
| `src/lib/portfolioHistoryAnalytics.ts`: `expirationPeriodIdentity` | Portfolio History | 382 | 10 | Reuse UTC short-month formatter |
| `src/lib/format.ts`: `formatOptionLastTradeDate` | Loaded Screener | 1,061 | 31 | Reuse exact New York Last Trade formatter |

The shared market-date improvement also reduced Portfolio sampled self CPU from 3,885 to 265 ms and Screener from 3,223 to 167 ms. The four changes affect only formatter construction. They preserve original conversions, default arguments, date parts, invalid/future timestamp handling, and trading-session calculation. Tests explicitly advance the clock to ensure current date and timestamp admission do not become stale.

## Route and rendering results

Milliseconds, medians of three samples. Largest task is the median of each sample's largest observed task after navigation, including loaded-table/Portfolio interactions.

| Route | Navigation before | Navigation after | Largest task before | Largest task after |
| --- | ---: | ---: | ---: | ---: |
| Portfolio | 8,301 | 5,604 | 5,683 | 2,894 |
| Options | 895 | 806 | 287 | 223 |
| Watchlist | 3,016 | 2,501 | 558 | 338 |
| Screener | 1,807 | 2,137 | 3,482 | 1,293 |
| ETF Pulse | 2,530 | 2,305 | 25,218 | 1,337 |
| Recommendations | 2,058 | 1,591 | 166 | 121 |

Do not interpret every navigation difference as a causal improvement. Portfolio before ranged 2,836–8,567 ms and after 5,375–6,406 ms. Screener navigation did not improve (before 1,341–2,446; after 1,967–2,261); its loaded-table CPU and long tasks did. Recommendations had no dedicated optimization and overlapping timing ranges. The strongest evidence is the directly attributed formatter CPU reduction and shorter heavy long tasks. Long tasks remain in large Portfolio/Screener views; this pass does not claim to eliminate all jank.

## Loading and bundle audit

Scanner startup still loads the application/account bootstrap and Home route plus their shared dependencies. Browser assertions verify that the other six route chunks and XLSX do not load at startup. First navigation loads its route module; one native baseline sample measured main route asset transfers of 182 ms Portfolio, 131 Options, 165 Watchlist, 120 Screener, 113 Pulse, and 158 Recommendations. CPU profiles identified repeated formatter work rather than module transfer as the dominant measured problem. No isolated parse/evaluation benchmark is claimed.

Intent prefetch was considered but not implemented or claimed as a measured win. Eliminating a roughly 0.1–0.2 second module transfer did not justify broadening this pass while much larger CPU costs had direct evidence. There is no new hover/focus/touch fetch, early mount, or market-data prefetch. No production optimization was implemented and then rejected; all four selected edits passed the before/after CPU check. Portfolio splitting, extra memoization, virtualization, storage caches, and altered acquisition were not attempted.

On-disk release asset bytes, before → after:

| Asset | Before | After |
| --- | ---: | ---: |
| Main JS | 360,501 | 360,501 |
| CSS | 168,658 | 168,658 |
| Home | 60,918 | 60,918 |
| Portfolio | 214,971 | 214,996 |
| Options | 57,065 | 57,065 |
| Watchlist | 46,702 | 46,702 |
| Screener | 65,185 | 65,185 |
| Pulse | 57,370 | 57,370 |
| Recommendations | 118,000 | 118,000 |
| XLSX | 500,390 | 500,390 |

Total built JS/CSS increased by 77 bytes (2,095,866 → 2,095,943). CSS is byte-identical. XLSX remains dynamically imported in Excel workflows, and existing optional modal chunks remain lazy. No dependencies or chunking configuration changed. `build:report` passes the existing retired-code/account-bootstrap guards.

## Request and behavior verification

All three before/after samples have matching row populations and navigation/action request counts. From an already loaded Scanner: Portfolio performs one prices request and four unique option-chain requests automatically; Options performs one ticker-detail plus one options request; Watchlist one shared options request; Screener Load 28 batch requests; Pulse one aggregate request; Recommendations zero market requests. The availability and initial price/chart requests are warm from Scanner in this sequence. This does not replace cold-route ceilings in `requestBudgets.ts`.

The request ledger and its unit regressions pass. No provider, retry, cache-admission, optionability, freshness, refresh, ranking/evidence, Pulse breadth, persistence, formula, sorting/filter default, layout, typography, or animation policy changed. The four source diffs contain only formatter lifetime changes. Automatic Portfolio refresh remains present and was observed in every benchmark sample.

Verification completed:

- 609/609 normal Node unit tests, including five new date/session equivalence tests and affected request/freshness/history regressions.
- Typecheck; targeted TypeScript lint; JavaScript syntax checks.
- Production build and `build:report`; request ledger.
- 18 before and 18 after production-browser benchmark cases; request/row comparison passes.
- Mobile production-browser sanity check of all seven routes and opened Portfolio History, with no page errors or page-level horizontal overflow.
- Visual review of desktop Options, Watchlist, Screener, Portfolio Schedule/History, Pulse, Recommendations; mobile Scanner and all six other routes. The changes are not visually distinguishable aside from normal observation-time/date differences.

## Reproduction and artifacts

From the repository directory in PowerShell (use a fresh shell so fake account environment variables are not carried into a release build):

```powershell
$env:VITE_SUPABASE_URL='https://visual-fixture.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_visual_fixture'
npm.cmd run build -- --outDir e2e-artifacts/perf-dist --sourcemap
$env:PERF_LABEL='before' # choose a distinct label after the change
npx.cmd playwright test --config playwright.performance.config.ts --grep 'first navigation' --repeat-each=3
npx.cmd playwright test --config playwright.performance.config.ts --grep 'mobile route visual'
node scripts/performance-summary.mjs before after
```

The script compares row counts and request counts without brittle millisecond CI thresholds. The benchmark also guards lazy startup assets. Fixtures have dated expirations; refresh fabricated dates before benchmarking after those expirations. Do not use private account/workbook data.

Local ignored artifacts are under `e2e-artifacts/performance/`: native before/after JSON, Chrome CPU profiles, screenshots, profile summaries, and unit-test output. Before-build maps are retained locally in `e2e-artifacts/perf-baseline/`; after-build maps are in `e2e-artifacts/perf-dist/`. No profiling hook is shipped in application code. The changed production files are the four hot-path files listed above; supporting changes are the benchmark spec/config, summary script, two equivalence test files, and this report.
