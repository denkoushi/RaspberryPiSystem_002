-- CreateTable
CREATE TABLE "MeasuringInstrumentLoanEvent" (
    "id" TEXT NOT NULL,
    "managementNumber" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "sourceMessageId" TEXT,
    "sourceMessageSubject" TEXT,
    "sourceCsvDashboardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasuringInstrumentLoanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrumentLoanEvent_managementNumber_eventAt_action_key" ON "MeasuringInstrumentLoanEvent"("managementNumber", "eventAt", "action");

-- CreateIndex
CREATE INDEX "MeasuringInstrumentLoanEvent_eventAt_idx" ON "MeasuringInstrumentLoanEvent"("eventAt");

-- CreateIndex
CREATE INDEX "MeasuringInstrumentLoanEvent_managementNumber_idx" ON "MeasuringInstrumentLoanEvent"("managementNumber");

-- CreateIndex
CREATE INDEX "MeasuringInstrumentLoanEvent_action_idx" ON "MeasuringInstrumentLoanEvent"("action");

