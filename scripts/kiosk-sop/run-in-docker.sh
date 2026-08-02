#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
mode="${1:-check}"
shift || true
image_tag="raspisys-kiosk-sop-generator:playwright-1.56.1"
dockerfile="$repo_root/infrastructure/docker/Dockerfile.kiosk-sop-generator"
generated_root="$repo_root/apps/web/src/generated/kiosk-sop/inspection-drawing"
preview_path="$repo_root/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html"

docker build --file "$dockerfile" --tag "$image_tag" "$repo_root"

if [[ "$mode" == "generate" ]]; then
  output_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-sop-output.XXXXXX")"
  cleanup() {
    rm -rf "$output_dir"
  }
  trap cleanup EXIT INT TERM
  docker run --rm --init --ipc=host --network=none \
    --volume "$output_dir:/output" \
    "$image_tag" \
    node scripts/kiosk-sop/generate.mjs generate --output-root /output "$@"
  mkdir -p "$generated_root"
  rsync -a --delete "$output_dir/" "$generated_root/"
  cp "$generated_root/manual.html" "$preview_path"
elif [[ "$mode" == "check" ]]; then
  docker run --rm --init --ipc=host --network=none \
    --volume "$preview_path:/workspace/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html:ro" \
    "$image_tag" \
    bash -lc 'node scripts/kiosk-sop/generate.mjs check "$@" && pnpm exec playwright test --config=playwright.kiosk-sop.config.ts' bash "$@"
else
  echo "Unknown kiosk SOP mode: $mode" >&2
  exit 2
fi
