-- CreateTable
CREATE TABLE "KioskHeaderTabOrderConfig" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "tabOrder" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskHeaderTabOrderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskHeaderTabOrderConfig_scopeKey_key" ON "KioskHeaderTabOrderConfig"("scopeKey");
