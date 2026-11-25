#!/usr/bin/env bash
set -euo pipefail

# 運用者が手で流す確認スクリプトは、既定で TLS 検証あり。
# VERIFY_ALLOW_INSECURE_TLS=1 のときだけ -k を付ける。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

SCRIPTS=(
  scripts/deploy/verify-phase12-real.sh
  scripts/deploy/verify-services-real.sh
  scripts/test/verify-signage-layout-config.sh
  scripts/test/verify-signage-display.sh
  scripts/test/security-e2e.sh
)

for rel in "${SCRIPTS[@]}"; do
  path="${ROOT_DIR}/${rel}"
  bash -n "$path"
  if grep -En 'curl[^|]*(-k([[:space:]]|")|-sk|--insecure)' "$path" >&2; then
    fail "${rel} passes -k directly to curl"
  fi
  grep -Fq 'VERIFY_ALLOW_INSECURE_TLS' "$path" || fail "${rel} lacks the VERIFY_ALLOW_INSECURE_TLS opt-in"
done

# 組み立て部分(空行まで)だけを取り出して既定と opt-in の結果を確かめる
extract_block() {
  awk -v start="$2" 'index($0, start)==1 {on=1} on && $0=="" {exit} on {print}' "$1"
}
for rel in scripts/deploy/verify-phase12-real.sh scripts/deploy/verify-services-real.sh scripts/test/security-e2e.sh; do
  block="$(extract_block "${ROOT_DIR}/${rel}" 'CURL_TLS_ARGS=()')"
  default="$(env -u VERIFY_ALLOW_INSECURE_TLS -u VERIFY_CA_CERT bash -c "set -u; ${block}; echo \"[\${CURL_TLS_ARGS[*]-}]\"")"
  [ "$default" = "[]" ] || fail "${rel} adds curl TLS args by default: ${default}"
  optin="$(VERIFY_ALLOW_INSECURE_TLS=1 bash -c "set -u; ${block}; echo \"[\${CURL_TLS_ARGS[*]-}]\"")"
  [ "$optin" = "[-k]" ] || fail "${rel} opt-in result unexpected: ${optin}"
done

for rel in scripts/test/verify-signage-layout-config.sh scripts/test/verify-signage-display.sh; do
  block="$(extract_block "${ROOT_DIR}/${rel}" 'CURL_TLS_OPTS=""')"
  default="$(env -u VERIFY_ALLOW_INSECURE_TLS -u VERIFY_CA_CERT bash -c "set -u; ${block}; echo \"[\${CURL_TLS_OPTS}]\"")"
  [ "$default" = "[]" ] || fail "${rel} adds curl TLS opts by default: ${default}"
  optin="$(VERIFY_ALLOW_INSECURE_TLS=1 bash -c "set -u; ${block}; echo \"[\${CURL_TLS_OPTS}]\"")"
  [ "$optin" = "[-k]" ] || fail "${rel} opt-in result unexpected: ${optin}"
done

printf 'operator scripts TLS default contract passed\n'
