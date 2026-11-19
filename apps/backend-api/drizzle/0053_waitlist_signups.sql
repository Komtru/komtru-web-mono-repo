CREATE SCHEMA "waitlist";
--> statement-breakpoint
CREATE TABLE "waitlist"."signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text NOT NULL,
	"contact_key" text NOT NULL,
	"channel" text NOT NULL,
	"intent" text NOT NULL,
	"city" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signups_channel" CHECK ("waitlist"."signups"."channel" IN ('EMAIL', 'PHONE')),
	CONSTRAINT "signups_intent" CHECK ("waitlist"."signups"."intent" IN ('BUY', 'SELL', 'BOTH'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signups_contact_key" ON "waitlist"."signups" USING btree ("contact_key");--> statement-breakpoint
CREATE INDEX "signups_city_idx" ON "waitlist"."signups" USING btree ("city","created_at");