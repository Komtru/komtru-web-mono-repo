CREATE TABLE "identity"."user_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"street_line" text NOT NULL,
	"landmark" text,
	"state_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_addresses_phone_e164" CHECK ("identity"."user_addresses"."recipient_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "user_addresses_default_is_live" CHECK (NOT ("identity"."user_addresses"."is_default" AND "identity"."user_addresses"."archived_at" IS NOT NULL)),
	CONSTRAINT "user_addresses_text_not_blank" CHECK (length(btrim("identity"."user_addresses"."label")) > 0 AND length(btrim("identity"."user_addresses"."recipient_name")) > 0 AND length(btrim("identity"."user_addresses"."street_line")) > 0)
);
--> statement-breakpoint
ALTER TABLE "identity"."user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_addresses_one_default" ON "identity"."user_addresses" USING btree ("user_id") WHERE "identity"."user_addresses"."is_default";--> statement-breakpoint
CREATE INDEX "user_addresses_live_idx" ON "identity"."user_addresses" USING btree ("user_id","is_default" DESC NULLS FIRST,"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "identity"."user_addresses"."archived_at" IS NULL;--> statement-breakpoint
-- T-042: an address is archived, never deleted. A trade snapshots the address it ships to, and support
-- reads what a buyer had on file, so no writer may remove a row, this module's code or anyone else's,
-- the owner included. DELETE raises KT002 (the same code geo.reject_delete uses). UPDATE stays allowed:
-- editing and archiving are updates. A row trigger does not fire on TRUNCATE, which the test harness
-- uses between tests and which komtru_app cannot do.
CREATE FUNCTION identity.reject_address_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'komtru: %.% rows are archived, never deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'KT002';
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "identity"."user_addresses" FOR EACH ROW EXECUTE FUNCTION identity.reject_address_delete();
--> statement-breakpoint
REVOKE DELETE ON "identity"."user_addresses" FROM komtru_app;
