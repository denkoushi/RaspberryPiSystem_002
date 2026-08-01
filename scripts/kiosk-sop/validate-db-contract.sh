#!/usr/bin/env bash
set -euo pipefail

validation_id="kiosk-sop-$PPID-$(date +%s)"
container_name="${validation_id}-postgres"
volume_name="${validation_id}-data"
network_name="${validation_id}-network"
storage_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-sop-api-storage.XXXXXX")"

cleanup() {
  local cleanup_status=0

  docker container rm --force "$container_name" >/dev/null 2>&1 || cleanup_status=1
  docker volume rm "$volume_name" >/dev/null 2>&1 || cleanup_status=1
  docker network rm "$network_name" >/dev/null 2>&1 || cleanup_status=1
  rm -rf "$storage_dir"

  if docker container inspect "$container_name" >/dev/null 2>&1 \
    || docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || docker network inspect "$network_name" >/dev/null 2>&1; then
    echo "Disposable Docker resource cleanup failed for validation ID: $validation_id" >&2
    cleanup_status=1
  fi

  return "$cleanup_status"
}

on_exit() {
  local command_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  cleanup || cleanup_status=$?
  if (( cleanup_status != 0 )); then
    exit "$cleanup_status"
  fi
  exit "$command_status"
}

trap on_exit EXIT
trap 'exit 130' INT TERM

for resource in "$container_name" "$volume_name" "$network_name"; do
  if docker container inspect "$resource" >/dev/null 2>&1 \
    || docker volume inspect "$resource" >/dev/null 2>&1 \
    || docker network inspect "$resource" >/dev/null 2>&1; then
    echo "Refusing to reuse existing Docker resource: $resource" >&2
    exit 1
  fi
done

docker network create "$network_name" >/dev/null
docker volume create "$volume_name" >/dev/null
docker run --detach \
  --name "$container_name" \
  --network "$network_name" \
  --volume "$volume_name:/var/lib/postgresql/data" \
  --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=borrow_return \
  --health-cmd='pg_isready -U postgres -d borrow_return' \
  --health-interval=2s \
  --health-timeout=2s \
  --health-retries=30 \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d borrow_return >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d borrow_return >/dev/null

host_port="$(docker port "$container_name" 5432/tcp | awk -F: '{print $NF}')"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${host_port}/borrow_return"
export JWT_ACCESS_SECRET="test-access-secret-1234567890"
export JWT_REFRESH_SECRET="test-refresh-secret-1234567890"
export NODE_ENV="test"
export CAMERA_TYPE="mock"
export PHOTO_STORAGE_DIR="$storage_dir/photos"
export BACKUP_STORAGE_DIR="$storage_dir/backups"
export BACKUP_CONFIG_PATH="$storage_dir/backup.json"

pnpm --filter @raspi-system/api exec prisma generate
pnpm --filter @raspi-system/api exec prisma migrate deploy
pnpm --filter @raspi-system/api exec prisma migrate status

unfinished_migrations="$(docker exec "$container_name" psql -U postgres -d borrow_return -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;')"
test "$unfinished_migrations" = "0"

pnpm --filter @raspi-system/api test -- src/routes/__tests__/part-measurement.integration.test.ts -t "creates visual template with PNG"
pnpm --filter @raspi-system/api test -- src/routes/__tests__/part-measurement.integration.test.ts -t "creates, revises, detaches, and extends inspection drawing sibling groups"
pnpm --filter @raspi-system/api test -- src/routes/__tests__/part-measurement.integration.test.ts -t "treats includeInactive=false as false and only returns inactive visual when true"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d borrow_return <<'SQL'
INSERT INTO "PartMeasurementVisualTemplate"
  (id, name, "searchDigits", "drawingImageRelativePath", "isActive", "createdAt", "updatedAt")
SELECT
  'sop-explain-visual-' || value,
  '図面' || value,
  value::text,
  '/api/storage/part-measurement-drawings/sop-' || value || '.png',
  true,
  now(),
  now()
FROM generate_series(7000, 8999) AS value;

INSERT INTO "PartMeasurementTemplate"
  (id, "templateScope", fhincd, "processGroup", "resourceCd", name, version, "isActive", "visualTemplateId", "createdAt", "updatedAt")
SELECT
  'sop-explain-template-' || value,
  'THREE_KEY'::"PartMeasurementTemplateScope",
  'PART-' || value,
  'CUTTING'::"PartMeasurementProcessGroup",
  'R' || value,
  '検査図面テンプレート' || value,
  1,
  true,
  'sop-explain-visual-' || value,
  now(),
  now()
FROM generate_series(7000, 8999) AS value;

ANALYZE "PartMeasurementVisualTemplate";
ANALYZE "PartMeasurementTemplate";

EXPLAIN (ANALYZE, BUFFERS)
SELECT template.id
FROM "PartMeasurementTemplate" AS template
JOIN "PartMeasurementVisualTemplate" AS visual
  ON visual.id = template."visualTemplateId"
WHERE template."templateScope" = 'THREE_KEY'
  AND template."processGroup" IN ('CUTTING', 'GRINDING')
  AND template."isActive" = true
  AND visual."searchDigits" LIKE '%7161%'
ORDER BY template.fhincd, template."resourceCd", template.version DESC;

BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM "PartMeasurementVisualTemplate" WHERE "searchDigits" LIKE '%7161%';
ROLLBACK;
SQL

echo "Disposable PostgreSQL validation passed; cleanup verification follows on exit."
