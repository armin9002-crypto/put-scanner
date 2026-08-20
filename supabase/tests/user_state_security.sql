-- Put Scanner Stage 2A controlled-development security checks.
--
-- DO NOT run this in production. Run it only after the Stage 2A migration has
-- been deliberately applied to a disposable development project. Create two
-- sacrificial users through Supabase Auth, then replace the two UUIDs below.
-- The transaction rolls back all fixture rows; it never creates or deletes
-- auth.users records.

begin;

select set_config(
  'put_scanner.test_user_a',
  '00000000-0000-0000-0000-000000000001',
  false
);
select set_config(
  'put_scanner.test_user_b',
  '00000000-0000-0000-0000-000000000002',
  false
);

do $$
declare
  user_a uuid := current_setting('put_scanner.test_user_a')::uuid;
  user_b uuid := current_setting('put_scanner.test_user_b')::uuid;
begin
  if user_a = '00000000-0000-0000-0000-000000000001'::uuid
    or user_b = '00000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'replace both placeholder UUIDs with sacrificial development Auth users';
  end if;
  if user_a = user_b then
    raise exception 'the two development Auth users must be different';
  end if;
  if not exists (select 1 from auth.users where id = user_a)
    or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'both configured UUIDs must already exist in auth.users';
  end if;
end;
$$;

-- Catalog checks: RLS, three narrowly-scoped policies, grants, and trigger mode.
do $$
declare
  policy_count integer;
begin
  if not coalesce((
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.user_state'::regclass
  ), false) then
    raise exception 'public.user_state must have RLS enabled';
  end if;

  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'user_state'
    and policyname in (
      'user_state_select_own',
      'user_state_insert_own',
      'user_state_update_own'
    )
    and roles = array['authenticated']::name[];
  if policy_count <> 3 then
    raise exception 'expected three authenticated-only user_state policies, found %', policy_count;
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_state'
      and cmd = 'DELETE'
  ) then
    raise exception 'user_state must not expose a DELETE policy';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_state'
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'anon/public must not be named by a user_state policy';
  end if;

  if has_table_privilege('anon', 'public.user_state', 'SELECT')
    or has_table_privilege('anon', 'public.user_state', 'INSERT')
    or has_table_privilege('anon', 'public.user_state', 'UPDATE')
    or has_table_privilege('anon', 'public.user_state', 'DELETE') then
    raise exception 'anon unexpectedly has a user_state table privilege';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = 'public.user_state'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'PUBLIC unexpectedly has a user_state CRUD privilege';
  end if;

  if not has_table_privilege('authenticated', 'public.user_state', 'SELECT')
    or not has_column_privilege('authenticated', 'public.user_state', 'payload', 'INSERT')
    or not has_column_privilege('authenticated', 'public.user_state', 'payload', 'UPDATE') then
    raise exception 'authenticated is missing an intended user_state privilege';
  end if;

  if has_table_privilege('authenticated', 'public.user_state', 'DELETE')
    or has_column_privilege('authenticated', 'public.user_state', 'revision', 'INSERT')
    or has_column_privilege('authenticated', 'public.user_state', 'revision', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_state', 'created_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_state', 'user_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_state', 'namespace', 'UPDATE') then
    raise exception 'authenticated can write a database-managed or immutable column';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.user_state'::regclass
      and t.tgname = 'user_state_before_write_trigger'
      and not t.tgisinternal
      and not p.prosecdef
      and p.proconfig @> array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'expected a SECURITY INVOKER trigger function with a fixed search_path';
  end if;
end;
$$;

-- Isolate the sacrificial users inside this transaction, then seed one row each.
delete from public.user_state
where user_id in (
  current_setting('put_scanner.test_user_a')::uuid,
  current_setting('put_scanner.test_user_b')::uuid
);

insert into public.user_state (
  user_id, namespace, schema_version, payload, revision, created_at, updated_at
)
values
  (
    current_setting('put_scanner.test_user_a')::uuid,
    'portfolio',
    1,
    '{"data":[]}'::jsonb,
    99,
    '2000-01-01T00:00:00Z',
    '2000-01-01T00:00:00Z'
  ),
  (
    current_setting('put_scanner.test_user_b')::uuid,
    'watchlist',
    1,
    '{"data":[]}'::jsonb,
    99,
    '2000-01-01T00:00:00Z',
    '2000-01-01T00:00:00Z'
  );

do $$
begin
  if exists (
    select 1 from public.user_state
    where user_id in (
      current_setting('put_scanner.test_user_a')::uuid,
      current_setting('put_scanner.test_user_b')::uuid
    )
      and (revision <> 1 or created_at <> updated_at or created_at <= '2000-01-01T00:00:00Z')
  ) then
    raise exception 'insert trigger did not canonicalize revision and timestamps';
  end if;
end;
$$;

-- Simulate a regular authenticated JWT for user A.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('put_scanner.test_user_a'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('put_scanner.test_user_a'),
    'role', 'authenticated',
    'is_anonymous', false
  )::text,
  true
);

do $$
declare
  visible_count integer;
  changed_count integer;
  prior_updated_at timestamptz;
begin
  select count(*) into visible_count from public.user_state;
  if visible_count <> 1 then
    raise exception 'user A should see exactly its own seeded row, saw %', visible_count;
  end if;

  insert into public.user_state (user_id, namespace, schema_version, payload)
  values (
    current_setting('put_scanner.test_user_a')::uuid,
    'preferences',
    1,
    '{"data":{"theme":"dark"}}'::jsonb
  );
  if not exists (
    select 1 from public.user_state
    where namespace = 'preferences' and revision = 1
  ) then
    raise exception 'own-row insert did not produce revision 1';
  end if;

  begin
    insert into public.user_state (user_id, namespace, schema_version, payload)
    values (
      current_setting('put_scanner.test_user_b')::uuid,
      'portfolio',
      1,
      '{"data":[]}'::jsonb
    );
    raise exception 'cross-user insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  select updated_at into prior_updated_at
  from public.user_state
  where namespace = 'portfolio';

  update public.user_state
  set payload = '{"data":[{"id":"trade-a"}]}'::jsonb
  where namespace = 'portfolio' and revision = 1;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'fresh compare-and-swap update should affect one row';
  end if;
  if not exists (
    select 1 from public.user_state
    where namespace = 'portfolio'
      and revision = 2
      and updated_at > prior_updated_at
  ) then
    raise exception 'update trigger did not increment revision/timestamp';
  end if;

  update public.user_state
  set payload = '{"data":[]}'::jsonb
  where namespace = 'portfolio' and revision = 1;
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'stale compare-and-swap update unexpectedly succeeded';
  end if;

  update public.user_state
  set payload = '{"data":[]}'::jsonb
  where user_id = current_setting('put_scanner.test_user_b')::uuid;
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'cross-user update unexpectedly succeeded';
  end if;

  begin
    delete from public.user_state
    where user_id = current_setting('put_scanner.test_user_a')::uuid
      and namespace = 'portfolio';
    raise exception 'own-row browser DELETE unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.user_state
    where user_id = current_setting('put_scanner.test_user_b')::uuid;
    raise exception 'cross-user browser DELETE unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.user_state
    set user_id = current_setting('put_scanner.test_user_b')::uuid
    where namespace = 'portfolio';
    raise exception 'authenticated identity update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- Supabase Auth anonymous users carry the authenticated database role. The
-- policies deliberately reject their is_anonymous claim as well as SQL anon.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('put_scanner.test_user_a'),
    'role', 'authenticated',
    'is_anonymous', true
  )::text,
  true
);

do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count from public.user_state;
  if visible_count <> 0 then
    raise exception 'anonymous Auth user unexpectedly read user_state';
  end if;
  begin
    insert into public.user_state (user_id, namespace, schema_version, payload)
    values (
      current_setting('put_scanner.test_user_a')::uuid,
      'watchlist',
      1,
      '{"data":[]}'::jsonb
    );
    raise exception 'anonymous Auth user unexpectedly inserted user_state';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.user_state limit 1;
    raise exception 'anon role unexpectedly read user_state';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- The owner-level checks exercise trigger immutability independently of the
-- authenticated role's deliberately narrower column grants.
reset role;
do $$
declare
  user_a uuid := current_setting('put_scanner.test_user_a')::uuid;
  user_b uuid := current_setting('put_scanner.test_user_b')::uuid;
  original_created_at timestamptz;
begin
  select created_at into original_created_at
  from public.user_state
  where user_id = user_a and namespace = 'portfolio';

  begin
    update public.user_state set user_id = user_b
    where user_id = user_a and namespace = 'portfolio';
    raise exception 'trigger allowed user_id mutation';
  exception when others then
    if sqlerrm <> 'user_state.user_id is immutable' then raise; end if;
  end;

  begin
    update public.user_state set namespace = 'watchlist'
    where user_id = user_a and namespace = 'portfolio';
    raise exception 'trigger allowed namespace mutation';
  exception when others then
    if sqlerrm <> 'user_state.namespace is immutable' then raise; end if;
  end;

  begin
    update public.user_state set created_at = original_created_at - interval '1 day'
    where user_id = user_a and namespace = 'portfolio';
    raise exception 'trigger allowed created_at mutation';
  exception when others then
    if sqlerrm <> 'user_state.created_at is immutable' then raise; end if;
  end;
end;
$$;

rollback;
