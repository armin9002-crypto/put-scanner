# Stage 6B.4 - Portfolio Maintenance, Quote Freshness, and Entry Delta

Implementation date: 2026-08-28

This stage remains within the current Put Scanner product. It adds explicit durable Portfolio maintenance, truthful quote-freshness policy, and a historical Entry Delta snapshot. It does not add a historical Greeks service, polling, scheduled work, rolling, alerts, or new cloud architecture.

## Maintenance audit and boundaries

Before Stage 6B.4, `PortfolioPage` called expiration archival from three unrelated paths:

1. Portfolio mount/date rollover.
2. Add or edit trade completion.
3. Fidelity screenshot import completion.

Those calls could fetch historical prices and durably change lifecycle state without the user entering a maintenance workflow. Entry VIX had a durable historical resolver but no explicit production workflow. Backup/restore and the Fidelity review plan were already explicit durable replacement/edit workflows. Refresh Open Trades was already quote-only and remains so.

Portfolio work is now separated into three classes:

| Class | Examples | Durable revision |
|---|---|---|
| Transient market refresh | Underlying, Bid, Ask, Last, Current Delta, IV, OI, Volume, observation time | No; stored only in device-local `localMarketData` |
| Durable user edit | Add/edit/delete, notes, manual Entry Delta, explicit close/archive, import/restore | Yes, after successful validation and storage |
| Durable maintenance | Expiration resolution, historical Entry VIX, recovery of an actually stored entry-snapshot Delta | Yes, only after an explicit maintenance action |

Portfolio mount, route navigation, Maintenance panel open, hover, intervals, Refresh Open Trades, and backup import completion perform no automatic maintenance request or maintenance write. The Fidelity import review can still apply lifecycle statuses the user explicitly selects in that review.

## Portfolio Maintenance workflow

The existing Portfolio action area now opens a compact **Portfolio Maintenance** dialog. Its first assessment is local and read-only. It reports:

- open positions definitively past expiration;
- expiration-price-pending history;
- positions missing Entry VIX;
- missing Entry Delta values recoverable from a durable `entrySnapshot.delta`;
- historical Entry Delta blanks with no trustworthy source.

Explicit actions are:

- **Resolve Lifecycle**: obtains cached or bounded historical expiration closes, applies established worthless/ITM formulas, and uses the existing `updatedAt` conflict guard before writing.
- **Backfill Entry VIX**: resolves a single historical date range for all missing entry dates when local history is insufficient, then uses the same conflict guard.
- **Recover Stored Delta**: copies only a valid Delta that already exists in the durable entry snapshot. It performs zero market requests.

An unavailable legacy Entry Delta is informational, not an error. The dialog never offers a current-data historical Delta backfill.

## Entry Delta durable contract

`PortfolioTrade` adds three backward-compatible optional fields:

```ts
entryDelta?: number
entryDeltaSource?: 'provider' | 'calculated' | 'manual' | 'imported' | 'stored_snapshot'
entryDeltaCapturedAt?: string
```

**Entry Delta** means a put Delta observed or validly calculated for the exact ticker, put, strike, and expiration at or near the trade's entry. It uses the application's signed put convention and must be finite in `[-1, 0]`. Invalid values are rejected rather than clamped.

Provenance meanings:

- `provider`: a valid contemporaneous exact-contract provider Delta;
- `calculated`: the Stage 6B.1 canonical Black-Scholes fallback with all contemporaneous required inputs;
- `manual`: an explicit broker value entered or corrected by the user;
- `imported`: a valid Entry Delta explicitly present in imported JSON without richer source metadata;
- `stored_snapshot`: a valid Delta recovered from the trade's already-durable entry snapshot.

The optional timestamp records when an automatic/manual value was captured. A stored-snapshot recovery uses the trade creation timestamp because the snapshot was durably created with that trade. Source metadata is omitted entirely when Entry Delta is absent.

### Capture policy

Automatic capture is eligible only when `soldDate` equals the current U.S. market date in `America/New_York`, the position is open, and exact-contract data is contemporaneous and not a stale fallback.

- Add from an already-loaded option detail: zero additional browser/function/provider requests. The loaded exact chain is reused.
- Same-day manual Add Trade: save succeeds first. If Entry Delta is still blank, the app performs at most one cache-first exact-chain acquisition; cached data costs zero network requests. Failure leaves the valid trade saved with Entry Delta unavailable.
- Same-day Fidelity import: each genuinely new, same-day exact contract is eligible for the same bounded cache-first capture. Shared chain acquisition deduplication is retained.
- Historical manual/OCR trade: current Delta is ineligible.
- JSON backup import: preserves a valid Entry Delta if present and performs no lookup if absent.

Provider Delta is preferred. The calculated fallback requires valid positive underlying, strike, DTE, and IV plus a finite risk-free rate. The retired 80% IV and fabricated `-0.5` fallbacks are never used.

### Existing-position backfill

The audit found one genuinely recoverable class: existing trades with a finite `entrySnapshot.delta` in `[-1, 0]`. That is an actual stored entry-time Delta. It can be recovered only through the explicit zero-request maintenance action.

Entry snapshots may also contain underlying and IV, but no historical risk-free-rate snapshot. Therefore Stage 6B.4 does not claim that all inputs required for a historical recalculation are durably present. Current provider Delta, current IV, and current underlying are prohibited from legacy Entry Delta recovery.

## Compatibility, backup, and cloud

Portfolio durable schema version remains **1** and backup format remains **2**. No bump is needed because the new fields are optional, v1 validation already supports backward-compatible optional properties, and no transformation of legacy economics is required.

Normalization deliberately omits the fields rather than materializing `null` or `undefined`. Tests prove that reading and rewriting a canonical legacy portfolio produces no storage write, revision change, `updatedAt` change, or fingerprint churn.

New backup/export retains Entry Delta and provenance. Old backups import with the fields absent. Fidelity OCR does not supply Delta and never fabricates it. Entry Delta remains on close/archive and participates automatically in canonical Portfolio serialization, sync fingerprints, cloud push/pull, conflict comparison, Keep This Device, Use Account Copy, and conflict recovery. `latestMarketData` remains device-local and excluded.

## Quote freshness policy

Portfolio now distinguishes a market-data observation from the provider's last option trade:

- `latestMarketData.refreshedAt`: when Put Scanner observed the returned market data;
- `lastTradeDate`: the provider's last option trade time, which can be old even when a current Bid/Ask was observed;
- provider quote/underlying timestamp: not available in the current normalized Portfolio response;
- cache metadata: used during acquisition but not persisted as a durable trade fact.

The canonical Portfolio helper returns:

| State | Policy |
|---|---|
| Fresh | Observed in the current U.S. market date, or across a weekend/non-trading gap with zero elapsed weekday sessions |
| Aging | One weekday market session has elapsed |
| Stale | Two or more weekday sessions elapsed, or refresh returned failure/stale fallback |
| Unavailable | No usable current observation, imported-only snapshot, unavailable contract, or expired contract |

This intentionally uses a conservative weekday-session approximation rather than claiming exchange-calendar precision. Friday data remains Fresh on Saturday/Sunday and becomes Aging on Monday. Holidays are not modeled.

A current observation with an old `lastTradeDate` remains a current observation; the old trade age remains separately available for display/diagnostics. The app does not mislabel last-trade time as provider quote time.

### Portfolio decisions

- Fresh and Aging observations remain eligible for existing quote-dependent formulas.
- Stale and Unavailable observations gate distance/Delta components from the attention score and appear as **Needs fresh quote** rather than a high-confidence risk tier.
- Stale and Unavailable observations cannot become Close Candidates.
- Existing thresholds and mark-basis formulas are unchanged.
- A compact Portfolio summary reports how many open positions need fresh market data.

## Display

Open positions show **Entry Delta** and **Current Delta** distinctly. The desktop schedule uses one compact `Entry / Current Delta` column (sorting still uses Current Delta), including a quiet Fresh/Aging/Stale/Unavailable label. Mobile cards label both values separately. Entry Delta provenance is available in the Entry Delta detail tooltip. Closed/expired history retains and displays Entry Delta while Current Delta is not treated as historical truth.

## Network and observability impact

The Stage 6B.3 request-observation path is reused; no new logger or endpoint exists.

| Workflow | Expected browser/function/acquisition | Cold ceiling | Notes |
|---|---:|---:|---|
| Add from loaded detail | `0 / 0 / 0` | zero | Exact chain already loaded |
| Same-day manual/OCR Entry Delta capture | `0 / 0 / 0` cached | `1 / 1 / 1` | One cache-first exact chain; never historical bulk fetch |
| Explicit Entry VIX maintenance | `1 / 1 / 1` | `1 / 1 / 1` | One date-range chart request; local history may reduce to zero |
| Explicit lifecycle maintenance, representative one ticker/expiration | `1 / 1 / 1` | `1 / 1 / 1` | Rich local history may reduce to zero |
| Recover stored Entry Delta | `0 / 0 / 0` | zero | Local durable snapshot only |

Multi-position lifecycle work remains bounded by unique ticker/expiration history requirements with concurrency three. No historical Entry Delta bulk request exists.

## Remaining limitations

- The current provider path does not expose a normalized Bid/Ask quote timestamp or underlying timestamp, so freshness is observation-based and plainly labeled as such.
- The weekday-session approximation does not model exchange holidays or exceptional closures.
- Historical Entry Delta cannot be reconstructed when no actual Delta was stored and complete historical model inputs were not durably captured.
- A manual/OCR same-day enrichment can require one asynchronous second durable write after the trade itself is safely saved.
- Browser abort cannot guarantee that an already-sent server/provider request stops immediately.
