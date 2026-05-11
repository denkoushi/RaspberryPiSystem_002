#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
from datetime import datetime
from pathlib import Path

LOG_PATH = Path(os.getenv("STACKCHAN_DEBUG_LOG_PATH", "/Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug-e2fdaa.log"))
SESSION_ID = os.getenv("STACKCHAN_DEBUG_SESSION_ID", "e2fdaa")
STACKCHAN_IP_DEFAULT = "192.168.128.125"
STACKCHAN_MAC = "44:1b:f6:e2:7a:e0"
BRIDGE_SIMPLE_URL = "http://192.168.128.112:18080/api/stackchan/chat/simple"
BRIDGE_HEALTH_CANDIDATES = [
    "http://192.168.128.112:18080/healthz",
    "http://192.168.128.113:18080/healthz",
]
ANSIBLE_DIR = Path("/Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible")
ANSIBLE_CMD = [
    "ansible",
    "-i",
    "inventory-private-pi5-stackchan-bridge-fragment.yml",
    "private-pi5-stackchan-bridge",
    "-m",
    "shell",
]


def write_log(run_id: str, hypothesis_id: str, location: str, message: str, data: dict) -> None:
    payload = {
        "sessionId": SESSION_ID,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def http_get(url: str, timeout: float) -> tuple[int, str]:
    started = time.time()
    with urllib.request.urlopen(url, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        return int((time.time() - started) * 1000), body


def http_get_meta(url: str, timeout: float) -> dict[str, object]:
    started = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return {
                "ok": True,
                "status": getattr(response, "status", None),
                "contentType": response.headers.get("Content-Type", ""),
                "elapsedMs": int((time.time() - started) * 1000),
                "bodyLength": len(body),
                "bodySnippet": body[:160],
                "endpointHints": sorted(set(re.findall(r"/[A-Za-z0-9_?=&.-]+", body)))[:20],
            }
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status": e.code,
            "errorType": "HTTPError",
            "elapsedMs": int((time.time() - started) * 1000),
            "bodyLength": len(body),
            "bodySnippet": body[:160],
        }
    except TimeoutError:
        return {
            "ok": False,
            "errorType": "TimeoutError",
            "elapsedMs": int((time.time() - started) * 1000),
        }
    except URLError as e:
        return {
            "ok": False,
            "errorType": "URLError",
            "elapsedMs": int((time.time() - started) * 1000),
            "message": str(e),
        }


def http_post_json(url: str, payload: dict, timeout: float) -> tuple[int, str]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    started = time.time()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        return int((time.time() - started) * 1000), body


def ansible_shell(command: str) -> tuple[str, str | None]:
    try:
        completed = subprocess.run(
            [*ANSIBLE_CMD, "-a", command],
            cwd=ANSIBLE_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout, None
    except subprocess.CalledProcessError as exc:
        return exc.stdout or "", (exc.stderr or str(exc))


def resolve_stackchan_ip() -> str:
    try:
        arp_out = subprocess.run(["arp", "-a"], check=True, capture_output=True, text=True).stdout
        for line in arp_out.splitlines():
            if STACKCHAN_MAC in line.lower():
                match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line)
                if match:
                    return match.group(1)
    except Exception:
        pass
    return STACKCHAN_IP_DEFAULT


def main() -> int:
    run_id = f"run-{int(time.time())}"
    since = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    stackchan_ip = resolve_stackchan_ip()
    stackchan_root_url = f"http://{stackchan_ip}/"
    stackchan_chat_url = f"http://{stackchan_ip}/chat?text="
    stackchan_personalize_js_url = f"http://{stackchan_ip}/personalize.js"

    # region agent log
    write_log(
        run_id,
        "H4",
        "debug_stackchan_runtime_probe.py:67",
        "probe_start",
        {
            "since": since,
            "stackchanIp": stackchan_ip,
            "stackchanChatUrl": stackchan_chat_url,
            "bridgeSimpleUrl": BRIDGE_SIMPLE_URL,
        },
    )
    # endregion

    simple_elapsed_ms = 0
    simple_body = ""
    simple_json: dict[str, object] = {}
    simple_error: str | None = None
    started = time.time()
    try:
        simple_elapsed_ms, simple_body = http_post_json(
            BRIDGE_SIMPLE_URL,
            {"messages": [{"role": "user", "content": "こんにちは"}], "maxTokens": 128, "temperature": 0.35},
            timeout=20,
        )
        simple_json = json.loads(simple_body)
    except Exception as exc:
        simple_elapsed_ms = int((time.time() - started) * 1000)
        simple_error = str(exc)

    # region agent log
    write_log(
        run_id,
        "H1",
        "debug_stackchan_runtime_probe.py:82",
        "bridge_simple_response",
        {
            "ok": simple_error is None,
            "elapsedMs": simple_elapsed_ms,
            "error": simple_error,
            "bodyLength": len(simple_body),
            "topLevelKeys": sorted(simple_json.keys()),
            "replyTextLength": len(simple_json.get("replyText", "")),
            "hasUpstream": "upstream" in simple_json,
            "upstreamChoiceCount": len(simple_json.get("upstream", {}).get("choices", [])),
        },
    )
    # endregion

    root_meta = http_get_meta(stackchan_root_url, timeout=20)
    chat_meta = http_get_meta(stackchan_chat_url + urllib.parse.quote("こんにちは"), timeout=90)
    personalize_meta = http_get_meta(stackchan_personalize_js_url, timeout=20)
    bridge_health_checks = [http_get_meta(url, timeout=5) for url in BRIDGE_HEALTH_CANDIDATES]
    # region agent log
    write_log(
        run_id,
        "H11",
        "debug_stackchan_runtime_probe.py:100",
        "stackchan_http_surfaces",
        {
            "root": root_meta,
            "chat": chat_meta,
            "personalizeJs": {
                "ok": personalize_meta.get("ok"),
                "status": personalize_meta.get("status"),
                "contentType": personalize_meta.get("contentType"),
                "elapsedMs": personalize_meta.get("elapsedMs"),
                "bodyLength": personalize_meta.get("bodyLength"),
                "endpointHints": personalize_meta.get("endpointHints", []),
            },
            "bridgeHealth": [
                {"url": BRIDGE_HEALTH_CANDIDATES[idx], **bridge_health_checks[idx]}
                for idx in range(len(BRIDGE_HEALTH_CANDIDATES))
            ],
        },
    )
    # endregion

    compat_unit = "stackchan-bridge-compat-ip.service"
    deep_cmd = (
        f"journalctl -u stackchan-bridge --since '{since}' --no-pager; "
        "echo '---IP---'; ip -brief addr show wlan0; ip -4 addr show dev wlan0; "
        f"echo '---COMPAT_SHOW---'; "
        f"systemctl show {compat_unit} -p ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,ExecMainStatus --no-pager; "
        f"echo '---COMPAT_JOURNAL---'; journalctl -u {compat_unit} -n 40 --no-pager; "
        "echo '---NM_SNIP---'; journalctl -u NetworkManager --since '-6 hours' --no-pager | "
        "grep -E -i 'wlan0|dhcp|lease|carrier|disconnect|connect|address|192\\.168\\.128' | tail -n 35 || true"
    )
    bridge_log_output, bridge_log_error = ansible_shell(deep_cmd)
    http_lines = [line for line in bridge_log_output.splitlines() if "[stackchan-bridge]" in line and "HTTP/1.1" in line]
    post_lines = [line for line in http_lines if "POST /api/stackchan/chat/simple" in line]
    raw_post_lines = [line for line in http_lines if "POST /api/stackchan/chat " in line]
    non_200_lines = [line for line in http_lines if '" 200 ' not in line]
    alias_lines = [line for line in bridge_log_output.splitlines() if line.startswith("wlan0")]
    service_show_block = []
    in_show = False
    for line in bridge_log_output.splitlines():
        if line.strip() == "---COMPAT_SHOW---":
            in_show = True
            continue
        if line.strip() == "---COMPAT_JOURNAL---":
            break
        if in_show and line.strip():
            service_show_block.append(line.strip())
    compat_journal_snip = []
    in_cj = False
    for line in bridge_log_output.splitlines():
        if line.strip() == "---COMPAT_JOURNAL---":
            in_cj = True
            continue
        if line.strip() == "---NM_SNIP---":
            break
        if in_cj:
            compat_journal_snip.append(line.rstrip())
    nm_snip = []
    in_nm = False
    for line in bridge_log_output.splitlines():
        if line.strip() == "---NM_SNIP---":
            in_nm = True
            continue
        if in_nm:
            nm_snip.append(line.rstrip())
    has_compat_ip = any("192.168.128.112" in ln for ln in bridge_log_output.splitlines())
    sub_state = next((ln for ln in service_show_block if ln.startswith("SubState=")), "")
    # region agent log
    write_log(
        run_id,
        "H4",
        "debug_stackchan_runtime_probe.py:116",
        "bridge_journal_and_alias_state",
        {
            "httpLineCount": len(http_lines),
            "postCount": len(post_lines),
            "rawPostCount": len(raw_post_lines),
            "non200Count": len(non_200_lines),
            "httpLines": http_lines[-6:],
            "postLines": post_lines[-3:],
            "aliasState": alias_lines[-1] if alias_lines else "",
            "wlan0Has112Alias": has_compat_ip,
            "bridgeJournalFetchError": bridge_log_error,
        },
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H6",
        "debug_stackchan_runtime_probe.py:compat_unit_show",
        "compat_systemd_show",
        {"lines": service_show_block, "subState": sub_state.replace("SubState=", "")},
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H7",
        "debug_stackchan_runtime_probe.py:nm_snip",
        "networkmanager_recent_wlan_snip",
        {"lineCount": len(nm_snip), "tail": nm_snip[-15:] if nm_snip else []},
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H8",
        "debug_stackchan_runtime_probe.py:compat_journal",
        "compat_ip_unit_journal_tail",
        {"lineCount": len(compat_journal_snip), "tail": compat_journal_snip[-12:] if compat_journal_snip else []},
    )
    # endregion

    oneshot_active_exited = "exited" in sub_state.lower()
    # region agent log
    write_log(
        run_id,
        "H5",
        "debug_stackchan_runtime_probe.py:129",
        "probe_summary",
        {
            "simpleReplyText": simple_json.get("replyText", ""),
            "simpleBodyLength": len(simple_body),
            "simpleError": simple_error,
            "stackchanReachedBridge": len(http_lines) > 0,
            "stackchanChatSurfaceOk": bool(chat_meta.get("ok")),
            "stackchanChatLooksHtml": "html" in str(chat_meta.get("contentType", "")).lower()
            or "<!DOCTYPE html>" in str(chat_meta.get("bodySnippet", "")),
            "wlan0Has112Alias": has_compat_ip,
            "compatSubStateExited": oneshot_active_exited,
            "likelyEmptyReplyFromUnreachable": not has_compat_ip,
        },
    )
    # endregion
    return 0


if __name__ == "__main__":
    sys.exit(main())
