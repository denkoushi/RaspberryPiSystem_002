ALTER TABLE "AssemblyProcedureDocumentFeedback" ADD COLUMN "modelInput" TEXT,
ADD COLUMN "promptVersion" TEXT;

CREATE TABLE "AssemblyProcedureDocumentFeedbackRating" (
    "feedbackId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssemblyProcedureDocumentFeedbackRating_pkey" PRIMARY KEY ("feedbackId","section","itemIndex")
);

ALTER TABLE "AssemblyProcedureDocumentFeedbackRating" ADD CONSTRAINT "AssemblyProcedureDocumentFeedbackRating_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "AssemblyProcedureDocumentFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
