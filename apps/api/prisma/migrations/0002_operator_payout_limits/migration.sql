-- Per-network maximum payout per transfer (destination currency). NULL = no network limit.
ALTER TABLE "mobile_operators" ADD COLUMN "max_payout_amount" NUMERIC(20,4);
ALTER TABLE "mobile_operators" ADD CONSTRAINT "mobile_operators_max_payout_chk" CHECK ("max_payout_amount" IS NULL OR "max_payout_amount" > 0);
