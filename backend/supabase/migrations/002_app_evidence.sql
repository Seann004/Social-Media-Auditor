-- App evidence: the AI checks items by using a platform's web app with test accounts.
--
-- PRE-CHECK: run this in the Supabase SQL editor first.
--   select to_regclass('public."Evidence_Run"'), to_regclass('public."AI_Suggestion"'), to_regclass('public."Evidence_Page"');
-- All three must be non-null, meaning migration 001 is applied.
-- This file only adds tables and columns; running it twice is harmless.
--
-- App runs reuse the run statuses: capturing means "checking in the app" and
-- assessing means judging. The status check on Evidence_Run is not altered.
-- Every new table has row level security enabled and no policies, so the anon
-- and authenticated roles are refused. Only the backend (service role) reads or writes.

alter table "Evidence_Run"
  add column if not exists "source" text not null default 'pages' check ("source" in ('pages','app'));
alter table "Evidence_Run"
  add column if not exists "checkedItemIds" jsonb not null default '[]'::jsonb;
alter table "Evidence_Run"
  add column if not exists "uncheckedItemIds" jsonb not null default '[]'::jsonb;
-- Progress only, so no foreign key.
alter table "Evidence_Run"
  add column if not exists "currentItemId" uuid;
alter table "Evidence_Run"
  add column if not exists "currentStep" integer not null default 0;

alter table "AI_Suggestion"
  add column if not exists "source" text not null default 'pages' check ("source" in ('pages','app'));

create table if not exists "Evidence_App_Source" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null unique references "Audit_Project"("projectId") on delete cascade,
  "appUrl" text not null,
  "loginDomains" jsonb not null default '[]'::jsonb,
  "updatedBy" uuid references "User"("userId") on delete set null,
  "updatedAt" timestamptz not null default now()
);
alter table "Evidence_App_Source" enable row level security;

create table if not exists "Evidence_Test_Account" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "label" text not null,
  "ageGroup" text not null check ("ageGroup" in ('under_18','adult')),
  "age" integer check ("age" between 0 and 120),
  "loginName" text not null,
  "handles" jsonb not null default '[]'::jsonb,
  "passwordCiphertext" text not null,
  "createdBy" uuid references "User"("userId") on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("projectId", "label")
);
alter table "Evidence_Test_Account" enable row level security;

create table if not exists "Evidence_App_Step" (
  "id" uuid primary key default gen_random_uuid(),
  "runId" uuid not null references "Evidence_Run"("id") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "position" integer not null,
  "accountId" uuid references "Evidence_Test_Account"("id") on delete set null,
  "accountLabel" text,
  "action" jsonb not null,
  "line" text not null,
  "outcome" text not null check ("outcome" in ('done','refused','failed','blocked')),
  "refusalReason" text,
  "pageId" uuid references "Evidence_Page"("id") on delete set null,
  "createdAt" timestamptz not null default now()
);
alter table "Evidence_App_Step" enable row level security;
create index if not exists "idx_evidence_app_step_run_item_position" on "Evidence_App_Step"("runId", "itemId", "position");

create table if not exists "Evidence_App_Change" (
  "id" uuid primary key default gen_random_uuid(),
  "runId" uuid not null references "Evidence_Run"("id") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "accountId" uuid references "Evidence_Test_Account"("id") on delete set null,
  "accountLabel" text not null,
  "pageUrl" text not null,
  "role" text not null,
  "control" text not null,
  "before" text not null,
  "after" text not null,
  "saveControl" text,
  "restored" boolean not null default false,
  "restoreDetail" text,
  "createdAt" timestamptz not null default now()
);
alter table "Evidence_App_Change" enable row level security;
create index if not exists "idx_evidence_app_change_run_item" on "Evidence_App_Change"("runId", "itemId");
