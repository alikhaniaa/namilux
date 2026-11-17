-- 0009_media_fold - the worker folds a duplicate upload into the image the library already holds.
--   When an uploaded file turns out to be byte-identical to an image already in the library, its
--   final storage key collides with that image's (media_storage_key_uq) and media-process must retire
--   the new row in favour of the old one. The worker role may not DELETE from `media` or touch
--   `product_images` (roles.sql; the roles test pins «nl_worker cannot delete media»), so every such
--   upload died as a dead job - «permission denied for table media» - and left a row whose storage
--   key still points under tmp/ (seen on the box: 29 Aug, and three uploads on 22 Sep 2026).
--
--   nl_media_fold is that one fold and nothing more. SECURITY DEFINER, executable by nl_worker only:
--     • it refuses to remove any row that is not still an unprocessed upload (storage_key under tmp/),
--       so the worker's reach grows by exactly this case and `delete from media` stays refused;
--     • before the delete it moves every reference to the twin: product images (a product that
--       already shows the twin keeps that row, promoted to primary when the duplicate was the
--       primary), banners, brand logos, collection and post covers, product swatches and videos.
--
-- DEPENDS ON  0001_init (media, product_images and the tables that reference media)
CREATE OR REPLACE FUNCTION nl_media_fold(dup text, twin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  IF dup IS NULL OR twin IS NULL OR dup = twin THEN
    RAISE EXCEPTION 'nl_media_fold: two different media ids are required';
  END IF;
  PERFORM 1 FROM media WHERE id = dup AND storage_key LIKE 'tmp/%' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nl_media_fold: % is not an unprocessed upload', dup;
  END IF;
  PERFORM 1 FROM media WHERE id = twin FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nl_media_fold: % does not exist', twin;
  END IF;

  FOR r IN SELECT id, product_id, role FROM product_images WHERE media_id = dup LOOP
    IF EXISTS (SELECT 1 FROM product_images WHERE product_id = r.product_id AND media_id = twin) THEN
      DELETE FROM product_images WHERE id = r.id;
      IF r.role = 'primary' THEN
        UPDATE product_images SET role = 'primary' WHERE product_id = r.product_id AND media_id = twin;
      END IF;
    ELSE
      UPDATE product_images SET media_id = twin WHERE id = r.id;
    END IF;
  END LOOP;

  UPDATE banners SET media_light_id = twin WHERE media_light_id = dup;
  UPDATE banners SET media_dark_id = twin WHERE media_dark_id = dup;
  UPDATE brands SET logo_media_id = twin WHERE logo_media_id = dup;
  UPDATE collections SET cover_media_id = twin WHERE cover_media_id = dup;
  UPDATE collections SET cover_dark_media_id = twin WHERE cover_dark_media_id = dup;
  UPDATE posts SET cover_media_id = twin WHERE cover_media_id = dup;
  UPDATE products SET swatch_media_id = twin WHERE swatch_media_id = dup;
  UPDATE products SET video_media_id = twin WHERE video_media_id = dup;

  DELETE FROM media WHERE id = dup;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION nl_media_fold(text, text) FROM PUBLIC;
--> statement-breakpoint
-- MANUAL: the grant roles.sql also carries, here too because a release runs migrations before
-- `pnpm db:roles`; guarded because a test database may be migrated before the roles exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_worker') THEN
    GRANT EXECUTE ON FUNCTION nl_media_fold(text, text) TO nl_worker;
  END IF;
END
$$;
