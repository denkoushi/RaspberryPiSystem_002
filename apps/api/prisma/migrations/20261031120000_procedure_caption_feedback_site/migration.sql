ALTER TABLE "AssemblyProcedureCaptionFeedback" ADD COLUMN "site" TEXT;

CREATE INDEX "AssemblyProcedureCaptionFeedback_site_outcome_resolvedAt_idx"
ON "AssemblyProcedureCaptionFeedback"("site", "outcome", "resolvedAt");

UPDATE "AssemblyProcedureCaptionFeedback" AS feedback
SET "site" = sites.site
FROM "AssemblyProcedureDocumentRevision" AS source
JOIN (
    SELECT revision."revisionRootId",
           CASE
               WHEN bool_or(process.name LIKE '組立%' OR parent.name LIKE '組立%') THEN 'assembly'
               WHEN bool_or(process.name LIKE '研削%' OR parent.name LIKE '研削%') THEN 'grinding'
               ELSE NULL
           END AS site
    FROM "AssemblyProcedureDocumentRevision" AS revision
    JOIN "ProcedureManualAssignment" AS assignment
      ON assignment."assemblyProcedureDocumentId" = revision."documentId"
    JOIN "ProcedureManualProcess" AS process ON process.id = assignment."processId"
    LEFT JOIN "ProcedureManualProcess" AS parent ON parent.id = process."parentId"
    GROUP BY revision."revisionRootId"
) AS sites ON sites."revisionRootId" = source."revisionRootId"
WHERE feedback."documentId" = source."documentId";
