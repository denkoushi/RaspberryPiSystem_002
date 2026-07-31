#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node24="${CODEX_NODE24_PATH:-/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
prisma_cli="$repo_root/apps/api/node_modules/prisma/build/index.js"
task_token="assembly-step-$(date +%s)-$$"
task_label="codex.assembly-step-validation=$task_token"
container_name="raspi-assembly-step-pg-$task_token"
volume_name="raspi-assembly-step-volume-$task_token"
network_name="raspi-assembly-step-network-$task_token"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/raspi-assembly-step.XXXXXX")"

cleanup() {
  local cleanup_status=0
  set +e
  docker rm -f "$container_name" >/dev/null 2>&1
  docker volume rm "$volume_name" >/dev/null 2>&1
  docker network rm "$network_name" >/dev/null 2>&1
  if [[ -n "$scratch_dir" && "$scratch_dir" == */raspi-assembly-step.* ]]; then
    rm -rf "$scratch_dir"
  fi
  if [[ -n "$(docker ps -aq --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  if [[ -n "$(docker volume ls -q --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  if [[ -n "$(docker network ls -q --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  set -e
  if [[ "$cleanup_status" -ne 0 ]]; then
    echo "isolated Docker resource cleanup verification failed" >&2
    return 1
  fi
  echo "isolated Docker resources removed; label residue=0"
}

finish() {
  local status=$?
  trap - EXIT INT TERM
  cleanup || status=1
  exit "$status"
}
trap finish EXIT INT TERM

if [[ ! -x "$node24" ]]; then
  echo "Node 24 runtime is not executable: $node24" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available" >&2
  exit 1
fi
if ! docker image inspect pgvector/pgvector:pg15 >/dev/null 2>&1; then
  docker pull pgvector/pgvector:pg15
fi

docker network create --label "$task_label" "$network_name" >/dev/null
docker volume create --label "$task_label" "$volume_name" >/dev/null
docker run -d \
  --name "$container_name" \
  --label "$task_label" \
  --network "$network_name" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=assembly_fresh \
  -p 127.0.0.1::5432 \
  -v "$volume_name:/var/lib/postgresql/data" \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d assembly_fresh >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d assembly_fresh >/dev/null
host_port="$(docker port "$container_name" 5432/tcp | awk -F: 'END { print $NF }')"
fresh_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_fresh"
upgrade_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_upgrade"

echo "fresh migration deploy/status on isolated PostgreSQL port $host_port"
DATABASE_URL="$fresh_url" "$node24" "$prisma_cli" validate \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$fresh_url" "$node24" "$prisma_cli" generate \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$fresh_url" "$node24" "$prisma_cli" migrate deploy \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$fresh_url" "$node24" "$prisma_cli" migrate status \
  --schema "$repo_root/apps/api/prisma/schema.prisma"

echo "upgrade migration from origin/main without modifying existing rows"
docker exec "$container_name" createdb -U postgres assembly_upgrade
mkdir -p "$scratch_dir/main"
git -C "$repo_root" archive origin/main -- apps/api/prisma | tar -x -C "$scratch_dir/main"
DATABASE_URL="$upgrade_url" "$node24" "$prisma_cli" migrate deploy \
  --schema "$scratch_dir/main/apps/api/prisma/schema.prisma"

docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d assembly_upgrade <<'SQL'
INSERT INTO "KioskDocument" (
  id, title, filename, "filePath", "sourceType", "pageCount", "createdAt", "updatedAt"
) VALUES (
  'upgrade-kiosk', 'Upgrade Kiosk', 'upgrade.pdf', '/upgrade.pdf', 'MANUAL', 2, now(), now()
);
INSERT INTO "AssemblyProcedureDocument" (
  id, name, "imageRelativePath", status, "publishedAt", "isActive", "createdAt", "updatedAt"
) VALUES
  ('upgrade-doc-primary', 'Upgrade Primary', '/upgrade-primary.png', 'PUBLISHED', now(), true, now(), now()),
  ('upgrade-doc-secondary', 'Upgrade Secondary', '/upgrade-secondary.png', 'PUBLISHED', now(), true, now(), now());
INSERT INTO "AssemblyProcedureDocumentPage" (
  id, "documentId", "pageIndex", "imageRelativePath", "createdAt"
) VALUES
  ('upgrade-page-0', 'upgrade-doc-primary', 0, '/upgrade-primary-0.png', now()),
  ('upgrade-page-1', 'upgrade-doc-primary', 1, '/upgrade-primary-1.png', now());
INSERT INTO "AssemblyTemplate" (
  id, "modelCode", "procedurePattern", name, version, "isActive",
  "procedureDocumentId", "createdAt", "updatedAt"
) VALUES (
  'upgrade-template', 'UPGRADE-MODEL', 'P1', 'Upgrade Template', 1, true,
  'upgrade-doc-primary', now(), now()
);
INSERT INTO "AssemblyTemplateProcedureItem" (
  id, "templateId", "assemblyProcedureDocumentId", "sortOrder", label, "createdAt", "updatedAt"
) VALUES (
  'upgrade-item', 'upgrade-template', 'upgrade-doc-primary', 0, 'primary', now(), now()
);
INSERT INTO "AssemblyTemplateArea" (
  id, "templateId", "sortOrder", "processNo", "areaCode", "areaName", "unitCode",
  "requireManualAdvance", "createdAt", "updatedAt"
) VALUES (
  'upgrade-area', 'upgrade-template', 0, '10', 'A', 'Upgrade Area', 'U1', true, now(), now()
);
INSERT INTO "AssemblyTemplateBolt" (
  id, "areaId", "templateId", "sortOrder", "tighteningId", "markerNo",
  "xRatio", "yRatio", "assemblyProcedureDocumentId", "pageIndex", "boltSpec",
  "nominalTorque", "lowerLimit", "upperLimit", unit, "createdAt", "updatedAt"
) VALUES (
  'upgrade-bolt', 'upgrade-area', 'upgrade-template', 0, 'UP-B1', 1,
  0.25, 0.25, 'upgrade-doc-primary', 0, 'M8',
  10, 9, 11, 'N-m', now(), now()
);
INSERT INTO "AssemblyTemplateCheckItem" (
  id, "templateId", "markerNo", label, required, "xRatio", "yRatio",
  "kioskDocumentId", "pageIndex", "sortOrder", "createdAt", "updatedAt"
) VALUES (
  'upgrade-check', 'upgrade-template', 2, 'Upgrade Check', true, 0.5, 0.5,
  'upgrade-kiosk', 0, 0, now(), now()
);
SQL

snapshot_sql='
SELECT json_build_object(
  '"'"'documents'"'"', (SELECT json_agg(d ORDER BY id) FROM (
    SELECT id, name, "imageRelativePath", status, "isActive"
    FROM "AssemblyProcedureDocument" WHERE id LIKE '"'"'upgrade-%'"'"'
  ) d),
  '"'"'pages'"'"', (SELECT json_agg(p ORDER BY id) FROM (
    SELECT id, "documentId", "pageIndex", "imageRelativePath"
    FROM "AssemblyProcedureDocumentPage" WHERE id LIKE '"'"'upgrade-%'"'"'
  ) p),
  '"'"'templates'"'"', (SELECT json_agg(t ORDER BY id) FROM (
    SELECT id, "modelCode", "procedurePattern", name, version, "isActive", "procedureDocumentId"
    FROM "AssemblyTemplate" WHERE id = '"'"'upgrade-template'"'"'
  ) t),
  '"'"'items'"'"', (SELECT json_agg(i ORDER BY id) FROM (
    SELECT id, "templateId", "kioskDocumentId", "assemblyProcedureDocumentId", "sortOrder", label
    FROM "AssemblyTemplateProcedureItem" WHERE id = '"'"'upgrade-item'"'"'
  ) i),
  '"'"'bolts'"'"', (SELECT json_agg(b ORDER BY id) FROM (
    SELECT id, "areaId", "templateId", "markerNo", "xRatio", "yRatio",
           "assemblyProcedureDocumentId", "pageIndex"
    FROM "AssemblyTemplateBolt" WHERE id = '"'"'upgrade-bolt'"'"'
  ) b),
  '"'"'checks'"'"', (SELECT json_agg(c ORDER BY id) FROM (
    SELECT id, "templateId", "markerNo", "xRatio", "yRatio", "kioskDocumentId", "pageIndex"
    FROM "AssemblyTemplateCheckItem" WHERE id = '"'"'upgrade-check'"'"'
  ) c)
)::text;
'
docker exec "$container_name" psql -XAt -U postgres -d assembly_upgrade \
  -c "$snapshot_sql" >"$scratch_dir/before-upgrade.txt"
cp -R \
  "$repo_root/apps/api/prisma/migrations/20260726173000_assembly_template_procedure_steps" \
  "$scratch_dir/main/apps/api/prisma/migrations/"
DATABASE_URL="$upgrade_url" "$node24" "$prisma_cli" migrate deploy \
  --schema "$scratch_dir/main/apps/api/prisma/schema.prisma"
docker exec "$container_name" psql -XAt -U postgres -d assembly_upgrade \
  -c "$snapshot_sql" >"$scratch_dir/after-upgrade.txt"
cmp "$scratch_dir/before-upgrade.txt" "$scratch_dir/after-upgrade.txt"
upgrade_step_count="$(docker exec "$container_name" psql -XAt -U postgres -d assembly_upgrade \
  -c 'SELECT count(*) FROM "AssemblyTemplateProcedureStep";')"
[[ "$upgrade_step_count" == "0" ]]

echo "direct SQL checks for XOR, page, crop, unique, CASCADE and RESTRICT"
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d assembly_fresh <<'SQL'
INSERT INTO "KioskDocument" (
  id, title, filename, "filePath", "sourceType", "pageCount", "createdAt", "updatedAt"
) VALUES ('db-kiosk', 'DB Kiosk', 'db.pdf', '/db.pdf', 'MANUAL', 2, now(), now());
INSERT INTO "AssemblyProcedureDocument" (
  id, name, "imageRelativePath", status, "publishedAt", "isActive", "createdAt", "updatedAt"
) VALUES
  ('db-doc-primary', 'DB Primary', '/db-primary.png', 'PUBLISHED', now(), true, now(), now()),
  ('db-doc-secondary', 'DB Secondary', '/db-secondary.png', 'PUBLISHED', now(), true, now(), now());
INSERT INTO "AssemblyTemplate" (
  id, "modelCode", "procedurePattern", name, version, "isActive",
  "procedureDocumentId", "createdAt", "updatedAt"
) VALUES (
  'db-template', 'DB-MODEL', 'P1', 'DB Template', 1, true,
  'db-doc-primary', now(), now()
);
INSERT INTO "AssemblyTemplateProcedureStep" (
  id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
  "viewMode", emphasis, "updatedAt"
) VALUES (
  'valid-full', 'db-template', 'db-doc-primary', 0, 0, 'FULL_PAGE', 'NORMAL', now()
);
INSERT INTO "AssemblyTemplateProcedureStep" (
  id, "templateId", "kioskDocumentId", "sortOrder", "pageIndex", "viewMode",
  "cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio", emphasis, "updatedAt"
) VALUES (
  'valid-crop', 'db-template', 'db-kiosk', 1, 0, 'CROP',
  0.10, 0.20, 0.30, 0.40, 'IMPORTANT', now()
);
INSERT INTO "AssemblyTemplateProcedureStep" (
  id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
  "viewMode", emphasis, "updatedAt"
) VALUES (
  'restrict-step', 'db-template', 'db-doc-secondary', 2, 0, 'FULL_PAGE', 'CAUTION', now()
);

CREATE FUNCTION pg_temp.expect_check(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN check_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'statement unexpectedly passed CHECK: %', statement;
END
$$;
CREATE FUNCTION pg_temp.expect_unique(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'statement unexpectedly passed UNIQUE: %', statement;
END
$$;
CREATE FUNCTION pg_temp.expect_fk(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'statement unexpectedly passed FK: %', statement;
END
$$;

SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "kioskDocumentId", "assemblyProcedureDocumentId",
    "sortOrder", "pageIndex", "viewMode", emphasis, "updatedAt"
  ) VALUES ('bad-xor-both', 'db-template', 'db-kiosk', 'db-doc-primary',
    10, 0, 'FULL_PAGE', 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "sortOrder", "pageIndex", "viewMode", emphasis, "updatedAt"
  ) VALUES ('bad-xor-neither', 'db-template', 11, 0, 'FULL_PAGE', 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", emphasis, "updatedAt"
  ) VALUES ('bad-page', 'db-template', 'db-doc-primary', 12, -1, 'FULL_PAGE', 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", "cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio",
    emphasis, "updatedAt"
  ) VALUES ('bad-full-crop', 'db-template', 'db-doc-primary', 13, 0, 'FULL_PAGE',
    0, 0, 0.5, 0.5, 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", "cropXRatio", "cropYRatio", "cropWidthRatio",
    emphasis, "updatedAt"
  ) VALUES ('bad-crop-null', 'db-template', 'db-doc-primary', 14, 0, 'CROP',
    0, 0, 0.5, 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", "cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio",
    emphasis, "updatedAt"
  ) VALUES ('bad-crop-small', 'db-template', 'db-doc-primary', 15, 0, 'CROP',
    0, 0, 0.019, 0.5, 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_check($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", "cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio",
    emphasis, "updatedAt"
  ) VALUES ('bad-crop-bounds', 'db-template', 'db-doc-primary', 16, 0, 'CROP',
    0.8, 0, 0.3, 0.5, 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_unique($sql$
  INSERT INTO "AssemblyTemplateProcedureStep" (
    id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
    "viewMode", emphasis, "updatedAt"
  ) VALUES ('bad-duplicate-order', 'db-template', 'db-doc-primary', 0, 0,
    'FULL_PAGE', 'NORMAL', now())
$sql$);
SELECT pg_temp.expect_fk($sql$
  DELETE FROM "AssemblyProcedureDocument" WHERE id = 'db-doc-secondary'
$sql$);

INSERT INTO "AssemblyTemplate" (
  id, "modelCode", "procedurePattern", name, version, "isActive",
  "procedureDocumentId", "createdAt", "updatedAt"
) VALUES (
  'cascade-template', 'DB-CASCADE', 'P1', 'Cascade Template', 1, true,
  'db-doc-primary', now(), now()
);
INSERT INTO "AssemblyTemplateProcedureStep" (
  id, "templateId", "assemblyProcedureDocumentId", "sortOrder", "pageIndex",
  "viewMode", emphasis, "updatedAt"
) VALUES (
  'cascade-step', 'cascade-template', 'db-doc-primary', 0, 0, 'FULL_PAGE', 'NORMAL', now()
);
DELETE FROM "AssemblyTemplate" WHERE id = 'cascade-template';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AssemblyTemplateProcedureStep" WHERE id = 'cascade-step') THEN
    RAISE EXCEPTION 'template delete did not cascade to procedure step';
  END IF;
END
$$;
SQL

echo "loading 20,100 step rows and checking query plans"
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d assembly_fresh <<'SQL'
INSERT INTO "AssemblyProcedureDocument" (
  id, name, "imageRelativePath", status, "publishedAt", "isActive", "createdAt", "updatedAt"
)
SELECT
  'perf-doc-' || lpad(n::text, 3, '0'),
  'Performance Document ' || n,
  '/perf-' || n || '.png',
  'PUBLISHED', now(), true, now(), now()
FROM generate_series(0, 99) AS n;
INSERT INTO "KioskDocument" (
  id, title, filename, "filePath", "sourceType", "pageCount", "createdAt", "updatedAt"
)
SELECT
  'perf-kiosk-' || lpad(n::text, 3, '0'),
  'Performance Kiosk ' || n,
  'perf-' || n || '.pdf',
  '/perf-' || n || '.pdf',
  'MANUAL', 201, now(), now()
FROM generate_series(0, 99) AS n;
INSERT INTO "AssemblyTemplate" (
  id, "modelCode", "procedurePattern", name, version, "isActive",
  "procedureDocumentId", "createdAt", "updatedAt"
)
SELECT
  'perf-template-' || lpad(n::text, 3, '0'),
  'PERF-' || n, 'P1', 'Performance Template ' || n, 1, true,
  'perf-doc-' || lpad(n::text, 3, '0'), now(), now()
FROM generate_series(0, 99) AS n;
INSERT INTO "AssemblyTemplateProcedureStep" (
  id, "templateId", "kioskDocumentId", "assemblyProcedureDocumentId",
  "sortOrder", "pageIndex", "viewMode", emphasis, "updatedAt"
)
SELECT
  'perf-step-' || template_no || '-' || step_no,
  'perf-template-' || lpad(template_no::text, 3, '0'),
  CASE WHEN step_no % 2 = 1 THEN 'perf-kiosk-' || lpad(template_no::text, 3, '0') END,
  CASE WHEN step_no % 2 = 0 THEN 'perf-doc-' || lpad(template_no::text, 3, '0') END,
  step_no, step_no, 'FULL_PAGE', 'NORMAL', now()
FROM generate_series(0, 99) AS template_no
CROSS JOIN generate_series(0, 200) AS step_no;
ANALYZE "AssemblyTemplateProcedureStep";
SQL

docker exec "$container_name" psql -XAt -U postgres -d assembly_fresh -c '
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id, "sortOrder", "pageIndex"
  FROM "AssemblyTemplateProcedureStep"
  WHERE "templateId" = '"'"'perf-template-042'"'"'
  ORDER BY "sortOrder";
' | tee "$scratch_dir/explain-template.txt"
grep -q 'AssemblyTemplateProcedureStep_unique_template_sort' "$scratch_dir/explain-template.txt"

docker exec "$container_name" psql -XAt -U postgres -d assembly_fresh -c '
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id FROM "AssemblyTemplateProcedureStep"
  WHERE "assemblyProcedureDocumentId" = '"'"'perf-doc-042'"'"';
' | tee "$scratch_dir/explain-assembly-document.txt"
grep -q 'AssemblyTemplateProcedureStep_idx_assembly_document' "$scratch_dir/explain-assembly-document.txt"

docker exec "$container_name" psql -XAt -U postgres -d assembly_fresh -c '
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id FROM "AssemblyTemplateProcedureStep"
  WHERE "kioskDocumentId" = '"'"'perf-kiosk-042'"'"';
' | tee "$scratch_dir/explain-kiosk-document.txt"
grep -q 'AssemblyTemplateProcedureStep_idx_kiosk_document' "$scratch_dir/explain-kiosk-document.txt"

step_fixture_count="$(docker exec "$container_name" psql -XAt -U postgres -d assembly_fresh \
  -c "SELECT count(*) FROM \"AssemblyTemplateProcedureStep\" WHERE id LIKE 'perf-step-%';")"
[[ "$step_fixture_count" == "20100" ]]

echo "running assembly API integration tests against the same isolated database"
(
  cd "$repo_root/apps/api"
  DATABASE_URL="$fresh_url" \
  LOG_LEVEL=error \
  FILE_STORAGE_ROOT="$scratch_dir/file-storage" \
  PHOTO_STORAGE_DIR="$scratch_dir/file-storage" \
  PDF_STORAGE_DIR="$scratch_dir/file-storage" \
  CSV_DASHBOARD_STORAGE_DIR="$scratch_dir/file-storage" \
  SIGNAGE_RENDER_DIR="$scratch_dir/file-storage/signage-rendered" \
  "$node24" node_modules/vitest/vitest.mjs run \
    --config vitest.config.ts \
    --reporter=dot \
    src/routes/__tests__/assembly.integration.test.ts
)

if [[ "${RUN_ALL_API_TESTS:-0}" == "1" ]]; then
  echo "running the full API test suite against a separate fresh database in the isolated container"
  docker exec "$container_name" createdb -U postgres assembly_all_tests
  all_tests_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_all_tests"
  DATABASE_URL="$all_tests_url" "$node24" "$prisma_cli" migrate deploy \
    --schema "$repo_root/apps/api/prisma/schema.prisma"
  (
    cd "$repo_root/apps/api"
    DATABASE_URL="$all_tests_url" \
    LOG_LEVEL=error \
    FILE_STORAGE_ROOT="$scratch_dir/all-file-storage" \
    PHOTO_STORAGE_DIR="$scratch_dir/all-file-storage" \
    PDF_STORAGE_DIR="$scratch_dir/all-file-storage" \
    CSV_DASHBOARD_STORAGE_DIR="$scratch_dir/all-file-storage" \
    SIGNAGE_RENDER_DIR="$scratch_dir/all-file-storage/signage-rendered" \
    "$node24" node_modules/vitest/vitest.mjs run \
      --config vitest.config.ts \
      --reporter=dot
  )
fi

echo "assembly procedure step database validation passed"
