import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const securityTestPath = path.join(root, 'supabase', 'tests', 'user_state_security.sql');

const compact = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

async function migrationSource() {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(names, ['20260820154219_create_user_state.sql']);
  assert.equal(names.some((name) => /flowboard|create_(tables|rls_policies|triggers)/i.test(name)), false);
  return readFile(path.join(migrationsDir, names[0]), 'utf8');
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  }));
  return nested.flat();
}

test('Stage 2A migration is a single clean Put Scanner baseline', async () => {
  const sql = compact(await migrationSource());
  assert.match(sql, /create table public\.user_state/);
  assert.match(sql, /primary key \(user_id, namespace\)/);
  assert.match(sql, /references auth\.users \(id\) on delete cascade/);
  assert.match(sql, /namespace in \('portfolio', 'watchlist', 'preferences'\)/);
  assert.match(sql, /check \(schema_version > 0\)/);
  assert.match(sql, /check \(jsonb_typeof\(payload\) = 'object'\)/);
  assert.match(sql, /revision bigint not null default 1/);
  assert.equal(/create\s+(?:unique\s+)?index/.test(sql), false);
});

test('RLS is deny-by-default and every own-row operation is explicit', async () => {
  const sql = compact(await migrationSource());
  assert.match(sql, /alter table public\.user_state enable row level security/);
  assert.equal((sql.match(/create policy /g) ?? []).length, 4);
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`create policy "user_state_${operation}_own"`));
  }
  assert.equal((sql.match(/create policy [^;]+?to authenticated/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /to anon/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/);
  assert.match(
    sql,
    /create policy "user_state_update_own"[\s\S]*?for update[\s\S]*?using \([\s\S]*?auth\.uid\(\)[\s\S]*?\) with check \([\s\S]*?auth\.uid\(\)/,
  );
  assert.equal((sql.match(/is_anonymous/g) ?? []).length, 5);
});

test('table privileges expose payload operations but not managed metadata writes', async () => {
  const sql = compact(await migrationSource());
  assert.match(sql, /revoke all privileges on table public\.user_state from public, anon, authenticated/);
  assert.match(sql, /grant select, delete on table public\.user_state to authenticated/);
  assert.match(sql, /grant insert \(user_id, namespace, schema_version, payload\) on table public\.user_state to authenticated/);
  assert.match(sql, /grant update \(schema_version, payload\) on table public\.user_state to authenticated/);
  assert.doesNotMatch(sql, /grant (?:all|insert|update)[^;]*(?:revision|created_at|updated_at)/);
});

test('trigger owns revisions and protects row identity', async () => {
  const sql = compact(await migrationSource());
  assert.match(sql, /create function public\.user_state_before_write\(\) returns trigger language plpgsql security invoker set search_path = pg_catalog/);
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /new\.revision := 1/);
  assert.match(sql, /new\.revision := old\.revision \+ 1/);
  assert.match(sql, /new\.updated_at := greatest\(write_time, old\.updated_at \+ interval '1 microsecond'\)/);
  for (const column of ['user_id', 'namespace', 'created_at']) {
    assert.match(sql, new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  }
  assert.match(sql, /before insert or update on public\.user_state/);
});

test('controlled SQL security test covers isolation, CAS, anonymity, and rollback', async () => {
  const sql = compact(await readFile(securityTestPath, 'utf8'));
  assert.match(sql, /^-- put scanner stage 2a controlled-development security checks\./);
  assert.match(sql, /begin;/);
  assert.match(sql, /set local role authenticated/);
  assert.match(sql, /set local role anon/);
  assert.match(sql, /cross-user insert/);
  assert.match(sql, /cross-user update/);
  assert.match(sql, /cross-user delete/);
  assert.match(sql, /stale compare-and-swap/);
  assert.match(sql, /is_anonymous', true/);
  assert.match(sql, /trigger allowed user_id mutation/);
  assert.match(sql, /trigger allowed namespace mutation/);
  assert.match(sql, /trigger allowed created_at mutation/);
  assert.match(sql, /rollback;$/);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?(?:table|function|policy)/);
});

test('Stage 2A introduces no Supabase runtime initialization or browser secret', async () => {
  const sourceFiles = (await filesUnder(path.join(root, 'src')))
    .filter((name) => /\.(?:js|jsx|ts|tsx)$/.test(name));
  const apiFiles = await filesUnder(path.join(root, 'api'));
  const combined = await Promise.all([...sourceFiles, ...apiFiles].map((name) => readFile(name, 'utf8')));
  const runtime = combined.join('\n');
  assert.doesNotMatch(runtime, /@supabase\/supabase-js/);
  assert.doesNotMatch(runtime, /\bcreateClient\s*\(/);
  assert.doesNotMatch(runtime, /VITE_[A-Z0-9_]*SUPABASE/);
  assert.doesNotMatch(runtime, /(?:SUPABASE_SECRET_KEY|service_role|sb_secret_)/i);
});
