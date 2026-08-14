# Legacy Supabase artifacts

The three SQL migrations that were previously under `supabase/migrations/` belonged to an unrelated project-management application named Flowboard. They created project, task, comment, membership, and profile tables plus Flowboard-specific policies and triggers.

Stage 1.5 removed those files from the active Supabase migration path after verifying that no Put Scanner source, API route, build script, or test imported Supabase or depended on any of the Flowboard objects. The files remain recoverable from Git history through commit `53cf04f`, immediately before this cleanup.

This repository does **not** currently define a Put Scanner Supabase project or schema. A future cloud stage must begin with a reviewed, product-specific baseline; it must not restore or execute the Flowboard migrations. The existing `@supabase/supabase-js` package entry remains unused and uninitialized in Stage 1.5.
