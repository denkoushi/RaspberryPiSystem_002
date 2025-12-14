-- Add MFA fields to User
ALTER TABLE "User"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "mfaBackupCodes" TEXT[] NOT NULL DEFAULT '{}';

-- Role audit log table
CREATE TABLE "RoleAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "fromRole" "UserRole" NOT NULL,
  "toRole" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoleAuditLog_actorUserId_idx" ON "RoleAuditLog"("actorUserId");
CREATE INDEX "RoleAuditLog_targetUserId_idx" ON "RoleAuditLog"("targetUserId");

ALTER TABLE "RoleAuditLog"
  ADD CONSTRAINT "RoleAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RoleAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
