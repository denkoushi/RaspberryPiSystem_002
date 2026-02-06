# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> - プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照してください。
> - ドキュメント体系の基本思想については [README.md](../README.md) の「ドキュメント体系の基本思想」セクションを参照してください。

---

## 🎯 目的別インデックス

### 🆕 最新アップデート（2026-02-06）

- **✅ 生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化**: 生産スケジュールの登録製番上限を8件から20件に拡張し、サイネージに20件を表示できるように最適化。**実装内容**: API側（Zodスキーマ・正規化関数）、フロントエンド側（正規化関数）、サイネージ側（データソース・レンダラー）のすべての箇所で上限を20件に統一。サイネージのカード高さを`210 * scale`から`105 * scale`（半分）に変更し、20件表示でも画面に収まるように最適化。カードスケールの基準値も`260 * scale`から`130 * scale`（半分）に変更。20件表示のテストケースを追加し、CI成功・デプロイ成功・動作確認完了。**学んだこと**: 制限値が複数箇所に分散している場合は、すべての箇所を同時に更新する必要がある。初回実装ではサイネージ側のみを変更したが、キオスクUI側の制限が残っていたため、API側とフロントエンド側も変更が必要だった。詳細は [knowledge-base/api.md#kb-231](./knowledge-base/api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) / [knowledge-base/infrastructure/signage.md#kb-231](./knowledge-base/infrastructure/signage.md#kb-231-生産スケジュールサイネージアイテム高さの最適化20件表示対応) を参照。

- **✅ Gmail認証切れ時のSlack通知機能追加・実機調査と回復**: CSVインポート定期実行時にGmail認証切れが発生しても、管理者に通知されずCSV取り込みが失敗し続けていた問題を解決。**実装内容**: CSVインポートスケジューラーにGmail認証切れ検知機能を追加し、定期実行時（手動実行時は通知しない）に`GmailReauthRequiredError`または`invalid_grant`エラーを検知してAlerts Platform経由でSlack通知を送信。アラートタイプ`gmail-oauth-expired`を`ops`チャンネル（`#rps-ops`）にルーティングし、fingerprintベースのdedupeで連続通知を抑制（1回のみ通知）。**実機調査**: Pi3のサイネージ右ペイン（計測機器持出返却）が更新されていない問題を調査し、Gmail OAuth認証トークンが期限切れであることを確認。管理コンソールでOAuth再認証を実行して回復し、手動実行で189行が正常に追加されることを確認。詳細は [knowledge-base/api.md#kb-229](./knowledge-base/api.md#kb-229-gmail認証切れ時のslack通知機能追加) / [knowledge-base/api.md#kb-230](./knowledge-base/api.md#kb-230-gmail認証切れの実機調査と回復) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md#gmail認証切れ通知機能2026-02-06実装) を参照。

### 🆕 最新アップデート（2026-02-03）

- **✅ Fastify v5移行完了・CIゲート復帰**: Fastify v4の監査high脆弱性を解消するため、Fastify v5への移行を完了。**実施内容**: Fastify本体・`@fastify/*`・`fastify-plugin`をv5互換へ更新、既知の破壊点（`reply.getResponseTime()` → `reply.elapsedTime`、error handlerの`unknown`対応）を最小差分で解消。段階デプロイ（Pi5→Pi4→Pi3）を実施し、全デバイスで正常動作を確認。CIの`pnpm audit --audit-level=high`をブロッキングに復帰し、GitHub Actions CIで全ステップ成功を確認（Run ID: 21614498898）。**デプロイ安定化の追加知見**: Ansible preflightの`ping`は`ansible_become=false`を強制、`systemctl`参照系チェックは`become: false`を明示することでPi3系の制限sudo環境で詰まりにくい。詳細は [knowledge-base/ci-cd.md#kb-227](./knowledge-base/ci-cd.md#kb-227-pnpm-audit-のhighでciが失敗するfastify脆弱性--fastify-v5移行の影響範囲調査) / [knowledge-base/infrastructure/signage.md#kb-087](./knowledge-base/infrastructure/signage.md#kb-087-pi3-status-agenttimer-再起動時のsudoタイムアウト) / [knowledge-base/infrastructure/ansible-deployment.md#kb-216](./knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) を参照。

### 🆕 最新アップデート（2026-02-02）

- **✅ キオスク入力フィールド保護ルールの実装・実機検証完了**: キーボード誤入力によるAPIキー/IDの破損問題を根本解決。**実装内容**: `KioskHeader.tsx`の入力フィールドを完全削除し、`<span>`要素による表示のみに変更。各キオスクページから`useLocalStorage('kiosk-client-key')`の使用を削除し、`DEFAULT_CLIENT_KEY`を直接使用。`client.ts`の初期化時に`localStorage`に`DEFAULT_CLIENT_KEY`を強制設定し、`axios` response interceptorで401エラー（`INVALID_CLIENT_KEY`）を検知して自動復旧機能を実装。**実機検証結果**: IDとAPIキーが編集不可に改善されていることを確認、生産スケジュールの値が正常に表示されることを確認。自動復旧機能は後日検証予定。デプロイ後の入力欄が残る問題はWebコンテナの再ビルドが必要であることを確認。詳細は [knowledge-base/frontend.md#kb-225](./knowledge-base/frontend.md#kb-225-キオスク入力フィールド保護ルールの実装と実機検証) / [knowledge-base/kiosk-input-protection-investigation.md](./knowledge-base/kiosk-input-protection-investigation.md) / [guides/api-key-policy.md](./guides/api-key-policy.md) を参照。

### 🆕 最新アップデート（2026-01-31）

- **✅ Pi4メンテナンス画面の修正・SSH接続失敗とGit権限問題の解決**: Pi4デプロイ時のメンテナンス画面が`--limit raspberrypi4`以外でも表示されるように改善。`should_enable_kiosk_maintenance()`関数を追加し、デプロイ対象ホストにキオスククライアントが含まれるかを動的に判定するように修正。Fast-pathで一般的な`--limit`パターン（`*raspberrypi4*`, `clients`, `server:clients`, `all`）では即座に有効化。**SSH接続失敗の原因調査**: MacからPi5へのSSH接続が`Connection refused`で失敗した問題を調査。原因は誤ったユーザー名（`tsudatakashi`）での認証試行によりfail2banがIP Banしたこと。RealVNC経由でPi5にアクセスし、`sudo fail2ban-client set sshd unbanip 100.64.230.31`でBan解除。**Git権限問題の解決**: デタッチ実行時に`.git`ディレクトリがroot所有でGit操作が失敗した問題を解決。過去のAnsible実行で`become: true`により`.git`がroot所有になっていたため、`sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/.git`で所有権を修正。デプロイ前チェックリストにGit権限とfail2ban Banの確認を追加。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-183](./knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) / [knowledge-base/infrastructure/ansible-deployment.md#kb-218](./knowledge-base/infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行) / [knowledge-base/infrastructure/ansible-deployment.md#kb-219](./knowledge-base/infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗) / [guides/deployment.md](./guides/deployment.md) / [guides/mac-ssh-access.md](./guides/mac-ssh-access.md) を参照。

- **✅ サイネージ可視化ダッシュボード機能実装・デプロイ再整備完了**: サイネージに可視化ダッシュボード機能を統合し、デプロイプロセスでコード変更時のDocker再ビルドを確実化。**可視化ダッシュボード機能**: データソース（計測機器、CSVダッシュボード行）とレンダラー（KPIカード、棒グラフ、テーブル）をFactory/Registryパターンで実装し、疎結合・モジュール化・スケーラビリティを確保。サイネージスロットに`visualization`を追加し、`layoutConfig`で可視化ダッシュボードを指定可能に。管理コンソールで可視化ダッシュボードのCRUD UIを実装。**デプロイ再整備**: Ansibleでリポジトリ変更検知（`repo_changed`）を実装し、コード変更時に`api/web`を`--force-recreate --build`で再作成するように修正。`scripts/update-all-clients.sh`の`git rev-list`解析を`awk`で改善し、タブ文字を含む場合でも正常に動作するように修正。実機検証でコード変更時のDocker再ビルドが正常に動作することを確認（正のテスト: コード変更→再ビルド、負のテスト: コード変更なし→再ビルドなし）。サイネージプレビューで可視化ダッシュボードが正常に表示されることを確認。CI成功。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-217](./knowledge-base/infrastructure/ansible-deployment.md#kb-217-デプロイプロセスのコード変更検知とdocker再ビルド確実化) / [modules/signage/README.md](./modules/signage/README.md) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Pi5ストレージメンテナンススクリプト修正完了（KB-130追加調査）**: Pi5のストレージ使用量が再び24%（約233GB）に増加した問題を調査・解決。`storage-maintenance.sh`の`find -delete -print | wc -l`の順序問題により、`signage_*.jpg`ファイルが22,412件（8.2GB）削除されずに蓄積していた。Docker Build Cache 196.1GB、未使用Docker Images 182.4GBも蓄積。手動クリーンアップ実行後、スクリプトを修正（ファイル数を先にカウントしてから削除、`docker builder du`のサイズ取得のフォールバック追加）。ストレージ使用量24%→2%に改善、CI成功。詳細は [knowledge-base/infrastructure/miscellaneous.md#kb-130](./knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) / [guides/operation-manual.md](./guides/operation-manual.md) を参照。

### 🆕 最新アップデート（2026-01-30）

- **✅ Tailscale主運用への移行計画の実機検証完了**: Tailscaleを主（通常運用）とし、local（LAN）を緊急時のみに限定する方針で実装した計画の実機検証を完了。Pi5/Pi4/Pi3の全デバイスでデプロイが成功し、Tailscale経由での接続が正常に動作することを確認。Pi3デプロイ時に`post_tasks`で`unreachable=1`が発生したが、実際にはサービス（`signage-lite-watchdog.timer`、`signage-daily-reboot.timer`）は正常動作しており、デプロイ全体は成功（`failed=0`、`state: success`）。これは一時的なSSH接続問題であり、サービス起動には影響していない。ナレッジベースにKB-216を追加、デプロイガイドに注意事項を追記。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-216](./knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) / [guides/deployment.md](./guides/deployment.md) / [decisions/ADR-20260130-tailscale-primary-operations.md](./decisions/ADR-20260130-tailscale-primary-operations.md) を参照。

### 🆕 最新アップデート（2026-01-29）

- **🔄 Gmail OAuthリフレッシュトークンの7日間制限問題への対応中**: Gmail OAuth認証が約1週間で切れてしまう問題の根本原因を特定。Google Cloud Consoleでアプリが「未検証」状態のため、Googleの仕様によりリフレッシュトークンが7日間で期限切れになっていた。解決のため、GitHub Pagesでプライバシーポリシーページとホームページを作成・公開（`docs/privacy-policy.html`、`docs/index.html`）。Google Cloud Consoleでブランディング情報を入力し、検証をリクエスト済み。Googleの審査完了後、リフレッシュトークンが無期限になる予定。ナレッジベースにKB-215を追加。詳細は [knowledge-base/api.md#kb-215](./knowledge-base/api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) を参照。

- **✅ デプロイ整備（KB-200）の全デバイス実機検証完了・ブランチ指定必須化**: デプロイ標準手順の安定性と安全性を向上させる「デプロイ整備」機能の全デバイス実機検証を完了。fail-fastチェック（未commit/未push防止）、デタッチモード（`--detach`）とログ追尾（`--attach`/`--follow`）、プレフライトチェック（Pi3のサービス停止・GUI停止）、リモートロック、`git reset --hard origin/<branch>`修正、**ブランチ指定必須化**（デフォルトmain削除で誤デプロイ防止）を実装。Pi5/Pi4/Pi3の全デバイスで実機検証成功。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-200](./knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ キオスク持出タブの持出中アイテムが端末間で共有されない問題の修正完了**: キオスクの持出タブ（NFCタブ・写真タブ）で表示する「持出中」一覧が端末ごとに分かれており、Pi4で持ち出したアイテムがMacブラウザで開いたキオスクに表示されない問題を修正。原因は`KioskPhotoBorrowPage.tsx`が`useActiveLoans(resolvedClientId, ...)`でローカル端末の`clientId`を渡しており、APIがその端末の貸出のみ返していたこと。`useActiveLoans(undefined, resolvedClientKey)`に変更し、持出タブ・返却一覧は全端末の持出中を表示するように統一。CI成功、デプロイ（Pi5・Pi4対象）、実機検証完了。ナレッジベースにKB-211を追加。詳細は [knowledge-base/frontend.md#kb-211](./knowledge-base/frontend.md#kb-211-キオスク持出タブの持出中アイテムが端末間で共有されない問題) / [guides/api-key-policy.md](./guides/api-key-policy.md) / [modules/tools/api.md](./modules/tools/api.md) を参照。

### 🆕 最新アップデート（2026-01-28）

- **✅ セキュリティ評価の実機検証完了・評価修正**: OWASP Top 10 2021、IPA「安全なウェブサイトの作り方」、CISベンチマーク、NIST Cybersecurity Framework等の標準的なセキュリティ評価指標に基づいて実機検証を実施。ポート露出・fail2ban監視・security-monitorは正常動作を確認。ルーター（IODATA UD-LTA/UE）のデフォルト設定を確認し、「外部露出」という表現を「ローカルネットワーク内での待受」に修正。ルーターのSPIファイアウォールが有効でポート転送が未設定の場合、インターネットからの直接アクセスはブロックされることを確認。バックアップ/復元検証は暗号化キー設定後に再実施が必要。USBオフライン運用はバックアップファイル生成後に再実施が必要。実機検証スクリプト（`scripts/security/verify-production-security.sh`）を作成し、証跡ファイルを構造化して保存。評価報告書を更新し、ギャップ一覧・トップリスク10を更新。ナレッジベースにKB-213、KB-214を追加。詳細は [knowledge-base/infrastructure/security.md#kb-213](./knowledge-base/infrastructure/security.md#kb-213-セキュリティ評価の実機検証2026-01-28) / [knowledge-base/infrastructure/security.md#kb-214](./knowledge-base/infrastructure/security.md#kb-214-ルーターのデフォルト設定によるポート露出評価の誤解解消) / [security/evaluation-report.md](./security/evaluation-report.md) / [security/evidence/production-verification-guide.md](./security/evidence/production-verification-guide.md) を参照。

### 🆕 最新アップデート（2026-01-28）

- **✅ 生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正完了**: KB-209で実装された検索状態共有機能が、その後`search-history`エンドポイントに変更されたことで端末間共有ができなくなっていた問題を修正。git履歴とドキュメントを確認して原因を特定し、フロントエンドを`search-state`エンドポイント使用に戻し、`activeQueries`（登録製番）を含む検索状態を端末間で共有できるように修正。資源フィルタ（`activeResourceCds`, `activeResourceAssignedOnlyCds`）も共有。デバッグログコードを削除。既存の`search-state`エンドポイント（共有キー`'shared'`）をそのまま使用し、フロントエンドのみを修正することで最小変更で対応。CI成功（全ジョブ成功）、デプロイ成功、実機検証完了（端末間共有が正常に動作）。ナレッジベースにKB-210を追加。詳細は [knowledge-base/api.md#kb-210](./knowledge-base/api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正) / [plans/production-schedule-kiosk-execplan.md](./plans/production-schedule-kiosk-execplan.md) を参照。

### 🆕 最新アップデート（2026-01-22）

- **✅ デプロイ検証強化（DBゲート追加・fail-fast化）実装・実機検証完了**: デプロイが成功したように見えてもDBマイグレーション未適用でテーブル不存在エラーが発生する問題を根本解決。Pi5単体デプロイ（`deploy.sh`）にDB整合性ゲートを追加し、migrate失敗時にfail-fast。`verification-map.yml`にDBゲート（migrate status、`_prisma_migrations`存在、必須テーブル存在）を追加し、`verifier.sh`でSSH経由でPi5上のDBチェックを実行。`verifier.sh`にTLS自己署名対応（`insecure_tls`）とcommand変数展開を実装。`health-check.yml`にサーバー側DBチェックを追加。`backup.sh`をHTTPS対応に変更。`MeasuringInstrumentLoanEvent`マイグレーションを追加。実機検証で全DBゲート/HTTPゲート/スモークテストがpassすることを確認。デプロイタイムアウト問題（240秒不足）を発見し、`CI=1`で再実行して解決。ナレッジベースにKB-191を更新。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-191](./knowledge-base/infrastructure/ansible-deployment.md#kb-191-デプロイは成功したのにdbが古いテーブル不存在) / [guides/deployment.md](./guides/deployment.md) を参照。

### 🆕 最新アップデート（2026-01-24）

- **✅ 旧キー自動削除機能の実装完了（backup.json保存時の自動クリーンアップ）**: 管理コンソールのバックアップタブで「設定の健全性: 警告」が表示される問題を根本解決。原因は`backup.json`の`storage.options`直下に旧キー（`accessToken`, `refreshToken`, `appKey`, `appSecret` for Dropbox; `clientId`, `clientSecret`, `redirectUri`, `subjectPattern`, `fromEmail`, `gmailAccessToken`, `gmailRefreshToken` for Gmail）が残っていたこと。KB-168で手動削除方法は記録されていたが、保存時に自動的に削除する機能がなかった。`BackupConfigLoader.save()`メソッドに`pruneLegacyKeysOnSave()`静的メソッドを追加し、保存時に新構造（`options.dropbox.*`, `options.gmail.*`）が存在し値が非空の場合のみ旧キーを自動削除するように実装。後方互換性を維持し、新構造の値が空の場合は旧キーを保持。ユニットテストを追加して自動削除ロジックの動作を確認。CI成功、デプロイ完了、実機検証完了（デプロイ後、`BackupConfigLoader.load()`と`BackupConfigLoader.save()`を実行し、ヘルスチェックで警告が解消されたことを確認）。ナレッジベースにKB-196を追加。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-196](./knowledge-base/infrastructure/backup-restore.md#kb-196-旧キー自動削除機能の実装backupjson保存時の自動クリーンアップ) / [knowledge-base/infrastructure/backup-restore.md#kb-168](./knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法) を参照。

### 🆕 最新アップデート（2026-01-23）

- **✅ スケジュール自動実行時のバックアップ履歴記録問題修正完了**: 管理コンソールのバックアップタブの履歴ボタンから履歴を見ると、スケジュールの数と履歴の数が一致しない問題を解決。原因は`BackupScheduler.executeBackup`メソッドに履歴作成・更新処理が実装されていなかったこと。手動実行（`/api/backup`）では履歴が記録されていたが、スケジュール自動実行では記録されていなかった。`BackupScheduler.executeBackup`に`BackupHistoryService.createHistory()`、`completeHistory()`、`failHistory()`を追加し、手動実行と同じロジックを適用。CI成功、デプロイ完了。次回のスケジュール実行（毎日4時、5時、6時、毎週日曜2時）で履歴が記録されることを確認予定。ナレッジベースにKB-194を追加。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-194](./knowledge-base/infrastructure/backup-restore.md#kb-194-スケジュール自動実行時にバックアップ履歴が記録されない問題) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) を参照。

- **✅ Dropbox 409 Conflictエラー修正完了（labelサニタイズ未実施によるパス不正）**: 手動バックアップ実行時に、Dropbox APIから`409 Conflict`エラーが発生する問題を解決。原因は`BackupService.buildPath()`メソッドで、`options.label`がパスに直接埋め込まれていたこと。labelに`/`や`\`などのパス区切り文字が含まれると、Dropboxのパス構造が不正になり、APIが`409 Conflict`として拒否する。`sanitizePathSegment()`メソッドを追加し、制御文字除去、パス区切り文字の`_`への置換、空白の正規化、長さ制限（64文字）を実装。`buildPath()`でlabelをサニタイズしてから使用するように修正。テストケースを追加して境界値テストを実施。CI成功、デプロイ完了、実機検証完了。ナレッジベースにKB-195を追加。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-195](./knowledge-base/infrastructure/backup-restore.md#kb-195-dropbox-409-conflictエラーlabelサニタイズ未実施によるパス不正) / [guides/backup-dropbox-status-investigation.md](./guides/backup-dropbox-status-investigation.md) / [guides/backup-dropbox-status-investigation-results.md](./guides/backup-dropbox-status-investigation-results.md) を参照。

- **✅ 管理コンソールのサイネージプレビュー機能実装完了**: 管理コンソールに「サイネージプレビュー」タブを追加し、Pi3で表示中のサイネージ画像をプレビューできるように実装。30秒ごとの自動更新と手動更新ボタンを実装。最初は`fetch`で実装していたが、JWT認証ヘッダーが付与されず401エラーが発生。`axios(api)`クライアントに変更することで、JWT認証ヘッダーが自動付与され、正常に画像を取得・表示できるようになった。Blob取得と`URL.createObjectURL`による画像表示、メモリリーク防止のための`URL.revokeObjectURL`実装を完了。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-192を追加。詳細は [knowledge-base/frontend.md#kb-192](./knowledge-base/frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ CSVインポートスケジュールの間隔設定機能実装完了**: CSVインポートスケジュールが1日1回（曜日+時刻）のみで、10分ごとなどの細かい頻度設定ができなかった問題を解決。UIに「間隔（N分ごと）」モードを追加し、5分、10分、15分、30分、60分のプリセットを提供。最小5分間隔の制限をUI/API/スケジューラーの3層で実装（多層防御）。既存のcronスケジュールを解析し、UIで編集可能かどうかを判定する機能を実装。cron文字列を人間可読形式で表示する機能を追加（例: `"*/10 * * * 1,3"` → `"毎週月、水の10分ごと"`）。cron解析・生成ロジックをユーティリティ関数として分離し、保守性を向上。UIユニットテストとAPI統合テストを追加。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-191を追加。詳細は [knowledge-base/api.md#kb-191](./knowledge-base/api.md#kb-191-csvインポートスケジュールの間隔設定機能実装10分ごと等の細かい頻度設定) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVダッシュボードの列幅計算改善完了**: Pi3で表示中のサイネージのCSVダッシュボードで、フォントサイズ変更が反映されず、列幅が適切に追随しない問題を解決。列幅計算にフォントサイズを反映し、最初のページだけでなく全データ行を走査して最大文字列を考慮するように改善。日付列などフォーマット後の値で幅を計算するように修正。列名（ヘッダー）は`fontSize+4px`で太字表示されるため、列幅計算にも含めるように改善（太字係数1.06を適用）。列幅の合計がキャンバス幅を超える場合、比例的に縮小する機能を実装。仮説駆動デバッグ（fetchベースのNDJSONログ出力）により根本原因を特定。列幅計算の動作を検証するユニットテストを追加（5件すべてパス）。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-193を追加。詳細は [knowledge-base/infrastructure/signage.md#kb-193](./knowledge-base/infrastructure/signage.md#kb-193-csvダッシュボードの列幅計算改善フォントサイズ反映全行考慮列名考慮) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-26）

- **✅ 生産スケジュール画面のパフォーマンス最適化と検索機能改善完了**: 生産スケジュール画面で3000件のデータを表示する際、Pi4で初期表示に8秒、アイテム完了操作に23秒かかる問題を解決。**API側**: `q`パラメータを追加し、`ProductNo`と`FSEIBAN`の統合検索を実装。検索ロジックを改善（数値→ProductNo部分一致、8文字英数字→FSEIBAN完全一致、その他→OR検索）。SQLクエリを最適化し、DB側でフィルタリング・ソート・ページングを実行。`rowData`から必要なフィールドのみを選択し、レスポンスサイズを削減。デフォルト`pageSize`を400に変更。**フロントエンド側**: 検索時のみデータ取得（`enabled: hasQuery`）を実装し、初期表示を即座に「検索してください。」と表示。検索履歴の削除機能（黄色×ボタン）を追加。クリアボタンの視認性向上（`variant="secondary"`）。カラム幅計算をサンプリング（80件のみ）し、CPU負荷を削減。Macで実機検証完了、Pi4での実機検証は明日実施予定。CI成功。ナレッジベースにKB-205、KB-206を追加。詳細は [knowledge-base/api.md#kb-205](./knowledge-base/api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側) / [knowledge-base/frontend.md#kb-206](./knowledge-base/frontend.md#kb-206-生産スケジュール画面のパフォーマンス最適化と検索機能改善フロントエンド側) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-27）

- **✅ 生産スケジュールUI改善完了（チェック配色/OR検索/ソフトキーボード）**: 完了チェックボタンの配色を白背景・黒✓に変更し、状態識別を枠色（未完了=赤枠、完了=灰枠）で表現するように改善。検索履歴チップをトグル選択化し、複数選択でOR検索が可能に。`activeQuery: string`を`activeQueries: string[]`に変更し、選択中の履歴を配列で保持。選択中は色が付き（`border-emerald-300 bg-emerald-400`）、クリックで選択/解除がトグル。複数選択されたチップはカンマ区切りで`q`パラメータに結合し、API側でOR検索を実行。ソフトウェアキーボードモーダル（`KioskKeyboardModal.tsx`）を新規実装し、キーボードアイコン（⌨）ボタンでポップアップ表示。英数字入力（A-Z、0-9）、Backspace/Clear/Cancel/OKボタンを実装。OKで入力確定→モーダル閉じる。API側で`q`パラメータのカンマ区切りを解析し、トークンごとに既存ヒューリスティック（数値→ProductNo ILIKE / 8桁→FSEIBAN = / その他→OR ILIKE）を適用し、OR条件で結合。`q`パラメータの最大長を100から200に緩和。統合テストにOR検索ケースを追加。CI成功、デプロイ成功、実機検証完了（Mac・Pi4）。ナレッジベースにKB-207を追加。詳細は [knowledge-base/frontend.md#kb-207](./knowledge-base/frontend.md#kb-207-生産スケジュールui改善チェック配色or検索ソフトキーボード) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ 生産スケジュールUI改良完了（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）**: 資源CDフィルタ機能を追加し、各資源CDに2つのボタン（全件検索 / 割当済みのみ検索）を提供。検索登録製番と資源CDフィルタをAND条件で結合するように変更（テキスト条件と資源CD条件を分離し、AND結合）。加工順序番号（1-10）を資源CDごとに独立して割当可能にし、完了時に自動で詰め替え（例: 1,2,3,4 → 3完了で 4→3）。同一location（`ClientDevice.location`）の複数端末間で検索条件を同期（poll + debounce）。ドロップダウンの文字色を黒に固定し、視認性を向上。新規テーブル`ProductionScheduleOrderAssignment`と`KioskProductionScheduleSearchState`を追加。APIエンドポイント追加（`PUT /kiosk/production-schedule/:rowId/order`、`GET /kiosk/production-schedule/order-usage`、`GET/PUT /kiosk/production-schedule/search-state`）。CI成功、デプロイ成功、実機検証完了（Mac・Pi4）。ナレッジベースにKB-208を追加。詳細は [knowledge-base/frontend.md#kb-208](./knowledge-base/frontend.md#kb-208-生産スケジュールui改良資源cdfilter加工順序割当検索状態同期and検索) / [knowledge-base/api.md#kb-208](./knowledge-base/api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ 生産スケジュール行ごとの備考欄追加機能完了**: 生産スケジュールの各行に現場リーダーが備考を記入できる機能を実装。備考はlocation単位で管理し、同一locationの端末間で共有される。100文字以内・改行不可の制限を実装。インライン編集機能を実装し、Enterキーで保存、Escapeキーでキャンセルが可能。新規テーブル`ProductionScheduleRowNote`を追加。APIエンドポイント追加（`PUT /kiosk/production-schedule/:rowId/note`）。CI成功、デプロイ成功、実機検証完了（Pi5/Pi4/Pi3）。ナレッジベースにKB-212を追加。詳細は [knowledge-base/frontend.md#kb-212](./knowledge-base/frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能) / [knowledge-base/api.md#kb-212](./knowledge-base/api.md#kb-212-生産スケジュール行ごとの備考欄追加機能) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVインポートスケジュール実行ボタンの競合防止とFSEIBANバリデーション修正完了**: CSVインポートスケジュールページで、1つのスケジュールの「実行」ボタンを押すと他のスケジュールのボタンも「実行中...」と表示される問題を解決。`useRef`（`runningScheduleIdRef`）を追加し、実行中のスケジュールIDを即座に反映される参照で追跡することで競合を防止。既に実行中のスケジュールを再度実行しようとした場合、500エラーではなく409エラー（Conflict）を返すように修正。FSEIBANバリデーションを修正し、割当がない場合の`********`（8個のアスタリスク）を明示的に許可。実機検証でGmail経由のCSV取り込みが正常に動作し、`********`も正常に取得できることを確認。CI成功、デプロイ成功。ナレッジベースにKB-201（更新）、KB-204を追加。詳細は [knowledge-base/api.md#kb-201](./knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) / [knowledge-base/frontend.md#kb-204](./knowledge-base/frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-26）

- **✅ 生産スケジュール機能改良完了**: 列名変更（ProductNo→製造order番号、FSEIBAN→製番）、FSEIBAN全文表示、管理コンソールの列並び順・表示非表示機能、差分ロジック改善（updatedAt優先・完了でも更新）、CSVインポートスケジュールUI改善（409エラー時のrefetch）、バリデーション追加（ProductNo: 10桁数字、FSEIBAN: 8文字英数字）、TABLEテンプレート化を実装。実機検証でCSVダッシュボード画面とキオスク画面の動作を確認。CI成功、デプロイ成功。ナレッジベースにKB-201、KB-202、KB-203を追加。詳細は [knowledge-base/api.md#kb-201](./knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) / [knowledge-base/frontend.md#kb-202](./knowledge-base/frontend.md#kb-202-生産スケジュールキオスクページの列名変更とfseiban全文表示) / [knowledge-base/infrastructure/ansible-deployment.md#kb-203](./knowledge-base/infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) / [plans/production-schedule-kiosk-execplan.md](./plans/production-schedule-kiosk-execplan.md) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。
- **✅ CSV取り込み統合設定の追加**: マスターデータの列定義（ColumnDefinition）と手動/自動の許可、取り込み戦略を管理コンソールで統一管理できるようにし、USB一括登録とCSVインポートスケジュールを統合ページに集約。Gmail件名パターンはcsvDashboards対応を追加。詳細は [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-XX）

- **✅ 生産スケジュールキオスクページ実装・実機検証完了**: PowerAppsの生産スケジュールUIを参考に、キオスクページ（`/kiosk/production-schedule`）を実装。CSVダッシュボード（`ProductionSchedule_Mishima_Grinding`）のデータをキオスク画面で表示し、完了ボタン（赤いボタン）を押すと`progress`フィールドに「完了」が入り、完了した部品を視覚的に識別可能に。完了ボタンのグレーアウト・トグル機能を実装し、完了済みアイテムを`opacity-50 grayscale`で視覚的にグレーアウト。完了ボタンを押すと`progress`が「完了」→空文字（未完了）にトグル。チェックマーク位置調整（`pr-11`でパディング追加）と`FSEIBAN`の下3桁表示を実装。CSVダッシュボードの`gmailSubjectPattern`設定UIを管理コンソールに追加。`CsvImportSubjectPattern`モデルを追加し、マスターデータインポートの件名パターンをDB化（設計統一）。実機検証でCSVダッシュボードのデータがキオスク画面に表示され、完了ボタンの動作、グレーアウト表示、トグル機能が正常に動作することを確認。CI成功、デプロイ成功。ナレッジベースにKB-184、KB-185、KB-186を追加。詳細は [knowledge-base/frontend.md#kb-184](./knowledge-base/frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能) / [knowledge-base/api.md#kb-185](./knowledge-base/api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善) / [knowledge-base/api.md#kb-186](./knowledge-base/api.md#kb-186-csvimportsubjectpatternモデル追加による設計統一マスターデータインポートの件名パターンdb化) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-19）

- **✅ Pi4デプロイ時のキオスクメンテナンス画面表示機能実装完了**: Pi4デプロイ時にキオスク画面にメンテナンス画面を表示する機能を実装。デプロイスクリプト（`scripts/update-all-clients.sh`）で`--limit raspberrypi4`使用時に自動的にメンテナンスフラグを設定・クリアし、Web UIでメンテナンス画面を表示。APIエンドポイント（`/api/system/deploy-status`）経由でフラグを管理し、`KioskLayout.tsx`で5秒間隔でポーリングして即座に反映。デプロイ完了後、メンテナンス画面は自動的に消える（最大5秒以内）。実機検証でメンテナンス画面の表示・非表示を確認。Webコンテナの再ビルドが必要であること、ブラウザキャッシュのクリアが必要な場合があることを確認。ナレッジベースにKB-183を追加。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-183](./knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Pi4デプロイ検証完了（デプロイ安定化機能の動作確認）**: KB-172で実装したデプロイ安定化機能（プリフライト・ロック・リソースガード）がPi4に対して正常に動作することを検証。デプロイ前チェック（ネットワークモード確認、プリフライトチェック、リモートロック）が正常に動作し、デプロイ成功（ok=78, changed=8, failed=0）。デプロイ後の確認（systemdサービス、API接続）で問題なし。Pi5と同様に、Pi4でもデプロイが安定して実行できることを確認。ナレッジベースにKB-182を追加。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-182](./knowledge-base/infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Dropbox証明書ピニング問題の解決・バックアップ対象の追加・UI表示問題の修正完了**: Dropboxの証明書更新により`api.dropboxapi.com`の証明書ピニングが失敗していた問題を解決。新しい証明書フィンガープリント（`sha256/9d6683591abfc0a0e0681152ed4577430bf5b00e7a3ff71b9f21098e2922a2e5`）を追加し、スケジュール実行されたDropboxバックアップのクリーンアップ処理が正常に動作するように修正。Pi5/Pi4/Pi3の環境設定ファイル（vault.yml、vault password、status-agent configs、backup.json）をバックアップ対象に追加し、すべてのバックアップ対象（合計25件）にスケジュール設定を追加。管理コンソールのバックアップ対象一覧で「バックアップ先」列に「未設定」と表示されていた問題を修正し、新構造（`options.dropbox.accessToken`）と旧構造（`options.accessToken`）の両方に対応するようにUI表示ロジックを更新。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-179、KB-180、KB-181を追加。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-179](./knowledge-base/infrastructure/backup-restore.md#kb-179-dropbox証明書ピニング問題api-dropboxapi-comの新しい証明書フィンガープリント追加) / [knowledge-base/infrastructure/backup-restore.md#kb-180](./knowledge-base/infrastructure/backup-restore.md#kb-180-バックアップ対象の追加pi5pi4pi3の環境設定ファイル) / [knowledge-base/infrastructure/backup-restore.md#kb-181](./knowledge-base/infrastructure/backup-restore.md#kb-181-ui表示問題の修正dropbox設定の新構造対応) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) を参照。

- **✅ セキュリティ評価実施・ログの機密情報保護実装完了**: OWASP Top 10 2021、IPA「安全なウェブサイトの作り方」、CISベンチマーク、NIST Cybersecurity Framework等の標準的なセキュリティ評価指標に基づいてセキュリティ評価を実施。総合評価は良好（2.2/3.0、実施率73%）。緊急に実装すべき項目として「ログの機密情報保護」を特定し、`x-client-key`がログに平文で出力されていた問題を修正。6ファイルを修正し、認証キーを`[REDACTED]`に置換するように実装。CI成功、デプロイ成功、ログ確認完了。ナレッジベースにKB-178を追加、プレゼン用ドキュメントに第6層（ログの機密情報保護）を追加。詳細は [security/evaluation-report.md](./security/evaluation-report.md) / [security/log-redaction-implementation.md](./security/log-redaction-implementation.md) / [security/urgent-security-measures.md](./security/urgent-security-measures.md) / [knowledge-base/infrastructure/security.md#kb-178](./knowledge-base/infrastructure/security.md#kb-178-ログの機密情報保護実装x-client-keyのredacted置換) / [presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md) を参照。

### 🆕 最新アップデート（2026-01-18）

- **✅ デプロイ安定化の恒久対策実装・実機検証完了**: KB-176で発見された問題（環境変数反映、vault.yml権限問題）に対する恒久対策を実装・実機検証完了。`.env`更新時のapiコンテナ強制再作成、デプロイ後の環境変数検証（fail-fast）、vault.yml権限ドリフトの自動修復、handlersの再起動ロジック統一を実装。実機検証でPi5へのデプロイ成功（ok=91, changed=3, failed=0）、APIコンテナ内の環境変数が正しく設定されていること、vault.ymlファイルの権限が適切に設定されていることを確認。デプロイ前にvault.yml権限問題が発生したが、手動で修正。次回のデプロイからは自動修復機能が動作する。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-176](./knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) を参照。

- **✅ Slack通知チャンネル分離機能の実機検証完了**: Slack通知を4系統（deploy/ops/security/support）に分類し、それぞれ別チャンネル（`#rps-deploy`, `#rps-ops`, `#rps-security`, `#rps-support`）に着弾させる機能を実装・検証完了。Ansible VaultにWebhook URLを登録し、`docker.env.j2`テンプレートで環境変数を生成。実機検証で4チャンネルすべてでの通知受信を確認。デプロイ時のトラブルシューティング（Ansibleテンプレートの既存値保持パターン、ファイル権限問題、コンテナ再起動の必要性）をナレッジベースに記録。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-176](./knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md) / [guides/deployment.md#slack通知のチャンネル分離](./guides/deployment.md#slack通知のチャンネル分離2026-01-18実装) を参照。

- **✅ Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了**: Phase2完全移行を実装し、API/UIをDBのみ参照に変更。APIの`/clients/alerts`はファイル走査を撤去しDBのみ参照、`/clients/alerts/:id/acknowledge`はDBのみ更新。Web管理ダッシュボードは`dbAlerts`を表示し、「アラート:」セクションにDB alertsが複数表示されることを確認。Ansible環境変数を永続化し、API integration testを追加。実機検証でPi5でのAPIレスポンス（dbAlerts=10、fileAlerts=0）・Web UI表示（DB alerts表示）・acknowledge機能・staleClientsアラートとの共存を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-175](./knowledge-base/infrastructure/ansible-deployment.md#kb-175-alerts-platform-phase2完全移行db中心運用の実機検証完了) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了**: Alerts Platform Phase2後続実装を実装し、DB版Dispatcherが正常に動作することを確認。DB版Dispatcherは`AlertDelivery(status=pending|failed, nextAttemptAt<=now)`を取得してSlackへ配送し、dedupe（`fingerprint + routeKey + windowSeconds`）により連続通知を抑制。retry/backoffで失敗時の再送を実装。Phase1（file）Dispatcherは停止し、DB中心へ完全移行。実機検証でPi5でのDB版Dispatcher起動・配送処理（10件SENT、45件SUPPRESSED）・dedupe動作・fingerprint自動計算・Phase1停止を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-174](./knowledge-base/infrastructure/ansible-deployment.md#kb-174-alerts-platform-phase2後続実装db版dispatcher-dedupe-retrybackoffの実機検証完了) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Platform Phase2のDB取り込み実装完了**: Alerts Platform Phase2のIngest機能を実装し、`alerts/alert-*.json`をDBへ永続化する機能を追加。Prismaスキーマに`Alert`/`AlertDelivery`モデルを追加し、AlertsIngestorが60秒間隔でDB取り込みを実行。API互換性を維持し、`GET /api/clients/alerts`でDBアラート取得、`POST /api/clients/alerts/:id/acknowledge`でDB側もack対応。空ファイル（0バイト）や壊れたJSONを`errors`ではなく`skipped`として扱うように改善し、ログノイズを削減。実機検証でPi5でのDB取り込み・AlertDelivery作成・ack更新を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-173](./knowledge-base/infrastructure/ansible-deployment.md#kb-173-alerts-platform-phase2のdb取り込み実装と空ファイル処理の改善) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Dispatcher Phase 1実装・過去のアラート再送問題修正完了**: Alerts Dispatcher Phase 1を実装し、Slack通知の一元管理を実現。B1アーキテクチャ（scriptsはalertsファイル生成、API側がSlack配送）を採用。実機検証でPi5でのSlack通知着弾を確認。過去のアラート再送問題を修正し、24時間以上古いアラートは再送されないように改善。送信済み（`status === 'sent'`）のアラートも再送されない。`.gitignore`の全階層マッチ問題も修正（`/alerts/`と`/config/`に変更）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-172](./knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ デプロイ安定化機能の実装完了**: デプロイプロセスの安全性と可観測性を向上させる機能を実装。プリフライトリーチビリティチェック（Pi5 + inventory hosts）、リモートロック（並行実行防止、古いロックの自動クリーンアップ）、リソースガード（メモリ120MB、ディスク90%）、環境限定リトライ（unreachable hostsのみ、3回、30秒）、ホストごとのタイムアウト（Pi3 30m / Pi4 10m / Pi5 15m）、Slack通知（start/success/failure/per-host failure）、`--limit`オプション（特定ホストのみ更新）を実装。実機検証でPi5とPi4でのデプロイ成功を確認。実装時の発見事項（locale問題、git権限問題、ESLint設定問題、`.gitignore`全階層マッチ問題）も解決。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-172](./knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) / [guides/deployment.md](./guides/deployment.md#デプロイ安定化機能2026-01-17実装) / [plans/deploy-stability-execplan.md](../plans/deploy-stability-execplan.md) を参照。

### 🆕 最新アップデート（2026-01-16）

- **✅ WebRTCビデオ通話機能の修正（clientKey/clientId未設定問題）**: `KioskCallPage.tsx`で`clientKey`と`clientId`が設定されていなかったため、WebSocket接続が確立されずビデオ通話機能が動作しない問題を解決。`useLocalStorage`フックを追加し、`localStorage`から`clientKey`と`clientId`を取得して`useWebRTC`フックに渡すように修正。`resolveClientKey`関数で`DEFAULT_CLIENT_KEY`をフォールバックとして使用するように改善。実機検証でPi4とMac間のビデオ通話が正常に動作することを確認。詳細は [knowledge-base/frontend.md#kb-171](./knowledge-base/frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定) を参照。

### 🆕 最新アップデート（2026-01-16）

- **✅ デバイスタイプ汎用化による将来クライアント拡張対応**: `preflight-pi3-signage.yml`を`preflight-signage.yml`に汎用化し、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能に。`group_vars/all.yml`に`device_type_defaults`を追加し、デバイスタイプごとの設定（メモリ要件、lightdm停止要否、サービス停止リスト）を一元管理。inventoryファイルに`device_type`変数を追加（Pi3: `pi3`, Pi Zero 2W: `pi_zero_2w`）。`device_type`未指定時は`default`設定を使用し、後方互換性を維持。新しいデバイスタイプ追加時の手順をドキュメント化。CI成功・構文チェック完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-170](./knowledge-base/infrastructure/signage.md#kb-170-デバイスタイプ汎用化による将来クライアント拡張対応) / [guides/deployment.md](./guides/deployment.md#新しいサイネージ端末デバイスタイプの追加手順) を参照。

- **✅ Pi3デプロイ信頼性向上（lightdm停止・自動再起動）**: Pi3デプロイがメモリ不足で完了しない問題を根本解決。プレフライトチェックでlightdm（GUIディスプレイマネージャー）を停止し約100MBのメモリを確保。デプロイ完了後はPi3を自動再起動してGUIとサイネージサービスを復活。signageロール・clientロールでlightdm停止時はサービス起動をスキップし、デプロイエラーを回避。デプロイ成功（ok=101, changed=22, failed=0）、所要時間約10分を実機検証で確認。詳細は [knowledge-base/infrastructure/signage.md#kb-169](./knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動) / [guides/deployment.md](./guides/deployment.md) を参照。

### 🆕 最新アップデート（2025-12-31）

- **✅ CSVインポートUI改善・計測機器・吊具対応完了**: USBメモリ経由のCSVインポートUIを4つのフォーム（従業員・工具・計測機器・吊具）に分割し、各データタイプを個別にアップロードできるように改善。新APIエンドポイント`POST /api/imports/master/:type`を追加し、単一データタイプ対応のインポート機能を実装。共通コンポーネント`ImportForm`を作成し、コードの重複を削減。各フォームで`replaceExisting`を個別に設定可能。CI通過確認済み。詳細は [knowledge-base/api.md#kb-117](./knowledge-base/api.md#kb-117-csvインポートapiの単一データタイプ対応エンドポイント追加) / [knowledge-base/frontend.md#kb-117](./knowledge-base/frontend.md#kb-117-csvインポートuiの4フォーム分割実装) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVフォーマット仕様実装・従業員編集フォーム改善完了**: 従業員CSVインポートの新フォーマット（`lastName`/`firstName`）を実装し、従業員編集フォームを`lastName`と`firstName`の個別フィールドに変更。`displayName`は自動生成されるように改善。データベーススキーマに`lastName`/`firstName`フィールドを追加し、APIとフロントエンドを更新。既存データの`displayName`から`lastName`/`firstName`への分割ロジックも実装。実機検証でCSVインポート成功、`displayName`自動生成、一覧表示、編集画面の動作をすべて確認済み。詳細は [guides/verification-checklist.md#62-従業員csvインポート新フォーマット](./guides/verification-checklist.md#62-従業員csvインポート新フォーマット) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2025-12-30）

- **✅ CSVインポート実機検証完了・UI改善**: CSVインポートスケジュールページのフォーム状態管理を改善し、削除後や編集から新規作成への切り替え時にフォームが正しくリセットされるように修正。手動実行時のリトライスキップ機能を実装し、即座に結果を確認できるように改善（自動実行は従来通りリトライあり）。実機検証でターゲット追加機能、データタイプ選択、プロバイダー選択、Gmail件名パターン管理、スケジュールCRUD、削除機能、手動実行、スケジュール表示の人間可読形式をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-116](./knowledge-base/frontend.md#kb-116-csvインポートスケジュールページのフォーム状態管理改善) / [knowledge-base/api.md#kb-116](./knowledge-base/api.md#kb-116-csvインポート手動実行時のリトライスキップ機能) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-15）

- **✅ backup.json削除問題の根本的解決と復元手順確立**: `git clean -fd`による`backup.json`削除問題を根本的に解決。`.gitignore`に`config/`を追加し、**Ansibleデプロイから`git clean`を削除**することで運用データ削除リスクを排除。Dropboxからの`backup.json`復元方法、Gmail OAuth設定の復元方法、Gmail OAuthルートの新構造対応修正、旧キーと新構造の衝突問題と解決方法をナレッジベースに記録。デプロイ時の設定ファイル削除を防止し、復元手順を確立。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-163](./knowledge-base/infrastructure/backup-restore.md#kb-163-git-cleanによるbackupjson削除問題再発) / [knowledge-base/infrastructure/backup-restore.md#kb-164](./knowledge-base/infrastructure/backup-restore.md#kb-164-git-clean設計の根本的改善-fd--fdx) / [knowledge-base/infrastructure/backup-restore.md#kb-165](./knowledge-base/infrastructure/backup-restore.md#kb-165-dropboxからのbackupjson復元方法) / [knowledge-base/infrastructure/backup-restore.md#kb-166](./knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法) / [knowledge-base/infrastructure/backup-restore.md#kb-167](./knowledge-base/infrastructure/backup-restore.md#kb-167-gmail-oauthルートの新構造対応修正) / [knowledge-base/infrastructure/backup-restore.md#kb-168](./knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法) を参照。

### 🆕 最新アップデート（2026-01-14）

- **✅ トークプラザ工場へのマルチサイト対応実装完了**: トークプラザ工場（別拠点）への同一システム導入に対応。inventoryファイルの分離（`inventory-talkplaza.yml`）、group_vars/host_varsの分離、プレフィックス命名規則（`talkplaza-`）の実装により、設定の混在を防止。デプロイスクリプトのinventory引数必須化により、誤デプロイのリスクを大幅に削減。Dropbox basePathの分離対応により、拠点別フォルダにバックアップを分離。デプロイスクリプトのinventory/playbookパス相対パス修正により、Pi5上での実行時のパス重複問題を解決。第1工場への導入時も同様の手順で対応可能。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-159](./knowledge-base/infrastructure/ansible-deployment.md#kb-159-トークプラザ工場へのマルチサイト対応実装inventory分離プレフィックス命名規則) / [knowledge-base/infrastructure/ansible-deployment.md#kb-160](./knowledge-base/infrastructure/ansible-deployment.md#kb-160-デプロイスクリプトのinventory引数必須化誤デプロイ防止) / [knowledge-base/infrastructure/ansible-deployment.md#kb-162](./knowledge-base/infrastructure/ansible-deployment.md#kb-162-デプロイスクリプトのinventoryplaybookパス相対パス修正pi5上での実行時) / [knowledge-base/infrastructure/backup-restore.md#kb-161](./knowledge-base/infrastructure/backup-restore.md#kb-161-dropbox-basepathの分離対応拠点別フォルダ分離) / [guides/talkplaza-rollout.md](./guides/talkplaza-rollout.md) / [guides/deployment.md](./guides/deployment.md) を参照。

### 🆕 最新アップデート（2026-01-09）

- **✅ MacとPi3のstatus-agent問題修正完了**: 管理コンソールでMacとPi3のステータスが表示されない問題を解決。Pi3の`status-agent.timer`が無効化されていたため、`systemctl enable --now status-agent.timer`で再有効化。MacにはLinux用の`status-agent.py`しか存在せず、macOSでは動作しないため、macOS専用の`status-agent-macos.py`を作成し、`launchd`設定ファイルを追加して定期実行を設定。`docs/guides/status-agent.md`にmacOS向けセットアップ手順を追加。CI成功・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-157](./knowledge-base/infrastructure/ansible-deployment.md#kb-157-pi3のstatus-agenttimerが無効化されていた問題) / [knowledge-base/infrastructure/miscellaneous.md#kb-158](./knowledge-base/infrastructure/miscellaneous.md#kb-158-macのstatus-agent未設定問題とmacos対応) / [guides/status-agent.md](./guides/status-agent.md) を参照。

- **✅ 複数スケジュールの順番切り替え機能実装完了**: 複数のスケジュールが同時にマッチする場合、優先順位順（高い順）にソートされ、設定された間隔（デフォルト: 30秒）で順番に切り替えて表示する機能を実装。環境変数`SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS`で切り替え間隔を設定可能。優先順位100（分割表示）と優先順位10（全画面表示）が同時にマッチする場合、30秒ごとに交互に表示される。CI成功・デプロイ完了・実機検証完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-156](./knowledge-base/infrastructure/signage.md#kb-156-複数スケジュールの順番切り替え機能実装) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Pi3サイネージの画像更新方式改善完了**: Pi3サイネージの「1ページずつ表示されない」問題の再発要因を特定し、画像更新方式を改善。`signage-update.sh`が`mv`で置換していたため、更新のたびに`current.jpg`のinodeが変わり、`feh --auto-reload(inotify)`が追従できない問題を解決。既存`current.jpg`がある場合は上書き更新（inode維持）に変更し、画面更新が安定するように改善。Ansibleテンプレートも同様に修正。詳細は [knowledge-base/infrastructure/signage.md#kb-152](./knowledge-base/infrastructure/signage.md#kb-152-サイネージページ表示漏れ調査と修正) / [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) を参照。

- **✅ CSVダッシュボード機能の検証9完了**: CSVダッシュボード可視化機能の検証9（表示期間フィルタ）を実施し、表示期間フィルタ（`displayPeriodDays: 1`）が正しく動作することを確認。当日分（8行）のみが表示され、前日分（2行）は除外されている。JSTの「今日の0:00」から「今日の23:59:59」をUTCに正しく変換してフィルタリングしていることを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

- **✅ CSVダッシュボード機能のCI修正・デプロイ完了**: CSVダッシュボード可視化機能のCI修正とデプロイを完了。E2Eテストのstrict mode violation（「ダッシュボード」リンクが「CSVダッシュボード」リンクと重複マッチ）を修正し、`@remix-run/router`の脆弱性対応（1.23.2へ強制）を実施。GitHub Actions CIが成功し、Pi5へのデプロイも正常に完了。管理コンソールの「CSVダッシュボード」タブが表示され、機能が利用可能な状態に到達。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

- **✅ CSVダッシュボード機能の実機検証・修正完了**: CSVダッシュボード可視化機能の実機検証を実施し、4つの問題を発見・修正。スキーマ修正で`csvDashboardId`が保持されるように改善、手動アップロードでデータ取り込みを実行するように修正、日付フィルタリングでJST/UTCの変換を正しく計算するように修正、`displayPeriodDays`のnullチェックを追加。実機検証でCSVダッシュボードのデータが正しく表示されることを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

### 🆕 最新アップデート（2026-01-XX）

- **✅ CI YAML責務分離リファクタ完了**: GitHub Actions CIワークフローを品質レビューに適した構成に改善。巨大な`lint-and-test`ジョブを`static-quality`、`api-tests`、`scripts-verification`、`security`に分割し、失敗原因の特定を容易に。PostgreSQLを`services:`化し、ポート衝突と後片付けの問題を解消。共通基盤を整備（`runs-on: ubuntu-24.04`固定、`concurrency`追加、`defaults.run.shell: bash -euo pipefail`設定）。成果物を標準化（Vitest JUnit/JSON/coverage、Trivy SARIF、Playwright reportをartifact化）。`pnpm audit`をnon-blocking化し、失敗してもCIを落とさず結果をログ/レポートとして残す方針に変更。詳細は [knowledge-base/ci-cd.md#kb-027](./knowledge-base/ci-cd.md#kb-027-ci-yaml責務分離リファクタ品質レビュー強化) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

### 🆕 最新アップデート（2026-01-08）

- **✅ CSVダッシュボード可視化機能実装完了**: Gmail経由でPowerAutomateから送信されたCSVファイルをサイネージで可視化表示する機能を実装。`slot.kind=csv_dashboard`の実装が完了し、FULL/SPLITレイアウトでCSVダッシュボードを表示可能に。データ構造定義、可視化テンプレート（テーブル/カードグリッド）、表示期間フィルタ、データ保持期間管理を実装。管理コンソールUIでCSVダッシュボードを選択可能に。CI通過・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ SPLITモードで左右別PDF表示に対応完了**: SPLITレイアウトで左右ともPDFを表示できる機能を実装。`SignageContentResponse`に`pdfsById`フィールドを追加し、複数PDFを辞書形式で提供可能に。レンダラーに`renderSplitWithPanes`メソッドを追加し、左右ともPDFの場合に対応。Web側の`SignageDisplayPage`を`layoutConfig`準拠の2ペインSPLIT描画に更新し、左右それぞれのスロットに応じてPDFまたは工具を描画。左右それぞれのPDFが独立してスライドショー表示されることを実機検証で確認。CI通過・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-154](./knowledge-base/infrastructure/signage.md#kb-154-splitモードで左右別pdf表示に対応) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Pi3デプロイ安定化の十分条件実装完了**: Pi3デプロイ時のプレフライトチェックを自動化し、手順遵守に依存しない運用を実現。コントロールノード側でAnsibleロールのテンプレートファイル存在チェックを実装し、Pi3側でサービス停止・無効化・mask、残存AnsiballZ掃除、メモリ閾値チェック（>= 120MB）を自動実行。条件を満たせない場合はfail-fastし、エラーメッセージに手動対処手順を表示。標準手順ドキュメントを更新し、プレフライトチェックが自動実行されることを明記。実機検証でコントロールノード側のロール構造チェックとPi3側のプレフライトチェックが正常に動作し、メモリ不足時にfail-fastすることを確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-154](./knowledge-base/infrastructure/ansible-deployment.md#kb-154-pi3デプロイ安定化の十分条件実装プレフライトチェック自動化) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Pi3サイネージ安定化施策実装・デプロイ完了**: Pi3サイネージの安定稼働を向上させるため、SDカードへの高頻度書込み削減（tmpfs化）、systemdサービス堅牢化、画像更新停止の自己修復（Watchdog）、深夜の日次再起動、Ansibleによる設定の収束を実装。デプロイ時に`signage`ロールのテンプレートディレクトリ不足で失敗した問題を解決し、テンプレートファイルを`roles/signage/templates/`に配置してデプロイ成功。すべてのサービス（signage-lite.service、signage-lite-update.timer、signage-lite-watchdog.timer、signage-daily-reboot.timer、status-agent.timer）が正常に起動することを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-153](./knowledge-base/infrastructure/signage.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) / [knowledge-base/infrastructure/ansible-deployment.md#kb-153](./knowledge-base/infrastructure/ansible-deployment.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-07）

- **✅ backup.jsonの破壊的上書きを防ぐセーフガード実装・実機検証完了**: `backup.json`がフォールバック設定（デフォルト設定）で上書きされ、Gmail設定や多数のバックアップターゲットが消失する問題を解決。フォールバック検知マーカー（`FALLBACK_MARKER`）の保持（`{...config}`によるスプレッドクローンを廃止）、フォールバック保存の拒否（本番パスのみ）、破壊的上書き防止ガード（targets数が50%以上減る保存を拒否）を実装。詳細ログ（ファイル読み込み時のサイズ・要約情報、保存時の検証結果）を追加。CI通過・デプロイ完了・実機検証完了を確認。Gmail設定のトークン更新とバックアップ実行後も、ファイルサイズ（9358 bytes）、ターゲット数（17）、Gmail/Dropbox設定が維持されることを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-151](./knowledge-base/infrastructure/backup-restore.md#kb-151-backupjsonの破壊的上書きを防ぐセーフガード実装) を参照。

- **✅ サイネージレイアウト設定の実機検証完了・UI改善**: サイネージレイアウトとコンテンツの疎結合化実装の実機検証を完了。SPLITレイアウトで左PDF・右工具管理の組み合わせに対応し、タイトルを動的に表示するように改善。タイトルとアイテムの重なりを解消し、PDF表示の重複タイトルを削除。スケジュールの優先順位ロジックを改善し、優先順位が高いスケジュールが優先されることを確認。実機検証で発見された問題（Pi3のサイネージサービス更新タイマーが停止していた）も解決。すべてのレイアウトパターン（FULL/SPLIT、左PDF右工具管理、左工具管理右PDF）が正常に動作することを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-150](./knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) / [guides/signage-layout-config-verification-results.md](./guides/signage-layout-config-verification-results.md) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-06）

- **✅ サイネージレイアウトとコンテンツの疎結合化実装完了**: サイネージのレイアウト（全体/左右）と各エリアのコンテンツ（PDF/持出一覧/将来のCSV可視化）を分離し、新しい可視化を追加する際のコード変更を最小限に抑えられる構造を実現。`SignageSchedule`と`SignageEmergency`に`layoutConfig Json?`フィールドを追加し、レイアウトごとのキャンバス割当とslotごとのSVG生成を分離。既存の`contentType`/`pdfId`形式を新形式へ自動変換する機能を実装し、後方互換性を維持。管理コンソールUIでレイアウト（全体/左右）と各スロットのコンテンツ種別（PDF/持出一覧）を選択可能に。デプロイ時にPrisma Client再生成が必要な場合があることをナレッジベースに記録。詳細は [knowledge-base/infrastructure/signage.md#kb-150](./knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) / [modules/signage/README.md](./modules/signage/README.md) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ バックアップ履歴ページに用途列を追加（UI改善）完了**: バックアップ履歴のテーブルに「用途」列を追加し、各バックアップ対象の用途を一目で把握できるように改善。`targetKind`と`targetSource`から用途を自動判定する`getTargetPurpose`関数を実装し、日本語で分かりやすく表示。backup.json、vault.yml、.env、データベース、CSV、画像などの用途を適切に表示。実機検証で用途列が正しく表示され、レイアウトが崩れないことを確認。詳細は [knowledge-base/frontend.md#kb-149](./knowledge-base/frontend.md#kb-149-バックアップ履歴ページに用途列を追加ui改善) を参照。

- **✅ 外部連携運用台帳ドキュメント作成完了（P2実装）**: Dropbox/Gmail/Slackなどの外部サービス連携の設定・運用情報を一元管理する運用台帳ドキュメントを作成。各外部サービスの設定場所（Ansible Vault、backup.json、環境変数）、設定手順へのリンク、運用時の注意事項、トラブルシューティング情報、設定の永続化方法、ヘルスチェック方法をまとめ。既存のセットアップガイドやナレッジベースへの参照を整理し、運用者が外部連携の設定・運用を効率的に管理できるように改善。詳細は [guides/external-integration-ledger.md](./guides/external-integration-ledger.md) を参照。

- **✅ バックアップ設定の衝突・ドリフト検出の自動化（P1実装）完了**: `backup.json`の新旧構造間の設定値の衝突や、環境変数と設定ファイル間のドリフトを自動検出する機能を実装。`BackupConfigLoader.checkHealth()`メソッドと`GET /api/backup/config/health`エンドポイントを追加し、管理コンソールUIに統合。衝突検出（旧キーと新構造の両方に値がある場合）、ドリフト検出（環境変数と設定ファイルの値の不一致）、欠落チェック（必須設定の欠落）を実装。実機検証でヘルスチェックエンドポイントが正常に動作し、UI表示が成功することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-148](./knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装) / [api/backup.md](./api/backup.md) を参照。

- **✅ backup.jsonのprovider別名前空間化（構造的再発防止策）実装・実機検証完了**: `backup.json`の`storage.options`をprovider別名前空間（`options.dropbox.*`, `options.gmail.*`）へ移行し、Dropbox/Gmailトークン衝突を構造的に再発不能に。後方互換性を維持し、旧キーから新構造への自動正規化を実装。ネスト対応の`${ENV}`解決、OAuthコールバック/refresh/onTokenUpdateの統一、Gmail設定APIの新構造対応を実装。実機検証で旧構造の後方互換性、新構造への保存、Dropboxバックアップ、Gmail OAuth更新がすべて正常に動作することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-147](./knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策) / [api/backup.md](./api/backup.md) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) を参照。

- **✅ バックアップ手動実行時の500エラー修正・client-directory kind追加完了**: 手動バックアップ実行時に一部の対象で500エラーが発生していた問題を解決。Pi5自身のファイルを`client-file`として登録していた問題と、Pi3/Pi4のディレクトリを`directory`として登録していた問題を修正。`client-directory` kindを追加し、クライアント端末のディレクトリをAnsible経由でバックアップ可能に。`backup.json`を正規化し、Pi5自身のファイルは`file`/`directory`、Pi3/Pi4のディレクトリは`client-directory`に統一。Tailscaleパスを`/etc/tailscale`から`/var/lib/tailscale`に修正。Docker Composeに証明書マウントを追加。実機検証で全バックアップ対象が正常に動作することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-144](./knowledge-base/infrastructure/backup-restore.md#kb-144-バックアップ手動実行時の500エラーclient-directory-kind追加とbackupjson正規化) / [api/backup.md](./api/backup.md) を参照。

- **✅ Dropbox設定の恒久対策とbackup.json保護機能追加・実機検証完了**: Ansibleで`.env`再生成時にDropbox設定が消失する問題を解決。KB-142でSlack Webhook URLの恒久対策を実施したが、同様の問題がDropbox設定でも発生したため、AnsibleテンプレートにDropbox環境変数を追加し、vaultで管理するように改善。さらに、`backup.json`の存在保証と健全性チェック機能を追加し、ファイル消失時に設定が失われる問題を防止。実機検証でAnsible再実行後もSlack/Dropbox設定が維持され、システムが正常に動作することを確認。CI失敗の修正（`slack-webhook.ts`のデバッグログ削除）も完了。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-143](./knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Gmail OAuthとDropboxバックアップのトークン衝突（refreshToken共有）を恒久対策（トークン分離）**: Gmail OAuthのトークン保存がDropbox用トークンを上書きしてしまい、Dropbox手動バックアップが大量に失敗する問題を解決。`backup.json`の`storage.options`でGmail用トークンを`gmailAccessToken/gmailRefreshToken`に分離し、Gmail設定の「設定済み」判定も`storage.provider`に依存しない形へ改善。CSVインポート後の自動バックアップ等のトークン更新も分離し、再発を防止。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-146](./knowledge-base/infrastructure/backup-restore.md#kb-146-gmail-oauthがdropboxトークンを上書きしdropboxバックアップが失敗するトークン分離で恒久対策) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) を参照。

### 🆕 最新アップデート（2026-01-05）

- **✅ WebRTCビデオ通話機能 実装・実機検証完了**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話・ビデオ通話の実機検証を完了し、機能が完成。**音声通話**：双方向発信/受話、マイク無し端末でのrecvonlyモード対応、60秒以上の通話維持を確認。**ビデオ通話**：片側のみビデオON、両側ビデオON、ビデオON/OFFの切り替えを確認。**長時間接続**：WebSocket keepalive（30秒ping/pong）により5分以上の通話を安定維持。実装過程で発生した問題と解決策をナレッジベースに詳細記録（KB-132〜141）。詳細は [guides/webrtc-verification.md](./guides/webrtc-verification.md) / [knowledge-base/api.md#kb-132](./knowledge-base/api.md#kb-132-webrtcシグナリングルートのダブルプレフィックス問題) / [knowledge-base/frontend.md#kb-136](./knowledge-base/frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題) / [knowledge-base/infrastructure/docker-caddy.md#kb-141](./knowledge-base/infrastructure/docker-caddy.md#kb-141-caddyがすべてのapi要求にwebsocketアップグレードヘッダーを強制する問題) を参照。

### 🆕 最新アップデート（2026-01-04）

- **✅ WebRTC通話（音声）実機検証・安定化**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話の実機検証を実施。WebSocketシグナリング、offer/answer/ICE交換、接続維持を確認。マイク権限周りの切断問題に対して、マイク未接続端末でも受信専用（recvonly）で接続を継続するフォールバックを追加。手順は [guides/webrtc-verification.md](./guides/webrtc-verification.md) を参照。

- **✅ Pi5ストレージ経時劣化対策（10年運用対応）完了**: Pi5のストレージ使用量が27%（約270GB）と異常に高い問題を調査・解決。Docker Build Cache（237.2GB）とsignage-renderedの履歴画像（約6.2GB）を削除し、ディスク使用量を249GB→23GB（約226GB削減、27%→3%）に改善。さらに、10年運用を見据えた自動メンテナンス機能を実装。`storage-maintenance.sh`スクリプトを追加し、systemd timerで毎日実行（signage履歴画像削除、月1回build cache削除）。`monitor.sh`のディスク閾値を段階化（50%警告、70%警告、80%アラート、90%クリティカル）。`signage-render-storage.ts`を修正し、履歴画像をデフォルトで生成しないように変更（`SIGNAGE_RENDER_KEEP_HISTORY=1`で有効化可能）。Ansibleで`storage-maintenance.service/timer`を管理化。実機検証完了（APIコンテナ正常動作、storage-maintenance.timer有効化、ストレージ使用量3%維持を確認）。詳細は [knowledge-base/infrastructure/miscellaneous.md#kb-130](./knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) / [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) / [guides/operation-manual.md](./guides/operation-manual.md) を参照。

- **✅ APIコンテナ再起動ループ問題修正完了**: APIコンテナが`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`環境変数の空文字でZodバリデーションエラーを起こし、再起動ループに陥っていた問題を修正。`docker-compose.server.yml`の`${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}`により未設定時でも空文字が注入されるため、`z.preprocess`で空文字を`undefined`に変換してからURL検証するように変更。実機検証完了（APIコンテナが正常起動、ヘルスチェック200、サイネージ画像取得正常を確認）。詳細は [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) を参照。

- **✅ Pi5サーバー側のstatus-agent設定をAnsible管理化完了**: Pi5サーバー側のstatus-agent設定が手動設定のままで、設定のドリフトが発生していた問題を解決。Pi5に`status_agent_client_id`、`status_agent_client_key`などのホスト変数を追加（`inventory.yml`）。Pi5用vaultに`vault_status_agent_client_key`を追加（`host_vars/raspberrypi5/vault.yml`）。serverロールに`status-agent.yml`タスクを追加（設定ファイル配布、systemdユニット配布、タイマー有効化）。`main.yml`から`status-agent.yml`をインポート。Ansible実行時に自動的に設定ファイルが更新されるように改善。設定のドリフトを防止し、自動更新が可能になった。実機検証完了（設定ファイルが正しく生成、systemdサービスが正常動作、データベースに最新データが記録されることを確認）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-129](./knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま) / [guides/status-agent.md](./guides/status-agent.md) を参照。

### 🆕 最新アップデート（2026-01-03）

- **✅ Pi3サイネージ正常化作業完了**: Pi3のサイネージ画面が旧デザイン（「工具管理データ」タイトル、温度表示なし）のままだった問題を解決。Pi5のTSソース（`signage.renderer.ts`）が旧い実装のままだったため、正しい実装（「持出中アイテム」＋`getClientSystemMetricsText()`）を反映し、APIコンテナを`--no-cache`で再ビルドして正常化完了。DEBUG MODEのNDJSONログでrepo/コンテナの不一致を検出し、修正前後のログ比較で正常化を確認。Pi3のサイネージ画面で「持出中アイテム」タイトルと温度表示（`CPU xx% Temp yy.y°C`）が正常に表示されることを確認済み。詳細は [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ キオスク・サイネージUIで自端末の温度表示機能追加・実機検証完了**: キオスクUI（Pi4）とサイネージUI（Pi3）で自端末の温度を表示する機能を実装し、実機検証を完了。`ClientDevice.statusClientId`フィールドを追加し、`x-client-key`と`status-agent`の`clientId`を紐づけ。`GET /api/kiosk/config`エンドポイントを拡張し、`clientStatus`を返却。サイネージレンダラーで`getClientSystemMetricsText()`を実装し、Pi3の温度を取得して画像に埋め込む。サイネージ左ペインのタイトルを「工具管理データ」→「持出中アイテム」に変更。実機検証でPi4のキオスクUIで自端末の温度が正しく表示されることを確認済み。詳細は [knowledge-base/api.md#kb-126](./knowledge-base/api.md#kb-126-キオスクuiで自端末の温度表示機能追加) / [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ APIエンドポイントのHTTPS化・デプロイ標準手順のブラッシュアップ完了**: APIエンドポイントをHTTPS経由（Caddy経由）に変更し、デプロイ標準手順をブラッシュアップ。`group_vars/all.yml`の`api_base_url`を`http://{{ server_ip }}:8080/api`から`https://{{ server_ip }}/api`に変更。クライアント（Pi3/Pi4）のエージェントがCaddy経由（HTTPS 443）でAPIにアクセスするように統一。ポート8080は外部公開されていない（Docker内部ネットワークでのみアクセス可能）ことを明記。デプロイドキュメントを更新し、HTTPS経由での確認方法を追加。セキュリティ強度が向上（HTTPS化、8080非公開の維持）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-128](./knowledge-base/infrastructure/ansible-deployment.md#kb-128-apiエンドポイントのhttps化caddy経由) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ キオスクお問い合わせフォームのデザイン変更・実機検証完了**: キオスクUIのお問い合わせフォームを改善し、実機検証を完了。送信者を社員名簿から選択するドロップダウンに変更し、依頼内容を「現場まで来てください。」のドロップダウンに変更。打合せ日時の選択フィールド（日付・時刻）を追加し、デフォルト値として現在の日時を設定。キオスク専用の従業員リスト取得エンドポイント（`/api/kiosk/employees`）を追加し、`x-client-key`認証のみでアクセス可能に。実機検証でフォームの各フィールドが正常に動作することを確認済み。詳細は [knowledge-base/api.md#kb-125](./knowledge-base/api.md#kb-125-キオスク専用従業員リスト取得エンドポイント追加) / [knowledge-base/frontend.md#kb-125](./knowledge-base/frontend.md#kb-125-キオスクお問い合わせフォームのデザイン変更) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) を参照。

- **✅ キオスクSlackサポート機能実装・実機検証完了**: キオスクUIから管理者への問い合わせ機能（Slack通知）を実装し、実機検証を完了。キオスク画面ヘッダーに「お問い合わせ」ボタンを追加し、モーダルから問い合わせ内容を送信可能に。Slack Incoming Webhookを使用して通知を送信し、同時に既存のクライアントログとして保存。レート制限（1分に3件）とセキュリティ対策（Webhook URLの秘匿、タイムアウト処理）を実装。実機検証でSlack通知送信、ClientLog記録、APIログの正常動作をすべて確認済み。詳細は [knowledge-base/api.md#kb-124](./knowledge-base/api.md#kb-124-キオスクslackサポート機能の実装と実機検証完了) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md) を参照。

- **✅ Gmail経由CSV取り込み（手動実行）の実機検証完了**: Gmail経由でのCSVファイル自動取り込み機能の手動実行での実機検証を完了。Gmail検索・取得処理、CSVインポート処理、エラーハンドリングがすべて正常に動作することを確認。`GmailStorageProvider`が仕様通りに動作し、メールのアーカイブ処理も正常に機能。PowerAutomate設定後、スケジュール実行でのE2E検証を実施予定。詳細は [knowledge-base/api.md#kb-123](./knowledge-base/api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了) / [guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証](./guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証) を参照。

- **✅ 計測機器管理画面の部署表示・編集機能の実機検証完了**: 計測機器管理画面に`department`列と選択式編集機能を追加し、実機検証を完了。一覧表への部署列表示、新規作成フォームでの部署選択フィールド表示、部署候補の動的取得、部署の保存・更新がすべて正常に動作することを確認。詳細は [knowledge-base/api.md#kb-121](./knowledge-base/api.md#kb-121-部署一覧取得エンドポイント追加とprisma-where句の重複プロパティエラー修正) / [knowledge-base/frontend.md#kb-122](./knowledge-base/frontend.md#kb-122-計測機器管理画面にdepartment表示編集機能を追加) / [guides/verification-checklist.md#662-計測機器管理画面](./guides/verification-checklist.md#662-計測機器管理画面admintoolsmeasuring-instruments) を参照。

### 🆕 最新アップデート（2025-01-XX）

- **✅ 吊具CSVインポート検証完了・レイアウト改善**: 吊具CSVインポート（新フィールド`usableYears`）の検証を完了し、すべて正常に動作することを確認。吊具管理画面のレイアウトを改善し、一覧表と編集フォームが重ならないように修正。編集フォームを別のCardとして分離し、縦配置に変更。編集フォーム内のフィールドを2列のグリッドレイアウトに変更し、より使いやすく改善。実機検証でCSVインポート成功、`usableYears`フィールドの保存・表示・編集をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-120](./knowledge-base/frontend.md#kb-120-吊具管理画面のレイアウト改善一覧表と編集フォームの重なり解消) / [guides/verification-checklist.md#64-吊具csvインポート新フィールド](./guides/verification-checklist.md#64-吊具csvインポート新フィールド) / [guides/verification-checklist.md#663-吊具管理画面](./guides/verification-checklist.md#663-吊具管理画面admintoolsrigging-gears) を参照。

- **✅ 計測機器UID編集時のバグ修正完了**: 計測機器のUIDを手動編集しても反映されない問題を修正。根本原因は1つの計測機器に複数の`MeasuringInstrumentTag`が紐づいていたこと。APIの`update`メソッドで既存タグをすべて削除してから新しいタグを1つ作成するように修正し、1対1の関係を保つように改善。フロントエンドでは`useRef`を使用して手動編集フラグを追加し、ユーザーの手動編集を`useEffect`の自動更新で上書きしないように修正。デバッグモードでランタイム証拠を収集し、根本原因を正確に特定。実機検証でUID編集が正常に反映されることを確認済み。詳細は [knowledge-base/api.md#kb-118](./knowledge-base/api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) / [knowledge-base/frontend.md#kb-119](./knowledge-base/frontend.md#kb-119-計測機器uid編集時の手動編集フラグ管理) / [guides/verification-checklist.md#63-計測機器csvインポート新フィールド](./guides/verification-checklist.md#63-計測機器csvインポート新フィールド) を参照。

- **✅ CSVインポート構造改善と計測機器・吊具対応完了（CSV Import Scalingプラン完了）**: CSVインポート機能をレジストリ・ファクトリパターンでモジュール化し、計測機器・吊具のCSVインポートに対応。新しいデータタイプの追加が容易になり、コードの重複を削減。スケジュール設定を`targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に。後方互換性を確保（旧`employeesPath`/`itemsPath`形式もサポート）。`replaceExisting=true`時の安全性を確保（参照がある個体は削除しない）。Gmail件名パターンを管理コンソールから編集できる機能を実装し、設定ファイル（`backup.json`）に保存されるように変更。**プラン完了日**: 2025-12-29（全6To-do完了）。詳細は [guides/csv-import-export.md](./guides/csv-import-export.md) / [knowledge-base/frontend.md#kb-112](./knowledge-base/frontend.md#kb-112-csvインポート構造改善と計測機器吊具対応) / [knowledge-base/frontend.md#kb-113](./knowledge-base/frontend.md#kb-113-gmail件名パターンの管理コンソール編集機能) / [knowledge-base/api.md#kb-114](./knowledge-base/api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) / [knowledge-base/api.md#kb-115](./knowledge-base/api.md#kb-115-gmail件名パターンの設定ファイル管理) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ CSVインポートスケジュールページのUI統一・表示改善完了**: CSVインポートスケジュールページの日付指定UIをバックアップペイン（`BackupTargetForm.tsx`）と同じUIに統一。時刻入力（`type="time"`）と曜日選択ボタンを使用し、UI形式からcron形式への変換関数を実装。スケジュール表示を人間が読みやすい形式に変更（cron形式 `0 4 * * 1,2,3` → 「毎週月曜日、火曜日、水曜日の午前4時」）。デプロイ標準手順の遵守を徹底し、現在のブランチを使用するように修正。詳細は [knowledge-base/frontend.md#kb-109](./knowledge-base/frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) / [knowledge-base/frontend.md#kb-111](./knowledge-base/frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) / [knowledge-base/infrastructure/ansible-deployment.md#kb-110](./knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Gmailデータ取得機能実装完了**: PowerAutomateからGmail経由でCSVファイルやJPEGファイルをPi5に送信し、自動的にインポートする機能を実装完了。OAuth 2.0認証によるセキュアな認証フローを実装し、管理画面からGmail設定を管理できるUIを実装。Tailscale DNSをオフにした場合の`/etc/hosts`設定スクリプトを作成し、Gmail OAuth認証が正常に完了（refresh token取得済み）。GmailとDropboxのトークンリフレッシュの違いを明確化（Gmailは自動リフレッシュ、Dropboxは手動リフレッシュ）。詳細は [plans/gmail-data-acquisition-execplan.md](./plans/gmail-data-acquisition-execplan.md) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) / [knowledge-base/infrastructure/backup-restore.md#kb-108](./knowledge-base/infrastructure/backup-restore.md#kb-108-gmail-oauth認証時のtailscale-dns解決問題とetchosts設定) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ バックアップエラーハンドリング改善完了**: Dropboxストレージプロバイダーの`download`と`delete`メソッドに、レート制限エラー（429）とネットワークエラー時のリトライ機能を追加。指数バックオフによるリトライロジック（最大5回、最大30秒）を実装。レート制限エラーや一時的なネットワークエラーが発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上。詳細は [guides/backup-error-handling-improvements.md](./guides/backup-error-handling-improvements.md) / [knowledge-base/infrastructure/backup-restore.md#kb-107](./knowledge-base/infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善) を参照。

- **✅ バックアップスクリプトとの整合性確認完了**: `scripts/server/backup.sh`スクリプトと管理コンソールのバックアップ機能の整合性を確認。`/api/backup/internal`エンドポイントが存在し、localhostからのアクセスのみ許可されていることを確認。バックアップスクリプトが使用する`kind`と`source`の組み合わせが管理コンソールと一致していることを確認。両方の方法で同じ設定ファイル（`backup.json`）が使用され、バックアップ履歴が正しく記録されることを確認。詳細は [guides/backup-script-integration-verification.md](./guides/backup-script-integration-verification.md) / [knowledge-base/infrastructure/backup-restore.md#kb-106](./knowledge-base/infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認) を参照。

- **✅ 実機検証完了（画像バックアップ・items.csv）**: 画像バックアップのリストア検証を完了。`tar.gz`形式のバックアップを正常に展開・復元することを確認。items.csvのバックアップ・リストア検証も完了。バリデーションエラーはデータの問題（`ITEM-XXX`形式が`TOXXXX`形式に適合しない）であり、リストア機能自体は正常動作していることを確認。詳細は [guides/backup-restore-verification-results.md](./guides/backup-restore-verification-results.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-19）

- **✅ バックアップロジックのアーキテクチャ改善完了**: Factoryパターンとレジストリパターンを実装し、コード重複を完全に解消。新しいバックアップターゲット追加時の修正箇所が7箇所から2箇所に削減（約71%削減）。`BackupTargetFactory`と`StorageProviderFactory`を追加し、リストアロジックを各ターゲットに分離。設定ファイルによるパスマッピング管理を実装。`backup-scheduler.ts`に`client-file`ケースを追加して設定と実装の整合性を確保。リンター0エラー、ユニットテスト16/16成功。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md#phase-7-バックアップロジックのアーキテクチャ改善--完了) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ Ansibleによるクライアント端末バックアップ機能実装完了**: クライアント端末（Pi4、Pi3など）のファイルは物理的に別マシン上に存在するため、Pi5（サーバー）のAPIから直接アクセスできない問題を解決するため、Ansibleを使用してクライアント端末のファイルをPi5に取得してバックアップする機能を実装完了。Ansibleのinventoryでクライアント端末を管理し、スケーラブルに対応。実装時にAnsibleとTailscaleの連携で問題が発生したが、`hosts: "{{ client_host }}"`への変更とSSH鍵のマウントにより解決。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [knowledge-base/infrastructure/backup-restore.md#kb-102](./knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照。

- **✅ 画像バックアップリストア処理追加**: 画像バックアップは`tar.gz`形式で保存されるが、リストア時に展開処理がなかった問題を修正。`/api/backup/restore/from-dropbox`と`/api/backup/restore`エンドポイントに画像バックアップのリストア処理を追加。`tar.gz`を展開して写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元。既存ディレクトリの自動バックアップ機能も追加。ドキュメントを更新して画像バックアップのリストア手順を明記。詳細は [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-18）

- **✅ バックアップ対象管理UI実装完了**: 管理コンソールの「バックアップ」タブからバックアップ対象（`targets`）を管理できる機能を実装完了。バックアップ対象の追加・編集・削除、有効/無効切り替え、手動バックアップ実行が可能。`backup.sh`スクリプトと管理コンソールの機能が整合性を保ち、設定ファイル（`backup.json`）の変更が即座に反映される。統合テスト・E2Eテストも実装済み。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ 標準セキュリティチェックリスト監査完了**: IPA「安全なウェブサイトの作り方」、OWASP Top 10 2021、CISベンチマークに基づく監査を実施。主要なセキュリティ対策がほぼ完了していることを確認。未実施項目（CSRF対策、PostgreSQLのSSL/TLS接続強制、パスワードポリシー強化など）と必要性を評価。詳細は [security/standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) を参照。

- **✅ ポートセキュリティ強化（追加）完了**: Docker Composeのポートマッピング削除により、PostgreSQL（5432）とAPI（8080）のポートをDocker内部ネットワークでのみアクセス可能に（UFW依存を低減）。加えて、Pi5上の不要サービス（rpcbind/avahi/exim4/cups）をstop+disable+maskしてLISTEN自体を削減し、`ports-unexpected` を「外部露出 + プロセス込み」で有意にした。ベースライン証跡を保存。詳細は [security/port-security-audit.md](./security/port-security-audit.md) / [security/port-security-verification-results.md](./security/port-security-verification-results.md) / [knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ](./knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ) / [knowledge-base/infrastructure/ports-baseline-20260118.md](./knowledge-base/infrastructure/ports-baseline-20260118.md) を参照。

### 🆕 最新アップデート（2025-12-17）

- **✅ UI視認性向上カラーテーマ実装完了（Phase 1-8）**: 工場現場での視認性を向上させるため、提案3（工場現場特化・高視認性テーマ）を採用し、管理コンソール、サイネージ、キオスクのカラーテーマを改善完了。主要ページ（統合一覧、アイテム一覧、キオスク返却画面、サイネージレンダラー、管理コンソール全ページ、工具管理全ページ）に提案3カラーパレットを適用。コントラスト比約21:1（WCAG AAA準拠）を達成。詳細は [requirements/ui-visibility-color-theme.md](./requirements/ui-visibility-color-theme.md) / [modules/tools/README.md](./modules/tools/README.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Dropbox CSVインポート Phase 3完全検証・ベストプラクティス実装完了**: Phase 3の必須検証（実際のデータファイルを使用したエンドツーエンドテスト、エラーハンドリングテスト）を完了。ベストプラクティス実装（バックアップ履歴の記録機能、リストアAPIのパス処理改善）も完了。すべての検証項目が正常に動作することを確認し、本番運用可能な状態に到達。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/phase3-complete-verification-summary.md](./guides/phase3-complete-verification-summary.md) / [guides/phase3-mandatory-verification-results.md](./guides/phase3-mandatory-verification-results.md) / [guides/phase3-error-handling-test-results.md](./guides/phase3-error-handling-test-results.md) / [guides/phase3-next-tasks.md](./guides/phase3-next-tasks.md) を参照。

### 🆕 最新アップデート（2025-12-16）

- **✅ Dropbox CSVインポート Phase 3実装完了**: CSVインポート後の自動バックアップ機能、Dropboxからの自動リストア機能、バックアップ・リストア履歴機能を実装完了。`BackupHistory`モデル追加、`BackupHistoryService`実装、`BackupVerifier`による整合性検証機能、バックアップ履歴APIエンドポイント追加を完了。CIテストもすべて成功（BackupVerifier 12件、自動バックアップ機能 21件、バックアップAPI統合テストすべて成功）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ Dropbox CSVインポート Phase 1/2補完タスク完了**: Phase 1補完として認可設定確認（mustBeAdmin適用、rateLimit設定）、大規模CSV性能テスト（1000行・10000行）、テスト独立性の問題修正を完了。Phase 2補完としてPowerAutomate側仕様のドキュメント化（`docs/guides/powerautomate-dropbox-integration.md`）、PowerAutomate未配置時のリトライ/アラート確認テスト追加、履歴APIフィルタ/ページング機能実装を完了。CIテストもすべて成功（192 passed, 21 passed, 14 passed, 18 passed, 24 passed, 4 passed）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/powerautomate-dropbox-integration.md](./guides/powerautomate-dropbox-integration.md) を参照。

- **✅ Dropbox CSVインポート Phase 2 実機検証完了**: Phase 2の実機検証を完了。スケジュールAPI（CRUD）、手動実行API、CsvImportScheduler、ImportHistoryService（履歴記録）、ImportAlertService（アラート生成）のすべてが正常に動作することを確認。Dockerfile.apiにscriptsディレクトリを追加し、アラート生成機能も正常動作を確認。KB-101としてPi5へのSSH接続不可問題（force pushの影響）も記録。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [knowledge-base/infrastructure/ansible-deployment.md#kb-101](./knowledge-base/infrastructure/ansible-deployment.md#kb-101-pi5へのssh接続不可問題の原因と解決) を参照。

### 🆕 最新アップデート（2025-12-15）

- **✅ Dropbox CSVインポート Phase 2 実装完了**: Phase 2のスケジュール実行機能の実装とCI統合が完了。csv-import-scheduler（10件）、imports-schedule（13件）、import-alert（4件）の合計27件のテストがCIで実行され、すべて成功。ImportHistoryServiceの有効化とPrismaマイグレーション実行も完了（ローカル・実機の両方）。CsvImportHistoryテーブルが作成され、インポート履歴の記録機能が利用可能に。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-history-migration.md](./guides/csv-import-history-migration.md) を参照。

- **✅ Dropbox CSVインポート Phase 1 実装完了**: DropboxからCSVファイルをダウンロードしてインポートする機能を実装完了。パストラバーサル防止、バリデーション強化、ログ出力、エラーハンドリング、追加テスト（13件すべてパス）を実装。CI必須化（`continue-on-error`削除）とブランチ保護設定ガイドも作成。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/ci-branch-protection.md](./guides/ci-branch-protection.md) を参照。

- **✅ Dropbox OAuth 2.0フローとリフレッシュトークン自動更新機能実装・実機検証完了**: OAuth 2.0認証フロー、リフレッシュトークンによる自動アクセストークン更新機能を実装完了し、実機検証も完了。401エラー（`expired_access_token`）時に自動的にリフレッシュし、設定ファイルを自動更新。テストも実装済み（10件すべてパス）。実機検証では、Docker Composeのconfigボリューム読み書き権限問題（KB-099）を解決し、OAuth認証フロー、リフレッシュトークン更新、ファイルバックアップの動作を確認済み。詳細は [plans/backup-modularization-execplan.md](./plans/backup-modularization-execplan.md) / [guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md) / [guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md) / [knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題) を参照。

### 🆕 最新アップデート（2025-12-14）

- **✅ Phase 9/10 セキュリティ強化完了**: インターネット接続時の追加防御（Phase 9）と認証・監視強化（Phase 10）を実装完了。管理画面IP制限、Webhookアラート通知、セキュリティヘッダー（Strict-Transport-Security含む）、DDoS/ブルートフォース緩和（レート制限）、MFA（多要素認証）、リアルタイム監視強化、権限監査を実装。実機テストも完了し、ローカルネットワークとインターネットの両環境で安全に運用可能。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) / [security/phase9-10-specifications.md](./security/phase9-10-specifications.md) / [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

- **📊 外部インシデント評価と追加対策**: アスクル社ランサムウェア事故を踏まえた対応可否と推奨対策（MFA、リアルタイム監視、権限監査）を実装完了。詳細は [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

### 🆕 最新アップデート（2025-12-13）

- **✅ サイネージデザイン改善（レイアウト/座標再調整）**: サーバー側レンダラーで余白を最小化しつつ、右ペインのタイトル・ファイル名とPDF表示領域の重なりを解消。外枠余白を極小化、タイトル・ファイル名のベースラインオフセットを揃え、PDFの黒地を拡大。詳細は [modules/signage/README.md](./modules/signage/README.md) / [knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない](./knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) を参照。

- **✅ サイネージタブ内にPDFアップロード機能を統合**: 管理コンソールの「サイネージ」タブ（`/admin/signage/schedules`）にPDFアップロード・管理機能を追加。スケジュール設定画面と同じページでPDFをアップロード・管理できるようになり、ワークフローが改善されました。`SignagePdfManager`コンポーネントを新規作成して共通化し、サイネージタブとクライアント端末管理ページの両方で使用可能に。詳細は [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2025-12-12）

- **✅ Ansibleデプロイのブランチ指定機能追加**: `scripts/update-all-clients.sh`とAnsibleの`deploy.yml`でブランチを指定可能に。デフォルトは`main`ブランチ。開発ブランチ（`feature/production-deployment-management`）のハードコードを削除し、環境変数`ANSIBLE_REPO_VERSION`または引数でブランチを指定可能に。`scripts/update-all-clients.sh <branch> <inventory_path>`で全デバイス（Pi5 + Pi3/Pi4）を更新可能（**誤デプロイ防止のためinventory指定は必須**）。詳細は [guides/deployment.md](./guides/deployment.md) / [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) を参照。

- **✅ デプロイメントベストプラクティスの明確化**: 開発時（Pi5のみ）は`scripts/server/deploy.sh <branch>`、運用時（全デバイス）は`scripts/update-all-clients.sh <branch> <inventory_path>`を使用する使い分けをドキュメント化。デフォルトは`main`ブランチで、開発ブランチをハードコードしない設計に統一。詳細は [guides/deployment.md](./guides/deployment.md) を参照。

- **🆕 network_mode戻り・ローカルIP変動への対策**: git syncで`network_mode`が`local`へ戻る事象（KB-094）を踏まえ、デプロイ前だけでなくヘルスチェック前にも再確認する運用を追加。ローカルIPは毎回`hostname -I`で取得し`group_vars/all.yml`を更新するよう明記。キオスク向けヘルスチェックから`signage-lite`チェックを除外。詳細: [guides/deployment.md](./guides/deployment.md), [knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題](./knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題), [infrastructure/ansible/playbooks/health-check.yml](../infrastructure/ansible/playbooks/health-check.yml)

- **✅ 吊具管理モジュール 1stリリース**: Prismaスキーマ/CRUD/API/管理コンソール/キオスクを追加。吊具タグ→従業員タグで持出登録し、成功時は`defaultMode`に従い自動遷移（計測機器と同等UX）。管理コンソールでUID登録・編集・削除（空文字で削除指示）、点検記録の簡易登録、一覧にUID列を追加。UIを横幅拡大・非折返しに調整。詳細は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **✅ NFC/UIDハンドリングの共通化**: 管理コンソール（計測機器・吊具）でNFCスキャン自動入力を復旧し、UID入力欄を空にして保存するとタグ紐付けを削除する仕様に統一。計測機器タブのスキャン不能/削除不可事象を解消。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスク→管理コンソール遷移の強制ログイン**: キオスクヘッダーの「管理コンソール」ボタンを`/login?force=1`遷移に変更し、既ログインでも必ず再認証を実施。戻り先は`/admin`を維持。関連: `KioskLayout.tsx` / `LoginPage.tsx`。

### 🆕 最新アップデート（2025-12-11）

- **✅ 管理コンソール: 計測機器のNFCタグ登録欄を追加**: 計測機器の登録/編集フォームに「NFC/RFIDタグUID」入力欄を追加し、保存時にタグ紐付けを同時登録（重複UIDは409で拒否）。既存のRFIDタグ管理ページも併用可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスクUI簡素化: 返却タブ削除**: 機能重複のため「返却」「計測機器 返却」の2タブを削除し、「持出」「計測機器 持出」の2タブ構成に統一。持出画面の持出一覧から工具・計測機器の両方を返却可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ サイネージ左ペインの計測機器表示改善**: Pi3サイネージの工具データ左ペインで、計測機器の持出アイテムを藍系背景で表示し、管理番号を上段・名称を下段に2行表示。工具と計測機器を視覚的に識別可能に。バックエンド（`signage.service.ts`）とレンダラー（`signage.renderer.ts`）を修正。詳細は [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ 持出一覧キオスクUI改善**: 計測機器は「管理番号＋名称」を2行表示し、背景色を藍系に変更して工具と識別。写真持出は「写真撮影モード」を表示し、「アイテム情報なし」は非表示。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) を参照。

- **✅ 計測機器持出: エラー時の無限ループ修正とメッセージ改善**: エラー発生時に持出登録ボタンが無限ループ動作する問題を修正。エラー時に氏名タグをクリアして自動再送を防止し、APIエラーメッセージを短縮・ユーザーフレンドリーに改善（「タグ未登録（計測機器）」「タグ未登録（社員）」「既に貸出中です」など）。詳細は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題9-エラー時に持出登録ボタンが無限ループ動作する) を参照。

- **✅ NFC/カメラ入力のスコープ分離: 実装完了**: 計測機器モードでの氏名タグスキャン直後にPHOTOモードが誤発火する問題を解決。`useNfcStream`フックに`enabled`フラグと`enabledAt`タイムスタンプを追加し、ページ遷移前のイベントを無視。各キオスクページで`useMatch`を使用して、アクティブなページの時のみNFC購読を有効化。詳細は [plans/nfc-stream-isolation-plan.md](./plans/nfc-stream-isolation-plan.md) を参照。

- **計測機器キオスク: ドロップダウン→氏名タグで自動送信を復旧**: JWT失敗時でも`x-client-key`フォールバック後にHTTP 200へ戻すようAPIを修正し（`apps/api/src/routes/measuring-instruments/index.ts`）、Pi4キオスクで「てこ式ダイヤルゲージ」がドロップダウンに復活。さらに、タグ未登録でもドロップダウン選択＋氏名タグスキャンで自動送信されるようUI条件を緩和（`apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`）。経緯と手順は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題8-ドロップダウン選択時に氏名タグ自動送信されない) と [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **計測機器キオスク: エラーメッセージ/リセット修正**: 古いフロントビルドが配信されていたため最新文言が未反映・リセット不可だった問題を解消。未登録タグ時に「タグ未登録（アイテム/社員）」を表示し、リセットはF5リロードで初期化。手順と原因は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題6-エラーメッセージが古いリセットが効かない) を参照。
- **計測機器キオスク実機検証トラブル対応**: Pi4の`kiosk-launch.sh`が空URLで起動しカメラ/APIが動かない問題を修正。原因と対処・再発防止を [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題5-キオスクブラウザ起動が空urlでカメラapiが動かない) に追記。

- **計測機器管理システム Phase 1-3 実装完了**: データベーススキーマ、バックエンドAPI（CRUD、持ち出し/返却API）、フロントエンドAPI統合、管理コンソールUI（計測機器・点検項目・RFIDタグ・点検記録のCRUDページ）、キオスク持出・返却ページ（手入力対応）を実装完了。TS100統合と点検項目表示・NGボタン機能は未実装。詳細は [modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md) / [requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **Lint統合 Phase 8 完了**: 契約テスト（API/Web）と破壊的変更検知スナップショットを追加。`pnpm lint --max-warnings=0`/e2e-smoke/e2e-tests/docker-build がCIで成功（run #641）。import/order違反ナレッジをガイドに追加。詳細は [plans/lint-integration-plan.md](./plans/lint-integration-plan.md) / [guides/lint.md](./guides/lint.md) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

- **デプロイメントモジュール設計**: Tailscale/セキュリティ機能実装後に発生したサイネージ・キオスク機能不全の根本原因を分析し、設定変更を自動検知・影響範囲を自動判定してデプロイする「堅剛なロジック」を設計。4つの独立モジュール（config-detector, impact-analyzer, deploy-executor, verifier）を標準入出力（JSON）で連携する疎結合・モジュール化アーキテクチャ。テスト項目を明確化し、単体・統合・E2Eテストの計画を策定。詳細は [architecture/deployment-modules.md](./architecture/deployment-modules.md) を参照。
- **サイネージUI最終調整**: 左ペインTOOLSを3列化しサムネイルを最大化。右ペインの更新文言を削除。Pi3で再デプロイ済み（`signage-lite`再起動）。
- **キオスクUI統一**: 返却（持出）一覧を5列＋ボタン縦並びに統一。APIキー初期値を管理コンソールと同一に強制し、設定カードを非表示化。Pi4で再起動済み。
- **Phase 8 継続**: サイネージ／キオスク回帰対応を進行中。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) と [KB-080〜085](./knowledge-base/infrastructure.md) を参照。
- **Phase 7 セキュリティ検証完了**: IPアドレス切替、Tailscale経路、UFW/HTTPS、fail2ban、暗号化バックアップ復元、ClamAV/Trivy/rkhunterスキャンを一通り手動検証しました。`alerts/alert-20251205-182352.json`（fail2ban）と `alert-20251205-184324.json`（rkhunter）を生成し、監視ルートの動作も確認済み。複数ローカルネットワーク環境（会社/自宅）でのVNC接続設定も対応済み。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) および [docs/security/requirements.md](./security/requirements.md) を参照してください。ナレッジベース: [KB-078](./knowledge-base/infrastructure/security.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定), [KB-079](./knowledge-base/infrastructure/security.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント)
- **Phase 6 セキュリティ監視・アラート実装完了**: fail2banのBanイベントとマルウェアスキャン結果を自動監視し、管理画面でアラート表示する仕組みを実装しました。`security-monitor.sh`がsystemd timer（15分間隔）で実行され、fail2banログを監視して侵入試行を検知します。ClamAV/Trivy/rkhunterのスキャン結果も自動でアラート化され、感染検知やスキャンエラー時に即座に通知されます。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) を参照してください。ナレッジベース: [KB-076](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー), [KB-077](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)
- **Ansibleロール化 & 新`deploy.yml`**: `common/server/client/kiosk/signage` ロールを導入し、メインプレイブックを `playbooks/deploy.yml` に刷新しました。既存の `update-clients.yml` は互換ラッパーとして残しつつ、今後は `ansible-playbook infrastructure/ansible/playbooks/deploy.yml` の利用を推奨します。詳細は [plans/ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) を参照してください。

- **Phase 2.4 実機テスト完了**: クライアント状態可視化とデバッグ支援システムの実機テストを完了しました。Raspberry Pi 5上でstatus-agentを設定・実行し、systemd timerで1分ごとに自動実行されることを確認。管理画面で稼働状況カードが正しく表示され、CPU/メモリ/温度などのメトリクスが更新されることを確認。詳細は [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) を参照してください。
- **システム安定性向上の実装完了**: エラーハンドリングとログ出力の最適化を実装しました。エラーメッセージの詳細化、エラーログの構造化、ログレベルの環境変数制御、Dockerログローテーション設定を完了。詳細は [plans/stability-improvement-plan.md](./plans/stability-improvement-plan.md) を参照してください。ガイドドキュメント: [エラーハンドリングガイド](./guides/error-handling.md), [ログ出力ガイド](./guides/logging.md)
- **サイネージ持出中アイテム表示の改善**: 借用日時を日本標準時（JST）で表示し、12時間超のアイテムを赤色で強調してリストの先頭に配置するように改善しました。アイテムコードのフォントサイズも日時と同じサイズに調整しました。
- **Raspberry Pi 4再起動時のサービス起動ガイド**: [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) を追加。開発中に自動起動を無効化している場合の手動起動手順、Docker Compose推奨方法、Poetry直接起動の問題点と改善案を記載しました。
- **サイネージ自動レンダリングの安定化**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) と [guides/signage-test-plan.md](./guides/signage-test-plan.md) に、`SignageRenderScheduler` の自動実行・管理画面からの手動再レンダリング手順・`SIGNAGE_RENDER_DIR` の設定方法を追記しました。
- **PDFスライド & 工具サムネイル改善**: サイネージの分割表示で PDF スライドショーが必ずページ送りされるようになり、工具サムネイルは 4:3 のまま大型表示に統一されました。詳細は [knowledge-base/api.md](./knowledge-base/api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) / [knowledge-base/api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) を参照してください。
- **軽量クライアントTLS/Troubleshooting**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) に自己署名証明書環境での `curl -k` 設定や初回キャッシュ待機ロジック、`setup-signage-lite.sh` の改善点を追加しました。
- **CPU/温度モニタリング**: 画像レンダリング時に `/proc/stat` と `/sys/class/thermal` を取得し、サイネージヘッダー右上に `CPU xx% / Temp yy.y°C` を表示するようにしました。
- **PDFトリミング問題の解消**: `fit: 'contain'` + 背景色でレターボックス表示に変更し、PDFの縦横比にかかわらず全体が映るようになりました。詳細は [knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される](./knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される) を参照してください。
- **NFCエージェントキュー処理改善**: 工具スキャンが二重登録される問題を解決。オンライン時にイベントを即座に配信し、配信成功したイベントはキューから即時削除するように変更。詳細は [knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善](./knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) を参照してください。
- **ナレッジベース更新**: [knowledge-base/index.md](./knowledge-base/index.md) の登録件数が 74件になり、fail2ban連携のセキュリティ監視タイマー（KB-076）とマルウェアスキャン結果の自動アラート化（KB-077）を追加しました。
- **Raspberry Pi status-agent**: クライアント端末が1分毎にメトリクスを送信する `status-agent.py`（systemd timer 同梱）を追加。ガイドは [guides/status-agent.md](./guides/status-agent.md)、ソースは `clients/status-agent/` を参照してください。
- **ローカル環境対応の通知機能**: 管理画面でのアラート表示とファイルベースの通知機能を実装しました。Ansible更新失敗時に自動的にアラートファイルを生成し、管理画面で確認できます。ガイドは [guides/local-alerts.md](./guides/local-alerts.md) を参照してください。
- **Ansible堅牢化・安定化の実装**: `git clean`による設定ファイル削除問題を解決し、システム設定ファイル（polkit設定など）をAnsibleで管理する仕組みを実装しました。バックアップ・ロールバック機能も追加。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。ガイド: [Ansibleで管理すべき設定ファイル一覧](./guides/ansible-managed-files.md)、ナレッジベース: [KB-061](./knowledge-base/infrastructure/ansible-deployment.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策)
- **Ansible設定ファイル管理化の実装**: systemdサービスファイル（kiosk-browser.service、signage-lite.service）とアプリケーション設定ファイル（.env）のAnsible管理化を実装しました。実用段階に到達。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。

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
| **計測機器管理システムを理解したい** | **[modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md)**, **[requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md)** |
| **Ansibleロールを追加・修正したい** | **[guides/ansible-role-development.md](./guides/ansible-role-development.md)** |
| APIを理解したい | [api/overview.md](./api/overview.md), [api/auth.md](./api/auth.md) |
| **APIキー統一の方針とフィルタリングロジック** | [guides/api-key-policy.md](./guides/api-key-policy.md) |
| モジュール構造を理解したい | [decisions/001-module-structure.md](./decisions/001-module-structure.md) |
| サービス層を理解したい | [decisions/002-service-layer.md](./decisions/002-service-layer.md) |
| CSVインポート・エクスポートを理解したい | [guides/csv-import-export.md](./guides/csv-import-export.md) |
| **Dropbox CSV統合機能の現状を把握したい** | **[analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md)** |

### デプロイ・運用する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 本番環境にデプロイしたい | [guides/deployment.md](./guides/deployment.md) |
| **デプロイメントモジュール（原因分析・設計・テスト計画）を確認したい** | **[architecture/deployment-modules.md](./architecture/deployment-modules.md)** |
| 本番環境をセットアップしたい | [guides/production-setup.md](./guides/production-setup.md) |
| バックアップ・リストアしたい | [guides/backup-and-restore.md](./guides/backup-and-restore.md) |
| **バックアップ設定を変更したい** | **[guides/backup-configuration.md](./guides/backup-configuration.md)** |
| **バックアップ対象を管理したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** / **[requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md)** |
| **バックアップ機能を実機検証したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** |
| **外部連携（Dropbox/Gmail/Slack）の設定・運用を管理したい** | **[guides/external-integration-ledger.md](./guides/external-integration-ledger.md)** |
| **Dropbox OAuth 2.0を設定したい** | **[guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md)** |
| **Dropbox OAuth 2.0を実機検証したい** | **[guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md)** |
| **Slack Webhookを設定したい** | **[guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md)** |
| **Gmail連携を設定したい** | **[guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md)** |
| **CI必須化とブランチ保護設定** | **[guides/ci-branch-protection.md](./guides/ci-branch-protection.md)** |
| 監視・アラートを設定したい | [guides/monitoring.md](./guides/monitoring.md) |
| デジタルサイネージ機能をデプロイしたい | [guides/signage-deployment.md](./guides/signage-deployment.md) |
| デジタルサイネージクライアント端末をセットアップしたい | [guides/signage-client-setup.md](./guides/signage-client-setup.md)（Chromiumモード / `setup-signage-lite.sh` 軽量モード） |
| **サイネージレイアウト設定の実機検証を実施したい** | **[guides/signage-layout-config-verification.md](./guides/signage-layout-config-verification.md)** |
| クライアント端末を一括更新したい | [plans/production-deployment-management-plan.md](./plans/production-deployment-management-plan.md#phase-1-一括更新システムssh--ansible) |
| Ansibleの堅牢化・安定化を実施したい | [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) |
| Ansibleで管理すべき設定ファイルを確認したい | [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) |
| Ansibleエラーハンドリングを確認したい | [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) |
| Ansibleベストプラクティスを確認したい | [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) |
| git cleanの安全な使用方法を確認したい | [guides/git-clean-safety.md](./guides/git-clean-safety.md) |
| クライアント状態監視のExecPlanを確認したい | [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) |
| Raspberry Pi クライアントにSSH鍵を配布したい | [guides/ssh-setup.md](./guides/ssh-setup.md) |
| **Raspberry Pi 4 再起動時のサービス起動** | [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) |
| Raspberry Pi status-agentを導入したい | [guides/status-agent.md](./guides/status-agent.md) |
| **クライアント一括更新と監視のクイックスタート** | [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) |
| **ローカル環境対応の通知機能** | [guides/local-alerts.md](./guides/local-alerts.md) |
|| **新規クライアント端末の初期設定** | [guides/client-initial-setup.md](./guides/client-initial-setup.md) |
|| **MacからRaspberry Pi 5へのSSH接続** | [guides/mac-ssh-access.md](./guides/mac-ssh-access.md) |
|| **Ansible SSH接続アーキテクチャの説明** | [guides/ansible-ssh-architecture.md](./guides/ansible-ssh-architecture.md) |
|| **環境構築ガイド（ローカルネットワーク変更時）** | [guides/environment-setup.md](./guides/environment-setup.md) |
|| **システム自動起動の現状と設定** | [guides/auto-startup-status.md](./guides/auto-startup-status.md) |
|| **クライアント端末のstatus-agent設定（実機テスト用）** | [guides/setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) |

### 検証する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 計測機器キオスク実機検証 | [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) |
| 機能を検証したい | [guides/verification-checklist.md](./guides/verification-checklist.md) |
| **CSVフォーマット仕様実装を検証したい** | **[guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31](./guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)** |
| USBインポートを検証したい | [guides/validation-7-usb-import.md](./guides/validation-7-usb-import.md) |
| デジタルサイネージ機能を検証したい | [guides/signage-test-plan.md](./guides/signage-test-plan.md) |
| **CSVダッシュボード可視化機能を検証したい** | **[guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md)** |
| **計測機器持出返却イベント機能を検証したい** | **[guides/measuring-instrument-loan-events-verification.md](./guides/measuring-instrument-loan-events-verification.md)** |
| システム安定性向上機能を検証したい | [guides/stability-improvement-test.md](./guides/stability-improvement-test.md) |
| セキュリティを検証したい | [security/validation-review.md](./security/validation-review.md) |
| **セキュリティ要件を確認したい** | **[security/requirements.md](./security/requirements.md)** |
| **セキュリティ強化の実装計画を確認したい** | **[plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md)** |
| **Phase 9/10 セキュリティ機能の詳細仕様を確認したい** | **[security/phase9-10-specifications.md](./security/phase9-10-specifications.md)** |
| **セキュリティ強化のテスト計画を確認したい** | **[guides/security-test-plan.md](./guides/security-test-plan.md)** |
| **インシデント対応手順を確認したい** | **[security/incident-response.md](./security/incident-response.md)** |
| **外部インシデント評価と追加対策** | **[security/implementation-assessment.md](./security/implementation-assessment.md)** |
| **システム担当者向けセキュリティプレゼン資料** | **[presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md)** |
| **IPアドレス管理の変数化について知りたい** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-069](./knowledge-base/infrastructure/ansible-deployment.md#kb-069)** |
| **運用モード可視化について知りたい** | **[knowledge-base/infrastructure/miscellaneous.md#kb-070](./knowledge-base/infrastructure/miscellaneous.md#kb-070)** |
| **Tailscale導入について知りたい** | **[knowledge-base/infrastructure/security.md#kb-071](./knowledge-base/infrastructure/security.md#kb-071)** |
| **ファイアウォール/HTTPS強化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-072](./knowledge-base/infrastructure/security.md#kb-072)** |
| **fail2ban設定について知りたい** | **[knowledge-base/infrastructure/security.md#kb-073](./knowledge-base/infrastructure/security.md#kb-073)** |
| **Pi5のマルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-074](./knowledge-base/infrastructure/security.md#kb-074)** |
| **Pi4キオスクの軽量マルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-075](./knowledge-base/infrastructure/security.md#kb-075)** |
| **fail2ban連携のセキュリティ監視を確認したい** | **[knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー)** |
| **マルウェア検知アラート化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)** |

### エラーを解決する

| やりたいこと | ドキュメント |
|-------------|-------------|
| セキュリティインシデントに対応したい | [security/incident-response.md](./security/incident-response.md) |
| トラブルシューティングしたい | [knowledge-base/troubleshooting-knowledge.md](./knowledge-base/troubleshooting-knowledge.md) |
| CI/CDの問題を解決したい | [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) |
| NFCリーダーの問題を解決したい | [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) |
| **工具管理システムのデータ整合性を確認したい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **工具管理システムの復旧手順を知りたい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **エラーハンドリングを理解したい** | **[guides/error-handling.md](./guides/error-handling.md)** |
| **ログ出力を理解したい** | **[guides/logging.md](./guides/logging.md)** |
| **Dropbox OAuth設定でエラーが発生した** | **[knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題)** |
| **CIテストが失敗してもマージできてしまう** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-100](./knowledge-base/infrastructure/ansible-deployment.md#kb-100-ciテストが失敗してもマージが進んでしまう問題再発)** / **[.github/BRANCH_PROTECTION_SETUP.md](../.github/BRANCH_PROTECTION_SETUP.md)** |

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
| [modules/tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [decisions/001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [decisions/002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

### 運用者

| ドキュメント | 説明 |
|-------------|------|
| [guides/deployment.md](./guides/deployment.md) | デプロイ手順 |
| [guides/production-setup.md](./guides/production-setup.md) | 本番環境セットアップ（HTTPS設定含む） |
| [guides/backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [guides/monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [runbooks/ports-unexpected-and-port-exposure.md](./runbooks/ports-unexpected-and-port-exposure.md) | **Runbook**: `ports-unexpected` / ポート露出の点検と切り分け |
| [runbooks/kiosk-loan-status-repair.md](./runbooks/kiosk-loan-status-repair.md) | **Runbook**: キオスク貸出の取消混入と資産status修復 |
| [guides/operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [modules/tools/operations.md](./modules/tools/operations.md) | **工具管理運用・保守ガイド**（データ整合性、復旧手順、エラーハンドリング） |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |

### システム担当者・経営層

| ドキュメント | 説明 |
|-------------|------|
| [presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |
| [security/requirements.md](./security/requirements.md) | **セキュリティ要件定義**（Tailscale主運用、IPアドレス管理、ランサムウェア対策など） |
| [security/implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

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
| [deployment-modules.md](./architecture/deployment-modules.md) | **デプロイメントモジュール**（原因分析・設計・テスト計画統合、疎結合・モジュール化アーキテクチャ） |

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
| [tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [tools/api.md](./modules/tools/api.md) | 工具管理API |
| [tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [tools/photo-loan.md](./modules/tools/photo-loan.md) | **写真撮影持出機能**（FR-009） |
| [measuring-instruments/README.md](./modules/measuring-instruments/README.md) | **計測機器管理モジュール概要** |
| [measuring-instruments/api.md](./modules/measuring-instruments/api.md) | **計測機器管理API仕様** |
| [measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) | **計測機器管理UI設計メモ** |
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
| [measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) | **計測機器管理システム要件定義** |

### 実装計画（plans/）

機能実装の計画と進捗。

| ファイル | 説明 |
|---------|------|
| [production-deployment-management-plan.md](./plans/production-deployment-management-plan.md) | プロダクション環境デプロイメント・更新・デバッグ管理計画 |
| [production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) | クライアント状態可視化とデバッグ支援システム実行計画 |
| [production-documents-feature-plan.md](./plans/production-documents-feature-plan.md) | **写真付きドキュメント表示機能の実装計画**（設計検討中） |
| [stability-improvement-plan.md](./plans/stability-improvement-plan.md) | システム安定性向上計画 |
| [ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) | **Ansible安定性・堅牢化・柔軟性向上計画** |
| [ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) | **Ansible Phase 9（ロール化）実行計画** |
| [tool-management-debug-execplan.md](./plans/tool-management-debug-execplan.md) | **キオスク工具スキャン重複＆黒画像対策 ExecPlan** |
| [ts100-integration-plan.md](./plans/ts100-integration-plan.md) | **TS100 RFIDリーダー統合計画**（計測機器管理システム用） |

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
| [production-schedule-signage.md](./guides/production-schedule-signage.md) | **生産スケジュール進捗サイネージ可視化ガイド** |
| [ci-troubleshooting.md](./guides/ci-troubleshooting.md) | CI/CDトラブルシューティング |
| [operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [ai-handoff.md](./guides/ai-handoff.md) | **AI引き継ぎガイド**（別AIへの引き継ぎ時） |
|| [client-initial-setup.md](./guides/client-initial-setup.md) | **新規クライアント端末の初期設定手順** |
|| [mac-ssh-access.md](./guides/mac-ssh-access.md) | **MacからRaspberry Pi 5へのSSH接続ガイド** |
|| [auto-startup-status.md](./guides/auto-startup-status.md) | **システム自動起動の現状と設定手順** |
|| [ai-ssh-access.md](./guides/ai-ssh-access.md) | **AIアシスタントのSSHアクセスについて** |
|| [setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) | **クライアント端末のstatus-agent設定手順（実機テスト用）** |
| [status-agent.md](./guides/status-agent.md) | Raspberry Pi クライアント状態送信エージェント |
| [quick-start-deployment.md](./guides/quick-start-deployment.md) | **クライアント一括更新と監視のクイックスタート** |
| [local-alerts.md](./guides/local-alerts.md) | **ローカル環境対応の通知機能ガイド** |
| [local-alerts-verification.md](./guides/local-alerts-verification.md) | **ローカル環境対応の通知機能 実機検証手順** |
| [ssd-migration.md](./guides/ssd-migration.md) | **SDカードからSSDへの移行手順** |
| [ansible-managed-files.md](./guides/ansible-managed-files.md) | **Ansibleで管理すべき設定ファイル一覧** |
| [ansible-error-handling.md](./guides/ansible-error-handling.md) | **Ansibleエラーハンドリングガイド** |
| [ansible-best-practices.md](./guides/ansible-best-practices.md) | **Ansibleベストプラクティス** |
| [git-clean-safety.md](./guides/git-clean-safety.md) | **git cleanの安全な使用方法** |
| [mac-storage-migration.md](./guides/mac-storage-migration.md) | **Macストレージ圧迫対策: Docker/Cursorデータの外付けSSD移行とGoogleドライブバックアップ** |

### トラブルシューティング（knowledge-base/, troubleshooting/）

問題解決のナレッジベース。**カテゴリ別に分割されています。**

| ファイル | 説明 |
|---------|------|
| [knowledge-base/index.md](./knowledge-base/index.md) | 📋 **ナレッジベース索引**（全65件の一覧） |
| [knowledge-base/api.md](./knowledge-base/api.md) | API関連（16件） |
| [knowledge-base/database.md](./knowledge-base/database.md) | データベース関連（3件） |
| [knowledge-base/ci-cd.md](./knowledge-base/ci-cd.md) | CI/CD関連（4件） |
| [knowledge-base/frontend.md](./knowledge-base/frontend.md) | フロントエンド関連（15件） |
| [knowledge-base/infrastructure.md](./knowledge-base/infrastructure.md) | インフラ関連（25件） |
| [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) | NFCリーダー固有の問題 |

### セキュリティ（security/）

セキュリティに関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [requirements.md](./security/requirements.md) | **セキュリティ要件定義**（Tailscale主運用、IPアドレス管理、ランサムウェア対策など） |
| [validation-review.md](./security/validation-review.md) | バリデーションレビュー |
| [implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [incident-response.md](./security/incident-response.md) | **インシデント対応手順**（侵入・マルウェア検知時の初動・封じ込め・復旧手順） |
| [port-security-audit.md](./security/port-security-audit.md) | **ポートセキュリティ監査レポート**（ポート公開状況の監査と修正内容、2025-12-18） |
| [port-security-verification.md](./security/port-security-verification.md) | **ポートセキュリティ修正後の動作確認手順**（ポートマッピング削除後の動作確認手順、2025-12-18） |
| [port-security-verification-results.md](./security/port-security-verification-results.md) | **ポートセキュリティ修正後の実機検証結果**（実機検証結果と評価、2025-12-18） |
| [standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) | **標準セキュリティチェックリスト監査レポート**（IPA、OWASP、CISベンチマークに基づく監査結果、2025-12-18） |
| [postgresql-password-policy-implementation.md](./security/postgresql-password-policy-implementation.md) | **PostgreSQLパスワードポリシー強化の実装**（環境変数によるパスワード管理の実装手順、2025-12-18完了） |
| [evaluation-plan.md](./security/evaluation-plan.md) | **セキュリティ評価計画書**（OWASP/IPA/CIS/NIST等の標準指標に基づく評価実施計画、2026-01-18作成） |
| [evaluation-report.md](./security/evaluation-report.md) | **セキュリティ評価報告書**（評価計画書に基づく評価実施結果、2026-01-18作成） |
| [external-intrusion-risk-analysis.md](./security/external-intrusion-risk-analysis.md) | **外部侵入リスク分析レポート**（外部からの不正侵入リスクの詳細分析、2026-01-18作成） |
| [urgent-security-measures.md](./security/urgent-security-measures.md) | **緊急に実装すべき安全対策機能**（USBメモリ運用予定がない前提での緊急実装項目、2026-01-18作成） |
| [log-redaction-implementation.md](./security/log-redaction-implementation.md) | **ログの機密情報保護実装レポート**（x-client-keyのログ出力を[REDACTED]に置換する実装、2026-01-18実装完了） |
| [system-inventory.md](./security/system-inventory.md) | **システム構造台帳**（評価対象/公開面/外部連携/秘密情報の所在、2026-01-28作成） |
| [evidence/production-verification-guide.md](./security/evidence/production-verification-guide.md) | **実機検証実行ガイド**（Pi5本番でのセキュリティ評価実機検証手順、2026-01-28作成） |

### プレゼンテーション（presentations/）

システム担当者・経営層向けのプレゼンテーション資料。

| ファイル | 説明 |
|---------|------|
| [security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |

---

## 🔗 コードとの対応関係

### 工具管理モジュール（tools）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/tools/README.md](./modules/tools/README.md), [modules/tools/operations.md](./modules/tools/operations.md) |
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
| アーキテクチャ | 4 |
| 設計決定 | 3 |
| モジュール仕様 | 6 |
| APIリファレンス | 2 |
| 要件定義 | 1 |
| 実装計画 | 7 |
| 実践ガイド | 31 |
| トラブルシューティング | 6 |
| セキュリティ | 3 |
| プレゼンテーション | 1 |
| **合計** | **56** |

---

## 📝 関連ドキュメント

- [EXEC_PLAN.md](../EXEC_PLAN.md): プロジェクト管理ドキュメント
- [README.md](../README.md): プロジェクト概要、ドキュメント体系の基本思想
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md): ドキュメントリファクタリング計画

---

## 📅 更新履歴

- 2025-11-27: 初版作成
- 2025-12-01: ローカルアラートシステム関連ドキュメント追加、ナレッジベースKB-059追加、統計更新
- 2025-12-01: 工具管理システム運用・保守ガイド追加、NFCリーダートラブルシューティング追加、ナレッジベースKB-060追加、統計更新（58件）
- 2025-12-04: 工具スキャン重複対策（KB-067）と黒画像対策（KB-068）を実装完了、ナレッジベース更新（65件）
- 2025-12-01: Ansible堅牢化・安定化計画追加、Ansibleで管理すべき設定ファイル一覧追加、ナレッジベースKB-061追加、統計更新（59件、実装計画セクション追加）
- 2025-12-01: Ansible設定ファイル管理化実装完了（systemdサービス・アプリケーション設定）、ナレッジベースKB-062追加、統計更新（60件、インフラ関連26件、実装計画5件）

