CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"work_id" uuid,
	"detail" jsonb,
	"amount" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"score" real,
	"favorite" boolean DEFAULT false NOT NULL,
	"progress" double precision,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"revisit_count" integer DEFAULT 0 NOT NULL,
	"has_new_units" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"work_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_label" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"language" text,
	"region" text,
	"monetization" text DEFAULT 'unknown' NOT NULL,
	"confidence" text NOT NULL,
	"official" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"logo_url" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broken_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unit_progress" (
	"user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_progress_user_id_unit_id_pk" PRIMARY KEY("user_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" double precision,
	"season" integer,
	"title" text,
	"language" text,
	"published_at" timestamp with time zone,
	"runtime" integer,
	"external_url" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"titles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synopsis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cover_url" text,
	"banner_url" text,
	"year" integer,
	"release_status" text DEFAULT 'unknown' NOT NULL,
	"score" real,
	"total_units" integer,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"studios" text[] DEFAULT '{}' NOT NULL,
	"authors" text[] DEFAULT '{}' NOT NULL,
	"available_languages" text[] DEFAULT '{}' NOT NULL,
	"average_runtime" integer,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"next_release_number" double precision,
	"next_release_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"units_refreshed_at" timestamp with time zone,
	"links_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ids" ADD CONSTRAINT "external_ids_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_links" ADD CONSTRAINT "official_links_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_progress" ADD CONSTRAINT "unit_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_progress" ADD CONSTRAINT "unit_progress_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_progress" ADD CONSTRAINT "unit_progress_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_user_date_idx" ON "activity_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_cache_expires_idx" ON "api_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_ids_provider_key" ON "external_ids" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "external_ids_work_idx" ON "external_ids" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_entries_user_work_key" ON "library_entries" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "library_entries_user_status_idx" ON "library_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_links_work_key" ON "official_links" USING btree ("work_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "official_links_work_idx" ON "official_links" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "unit_progress_user_work_idx" ON "unit_progress" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "unit_progress_completed_idx" ON "unit_progress" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "units_work_key" ON "units" USING btree ("work_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "units_work_order_idx" ON "units" USING btree ("work_id","season","number");--> statement-breakpoint
CREATE INDEX "units_published_idx" ON "units" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "works_kind_idx" ON "works" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "works_next_release_idx" ON "works" USING btree ("next_release_at");