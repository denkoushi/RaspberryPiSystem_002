# 私用 Pi5 `stackchan-bridge` 標準デプロイ

最終更新: 2026-05-10

## 目的

自宅の **私用 Pi5** に載せる **`stackchan-bridge`** を、**手作業なし**で再現可能に反映する。  
秘密は **ローカル非追跡 inventory fragment** にだけ置き、コミットするのは **playbook / sample / runbook** のみとする。

## 標準ファイル

- Playbook: `infrastructure/ansible/playbooks/private-pi5-stackchan-bridge.yml`
- Sample inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml`
- Deploy wrapper: `scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh`
- Bridge 実装: `scripts/private-pi5-stackchan-bridge/bridge_server.py` / `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`

## 前提

- 私用 Pi5 が **Tailscale** 参加済みで、Mac から SSH 可能。
- private Pi5 上で `sudo` が使えること。
- DGX 用の **`DGX_LLM_SHARED_TOKEN`** を把握していること。
- 任意: cold start 復旧を使うなら **`DGX_RUNTIME_CONTROL_TOKEN`** も用意すること。

## 手順

### 1. ローカル inventory fragment を作る

```bash
cp infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml \
  infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml
```

次を **ローカル断片**だけに設定する。

- `ansible_host`
- 必要なら `ansible_password` / `ansible_become_password`
- `private_pi5_dgx_llm_shared_token`
- 必要なら `private_pi5_dgx_runtime_control_token`
- 必要なら `private_pi5_stackchan_token`

`inventory-private-pi5-stackchan-bridge-fragment.yml` は `.gitignore` 済み。

### 2. デプロイする

リポジトリ直下で実行:

```bash
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh
```

追加で dry-run / 詳細ログを見たい場合:

```bash
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh --check --diff
./scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh -vv
```

## Playbook が行うこと

1. Tailscale preflight
2. `bridge_server.py` / `dgx_runtime_client.py` を私用 Pi5 へ同期
3. `.env` を template から生成（`0600`）
4. `stackchan-bridge.service` を systemd に配備
5. `systemctl enable --now`
6. `GET /healthz` で起動確認

## 検証

playbook 成功後、追加確認は次で十分。

```bash
ssh <private-pi5-user>@<private-pi5-host> \
  'systemctl is-active stackchan-bridge && curl -fsS http://127.0.0.1:18080/healthz'
```

期待値:

- `systemctl is-active` が `active`
- `/healthz` が `ok`

## 運用メモ

- 秘密は **private Pi5 の `.env`** と **ローカル非追跡 fragment** に限定する。
- **業務 Pi5 API の `update-all-clients.sh` 経路には混ぜない**。私用経路は private Pi5 専用 playbook で分離する。
- 将来 SSH 鍵と `NOPASSWD` を整えたら、ローカル fragment から `ansible_password` / `ansible_become_password` を外す。

## 関連

- `scripts/private-pi5-stackchan-bridge/README.md`
- `docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`
- `docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md`
