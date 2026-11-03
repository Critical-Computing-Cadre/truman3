ALTER TABLE "content" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing images become the first attachment. Frozen content can't normally change, and this
-- changes only how the same image is stored, so its rule is off for this one step.
ALTER TABLE "content" DISABLE TRIGGER "content_frozen";
--> statement-breakpoint
UPDATE "content"
SET "attachments" = jsonb_build_array(jsonb_build_object('type', 'image', 'key', "media_key"))
WHERE "media_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "content" ENABLE TRIGGER "content_frozen";
--> statement-breakpoint
-- Drafts and packs written before this change have one `picture` on each post.
UPDATE "draft_items"
SET "data" = ("data" - 'picture') || jsonb_build_object('pictures', jsonb_build_array("data" -> 'picture'))
WHERE "kind" = 'post' AND "data" ? 'picture';
--> statement-breakpoint
UPDATE "content_packs"
SET "contents" = jsonb_set("contents", '{posts}', (
  SELECT coalesce(jsonb_agg(
    CASE WHEN post ? 'picture'
      THEN (post - 'picture') || jsonb_build_object('pictures', jsonb_build_array(post -> 'picture'))
      ELSE post
    END ORDER BY place
  ), '[]'::jsonb)
  FROM jsonb_array_elements("contents" -> 'posts') WITH ORDINALITY AS each_post(post, place)
))
WHERE "contents" ? 'posts';
