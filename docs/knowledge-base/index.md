---
title: トラブルシューティングナレッジベース - 索引
tags: [トラブルシューティング, ナレッジベース, 索引]
audience: [開発者, 運用者]
last-verified: 2025-11-27
related: [api.md, database.md, ci-cd.md, frontend.md, infrastructure.md]
category: knowledge-base
update-frequency: high
---

# トラブルシューティングナレッジベース - 索引

このドキュメントは、トラブルシューティングナレッジの索引です。各課題はカテゴリ別に分割されたファイルに記録されています。

**EXEC_PLAN.mdとの連携**: 各課題はEXEC_PLAN.mdの「課題」セクションまたは「Surprises & Discoveries」セクションと対応しています。課題ID（KB-XXX）で参照してください。

---

## 📁 カテゴリ別ファイル

| カテゴリ | ファイル | 件数 | 説明 |
|---------|---------|------|------|
| API関連 | [api.md](./api.md) | 8件 | APIエラー、レート制限、認証、履歴 |
| データベース関連 | [database.md](./database.md) | 3件 | P2002エラー、削除機能、シードデータ |
| CI/CD関連 | [ci-cd.md](./ci-cd.md) | 4件 | CIテスト失敗、E2Eテスト、バックアップ/リストア |
| フロントエンド関連 | [frontend.md](./frontend.md) | 11件 | キオスク接続、XState、UI、カメラ連携 |
| インフラ関連 | [infrastructure.md](./infrastructure.md) | 13件 | Docker、Caddy、HTTPS設定、オフライン耐性、バックアップ |

---

## 📋 課題一覧（ID順）

### API関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-001](./api.md#kb-001-429エラーレート制限エラーが発生する) | 429エラー（レート制限エラー）が発生する | ✅ 解決済み |
| [KB-002](./api.md#kb-002-404エラーが発生する) | 404エラーが発生する | ✅ 解決済み |
| [KB-007](./api.md#kb-007-ログインが失敗する) | ログインが失敗する | ✅ 解決済み |
| [KB-008](./api.md#kb-008-履歴の精度が低い) | 履歴の精度が低い | ✅ 解決済み |
| [KB-010](./api.md#kb-010-client-key未設定で401エラーが発生する) | client-key未設定で401エラーが発生する | ✅ 解決済み |
| [KB-011](./api.md#kb-011-同じアイテムが未返却のまま再借用できない) | 同じアイテムが未返却のまま再借用できない | ✅ 解決済み |
| [KB-012](./api.md#kb-012-管理uiの履歴画面に日付フィルタcsvエクスポートがない) | 管理UIの履歴画面に日付フィルタ/CSVエクスポートがない | ✅ 解決済み |
| [KB-017](./api.md#kb-017-fastify-swaggerが存在しない) | fastify-swaggerが存在しない | ✅ 解決済み |

### データベース関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-003](./database.md#kb-003-p2002エラーnfctaguidの重複が発生する) | P2002エラー（nfcTagUidの重複）が発生する | ✅ 解決済み |
| [KB-004](./database.md#kb-004-削除機能が動作しない) | 削除機能が動作しない | ✅ 解決済み |
| [KB-013](./database.md#kb-013-実機uidとseedデータが不一致) | 実機UIDとseedデータが不一致 | ✅ 解決済み |

### CI/CD関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-005](./ci-cd.md#kb-005-ciテストが失敗する) | CIテストが失敗する | 🔄 進行中 |
| [KB-009](./ci-cd.md#kb-009-e2eテストのログイン成功後のリダイレクトがci環境で失敗する) | E2Eテストのログイン成功後のリダイレクトがCI環境で失敗する | ✅ 解決済み |
| [KB-023](./ci-cd.md#kb-023-ciでバックアップリストアテストが失敗する) | CIでバックアップ・リストアテストが失敗する | 🔄 進行中 |
| [KB-024](./ci-cd.md#kb-024-ciテストアーキテクチャの設計不足) | CI/テストアーキテクチャの設計不足 | 🔄 進行中 |

### フロントエンド関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-006](./frontend.md#kb-006-キオスクの接続が不安定) | キオスクの接続が不安定 | ✅ 解決済み |
| [KB-016](./frontend.md#kb-016-xstate-v5のassignの誤用) | XState v5のassignの誤用 | ✅ 解決済み |
| [KB-022](./frontend.md#kb-022-キオスクがラズパイ5に接続できない) | キオスクがラズパイ5に接続できない | ✅ 解決済み |
| [KB-026](./frontend.md#kb-026-キオスク画面のリダイレクトが設定変更時に反映されない) | キオスク画面のリダイレクトが設定変更時に反映されない | ✅ 解決済み |
| [KB-027](./frontend.md#kb-027-nfcイベントが重複発火して持出一覧に自動追加が止まらない) | NFCイベントが重複発火して持出一覧に自動追加が止まらない | ✅ 解決済み |
| [KB-028](./frontend.md#kb-028-デバッグログの環境変数制御) | デバッグログの環境変数制御 | ✅ 解決済み |
| [KB-029](./frontend.md#kb-029-従業員編集画面でバリデーションエラーメッセージが表示されない) | 従業員編集画面でバリデーションエラーメッセージが表示されない | ✅ 解決済み |
| [KB-035](./frontend.md#kb-035-useeffectの依存配列にiscapturingを含めていた問題重複処理) | useEffectの依存配列にisCapturingを含めていた問題（重複処理） | ✅ 解決済み |
| [KB-036](./frontend.md#kb-036-履歴画面の画像表示で認証エラーwindowopenでの新しいタブ) | 履歴画面の画像表示で認証エラー（window.openでの新しいタブ） | ✅ 解決済み |
| [KB-037](./frontend.md#kb-037-カメラプレビューのcpu負荷問題常時プレビュー削除) | カメラプレビューのCPU負荷問題（常時プレビュー削除） | ✅ 解決済み |
| [KB-038](./frontend.md#kb-038-カメラ撮影時のcpu100問題video要素のクリーンアップ) | カメラ撮影時のCPU100%問題（video要素のクリーンアップ） | ✅ 解決済み |

### インフラ関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-014](./infrastructure.md#kb-014-caddyのリバースプロキシ設定が不適切) | Caddyのリバースプロキシ設定が不適切 | ✅ 解決済み |
| [KB-015](./infrastructure.md#kb-015-docker-composeのポート設定が不適切) | Docker Composeのポート設定が不適切 | ✅ 解決済み |
| [KB-018](./infrastructure.md#kb-018-オフライン耐性の実装) | オフライン耐性の実装 | ✅ 解決済み |
| [KB-019](./infrastructure.md#kb-019-usb一括登録機能の実装) | USB一括登録機能の実装 | ✅ 解決済み |
| [KB-020](./infrastructure.md#kb-020-バックアップリストア機能の実装) | バックアップ・リストア機能の実装 | ✅ 実装完了 |
| [KB-021](./infrastructure.md#kb-021-監視アラート機能の実装) | 監視・アラート機能の実装 | ✅ 実装完了 |
| [KB-030](./infrastructure.md#kb-030-カメラapiがhttp環境で動作しないhttps必須) | カメラAPIがHTTP環境で動作しない（HTTPS必須） | ✅ 解決済み |
| [KB-031](./infrastructure.md#kb-031-websocket-mixed-content-エラーhttpsページからwsへの接続) | WebSocket Mixed Content エラー（HTTPSページからws://への接続） | ✅ 解決済み |
| [KB-032](./infrastructure.md#kb-032-caddyfilelocal-のhttpバージョン指定エラー) | Caddyfile.local のHTTPバージョン指定エラー | ✅ 解決済み |
| [KB-033](./infrastructure.md#kb-033-docker-composeserveryml-のyaml構文エラー手動編集による破壊) | docker-compose.server.yml のYAML構文エラー（手動編集による破壊） | ✅ 解決済み |
| [KB-034](./infrastructure.md#kb-034-ラズパイのロケール設定euc-jpによる文字化け) | ラズパイのロケール設定（EUC-JP）による文字化け | ✅ 解決済み |
| [KB-039](./infrastructure.md#kb-039-cpu温度取得のdocker対応sysclassthermalマウント) | CPU温度取得のDocker対応（/sys/class/thermalマウント） | ✅ 解決済み |

---

## 📝 記録フォーマット

各課題は以下のフォーマットで記録します：

```markdown
### [課題ID] 課題名

**EXEC_PLAN.md参照**: Phase X / Surprises & Discoveries (行番号)
**事象**: 
- 何が起きたか（エラーメッセージ、症状など）

**要因**: 
- なぜ起きたか（根本原因）

**試行した対策**: 
- [試行1] 対策内容 → 結果（成功/失敗）
- [試行2] 対策内容 → 結果（成功/失敗）
- ...

**有効だった対策**: 
- 最終的に有効だった対策

**学んだこと**: 
- この経験から学んだこと、今後同じ問題を避けるための知見

**関連ファイル**: 
- 関連するファイルのパス
```

---

## 📊 統計

| 状態 | 件数 |
|------|------|
| ✅ 解決済み | 31件 |
| 🔄 進行中 | 4件 |
| **合計** | **35件** |

---

## 📅 更新履歴

- 2025-11-18: 初版作成（KB-001〜KB-004）
- 2025-11-19: KB-005〜KB-017を追加
- 2025-11-20: KB-018〜KB-019を追加
- 2025-11-24: KB-020〜KB-021を追加
- 2025-11-25: EXEC_PLAN.mdのSurprises & Discoveriesから解決済み課題を追加
- 2025-11-26: KB-023〜KB-024を追加
- 2025-11-27: カテゴリ別にファイルを分割（リファクタリング）
- 2025-11-28: KB-030〜KB-036を追加（HTTPS設定、WebSocket Mixed Content、YAML構文エラー、ロケール設定、useEffect重複処理、履歴画面画像表示）
- 2025-11-28: KB-037〜KB-039を追加（カメラプレビューCPU負荷、カメラ撮影CPU100%、CPU温度取得Docker対応）

