-- Per-project decisions on cross-guideline links.
--
-- A link between two guideline items (Item_Mapping) is proposed once and shared. Whether a project
-- USES it is that project's own decision, made by its head auditor, so one project's choice never
-- changes another's. A project with no decision falls back to the shared status.
--
-- Run in the Supabase SQL editor after 004 and 005. Safe to run twice.
-- Like Item_Mapping this table has no row level security: the main API uses the anon key, so with
-- row level security on and no policy every write is refused (and every read comes back empty).
-- The Supabase SQL editor can create tables with it on, hence the explicit line at the end.

create table if not exists "Project_Mapping_Decision" (
  "decisionId" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "mappingId" uuid not null references "Item_Mapping"("mappingId") on delete cascade,
  "status" text not null check ("status" in ('confirmed', 'rejected')),
  "relation" text check ("relation" in ('equivalent', 'partial')),
  "decidedBy" uuid references "User"("userId") on delete set null,
  "decidedAt" timestamptz not null default now(),
  constraint project_mapping_decision_pair unique ("projectId", "mappingId")
);

create index if not exists project_mapping_decision_project_idx on "Project_Mapping_Decision"("projectId");

alter table "Project_Mapping_Decision" disable row level security;
