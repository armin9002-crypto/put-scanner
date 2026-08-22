# Supabase Stage 4C production first-account migration

Stage 4C provides a production-safe, explicit first-migration and new-device restore workflow. It does **not** enable ongoing synchronization. Local browser storage remains Put Scanner's active runtime state.

## Entry point and request boundary

The signed-in Account panel contains a compact **Account Data** section. Signing in, restoring an Auth session, opening the application, and opening the outer Account panel remain authentication-only. The first `public.user_state` read occurs only when the user explicitly opens **Account Data**.

There is no polling, Realtime subscription, focus/visibility listener, route-change fetch, or background revalidation. Initialization and restore perform their own required fresh read only after the user confirms that operation.

The Stage 4B disposable harness remains separate and is available only when both `import.meta.env.DEV === true` and `VITE_CLOUD_MIGRATION_TEST_MODE === "true"`. Production Account Data does not import fixtures or use test wording.

## Production decision logic

The Stage 4A planner owns the safe state and action:

| Local browser | Account cloud rows | Production behavior |
| --- | --- | --- |
| Empty | Zero rows | Show a neutral state; create no empty rows. |
| Populated | Zero rows | Summarize counts and require a fresh session backup before offering Local → Cloud initialization. |
| Empty | Three valid rows | Offer explicit, confirmed restore to this browser. |
| Populated | Three valid rows | Stop. Show both summaries and offer only a local JSON backup. |
| Any | Partial, corrupt, unsupported, unexpected, or inaccessible | Stop with “Account data needs attention”; write nothing. |
| Any | Metadata belongs to another user | Stop with an account-association warning; write nothing. |

The summaries contain only open-Portfolio, Portfolio-history, Watchlist, and non-default portable-preference counts. They do not expose tickers, strikes, premiums, notes, account values, tokens, keys, URLs, or raw JSON.

## Owner's expected Local → Cloud path

The expected first migration is an authenticated account with zero `user_state` rows and meaningful data in the authoritative browser.

1. Opening **Account Data** reads canonical local state and performs one explicit cloud inspection.
2. The UI shows safe local counts and keeps initialization locked.
3. **Download Backup** runs the existing versioned JSON exporter. Only a successful download action acknowledges the current in-memory migration session.
4. A reload or a newly opened Account migration session starts locked again. No acknowledgement is persisted.
5. **Save Existing Data to My Account** opens a confirmation that states the Local → Cloud direction and repeats the reviewed counts.
6. Confirmation re-reads canonical local state. If it changed after review, the operation stops before a cloud request.
7. The controller performs a fresh `fetchAllUserState()`. Any newly present row stops the operation with no overwrite or retry.
8. Stage 4A sends Portfolio, Watchlist, and Preferences in one bulk INSERT. There is no upsert, delete, pre-delete, fallback write, merge, or last-write-wins behavior.
9. The Stage 4A client separately fetches all three rows, validates ownership/schema/completeness, and canonically compares the read-back with the exact upload input.
10. The controller verifies that every pre-migration durable local raw value remains byte-for-byte unchanged.
11. Only after those checks does it write account-scoped device metadata with the authenticated user ID, cloud revisions, `lastSyncedAt`, and local mutation markers.

The initial database trigger owns revision 1. Successful migration never clears, rewrites, imports, or replaces local Portfolio, history, Watchlist, preferences, trade IDs, local market state, or unrelated caches.

## Explicit restore path

When all three cloud namespaces exist and the browser has no meaningful local state, **Restore to This Browser** is available. Restore requires a second explicit confirmation and a fresh cloud fetch.

The proven Stage 4B restore algorithm is reused:

1. Validate ownership, namespace completeness, schemas, and payloads before local writes.
2. Hydrate Portfolio and Watchlist runtime forms in memory while preserving only matching device-local market state.
3. Serialize every intended durable value before writing.
4. Capture the raw value of every current, legacy, and portable-preference durable key.
5. Write Portfolio, Watchlist, and Preferences deliberately.
6. Re-read and canonically compare local durable state with the validated cloud state.
7. On any write or verification failure, restore and verify every original raw value.
8. Write verified device metadata only after local verification succeeds.

The UI also offers an optional local recovery backup. Restore is never triggered by sign-in, session restoration, mount, or the initial Account panel opening.

## Conflicts and failures

If both browser and account contain data, Put Scanner does not compare timestamps to choose a winner, merge records, upload, restore, or overwrite. The user may download a local backup; resolution is deferred to a later stage.

If device metadata belongs to another authenticated user, the UI instructs the user to sign out or use a clean browser. It does not transfer accounts or clear any local value.

Partial rows, corrupt payloads, unsupported schemas, unknown namespaces, duplicate rows, ownership mismatches, permission failures, and verification mismatches fail closed. The UI uses a simple safe message while typed internal results retain the technical category.

## No ongoing synchronization

After migration or restore, ordinary Portfolio, history, Watchlist, and preference edits remain local-only. Stage 4C performs zero automatic `user_state` UPDATE operations. The cloud copy may become older than this browser until a later synchronization stage is explicitly designed.

Signing out remains Auth-only and never clears durable data, backup capability, metadata, or market caches. The independent **Data Backup** export/import feature remains available as a second recovery mechanism, and its file format is unchanged.

## Emergency JSON recovery

If the migration UI reports a failure, stop and retain the newest downloaded JSON file. Do not retry by clearing the browser or deleting cloud rows. Use the existing **Data Backup** import workflow only after reviewing which copy is authoritative; that workflow requires its own pre-import recovery backup and validates the entire file before replacing local durable state.

> ## OWNER'S FIRST REAL MIGRATION — MANUAL CHECKLIST
>
> Do not automate this checklist. Use the authoritative production browser only after the implementation and current database state have been reviewed.
>
> **BEFORE SIGNING IN**
>
> 1. Use the browser containing the authoritative Portfolio and history.
> 2. Export a BRAND-NEW JSON backup.
> 3. Confirm the downloaded file exists.
> 4. Save a second copy elsewhere.
> 5. Record the current visible Portfolio, history, Watchlist, and preference counts.
> 6. Confirm Supabase `public.user_state` has 0 rows.
>
> **THEN**
>
> 7. Sign in on that SAME authoritative browser.
> 8. Open **Account Data**.
> 9. Confirm the local counts are correct.
> 10. Confirm the account is reported as empty.
> 11. Download ANOTHER fresh migration-session backup.
> 12. Confirm the displayed upload direction is **LOCAL → CLOUD**.
> 13. Select **Save Existing Data to My Account**, review the confirmation, and confirm.
> 14. Wait for **Account data saved** verified success.
> 15. Confirm exactly three `user_state` rows exist at revision 1.
> 16. Confirm Portfolio, history, and Watchlist still exist locally.
> 17. Refresh and confirm the same local data remains intact.
> 18. DO NOT test another device until every preceding check passes.

## Infrastructure boundary

Stage 4C adds no SQL migration, RLS policy, schema, Supabase dashboard setting, Auth setting, Vercel variable, route, navigation item, or browser DELETE capability. Production continues to use only the existing Supabase URL, publishable key, authenticated session, and RLS boundary. `VITE_CLOUD_MIGRATION_TEST_MODE` must not be added to Vercel.
