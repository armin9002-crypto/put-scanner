# Stage 2 user-state rollback

> DEVELOPMENT / PRE-PRODUCTION ONLY

This is a human-reviewed abandonment procedure, not an automatic migration. Never use it after real account data exists. Before doing anything, verify that `public.user_state` contains no production user state and that no later migration depends on it.

The Stage 2A migration creates only:

- `public.user_state`
- `public.user_state_before_write()`
- the table's trigger, policies, constraints, comments, and grants

Dropping the table automatically removes its trigger, policies, constraints, and grants. In a disposable development project, a database owner can then remove the now-unused function in one explicit transaction:

```sql
begin;

drop table public.user_state;
drop function public.user_state_before_write();

commit;
```

Do not add `if exists` or `cascade` casually: a failure should expose an unexpected dependency or schema mismatch for review. Do not turn this into a checked-in forward migration or automated deployment step. If any real user row exists, stop and design an export/retention migration instead of dropping anything.
