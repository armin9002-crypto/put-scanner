# put-scanner

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-zbhgn797)

## Usage / Vercel safety

- The app does not poll market data automatically; refreshes and scans are user-initiated.
- Vercel `/api` routes are the canonical serverless surface for market data.
- ETF Pulse stores computed rows in a 6-hour client cache and reuses cached daily history.
- Option chains use memory, localStorage, in-flight request deduping, and Vercel CDN cache headers.
- ETF Pulse Market Read reuses already-loaded ETF Pulse rows and does not fetch option chains.
- Recommendations is an explicit-refresh, deterministic Market-mode engine; page load and all board/evidence interactions are request-free.
- A cold Recommendations refresh reuses one Pulse pass plus the bounded near/middle/far (maximum three) Screener expiration plan; see `docs/RECOMMENDATIONS_ENGINE_V1.md` for exact policy and ceilings.
- Sorting, filtering, visual period toggles, Market Read details, and hover interactions are client-side only.
- Refresh buttons are the intended market-data refresh points.
- Run `npm run build` followed by `npm run build:report` to inspect the largest built JS/CSS assets.

## Validation

- `npm test` runs deterministic Node regression tests against sanitized Yahoo fixtures and the production domain modules.
- `npm run verify` is the pre-commit gate: typecheck, unit tests, legacy self-checks, responsive checks, one production build, and lint.
- `npm run build:report` reads the completed build output separately, so the verification gate does not build twice.
- `npm run visual:recommendations` captures the four-theme Recommendations state/viewport matrix under ignored `e2e-artifacts/`.
