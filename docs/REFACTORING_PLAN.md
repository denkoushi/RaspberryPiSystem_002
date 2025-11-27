---
title: ドキュメントリファクタリング計画
tags: [ドキュメント, リファクタリング, 計画]
audience: [開発者, アーキテクト]
last-verified: 2025-11-27
related: [INDEX.md, ../EXEC_PLAN.md]
category: planning
update-frequency: low
---

# ドキュメントリファクタリング計画

> **ステータス**: ✅ **完了**（2025-11-27）
>
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

---

## 🚀 リファクタリング計画ステップ

### 優先順位1: INDEX.md作成 ✅ 完了

**目的**: 各種ドキュメント（docs/）の「入口」として機能し、検索性を向上させる。

**成果物**:
- [docs/INDEX.md](./INDEX.md): 目的別・対象者別・カテゴリ別インデックス
- README.mdにINDEX.mdへの参照を追加

### 優先順位2: ナレッジベースの分割 ✅ 完了

**目的**: 964行のナレッジベースを検索しやすいサイズに分割する。

**成果物**:
- [docs/knowledge-base/index.md](./knowledge-base/index.md): 全24件の索引
- [docs/knowledge-base/api.md](./knowledge-base/api.md): API関連（8件）
- [docs/knowledge-base/database.md](./knowledge-base/database.md): データベース関連（3件）
- [docs/knowledge-base/ci-cd.md](./knowledge-base/ci-cd.md): CI/CD関連（4件）
- [docs/knowledge-base/frontend.md](./knowledge-base/frontend.md): フロントエンド関連（3件）
- [docs/knowledge-base/infrastructure.md](./knowledge-base/infrastructure.md): インフラ関連（6件）

### 優先順位3: Frontmatter導入 ✅ 完了

**目的**: ドキュメントにメタデータを付与し、将来の検索・フィルタリングに備える。

**成果物**:
主要ドキュメント12ファイルにFrontmatterを追加:
- guides/: development.md, deployment.md, backup-and-restore.md, monitoring.md, ci-troubleshooting.md
- architecture/: overview.md
- knowledge-base/: index.md, api.md, database.md, ci-cd.md, frontend.md, infrastructure.md

**Frontmatter形式**:
```yaml
---
title: ドキュメントタイトル
tags: [検索用タグ]
audience: [対象者]
last-verified: 最終確認日
related: [関連ドキュメント]
category: カテゴリ
update-frequency: 更新頻度(low/medium/high)
---
```

### 優先順位4: EXEC_PLAN.mdのOutcomes & Retrospective活用 ✅ 完了

**目的**: マイルストーン完了時の要約をOutcomes & Retrospectiveに追加し、一覧性を確保する。

**成果物**:
- EXEC_PLAN.mdのOutcomes & Retrospectiveセクションに以下を追加:
  - Milestone 1-4完了の要約
  - Milestone 5完了の要約
  - Milestone 6完了の要約
  - Phase 5: CI/テストアーキテクチャ整備完了の要約
  - ドキュメントリファクタリング完了の要約

---

## 📊 リファクタリング結果

### Before（2025-11-27以前）

| 指標 | 値 |
|------|------|
| ファイル数 | 26ファイル |
| 最大ファイルサイズ | 964行（troubleshooting-knowledge.md） |
| ナレッジ集約 | 1ファイルに全24件 |
| インデックス | なし |
| Frontmatter | なし |

### After（2025-11-27）

| 指標 | 値 |
|------|------|
| ファイル数 | 31ファイル（+5件） |
| 最大ファイルサイズ | 約200-300行（分割後） |
| ナレッジ集約 | 5カテゴリに分割（3-8件/ファイル） |
| インデックス | INDEX.md, knowledge-base/index.md |
| Frontmatter | 主要12ファイルに導入 |

---

## 📅 更新履歴

- 2025-11-27: 初版作成、全4ステップ完了
