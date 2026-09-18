ALTER TABLE "InventoryImportMessage" ADD COLUMN "mailCleanupPending" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "InventoryImportMessage_mailCleanupPending_nextRetryAt_idx"
  ON "InventoryImportMessage"("mailCleanupPending", "nextRetryAt");
