# Underlying Universe Architecture

Stage 6A decision: use a layered, local-first universe with explicit market-data acquisition. Do not build a market crawler or a ticker-metadata database.

## Goals and non-goals

The universe architecture must let leveraged ETFs, normal ETFs, stocks, and context indices coexist without making them behave identically. It must preserve the current 42-symbol product exactly while enabling later on-demand stock analysis. It must also keep request cost proportional to an explicit user action, not to the number of optionable U.S. securities.

It is not responsible for:

- proving optionability forever;
- storing transient quotes/chains/history;
- discovering every listed security;
- running scheduled scans;
- selecting trades or scoring suitability;
- replacing specialized mappings such as leveraged benchmark proxies.

## Layered model

### 1. Core curated universe

A small reviewed list that the product can name, categorize, and expose in Scanner/Screener. Recommended public-MVP size: **35–50 symbols**, not counting context indices.

Suggested composition, subject to actual option-liquidity validation when Stage 6B begins:

- 5–8 broad-market/index ETFs;
- 8–12 sector/style/commodity ETFs;
- 12–20 of the most useful/liquid current leveraged ETFs;
- 8–15 very liquid, commonly owned large-cap stocks.

The current product remains at 42 leveraged ETFs in Stage 6A. No visible membership changed. The future recommendation is not “42 plus everything”; it is a deliberately re-reviewed core where each member has a reason to exist and acceptable option liquidity.

Core metadata should remain a version-controlled typed local registry initially. Benefits: zero runtime database dependency, reviewable changes, stable server/browser imports, deterministic chunk/cache keys, and straightforward tests. A backend-managed catalog becomes justified only when non-engineers must edit it frequently, memberships are personalized at scale, or provider/licensing rules require dynamic entitlements.

### 2. User universe

User-owned symbols come from two independent durable concepts:

- saved underlyings (“willing to own/watch”); future schema;
- tickers already referenced by saved contracts and Portfolio trades; existing schemas.

Membership must not trigger option-chain refresh by itself. Cheap underlying quotes can be batched after an explicit view/refresh. Contract refresh remains deduplicated by ticker/expiration. User symbols should not silently become global curated metadata or join Pulse.

### 3. On-demand universe

An explicit Analyze Ticker submit accepts a normalized ticker and attempts a bounded detail acquisition. Successful analysis is cached through the existing market-data broker but does not mutate the registry. Unknown/invalid/non-optionable/provider-unavailable are separate states.

The on-demand path should perform:

1. normalize and syntactically validate the ticker;
2. use local metadata when known;
3. fetch one underlying/detail payload on explicit submit;
4. infer only provider-confirmed runtime fields such as display name and quote type;
5. show asset-specific modules only when supported;
6. optionally let the user save the underlying or a contract.

This produces O(1) ticker-analysis cost and avoids broad crawling.

## Implemented Stage 6A symbol model

`shared/symbolRegistry.js` plus `shared/symbolRegistry.d.ts` is now authoritative for identity and universe membership.

```ts
type AssetType = 'etf' | 'stock' | 'index';
type SymbolUniverse = 'scanner' | 'screener' | 'pulse' | 'context';

interface SymbolMetadata {
  ticker: string;
  aliases: readonly string[];
  name: string;
  assetType: AssetType;
  etfCategory?: 'Broad Index' | 'Sector' | 'Commodity' | 'Country';
  exposure?: string;
  leveraged: boolean;
  leverageMultiple: number | null;
  universeMembership: readonly SymbolUniverse[];
}
```

Every field has a current use:

- `ticker`, `aliases`, `name`: display and normalized selection, including VIX/VXN aliases;
- `assetType`: future stock/ETF/index conditional behavior;
- `etfCategory`, `exposure`: current Scanner/Pulse filtering and copy;
- `leveraged`, `leverageMultiple`: current adapter and future leverage-specific modules;
- `universeMembership`: derives the current Scanner, Screener, Pulse, and context lists.

Fields intentionally omitted: sector, industry, market cap, liquidity tier, optionability, earnings date, and provider identifiers. There is no reliable current consumer for these fields, and static values would become stale or create false confidence. Add a field only with an owned source, refresh rule, consumer, and fallback.

### Compatibility adapters

- `src/lib/etfs.ts` derives legacy `ETFInfo[]` for current UI code and exposes a normalized `getScannerEtf` selector.
- `shared/screenerUniverse.js` derives fixed chunk tickers.
- `shared/etfPulseUniverse.js` derives Pulse tickers.
- `src/lib/etfPulseData.ts` derives `ETFInfo` view models, including SPY/QQQ, without duplicate metadata.
- `src/lib/instrumentNames.ts` resolves registry names and index aliases.
- Scanner price/assets acquisition derives from `ETF_LIST`; the former duplicated string was removed.

The registry contains 46 canonical entries: 42 current leveraged discovery ETFs, normal ETFs SPY/QQQ already used by Pulse/context, and context indices `^VIX`/`^VXN`. It includes no stock yet because Stage 6A does not expand the product.

## What remains separate

Identity metadata and financial behavior are different concerns.

- `underlyingHoldingsProxies.ts` should remain a specialized leveraged-product map. The future selector must first inspect `assetType`; a stock should never receive “Direct ETF holdings.”
- Portfolio category/leverage/theme buckets may consume the registry but still need an explicit “unknown/normal stock” policy.
- Pulse membership is a costly history dataset, not simply another tag to assign broadly.
- Screener chunk membership is a request/cache strategy; on-demand symbols should not be forced into a global fixed chunk.
- Optionability and liquidity must be provider-observed/fresh, not permanent booleans in source control.

## Recommended acquisition rules

| Layer/action | Underlying quote | Option chains | History/Pulse | Refresh policy |
|---|---:|---:|---:|---|
| Core Scanner mount | One batched quote request for ≤50. | None automatically. | Only four context intraday charts; cached option snapshots display if present. | Cache-first; explicit refresh. |
| Scanner snapshot update | Already cached quote. | Up to two per visible stale ticker. | None. | Explicit, visible-only, concurrency 3. |
| Core Screener | Optional quote in returned chain. | One or two expirations per selected ticker. | At most one IV/realized-vol history per selected ticker. | Explicit Load, limits, stable cache keys. |
| Saved underlying list | One batched quote request for visible/explicitly refreshed symbols. | None. | None by default. | Cache-first, no polling. |
| Saved contracts | One batched quote plus one unique chain key. | Unique ticker/expiry only. | None. | Current cache-first mount; consider visible/freshness cap. |
| Analyze Ticker | One detail/extended quote. | Initial/exact chain only. | Current chart/IV context; leveraged proxy only if registry says so. | Explicit submit. |
| Portfolio | One quote batch plus unique open chain keys. | Current open ticker/expiry keys. | VIX/expiration history only when required. | Explicit refresh except immutable lifecycle resolution. |
| Pulse | None beyond its dataset. | None. | One history per deliberately small member. | 6h client cache/1h CDN; never expand automatically. |

## Screener architecture beyond fixed curated chunks

Keep current fixed chunks for the legacy 42 while they remain cache-efficient. Add a separate exact-symbol batch route for user/core symbols that are not part of those chunks. A request should contain a server-validated maximum list and a structural expiry selector; the server canonicalizes, deduplicates, sorts for a stable cache key, enforces membership/limits, and applies existing concurrency/circuit/size guards.

Recommended first caps:

- no more than 50 symbols per user action;
- no more than two chain expirations per symbol;
- client runs at most two batch functions concurrently;
- server runs at most three Yahoo operations concurrently;
- batch payload retains the 750 KB guard;
- explicit confirmation and cost estimate over 20 symbols;
- partial results remain usable and retry targets only failures.

Do not send arbitrary user-provided provider URLs or accept unlimited query-string ticker lists.

## Universe-size stress test

Assumptions: Scanner fetches cheap quotes in 20-symbol provider chunks; Pulse would require one history per member; contract scanning needs one initial chain plus up to one additional chain and one volatility-history request per symbol. Real attempts vary because an initial chain may already match the target and caches/CDN may satisfy calls.

| Universe | Quote-only Scanner cold provider calls | Contract scan rough cold provider attempts | Assessment |
|---:|---:|---:|---|
| 25 | ~2 quote chunks | ~50–75 | Comfortable when explicit; good curated MVP size. |
| 50 | ~3 | ~100–150 | Recommended upper automatic quote universe; contract scan must be explicit/capped. |
| 100 | ~5 | ~200–300 | Quote overview acceptable, but UI relevance and per-user full scans become uncomfortable. Use subsets/presets. |
| 250 | ~13 | ~500–750 | Do not auto-scan chains or histories. Quote-only search could work with pagination/backend datasets, but not the current product shape. |
| 500 | ~25 | ~1,000–1,500 | Outside lightweight per-user scanning; requires vendor bulk data/indexing and quotas. |
| 1,000 | ~50 | ~2,000–3,000 | Full-market platform territory; violates constraints and Yahoo reliability assumptions. |

A 50-symbol quote list does not imply a 50-symbol option scan. Those actions need separate budgets and user intent. Likewise, Pulse at 100 symbols would double its current provider fan-out and should not be tied to registry growth.

## 1 / 100 / 1,000-user implications

For a typical user who launches Scanner, analyzes two tickers, changes one expiry, refreshes a 10-contract/6-unique-chain portfolio, and performs one 10-symbol Screener load:

- **one user, cold:** roughly 6 Scanner Vercel calls + 6 detail/analysis calls + 1 expiry + 7 portfolio calls + 4–10 Screener batch calls depending chunk distribution. Provider work can reach dozens; browser/provider caches reduce repeats.
- **100 users:** browser calls scale linearly, but stable Vercel CDN keys can collapse Scanner/context and common curated Screener/provider work. User-specific portfolio chains and random Analyze Ticker requests do not collapse as well.
- **1,000 users:** simultaneous bursts, high-cardinality tickers/expiries, and Yahoo degradation dominate. Limits, jitter/explicit actions, hit-rate/upstream telemetry, and a licensed provider become operational requirements. Supabase durable startup remains about one select per enrolled session and is not the main market-data bottleneck.

Avoid multiplying costs by never performing these automatically:

- all-core option chains at launch;
- history for every curated/user symbol;
- portfolio polling;
- Watchlist underlying plus contract refresh plus Pulse membership for the same symbol without separate user actions;
- recurring server-side scans or cron.

## Metadata lifecycle and governance

For each proposed core symbol, record in code review:

1. intended audience/job;
2. asset type and canonical display name;
3. option-liquidity evidence and date checked;
4. category/exposure used by the UI;
5. whether leverage/proxy/holdings logic applies;
6. exact universe memberships and their request cost;
7. removal/deprecation behavior for delisted or renamed symbols.

Registry edits should have tests for canonical uniqueness, alias collisions, sorted membership, UI adapter parity, fixed chunk coverage, and Pulse dataset parity. Dynamic runtime data should never be committed as if permanent.

## Failure and safety model

- Unknown symbol: show a neutral Analyze Ticker validation state; make no ETF assumptions.
- Provider says invalid/non-optionable: preserve prior user state and explain the distinction.
- Partial chain/history failure: preserve successful rows and stale usable data with freshness markers.
- Metadata missing: render generic symbol identity; hide ETF holdings/leverage modules.
- Delisted/renamed core member: remove from new discovery only after preserving historical Watchlist/Portfolio rendering by ticker fallback.
- Request limit exceeded: reject before provider calls and present a smaller explicit selection.

## Stage boundaries

- Stage 6A completed registry centralization and tests only.
- Stage 6B should implement Analyze Ticker, initial curated normal ETF/stock categories, generic detail behavior, metric naming, and saved-underlying data design without full-market scan.
- Stage 6C can add reliable event context and explicit comparison/presets, then design bounded roll economics.
- Stage 6D can harden paid-user operations, quotas/observability/provider strategy, and management workflows.
