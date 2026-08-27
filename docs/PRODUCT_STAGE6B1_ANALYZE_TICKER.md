# Stage 6B.1 — Asset-Aware Analyze Ticker

Completion date: 2026-08-26

## UX and placement

Analyze Ticker is placed at the top of Scanner's discovery controls in both desktop and mobile layouts. This is discoverable at the moment a user starts researching, without adding a route, desktop navigation item, mobile bottom tab, or command palette.

The control is a normal form with a controlled text input and an explicit Analyze button. It performs no request on typing, focus, hover, or suggestion preload. The input trims whitespace, uppercases case-insensitively, permits supported alphanumeric ticker syntax plus `.`, `^`, and `-`, and does not blindly strip meaningful punctuation. A valid submission navigates once to the bookmarkable `/options/:ticker` route. Viewing remains transient; nothing is saved unless the user later invokes an existing explicit contract action.

On phones the input uses a 16px font to prevent iOS zoom, and both input and button have a minimum 44px target. The form stacks when needed and remains available at 375×667, 390×844, 430×932, 667×375, and 844×390 without a new navigation surface.

## Asset capabilities

| Runtime identity | Shown | Hidden |
|---|---|---|
| Known leveraged ETF (for example TQQQ) | Registry name/type, leverage multiple, holdings/proxy, leverage-aware chart context, daily-reset/compounding warning | Unsupported stock modules |
| Normal ETF (for example SPY) | ETF/provider identity and holdings when available | Leverage, leveraged proxy analytics, daily-reset warning |
| Stock (for example NVDA) | Provider-supported name/type, price history, option chain, transparent contract metrics | ETF holdings, benchmark proxy, leverage, ETF copy |
| Unknown provider-valid symbol | Safe generic/provider-confirmed name and type, supported price/option data | Guessed leverage, industry, category, benchmark, holdings |

Unknown metadata hides modules. It never becomes inferred financial metadata merely because a route exists.

## Result and recovery states

- **Valid + optionable:** render normal asset-aware detail and select the requested expiry or shortest valid expiry.
- **Valid + no listed puts:** explain that the ticker may not have listed options or that its chain may currently be unavailable.
- **Invalid syntax/symbol:** explain that the ticker could not be found or input is invalid without making an additional preflight request.
- **Temporary provider failure:** say market data is temporarily unavailable; do not claim the ticker does not exist.

Every failure/empty state offers **Try Again** and **Back to Scanner**. Raw Yahoo/provider errors are never rendered.

## Request graph and measured architectural budget

The counts below describe application endpoints and core acquisitions. Yahoo session acquisition, cookie/crumb refresh, retry, stale fallback, and circuit-breaker behavior are conditional; actual provider HTTP attempts are exposed through the existing diagnostic response header and are not falsely presented as a constant.

### Before consolidation — cold initial detail

| Layer | Calls | Work |
|---|---:|---|
| Browser | 3 | `/api/options`, extended `/api/price`, legacy volatility-context endpoint |
| Vercel functions | 3 | One per browser endpoint |
| Core provider acquisitions | approximately 5 | initial options, daily price chart, intraday price chart, duplicate initial options for volatility context, weekly realized-vol chart |

### After consolidation — cold initial detail

| Layer | Calls | Work |
|---|---:|---|
| Browser | 1 | `/api/ticker-detail?ticker=...` (optional exact `date`) |
| Vercel functions | 1 | `ticker-detail` with a 60-second ceiling |
| Core provider acquisitions | 4 | one shared initial/exact option chain, daily chart, intraday chart, weekly realized-vol chart |

Exact architectural savings are **2 browser calls, 2 Vercel invocations, and 1 duplicate core option-chain acquisition** per cold initial detail. Conditional provider retries/session work can change HTTP-attempt totals, so the server records actual attempts instead of claiming a fixed vendor count.

### Other navigation paths

- A valid Scanner exact-expiry route passes that date into the combined request and does not also acquire a default chain.
- If a requested date is unavailable, the page safely falls back; the bounded worst case is one combined exact-date attempt plus one combined default fallback.
- Analyze Ticker without an expiry uses the normal shortest-valid-expiry response.
- Expiry switching makes one explicit cached `/api/options?ticker=...&date=...` request for the chosen chain; it does not reacquire price or volatility context.
- Opening the interactive chart remains explicit. Leveraged proxy acquisition occurs only when leverage context is supported and requested.
- Warm browser-broker hits can render without a network request; soft/hard TTL, stale fallback, and in-flight deduplication remain the established cache policy.

## Volatility context

The visible label is **IV vs 1Y Realized Range**. Current ATM put IV is positioned within the min/max range of rolling four-week annualized realized-volatility observations derived from trailing one-year weekly closes. The tooltip explicitly states that this is not traditional historical IV Rank. True historical IV Rank/Percentile is unavailable because no reliable historical implied-volatility series is present.

## Financial and liquidity integrity

Discovery surfaces use Secured-Cash Yield and Annualized Secured-Cash Yield, based on gross strike cash. Entered-position surfaces use Entry Net-Risk Return, based on net maximum-loss capital. Remaining-liability metrics name whether they use entry or current net risk. Bid, Ask, Last, spread, Spread %, Volume, Open Interest, last-trade freshness, and cache freshness remain visible primitives; no opaque liquidity score was added.

Unavailable/non-finite values sort last both ways, zero remains valid, stale is not collapsed into missing, and a Delta fallback requires complete finite positive model inputs. Cross-surface deterministic fixtures reconcile identical contracts and explicitly encode intentional denominator differences.

## Safety boundaries and limitations

- No broad stock/ETF membership was added to Scanner, Screener, or Pulse.
- No autocomplete, provider search, preflight request, crawler, polling, automatic all-symbol refresh, or background prefetch exists.
- No Saved Underlying, Watchlist-underlying, Portfolio, preference, cloud, or schema mutation occurs on analysis.
- Provider quote type/name and Yahoo optionability can be absent or temporarily ambiguous; the UI fails generically rather than guessing.
- Market data can be stale, delayed, incomplete, retried, or unavailable. A displayed quote is not a fill guarantee.
- Earnings, dividends, fundamentals, true historical IV, assignment probability, and proprietary liquidity scoring remain out of scope.

## Recommended follow-up after Stage 6B.1

Stage 6B.2 should harden the existing Scanner, Screener, Watchlist, Portfolio, detail, and Pulse workflows before any product expansion. A broader universe or Saved Underlyings is not a current Put Scanner recommendation; keep those ideas in a separate future product/design track unless usage evidence later justifies reopening scope.
