-- Requested store details; retain all other contact fields and closed days.
INSERT INTO settings (key, value_json) VALUES ('store.contact', '{"phoneMobile":"09121230077","phoneLand":""}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value_json = settings.value_json || '{"phoneLand":""}'::jsonb, updated_at = now();
--> statement-breakpoint
INSERT INTO settings (key, value_json)
VALUES ('store.hours', jsonb_build_object('days', (SELECT jsonb_object_agg(day, jsonb_build_object('open', '09:00', 'close', '18:00')) FROM unnest(ARRAY['sat','sun','mon','tue','wed','thu','fri']) AS day), 'note', 'همه‌روزه ۹ صبح تا ۶ عصر'))
ON CONFLICT (key) DO UPDATE SET value_json = jsonb_build_object(
  'days', (SELECT jsonb_object_agg(day, CASE WHEN settings.value_json->'days'->day = 'null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('open', '09:00', 'close', '18:00') END) FROM unnest(ARRAY['sat','sun','mon','tue','wed','thu','fri']) AS day),
  'note', 'ساعت کاری ۹ صبح تا ۶ عصر'
), updated_at = now();
