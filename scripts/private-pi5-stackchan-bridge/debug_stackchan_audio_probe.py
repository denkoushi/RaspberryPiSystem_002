#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

import serial
from serial import SerialException

LOG_PATH = Path(os.getenv("STACKCHAN_DEBUG_LOG_PATH", "/Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug-e2fdaa.log"))
SESSION_ID = os.getenv("STACKCHAN_DEBUG_SESSION_ID", "e2fdaa")
STACKCHAN_IP_DEFAULT = "192.168.128.125"
SERIAL_PORT = "/dev/cu.usbmodem1101"
STACKCHAN_MAC = "44:1b:f6:e2:7a:e0"
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


def wait_for_stackchan_http(ip: str, timeout_sec: int = 60) -> tuple[bool, int]:
    deadline = time.time() + timeout_sec
    attempts = 0
    url = f"http://{ip}/"
    while time.time() < deadline:
        attempts += 1
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if getattr(response, "status", None) == 200:
                    return True, attempts
        except Exception:
            pass
        time.sleep(2)
    return False, attempts


def capture_serial(seconds: int) -> str:
    chunks: list[str] = []
    ser = serial.Serial(SERIAL_PORT, 115200, timeout=0.2)
    try:
        started = time.time()
        while time.time() - started < seconds:
            try:
                data = ser.read(4096)
            except (SerialException, OSError):
                chunks.append("[DBG][H3] serial_read_interrupted\n")
                break
            if data:
                chunks.append(data.decode("utf-8", errors="replace"))
    finally:
        try:
            ser.close()
        except Exception:
            pass
    return "".join(chunks)


def main() -> int:
    run_id = f"audio-run-{int(time.time())}"
    since = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    stackchan_ip = resolve_stackchan_ip()
    stackchan_chat_url = f"http://{stackchan_ip}/chat?text="
    serial_output: dict[str, str] = {"value": ""}

    # region agent log
    write_log(
        run_id,
        "H1",
        "debug_stackchan_audio_probe.py:71",
        "probe_start",
        {"stackchanIp": stackchan_ip, "serialPort": SERIAL_PORT, "since": since},
    )
    # endregion

    reader = threading.Thread(target=lambda: serial_output.__setitem__("value", capture_serial(110)))
    reader.start()
    root_ready, ready_attempts = wait_for_stackchan_http(stackchan_ip, timeout_sec=40)
    # region agent log
    write_log(
        run_id,
        "H3",
        "debug_stackchan_audio_probe.py:97",
        "stackchan_http_ready_poll",
        {"rootReady": root_ready, "attempts": ready_attempts},
    )
    # endregion
    chat_url = stackchan_chat_url + urllib.parse.quote("こんにちは")
    started = time.time()
    chat_error: str | None = None
    try:
        with urllib.request.urlopen(chat_url, timeout=90) as response:
            body = response.read().decode("utf-8", errors="replace")
            # region agent log
            write_log(
                run_id,
                "H3",
                "debug_stackchan_audio_probe.py:91",
                "stackchan_chat_http",
                {
                    "status": getattr(response, "status", None),
                    "contentType": response.headers.get("Content-Type", ""),
                    "elapsedMs": int((time.time() - started) * 1000),
                    "bodyLength": len(body),
                },
            )
            # endregion
    except Exception as exc:
        chat_error = str(exc)
        # region agent log
        write_log(
            run_id,
            "H3",
            "debug_stackchan_audio_probe.py:106",
            "stackchan_chat_http_error",
            {"elapsedMs": int((time.time() - started) * 1000), "error": str(exc)},
        )
        # endregion
    reader.join()
    logs = serial_output["value"]
    serial_lines = [line for line in logs.splitlines() if line.strip()]

    payload_lengths = [int(x) for x in re.findall(r"\[HTTP\] payload length: (\d+)", logs)]
    mp3_urls = re.findall(r"https://audio\d+\.tts\.quest[^\s]+", logs)
    has_buflen_error = "MP3:ERROR_BUFLEN 0" in logs
    has_i2s_error = "I2S: register I2S object to platform failed" in logs
    buflen_error_count = len(re.findall(r"MP3:ERROR_BUFLEN 0", logs))
    i2s_error_count = len(re.findall(r"I2S: register I2S object to platform failed", logs))
    dbg_begin = re.findall(r"\[DBG\]\[H2/H3/H4\] mp3->begin result=(\d+)", logs)
    dbg_loop_false = re.findall(r"\[DBG\]\[H2\] mp3->loop returned false loopCount=(\d+)", logs)
    dbg_url = re.findall(r"\[DBG\]\[H1\] stream URL len=(\d+) ext=([^\r\n]+)", logs)
    update_delta = re.findall(r"\[DBG\]\[H6\] speaker updateCount afterLoop=(\d+) delta=(\d+)", logs)
    play_result_mark = "[DBG][H8] playMP3SPIFFS result=1"
    idx_play_result = logs.rfind(play_result_mark)
    i2s_after_play_result = 0
    if idx_play_result >= 0:
        i2s_after_play_result = len(
            re.findall(r"I2S: register I2S object to platform failed", logs[idx_play_result + len(play_result_mark) :])
        )

    # region agent log
    write_log(
        run_id,
        "H1",
        "debug_stackchan_audio_probe.py:121",
        "serial_audio_url_and_payload",
        {
            "chatError": chat_error,
            "serialLineCount": len(serial_lines),
            "serialTail": serial_lines[-20:],
            "payloadLengths": payload_lengths[-4:],
            "mp3UrlsTail": mp3_urls[-3:],
            "dbgUrl": dbg_url[-1] if dbg_url else None,
        },
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H2",
        "debug_stackchan_audio_probe.py:133",
        "serial_mp3_decoder_state",
        {
            "mp3BeginResults": dbg_begin[-3:],
            "loopFalseCounts": dbg_loop_false[-3:],
            "hasBuflenError": has_buflen_error,
            "buflenErrorCount": buflen_error_count,
        },
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H6",
        "debug_stackchan_audio_probe.py:speaker_updates",
        "speaker_update_count_delta",
        {"updateDelta": update_delta[-1] if update_delta else None},
    )
    # endregion

    # region agent log
    write_log(
        run_id,
        "H4",
        "debug_stackchan_audio_probe.py:145",
        "serial_i2s_state",
        {
            "hasI2sRegisterError": has_i2s_error,
            "i2sErrorCount": i2s_error_count,
            "i2sErrorAfterPlayResultCount": i2s_after_play_result,
            "speakerLifecycleLogged": "[DBG][H5] speaker.end + mic.begin done" in logs,
        },
    )
    # endregion

    bridge_journal, bridge_err = ansible_shell(f"journalctl -u stackchan-bridge --since '{since}' --no-pager")
    bridge_post_lines = [
        line for line in bridge_journal.splitlines() if "POST /api/stackchan/chat/simple" in line and " 200 " in line
    ]
    # region agent log
    write_log(
        run_id,
        "H5",
        "debug_stackchan_audio_probe.py:160",
        "bridge_confirmation",
        {
            "bridgePost200Count": len(bridge_post_lines),
            "bridgePost200Tail": bridge_post_lines[-3:],
            "bridgeJournalError": bridge_err,
        },
    )
    # endregion
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
