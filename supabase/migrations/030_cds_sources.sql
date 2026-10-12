-- Phase 20b: allow 'cds' as the source of imported measurements and photos
-- (CDS / WebForFashion import, migration 029). Additive: the existing values stay.

alter table public.talent_measurements drop constraint if exists talent_measurements_source_check;
alter table public.talent_measurements add constraint talent_measurements_source_check
  check (source in ('staff', 'ghl', 'portal', 'application', 'cds'));

alter table public.talent_photos drop constraint if exists talent_photos_source_check;
alter table public.talent_photos add constraint talent_photos_source_check
  check (source in ('upload', 'portal', 'application', 'ghl', 'cds'));
