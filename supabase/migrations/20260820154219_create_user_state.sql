-- Put Scanner Stage 2A: durable account-state foundation.
-- Design only in Stage 2A. Review this migration before applying it to any project.

create table public.user_state (
  user_id uuid not null,
  namespace text not null,
  schema_version integer not null,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_state_pkey primary key (user_id, namespace),
  constraint user_state_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint user_state_namespace_check
    check (namespace in ('portfolio', 'watchlist', 'preferences')),
  constraint user_state_schema_version_check
    check (schema_version > 0),
  constraint user_state_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint user_state_revision_check
    check (revision > 0)
);

comment on table public.user_state is
  'One durable Put Scanner state document per authenticated user and namespace.';
comment on column public.user_state.payload is
  'Application-validated namespace document. Market-data caches and device-local state are prohibited.';
comment on column public.user_state.revision is
  'Database-managed optimistic concurrency token. Starts at 1 and increments on every update.';

create function public.user_state_before_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  write_time timestamptz;
begin
  write_time := clock_timestamp();

  if tg_op = 'INSERT' then
    -- Ignore client-supplied metadata so an insert always has canonical revision 1.
    new.revision := 1;
    new.created_at := write_time;
    new.updated_at := write_time;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'user_state.user_id is immutable';
  end if;
  if new.namespace is distinct from old.namespace then
    raise exception 'user_state.namespace is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'user_state.created_at is immutable';
  end if;

  -- Override any client-supplied revision/timestamp values atomically.
  new.revision := old.revision + 1;
  new.updated_at := greatest(write_time, old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

comment on function public.user_state_before_write() is
  'Forces canonical write metadata and prevents user_state identity transfer.';

revoke all on function public.user_state_before_write() from public, anon, authenticated;

create trigger user_state_before_write_trigger
before insert or update on public.user_state
for each row
execute function public.user_state_before_write();

alter table public.user_state enable row level security;

create policy "user_state_select_own"
on public.user_state
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

create policy "user_state_insert_own"
on public.user_state
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

create policy "user_state_update_own"
on public.user_state
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
)
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

-- Supabase may apply broad default privileges to new public-schema objects.
-- Make this table opt-in and expose only the columns future browser sync requires.
revoke all privileges on table public.user_state from public, anon, authenticated;
grant select on table public.user_state to authenticated;
grant insert (user_id, namespace, schema_version, payload)
  on table public.user_state to authenticated;
grant update (schema_version, payload)
  on table public.user_state to authenticated;
