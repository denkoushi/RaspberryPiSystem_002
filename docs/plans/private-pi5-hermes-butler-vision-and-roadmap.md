---
title: 私用 Pi5 Hermes — AI執事ビジョンとロードマップ（北極星）
tags: [Hermes Agent, private Pi5, Discord, tools profile, product vision, butler]
audience: [開発者, 運用者, ステークホルダー（非エンジニア向け要約あり）]
last-verified: 2026-05-25
related:
  - private-pi5-hermes-agent-plan.md
  - private-pi5-hermes-tools-security-phase-d3-execplan.md
  - ../knowledge-base/KB-private-pi5-hermes-phase-d3-production.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
  - ../runbooks/private-pi5-hermes-deploy.md
category: plans
update-frequency: medium
---

# AI執事ビジョンとロードマップ（北極星）

## 要約（非エンジニア向け）

**最終的に欲しいもの**: 自宅の **Discord** から普段話しかけると、裏で安全に **ファイル・Web・（将来）家の設備やカメラ** などを使い、**メモとリマインド**、**定時の情報（例: X）**、**簡単なアプリ作成**、**定点観測の報告** まで任せられる **AI執事**。

**いま（2026-05-25）**: そのための **安全な土台の途中**。Discord は **雑談専用（ツールなし）**。**作業用（file+web）** は別プロファイルで本番稼働済みだが、**Discord からはまだつながっていない**。

**進め方（合意）**: 執事機能を **一気に ON にしない**。これまで通り **Phase 単位でセキュアな運用環境を丁寧に構築**し、あとから **1 機能ずつ**足す。

---

## 北極星 — 執事に含めたい能力

| # | 要望（ステークホルダー） | Hermes / インフラ上の相当 | いま |
|---|-------------------------|---------------------------|------|
| 1 | **メモを覚え、必要時にリマインド** | `memory` · `cronjob` · 将来 Discord からのタスク委譲 | **無効**（chat/tools とも `memory_enabled: false`） |
| 2 | **X から好みの情報を毎日定時で教える** | `x_search` · `cronjob` · Web/認証設計 | **無効**（`x_search` disabled） |
| 3 | **簡単なアプリを作る** | `file` · 将来 `code_execution` / `terminal`（最後） | **file のみ tools 側** · Discord からは不可 |
| 4 | **カメラ・Home Assistant・定点観測と状況通知** | `homeassistant` · `vision` · カメラ連携 · egress 設計 | **無効** |
| 5 | **Discord から指示 → バックグラウンドで tools が処理** | chat ↔ tools **オーケストレーション**（未実装） | **意図的に未接続**（安全のため） |

**UX の入口（目標）**: **Discord DM（本人のみ）** — 別 CLI・別 Web UI を日常操作にしない。

**安全の原則（維持）**:

- **manual 承認**（`approvals.mode: manual`）を急に全自動にしない。
- **chat と tools のプロファイル分離**は維持し、執事化は **「橋」** でつなぐ（chat に全ツール直結は避ける）。
- **境界正本**は引き続き [`boundary-policy.tools.yaml`](../../scripts/private-pi5-hermes/config/boundary-policy.tools.yaml)。

---

## いま実現されていること（2026-05-25 時点）

### 完了済みフェーズ

| フェーズ | 内容 | 記録 |
|--------|------|------|
| A–C | 基盤・Discord 雑談 E2E・遅延改善（keep-warm・thinking 注入・max_tokens 128） | [KB Discord E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| D0 | chat/tools 分離・DGX 複数トークン・境界ポリシー正本 | [KB D0](../knowledge-base/KB-private-pi5-hermes-phase-d0-production.md) |
| D1 | tools 骨格・専用 Bearer・gateway 停止検証 | [KB D1](../knowledge-base/KB-private-pi5-hermes-phase-d1-production.md) |
| D2 | file のみ・workspace マウント・`hermes-tools-gateway` active | [KB D2](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md) |
| D3 | file+web · `website_blocklist` 同期 · 実機デプロイ | [KB D3](../knowledge-base/KB-private-pi5-hermes-phase-d3-production.md) |

### 2 プロファイルの現状

| プロファイル | systemd | 入口 | ツール |
|-------------|---------|------|--------|
| **chat** | `hermes-gateway` | **Discord** | **すべて disabled**（雑談・高速・攻撃面小） |
| **tools** | `hermes-tools-gateway` | **未整備**（gateway は稼働・専用 HOME） | **file + web**（D3） |

**重要**: D3 は **「執事の手（tools）を安全に使える状態」** まで。 **「Discord からその手を動かす」** は次フェーズ以降。

### Git / 本番（D3）

- PR [#336](https://github.com/denkoushi/RaspberryPiSystem_002/pull/336) マージ → **`main`**
- 実装: `cfdae77a` · 検証修正+KB: `6eb4a79c`（マージ後 `cdebcb75` 付近）
- CI: **`26375912601`** success

---

## 議論で確定した方向性（2026-05-25）

### 1. Discord → バックグラウンド tools（賛成・将来）

- ステークホルダー要望: **Discord で指示し、裏で tools がタスク処理**。
- 技術判断: **可能**。ただし **いきなり chat の `disabled_toolsets` を全部外す**のではなく、**既存 tools プロファイル + 境界 + 承認**を活かす **オーケストレーション層** が望ましい。
- 雑談だけのメッセージは **現行 chat（ツールなし）** のまま残す案が現実的（速度・安全）。

### 2. いまは執事に直行しない（合意）

- 優先: **セキュアな運用環境の構築を丁寧に継続**（Phase D4 以降も同様）。
- D0–D3 の投資は **無駄にならない**（トークン分離・blocklist・workspace・検証スクリプト）。

### 3. tools の「最終 UI」

- リポジトリ時点では **専用の自社 Web UI は未計画**。
- 執事の **日常 UI = Discord**（目標）。tools gateway（`hermes gateway`）は **裏方の実行エンジン**。
- 開発途中のため、**tools 単体の操作 Runbook（CLI 手順）は未整備**。

---

## ロードマップ（D3 以降・提案）

**原則**: 各 Phase は **ExecPlan → 実装 → 私用 Pi5 のみデプロイ → KB/Runbook**。執事の全機能を一度に有効化しない。

| Phase | 名称 | 目的 | 執事との関係 | 優先 |
|-------|------|------|--------------|------|
| **D4** | browser 隔離 | sandbox · `AGENT_BROWSER_ARGS` · 脅威モデル実機 | 将来ブラウザ操作の足場 | **高**（**repo 実装済・実機未**） |
| **D5** | Discord ↔ tools 橋（最小） | 限定インテントのみ tools プロファイルへ委譲 · manual 承認維持 | **執事の「指示→実行」第一歩** | **高** |
| **D6** | memory + リマインド（限定） | `memory` のスコープ設計 · 保持/削除ポリシー · Discord 通知 | 執事 §1 | 中 |
| **D7** | 定時ジョブ基盤 | `cronjob` + 失敗時 Discord 通知 · 1 本の smoke タスク | 執事 §2 の土台 | 中 |
| **D8** | X 定時ダイジェスト | API/規約 · 好みフィルタ · D7 上に実装 | 執事 §2 | 中（外部依存大） |
| **D9** | Home Assistant / カメラ（読み取り中心） | `homeassistant` · vision · Tailscale/UFW 追加境界 | 執事 §4 | 中〜低 |
| **D10** | 簡易アプリ生成 | code_execution/terminal は **脅威モデル「最後」** 遵守 | 執事 §3 | 低 |

**並行・任意**: Discord 回帰（D3 後 chat 不変の確認）· Hermes プロンプト短縮 · `title_generation` 無効化。

**明示的に後回し**: 全ツール一括有効化 · 承認の全面自動化 · 業務 Pi / `update-all-clients.sh` への混載。

### D5（橋）の受け入れイメージ（草案）

- Discord で **タスクっぽい指示**（例: workspace 内ファイル要約）のみ tools へルーティング。
- **雑談**は chat のまま（レイテンシ・攻撃面を守る）。
- 失敗・要承認は **Discord に短文で返す**。
- 許可ユーザーは **現行 Discord allowlist のみ**。

（詳細設計は **D5 用 ExecPlan** 作成時に ADR 化する。）

---

## 執事化時の追加リスク（先読み）

| リスク | 対策の方向 |
|--------|------------|
| プロンプトインジェクション | Tirith · manual 承認 · タスク種別の allowlist |
| 記憶のプライバシー | memory の保持範囲・/export 禁止・削除手順 |
| X / HA / カメラの egress | boundary 拡張 · Tailscale grants 見直し |
| 承認 fatigue | タスク種別ごとに承認要否を分ける |
| 遅延増 | ツール往復は chat より遅い前提を UX で明示 |

正本: [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)。

---

## トラブルシュート索引（ビジョン関連）

| 質問 | 答え / 参照 |
|------|-------------|
| Discord から file/web が使えない？ | **仕様**（chat はツール無効）。執事化は D5 以降。 |
| tools はどこから使う？ | 現状 **運用 UI 未整備** · gateway は稼働。将来は Discord 橋。 |
| なぜ memory を ON にしない？ | 安全フェーズ優先 · [KB スキル/設計](../knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md) |
| D3 デプロイ verify 失敗 | [KB D3 Investigation](../knowledge-base/KB-private-pi5-hermes-phase-d3-production.md)（Jinja `\n` · blocklist assert） |

---

## References

- [私用 Pi5 Hermes 計画](./private-pi5-hermes-agent-plan.md)
- [`EXEC_PLAN.md`](../../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24) — 進捗表
- [Runbook](../runbooks/private-pi5-hermes-deploy.md)
- [Phase D3 ExecPlan](./private-pi5-hermes-tools-security-phase-d3-execplan.md)
