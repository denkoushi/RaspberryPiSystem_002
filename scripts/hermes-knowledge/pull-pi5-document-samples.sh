#!/usr/bin/env bash
# Copy the Pi5 document stores used for knowledge evaluation onto this Mac,
# read-only on the Pi5 side. Business data: the destination must stay outside
# any Git checkout. Re-running only transfers changed files.
#
# Usage: scripts/hermes-knowledge/pull-pi5-document-samples.sh [DEST]
#   DEST defaults to ~/RaspiKnowledgeSamples
#   PI5_SSH_HOST overrides the ssh alias (default raspi5-tailscale)
set -euo pipefail

host="${PI5_SSH_HOST:-raspi5-tailscale}"
dest="${1:-$HOME/RaspiKnowledgeSamples}"
remote_root=/opt/RaspberryPiSystem_002/storage

mkdir -p "$dest/files" "$dest/metadata"
if git -C "$dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "refusing: $dest is inside a Git checkout" >&2; exit 1
fi
chmod 700 "$dest"

for dir in pdfs part-measurement-drawings assembly-procedure-images assembly-procedure-assets work-instruction-assets; do
  echo "== $dir"
  rsync -a --stats "$host:$remote_root/$dir/" "$dest/files/$dir/" | grep -E "Number of (regular )?files transferred|Total file size" || true
done

# Metadata that names the files (titles, part numbers, step order). Read-only SELECTs.
query() {
  local name=$1 sql=$2
  # shellcheck disable=SC2016
  ssh "$host" 'db=$(docker ps --format "{{.Names}} {{.Image}}" | awk "\$2 ~ /postgres|pgvector/{print \$1; exit}");
    test -n "$db" || { echo "postgres container not found" >&2; exit 1; }
    docker exec -i "$db" psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -X -q' \
    <<<"\\copy ($sql) to stdout with csv header" > "$dest/metadata/$name.csv"
  echo "== metadata/$name.csv: $(($(wc -l < "$dest/metadata/$name.csv") - 1)) rows"
}
query kiosk-documents 'select id, title, "displayTitle", filename, "filePath", "pageCount", "ocrStatus", "candidateFhincd", "candidateDrawingNumber", "candidateProcessName" from "KioskDocument" order by "createdAt"'
query drawings 'select id, name, "drawingImageRelativePath", "isActive" from "PartMeasurementVisualTemplate" order by name'
query work-instruction-steps 'select r."partNumber", r."shootingTarget", s.step, s.text, a."storageKey" from "WorkInstructionStep" s join "WorkInstructionRow" r on r.id = s."rowId" left join "WorkInstructionAsset" a on a.id = s."assetId" order by r."partNumber", r."shootingTarget", s.step'
query assembly-procedure-documents 'select d.id, d.name, d.status, d."imageRelativePath", p."pageIndex", p."imageRelativePath" as page_image from "AssemblyProcedureDocument" d left join "AssemblyProcedureDocumentPage" p on p."documentId" = d.id order by d.name, p."pageIndex"'

echo "done: $dest"
