#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
output_dir="${1:?Usage: install-generated.sh <output-dir>}"
generated_root="$repo_root/apps/web/src/generated/kiosk-sop"

mkdir -p "$generated_root"
rsync -a --delete -- "$output_dir/" "$generated_root/"
cp "$generated_root/inspection-drawing/manual.html" "$repo_root/docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html"
cp "$generated_root/assembly-procedure-template/manual.html" "$repo_root/docs/design-previews/kiosk-assembly-procedure-template-sop.html"
