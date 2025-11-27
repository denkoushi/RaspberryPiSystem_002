# ドキュメントリファクタリング計画

> **出典**: [EXEC_PLAN.md](../EXEC_PLAN.md) の「ドキュメント管理の「1本のルート」設計」セクションを基に作成

## 📋 全体像

### 目的

時間経過とともにドキュメントやリポジトリのエントロピー増加を防ぎ、秩序を保つための明確な判断基準を確立する。

### 基本思想：階層構造

```
AGENTS.md (最上位・ベース)
  ↓ 参照
PLANS.md (具体的な思想・行動方針)
  ↓ 参照・指示
EXEC_PLAN.md (プロジェクト管理)
  ↓ 参照
INDEX.md (各種ドキュメントの入口)
  ↓ 参照
各種ドキュメント (docs/, README.md等)
```

**重要な原則**:
- AGENTS.mdはすべてのドキュメントと直接連携する構造ではない。階層的に参照される。
- PLANS.mdはAGENTS.mdから唯一参照される。具体的な思想・行動方針の唯一の源泉。
- EXEC_PLAN.mdはPLANS.mdに従って維持される。プロジェクトの進捗・決定を記録する生きたドキュメント。
- INDEX.mdは各種ドキュメント（docs/）の「入口」として機能し、階層構造を損なわない。

---

## 🔍 現状の課題

| 指標 | 現状 | 将来リスク |
|------|------|-----------|
| ファイル数 | 26ファイル | 機能追加で倍増の可能性 |
| ディレクトリ数 | 14ディレクトリ | 深い階層化で迷子になる |
| 最大ファイルサイズ | 964行（troubleshooting-knowledge.md） | 1500行超えると検索性低下 |
| ナレッジ集約 | 1ファイルに全ナレッジ | KB-050超えると探しにくい |

---

## 🎯 核となる判断基準：「情報の性質とライフサイクル」

### 質問フロー（1本のルート）

```
1. この情報は「何について」か？
   ↓
2. この情報は「いつ・どのように更新される」か？
   ↓
3. この情報は「誰が・なぜ参照する」か？
   ↓
4. この情報の「粒度」はどの程度か？
   ↓
5. 適切な配置場所を決定
```

### 情報の分類軸

**軸1: 情報の性質（What）**
- **アーキテクチャ**: システム全体の設計・構造
- **機能仕様**: モジュール・機能の詳細
- **運用**: デプロイ・監視・バックアップ
- **開発**: 開発環境・ワークフロー
- **トラブルシューティング**: 問題解決のナレッジ

**軸2: 情報のライフサイクル（When/How）**
- **静的（変更が少ない）**: アーキテクチャ、設計決定、要件定義
- **動的（頻繁に更新）**: ガイド、ナレッジベース、トラブルシューティング
- **参照（参照のみ）**: APIリファレンス、モジュール仕様

**軸3: 情報の参照頻度（Who/Why）**
- **高頻度**: 開発ガイド、トラブルシューティング
- **中頻度**: APIリファレンス、モジュール仕様
- **低頻度**: アーキテクチャ、設計決定

---

## 📁 提案する構造設計

```
docs/
├── INDEX.md                    # 【必須】全ドキュメントの索引（目的別・対象者別）
│
├── architecture/               # 静的: アーキテクチャ・設計決定
│   ├── overview.md            # システム全体のアーキテクチャ
│   ├── infrastructure-base.md  # インフラ基盤
│   ├── test-architecture.md   # テストアーキテクチャ
│   └── decisions/              # ADR（Architecture Decision Records）
│       ├── 001-module-structure.md
│       └── 002-service-layer.md
│
├── modules/                    # 静的: モジュール仕様（機能別）
│   ├── tools/
│   │   ├── README.md          # モジュール概要
│   │   ├── api.md             # APIリファレンス
│   │   └── services.md        # サービス層仕様
│   ├── documents/
│   └── logistics/
│
├── api/                        # 静的: APIリファレンス
│   ├── overview.md
│   └── auth.md
│
├── requirements/               # 静的: 要件定義
│   └── system-requirements.md
│
├── guides/                     # 動的: 実践ガイド（手順・ワークフロー）
│   ├── development.md         # 開発環境セットアップ
│   ├── deployment.md          # デプロイ手順
│   ├── production-setup.md    # 本番環境セットアップ
│   ├── backup-and-restore.md   # バックアップ・リストア手順
│   ├── monitoring.md          # 監視・アラート設定
│   ├── csv-import-export.md   # CSVインポート・エクスポート
│   ├── real-device-verification.md  # 実機検証手順
│   └── verification-checklist.md     # 検証チェックリスト
│
├── knowledge-base/             # 動的: トラブルシューティングナレッジ（分割）
│   ├── index.md               # 【必須】全ナレッジの索引（ID・タイトル・カテゴリ一覧）
│   ├── database.md            # DB関連（KB-001, KB-003, KB-016等）
│   ├── ci-cd.md               # CI/CD関連（KB-024等）
│   ├── frontend.md            # フロントエンド関連（KB-002, KB-004等）
│   ├── infrastructure.md      # インフラ関連（KB-006, KB-007等）
│   └── api.md                 # API関連（KB-005, KB-008等）
│
├── security/                   # 静的: セキュリティ
│   └── validation-review.md
│
└── troubleshooting/            # 動的: トラブルシューティング（個別問題）
    └── nfc-reader-issues.md   # NFCリーダー固有の問題
```

---

## 🔄 「1本のルート」の判断フロー

### 新しいドキュメントを作成する場合

```
質問1: この情報は「何について」か？
├─ アーキテクチャ・設計決定 → architecture/
├─ モジュール・機能の仕様 → modules/
├─ APIリファレンス → api/
├─ 要件定義 → requirements/
├─ 実践ガイド・手順 → guides/
├─ トラブルシューティング → knowledge-base/ または troubleshooting/
└─ セキュリティ → security/

質問2: この情報は「いつ・どのように更新される」か？
├─ 静的（変更が少ない）→ そのまま配置
└─ 動的（頻繁に更新）→ ファイルサイズを200-300行に制限、必要に応じて分割

質問3: この情報は「誰が・なぜ参照する」か？
├─ 開発者（開発時）→ guides/development.md
├─ 運用者（運用時）→ guides/deployment.md, guides/monitoring.md
├─ 問題解決時 → knowledge-base/（カテゴリ別）
└─ 設計検討時 → architecture/decisions/

質問4: この情報の「粒度」はどの程度か？
├─ 概要レベル → README.md または overview.md
├─ 詳細レベル → 個別ファイル（api.md, services.md等）
└─ 個別問題 → troubleshooting/ または knowledge-base/
```

### 既存ドキュメントを更新する場合

```
質問1: この情報は「どこに属する」か？
→ INDEX.md で確認

質問2: ファイルサイズが300行を超えているか？
├─ はい → カテゴリ別に分割を検討
└─ いいえ → そのまま更新

質問3: この情報は「他のドキュメントと重複」していないか？
├─ はい → 統合または参照リンクに変更
└─ いいえ → そのまま更新
```

---

## 📝 エントロピー増加を防ぐルール

**ルール1: ファイルサイズ制限**
- 1ファイルは300行以内を推奨
- 300行を超える場合は分割を検討

**ルール2: 重複排除**
- 同じ情報は1箇所にのみ記載
- 他のドキュメントからは参照リンクで参照

**ルール3: 命名規則**
- `README.md`: ディレクトリの概要
- `overview.md`: カテゴリ全体の概要
- `index.md`: 索引・目次
- その他: 具体的な機能名・問題名

**ルール4: 更新頻度の管理**
- Frontmatterで`last-verified`を記録
- 6ヶ月以上更新されていないドキュメントはレビュー対象

**ルール5: 索引の維持**
- `INDEX.md`は常に最新の状態を維持
- 新しいドキュメント追加時は必ず`INDEX.md`を更新

---

## 🚀 リファクタリングの計画ステップ

### 優先順位1: INDEX.md作成（最優先）

**目的**: 各種ドキュメント（docs/）の「入口」として機能し、検索性を向上させる。

**作業内容**:
1. `docs/INDEX.md`を作成
2. 目的別インデックス（「何をしたいか」から逆引き）
3. 対象者別インデックス（「誰が参照するか」で分類）
4. カテゴリ別インデックス（ドキュメントの種類ごとに一覧）
5. コードとの対応関係を明示（各モジュールのドキュメントとコードの対応）

**INDEX.mdの構成例**:
```markdown
# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../../EXEC_PLAN.md) を参照してください。

## 目的別インデックス
- 初期セットアップしたい → [guides/deployment.md](./guides/deployment.md)
- エラーを解決したい → [knowledge-base/index.md](./knowledge-base/index.md)
- 機能を追加したい → [guides/development.md](./guides/development.md)
- 運用したい → [guides/backup-and-restore.md](./guides/backup-and-restore.md)

## 対象者別インデックス
- 新規参加者 → [README.md](../../README.md), [guides/development.md](./guides/development.md)
- 開発者 → [guides/development.md](./guides/development.md), [modules/](./modules/)
- 運用者 → [guides/deployment.md](./guides/deployment.md), [guides/monitoring.md](./guides/monitoring.md)

## カテゴリ別インデックス
- [アーキテクチャ](./architecture/)
- [モジュール仕様](./modules/)
- [APIリファレンス](./api/)
- [実践ガイド](./guides/)
- [トラブルシューティング](./knowledge-base/)

## コードとの対応関係
- **工具管理モジュール**: 
  - ドキュメント: [modules/tools/README.md](./modules/tools/README.md)
  - APIコード: `apps/api/src/routes/tools/`
  - Webコード: `apps/web/src/pages/tools/`
```

**完了基準**: INDEX.mdが作成され、EXEC_PLAN.mdから参照される。

---

### 優先順位2: ナレッジベースの分割

**目的**: `troubleshooting-knowledge.md`（964行）をカテゴリ別に分割し、検索性を向上させる。

**作業内容**:
1. `docs/knowledge-base/index.md`を作成（全ナレッジの索引）
2. `troubleshooting-knowledge.md`を以下のカテゴリ別に分割:
   - `database.md`: DB関連（KB-001, KB-003, KB-016等）
   - `ci-cd.md`: CI/CD関連（KB-024等）
   - `frontend.md`: フロントエンド関連（KB-002, KB-004等）
   - `infrastructure.md`: インフラ関連（KB-006, KB-007等）
   - `api.md`: API関連（KB-005, KB-008等）
3. 各ファイルは200-300行以内に収める
4. `knowledge-base/index.md`に全ナレッジの索引を追加

**完了基準**: ナレッジベースがカテゴリ別に分割され、各ファイルが300行以内に収まる。

---

### 優先順位3: Frontmatter導入

**目的**: 各ドキュメントにメタデータを追加し、検索性と管理性を向上させる。

**作業内容**:
1. 新規作成するドキュメントにFrontmatterを追加
2. 既存ドキュメントは段階的にFrontmatterを追加（優先度の高いものから）

**Frontmatterの形式**:
```markdown
---
title: バックアップ・リストアガイド
tags: [運用, バックアップ, PostgreSQL, ラズパイ5]
audience: [運用者, 開発者]
last-verified: 2025-11-27
related: [guides/monitoring.md, guides/deployment.md]
category: guides
update-frequency: medium
---
```

**完了基準**: 主要なドキュメント（guides/, knowledge-base/）にFrontmatterが追加される。

---

### 優先順位4: EXEC_PLAN.mdのOutcomes & Retrospective活用

**目的**: EXEC_PLAN.mdの肥大化対策として、Outcomes & Retrospectiveに要約を追加し、一覧性を確保する。

**作業内容**:
1. マイルストーン完了時に、Outcomes & Retrospectiveに要約を追加
2. 定期的（四半期ごとなど）にOutcomes & Retrospectiveを更新

**要約の形式**:
```markdown
## Milestone X 完了（2025-XX-XX）

**達成事項**:
- 機能Aの実装完了
- 機能Bの実装完了

**残タスク**:
- 機能Cの実装（次のマイルストーン）

**学んだこと**:
- 技術Xの採用により、パフォーマンスが向上した
- 設計Yの変更により、保守性が向上した

**詳細**: Progressセクションの「Milestone X」を参照
```

**完了基準**: マイルストーン完了時に、Outcomes & Retrospectiveに要約が追加される。

---

### 優先順位5: モジュール単位の自己完結ドキュメント（将来検討）

**目的**: 各モジュールに必要なドキュメントを自己完結させ、コードとドキュメントの距離を近づける。

**作業内容**:
1. 各モジュール（tools, documents, logistics）に必要なドキュメントを整理
2. モジュール単位でドキュメントを自己完結させる

**完了基準**: 各モジュールのドキュメントが自己完結している。

---

## 📊 推奨アクション（優先順位）

| 優先度 | アイデア | 理由 | 完了基準 |
|--------|----------|------|----------|
| 1 | **INDEX.md作成** | 低コスト・高効果、今すぐ実施可能 | INDEX.mdが作成され、EXEC_PLAN.mdから参照される |
| 2 | **ナレッジベース分割** | 964行は既に長い、分割効果大 | ナレッジベースがカテゴリ別に分割され、各ファイルが300行以内 |
| 3 | **Frontmatter導入** | 新規作成時から適用、段階的に展開 | 主要なドキュメントにFrontmatterが追加される |
| 4 | **EXEC_PLAN.mdのOutcomes & Retrospective活用** | 一覧性と詳細性の両立 | マイルストーン完了時に要約が追加される |
| 5 | モジュール自己完結 | 将来の拡張時に検討 | 各モジュールのドキュメントが自己完結している |

---

## 🔗 関連ドキュメント

- [EXEC_PLAN.md](../EXEC_PLAN.md): プロジェクト管理ドキュメント（詳細な計画と進捗）
- [README.md](../README.md): ドキュメント体系の基本思想
- [PLANS.md](../.agent/PLANS.md): 具体的な思想・行動方針

---

## 📝 更新履歴

- 2025-11-27: 初版作成（EXEC_PLAN.mdの「ドキュメント管理の「1本のルート」設計」セクションを基に作成）

