#!/bin/bash
set -euo pipefail

# deploy-executor: impact-analyzerのJSONを受け取り、デプロイを実行する。
# 安全のためデフォルトは実行せず "skipped" を返す。DEPLOY_EXECUTOR_ENABLE=1 のとき実行。
# 実行コマンドは server: scripts/server/deploy.sh、クライアント: ansible-playbook deploy.yml --limit。

usage() {
  cat <<'EOF'
Usage: scripts/deploy/deploy-executor.sh [--help]

Reads JSON from stdin (impact-analyzer output) and prints deploy result JSON.
Set DEPLOY_EXECUTOR_ENABLE=1 to actually run deploy commands.
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "${repo_root}"

input="$(cat)"
now_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
enable_exec="${DEPLOY_EXECUTOR_ENABLE:-0}"

# パーサ（jq不要、pythonで安全に扱う）
python3 - <<'PY' "${enable_exec}" "${now_ts}" "${input}" "${repo_root}"
import sys, json, subprocess, time

enable_exec, now_ts, stdin_json, repo_root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

CMD_MAP = {
    "server": ["bash", "scripts/server/deploy.sh"],
    "pi4_kiosk": ["ansible-playbook", "-i", "infrastructure/ansible/inventory.yml",
                  "infrastructure/ansible/playbooks/deploy.yml", "--limit", "raspberrypi4",
                  "--roles-path", "infrastructure/ansible/roles"],
    "pi3_signage": ["ansible-playbook", "-i", "infrastructure/ansible/inventory.yml",
                    "infrastructure/ansible/playbooks/deploy.yml", "--limit", "raspberrypi3",
                    "--roles-path", "infrastructure/ansible/roles"],
}

def tail(text: str, limit: int = 600) -> str:
    if text is None:
        return ""
    return text[-limit:]

def run_cmd(cmd, cwd=None):
    start = time.time()
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    duration = int(time.time() - start)
    status = "success" if proc.returncode == 0 else "failed"
    return {
        "status": status,
        "duration_seconds": duration,
        "exit_code": proc.returncode,
        "stdout_tail": tail(proc.stdout),
        "stderr_tail": tail(proc.stderr),
    }

try:
    impact = json.loads(stdin_json)
except json.JSONDecodeError:
    print(json.dumps({
        "overall_status": "error",
        "error": "invalid JSON input",
        "executed_at": now_ts
    }, ensure_ascii=False, indent=2))
    sys.exit(1)

deploy_targets = impact.get("deploy_targets", [])
results = []

if not isinstance(deploy_targets, list):
    print(json.dumps({
        "overall_status": "error",
        "error": "deploy_targets must be an array",
        "executed_at": now_ts
    }, ensure_ascii=False, indent=2))
    sys.exit(1)

if enable_exec != "1":
    for t in deploy_targets:
        cmd = CMD_MAP.get(t)
        result = {
            "target": t,
            "status": "skipped",
            "duration_seconds": 0,
            "planned_command": " ".join(cmd) if cmd else "",
            "note": "DEPLOY_EXECUTOR_ENABLE!=1 のため実行しません"
        }
        results.append(result)
    overall = "skipped"
    note = "dry-run (DEPLOY_EXECUTOR_ENABLE!=1)"
else:
    for t in deploy_targets:
        cmd = CMD_MAP.get(t)
        if not cmd:
            results.append({
                "target": t,
                "status": "failed",
                "duration_seconds": 0,
                "exit_code": None,
                "planned_command": "",
                "note": "unknown target"
            })
            continue
        exec_result = run_cmd(cmd, cwd=repo_root)
        exec_result.update({
            "target": t,
            "planned_command": " ".join(cmd)
        })
        results.append(exec_result)

    if all(r["status"] == "success" for r in results if r["status"] in ("success", "failed")):
        overall = "success"
    elif any(r["status"] == "failed" for r in results):
        overall = "failed"
    else:
        overall = "skipped"
    note = "executed (DEPLOY_EXECUTOR_ENABLE=1)"

print(json.dumps({
    "results": results,
    "overall_status": overall,
    "executed_at": now_ts,
    "note": note
}, ensure_ascii=False, indent=2))
PY

