-- Applied after the enum migration has committed.
CREATE TABLE "ProcedureManualCommonAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ProcedureManualCommonAction_name_key" ON "ProcedureManualCommonAction"("name");
CREATE TABLE "ProcedureManualCommonSubject" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kanaRow" TEXT,
  CONSTRAINT "ProcedureManualCommonSubject_kanaRow_check" CHECK (
    "kanaRow" IS NULL OR "kanaRow" IN ('あ','か','さ','た','な','は','ま','や','ら','わ')
  )
);
