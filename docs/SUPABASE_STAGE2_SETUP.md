# Stage 2 Supabase setup checklist

Status: operator checklist for a future, explicitly approved deployment. Stage 2A stops before applying SQL. Do not perform the “apply” steps until the migration has been reviewed and a later stage authorizes them.

## Project and migration

1. Create a new, clean Supabase project for Put Scanner. Do not reuse a database containing the old Flowboard schema.
2. Choose the closest appropriate US/Americas region for the expected users. Treat the region as a durable infrastructure choice.
3. Generate a strong database password and save it in the owner's password manager. Do not paste it into source, documentation, chat, issue trackers, or Vercel.
4. Open the project's SQL Editor only when deployment is authorized.
5. Review `supabase/migrations/20260820154219_create_user_state.sql` line by line. Confirm that the active migration directory contains only Put Scanner history.
6. In the authorized deployment stage, apply the migration once in the SQL Editor. Do not use `supabase link`, `supabase db push`, or a remote CLI command for the Stage 2A review.
7. Verify `public.user_state` has the composite primary key, `auth.users` cascading foreign key, three namespace check, positive version/revision checks, JSON-object check, trigger, and no unexpected rows.
8. Verify RLS is enabled and exactly three policies—SELECT, INSERT, and UPDATE—target only `authenticated`; confirm UPDATE has both `USING` and `WITH CHECK`, and confirm there is no DELETE policy or authenticated DELETE privilege.
9. In a disposable development project with two sacrificial Auth users, run the methodology in `supabase/tests/user_state_security.sql`. Never run that script against production accounts.
10. Locate the Project URL in the Dashboard for future browser configuration. It is not a password, but do not configure or use it in Stage 2A.
11. Locate or create the current Publishable key (`sb_publishable_...`) under the Dashboard API-key settings for future browser use. Do not add it to code or Vercel in Stage 2A.

## Key and secret rules

The Project URL and Publishable key are intended for a future public browser client backed by RLS. A publishable key identifies the application; it does not authorize access to another user's row.

Never put a Supabase secret key, `sb_secret_*`, the legacy `service_role` key, or the database password in React/Vite code, a `VITE_*` variable, browser storage, a browser bundle, screenshots, chat, or support tickets. Do not ask the operator to copy any of those values for this stage. Ordinary user-state synchronization should not need them.

Do not configure Vercel yet. Do not add an Auth provider, callback URL, email template, SMTP credentials, or runtime Supabase client yet.

Normal browser synchronization is limited to reading, inserting, and updating stable namespace rows. Represent an empty Portfolio or Watchlist with a valid payload update such as `{ "data": [] }`, not a physical row deletion. Signing out must not delete cloud state. Future account deletion requires a separately reviewed workflow and may use Auth-user deletion plus the existing foreign-key cascade.

## Plan and email readiness

The Free plan is acceptable for development/testing. Before migrating real user data, recommend Pro so the project is not paused for inactivity and has automatic daily backups retained for seven days plus paid support characteristics. Reconfirm current plan details before purchase.

Supabase's built-in Auth email sender is for restricted development use. Before public passwordless/email authentication, configure a custom SMTP provider, protect its credentials, review Auth rate limits, and test deliverability. That belongs to a later Auth stage; no SMTP secret is created here.

## Stage 2A stop check

At the end of Stage 2A, all of the following must still be true:

- No Supabase project has been linked or contacted.
- No migration has been executed.
- No Project URL or key has been added to the app or Vercel.
- No browser data has been read, rewritten, uploaded, or deleted.
- No application UI, localStorage behavior, market request, or financial calculation has changed.
