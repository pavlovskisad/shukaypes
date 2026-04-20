CREATE TABLE IF NOT EXISTS "collect_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accepted" boolean NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companion_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'шукайпес' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"skin_id" text DEFAULT 'default' NOT NULL,
	"hunger" integer DEFAULT 80 NOT NULL,
	"happiness" integer DEFAULT 60 NOT NULL,
	"last_fed_at" timestamp with time zone,
	"last_decay_at" timestamp with time zone DEFAULT now() NOT NULL,
	"memory_notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"value" integer DEFAULT 1 NOT NULL,
	"spawned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lost_dogs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"breed" text NOT NULL,
	"emoji" text DEFAULT '🐕' NOT NULL,
	"photo_url" text,
	"last_seen_lat" double precision NOT NULL,
	"last_seen_lng" double precision NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_seen_description" text,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"search_zone_radius_m" integer DEFAULT 500 NOT NULL,
	"reward_points" integer DEFAULT 100 NOT NULL,
	"source" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reported_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sightings" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"reporter_id" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" text DEFAULT 'regular' NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"value" integer DEFAULT 1 NOT NULL,
	"zone_id" text,
	"spawned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"username" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_distance_meters" integer DEFAULT 0 NOT NULL,
	"home_lat" double precision,
	"home_lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collect_events" ADD CONSTRAINT "collect_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "companion_state" ADD CONSTRAINT "companion_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_items" ADD CONSTRAINT "food_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lost_dogs" ADD CONSTRAINT "lost_dogs_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sightings" ADD CONSTRAINT "sightings_dog_id_lost_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."lost_dogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sightings" ADD CONSTRAINT "sightings_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tokens" ADD CONSTRAINT "tokens_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collect_user_at_idx" ON "collect_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_owner_idx" ON "food_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dogs_status_idx" ON "lost_dogs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_owner_idx" ON "tokens" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_collected_idx" ON "tokens" USING btree ("collected_at");