"""Pi 5 mobile-placement API クライアント（標準ライブラリのみ）。"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

LOG = logging.getLogger("haizen_agent.api_client")


@dataclass(frozen=True)
class HaizenScanResponse:
    status: int
    body: dict[str, Any] | None
    error_text: str | None


def post_haizen_scan(
    *,
    api_base_url: str,
    x_client_key: str,
    tls_skip_verify: bool,
    manufacturing_order_barcode_raw: str,
    distribution_number: int | None,
    raw_barcode: str | None,
    timeout_sec: float = 30.0,
) -> HaizenScanResponse:
    url = f"{api_base_url.rstrip('/')}/api/mobile-placement/haizen-scans"
    payload: dict[str, Any] = {
        "manufacturingOrderBarcodeRaw": manufacturing_order_barcode_raw,
    }
    if distribution_number is not None:
        payload["distributionNumber"] = distribution_number
    if raw_barcode is not None:
        payload["rawBarcode"] = raw_barcode

    data = json.dumps(payload).encode("utf-8")
    ctx = ssl.create_default_context()
    if tls_skip_verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-client-key": x_client_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                body = None
            return HaizenScanResponse(status=resp.status, body=body if isinstance(body, dict) else None, error_text=None)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        LOG.warning("haizen-scans HTTP %s: %s", e.code, err_body[:500])
        parsed: dict[str, Any] | None = None
        try:
            maybe = json.loads(err_body)
            if isinstance(maybe, dict):
                parsed = maybe
        except json.JSONDecodeError:
            pass
        return HaizenScanResponse(status=e.code, body=parsed, error_text=err_body[:2000])
    except Exception as exc:
        LOG.exception("haizen-scans request failed: %s", exc)
        return HaizenScanResponse(status=0, body=None, error_text=str(exc))
