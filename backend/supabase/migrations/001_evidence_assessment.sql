-- AI-assisted evidence assessment: schema, row level security, search RPC, private bucket.
--
-- PRE-CHECK: run this in the Supabase SQL editor first.
--   select table_name, column_name, data_type from information_schema.columns
--   where column_name in ('projectId','itemId','userId')
--     and table_name in ('Audit_Project','Checklist_Item','User');
-- This file assumes those columns are uuid. If any is text, the referencing
-- columns below ("projectId", "itemId", "userId") must change to match.
--
-- Every table has row level security enabled and no policies, so the anon and
-- authenticated roles are refused. Only the backend (service role) reads or writes.

create extension if not exists pgcrypto;

create table if not exists "Evidence_Source" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "type" text not null default 'url' check ("type" in ('url', 'test_account', 'journey')),
  "startUrls" jsonb not null default '[]'::jsonb,
  "createdBy" uuid references "User"("userId") on delete set null,
  "createdAt" timestamptz not null default now()
);
alter table "Evidence_Source" enable row level security;
create index if not exists "idx_evidence_source_project" on "Evidence_Source"("projectId");

create table if not exists "Evidence_Permission" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "granted" boolean not null,
  "note" text,
  "recordedBy" uuid references "User"("userId") on delete set null,
  "recordedAt" timestamptz not null default now()
);
alter table "Evidence_Permission" enable row level security;
create index if not exists "idx_evidence_permission_project" on "Evidence_Permission"("projectId", "recordedAt" desc);

create table if not exists "Evidence_Run" (
  "id" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "startedBy" uuid references "User"("userId") on delete set null,
  "status" text not null default 'queued'
    check ("status" in ('queued', 'capturing', 'assessing', 'completed', 'failed', 'partial')),
  "capturedInRunId" uuid, -- run whose pages are used; its own id for capture runs
  "scope" text not null default 'all' check ("scope" in ('all', 'unfinished')),
  "unassessedCategories" jsonb not null default '[]'::jsonb,
  "categoriesTotal" integer not null default 0,
  "categoriesDone" integer not null default 0,
  "pagesTotal" integer not null default 0,
  "pagesDone" integer not null default 0,
  "tokensUsed" integer not null default 0,
  "model" text,
  "promptVersion" text,
  "error" text,
  "createdAt" timestamptz not null default now(),
  "startedAt" timestamptz,
  "finishedAt" timestamptz
);
alter table "Evidence_Run" enable row level security;
create index if not exists "idx_evidence_run_project" on "Evidence_Run"("projectId", "createdAt" desc);

create table if not exists "Evidence_Page" (
  "id" uuid primary key default gen_random_uuid(),
  "runId" uuid not null references "Evidence_Run"("id") on delete cascade,
  "url" text not null,
  "finalUrl" text,
  "httpStatus" integer,
  "accessStatus" text not null
    check ("accessStatus" in ('ok', 'error', 'timeout', 'login_required', 'blocked')),
  "accessDetail" text,
  "title" text,
  "text" text,
  "accessibilitySnapshot" jsonb,
  "screenshotPath" text,
  "contentHash" text,
  "capturedAt" timestamptz not null default now()
);
alter table "Evidence_Page" enable row level security;
create index if not exists "idx_evidence_page_run" on "Evidence_Page"("runId");

create table if not exists "Evidence_Passage" (
  "id" uuid primary key default gen_random_uuid(),
  "pageId" uuid not null references "Evidence_Page"("id") on delete cascade,
  "position" integer not null,
  "kind" text not null default 'text' check ("kind" in ('text', 'controls')),
  "text" text not null,
  "searchIndex" tsvector generated always as (to_tsvector('english', "text")) stored
);
alter table "Evidence_Passage" enable row level security;
create index if not exists "idx_evidence_passage_page" on "Evidence_Passage"("pageId", "position");
create index if not exists "idx_evidence_passage_search" on "Evidence_Passage" using gin ("searchIndex");

create table if not exists "AI_Suggestion" (
  "id" uuid primary key default gen_random_uuid(),
  "runId" uuid not null references "Evidence_Run"("id") on delete cascade,
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  -- null when the evidence does not settle the item
  "suggestedResult" text check ("suggestedResult" in ('yes', 'no', 'partially', 'not_applicable')),
  "reason" text not null default '',
  "confidence" text not null default 'low' check ("confidence" in ('high', 'medium', 'low')),
  "flags" jsonb not null default '[]'::jsonb,
  -- ids of the passages sent to the AI in the call that made this suggestion (spec 7.5)
  "passageIdsSent" jsonb not null default '[]'::jsonb,
  -- on a copy carried forward by a re-assess: the suggestion first assessed. Null when this run assessed it.
  "originSuggestionId" uuid references "AI_Suggestion"("id") on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("runId", "itemId")
);
alter table "AI_Suggestion" enable row level security;
create index if not exists "idx_ai_suggestion_project_item" on "AI_Suggestion"("projectId", "itemId");

create table if not exists "AI_Suggestion_Quote" (
  "id" uuid primary key default gen_random_uuid(),
  "suggestionId" uuid not null references "AI_Suggestion"("id") on delete cascade,
  -- nullable: an AI quote naming an unknown passage is kept, unverified
  "passageId" uuid references "Evidence_Passage"("id") on delete set null,
  "pageId" uuid references "Evidence_Page"("id") on delete set null,
  "quoteText" text not null,
  "verified" boolean not null default false,
  "highlightScreenshotPath" text
);
alter table "AI_Suggestion_Quote" enable row level security;
create index if not exists "idx_ai_suggestion_quote_suggestion" on "AI_Suggestion_Quote"("suggestionId");

create table if not exists "AI_Suggestion_Decision" (
  "id" uuid primary key default gen_random_uuid(),
  "suggestionId" uuid not null references "AI_Suggestion"("id") on delete cascade,
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "userId" uuid references "User"("userId") on delete set null,
  "decision" text not null check ("decision" in ('accepted', 'overridden')),
  "finalResult" text not null
    check ("finalResult" in ('compliant', 'non_compliant', 'partially', 'not_applicable')),
  "overrideReason" text,
  "origin" text not null default 'card' check ("origin" in ('card', 'answer_button', 'auto_match')),
  "decidedAt" timestamptz not null default now()
);
alter table "AI_Suggestion_Decision" enable row level security;
create index if not exists "idx_ai_decision_item" on "AI_Suggestion_Decision"("projectId", "itemId", "decidedAt" desc);
create index on "AI_Suggestion"("originSuggestionId");

-- Full-text search over a run's passages. Terms are OR-ed because an AND search
-- on a whole checklist question finds nothing. An empty query returns no rows.
create or replace function search_evidence_passages(p_run_id uuid, p_query text, p_limit int)
returns table ("id" uuid, "pageId" uuid, "position" integer, "kind" text, "text" text, "rank" real)
language plpgsql
stable
as $$
declare
  q tsquery;
begin
  select string_agg(quote_literal(l), ' | ')::tsquery
    into q
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) as l;
  if q is null then
    return;
  end if;
  return query
    select ps."id", ps."pageId", ps."position", ps."kind", ps."text",
           ts_rank(ps."searchIndex", q) as "rank"
      from "Evidence_Passage" ps
      join "Evidence_Page" pg on pg."id" = ps."pageId"
     where pg."runId" = p_run_id
       and ps."searchIndex" @@ q
     order by ts_rank(ps."searchIndex", q) desc, ps."position"
     limit greatest(p_limit, 0);
end;
$$;

revoke all on function search_evidence_passages(uuid, text, int) from public, anon, authenticated;
grant execute on function search_evidence_passages(uuid, text, int) to service_role;

-- Private bucket for screenshots; viewed through short-lived signed links only.
insert into storage.buckets (id, name, public)
values ('evidence-screenshots', 'evidence-screenshots', false)
on conflict do nothing;
