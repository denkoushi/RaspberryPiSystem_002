CREATE TABLE "ProductionScheduleAccessPasswordAttempt" (
    "location" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleAccessPasswordAttempt_pkey" PRIMARY KEY ("location", "scope")
);
