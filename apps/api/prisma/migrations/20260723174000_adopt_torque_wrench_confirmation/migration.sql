ALTER TABLE "TorqueWrenchConnectionLease"
ADD COLUMN "adoptedConfirmationId" TEXT;

ALTER TABLE "TorqueWrenchConnectionLeaseHistory"
ADD COLUMN "adoptedConfirmationId" TEXT;
