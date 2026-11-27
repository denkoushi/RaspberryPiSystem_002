CREATE TABLE "DepartmentMasterEntry" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kanaName" TEXT,
    "name" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "parentCode" TEXT,
    "isSupplier" BOOLEAN NOT NULL,
    "isCustomer" BOOLEAN NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "sourceEnteredAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMasterEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepartmentMasterEntry_code_validFrom_key" ON "DepartmentMasterEntry"("code", "validFrom");
CREATE INDEX "DepartmentMasterEntry_code_idx" ON "DepartmentMasterEntry"("code");
