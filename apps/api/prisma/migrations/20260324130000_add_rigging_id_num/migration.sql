-- AlterTable
ALTER TABLE "RiggingGear"
ADD COLUMN "idNum" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RiggingGear_idNum_key" ON "RiggingGear"("idNum");
