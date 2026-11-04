ALTER TABLE "MachinePalletEvent"
  ADD COLUMN "eventKey" UUID,
  ADD COLUMN "eventFingerprint" CHAR(64),
  ADD COLUMN "readAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "MachinePalletEvent_event_key_uidx" ON "MachinePalletEvent"("clientDeviceId", "eventKey");
