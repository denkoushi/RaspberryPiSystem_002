"""Capture one native MJPEG frame without processing or disk storage."""

import subprocess

MAX_FRAME_BYTES = 300 * 1024


def capture(device, run=subprocess.run):
    result = run([
        "v4l2-ctl", "--device", device,
        "--set-fmt-video=width=640,height=480,pixelformat=MJPG",
        "--stream-mmap", "--stream-skip=3", "--stream-count=1", "--stream-to=-",
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=True)
    frame = result.stdout
    if len(frame) > MAX_FRAME_BYTES:
        raise ValueError("JPEG exceeds 300KB")
    end = frame.rfind(b"\xff\xd9")
    if not frame.startswith(b"\xff\xd8\xff") or end == -1:
        raise ValueError("Invalid JPEG")
    return frame[:end + 2]
