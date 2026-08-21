# Stage 4B development-only live migration and restore test

> **DO NOT PERFORM REAL-BROWSER MIGRATION FROM THIS PROCEDURE.**
>
> Use only localhost and a fresh Incognito/private browser containing no real Put Scanner data. Stage 4B is a disposable test harness, not production migration or ongoing synchronization.

## Safety gates

The harness renders only when both conditions are true:

```text
import.meta.env.DEV === true
VITE_CLOUD_MIGRATION_TEST_MODE === "true"
```

Production builds fail the first condition even if someone accidentally supplies the flag. The flag must never be added to Vercel. Signing in never checks cloud state. The first `user_state` request occurs only after the signed-in operator opens the development entry and clicks **Check Cloud State**.

To enable the harness locally, create or edit the ignored `.env.local` file:

```text
VITE_CLOUD_MIGRATION_TEST_MODE=true
```

Restart the local development server after changing the file. Remove the line or set it to `false` after the test.

## Manual operator procedure

Codex must not perform these live steps. A human performs them only after reviewing the implementation and confirming that the target rows are disposable.

### First Incognito window: migration

A. Confirm the intended authenticated test account currently has zero `public.user_state` rows. Do not assume; inspect only through an approved human operator procedure.

B. Start the application on localhost. Do not use the production URL.

C. Open a brand-new Incognito/private browser. Do not open the harness in the owner's normal browser.

D. Enable `VITE_CLOUD_MIGRATION_TEST_MODE=true` only in local development and restart localhost.

E. Sign in manually through the normal Account control. Do not give an automated agent a magic link, OTP, or session token.

F. In Account, open **Migration Test Harness** and click **Create Disposable Local Test Data**. Confirm the warning. Expected safe summary:

```text
Portfolio: 1 open
History: 1
Watchlist: 1
Portable preferences: 3 non-default
```

G. Click **Check Cloud State**. Expected result: `No saved account state`. Merely signing in or opening Account must not perform this check.

H. Click **Download Backup** and retain the downloaded disposable backup. The initialization button must remain disabled until this succeeds.

I. Click **Save Existing Data to Test Account**. The harness performs a fresh zero-row check immediately before one three-row insert.

J. Confirm the harness reports **Test migration verified** and shows Portfolio, Watchlist, and Preferences at revision 1. This status requires a complete canonical read-back match.

### Second clean Incognito window: restore

K. Close **all** Incognito/private windows so the disposable local storage and session-only backup acknowledgement disappear.

L. Open a new clean Incognito/private browser and return to localhost.

M. Sign in manually to the same test account.

N. Open the harness and click **Check Cloud State**. Expected result: all three cloud namespaces available, while local meaningful counts remain zero.

O. Optionally click **Download Pre-Restore Backup**, then click **Restore Cloud Data to This Browser**. Restore is never automatic.

P. Confirm **Test restore verified** and the same safe local counts: 1 open Portfolio item, 1 history item, 1 Watchlist item, and 3 non-default portable preferences. Do not inspect or log raw payloads through the harness.

### Required cleanup

Q. Before any real migration, stop and perform a separately reviewed administrative cleanup of exactly the three disposable `user_state` rows for the authenticated test account. The browser harness intentionally has no DELETE operation. Confirm that the account is back to zero rows, close all Incognito windows, and disable the local test flag.

Do not proceed to real browser migration from this procedure.

## What the test proves

- Authenticated RLS reads work through the existing publishable-key browser client.
- Empty, complete, partial, corrupt, unsupported, and wrong-owner state remain distinct.
- Disposable local data cannot replace a meaningful existing browser inventory.
- A real backup download unlocks initialization only for the current in-memory session.
- Initialization rechecks for races, inserts all three namespaces in one statement, and verifies read-back.
- Restore fetches and validates all namespaces before any durable write.
- Restore snapshots every durable local key and rolls every key back on write or verification failure.
- Restored data is re-read and canonically compared before success.
- Device sync metadata is written only after verification and is scoped to the authenticated user.
- Portfolio edits, Watchlist edits, and preference changes remain local-only after the test. There is no polling, Realtime, merge engine, or ongoing sync.

## What this stage does not change

Stage 4B adds no SQL migration, schema or RLS change, Supabase dashboard configuration, Auth configuration, Vercel variable, production route, navigation item, or production migration surface. It does not provide cloud-row cleanup, automatic migration, automatic restore, or ongoing synchronization.
