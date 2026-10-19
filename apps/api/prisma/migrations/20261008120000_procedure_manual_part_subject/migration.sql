-- CreateEnum
CREATE TYPE "ProcedureManualSubjectKind" AS ENUM ('MODEL', 'PART');

-- AlterTable
ALTER TABLE "ProcedureManualProcess" ADD COLUMN "subjectKind" "ProcedureManualSubjectKind" NOT NULL DEFAULT 'MODEL';

UPDATE "ProcedureManualProcess" SET "subjectKind" = 'PART'
WHERE "id" IN ('procedure-manual-machining-cutting', 'procedure-manual-machining-grinding');
