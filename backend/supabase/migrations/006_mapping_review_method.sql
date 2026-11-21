-- How a pair was decided, and which relation the AI first gave it.
-- Bulk decisions are not independent examples of how right the AI was, so the learned scores leave them out.
alter table "Item_Mapping"
  add column if not exists "reviewMethod" text check ("reviewMethod" in ('single', 'bulk')),
  add column if not exists "aiRelation" text check ("aiRelation" in ('equivalent', 'partial'));

update "Item_Mapping" set "aiRelation" = "relation" where "aiRelation" is null;
