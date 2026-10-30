"""Minimal systemd notification support."""

import os
import socket


def sd_notify(message):
    address = os.environ.get("NOTIFY_SOCKET")
    if not address:
        return
    if address.startswith("@"):
        address = "\0" + address[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.settimeout(1)
            sock.connect(address)
            sock.sendall(message.encode("utf-8"))
    except OSError:
        pass


def watchdog_interval():
    try:
        seconds = int(os.environ.get("WATCHDOG_USEC", "60000000")) / 1000000
    except ValueError:
        seconds = 60
    return min(30.0, seconds / 2) if seconds > 0 else 30.0
