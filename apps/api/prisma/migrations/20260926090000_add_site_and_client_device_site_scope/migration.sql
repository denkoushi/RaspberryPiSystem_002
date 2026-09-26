-- Explicit site scope (docs/plans/explicit-site-scope-execplan.md, Milestone 1).
-- Additive only: ClientDevice.siteKey stays NULL, so the resolver keeps the
-- legacy location-text guess until an administrator assigns a site.

CREATE TABLE "Site" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("key")
);

INSERT INTO "Site" ("key", "displayName", "sortOrder", "updatedAt")
VALUES ('第2工場', '第2工場', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "ClientDevice" ADD COLUMN "siteKey" TEXT;
ALTER TABLE "ClientDevice" ADD COLUMN "canProxyOtherDevices" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ClientDevice_siteKey_idx" ON "ClientDevice"("siteKey");

ALTER TABLE "ClientDevice"
  ADD CONSTRAINT "ClientDevice_siteKey_fkey"
  FOREIGN KEY ("siteKey") REFERENCES "Site"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The proxy privilege used to be "device scope key equals 'Mac'". Carry it over
-- exactly, using the same derivation as location-scope-resolver.ts.
UPDATE "ClientDevice"
SET "canProxyOtherDevices" = true
WHERE COALESCE(NULLIF(btrim("location"), ''), NULLIF(btrim("name"), ''), 'default') = 'Mac';
