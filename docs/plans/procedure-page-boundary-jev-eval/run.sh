#!/bin/zsh
# Runs the eval with the TypeSafe key from the Pi5 Vault; never prints the key.
HERE=${0:a:h}
cd "$(git -C "$HERE" rev-parse --show-toplevel)/infrastructure/ansible" || exit 1
KEY=$(ansible-vault view host_vars/raspberrypi5/vault.yml | awk '/typesafe_api_key/{print $2}' | tr -d "\"'")
[[ ${#KEY} -ge 16 ]] || { echo "key missing"; exit 1; }
TYPESAFE_API_KEY=$KEY exec node "$HERE/jev-page-boundary-eval.mjs" "$@"
