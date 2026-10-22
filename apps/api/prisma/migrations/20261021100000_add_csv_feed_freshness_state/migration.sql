CREATE TABLE "CsvFeedFreshnessState" (
    "csvDashboardId" TEXT NOT NULL,
    "lastComparedRunId" TEXT,
    "lastComparedRunAt" TIMESTAMP(3),
    "lastContentChangedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsvFeedFreshnessState_pkey" PRIMARY KEY ("csvDashboardId")
);

ALTER TABLE "CsvFeedFreshnessState" ADD CONSTRAINT "CsvFeedFreshnessState_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
