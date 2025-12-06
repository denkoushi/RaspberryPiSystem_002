#!/bin/bash
set -euo pipefail

# impact-analyzer: change-detectorのJSONを受け取り、影響範囲を判定する。
# - config-impact-map.yml: 設定変更 → 影響ターゲットを決定
# - dependency-map.yml: コード変更 → モジュール/コンポーネントからターゲット決定
# - ヒューリスティック: パスからモジュール推定（signage/kiosk/tools）

usage() {
  cat <<'EOF'
Usage: scripts/deploy/impact-analyzer.sh

Reads JSON from stdin (change-detector output) and prints impact JSON.
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "${repo_root}"

CONFIG_IMPACT_MAP="infrastructure/ansible/config-impact-map.yml"
DEPENDENCY_MAP="infrastructure/ansible/dependency-map.yml"

input="$(cat)"

python3 - <<'PY' "${CONFIG_IMPACT_MAP}" "${DEPENDENCY_MAP}" "${input}"
import sys, json, yaml, os, re

config_map_path, dep_map_path, stdin_json = sys.argv[1], sys.argv[2], sys.argv[3]

def load_yaml(path):
    if not os.path.isfile(path):
        return {}
    with open(path, 'r') as f:
        return yaml.safe_load(f) or {}

try:
    changes = json.loads(stdin_json)
except json.JSONDecodeError:
    changes = {"config_changes": [], "code_changes": []}

config_changes = changes.get("config_changes", [])
code_changes = changes.get("code_changes", [])

impact_scope = {
    "server": False,
    "pi4_kiosk": False,
    "pi3_signage": False,
    "nfc_agent": False
}
deploy_targets = set()
reasons = []

config_map = load_yaml(config_map_path).get("config_impact_map", {})
dep_map = load_yaml(dep_map_path).get("dependency_map", {})
api_endpoints = dep_map.get("api_endpoints", {})
frontend_components = dep_map.get("frontend_components", {})
module_deps = dep_map.get("module_dependencies", {})

def mark(target, reason):
    if target:
        impact_scope[target] = True
        deploy_targets.add(target)
        if reason:
            reasons.append(reason)

# --- 設定変更判定 ---
for cfg in config_changes:
    keys = cfg.get("changed_keys") or []
    for key in keys:
        if key in config_map:
            impacted = config_map[key].get("impact", [])
            reason = config_map[key].get("reason", "")
            for t in impacted:
                mark(t, f"{key}: {reason}")
        else:
            for t in impact_scope.keys():
                mark(t, f"{key}: 未知の設定キーのため全体に影響")

# --- コード変更判定 ---
def infer_module_from_path(path: str):
    if "signage" in path:
        return "signage"
    if "kiosk" in path:
        return "kiosk"
    if "tools" in path:
        return "tools"
    return None

for code in code_changes:
    path = code.get("path", "")

    # frontend_components で明示的にターゲット決定
    if path in frontend_components:
        target = frontend_components[path].get("deploy_target")
        mark(target, f"{path}: frontend deploy target {target}")

    # API endpoints (files が未定義の場合はスキップ)
    for ep, meta in api_endpoints.items():
        files = meta.get("files") or []
        module = meta.get("module")
        used_by = meta.get("used_by") or []
        if path in files:
            for u in used_by:
                if u == "pi3_signage":
                    mark("pi3_signage", f"{path}: used_by signage")
                if u == "pi4_kiosk":
                    mark("pi4_kiosk", f"{path}: used_by kiosk")
                if u == "admin_console":
                    mark("server", f"{path}: used_by admin_console")
            if module:
                deps = module_deps.get(module, {}).get("depends_on", [])
                if "tools" in deps:
                    mark("server", f"{path}: module {module} depends_on tools")

    # ヒューリスティック: モジュール推定
    module = infer_module_from_path(path)
    if module == "signage":
        mark("pi3_signage", f"{path}: signage module change")
        mark("server", f"{path}: api signage")
    if module == "kiosk":
        mark("pi4_kiosk", f"{path}: kiosk module change")
        mark("server", f"{path}: api kiosk")
    if module == "tools":
        mark("server", f"{path}: tools module change")
        # toolsに依存するクライアントへ波及
        mark("pi4_kiosk", f"{path}: tools dependency (kiosk)")
        mark("pi3_signage", f"{path}: tools dependency (signage)")

    # サーバー側 API / 共有型
    if path.startswith(("apps/api/", "packages/")):
        mark("server", f"{path}: server-side change")
    # フロントエンド共通
    if path.startswith("apps/web/src/pages/kiosk"):
        mark("pi4_kiosk", f"{path}: kiosk web change")
    if path.startswith("apps/web/src/pages/signage"):
        mark("pi3_signage", f"{path}: signage web change")

if not config_changes and not code_changes:
    reasons.append("変更が検知されませんでした")

print(json.dumps({
    "impact_scope": impact_scope,
    "deploy_targets": sorted(list(deploy_targets)),
    "reason": "; ".join(reasons) if reasons else "変更が検知されませんでした"
}, ensure_ascii=False, indent=2))
PY

