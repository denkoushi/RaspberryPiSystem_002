-- Expand-only rollout for type-level torque-wrench setting verification.
-- Existing rows remain NULL and are interpreted as REGISTERED_SETTING by the API.

ALTER TABLE "TorqueWrenchModel" ADD COLUMN "settingVerificationMode" TEXT;

ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD COLUMN "settingVerificationMode" TEXT;
ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD COLUMN "observedLeaseGeneration" INTEGER;
ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD COLUMN "observedAdoptedConfirmationId" TEXT;

ALTER TABLE "TorqueTrainingWrenchConfirmation"
  ADD COLUMN "settingVerificationMode" TEXT;
ALTER TABLE "TorqueTrainingWrenchConfirmation"
  ADD COLUMN "observedLeaseGeneration" INTEGER;
ALTER TABLE "TorqueTrainingWrenchConfirmation"
  ADD COLUMN "observedAdoptedConfirmationId" TEXT;

ALTER TABLE "AssemblyTorqueRecord"
  ADD COLUMN "settingVerificationMode" TEXT;
ALTER TABLE "TorqueTrainingAttempt"
  ADD COLUMN "settingVerificationMode" TEXT;

ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ALTER COLUMN "settingHistoryId" DROP NOT NULL;
ALTER TABLE "TorqueTrainingWrenchConfirmation"
  ALTER COLUMN "settingHistoryId" DROP NOT NULL;
