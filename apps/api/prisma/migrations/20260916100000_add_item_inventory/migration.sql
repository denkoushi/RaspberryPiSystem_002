-- CreateEnum
CREATE TYPE "InventoryImportOutcome" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'DUPLICATE', 'INVALID', 'RETRYABLE');

-- CreateEnum
CREATE TYPE "InventoryImportPayloadStatus" AS ENUM ('PENDING', 'REGISTERED', 'INVALID', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "InventoryRegistrationMode" AS ENUM ('NEW_ITEM', 'EXISTING_ITEM');

-- CreateEnum
CREATE TYPE "InventoryNfcTagKind" AS ENUM ('ITEM', 'QUANTITY', 'RESTOCK');

-- CreateEnum
CREATE TYPE "InventoryTransactionAction" AS ENUM ('ISSUE', 'RESTOCK', 'CANCEL', 'CORRECTION', 'LOCATION_CHANGE', 'TAG_REPLACEMENT', 'REGISTER');

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "usage" TEXT,
    "category" TEXT,
    "area" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemPhoto" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "sourcePayloadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryImportPayload" (
    "id" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceList" TEXT NOT NULL,
    "sourceItemId" INTEGER NOT NULL,
    "sourceModified" TIMESTAMP(3) NOT NULL,
    "area" TEXT NOT NULL,
    "category" TEXT,
    "note" TEXT,
    "manifest" JSONB NOT NULL,
    "status" "InventoryImportPayloadStatus" NOT NULL DEFAULT 'PENDING',
    "registrationMode" "InventoryRegistrationMode",
    "registeredItemId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryImportPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryImportPhoto" (
    "id" TEXT NOT NULL,
    "payloadId" TEXT NOT NULL,
    "photoIndex" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryImportPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryImportMessage" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "payloadId" TEXT,
    "outcome" "InventoryImportOutcome" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryImportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryShelf" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "shelfNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryShelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryDrawer" (
    "id" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "drawerNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryDrawer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCompartment" (
    "id" TEXT NOT NULL,
    "drawerId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryCompartment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryCompartment_stockQuantity_check" CHECK ("stockQuantity" >= 0)
);

-- CreateTable
CREATE TABLE "InventoryNfcTag" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "kind" "InventoryNfcTagKind" NOT NULL,
    "quantity" INTEGER,
    "compartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryNfcTag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryNfcTag_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0)
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "action" "InventoryTransactionAction" NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "compartmentId" TEXT,
    "clientId" TEXT,
    "performedByUserId" TEXT,
    "quantityTagId" TEXT,
    "idempotencyKey" TEXT,
    "reversalOfId" TEXT,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "beforeQuantity" INTEGER NOT NULL,
    "afterQuantity" INTEGER NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemCode_key" ON "InventoryItem"("itemCode");
CREATE INDEX "InventoryItem_name_idx" ON "InventoryItem"("name");
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");
CREATE INDEX "InventoryItemPhoto_inventoryItemId_createdAt_idx" ON "InventoryItemPhoto"("inventoryItemId", "createdAt");
CREATE INDEX "InventoryItemPhoto_sha256_idx" ON "InventoryItemPhoto"("sha256");
CREATE UNIQUE INDEX "InventoryImportPayload_contentHash_key" ON "InventoryImportPayload"("contentHash");
CREATE INDEX "InventoryImportPayload_status_createdAt_idx" ON "InventoryImportPayload"("status", "createdAt");
CREATE INDEX "InventoryImportPayload_sourceSystem_sourceList_sourceItemId_sourceModified_idx" ON "InventoryImportPayload"("sourceSystem", "sourceList", "sourceItemId", "sourceModified");
CREATE UNIQUE INDEX "InventoryImportPhoto_payloadId_photoIndex_key" ON "InventoryImportPhoto"("payloadId", "photoIndex");
CREATE INDEX "InventoryImportPhoto_payloadId_filename_idx" ON "InventoryImportPhoto"("payloadId", "filename");
CREATE UNIQUE INDEX "InventoryImportMessage_gmailMessageId_key" ON "InventoryImportMessage"("gmailMessageId");
CREATE INDEX "InventoryImportMessage_outcome_nextRetryAt_createdAt_idx" ON "InventoryImportMessage"("outcome", "nextRetryAt", "createdAt");
CREATE INDEX "InventoryImportMessage_payloadId_idx" ON "InventoryImportMessage"("payloadId");
CREATE UNIQUE INDEX "InventoryShelf_area_shelfNumber_key" ON "InventoryShelf"("area", "shelfNumber");
CREATE INDEX "InventoryShelf_area_shelfNumber_idx" ON "InventoryShelf"("area", "shelfNumber");
CREATE UNIQUE INDEX "InventoryDrawer_shelfId_drawerNumber_key" ON "InventoryDrawer"("shelfId", "drawerNumber");
CREATE INDEX "InventoryDrawer_shelfId_drawerNumber_idx" ON "InventoryDrawer"("shelfId", "drawerNumber");
CREATE INDEX "InventoryCompartment_drawerId_idx" ON "InventoryCompartment"("drawerId");
CREATE INDEX "InventoryCompartment_inventoryItemId_idx" ON "InventoryCompartment"("inventoryItemId");
CREATE UNIQUE INDEX "InventoryNfcTag_uid_key" ON "InventoryNfcTag"("uid");
CREATE INDEX "InventoryNfcTag_kind_idx" ON "InventoryNfcTag"("kind");
CREATE UNIQUE INDEX "InventoryNfcTag_compartmentId_key" ON "InventoryNfcTag"("compartmentId");
CREATE UNIQUE INDEX "InventoryTransaction_clientId_idempotencyKey_key" ON "InventoryTransaction"("clientId", "idempotencyKey");
CREATE UNIQUE INDEX "InventoryTransaction_reversalOfId_key" ON "InventoryTransaction"("reversalOfId");
CREATE INDEX "InventoryTransaction_compartmentId_createdAt_idx" ON "InventoryTransaction"("compartmentId", "createdAt");
CREATE INDEX "InventoryTransaction_inventoryItemId_createdAt_idx" ON "InventoryTransaction"("inventoryItemId", "createdAt");
CREATE INDEX "InventoryTransaction_action_createdAt_idx" ON "InventoryTransaction"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryItemPhoto" ADD CONSTRAINT "InventoryItemPhoto_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryImportPayload" ADD CONSTRAINT "InventoryImportPayload_registeredItemId_fkey" FOREIGN KEY ("registeredItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryImportPhoto" ADD CONSTRAINT "InventoryImportPhoto_payloadId_fkey" FOREIGN KEY ("payloadId") REFERENCES "InventoryImportPayload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryImportMessage" ADD CONSTRAINT "InventoryImportMessage_payloadId_fkey" FOREIGN KEY ("payloadId") REFERENCES "InventoryImportPayload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryDrawer" ADD CONSTRAINT "InventoryDrawer_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "InventoryShelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCompartment" ADD CONSTRAINT "InventoryCompartment_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "InventoryDrawer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCompartment" ADD CONSTRAINT "InventoryCompartment_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryNfcTag" ADD CONSTRAINT "InventoryNfcTag_compartmentId_fkey" FOREIGN KEY ("compartmentId") REFERENCES "InventoryCompartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_compartmentId_fkey" FOREIGN KEY ("compartmentId") REFERENCES "InventoryCompartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
