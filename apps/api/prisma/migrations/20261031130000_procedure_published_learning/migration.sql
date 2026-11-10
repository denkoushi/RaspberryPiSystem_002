CREATE TABLE "AssemblyProcedureSiteVocabulary" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "documentCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssemblyProcedureSiteVocabulary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssemblyProcedureSiteVocabulary_site_term_key" ON "AssemblyProcedureSiteVocabulary"("site", "term");

CREATE TABLE "AssemblyProcedureLearningSnapshot" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "publishedDocuments" INTEGER NOT NULL,
    "textKept" INTEGER NOT NULL,
    "textEdited" INTEGER NOT NULL,
    "textReverted" INTEGER NOT NULL,
    "captionKept" INTEGER NOT NULL,
    "captionEdited" INTEGER NOT NULL,
    "captionDeleted" INTEGER NOT NULL,
    "learnedTerms" INTEGER NOT NULL,
    "vocabularyTerms" INTEGER NOT NULL,
    "vocabularyBuiltAt" TIMESTAMP(3),
    "vocabularyDocuments" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyProcedureLearningSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssemblyProcedureLearningSnapshot_site_day_key" ON "AssemblyProcedureLearningSnapshot"("site", "day");
