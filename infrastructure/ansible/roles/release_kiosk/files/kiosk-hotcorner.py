#!/usr/bin/env python3
"""Own the temporary kiosk panel; Xwayland failure is recovered by systemd."""

import ctypes
import ctypes.util
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


BUTTON_MASK = sum(1 << bit for bit in range(8, 13))


class PanelPolicy:
    """Pure decision state: timestamps are monotonic seconds, buttons an X mask."""

    def __init__(self):
        self.corner_since = None
        self.corner_armed = True
        self.shown_at = None

    def decide(self, x, y, buttons, now, panel_running, show_requested=False):
        corner = x is not None and y is not None and 0 <= x <= 3 and 0 <= y <= 3
        if not corner:
            self.corner_since = None
            self.corner_armed = True
        if panel_running:
            self.corner_since = None
            if self.shown_at is None:
                self.shown_at = now
            if (y is not None and y >= 80 and buttons & BUTTON_MASK) or now - self.shown_at >= 900:
                self.shown_at = None
                return "hide"
            return None
        self.shown_at = None
        if corner and self.corner_armed and self.corner_since is None:
            self.corner_since = now
        if show_requested or (corner and self.corner_armed and now - self.corner_since >= 0.3):
            self.corner_armed = False
            self.corner_since = None
            self.shown_at = now
            return "show"
        return None


def wayland_environment():
    env = os.environ.copy()
    runtime = Path(env.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    sockets = sorted(path for path in runtime.glob("wayland-*") if stat.S_ISSOCK(path.stat().st_mode))
    if not sockets:
        raise RuntimeError(f"No Wayland socket in {runtime}")
    env["XDG_RUNTIME_DIR"] = str(runtime)
    env["WAYLAND_DISPLAY"] = sockets[0].name
    env["DBUS_SESSION_BUS_ADDRESS"] = env.get("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")
    return env


def labwc_pid(proc_root=Path("/proc")):
    """labwc --reconfigure signals $LABWC_PID, which only the session sets."""
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            if (entry / "comm").read_text().strip() == "labwc":
                return int(entry.name)
        except OSError:
            continue
    raise RuntimeError("No labwc process for this user")


class XPointer:
    def __init__(self):
        self.lib = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
        self.lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.lib.XOpenDisplay.restype = ctypes.c_void_p
        self.lib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        self.lib.XDefaultRootWindow.restype = ctypes.c_ulong
        self.lib.XQueryPointer.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong,
            ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_uint),
        ]
        self.lib.XQueryPointer.restype = ctypes.c_int
        self.lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.lib.XCloseDisplay.restype = ctypes.c_int
        # Xlib's default fatal I/O handler logs and exits nonzero on disconnect.
        self.display = self.lib.XOpenDisplay(os.environ.get("DISPLAY", ":0").encode())
        if not self.display:
            raise RuntimeError("Cannot open X display")
        self.root = self.lib.XDefaultRootWindow(self.display)

    def query(self):
        root, child = ctypes.c_ulong(), ctypes.c_ulong()
        x, y, wx, wy = (ctypes.c_int() for _ in range(4))
        mask = ctypes.c_uint()
        same_screen = self.lib.XQueryPointer(
            self.display, self.root, ctypes.byref(root), ctypes.byref(child),
            ctypes.byref(x), ctypes.byref(y), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask),
        )
        # Wayland popups may leave the pointer outside the X screen. Never use
        # those coordinates/buttons to hide a password dialog.
        return (x.value, y.value, mask.value) if same_screen else (None, None, 0)

    def close(self):
        self.lib.XCloseDisplay(self.display)


def panel_processes(proc_root=Path("/proc")):
    respawners, panels = [], []
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            argv = (entry / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
            # lwrespawn is a shell script, so its argv is "/bin/sh /usr/bin/lwrespawn ...".
            if os.path.basename(argv[0]) in (b"sh", b"dash", b"bash") and len(argv) > 1:
                argv = argv[1:]
            executable = os.path.basename(argv[0])
            if executable == b"lwrespawn" and len(argv) > 1 and os.path.basename(argv[1]) == b"wf-panel-pi":
                respawners.append(int(entry.name))
            elif executable == b"wf-panel-pi":
                panels.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return respawners, panels


def terminate_pid(pid, sig=signal.SIGTERM):
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass


def remove_foreign_panels(owned_pid):
    respawners, _ = panel_processes()
    for pid in respawners:
        terminate_pid(pid)
    if respawners:
        # Stop the supervisor before its child so it cannot replace the child.
        deadline = time.monotonic() + 0.5
        remaining = respawners
        while remaining and time.monotonic() < deadline:
            time.sleep(0.05)
            current, _ = panel_processes()
            remaining = [pid for pid in remaining if pid in current]
        for pid in remaining:
            terminate_pid(pid, signal.SIGKILL)
    _, panels = panel_processes()
    for pid in panels:
        if pid != owned_pid:
            terminate_pid(pid)


class PanelDaemon:
    def __init__(self):
        self.policy = PanelPolicy()
        self.panel = None
        self.show_requested = False
        self.stopping = False

    def request_show(self, _signum=None, _frame=None):
        self.show_requested = True

    def request_stop(self, _signum=None, _frame=None):
        self.stopping = True

    def hide(self):
        if self.panel is not None and self.panel.poll() is None:
            self.panel.terminate()
            try:
                self.panel.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.panel.kill()
                self.panel.wait()
            print("panel hidden", flush=True)
        self.panel = None

    def step(self, x, y, buttons, now):
        running = self.panel is not None and self.panel.poll() is None
        requested, self.show_requested = self.show_requested, False
        action = self.policy.decide(x, y, buttons, now, running, requested)
        if action == "show":
            self.panel = subprocess.Popen(
                ["/usr/bin/wf-panel-pi"], env=wayland_environment(),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            print("panel shown", flush=True)
        elif action == "hide":
            self.hide()

    def run(self):
        signal.signal(signal.SIGUSR1, self.request_show)
        signal.signal(signal.SIGTERM, self.request_stop)
        signal.signal(signal.SIGINT, self.request_stop)
        pointer = XPointer()
        next_cleanup = 0
        try:
            while not self.stopping:
                now = time.monotonic()
                if now >= next_cleanup:
                    owned_pid = self.panel.pid if self.panel is not None and self.panel.poll() is None else None
                    remove_foreign_panels(owned_pid)
                    next_cleanup = now + 5
                self.step(*pointer.query(), time.monotonic())
                time.sleep(0.1)
        finally:
            self.hide()
            pointer.close()


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--reconfigure"]:
            env = wayland_environment()
            env["LABWC_PID"] = str(labwc_pid())
            subprocess.run(["/usr/bin/labwc", "--reconfigure"], env=env, check=True)
        elif not sys.argv[1:]:
            PanelDaemon().run()
        else:
            raise RuntimeError("Usage: kiosk-hotcorner.py [--reconfigure]")
    except Exception as exc:
        print(f"kiosk-hotcorner: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
