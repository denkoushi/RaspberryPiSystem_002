#!/bin/bash
set -euo pipefail

# change-detector: 設定変更とコード変更を検知し、JSONで出力する。
# - 対象: HEADとの差分 + 未追跡ファイル
# - 設定: infrastructure/ansible/group_vars/*, inventory.yml
# - コード: apps/api, apps/web, packages, clients/nfc-agent
# - group_vars/all.yml はトップレベルキーの差分を推定（追加/削除/値変更を検知）

usage() {
  cat <<'EOF'
Usage: scripts/deploy/change-detector.sh [--help]

Outputs JSON:
{
  "config_changes": [
    {
      "path": "infrastructure/ansible/group_vars/all.yml",
      "changed_keys": ["network_mode"],
      "old_values": {},
      "new_values": {}
    }
  ],
  "code_changes": [
    {
      "path": "apps/api/src/services/signage/signage.service.ts",
      "change_type": "modified"
    }
  ],
  "detection_time": "2025-12-06T10:00:00Z"
}
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "${repo_root}"

python3 - <<'PY'
import json, subprocess, sys, os, yaml
from datetime import datetime, timezone

def git_status_porcelain():
    try:
        out = subprocess.check_output(["git", "status", "--porcelain"], text=True)
    except subprocess.CalledProcessError:
        return []
    lines = []
    for line in out.splitlines():
        if not line.strip():
            continue
        status = line[:2]
        path = line[3:].strip()
        lines.append((status, path))
    return lines

def classify_change(status):
    if status.startswith("??"):
        return "added"
    if "D" in status:
        return "deleted"
    return "modified"

def load_yaml(path):
    if not os.path.isfile(path):
        return {}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}

def load_yaml_from_git(path):
    try:
        out = subprocess.check_output(["git", "show", f"HEAD:{path}"], text=True)
    except subprocess.CalledProcessError:
        return {}
    try:
        return yaml.safe_load(out) or {}
    except Exception:
        return {}

def top_level_changed_keys(path):
    cur = load_yaml(path)
    base = load_yaml_from_git(path)
    keys = set()
    if isinstance(cur, dict):
        keys.update(cur.keys())
    if isinstance(base, dict):
        keys.update(base.keys())
    changed = []
    for k in sorted(keys):
        cur_v = cur.get(k) if isinstance(cur, dict) else None
        base_v = base.get(k) if isinstance(base, dict) else None
        if cur_v != base_v:
            changed.append(k)
    return changed

status_lines = git_status_porcelain()

config_changes = []
code_changes = []

for status, path in status_lines:
    change_type = classify_change(status)
    # 設定ファイル
    if path.startswith("infrastructure/ansible/group_vars/") or path == "infrastructure/ansible/inventory.yml":
        changed_keys = []
        if path == "infrastructure/ansible/group_vars/all.yml" and change_type != "deleted":
            changed_keys = top_level_changed_keys(path)
        config_changes.append({
            "path": path,
            "changed_keys": changed_keys,
            "old_values": {},
            "new_values": {},
            "change_type": change_type
        })
        continue
    # コード
    if path.startswith(("apps/api/", "apps/web/", "packages/", "clients/nfc-agent/")):
        code_changes.append({
            "path": path,
            "change_type": change_type
        })
        continue

output = {
    "config_changes": config_changes,
    "code_changes": code_changes,
    "detection_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
}

print(json.dumps(output, ensure_ascii=False, indent=2))
PY

