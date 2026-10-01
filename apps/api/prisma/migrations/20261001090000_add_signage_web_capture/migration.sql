-- Signage content captured from an admin web page. Additive only.
CREATE TABLE "SignageWebCapture" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "viewportWidth" INTEGER NOT NULL DEFAULT 1920,
    "viewportHeight" INTEGER NOT NULL DEFAULT 1080,
    "waitMode" VARCHAR(16) NOT NULL DEFAULT 'network_idle',
    "waitSeconds" INTEGER NOT NULL DEFAULT 3,
    "hideSelectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clipSelector" TEXT,
    "refreshIntervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCapturedAt" TIMESTAMP(3),
    "lastStatus" VARCHAR(16) NOT NULL DEFAULT 'never',
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignageWebCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignageWebCapture_enabled_idx" ON "SignageWebCapture"("enabled");
