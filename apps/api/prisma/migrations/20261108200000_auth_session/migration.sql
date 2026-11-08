-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "refreshTokenId" TEXT NOT NULL,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "AuthSession_revokedAt_idx" ON "AuthSession"("revokedAt");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Credential and account-state updates also occur outside the HTTP routes.
CREATE OR REPLACE FUNCTION "revoke_auth_sessions_on_user_credentials_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "AuthSession"
  SET "revokedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
  WHERE "userId" = NEW."id" AND "revokedAt" IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_revoke_auth_sessions_on_credentials_change"
AFTER UPDATE OF "passwordHash", "status" ON "User"
FOR EACH ROW
WHEN (OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash"
  OR (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" <> 'ACTIVE'))
EXECUTE FUNCTION "revoke_auth_sessions_on_user_credentials_change"();
