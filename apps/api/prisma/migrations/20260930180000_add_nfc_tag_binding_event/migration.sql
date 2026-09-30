-- NFC tag link/unlink history for the kiosk tag desk. Additive only.
CREATE TYPE "NfcTagBindingAction" AS ENUM ('LINK', 'UNLINK');

CREATE TABLE "NfcTagBindingEvent" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "action" "NfcTagBindingAction" NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NfcTagBindingEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NfcTagBindingEvent_createdAt_idx" ON "NfcTagBindingEvent"("createdAt");
CREATE INDEX "NfcTagBindingEvent_uid_idx" ON "NfcTagBindingEvent"("uid");
