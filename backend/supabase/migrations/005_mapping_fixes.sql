alter table "Audit_Result"
  add column if not exists "evidenceCount" integer generated always as (
    case when jsonb_typeof("evidenceImages") = 'array' then jsonb_array_length("evidenceImages") else 0 end
  ) stored;

-- older clones whose guideline was deleted and uploaded again
update "Checklist_Item" pi
set "originalItemId" = gi."itemId"
from "Checklist" pc
join "Guideline" pg on pg."guidelineId" = pc."guidelineId"
join "Guideline" gg on gg."guidelineName" = pg."guidelineName" and gg."projectId" is null
join "Checklist" gc on gc."guidelineId" = gg."guidelineId" and gc."projectId" is null
join "Checklist_Item" gi on gi."checklistId" = gc."checklistId"
where pi."checklistId" = pc."checklistId"
  and pc."projectId" is not null
  and pi."originalItemId" is null
  and gi."itemDescription" = pi."itemDescription"
  and gi."itemCode" is not distinct from pi."itemCode";
