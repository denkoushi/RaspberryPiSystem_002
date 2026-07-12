#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT/infrastructure/ansible/roles/signage/templates/signage-update.sh.j2"
SVG="$ROOT/infrastructure/ansible/roles/signage/templates/signage-maintenance.svg.j2"
grep -Fq 'DEPLOY_STATUS_URL=' "$TEMPLATE"
grep -Fq 'acknowledge_maintenance' "$TEMPLATE"
grep -Fq 'rsvg-convert' "$TEMPLATE"
grep -Fq 'ただいま更新中です' "$SVG"
echo 'PASS: signage deployment maintenance template'
