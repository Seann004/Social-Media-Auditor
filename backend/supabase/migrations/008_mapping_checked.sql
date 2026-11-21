-- A record of every pair the AI has already compared, whether or not it matched them.
-- Without it a pair the AI turned down is offered again on every run, and again from the other guideline.
-- "promptVersion" lets a changed matching prompt re-check the pairs. Run by hand in the Supabase SQL editor. Safe to run twice.
create table if not exists "Mapping_Checked" (
  "itemIdA" uuid not null,
  "itemIdB" uuid not null,
  "promptVersion" text not null,
  "checkedAt" timestamptz not null default now(),
  primary key ("itemIdA", "itemIdB", "promptVersion"),
  check ("itemIdA" < "itemIdB")
);

alter table "Mapping_Checked" enable row level security;
revoke all on "Mapping_Checked" from anon, authenticated;
