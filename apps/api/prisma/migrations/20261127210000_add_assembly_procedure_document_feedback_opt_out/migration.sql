CREATE TABLE "AssemblyProcedureDocumentFeedbackOptOut" (
    "revisionRootId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyProcedureDocumentFeedbackOptOut_pkey" PRIMARY KEY ("revisionRootId")
);
