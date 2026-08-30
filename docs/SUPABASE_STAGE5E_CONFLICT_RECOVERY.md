# Supabase Stage 5E conflict recovery

> **Historical and obsolete.** Keep-This-Device/Use-Account-Copy conflict recovery was removed in Stage 7A. Current conflicts mean only a stale cloud CAS. See [the current architecture](./PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md).

Status: explicit namespace-level conflict recovery is implemented with deterministic local tests and mock browser fixtures. This stage performs no live Supabase/Auth request, SQL/RLS change, Vercel change, deployment, production environment change, real-account inspection, or production canary.

## Why conflict recovery is explicit

Put Scanner does not attempt automatic field-level merging. Portfolio trades and lifecycle state, Watchlist contracts, and Preferences can contain intentional edits whose meaning cannot be inferred from timestamps or revision numbers. “Newest,” “highest revision,” and Last Write Wins can silently discard valid work. Stage 5E therefore preserves both validated versions and waits for the user to select one.

A true `BOTH_CHANGED` conflict retains the existing definition:

- the current local canonical fingerprint differs from the last known common fingerprint; and
- the validated cloud revision advanced beyond the last known common revision.

Both conditions are required. Envelope timestamps, market refreshes, local device labels, and revision magnitude do not create or resolve a conflict.

## Captured recovery state

When reconciliation classifies an account area as `BOTH_CHANGED`, the coordinator freezes only that area and captures:

- the validated local canonical document and fingerprint;
- the validated cloud row, fingerprint, owner, and current revision;
- safe local/cloud change times used only for display; and
- a deterministic opaque conflict identifier tying the UI to that exact pair.

The documents remain in coordinator memory; they are not added to persisted sync metadata. Persisted conflict status retains the common revision/fingerprint baseline. After reload, the root coordinator performs its normal fresh inventory and reconstructs the unresolved conflict without writing or pulling either version. If the cloud is unavailable or either side is invalid, no winner controls are exposed.

Conflicts are independent. Portfolio may remain frozen while clean Watchlist and Preferences mutations continue normally. Multiple conflicted areas can be backed up and resolved one at a time.

## Backup-first gate

Every conflict begins with **Download Recovery Backup**. It reuses the standard Put Scanner JSON exporter and includes complete local Portfolio/history, Watchlist, and portable Preferences—not just the conflicted area.

The coordinator records an in-memory acknowledgement tied to the exact conflict identifier only after backup generation and browser download initiation succeed. Winner buttons remain disabled before that acknowledgement. A changed or refreshed conflict snapshot invalidates the acknowledgement. Browsers do not expose a reliable API proving that a user kept the file after the download began; therefore “completed” means successful generation plus download initiation. Operational procedures must still ask the human operator to verify the file exists.

## Keep This Device

Preconditions are authenticated ownership, enabled device metadata, current conflict status, a valid captured local/cloud pair, unchanged current local fingerprint, no in-flight operation for that area, and the exact-session backup acknowledgement.

The coordinator then:

1. re-reads and canonicalizes the affected local area;
2. sends one revision-checked update using the captured cloud revision;
3. never retries a conflict-resolution CAS;
4. validates the returned owner, schema, payload, and exact revision increment through the existing cloud client;
5. verifies the returned canonical fingerprint equals the chosen local document;
6. advances only that area’s local sync baseline and known cloud revision;
7. clears only that conflict and its superseded queued work; and
8. resumes normal event-driven synchronization.

Unrelated areas are not read, written, or reset. If local data changes while the CAS is in flight, the chosen version is still verified and the later local edit becomes a normal pending mutation against the new baseline.

If the captured revision is stale, the CAS returns zero rows. Stage 5E stops after that one attempt and reports: **Account data changed again. Nothing was overwritten. Review the latest account copy before trying again.** The captured snapshot and its backup acknowledgement are invalidated; a fresh explicit review is required.

## Use Account Copy

The same ownership, conflict, local-validation, and backup preconditions apply. The coordinator then:

1. fetches the affected cloud row only;
2. requires its revision and canonical fingerprint to equal the captured snapshot;
3. applies it through the existing rollback-protected safe-pull path;
4. preserves Portfolio `latestMarketData` and Watchlist local snapshot/status data where identities match;
5. verifies the new local canonical fingerprint;
6. advances only that area’s baseline;
7. discards only its superseded queued writes; and
8. emits no upload echo or CAS.

If the cloud row changed, the stale snapshot is not applied. If the local area changed again, the pull’s double local-fingerprint check stops before overwrite. Corrupt, unsupported, wrong-owner, missing, or unverifiable state exposes backup/attention only.

## Account UX

Desktop uses the existing Account dialog; phones use the existing body-portaled `MobileAccountSheet`. Both render the same `CloudSyncSection` and production actions.

Each conflicted area shows only a non-sensitive summary:

- Portfolio: open-position and history counts;
- Watchlist: saved-contract count;
- Preferences: theme and Mark Book basis; and
- safe last-changed/last-saved times when available.

Raw JSON, trade details, fingerprints, revisions, and engine terms are not displayed. The backup and both 44 px winner controls remain inside the Account scroll region. Winner confirmation uses a second body portal above Account, with safe-area/`100dvh` constraints, blocked background interaction, focus containment, Escape/Cancel handling, and explicit overwrite wording.

## Device identity

Stage 5E found no existing stable opaque device identifier. It adds `put_scanner_cloud_device_id:v1`, containing a version and `crypto.randomUUID()` value generated once per browser profile. It is local-only, excluded from account payloads and JSON backups, and never replaces malformed existing identity metadata automatically.

There is no IP, location, browser fingerprint, hardware identifier, or cloud device registry. The optional friendly label is simply **This iPhone** or **This Browser**.

## Offline and multi-device behavior

- Long-offline device: if another device advances an area and the offline device also changes it, reconnect reconciliation is `BOTH_CHANGED`; neither side is automatically applied.
- Sequential devices: a clean device sees `CLOUD_AHEAD`, safely pulls, and remains clean; a later clean device does the same without conflict.
- Simultaneous edits: the first CAS advances the cloud; the other device retains its local edit and enters `BOTH_CHANGED`. Notes and trades are not merged.
- Sign-out: generation invalidation disposes the coordinator and conflict session permits; local bytes remain and no conflict write occurs.
- Reload: persisted baseline/conflict status plus fresh inventory reconstructs the conflict; backup must be downloaded again for the new session.

Normal debounce, coalescing, bounded network retries, startup reconciliation, safe cloud pull, JSON import, and sign-out behavior are unchanged. Quote-only refresh, hover, charts, Scanner, ETF Pulse, and option market requests remain outside canonical fingerprints and produce zero conflict/CAS activity.

## Recommended production conflict-recovery canary

Do not execute without explicit human authorization, current backups, and reviewed monitoring.

1. Confirm the Stage 5E commit is deployed and normal production sync health is clean.
2. Select two controlled enrolled canary browsers owned by the same reviewed account.
3. Download and verify a fresh JSON backup from both browsers.
4. Confirm Portfolio, Watchlist, and Preferences are clean and record their current revisions through approved operator tooling.
5. Choose a low-risk Preferences setting for the first conflict round; do not use Portfolio financial data.
6. Take Device A offline before either edit.
7. On Device B, change the selected Preference and wait for its single Preferences CAS to verify.
8. While still offline, change the same Preference differently on Device A.
9. Reconnect Device A and run explicit **Sync Now** if startup reconciliation has not already run.
10. Confirm Preferences alone reports **Sync conflict**, both versions remain intact, and Portfolio/Watchlist remain operational.
11. Confirm both resolution buttons are disabled before backup.
12. Download and verify Device A’s **Recovery Backup**; confirm both buttons become available.
13. Choose **Use Account Copy**, review the confirmation, and confirm.
14. Verify one Preferences row read, zero CAS writes, the Device B value applied locally, and state returned to **Synced**.
15. Create a second controlled Preferences divergence from a new clean common baseline using the same offline order.
16. Download and verify a new recovery backup tied to the new conflict.
17. Choose **Keep This Device**, review the confirmation, and confirm.
18. Verify exactly one Preferences CAS used the captured current revision, returned the next revision, and no other area changed.
19. Run **Refresh Open Trades** and verify zero Portfolio CAS and no new conflict.
20. Reload Device A, navigate routes, and confirm the root coordinator remains enabled and clean.
21. Sign out and verify local Portfolio/history, Watchlist, and Preferences remain present.
22. Review Supabase request logs/storage behavior, retain both recovery backups, and stop the canary if any request or revision differs from this procedure.

## Operational recovery

If a resolution is rejected as stale, do not retry blindly. Use **Review Latest Account Copy** to perform a fresh inventory, inspect the updated summary, and download a new recovery backup before selecting again. If state is invalid or cannot be verified, stop with the local backup and use the permanent Data Backup import workflow only after human review.

## Optional future work — not implemented

- cloud device registry or device-revocation dashboard;
- automatic field-level merge;
- historical cloud snapshots or an undo server;
- Realtime or background polling;
- cross-account sharing; and
- collaborative portfolios.
