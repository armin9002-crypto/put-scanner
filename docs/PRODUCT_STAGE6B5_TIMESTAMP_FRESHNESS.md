# Stage 6B.5 — Provider Timestamp Provenance and Holiday-Aware Portfolio Freshness

## Scope

This stage makes the time behind a quote explicit and makes Portfolio freshness count U.S. equity trading sessions. It does not add requests, change cache TTLs, change Entry Delta, or persist market observations as account data.

## Provider timestamp audit

| Surface | Field | Meaning and reliability | Canonical treatment |
| --- | --- | --- | --- |
| Yahoo option chain | `result.quote.regularMarketTime` | Optional Unix seconds for the underlying's provider market event; not a contract quote timestamp | `providerMarketAt` / `providerMarketTime` |
| Yahoo option contract | `lastTradeDate` | Optional Unix seconds for that contract's last trade; can be old and is independent of bid/ask freshness | `lastTradeAt` / existing `lastTradeDate` |
| Yahoo chart and spark | `result.meta.regularMarketTime` | Optional Unix seconds for the underlying's provider market event | `providerMarketTime` on price, batch-price, extended-price, and chart-history responses |
| Yahoo chart candles | `timestamp` | Unix-second candle/event time for historical points | Normalized historical point timestamp; not used as a current Portfolio quote timestamp |
| Put Scanner option adapter | `chainMeta.fetchedAt` | Application observation time in milliseconds | `observedAt` |
| Put Scanner Portfolio refresh | `latestMarketData.refreshedAt` | Browser observation time in ISO format | `observedAt` |
| Market-data broker | cache record `fetchedAt` | Time the network result was stored, not the time a cache read occurred | Cache provenance only; never promotes an old quote to fresh |
| API/request diagnostics | response duration and correlation metadata | Server timing/transport metadata; no market-event timestamp is exposed | Kept diagnostic-only; not used as quote freshness |

Yahoo does not reliably expose a per-contract Bid/Ask observation timestamp. The app therefore does not claim one and leaves `providerQuoteAt` absent unless a future provider supplies a trustworthy field.

## Canonical timestamp model

`src/lib/marketTimestamp.ts` accepts seconds, milliseconds, numeric strings, ISO strings, and `Date` values. It rejects null, zero, malformed, non-finite, pre-2000, and implausibly future values (more than five minutes ahead of the supplied clock). The model contains `observedAt`, `providerQuoteAt`, `providerMarketAt`, `lastTradeAt`, `cachedAt`, and a source enum. Provider quote time wins, then provider market time, then application observation time. Cache time is diagnostic provenance only.

Malformed or future provider values fail closed and freshness falls back to a valid observation time. There is no fabricated precision: a provider market event is not relabeled as a bid/ask event, and a last-trade timestamp is not used as quote freshness.

## Portfolio freshness policy

The existing `Fresh`, `Aging`, `Stale`, and `Unavailable` states and thresholds remain unchanged: same-session data is Fresh, one trading session old is Aging, and two or more sessions old is Stale. Existing `Needs Attention` and `Close Candidates` policy gates continue to use only Fresh/Aging quote data. Old `lastTradeDate` remains visible and independently reported; it does not make an otherwise current quote stale.

Freshness uses provider market/quote event time when valid, otherwise `refreshedAt` observation time. A cache read updates neither value. Missing market inputs, missing observation/provider time, imported snapshots, expired positions, and unavailable data remain Unavailable; failed or stale fallback refreshes remain Stale.

The UI remains quiet and explains provenance in the existing freshness detail: provider market event time when available, otherwise when Put Scanner observed the data. Options detail copy says `Observed` rather than implying that cache-read time is a provider quote time.

## Local U.S. equity calendar

`src/lib/usMarketCalendar.ts` is deterministic and dependency-free. It excludes weekends and the NYSE/Nasdaq-style full-day closures for:

- observed New Year's Day, Independence Day, and Christmas;
- Martin Luther King Jr. Day, Presidents Day, Memorial Day, Labor Day, and Thanksgiving;
- Good Friday;
- Juneteenth beginning with the 2022 regular closure.

Observed Saturday holidays use Friday and observed Sunday holidays use Monday, including the New Year's boundary between adjacent years. Early closes are intentionally not modeled; session counting is therefore conservative and date/session based. Pre-open and after-close times use the local New York market date, so overnight/weekend/holiday periods do not manufacture extra aging transitions. DST is handled by the time-zone date conversion rather than fixed local offsets.

## Surfaces and operational boundaries

Underlying timestamps now travel through Portfolio refresh, Watchlist/Options chain metadata, Ticker Detail price data, Scanner batch prices, Screener acquisition data, and ETF Pulse/chart history where those provider fields exist. No new Yahoo/Supabase/network request is introduced. Timestamp fields in `latestMarketData` remain transient local state and are excluded from durable cloud payloads, backups, and revisions. Request observability remains correlation/count-only and never logs account, quote, or raw market payloads.

## Verification

Deterministic Stage 6B.5 tests cover seconds/milliseconds/ISO normalization, malformed/zero/future values, provider precedence and observation fallback, cache-old data, independent old last trade, overnight/weekend behavior, Good Friday, Memorial Day, observed Independence Day, Thanksgiving, Christmas, New Year's observed boundary, Juneteenth, multiple years, and DST date boundaries. Existing Entry Delta semantics and all Stage 2–5 cloud/ledger protections are regression-tested unchanged.

## Known limitation and next stage decision

The calendar intentionally does not model exchange early closes, half-days, or an authenticated per-contract quote timestamp because Yahoo does not provide those reliably. A follow-up reliability stage is warranted only if the product needs half-day-aware intraday policy or a provider with contract-level quote-event provenance; neither is required for this stage's conservative portfolio decisions.
