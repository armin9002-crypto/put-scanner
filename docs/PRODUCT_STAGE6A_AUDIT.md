# Product Stage 6A Audit

> **Historical persistence note.** Product findings remain useful, but every local-first account-data statement was superseded by [Stage 7A cloud-authoritative account state](./PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md). Do not use this audit to design current Portfolio, Watchlist, or account-preference persistence.

Audit date: 2026-08-26

Code baseline: `3d1ed6b93303a4ff9d5d8963abda74f10c325cb8`

Scope: static code/path audit, focused regression tests, request-model review, and qualitative public-source research. No production, Vercel, or live Supabase mutation was performed.

## Executive verdict

Put Scanner is already more than a leveraged-ETF list. Its strongest coherent product loop is:

> discover a bounded set of put contracts, inspect contract and underlying context, save or record the contract, then manage the short-put liability and portfolio concentration.

That loop supports the product concept **Short-Put Decision Workstation**. “Leveraged ETF Put Scanner” is accurate for the current curated discovery universe but too narrow for the working product. “Cash-Secured Put Screener” undersells Portfolio and management. “Premium-Selling Dashboard” is too broad because the product does not cover calls, spreads, or every volatility strategy.

The initial external audience should be:

1. self-directed ETF/index-ETF cash-secured-put sellers;
2. disciplined wheel/CSP traders who maintain a curated “willing to own” list;
3. experienced leveraged-ETF put sellers as the differentiated specialist segment.

Do not target all option sellers. Do not become an all-market crawler, brokerage execution system, options-flow terminal, multi-leg simulator, or automated recommendation engine.

## 1. Code-based product map

### Routes and navigation

| Route | Page/owner | Current job | Important navigation |
|---|---|---|---|
| `/` | `src/pages/HomePage.tsx` | Scanner: overview and opinionated discovery across 42 leveraged ETFs. | Cards/rows link to `/options/:ticker`; specific date is encoded as `?expiry=YYYY-MM-DD`. |
| `/screener` | `src/pages/ScreenerPage.tsx` | Explicit, bounded option-contract discovery. | User selects ETFs/expiry, clicks Load, filters retrieved rows locally, opens drawer or detail. |
| `/watchlist` | `src/pages/WatchlistPage.tsx` | Saved **contracts**, not saved underlyings. | Rows open `OptionDetailDrawer` or the ticker detail route. |
| `/portfolio` | `src/pages/PortfolioPage.tsx` | Open short-put book, lifecycle history, management signals, and concentration analytics. | Add/edit/import, refresh, drawer, detail, schedule/analytics/history. |
| `/pulse` | `src/pages/EtfPulsePage.tsx` | ETF breadth, trend, return, RSI, drawdown, and market-regime context. | Rows link to ETF detail. |
| `/cockpit` | `src/App.tsx` | Compatibility redirect. | Redirects to `/pulse`. |
| `/options/:ticker` | `src/pages/OptionsPage.tsx` | Put chain, expiration selection, chart, leverage/proxy context, holdings, IV context, watchlist and portfolio entry. | Back-to-Scanner state/session fallback; exact expiry is refresh-safe. |

Desktop navigation and the mobile bottom navigation expose Scanner, Screener, Watchlist, Portfolio, and Pulse. Detail owns a dedicated mobile header. Pages are lazy-loaded; `CloudSyncProvider` is also lazy and absent unless `VITE_CLOUD_SYNC_ENABLED === 'true'`.

### Major UI components

- `ETFCard`, `MobileEtfRow`, and `MobileMarketStrip` render Scanner discovery/context.
- `ExpirationFilter` owns shared expiry labels and Scanner/Screener selection concepts.
- `MobileOptionRow` is reused by contract-heavy mobile views.
- `OptionDetailDrawer` is the cross-page contract inspection and position calculator.
- `InteractivePriceChartModal` owns multi-timeframe history, return ranges, underlying proxy comparison, and “true leverage.”
- `UnderlyingHoldingsModal` fetches holdings only after an explicit open.
- `MobileBottomSheet` and page-specific mobile trees provide touch layouts.
- `PortfolioScreenshotImportModal` performs client-side OCR/import review; `DataBackupModal` exports/imports durable JSON.
- `AccountControl`, account data/sync sections, conflict dialog, and `CloudSyncProvider` own authentication and cloud state.

### Ownership boundaries

| Concern | Authoritative code |
|---|---|
| Curated symbol identity/membership | `shared/symbolRegistry.js` and `.d.ts` after Stage 6A. `src/lib/etfs.ts` is a legacy UI adapter. |
| Current leveraged holdings/proxy behavior | `src/lib/underlyingHoldingsProxies.ts`; deliberately separate because this is specialized financial behavior, not general identity metadata. |
| Market request policy | `src/lib/marketDataRequest.ts`: memory + Web Storage, soft/hard TTL, in-flight dedupe, timeout, stale-on-error, endpoint cooldown, diagnostics. |
| Yahoo normalization | `api/_lib/yahoo.js`, `src/lib/yahooOptionAdapter.ts`, `src/lib/marketDataNormalize.ts`. |
| Shared option math | `src/lib/optionMetrics.ts`; put delta in `src/lib/putDelta.ts`; portfolio economics in `src/lib/portfolioMetrics.ts`. |
| Bounded fan-out | `shared/concurrency.js`, `src/lib/optionChainRequests.ts`, `src/lib/screenerAcquisition.ts`, server dataset builders. |
| Durable local state | Versioned envelopes in `portfolioStorage.ts`, `watchlist.ts`, and `durablePreferences.ts`. |
| Cloud state | Three Supabase `user_state` namespaces: portfolio, watchlist, preferences. Reconciliation/CAS lives under `src/lib/cloudState`. |
| Transient market state | Component state and market caches only; it is intentionally excluded from Supabase durable documents. |

### API and provider map

| Browser endpoint | Server work | Main cache policy |
|---|---|---|
| `/api/prices` | Batched Yahoo quotes, chunks of 20, concurrency 3. | Client price soft TTL 3m/hard 45m; CDN 5m/SWR 15m. |
| `/api/price` | Extended quote; with sparkline it performs one 1Y daily chart plus one 1D one-minute chart. | Client soft 10m/hard 60m; CDN 5m/SWR 15m. |
| `/api/options` | Initial or dated Yahoo option chain with validation metadata. | Client initial soft 15m/hard 2h; dated soft 10m/hard 30m; CDN initial 5m/SWR 15m, dated 10m/SWR 30m. |
| `/api/chart-history` | Yahoo chart history or explicit custom range. | Timeframe-specific client TTL; longer histories can satisfy shorter requests. CDN varies by timeframe. |
| `/api/ivrank` | ATM put IV plus one-year weekly price history. | Client 1h/hard 4h; CDN 1h/SWR 6h. Current metric uses realized-vol history; see metric audit. |
| `/api/holdings` | Yahoo fund holdings. | Explicit open only; client 7d/hard 30d; CDN 1d/SWR 7d. |
| `/api/fund-metadata` | Bulk Yahoo quote-summary metadata for net assets. | Scanner launch, cache broker protected. |
| `/api/screener-expirations` | Initial chains for seven representative ETFs, concurrency 3. | Session/client cache and CDN; partial-safe. |
| `/api/screener-batch` | Fixed three-symbol chunk: initial chains, up to one extra chain per ticker, and one IV-history request per ticker; concurrency 3. | Fixed chunk/date key; complete datasets CDN 5m/SWR 15m. |
| `/api/etf-pulse` | 44 two-year histories, concurrency 6. | One browser dataset; client row cache 6h/hard 24h; CDN 1h/SWR 6h. |

## 2. Actual data flows and request behavior

### Scanner

On a cold mount, Scanner starts six browser acquisitions: one `/prices` for 42 tickers, one `/fund-metadata`, and four `/price` sparkline requests for QQQ, SPY, VIX, and VXN. Cold provider work is approximately eight Yahoo calls: three quote chunks, one fund-metadata bulk call, and four intraday charts. The existing market-data architecture document's older seven-call benchmark omits the later fund-metadata acquisition.

Search, leverage/category, expiration, liquidity, and sort changes are local. Card hover/click does not fetch. The `Update` action explicitly refreshes only missing/stale option snapshots for visible symbols, at concurrency 3 and up to two chains per ticker. Opening a chart requests the ticker and, when meaningful, one proxy history.

### Screener

Mount can acquire VIX context and one `/screener-expirations` dataset; the latter fans out to seven representative initial chains. This is useful but is the largest non-user-initiated option-chain fan-out.

Load is explicit. The fixed universe is 14 chunks of three. A selected ticker still causes its entire three-symbol server chunk to be acquired; that intentionally improves stable shared CDN keys but can overfetch up to 3× for a small selection. Each cold chunk performs three initial chains, up to three additional chains, and three IV-history chart calls: up to nine provider attempts. Full-universe cold worst case is therefore 14 Vercel calls and roughly 126 provider attempts, bounded at browser concurrency 2 and server concurrency 3. CDN and browser caches make repeated identical scans far cheaper.

Delta, moneyness, yield, OI, volume, and IV filters apply to `rawRowsRef` after retrieval and make zero network requests. Ticker and expiration changes are structural and require Load. A latest-scan gate aborts/invalidates older scans.

### Detail and drawer

A supported detail route starts options and extended-price requests in parallel, then IV context asynchronously. With `includeSparkline=true`, extended price costs two provider chart calls. Standalone `/ivrank` may reacquire initial option data and adds a weekly chart; across separate server invocations it cannot reliably reuse the raw payload from `/options`. Cold detail can therefore cost three browser API calls and about five provider calls. This is the clearest request-consolidation candidate for a later stage.

Changing expiration costs one dated chain. Stage 6A now verifies the returned chain matches the requested date and preserves the old chain on mismatch. Drawer open, quote selection, calculation, Watchlist save, and Portfolio draft creation are local/durable operations with no market fetch.

### Watchlist

Watchlist is contract-centric. On mount, a non-empty list automatically refreshes cache-first: one price batch plus one unique ticker/expiration chain, deduplicated at concurrency 3. Explicit refresh uses revalidation. Transient snapshots/status live under the envelope's `localState`; durable comparisons prevent quote changes from becoming cloud CAS writes. Stage 6A fixed expiration-day contracts to remain live at DTE 0.

### Portfolio

Mount loads local durable state and performs no open-position quote refresh. It does automatically archive expired open trades; unresolved expiration prices can require one custom history per unique ticker/expiration at concurrency 3. “Refresh Open Trades” archives, fills missing entry VIX from a batched custom VIX history when needed, fetches one price batch, and fetches one unique option chain per ticker/expiration at concurrency 3.

### Pulse, charts, and cloud

Pulse makes one browser request but 44 provider-history calls on a cold CDN miss. This is acceptable at the current stable set and not a pattern to extend to hundreds of symbols.

Each chart timeframe change requests one main history and usually one leveraged proxy history. Longer cached histories are reused where compatible. Stage 6A added latest-request-only publication so a slow prior timeframe cannot overwrite a newer choice.

Cloud sync is absent when the feature flag is off. Anonymous, unconfigured, and unenrolled cases perform local checks only. A signed-in enrolled startup fetches all three namespaces in one Supabase select and reconciles them; durable local events enqueue per-namespace CAS updates. There is no polling or Realtime.

## 3. User-journey audit

| Job | What works well | Friction / missing context / external tool still needed |
|---|---|---|
| A. Find an attractive put | Scanner gives fast curated context; Screener gives explicit bounded discovery with delta/yield/liquidity filters. | Scanner's automatic universe is leveraged-only; Scanner and Screener roles are not explained to a newcomer; no earnings/event awareness. |
| B. Compare underlyings | Scanner price/performance/assets, Pulse trend/regime, charts, and proxy comparison are unusually cohesive. | Comparison spans Scanner and Pulse; no saved underlying list; “IV Rank” definition is nonstandard. |
| C. Choose expiration | Exact-date navigation is now refresh-safe; range buckets preserve shortest-DTE behavior; detail shows all expiries. | No side-by-side term structure or “best expiry” comparison; Screener expiration discovery has hidden seven-chain cost. |
| D. Compare strikes | Dense table, quote variants, delta, moneyness, yields, liquidity, and drawer make strike comparison strong. | Missing-values sorting can put unavailable values first in ascending sorts; no expected move or event marker. |
| E. Inspect underlying | Multi-timeframe chart, returns, true leverage, proxy holdings, fund assets, Pulse context. | Holdings fallback assumes unknown symbols are ETFs; stock fundamentals/events are absent; separate detail IV endpoint duplicates work. |
| F. Save a contract | One-click contract Watchlist with notes and durable/cloud-safe state. | Cannot save an underlying independently; users may misuse contracts as a symbol watchlist. |
| G. Add a sold put | Drawer transfers exact contract and entry snapshot; Portfolio supports manual and screenshot import. | No broker import/sync; zero sold price is accepted; position metric labels need denominator clarity. |
| H. Monitor a position | Explicit mark basis, P&L, premium captured, delta, DTE, distance, refresh, and lifecycle history. | Refresh is manual and linear in unique chains; no event proximity or stale-quote triage at portfolio level. |
| I. Decide whether to close | Close Candidates and 50%/75% captured, low remaining yield, small premium, DTE/cushion signals are actionable. | Scoring is embedded in the 153 KB page, thresholds are unexplained, and no transaction-cost/fill sensitivity is shown. |
| J. Understand concentration/risk | Expiry/ticker grouping, maturity wall, gross/net capital, leverage/theme/category and delta analytics are rich. | Some buckets depend on leveraged-ETF maps and manual fallbacks; gross risk, delta exposure, and concentration compete for attention. |
| K. Review volatility/context | QQQ/SPY/VIX/VXN strip and Pulse regime give a real top-down workflow. | Context is not consistently carried into contract/portfolio decisions; no event-specific context for stocks. |

### Strongest current capabilities

1. A complete local-first path from discovery to saved contract to managed position.
2. Conservative request architecture: explicit bulk loads, bounded concurrency, caching, stale fallback, and no polling.
3. Dense but useful put-specific contract comparison on desktop and mobile.
4. Portfolio lifecycle handling, including immutable expiration resolution and history analytics.
5. Leveraged-ETF-specific chart/proxy context that broad generic tools do not present cohesively.
6. Durable versioned storage, backup, account migration, CAS sync, and conflict recovery without mixing transient quotes into cloud state.

### Biggest workflow weaknesses

1. Discovery cannot yet start from a normal ETF/stock or user-entered ticker, even though much of detail/portfolio math is generic.
2. Ambiguous metric labels hide gross-secured-cash versus net-risk denominators.
3. Event risk (especially earnings for stocks) and executable-liquidity quality are the largest missing pre-trade contexts.
4. Watchlist is contract-only, leaving the “willing to own” underlying list unmodeled.
5. Detail and Portfolio are monolithic pages with distinct mobile/desktop render trees, increasing drift risk.
6. The current IV Rank label overstates what the data calculates.

## 4. Concrete bugs and fragilities

### Fixed in Stage 6A

1. **Watchlist prematurely expired 0-DTE contracts.** `buildRow`, refresh planning, and merge logic treated `DTE <= 0` as expired while Portfolio correctly used `< 0`. Expiration-day contracts now remain refreshable/live.
2. **Chart timeframe race.** Main history requests lacked cancellation/generation validation; a slow old request could publish after a newer timeframe. Publication/loading/error state is now generation-gated.
3. **Unsupported detail routes fetched before rejection.** `/options/NVDA` and lowercase paths could start options/price/IV work before the late `ETF not found` render. Tickers are normalized and unsupported symbols are gated before acquisition.
4. **Expiration-click fallback could be mislabeled.** The clicked date was selected before the response and the response was accepted even when Yahoo returned another date. Selection is committed only after chain metadata matches.
5. **Detail route/request race.** Navigating between detail tickers could allow an older route's options/price/IV response to publish. A route generation now invalidates older work and clears old detail state.

### Documented, not changed

| Finding | Evidence and consequence | Disposition |
|---|---|---|
| Options fallback delta can use invalid underlying | `OptionsPage` calls the model even when current price is zero, unlike Watchlist/Portfolio guards. Missing delta can look near −1 rather than unavailable. | Change requires nullable enriched-row typing and UI audit; Stage 6B candidate. |
| Missing numeric values sort inconsistently | Screener and Watchlist map null to negative sentinels; ascending sorts put unavailable first. Scanner/Portfolio have explicit unavailable-last behavior. | Extract/test one missing-last comparator in Stage 6B. |
| Unknown holdings proxy assumes ETF | `getUnderlyingHoldingsProxy` default says direct ETF holdings and enables holdings for unknown symbols. | Analyze-Ticker must branch on registry `assetType`; never apply that default to stocks. |
| Detail duplicates option acquisition for IV context | `/options` and standalone `/ivrank` are separate function calls; IV rank fetches an initial chain when `optionData` is absent. | Consolidate a bounded detail payload or derive compatible context server-side later. |
| Pulse fan-out is linear | One cold dataset performs 44 histories. | Keep Pulse membership intentionally small; do not attach the entire curated stock universe. |
| Watchlist mount refresh is linear | One chain per unique saved ticker/expiry occurs automatically, cache-first. | Add freshness/visible caps before external scale; preserve explicit refresh semantics. |
| Full Screener chunk overfetch | One chosen ticker loads all three symbols in its stable chunk. | Accept for current universe/CDN economics; reconsider for user-entered symbols. |
| Page monoliths | Portfolio ≈153 KB, Options ≈82 KB, Screener ≈65 KB, Pulse ≈60 KB source. | Extract tested view models and management policies before adding major UI. |
| Mobile/desktop drift | Key pages render separate branches with repeated control/metric copy. | Continue shared calculations/models; add parity contract tests for new features. |
| Embedded management thresholds | Close-candidate logic lives inside `PortfolioPage.tsx`: 50/75% captured, AY <5%, mark <=$0.05, DTE <=14 plus cushion. | Extract and explain before making thresholds configurable. |
| Portfolio schedule has dormant sort enum | `netCapitalRisk` remains in sort type/switch after the display column was removed; no UI exposes it and sort state is not persisted. | Harmless dead path; clean during a schedule extraction, not as an isolated financial change. |

No regression was found in the recent exact-expiry navigation, shortest-DTE bucket behavior, Portfolio Analytics collapsed default, removed schedule column, or cloud/sync architecture.

## 5. Leveraged-ETF assumption inventory

| Class | Material assumptions |
|---|---|
| A — Copy only | “Leveraged ETFs” page/nav/title copy; “ETFs,” “Scan All ETFs,” search placeholders, “ETF opportunities,” detail `ETF not found`, Pulse ETF language. Easy to contextualize once another universe is visible. |
| B — Easy to generalize | The duplicated 42-ticker arrays (centralized in Stage 6A); instrument names; route normalization; Scanner/Screener selectors; Pulse adapter; category filter labels; ticker descriptions. |
| C — Architectural dependency | Fixed three-ticker Screener chunks; Scanner full-universe price/assets load; Pulse one-history-per-member dataset; ETF-only `ETFInfo` passed through pages; Watchlist contract-only model; route allows only Scanner members. |
| D — Financial logic dependency | True leverage against a proxy, leverage/theme concentration buckets, proxy holdings, “leveraged” posture/risk copy, and daily-reset interpretation. These must be conditional on symbol metadata. |
| E — Should remain leveraged-specific | True-leverage calculations, benchmark proxy maps, non-meaningful commodity holdings warnings, leverage-aware concentration, and daily-reset/compounding risk education. |

The registry separates “the app supports leveraged products” from “all symbols are leveraged ETFs,” but the visible discovery universe intentionally remains unchanged in Stage 6A. Leveraged and inverse ETPs generally target daily, not long-period, multiples, and volatility/compounding can materially alter longer-period results; that is a product-specific risk worth retaining prominently ([FINRA](https://www.finra.org/investors/insights/lowdown-leveraged-and-inverse-exchange-traded-products)).

## 6. Short-put job to be done

Ranked decision questions:

1. **Would I willingly own this underlying at the effective purchase price?** This dominates every attractive premium statistic.
2. **Can I afford and tolerate assignment/concentration?** Gross secured cash, contracts, existing correlated exposure, and account size.
3. **Is the contract executable?** Real bid, spread %, OI/volume, quote age.
4. **What downside/event risk occurs before expiry?** Trend/drawdown, earnings or other major event, leveraged daily-reset behavior.
5. **Is the strike/expiry risk–reward acceptable?** Delta proxy, OTM distance, breakeven/cushion, DTE, premium.
6. **Is volatility compensation elevated relative to a defensible history?** Correctly defined IV context, not a misleading label.
7. **Is another strike/expiry materially better?** Side-by-side marginal premium versus extra risk/time/capital.
8. **After entry, what changed and what requires action?** P&L/captured premium, delta, distance, DTE, quote freshness, event proximity.
9. **Should I close, hold, accept assignment, or evaluate a roll?** Remaining economics and original thesis; never a single score.

The Options Industry Council describes a cash-secured put primarily as a stock-acquisition strategy whose maximum loss remains substantial; the seller should accept ownership outcomes, not merely chase income ([OIC](https://www.optionseducation.org/strategies/all-strategies/cash-secured-put)). Fidelity likewise defines breakeven as strike minus premium and emphasizes that the obligation can be closed before assignment ([Fidelity](https://www.fidelity.com/learning-center/investment-products/options/options-strategy-guide/shortput-cashsecured)).

## 7. User archetypes

| Archetype | Objective/risk | Typical universe and trade | Important metrics/workflow | Current fit / largest gap |
|---|---|---|---|---|
| Conservative CSP seller | Acquire quality assets below current price; low/moderate risk. | Broad/sector ETFs and profitable liquid large caps; often 21–60 DTE, roughly 0.10–0.25 absolute delta. | Ownership thesis, cash, cushion, liquidity, event avoidance, concentration. | Strong mechanics/ETF context; missing normal universe, events, explicit secured-cash language. |
| Wheel investor | Repeated puts → assignment → calls; moderate risk. | “Willing to own” stocks/ETFs; often 20–50 DTE and 0.20–0.35 delta. | Lifetime basis, assignment state, roll/close economics, dividends. | Put leg/portfolio strong; no underlying list, stock/share/covered-call lifecycle. Do not promise full wheel yet. |
| High-IV premium seller | Monetize elevated volatility; high risk. | Eventful/high-beta names; varied DTE/delta. | True IV rank/percentile, IV-HV, skew, events, liquidity, defined-risk alternatives. | Current IV label/data and event coverage insufficient. Not an initial target. |
| Leveraged-ETF seller | Earn premium on high-beta daily-reset products; high risk. | Current 42, often wide cushion/lower delta. | True leverage, proxy trend/holdings, drawdown, spread, capital, concentration. | Best current fit and clear differentiation. |
| Index/ETF seller | Systematic premium on diversified products; low/moderate risk. | SPY/QQQ/IWM/sector ETFs; commonly 21–60 DTE. | Regime, term/strike comparison, liquidity, portfolio exposure. | Strong architecture and context; normal ETFs absent from discovery. |
| Income-focused seller | Stable cash-flow target; moderate risk. | Liquid ETFs/large caps; repeated monthly cycles. | Premium/day, return on secured cash, realized history, idle capital. | Good yield/history base; labels and portfolio cash planning need work. |
| Small-account seller | Fit assignment within limited capital; variable risk. | Lower-priced liquid stocks/ETFs; 7–45 DTE. | Max secured cash, contract count, liquidity, concentration. | Portfolio supports contracts, but no price/account-size universe control. Risk of steering users toward low-quality high IV. |
| Tactical/event-aware seller | Intentionally trade or avoid catalysts; high expertise. | Single names around earnings/news; short durations. | Earnings timing, implied move, IV crush, historical event moves, liquidity. | Pulse/trend useful; required event data absent. Later audience only. |

Best first external archetypes: Index/ETF seller, Conservative CSP seller with a curated list, and the existing Leveraged-ETF specialist. The Wheel user is a secondary audience until shares/calls/lifetime basis exist.

## 8. External behavior research

### Recurring needs

- Users repeatedly combine a curated “willing to own” universe with strike/expiry selection rather than blindly scanning every optionable ticker. A long-running r/thetagang discussion explicitly preferred a curated list and asked for midpoint, annualized yield, daily decay, delta, underlying price, DTE, earnings, and spreads ([thread](https://www.reddit.com/r/thetagang/comments/jds24d)).
- Delta, DTE, IV/IV rank, yield, OTM/cushion, and liquidity recur. Another discussion adds underlying fundamentals, RSI, events, and ratings, while warning that yield comparisons require DTE normalization ([thread](https://www.reddit.com/r/thetagang/comments/jmogna)).
- Recent hobbyist screeners still converge on roughly 0.15–0.30 delta, 21–55 DTE, IV context, and liquidity minimums, with requests for RSI/trend context ([example](https://www.reddit.com/r/IMadeThis/comments/1urerau/i_built_a_cashsecured_put_screener_because_i_got/)). Treat these bands as user conventions, not validated universal rules.
- Earnings awareness is repeatedly requested for single stocks. Schwab notes earnings can create sharp moves, IV changes, and greater assignment risk; knowledge of the company remains necessary ([Schwab earnings guide](https://www.schwab.com/learn/story/trading-options-around-earnings-announcements)).
- Bid/ask spread is not cosmetic. Schwab shows how large spreads impose immediate economic cost and connects higher volume with tighter spreads ([Schwab liquidity guide](https://advisorservices.schwab.com/story/options-market-participants)).
- Position management often revolves around closing winners, rolling challenged positions, and tracking basis, but behavior is heterogeneous. The app should calculate choices, not prescribe one threshold.

### Classification

| Class | Findings |
|---|---|
| Frequent need | Curated universe; delta/DTE/OTM; executable bid/spread; yield on cash; earnings awareness for stocks; Watchlist; P&L/captured premium; concentration. |
| Power-user need | IV term structure, IV vs realized vol, skew, expected move, roll economics, multi-leg alternatives, backtesting. |
| Beginner question | “What does delta mean?”, “Can I be assigned?”, “Why is high yield risky?”, “How much cash is required?”, “What happens at expiry?” Solve with definitions/context, not a beginner-only UI. |
| Niche need | 0-DTE automation, unusual flow, naked margin optimization, systematic bots, crypto options, futures options. |
| Bad practice | Selecting solely by annualized yield/IV, treating delta as exact assignment probability, ignoring ownership/cash/event risk, assuming leveraged ETF long-term multiple equals daily target. |
| Served better elsewhere | Brokerage execution/order status; full multi-leg payoff simulation; real-time flow; institutional volatility surface; tax accounting. Integrate/link conceptually later rather than clone. |

## 9. Competitive job analysis

| Tool | Job the user opens it for | Relevant strength | Put Scanner opportunity |
|---|---|---|---|
| Broker chain/watchlist | Verify live quote, buying power, place/adjust order. | Executable account data and order routing. | Be the pre-trade and management workspace; never imply quotes equal fills. |
| OptionStrat | Visualize P&L/Greeks across time/IV and optimize multi-leg structures; track strategies. | Strategy builder, optimizer, events, probability, saved strategies ([features](https://optionstrat.com/features)). | Avoid building a generic simulator. Link discovery → simple short-put economics → portfolio more quickly. |
| Barchart | Full-market filter/saved screener/export/email. | Broad puts/calls filters and scheduled discovery ([screener](https://www.barchart.com/options/options-screener)). | Win on curated ownership-quality workflow and integrated short-put book, not universe breadth. |
| Market Chameleon | Deep volatility/event/options statistics. | Thousands of symbols, ATM spread, option volume, earnings, IV/HV and rigorously distinguished IV percentile/range ([screener](https://marketchameleon.com/Screeners/Options), [IV definitions](https://marketchameleon.com/volReports/VolatilityRankings)). | Use fewer, clearer, put-decision metrics; correct the current IV terminology. |
| Option Samurai | Highly configurable strategy scans, scenario/stress tools, Monte Carlo, wheel screens. | 100+ filters and broad strategy tooling ([features](https://optionsamurai.com/product/all-features/)). | Do not copy filter count; make the default decision path coherent. |
| Unusual Whales | Flow, dark pool, Greek exposure, events, APIs. | 100+ data endpoints and real-time market-attention workflows ([API/features](https://unusualwhales.com/public-api)). | Flow is not required to answer “would I sell/own/manage this put?” |
| TradingView | Technical charting and configurable security screening; increasingly options chain comparison. | Multi-expiration chains, Greeks, strike/expiry/spread filters ([options chain](https://www.tradingview.com/support/solutions/43000760837-options-chain-overview/)). | Keep charts decision-specific: breakeven, strike, proxy, leverage, and portfolio context. |
| Spreadsheet | User-defined formulas, journal, basis, bespoke rules. | Infinite customization and ownership. | Provide trustworthy definitions/export and remove repetitive data entry while keeping user agency. |

Plausible differentiation: **a curated, local-first, short-put workflow where underlying quality/context, executable contract economics, and existing portfolio exposure are visible in one decision loop**, with unusually strong leveraged-ETF context. That is more defensible than “more filters.”

## 10. Product-role recommendations

### Scanner

Scanner should be an opinionated **curated opportunity overview**, not an option-chain crawler. It can load cheap underlying-level data for a bounded core universe, show cached/on-demand option snapshots, and answer “where should I investigate?” It should preserve current leveraged-ETF expertise and later add curated normal ETFs/stocks through categories. It should not automatically fetch chains for every member.

### Screener

Screener should be **explicit user-defined contract discovery**:

`select bounded universe/symbols → choose structural expiry scope → Load → retrieve bounded chains → filter/sort locally`.

Recommended initial caps: 50 selected symbols, no more than two expirations per symbol per Load, stable displayed request estimate, explicit confirmation above 20 symbols, browser concurrency 2, server/provider concurrency 3. User-entered/on-demand symbols should use exact symbol requests rather than fixed curated chunks.

### Watchlist

Watchlist should eventually support both concepts but as distinct entities:

- **Saved contracts**: current object, expiry/strike/quote snapshot/note.
- **Saved underlyings**: a future lightweight list representing “willing to own/watch,” with no automatic option-chain fan-out.

Do not overload one schema. Current Watchlist remains contracts-only in Stage 6A.

### Portfolio

Portfolio's primary question is “what short puts do I have, what changed, and what needs attention?” Most useful current signals, in order:

1. quote freshness/status plus current buy-to-close mark;
2. DTE and expiration/maturity concentration;
3. distance to strike/breakeven and delta;
4. P&L and premium captured;
5. gross secured cash and ticker/correlated exposure concentration.

Current/remaining AY is useful as a redeployment comparison but should not outrank assignment risk or liquidity. “Close Candidates” is useful but must show reasons and mark basis, not appear as advice.

### Analyze Ticker

Recommend Stage 6B implementation. Current `/options/:ticker` already has most acquisition, chain, chart, drawer, Watchlist, and Portfolio-entry mechanics. Required work is bounded:

- accept a normalized user-entered symbol;
- validate provider support and optionability on explicit submit;
- use registry metadata when known and a minimal runtime fallback when unknown;
- branch ETF-only holdings/proxy/leverage UI by `assetType`;
- give unsupported/non-optionable/invalid symbols distinct errors;
- cache only market data, not automatically mutate the curated registry;
- do not add the symbol to Scanner/Pulse or bulk scans unless explicitly saved/configured.

Request cost is one normal detail acquisition per explicit analysis, not a market crawl.

## 11. Metric and missing-metric conclusions

The complete formula audit is in `docs/PUT_METRIC_DEFINITIONS.md`.

### Inconsistencies requiring product language

- Discovery AY divides premium by gross strike collateral; drawer/Portfolio Entry AY divide by net maximum-loss capital. Both are reasonable but the labels imply sameness.
- Portfolio Current AY and AY to maturity use different risk denominators.
- Current “IV Rank” compares ATM implied volatility with a range of weekly realized-vol estimates, not historical implied volatility.

No silent formula change was made.

### Potential metrics

| Classification | Metrics | Rationale |
|---|---|---|
| High-value / feasible now | Return on secured cash (already calculated; rename); delta as a clearly labeled proxy; liquidity score/spread %; premium/capital; drawdown from high; trend context; realized vol. | Current Yahoo inputs and code support them, subject to honest labels. |
| High-value / data problem | True IV rank/percentile, earnings proximity, ex-dividend proximity, probability of assignment. | Yahoo reliability/history is insufficient for paid-product promises; delta is not exact assignment probability. Use a licensed/reliable source or label unavailable. |
| Useful later | Expected move from ATM straddle, IV vs realized vol, downside to 52-week low, put/call skew, capital efficiency under user-selected collateral policy. | Useful after metric definitions, event data, and universe support are stable. |
| Low value | More raw Greeks in every Scanner row, generic fundamental ratios without an ownership workflow, social sentiment scores. | Adds density without improving the core decision. |
| Misleading | A single “opportunity score,” uncaveated probability-of-profit, annualized 0–3 DTE yield leaderboard, current IV Rank label. | Hides model/data assumptions and encourages yield chasing. |
| Not worth complexity now | Full volatility surface, institutional flow, intraday backtesting, broker-margin optimization. | High data/license/request burden and already served by specialists. |

## 12. Position management and rolling

The 3–5 best management signals are quote freshness/executability, DTE/expiry concentration, strike/breakeven distance plus delta, captured premium/P&L, and assignment cash/concentration. Add event proximity only when reliable data exists.

Do not implement rolling as a “roll button.” A useful comparison must retrieve the current close cost and candidate new chains, then show:

- current buy-to-close cost;
- new credit, strike, expiry, and DTE;
- combined net credit/debit;
- added calendar days;
- new effective breakeven including cumulative credits/debits;
- incremental secured cash;
- incremental annualized economics;
- before/after delta, cushion, liquidity, and concentration.

Current Yahoo infrastructure can support an **explicit one-position roll comparison** with the current chain plus one or two bounded future expirations. It cannot support automatic portfolio-wide roll scanning cheaply/reliably. Design in Stage 6C; implementation after Analyze Ticker, metrics, events, and management-policy extraction.

## 13. UX and information density

### Redundancy and ambiguity

- Detail rows, drawer cards, drawer calculator, and Portfolio repeat premium/breakeven/AY with different price inputs/denominators.
- Gross risk, net risk, maximum loss, current value, current premium, Current AY, and remaining AY are mathematically distinct but visually adjacent.
- Scanner and Pulse both summarize underlying trend/context but do not explain their separate jobs.
- Screener desktop/mobile duplicate a large filter vocabulary and result controls.
- Portfolio has summary, schedule, close candidates, analytics, maturity, and history; collapsed analytics helps, but “what needs attention” is still distributed.

### Progressive disclosure without dumbing down

- Put a one-line denominator/source tooltip on yield, IV context, delta, and mark basis.
- Keep the default contract columns to strike, DTE, bid/ask, delta, OTM, annualized secured-cash return, and liquidity; put Last, IV, Vol/OI, and alternate quote yields behind column controls.
- Preserve advanced charts/analytics in collapsible sections.
- Distinguish “Unavailable,” “Stale,” and numeric zero everywhere.
- Use a first-run explanation of Scanner vs Screener vs Watchlist, then never force a tutorial.
- For management cards, show reason chips and source/mark rather than an opaque score.

## 14. Request economics

These are architecture ranges, not provider-billing forecasts. They assume cold browser and CDN caches unless noted. Provider retries/session bootstrap can add attempts.

| Action | Browser → Vercel | Vercel → Yahoo/provider | Supabase |
|---|---:|---:|---:|
| App/Scanner cold launch | 6 | ~8 | 0 anonymous; ~1 select if enrolled sync starts |
| Scanner filters/card interaction | 0 | 0 | 0 |
| Scanner snapshot update | 0–2 per visible stale ticker | same order | 0 |
| Screener mount, caches cold | ~2 | up to ~8 | 0 |
| Screener Load | 1 per touched fixed chunk; 1–14 current | up to ~9 per cold three-symbol chunk | 0 |
| Explicit ticker analysis/detail | 3 current | roughly 4–5 cold | 0 |
| Expiry change | 1 | ~1 | 0 |
| Drawer | 0 | 0 | 0 |
| Watchlist mount/refresh | `1 + unique chains` | `ceil(unique tickers/20) + unique chains` | durable write only if user mutation; transient refresh does not sync |
| Portfolio mount | usually 0; up to unresolved-expiry history keys | same order | sync startup independent |
| Portfolio refresh | `1 + unique chains + optional VIX history` | comparable | 0 unless durable archive/entry-VIX state changes and sync is enabled |
| Chart timeframe | 1 main + 0/1 proxy | same order | 0 |
| Cloud startup | 0 market calls | 0 market calls | one three-namespace select when eligible |

At 100 simultaneous cold Scanner launches with no CDN reuse, the upper bound is approximately 600 Vercel requests and 800 Yahoo calls; actual CDN collapse should materially lower provider calls. At 1,000, burst shape—not monthly user count—is the danger: 6,000 browser API requests and a theoretical 8,000 provider attempts before cache sharing. Full Screener is much heavier: one cold user can touch 14 Vercel functions and about 126 provider attempts. Therefore the public product must keep large scans explicit, estimate cost, share stable cache keys, and prevent simultaneous automatic scans.

The existing cache/concurrency/circuit-breaker design is structurally suitable for ~1,000 users if the curated automatic universe stays bounded, heavy actions remain explicit, and externally sourced market data has contractual reliability. Yahoo itself, rather than React/Vercel compute, is the dominant reliability/scaling risk.

## 15. Public paid-MVP definition

### Must have for strangers to pay

- Analyze any explicitly entered, optionable supported ticker without adding it to a bulk universe.
- A trustworthy 25–50 symbol curated core spanning broad/sector ETFs, current leveraged specialists, and a small set of liquid large caps.
- Clear formula/mark/data-freshness definitions; correct IV terminology.
- Reliable expiry/strike comparison with missing-last sorting and visible liquidity quality.
- Saved-underlying list separated from saved contracts.
- Earnings proximity for stocks from a reliable source, or a conspicuous “event data unavailable” state.
- Portfolio attention view with assignment cash, DTE, delta/distance, captured premium, concentration, and quote freshness.
- Mobile parity, durable backup, account sync/conflict safety, and a clear not-advice/data-delay disclosure.

### Should have

- Side-by-side strike/expiry comparison and expected-move context.
- Export/import that reduces spreadsheet duplication.
- Extracted/explained close-candidate policy.
- Explicit request budget/status and partial-result recovery.
- Normal-ETF/stock-aware chart/holdings behavior.

### Nice to have

- Roll comparison, user presets, notifications, broker read-only import, and covered-call/share lifecycle.

### Sufficient for ~1,000 users without rewrite

- Keep automatic Scanner at ≤50 cheap underlying quote rows.
- Never attach Pulse/history or option chains to every curated stock automatically.
- Cap explicit Screener selections/expirations and use stable server cache keys.
- Add provider observability, cache-hit/upstream-count dashboards, and per-action quotas before marketing.
- Use licensed/reliable option/event data or make provider degradation a supported product state.
- Keep Supabase for durable user state only; no transient quote lake, polling, or Realtime.

## 16. Things users ask for that should not be built now

1. Every optionable stock scanned automatically.
2. A single AI/opportunity score or trade recommendation.
3. Unusual-options-flow terminal.
4. Multi-leg strategy builder/payoff simulator.
5. Broker execution/order routing.
6. Automatic rolling or portfolio-wide roll scans.
7. Real-time polling/alerts before a reliable event/quote provider and quotas exist.
8. Social feed/copy trading.
9. Full wheel/covered-call lifecycle before shares and basis are deliberately modeled.
10. Backtests presented as expected future returns without survivorship, liquidity, slippage, event, and assignment modeling.

The Stage 6 roadmap and scored priorities are in `docs/PRODUCT_STAGE6_ROADMAP.md`; the universe/request design is in `docs/UNDERLYING_UNIVERSE_ARCHITECTURE.md`.
