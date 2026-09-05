#!/usr/bin/env bash
set -euo pipefail

# This is an opt-in host/container fixture for the standard release's first
# Business Hermes materialization boundary. It never contacts a Pi or a
# registry and uses only disposable dummy values.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMAGE="${BUSINESS_HERMES_ANSIBLE_IMAGE:-business-hermes-ansible:localtest}"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/business-hermes-ansible.XXXXXX")"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

if command -v docker >/dev/null 2>&1 && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  RUNNER=(docker run --rm
    -v "${ROOT_DIR}:/repo:ro"
    -v "${FIXTURE_DIR}:/fixture"
    -w /fixture
    "$IMAGE")
  PLAYBOOK_PATH=/fixture/playbook.yml
else
  if ! command -v ansible-playbook >/dev/null 2>&1 || [[ "$(id -u)" != 0 ]]; then
    echo "Business Hermes Ansible fixture requires ansible-playbook as root or ${IMAGE}." >&2
    exit 77
  fi
  RUNNER=(ansible-playbook)
  PLAYBOOK_PATH="${FIXTURE_DIR}/playbook.yml"
fi

mkdir -p "${FIXTURE_DIR}/source/infrastructure/docker" "${FIXTURE_DIR}/out" "${FIXTURE_DIR}/run"
cat >"${FIXTURE_DIR}/source/infrastructure/docker/.env" <<'EOF'
KEEP_EXISTING=managed
EOF

cat >"${FIXTURE_DIR}/playbook.yml" <<'EOF'
---
- name: Exercise the disposable Business Hermes runtime boundary
  hosts: localhost
  connection: local
  gather_facts: false
  vars:
    business_hermes_enabled: true
    business_hermes_provider: dgx
    business_hermes_api_key: fixture-business-api-key-0123456789
    business_hermes_dgx_token: fixture-dgx-token-0123456789
    business_hermes_model: system-prod-primary
    business_hermes_image: nousresearch/hermes-agent:fixture@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    business_hermes_egress_image: node:20-alpine@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    api_business_hermes_base_url: http://business-hermes:8642
    api_business_hermes_api_key: fixture-business-api-key-0123456789
    api_business_hermes_model: system-prod-primary
    api_business_hermes_timeout_ms: 8000
    business_hermes_runtime_env_file: /fixture/out/runtime.env
    business_hermes_candidate_env_file: /fixture/out/compose.env
    business_hermes_config_file: /fixture/out/config.yaml
    business_hermes_config_template: /repo/infrastructure/ansible/templates/business-hermes-config.yaml.j2
    business_hermes_config_repo_path: /fixture/source
    business_hermes_backup_dir: /fixture/run
    business_hermes_backup_env_files: true
    business_hermes_sync_candidate_env: true
    release_pi5_business_hermes_existing_running: false
  tasks:
    - name: Materialize the disposable Business Hermes runtime
      ansible.builtin.include_tasks: /repo/infrastructure/ansible/tasks/business-hermes-runtime.yml

    - name: Check the generated disposable runtime files
      ansible.builtin.stat:
        path: "{{ item }}"
      loop:
        - /fixture/out/runtime.env
        - /fixture/out/compose.env
        - /fixture/out/config.yaml
      register: generated_files
      no_log: true

    - name: Verify generated files and concrete model configuration
      ansible.builtin.assert:
        that:
          - generated_files.results | map(attribute='stat.exists') | list | unique == [true]
          - generated_files.results[0].stat.mode == '0600'
          - generated_files.results[1].stat.mode == '0600'
          - generated_files.results[2].stat.mode == '0644'
          - "'system-prod-primary' in lookup('file', '/fixture/out/config.yaml')"
          - "'max_tokens: 512' in lookup('file', '/fixture/out/config.yaml')"
      no_log: true

    - name: Remove the disposable generated files through the production rollback task
      block:
        - ansible.builtin.include_tasks: /repo/infrastructure/ansible/roles/release_pi5/tasks/rollback.yml
      rescue:
        - ansible.builtin.set_fact:
            rollback_preserved_original_failure: true
      vars:
        release_pi5_compose_environment: {PI5_ENV_FILE: /fixture/out/compose.env}
        release_pi5_rollback_compose_environment: {PI5_ENV_FILE: /fixture/out/compose.env}
        release_pi5_compose_argv: [docker, compose]
        release_pi5_switch_attempted: false
        release_pi5_handoff_attempted: false

    - name: Verify rollback removed only newly materialized Business Hermes files
      ansible.builtin.stat:
        path: "{{ item }}"
      loop:
        - /fixture/out/runtime.env
        - /fixture/out/compose.env
        - /fixture/out/config.yaml
      register: rollback_files
      no_log: true

    - name: Assert disposable rollback cleanup
      ansible.builtin.assert:
        that:
          - rollback_files.results | map(attribute='stat.exists') | list | unique == [false]
      no_log: true
EOF

"${RUNNER[@]}" ansible-playbook -i localhost, "$PLAYBOOK_PATH"
echo "business-hermes runtime Ansible fixture passed"
