ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "scripted_reactions" DROP CONSTRAINT "scripted_reactions_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn'));--> statement-breakpoint
ALTER TABLE "scripted_reactions" ADD CONSTRAINT "scripted_reactions_type" CHECK ("scripted_reactions"."type" in ('read', 'like', 'reply', 'up', 'down', 'remove', 'warn'));