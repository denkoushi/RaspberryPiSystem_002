#!/usr/bin/env bash
# Shared, source-only wrapper for the authoritative Pi5 migration ledger gate.

migration_gate_validate_ledger() {
  if (($# != 4)); then
    echo 'migration gate requires project, base ref, candidate ref, and ledger file' >&2
    return 2
  fi
  local project_dir="$1" base_ref="$2" candidate_ref="$3" ledger_file="$4"
  [[ -f "$ledger_file" && ! -L "$ledger_file" ]] || {
    echo 'applied migration ledger snapshot is not a regular file' >&2
    return 1
  }
  python3 "$project_dir/scripts/deploy/validate-expand-only-migrations.py" \
    --applied-checksums "$ledger_file" \
    --repository "$project_dir" \
    --base-ref "$base_ref" \
    --candidate-ref "$candidate_ref" \
    --migration-root apps/api/prisma/migrations
}

migration_gate_verify_applied_ledger() {
  if (($# != 4)); then
    echo 'applied migration verification requires project, base ref, candidate ref, and ledger file' >&2
    return 2
  fi
  local project_dir="$1" base_ref="$2" candidate_ref="$3" ledger_file="$4"
  [[ -f "$ledger_file" && ! -L "$ledger_file" ]] || {
    echo 'applied migration ledger snapshot is not a regular file' >&2
    return 1
  }
  python3 "$project_dir/scripts/deploy/validate-expand-only-migrations.py" \
    --applied-checksums "$ledger_file" \
    --repository "$project_dir" \
    --base-ref "$base_ref" \
    --candidate-ref "$candidate_ref" \
    --migration-root apps/api/prisma/migrations \
    --require-all-candidate-applied
}

migration_gate_validate() (
  if (($# < 4)); then
    echo 'migration gate requires project, base ref, candidate ref, and ledger provider' >&2
    return 2
  fi
  local project_dir="$1" base_ref="$2" candidate_ref="$3" ledger_provider="$4"
  shift 4
  local ledger_file result=0
  ledger_file="$(mktemp "${TMPDIR:-/tmp}/pi5-migration-ledger.XXXXXX")" || {
    echo 'could not create the migration ledger snapshot' >&2
    return 1
  }
  trap 'rm -f "$ledger_file"' EXIT

  if ! "$ledger_provider" "$@" >"$ledger_file"; then
    echo 'could not read applied Prisma migration checksums' >&2
    return 1
  fi

  migration_gate_validate_ledger \
    "$project_dir" "$base_ref" "$candidate_ref" "$ledger_file" || result=$?
  return "$result"
)
