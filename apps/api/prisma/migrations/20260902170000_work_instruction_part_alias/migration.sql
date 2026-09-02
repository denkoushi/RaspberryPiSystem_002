CREATE TABLE "WorkInstructionPartAlias" (
    "id" TEXT NOT NULL,
    "scannedPartNumber" VARCHAR(200) NOT NULL,
    "canonicalPartNumber" VARCHAR(200) NOT NULL,
    "selectionCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSelectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSelectedClientDeviceId" TEXT,

    CONSTRAINT "WorkInstructionPartAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkInstructionPartAlias_unique_scanned"
ON "WorkInstructionPartAlias"("scannedPartNumber");

CREATE INDEX "WorkInstructionPartAlias_idx_client_device"
ON "WorkInstructionPartAlias"("lastSelectedClientDeviceId");

ALTER TABLE "WorkInstructionPartAlias"
ADD CONSTRAINT "WorkInstructionPartAlias_lastSelectedClientDeviceId_fkey"
FOREIGN KEY ("lastSelectedClientDeviceId") REFERENCES "ClientDevice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
