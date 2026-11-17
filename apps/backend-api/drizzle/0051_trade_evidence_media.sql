CREATE TYPE "trade"."trade_evidence_event" AS ENUM('DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE');--> statement-breakpoint
CREATE TABLE "trade"."trade_evidence_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"event" "trade"."trade_evidence_event" NOT NULL,
	"attached_by_user_id" uuid NOT NULL,
	"attached_by_role" "trade"."trade_initiator_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade"."trade_evidence_media" ADD CONSTRAINT "trade_evidence_media_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_evidence_media_file" ON "trade"."trade_evidence_media" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "trade_evidence_media_trade_event_idx" ON "trade"."trade_evidence_media" USING btree ("trade_id","event","created_at");--> statement-breakpoint
CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "trade"."trade_evidence_media" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "trade"."trade_evidence_media" FROM komtru_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON "trade"."trade_evidence_media" TO komtru_app;
