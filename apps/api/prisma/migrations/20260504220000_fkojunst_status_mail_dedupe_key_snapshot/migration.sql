-- CreateTable
CREATE TABLE "ProductionScheduleFkojunstStatusMailDedupeKeySnapshot" (
    "compositeKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionScheduleFkojunstStatusMailDedupeKeySnapshot_pkey" PRIMARY KEY ("compositeKey")
);
