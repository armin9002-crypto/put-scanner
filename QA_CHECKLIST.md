# Put Scanner QA Checklist

## Network / Usage

- Opening Scanner, Portfolio, and ETF Pulse does not create request loops.
- Sorting, filtering, scrolling, hovering, and visual-period changes create zero API calls.
- ETF Pulse Market Read and details use loaded rows and create zero API calls.
- ETF Pulse uses cached daily history on reload and refreshes only from the Refresh button.
- Portfolio Refresh Open Trades makes only expected quote/chain requests.
- ETF option-page Refresh uses a fresh selected-chain request and normal navigation remains cached.
- Visiting `/cockpit` redirects to `/pulse`.

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
- Portfolio analytics and ETF Pulse visuals stack cleanly.
- Inputs, tooltips, and warning popovers remain usable on touch devices.
- Test iPhone portrait and landscape, iPad portrait and landscape, and desktop for `/`, `/options/TQQQ`, `/options/HIBL`, `/screener`, `/watchlist`, `/portfolio`, and `/pulse`.
- Rotating or resizing the viewport creates zero API calls.
- Phone landscape option pages use mobile-safe option cards, not the desktop table.
- Modals and drawers keep close buttons visible and scroll internally only when content exceeds available height.

## Responsive / Orientation QA

Use these viewports when touching layout: iPhone SE portrait `375 x 667`, iPhone SE landscape `667 x 375`, iPhone 14 portrait `390 x 844`, iPhone 14 landscape `844 x 390`, iPhone Pro Max portrait `430 x 932`, iPhone Pro Max landscape `932 x 430`, iPad portrait `768 x 1024`, iPad landscape `1024 x 768`, desktop `1440 x 900`.

Debug helpers:

- Enable layout badge with `localStorage.setItem('put_scanner_debug_layout', 'true')` and reload.
- Enable network badge with `localStorage.setItem('put_scanner_debug_network', 'true')` and reload.
- Run `npm run responsive:check` to print the manual viewport matrix and overflow snippet.

ETF option pages:

- iPhone portrait uses mobile option cards.
- iPhone landscape uses mobile-safe option cards, not the desktop table.
- iPad landscape table fits inside its table wrapper.
- Option detail drawer fits portrait and landscape; close button remains visible.
- Underlying Holdings modal fits portrait and landscape without unnecessary scroll.
- Expiration pills are horizontally scrollable and tappable.
- No page-level horizontal overflow.
- Mobile sort controls work.
- Refresh only fetches after the user clicks Refresh.

Portfolio:

- Summary cards wrap cleanly.
- Analytics cards stack or grid without clipping.
- Schedule table/cards remain usable.
- Add Trade, Import Screenshot, and Refresh buttons remain accessible.
- Add/edit/import modals fit portrait and landscape.

ETF Pulse:

- Table scroll is contained inside the table card.
- Market Read ribbon stays compact and details open without network requests.
- Heatmap tiles fit phone portrait and landscape.
- Momentum quadrant does not overflow the page.
- Sticky/frozen controls do not consume too much mobile screen height.
- Visual period toggles update from loaded rows and create zero fetches.

Screener / Watchlist / Scanner:

- Filters wrap cleanly.
- Tables or cards remain usable without clipped columns.
- Scanner ETF cards remain tappable and charts do not overflow.
- Watchlist note editing does not create row-height explosions.
- Sorting and resizing create zero accidental fetches.
