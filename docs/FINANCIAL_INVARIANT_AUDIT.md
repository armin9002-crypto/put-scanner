# Financial calculation invariant audit

Audited 2026-09-21 against fetched `main`, starting at `8d7883e05a388d10263a3490a7d7240fbf9a88c8`.
Scope: discovery, Option Drawer, Watchlist, Portfolio, History and Recommendations financial boundaries. ETF Pulse technical indicators are excluded.

## Authoritative contract and units

The opening contract in [PUT_METRIC_DEFINITIONS.md](PUT_METRIC_DEFINITIONS.md) supersedes its retained Stage 6A text. NY is `price / strike`; AY is `NY * 365 / calendar days`. Neither uses Net Risk. The older net-risk NY wording in `PORTFOLIO_HISTORY_SEMANTICS_REFINEMENT.md` is also superseded by that explicitly authoritative contract. No denominator or policy threshold was redesigned.

| Value | Calculation unit | Display boundary / intentional difference |
| --- | --- | --- |
| NY / AY | Decimal in `optionMetrics` and Portfolio; percentage points from `calculateYieldPercent` | `formatPercent` multiplies decimals once; `formatPercentPoints` does not. |
| IV | Yahoo compatibility normalization to percentage points | `resolvePutDeltaWithSource` divides by 100 for Black-Scholes sigma; UI prints points directly. See unresolved compatibility issue below. |
| Moneyness | Signed percentage points: `(underlying - strike) / underlying * 100` | Canonical one-decimal label; Options' `otmItmPct` is an absolute-distance sorting field, with sign retained in state/label. |
| Cushion / strike and breakeven distances | Decimal fractions | Portfolio percent formatter multiplies once. Breakeven distance includes original sold credit; current-mark breakeven is a different concept. |
| Captured premium | Decimal P&L / entry premium | Negative values are valid; zero entry premium makes capture unavailable. Never clamped. |
| Premium / Gross Risk / Net Risk | Dollars for `100 * contracts` shares | Gross Risk = strike notional; Net Risk subtracts entry premium. |
| Current option value | Negative dollars for a short liability | P&L = entry premium + current value. Current NY/AY use positive mark, gross collateral and remaining DTE. |
| Realized return / AY | Decimal realized P&L / gross risk; simple calendar-day annualization | Legacy `Irr` identifiers do not mean cash-flow IRR/XIRR. Generic XIRR utility is not the History headline. |
| Remaining AY to maturity | Decimal mark / (strike - mark), annualized | Intentionally uses current net risk, distinct from Current AY. |

## Canonical implementation map

| Domain | Canonical source and actual consumers |
| --- | --- |
| Market date / DTE | `shared/marketDate.js`, `usMarketCalendar.ts`, `optionMetrics.calculateDte`; Options, Screener, Watchlist, Portfolio refresh. Original DTE and Days Held use date-only UTC intervals, not elapsed intraday hours. |
| NY / AY / premium / breakeven / cushion / moneyness | `optionMetrics.ts`; Options' enriched rows, `screenerRows.ts`, `watchlistRows.ts`, `OptionDetailDrawer.tsx`; Portfolio wrappers preserve gross-risk yield. |
| Quote trust and Drawer basis | `optionMarketIntegrity.trustedOptionPrice`, `optionQuoteDisplay.buildOptionDrawerQuoteState`; trusted Last → Bid → Mid → none. Stale and undated Last stay reference inputs with their existing warnings. Invalid/fallback-only Last stays excluded. |
| Delta / IV | `yahooOptionAdapter.ts`, `marketDataNormalize.ts`, `putDelta.resolvePutDeltaWithSource`; exact provider Delta first, otherwise versioned calculated fallback with valid inputs. Provider positive magnitudes are normalized to signed put Delta by existing compatibility behavior. |
| Watchlist | `watchlistRefresh.mergeWatchlistRefreshItem` resolves exact evidence; `watchlistRows.buildWatchlistRow` recomputes yields and moneyness from raw snapshot values. Saved observation Greeks retain their observation semantics until refresh. |
| Open positions | `portfolioValuation.resolvePortfolioMark`, `portfolioMetrics.ts`, `portfolioAnalytics.ts`; selected basis or explicit Portfolio-only positive Last valuation fallback. `portfolioContractPositions.ts` selects the current contract observation and retains independent entry lots. |
| Expiration / assignment / close | `portfolioExpirationArchive.resolveExpiredTradeWithClose`, `portfolioRealizedEconomics.ts`, `portfolioHistoricalTrade.ts`; intrinsic = `max(strike - underlying close, 0)`. Expired ITM does not infer confirmed assignment. Assigned P&L requires known durable economics. |
| History / aggregation | `portfolioHistoryAnalytics.ts`, `portfolioContractPositions.ts`; raw-lot numerator/eligible denominator, Gross Risk weighting except Premium-weighted capture. Monthly buckets use expiration month; realized AY uses the actual canonical realization date. |
| Historical charts | `rollingHistoricalAnalytics.ts` delegates Entry AY, realized AY, dates, Delta/IV and premium to the canonical helpers; `portfolioHistoricalStateAnalytics.ts` reconstructs EOD exposure and risk-weighted DTE using date-only arithmetic. Existing rolling/history suites cover windows, coverage and terminal boundaries. |
| Recommendations | `recommendations/pricing.ts` supplies trusted Bid or explicitly indicative economics; `engine.ts` consumes canonical Screener points and helpers for breakeven/cushion/yield inversion. Last is transaction evidence, not executable seller credit. Tick rounding for hypothetical indicative ranges / target order credits remains policy, not rounding of provider quotes. |

## Deterministic fixture matrix

The three `tests/financial-*.test.mjs` files use fabricated data, fixed clocks and independent arithmetic expectations. They complement the existing financial suites rather than replacing their broader lifecycle and request fixtures.

| Fixture | Coverage and required agreement |
| --- | --- |
| A normal OTM | Yahoo adapter → Screener → Watchlist refresh/row; Drawer same-basis yields, breakeven, premium, cushion, moneyness, IV/Delta; Recommendations Bid evidence. |
| B high precision | Last/Bid/Ask and computed Mid retain all input digits; yields differ detectably from cent-rounded inputs. Actual Drawer selection tested in Playwright. |
| C No Bid | Raw Bid 0 remains visible as No Bid; executable Bid yield unavailable. Valid Last remains Drawer default; no fictitious Mid or Recommendations Bid. |
| D stale Last | Same-basis reference yields agree; freshness remains stale. Recommendations does not substitute Last for Bid. Portfolio fallback is explicitly valuation-only. |
| E unknown Last age | Last-first stays intact; age is unavailable, not recent. |
| F provider Delta | Signed provider Delta, including zero, stays provider-sourced through normalization, refresh, save and Drawer mapping. |
| G calculated Delta | Independent Black-Scholes input-unit check; source/model retained on Watchlist save and Drawer open. Missing/invalid IV yields unavailable. |
| H near expiry | One-day AY, New York midnight, DST, 0 DTE and past expiration. Provider Delta may exist at 0 DTE; calculated Delta and AY require positive days. |
| I worthless expiry | Zero intrinsic; realized P&L = full premium; Days Held ends at expiration even if archived later; realized AY = Entry AY. |
| J ITM expiry | Positive intrinsic and a losing realized outcome; History agrees with expiration resolver and ignores stale redundant stored P&L. |
| K early buyback | High-precision close credit/cost, actual five-day holding period, winner and loser; same-day annualization unavailable. |
| L multiple exact lots | Unequal prices, quantities and entry dates; shared current contract observation; raw-lot Entry AY; grouped History totals and missing Delta/IV coverage reconcile to raw lots. |
| Additional boundaries | Open losing/near-zero marks, zero entry premium, unavailable aggregate liability, partial AY coverage, confirmed assignment with/without economics, invalid quote snapshots, screenshot sold-price precision and preserved exact-total precedence. |

Agreement is required only for identical evidence and basis. Entry/current prices and periods, reference Last/executable Bid, raw negative DTE/expired display clamps, and net-risk remaining AY/gross-risk Current AY deliberately differ. Portfolio and Watchlist clamp displayed expired DTE to zero; discovery excludes past expirations. All have unavailable AY for non-positive time. Watchlist's clamp predates this audit and is preserved.

## Findings and fixes

| Class | Finding | Resolution |
| --- | --- | --- |
| D calculation boundary | Portfolio contract rows used the freshest selected observation while headline/schedule totals valued sibling lots with their older or absent observations. | Pure `buildPortfolioValuationLots` projects the same observation onto the original lots for totals and coverage. Entry facts, weights and durable records remain unchanged. |
| D aggregation | History headers reweighted a contract's partial Entry Delta/IV (and other partial metrics) using the whole contract's risk, unlike raw-lot headline/footer totals. A fixture produced Delta `-0.0968989` instead of `-0.0477097`. | `buildHistoryGroupAggregates` expands contract rows back to their lots for financial aggregation, preserving the displayed position count. |
| D trust boundary | Options → Watchlist omitted integrity metadata; Watchlist row calculations accepted an invalid snapshot's raw quotes. | Preserve integrity on save and suppress invalid yield/Delta/IV calculations. Raw provider quotes remain auditable. Prior trusted retained/degraded snapshots keep their existing policy. |
| B provenance | Options/Recommendations → Watchlist and Watchlist → Drawer omitted provider/calculated Delta source/model. | Forward existing metadata through all three boundaries. No recalculation from current facts is substituted for a saved observation. |
| D precision | Screenshot parser rounded explicit or derived per-share average credit to cents before downstream use. Example `0.943267` became `0.94`. | Retain raw per-share precision. The existing exact total cost basis remains authoritative when present; OCR heuristics/tolerances are unchanged. |
| B presentation | Screener took the canonical one-decimal moneyness label and added a second decimal to that rounded string. | Use the shared canonical label. The production-scale Recommendation golden matches the old hash exactly after restoring only this old label. |
| C stale duplicate | Unused `calculateRealizedPnl` / unused summary field preferred redundant stored P&L and assumed every expired contract was worthless. | Removed the unused calculation/field. Active History economics already use canonical lifecycle helpers. No active historical formula changed. |
| A correct | Secured-cash denominators; full-precision live quote/Drawer path; calendar DTE; liability/P&L signs; unclamped capture; entry/current distinctions; intrinsic payoff; explicit assignment; simple realized AY; raw historical aggregation. | Regression protection added; established formulas retained. |

## Unresolved methodology / compatibility

`normalizeYahooIvPercent` accepts two unlabeled input units using magnitude (`<= 5` multiplied by 100; `> 5` treated as percentage points). Existing fixtures and compatibility inputs depend on that convention. An IV decimal above 5 (above 500%) is indistinguishable from a low percentage-point input. Ordinary Yahoo decimal IV is verified, but universal correctness for this overlapping range cannot be proved without a source-unit contract. This is class E; behavior is unchanged rather than silently dropping compatibility or redesigning normalization.

No claim is made that arbitrary malformed legacy records or untested provider payloads are covered by finite fixtures. The audit establishes the documented financial identities and inspected consumer paths, with the IV ambiguity above left explicit.

## Side effects, review and verification

Production financial consumption changed at the proven boundaries above; NY/AY methodology, thresholds, assignment policy and option identity did not. No acquisition, endpoint, request scheduling, durable mutation call, schema, or contract-key implementation changed. **Zero additional provider requests, zero new persistence writes, zero option-identity changes.** Snapshot metadata travels through existing save/local-observation paths; current valuation projections are never persisted. Drawer quote selection was additionally checked for zero market/account requests using intercepted browser fixtures.

The configured read-only Luna Explorer traced discovery consumers; Luna Fast Worker drafted bounded Portfolio tests, which the primary reviewed and strengthened. The configured read-only Sol Reviewer was invoked for the consequential diff but failed before review with a usage-limit error. There is no independent Sol approval. The primary completed integration, consumer/diff review, React hook/dependency review and final verification.

Checks passed: 21 targeted financial regressions; normal Node suite (607 tests, before the final additional Recommendation fixture, which passed in the targeted run); TypeScript; 94 self-checks; responsive source guardrails; request ledger; production build; ESLint; three desktop Playwright Drawer checks including full precision and no extra requests. The browser CLI skill's `agent-browser` binary was unavailable, so the established isolated Playwright harness supplied the browser checks. No screenshot matrix or live financial account mutation was performed. Windows sandbox restrictions required running Vite build/browser checks with approved execution permission. Lint retains four unrelated existing Fast Refresh warnings.
