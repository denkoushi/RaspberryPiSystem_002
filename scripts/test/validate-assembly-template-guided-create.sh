#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node24="${CODEX_NODE24_PATH:-/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
prisma_cli="$repo_root/apps/api/node_modules/prisma/build/index.js"
task_token="assembly-guided-$(date +%s)-$$"
task_label="codex.assembly-guided-validation=$task_token"
container_name="raspi-assembly-guided-pg-$task_token"
volume_name="raspi-assembly-guided-volume-$task_token"
network_name="raspi-assembly-guided-network-$task_token"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/raspi-assembly-guided.XXXXXX")"
vite_pid=""

cleanup() {
  local cleanup_status=0
  set +e
  if [[ -n "$vite_pid" ]]; then
    kill "$vite_pid" >/dev/null 2>&1
    wait "$vite_pid" >/dev/null 2>&1
  fi
  docker rm -f "$container_name" >/dev/null 2>&1
  docker volume rm "$volume_name" >/dev/null 2>&1
  docker network rm "$network_name" >/dev/null 2>&1
  if [[ -n "$scratch_dir" && "$scratch_dir" == */raspi-assembly-guided.* ]]; then
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

migration_count="$(
  find "$repo_root/apps/api/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
)"
echo "migration directories discovered dynamically: $migration_count"

docker network create --label "$task_label" "$network_name" >/dev/null
docker volume create --label "$task_label" "$volume_name" >/dev/null
docker run -d \
  --name "$container_name" \
  --label "$task_label" \
  --network "$network_name" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=assembly_guided \
  -p 127.0.0.1::5432 \
  -v "$volume_name:/var/lib/postgresql/data" \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d assembly_guided >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d assembly_guided >/dev/null
host_port="$(docker port "$container_name" 5432/tcp | awk -F: 'END { print $NF }')"
focused_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_guided"
all_url="postgresql://postgres:postgres@127.0.0.1:${host_port}/assembly_guided_all"
schema="$repo_root/apps/api/prisma/schema.prisma"

echo "validating and deploying migrations on isolated PostgreSQL port $host_port"
DATABASE_URL="$focused_url" "$node24" "$prisma_cli" validate --schema "$schema"
DATABASE_URL="$focused_url" "$node24" "$prisma_cli" generate --schema "$schema"
DATABASE_URL="$focused_url" "$node24" "$prisma_cli" migrate deploy --schema "$schema"
DATABASE_URL="$focused_url" "$node24" "$prisma_cli" migrate status --schema "$schema"
applied_count="$(
  docker exec "$container_name" psql -XAt -U postgres -d assembly_guided \
    -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'
)"
if [[ "$applied_count" != "$migration_count" ]]; then
  echo "migration count mismatch: directories=$migration_count applied=$applied_count" >&2
  exit 1
fi

echo "running focused REQUIRED assembly-template API contract test"
(
  cd "$repo_root/apps/api"
  DATABASE_URL="$focused_url" \
  LOG_LEVEL=error \
  FILE_STORAGE_ROOT="$scratch_dir/focused-file-storage" \
  PHOTO_STORAGE_DIR="$scratch_dir/focused-file-storage" \
  PDF_STORAGE_DIR="$scratch_dir/focused-file-storage" \
  CSV_DASHBOARD_STORAGE_DIR="$scratch_dir/focused-file-storage" \
  SIGNAGE_RENDER_DIR="$scratch_dir/focused-file-storage/signage-rendered" \
  "$node24" node_modules/vitest/vitest.mjs run \
    --config vitest.config.ts \
    --reporter=dot \
    src/routes/__tests__/assembly.integration.test.ts \
    -t 'REQUIREDテンプレート'
)

docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d assembly_guided <<'SQL'
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "AssemblyTemplate" t
    JOIN "AssemblyProcedureDocument" d ON d.id = t."procedureDocumentId"
    JOIN "AssemblyTemplateArea" a ON a."templateId" = t.id
    JOIN "AssemblyTemplateBolt" b ON b."areaId" = a.id
    JOIN "TorqueWrenchCapabilityGroup" g ON g.id = b."capabilityGroupId"
    WHERE t."modelCode" = 'GUIDED-VALID'
      AND t."traceabilityMode" = 'REQUIRED'
      AND d.status = 'PUBLISHED'
      AND b."nominalDiameter" = g."nominalDiameter"
      AND b."boltLengthMm" = g."boltLengthMm"
      AND b.material = g.material
      AND b."strengthClass" = g."strengthClass"
  ) <> 1 THEN
    RAISE EXCEPTION 'guided valid template relation verification failed';
  END IF;
  IF (
    SELECT count(*) FROM "AssemblyTemplate"
    WHERE "modelCode" LIKE 'GUIDED-%' AND "modelCode" <> 'GUIDED-VALID'
  ) <> 0 THEN
    RAISE EXCEPTION 'invalid guided template left persisted rows';
  END IF;
END $$;

INSERT INTO "TorqueWrenchCapabilityGroup" (
  id, name, "nominalDiameter", "boltLengthMm", material, "strengthClass",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  'guided-perf-group-' || gs,
  'Guided performance group ' || gs,
  'M' || (gs % 100),
  (gs % 50) + 1,
  'MAT' || (gs % 20),
  'CLASS' || (gs % 10),
  gs % 7 <> 0,
  now(),
  now()
FROM generate_series(1, 20100) AS gs;
ANALYZE "TorqueWrenchCapabilityGroup";
SQL

docker exec "$container_name" psql -XAt -U postgres -d assembly_guided -c '
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id, name
  FROM "TorqueWrenchCapabilityGroup"
  WHERE "nominalDiameter" = '"'"'M42'"'"'
    AND "boltLengthMm" = 43
    AND material = '"'"'MAT2'"'"'
    AND "strengthClass" = '"'"'CLASS2'"'"'
    AND "isActive" = true;
' | tee "$scratch_dir/explain-capability.txt"
grep -q 'TorqueWrenchCapabilityGroup_idx_fastener_active' "$scratch_dir/explain-capability.txt"
fixture_count="$(
  docker exec "$container_name" psql -XAt -U postgres -d assembly_guided \
    -c "SELECT count(*) FROM \"TorqueWrenchCapabilityGroup\" WHERE id LIKE 'guided-perf-group-%';"
)"
[[ "$fixture_count" == "20100" ]]

echo "creating a separate fresh database for all tests"
docker exec "$container_name" createdb -U postgres assembly_guided_all
DATABASE_URL="$all_url" "$node24" "$prisma_cli" migrate deploy --schema "$schema"

(
  cd "$repo_root/apps/api"
  DATABASE_URL="$all_url" \
  LOG_LEVEL=error \
  FILE_STORAGE_ROOT="$scratch_dir/all-file-storage" \
  PHOTO_STORAGE_DIR="$scratch_dir/all-file-storage" \
  PDF_STORAGE_DIR="$scratch_dir/all-file-storage" \
  CSV_DASHBOARD_STORAGE_DIR="$scratch_dir/all-file-storage" \
  SIGNAGE_RENDER_DIR="$scratch_dir/all-file-storage/signage-rendered" \
  "$node24" node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=dot
)
(
  cd "$repo_root/apps/web"
  "$node24" node_modules/vitest/vitest.mjs run --reporter=dot
  "$node24" node_modules/eslint/bin/eslint.js src --ext .ts,.tsx
)
(
  cd "$repo_root/apps/api"
  "$node24" node_modules/eslint/bin/eslint.js . --ext .ts
)
(
  cd "$repo_root/packages/shared-types"
  "$node24" node_modules/typescript/bin/tsc
)
(
  cd "$repo_root/apps/api"
  "$node24" node_modules/typescript/bin/tsc -p tsconfig.build.json
  mkdir -p dist/services/visualization/renderers/pallet-board
  cp -R src/services/visualization/renderers/pallet-board/assets \
    dist/services/visualization/renderers/pallet-board/
)
(
  cd "$repo_root/apps/web"
  "$node24" node_modules/typescript/bin/tsc -b
  "$node24" node_modules/vite/bin/vite.js build
)

vite_port="$(
  "$node24" -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
)"
(
  cd "$repo_root/apps/web"
  "$node24" node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$vite_port"
) >"$scratch_dir/vite.log" 2>&1 &
vite_pid=$!
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${vite_port}" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${vite_port}" >/dev/null
(
  cd "$repo_root"
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${vite_port}" \
  "$node24" node_modules/@playwright/test/cli.js test \
    e2e/assembly-library-editor-ui.spec.ts \
    --project=chromium \
    --workers=1 \
    --reporter=line
)

git -C "$repo_root" diff --check
echo "guided-create validation passed; migrations=$migration_count fixtures=$fixture_count index=TorqueWrenchCapabilityGroup_idx_fastener_active"
