# Canonical Option Market Integrity

Option-chain retrieval now has four separate concepts:

1. **Retrieval provenance/freshness** records network or cache source, `fetchedAt`, cache age, and stale fallback. It says when Put Scanner obtained the payload, not when an option quote was executable.
2. **Transaction recency** comes from an exact contract's last-trade timestamp and the canonical U.S. trading-session calendar.
3. **Structural validity** verifies ticker/expiration/contract identity and that the provider response is usable.
4. **Surface integrity** assesses normalized same-expiration puts as `clean`, `degraded`, or `invalid` before any consumer calculates trusted economics.

Raw provider Bid, Ask, Last, IV, Delta, volume, open interest, and raw normalization fields remain unchanged and auditable. Integrity is compact derived metadata on the contract and chain.

Hard invalid conditions are a materially crossed same-contract market, lower-strike Bid above a higher-strike Ask, a put-vertical executable value above its strike width, and existing structural identity/expiration contradictions. Very wide markets are a soft degraded signal. The assessment sorts once and uses suffix/prefix envelopes, so each expiration costs `O(n log n) + O(n)` and stores no pairwise graph.

Contract-local failures do not remove the chain or ETF. Options and detail views show the raw quote with a compact warning while executable yields are unavailable. Screener rows remain represented but cannot pass quote-yield filters. Scanner excludes invalid contracts from IV and liquidity evidence without changing expiration availability. Recommendations consume the same metadata; Phase A does not change verdict or ranking policy for clean inputs.

Cache admission requires structural validity and a non-invalid chain summary. A materially invalid fresh chain cannot replace a trusted cached chain. Localized degraded chains remain admissible so healthy strikes stay usable. Watchlist and Portfolio exact-contract refreshes retain a prior trusted quote and its original observation timestamp when the new contract is invalid, record the failed refresh separately, and mark it degraded/stale. With no trusted prior quote, current economics remain unavailable. New trades may still be saved, but invalid exact-contract Delta/IV is never captured as durable entry history.

The assessment reuses already acquired chains and creates no requests, retries, polling, provider calls, or new endpoints.
