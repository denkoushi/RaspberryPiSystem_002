ALTER TABLE "Machine" ADD COLUMN "resourceCd" VARCHAR(20);

CREATE INDEX "Machine_resourceCd_idx" ON "Machine"("resourceCd");
