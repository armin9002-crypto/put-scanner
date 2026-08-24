# Supabase Stage 5 local-first sync design

Status: Stage 5C.4 successfully exercised the gated production lifecycle and then returned the production flag to false. Stage 5D.1 hardens final rollout behavior and adds the purpose-built mobile Account presentation. Ongoing synchronization remains off and Stage 5D.1 does not authorize deployment or permanent activation.

Stage 4C Account Data remains the explicit first-save and new-browser restore surface. Restore and ongoing-sync enrollment stay separate; signing in never chooses a winner or uploads browser data. The complete rollout guide is [Supabase Stage 5D production rollout](./SUPABASE_STAGE5D_ROLLOUT.md).

## Boundaries

The three cloud namespaces remain exactly `portfolio`, `watchlist`, and `preferences`. Portfolio includes open positions and history. There is no history row or namespace, trade-per-row model, market-data namespace, cache namespace, DELETE operation, upsert, merge engine, Realtime subscription, polling loop, Vercel function, SQL migration, or RLS/schema change.

Only canonical Stage 1.5 durable documents can be fingerprinted or transported. Current quotes, Bid/Ask/Last, IV, OI, Volume, underlying snapshots, Yahoo data, option chains, charts, Scanner/ETF Pulse caches, diagnostics, routes, modal state, debug flags, auth tokens, and device-local market maps are excluded.

Cloud transport, durable local storage, mutation signals, reconciliation, queues, device metadata, authentication, and UI remain separate. In particular, `AuthProvider` contains no synchronization logic.

## Account presentation and coordinator ownership

`CloudSyncProvider` remains above routes and Account UI, inside Auth ownership. Account open/close state is presentation-only and cannot construct, attach, detach, reconcile, or dispose synchronization. Route changes and phone rotation likewise do not control the coordinator.

Desktop retains its existing Account dialog. Phone portrait and semantic phone landscape use `MobileAccountSheet`, portaled to `document.body` so the fixed overlay escapes the sticky blurred header's containing block and stacking context. The sheet uses viewport-level stacking above mobile navigation, `100dvh`, safe-area padding, one scroll region, focus trapping/restoration, Escape and close controls, and iOS-safe body scroll locking.

Mobile and desktop share the same Auth, Account Data, backup, restore, enrollment, Sync Now, and sign-out actions. Only presentation and mobile information order differ. The development Account UI fixture contains no transport and is excluded from production assets alongside the Stage 4B/5B harnesses.

## Local-first mutation flow

The feature-enabled production flow is:

```text
user action
  -> existing React state update
  -> existing validated local durable write
  -> namespace-only durable mutation event
  -> independent debounced namespace queue
  -> asynchronous Supabase CAS update
```

The local write completes before any cloud work. A listener exception cannot make that completed write fail. Cloud downtime never rolls a valid local edit back.

Portfolio and Watchlist emit only when their canonical durable data changed; quote-only/local-market refreshes do not emit. Portable preference writers compare the stored value before emitting. Events contain only `portfolio`, `watchlist`, or `preferences`—never payloads, financial facts, user IDs, URLs, or auth data.

The explicit JSON importer emits each changed namespace once, and only after its existing multi-key transaction succeeds. A failed import that rolls back emits nothing. Controlled cloud pulls write and verify locally without emitting an upload echo.

When the production feature flag is off, the application excludes the coordinator and attaches no listener. When the flag is on, only an explicitly enrolled, authenticated device attaches the listener after safe startup reconciliation. Importing the event emitter from existing writers still creates no cloud work by itself.

## Device association and enablement

Signing in is not device association. The separate ongoing-sync metadata key is `put_scanner_cloud_sync_engine:v1`. A separate key preserves the strict Stage 4 migration-metadata contract and avoids silently rewriting already verified Stage 4C metadata.

A device can become `eligible` only through an explicit pure eligibility operation that proves all of the following:

- the authenticated user matches Stage 4 device metadata;
- Stage 4 reports `migration_verified` from a successful Local → Cloud migration or explicit Cloud → Local restore;
- all three known revisions match the verified cloud rows;
- Stage 4 local mutation markers still match;
- local and cloud canonical fingerprints match for all namespaces; and
- every last-synced timestamp exists.

Eligibility still does not enable anything. A second explicit transition produces `enabled` metadata. Stage 5C.1 exposes that transition only through **Enable Sync on This Device**, after a fresh inventory/equality verification; the action performs no data-changing cloud write.

The ongoing metadata stores only the account ID, sync mode, per-namespace cloud revision, last-synced fingerprint/time, current status, optional pending fingerprint, and last reconciliation time. It stores no raw Portfolio/Watchlist/Preferences document and no token. Like Stage 4 metadata, it is device-local and excluded from JSON backups.

### Previously enabled development-device resume

Stage 5B.1 treats first enablement and runtime resume as different operations. First-time eligibility remains the strict Stage 4 verified-state proof above. A device that already has valid `enabled` ongoing-sync metadata must not be sent through that proof again, because another device may have legitimately advanced cloud state while this device was closed.

The development-only resume assessment requires the exact DEV/flag/email allow-list, a valid disposable local fixture, valid versioned metadata owned by the authenticated user, `enabled` sync mode, and a complete known revision/fingerprint/time baseline for every namespace. Resume then performs a fresh cloud safety read and requires all three current rows to remain the disposable fixture. It never reconstructs the baseline from current cloud.

After those checks, the operator's explicit **Resume Test Sync** action constructs the real coordinator and attaches the durable mutation listener exactly once. Construction and attachment perform no CAS, pull, or reconciliation write. The device reports **Enabled / awaiting reconciliation** until the operator deliberately invokes **Sync Now**, which applies the unchanged `CLEAN`, `LOCAL_AHEAD`, `CLOUD_AHEAD`, and `BOTH_CHANGED` rules against the persisted baseline.

In Stage 5B the coordinator is intentionally stored in a Sync Test Harness component-local ref. Closing Account, unmounting the harness, or reloading the page disposes that runtime owner while durable local state and metadata survive; explicit resume makes this safe for the test stage. Stage 5C production architecture must instead own the ongoing coordinator above the Account modal/component lifecycle so closing Account does not disable synchronization. Stage 5B.1 does not implement or authorize that production activation.

## Canonical fingerprints

`syncFingerprint.ts` hashes the canonical serialization of exactly `{ schemaVersion, payload }` with deterministic 64-bit FNV-1a. The fingerprint format is `fnv1a64:` plus 16 lowercase hexadecimal characters.

The existing Stage 4 canonical serializer recursively sorts object keys, retains array order and JSON value types, and omits undefined object properties using JSON semantics. Inputs first pass through the Stage 1.5 migration/normalization functions. Therefore property insertion order and legacy representation differences do not create false changes, while durable Portfolio/history, Watchlist, or Preferences changes do.

FNV-1a is a compact change detector, not an authentication or cryptographic integrity mechanism. Payload validation, ownership checks, RLS, revisions, and exact returned-payload verification remain the safety controls.

### Stage 5C.3 enrollment-baseline semantics

Stage 4’s `lastSyncedLocalUpdatedAt` was originally a conservative migration-time signal that the local storage envelope had not changed since verification. It is not a canonical account fact. A local-only market-data rewrite or storage-envelope normalization can change bookkeeping while leaving the exact cloud document unchanged.

Production enrollment therefore uses the safety properties that enforce the no-overwrite invariant directly: matching authenticated ownership, valid verified Stage 4 metadata, complete supported cloud rows, cloud revisions equal to the verified revisions, non-null verified sync timestamps, and fresh equality of canonical local/cloud fingerprints. Harmless envelope timestamp drift is accepted. Canonical local divergence, a different cloud revision, wrong owner, corrupt metadata, or invalid/partial state still blocks.

Portfolio’s state contract is explicit: `latestMarketData` contains current underlying/option marks, last-trade time, IV, delta, Volume/OI, display DTE, availability, and refresh time. It remains device-local and is excluded from fingerprints. `PortfolioTrade.updatedAt` changes only for durable trade/user/lifecycle data. Entry VIX remains durable history but is no longer backfilled by passive mount; explicit Refresh Open Trades may enrich it and reports that durable activity. Expiration resolution remains a genuine durable transition.

## Namespace queues and coalescing

There is one queue each for Portfolio, Watchlist, and Preferences. Unrelated namespaces can run concurrently, while one namespace permits at most one cloud update in flight.

The default cloud-only debounce is 1,000 ms. This is long enough to coalesce common bursts of trade edits and preference toggles without delaying any local write. An explicit per-namespace flush and the coordinator's `syncNow()` operation bypass the timer. Correctness never depends on unload, beacon, polling, or a focus handler.

If local A uploads while local B is created, A may finish at revision N+1. The response records only A's fingerprint. The coordinator re-reads the current local fingerprint; when it sees B, it marks the namespace pending and immediately drains the latest state using N+1. It never sends B with A's stale expected revision.

## CAS and verified success

Pushes use the existing `updateNamespaceIfRevisionMatches()` operation:

```text
known revision N
  -> UPDATE user/account namespace WHERE revision = N
  -> database trigger advances to N+1
  -> validate one returned row, ownership, schema, revision N+1, and payload
  -> compare returned canonical fingerprint with the intended local fingerprint
  -> only then persist N+1, last-synced fingerprint, and last-synced time
```

Zero returned rows is a conflict. It is not retried with a newer revision. There is no fetch-then-overwrite fallback, upsert, DELETE, automatic merge, timestamp winner, or Last Write Wins.

A generation token binds each operation to the current in-memory account/session. Sign-out, session loss, or account change increments the generation. A late response may not change metadata for the stale generation. Local data is never cleared.

## Offline and retry behavior

Only `network_error` writes use automatic retries. One initial attempt may be followed by two retries after 250 ms and 1,000 ms. The intended document and expected revision remain fixed throughout that bounded sequence.

When attempts are exhausted, local data remains intact, cloud revision metadata does not advance, and the latest local fingerprint remains pending with `offline` status. There is no retry timer after exhaustion. A later durable mutation, explicit flush/Sync Now, or future safe session reconciliation may begin a new bounded sequence. Conflicts, permission failures, invalid responses, and verification failures are never treated as transient network errors.

## Reconciliation

The pure per-namespace reconciler accepts current local fingerprint, last-synced fingerprint, known cloud revision, current cloud revision/fingerprint, cloud presence/validity, and account identity.

| Classification | Meaning | Permitted action |
| --- | --- | --- |
| `CLEAN` | Local equals baseline; cloud revision and fingerprint equal baseline | None |
| `LOCAL_AHEAD` | Local changed; cloud remains at the known revision and baseline payload | CAS push candidate |
| `CLOUD_AHEAD` | Local equals baseline; cloud revision advanced | Safe pull candidate |
| `BOTH_CHANGED` | Local changed and cloud revision advanced | Conflict; choose no winner |
| `CLOUD_MISSING` | A previously synchronized row disappeared | Attention; never recreate automatically |
| `INVALID` | Corrupt state, missing metadata, backward revision, or payload changed without revision | Attention |
| `ACCOUNT_MISMATCH` | Authenticated user differs from device metadata | Hard block |

Stage 5C.1 runs one session-restoration reconciliation only for an already enabled device and only when the exact production feature flag is true. A new or unassociated browser performs no startup `user_state` read and remains on the explicit Stage 4C “Restore to This Browser” plus enrollment flow. There is no reconciliation on focus, visibility, route change, hover, resize, or an interval.

## Safe cloud-ahead pull

A cloud pull is allowed only when the current local canonical fingerprint still equals the last successfully synced fingerprint. The operation then:

1. validates row ownership, schema, revision, timestamps, and durable payload;
2. checks the clean-local fingerprint;
3. rechecks it immediately before the local commit;
4. hydrates the namespace in memory while preserving matching device-local quote state;
5. serializes all intended local values;
6. captures all eleven current/legacy durable recovery keys;
7. writes the selected namespace locally without emitting an upload echo;
8. verifies the canonical fingerprint; and
9. updates revision/fingerprint metadata only after local verification.

A durable local change detected before commit stops the pull and preserves that newer local value. A local write or verification failure restores and verifies the exact recovery snapshot. No cloud pull is active in Stage 5A.

## Multi-device conflict

For the fundamental r5/r5 case, both devices begin at fingerprint F5. Device A writes its local change with expected r5 and creates r6. Device B keeps its offline local change and later attempts expected r5. The database returns zero rows, so B becomes `conflict` and its automatic queue freezes. A's r6 remains in the cloud and B's local state remains in B's browser. B never fetches r6 and automatically overwrites it with B's copy. Explicit conflict resolution is deferred.

Conflicts are per namespace. A Portfolio conflict does not roll back a successful Preferences update or stop an unrelated Watchlist queue.

## Status and Sync Now models

Namespace statuses are `disabled`, `synced`, `pending`, `syncing`, `offline`, `conflict`, and `attention`. The overall summary is one of `disabled`, `all_synced`, `changes_pending`, `offline_saved_locally`, `conflict_needs_attention`, or `attention`. Status is not inferred from unrelated booleans.

The dormant `syncNow()` operation captures local fingerprints, performs one all-namespace cloud read, runs the pure reconciler, safely pushes `LOCAL_AHEAD`, safely pulls `CLOUD_AHEAD`, ignores `CLEAN`, and blocks `BOTH_CHANGED`, missing, invalid, and account-mismatched state. A previously conflicted namespace remains frozen. Results are structured per namespace, so partial failures do not produce a false “All synced” result.

Stage 5C.1 adds a compact production **Sync Now** control inside Account for enabled devices only. It uses this same operation and adds no polling.

## Payload measurements

Run `npm run sync:payload-report` to reproduce these UTF-8 JSON sizes. Fixtures contain durable fields only and are synthetic; no owner browser or live Supabase row was read.

| Namespace shape | Serialized `{ data: ... }` |
| --- | ---: |
| Portfolio light: 2 open + 1 history | 1,628 bytes |
| Portfolio representative: 15 open + 8 history | 12,498 bytes |
| Portfolio heavy synthetic: 300 open + 200 history | 277,625 bytes |
| Watchlist normal: 20 items | 5,000 bytes |
| Watchlist heavy: 200 items | 50,340 bytes |
| Preferences: 4 non-default settings | 111 bytes |

The representative Portfolio shape matches only the verified production counts supplied for planning; the records and measured contents are synthetic. The heavy Portfolio document remains well below 1 MB in this test, so whole-namespace JSONB remains reasonable for v1. Real payload telemetry should precede any decision to normalize trades.

## Estimated Supabase traffic

Planning assumptions, not billing guarantees:

- every listed user is daily active and already sync-enabled;
- one authenticated session reconciliation per user/day;
- that reconciliation is one browser request returning three namespace rows;
- six durable UI edits coalesce into three CAS writes/user/day;
- the write mix is two representative Portfolio writes and one Preferences write;
- no focus polling, Realtime, market data, Yahoo traffic, or Vercel traffic is included; and
- explicit Sync Now clicks are excluded. Each click adds one three-row read plus only the safe actions reconciliation identifies.

| Daily active users | Fetch requests/day | Namespace rows read/day | CAS writes/day | Total browser requests/day | Approx. application JSON transfer/day* |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 10 | 30 | 30 | 40 | ~0.6 MB |
| 100 | 100 | 300 | 300 | 400 | ~6.3 MB |
| 500 | 500 | 1,500 | 1,500 | 2,000 | ~31.4 MB |
| 1,000 | 1,000 | 3,000 | 3,000 | 4,000 | ~62.8 MB |

\*Approximately 62.8 KB/user/day from one 12.6 KB representative download plus request/returned-payload bytes for two 12.5 KB Portfolio CAS operations and one 111-byte Preferences CAS operation. HTTP headers, PostgREST envelopes, database/WAL overhead, compression, retries, and Supabase accounting are excluded.

## Why no Realtime or Vercel layer

Revisions plus restrained event-driven reconciliation provide the required conflict signal without a permanent WebSocket subscription. Realtime would add connection lifecycle, ordering, duplicate-event, and account-switch complexity without solving conflict resolution.

Account state remains browser ↔ Supabase under the authenticated RLS boundary. Sending it through Vercel would add latency, invocations, credentials, and a second authorization surface while mixing account traffic with independent Yahoo/market-data scaling.

## Feature-gated production lifecycle

With `VITE_CLOUD_SYNC_ENABLED` missing or not exactly `true`, the production build excludes the root provider, coordinator, engine metadata implementation, and Account Sync controls. App mount, authentication, normal durable edits, and market-data work therefore produce zero automatic `user_state` calls. Stage 4C remains explicit and unchanged.

With the flag exactly `true`, `CloudSyncProvider` lives inside Auth but above Account, routes, pages, and drawers. A signed-in but unenrolled browser performs no startup inventory read. Explicit enrollment performs one equality-verification inventory read, writes only local engine metadata, constructs one coordinator, and attaches one listener. A previously enabled device performs one startup inventory reconciliation before listener attachment. Sign-out/account change invalidates the generation and disposes the coordinator without clearing local data.

Stage 5B adds a separately gated localhost test harness for one explicitly allow-listed disposable email. Stage 5B.1 adds explicit reconstruction of that harness coordinator only for a valid previously enabled test device, with no automatic reconciliation. Its test coordinator, fixture, email allow-list, enable/resume controls, and resume implementation are excluded from production builds, so the production attachment boundary above is unchanged. The literal operator procedure is in `docs/SUPABASE_STAGE5B_LIVE_SYNC_TEST.md`.

The full production lifecycle and the future controlled localhost operator procedure are documented in `docs/SUPABASE_STAGE5C_PRODUCTION_SYNC.md`. Stage 5C.1 does not set the flag, deploy, access a real account, or begin live testing/conflict resolution.
