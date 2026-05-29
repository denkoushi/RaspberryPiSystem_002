#!/usr/bin/env python3
"""
Keep DGX system-prod runtime warm for Hermes Discord (private Pi5).

Probes GET /v1/models first; calls POST /start only when cold.
Intended for systemd timer / oneshot — see infrastructure/ansible templates.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Repo layout: this file lives beside dgx_runtime_client.py on the Pi5 host.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dgx_runtime_client import DgxUpstreamClient, config_from_env  # noqa: E402


def main() -> int:
    client = DgxUpstreamClient(config_from_env())
    ok, details = client.warm_runtime()
    print(json.dumps({"ok": ok, **details}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
