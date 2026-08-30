# Put Metric Definitions

Stage 6B.1 contract date: 2026-08-26

This section is the authoritative product contract as of Stage 6B.1. It supersedes the historical Stage 6A audit retained below.

## Canonical capital and return terminology

| Product label | Exact formula | Denominator and use |
|---|---|---|
| Premium per Contract | `option price × 100` | No denominator. Total premium additionally multiplies by contracts. |
| Gross Risk | `strike × 100 × contracts` | Full cash-secured assignment requirement before premium; not broker margin or buying-power reduction. |
| Net Risk | `gross secured cash - total premium` | Assumes the underlying can fall to zero. |
| Nominal Yield (NY) | `premium / gross secured cash` | Gross secured cash. Used for Scanner, Screener, ticker detail, and Watchlist discovery quotes. |
| Annualized Yield (AY) | `NY × 365 / DTE` | Gross secured cash. Simple annualization; unavailable at `DTE <= 0`. |
| Entry NY | `premium collected / entry net maximum-loss capital` | Entry net maximum-loss capital. Used for an entered position in Portfolio. |
| Entry AY | `entry NY × 365 / original DTE` | Entry net maximum-loss capital. Simple annualization. |
| Current NY | `current buyback cost / entry net maximum-loss capital` | Original entry net maximum-loss capital. This is a remaining-liability ratio, not earned yield. |
| Current AY | preceding ratio `× 365 / remaining DTE` | Original entry net maximum-loss capital. |
| Remaining AY to Maturity | `current buyback cost / (gross secured cash - current buyback cost) × 365 / remaining DTE` | Current net maximum-loss capital. Kept distinct because its denominator is intentionally different. |

Canonical labels now map consistently to their existing context-specific formulas. Discovery values remain distinct from entered-position economics because they answer different questions. Internal persisted field names such as `originalAnnualizedYield` remain for schema compatibility; visible labels and tooltips carry the canonical meaning.

## Quote, contract, and lifecycle definitions

- Bid, Ask, and Last are normalized provider values. A valid zero remains zero. Invalid, negative where invalid, or non-finite values are unavailable.
- Mid is `(bid + ask) / 2` only for valid ordered quotes. It is a reference value, not a fill guarantee.
- Selected mark is the user-visible Bid, Ask, Last, or Mid basis used for position calculations. Mark basis remains visible.
- Breakeven is `strike - option price` per share.
- OTM % is `(underlying - strike) / underlying × 100`; positive is OTM for a put. It is not assignment probability.
- DTE is UTC expiration date minus the UTC current date. Expiration day is 0 DTE; a contract is expired only below 0 DTE.
- Bid-Ask Spread is `ask - bid`. Spread % is `(ask - bid) / ((bid + ask) / 2)` and is unavailable when quotes are invalid or the midpoint is zero.
- Premium Captured is open-position gain/loss divided by premium collected. It is mark-dependent and not clamped.
- Realized IRR is `(1 + realized P&L / original net risk)^(365.25 / days held) - 1`; invalid capital or holding periods produce unavailable.

Volume and Open Interest remain transparent primitives. Put Scanner does not create a proprietary liquidity score. A user can inspect Bid, Ask, spread, Spread %, Volume, Open Interest, and quote age where supported.

## Volatility-context correction

The current metric is **IV vs 1Y Realized Range**, not IV Rank or IV Percentile.

1. Select the nearest-strike current put IV from the already acquired initial option chain.
2. Acquire trailing one-year weekly closes.
3. Build a series of annualized four-week realized-volatility observations from rolling weekly log returns.
4. Position current ATM put IV within the minimum/maximum of that realized-volatility series, clamped to 0–100.

The observation percentage is the share of realized-volatility observations below current ATM put IV. Neither number is traditional historical IV Rank/Percentile because the historical comparison series is realized volatility, not implied volatility. True IV Rank and IV Percentile remain unavailable until a reliable historical implied-volatility source, retention policy, licensing basis, and quality rules exist.

## Value availability and sorting

Stage 6B.1 uses four explicit states: `available`, `unavailable`, `stale`, and `loading`. `0` is available and formats as zero; it is not folded into unavailable. `null`, `undefined`, empty input, and non-finite numeric values do not receive plausible numeric formatting. Cache or quote freshness is tracked separately from numeric validity, so a valid number can be marked stale.

Shared nullable comparators rank valid numeric values normally and put unavailable/non-finite values last in both ascending and descending order. Equal values return a comparator tie so JavaScript's stable sort preserves source order. This contract is applied to Scanner, Screener, Watchlist, ticker detail, and applicable Portfolio tables.

## Delta source and fallback rules

- A finite provider put Delta in `[-1, 0]` is preferred, including on expiration day.
- A calculated Black-Scholes put Delta is allowed only when underlying, strike, time, and IV are finite and strictly positive and the risk-free rate is finite.
- Missing/zero/negative underlying, invalid strike, missing/zero/negative IV, non-positive modeled time, expired contracts, or non-finite intermediates produce unavailable.
- There is no fabricated `-0.5`, zero-Delta, or 80% IV fallback.
- Staleness is shown as freshness context; it does not make an invalid fallback permissible.

Delta remains a model sensitivity, not a guaranteed probability of assignment.

### Entry Delta historical snapshot (Stage 6B.4)

Portfolio **Entry Delta** is distinct from **Current Delta**. Entry Delta is the finite signed put Delta in `[-1, 0]` observed or validly calculated for the exact contract at/near entry. Current Delta is transient market state and is never substituted for an older missing Entry Delta.

Eligible automatic capture requires the trade's sold date to match the current U.S. market date, a contemporaneous non-stale exact chain, and either a valid provider Delta or every input required by the canonical calculation. Manual broker Entry Delta is optional and explicitly durable. Legacy recovery is limited to an actual `entrySnapshot.delta`; current Delta, IV, and underlying are prohibited historical inputs. See `PRODUCT_STAGE6B4_PORTFOLIO_MAINTENANCE.md` for provenance and compatibility.

### Portfolio quote freshness (Stage 6B.4)

Portfolio distinguishes the time Put Scanner observed a market response from the provider's last option trade. Fresh/Aging/Stale/Unavailable uses observed time and weekday market-session age; an old Last trade does not by itself claim the current Bid/Ask is old. Stale/unavailable quote inputs are gated from Close Candidates and from quote-derived attention components. Existing risk and close thresholds are unchanged.

## Cross-surface regression contract

Deterministic fixtures cover a liquid contract, wide spread, missing Bid/Ask/Last/Delta, invalid underlying, expired contract, 0-DTE contract, and non-finite provider values. For the same contract and price basis, tests reconcile premium, Gross Risk, Net Risk, NY, AY, Entry NY, breakeven, OTM %, DTE, and spread across applicable Scanner, Screener, ticker-detail, drawer, Watchlist, and Portfolio code. Intentional differences are asserted by denominator rather than allowed as unexplained drift.

## Historical-value safety

Stage 6B.1 changes labels, shared helpers, and invalid-input behavior; it does not rewrite saved Portfolio trades, Watchlist contracts, backups, cloud payloads, revisions, prices, premiums, or historical return fields. Existing saved financial values retain their original arithmetic and durable schema interpretation.

## Historical Stage 6A audit (superseded above)

Stage 6A audit date: 2026-08-26

This is the product contract for the financial metrics currently shown by Put Scanner. It documents what the code calculates; it is not investment advice. Unless noted otherwise, one U.S. equity-option contract represents 100 shares, percentages are stored as decimals in portfolio code and as percentage points in discovery-row code, and UI formatters perform display rounding only.

## Price inputs and quote policy

| Term | Definition and source | Current use | Caveat |
|---|---|---|---|
| Bid | Provider's normalized option bid. Invalid/negative values become unavailable; zero is retained where a quote can legitimately be zero. | Discovery-row `AY Bid`; Watchlist; selectable sold price; portfolio `bid` mark. | A displayed bid is not a fill guarantee. |
| Ask | Provider's normalized option ask. | Discovery-row `AY Ask`; Watchlist; portfolio default close-cost basis when selected. | For a short put, ask is the conservative buy-to-close side. |
| Last | Provider's normalized last option trade. Last-trade timestamp is separately exposed. | Discovery-row `AY Last`; fallback mid/current mark; manual sold-price choice. | Can be stale; `OptionDetailDrawer` explicitly shows age. |
| Mid | `(bid + ask) / 2` only when both are non-negative and `ask >= bid`; portfolio also accepts a stored explicit mid, then falls back to last. | Option drawer; portfolio selectable mark. | Mid is a reference, not an executable price. |
| Selected sold price | User-entered value or selected Last/Bid/Mid/Ask in `OptionDetailDrawer`. | Premium, risk, return, and portfolio-entry snapshot. | Zero is currently accepted. This is permissive input behavior, not an assertion that a zero-premium trade is sensible. |
| Selected portfolio mark | User preference: ask, bid, last, or mid. | Open-position value, gain/loss, captured premium, current yields, close candidates. | Every management signal changes with mark basis. UI must keep that basis visible. |

Primary implementation: `src/lib/optionMetrics.ts`, `src/lib/portfolioMetrics.ts`, `src/components/OptionDetailDrawer.tsx`, and `src/lib/yahooOptionAdapter.ts`.

## Contract and discovery metrics

| Metric | Exact formula | Locations and consistency | Applicability and caveats |
|---|---|---|---|
| DTE | UTC calendar date of expiration minus current UTC calendar date, rounded to whole days. Original portfolio DTE is expiration date minus sold date. | Shared `calculateDte`; Scanner/Screener/detail/Watchlist use it. Portfolio clamps remaining DTE to `max(0, DTE)`. | Expiration day is `0 DTE`, not expired. Stage 6A fixed Watchlist to expire only when DTE `< 0`, matching Portfolio. No trading-calendar adjustment. |
| Premium per contract | `optionPrice × 100`. | Shared calculation. | Excludes commissions, fees, tax, and slippage. |
| Total premium | `optionPrice × 100 × contracts`. | Drawer and Portfolio agree for the same sold price/contracts. | Same exclusions as above. |
| Gross/equity at risk | `strike × 100 × contracts`. | Drawer and Portfolio agree. | This is full cash-secured assignment value, not broker margin or buying-power reduction. |
| Maximum loss / net capital at risk | `gross risk − premium`. | Drawer and Portfolio agree. | Assumes the underlying can fall to zero. Product labels use both “Max Loss” and “Net Capital at Risk” for the same number. |
| Breakeven | `strike − optionPrice` per share. | Scanner/Screener/detail/Watchlist use the applicable quote; drawer/Portfolio use selected sold price. | Two views agree only when they use the same price input. |
| OTM/ITM % | Signed value `(underlying − strike) / underlying × 100`. A put is OTM when strike is below underlying. Absolute distance `< 0.5%` is labeled ATM. | Shared `calculateMoneyness` across discovery/detail/Watchlist. Portfolio distance-to-strike stores the decimal equivalent. | The signed stored value is positive OTM and negative ITM. This is distance, not assignment probability. |
| Downside cushion | `(underlying − breakeven) / underlying`. | Drawer and shared option metrics; Portfolio has the same distance-to-breakeven formula. | Depends on selected option price and current underlying. |
| Secured-Cash Yield (SCY) — discovery | `optionPrice / strike`; displayed as percent. | Scanner snapshots, Screener, detail rows, Watchlist, and the drawer use `calculateSecuredCashYield`/the equivalent shared calculation. | Denominator is gross secured cash per share. |
| Annualized Secured-Cash Yield (Ann. SCY) — discovery | `(optionPrice / strike) × (365 / DTE)`; displayed as percent. | Scanner snapshots, Screener, detail rows, Watchlist, and the drawer agree for the same quote and DTE. | Simple annualization, not compounded, and unavailable at DTE `<= 0`. It can exaggerate very short-duration economics. |
| Return on risk — position | `total premium / (gross risk − total premium)`. | Drawer `Return on Risk`; Portfolio Original Nominal Yield. | Denominator is net capital/max loss, so this is deliberately higher than discovery nominal yield. |
| Annualized return — position | `return on risk × (365 / original DTE)`. | Drawer `Annualized Return`; Portfolio Original/Entry AY. | Same simple-annualization caveat. This is the important cross-page naming inconsistency: it is not the discovery-table AY formula. |
| Bid/ask spread | `ask − bid` when quotes are valid and ordered. | Drawer and liquidity snapshot inputs. | Absolute dollars per share. |
| Bid/ask spread % | `(ask − bid) / ((bid + ask)/2)`. | Drawer and Scanner liquidity classification. | Unavailable when midpoint is zero. Spread can change rapidly and is not a fill model. |
| Delta | Provider delta when usable; otherwise Black–Scholes put delta `N(d1) − 1`, with annualized time `DTE/365`, risk-free rate 4.5%, and IV fallback 80%. | Detail, Scanner snapshot, Screener, Watchlist, and Portfolio refresh share the fallback convention in several call sites. | The fallback is model-based and hard-codes rate/IV defaults. In `OptionsPage`, a missing underlying price can still produce a misleading fallback delta because the guard is weaker than Watchlist/Portfolio; Stage 6A documents rather than changes this typed data path. Delta is not a guaranteed probability of assignment. |
| IV | Provider contract implied volatility, normalized to percentage points. | Rows, drawer, snapshots, Watchlist/Portfolio market snapshot. | A contract-specific quote, not an underlying-wide volatility measure. |
| IV vs 1Y Realized Range | Current ATM put IV is compared with a one-year series of four-week realized volatilities calculated from weekly closes. Position is `(current ATM IV − min realized vol) / (max − min)`, clamped 0–100. The companion percentile is the fraction of realized-vol observations below ATM IV. | `api/_lib/ivRank.js`; displayed on detail and Screener with the corrected visible name. | This is **not conventional IV Rank or IV Percentile**, because the historical series is realized volatility, not historical implied volatility. |
| Vol/OI | `volume / openInterest` when the row builder has valid values. | Detail/Screener optional column. | Same-day volume and accumulated open interest answer different questions; high ratio is not automatically bullish or liquid. |

## Portfolio and lifecycle metrics

| Metric | Exact formula | Meaning and caveat |
|---|---|---|
| Current option value | `−mark × 100 × contracts`. | Liability sign convention for a short option. Imported brokerage value can be used as a fallback in selected summaries. |
| Unrealized P&L | `(soldPrice − mark) × 100 × contracts`. | Excludes fees/slippage. |
| Total gain/loss | `premium collected + current option value`, equivalent to unrealized P&L for an open short put with a live mark. | Mark-basis dependent. |
| Premium captured | `total gain/loss / premium collected`. | 50% means half the original credit has been earned. It can be negative or exceed 100% with inconsistent/imported data; no clamp is applied. |
| Current nominal yield | `current buyback cost / original net capital at risk`. | Despite its label, this measures the remaining option liability against original net risk, not yield already earned. |
| Current AY | `current nominal yield × 365 / remaining DTE`. | Used in Portfolio cards and close-candidate logic. It is mark-dependent and is best read as annualized remaining liability relative to original net risk. The label needs clarification before a paid release. |
| AY to maturity / remaining AY | `current buyback cost / (gross assignment value − current buyback cost) × 365 / remaining DTE`. | Re-estimates the remaining premium economics against current net risk. It differs intentionally from Current AY's denominator. |
| Weighted delta | Gross-risk-weighted mean of valid open-trade deltas. | A portfolio directional-risk summary, but dollar risk and nonlinear Greeks are not fully represented. |
| Delta exposure | `delta × 100 × contracts`, summed across open trades. | Share-equivalent delta units; not dollars. |
| Underlying-equivalent exposure | `abs(delta) × underlying × 100 × contracts`. | A dollar-like directional exposure proxy used in analytics. It is not maximum loss. |
| Distance to strike | `(underlying − strike) / underlying`. | Positive means OTM for a put. |
| Distance to breakeven | `(underlying − (strike − soldPrice)) / underlying`. | Includes the original credit cushion. |
| Realized P&L at expiry | `premium − max(strike − expirationClose, 0) × 100 × contracts`. | Automatic archive uses an expiration close or nearest prior close and records warnings/source. Corporate actions are not modeled. |
| Realized IRR | `(1 + realizedPnl / originalNetRisk)^(365.25/daysHeld) − 1`. | History only. Returns `null` for invalid periods/capital and should not be compared casually across tiny holding periods. |

## Cross-page consistency result

For an identical contract, identical quote, identical underlying, and identical DTE:

- Premium, breakeven, OTM %, DTE, row nominal yield, and row annualized yield are consistent across Scanner, Screener, detail, and Watchlist.
- Drawer and Portfolio premium/breakeven agree when the drawer's selected sold price becomes the Portfolio sold price.
- Drawer Annualized Return and Portfolio Original/Entry AY agree because both use net capital at risk.
- Discovery-table AY does **not** equal drawer/Portfolio AY because discovery divides by gross strike collateral while position calculations divide by strike collateral net of premium. This is intentional arithmetic but ambiguous product language.
- Current AY and AY to maturity also use different denominators. Both are mathematically defined, but neither label currently explains the distinction.

## Required naming changes before public MVP

No financial definition was silently changed in Stage 6A. The UI nomenclature reversal keeps these definitions intact:

1. Discovery `AY` retains the gross-risk denominator and is defined in the shared tooltip contract.
2. Drawer and Portfolio `Entry AY` retain the net-risk denominator and original DTE.
3. Portfolio `Current AY` retains the original entry net-risk denominator; `Remaining AY to Maturity` remains distinct because its denominator is current net risk.
4. Rename the current `IV Rank` unless true historical implied-volatility data is obtained.
5. Keep the mark basis adjacent to all position-management metrics.

## Rounding and data quality

Calculations retain JavaScript floating-point values. Formatting generally uses two currency decimals, one or two percentage decimals, three delta decimals, and whole-number volume/open interest. Sorting and filtering use unrounded values. Provider timestamps, quote age, cache freshness, chain validation warnings, and stale-fallback markers are distinct from calculation validity; a numerically valid metric can still be based on stale data.
