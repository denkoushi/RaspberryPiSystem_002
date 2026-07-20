"""Build the secret-free terminal release preflight contract.

Inventory resolution remains on the trusted operator host.  This module emits
only host routing, feature flags, and non-secret baseline requirements for the
read-only Pi5 preflight; client keys and other inventory secrets never cross
that boundary.
"""
from __future__ import annotations

import ipaddress
import re
from collections.abc import Iterable, Mapping
from typing import Any

from .adapter_registry import adapter_for_profile


_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_VARIABLE_TEMPLATE_RE = re.compile(r"^\s*{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}\s*$")
_UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.(?:service|timer|socket|path|target|mount)$"
)
_SAFE_HID_LINK_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,126}-event-kbd$")
_HEX4_RE = re.compile(r"^[0-9a-f]{4}$")
_MAC_RE = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$")


class TerminalPreflightContractError(ValueError):
    """A selected inventory host cannot form a safe preflight contract."""


def _boolean(value: Any, *, default: bool = False) -> bool:
    if value is None:
        return default
    if type(value) is not bool:
        raise TerminalPreflightContractError("terminal boolean inventory value is malformed")
    return value


def _safe_path(value: Any, *, name: str, default: str | None = None) -> str:
    candidate = default if value is None else value
    if (
        not isinstance(candidate, str)
        or not candidate.startswith("/")
        or "\x00" in candidate
        or "/../" in candidate
        or candidate.endswith("/..")
        or len(candidate) > 4096
    ):
        raise TerminalPreflightContractError(f"{name} is not a safe absolute path")
    return candidate


def _safe_text(value: Any, *, name: str, default: str, maximum: int = 512) -> str:
    candidate = default if value is None else value
    if (
        not isinstance(candidate, str)
        or not candidate
        or "\x00" in candidate
        or len(candidate) > maximum
        or any(ord(character) < 32 and character not in "\t" for character in candidate)
    ):
        raise TerminalPreflightContractError(f"{name} is malformed")
    return candidate


def _resolve_address(values: Mapping[str, Any], host: str) -> str:
    raw = values.get("ansible_host")
    seen_variables: set[str] = set()
    while isinstance(raw, str):
        variable_match = _VARIABLE_TEMPLATE_RE.fullmatch(raw)
        if variable_match is None:
            break
        variable_name = variable_match.group(1)
        if variable_name in seen_variables:
            break
        seen_variables.add(variable_name)
        raw = values.get(variable_name)

    if isinstance(raw, str) and "{{" not in raw:
        candidate = raw
    else:
        mode = values.get("network_mode", "tailscale")
        network_name = "local_network" if mode == "local" else "tailscale_network"
        network = values.get(network_name)
        fallback = values.get("local_network")
        key_match = re.search(r"current_network\.([A-Za-z0-9_]+)", raw or "")
        key = key_match.group(1) if key_match else None
        candidate = network.get(key) if isinstance(network, dict) and key else None
        if not candidate and isinstance(fallback, dict) and key:
            candidate = fallback.get(key)
    if not isinstance(candidate, str) or not candidate or len(candidate) > 255:
        raise TerminalPreflightContractError(f"{host} has no resolved preflight address")
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        if _HOST_RE.fullmatch(candidate) is None:
            raise TerminalPreflightContractError(
                f"{host} has an unsafe preflight address"
            ) from None
    return candidate


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _bounded_int(
    value: Any, *, name: str, default: int, minimum: int, maximum: int
) -> int:
    candidate = default if value is None else value
    if type(candidate) is not int or not minimum <= candidate <= maximum:
        raise TerminalPreflightContractError(f"{name} is malformed")
    return candidate


def _torque_contract_valid(values: Mapping[str, Any]) -> bool:
    if not all(
        _nonempty(values.get(key))
        for key in ("torque_agent_client_key", "torque_agent_api_base_url")
    ):
        return False
    adapter = values.get("torque_agent_bluetooth_adapter")
    devices = values.get("torque_agent_hid_devices")
    links = values.get("torque_agent_hid_links")
    if (
        not isinstance(adapter, dict)
        or _HEX4_RE.fullmatch(str(adapter.get("usb_vendor_id", ""))) is None
        or _HEX4_RE.fullmatch(str(adapter.get("usb_product_id", ""))) is None
        or not isinstance(devices, list)
        or not devices
        or not isinstance(links, list)
        or not links
    ):
        return False
    device_paths = set()
    for device in devices:
        if not isinstance(device, dict):
            return False
        path = device.get("path")
        if (
            not isinstance(path, str)
            or not path.startswith("/dev/input/by-id/")
            or device.get("parserProfile") != "cem3-btla-hogp-v1"
        ):
            return False
        device_paths.add(path)
    for link in links:
        if not isinstance(link, dict):
            return False
        link_name = link.get("link_name")
        if (
            not isinstance(link_name, str)
            or _SAFE_HID_LINK_RE.fullmatch(link_name) is None
            or not _nonempty(link.get("name"))
            or _MAC_RE.fullmatch(str(link.get("uniq", ""))) is None
            or _HEX4_RE.fullmatch(str(link.get("vendor_id", ""))) is None
            or _HEX4_RE.fullmatch(str(link.get("product_id", ""))) is None
            or f"/dev/input/by-id/{link_name}" not in device_paths
        ):
            return False
    return True


def _restart_units(values: Mapping[str, Any]) -> list[str]:
    raw = values.get("services_to_restart", ["status-agent.service", "status-agent.timer"])
    if not isinstance(raw, list) or any(
        not isinstance(unit, str) or _UNIT_RE.fullmatch(unit) is None for unit in raw
    ):
        raise TerminalPreflightContractError("services_to_restart is malformed")
    return list(dict.fromkeys(raw))


def build_target_contracts(
    inventory: Mapping[str, Any], targets: Iterable[Mapping[str, str]]
) -> list[dict[str, Any]]:
    """Return deterministic, secret-free target contracts in rollout order."""

    metadata = inventory.get("_meta")
    hostvars = metadata.get("hostvars") if isinstance(metadata, dict) else None
    if not isinstance(hostvars, dict):
        raise TerminalPreflightContractError("inventory hostvars are unavailable")

    contracts: list[dict[str, Any]] = []
    for target in targets:
        host = target.get("host")
        profile = target.get("role") or target.get("terminalType")
        if (
            not isinstance(host, str)
            or _HOST_RE.fullmatch(host) is None
            or profile not in {"kiosk", "signage"}
        ):
            raise TerminalPreflightContractError("terminal target identity is malformed")
        values = hostvars.get(host)
        if not isinstance(values, dict):
            raise TerminalPreflightContractError(f"{host} has no inventory hostvars")
        user = values.get("ansible_user")
        if not isinstance(user, str) or _USER_RE.fullmatch(user) is None:
            raise TerminalPreflightContractError(f"{host} has an unsafe ansible_user")
        port = values.get("ansible_port", 22)
        if type(port) is not int or not 1 <= port <= 65535:
            raise TerminalPreflightContractError(f"{host} has an unsafe ansible_port")

        nfc_enabled = "nfc_agent_client_id" in values
        barcode_enabled = _boolean(values.get("barcode_agent_enabled"))
        torque_enabled = _boolean(values.get("torque_agent_enabled"))
        torque_adapter = values.get("torque_agent_bluetooth_adapter")
        torque_vendor_id = (
            str(torque_adapter.get("usb_vendor_id", ""))
            if isinstance(torque_adapter, dict)
            else ""
        )
        torque_product_id = (
            str(torque_adapter.get("usb_product_id", ""))
            if isinstance(torque_adapter, dict)
            else ""
        )
        haizen_enabled = _boolean(values.get("haizen_agent_enabled"))
        manage_kiosk = _boolean(values.get("manage_kiosk_browser"))
        manage_signage = _boolean(values.get("manage_signage_lite"))
        browser_engine = _safe_text(
            values.get("kiosk_browser_engine"),
            name="kiosk_browser_engine",
            default="chromium",
            maximum=32,
        ).lower()

        inventory_issues: list[str] = []
        if nfc_enabled and not all(
            _nonempty(values.get(key))
            for key in ("nfc_agent_client_id", "nfc_agent_client_secret")
        ):
            inventory_issues.append("inventory.nfc-contract")
        if torque_enabled and not _torque_contract_valid(values):
            inventory_issues.append("inventory.torque-contract")
        if manage_kiosk and browser_engine not in {"chromium", "firefox"}:
            inventory_issues.append("inventory.kiosk-browser-engine")
        nfc_contract_valid = "inventory.nfc-contract" not in inventory_issues
        torque_contract_valid = "inventory.torque-contract" not in inventory_issues
        runtime_manifest_contract = adapter_for_profile(
            profile, runtime=None
        ).runtime_manifest_contract.as_preflight_payload()

        contracts.append(
            {
                "version": 1,
                "mode": "target",
                "host": host,
                "profile": profile,
                "address": _resolve_address(values, host),
                "user": user,
                "port": port,
                "repoPath": _safe_path(
                    values.get("repo_path"), name="repo_path", default="/opt/RaspberryPiSystem_002"
                ),
                "memoryRequiredMb": _bounded_int(
                    values.get("memory_required_mb"),
                    name="memory_required_mb",
                    default=120,
                    minimum=1,
                    maximum=65536,
                ),
                "tailscaleEnabled": _boolean(values.get("tailscale_enabled")),
                "servicesToRestart": _restart_units(values),
                "manageKioskBrowser": manage_kiosk,
                "kioskBrowserEngine": browser_engine,
                "firefoxMinimizeChrome": _boolean(
                    values.get("kiosk_firefox_minimize_chrome_enabled"), default=True
                ),
                "clamavEnabled": _boolean(values.get("clamav_kiosk_enabled")),
                "clamavLogDir": _safe_path(
                    values.get("clamav_kiosk_log_dir"),
                    name="clamav_kiosk_log_dir",
                    default="/var/log/clamav",
                ),
                "clamavCron": _safe_text(
                    values.get("clamav_kiosk_scan_cron"),
                    name="clamav_kiosk_scan_cron",
                    default="0 3 * * 0",
                ),
                "rkhunterEnabled": _boolean(values.get("rkhunter_kiosk_enabled")),
                "rkhunterLogDir": _safe_path(
                    values.get("rkhunter_kiosk_log_dir"),
                    name="rkhunter_kiosk_log_dir",
                    default="/var/log/rkhunter",
                ),
                "rkhunterCron": _safe_text(
                    values.get("rkhunter_kiosk_cron"),
                    name="rkhunter_kiosk_cron",
                    default="30 3 * * 0",
                ),
                "nfcEnabled": nfc_enabled,
                "nfcContractValid": nfc_contract_valid,
                "barcodeEnabled": barcode_enabled,
                "barcodeSerialDevice": _safe_path(
                    values.get("barcode_agent_serial_device"),
                    name="barcode_agent_serial_device",
                    default="/dev/ttyACM0",
                ),
                "torqueEnabled": torque_enabled,
                "torqueContractValid": torque_contract_valid,
                "torqueUsbVendorId": torque_vendor_id,
                "torqueUsbProductId": torque_product_id,
                "haizenEnabled": haizen_enabled,
                "haizenHidDevice": _safe_path(
                    values.get("haizen_agent_hid_device"),
                    name="haizen_agent_hid_device",
                    default="/dev/input/event0",
                ),
                "haizenInstallEvdev": _boolean(
                    values.get("haizen_agent_install_evdev"), default=True
                ),
                "manageSignage": manage_signage,
                "inventoryIssues": inventory_issues,
                "runtimeManifestContract": runtime_manifest_contract,
            }
        )
    return contracts
