-- Security finding S-0: lock the database against the public anon key.
--
-- The anon key ships in the browser bundle, so anyone can use it. Before this migration it could read
-- (and write) the core tables, including "User" with every email and password hash. The backend checks
-- every request itself and, from this change on, talks to Supabase with the service-role key, which
-- row level security does not apply to. So the anon and authenticated roles need no table access at all.
--
-- The one exception: the browser listens for new guidelines (Supabase Realtime on "Guideline"), so anon
-- keeps read access to that table only. Guidelines are published regulatory frameworks, not private data.
--
-- Before running: set SUPABASE_SERVICE_ROLE_KEY in backend/.env and restart the backend. Otherwise the
-- backend still uses the anon key and every request fails after this runs.
-- Run by hand in the Supabase SQL editor, like the earlier migrations. Safe to run twice.

begin;

-- 1. Row level security on every table in the public schema, including tables made before the migrations.
do $$
declare t record;
begin
  for t in select tablename from pg_tables
           where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2. Remove every policy that lets a public role in (a policy would otherwise keep a table open).
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- 3. No table or sequence rights for the public roles, now or for tables created later.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 4. The single exception: read-only access to guidelines for the live guideline list.
grant select on "Guideline" to anon;
create policy "anon_read_guidelines" on "Guideline"
  for select to anon using (true);

-- 5. The login check answers whether an email and password match. Called with the anon key it would skip
--    the backend's login rate limit, so only the service role may call it (every overload of the name).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'verify_user_login'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

commit;
