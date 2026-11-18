CREATE TYPE "OsSecurityUpdateRequestMode" AS ENUM ('auto', 'trial');
CREATE TYPE "OsSecurityUpdateRequestStatus" AS ENUM ('open', 'verified', 'notified');
CREATE TYPE "OsSecurityUpdateTargetState" AS ENUM ('pending', 'verified', 'failed');

CREATE TABLE "OsSecurityUpdateRequest" (
    "id" TEXT NOT NULL,
    "advisoryKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "noticeKey" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "packages" TEXT[],
    "mode" "OsSecurityUpdateRequestMode" NOT NULL,
    "status" "OsSecurityUpdateRequestStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OsSecurityUpdateRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OsSecurityUpdateTarget" (
    "requestId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "state" "OsSecurityUpdateTargetState" NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "detail" JSONB NOT NULL,

    CONSTRAINT "OsSecurityUpdateTarget_pkey" PRIMARY KEY ("requestId","clientId")
);

CREATE TABLE "OsSecurityUpdateClientReport" (
    "clientId" TEXT NOT NULL,
    "earlyEnabled" BOOLEAN NOT NULL,
    "report" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsSecurityUpdateClientReport_pkey" PRIMARY KEY ("clientId")
);

CREATE UNIQUE INDEX "OsSecurityUpdateRequest_advisoryKey_key" ON "OsSecurityUpdateRequest"("advisoryKey");
CREATE INDEX "OsSecurityUpdateRequest_status_idx" ON "OsSecurityUpdateRequest"("status");
CREATE INDEX "OsSecurityUpdateTarget_clientId_idx" ON "OsSecurityUpdateTarget"("clientId");

ALTER TABLE "OsSecurityUpdateTarget" ADD CONSTRAINT "OsSecurityUpdateTarget_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "OsSecurityUpdateRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
