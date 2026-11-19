ALTER TABLE "AssemblyProcedureAsset" ADD COLUMN "derivedFromAssetId" TEXT;

CREATE INDEX "AssemblyProcedureAsset_derivedFromAssetId_idx"
ON "AssemblyProcedureAsset"("derivedFromAssetId");

ALTER TABLE "AssemblyProcedureAsset"
ADD CONSTRAINT "AssemblyProcedureAsset_derivedFromAssetId_fkey"
FOREIGN KEY ("derivedFromAssetId") REFERENCES "AssemblyProcedureAsset"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
