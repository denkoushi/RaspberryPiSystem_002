-- CreateTable
CREATE TABLE "ClientStatus" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memoryUsage" DOUBLE PRECISION NOT NULL,
    "diskUsage" DOUBLE PRECISION NOT NULL,
    "temperature" DOUBLE PRECISION,
    "uptimeSeconds" INTEGER,
    "lastBoot" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientStatus_clientId_key" ON "ClientStatus"("clientId");

-- CreateIndex
CREATE INDEX "ClientStatus_lastSeen_idx" ON "ClientStatus"("lastSeen");

-- CreateIndex
CREATE INDEX "ClientLog_clientId_createdAt_idx" ON "ClientLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientLog_createdAt_idx" ON "ClientLog"("createdAt");

