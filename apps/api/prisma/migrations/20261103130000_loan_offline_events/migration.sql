ALTER TABLE "Loan"
  ADD COLUMN "borrowReceivedAt" TIMESTAMP(3),
  ADD COLUMN "returnReceivedAt" TIMESTAMP(3);

ALTER TABLE "Transaction"
  ADD COLUMN "eventKey" UUID,
  ADD COLUMN "eventFingerprint" CHAR(64);

CREATE UNIQUE INDEX "Transaction_event_key_uidx" ON "Transaction"("clientId", "eventKey");
