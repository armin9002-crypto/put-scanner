# Recommendations Engine V1.1

## Scope and integrity contract

Recommendations is a deterministic Market-mode decision-support system. It can validly return **NO TRADE**. It uses no LLM, AI API, model key, paid inference, prediction, training, or automatic policy tuning. It has no Portfolio Fit lens and does not read or modify Portfolio data.

The current contract is `RECOMMENDATION_ENGINE_VERSION = 3` and `RECOMMENDATION_POLICY_VERSION = 2`. Engine V3 adds the versioned shared `UnderlyingTechnicalAssessment` to immutable ETF Pulse input and Recommendation evidence; pricing, compensation, selection, and policy V2 are unchanged. V1.1 previously changed both versions because its immutable input/output added the selected acquisition universe, per-ticker expiration plans, explicit policy-check classifications, cross-duration reasons, and Decision Trace. The same snapshot and policy produce the same ordered `RecommendationRun`.

Earlier repository history contained an additive-score Trade Cockpit. V1 retained its useful manual acquisition, posture, diagnostics, and near-miss ideas but did not restore universal scores, Portfolio contamination, pre-ranking truncation, mandatory-bid qualification, or binary liquidity buckets.

## Modules and canonical reuse

- `types.ts`: versioned snapshot, universe, run, evidence, comparison, trace, and verdict contracts.
- `policy.ts`: all consequential thresholds.
- `underlyingTechnical.ts`: shared close-derived ticker state, signals, metrics, evidence quality, reason codes, and thresholds used by ETF Pulse and Recommendations.
- `underlying.ts`: maps that shared ticker assessment plus separate Market Regime context into pre-contract qualification and structured Recommendation evidence.
- `pricing.ts`: same-expiration price discovery and quote provenance.
- `engine.ts`: hurdles, comparisons, skeptic, robustness, verdicts, trace, and selections.
- `explanations.ts`: centralized deterministic reason-code copy.
- `acquisition.ts`: explicit-refresh orchestration and session-memory publication.
- `visualFixtures.ts`: sanitized request-free UI states.

The system reuses canonical Market Read, ETF Pulse, the [Underlying Technical Assessment V1](./UNDERLYING_TECHNICAL_ASSESSMENT_V1.md), Screener batches/rows, option-chain cache keys, option math, Watchlist, and Option Detail modules. It does not introduce a second option-data pipeline or duplicate NY, AY, Delta, IV, moneyness, breakeven, or ticker-technical definitions.

## Snapshot and decision pipeline

The snapshot contains `asOf`, engine/policy versions, the selected universe, exact regime/posture, Pulse rows, raw chains, canonical Screener rows, and explicit coverage/provenance. The run retains those facts plus assessments, candidates, frontiers, recommendation classes, near misses, Decision Trace, and reason codes.

Execution order is:

1. validate versions, bind the DTE universe, and stably sort canonical rows;
2. qualify underlyings while preserving missing evidence;
3. validate contracts and identify Direct, Indicative, or Insufficient pricing;
4. compute absolute and relative compensation hurdles;
5. prune only materially dominated local contracts;
6. compare serious finalists, including explicit same-ticker cross-tenor cases;
7. run the deterministic skeptic;
8. test the bounded robustness grid;
9. assign candidate and run verdicts;
10. build Decision Trace counts and overlapping rejection reasons.

Invalid price, strike, expiration, DTE, or quote ordering fails closed. Missing optional fields remain `null`, lower evidence quality, and never silently become zero. Outputs never serialize `NaN` or infinity.

## Policy V2

Required AY starts with a regime floor: 16% Complacent Risk-On, 13% Healthy Risk-On, 14% Healthy Pullback, 18% Choppy/Elevated Vol, 24% Risk-Off, 28% Oversold Panic, and 18% Mixed/No Edge. Additions are +4pp below 21 DTE, +1.5pp from 46–75 DTE, +3pp above 75 DTE, +3pp near minimum breakeven cushion, +1pp for moderate cushion, +2pp near maximum Delta, and +3pp for a Watch-quality underlying.

`Minimum Attractive Credit` is the larger of the absolute policy credit and any relative frontier credit. The relative credit requires a riskier comparable contract to exceed a safer contract's AY by 2.5pp. It is a policy hurdle—not fair value, expected fill, or forecast.

Material comparison thresholds are 1.5pp AY, 0.03 absolute Delta, and 5pp breakeven cushion. Same-neighborhood dominance is limited to the same ticker within 21 DTE. Cross-duration comparison begins at a 45-day DTE difference; a longer tenor needs at least 2pp additional AY unless it adds material defensive value, for which at most 1.5pp AY give-up is accepted.

Pricing thresholds are 25% of Ask for a tight spread, 55% for acceptable direct execution, and 80% for a usable neighbor. Fresh/stale ages are 30 minutes / 2 hours. Price brackets use a $0.02 or 5% monotonic tolerance, 3:1 maximum spacing, 40 percentage-point IV gap, 0.18 Delta gap, and $0.01 rounding.

Robustness uses seven deterministic cases: basis; hurdle ±2pp; Delta/cushion boundary ±0.01/2pp; and supported low/high price bases. At least 80% stable is High, at least 50% is Moderate, otherwise Low. An effective tie caps High at Moderate.

## Underlying, policy checks, and DTE

Underlying lenses are Trend Integrity, Reset/Extension, Volatility Context, and Regime Fit. The first three consume the exact shared ETF Pulse assessment; Regime Fit remains separate broad-market context. Strong/Good setups with non-Low evidence are Eligible. Mixed but undamaged setups remain Watch. A materially damaged `BROKEN_TREND` remains a pre-chain Hard Fail, as does the prior Risk-Off/Oversold-Panic combination with price below both SMA50 and SMA200. The richer taxonomy does not broadly create new Hard Fails.

Every candidate preserves six independent lenses: Compensation, Cushion, Volatility Opportunity, Underlying Setup, Pricing Confidence, and Actionability. They are qualitative and never summed into a universal score.

Policy checks explicitly carry `severity` and `phase`. Required identity/quote validity, Delta, strike cushion, breakeven cushion, and underlying qualification are **BLOCKING** checks. The Market Read posture DTE range is **INFORMATIONAL** `DURATION_CONTEXT`: it can explain and increase required compensation, but it cannot alone fail validity, risk policy, skeptic, or verdict. Blocking logic inspects classifications rather than array positions.

OI and volume are evidence, not universal vetoes.

## Price discovery and actionability

`DIRECT_MARKET` preserves a positive Bid as the seller-credit basis and keeps Ask/Last as evidence. High confidence requires a fresh, two-sided, tight market and a credible monotonic same-expiration bracket. Other usable non-stale direct markets are Moderate. Last never becomes seller credit.

A zero/missing Bid is never replaced and can never be Actionable. The engine may form a labeled `INDICATIVE_RANGE` only from independently usable lower and upper strikes in the same expiration, subject to spread, spacing, monotonicity, Delta, IV, staleness, and candidate-Ask bounds. It is not fair value or an executable quote. Nearby expirations are never dollar-interpolated.

Actionable requires a direct Bid clearing the hurdle plus blocking risk, evidence, skeptic, and robustness clearance. Conditional requires those non-execution gates but relies on a credible Ask or Moderate indicative range reaching the hurdle. Watch and Pass retain their distinct failure meanings.

## Dominance and cross-duration comparison

Within 21 DTE, A dominates B only with no material disadvantage in AY, Delta, breakeven cushion, Pricing Confidence, or Actionability and at least one material advantage. Small differences do not manufacture a winner.

For same-ticker pairs at least 45 days apart:

- If the longer contract adds no material defensive value and does not provide 2pp additional AY, it receives `DURATION_NOT_COMPENSATED`; the shorter contract receives `SHORTER_DURATION_EFFICIENT`.
- If the longer contract materially improves absolute Delta or breakeven cushion and gives up no more than 1.5pp AY, it receives `LONGER_DURATION_DEFENSIVE_VALUE` and can outrank the shorter tenor.
- Otherwise both retain an explicit duration tradeoff.

The comparison uses normalized yield/risk evidence; it never compares raw option dollars as if expirations were interchangeable. Stable ID order is display-only. Effective ties receive `NO_CLEAR_LEADER` and cannot produce a false Best Overall.

## Verdict and operational semantics

Recommendation classes are emitted only when supported: Best Overall, More Defensive, Higher Compensation, and Conditional Price Opportunity. Counts shown to users deduplicate candidate IDs so one contract in multiple classes is surfaced once.

A complete run with no Actionable/Conditional contract is the successful `NO_TRADE` conclusion. Any failed Pulse input, batch, or underlying makes the run `INCOMPLETE`; successful partial candidates remain visible, but an empty partial result cannot be mislabeled NO TRADE.

## Recommendation universe and expiration planner

Opening `/recommendations` makes zero market requests. Only **Refresh Recommendations** starts acquisition. A later refresh aborts/supersedes the old generation; obsolete work cannot publish.

The account-level **Only evaluate options ≥60 DTE** preference defaults checked. It is backward-compatible in the optional cloud Preferences namespace and backup format. Checked selects 60–365 DTE; unchecked selects 0–365 DTE. A toggle changes preference only. The displayed run retains its original universe and shows a mismatch notice until an explicit refresh.

The existing batch pipeline obtains one normal metadata/discovery chain per qualified ticker, filters unique expirations to the selected bounds, and selects at most three:

1. nearest eligible;
2. lower-middle eligible;
3. farthest eligible.

If three or fewer qualify, all are selected. If none qualify, no chain is fabricated. A discovery response that already matches a selected tenor is reused. The run records available, eligible, selected, and discovery dates per ticker. Batching, two-batch client concurrency, three-operation server concurrency, cancellation, successful partial results, failed-batch retry, cache priming, and `INCOMPLETE` behavior are preserved.

## Measured request budget

The old two-standard-expiration cold ceiling was 15 browser requests, 15 function invocations, 170 logical provider acquisitions, and 240 conditional HTTP attempts.

The conservative V1.1 cold full-universe ceiling is 15 browser requests, 15 functions, 254 logical acquisitions, and 324 conditional HTTP attempts. It comprises 44 Pulse histories plus, for up to 42 qualified ETFs, one discovery chain, at most three selected representative chains, and one volatility-context operation. A deterministic three-ETF worst-case fixture measures 12 option acquisitions—3 discovery plus 9 selected—and 3 volatility operations. Discovery reuse, hard fails, sparse calendars, and no-eligible cases lower this count.

A compatible warm Pulse/batch cache creates zero provider acquisitions. The `etf_pulse_rows:v3` calculated-row cache includes shared assessment V1; compatible v2 rows upgrade locally without acquisition. Sorting, expansion, show-all, evidence, Decision Trace, near misses, methodology, hover, selection, and JSON export are 0 browser / 0 function / 0 provider requests. The bounded increase provides near/middle/far DTE representation without crawling all expirations.

## Product information hierarchy and evaluation

The page order is Decision, Top Opportunities, How Recommendations Work, Why Only These / Near Misses, then Full Opportunity Board / Audit. The header shows update time, dynamic tracked → qualified → contracts → surfaced counts, the universe checkbox, and Refresh. It does not advertise internal versions or export as primary actions.

Primary cards lead with AY and show all six lenses, a concise Why This, and Main Trade-off. Conditional presentation visibly separates Direct Bid, Ask, Indicative range, Minimum Attractive Credit, Pricing Confidence, and Actionability. How Recommendations Work exposes a five-stage explanation and a Full Methodology modal. The board is secondary and shows eight rows until request-free expansion.

Decision Trace is collapsed by default. It defines and counts tracked/qualified underlyings, acquired chains, evaluated/valid contracts, hurdle+risk survivors, frontier contracts, serious finalists, policy survivors, and distinct surfaced contracts. Rejection reasons intentionally overlap: one candidate can fail several independent checks, so reason totals are not a partition of candidates.

Evaluation export contains the versioned run, selected universe, timestamp, coverage/expiration plans, evidence, provenance, policy checks, reasons, comparisons, robustness, Decision Trace, and results. It adds no recommendation-history table and no automatic persistence.

V1.1 still defers Portfolio Fit, correlation, outcome training, ML/prediction, auto-tuning, all-expiration crawling, cross-expiration dollar interpolation, order execution, and persistent recommendation history. Snapshot exports should be shadow-evaluated on a fixed cadence before policy thresholds are changed; any change requires an explicit versioned policy.
