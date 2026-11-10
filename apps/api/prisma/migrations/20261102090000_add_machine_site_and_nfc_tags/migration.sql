ALTER TABLE "Machine" ADD COLUMN "siteKey" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "machineId" TEXT;
CREATE TABLE "MachineNfcTag" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "uid" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MachineNfcTag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "KioskInventoryMachineOrder" (
  "id" TEXT NOT NULL,
  "clientDeviceId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KioskInventoryMachineOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Machine_siteKey_idx" ON "Machine"("siteKey");
CREATE INDEX "InventoryTransaction_machineId_idx" ON "InventoryTransaction"("machineId");
CREATE UNIQUE INDEX "MachineNfcTag_uid_key" ON "MachineNfcTag"("uid");
CREATE INDEX "MachineNfcTag_machineId_idx" ON "MachineNfcTag"("machineId");
CREATE UNIQUE INDEX "KioskInventoryMachineOrder_clientDeviceId_machineId_key" ON "KioskInventoryMachineOrder"("clientDeviceId", "machineId");
CREATE INDEX "KioskInventoryMachineOrder_clientDeviceId_position_idx" ON "KioskInventoryMachineOrder"("clientDeviceId", "position");
CREATE INDEX "KioskInventoryMachineOrder_machineId_idx" ON "KioskInventoryMachineOrder"("machineId");
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_siteKey_fkey" FOREIGN KEY ("siteKey") REFERENCES "Site"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineNfcTag" ADD CONSTRAINT "MachineNfcTag_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskInventoryMachineOrder" ADD CONSTRAINT "KioskInventoryMachineOrder_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskInventoryMachineOrder" ADD CONSTRAINT "KioskInventoryMachineOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
