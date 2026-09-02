# Recommendations Engine V1

## Scope and integrity contract

Recommendations is a Market-mode, deterministic decision-support system. It answers whether any contract in the bounded analyzed opportunity set is genuinely worth considering, including the valid answer **NO TRADE**. It does not use an LLM, an AI API, a model key, paid inference, prediction, training, or automatic policy tuning. It has no Portfolio Fit input or lens and does not read or modify Portfolio data.

The stable domain contract is `RECOMMENDATION_ENGINE_VERSION = 1` and `RECOMMENDATION_POLICY_VERSION = 1`. One immutable canonical snapshot and one V1 policy produce the same ordered `RecommendationRun`. The engine contains no React types, storage, request code, or generated prose.

## Prior-history archaeology

Targeted local-history searches found one meaningful predecessor:

- `09f489c` (`2026-05-31`, `feat: add usage-safe trade cockpit`) added `tradeCockpit/cache.ts`, `posture.ts`, `regime.ts`, `scan.ts`, `scoring.ts`, `types.ts`, and `TradeCockpitPage.tsx`.
- `4fe3b4f` (`2026-06-06`, `remove Cockpit dashboard and clean unused scan code`) removed that surface and moved the useful market regime/posture concepts into the current Market Read modules.

The prior ranking was an additive score: opportunity used AY (42 points), direct bid (12), spread (18), OI (16), and DTE (12); risk started at 100 and subtracted Delta, cushion, trend, 200-day, drawdown, and spread penalties; fit used a base of 55 plus Watchlist, existing-exposure, trend, and RSI adjustments. The final score was `36% opportunity + 38% risk + 26% fit`, then clamped to 0–100. A separate trend/realized-vol mini-score selected five underlyings before option ranking.

Useful ideas retained are manual bounded acquisition, explicit posture, diagnostics, and near misses. V1 deliberately does not restore the universal score, Portfolio contamination, five-underlying truncation, mandatory-bid qualification, or binary liquidity buckets. Those mechanisms could manufacture precision, let compensation offset veto-level risk, hide most of the universe, and make a weak relative winner look objectively good.

## Modules and canonical reuse

The feature is divided into the smallest useful boundaries:

- `types.ts`: versioned snapshot, run, evidence, comparison, and verdict contracts.
- `policy.ts`: every consequential V1 threshold.
- `underlying.ts`: pre-contract qualification and structured ETF evidence.
- `pricing.ts`: same-expiration price discovery and quote provenance.
- `engine.ts`: hurdles, dominance, comparisons, skeptic, robustness, verdicts, and selections.
- `explanations.ts`: centralized deterministic reason-code copy.
- `acquisition.ts`: the explicit-refresh coordinator and session-memory publication boundary.
- `visualFixtures.ts`: sanitized, request-free visual states.

V1 reuses `analyzeRegime`, `postureFromRegime`, `buildEtfPulseRows`, `runScreenerBatchScan`, `buildScreenerRows`, `resolvePutDelta`, `calculateMoneyness`, `calculateBreakeven`, `calculateDownsideCushion`, `calculateAnnualizedYield`, `getOptionLastTradeFreshness`, option-chain cache/request keys, the existing Option Detail drawer, and the existing cloud-authoritative Watchlist helpers. The only financial helper added is the algebraic inverse of canonical simple AY, `calculateCreditForAnnualizedYield`.

## Canonical snapshot and pipeline

The input contains `asOf`, both versions, the exact Market Read regime and posture, canonical Pulse rows, raw chain objects, canonical Screener rows, and explicit acquisition coverage/provenance. The output retains market context, coverage, underlying assessments, every candidate, per-underlying frontiers, honest recommendation classes, near misses, and run reason codes.

Execution order is explicit:

1. validate snapshot versions and sort canonical rows;
2. qualify underlyings and preserve missing evidence;
3. validate contracts and discover direct or indicative pricing;
4. compute absolute and relative compensation hurdles;
5. prune only materially dominated local contracts and form tradeoff facts;
6. pairwise-outrank serious finalists without a total score;
7. run the deterministic skeptic;
8. test a bounded robustness grid;
9. assign candidate verdicts and the separate run/operational conclusions.

Invalid price, strike, expiration, DTE, or quote ordering fails closed. Missing optional fields remain `null`, lower evidence, and never silently become zero. No output serializes `NaN` or infinity.

## V1 policy constants

All percentages below are fractional policy values in code. They are conservative, understandable first-release policy—not scientific truth and not fitted to owner outcomes. Calibration used the repository’s sanitized leveraged-ETF fixtures and existing Market Read/Screener distributions; thresholds were not adjusted merely to force recommendations.

### Compensation

| Constant | V1 value | Meaning |
|---|---:|---|
| Minimum AY: Complacent Risk-On | 16% | Higher floor when volatility compensation is commonly thin |
| Minimum AY: Healthy Risk-On | 13% | Base constructive-regime floor |
| Minimum AY: Healthy Pullback | 14% | Slight premium for reset risk |
| Minimum AY: Choppy / Elevated Vol | 18% | Compensation for unstable conditions |
| Minimum AY: Risk-Off | 24% | Material defensive hurdle |
| Minimum AY: Oversold Panic | 28% | Highest base hurdle |
| Minimum AY: Mixed / No Edge | 18% | Requires compensation for unclear regime |
| DTE premium under 21 days | +4.0pp AY | Short-horizon concentration |
| DTE premium 46–75 days | +1.5pp AY | Medium-extension premium |
| DTE premium above 75 days | +3.0pp AY | Long exposure window |
| Breakeven margin under 3pp above posture minimum | +3.0pp AY | Near-minimum cushion |
| Breakeven margin 3–8pp above posture minimum | +1.0pp AY | Moderate cushion |
| Delta within 0.03 of posture maximum | +2.0pp AY | Near-maximum directional risk |
| Watch-quality underlying | +3.0pp AY | Weaker pre-contract setup |
| Material AY difference | 1.5pp | Ignore tiny compensation differences |
| Relative risk premium | +2.5pp AY | Required over the best safer comparable frontier |

Required AY is the regime base plus applicable DTE, cushion, Delta, and Watch-underlying premiums. Absolute credit is obtained with the canonical Put Scanner annualization inverse. For a riskier comparable candidate, relative frontier credit is the credit needed to exceed the safer contract’s AY by 2.5pp. `Minimum Attractive Credit = max(absolute credit, relative frontier credit)`. It is a policy hurdle, never fair value, a target forecast, or an expected fill.

### Comparison, pricing, evidence, and robustness

| Constant | V1 value |
|---|---:|
| Material absolute-Delta difference | 0.03 |
| Material breakeven-cushion difference | 5pp |
| Similar-DTE neighborhood | 21 days |
| Tight spread / High-confidence threshold | 25% of ask |
| Acceptable direct spread | 55% of ask |
| Maximum usable neighbor spread | 80% of ask |
| Fresh chain age | 30 minutes |
| Stale chain age | 2 hours |
| Monotonicity tolerance | max($0.02, 5% of prior midpoint) |
| Maximum bracket-spacing ratio | 3:1 |
| Maximum local IV gap | 40 percentage points |
| Maximum local absolute-Delta gap | 0.18 |
| Quote rounding tick | $0.01 |
| High underlying evidence | at least 7 of 9 fields |
| Moderate underlying evidence | at least 4 of 9 fields |
| Robustness hurdle perturbation | ±2pp AY |
| Robustness Delta boundary perturbation | ±0.01 |
| Robustness cushion boundary perturbation | ±2pp |
| High robustness | at least 80% stable scenarios |
| Moderate robustness | at least 50% stable scenarios |

Exact Market Read Delta, strike-cushion, breakeven-cushion, DTE, and liquidity expectations remain owned by `postureFromRegime`; Recommendations does not duplicate them.

## Underlying and contract assessment

Underlying assessment precedes chain work. Its structured lenses are Trend Integrity, Reset/Extension, Volatility Context, and Regime Fit; their restrained summary is Strong, Good, Mixed, or Weak. Evidence Quality counts price, 20/50/200-day distances, RSI, 20-day realized volatility, 52-week position/drawdown, and recent drawdown. A genuinely damaged downtrend—down at least 8% versus 200D or 20% recently—or a downtrend below 200D in Risk-Off/Panic is a hard fail. Strong/Good setups with non-Low evidence are Eligible; other non-damaged setups remain Watch and still receive contract analysis.

Each contract preserves the canonical Screener identity/economics and raw same-expiration chain evidence. Validity, posture DTE, absolute Delta, strike cushion, breakeven cushion, and underlying qualification remain explicit checks. OI and volume are displayed evidence, not universal vetoes.

The six independent contract lenses are Compensation, Cushion, Volatility Opportunity, Underlying Setup, Pricing Confidence, and Actionability. They use four qualitative bands and are never added into an overall score.

## Price discovery, confidence, and actionability

`DIRECT_MARKET` preserves a positive bid as the conservative seller-credit basis and keeps Ask/Last as evidence. A direct market can be High confidence only when it is two-sided, spread is at most 25%, the chain is at most 30 minutes old, and credible lower/upper neighbors form a monotonic, continuous bracket. Other non-stale direct markets are Moderate; stale source data is Low. Direct execution is High through a 55% spread, Moderate when wider/one-sided, and Low when the source is stale.

A zero/missing bid is never replaced and can never be High confidence or Actionable. V1 searches the same expiration for the nearest independently usable lower and upper strike. Each neighbor must have a positive two-sided market and spread at most 80%; bracket spacing cannot be more asymmetric than 3:1. Candidate/neighbor midpoints must be nondecreasing within the explicit tolerance, and available Delta/IV must be locally continuous. Dollar interpolation between neighbor bid/ask intervals is bounded by the lower bid, upper ask, and usable candidate ask, then rounded to cents. The result is labeled `INDICATIVE_RANGE`, never fair value. A missing side, irregular bracket, corrupt/contradictory quote, monotonicity break, stale chain, or unusable range yields `INSUFFICIENT_PRICING_EVIDENCE` or Low confidence. Nearby expirations are not dollar-interpolated and no extra request exists for inference. Last-trade freshness is canonical evidence; Last never becomes seller credit.

## Dominance, tradeoffs, outranking, and skeptic

Dominance is local to the same ticker and within 21 DTE. Candidate A dominates B only when A has no material disadvantage on AY, Delta, breakeven cushion, Pricing Confidence, or Actionability and has at least one material advantage. Differences inside 1.5pp AY, 0.03 Delta, or 5pp cushion do not create false dominance.

Frontier pairs retain material facts such as AY gained, Delta added, cushion surrendered, evidence, pricing, and execution quality. Reason codes distinguish marginal compensation, a favorable defensive tradeoff, justified higher compensation, and poor relative value; no universal marginal ratio is created.

Serious finalists must already clear risk/evidence and have a direct or credible upper price basis reaching their hurdle. A finalist outranks another only with at least two independent material advantages and no critical Delta, cushion, pricing, actionability, or evidence disadvantage. Otherwise the relationship remains a tradeoff or effective tie. Stable ID order is display-only and never claims financial superiority. Ties with no unique unbeaten leader produce `NO_CLEAR_LEADER` and no Best Overall.

The skeptic selects the strongest structured reason not to recommend each candidate: broken trend/yield trap, invalid contract, risk-policy failure, dominance, pricing uncertainty, no clear leader, weak actionability, thin volatility opportunity, marginal compensation, or residual downside-tail risk. Explanations are centrally generated from these reason codes plus actual evidence.

## Robustness and verdicts

Robustness is a seven-case finite grid: basis; AY hurdle +2pp and -2pp; stricter and looser 0.01 Delta/2pp cushion boundaries; and low/high supported price bases. It makes no forecast and no market call. High means at least 80% of cases remain qualified; Moderate at least 50%; otherwise Low. Effective ties cap High at Moderate. Only the category is public; scenario counts remain in the audit snapshot.

- **Actionable:** direct bid clears Minimum Attractive Credit; underlying/risk checks clear; pricing/actionability and evidence are not Low; skeptic has no veto; robustness is not Low.
- **Conditional:** underlying/risk/evidence/robustness clear, but execution is inadequate; a Moderate coherent indicative range reaches the hurdle, or a credible ask reaches it while the displayed bid does not. It is never Actionable without a bid.
- **Watch:** interesting or near the hurdle, but one or more substantive requirements do not clear.
- **Pass:** invalid, incompatible, dominated, or not compelling.

Recommendation classes are emitted only when real candidates support them: Best Overall, More Defensive, Higher Compensation, and Conditional Price Opportunity. No category is filled artificially.

A complete run with zero Actionable/Conditional candidates is the successful conclusion `NO_TRADE`; Watch candidates can remain visible. Any failed batch, failed underlying, or Pulse failure makes operational status `INCOMPLETE`. Successful candidates remain visible, but if none qualify the run verdict is withheld (`null`) rather than mislabeled NO TRADE.

## Acquisition, universe, and request model

Opening `/recommendations` performs zero market calls. Only **Refresh Recommendations** starts work. A new refresh aborts and supersedes the previous generation; obsolete results cannot publish. A compatible run may live only in memory for the current app session.

Refresh performs one cache-aware ETF Pulse dataset pass (42 tracked leveraged ETFs plus SPY/QQQ context), derives the existing Market Read/posture, skips only hard-failed ETFs, then reuses the fixed Screener chunks with `expFilter: all`. That established standard universe is the first two provider-returned expirations per requested ticker—not every listed expiration. Successful partial batches are retained and exact coverage records tracked, hard-failed, requested, successful, failed, expirations, contract count, source, and fetch time.

Cold full-universe ceiling: 15 browser requests, 15 function invocations, 170 logical acquisitions, and 240 conditional provider HTTP attempts (1/1/44 Pulse plus 14/14/126 Screener). Cache hits and hard-failed chunks can reduce actual work. Board sort/expand, evidence, near misses, hover, selection, and JSON export are 0/0/0/0. Watch uses only normal Watchlist persistence; Option Detail reuses the selected row and creates no recommendation refresh.

## Product surface and shadow evaluation

Desktop navigation order is Scanner, Screener, Recommendations, Watchlist, Portfolio, ETF Pulse. Mobile keeps all six destinations and labels Recommendations as **Recs**. The page leads with market context and the run verdict, then only genuine primary recommendations, a one-row-per-underlying Opportunity Board, at most three near misses, and detail on demand. Desktop evidence uses the shared drawer language; phones use the existing bottom-sheet primitive. Open Contract uses `OptionDetailDrawer`; Watch uses the existing cloud-authoritative Watchlist.

**Export Evaluation Snapshot** downloads the deterministic, privacy-safe `RecommendationRun` JSON with versions, timestamp, coverage, evidence, provenance, reasons, comparisons, robustness, and results. V1 adds no Supabase table and no automatic recommendation persistence.

## Deferred scope and known limitations

V1 deliberately defers Portfolio mode/Fit, personalization, correlation, outcome training, ML/prediction, auto-tuning, all-expiration crawling, cross-expiration dollar interpolation, brokerage/order execution, persistent recommendation history, and Compare/Overlay. Quote timestamps are chain-level provider/cache observations rather than exchange-certified per-contract quote times. Indicative ranges are conservative local constraints, not executable quotes. V1 policy should therefore be shadow-evaluated before heavy trust: export snapshots on a fixed cadence, record later outcomes separately without changing policy, audit false positives/negatives and regime slices, review no-bid interval behavior and coverage failures, then propose any V2 thresholds as an explicit newly versioned policy.
