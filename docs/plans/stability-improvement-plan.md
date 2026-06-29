# システムの安定性向上 - 開発計画

## 目的

システムの安定性と信頼性を向上させる。要件定義に明示されていない改善として、エラーハンドリングの改善とログ出力の最適化を実施する。

## 背景

現在のシステムは基本的な機能要件を満たしているが、以下の点で改善の余地がある：

1. **エラーハンドリング**: エラーメッセージが詳細でない場合があり、問題の特定が困難
2. **ログ出力**: 一部のログ出力が最適化されていない可能性がある（デバッグログの環境変数制御は実装済み）

## スコープ

### 対象範囲

- API側のエラーハンドリング改善
- ログ出力の最適化
- エラー通知機能の検討（将来拡張）

### 対象外

- フロントエンドのエラーハンドリング（既に実装済み）
- パフォーマンス最適化（別タスク）
- 新機能の追加

## 実装計画

### Phase 1: エラーハンドリングの改善

#### 1.1 エラーメッセージの詳細化

**目的**: エラーメッセージをより詳細で有用な情報を含むように改善する

**タスク**:
- [x] APIエラーレスポンスに詳細情報を追加 ✅ **完了**
  - エラーコードの統一
  - エラーコンテキスト（リクエストID、タイムスタンプ、エラー発生箇所）の追加
  - ユーザー向けメッセージと開発者向けメッセージの分離
- [x] Prismaエラーの詳細化 ✅ **完了**
  - P2002（一意制約違反）の詳細化
  - P2003（外部キー制約違反）の詳細化
  - その他のPrismaエラーの詳細化
- [x] バリデーションエラーの詳細化 ✅ **完了**
  - Zodバリデーションエラーの詳細化
  - フィールドごとのエラーメッセージの改善

**関連ファイル**:
- `apps/api/src/lib/errors.ts`
- `apps/api/src/lib/error-handler.ts`
- `apps/api/src/routes/**/*.ts`（各ルートハンドラー）

**成功基準**:
- エラーレスポンスに`errorCode`、`requestId`、`timestamp`が含まれる
- Prismaエラーの詳細情報が適切に表示される
- バリデーションエラーの詳細情報が適切に表示される

#### 1.2 エラーログの構造化

**目的**: エラーログを構造化して、問題の特定と分析を容易にする

**タスク**:
- [x] エラーログの構造化 ✅ **完了**
  - エラーログに`requestId`、`userId`、`method`、`url`、`errorCode`を含める
  - エラースタックトレースの適切な記録
  - エラーコンテキストの追加（リクエストボディ、クエリパラメータなど、機密情報を除く）
- [x] エラーログレベルの適切な設定 ✅ **完了**
  - `error`レベル: システムエラー、予期しないエラー
  - `warn`レベル: 警告、リトライ可能なエラー
  - `info`レベル: 情報、デバッグ情報

**関連ファイル**:
- `apps/api/src/lib/logger.ts`
- `apps/api/src/lib/error-handler.ts`

**成功基準**:
- エラーログが構造化され、問題の特定が容易になる
- エラーログレベルが適切に設定される

#### 1.3 エラー通知機能の検討（将来拡張）

**目的**: 重大なエラーが発生した際に通知を送信する機能の検討

**要件定義**:
- **通知対象のエラーレベル**: `error`レベルのエラーのみ（`warn`は除外）
- **通知方法の候補**:
  1. **メール通知**: SMTPサーバー経由で管理者にメール送信
  2. **Slack通知**: Slack Webhook経由でチャンネルに通知
  3. **Webhook通知**: カスタムWebhookエンドポイントにPOSTリクエスト
- **通知頻度の制御**:
  - 同じエラーコードの通知は1時間に1回まで（レート制限）
  - エラーコード + リクエストパスの組み合わせで重複通知を防止
- **実装方針**:
  - 優先度: 中（現在のシステムでは手動ログ確認で十分）
  - 実装方法: エラーハンドラーに通知送信ロジックを追加
  - 設定: 環境変数で通知方法と通知先を設定可能にする

**成功基準**:
- ✅ エラー通知機能の要件定義が完了する
- ✅ 実装方針が決定する

### Phase 2: ログ出力の最適化

#### 2.1 ログレベルの適切な設定

**目的**: ログレベルを適切に設定し、不要なログを削減する

**タスク**:
- [x] 環境変数によるログレベルの制御 ✅ **完了**
  - `LOG_LEVEL`環境変数でログレベルを制御（`debug`、`info`、`warn`、`error`）
  - デフォルトは`info`レベル
  - 本番環境では`warn`レベルを推奨
- [x] 各ログ出力のレベル見直し ✅ **完了**
  - デバッグ情報は`debug`レベル
  - 通常の情報は`info`レベル
  - 警告は`warn`レベル
  - エラーは`error`レベル

**関連ファイル**:
- `apps/api/src/lib/logger.ts`
- `apps/api/src/config/env.ts`

**成功基準**:
- 環境変数でログレベルを制御できる
- 各ログ出力のレベルが適切に設定される

#### 2.2 ログローテーションの設定

**目的**: ログファイルのサイズを制御し、ディスク容量を節約する

**タスク**:
- [x] Docker環境でのログローテーション設定
  - Docker Composeの`logging`設定でログローテーションを設定
  - ログファイルの最大サイズ（10MB）、保持ファイル数（3ファイル）、圧縮を設定
- [x] ログローテーション設定のドキュメント化
  - 設定方法の説明
  - 推奨設定の提示

**関連ファイル**:
- `infrastructure/docker/docker-compose.server.yml`

**成功基準**:
- ✅ Docker環境でログローテーションが設定される
- ✅ ログローテーション設定のドキュメントが作成される

**実装内容**:
- `api`サービスと`web`サービスに`logging`設定を追加
- 最大サイズ: 10MB
- 保持ファイル数: 3ファイル（合計30MB）
- 圧縮: 有効（古いログファイルを自動圧縮）

#### 2.3 ログ分析ツールの導入検討（将来拡張）

**目的**: ログ分析ツールの導入を検討し、問題の早期発見を可能にする

**要件定義**:
- **必要な機能**:
  1. **ログ検索**: エラーコード、リクエストID、ユーザーID、日時範囲で検索
  2. **フィルタリング**: エラーレベル、エラーコード、HTTPステータスコードでフィルタリング
  3. **アラート**: 特定のエラーコードが一定回数以上発生した場合にアラート
  4. **ダッシュボード**: エラー発生率、エラーコード別の統計を可視化
- **導入コストの評価**:
  - **無料オプション**: Docker環境で`Loki` + `Grafana`を導入（推奨）
  - **有料オプション**: Datadog、SentryなどのSaaSサービス（月額費用が発生）
- **運用方法**:
  - Docker ComposeにLoki + Grafanaサービスを追加
  - PinoロガーからLokiにログを送信
  - Grafanaでダッシュボードを作成
- **実装方針**:
  - 優先度: 低（現在のシステム規模では手動ログ確認で十分）
  - 実装方法: Docker ComposeにLoki + Grafanaを追加、PinoロガーをLokiに接続
  - 設定: 環境変数でLokiのURLを設定可能にする

**成功基準**:
- ✅ ログ分析ツールの要件定義が完了する
- ✅ 実装方針が決定する

## 実装順序

1. **Phase 1.1**: エラーメッセージの詳細化（最優先）
2. **Phase 1.2**: エラーログの構造化
3. **Phase 2.1**: ログレベルの適切な設定
4. **Phase 2.2**: ログローテーションの設定
5. **Phase 1.3**: エラー通知機能の検討（将来拡張）
6. **Phase 2.3**: ログ分析ツールの導入検討（将来拡張）

## 成功基準

### Phase 1完了時

- ✅ エラーメッセージが詳細で有用な情報を含む
- ✅ エラーログが構造化され、問題の特定が容易になる
- ✅ エラー通知機能の要件定義が完了する

### Phase 2完了時

- ✅ ログレベルが適切に設定され、不要なログが削減される
- ✅ ログローテーションが設定され、ディスク容量が節約される
- ✅ ログ分析ツールの要件定義が完了する

## 実装完了サマリー

### 実装済み機能

1. **エラーメッセージの詳細化**
   - すべてのエラーレスポンスに`errorCode`、`requestId`、`timestamp`を含める
   - Prismaエラー（P2002、P2003）の詳細メッセージ生成
   - Zodバリデーションエラーの詳細化

2. **エラーログの構造化**
   - 統一フォーマット（`buildStructuredErrorLog`関数）
   - すべてのエラーログに`errorCode`、`requestId`、`method`、`url`、`userId`を含める
   - エラースタックトレースの構造化記録

3. **ログレベルの環境変数制御**
   - `LOG_LEVEL`環境変数で制御（`debug`、`info`、`warn`、`error`）
   - 環境に応じたデフォルト値（本番環境は`warn`、開発環境は`info`）

4. **Dockerログローテーション**
   - 最大サイズ: 10MB
   - 保持ファイル数: 3ファイル（合計30MB）
   - 圧縮: 有効

### 将来拡張（要件定義完了）

1. **エラー通知機能**: メール/Slack/Webhook通知（優先度: 中）
2. **ログ分析ツール**: Loki + Grafana導入（優先度: 低）

### 実装完了日

- **Phase 1.1**: ✅ 2025-11-30 完了
- **Phase 1.2**: ✅ 2025-11-30 完了
- **Phase 2.1**: ✅ 2025-11-30 完了
- **Phase 2.2**: ✅ 2025-11-30 完了（既に完了済み）
- **実機テスト**: ✅ 2025-11-30 完了（Raspberry Pi 5で検証済み）

### 次のステップ

1. ✅ **実機テスト**: Raspberry Pi 5で実装をテストし、エラーログの構造化とログローテーションが正常に動作することを確認 → **完了**
2. ✅ **ドキュメント更新**: エラーハンドリングガイドとログ出力ガイドを作成 → **完了**
3. **mainブランチへのマージ**: 実装完了後、`main`ブランチにマージ

## 2026-06-29: Pi4 SDカード予防保全 v1

### source_of_truth

この節を、Pi4 SDカード予防保全 v1 の進捗、仕様、検証結果、未完了事項の正本とする。詳細はここに集約し、索引文書や`EXEC_PLAN.md`には重複記録しない。

### 進捗

- 作業ブランチ: `feat/pi4-sd-card-health-monitor`
- 対象コミット:
  - `29a1c993 feat: add pi4 sd card health monitoring`
  - `5d0e754b fix: throttle pi4 storage health checks`
  - `ed5fb29b feat: notify slack on storage health alerts`
- 実装済み:
  - Pi4キオスク向けのSDカード破損兆候監視
  - 監視頻度の抑制
  - ローカル成功ログの削減
  - storage health異常時のAlert作成とSlack配送キュー登録
- DB schemaと既存API schemaは変更していない。

### v1仕様

- 有効化対象は`kiosk`グループのPi4のみ。Pi3、Pi5、TalkPlazaはv1では未有効化。
- 通常のステータス送信は毎分継続する。
- SDヘルスチェック本体は毎分実行しない。既定は`STORAGE_HEALTH_INTERVAL_SECONDS=3600`で、最終実行時刻はtmpfs上の`/run/raspi-status-agent/storage-health-last-run`に保持し、SDカードへの不要な書き込みを避ける。
- `STATUS_AGENT_LOG_SUCCESS=0`を既定にし、成功時のローカルログ書き込みを抑制する。異常時はローカルログとAPI送信ログに残す。
- 1日1回まで落とす案は保留。kernel logの短時間エラーを拾うため、v1は1時間間隔で開始し、運用データを見て日次化を再判断する。
- 監視シグナル:
  - `/proc/mounts`でroot filesystemが`ro`なら`ERROR`
  - `journalctl -k`またはfallbackの`dmesg`で`mmc`、`I/O error`、`EXT4-fs error`、`Buffer I/O error`、read-only remount系を検出したら`ERROR`
  - rootディスク使用率またはinode使用率が80%以上なら`WARN`、90%以上なら`ERROR`
  - `vcgencmd get_throttled`で現在の低電圧は`ERROR`、現在のthrottleまたは温度制限は`WARN`
- `ClientLog.context`には`category: "storage_health"`、`signal`、`rootSource`、`raw`、`observedAt`を入れる。
- 1回のPOSTに追加するstorage healthログは最大10件。

### 実装箇所

- status agent:
  - [storage_health.py](../../clients/status-agent/storage_health.py)
  - [status-agent.py](../../clients/status-agent/status-agent.py)
  - [status-agent.conf.j2](../../infrastructure/ansible/templates/status-agent.conf.j2)
  - [inventory.yml](../../infrastructure/ansible/inventory.yml)
- API通知:
  - [client-telemetry.service.ts](../../apps/api/src/services/clients/client-telemetry.service.ts)
- 運用ガイド:
  - [status-agent guide](../guides/status-agent.md)
  - [local alerts guide](../guides/local-alerts.md)

### Slack通知仕様

- APIは`WARN`または`ERROR`の`ClientLog`で`context.category === "storage_health"`を検出すると、DB transaction内で`Alert`と`AlertDelivery(channel=SLACK, routeKey=ops)`を作成する。
- `type`は`storage-health-${signal}`、severityは`WARN -> WARNING`、`ERROR -> ERROR`。
- fingerprintはclient、signal、type単位。同じfingerprintの未acknowledged alertが残っている間は新規通知を作らず、Slack連投を抑制する。
- Alert作成に失敗してもstatus ingestは失敗させず、APIログにwarnを残す。
- 本番で必要な既存設定は`ALERTS_DISPATCHER_MODE=db`、`ALERTS_DB_DISPATCHER_ENABLED=true`、`ALERTS_SLACK_WEBHOOK_OPS`。

### 検証結果

- Python unit:
  - `python3 -m unittest discover -s clients/status-agent/tests -v`成功
- API unit:
  - `pnpm --filter @raspi-system/api test -- src/services/clients/__tests__/client-telemetry.service.test.ts`成功
- API integration:
  - 一時Postgres `pgvector/pgvector:pg16`でmigrations 119件を適用
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/clients.integration.test.ts`成功
  - storage healthログが`ClientLog`、`Alert`、`AlertDelivery(SLACK, ops)`として保存されることを確認
  - 同じsignalの未acknowledged alertが重複作成されないことを確認
  - 一時DBコンテナは検証後に削除済み
- API checks:
  - `pnpm --filter @raspi-system/api lint`成功
  - `pnpm --filter @raspi-system/api build`成功
- CI:
  - GitHub Actions run `28357286183`は成功
  - `lint-build-unit`、`security-docker`、`api-db-and-infra`、`e2e-smoke`、`e2e-tests`が成功
- 実機:
  - Pi5 serverへ`ed5fb29b`をデプロイ成功
  - deploy run id: `20260629-171426-7629`
  - API containerはhealthy
  - `https://127.0.0.1/api/system/health`は`status: "ok"`
  - DB dispatcherとSlack ops webhook設定が有効であることを確認
  - deploy時のDB dispatcher runで`processed=1 sent=1 failed=0 suppressed=0`を確認

### 未完了事項

- 本番DBに人工のstorage health異常を投入する検証は未実施。実データを汚さないため、Slack着弾は既存dispatcher動作確認までに留めた。
- Pi4実機での次回確認項目:
  - `systemctl status status-agent.timer`
  - `journalctl -u status-agent.service -n 50`
  - `/admin/clients`の最新storage healthログ
  - 異常検出時のSlack通知
- 専用ダッシュボード、履歴集計、交換判断ワークフローは次フェーズ。v1は既存`ClientLog`と`Alert`を使う。
- SDカード摩耗低減の追加策として、overlayfs、tmpfs拡張、read-only root化は未実装。監視とログ削減を先に安定させる。
- 1時間間隔を日次へ下げるかは、数日分の実機ログと通知頻度を見て判断する。

## 関連ドキュメント

- [システム要件定義](../requirements/system-requirements.md)（NFR-004: 保守性）
- [エラーハンドリングガイド](../guides/error-handling.md) ✅ **作成完了**
- [ログ出力ガイド](../guides/logging.md) ✅ **作成完了**

## 注意事項

- 機密情報（パスワード、トークンなど）はログに出力しない
- パフォーマンスへの影響を考慮する（過度なログ出力は避ける）
- 既存のログ出力との互換性を保つ
