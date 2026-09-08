CREATE TABLE "release_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid,
	"label" text,
	"frequency" text NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"time_of_day" text DEFAULT '12:00' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"start_number" double precision,
	"increment" double precision DEFAULT 1 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_schedules" ADD CONSTRAINT "release_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_schedules" ADD CONSTRAINT "release_schedules_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_schedules_user_idx" ON "release_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "release_schedules_work_idx" ON "release_schedules" USING btree ("user_id","work_id");