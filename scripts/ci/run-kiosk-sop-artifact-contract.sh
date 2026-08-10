#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
image_tag="raspisys-kiosk-sop-generator:playwright-1.56.1"
generator_platform="linux/amd64"
dockerfile="$repo_root/infrastructure/docker/Dockerfile.kiosk-sop-generator"
inspection_preview_path="$repo_root/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html"
assembly_preview_path="$repo_root/docs/design-previews/kiosk-assembly-procedure-template-sop.html"
temporary_diagnostics="false"

if [[ -n "${KIOSK_SOP_DIAGNOSTICS_DIR:-}" ]]; then
  diagnostics_dir="$KIOSK_SOP_DIAGNOSTICS_DIR"
  mkdir -p "$diagnostics_dir"
else
  diagnostics_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-sop-contract.XXXXXX")"
  temporary_diagnostics="true"
fi

mkdir -p "$diagnostics_dir/candidate"
diff -qr \
  "$repo_root/apps/web/src/generated/kiosk-sop/inspection-drawing" \
  "$diagnostics_dir/candidate/inspection-drawing" > "$diagnostics_dir/inspection-artifact-tree-diff.txt" || true
diff -qr \
  "$repo_root/apps/web/src/generated/kiosk-sop/assembly-procedure-template" \
  "$diagnostics_dir/candidate/assembly-procedure-template" > "$diagnostics_dir/assembly-artifact-tree-diff.txt" || true

cleanup() {
  if [[ "$temporary_diagnostics" == "true" ]]; then
    rm -rf "$diagnostics_dir"
  fi
}
trap cleanup EXIT INT TERM

docker build --platform "$generator_platform" --file "$dockerfile" --tag "$image_tag" "$repo_root"

docker run --rm --init --ipc=host --network=none --platform "$generator_platform" \
  --volume "$diagnostics_dir:/diagnostics" \
  --volume "$inspection_preview_path:/workspace/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html:ro" \
  --volume "$assembly_preview_path:/workspace/docs/design-previews/kiosk-assembly-procedure-template-sop.html:ro" \
  "$image_tag" \
  bash -lc '
    set -euo pipefail

    capture_tree_diff() {
      mkdir -p /diagnostics/candidate
      diff -qr \
        /workspace/apps/web/src/generated/kiosk-sop/inspection-drawing \
        /diagnostics/candidate/inspection-drawing > /diagnostics/inspection-artifact-tree-diff.txt || true
      diff -qr \
        /workspace/apps/web/src/generated/kiosk-sop/assembly-procedure-template \
        /diagnostics/candidate/assembly-procedure-template > /diagnostics/assembly-artifact-tree-diff.txt || true
    }
    trap capture_tree_diff EXIT

    node --test scripts/kiosk-sop/capture-contract.test.mjs scripts/ci/kiosk-sop-artifact-contract.test.mjs
    node scripts/kiosk-sop/generate.mjs generate --output-root /diagnostics/candidate
    node scripts/ci/kiosk-sop-artifact-contract.mjs verify \
      --expected-root /workspace/apps/web/src/generated/kiosk-sop/inspection-drawing \
      --actual-root /diagnostics/candidate/inspection-drawing \
      --preview /workspace/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html \
      --diagnostics-root /diagnostics/inspection
    node scripts/ci/kiosk-sop-artifact-contract.mjs verify \
      --expected-root /workspace/apps/web/src/generated/kiosk-sop/assembly-procedure-template \
      --actual-root /diagnostics/candidate/assembly-procedure-template \
      --preview /workspace/docs/design-previews/kiosk-assembly-procedure-template-sop.html \
      --diagnostics-root /diagnostics/assembly
    pnpm exec playwright test --config=playwright.kiosk-sop.config.ts
  '
