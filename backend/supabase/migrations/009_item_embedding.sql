-- Vectors of the library items, so items worded differently can still be found as close in meaning.
-- One row per item and model; "textHash" changes when the item's text does, so its vector is made again.
-- Run by hand in the Supabase SQL editor. Safe to run twice.
create table if not exists "Item_Embedding" (
  "itemId" uuid primary key,
  "model" text not null,
  "textHash" text not null,
  "vector" jsonb not null,
  "updatedAt" timestamptz not null default now()
);

alter table "Item_Embedding" enable row level security;
revoke all on "Item_Embedding" from anon, authenticated;
