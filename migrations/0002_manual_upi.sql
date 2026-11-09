-- Manual UPI verification fields. Existing Razorpay rows remain intact.
ALTER TABLE payments ADD COLUMN utr TEXT;
ALTER TABLE payments ADD COLUMN reviewed_by TEXT;
ALTER TABLE payments ADD COLUMN reviewed_at TEXT;
ALTER TABLE payments ADD COLUMN review_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_utr
ON payments(utr) WHERE utr IS NOT NULL;
