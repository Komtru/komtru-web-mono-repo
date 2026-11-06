CREATE SCHEMA "geo";
--> statement-breakpoint
CREATE TABLE "geo"."cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seed_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_normalised_name_not_blank" CHECK (length("geo"."cities"."normalised_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "geo"."city_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"state_id" uuid NOT NULL,
	"city_name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_city_id" uuid,
	"decided_by_admin_id" uuid,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "city_requests_status" CHECK ("geo"."city_requests"."status" IN ('PENDING', 'ADDED', 'MERGED', 'REJECTED')),
	CONSTRAINT "city_requests_decision_shape" CHECK (("geo"."city_requests"."status" = 'PENDING' AND "geo"."city_requests"."decided_at" IS NULL AND "geo"."city_requests"."decided_by_admin_id" IS NULL AND "geo"."city_requests"."resolved_city_id" IS NULL)
        OR ("geo"."city_requests"."status" IN ('ADDED', 'MERGED') AND "geo"."city_requests"."decided_at" IS NOT NULL AND "geo"."city_requests"."decided_by_admin_id" IS NOT NULL AND "geo"."city_requests"."resolved_city_id" IS NOT NULL)
        OR ("geo"."city_requests"."status" = 'REJECTED' AND "geo"."city_requests"."decided_at" IS NOT NULL AND "geo"."city_requests"."decided_by_admin_id" IS NOT NULL AND "geo"."city_requests"."decision_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "geo"."states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geo"."cities" ADD CONSTRAINT "cities_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "geo"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo"."city_requests" ADD CONSTRAINT "city_requests_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "geo"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo"."city_requests" ADD CONSTRAINT "city_requests_resolved_city_id_cities_id_fk" FOREIGN KEY ("resolved_city_id") REFERENCES "geo"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_state_normalised_name_unique" ON "geo"."cities" USING btree ("state_id","normalised_name");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_seed_key_unique" ON "geo"."cities" USING btree ("seed_key");--> statement-breakpoint
CREATE INDEX "cities_normalised_name_prefix_idx" ON "geo"."cities" USING btree ("normalised_name" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "city_requests_pending_per_user" ON "geo"."city_requests" USING btree ("requested_by_user_id","state_id","normalised_name") WHERE "geo"."city_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "city_requests_queue_idx" ON "geo"."city_requests" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "city_requests_group_idx" ON "geo"."city_requests" USING btree ("state_id","normalised_name");--> statement-breakpoint
CREATE UNIQUE INDEX "states_code_unique" ON "geo"."states" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "states_normalised_name_unique" ON "geo"."states" USING btree ("normalised_name");