CREATE TABLE "AuthLoginAttempt" (
    "username" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthLoginAttempt_pkey" PRIMARY KEY ("username")
);

CREATE INDEX "AuthLoginAttempt_windowEndsAt_idx" ON "AuthLoginAttempt"("windowEndsAt");

ALTER TABLE "User" ADD COLUMN "totpLastUsedStep" INTEGER;
