ALTER TYPE "ProcedureMaterialOrigin" ADD VALUE 'WORK_INSTRUCTION';

ALTER TABLE "ProcedureMaterial"
  ADD COLUMN "workInstructionRef" JSONB;
