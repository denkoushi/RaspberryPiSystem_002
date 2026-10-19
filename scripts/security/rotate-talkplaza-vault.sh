#!/usr/bin/env bash
# Regenerate the TalkPlaza host_vars vault secrets and encrypt the three
# vault.yml files with ansible-vault. Prints no secret values.
#
# Background: until 2026-10-12 these files were tracked in plaintext in the
# public repository, so every value in them must be treated as leaked and
# replaced. The old values remain in git history; rotation is the remedy.
#
# Usage (from the repository root or a task worktree):
#   bash scripts/security/rotate-talkplaza-vault.sh [--vault-password-file PATH]
# Default password file: infrastructure/ansible/.vault-pass (ansible.cfg).
#
# Writes:
#   infrastructure/ansible/host_vars/talkplaza-pi5/vault.yml       (encrypted)
#   infrastructure/ansible/host_vars/talkplaza-pi4/vault.yml       (encrypted)
#   infrastructure/ansible/host_vars/talkplaza-signage01/vault.yml (encrypted)
# Key format follows scripts/security/rotate-client-key.sh:
#   client-key-<label>-<32 hex>. The kiosk status-agent/NFC pair and the
#   signage status-agent/display pair each share one ClientDevice credential.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ansible_dir="${repo_root}/infrastructure/ansible"
vault_pass="${ansible_dir}/.vault-pass"
if [[ "${1:-}" == "--vault-password-file" ]]; then
  vault_pass="${2:?missing path}"
fi
if [[ ! -r "${vault_pass}" ]]; then
  echo "vault password file not readable: ${vault_pass}" >&2
  exit 1
fi
command -v ansible-vault >/dev/null || { echo "ansible-vault not found" >&2; exit 1; }

hex() { openssl rand -hex "$1"; }
jwt_access="$(hex 32)"
jwt_refresh="$(hex 32)"
key_pi5="client-key-talkplaza-pi5-server-$(hex 16)"
key_pi4="client-key-talkplaza-pi4-kiosk01-$(hex 16)"
key_sig="client-key-talkplaza-signage01-$(hex 16)"

umask 077
write_vault() {
  local host="$1" content="$2"
  local target="${ansible_dir}/host_vars/${host}/vault.yml"
  printf '%s' "${content}" > "${target}"
  ansible-vault encrypt --vault-password-file "${vault_pass}" "${target}" >/dev/null
  if ! head -c 15 "${target}" | grep -q '^\$ANSIBLE_VAULT;'; then
    echo "encryption failed for ${target}" >&2
    exit 1
  fi
  echo "encrypted ${target#"${repo_root}"/}"
}

write_vault talkplaza-pi5 "# トークプラザ Pi5 シークレット（ansible-vault で暗号化。サンプルは vault.yml.example）
vault_talkplaza_api_jwt_access_secret: \"${jwt_access}\"
vault_talkplaza_api_jwt_refresh_secret: \"${jwt_refresh}\"
vault_talkplaza_pi5_status_agent_client_key: \"${key_pi5}\"
vault_talkplaza_slack_kiosk_support_webhook_url: \"\"
vault_talkplaza_alerts_dispatcher_enabled: \"true\"
vault_talkplaza_alerts_slack_webhook_deploy: \"\"
vault_talkplaza_alerts_slack_webhook_ops: \"\"
vault_talkplaza_alerts_slack_webhook_security: \"\"
vault_talkplaza_alerts_slack_webhook_support: \"\"
vault_talkplaza_dropbox_app_key: \"\"
vault_talkplaza_dropbox_app_secret: \"\"
vault_talkplaza_dropbox_refresh_token: \"\"
vault_talkplaza_dropbox_access_token: \"\"
"

write_vault talkplaza-pi4 "# トークプラザ Pi4 キオスク シークレット（ansible-vault で暗号化。サンプルは vault.yml.example）
# status-agent と NFC agent は同じ ClientDevice(talkplaza-pi4-kiosk01)
vault_talkplaza_pi4_status_agent_client_key: \"${key_pi4}\"
vault_talkplaza_nfc_agent_client_secret: \"${key_pi4}\"
"

write_vault talkplaza-signage01 "# トークプラザ サイネージ01 シークレット（ansible-vault で暗号化。サンプルは vault.yml.example）
# status-agent とサイネージ表示は同じ ClientDevice(talkplaza-signage01)
vault_talkplaza_signage01_status_agent_client_key: \"${key_sig}\"
vault_talkplaza_signage01_client_key: \"${key_sig}\"
"

echo "done. Next: apply on the hosts per docs/runbooks/security-hardening-remediation.md C-10."
