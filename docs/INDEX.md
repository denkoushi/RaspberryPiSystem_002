ｎ# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> - プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照してください。
> - ドキュメント体系の基本思想については [README.md](../README.md) の「ドキュメント体系の基本思想」セクションを参照してください。

---

## 🎯 目的別インデックス

### 🆕 最新アップデート（2025-12-01）

- **Phase 2.4 実機テスト完了**: クライアント状態可視化とデバッグ支援システムの実機テストを完了しました。Raspberry Pi 5上でstatus-agentを設定・実行し、systemd timerで1分ごとに自動実行されることを確認。管理画面で稼働状況カードが正しく表示され、CPU/メモリ/温度などのメトリクスが更新されることを確認。詳細は [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) を参照してください。
- **システム安定性向上の実装完了**: エラーハンドリングとログ出力の最適化を実装しました。エラーメッセージの詳細化、エラーログの構造化、ログレベルの環境変数制御、Dockerログローテーション設定を完了。詳細は [plans/stability-improvement-plan.md](./plans/stability-improvement-plan.md) を参照してください。ガイドドキュメント: [エラーハンドリングガイド](./guides/error-handling.md), [ログ出力ガイド](./guides/logging.md)
- **サイネージ持出中アイテム表示の改善**: 借用日時を日本標準時（JST）で表示し、12時間超のアイテムを赤色で強調してリストの先頭に配置するように改善しました。アイテムコードのフォントサイズも日時と同じサイズに調整しました。
- **Raspberry Pi 4再起動時のサービス起動ガイド**: [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) を追加。開発中に自動起動を無効化している場合の手動起動手順、Docker Compose推奨方法、Poetry直接起動の問題点と改善案を記載しました。
- **サイネージ自動レンダリングの安定化**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) と [guides/signage-test-plan.md](./guides/signage-test-plan.md) に、`SignageRenderScheduler` の自動実行・管理画面からの手動再レンダリング手順・`SIGNAGE_RENDER_DIR` の設定方法を追記しました。
- **PDFスライド & 工具サムネイル改善**: サイネージの分割表示で PDF スライドショーが必ずページ送りされるようになり、工具サムネイルは 4:3 のまま大型表示に統一されました。詳細は [knowledge-base/api.md](./knowledge-base/api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) / [knowledge-base/api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) を参照してください。
- **軽量クライアントTLS/Troubleshooting**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) に自己署名証明書環境での `curl -k` 設定や初回キャッシュ待機ロジック、`setup-signage-lite.sh` の改善点を追加しました。
- **CPU/温度モニタリング**: 画像レンダリング時に `/proc/stat` と `/sys/class/thermal` を取得し、サイネージヘッダー右上に `CPU xx% / Temp yy.y°C` を表示するようにしました。
- **PDFトリミング問題の解消**: `fit: 'contain'` + 背景色でレターボックス表示に変更し、PDFの縦横比にかかわらず全体が映るようになりました。詳細は [knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される](./knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される) を参照してください。
- **NFCエージェントキュー処理改善**: 工具スキャンが二重登録される問題を解決。オンライン時にイベントを即座に配信し、配信成功したイベントはキューから即時削除するように変更。詳細は [knowledge-base/infrastructure.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善](./knowledge-base/infrastructure.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) を参照してください。
- **ナレッジベース更新**: [knowledge-base/index.md](./knowledge-base/index.md) の登録件数が 54件になり、PDFトリミングや軽量サイネージのフォント/CPU対策、NFCエージェントのキュー処理改善を反映しました。
- **Raspberry Pi status-agent**: クライアント端末が1分毎にメトリクスを送信する `status-agent.py`（systemd timer 同梱）を追加。ガイドは [guides/status-agent.md](./guides/status-agent.md)、ソースは `clients/status-agent/` を参照してください。
- **ローカル環境対応の通知機能**: 管理画面でのアラート表示とファイルベースの通知機能を実装しました。Ansible更新失敗時に自動的にアラートファイルを生成し、管理画面で確認できます。ガイドは [guides/local-alerts.md](./guides/local-alerts.md) を参照してください。

### 初めて参加する

| やりたいこと | ドキュメント |
|-------------|-------------|
| プロジェクトの概要を理解したい | [README.md](../README.md) |
| システムアーキテクチャを理解したい | [architecture/overview.md](./architecture/overview.md) |
| 開発環境をセットアップしたい | [guides/development.md](./guides/development.md) |
| **AIアシスタントとして引き継ぐ** | **[guides/ai-handoff.md](./guides/ai-handoff.md)** |

### 開発する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 新機能を追加したい | [guides/development.md](./guides/development.md), [modules/](./modules/) |
| APIを理解したい | [api/overview.md](./api/overview.md), [api/auth.md](./api/auth.md) |
| モジュール構造を理解したい | [decisions/001-module-structure.md](./decisions/001-module-structure.md) |
| サービス層を理解したい | [decisions/002-service-layer.md](./decisions/002-service-layer.md) |
| CSVインポート・エクスポートを理解したい | [guides/csv-import-export.md](./guides/csv-import-export.md) |

### デプロイ・運用する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 本番環境にデプロイしたい | [guides/deployment.md](./guides/deployment.md) |
| 本番環境をセットアップしたい | [guides/production-setup.md](./guides/production-setup.md) |
| バックアップ・リストアしたい | [guides/backup-and-restore.md](./guides/backup-and-restore.md) |
| 監視・アラートを設定したい | [guides/monitoring.md](./guides/monitoring.md) |
| デジタルサイネージ機能をデプロイしたい | [guides/signage-deployment.md](./guides/signage-deployment.md) |
| デジタルサイネージクライアント端末をセットアップしたい | [guides/signage-client-setup.md](./guides/signage-client-setup.md)（Chromiumモード / `setup-signage-lite.sh` 軽量モード） |
| クライアント端末を一括更新したい | [plans/production-deployment-management-plan.md](./plans/production-deployment-management-plan.md#phase-1-一括更新システムssh--ansible) |
| クライアント状態監視のExecPlanを確認したい | [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) |
| Raspberry Pi クライアントにSSH鍵を配布したい | [guides/ssh-setup.md](./guides/ssh-setup.md) |
| **Raspberry Pi 4 再起動時のサービス起動** | [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) |
| Raspberry Pi status-agentを導入したい | [guides/status-agent.md](./guides/status-agent.md) |
| **クライアント一括更新と監視のクイックスタート** | [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) |
| **ローカル環境対応の通知機能** | [guides/local-alerts.md](./guides/local-alerts.md) |

### 検証する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 機能を検証したい | [guides/verification-checklist.md](./guides/verification-checklist.md) |
| USBインポートを検証したい | [guides/validation-7-usb-import.md](./guides/validation-7-usb-import.md) |
| デジタルサイネージ機能を検証したい | [guides/signage-test-plan.md](./guides/signage-test-plan.md) |
| セキュリティを検証したい | [security/validation-review.md](./security/validation-review.md) |

### エラーを解決する

| やりたいこと | ドキュメント |
|-------------|-------------|
| トラブルシューティングしたい | [knowledge-base/troubleshooting-knowledge.md](./knowledge-base/troubleshooting-knowledge.md) |
| CI/CDの問題を解決したい | [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) |
| NFCリーダーの問題を解決したい | [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) |
| **エラーハンドリングを理解したい** | **[guides/error-handling.md](./guides/error-handling.md)** |
| **ログ出力を理解したい** | **[guides/logging.md](./guides/logging.md)** |

---

## 👥 対象者別インデックス

### 新規参加者

| ドキュメント | 説明 |
|-------------|------|
| [README.md](../README.md) | プロジェクトの概要 |
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [guides/development.md](./guides/development.md) | 開発環境セットアップ |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

### 開発者

| ドキュメント | 説明 |
|-------------|------|
| [guides/development.md](./guides/development.md) | 開発環境・ワークフロー |
| [api/overview.md](./api/overview.md) | API概要 |
| [api/auth.md](./api/auth.md) | 認証API |
| [modules/tools/README.md](./modules/tools/README.md) | 工具管理モジュール |
| [modules/tools/api.md](./modules/tools/api.md) | 工具管理API |
| [modules/tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [decisions/001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [decisions/002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |

### 運用者

| ドキュメント | 説明 |
|-------------|------|
| [guides/deployment.md](./guides/deployment.md) | デプロイ手順 |
| [guides/production-setup.md](./guides/production-setup.md) | 本番環境セットアップ（HTTPS設定含む） |
| [guides/backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [guides/monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [guides/operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |

### アーキテクト

| ドキュメント | 説明 |
|-------------|------|
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | インフラ基盤 |
| [decisions/](./decisions/) | アーキテクチャ決定記録（ADR） |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

---

## 📁 カテゴリ別インデックス

### アーキテクチャ（architecture/）

システム全体の設計・構造に関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [overview.md](./architecture/overview.md) | システム全体のアーキテクチャ（クライアントデバイス統合含む） |
| [infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [signage-module-architecture.md](./architecture/signage-module-architecture.md) | **デジタルサイネージモジュール アーキテクチャ**（モジュール化、コンフリクト確認、スケーラビリティ） |

### 設計決定（decisions/）

アーキテクチャ決定記録（ADR）。

| ファイル | 説明 |
|---------|------|
| [001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [003-camera-module.md](./decisions/003-camera-module.md) | **カメラ機能のモジュール化**（写真撮影持出機能） |

### モジュール仕様（modules/）

機能別のモジュール仕様。

| ファイル | 説明 |
|---------|------|
| [tools/README.md](./modules/tools/README.md) | 工具管理モジュール概要 |
| [tools/api.md](./modules/tools/api.md) | 工具管理API |
| [tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [tools/photo-loan.md](./modules/tools/photo-loan.md) | **写真撮影持出機能**（FR-009） |
| [signage/README.md](./modules/signage/README.md) | **デジタルサイネージモジュール** |
| [signage/signage-lite.md](./modules/signage/signage-lite.md) | **デジタルサイネージ軽量モード計画** |
| [documents/README.md](./modules/documents/README.md) | ドキュメントモジュール（将来実装予定） |
| [logistics/README.md](./modules/logistics/README.md) | 物流モジュール（将来実装予定） |

### APIリファレンス（api/）

APIの概要と詳細。

| ファイル | 説明 |
|---------|------|
| [overview.md](./api/overview.md) | API概要 |
| [auth.md](./api/auth.md) | 認証API |

### 要件定義（requirements/）

システム要件と仕様。

| ファイル | 説明 |
|---------|------|
| [system-requirements.md](./requirements/system-requirements.md) | システム要件定義 |

### 実践ガイド（guides/）

開発・デプロイ・運用の手順。

| ファイル | 説明 |
|---------|------|
| [development.md](./guides/development.md) | 開発環境セットアップ |
| [deployment.md](./guides/deployment.md) | デプロイ手順 |
| [production-setup.md](./guides/production-setup.md) | 本番環境セットアップ |
| [backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [csv-import-export.md](./guides/csv-import-export.md) | CSVインポート・エクスポート |
| [verification-checklist.md](./guides/verification-checklist.md) | 検証チェックリスト |
| [photo-loan-test-plan.md](./guides/photo-loan-test-plan.md) | **写真撮影持出機能 テスト計画**（FR-009） |
| [validation-7-usb-import.md](./guides/validation-7-usb-import.md) | USBインポート検証 |
| [signage-test-plan.md](./guides/signage-test-plan.md) | **デジタルサイネージ機能 テスト計画** |
| [signage-deployment.md](./guides/signage-deployment.md) | **デジタルサイネージ機能 デプロイメントガイド** |
| [signage-client-setup.md](./guides/signage-client-setup.md) | **デジタルサイネージクライアント端末セットアップガイド** |
| [ci-troubleshooting.md](./guides/ci-troubleshooting.md) | CI/CDトラブルシューティング |
| [operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [ai-handoff.md](./guides/ai-handoff.md) | **AI引き継ぎガイド**（別AIへの引き継ぎ時） |
| [status-agent.md](./guides/status-agent.md) | Raspberry Pi クライアント状態送信エージェント |

### トラブルシューティング（knowledge-base/, troubleshooting/）

問題解決のナレッジベース。**カテゴリ別に分割されています。**

| ファイル | 説明 |
|---------|------|
| [knowledge-base/index.md](./knowledge-base/index.md) | 📋 **ナレッジベース索引**（全40件の一覧） |
| [knowledge-base/api.md](./knowledge-base/api.md) | API関連（9件） |
| [knowledge-base/database.md](./knowledge-base/database.md) | データベース関連（3件） |
| [knowledge-base/ci-cd.md](./knowledge-base/ci-cd.md) | CI/CD関連（4件） |
| [knowledge-base/frontend.md](./knowledge-base/frontend.md) | フロントエンド関連（13件） |
| [knowledge-base/infrastructure.md](./knowledge-base/infrastructure.md) | インフラ関連（15件） |
| [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) | NFCリーダー固有の問題 |

### セキュリティ（security/）

セキュリティに関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [validation-review.md](./security/validation-review.md) | バリデーションレビュー |

---

## 🔗 コードとの対応関係

### 工具管理モジュール（tools）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/tools/README.md](./modules/tools/README.md) |
| **APIルート** | `apps/api/src/routes/tools/` |
| **サービス層** | `apps/api/src/services/tools/` |
| **Webページ** | `apps/web/src/pages/tools/` |
| **共通型** | `packages/shared-types/src/` |

### ドキュメントモジュール（documents）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/documents/README.md](./modules/documents/README.md) |
| **APIルート** | `apps/api/src/routes/documents/` |
| **サービス層** | `apps/api/src/services/documents/` |
| **Webページ** | `apps/web/src/pages/documents/` |

### デジタルサイネージモジュール（signage）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/signage/README.md](./modules/signage/README.md) |
| **アーキテクチャ** | [architecture/signage-module-architecture.md](./architecture/signage-module-architecture.md) |
| **APIルート** | `apps/api/src/routes/signage/` |
| **サービス層** | `apps/api/src/services/signage/` |
| **Webページ** | `apps/web/src/pages/signage/`, `apps/web/src/pages/admin/Signage*.tsx` |

### 物流モジュール（logistics）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/logistics/README.md](./modules/logistics/README.md) |
| **APIルート** | `apps/api/src/routes/logistics/` |
| **サービス層** | `apps/api/src/services/logistics/` |
| **Webページ** | `apps/web/src/pages/logistics/` |

### インフラ設定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) |
| **Docker設定** | `infrastructure/docker/` |
| **デプロイスクリプト** | `scripts/server/deploy.sh` |
| **バックアップスクリプト** | `scripts/server/backup.sh` |
| **リストアスクリプト** | `scripts/server/restore.sh` |
| **監視スクリプト** | `scripts/server/monitor.sh` |

---

## 📊 ドキュメント統計

| カテゴリ | ファイル数 |
|---------|-----------|
| アーキテクチャ | 3 |
| 設計決定 | 3 |
| モジュール仕様 | 6 |
| APIリファレンス | 2 |
| 要件定義 | 1 |
| 実践ガイド | 12 |
| トラブルシューティング | 9 |
| セキュリティ | 1 |
| **合計** | **37** |

---

## 📝 関連ドキュメント

- [EXEC_PLAN.md](../EXEC_PLAN.md): プロジェクト管理ドキュメント
- [README.md](../README.md): プロジェクト概要、ドキュメント体系の基本思想
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md): ドキュメントリファクタリング計画

---

## 📅 更新履歴

- 2025-11-27: 初版作成

