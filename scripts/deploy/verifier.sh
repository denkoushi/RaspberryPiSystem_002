#!/bin/bash
set -euo pipefail

# verifier: デプロイ結果JSONを受け取り、検証を実行する。
# 安全のためデフォルトは実行せず "skipped" を返す。DEPLOY_VERIFIER_ENABLE=1 のときのみ実行。
# 検証項目は infrastructure/ansible/verification-map.yml（または VERIFICATION_MAP_PATH で上書き）。

usage() {
  cat <<'EOF'
Usage: scripts/deploy/verifier.sh

Reads JSON from stdin (deploy-executor output) and prints verification JSON.
Set DEPLOY_VERIFIER_ENABLE=1 to actually run verification commands (not implemented here).
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

input="$(cat)"
now_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
enable_exec="${DEPLOY_VERIFIER_ENABLE:-0}"
repo_root="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ver_map="${VERIFICATION_MAP_PATH:-${repo_root}/infrastructure/ansible/verification-map.yml}"

python3 - <<'PY' "${enable_exec}" "${now_ts}" "${input}" "${ver_map}"
import sys, json, yaml, os, subprocess, time, re, urllib.request, ssl

enable_exec, now_ts, stdin_json, ver_map = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

LOG_PATH = "/Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug.log"

def log_event(hypothesis_id: str, location: str, message: str, data: dict):
    payload = {
        "sessionId": "debug-session",
        "runId": os.environ.get("DEBUG_RUN_ID", "verifier-run"),
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass

def load_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None

def load_yaml(path):
    if not os.path.isfile(path):
        return {}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}

def env_bool(name: str):
    val = os.environ.get(name)
    if val is None:
        return False
    return val.lower() in ("1", "true", "yes", "on")

def render_vars(text: str):
    def repl(match):
        key = match.group(1).strip()
        env_key = key.upper()
        return os.environ.get(env_key, "")
    return re.sub(r"\{\{\s*([^\}]+?)\s*\}\}", repl, text)

def http_get(url: str, expected_status: int, timeout: int = 5, headers: dict = None, insecure_tls: bool = False):
    start = time.time()
    try:
        #region agent log
        log_event("H2", "verifier.sh:http_get", "http_get request", {
            "url": url,
            "expected_status": expected_status,
            "insecure_tls": insecure_tls
        })
        #endregion
        req = urllib.request.Request(url)
        if headers:
            for key, value in headers.items():
                req.add_header(key, value)
        context = None
        if url.startswith("https://") and insecure_tls:
            context = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
            status = resp.getcode()
            duration = int(time.time() - start)
            return {
                "status": "pass" if status == expected_status else "fail",
                "actual_status": status,
                "duration_seconds": duration,
            }
    except Exception as e:
        duration = int(time.time() - start)
        #region agent log
        log_event("H2", "verifier.sh:http_get", "http_get error", {
            "url": url,
            "error": str(e)
        })
        #endregion
        return {
            "status": "fail",
            "error": str(e),
            "duration_seconds": duration,
        }

def systemd_status(service: str, expected_status: str):
    start = time.time()
    proc = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True)
    duration = int(time.time() - start)
    actual = proc.stdout.strip()
    ok = (proc.returncode == 0) and (actual == expected_status)
    return {
        "status": "pass" if ok else "fail",
        "actual_status": actual,
        "exit_code": proc.returncode,
        "duration_seconds": duration,
    }

def command_check(command: str, expected_output: str):
    start = time.time()
    proc = subprocess.run(command, shell=True, capture_output=True, text=True)
    duration = int(time.time() - start)
    out = proc.stdout.strip()
    ok = proc.returncode == 0 and (expected_output == "" or expected_output in out)
    #region agent log
    log_event("H3", "verifier.sh:command_check", "command result", {
        "command": command,
        "exit_code": proc.returncode,
        "stdout_tail": out[-200:],
        "stderr_tail": proc.stderr.strip()[-200:]
    })
    #endregion
    return {
        "status": "pass" if ok else "fail",
        "exit_code": proc.returncode,
        "stdout_tail": out[-400:],
        "stderr_tail": proc.stderr.strip()[-400:],
        "duration_seconds": duration,
    }

def skip_all(note):
    print(json.dumps({
        "verification_results": [],
        "overall_status": "skipped",
        "verified_at": now_ts,
        "note": note
    }, ensure_ascii=False, indent=2))
    sys.exit(0)

if enable_exec != "1":
    skip_all("DEPLOY_VERIFIER_ENABLE!=1 のため検証は未実行")

deploy_result = load_json(stdin_json)
if deploy_result is None:
    print(json.dumps({
        "verification_results": [],
        "overall_status": "error",
        "verified_at": now_ts,
        "note": "invalid JSON input"
    }, ensure_ascii=False, indent=2))
    sys.exit(1)

ver_map_obj = load_yaml(ver_map).get("verification_map", {})
if not ver_map_obj:
    print(json.dumps({
        "verification_results": [],
        "overall_status": "error",
        "verified_at": now_ts,
        "note": f"verification map not found or empty: {ver_map}"
    }, ensure_ascii=False, indent=2))
    sys.exit(1)

deploy_targets = {}
for r in deploy_result.get("results", []):
    deploy_targets[r.get("target")] = r.get("status")

ver_results = []

#region agent log
log_event("H4", "verifier.sh:deploy_targets", "deploy targets parsed", {
    "deploy_targets": deploy_targets
})
#endregion

for target, checks in ver_map_obj.items():
    target_status = deploy_targets.get(target, "unknown")
    target_checks = []

    if target_status not in ("success", "skipped"):
        #region agent log
        log_event("H4", "verifier.sh:target_skip", "target skipped by status", {
            "target": target,
            "target_status": target_status
        })
        #endregion
        ver_results.append({
            "target": target,
            "overall_status": "skipped",
            "note": f"deploy status is {target_status}, verification skipped",
            "checks": []
        })
        continue

    for chk in checks:
        name = chk.get("name", "unknown")
        chk_type = chk.get("type")
        when_key = chk.get("when")
        if when_key:
            if not env_bool(when_key.upper()):
                target_checks.append({
                    "name": name,
                    "status": "skipped",
                    "note": f"when {when_key} is false"
                })
                continue

        if chk_type == "http_get":
            url = render_vars(chk.get("url", ""))
            expected_status = int(chk.get("expected_status", 200))
            headers = chk.get("headers", {})
            insecure_tls = bool(chk.get("insecure_tls", False))
            # headersの値もrender_varsで変数展開
            rendered_headers = {}
            for key, value in headers.items():
                rendered_headers[key] = render_vars(str(value))
            res = http_get(url, expected_status, headers=rendered_headers if rendered_headers else None, insecure_tls=insecure_tls)
            res.update({"name": name, "type": chk_type, "url": url})
        elif chk_type == "systemd_status":
            service = chk.get("service", "")
            expected_status = chk.get("expected_status", "active")
            res = systemd_status(service, expected_status)
            res.update({"name": name, "type": chk_type, "service": service})
        elif chk_type == "command":
            command = render_vars(chk.get("command", ""))
            expected_output = render_vars(chk.get("expected_output", ""))
            res = command_check(command, expected_output)
            res.update({"name": name, "type": chk_type, "command": command})
        else:
            res = {
                "name": name,
                "type": chk_type,
                "status": "skipped",
                "note": "unknown check type"
            }
        target_checks.append(res)

    if any(c.get("status") == "fail" for c in target_checks):
        overall = "fail"
    elif all(c.get("status") == "skipped" for c in target_checks):
        overall = "skipped"
    else:
        overall = "pass"

    ver_results.append({
        "target": target,
        "overall_status": overall,
        "checks": target_checks
    })

if any(t.get("overall_status") == "fail" for t in ver_results):
    overall_status = "failed"
elif all(t.get("overall_status") == "skipped" for t in ver_results):
    overall_status = "skipped"
else:
    overall_status = "passed"

print(json.dumps({
    "verification_results": ver_results,
    "overall_status": overall_status,
    "verified_at": now_ts
}, ensure_ascii=False, indent=2))
PY

