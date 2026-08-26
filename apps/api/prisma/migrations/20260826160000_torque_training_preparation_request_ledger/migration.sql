-- Idempotency ledger for the training one-touch preparation flow.
-- The existing confirmation table remains the sole operator/device audit row.
CREATE TABLE "TorqueTrainingWrenchPreparationRequest" (
    "requestId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorqueTrainingWrenchPreparationRequest_pkey" PRIMARY KEY ("requestId"),
    CONSTRAINT "TorqueTrainingWrenchPreparationRequest_confirmationId_key" UNIQUE ("confirmationId"),
    CONSTRAINT "TorqueTrainingWrenchPreparationRequest_confirmationId_fkey"
      FOREIGN KEY ("confirmationId") REFERENCES "TorqueTrainingWrenchConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
