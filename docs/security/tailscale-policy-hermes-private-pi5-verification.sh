#!/usr/bin/env bash
# Run on private Pi5 (raspi5-private) after Tailscale ACL merge.
# Usage: sudo -u raspi5-private bash docs/security/tailscale-policy-hermes-private-pi5-verification.sh
set -euo pipefail

DGX_IP="${DGX_IP:-100.118.82.72}"
BIZ_PI5_IP="${BIZ_PI5_IP:-100.106.158.2}"

echo "== tailscale self =="
tailscale status --json | python3 -c "import sys,json; s=json.load(sys.stdin)['Self']; print('tags', s.get('Tags')); print('ips', s.get('TailscaleIPs'))"

echo "== allow: DGX healthz =="
curl -sf -o /dev/null -w "dgx_healthz=%{http_code}\n" "http://${DGX_IP}:38081/healthz"

echo "== deny probe: business Pi5 :443 (expect fail/timeout) =="
if curl -sf -o /dev/null -w "biz_pi5_443=%{http_code}\n" --connect-timeout 3 "http://${BIZ_PI5_IP}:443/" 2>/dev/null; then
  echo "WARN: reached business Pi5 — review ACL"
  exit 1
else
  echo "biz_pi5_443=blocked_or_timeout (ok)"
fi

echo "== Hermes bearer (optional; needs ~/.hermes/.env) =="
if sudo -u hermes test -f /home/hermes/.hermes/.env; then
  sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; set +a; curl -sf -o /dev/null -w "hermes_bearer=%{http_code}\n" -H "Authorization: Bearer $OPENAI_API_KEY" http://'"${DGX_IP}"':38081/v1/models'
fi

echo "OK"
