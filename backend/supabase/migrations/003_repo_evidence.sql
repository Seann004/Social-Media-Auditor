-- Repo evidence: the AI checks items against the code of a public GitHub repository.
--
-- PRE-CHECK: run this in the Supabase SQL editor first.
--   select to_regclass('public."Evidence_App_Source"'), to_regclass('public."Evidence_Run"'), to_regclass('public."Evidence_Page"');
-- All three must be non-null, meaning migrations 001 and 002 are applied.
-- Apart from the two source checks below, this file only adds tables; running it twice is harmless.
--
-- The source checks that migration 002 added on Evidence_Run and AI_Suggestion are replaced so
-- that they also allow 'repo'. The names are the ones Postgres gave them by default.
-- Every new table has row level security enabled and no policies, so the public roles are
-- refused. Only the backend (service role) reads or writes.

alter table "Evidence_Run" drop constraint if exists "Evidence_Run_source_check";
alter table "Evidence_Run"
  add constraint "Evidence_Run_source_check" check ("source" in ('pages','app','repo'));

alter table "AI_Suggestion" drop constraint if exists "AI_Suggestion_source_check";
alter table "AI_Suggestion"
  add constraint "AI_Suggestion_source_check" check ("source" in ('pages','app','repo'));

create table if not exists "Evidence_Repo_Source" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null unique references "Audit_Project"("projectId") on delete cascade,
  "repoUrl" text not null,
  "owner" text not null,
  "name" text not null,
  "branch" text,
  "updatedBy" uuid references "User"("userId") on delete set null,
  "updatedAt" timestamptz not null default now()
);
alter table "Evidence_Repo_Source" enable row level security;

create table if not exists "Evidence_Repo_Snapshot" (
  "runId" uuid primary key references "Evidence_Run"("id") on delete cascade,
  "repoUrl" text not null,
  "owner" text not null,
  "name" text not null,
  "branch" text,
  "commitSha" text not null,
  "filesRead" integer not null default 0,
  "filesSkipped" integer not null default 0,
  "truncated" boolean not null default false,
  "createdAt" timestamptz not null default now()
);
alter table "Evidence_Repo_Snapshot" enable row level security;

create table if not exists "Evidence_Repo_Piece" (
  "id" uuid primary key default gen_random_uuid(),
  "runId" uuid not null references "Evidence_Run"("id") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "pageId" uuid not null references "Evidence_Page"("id") on delete cascade,
  "path" text not null,
  "startLine" integer not null,
  "endLine" integer not null,
  "commitSha" text not null,
  "round" integer not null check ("round" in (1, 2)),
  "position" integer not null default 0,
  "createdAt" timestamptz not null default now()
);
alter table "Evidence_Repo_Piece" enable row level security;
create index if not exists "idx_evidence_repo_piece_run_item" on "Evidence_Repo_Piece"("runId", "itemId");
