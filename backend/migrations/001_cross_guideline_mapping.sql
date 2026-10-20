alter table "Checklist_Item"
  add column if not exists "originalItemId" uuid references "Checklist_Item"("itemId") on delete set null;

-- link items that were cloned into projects before this column existed
update "Checklist_Item" pi
set "originalItemId" = gi."itemId"
from "Checklist" pc
join "Guideline" pg on pg."guidelineId" = pc."guidelineId"
join "Checklist" gc on gc."guidelineId" = pg."originalGuidelineId" and gc."projectId" is null
join "Checklist_Item" gi on gi."checklistId" = gc."checklistId"
where pi."checklistId" = pc."checklistId"
  and pc."projectId" is not null
  and pi."originalItemId" is null
  and gi."itemDescription" = pi."itemDescription"
  and gi."itemCode" is not distinct from pi."itemCode";

create table if not exists "Item_Mapping" (
  "mappingId" uuid primary key default gen_random_uuid(),
  "itemIdA" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "itemIdB" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "relation" text not null check ("relation" in ('equivalent', 'partial')),
  "confidence" numeric,
  "rationale" text,
  "status" text not null default 'suggested' check ("status" in ('suggested', 'confirmed', 'rejected')),
  "createdAt" timestamptz not null default now(),
  "reviewedBy" uuid references "User"("userId") on delete set null,
  "reviewedAt" timestamptz,
  constraint item_mapping_order check ("itemIdA" < "itemIdB"),
  constraint item_mapping_pair unique ("itemIdA", "itemIdB")
);

create table if not exists "Suggestion_Decision" (
  "decisionId" uuid primary key default gen_random_uuid(),
  "projectId" uuid not null references "Audit_Project"("projectId") on delete cascade,
  "itemId" uuid not null references "Checklist_Item"("itemId") on delete cascade,
  "sourceProjectId" uuid references "Audit_Project"("projectId") on delete set null,
  "sourceItemId" uuid references "Checklist_Item"("itemId") on delete set null,
  "userId" uuid not null references "User"("userId") on delete cascade,
  "decision" text not null check ("decision" in ('accepted', 'dismissed')),
  "decidedAt" timestamptz not null default now()
);

create index if not exists checklist_item_original_idx on "Checklist_Item"("originalItemId");
create index if not exists suggestion_decision_project_idx on "Suggestion_Decision"("projectId", "userId");
