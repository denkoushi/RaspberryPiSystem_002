# ADR-20260524: 私用 Pi5 Hermes Agent セキュリティプロファイル

- **Status**: accepted（**2026-05-24 追補**: 雑談プロファイル・Discord DM 既定）
- **Date**: 2026-05-24

## Context

- 自宅私用 Pi5 で **Hermes Agent** を導入し、**Discord（本人のみ）** で雑談する。
- 同一ホストで **StackChan `stackchan-bridge`**（LAN :18080）が既に稼働。
- 上流 LLM は **DGX Spark**（Tailscale `100.x`、OpenAI 互換 API）。
- ユーザー要件: **セキュリティ最優先**・**Pi5 上のファイル操作は不要（雑談のみ）**・業務 Pi5 API とは分離。
- **2026-05-24 実機**: Discord DM E2E 成功。DGX は **実効コンテキスト ~8192**（Hermes config は 65536 で起動）。

## Decision

### 基盤（変更なし）

1. **専用 Unix ユーザー `hermes`** で Hermes を実行（`raspi5-private` / bridge プロセスと分離）。
2. **ツール実行は Docker**（`terminal.backend: docker`、`container_persistent: false`）。
3. **承認は manual**（`approvals.mode: manual`）。
4. **セキュリティフラグ**: `allow_lazy_installs: false`、`tirith_enabled: true`、`tirith_fail_open: false`。
5. **DGX 到達のため** `allow_private_urls: true`（Tailscale 100.x）。
6. **UFW**: 既定 deny incoming・**OpenSSH**・自宅 LAN **`192.168.128.0/24` → tcp/18080** のみ（bridge 維持）。
7. **秘密**は `~/.hermes/.env` **0600** のみ。`OPENAI_API_KEY` に DGX 共有トークンを載せる（OpenAI クラウドは使わない）。
8. **Discord gateway** は **Bot token と許可 User ID が揃うまで systemd で起動しない**（`private_pi5_hermes_gateway_enabled: false` 既定）。
9. **デプロイ経路**: 専用 Ansible Playbook + ローカル非追跡 inventory。**`update-all-clients.sh` へ混載しない**。
10. **インストール**: 公式 `install.sh` は **`--skip-setup` `--skip-browser`**・非対話（apt 先行 + ファイル実行 + `stdin: /dev/null`）。

### 雑談プロファイル（2026-05-24 追補・実機確定）

11. **DGX 認証**: repo `gateway-server.py` は **Bearer と X-LLM-Token の両方**を受理（Hermes は Bearer）。Hermes は **`custom:dgx-system-prod` + `key_env: OPENAI_API_KEY`**（`no-key-required` 回避）。
12. **ツール**: 雑談時は **`agent.disabled_toolsets`**（全主要 + kanban/discord 系）と **`platform_toolsets.discord: []`**。8K 上流で既定ツール JSON がコンテキストを圧迫するため。
13. **圧縮**: `compression.enabled: false`（8K モデルと Hermes 64K 圧縮要件の不整合）。
14. **推論**: **`agent.reasoning_effort: none`** + **`model.max_tokens: 128`** + **`agent.system_prompt`（簡潔雑談・追記）**。
15. **DGX thinking 抑止**: vLLM には **`chat_template_kwargs.enable_thinking: false`** が必須。Hermes config の `extra_body` だけでは **毎ターン `request_overrides` 上書き**で届かないことがあるため、**DGX `gateway-server.py` が blue の `chat/completions` に注入**（2026-05-24）。
16. **Discord DM**: テンプレ既定 **`require_mention: false`**（`DISCORD_ALLOWED_USERS` で保護）。サーバー運用でメンション必須に戻す場合は inventory で `private_pi5_hermes_discord_require_mention: true`。
17. **`unauthorized_dm_behavior: ignore`**、許可リストは `DISCORD_ALLOWED_USERS`（inventory → template）。
18. **keep-warm**: Pi5 `hermes-dgx-keep-warm.timer`（`private_pi5_dgx_runtime_control_token` 要）。コールドスタート用（思考 ON 時の ~100s/通 とは別問題）。

## Alternatives

| 案 | 却下理由 |
|----|----------|
| `raspi5-private` で Hermes 実行 | bridge / 運用アカウントとの権限境界が曖昧 |
| `terminal.backend: local` | ホスト直実行の blast radius が大きい |
| `approvals.mode: auto` | 雑談でもツール誤実行リスク |
| `allow_private_urls: false` | DGX Tailscale URL がブロックされ LLM 不可 |
| 常時 `hermes-gateway` 起動 | Discord 未設定時の不要な露出 |
| Hermes ブラウザツール有効 | 攻撃面・リソース増。`--skip-browser` で除外 |
| `require_mention: true` のみ（DM） | DM でメンション不要なのに無応答（実機 2026-05-24） |
| ツール有効のまま 8K DGX | 圧縮ループ・auto-reset（実機 2026-05-24） |
| `model.context_length: 8192` のみ | Hermes 起動時に 64K 必須チェックで失敗 |

## Consequences

### 良い点

- StackChan と **プロセス・設定・gateway ライフサイクル**が分離される。
- UFW で **bridge 以外のインバウンドを閉じる**。
- Discord 未準備時は **gateway が動かない**。
- 雑談は **ツール無効**で 8K 圧迫と圧縮ループを回避。

### 悪い点 / 残リスク

- `hermes` が **docker グループ**所属 → コンテナ経路で **実質 root 相当**になり得る。
- `allow_private_urls: true` → プロンプト経由の **内部 URL 到達**リスク（Tirith で緩和、ゼロではない）。
- DGX トークンを StackChan と **共有**（**分離推奨**・未実施）。
- **長文会話**は DGX ~8K で切れる（圧縮オフのトレードオフ）。
- **レイテンシ**: keep-warm + gateway thinking 注入 + **max_tokens 128 / 簡潔プロンプト**で **数秒〜十数秒/通**（2026-05-24 実測 **8.7〜10.7 s**）。主因は **DGX 推論**（out 比例）。経路は通常 **~2〜3 s** 級。
- UFW の SSH は **Anywhere allow**。

## References

- [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)
- [private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md)
- [KB-private-pi5-hermes-install-noninteractive.md](../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)
- [KB-private-pi5-hermes-dgx-403-bearer-token.md](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md)
- [KB-private-pi5-hermes-discord-e2e-and-latency.md](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)
- Playbook: [`private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml)
