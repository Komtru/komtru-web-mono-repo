-- T-061: a terms version carries the proposer's own address; the other side is filled by whoever
-- accepts. The shape checks therefore allow NULL, and a new check keeps at least one side present.
-- Each check goes in NOT VALID and is validated straight away: validation takes only SHARE UPDATE
-- EXCLUSIVE (reads and writes carry on), and the add-then-validate order keeps the ACCESS EXCLUSIVE
-- window to the catalog change. Every existing row already satisfies all three (both columns were
-- NOT NULL and shape-checked before), so validation passes.
CREATE TABLE "trade"."trade_proof_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"attached_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" DROP CONSTRAINT "trade_terms_delivery_address_shape";--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" DROP CONSTRAINT "trade_terms_ships_from_address_shape";--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ALTER COLUMN "delivery_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ALTER COLUMN "ships_from_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade"."trade_proof_media" ADD CONSTRAINT "trade_proof_media_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_proof_media_trade_file" ON "trade"."trade_proof_media" USING btree ("trade_id","file_id");--> statement-breakpoint
CREATE INDEX "trade_proof_media_trade_idx" ON "trade"."trade_proof_media" USING btree ("trade_id");--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ADD CONSTRAINT "trade_terms_delivery_address_shape" CHECK ("trade"."trade_terms_versions"."delivery_address" IS NULL OR ("trade"."trade_terms_versions"."delivery_address" ?& array['street', 'landmark', 'recipient', 'state_id', 'city_id']
      AND length(coalesce("trade"."trade_terms_versions"."delivery_address" ->> 'street', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."delivery_address" ->> 'recipient', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."delivery_address" ->> 'state_id', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."delivery_address" ->> 'city_id', '')) > 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ADD CONSTRAINT "trade_terms_ships_from_address_shape" CHECK ("trade"."trade_terms_versions"."ships_from_address" IS NULL OR ("trade"."trade_terms_versions"."ships_from_address" ?& array['street', 'landmark', 'recipient', 'state_id', 'city_id']
      AND length(coalesce("trade"."trade_terms_versions"."ships_from_address" ->> 'street', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."ships_from_address" ->> 'recipient', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."ships_from_address" ->> 'state_id', '')) > 0
      AND length(coalesce("trade"."trade_terms_versions"."ships_from_address" ->> 'city_id', '')) > 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ADD CONSTRAINT "trade_terms_has_an_address" CHECK ("trade"."trade_terms_versions"."delivery_address" IS NOT NULL OR "trade"."trade_terms_versions"."ships_from_address" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" VALIDATE CONSTRAINT "trade_terms_delivery_address_shape";--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" VALIDATE CONSTRAINT "trade_terms_ships_from_address_shape";--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" VALIDATE CONSTRAINT "trade_terms_has_an_address";
