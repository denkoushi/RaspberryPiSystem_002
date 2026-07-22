-- Expand-only Release A contract:
-- - existing tables receive nullable built-in columns only;
-- - existing torque-wrench profiles remain in the compatibility path;
-- - current ownership and append-only history live in new tables;
-- - enforcement activation is an explicit post-deploy API action.

ALTER TABLE "TorqueWrenchProfile" ADD COLUMN "connectionLeaseEnforcedAt" TIMESTAMP(3);
ALTER TABLE "TorqueWrenchProfile" ADD COLUMN "connectionLeaseEnforcementReason" TEXT;
ALTER TABLE "TorqueWrenchProfile" ADD COLUMN "connectionLeaseEnforcedByUserId" TEXT;
ALTER TABLE "TorqueWrenchProfile" ADD COLUMN "connectionLeaseEnforcedByUsername" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "connectionLeaseId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "connectionLeaseGeneration" INTEGER;

CREATE TABLE "TorqueWrenchConnectionLease" (
  "torqueWrenchProfileId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "ownerClientDeviceId" TEXT NOT NULL,
  "ownerSessionId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "connectAfter" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TorqueWrenchConnectionLease_pkey" PRIMARY KEY ("torqueWrenchProfileId"),
  CONSTRAINT "TorqueWrenchConnectionLease_leaseId_key" UNIQUE ("leaseId"),
  CONSTRAINT "TorqueWrenchConnectionLease_torqueWrenchProfileId_fkey"
    FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TorqueWrenchConnectionLease_ownerClientDeviceId_fkey"
    FOREIGN KEY ("ownerClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TorqueWrenchConnectionLease_ownerSessionId_fkey"
    FOREIGN KEY ("ownerSessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TorqueWrenchConnectionLeaseHistory" (
  "id" TEXT NOT NULL,
  "torqueWrenchProfileId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "ownerClientDeviceId" TEXT NOT NULL,
  "ownerClientDeviceName" TEXT NOT NULL,
  "ownerSessionId" TEXT NOT NULL,
  "previousClientDeviceId" TEXT,
  "previousClientDeviceName" TEXT,
  "previousSessionId" TEXT,
  "reason" TEXT,
  "actorUserId" TEXT,
  "actorUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TorqueWrenchConnectionLeaseHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TorqueWrenchConnectionLeaseHistory_torqueWrenchProfileId_fkey"
    FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TorqueWrenchConnectionLease_idx_owner_expiry"
  ON "TorqueWrenchConnectionLease"("ownerClientDeviceId", "expiresAt");
CREATE INDEX "TorqueWrenchConnectionLease_idx_session"
  ON "TorqueWrenchConnectionLease"("ownerSessionId");
CREATE INDEX "TorqueWrenchConnectionLease_idx_expiry"
  ON "TorqueWrenchConnectionLease"("expiresAt");
CREATE INDEX "TorqueWrenchConnectionLeaseHistory_idx_profile_time"
  ON "TorqueWrenchConnectionLeaseHistory"("torqueWrenchProfileId", "createdAt");
CREATE INDEX "TorqueWrenchConnectionLeaseHistory_idx_owner_time"
  ON "TorqueWrenchConnectionLeaseHistory"("ownerClientDeviceId", "createdAt");
CREATE INDEX "TorqueWrenchConnectionLeaseHistory_idx_lease"
  ON "TorqueWrenchConnectionLeaseHistory"("leaseId");
