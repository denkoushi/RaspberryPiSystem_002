#!/bin/zsh
# Runs run_jev.mjs with the TypeSafe key from the Pi5 Vault; never prints the key.
# Usage: run.sh <manifest.jsonl> <results.jsonl> <instructions.txt> [--concurrency N]
HERE=${0:a:h}
cd "$(git -C "$HERE" rev-parse --show-toplevel)/infrastructure/ansible" || exit 1
KEY=$(ansible-vault view host_vars/raspberrypi5/vault.yml | awk '/typesafe_api_key/{print $2}' | tr -d "\"'")
[[ ${#KEY} -ge 16 ]] || { echo "key missing"; exit 1; }
cd "$HERE" && TYPESAFE_API_KEY=$KEY exec node run_jev.mjs "$@"
