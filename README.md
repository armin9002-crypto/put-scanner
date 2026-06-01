# put-scanner

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-zbhgn797)

## Usage / Vercel safety

- The app does not poll market data automatically; refreshes and scans are user-initiated.
- Vercel `/api` routes are the canonical serverless surface for market data.
- ETF Pulse stores computed rows in a 6-hour client cache and reuses cached daily history.
- Option chains use memory, localStorage, in-flight request deduping, and Vercel CDN cache headers.
- Trade Cockpit loads without option-chain calls and only scans when `Run Trade Scan` is clicked.
- Trade Cockpit defaults are bounded by max tickers and expirations per ticker, with request estimates shown before scanning.
- Sorting, filtering, visual period toggles, and hover interactions are client-side only.
- Refresh buttons and manual scan buttons are the intended network refresh points.
