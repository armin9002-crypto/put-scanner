# Supabase Stage 5D production rollout

Status: Stage 5D.1 rollout hardening and mobile Account presentation are implemented locally. Production synchronization remains controlled only by the exact build-time value `VITE_CLOUD_SYNC_ENABLED=true`; it remains off. This document does not authorize a deployment, environment-variable change, live account inspection, or rollout.

## Final production behavior

Put Scanner remains local-first. Portfolio/history, Watchlist, and portable Preferences are written locally before any cloud work. Current quotes, option marks, market timestamps, charts, caches, Scanner data, ETF Pulse data, and diagnostics remain device-local and never enter the account copy.

When the feature flag is missing, false, or malformed, the production coordinator and Account Sync UI are excluded from the build. Authentication and explicit Account Data save/restore remain available. When the flag is exactly true, a signed-out session performs no account-state operation, and a newly signed-in browser remains inert until the user completes the appropriate explicit Account Data action and separately chooses **Enable Sync on This Device**.

The root ownership chain remains:

```text
AuthProvider
  -> CloudSyncProvider
    -> routes, pages, and Account presentation
```

Opening or closing Account, changing routes, rotating a phone, or switching between mobile and desktop presentation does not construct, attach, detach, or dispose the coordinator. An already enrolled device reconstructs the root coordinator after Auth restoration and performs one conservative startup reconciliation. Idle synchronization performs zero requests: there is no polling, Realtime subscription, focus/visibility watcher, or interval.

Typical request shape remains:

- enabled startup: approximately one inventory SELECT;
- durable edit: one namespace-specific revision-checked update after debounce;
- manual **Sync Now**: one inventory SELECT plus only the reconciliation actions required;
- idle: zero requests;
- quote-only refresh: zero account-state writes.

## New-device and enrollment flow

- Cloud populated, browser empty: **Restore to This Browser** is explicit.
- Cloud empty, browser populated: download a backup, then **Save Existing Data to My Account** explicitly.
- Both populated: no automatic winner and no overwrite.
- Verified save/restore: **Enable Sync on This Device** remains a separate explicit action.
- Enrollment verifies ownership, schema, complete cloud state, verified cloud revisions, and exact canonical local/cloud fingerprints. Successful enrollment creates device-local metadata and performs zero CAS writes.

Restore and enrollment are intentionally not combined. Signing in alone does not upload local data, restore cloud data, or enable ongoing synchronization.

## Conflict and offline behavior

`BOTH_CHANGED` freezes only the affected account area. The cloud version and browser version are preserved; there is no automatic merge, timestamp winner, revision winner, or Last Write Wins. The mobile Account sheet states which area needs attention, confirms that no data was overwritten, and offers **Download Local Backup**. Stage 5D.1 provides no conflict-resolution action.

When a network update cannot complete after bounded retry, the durable change remains saved locally and Account reports **Saved locally** / **Account sync pending**. It does not create a polling or recurring retry loop. A later durable edit or explicit **Sync Now** may retry safely.

Sign Out ends Auth, disposes the root coordinator, and detaches its listener. Local Portfolio, History, Watchlist, Preferences, and market caches remain present. Sign-out performs no cloud DELETE and no account-state update.

## Purpose-built mobile Account

The former mobile Account overlay was a fixed descendant of the sticky, backdrop-filtered mobile header. That header established the overlay's containing block and stacking context. The sheet therefore ended at the roughly 44–52 px header bottom and extended above the viewport; its apparent `z-index` could not escape the header or outrank the mobile navigation. Tapping Account appeared to do nothing because nearly all dialog content was offscreen.

Stage 5D.1 uses a dedicated `MobileAccountSheet` rendered through a portal to `document.body`. Its viewport-level fixed layer sits above headers and bottom navigation, blocks background interaction, uses `100dvh`, respects top/bottom/left/right safe areas, keeps the close target reachable, and provides one vertically scrollable content region. The sheet traps keyboard focus, closes on Escape/backdrop/close control, restores focus, and uses an iOS-safe scroll lock that restores the prior page position.

Phone landscape remains mobile at 844×390 and 667×375. The sheet shrinks with the dynamic viewport, form controls retain 16 px input text to avoid iOS zoom, and the content region remains scrollable when the software keyboard reduces visible height.

Mobile information order is:

1. Account identity and signed-in status;
2. Account Sync;
3. Account Data;
4. Sign Out.

Signed-out presentation shows the account explanation, email field, and **Send Sign-In Link** without passwords. Production Account actions are not forked: mobile and desktop render the same `AccountPanel`, `CloudSyncSection`, `AccountDataSection`, Auth actions, backup actions, restore action, enrollment action, and Sync Now action. Desktop retains its established dialog presentation.

## FINAL PERMANENT ROLLOUT CHECKLIST

Do not execute this checklist as part of Stage 5D.1.

1. Confirm latest commit deployed with sync false.
2. Confirm real cloud account healthy.
3. Confirm fresh JSON backup exists.
4. Test desktop Account.
5. Test iPhone portrait Account.
6. Test iPhone landscape Account.
7. Test signed-out mobile login.
8. Test clean-browser restore.
9. Enable sync on clean canary device.
10. Confirm enrollment causes zero CAS.
11. Perform one durable preference change.
12. Confirm namespace-specific CAS.
13. Refresh Portfolio quotes.
14. Confirm zero Portfolio CAS.
15. Sign out and verify local preservation.
16. Enable `VITE_CLOUD_SYNC_ENABLED=true` in Production permanently.
17. Redeploy.
18. Verify existing unenrolled browsers remain inert.
19. Enroll only reviewed browsers/devices.
20. Monitor Supabase request/storage behavior.

The checklist requires explicit human authorization. Stage 5D.1 itself performs none of these production operations.
