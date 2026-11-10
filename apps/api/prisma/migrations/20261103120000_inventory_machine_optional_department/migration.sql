CREATE TABLE "InventoryMachineOptionalDepartment" (
    "department" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMachineOptionalDepartment_pkey" PRIMARY KEY ("department")
);

INSERT INTO "InventoryMachineOptionalDepartment" ("department") VALUES ('生産技術課');
