ALTER TABLE "ClientDevice"
ADD COLUMN "isSignage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "signagePreviewTargetDeviceId" TEXT;

ALTER TABLE "SignageSchedule"
ADD COLUMN "targetClientDeviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "ClientDevice"
SET "isSignage" = true
WHERE lower("apiKey") LIKE '%signage%';

UPDATE "SignageSchedule" AS schedule
SET "targetClientDeviceIds" = ARRAY(
  SELECT device."id"
  FROM unnest(schedule."targetClientKeys") WITH ORDINALITY AS target(key, position)
  JOIN "ClientDevice" AS device ON device."apiKey" = target.key
  ORDER BY target.position
);

-- Targeted schedules whose terminals no longer exist were shown nowhere; keep them that way.
UPDATE "SignageSchedule"
SET "enabled" = false
WHERE cardinality("targetClientKeys") > 0
  AND cardinality("targetClientDeviceIds") = 0;

UPDATE "ClientDevice" AS kiosk
SET "signagePreviewTargetDeviceId" = target."id"
FROM "ClientDevice" AS target
WHERE kiosk."signagePreviewTargetApiKey" = target."apiKey";

UPDATE "ClientDevice" AS kiosk
SET "signagePreviewTargetDeviceId" = target."id"
FROM "ClientDevice" AS target
WHERE kiosk."signagePreviewTargetDeviceId" IS NULL
  AND kiosk."signagePreviewTargetApiKey" = target."id";

-- Both preview columns hold the same device ID from here on.
UPDATE "ClientDevice"
SET "signagePreviewTargetApiKey" = "signagePreviewTargetDeviceId"
WHERE "signagePreviewTargetApiKey" IS DISTINCT FROM "signagePreviewTargetDeviceId";
