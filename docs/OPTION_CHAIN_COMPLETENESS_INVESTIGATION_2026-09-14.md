# Option-chain completeness investigation — September 14, 2026

## Conclusions

- **EQQQ: no options according to the current Yahoo response.** A direct acquisition at 12:29:07 UTC identified `EQQQ` as **ProShares Ultra QQQ Equal Weight**, NasdaqGM, with `expirationDates: []` and `options: []`. The positive underlying quote was $39.5709. No expiration mismatch, integrity rejection, or application cache was needed to produce the empty result. This does not establish availability at every broker or for a similarly named instrument on another exchange.
- **No strike truncation reproduced.** SPY, expiration **2026-09-14** (`1789344000`), had **116 puts / 116 unique strikes / $550–$845** at every applicable stage, including actual client caches and desktop/mobile DOM rows.
- **A separate availability-classification defect was confirmed and fixed.** Before this change, a partial response containing a positive underlying quote but omitting `expirationDates` and `options` was classified as `no_options`. Normalization supplied empty arrays, and client validators accepted that result. Missing evidence could therefore become a misleading no-options state. The server inspector now requires explicit empty provider fields. There is no evidence this defect caused the observed EQQQ result.
- **The unidentified 66-contract Fidelity discrepancy remains unresolved.** SPY is an independent control, not an invented identity for that screenshot. No Fidelity chain was accessed or compared.

## Current pipeline and loss points

| Stage | Current implementation and behavior |
|---|---|
| Provider acquisition | `api/_lib/yahoo.js`, `fetchYahooOptions`: Yahoo session/crumb, then `/v7/finance/options/{ticker}` with optional `date`. No strike, moneyness, liquidity, Bid, Delta, DTE, pagination, or row-limit query. One selected option block is consumed, `options[0]`; no all-expiration union. Initial acquisition uses Yahoo's default block. A 401/403 can cause one session retry. |
| Server gate | `api/options.js` and `api/ticker-detail.js` call `inspectYahooOptionData`. `/options` forwards the original JSON unchanged on acceptance. `/ticker-detail` wraps the same raw options with underlying/volatility context. Explicit-date responses must report that exact block expiration; missing/wrong expiration becomes failure. Incomplete `/options` returns 502; ticker-detail returns provider failure, ordinarily 503. |
| Field normalization and contract structure | `src/lib/yahooOptionAdapter.ts`, `normalizeOptionChainData`: select first result/block; normalize numbers; discard nonpositive/missing/nonfinite strikes and OCC call symbols from puts; deduplicate by numeric strike, preferring usable market data then newer trade time; sort ascending. Duplicate rows can disappear here, but duplicate-strike collapse alone cannot reduce the unique strike count. Distinct adjusted contracts sharing one strike are not separately represented by this existing model; no such discrepancy was established in the sample. |
| Expiration evidence | Adapter propagates explicit returned expiration and, for requested chains, `expirationEvidence` derived from returned metadata and raw put/call OCC dates. `optionExpiryNavigation.ts` never treats the request itself as returned proof. Known contradictions take precedence; absent evidence is `unknown`. |
| Surface integrity | `src/lib/optionMarketIntegrity.ts`, `assessPutOptionSurface`: returns one annotated record per normalized contract. Local invalid/degraded contracts remain present. Whole-chain rejection occurs for a returned-expiration contradiction, all contracts invalid, or at least three invalid contracts constituting at least 80% of the chain. No quote values or strikes are fabricated. |
| Admission | `src/lib/optionChainCache.ts`, `isValidOptionsChain`: requires arrays, positive underlying price, non-invalid chain integrity, and exact requested-expiration proof when requested. An empty chain is admissible only without requested expiry, expirations, or calls. Whole-chain invalid acquisition is rejected before cache replacement. |
| Client acquisition/caches | `src/lib/api.ts`: `fetchTickerDetail` normalizes and validates, then primes shared options storage; `fetchOptions` validates through `requestMarketData`. Provenance wrapping preserves puts and `expirationEvidence`. `options_v2_TICKER_initial` and `options_v2_TICKER_DATE` are separate; schema 7, soft TTL 15 minutes, hard TTL 2 hours. Ticker-detail is separately cached, schema 2, soft TTL 5 minutes, hard TTL 45 minutes. Cache-first can reuse data through hard TTL. HTTP no-options responses are `no-store`, although validated client no-options data can still be cached. |
| Retention | `marketDataRequest.ts` validates before writing; invalid acquisition cannot replace a trusted record. `fetchOptions` permits stale fallback even for a fresh refresh. Ticker-detail fresh requests disable cache fallback, but OptionsPage keeps its previous in-memory chain on failure. Original observation time is preserved, with failure/stale labeling. A smaller but valid fresh chain can replace a larger valid chain; there is no completeness threshold or timestamp union. |
| Page/expiration navigation | `OptionsPage.tsx:434` loads ticker-detail with the requested expiry first; only HTTP 400/404 causes the initial request to retry without expiry. `resolveOptionExpirySelection` chooses the requested listed date or first listed date and fetches a specific chain if necessary. Publication checks exact expiration again. Failed expiry change keeps the prior selected chain and reports unavailability. |
| Presentation | `OptionsPage.tsx:637` maps **every** canonical put into an enriched row and sorts it. Desktop, portrait, and mobile-card paths iterate all rows. Integrity can suppress trusted economics, not contract existence within an accepted chain. Column toggles, watchlist status, origin, and portfolio strike focus do not filter the strike population. There is no Scanner/Screener discovery filter, row cap, pagination, or virtualization on this page. |

Source-aware navigation is centralized in `src/lib/optionsNavigation.ts`; it validates six internal origins and preserves ticker/expiry context. Scanner/Screener discovery policy is separate. Screener can prime full normalized chains into shared caches; its filtered display rows are not the OptionsPage source. Scanner benchmark snapshots are not a full-chain source for OptionsPage.

## Measured counts

Public Yahoo captures are retained locally under `e2e-artifacts/chain-audit-spy.json` and `chain-audit-eqqq.json`. These are investigation evidence, not brokerage fixtures. SPY was captured at **2026-09-14 12:29:07.664 UTC**, with an explicit request for September 14. Its raw response advertised **32 expirations**. An earlier initial/default acquisition also returned 116 puts for September 14; these acquisitions were not merged.

| SPY stage | Puts | Unique strikes | Minimum | Maximum |
|---|---:|---:|---:|---:|
| Raw provider selected block | 116 | 116 | 550 | 845 |
| Server-accepted payload | 116 | 116 | 550 | 845 |
| Numeric field normalization | 116 | 116 | 550 | 845 |
| Structural row filtering and duplicate handling | 116 | 116 | 550 | 845 |
| Canonical integrity-assessed chain | 116 | 116 | 550 | 845 |
| Structurally valid/cache-admissible chain | 116 | 116 | 550 | 845 |
| Shared cache read in isolated Node capture | 116 | 116 | 550 | 845 |
| Actual browser ticker-detail cache | 116 | 116 | 550 | 845 |
| Actual browser exact-expiry options cache | 116 | 116 | 550 | 845 |
| OptionsPage enrichment/sort input and output | 116 | 116 | 550 | 845 |
| Rendered desktop rows, 1440×900 | 116 | 116 | 550 | 845 |
| Rendered portrait rows, 390×844 | 116 | 116 | 550 | 845 |

Integrity: **116 clean, 0 degraded, 0 invalid**; expiration evidence **match**. Field normalization and structural filtering occur within the adapter, not as separate network responses. Their unchanged population follows from the raw/canonical strike equality and the length-preserving field map. The browser test replayed the captured public response through actual client acquisition, normalization, cache, and page rendering; it asserted equality of the entire strike arrays, not just counts. It did not call Yahoo or a brokerage from the browser.

EQQQ: **0 expirations, 0 raw/normalized/cached/exposed/rendered puts, 0 unique strikes; minimum/maximum not applicable**. Integrity counts are 0/0/0, and no requested-expiration proof is needed for this initial empty response. Both desktop and portrait rendered the no-listed-puts state from the captured data. The original user's browser cache was not inspected; fresh independent acquisition shows caching is unnecessary to explain this result.

## State audit

| State | Outcome |
|---|---|
| A. Explicit provider no options | Accepted only from explicitly empty provider evidence after the fix; no-store HTTP response; no-options UI. |
| B. Listed expirations, selected expiry has no puts | Classified incomplete, including calls-only blocks. The app cannot prove whether an empty puts array means true absence or incomplete supply; it intentionally does not assert absence. |
| C. Incomplete/unavailable | Missing result, network errors, suspicious emptiness, and now quote-only partial emptiness fail acquisition. Prior trusted data may be retained; otherwise unavailable/error. |
| D. Nonempty, UNKNOWN expiry | Explicit-date server requests fail if block expiration is missing. Canonical validators also reject UNKNOWN exact-expiry evidence. No conversion to no-options. |
| E. Wrong expiration | Fails server or canonical/page checks; does not publish requested-expiry economics. |
| F. Some invalid contracts | Remain as raw auditable rows in an accepted degraded chain; trusted economics fail closed. |
| G. Whole-chain invalid | Acquisition/cache rejection; no automatic empty-chain substitution. |
| H. Trusted cache retained | Existing chain and original observation time retained according to the acquisition path above; failure is separate. |
| I. Internally present but hidden | Not reproduced. Every canonical strike rendered in SPY, including absent/zero-Bid rows. Normalization exclusions and strike deduplication precede canonical data. |
| J. Yahoo thinner than Fidelity | Plausible but unproven without the actual matching brokerage symbol/expiry/strikes. The SPY control establishes preservation of one Yahoo response, not global provider completeness. |

## Exact-expiration hardening

No lost `expirationEvidence` propagation was found in the current adapter, provenance wrapper, cache validator, or page check. Schema 7 rejects old exact-expiry cache records without sufficient authority rather than relabeling them no-options.

One existing asymmetry is explicit and tested: the server requires `options[0].expirationDate` for an exact-date request, while the canonical client helper can accept fully matching OCC evidence when that field is absent. A hypothetical complete OCC-proven response with missing block expiration therefore fails at the server. `tests/yahoo-and-scanner.test.mjs` already asserts both outcomes. This can reduce availability, but neither live sample exhibited it; it was not established as a new regression and was not changed. Correctness was not weakened to increase counts.

## Changes and verification

Runtime change: `api/_lib/yahoo.js`, `inspectYahooOptionData`, now requires an actual empty `expirationDates` array and an actual `options` array whose blocks, if any, are explicitly empty and undated before returning `no_options`. Empty/missing/malformed evidence is not interchangeable. No provider architecture, cache schema, economics, identity rule, UI filter, polling, or request graph changed.

Regressions in `tests/yahoo-and-scanner.test.mjs` cover quote-only and partially missing fields, malformed expiration entries, dated empty blocks, hidden contracts in a later block, true empty responses, and explicit-expiry emptiness. A mocked real `/api/options` handler test proves partial data returns 502, genuine empty data returns 200/no-store, accepted full data preserves the entire raw payload, and three handler calls make exactly three chain requests.

- Final targeted checks: **53/53 passed** across yahoo-and-scanner, option-market-integrity, xapp-011-options-navigation, stage6b3-observability-e2e, and canonical-yield-integrity tests. These include trusted-cache preservation and UNKNOWN exact-expiry poisoning prevention.
- Broader `npm test`: **537 passed / 3 failed / 540 total**, run before adding the final handler regression. Failures: `focused-ux-before-stage6a.test.mjs:96` expects an obsolete mobile Delta-source expression; `mobile-design-audit-stage3.test.mjs:28` expects `Import Screenshot` in current Portfolio source; `portfolio.test.mjs:66` expects a zero aggregation to equal an unavailable (`null`) current-value total. These paths do not execute the changed server inspector. They were left untouched.
- `npm run typecheck`, `npm run request:ledger`, targeted ESLint, and `git diff --check` passed (Git emitted existing CRLF conversion warnings).
- Captured-response browser verification: **4/4 passed**, SPY and EQQQ on desktop and portrait. SPY had no page errors, and both actual browser cache records held 116 puts. Screenshots were inspected. The development StrictMode run recorded two identical ticker-detail interceptions per SPY navigation, no extra expiration endpoint; this is not a production request-budget measurement. No runtime request logic changed.
- Configured read-only Explorer traced the client and cache paths. Configured Sol Reviewer independently reviewed the consequential change and found no actionable findings; its initial usage-limit failure was resolved on retry.
- The in-app browser connection was unavailable due to a tool sandbox-metadata error; verification used the existing isolated Playwright harness. Temporary acquisition/test executables were removed after verification; public captures, screenshots, and result logs remain as local evidence.

No commit, push, deployment, production mutation, vendor addition, or Fidelity scraping occurred. Existing unrelated working-tree edits were preserved. Existing client records created by an earlier partial response are not migrated by this server-only correction; an explicit fresh refresh bypasses them, and normal hard TTL also bounds reuse.

## Provider/request implications and missing evidence

The acquisition command initially failed under the filesystem/network sandbox, then Node's default HTTP-header limit rejected Yahoo's response headers. A diagnostic-only `--max-http-header-size=65536` allowed capture. This flag was not added to production code or treated as proof of the deployed application's behavior. The final capture used two upstream attempts for EQQQ (session plus chain) and one for SPY with the shared session; earlier bounded diagnostic attempts are separate. No provider retry loop or fan-out increase was added.

If Yahoo itself lacks the brokerage strikes, practical next steps are a timestamp-aligned manual comparison and, if authorized, a separate provider-coverage evaluation. Manual comparison adds no app requests. One explicit refresh costs the existing bounded chain/detail workflow; it cannot guarantee additional strikes. A second vendor would add integration work, licensing/entitlement questions, per-chain request and possible subscription costs; none was researched or installed in this run.

To resolve the 66-contract discrepancy, provide **the exact ticker and exchange/instrument name, exact expiration, the approximate screenshot time and timezone, and two or three strikes visible in Fidelity but absent in Put Scanner**. Include whether Fidelity was showing puts only, standard or adjusted contracts, and any strike-range filters. The Put Scanner URL and visible count/freshness label will establish requested expiry and cache provenance. A cropped comparison is sufficient; account numbers, balances, positions, and other brokerage-private information are unnecessary.

Root-cause classifications: **EQQQ — actually no options according to Yahoo; confirmed separate defect — availability/state classification bug; SPY — no application truncation; Fidelity discrepancy — unresolved/more evidence needed.** No normalization, cache-truncation, UI-filter, or expiration-propagation regression was established for either live capture.
