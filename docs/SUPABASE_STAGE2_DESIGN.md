# Stage 2A Supabase user-state design

Status: design-only; not applied to a Supabase project.

## Decision

Use one `public.user_state` row per authenticated user and durable namespace. The three allowed namespaces are `portfolio`, `watchlist`, and `preferences`, so 1,000 users normally create at most 3,000 rows.

This namespaced JSONB model is appropriate for the current v1 contract. Portfolio and Watchlist are already mutated and backed up as namespace-level documents, a state replacement must be atomic, and optimistic concurrency is namespace-wide. Splitting every trade or contract into relational rows would add merge, transaction, and RLS surface without a current query that needs it. Revisit normalization only if real product requirements need server-side per-trade queries or namespace documents become operationally large.

Each payload is a JSON object. The future application mapping is:

- `portfolio`: `{ "data": [/* durable trades only */] }`
- `watchlist`: `{ "data": [/* durable saved contracts only */] }`
- `preferences`: `{ "data": {/* portable preference fields */} }`

`schema_version`, `revision`, and timestamps are authoritative table columns and are not duplicated inside `payload`. Detailed field validation and schema migrations remain application responsibilities. The database validates ownership, namespace, positive schema version/revision, and an object-shaped JSON payload. Local `localMarketData`, Watchlist `localState`, market caches, Yahoo data, charts, ETF Pulse, debug/session state, and raw corrupt values must never enter these rows.

Stage 2A does not copy the local envelope revision. A future first upload inserts cloud revision 1; subsequent cloud compare-and-swap operations use the database revision.

## Schema and conflict behavior

`public.user_state` has a composite primary key `(user_id, namespace)` and a cascading foreign key to `auth.users(id)`. There are no extra indexes: the primary-key B-tree supports both common reads—every namespace for one user and one specific namespace—and also provides the leading `user_id` index needed for user deletion cascades.

The `public.user_state_before_write()` trigger is `SECURITY INVOKER`, has a pinned `pg_catalog` search path, and is not executable directly by browser roles. It forces every insert to revision 1 and canonical timestamps. Every update atomically sets `revision = old.revision + 1` and advances `updated_at`. It rejects changes to `user_id`, `namespace`, or `created_at`.

A future client can perform compare-and-swap by updating `schema_version` and `payload` with filters for its user, namespace, and expected revision. If another device has already advanced the revision, zero rows are updated and the stale client must resolve the conflict instead of overwriting cloud state. Sync code is deliberately not implemented in Stage 2A.

Namespace rows normally remain stable after creation. An intentionally empty Portfolio or Watchlist is represented by updating its payload to a valid empty document such as `{ "data": [] }`; it is not represented by physically deleting the namespace row. The same stable-row rule applies to Preferences, using its valid empty/default document shape.

## RLS and privileges

RLS is enabled explicitly. Three policies allow permanent authenticated users to select, insert, and update only rows where `(select auth.uid()) = user_id`. UPDATE has both `USING` and `WITH CHECK`. There is no browser-facing DELETE policy. Policies also deny Supabase anonymous-auth users through the signed `is_anonymous` JWT claim; the unauthenticated `anon` database role has no table privileges or policy.

Privileges are independently least-privilege:

- `anon` and `public`: no table privileges.
- `authenticated`: SELECT on the table; INSERT only for `user_id`, `namespace`, `schema_version`, and `payload`; UPDATE only for `schema_version` and `payload`; no DELETE.
- Revision and timestamps are trigger-managed. Identity columns cannot be updated through the Data API and are also protected by the trigger.

RLS and grants are separate controls: a role must pass both. No `USING (true)` policy exists. No `SECURITY DEFINER` function is required.

Account deletion is a separate, deliberately designed administrative workflow. A future process may delete the Auth user and rely on the existing `auth.users(id) ON DELETE CASCADE` foreign key to remove that account's namespace rows. Signing out never deletes cloud data, and normal browser synchronization cannot physically delete `user_state` rows.

## API-key architecture

Future browser code will use the current Supabase publishable key (`sb_publishable_...`) plus the signed user session; RLS supplies authorization. The legacy `anon` key is not the target architecture. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Secret keys and the legacy service-role key bypass RLS and must never appear in `src/`, `VITE_*` variables, client JavaScript, or browser bundles. In particular, `SUPABASE_SECRET_KEY`, `service_role`, and `sb_secret_*` are forbidden there. Ordinary account sync does not require an administrative key. Any future administrative backend needs a separate threat model and design.

No key, URL, environment read, client initialization, authentication UI, or runtime request is added in Stage 2A.

## Storage model

These are conservative JSON sizes before JSONB/TOAST compression, indexes, WAL, backups, and implementation-dependent overhead. The planning totals add 25% for row/index overhead and round upward.

| User shape | Portfolio | Watchlist | Preferences | Raw/user | Planned/user with 25% | 100 users | 500 users | 1,000 users |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Light | 5 KB | 2 KB | 1 KB | 8 KB | 10 KB | ~1 MB | ~5 MB | ~10 MB |
| Normal | 50 KB | 10 KB | 2 KB | 62 KB | 78 KB | ~8 MB | ~39 MB | ~78 MB |
| Heavy history | 500 KB | 50 KB | 5 KB | 555 KB | 694 KB | ~69 MB | ~347 MB | ~694 MB |

The model is sensible for 1,000 initially expected users. A population where every account is “heavy” would exceed today's 500 MB Free-plan database allowance and should trigger document-size observation, retention/product review, and a paid plan—not silent data truncation. Market data is excluded, which is the main reason the normal case remains small.

## Query and egress model

Planning assumption per daily active user: one sign-in loads three namespaces, one foreground revalidation reads three namespaces, and two durable edits each write one namespace. That is 6 reads and 2 writes per active user/day. These are account-state operations only, not Yahoo or Vercel market traffic.

| Daily active users | Namespace reads/day | Namespace writes/day | Total operations/day |
| ---: | ---: | ---: | ---: |
| 100 | 600 | 200 | 800 |
| 500 | 3,000 | 1,000 | 4,000 |
| 1,000 | 6,000 | 2,000 | 8,000 |

Two full normal-state downloads are roughly 124 KB/user/day before protocol overhead: about 12 MB, 62 MB, and 124 MB/day for 100, 500, and 1,000 daily-active users. The light range is about 1.6/8/16 MB; the deliberately heavy range is about 111/555/1,110 MB. Writes add uplink traffic and response metadata. These are planning estimates, not billing guarantees; future clients should read only when sign-in, focus/revalidation policy, or conflict recovery requires it.

## Plan and authentication recommendations

The Free plan is appropriate for development and controlled testing. Before real production cloud migration, use Pro for non-pausing production behavior, seven days of automatic daily backups, and paid support characteristics. Current references: [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) and [database backups](https://supabase.com/docs/guides/platform/backups). Do not encode a billing plan into application logic.

Before public passwordless or email-based authentication, configure custom SMTP. Supabase's built-in sender is restricted and intended for development, not public production delivery. See [custom SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp). Stage 2A creates no Auth configuration or SMTP secret.
