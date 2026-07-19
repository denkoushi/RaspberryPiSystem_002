---
id: client-agent-addition
title: Client Docker Agent Addition Runbook
status: active
scope: Terminal client-agent contract wiring
date: 2026-07-19
source_of_truth: docs/runbooks/client-agent-addition.md
related_code:
  - scripts/deploy/terminal-profile-registry.json
  - scripts/deploy/tests/test_client_agent_contract_matrix.py
  - scripts/ci/run-deploy-contracts-local.sh
related_docs:
  - ./assembly-torque-agent.md
  - ../plans/deployment-exhaustive-preflight-execplan.md
validation:
  - python3 scripts/deploy/tests/test_client_agent_contract_matrix.py
  - pnpm test:deploy-contracts
open_items: []
supersedes: null
superseded_by: null
---

# Client Docker Agent Addition Runbook

## Purpose

Pi4/端末で動く新しい Docker agent を、設定配布だけ、health だけ、rollback だけが先行する半配線状態にしないための手順である。実機への反映手順ではない。通常のリリース承認、対象選定、メンテナンス、rollback 判断は既存のデプロイ Runbook に従う。

このチェックリストの正本データは `scripts/deploy/terminal-profile-registry.json` の `clientAgents` である。配布先で自己完結して実行される runtime helper の allowlist は、互換性を保つため当面は直接この registry を import しない。代わりに `test_client_agent_contract_matrix.py` が両者の完全一致を fail-closed で確認する。

## Addition Sequence

1. `clientAgents` に agent ID、Compose service、runtime `.env` 絶対パス、Ansible template、component、host selector を定義する。`componentHostSelectors` と host selector は一致させる。
2. port 契約を明記する。固定なら `portPolicy: fixed`、inventory で変更できるなら `configurable` を選び、既定 port と環境変数名を記録する。実際のポート挙動を変える変更はこの配線変更とは分ける。
3. health endpoint と response validator ID を追加する。agent の HTTP 実装、`terminal-agent-health-probe.py`、Ansible lifecycle の readiness check は同じ endpoint・port 契約にする。
4. Compose service と `env_file` を追加し、`clients/<agent>/.env` を実行時に読むことを確認する。サービス名、profile、volume、device 権限は最小化し、他 agent の設定を共有しない。
5. Ansible を「設定配布」と「container lifecycle」に分ける。前者は `.env` 作成だけを担い、後者だけが build/recreate/no-build と health retry を行う。`.env` 配布結果は lifecycle の recreate 判定へ反映する。
6. `infrastructure/ansible/roles/common/tasks/main.yml` の image/runtime 変更分類に、agent source、Dockerfile、Compose、設定/lifecycle、`infrastructure/ansible/templates/<agent>.env.j2` を含める。template の変更で recreate が選ばれることを試験で確認する。
7. runtime manifest、terminal adapter、health probe、Ansible backend marker/order に agent を追加する。runtime manifest の Docker service allowlist、registry の health probe、rollback manifest の `.env` path が全て揃うまで release しない。
8. registry の path mapping と component profile を追加する。agent source、Dockerfile、Ansible task、template のいずれを変更しても正しい terminal profile だけが選ばれることを確認する。
9. kiosk/signage 等、agent を配る profile の rollback paths に runtime `.env` を明示する。restore が image、volume、秘密値を推測して収集しない既存の封印契約を崩さない。
10. `python3 scripts/deploy/tests/test_client_agent_contract_matrix.py` と `pnpm test:deploy-contracts` を実行する。後者は CI と同じ `scripts/ci/run-deploy-contracts-local.sh` を実行する唯一の入口であり、別のローカル実行器を作らない。

## Acceptance

- matrix test が、registry の全 agent と各境界に余剰・不足がないことを示す。
- config task が Docker を直接操作せず、lifecycle task だけが container を操作する。
- fixed/configurable port、endpoint、response validator、`.env` path、Compose service、rollback path が一致する。
- candidate release 前に通常の exact-SHA preflight と agent health を read-only で実行し、対象 host と maintenance 状態を確認する。

新しい agent を追加するために archive 内の旧 `change-detector.sh`／`impact-analyzer.sh` を実行経路として復活させたり、削除したりしてはならない。現在の registry 駆動経路と matrix test を更新する。
