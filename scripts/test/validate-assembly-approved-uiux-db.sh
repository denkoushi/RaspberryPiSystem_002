#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node24="${CODEX_NODE24_PATH:-/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
prisma_cli="$repo_root/apps/api/node_modules/prisma/build/index.js"
task_token="assembly-uiux-$(date +%s)-$$"
task_label="codex.assembly-uiux-validation=$task_token"
container_name="raspi-assembly-uiux-pg-$task_token"
volume_name="raspi-assembly-uiux-volume-$task_token"
network_name="raspi-assembly-uiux-network-$task_token"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/raspi-assembly-uiux.XXXXXX")"

cleanup() {
  local cleanup_status=0
  set +e
  docker stop --time 10 "$container_name" >/dev/null 2>&1
  docker rm "$container_name" >/dev/null 2>&1
  docker volume rm "$volume_name" >/dev/null 2>&1
  docker network rm "$network_name" >/dev/null 2>&1
  if [[ -n "$scratch_dir" && "$scratch_dir" == */raspi-assembly-uiux.* ]]; then
    find "$scratch_dir" -depth -delete
  fi
  if [[ -n "$(docker ps -aq --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  if [[ -n "$(docker volume ls -q --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  if [[ -n "$(docker network ls -q --filter "label=$task_label")" ]]; then cleanup_status=1; fi
  set -e
  if [[ "$cleanup_status" -ne 0 ]]; then
    echo "isolated Docker resource cleanup verification failed" >&2
    return 1
  fi
  echo "isolated Docker resources removed; label residue=0; token=$task_token"
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
  -e POSTGRES_DB=assembly_uiux \
  -p 127.0.0.1::5432 \
  -v "$volume_name:/var/lib/postgresql/data" \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d assembly_uiux >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d assembly_uiux >/dev/null
host_port="$(docker port "$container_name" 5432/tcp | awk -F: 'END { print $NF }')"
database_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_uiux"

echo "isolated PostgreSQL token=$task_token port=$host_port"
DATABASE_URL="$database_url" "$node24" "$prisma_cli" validate \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$database_url" "$node24" "$prisma_cli" generate \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$database_url" "$node24" "$prisma_cli" migrate deploy \
  --schema "$repo_root/apps/api/prisma/schema.prisma"
DATABASE_URL="$database_url" "$node24" "$prisma_cli" migrate status \
  --schema "$repo_root/apps/api/prisma/schema.prisma"

(
  cd "$repo_root/apps/api"
  DATABASE_URL="$database_url" \
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
  docker exec "$container_name" createdb -U postgres assembly_uiux_all
  full_database_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_uiux_all"
  DATABASE_URL="$full_database_url" "$node24" "$prisma_cli" migrate deploy \
    --schema "$repo_root/apps/api/prisma/schema.prisma"
  (
    cd "$repo_root/apps/api"
    DATABASE_URL="$full_database_url" \
    LOG_LEVEL=error \
    FILE_STORAGE_ROOT="$scratch_dir/full-file-storage" \
    PHOTO_STORAGE_DIR="$scratch_dir/full-file-storage" \
    PDF_STORAGE_DIR="$scratch_dir/full-file-storage" \
    CSV_DASHBOARD_STORAGE_DIR="$scratch_dir/full-file-storage" \
    SIGNAGE_RENDER_DIR="$scratch_dir/full-file-storage/signage-rendered" \
    "$node24" node_modules/vitest/vitest.mjs run \
      --config vitest.config.ts \
      --reporter=dot
  )
fi

docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d assembly_uiux <<'SQL'
INSERT INTO "CsvDashboard" (
  id, name, "columnDefinitions", "templateConfig", "createdAt", "updatedAt"
) VALUES (
  '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01',
  'Assembly UIUX candidate plan fixture',
  '[]'::jsonb,
  '{}'::jsonb,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "CsvDashboardRow" (
  id, "csvDashboardId", "occurredAt", "rowData", "createdAt", "updatedAt"
)
SELECT
  'catalog-row-' || gs,
  '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01',
  now(),
  jsonb_build_object(
    'FSEIBAN', 'CAT-' || gs,
    'FHINCD', CASE WHEN gs % 2 = 0 THEN 'MH001' ELSE 'SH001' END,
    'FHINMEI', 'MODEL-' || gs,
    'FSIGENCD', 'R' || (gs % 20),
    'FKOJUN', (gs % 30)::text,
    'ProductNo', '1'
  ),
  now(),
  now()
FROM generate_series(1, 20000) AS gs
ON CONFLICT (id) DO NOTHING;

INSERT INTO "ProductionScheduleSeibanMachineNameSupplement" (
  id, "sourceCsvDashboardId", fseiban, "machineName", "createdAt", "updatedAt"
)
SELECT
  'catalog-supp-target-' || gs,
  'e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b',
  'SUP-' || gs,
  'SUPPLEMENT-MODEL-' || gs,
  now(),
  now()
FROM generate_series(1, 1000) AS gs
ON CONFLICT ("sourceCsvDashboardId", fseiban) DO NOTHING;

INSERT INTO "ProductionScheduleSeibanMachineNameSupplement" (
  id, "sourceCsvDashboardId", fseiban, "machineName", "createdAt", "updatedAt"
)
SELECT
  'catalog-supp-other-' || gs,
  '00000000-0000-4000-8000-000000000001',
  'OTHER-' || gs,
  'OTHER-MODEL-' || gs,
  now(),
  now()
FROM generate_series(1, 20000) AS gs
ON CONFLICT ("sourceCsvDashboardId", fseiban) DO NOTHING;

ANALYZE "CsvDashboardRow";
ANALYZE "ProductionScheduleSeibanMachineNameSupplement";
SQL

docker exec -i "$container_name" psql -XAt -U postgres -d assembly_uiux <<'SQL' \
  | tee "$scratch_dir/explain-schedule.txt"
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  (r."rowData"->>'FSEIBAN') AS fseiban,
  (r."rowData"->>'FHINMEI') AS fhinmei
FROM "CsvDashboardRow" r
WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND r.id = (
    SELECT r2.id
    FROM "CsvDashboardRow" r2
    WHERE r2."csvDashboardId" = r."csvDashboardId"
      AND COALESCE(r2."rowData"->>'FSEIBAN', '') = COALESCE(r."rowData"->>'FSEIBAN', '')
      AND COALESCE(r2."rowData"->>'FHINCD', '') = COALESCE(r."rowData"->>'FHINCD', '')
      AND COALESCE(r2."rowData"->>'FSIGENCD', '') = COALESCE(r."rowData"->>'FSIGENCD', '')
      AND COALESCE(r2."rowData"->>'FKOJUN', '') = COALESCE(r."rowData"->>'FKOJUN', '')
    ORDER BY
      CASE
        WHEN (r2."rowData"->>'ProductNo') ~ '^[0-9]+$'
          THEN ((r2."rowData"->>'ProductNo'))::bigint
        ELSE -1
      END DESC,
      r2."createdAt" DESC,
      r2.id DESC
    LIMIT 1
  )
  AND (
    UPPER(COALESCE(r."rowData"->>'FHINCD', '')) LIKE 'MH%'
    OR UPPER(COALESCE(r."rowData"->>'FHINCD', '')) LIKE 'SH%'
  )
  AND BTRIM(COALESCE(r."rowData"->>'FSEIBAN', '')) <> ''
  AND BTRIM(COALESCE(r."rowData"->>'FHINMEI', '')) <> ''
GROUP BY r."rowData"->>'FSEIBAN', r."rowData"->>'FHINMEI';
SQL
grep -Eq 'csv_dashboard_row_(prod_schedule_winner_lookup|winner_lookup_global)' \
  "$scratch_dir/explain-schedule.txt"

docker exec -i "$container_name" psql -XAt -U postgres -d assembly_uiux <<'SQL' \
  | tee "$scratch_dir/explain-supplement.txt"
EXPLAIN (ANALYZE, BUFFERS)
SELECT fseiban, "machineName"
FROM "ProductionScheduleSeibanMachineNameSupplement"
WHERE "sourceCsvDashboardId" = 'e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b';
SQL
grep -q 'PSSeibanMachNmSup_unique_src_fsb' "$scratch_dir/explain-supplement.txt"

candidate_count="$(
  docker exec "$container_name" psql -XAt -U postgres -d assembly_uiux \
    -c "SELECT count(*) FROM \"CsvDashboardRow\" WHERE id LIKE 'catalog-row-%';"
)"
if [[ "$candidate_count" != "20000" ]]; then
  echo "unexpected candidate source fixture count: $candidate_count" >&2
  exit 1
fi

echo "isolated candidate API and EXPLAIN validation passed; source rows=$candidate_count"
