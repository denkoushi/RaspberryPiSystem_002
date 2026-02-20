-- Add GmailRateLimitState for global 429 cooldown

CREATE TABLE "GmailRateLimitState" (
    "id" TEXT NOT NULL,
    "cooldownUntil" TIMESTAMPTZ,
    "last429At" TIMESTAMPTZ,
    "lastRetryAfterMs" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GmailRateLimitState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GmailRateLimitState_cooldownUntil_idx" ON "GmailRateLimitState"("cooldownUntil");
