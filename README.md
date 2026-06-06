# put-scanner

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-zbhgn797)

## Usage / Vercel safety

- The app does not poll market data automatically; refreshes and scans are user-initiated.
- Vercel `/api` routes are the canonical serverless surface for market data.
- ETF Pulse stores computed rows in a 6-hour client cache and reuses cached daily history.
- Option chains use memory, localStorage, in-flight request deduping, and Vercel CDN cache headers.
- ETF Pulse Market Read reuses already-loaded ETF Pulse rows and does not fetch option chains.
- Sorting, filtering, visual period toggles, Market Read details, and hover interactions are client-side only.
- Refresh buttons are the intended market-data refresh points.
- Run `npm run build` followed by `npm run build:report` to inspect the largest built JS/CSS assets.
