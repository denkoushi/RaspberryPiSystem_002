-- CreateEnum
CREATE TYPE "TorqueTrainingSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TorqueTrainingAttemptJudgement" AS ENUM ('OK', 'UNDER', 'OVER', 'IGNORED');

-- CreateEnum
CREATE TYPE "TorqueUsageOwnerKind" AS ENUM ('ASSEMBLY', 'TRAINING');

-- CreateTable
CREATE TABLE "TorqueTrainingProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorqueTrainingProgram_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueTrainingProgram_code_key" UNIQUE ("code")
);

-- CreateTable
CREATE TABLE "TorqueTrainingProgramVersion" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "nominalDiameter" TEXT NOT NULL,
    "boltLengthMm" DECIMAL(10,3) NOT NULL,
    "material" TEXT NOT NULL,
    "strengthClass" TEXT NOT NULL,
    "capabilityGroupId" TEXT NOT NULL,
    "nominalTorque" DECIMAL(18,6) NOT NULL,
    "lowerLimit" DECIMAL(18,6) NOT NULL,
    "upperLimit" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "jigConditionCode" TEXT NOT NULL,
    "conditionFingerprint" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingProgramVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueTrainingProgramVersion_attempt_count_ck" CHECK ("attemptCount" = 5),
    CONSTRAINT "TorqueTrainingProgramVersion_unique_program_version" UNIQUE ("programId", "version"),
    CONSTRAINT "TorqueTrainingProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TorqueTrainingProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingProgramVersion_capabilityGroupId_fkey" FOREIGN KEY ("capabilityGroupId") REFERENCES "TorqueWrenchCapabilityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueTrainingProgramWrench" (
    "programVersionId" TEXT NOT NULL,
    "torqueWrenchProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingProgramWrench_pkey" PRIMARY KEY ("programVersionId","torqueWrenchProfileId"),
    CONSTRAINT "TorqueTrainingProgramWrench_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "TorqueTrainingProgramVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingProgramWrench_torqueWrenchProfileId_fkey" FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueTrainingSession" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "programVersionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "clientDeviceNameSnapshot" TEXT NOT NULL,
    "conditionFingerprint" TEXT NOT NULL,
    "status" "TorqueTrainingSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "targetAttemptCount" INTEGER NOT NULL DEFAULT 5,
    "activeEmployeeKey" TEXT,
    "activeClientKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "excludedAt" TIMESTAMP(3),
    "exclusionReason" TEXT,
    "excludedByUserId" TEXT,
    "excludedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorqueTrainingSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueTrainingSession_requestId_key" UNIQUE ("requestId"),
    CONSTRAINT "TorqueTrainingSession_target_attempt_count_ck" CHECK ("targetAttemptCount" = 5),
    CONSTRAINT "TorqueTrainingSession_active_keys_ck" CHECK (
      ("status" = 'IN_PROGRESS' AND "activeEmployeeKey" = 'ACTIVE' AND "activeClientKey" = 'ACTIVE')
      OR
      ("status" <> 'IN_PROGRESS' AND "activeEmployeeKey" IS NULL AND "activeClientKey" IS NULL)
    ),
    CONSTRAINT "TorqueTrainingSession_unique_employee_active_key" UNIQUE ("employeeId", "activeEmployeeKey"),
    CONSTRAINT "TorqueTrainingSession_unique_client_active_key" UNIQUE ("clientDeviceId", "activeClientKey"),
    CONSTRAINT "TorqueTrainingSession_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "TorqueTrainingProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingSession_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueTrainingWrenchConfirmation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "torqueWrenchProfileId" TEXT NOT NULL,
    "settingHistoryId" TEXT NOT NULL,
    "conditionFingerprint" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "clientDeviceNameSnapshot" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingWrenchConfirmation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueTrainingWrenchConfirmation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TorqueTrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingWrenchConfirmation_torqueWrenchProfileId_fkey" FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingWrenchConfirmation_settingHistoryId_fkey" FOREIGN KEY ("settingHistoryId") REFERENCES "TorqueWrenchSettingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingWrenchConfirmation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingWrenchConfirmation_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueTrainingAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "attemptNo" INTEGER,
    "value" DECIMAL(18,6),
    "inputUnit" TEXT,
    "valueNm" DECIMAL(18,6),
    "nominalTorqueSnapshot" DECIMAL(18,6),
    "lowerLimitSnapshot" DECIMAL(18,6),
    "upperLimitSnapshot" DECIMAL(18,6),
    "deviationNm" DECIMAL(18,6),
    "deviationPercent" DECIMAL(18,6),
    "absoluteDeviationPercent" DECIMAL(18,6),
    "judgement" "TorqueTrainingAttemptJudgement" NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "ignoredReason" TEXT,
    "torqueWrenchProfileId" TEXT,
    "settingHistoryId" TEXT,
    "serialNumberSnapshot" TEXT,
    "manufacturerSnapshot" TEXT,
    "modelNumberSnapshot" TEXT,
    "sourceClientDeviceId" TEXT NOT NULL,
    "sourceEventKey" TEXT NOT NULL,
    "connectionLeaseId" TEXT,
    "connectionLeaseGeneration" INTEGER,
    "deviceRecordedAt" TIMESTAMP(3),
    "deviceMemoryCounter" TEXT,
    "deviceJudgement" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueTrainingAttempt_attempt_number_ck" CHECK (("accepted" = false AND "attemptNo" IS NULL) OR ("accepted" = true AND "attemptNo" BETWEEN 1 AND 5)),
    CONSTRAINT "TorqueTrainingAttempt_unique_source_event" UNIQUE ("sourceClientDeviceId", "sourceEventKey"),
    CONSTRAINT "TorqueTrainingAttempt_unique_attempt" UNIQUE ("sessionId", "attemptNo"),
    CONSTRAINT "TorqueTrainingAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TorqueTrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingAttempt_torqueWrenchProfileId_fkey" FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingAttempt_settingHistoryId_fkey" FOREIGN KEY ("settingHistoryId") REFERENCES "TorqueWrenchSettingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueTrainingAttempt_sourceClientDeviceId_fkey" FOREIGN KEY ("sourceClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueWrenchUsageLease" (
    "torqueWrenchProfileId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "ownerKind" "TorqueUsageOwnerKind" NOT NULL,
    "ownerAssemblySessionId" TEXT,
    "ownerTrainingSessionId" TEXT,
    "adoptedConfirmationId" TEXT,
    "ownerClientDeviceId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectAfter" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorqueWrenchUsageLease_pkey" PRIMARY KEY ("torqueWrenchProfileId"),
    CONSTRAINT "TorqueWrenchUsageLease_leaseId_key" UNIQUE ("leaseId"),
    CONSTRAINT "TorqueWrenchUsageLease_owner_exactly_one_ck" CHECK (
      ("ownerKind" = 'ASSEMBLY' AND "ownerAssemblySessionId" IS NOT NULL AND "ownerTrainingSessionId" IS NULL)
      OR
      ("ownerKind" = 'TRAINING' AND "ownerAssemblySessionId" IS NULL AND "ownerTrainingSessionId" IS NOT NULL)
    ),
    CONSTRAINT "TorqueWrenchUsageLease_torqueWrenchProfileId_fkey" FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TorqueWrenchUsageLease_ownerClientDeviceId_fkey" FOREIGN KEY ("ownerClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorqueWrenchUsageLease_ownerAssemblySessionId_fkey" FOREIGN KEY ("ownerAssemblySessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TorqueWrenchUsageLease_ownerTrainingSessionId_fkey" FOREIGN KEY ("ownerTrainingSessionId") REFERENCES "TorqueTrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TorqueWrenchUsageLeaseHistory" (
    "id" TEXT NOT NULL,
    "torqueWrenchProfileId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "ownerKind" "TorqueUsageOwnerKind" NOT NULL,
    "ownerTargetId" TEXT NOT NULL,
    "ownerClientDeviceId" TEXT NOT NULL,
    "ownerClientDeviceName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "adoptedConfirmationId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueWrenchUsageLeaseHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TorqueWrenchUsageLeaseHistory_torqueWrenchProfileId_fkey" FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TorqueTrainingProgram_idx_active_updated" ON "TorqueTrainingProgram"("isActive", "updatedAt");

-- CreateIndex
CREATE INDEX "TorqueTrainingProgramVersion_idx_program_fingerprint" ON "TorqueTrainingProgramVersion"("programId", "conditionFingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "TorqueTrainingProgramVersion_idx_fingerprint" ON "TorqueTrainingProgramVersion"("conditionFingerprint");

-- CreateIndex
CREATE INDEX "TorqueTrainingProgramWrench_idx_profile" ON "TorqueTrainingProgramWrench"("torqueWrenchProfileId");

-- CreateIndex
CREATE INDEX "TorqueTrainingSession_idx_employee_fingerprint_completed" ON "TorqueTrainingSession"("employeeId", "conditionFingerprint", "completedAt" DESC);

-- CreateIndex
CREATE INDEX "TorqueTrainingSession_idx_client_status" ON "TorqueTrainingSession"("clientDeviceId", "status");

-- CreateIndex
CREATE INDEX "TorqueTrainingSession_idx_version_status_completed" ON "TorqueTrainingSession"("programVersionId", "status", "completedAt" DESC);

-- CreateIndex
CREATE INDEX "TorqueTrainingWrenchConfirmation_idx_session_confirmed" ON "TorqueTrainingWrenchConfirmation"("sessionId", "confirmedAt" DESC);

-- CreateIndex
CREATE INDEX "TorqueTrainingWrenchConfirmation_idx_profile_confirmed" ON "TorqueTrainingWrenchConfirmation"("torqueWrenchProfileId", "confirmedAt" DESC);

-- CreateIndex
CREATE INDEX "TorqueTrainingAttempt_idx_session_recorded" ON "TorqueTrainingAttempt"("sessionId", "recordedAt");

-- CreateIndex
CREATE INDEX "TorqueTrainingAttempt_idx_session_accepted" ON "TorqueTrainingAttempt"("sessionId", "accepted", "attemptNo");

-- CreateIndex
CREATE INDEX "TorqueWrenchUsageLease_idx_owner_expiry" ON "TorqueWrenchUsageLease"("ownerClientDeviceId", "expiresAt");

-- CreateIndex
CREATE INDEX "TorqueWrenchUsageLease_idx_expiry" ON "TorqueWrenchUsageLease"("expiresAt");

-- CreateIndex
CREATE INDEX "TorqueWrenchUsageLeaseHistory_idx_profile_time" ON "TorqueWrenchUsageLeaseHistory"("torqueWrenchProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "TorqueWrenchUsageLeaseHistory_idx_lease" ON "TorqueWrenchUsageLeaseHistory"("leaseId");
