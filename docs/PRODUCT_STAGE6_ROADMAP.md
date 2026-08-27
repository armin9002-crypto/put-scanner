# Product Stage 6 Roadmap

Stage 6B.1 completion date: 2026-08-26

## Current decision after Stage 6B.1

Stage 6B.1 is complete. Metric integrity is now strong enough for bounded external testing: yield concepts expose their denominators, the realized-volatility comparison is no longer marketed as IV Rank, invalid Delta inputs fail closed, and unavailable numeric values cannot rise to the top of opportunity sorts.

Analyze Ticker now supports an explicit, refresh-safe, one-symbol path for provider-supported leveraged ETFs, normal ETFs, stocks such as NVDA, and safely generic unknown symbols. It does not fetch while typing, add a durable record, or expand Scanner/Screener/Pulse membership.

The recommended next stage is **Stage 6B.2 — Curated Universe + Saved Underlyings + Screener Universe Selection (design and bounded implementation only)**:

1. Start with a reviewed total curated discovery set of roughly **25–30 symbols**, including the most decision-useful legacy leveraged ETFs, liquid normal ETFs, and a small number of liquid large-cap stocks. Do not append 35–50 stocks to the current 42-symbol set.
2. Implement Saved Underlyings before broad Scanner expansion. It represents “willing to own/watch,” stays distinct from contract Watchlist records, and must have a versioned local/cloud migration plan before activation.
3. Keep Scanner mount quote-only. No membership-triggered chains, volatility history, or Pulse history.
4. Before exposing 35–50 selectable symbols to Screener, add a server-validated exact-symbol batch contract, canonical sorted cache keys, hard symbol/expiry caps, existing browser concurrency two/server provider concurrency three, partial-result retry, payload guards, and request-budget UI.
5. Validate option liquidity and provider behavior per symbol before curated membership. Analyze-Ticker demand should inform curation.

This recommendation is design direction only. Stage 6B.1 did not add a broad universe, Saved Underlyings, earnings, rolling, alerts, polling, or automatic scanning.

## Historical Stage 6A roadmap

Stage 6A audit date: 2026-08-26

## Ordering principle

The roadmap first makes existing decisions trustworthy, then opens one explicit ticker at a time, then adds reliable missing context, and only afterward deepens management. It does not grow market-data fan-out ahead of product proof.

## Stage 6B — On-Demand Ticker Analysis and Metric Integrity

Goal: let a stranger analyze a normal stock or ETF explicitly while keeping Scanner/Screener bulk behavior unchanged and making every key financial label defensible.

| Item | Problem solved | Target/frequency/value | Complexity, data, request, mobile, dependencies | Why now |
|---|---|---|---|---|
| Correct metric names/tooltips | AY/Current AY/IV Rank labels imply definitions the code does not calculate. | Every user, every contract decision; very high trust value and moderate differentiation through clarity. | Low–medium engineering, no new data/request cost, moderate mobile copy/layout. Depends on `PUT_METRIC_DEFINITIONS.md`. | Paid product cannot begin with ambiguous denominators or nonstandard IV terminology. |
| Generic asset-aware detail view | Detail assumes every supported route is a leveraged ETF. | CSP/ETF users, frequent; unlocks TAM using the strongest current workflow. | Medium engineering; existing Yahoo requests; moderate mobile parity. Depends on registry selectors and conditional holdings/leverage modules. | Smallest high-value expansion that does not crawl a market. |
| Analyze Ticker entry | No way to start with NVDA/SPY/etc. | All external users, frequent; high value and strong workflow differentiation. | Medium; one explicit detail acquisition; provider validation and error states; entry must work on mobile header/navigation. Depends on generic detail. | Validates demand before building broad Scanner universes. |
| Missing-last sorting and unavailable semantics | Screener/Watchlist can rank nulls first. | All discovery/monitoring users, frequent. | Low; no data/API cost; shared comparator tests and mobile/desktop parity. | Concrete trust/quality issue. |
| Delta fallback hardening | Detail can calculate a misleading fallback with invalid underlying input. | Users encountering incomplete Yahoo Greeks; occasional but high risk. | Low–medium nullable/view-model change; no new requests. | Correctness before new symbols increase incomplete-data cases. |
| Detail payload request consolidation | Options and IV context can reacquire the same initial chain. | Every detail analysis; high operational value. | Medium server/client change; lower provider cost; preserve cache keys/partial fallback. | New Analyze Ticker traffic should not multiply an existing inefficiency. |
| Saved-underlying schema/design | Contract Watchlist cannot express “willing to own.” | Conservative CSP and wheel users, frequent. | Design plus dormant/versioned durable schema; no automatic chains; cloud migration/sync tests required. | Define safely in 6B; enable UI only if bounded and fully migrated. |
| Curated-universe experiment | Existing visible set is leveraged-only. | ETF/CSP audience, daily. | Medium product curation; quote-only request impact; must not add all chains/Pulse. | Add only after Analyze Ticker shows which symbols users seek. Preserve the full legacy leveraged category. |

Stage 6B acceptance:

- explicit ticker analysis works for a known normal ETF and stock, plus current leveraged ETFs;
- unknown, invalid, non-optionable, and provider-unavailable are distinct and safe;
- stock detail never shows ETF holdings or true leverage;
- no new option chain is fetched on hover/render outside explicit detail;
- current Scanner/Screener universes and cloud behavior are regression-tested;
- metric definitions are visible and consistent on desktop/mobile;
- request-count tests prove no detail option-chain duplication;
- no earnings feed, roll tool, alerting, all-market scan, or recommendation score.

## Stage 6C — Pre-Trade Context and Explicit Comparison

Goal: reduce the external tools needed before selling a put without turning Put Scanner into a generic research terminal.

| Item | Problem solved | Target/frequency/value | Complexity, data, request, mobile, dependencies | Why this order |
|---|---|---|---|---|
| Reliable earnings proximity | Stock sellers must leave the app to check the largest routine catalyst. | CSP/wheel/single-stock users; every candidate; very high value. | Medium–high data difficulty/licensing, low request count if batched/cached; prominent mobile badge. Depends on stock analysis and source evaluation. | Highest-value missing stock context, but should not block ETF-first 6B. |
| Saved-underlying UI | Users need a durable “willing to own/watch” list distinct from contracts. | CSP/wheel users; daily. | Medium UI/cloud migration; cheap quote batch only, no automatic chains; mobile list/actions. Depends on 6B schema. | Creates the curated user workflow observed in research. |
| Strike/expiry comparison | Users manually flip expiries to judge marginal premium/risk. | All active sellers; frequent. | Medium; bounded two-expiry acquisition; careful mobile comparison layout. Depends on metric integrity and request consolidation. | High value with controllable request cost. |
| Expected-move context | Delta/OTM alone does not show market-implied range. | Intermediate/power users; frequent. | Medium math and chain quality; can derive from a bounded ATM straddle if calls are reliable; one existing chain when possible. | Add only with explicit definition and graceful missing state. |
| Presets/universe selection | Repeated Screener setup creates friction. | Repeat users; frequent. | Medium durable preference/cloud work; no incremental data; mobile editing. Depends on generalized universes and explicit caps. | Improves frequency after the core analysis works. |
| Portfolio attention-policy extraction | Management thresholds are opaque and embedded in a page. | Portfolio users; daily. | Medium refactor/tests/copy; no API cost; mobile reason chips. | Foundation for later configurable rules and roll comparison. |
| True IV-context provider decision | Current realized-vol comparison cannot answer true IV rank. | High-IV/power users; frequent for them. | High data/licensing difficulty; potentially high cost; UI terminology already corrected. | Research/prototype in 6C; ship only if reliable/economic. |
| Roll comparison design/prototype | Users need before/after economics, not an automatic action. | Wheel/active managers; episodic. | High calculation/UI complexity, bounded extra chains, heavy mobile implications. Depends on attention extraction, comparisons, definitions, and events. | Prototype after pre-trade foundations; do not automate. |

## Stage 6D — Paid Operations and Management Depth

Goal: support <100 paying users safely and demonstrate a credible path to ~1,000.

| Item | Problem solved | Target/frequency/value | Complexity, data, request, mobile, dependencies | Why later |
|---|---|---|---|---|
| Provider/cache observability and quotas | Yahoo degradation/bursts are invisible business risk. | Operator and all users indirectly; continuous. | High operational work; no user complexity; requires endpoint/cache telemetry and privacy-safe aggregation. | Needed before promotion, not before product validation. |
| Partial-result/request-budget UI | Heavy scans do not clearly communicate cost/failure scope. | Screener power users; each Load. | Medium; uses existing diagnostics; mobile progress/retry. | Generalized Screener volume makes it important. |
| Reliable market-data plan | Free provider behavior may not support paid SLAs or terms. | Entire paid product. | High vendor/legal/cost work and adapter design. | Validate product first, decide before scale. |
| Management “Today” view | Portfolio signals are distributed. | Active Portfolio users; daily. | Medium–high view-model/UI work; no automatic polling; mobile-first prioritization. | Build after policy is extracted and trusted. |
| Bounded roll comparison | Users compare hold/close/roll with cumulative economics. | Wheel/active managers; episodic, high value. | High; 1–2 future expiries per explicit position; complex mobile and lifecycle persistence. | Only after prototype and data reliability. |
| Export/journal improvements | Spreadsheet users duplicate history and analysis. | Serious users; weekly/monthly. | Medium; low data/API cost; file/mobile share UX. | Valuable retention feature after core workflow. |
| Paid entitlements/billing | Needed to charge. | Paying users. | High security/product work; avoid coupling to market caches. | Last responsible layer after value/reliability proof. |

## Later

- read-only broker import/reconciliation, if a partner API is reliable and permissions are narrow;
- share/covered-call lifecycle for a true wheel product;
- configurable management rules after defaults are evidence-backed and explainable;
- notifications only for durable user-selected conditions, with quotas and no polling architecture;
- ex-dividend proximity for share/call workflows or special short-put events;
- limited risk-defined put spread comparison if user demand clearly exceeds CSP focus;
- historical outcome review using the user's own durable trades, not generalized trade recommendations.

## Do not build yet

- full all-optionable-stock scanning;
- automatic server-side or recurring scans;
- real-time option polling or Supabase Realtime;
- unusual-options-flow/dark-pool terminal;
- generic multi-leg payoff simulator;
- AI trade recommendations or one opaque opportunity score;
- social/copy trading;
- brokerage order execution;
- portfolio-wide automatic rolling;
- transient Yahoo data in Supabase;
- backtesting claims without licensed survivorship-aware historical option data.

## Major idea scoring

Scale: 1 = low, 5 = high. For User Value, Frequency, Differentiation, and Data Reliability, high is favorable. For Implementation Difficulty, API Cost, and UX Complexity, high means greater burden. Scores guide discussion; they are not summed mechanically.

| Idea | User Value | Frequency | Differentiation | Impl. Difficulty | API Cost | Data Reliability | UX Complexity | Judgment |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Metric naming/definitions | 5 | 5 | 3 | 2 | 1 | 5 | 2 | First; trust prerequisite. |
| Analyze Ticker | 5 | 5 | 4 | 3 | 2 | 3 | 3 | First TAM expansion. |
| Asset-aware generic detail | 5 | 5 | 3 | 3 | 1 | 5 | Required by Analyze Ticker. |
| Missing-last sorting/data states | 4 | 5 | 2 | 1 | 1 | 5 | Cheap correctness. |
| Detail request consolidation | 4 | 5 | 2 | 3 | 1 (saves cost) | 4 | 2 | Do with traffic expansion. |
| Saved underlyings | 5 | 4 | 4 | 3 | 1 | 5 | Core curated-owner workflow. |
| Small curated normal universe | 5 | 4 | 3 | 3 | 2 | 3 | Add from observed demand, not guesses. |
| Earnings proximity | 5 | 4 | 3 | 4 | 3 | 3 | Must-have for stocks once source is reliable. |
| Strike/expiry comparison | 5 | 4 | 4 | 3 | 3 | 4 | High workflow value, bounded. |
| Expected move | 4 | 3 | 3 | 3 | 2 | 3 | Useful with transparent assumptions. |
| Portfolio Today/attention view | 5 | 4 | 4 | 4 | 1 | 5 | Strong retention after policy extraction. |
| True historical IV rank | 4 | 3 | 2 | 4 | 4 | 2 today | Do only with viable vendor/source. |
| Roll comparison | 5 | 2 | 4 | 5 | 3 | 3 | High value, later complexity. |
| Alerts | 4 | 3 | 2 | 5 | 5 | 3 | Defer until quotas/reliable data. |
| Broker read-only import | 4 | 3 | 4 | 5 | 3 | 3 | Later partnership/security work. |
| Full-market scanner | 3 | 3 | 1 | 5 | 5 | 2 | Do not build; competitors win this job. |
| Unusual flow | 2 | 2 | 1 | 5 | 5 | 2 | Off thesis. |
| AI opportunity score | 2 | 3 | 2 | 4 | 3 | 1 | Misleading and off trust strategy. |

## Top 10 product priorities

1. Make yield, IV context, delta, mark, and freshness definitions unmistakable.
2. Ship explicit Analyze Ticker for normal ETFs/stocks with safe asset-specific behavior.
3. Preserve current leveraged-ETF expertise as a category, not a global assumption.
4. Separate saved underlyings from saved contracts.
5. Make liquidity/executability a first-class decision gate.
6. Add reliable earnings proximity before presenting stocks as public-ready.
7. Enable bounded strike/expiry comparison without automatic broad scans.
8. Turn Portfolio into a clearer “what needs attention today?” view.
9. Instrument and budget provider/request behavior before paid promotion.
10. Add roll comparison only after cumulative economics and management policy are explicit.

## Top 10 technical risks

1. Yahoo reliability, undocumented behavior, terms/licensing, and paid-product suitability.
2. Linear option-chain fan-out when curated/user universes grow.
3. Cold Pulse/history fan-out accidentally tied to registry growth.
4. Ambiguous/nonstandard financial metrics becoming a public product contract.
5. Asset-type leakage: stock routes invoking ETF holdings/leverage assumptions.
6. Monolithic Options/Portfolio/Screener pages accumulating state races and mobile drift.
7. Separate API functions duplicating upstream option work despite client-level caching.
8. High-cardinality cache keys reducing CDN sharing at 1,000-user scale.
9. Durable-schema/cloud-sync changes for saved underlyings or wheel lifecycle causing migration conflicts.
10. Missing/stale quote values being treated as zero, ranked, or presented as executable.

## Public MVP gates

Before charging even <100 users:

- complete every Stage 6B acceptance item;
- choose a reliable earnings source or limit positioning to ETFs and disclose it;
- establish provider usage/legal fit and a degradation plan;
- expose not-advice, quote delay/freshness, and assignment/cash-secured risk clearly;
- verify mobile Scanner → detail → Watchlist/Portfolio and Portfolio management journeys;
- collect request/cache/provider telemetry in a privacy-safe operator view;
- load-test representative 50-symbol Scanner, 20-symbol Screener, 25-chain Watchlist/Portfolio, and concurrent cold/cache-hit cases;
- maintain backup/sync/conflict recovery and no transient market data in Supabase.

At ~1,000 users, add enforced per-action limits, shared stable server datasets, provider/circuit dashboards, cost alarms, and a commercial data decision. None requires replacing local-first durable state or the three-namespace Supabase design.

## Historical Stage 6A next-stage recommendation (completed)

**Stage 6B.1 — Metric Integrity + Asset-Aware Analyze Ticker Foundation**

Bounded deliverables:

1. implement the approved metric labels/tooltips from `PUT_METRIC_DEFINITIONS.md` on detail, drawer, Screener, Watchlist, and Portfolio;
2. rename current IV Rank to a truthful realized-vol comparison everywhere, without changing its calculation;
3. extract asset-aware detail capabilities (`showHoldings`, `showTrueLeverage`, generic name/type fallback) from route membership;
4. add an explicit Analyze Ticker form and normalized route validation for one ticker at a time;
5. support normal ETF and stock detail only on explicit submit; do not add them to Scanner, Screener, or Pulse;
6. consolidate or prove bounded the detail options/IV acquisition so initial option data is not fetched twice;
7. harden missing delta and missing-last sorting;
8. add request-count, route-race, invalid/non-optionable, stock-vs-ETF module, formula-copy, responsive, and cloud-regression tests;
9. document measured cold/cache-hit counts;
10. stop before saved-underlying UI, earnings, rolling, alerts, or bulk universe expansion.

This stage provides the cleanest user-value test with the smallest request and schema footprint.
