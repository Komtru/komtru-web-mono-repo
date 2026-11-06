-- T-061: a terms version carries the proposer's own address; the other side is filled by whoever
-- accepts. The shape checks therefore allow NULL. NOT VALID because the shape of every existing row
-- is unchanged (a NULL could not exist before) so there is nothing to re-scan under the lock.
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
      AND length(coalesce("trade"."trade_terms_versions"."ships_from_address" ->> 'city_id', '')) > 0)) NOT VALID;
