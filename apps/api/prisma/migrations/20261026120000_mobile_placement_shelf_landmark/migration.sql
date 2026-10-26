CREATE TABLE "MobilePlacementShelfLandmark" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByClientDeviceId" TEXT,
    CONSTRAINT "MobilePlacementShelfLandmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePlacementShelfLandmark_name_key" ON "MobilePlacementShelfLandmark"("name");
