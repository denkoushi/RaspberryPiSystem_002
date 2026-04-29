#!/usr/bin/env bash
# Boundary checks for private-personal ComfyUI stack (single responsibility: policy only).
# Source from start-private-comfyui.sh / stop-private-comfyui.sh — do not execute directly.

# Allowed root prefix on DGX host (ExecPlan: private-personal workload isolation).
readonly _DGX_PRIVATE_COMFYUI_ALLOWED_PREFIX="/srv/dgx/private-personal"

die_bc() {
  echo "dgx-private-comfyui boundary: $*" >&2
  exit 1
}

# COMFYUI_DATA_ROOT must stay under private-personal only (no system-prod / lab bind roots).
validate_comfyui_data_root() {
  local root="$1"
  [[ -n "${root}" ]] || die_bc "COMFYUI_DATA_ROOT is empty."

  if [[ "${root}" == *".."* ]]; then
    die_bc "COMFYUI_DATA_ROOT must not contain '..' (${root})."
  fi

  # Absolute path only.
  [[ "${root}" == /* ]] || die_bc "COMFYUI_DATA_ROOT must be absolute (${root})."

  case "${root}" in
    ${_DGX_PRIVATE_COMFYUI_ALLOWED_PREFIX} | ${_DGX_PRIVATE_COMFYUI_ALLOWED_PREFIX}/*) ;;
    *)
      die_bc "COMFYUI_DATA_ROOT must be under ${_DGX_PRIVATE_COMFYUI_ALLOWED_PREFIX} only (got: ${root})."
      ;;
  esac

  case "${root}" in
    */system-prod | */system-prod/* | */lab-experiments | */lab-experiments/*)
      die_bc "COMFYUI_DATA_ROOT must not point under system-prod or lab-experiments (${root})."
      ;;
  esac
}

# Fail if rendered compose config binds forbidden host paths (resolved via docker compose config).
validate_compose_config_resolved_paths() {
  local compose_file="$1"
  local env_file="$2"
  local tmp
  tmp="$(mktemp)"
  if ! docker compose -f "${compose_file}" --env-file "${env_file}" config >"${tmp}" 2>/dev/null; then
    rm -f "${tmp}"
    die_bc "docker compose config failed — check compose.yaml and .env."
  fi

  # Forbid obvious cross-workload roots in resolved binds.
  if grep -E '/srv/dgx/(system-prod|lab-experiments)(/|$)' "${tmp}" >/dev/null 2>&1; then
    rm -f "${tmp}"
    die_bc "Resolved compose binds forbidden paths (system-prod or lab-experiments). Use private-personal data root only."
  fi
  rm -f "${tmp}"
}
