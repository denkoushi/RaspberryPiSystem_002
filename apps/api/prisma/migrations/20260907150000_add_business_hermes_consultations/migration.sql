CREATE TABLE "BusinessHermesConsultation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "relatedIdentifiers" JSONB,
    "confirmedFacts" JSONB,
    "openQuestions" JSONB,
    "summary" TEXT,
    "hermesConversationId" TEXT,
    "createdByUserId" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessHermesConsultation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessHermesConsultationMessage" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessHermesConsultationMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessHermesConsultationMessage_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "BusinessHermesConsultation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BusinessHermesConsultation_hermesConversationId_key" ON "BusinessHermesConsultation"("hermesConversationId");
CREATE INDEX "BusinessHermesConsultation_updatedAt_idx" ON "BusinessHermesConsultation"("updatedAt");
CREATE INDEX "BusinessHermesConsultation_createdByUserId_updatedAt_idx" ON "BusinessHermesConsultation"("createdByUserId", "updatedAt");
CREATE INDEX "BusinessHermesConsultation_assignedUserId_updatedAt_idx" ON "BusinessHermesConsultation"("assignedUserId", "updatedAt");
CREATE INDEX "BusinessHermesConsultationMessage_consultationId_createdAt_idx" ON "BusinessHermesConsultationMessage"("consultationId", "createdAt");
