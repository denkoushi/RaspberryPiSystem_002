#!/usr/bin/env python3
"""Resolve the opt-in server Compose overlay and check deployment admission."""

from __future__ import annotations

import argparse
import ipaddress
import json
from pathlib import Path
import subprocess
import sys
from typing import Sequence


class ReplicationContractError(RuntimeError):
    pass


def resolve_server_compose(
    project_dir: Path, base: Sequence[str], *, mode: str = "auto"
) -> list[str]:
    """Keep the original argv byte-for-byte without a marker.

    apply/remove explicitly select the destination model during their transition;
    every ordinary consumer uses auto. primary.env contains only the saved IPs.
    """
    marker = project_dir / "config/pi5-replication-primary"
    argv = list(base)
    marked = marker.exists() or marker.is_symlink()
    if mode == "base" or (mode == "auto" and not marked):
        return argv
    compose_dir = project_dir / "infrastructure/docker"
    overlay = compose_dir / "docker-compose.replication-primary.yml"
    required = [overlay, compose_dir / "postgres/replication-primary-pg_hba.conf"]
    if mode == "auto":
        required.append(marker / "primary.env")
    if any(not path.is_file() for path in required):
        raise ReplicationContractError("Replication marker/configuration is incomplete; deployment stopped")
    if mode == "auto":
        try:
            values = dict(line.split("=", 1) for line in (marker / "primary.env").read_text().splitlines())
            if set(values) != {"PI5_REPLICATION_PRIMARY_IP", "PI5_REPLICATION_STANDBY_IP"}:
                raise ValueError("unexpected keys")
            ips = [ipaddress.IPv4Address(value) for value in values.values()]
            if len(set(ips)) != 2 or not all(ip in ipaddress.IPv4Network("100.64.0.0/10") for ip in ips):
                raise ValueError("unexpected addresses")
        except (OSError, ValueError):
            raise ReplicationContractError("Replication address marker is incomplete; deployment stopped") from None
        argv += ["--env-file", str(marker / "primary.env")]
    return [*argv, "-f", str(overlay)]


def _read_command(argv: Sequence[str]) -> str:
    result = subprocess.run(argv, capture_output=True, text=True, check=False)
    if result.returncode:
        # Neither Compose diagnostics/models nor SQL diagnostics may expose secrets.
        raise ReplicationContractError("Replication deployment check failed; inspect configuration/runtime")
    return result.stdout.strip()


def check_runtime(project_dir: Path, argv: Sequence[str]) -> None:
    marker = project_dir / "config/pi5-replication-primary"
    if not (marker.exists() or marker.is_symlink()):
        # Without the marker the standard deployment must behave exactly as before:
        # no Compose model reads, no docker exec, no new dependency on a running db.
        return
    model = json.loads(_read_command([*argv, "config", "--format", "json"]))
    db = model["services"]["db"]
    # Inspect only paths. Never open password files or require the one-shot
    # replication bootstrap password to remain on disk after apply.
    target = db["environment"].get("POSTGRES_PASSWORD_FILE")
    sources = [v["source"] for v in db.get("volumes", [])
               if v.get("type") == "bind" and v.get("target") == target]
    if not target or len(sources) != 1 or not Path(sources[0]).is_file():
        raise ReplicationContractError("Required database secret file is missing; deployment stopped")
    cid = _read_command([*argv, "ps", "-q", "db"])
    if not cid or len(cid.splitlines()) != 1:
        raise ReplicationContractError("Require one running primary db before deployment")
    query = """SELECT json_build_object(
      'primary', NOT pg_is_in_recovery(),
      'wal_level', current_setting('wal_level'),
      'max_wal_senders', current_setting('max_wal_senders'),
      'max_replication_slots', current_setting('max_replication_slots'),
      'max_slot_wal_keep_size', pg_size_bytes(current_setting('max_slot_wal_keep_size')),
      'synchronous_standby_names', current_setting('synchronous_standby_names'),
      'hba_file', current_setting('hba_file'),
      'pending', EXISTS(SELECT FROM pg_settings WHERE pending_restart AND name IN
        ('wal_level','max_wal_senders','max_replication_slots','max_slot_wal_keep_size',
         'synchronous_standby_names','hba_file')))"""
    state = json.loads(_read_command([
        "docker", "exec", "-u", "postgres", cid, "psql", "-XqAt",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query,
    ]))
    settings_match = all(state.get(k) == v for k, v in {
        "wal_level": "replica", "max_wal_senders": "4", "max_replication_slots": "4",
        "max_slot_wal_keep_size": 1073741824, "synchronous_standby_names": "",
    }.items())
    managed_hba = state.get("hba_file") == "/var/lib/postgresql/18/docker/replication-primary-pg_hba.conf"
    if not state.get("primary") or state.get("pending") or not (settings_match and managed_hba):
        raise ReplicationContractError("Replication marker and running db disagree; deployment stopped")
    _read_command(["docker", "exec", "-u", "postgres", cid,
                   "test", "-f", state["hba_file"]])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("auto", "base", "apply"), default="auto")
    parser.add_argument("--check-runtime", action="store_true")
    parser.add_argument("--lines", action="store_true")
    parser.add_argument("base", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    base = args.base[1:] if args.base[:1] == ["--"] else args.base
    argv = resolve_server_compose(args.project_dir, base, mode=args.mode)
    if args.check_runtime:
        check_runtime(args.project_dir, argv)
    print("\n".join(argv) if args.lines else json.dumps(argv))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReplicationContractError, OSError, ValueError, KeyError) as exc:
        # Do not echo exception data derived from resolved models.
        message = str(exc) if isinstance(exc, ReplicationContractError) else "Invalid replication configuration/runtime"
        print(message, file=sys.stderr)
        raise SystemExit(78)
