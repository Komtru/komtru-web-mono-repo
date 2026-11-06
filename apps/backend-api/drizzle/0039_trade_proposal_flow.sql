CREATE TABLE "trade"."trade_proof_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"attached_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ALTER COLUMN "delivery_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ALTER COLUMN "ships_from_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade"."trade_proof_media" ADD CONSTRAINT "trade_proof_media_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_proof_media_trade_file" ON "trade"."trade_proof_media" USING btree ("trade_id","file_id");--> statement-breakpoint
CREATE INDEX "trade_proof_media_trade_idx" ON "trade"."trade_proof_media" USING btree ("trade_id");