#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
mode="${1:-check}"
shift || true
image_tag="raspisys-kiosk-sop-generator:playwright-1.56.1"
generator_platform="linux/amd64"
dockerfile="$repo_root/infrastructure/docker/Dockerfile.kiosk-sop-generator"
generated_root="$repo_root/apps/web/src/generated/kiosk-sop"
inspection_preview_path="$repo_root/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html"
assembly_preview_path="$repo_root/docs/design-previews/kiosk-assembly-procedure-template-sop.html"

# Run by image ID. Every checkout builds to the same tag, so a parallel build in
# another worktree can retarget it between this build and the run below.
image_id_file="$(mktemp "${TMPDIR:-/tmp}/kiosk-sop-image-id.XXXXXX")"
docker build --platform "$generator_platform" --file "$dockerfile" --tag "$image_tag" --iidfile "$image_id_file" "$repo_root"
image_id="$(cat "$image_id_file")"
rm -f "$image_id_file"

if [[ "$mode" == "generate" ]]; then
  output_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-sop-output.XXXXXX")"
  cleanup() {
    rm -rf "$output_dir"
  }
  trap cleanup EXIT INT TERM
  docker run --rm --init --ipc=host --network=none --platform "$generator_platform" \
    --volume "$output_dir:/output" \
    "$image_id" \
    node scripts/kiosk-sop/generate.mjs generate --all --output-root /output "$@"
  mkdir -p "$generated_root"
  rsync -a --delete "$output_dir/" "$generated_root/"
  cp "$generated_root/inspection-drawing/manual.html" "$inspection_preview_path"
  cp "$generated_root/assembly-procedure-template/manual.html" "$assembly_preview_path"
elif [[ "$mode" == "check" ]]; then
  docker run --rm --init --ipc=host --network=none --platform "$generator_platform" \
    --volume "$inspection_preview_path:/workspace/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html:ro" \
    --volume "$assembly_preview_path:/workspace/docs/design-previews/kiosk-assembly-procedure-template-sop.html:ro" \
    "$image_id" \
    bash -lc 'node --test scripts/kiosk-sop/capture-contract.test.mjs && node scripts/kiosk-sop/generate.mjs check --all "$@" && pnpm exec playwright test --config=playwright.kiosk-sop.config.ts' bash "$@"
else
  echo "Unknown kiosk SOP mode: $mode" >&2
  exit 2
fi
