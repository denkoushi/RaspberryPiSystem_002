-- 製番→機種名補完（Gmail CSV FHINMEI_MH_SH 取り込み後に同期）

CREATE TABLE "ProductionScheduleSeibanMachineNameSupplement" (
    "id" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "fseiban" VARCHAR(64) NOT NULL,
    "machineName" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleSeibanMachineNameSupplement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PSSeibanMachNmSup_unique_src_fsb"
    ON "ProductionScheduleSeibanMachineNameSupplement"("sourceCsvDashboardId", "fseiban");

CREATE INDEX "PSSeibanMachNmSup_idx_fseiban"
    ON "ProductionScheduleSeibanMachineNameSupplement"("fseiban");
