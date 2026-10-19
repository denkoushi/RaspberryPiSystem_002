ALTER TYPE "ProcedureMaterialOrigin" ADD VALUE 'APP';
ALTER TABLE "ProcedureMaterial" ADD COLUMN "appRef" JSONB;
