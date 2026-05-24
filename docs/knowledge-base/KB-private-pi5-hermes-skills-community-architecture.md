# KB-private-pi5-hermes-skills-community-architecture: スキル・フォーラム知見・実装評価

- **Status**: reference（2026-05-24）
- **Related**: [KB Discord E2E・遅延](./KB-private-pi5-hermes-discord-e2e-and-latency.md) · [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md) · [ADR-20260524](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)

## Context

私用 Pi5 Hermes（Discord 雑談）の **Phase C**（keep-warm・thinking 注入・max_tokens 128）完了後、運用上の誤解しやすい点（**スキル蓄積**・**自然に賢くなるか**）と、**NVIDIA DGX Spark フォーラム**の Hermes 関連知見、**repo 実装の設計評価**をまとめる。

---

## Phase C 実装の要約（3 本柱）

| 柱 | 実装 | 場所 | 効果 |
|----|------|------|------|
| **keep-warm** | `probe_runtime_ready` → 未 warm なら `POST /start` | Pi5 `hermes-dgx-keep-warm.timer` + [`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py) | コールドスタート回避 |
| **thinking 注入** | blue `chat/completions` に `enable_thinking: false` | DGX [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py) `inject_blue_chat_completions_defaults` | **~100 s/通 → 数秒級** |
| **出力抑制** | `max_tokens: 128` + 簡潔 `agent.system_prompt` | [`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2) | **8.7〜10.7 s/通**（out=41〜52） |

**遅さの主因**: **DGX Spark 上の推論**（特に **out トークン数**）。Pi5→Tailscale→gateway の経路は通常 **~2〜3 s** 級（[KB Discord E2E](./KB-private-pi5-hermes-discord-e2e-and-latency.md) 実測表）。

---

## スキル蓄積・自己改善 — **現状は無効**

### 設定（雑談プロファイル）

| 項目 | 値 |
|------|-----|
| `disabled_toolsets` | **`skills`** を含む全主要ツール無効 |
| `memory.memory_enabled` | **`false`** |

正本: `private-pi5-hermes.config.yaml.j2`（Pi5 本番 `~/.hermes/config.yaml` と同期）。

### 「自然に賢くなる？」への答え

| 質問 | 答え |
|------|------|
| スキル蓄積は動いている？ | **いいえ**（`skills` ツールセット無効） |
| 会話を重ねると賢くなる？ | **この設定ではほぼならない**（`memory` もオフ） |
| セッション内の文脈 | **同一 Discord スレッド内**は会話履歴として効く（`/reset` で消える） |
| NVIDIA/Hermes 公式の「Self-Evolving Skills」 | **能動的**（タスク完了・ツール有効時に SKILL.md を書く）。**雑談だけでは自動では増えない** |

`~/.hermes/skills` や Hermes 同梱 `skills/` は **インストール時バンドル**の残存であり、雑談 gateway からは **呼び出し経路が塞がれている**。

### 有効化する場合（方針）

- **別 Hermes プロファイル**（雑談は現状維持・作業用だけ `skills` 有効）がフォーラムでも推奨されるパターン。
- 副作用: 8K 圧迫・レイテンシ増・ツール JSON 肥大 → [KB Discord E2E](./KB-private-pi5-hermes-discord-e2e-and-latency.md) と同種リスク。

---

## DGX Spark フォーラム — Hermes 関連知見（2026-05 調査）

探索先: [NVIDIA DGX Spark / GB10 フォーラム](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/719)。専用 Hermes スレは少なく、**エージェント全般・モデル選定**の文脈が多い。

### 速度

| 知見 | 出典・備考 |
|------|------------|
| エージェント用途では **ワーカーは thinking off**、監督役だけ reasoning | [2× Spark + Hermes/OpenClaw](https://forums.developer.nvidia.com/t/now-running-2x-dgx-spark-stacked-over-qsfp56-looking-for-model-recs-for-agentic-workloads-hermes-openclaw/368649) — **本 repo の gateway 注入と一致** |
| **マルチエージェント並列**では **SGLang** 推奨の声。**Ollama はエージェント向きでない** | 同上 |
| **OOM 後 GB10 パワースロットル**（数 W 張り付き）→ 電源ブリック抜きが回避策 | [GB10 power limited](https://forums.developer.nvidia.com/t/gb10-is-power-limited-after-crash/366590) |
| Qwen3.6 + vLLM で **reasoning-parser / MTP** が体感向上の例 | [Medium: Hermes on Spark](https://astrujic.medium.com/hermes-agent-on-dgx-spark-running-qwen3-6-35b-a3b-fp8-model-on-vllm-server-and-telegram-messages-cdc45b1d8b9c) |

### セキュリティ

| 知見 | 出典 |
|------|------|
| **Allowed user IDs 必須**（Telegram/メッセージング） | [build.nvidia.com/spark/hermes-agent](https://build.nvidia.com/spark/hermes-agent) |
| **LLM は localhost のみ**（LAN に晒さない） | 同上 |
| **`terminal.backend: docker`**・allowlist・`~/.hermes/.env` 0600 | [Hermes Security 公式](https://hermes-agent.nousresearch.com/docs/user-guide/security) |
| **プロファイルをドメイン別に分離**（仕事/個人） | [Agent Harnesses on GB10](https://forums.developer.nvidia.com/t/agent-harnesses-that-run-really-good-local-ai-for-gb10-systems/371167) |
| DGX Spark で **browser_navigate 不具合** → `AGENT_BROWSER_ARGS`（`AGENT_BROWSER_CHROME_FLAGS` ではない） | [browser_navigate スレ](https://forums.developer.nvidia.com/t/hermes-agent-dgx-spark-build-says-it-installs-browser-but-agent-throws-errors-for-every-url-via-browser-navigate/370196) |

**本構成**: Pi5 分離 + UFW + ツール無効 + Discord 許可 User — 公式・フォーラムの方向性と **整合**。

### モデル（フォーラム傾向 vs 本番）

| 用途 | フォーラムでよく挙がる | 本 repo 本番 |
|------|------------------------|--------------|
| 単一 Spark エージェント品質 | MiniMax M2.7 AWQ、Qwen3.6-35B-A3B | **`system-prod-primary`（Qwen3.6-27B 系）** |
| 2× Spark | MiniMax M2.7 TP=2、Qwen 397B | 未使用（単一 DGX） |
| コーディング副次 | qwen3-coder-next | 未使用（雑談のみ） |

NVIDIA ブログも **Qwen 3.6 + Hermes on DGX Spark** を推奨。[Hermes DGX Spark playbook](https://blogs.nvidia.com/blog/rtx-ai-garage-hermes-agent-dgx-spark/)（`dgx-spark-playbooks` に Hermes 専用 playbook は少ない）。

### 日々の便利な使い方（フォーラム）

- **Hermes profiles** でタスク・ドメイン分離
- **ローカル推論で API 代削減**（ユーザー報告で ~$500/2 週間級の例あり）
- **メッセージング gateway**（Telegram / Discord）で常時オン
- 厳密ワークフローは **ADK 等で手順固定**（再現性重視向け）

---

## 実装アーキテクチャ評価（SOLID・疎結合）

**結論**: 今回追加コードは **単一用途（私用 Pi5 + DGX）向けの境界分離**として妥当。**エンタープライズ級の完全 SOLID ではない**。

### 良い点

| 要素 | 評価 |
|------|------|
| [`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py) | DGX HTTP のみ。**StackChan と Hermes keep-warm で再利用**（SRP） |
| [`dgx_keep_warm.py`](../../scripts/private-pi5-hermes/dgx_keep_warm.py) | 薄い CLI（systemd 向け） |
| `inject_blue_chat_completions_defaults()` | 純関数・[単体テスト](../../scripts/dgx-local-llm-system/tests/test_gateway_server.py)。Hermes の `request_overrides` 問題を **gateway 境界で吸収**（adapter） |
| Ansible テンプレ | 設定とコードの分離。秘密は fragment のみ |

### トレードオフ・限界

| 要素 | 評価 |
|------|------|
| `gateway-server.py` 全体 | **モノリス**（ルーティング・認証・複数 backend 同居）。注入部分のみ分離 |
| keep-warm 配備 | `dgx_runtime_client.py` を Pi5 へ **ファイルコピー**（pip パッケージ化ではない） |
| スケール | **1 Pi5・1 DGX・許可 Discord User** 前提。マルチテナント非対応 |
| Hermes 本体 | 外部製品依存。速度・8K は **config + DGX 境界**で制御 |

リポジトリ `.cursor/rules/02-core-architecture.mdc`（安定→不安定・境界で隔離）と **大きく矛盾しない**。

---

## Prevention（誤解防止）

- 「Hermes は会話するほど賢くなる」→ **雑談プロファイルでは NO**（skills/memory 無効）。
- 「遅いのは Pi5 経路」→ 通常は **DGX 推論・out トークン**（障害・コールド除く）。
- 「スキルフォルダがある＝有効」→ **disabled_toolsets に `skills`** を確認。

## References

- [KB Discord E2E・遅延](./KB-private-pi5-hermes-discord-e2e-and-latency.md)
- [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)
- [NVIDIA: Hermes on DGX Spark](https://build.nvidia.com/spark/hermes-agent)
- [Agent Harnesses (GB10)](https://forums.developer.nvidia.com/t/agent-harnesses-that-run-really-good-local-ai-for-gb10-systems/371167)
