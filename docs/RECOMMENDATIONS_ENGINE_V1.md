# Recommendations Engine V1.2 — Phase B

## Integrity contract

Recommendations is deterministic Market-mode decision support. It uses no AI, LLM, inference API, prediction, training, automatic tuning, numerical opportunity score, recommendation quota, or Portfolio data. A complete run may correctly return **NO TRADE**.

The immutable contract is `RECOMMENDATION_ENGINE_VERSION = 4` and `RECOMMENDATION_POLICY_VERSION = 3`. The same versioned snapshot and policy produce the same ordered `RecommendationRun`. Engine V4 adds explicit transaction price-discovery evidence, auditable rank metadata, a ranked shortlist, optional distinctions, and expanded overlapping diagnostics. Policy V3 adds Recommendation-specific 10/60 trading-session recency, ±10% nearby-strike eligibility, the 5% very-close threshold, and the maximum 15-contract shortlist.

Phase A remains authoritative for ticker technicals. Both ETF Pulse and Recommendations consume the same versioned `UnderlyingTechnicalAssessment`; Recommendations does not reproduce its close-derived thresholds. Market Regime remains separate.

## Pipeline

Hard gates first, then deterministic relative ranking.

1. Validate engine/policy versions and bind the saved DTE universe.
2. Consume shared ticker technical assessments and preserve evidence gaps.
3. Validate canonical contracts and risk-policy checks.
4. Discover current price basis and exact/nearby transaction evidence from the already acquired same-expiration chain.
5. Compute absolute and relative Annualized Yield hurdles without changing Phase A or existing compensation, Delta, or cushion thresholds.
6. Apply local dominance and cross-tenor comparisons.
7. Run the typed skeptic and bounded robustness grid.
8. Assign `ACTIONABLE`, `CONDITIONAL`, `WATCH`, or `PASS`.
9. Assign one canonical actionability rank to every candidate.
10. Surface every genuine Actionable/Conditional contract in ranked order, up to 15, with no minimum and no filler.

Invalid price, identity, strike, DTE, underlying, or quote ordering fails closed. Missing fields remain `null`; they never silently become zero. Outputs do not serialize `NaN` or infinity.

## Recommendation price discovery

Recommendation transaction age uses `elapsedUsEquityTradingSessions()` rather than the generic option 2/7-calendar-day display thresholds:

- **Recent:** at most 10 U.S. equity trading sessions.
- **Stale/intermediate:** 11–60 sessions.
- **Very stale:** more than 60 sessions.

Chain/API age is recorded separately. A chain fetched today does not make the exact contract's Last recent.

The versioned discovery tiers, strongest first, are:

1. `DIRECT_RECENT`
2. `RECENT_NEARBY_CONFIRMED`
3. `QUOTED_TRANSACTION_STALE`
4. `INDICATIVE_SURFACE`
5. `INSUFFICIENT_PRICE_DISCOVERY`

Candidate evidence includes exact `lastTradeDate`, exact trading-session age/recency, discovery tier, proxy strength, qualifying recent-neighbor count, closest distance, recent lower/upper bracket flags, independent chain provenance, quote surface, confidence, and actionability.

Only an already loaded put from the same ticker and expiration may support a transaction proxy. Its strike distance must satisfy `abs(neighbor strike − candidate strike) / candidate strike <= 10%`, and its Last must be no more than 10 trading sessions old. A different expiration or a strike beyond 10% never rescues the candidate.

- Recent lower and upper neighbors inside 10%, with a coherent surface, form the strongest nearby proxy.
- One recent neighbor inside 5%, plus a credible current direct candidate quote and coherent surface, forms a moderate proxy.
- One recent neighbor 5–10% away is weak support only.
- Among eligible neighbors, the closest strike is preferred.

The proxy never bypasses spread limits, monotonicity, Delta continuity, IV continuity, quote-corruption checks, or chain freshness. A recent neighbor alone never guarantees High pricing.

## Executable and indicative economics

A usable current Bid remains the canonical seller-credit basis and is labeled **AY at Bid**. Last is transaction evidence only; stale Last never becomes executable credit.

If no direct Bid exists, a coherent same-expiration lower/upper bracket may produce a clearly labeled **Indicative AY Range**. It is not fair value, an expected fill, or an executable quote. If discovery is insufficient, the UI does not present one precise AY as executable economics.

Fresh exact transaction evidence plus a tight fresh direct market and coherent surface may be High. A stale exact trade with strong two-sided recent nearby evidence and a tight direct market can remain sufficiently credible. A stale exact trade with one very-close proxy is generally Moderate. Very stale exact evidence without a credible recent nearby proxy is Low and triggers a skeptic veto, so a large nominal AY cannot make it a strong Actionable idea.

## Canonical actionability rank

There is no 0–100 score and no hidden weighting. The lexicographic comparator uses, in order:

1. verdict (`ACTIONABLE > CONDITIONAL > WATCH > PASS`);
2. price-discovery tier;
3. pricing actionability, then pricing confidence;
4. robustness;
5. underlying qualification, then shared technical state;
6. skeptic veto state;
7. meaningful comparison/dominance loss count;
8. Annualized Yield margin above the required hurdle;
9. breakeven/downside cushion;
10. smaller absolute Delta;
11. canonical contract ID as a stable tie-break.

Each candidate exports the exact rank fields and ordinal. Pricing ranks before nominal yield, so unreliable discovery cannot win merely by displaying a larger AY.

## Ranked shortlist and distinctions

Every non-vetoed Actionable or Conditional candidate is a policy survivor. Exact duplicate contract IDs collapse. The ranked shortlist has a hard maximum of 15 and no minimum: two valid contracts produce two; eleven produce up to eleven; thirty produce the best fifteen.

Rank remains primary. Diversity acts only within the same major tier—verdict, discovery, robustness, qualification, and shared technical state—where broader underlying representation is preferred before a third contract from the same ticker. It never discards a clearly superior third same-ticker contract solely to diversify.

`BEST_OVERALL`, `MORE_DEFENSIVE`, and `HIGHER_COMPENSATION` are optional distinctions on selected candidates. They are not slots and do not determine eligibility. An effective tie suppresses a false Best Overall.

## Shared technical assessment, verdict, and explanations

Strong and constructive technical states support eligibility when evidence is adequate. Oversold-intact and recovery are context-sensitive, not automatic bullish passes. Extended or transition states remain skeptical/Watch contexts as policy dictates. Broken trend preserves the hard-fail philosophy. The existing `watchUnderlyingPremium` supplies extra compensation for Watch-quality underlyings; Phase B does not add a parallel premium system.

Every explanation is assembled from typed evidence/reason codes. This includes recent direct transactions, nearby confirmation, stale or very stale evidence, constructive pullback, recovery/oversold context, extension, and deterioration. Generic prose inference is not used.

## Opportunity Board and product hierarchy

Top Opportunity cards show rank/distinctions, ticker/strike/expiration, explicit AY basis, Delta, OTM, DTE, exact Last Trade plus trading-session age, discovery/confidence, shared technical setup, and the key trade-off. No card fetch occurs.

The Opportunity Board defaults to **Actionability** and uses the same comparator. Each underlying's representative is its true best-ranked candidate from the full run, not merely a surfaced selection. Ticker and Setup remain request-free alternate sorts. Desktop and mobile show rank, technical setup, and discovery without adding a materially wider table.

The existing Methodology modal is opened by the header's **Info + Methodology** control before the DTE/Refresh area. The redundant lower button is removed. The useful Decision Trace remains in the main explanation section.

## Diagnostics

Decision Trace separately exposes tracked/qualified underlyings, underlying hard-fails, chains, evaluated/invalid contracts, risk failures, compensation failures, discovery insufficiency, stale exact transactions, robustness failures, skeptic vetoes, dominance/frontier losses, every verdict, policy survivors, surfaced shortlist, and exclusions caused only by the cap.

Rejection reasons overlap by design. These counts are audit evidence, not a fake subtractive funnel. `POLICY_SURVIVORS` and `SURFACED_SHORTLIST` are deliberately distinct.

## Requests and acquisition

Opening `/recommendations` makes zero market calls. Only explicit Refresh runs the existing cache-aware Pulse pass and bounded Screener acquisition. Phase B performs zero additional option acquisitions: nearby discovery uses the already acquired same-expiration chain; Last Trade uses the already loaded candidate; rank, shortlist, badges, board sorting, evidence, methodology, Decision Trace, and export are local.

The 60+ DTE account preference, near/middle/far maximum-three expiration planner, batching, concurrency, cancellation, cache reuse, retry, and partial `INCOMPLETE` behavior are unchanged. The conservative cold request ceilings therefore remain those recorded by the request ledger.

## Verification contract

Pricing tests cover: a 422-calendar-day/>60-session exact trade without proxy; one very-close same-expiration proxy; >10% exclusion; different-expiration exclusion; exact recent evidence; weekend/holiday counting; fresh chain versus stale exact evidence; two-sided bracket strength; and non-monotonic rejection.

Ranking tests cover: 8–15 surfaces when qualified, the 15 cap, no minimum/two returns two, determinism, verdict order, price discovery before AY, veto preservation, duplicate removal, tier-bounded diversity, badge independence, and all Opportunity Board sorts/representatives.

The complete project verification includes unit/integration tests, request ledger, responsive checks, build/lint, workflow E2E, and the request-free Recommendations visual matrix across Dark, Dark Blue, Light, and Sepia at desktop, tablet, portrait, and landscape viewports.

## Refresh stability representation

Refresh keeps the same acquisition universe and financial policy. Candidate construction indexes each ticker/expiration chain once and reuses immutable prepared pricing evidence. Dominance and relative hurdles are evaluated only inside the exact same-ticker/similar-DTE comparison windows; global cross-underlying finalist outranking remains intact.

Every finalist relationship is still counted. Complete `OUTRANKS` and `OUTRANKED_BY` candidate IDs, aggregate relationship counts, and decision reason-code sets are exported on `comparisonSummary`. The rich prose/fact payload in `comparisons` is a deterministic evidence sample capped at two records per relationship type, with cross-duration decision evidence preferred. This avoids retaining a rich object twice for every global pair while keeping rank, robustness, skeptic, verdict, Decision Trace, and surfaced output equivalent.

The deterministic decision engine and full-run export serialization execute in dedicated workers after the Decision progress state receives a browser paint opportunity. Cancel terminates the active generation and retains the last successful run. No provider request, cache, DTE, threshold, or explanation policy is changed.
