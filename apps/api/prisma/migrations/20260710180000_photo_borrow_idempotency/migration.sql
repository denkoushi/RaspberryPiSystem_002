ALTER TABLE "Loan"
  ADD COLUMN "photoBorrowIdempotencyKey" UUID,
  ADD COLUMN "photoBorrowRequestFingerprint" CHAR(64);

CREATE UNIQUE INDEX "Loan_photo_borrow_idempotency_uidx"
  ON "Loan" ("clientId", "photoBorrowIdempotencyKey");
