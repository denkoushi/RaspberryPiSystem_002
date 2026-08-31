#!/usr/bin/env bash
set -euo pipefail

# This is intentionally an inner validation command.  It must be invoked by
# scripts/test/work-instructions-validation.sh, which owns the disposable
# PostgreSQL container, volume, loopback port and storage directory.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${DATABASE_URL:?DATABASE_URL must be supplied by work-instructions-validation.sh}"
: "${WORK_INSTRUCTION_CONTAINER_ID:?run this command through work-instructions-validation.sh}"
: "${WORK_INSTRUCTION_TEST_ROOT:?run this command through work-instructions-validation.sh}"
: "${FILE_STORAGE_ROOT:?run this command through work-instructions-validation.sh}"

if [[ ! -d "${FILE_STORAGE_ROOT}" ]]; then
  echo "inherited FILE_STORAGE_ROOT does not exist: ${FILE_STORAGE_ROOT}" >&2
  exit 1
fi
if [[ "${DATABASE_URL}" != *127.0.0.1:* ]]; then
  echo "refusing a non-loopback DATABASE_URL; use work-instructions-validation.sh" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for the SQL validation" >&2
  exit 1
fi

cd "${repo_root}"

echo "[1/5] Prisma client generation and idempotent migration deployment"
pnpm --filter @raspi-system/api prisma:generate
pnpm --filter @raspi-system/api prisma:deploy
pnpm --filter @raspi-system/api prisma:deploy
pnpm --filter @raspi-system/api exec prisma migrate status

run_id="$(date -u +%Y%m%d%H%M%S)-$$"
row_id="wi-db-validation-${run_id}-row"
asset_v0_id="wi-db-validation-${run_id}-source-v0"
asset_v1_id="wi-db-validation-${run_id}-source-v1"
asset_v2_id="wi-db-validation-${run_id}-source-v2"
edit_asset_id="wi-db-validation-${run_id}-edit"
version_v0_id="wi-db-validation-${run_id}-version-v0"
version_v1_id="wi-db-validation-${run_id}-version-v1"
version_v2_id="wi-db-validation-${run_id}-version-v2"
revision_id="wi-db-validation-${run_id}-revision"
overlay_id="wi-db-validation-${run_id}-overlay"
publication_id="wi-db-validation-${run_id}-publication"
source_step_v0_id="wi-db-validation-${run_id}-source-step-v0"
source_step_v1_id="wi-db-validation-${run_id}-source-step-v1"
source_step_v2_id="wi-db-validation-${run_id}-source-step-v2"
current_step_id="wi-db-validation-${run_id}-current-step"
audit_id="wi-db-validation-${run_id}-audit"

psql_base=(psql -X -v ON_ERROR_STOP=1)

echo "[2/5] Schema constraints, fixture invariants and deletion tombstone checks"
"${psql_base[@]}" \
  -v row_id="${row_id}" \
  -v asset_v0_id="${asset_v0_id}" \
  -v asset_v1_id="${asset_v1_id}" \
  -v asset_v2_id="${asset_v2_id}" \
  -v edit_asset_id="${edit_asset_id}" \
  -v version_v0_id="${version_v0_id}" \
  -v version_v1_id="${version_v1_id}" \
  -v version_v2_id="${version_v2_id}" \
  -v revision_id="${revision_id}" \
  -v overlay_id="${overlay_id}" \
  -v publication_id="${publication_id}" \
  -v source_step_v0_id="${source_step_v0_id}" \
  -v source_step_v1_id="${source_step_v1_id}" \
  -v source_step_v2_id="${source_step_v2_id}" \
  -v current_step_id="${current_step_id}" \
  -v audit_id="${audit_id}" \
  "${DATABASE_URL}" <<'SQL'
INSERT INTO "WorkInstructionRow" (
  "id", "sourceSystem", "sourceList", "sourceItemId", "sourceModified",
  "partNumber", "shootingTarget", "rawManifest", "contentHash", "createdAt", "updatedAt"
) VALUES (
  :'row_id', 'SharePoint', 'DB-Validation', 990001,
  '2026-08-29T00:00:00.000Z', 'WI-DB-VALIDATION', '加工',
  '{"validation": true}', repeat('1', 64), now(), now()
);

INSERT INTO "WorkInstructionAsset" (
  "id", "storageKey", "mimeType", "sizeBytes", "sha256", "status", "createdAt", "updatedAt"
) VALUES
  (:'asset_v0_id', 'work-instruction/db-validation/source-v0.jpg', 'image/jpeg', 4, repeat('0', 64), 'ACTIVE', now(), now()),
  (:'asset_v1_id', 'work-instruction/db-validation/source-v1.jpg', 'image/jpeg', 4, repeat('1', 64), 'ACTIVE', now(), now()),
  (:'asset_v2_id', 'work-instruction/db-validation/source-v2.jpg', 'image/jpeg', 4, repeat('2', 64), 'ACTIVE', now(), now());

INSERT INTO "WorkInstructionStep" (
  "id", "rowId", "step", "text", "imageName", "assetId", "createdAt", "updatedAt"
) VALUES (
  :'current_step_id', :'row_id', 1, 'latest cached step', 'source-v2.jpg', :'asset_v2_id', now(), now()
);

INSERT INTO "WorkInstructionSourceVersion" (
  "id", "rowId", "sourceModified", "partNumber", "shootingTarget", "rawManifest", "contentHash", "createdAt"
) VALUES
  (:'version_v0_id', :'row_id', '2026-08-27T00:00:00.000Z', 'WI-DB-VALIDATION', '加工', '{"version": 0}', repeat('0', 64), now()),
  (:'version_v1_id', :'row_id', '2026-08-28T00:00:00.000Z', 'WI-DB-VALIDATION', '加工', '{"version": 1}', repeat('1', 64), now()),
  (:'version_v2_id', :'row_id', '2026-08-29T00:00:00.000Z', 'WI-DB-VALIDATION', '加工', '{"version": 2}', repeat('2', 64), now());

INSERT INTO "WorkInstructionSourceVersionStep" (
  "id", "sourceVersionId", "step", "text", "imageName", "imageAssetId", "imageSha256", "createdAt"
) VALUES
  (:'source_step_v0_id', :'version_v0_id', 1, 'version zero step', 'source-v0.jpg', :'asset_v0_id', repeat('0', 64), now()),
  (:'source_step_v1_id', :'version_v1_id', 1, 'version one step', 'source-v1.jpg', :'asset_v1_id', repeat('1', 64), now()),
  (:'source_step_v2_id', :'version_v2_id', 1, 'version two step', 'source-v2.jpg', :'asset_v2_id', repeat('2', 64), now());

INSERT INTO "WorkInstructionEditRevision" (
  "id", "sourceVersionId", "revisionNumber", "isRevisionHead", "status", "editVersion",
  "baseContentHash", "createdAt", "updatedAt"
) VALUES (
  :'revision_id', :'version_v1_id', 1, true, 'PUBLISHED', 3, repeat('1', 64), now(), now()
);

INSERT INTO "WorkInstructionEditAsset" (
  "id", "storageKey", "mimeType", "sizeBytes", "sha256", "status", "origin", "ownerRevisionId",
  "createdAt", "activatedAt", "updatedAt"
) VALUES (
  :'edit_asset_id', 'work-instruction-assets/editing/db-validation/overlay.png', 'image/png', 4,
  repeat('e', 64), 'ACTIVE', 'UPLOAD', :'revision_id', now(), now(), now()
);

INSERT INTO "WorkInstructionEditOverlay" (
  "id", "revisionId", "sourceStep", "migratedFromStep", "baseStepFingerprint", "targetStepFingerprint",
  "migrationState", "kind", "xRatio", "yRatio", "widthRatio", "heightRatio", "zIndex", "opacity",
  "maskEnabled", "text", "editAssetId", "objectFit", "createdAt", "updatedAt"
) VALUES (
  :'overlay_id', :'revision_id', 1, 1, repeat('a', 64), repeat('b', 64), 'MIGRATED', 'IMAGE',
  0.10, 0.20, 0.30, 0.40, 5, 0.9, false, NULL, :'edit_asset_id', 'contain', now(), now()
);

INSERT INTO "WorkInstructionSourcePublication" (
  "id", "rowId", "latestVersionId", "publishedVersionId", "publishedRevisionId", "createdAt", "updatedAt"
) VALUES (
  :'publication_id', :'row_id', :'version_v2_id', :'version_v1_id', :'revision_id', now(), now()
);

CREATE TEMP TABLE "_wi_validation_ids" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL
);
INSERT INTO "_wi_validation_ids" ("key", "value") VALUES
  ('row_id', :'row_id'),
  ('asset_v0_id', :'asset_v0_id'),
  ('asset_v1_id', :'asset_v1_id'),
  ('asset_v2_id', :'asset_v2_id'),
  ('edit_asset_id', :'edit_asset_id'),
  ('version_v0_id', :'version_v0_id'),
  ('version_v1_id', :'version_v1_id'),
  ('version_v2_id', :'version_v2_id'),
  ('revision_id', :'revision_id'),
  ('overlay_id', :'overlay_id'),
  ('source_step_v0_id', :'source_step_v0_id'),
  ('audit_id', :'audit_id');

DO $$
DECLARE
  constraint_name text;
  expected_checks text[] := ARRAY[
    'WorkInstructionSourceVersionStep_step_check',
    'WorkInstructionEditRevision_revisionNumber_check',
    'WorkInstructionEditRevision_editVersion_check',
    'WorkInstructionEditAsset_size_check',
    'WorkInstructionEditAsset_origin_source_step_check',
    'WorkInstructionEditAsset_origin_bbox_check',
    'WorkInstructionEditOverlay_migratedFromStep_check',
    'WorkInstructionEditOverlay_sourceStep_check',
    'WorkInstructionEditOverlay_bbox_check',
    'WorkInstructionEditOverlay_opacity_check',
    'WorkInstructionEditOverlay_mask_check',
    'WorkInstructionEditOverlay_variant_check',
    'WorkInstructionEditOverlay_objectFit_check',
    'WorkInstructionEditOverlay_strokeWidth_check',
    'WorkInstructionEditOverlay_shapePoints_check'
  ];
  expected_foreign_keys text[] := ARRAY[
    'WorkInstructionSourceVersion_rowId_fkey',
    'WorkInstructionSourceVersionStep_sourceVersionId_fkey',
    'WorkInstructionSourceVersionStep_imageAssetId_fkey',
    'WorkInstructionEditRevision_sourceVersionId_fkey',
    'WorkInstructionEditRevision_supersedesRevisionId_fkey',
    'WorkInstructionEditRevision_copiedFromRevisionId_fkey',
    'WorkInstructionEditAsset_ownerRevisionId_fkey',
    'WorkInstructionEditAsset_originSourceVersionId_fkey',
    'WorkInstructionEditOverlay_revisionId_fkey',
    'WorkInstructionEditOverlay_editAssetId_fkey',
    'WorkInstructionSourcePublication_rowId_fkey',
    'WorkInstructionSourcePublication_latestVersionId_fkey',
    'WorkInstructionSourcePublication_publishedVersionId_fkey',
    'WorkInstructionSourcePublication_publishedRevisionId_fkey',
    'WorkInstructionSourceAssetDeletionAudit_sourceVersionId_fkey'
  ];
  expected_indexes text[] := ARRAY[
    'WorkInstructionSourceVersion_unique_snapshot',
    'WorkInstructionSourceVersionStep_unique_step',
    'WorkInstructionEditRevision_unique_number',
    'WorkInstructionEditRevision_unique_head',
    'WorkInstructionEditAsset_storageKey_key',
    'WorkInstructionSourcePublication_row_key'
  ];
BEGIN
  FOREACH constraint_name IN ARRAY expected_checks || expected_foreign_keys LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = constraint_name
    ) THEN
      RAISE EXCEPTION 'missing expected constraint %', constraint_name;
    END IF;
  END LOOP;
  FOREACH constraint_name IN ARRAY expected_indexes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = constraint_name AND c.relkind = 'i'
    ) THEN
      RAISE EXCEPTION 'missing expected index %', constraint_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'WorkInstructionEditRevision_unique_head'
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'revision head index is not partial';
  END IF;
END $$;

DO $$
DECLARE
  latest_id text;
  published_id text;
  published_revision_id text;
BEGIN
  SELECT "latestVersionId", "publishedVersionId", "publishedRevisionId"
    INTO latest_id, published_id, published_revision_id
  FROM "WorkInstructionSourcePublication"
  WHERE "rowId" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'row_id');
  IF latest_id <> (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'version_v2_id')
     OR published_id <> (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'version_v1_id')
     OR published_revision_id <> (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'revision_id') THEN
    RAISE EXCEPTION 'latest/public pointer invariant failed: latest %, published %, revision %',
      latest_id, published_id, published_revision_id;
  END IF;
  IF (SELECT count(*) FROM "WorkInstructionSourceVersion"
      WHERE "rowId" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'row_id')) <> 3 THEN
    RAISE EXCEPTION 'source version snapshot count is not three';
  END IF;
  IF (SELECT "contentHash" FROM "WorkInstructionSourceVersion"
      WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'version_v1_id')) <> repeat('1', 64) THEN
    RAISE EXCEPTION 'immutable source version content hash changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "WorkInstructionSourcePublication" p
    JOIN "WorkInstructionSourceVersion" lv ON lv."id" = p."latestVersionId"
    JOIN "WorkInstructionSourceVersion" pv ON pv."id" = p."publishedVersionId"
    LEFT JOIN "WorkInstructionEditRevision" r ON r."id" = p."publishedRevisionId"
    WHERE lv."rowId" IS DISTINCT FROM p."rowId"
       OR pv."rowId" IS DISTINCT FROM p."rowId"
       OR (r."id" IS NOT NULL AND r."sourceVersionId" IS DISTINCT FROM p."publishedVersionId")
  ) THEN
    RAISE EXCEPTION 'publication pointer row/version/revision integrity failed';
  END IF;
END $$;

-- The old published image remains referenced by its immutable source snapshot,
-- so a normal source-asset GC anti-join must not select it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "WorkInstructionAsset" a
    WHERE a."id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'asset_v1_id')
      AND NOT EXISTS (SELECT 1 FROM "WorkInstructionStep" s WHERE s."assetId" = a."id")
      AND NOT EXISTS (SELECT 1 FROM "WorkInstructionSourceVersionStep" s WHERE s."imageAssetId" = a."id")
  ) THEN
    RAISE EXCEPTION 'published source asset is incorrectly eligible for automatic GC';
  END IF;
END $$;

-- Exercise the deletion tombstone shape on an unreferenced historical version.
UPDATE "WorkInstructionSourceVersionStep"
SET "imageAssetId" = NULL, "imageDeletedAt" = now(), "imageDeletedBy" = 'db-validation-admin'
WHERE "id" = :'source_step_v0_id';
UPDATE "WorkInstructionAsset"
SET "status" = 'DELETE_PENDING', "deletePendingAt" = now()
WHERE "id" = :'asset_v0_id';
INSERT INTO "WorkInstructionSourceAssetDeletionAudit" (
  "id", "assetId", "sourceVersionId", "storageKey", "sha256", "requestedBy", "status", "requestedAt"
)
SELECT :'audit_id', a."id", :'version_v0_id', a."storageKey", a."sha256", 'db-validation-admin', 'REQUESTED', now()
FROM "WorkInstructionAsset" a
WHERE a."id" = :'asset_v0_id';
DELETE FROM "WorkInstructionAsset" WHERE "id" = :'asset_v0_id';
UPDATE "WorkInstructionSourceAssetDeletionAudit"
SET "status" = 'DELETED', "completedAt" = now()
WHERE "id" = :'audit_id';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WorkInstructionSourceVersionStep"
             WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'source_step_v0_id')
               AND "imageAssetId" IS NOT NULL) THEN
    RAISE EXCEPTION 'source image tombstone did not clear imageAssetId';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WorkInstructionSourceVersionStep"
    WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'source_step_v0_id')
      AND "imageSha256" = repeat('0', 64) AND "imageDeletedBy" = 'db-validation-admin'
  ) THEN
    RAISE EXCEPTION 'source image tombstone did not retain audit metadata';
  END IF;
  IF EXISTS (SELECT 1 FROM "WorkInstructionAsset"
             WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'asset_v0_id')) THEN
    RAISE EXCEPTION 'deleted source asset row remains';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WorkInstructionSourceAssetDeletionAudit"
    WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'audit_id')
      AND "assetId" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'asset_v0_id')
      AND "status" = 'DELETED' AND "completedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source asset deletion audit tombstone is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WorkInstructionEditOverlay"
    WHERE "id" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'overlay_id')
      AND "editAssetId" = (SELECT "value" FROM "_wi_validation_ids" WHERE "key" = 'edit_asset_id')
  ) THEN
    RAISE EXCEPTION 'edit overlay reference was damaged by source asset deletion';
  END IF;
END $$;
SQL

echo "[3/5] ANALYZE and required access-path plans"
"${psql_base[@]}" "${DATABASE_URL}" -c '
ANALYZE "WorkInstructionRow";
ANALYZE "WorkInstructionSourceVersion";
ANALYZE "WorkInstructionSourceVersionStep";
ANALYZE "WorkInstructionSourcePublication";
ANALYZE "WorkInstructionEditRevision";
ANALYZE "WorkInstructionEditOverlay";
ANALYZE "WorkInstructionAsset";
ANALYZE "WorkInstructionEditAsset";
ANALYZE "WorkInstructionSourceAssetDeletionAudit";
'

explain_query() {
  local label="$1"
  local query="$2"
  echo "--- EXPLAIN (ANALYZE, BUFFERS): ${label} ---"
  "${psql_base[@]}" "${DATABASE_URL}" -c "${query}"
}

explain_query "source tuple -> latest/public publication" '
EXPLAIN (ANALYZE, BUFFERS)
SELECT r."sourceSystem", r."sourceList", r."sourceItemId",
       p."latestVersionId", p."publishedVersionId", p."publishedRevisionId"
FROM "WorkInstructionRow" r
JOIN "WorkInstructionSourcePublication" p ON p."rowId" = r."id"
WHERE r."sourceSystem" = '\''SharePoint'\''
  AND r."sourceList" = '\''DB-Validation'\''
  AND r."sourceItemId" = 990001;
'

explain_query "revision -> overlays" "
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.\"id\", r.\"status\", o.\"id\", o.\"sourceStep\", o.\"migrationState\", o.\"zIndex\"
FROM \"WorkInstructionEditRevision\" r
JOIN \"WorkInstructionEditOverlay\" o ON o.\"revisionId\" = r.\"id\"
WHERE r.\"id\" = '${revision_id}'
ORDER BY o.\"sourceStep\", o.\"zIndex\";
"

explain_query "source and edit asset references" "
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.\"sourceVersionId\", s.\"step\", s.\"imageAssetId\", a.\"storageKey\"
FROM \"WorkInstructionSourceVersionStep\" s
LEFT JOIN \"WorkInstructionAsset\" a ON a.\"id\" = s.\"imageAssetId\"
WHERE s.\"sourceVersionId\" = '${version_v1_id}'
UNION ALL
SELECT o.\"revisionId\", o.\"sourceStep\", o.\"editAssetId\", a.\"storageKey\"
FROM \"WorkInstructionEditOverlay\" o
LEFT JOIN \"WorkInstructionEditAsset\" a ON a.\"id\" = o.\"editAssetId\"
WHERE o.\"revisionId\" = '${revision_id}';
"

explain_query "source asset GC candidates" '
EXPLAIN (ANALYZE, BUFFERS)
SELECT a."id", a."storageKey"
FROM "WorkInstructionAsset" a
WHERE a."status" IN ('\''ACTIVE'\'', '\''DELETE_PENDING'\'')
  AND NOT EXISTS (SELECT 1 FROM "WorkInstructionStep" s WHERE s."assetId" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "WorkInstructionSourceVersionStep" s WHERE s."imageAssetId" = a."id");
'

explain_query "edit asset GC candidates" '
EXPLAIN (ANALYZE, BUFFERS)
SELECT a."id", a."status", a."ownerRevisionId", a."storageKey"
FROM "WorkInstructionEditAsset" a
LEFT JOIN "WorkInstructionEditOverlay" o ON o."editAssetId" = a."id"
LEFT JOIN "WorkInstructionEditRevision" r ON r."id" = a."ownerRevisionId"
WHERE o."id" IS NULL
  AND (
    (a."status" = '\''STAGED'\'' AND a."createdAt" <= now() - interval '\''1 hour'\'')
    OR a."status" = '\''DELETE_PENDING'\''
    OR (a."status" = '\''ACTIVE'\'' AND (r."id" IS NULL OR r."status" <> '\''DRAFT'\''))
  );
'

explain_query "source deletion audit search" "
EXPLAIN (ANALYZE, BUFFERS)
SELECT \"id\", \"assetId\", \"sourceVersionId\", \"status\", \"requestedBy\", \"requestedAt\", \"completedAt\"
FROM \"WorkInstructionSourceAssetDeletionAudit\"
WHERE \"sourceVersionId\" = (SELECT \"sourceVersionId\" FROM \"WorkInstructionSourceAssetDeletionAudit\" WHERE \"id\" = '${audit_id}');
"

echo "[4/5] Work-instruction integration tests against the inherited disposable database"
WORK_INSTRUCTION_INTEGRATION=true \
  pnpm --filter @raspi-system/api exec vitest run \
    --config vitest.config.ts \
    src/services/work-instructions/__tests__/prisma-work-instruction-edit.integration.test.ts \
    src/services/work-instructions/__tests__/prisma-work-instruction-repository.integration.test.ts \
    src/services/work-instructions/__tests__/work-instruction-gmail-prisma-fs.integration.test.ts \
    src/services/work-instructions/__tests__/work-instruction-gmail-failure.integration.test.ts

echo "[5/5] Work-instruction overlay database validation completed"
echo "database=${DATABASE_URL%%\?*}"
echo "storage=${FILE_STORAGE_ROOT}"
echo "No Docker resource is created or removed by this inner command; the outer harness owns cleanup."
