-- Expand-only: existing rows and constraints remain unchanged; references on new columns are checked in code.
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "fieldId" TEXT;
ALTER TABLE "KnowledgeTriage" ADD COLUMN "presetProcedureId" TEXT;

CREATE TABLE "KnowledgeField" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeField_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeField_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeField"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeField_name_key" ON "KnowledgeField"("name");
CREATE INDEX "KnowledgeField_parentId_sortOrder_idx" ON "KnowledgeField"("parentId", "sortOrder");

-- A separate identity table keeps uniqueness additive, including topics created before this migration.
CREATE TABLE "KnowledgeTopicIdentity" (
    "key" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    CONSTRAINT "KnowledgeTopicIdentity_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "KnowledgeTopicIdentity_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "KnowledgeProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeTopicIdentity_procedureId_key" ON "KnowledgeTopicIdentity"("procedureId");
CREATE INDEX "KnowledgeProcedure_fieldId_idx" ON "KnowledgeProcedure"("fieldId");
