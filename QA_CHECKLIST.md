# Put Scanner QA Checklist

## Network / Usage

- Opening Scanner, Portfolio, ETF Pulse, and Trade Cockpit does not create request loops.
- Sorting, filtering, scrolling, hovering, and visual-period changes create zero API calls.
- Trade Cockpit makes option-chain requests only after Run Trade Scan.
- ETF Pulse uses cached daily history on reload and refreshes only from the Refresh button.
- Portfolio Refresh Open Trades makes only expected quote/chain requests.
- ETF option-page Refresh uses a fresh selected-chain request and normal navigation remains cached.

## Portfolio

- Bid / Ask / Last changes update displayed marks without mutating stored trade data.
- Gross risk, premium, current value, gain/loss, percent captured, and yields show no NaN/Infinity.
- Maturity Wall percentages sum logically against gross risk and show dashes for zero exposure.
- Health badges use absolute delta and the current thresholds: Monitor, Elevated, Risky, Threatened.
- Notes / Errors and Nominal Yield toggles affect display only.

## ETF Pulse

- Table header and body columns align, including during horizontal scroll.
- Sticky controls and sticky table header do not overlap or drift while scrolling.
- Search, leverage, type, and trend filters affect the table, heatmap, and quadrant consistently.
- 52W DD and Recent DD are zero or negative; 52W Pos is clamped to 0-100%.
- RSI is 0-100, 20D RV is positive when present, and missing values show dashes.

## Trade Cockpit

- Page load makes zero option-chain calls.
- Default scan inputs are conservative: 60-150 DTE, max delta 0.15, 30% cushion, 20 OI, 30% spread.
- Scan estimates reflect max tickers and expirations per ticker.
- Diagnostics explain where candidates were filtered out.
- Near misses exclude no-bid, non-OTM, and outside-DTE contracts unless explicitly labeled.
- Candidate sorting and bucket classification are client-side after a scan.

## Screener

- Delta filters use absolute delta for puts.
- OTM / ITM filters match put moneyness correctly.
- Yield filters use bid-based annualized yield where shown.
- Changing filters does not auto-run new network scans unless the user triggers a scan.
- Sorted rows continue to reflect the current filters.

## Option Chain Freshness

- Open `/options/HIBL`, select Aug 21, 2026 (`1787270400`), and click Refresh.
- Network shows `/api/options?ticker=HIBL&date=1787270400&fresh=1` or equivalent.
- Chain diagnostics are hidden by default in normal UI.
- Enable debug mode with `localStorage.setItem('put_scanner_debug_options', 'true')`, reload, and refresh again.
- Debug diagnostics show source Fresh, requested expiration, returned expiration, put strike count, and put strike range.
- Requested expiration and returned expiration match for the selected HIBL chain.
- Copy diagnostics JSON includes displayed rows with strike, contractSymbol, bid, ask, last, IV, OI, volume, and last trade date.
- Compare app rows to Yahoo Finance Puts for the same expiration, not Yahoo Calls.
- Displayed put count equals Yahoo raw puts count for the same expiration.
- Bid, ask, last, IV, OI, volume, and last trade date match Yahoo raw put JSON.
- Zero-bid, zero-OI, and missing-delta puts still appear on the ETF detail page.
- Decimal strikes display exactly and are not rounded.
- Sorting, strike clicks, and Show Volume / OI create zero additional requests.

## Underlying Holdings

- Open `/options/TQQQ` and confirm no `/api/holdings` request happens on page load.
- Click Underlying Holdings and confirm QQQ holdings load on demand.
- Close and reopen the popup; cached QQQ holdings should show without a new request inside the TTL.
- Open QLD and confirm QQQ holdings are reused from cache.
- Open SSO and confirm SPY holdings load on demand.
- Open SOXL and confirm SOXX holdings load on demand.
- Open AGQ and confirm no holdings request is made; the popup says holdings are not meaningful.
- Option-chain Refresh should not refresh holdings.
- Holdings Refresh should refresh only the current proxy ticker.
- Modal works on desktop, iPhone portrait, iPhone landscape, and iPad without page-level horizontal overflow.

## Watchlist

- Starred contracts persist across reloads.
- Unstarring/removing a contract removes the stored watchlist item.
- Refresh handles expired or missing contracts without crashing.
- Notes persist and sorting does not discard refreshed values.
- Duplicate watchlist entries are not created for the same contract.

## OCR Import

- Tesseract/OCR code loads only when the screenshot import flow is opened or used.
- Fidelity rows parse core fields: ticker, put, expiry, strike, contracts, average cost, and cost basis.
- Price/current-value screenshot fields are informational and do not block import when core fields are valid.
- Existing positions match by ticker | put | expiry | strike and preserve notes/date unless edited.

## Mobile / Tablet

- Navigation works at mobile widths.
- Wide tables scroll inside their wrappers without page-level horizontal overflow.
- Portfolio analytics, ETF Pulse visuals, and Trade Cockpit cards stack cleanly.
- Inputs, tooltips, and warning popovers remain usable on touch devices.
- Test iPhone portrait and landscape, iPad portrait and landscape, and desktop for `/`, `/options/TQQQ`, `/options/HIBL`, `/screener`, `/watchlist`, `/portfolio`, `/pulse`, and `/cockpit`.
- Rotating or resizing the viewport creates zero API calls.
- Phone landscape option pages use mobile-safe option cards, not the desktop table.
- Modals and drawers keep close buttons visible and scroll internally only when content exceeds available height.
