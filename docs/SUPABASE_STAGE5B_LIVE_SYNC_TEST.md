# Supabase Stage 5B Live Sync Test

This checklist is for a human operator testing the development-only Stage 5B harness. Codex implementation and automated tests make no live Supabase or Auth requests. Stage 5B never enables production synchronization.

## PHASE 0 — Safety

- Use only a disposable Supabase Auth email created for this test.
- In local `.env.local`, set `VITE_CLOUD_SYNC_TEST_MODE=true` and set `VITE_CLOUD_SYNC_TEST_EMAIL` to that exact disposable email.
- Confirm the signed-in email displayed by Put Scanner matches `VITE_CLOUD_SYNC_TEST_EMAIL` after trimming and case normalization.
- Never use the owner's real account, real browser profile, or any browser containing real Put Scanner data.
- Run only on localhost in development. Do not put either Stage 5B variable in Vercel.
- Confirm the separate **Sync Test Harness** is absent on production. Production automatic synchronization remains off.
- Do not continue if the harness says: **This account contains non-test Put Scanner data. Live synchronization testing is blocked.**
- Do not inspect, copy, or reuse owner data. The only permitted cloud state is zero rows or the exact three-namespace Stage 5 disposable fixture.

## PHASE 1 — Device A bootstrap

- Open a clean Chrome Incognito window or another clean private profile and treat it as Device A.
- Start localhost with the Stage 5B variables above, then sign in to the disposable test account.
- Open Account, expand **Sync Test Harness**, select **Device A**, and click **Check Test Account**.
- Confirm both local and cloud are empty. If either contains non-test data, stop.
- Click **Prepare Disposable Sync Test** and accept the explicit confirmation.
- Confirm the result says **Test account prepared** and shows Portfolio r1, Watchlist r1, and Preferences r1.
- Confirm the status is **Eligible — not enabled**. No coordinator listener should be active yet.
- Click **Enable Test Sync** and accept the separate explicit confirmation.
- Confirm overall status is enabled/all synced and each namespace has a known r1 revision plus matching local/last-synced fingerprints.

## PHASE 2 — Single-device push

- On Device A, click **Mutate Test Portfolio** once.
- Confirm the local Portfolio version changes immediately. After the 1,000 ms debounce, confirm only Portfolio advances from r1 to r2.
- Confirm Watchlist and Preferences remain r1 and the Portfolio revision changes only after a verified CAS response.
- Click **Mutate Test Watchlist**. Confirm only Watchlist advances from r1 to r2.
- Click **Mutate Test Preferences**. Confirm only Preferences advances from r1 to r2.
- Record the mutation-event, CAS-attempt, and verified-CAS counters. Verified CAS must never exceed CAS attempts.
- Click **Burst Mutate Test Portfolio**. Confirm five local mutation events/version steps but preferably one coalesced verified cloud CAS after the debounce.

## PHASE 3 — Device B

- Use a truly separate storage environment, such as Edge InPrivate or a separate browser profile, and treat it as Device B.
- Do not use another window from the same Chrome Incognito session; those windows can share storage.
- Sign in to the same disposable account and confirm the exact allow-listed email.
- Use the existing production **Account Data** flow to check cloud state and explicitly restore it into the empty Device B browser.
- Confirm the Stage 4C restore verifies all three canonical namespaces. Never auto-restore.
- Return to **Sync Test Harness**, select **Device B**, click **Check Test Account**, then **Establish Test Eligibility**.
- Confirm eligibility is verified but synchronization remains disabled.
- Click **Enable Test Sync** explicitly and confirm all namespaces are clean at the same revisions as Device A.

## PHASE 4 — Cross-device pull

- First ensure Devices A and B show the same clean Portfolio revision.
- On Device A, click **Mutate Test Portfolio** and wait for its verified automatic push from rN to rN+1.
- Confirm Device B's local Portfolio version has not changed by itself; there is no Realtime or polling.
- On Device B, click **Sync Now**.
- Confirm Portfolio reports `CLOUD_AHEAD / pulled`, the local fixture version matches Device A, and the known revision becomes rN+1.
- Confirm no upload echo occurred, unrelated namespaces were not overwritten, the pull counter advanced, and local recovery/verification completed before metadata advanced.

## PHASE 5 — Reverse

- On Device B, click **Mutate Test Preferences** and wait for its verified automatic Preferences push.
- On Device A, click **Sync Now**.
- Confirm Preferences reports `CLOUD_AHEAD / pulled` and Device A receives the portable preference change.
- Confirm Portfolio and Watchlist remain clean and unchanged.

## PHASE 6 — Offline

- Ensure Device B is clean at the current Watchlist revision N.
- On Device B, click **Simulate Offline (Pause Test Network)**.
- Confirm Auth remains signed in and normal app/market-data networking was not globally disabled.
- Click **Mutate Test Watchlist**. Confirm the local Watchlist version changes immediately.
- Wait for the bounded sequence of three CAS attempts (initial attempt plus two retries).
- Confirm Watchlist becomes offline/pending, its known cloud revision stays N, verified-CAS does not increase, and local data remains intact.
- Click **Resume Test Network**. Confirm this alone does not synchronize or advance a revision.
- Click **Sync Now** deliberately.
- If cloud stayed at N, confirm `LOCAL_AHEAD / pushed`, a verified CAS advances Watchlist to N+1, and the pending local value is preserved.

## PHASE 7 — Conflict

- Bring Devices A and B to CLEAN on the same Portfolio revision N. Record each device's local version and the cloud version.
- On Device B, click **Simulate Offline (Pause Test Network)**, then **Mutate Test Portfolio**. Record the Device B local version/change.
- Wait until Device B reports Portfolio offline/pending and the cloud remains N.
- On Device A, click **Mutate Test Portfolio** and wait for its verified automatic push to cloud revision N+1. Record Device A's cloud version/change.
- On Device B, click **Resume Test Network**. Confirm resume alone writes nothing.
- On Device B, click **Sync Now**.
- Confirm Portfolio reports `BOTH_CHANGED / conflict` (or a CAS conflict if timing produced that equivalent safe path).
- Confirm the prominent message says **Conflict — Portfolio needs attention. No data was overwritten.**
- Confirm cloud still contains Device A's test version at N+1 and Device B local storage still contains Device B's divergent test version.
- Confirm there was no pull over Device B, no push over Device A, no revision-N+1 retry, no merge, and no timestamp winner.
- While Portfolio remains frozen in conflict, mutate Watchlist or Preferences and confirm those clean namespaces can still synchronize independently.
- Do not attempt conflict resolution; Stage 5B detects and preserves only.

## PHASE 8 — Cleanup

- Record the final safe counters, per-namespace statuses, revisions, and fixture versions. Do not copy raw payloads or tokens.
- Close every private test browser window/profile so the disposable local fixtures and sessions are discarded.
- Set `VITE_CLOUD_SYNC_TEST_MODE=false` locally (or remove the local-only variables) and restart the development server.
- Confirm **Sync Test Harness** is gone while normal production **Account Data** remains unchanged.
- Arrange a separately reviewed administrative SQL operation that targets exactly the disposable test account's three rows. The browser has no DELETE control or privilege, and this document intentionally provides no generic deletion command.
- Confirm through separately authorized administration that cleanup targeted only the disposable account.
- Confirm the owner's real account, browser, and three real rows were never opened, read, restored, updated, or deleted during this test.

## Expected invariants

- The harness exists only when `import.meta.env.DEV === true`, `VITE_CLOUD_SYNC_TEST_MODE === "true"`, and the normalized authenticated email exactly equals normalized `VITE_CLOUD_SYNC_TEST_EMAIL`.
- Signing in, checking, restoring, preparing, and establishing eligibility do not implicitly enable ongoing synchronization.
- Only the explicit **Enable Test Sync** action constructs the coordinator and attaches the durable mutation listener.
- Test mutations use the production durable writers; cloud updates use revision-checked CAS and advance metadata only after verified responses.
- Offline retries are bounded. Resume requires a deliberate Sync Now fetch before pending writes are released.
- Conflicts preserve cloud and local values, freeze only the affected namespace, and expose no resolution action.
- There is no client DELETE, Supabase Realtime, interval polling, background cloud watcher, database migration, RLS change, dashboard change, Vercel change, or production sync activation in Stage 5B.
