-- Revision-owned source memo overrides.  Source-version step.text remains
-- immutable; an empty override text is a valid value.

CREATE TYPE "WorkInstructionEditMemoMigrationState" AS ENUM ('MIGRATED', 'NEEDS_REVIEW', 'UNASSIGNED', 'SKIPPED');

CREATE TABLE "WorkInstructionEditMemoOverride" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "revisionId" TEXT NOT NULL,
  "sourceStep" BIGINT,
  "migratedFromStep" BIGINT NOT NULL,
  "baseStepFingerprint" VARCHAR(128) NOT NULL,
  "targetStepFingerprint" VARCHAR(128),
  "migrationState" "WorkInstructionEditMemoMigrationState" NOT NULL DEFAULT 'MIGRATED',
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionEditMemoOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditMemoOverride_migratedFromStep_check" CHECK ("migratedFromStep" > 0),
  CONSTRAINT "WorkInstructionEditMemoOverride_sourceStep_check" CHECK ("sourceStep" IS NULL OR "sourceStep" > 0),
  CONSTRAINT "WorkInstructionEditMemoOverride_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkInstructionEditMemoOverride_unique_revision_source_step"
  ON "WorkInstructionEditMemoOverride"("revisionId", "migratedFromStep");
CREATE UNIQUE INDEX "WorkInstructionEditMemoOverride_unique_revision_target_step"
  ON "WorkInstructionEditMemoOverride"("revisionId", "sourceStep");
CREATE INDEX "WorkInstructionEditMemoOverride_idx_revision_step"
  ON "WorkInstructionEditMemoOverride"("revisionId", "sourceStep");
CREATE INDEX "WorkInstructionEditMemoOverride_idx_migration_state"
  ON "WorkInstructionEditMemoOverride"("revisionId", "migrationState");
