#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

LOG_PATH = Path("/Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug-896c7a.log")
SESSION_ID = "896c7a"
RUN_ID = f"run-{int(time.time())}"
ANSIBLE_INV = "/Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml"
ANSIBLE_CWD = "/Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible"


def emit(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    payload = {
        "sessionId": SESSION_ID,
        "runId": RUN_ID,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def run_cmd(command: str, cwd: str | None = None) -> tuple[int, str]:
    p = subprocess.run(command, cwd=cwd, shell=True, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out


def probe_bridge_chat() -> None:
    url = "http://192.168.128.112:18080/api/stackchan/chat/simple"
    body = {
        "messages": [{"role": "user", "content": "今日の天気は？"}],
        "maxTokens": 128,
        "temperature": 0.35,
        "enableThinking": False,
    }
    req = urllib.request.Request(
        url=url,
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            txt = r.read().decode("utf-8", errors="ignore")
            #region agent log
            emit(
                "H3",
                "debug_runtime_probe.py:62",
                "bridge simple chat probe",
                {
                    "status": r.getcode(),
                    "elapsedSec": round(time.time() - t0, 3),
                    "replyTextExists": "\"replyText\"" in txt,
                    "responsePrefix": txt[:180].replace("\n", " "),
                },
            )
            #endregion
    except Exception as e:  # noqa: BLE001
        #region agent log
        emit(
            "H3",
            "debug_runtime_probe.py:75",
            "bridge simple chat probe failed",
            {
                "errorType": type(e).__name__,
                "error": str(e),
                "elapsedSec": round(time.time() - t0, 3),
            },
        )
        #endregion


def probe_remote_state() -> None:
    cmd = (
        "ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml "
        "private-pi5-stackchan-bridge -m shell -a "
        "\"date '+%F %T %z'; systemctl is-active stackchan-bridge; "
        "journalctl -u stackchan-bridge --since '20 min ago' --no-pager\""
    )
    rc, out = run_cmd(cmd, cwd=ANSIBLE_CWD)
    #region agent log
    emit(
        "H2",
        "debug_runtime_probe.py:99",
        "private pi bridge journal snapshot",
        {
            "rc": rc,
            "hasStt200": "POST /api/stackchan/stt HTTP/1.1\" 200" in out,
            "hasChat200": "POST /api/stackchan/chat/simple HTTP/1.1\" 200" in out,
            "hasRecentChatAt1755": "17:55:39" in out,
            "snippet": out[-1200:],
        },
    )
    #endregion


def probe_dgx_from_private_pi() -> None:
    cmd = (
        "ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml "
        "private-pi5-stackchan-bridge -m shell -a "
        "\"set -e; . /home/raspi5-private/stackchan-bridge/.env; "
        "for p in /healthz /v1/models; do "
        "curl -sS -o /tmp/dgx_probe.out -w \\\"\\$p code=%{http_code} total=%{time_total}\\\\n\\\" "
        "-H \\\"X-LLM-Token: \\$DGX_LLM_SHARED_TOKEN\\\" \\\"\\$DGX_BASE_URL\\$p\\\"; "
        "done; "
        "curl -sS -o /tmp/dgx_chat.out -w '/v1/chat/completions code=%{http_code} total=%{time_total}\\n' "
        "-H \\\"X-LLM-Token: \\$DGX_LLM_SHARED_TOKEN\\\" -H \\\"Content-Type: application/json\\\" "
        "-d '{\\\"model\\\":\\\"system-prod-primary\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"probe\\\"}],\\\"max_tokens\\\":16,\\\"temperature\\\":0.0,\\\"chat_template_kwargs\\\":{\\\"enable_thinking\\\":false}}' "
        "\\\"\\$DGX_BASE_URL/v1/chat/completions\\\"\""
    )
    rc, out = run_cmd(cmd, cwd=ANSIBLE_CWD)
    #region agent log
    emit(
        "H1",
        "debug_runtime_probe.py:136",
        "dgx latency probe from private pi",
        {
            "rc": rc,
            "dgxHealthy": "/healthz code=200" in out,
            "modelsHealthy": "/v1/models code=200" in out,
            "chatHealthy": "/v1/chat/completions code=200" in out,
            "raw": out[-1000:],
        },
    )
    #endregion


def main() -> None:
    #region agent log
    emit(
        "H4",
        "debug_runtime_probe.py:154",
        "probe run started",
        {"runId": RUN_ID, "note": "collecting runtime evidence for delayed response/no immediate wakeword"},
    )
    #endregion
    probe_remote_state()
    probe_dgx_from_private_pi()
    probe_bridge_chat()
    #region agent log
    emit("H4", "debug_runtime_probe.py:164", "probe run finished", {"runId": RUN_ID})
    #endregion


if __name__ == "__main__":
    main()
