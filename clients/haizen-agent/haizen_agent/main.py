"""エントリ: HID / stdin から確定行を読み、配膳 API へ POST。"""

from __future__ import annotations

import logging
import sys

from haizen_agent.api_client import post_haizen_scan
from haizen_agent.classifier import DistributionToken, ManufacturingOrderToken, classify_scan_line
from haizen_agent.config import load_haizen_config
from haizen_agent.distribution_gate import DistributionGate
from haizen_agent.hid_wedge import iter_scan_lines

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stderr,
)
LOG = logging.getLogger("haizen_agent.main")


def main() -> None:
    cfg = load_haizen_config()
    gate = DistributionGate()
    LOG.info(
        "haizen-agent start base=%s hid=%s tls_verify_mode=%s",
        cfg.api_base_url,
        cfg.hid_device or "stdin",
        cfg.tls_verify_mode,
    )

    for line in iter_scan_lines(cfg.hid_device):
        try:
            token = classify_scan_line(line)
        except ValueError:
            continue

        if isinstance(token, DistributionToken):
            gate.set_next_distribution(token.value)
            LOG.info("distribution queued for next order: %s", token.value)
            continue

        if isinstance(token, ManufacturingOrderToken):
            dist = gate.take_for_manufacturing_order_scan()
            res = post_haizen_scan(
                api_base_url=cfg.api_base_url,
                x_client_key=cfg.x_client_key,
                tls_skip_verify=cfg.tls_skip_verify,
                manufacturing_order_barcode_raw=token.raw,
                distribution_number=dist,
                raw_barcode=token.raw,
            )
            if res.status == 200 and res.body:
                LOG.info(
                    "haizen OK order=%s dist=%s resolution=%s",
                    token.raw,
                    dist,
                    res.body.get("resolutionStatus"),
                )
            else:
                LOG.error(
                    "haizen FAIL order=%s dist=%s status=%s err=%s",
                    token.raw,
                    dist,
                    res.status,
                    res.error_text or res.body,
                )


if __name__ == "__main__":
    main()
