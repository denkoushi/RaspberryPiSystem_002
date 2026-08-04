#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVER_COMPOSE="$ROOT/infrastructure/docker/docker-compose.server.yml"
PHASE3_COMPOSE="$ROOT/infrastructure/docker/docker-compose.phase3.yml"
SERVER_MIGRATION="$ROOT/infrastructure/docker/docker-compose.server.migration.yml"
PHASE3_MIGRATION="$ROOT/infrastructure/docker/docker-compose.phase3.migration.yml"
DOCKER_ENV_TEMPLATE="$ROOT/infrastructure/ansible/templates/docker.env.j2"
API_ENV_TEMPLATE="$ROOT/infrastructure/ansible/templates/api.env.j2"
INVENTORY="$ROOT/infrastructure/ansible/inventory.yml"
SERVER_TASKS="$ROOT/infrastructure/ansible/roles/server/tasks/main.yml"
MIGRATIONS="$ROOT/scripts/deploy/lib/pi5-blue-green/migrations.sh"
ROLE_PLAYBOOK="$ROOT/infrastructure/ansible/playbooks/prepare-pi5-database-roles.yml"

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

for path in "$SERVER_MIGRATION" "$PHASE3_MIGRATION"; do
  [[ -f "$path" ]] || fail "missing migration-only Compose override: ${path#$ROOT/}"
done

for path in "$SERVER_COMPOSE" "$PHASE3_COMPOSE"; do
  grep -Fq 'DATABASE_URL: ${APP_DATABASE_URL:?APP_DATABASE_URL is required}' "$path" \
    || fail "runtime API is not restricted to APP_DATABASE_URL in ${path#$ROOT/}"
  ! grep -Eq 'DATABASE_URL:.*postgres|POSTGRES_PASSWORD:-postgres' "$path" \
    || fail "production Compose retains a postgres/default runtime credential in ${path#$ROOT/}"
done

grep -Fq 'POSTGRES_PASSWORD_FILE: /run/secrets/postgres-superuser-password' "$SERVER_COMPOSE" \
  || fail 'database bootstrap does not use a file-scoped superuser secret'
grep -Fq 'source: ${POSTGRES_SUPERUSER_PASSWORD_FILE:?POSTGRES_SUPERUSER_PASSWORD_FILE is required}' "$SERVER_COMPOSE" \
  || fail 'database bootstrap password file is not mandatory'
grep -Fq '${MIGRATION_DATABASE_ENV_FILE:?MIGRATION_DATABASE_ENV_FILE is required}' "$SERVER_MIGRATION" \
  || fail 'legacy migration override does not use the host-only migration environment'
[[ "$(grep -Fc '${MIGRATION_DATABASE_ENV_FILE:?MIGRATION_DATABASE_ENV_FILE is required}' "$PHASE3_MIGRATION")" -eq 2 ]] \
  || fail 'both Blue/Green migration overrides must use the host-only migration environment'

grep -Fq 'APP_DATABASE_URL={{ app_database_url }}' "$DOCKER_ENV_TEMPLATE" \
  || fail 'Docker environment template omits the application URL'
grep -Fq 'POSTGRES_SUPERUSER_PASSWORD_FILE=/etc/raspi-database/postgres-superuser-password' "$DOCKER_ENV_TEMPLATE" \
  || fail 'Docker environment template omits the root-managed superuser path'
grep -Fq 'MIGRATION_DATABASE_ENV_FILE=/etc/raspi-database/migration.env' "$DOCKER_ENV_TEMPLATE" \
  || fail 'Docker environment template omits the host-only migration path'
! grep -Eq '^(POSTGRES_SUPERUSER_PASSWORD|MIGRATION_DATABASE_URL)=' "$DOCKER_ENV_TEMPLATE" \
  || fail 'privileged database credentials must not enter the ordinary Compose environment'
grep -Fq 'DATABASE_URL={{ app_database_url }}' "$API_ENV_TEMPLATE" \
  || fail 'API environment template does not use the application URL'
! grep -Eq "DATABASE_URL=.*default\('postgresql://postgres" "$API_ENV_TEMPLATE" \
  || fail 'API environment template retains the production database fallback'

grep -Fq 'postgres_superuser_password: "{{ vault_postgres_superuser_password }}"' "$INVENTORY" \
  || fail 'normal-factory inventory does not require the Vault superuser password'
grep -Fq 'app_database_url: "{{ vault_app_database_url }}"' "$INVENTORY" \
  || fail 'normal-factory inventory does not require the Vault application URL'
grep -Fq 'migration_database_url: "{{ vault_migration_database_url }}"' "$INVENTORY" \
  || fail 'normal-factory inventory does not require the Vault migration URL'

grep -Fq 'docker-compose.server.migration.yml' "$SERVER_TASKS" \
  || fail 'legacy Ansible migration path does not apply the migration-only override'
grep -Fq 'compose_migration run --rm --no-deps' "$MIGRATIONS" \
  || fail 'Blue/Green migration path does not use the migration-only Compose boundary'
grep -Fq 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy' "$MIGRATIONS" \
  || fail 'ephemeral Blue/Green migration does not explicitly select migration authority'

grep -Fq 'pi5_database_role_migration_approved | bool' "$ROLE_PLAYBOOK" \
  || fail 'production role activation lacks a separate explicit approval gate'
grep -Fq 'pi5_database_role_migration_backup_path' "$ROLE_PLAYBOOK" \
  || fail 'production role activation lacks exact recent-backup evidence'
grep -Fq 'postgres-role-bootstrap.sql' "$ROLE_PLAYBOOK" \
  || fail 'production role activation does not use the isolated-tested bootstrap'
! grep -Eq 'ALTER ROLE postgres.*PASSWORD' "$ROLE_PLAYBOOK" \
  || fail 'role preparation must retain the legacy rollback credential until release success'

echo 'PASS: production database credentials and runtime/migration roles are wired separately'
