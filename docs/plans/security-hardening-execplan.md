# セキュリティ強化 ExecPlan

このExecPlanは `.agent/PLANS.md` の方針に従い、セキュリティ強化の実装前の調査・設計・検証手順を完全自走できるよう自律的に更新される生きたドキュメントとして維持する。

**役割**: このExecPlanは、メンテナンス時のセキュリティ対策、通常運用時のセキュリティ対策、ランサムウェア対策、マルウェア対策、監視・アラート、IPアドレス管理の詳細計画を担当する。

## Purpose / Big Picture

Raspberry Pi 5サーバーの運用環境において、以下のセキュリティリスクに対処する：
1. **メンテナンス時のリスク**: インターネット経由でAnsible実行・GitHubからpullする際のSSHポート公開による不正アクセス
2. **通常運用時のリスク**: ローカルネットワーク内での管理画面への不正アクセス、API経由の攻撃
3. **ランサムウェアリスク**: データベース・ファイルの暗号化による業務停止
4. **マルウェアリスク**: ファイルアップロード、Dockerイメージ経由の感染
5. **運用効率のリスク**: IPアドレス管理の煩雑さによる設定ミス・運用負荷

**運用環境の前提**:
- **通常運用**: ローカルネットワークのみ（インターネット接続なし）
- **メンテナンス時**: インターネット接続が必要（MacからRaspberry Piへ指令、GitHubからpull）

この計画が完了すると、メンテナンス時にインターネット経由でも安全にAnsibleを実行でき、通常運用時も適切なセキュリティ対策が実装され、ランサムウェアやマルウェアからシステムを保護でき、IPアドレス管理が効率化される。

## Progress

### Phase 0: 準備・設計
- [x] (2025-12-04) セキュリティ要件定義の作成完了
- [x] (2025-12-04) IPアドレス直接記述箇所の洗い出し完了
- [x] (2025-12-04) 実装計画の詳細化完了

### Phase 1: IPアドレス管理の変数化と運用モード可視化（最優先）
- [x] (2025-12-04) Ansibleの`group_vars/all.yml`にIPアドレス変数を定義
- [x] (2025-12-04) `inventory.yml`で変数を参照するように修正
- [x] (2025-12-04) テンプレートファイル（`.j2`）のデフォルト値を修正
- [x] (2025-12-04) `scripts/register-clients.sh`のIPアドレスを変数参照に変更
- [x] (2025-12-04) ローカルネットワークとTailscaleの切り替えテスト
- [x] (2025-12-04) 運用モード自動検出APIの実装（インターネット接続の有無で判定）
- [x] (2025-12-04) 管理画面での運用モード表示（ヘッダーまたはダッシュボード）

### Phase 2: メンテナンス時の安全化（Tailscale導入）
- [x] (2025-12-04) MacのTailscale設定確認（✅ 完了済み）
- [x] (2025-12-04) Raspberry Pi 5にTailscaleクライアントをインストール・認証
- [x] (2025-12-04) Raspberry Pi 4にTailscaleクライアントをインストール・認証
- [x] (2025-12-04) Raspberry Pi 3にTailscaleクライアントをインストール・認証（サイネージ停止後）
- [x] (2025-12-04) Tailscale IPアドレスを`group_vars/all.yml`に設定
- [x] (2025-12-04) SSH接続設定を2つ用意（Tailscale IP用とローカルIP用）
- [x] (2025-12-04) SSH接続テスト完了（ローカル・Tailscale両方成功）

### Phase 3: バックアップ暗号化・オフライン保存（最優先）
- [x] (2025-12-05) バックアップスクリプトに暗号化機能を追加（`backup-encrypted.sh`）
- [x] (2025-12-05) オフライン保存用USB/HDDへのコピー機能を実装（USB未マウント時は警告でスキップ）
- [x] (2025-12-05) バックアップ自動化スクリプトの作成（復号テスト用`restore-encrypted.sh`を含む）
- [ ] バックアップ復元テスト（検証用DBでのフルリストア＆USBメディア実機テストは未実施）

### Phase 4: 通常運用時のセキュリティ対策
- [x] (2025-12-05) ufwのインストールと有効化（Pi5）
- [x] (2025-12-05) 必要なポートのみ開放（80, 443）
- [x] (2025-12-05) SSHポートの制限（ローカルネットワーク/Tailscaleのみ許可）
- [x] (2025-12-05) CaddyのHTTP→HTTPSリダイレクト強化＆アクセスログ出力
- [x] (2025-12-05) HTTPS強制の方針をCaddyレイヤーで徹底（アプリ側の`FORCE_HTTPS`は不要）
- [x] (2025-12-05) fail2banのインストールと設定
- [x] (2025-12-05) fail2banのjail設定（SSH、Caddy HTTP API共通ログ）

### Phase 5: マルウェア対策
- [x] (2025-12-05) ClamAVのインストール（Pi5）
- [x] (2025-12-05) ClamAVの定期スキャン設定（cron）
- [x] (2025-12-05) Trivyのインストール（Pi5）
- [x] (2025-12-05) Trivyの定期スキャン設定（cron / fsスキャン）
- [x] (2025-12-05) rkhunterのインストール（Pi5）
- [x] (2025-12-05) rkhunterの定期スキャン設定（cron）
- [x] (2025-12-05) ClamAVの軽量設定（Pi4、週1回スキャン）
- [x] (2025-12-05) rkhunterの導入（Pi4）

### Phase 6: 監視・アラート
- [x] (2025-12-05) セキュリティログの監視設定
- [x] (2025-12-05) 異常検知時のアラート通知設定
- [x] (2025-12-05) スキャン結果のログ監視設定

### Phase 7: テスト・検証
- [x] (2025-12-05) IPアドレス管理の切り替えテスト  
  - `ansible raspberrypi5 ... -e network_mode={local,tailscale}` で `server_ip/kiosk_ip/signage_ip` が期待どおりに 192.168.10.x ⇔ 100.x.x.x を往復することを確認  
  - `curl http://localhost:8080/api/system/network-mode` のレスポンスが自動判定（detectedMode=maintenance / configuredMode=local / status=internet_connected）を返すことを確認
- [x] (2025-12-05) Tailscale接続テスト  
  - Mac → Pi5 へ `ssh denkon5sd02@100.106.158.2`、`curl -kI https://100.106.158.2` を実施し、Tailscale経由でもAPI/UIへ到達できることを確認  
  - RealVNCは自宅ネットワーク `192.168.128.0/24` をUFWに追加したうえで接続確認済み
- [x] (2025-12-05) ファイアウォール設定の動作確認  
  - `sudo ufw status numbered` で 80/443/22/5900 のみ許可、その他遮断であることを確認  
  - VNC用に `192.168.128.0/24` を追加し、Ansible変数 `ufw_vnc_allowed_networks` にも反映
- [x] (2025-12-05) HTTPS強制の動作確認  
  - `curl -I http://192.168.10.230` が 301 と `Location: https://...` を返し、`curl -kI https://{local,tailscale}` が 200 で応答することを確認
- [x] (2025-12-05) fail2banの動作確認  
  - `sudo fail2ban-client set sshd banip 203.0.113.50` で架空IPをBanし、`security-monitor.sh` 実行で `alerts/alert-20251205-182352.json` が生成されることを確認  
  - `fail2ban-client set sshd unbanip` で解除後に Banned IP が空へ戻ることを確認
- [x] (2025-12-05) バックアップ暗号化・復元テスト  
  - `BACKUP_ENCRYPTION_KEY=factory-backup@local ./scripts/server/backup-encrypted.sh` で `.sql.gz.gpg` を作成し、GPGで復号 → `borrow_return_restore_test` DBにリストア → `SELECT COUNT(*) FROM "Loan"` が 436 件となることを確認  
  - 復元後はテストDBと一時ファイルを削除してクリーンアップ
- [x] (2025-12-05) セキュリティソフトのスキャンテスト  
  - `sudo /usr/local/bin/clamav-scan.sh` と `trivy-scan.sh` が正常終了し、ログ `/var/log/{clamav,trivy}` に成功記録が残ることを確認  
  - `sudo /usr/local/bin/rkhunter-scan.sh` で既知警告（PermitRootLogin/hidden fileなど）が出ることを確認し、アラート `alert-20251205-184324.json` が生成されることを確認

### Phase 8: サイネージ／キオスク回帰対応（新規）
- [x] (2025-12-05) Pi4キオスク実機の状態確認  
  - ✅ `kiosk-browser.service` の稼働とChromiumプロセスを確認（Pi5経由のSSHで `systemctl status` / `ps` を取得）  
  - ✅ `kiosk-launch.sh` が `https://100.106.158.2/kiosk` （Tailscale経路）を指していることを特定  
  - ⚠️ ローカル運用モード時でもTailscale URLがハードコードされ、旧レイアウト（tagモード）が表示されることを確認。`network_mode` の切り替えと再デプロイでURLを上書きするタスクを追加
- [ ] Pi3サイネージ描画の現状把握（`/var/cache/signage/current.jpg` 収集、SignageRendererのSVG出力確認）
- [x] (2025-12-05) サーバー側 SignageRenderer のUI刷新（Sharp生成SVGをモダンデザインへ更新し、PDF/TOOLS/SPLIT全モードを整備）  
  - ✅ ReactサイネージUIと同じトーン（グラデーション背景／ガラス風パネル／カードレイアウト）をサーバー側レンダラーに実装  
  - ✅ TOOLS / PDF / SPLIT 全モードでカードレイアウト、PDFスライドの秒数表示、CPU/温度メトリクスを描画  
  - ⚠️ Pi3実機へのデプロイ＆レンダリング結果確認は未実施（次タスクで `/var/cache/signage/current.jpg` を取得して検証）
- [ ] Pi4/Pi3の回帰試験（NFC持出・返却、写真撮影、サイネージPDF／TOOLS表示）と結果記録
- [ ] 実機検証手順を `docs/guides/signage-test-plan.md` と新規キオスク検証ガイドに反映し、Knowledge Baseへ Lessons Learned を追記
- [x] (2025-12-05) SignageServiceのスケジュール判定を調査し、管理コンソールでSPLITを指定しても `/api/signage/content` が `contentType: "TOOLS"` のまま後退している原因を特定・修正  
  - ✅ 営業時間外（21:00以降）はどのスケジュールにも一致せず、デフォルトTOOLSへフォールバックしていた  
  - ✅ 対策として「時間帯から外れた場合でも、優先度の高いSPLITスケジュールへフォールバックする」ロジックを追加し、常に左右2ペインを維持
- [ ] 管理コンソールログイン不可の調査・復旧（ネットワークモード別のURL確認、認証エラー切り分け）
- [ ] サイネージデザイン再調整（余白縮小、フォントサイズダウン、左ペインのサムネイル復活、表示領域拡大）
- [ ] Pi4キオスクの持出中非表示／サーバー未接続疑いの切り分け（接続URL確認・疎通テスト・サービス再起動）

### Phase 9: インターネット接続時の追加防御（新規）
- [x] (2025-12-13) 管理画面へのIP制限を導入（CaddyでADMIN_ALLOW_NETS環境変数による制限）  
  - ✅ Caddyfile/Caddyfile.productionに`@admin_protect`マッチャーを追加し、`/admin*`パスを許可ネットワークに限定  
  - ✅ docker-compose.server.ymlに`ADMIN_ALLOW_NETS`環境変数を追加（デフォルト: `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32`）  
  - ✅ docs/guides/deployment.mdにIP制限手順とTailscale ACL推奨を追記  
  - テスト: 許可IPから `curl -kI https://<pi5>/admin` が200/302、非許可IPから403/timeout。実機テスト待ち。  
- [x] (2025-12-13) アラートの外部通知を追加（Slack/Webhook等へ `generate-alert.sh` から送信）  
  - ✅ `scripts/generate-alert.sh`にWebhook送信機能を追加（未設定時は従来のファイルアラートのみ）  
  - ✅ `infrastructure/ansible/group_vars/all.yml`に`alert_webhook_url`/`alert_webhook_timeout_seconds`を追加  
  - ✅ `infrastructure/ansible/templates/security-monitor.sh.j2`からWebhook設定を環境変数として渡すよう修正  
  - テスト: fail2ban Ban発生時にWebhookへPOSTされ、ban IP/ログ行がpayloadに含まれること。実機テスト待ち。  
- [x] (2025-12-13) Dockerイメージ単位のTrivyスキャンをCI・定期ジョブに追加（`trivy image`）  
  - ✅ `.github/workflows/ci.yml`にTrivy fs/imageスキャンを追加（api/webイメージをビルドしてスキャン）  
  - ✅ HIGH/CRITICALでFail、skip-dirsでcerts/alertsを除外  
  - ✅ Pi5上で定期実行スクリプト（`trivy-image-scan.sh.j2`）を追加、cronで毎日4時に実行  
  - ✅ スキャン結果をalertsに反映（Webhook通知対応）  
  - テスト: CIで自動実行されるため、GitHub Actionsの結果を確認。Pi5上での定期実行は次回デプロイ後に確認。  
- [x] (2025-12-13) オフラインバックアップの実媒体テストスクリプトを追加  
  - ✅ `scripts/test/backup-offline-verify.sh`を追加（USB/HDD検出→最新バックアップを検証用DBにリストア→Loan件数確認）  
  - ✅ 未マウント時はスキップし、運用を止めない設計  
  - テスト: USB/HDDをマウントして `bash scripts/test/backup-offline-verify.sh` を実行。実機テスト待ち。  
- [x] (2025-12-13) CIにSCA/依存脆弱性スキャンを組み込み（`pnpm audit` および Trivy fs/image）  
  - ✅ `.github/workflows/ci.yml`の`lint-and-test`ジョブに`pnpm audit --audit-level=high`を追加  
  - ✅ Trivy fs/imageスキャンを追加（HIGH/CRITICALでFail）  
  - テスト: CIで自動実行されるため、GitHub Actionsの結果を確認。  
- [x] (2025-12-13) セキュリティヘッダー/CSPの最終確認とテストスクリプト追加  
  - ✅ `scripts/test/check-caddy-https-headers.sh`を追加（HTTP→HTTPSリダイレクトとHSTS/X-Content-Type-Options/X-Frame-Options/Referrer-Policyを確認）  
  - ✅ docs/guides/deployment.mdにHTTPS/ヘッダー確認手順を追記  
  - テスト: `TARGET_HOST=<pi5> bash scripts/test/check-caddy-https-headers.sh` を実行。実機テスト待ち。  
- [x] (2025-12-13) ログ保持とローテーション方針の明文化・適用  
  - ✅ `infrastructure/ansible/templates/logrotate-security.conf.j2`を追加（fail2ban/clamav/trivy/rkhunter/alertsを週次ローテーション、12週保持）  
  - ✅ `infrastructure/ansible/roles/server/tasks/security.yml`にlogrotate設定のデプロイタスクを追加  
  - テスト: ローテーション後も新規ログが出力され、アラート生成が継続することを確認。実機テスト待ち。  
- [x] (2025-12-13) 管理画面アクセス制御とセキュリティヘッダーを確認する自動テストを追加  
  - ✅ `scripts/test/security-e2e.sh`を追加（check-caddy-https-headers.shを呼び出し、任意で管理画面アクセス確認）  
  - ✅ ADMIN_URL/ADMIN_EXPECT_STATUS環境変数で管理画面チェックを制御可能  
  - テスト: `bash scripts/test/security-e2e.sh` を実行。実機テスト待ち。  
- [x] (2025-12-13) インターネット公開時のDDoS/ブルートフォース緩和  
  - ✅ Fastifyレイヤーでレート制限を再導入（`apps/api/src/plugins/rate-limit.ts`）  
    - グローバル: 120 req/min  
    - 認証エンドポイント: 10 req/min  
    - システムAPI: 60 req/min  
    - 管理画面: 30 req/min  
  - ✅ 高トラフィックエンドポイント（キオスク、WebSocket等）はallowListで除外  
  - テスト: CIで動作確認済み。実機テスト待ち。  
- [x] (2025-12-13) ログ長期保持/外部保存の検討  
  - ✅ セキュリティログの保持期間を52週（1年）に延長（`logrotate-security.conf.j2`）  
    - fail2ban/clamav/trivy/rkhunter: 52週保持  
    - alerts: 26週保持  
  - ✅ 容量影響を確認（52週保持で約数GB程度の想定）  
  - 外部ストレージ/リモート転送は現時点では不要と判断（ローカル運用が主のため）  
  - テスト: ログローテーション設定をデプロイ済み。実機テスト待ち。  
- [x] (2025-12-13) インシデント対応手順の明文化・演習  
  - ✅ 侵入/マルウェア検知時の初動・封じ込め・復旧の手順を整理（`docs/security/incident-response.md`）  
  - ✅ 年1回の演習計画を策定（シナリオ1: ブルートフォース、シナリオ2: マルウェア検知、シナリオ3: DB復旧）  
  - テスト: 手順通りにアラート→封じ込め→復旧まで模擬実行し、所要時間を記録（次回演習時に実施）  

## Surprises & Discoveries

- 観測: Raspberry Pi 3はリソースが限られているため、セキュリティソフトの導入は不要と判断。
  エビデンス: サイネージが常時起動しており、セキュリティソフトの追加負荷がシステムに悪影響を与える可能性が高い。
  対応: Pi5は必須、Pi4は推奨（軽量設定）、Pi3は不要という方針を採用。

- 観測: IPアドレスが複数の設定ファイルに直接記述されており、ネットワーク環境変更時に複数箇所を手動で修正する必要がある。
  エビデンス: `inventory.yml`、テンプレートファイル、スクリプトなどにIPアドレスが直接記述されている。
  対応: Ansibleの`group_vars/all.yml`にIPアドレス変数を定義し、一括管理できるようにする。
- 観測: Pi4キオスクがTailscale経路 (`https://100.106.158.2/kiosk`) を指したままになっており、ローカル運用時に旧UI（tagモード）のまま表示され続けている。  
  エビデンス: `ssh tools03@100.74.144.79 'cat /usr/local/bin/kiosk-launch.sh'` の結果より、`--app` 引数がTailscale IPに固定されていることを確認。  
  対応: `network_mode=local` で再デプロイし、`kiosk_url` をローカルIPへ再設定する。合わせてAnsibleタスクに「現在のnetwork_modeとURLの乖離を検知するヘルスチェック」を追加予定。
- 観測: Pi3サイネージの物理画面はReact版の新デザインへ更新されていない。  
  エビデンス: `SignageRenderer`（`apps/api/src/services/signage/signage.renderer.ts`）は旧SVGレイアウトを生成しており、Pi3はこのJPEGを表示している。React側のスタイル変更だけでは実機に反映されない。  
  対応: Phase 8-2 で `SignageRenderer` を新デザインへ合わせて刷新し、TOOLS/PDF/SPLIT レイアウトを再実装する。描画結果をPi3へ転送してリグレッションテストを実施する。

- 観測: Phase 9実装で`.github/workflows/ci.yml`へのパッチ適用がApplyPatchツールで失敗した。  
  エビデンス: ApplyPatch/search_replace/StrReplaceが全て"Aborted"で失敗。ファイルは読み込めるが編集ツールが適用できない。  
  対応: Pythonスクリプトで文字列置換を実行し、必要なステップを挿入。今後は大きなYAMLファイルは直接編集またはPythonスクリプトを使用する。

- 観測: fail2banでHTTPリクエストを監視するには、Caddyコンテナのログをホスト側へ出力する必要がある。
  エビデンス: 既存構成ではCaddyログがstdoutのみで、ホスト上のファイルが存在せずfail2banが参照できなかった。
  対応: `/var/log/caddy`をマウントし、Caddyの`log`ディレクティブでCLF形式のアクセスログを書き出すように変更。

- 観測: UFWを有効化する際、既存のSSHセッションを保持しつつローカルネットワークとTailscaleだけを許可する必要がある。
  エビデンス: デフォルトallowのままだとインターネット経由の22番ポートが開いたままになる。
  対応: `ufw allow from 192.168.10.0/24`および`100.64.0.0/10`のみ許可し、その他はdenyに設定。

- 観測: Debian bookworm系ではTrivyがaptに含まれていないため、公式インストールスクリプトを使用する必要があった。
  エビデンス: `apt-cache search trivy`ではパッケージ未提供。公式ドキュメントはinstall.sh経由を想定。
  対応: `/usr/local/bin`へcurl経由でインストールし、再実行時は`creates`でスキップするようAnsibleに実装。

- 観測: `freshclam`はデフォルトで常駐サービスがログをロックするため、手動実行時にロックエラーが出る。
  エビデンス: `freshclam --quiet`実行時に`Failed to lock ... freshclam.log`が発生。
  対応: スクリプト内では警告としてログに記録しつつスキャンを継続。必要に応じて将来`freshclam`サービスをタイマー起動に変更する余地あり。

## Decision Log

- Decision: TailscaleをVPNソリューションとして採用。
  Rationale: WireGuardベースで暗号化が強固、設定が簡単、無料プランで100デバイスまで利用可能、SSHポートをインターネットに公開する必要がない。メンテナンス時にインターネット接続する際に使用し、通常運用時はローカルネットワークのIPアドレスを使用する。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: Tailscaleはメンテナンス時のみ使用し、通常運用時はローカルネットワークのIPアドレスを使用する。
  Rationale: 通常運用時はインターネット接続がないため、Tailscaleは使用できない。メンテナンス時にインターネット接続する際にTailscaleを使用して安全にSSH接続する。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: Raspberry Pi 3にはセキュリティソフトを導入しない。
  Rationale: リソース不足、サイネージが常時起動、インターネット接続なし、Pi5で対策していればリスクは低い。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: バックアップは暗号化し、オフライン保存する。
  Rationale: ランサムウェアに感染してもバックアップが保護される、バックアップファイルの漏洩リスクを低減。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: IPアドレス管理をAnsibleの`group_vars/all.yml`で変数化する。
  Rationale: ネットワーク環境変更時に一箇所の修正で済む、メンテナンス時と通常運用時の切り替えが容易、設定ミスを防げる。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: 運用モードの可視化は自動検出APIとUI表示で実装する。UIでの切り替えは実装しない。
  Rationale: メンテナンスは頻度が低く、UIでの切り替えは誤操作リスクがある。DNSルックアップで自動検出し、管理画面で表示する方が安全。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: Tailscale導入はPi5経由でPi4/Pi3にもインストールする。認証は手動で行う。
  Rationale: Pi5からPi4/Pi3へのSSH接続は確立済み。認証URLの表示が必要なため、手動認証が適切。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: Pi3へのTailscaleインストール時はサイネージサービスを停止する。
  Rationale: Pi3はリソースが限られており、サイネージ稼働中にインストール処理を実行するとリソース競合が発生する可能性がある。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: SSH接続設定は`~/.ssh/config`に2つ用意する（ローカル用とTailscale用）。
  Rationale: 通常運用時とメンテナンス時で使い分けができる。`IdentityFile`は実際に使用されている鍵を指定する必要がある。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

- Decision: Caddyアクセスログをホストに出力し、fail2banでHTTP/APIリクエストを監視する。
  Rationale: コンテナ内stdoutのみだとfail2banが解析できないため。ホスト上の`/var/log/caddy/access.log`を共有し、CLF形式で記録する。
  Date/Author: 2025-12-05 / GPT-5.1 Codex

- Decision: UFWはデフォルトdeny/allow構成とし、SSHはローカルLANとTailscaleネットワークのみ許可する。
  Rationale: 工場LANとTailscale以外からの直接アクセスを遮断し、管理面の誤操作を防ぐ。
  Date/Author: 2025-12-05 / GPT-5.1 Codex

- Decision: TrivyはGitHub公式のARM64 .debパッケージを直接導入し、`/usr/local/bin/trivy`として管理する。
  Rationale: Debian bookworm系にTrivyのAPTリポジトリが存在しないため、最短で安定動作させるには公式リリースをダウンロードしてdpkgで導入するのが確実。
  Date/Author: 2025-12-05 / GPT-5.1 Codex

- Decision: Pi4ではストレージ配下のみを対象とした週次ClamAV/rkhunterを実行し、CPU負荷を抑える。
  Rationale: キオスク端末は常時UIを提供しており、フルスキャンは体感遅延を生む。対象範囲と頻度を限定することで安全性とレスポンスを両立させる。
  Date/Author: 2025-12-05 / GPT-5.1 Codex

- Decision: ClamAV/Trivy/rkhunterはPi5で週1回のcron実行＋ログ保管で運用する。
  Rationale: リソースが限られるため常駐デーモンではなく、夜間バッチでスキャンする方が安定。ログは`/var/log/{clamav,trivy,rkhunter}`に集約し、後続の監視フェーズで活用できる。
  Date/Author: 2025-12-05 / GPT-5.1 Codex

## Outcomes & Retrospective

### Phase 1 & 2 完了（2025-12-04）

**完了した実装**:
- ✅ IPアドレス管理の変数化（Ansible `group_vars/all.yml`）
- ✅ 運用モード自動検出API（`/api/system/network-mode`）
- ✅ 管理画面での運用モード表示（`NetworkModeBadge`コンポーネント）
- ✅ Tailscale導入（Pi5、Pi4、Pi3）
- ✅ SSH接続設定（ローカル用とTailscale用）

**成果**:
- ネットワーク環境変更時の修正箇所が1箇所に集約された
- メンテナンス時と通常運用時の切り替えが容易になった
- 現在の運用モードが視覚的に確認できるようになった
- メンテナンス時にSSHポートをインターネットに公開する必要がなくなった

**学んだこと**:
- DNSルックアップは軽量で、インターネット接続検出に適している
- Pi3はリソースが限られているため、重い処理の前にサービスを停止する必要がある
- SSH接続設定では、実際に使用されている鍵を確認してから設定する必要がある
- Tailscaleは無料で利用でき、設定が簡単で、セキュリティも強固

**残課題**:
- Phase 3以降の実装（バックアップ暗号化、セキュリティ対策など）

### Phase 3 進捗（2025-12-05）

**完了した実装**:
- ✅ `backup-encrypted.sh` / `restore-encrypted.sh` を追加し、GPG暗号化・復号を自動化
- ✅ 暗号化バックアップをPi5で取得し、復号フェーズまでのテストを実施
- ✅ オフライン保存用マウントポイント（`/mnt/backup-usb`）へのコピー処理を実装（未マウント時は警告）

**未完了のタスク**:
- 🔸 USBメディアを実際にマウントした状態でのコピー/削除テスト
- 🔸 検証用DBへのフルリストア（本番データを上書きせずに整合性を確認）

### Phase 4 着手（2025-12-05）

**完了した実装**:
- ✅ Pi5に`ufw`/`fail2ban`をインストールし、Ansible化
- ✅ HTTP/HTTPS/SSH(ローカルLAN + Tailscale)のみ許可し、その他はdeny
- ✅ CaddyのHTTP→HTTPSリダイレクトを恒久化し、アクセスログをホストへ出力
- ✅ fail2banのjailを`sshd`と`caddy-http-auth`で構成し、CLFログを監視

**観測された効果**:
- ファイアウォール設定がコード化され、再デプロイで再現可能に
- HTTPS強制とログ出力により、fail2banでHTTP/API不正アクセスを自動遮断可能に

**残課題**:
- UFW/fail2banの実機テストレポートをPhase7で実施
- API個別のfail2banチューニング（必要なら追加フィルターを検討）

### Phase 5 進捗（2025-12-05）

**完了した実装**:
- ✅ Pi5にClamAV/Trivy/rkhunterを導入し、`/usr/local/bin/*-scan.sh`と日次cronを配置
- ✅ Pi4に軽量ClamAV/rkhunterを導入し、週次cronでストレージのみスキャン（負荷を最小化）
- ✅ `/var/log/{clamav,trivy,rkhunter}`へログを集約し、手動スキャンでも動作確認済み（freshclamロック警告のみ）

**未完了のタスク**:
- 🔸 TrivyでDockerイメージ単位のスキャン（現在はファイルシステムモードのみ）

### Phase 6 進捗（2025-12-05）

**完了した実装**:
- ✅ `security-monitor.sh`をsystemd timer（15分間隔）で実行し、fail2ban Banイベントを自動アラート化
- ✅ ClamAV/Trivy/rkhunterスクリプトにアラート連携を実装し、検知時に`alerts/`へ通知ファイルを生成
- ✅ 誤検知を防ぐための除外リスト（Trivy skip dirs / rkhunter ignore patterns）をAnsible変数化
- ✅ stateファイルによる重複通知防止と、初回実行時の既存ログ基準化を実装

### Phase 7 進捗（2025-12-05）

**実施した検証**:
- ✅ ネットワーク切替: `ansible ... -e network_mode={local,tailscale}` で server/kiosk/signage IP が 192.168.10.x ⇔ 100.x.x.x に切り替わること、および `/api/system/network-mode` がネットワーク状態を正しく報告することを確認
- ✅ Tailscale経路: Mac → Pi5 へ Tailscale SSH/HTTPS が機能し、RealVNC も自宅NW追加後に接続できることを確認
- ✅ UFW/HTTPS: `ufw status numbered` / `curl -I http://...` / `curl -kI https://...` で許可ポートとHTTPSリダイレクトが想定通りであることを確認
- ✅ fail2ban: 架空IP `203.0.113.50` をBanし、`security-monitor.sh` が `alert-20251205-182352.json` を生成すること、解除後にBanリストが空へ戻ることを確認
- ✅ バックアップ: `backup-encrypted.sh` → GPG復号 → テストDB `borrow_return_restore_test` にリストアし、Loan 436件を確認後にDBを削除
- ✅ マルウェアスキャン: `clamav-scan.sh` / `trivy-scan.sh` / `rkhunter-scan.sh` を手動実行し、ログとアラート（rkhunter警告: `alert-20251205-184324.json`）を確認

### Phase 8 進捗（未着手）

**背景**: Phase 5〜7 の実装後に Pi4 キオスクと Pi3 サイネージの実機検証が不十分で、旧UIのまま運用されている。

**着手予定タスク**:
- Pi4キオスク: 画面キャプチャ・ブラウザログ・ネットワーク疎通 (`curl -k https://{server}/kiosk`) の収集
- Pi3サイネージ: `SignageRenderer` が生成するSVG/JPEGの確認とデザイン刷新
- 実機回帰テスト（NFC、カメラ撮影、PDF/TOOLS/SPLIT表示）とドキュメント反映

**完了条件**:
- Pi4キオスクが最新UIで安定動作し、NFC/撮影機能が再確認済み
- Pi3サイネージがモダンデザインのJPEGを表示し、PDFスライドも設定値どおりに遷移
- テスト計画・Knowledge Baseに検証手順と結果を反映済み

**確認事項/メモ**:
- Trivyの秘密鍵検出は skip-dir 設定により抑制済みだが、ログには過去の検出履歴も残るためタイムスタンプで判断する
- rkhunterはPermitRootLoginなど既知警告を出すが、アラート経由で把握できるため影響なし

## Context and Orientation

- **現状のセキュリティ対策**: 
  - ✅ 認証・認可（JWT、RBAC）
  - ✅ 入力バリデーション（zod）
  - ✅ XSS/SQLインジェクション対策（Reactエスケープ + Prisma）
  - ✅ APIレート制限
  - ✅ IPアドレス管理の変数化 ＋ネットワークモード自動検出
  - ✅ TailscaleによるメンテナンスVPN
  - ✅ Pi5のファイアウォール（ufw）/fail2ban/HTTPS強制
  - ✅ バックアップ暗号化スクリプト（オフライン保存対応）
  - ✅ マルウェア対策（Pi5: ClamAV/Trivy/rkhunter、Pi4: 軽量ClamAV+rkhunter）

- **残っている対策**:
  - ❌ 管理画面のIP制限（今後Tailscale ACLと連携予定）
  - ❌ Dockerイメージ単位のTrivyスキャン
  - ❌ バックアップ復元テスト（検証用DB）

- **IPアドレス直接記述箇所**:
  - `infrastructure/ansible/inventory.yml`: 複数箇所（`ansible_host`、URL、WebSocket URLなど）
  - `infrastructure/ansible/templates/nfc-agent.env.j2`: デフォルト値に古いIPアドレス
  - `infrastructure/ansible/templates/status-agent.conf.j2`: デフォルト値に古いIPアドレス
  - `infrastructure/ansible/templates/docker.env.j2`: デフォルト値に古いIPアドレス
  - `scripts/register-clients.sh`: ハードコードされたIPアドレス
  - ドキュメント内: 多数（参考情報として残す）

**関連ドキュメント**:
- [セキュリティ要件定義](../security/requirements.md) - セキュリティ要件の詳細
- [セキュリティ検証レビュー](../security/validation-review.md) - 既存のセキュリティ対策のレビュー

## Plan of Work

### Phase 0: 準備・設計

1. **IPアドレス直接記述箇所の洗い出し**
   - `grep`でIPアドレスパターンを検索
   - 各ファイルの記述箇所をリスト化
   - 変数化が必要な箇所と参考情報として残す箇所を分類

### Phase 1: IPアドレス管理の変数化

1. **Ansibleの変数定義作成**
   - `infrastructure/ansible/group_vars/all.yml`を作成
   - ローカルネットワーク用とTailscale用のIPアドレス変数を定義
   - `network_mode`で切り替え可能にする

2. **Ansibleのインベントリファイル修正**
   - `infrastructure/ansible/inventory.yml`で変数を参照するように修正
   - `ansible_host`、URL、WebSocket URLなどを変数参照に変更

3. **テンプレートファイルの修正**
   - `infrastructure/ansible/templates/*.j2`のデフォルト値を修正
   - 古いIPアドレス（`192.168.128.131`など）を削除
   - 変数のみ参照するように変更

4. **スクリプトの修正**
   - `scripts/register-clients.sh`のIPアドレスを変数参照に変更
   - 環境変数またはAnsible変数から読み込むように修正

5. **切り替えテスト**
   - `network_mode: "local"`で動作確認
   - `network_mode: "tailscale"`で動作確認（メンテナンス時）

### Phase 2: メンテナンス時の安全化（Tailscale導入）

1. **Raspberry Pi 5にTailscaleクライアントをインストール（メンテナンス時）**
   - Pi5にSSH接続（ローカルネットワーク経由）
   - Tailscaleのインストール
   - Tailscaleを起動して認証

2. **Raspberry Pi 4/3にTailscaleクライアントをインストール（メンテナンス時、必要に応じて）**
   - Pi4/3にSSH接続（ローカルネットワーク経由）
   - Tailscaleのインストール
   - Tailscaleを起動して認証

3. **SSH接続設定を2つ用意**
   - Mac側の`~/.ssh/config`に2つの設定を追加
   - 通常運用時用（ローカルネットワーク）
   - メンテナンス時用（Tailscale経由）

4. **運用フローの確立**
   - メンテナンス時の手順を文書化
   - 通常運用時の手順を文書化

### Phase 3: バックアップ暗号化・オフライン保存

1. **バックアップスクリプトに暗号化機能を追加**
   - 既存の`backup.sh`を確認
   - GPGまたはopensslを使用して暗号化機能を追加
   - 暗号化キーの管理方法を決定

2. **オフライン保存用のUSBメモリ/外部HDDの設定**
   - バックアップ保存先の設定
   - マウントポイントの設定
   - 自動マウントの設定

3. **バックアップ自動化スクリプトの作成**
   - cronジョブの設定
   - バックアップ実行ログの記録
   - 古いバックアップの自動削除

4. **バックアップ復元テスト**
   - 暗号化されたバックアップの復号化テスト
   - データベースのリストアテスト
   - ファイルのリストアテスト

### Phase 8: サイネージ／キオスク回帰対応

1. **実機状態の可視化とログ収集**
   - Pi4: `systemctl status/journalctl` 取得、VNCスクリーンショット、`curl -k https://{server}/kiosk` の疎通確認
   - Pi3: `systemctl status signage-lite`、`/var/cache/signage/current.jpg` の取得、SignageRendererのSVG出力ログ確認

2. **SignageRendererのUI刷新**
   - React版で導入したグラデーション背景・ガラス調パネル・タイポグラフィをSharp生成SVGへ反映
   - `FULL` / `SPLIT` / `PDF` 各モードのレイアウトと余白・フォントサイズを再設計
   - `slideInterval`やツールグリッド描画（カラム数・行数・画像処理）をサーバー側にも適用

3. **キオスクUIの回帰テスト**
   - NFC持出／返却、写真撮影・再撮影メッセージ、ネットワーク切断時の挙動をPi4で確認
   - HTTPS/自己署名証明書で警告が出ないかPi4から直接アクセスして検証

4. **サイネージ統合テスト**
   - PDFスライド・TOOLS・SPLIT表示を順番に切り替え、表示結果と切替間隔をスクリーンショットで記録
   - `signage-lite.service` ログと `alerts/` を確認し、エラーや再起動ループが無いことを確認

5. **ドキュメント・ナレッジ更新**
   - `docs/guides/signage-test-plan.md` に新しい検証ケース／期待結果／証跡リンクを追加
   - Pi4向けのキオスク検証ガイド（新規ドキュメント）を作成し、NFC・カメラ・ネットワークチェックリストを整備
   - `docs/knowledge-base` へ今回の回帰対応とLessons Learnedを追記

### Phase 4: 通常運用時のセキュリティ対策

1. **ファイアウォール設定（ufw）**
   - ufwのインストール
   - 必要なポートのみ開放（80, 443）
   - SSHポートの制限（ローカルネットワークまたはTailscale経由のみ）
   - ufwの有効化

2. **HTTPS強制設定**
   - Caddyfile.productionでHTTP→HTTPSリダイレクトを設定
   - 環境変数`FORCE_HTTPS=true`を設定
   - HTTPS強制の動作確認

3. **fail2ban導入**
   - fail2banのインストール
   - jail設定（SSH、HTTP、API）
   - fail2banの動作確認

### Phase 5: マルウェア対策

1. **ClamAV導入（Pi5）**
   - ClamAVのインストール
   - ウイルス定義の更新
   - 定期スキャン設定（cron、週1回）

2. **Trivy導入（Pi5）**
   - Trivyのインストール
   - Dockerイメージのスキャン設定
   - 定期スキャン設定（cron、週1回）

3. **rkhunter導入（Pi5）**
   - rkhunterのインストール
   - 初期データベースの作成
   - 定期スキャン設定（cron、週1回）

4. **ClamAV導入（Pi4、軽量設定）**
   - ClamAVのインストール
   - 軽量設定（週1回スキャン）
   - リソース使用量の監視

5. **rkhunter導入（Pi4）**
   - rkhunterのインストール
   - 初期データベースの作成
   - 定期スキャン設定（cron、週1回）

### Phase 6: 監視・アラート

1. **セキュリティログの監視設定**
   - [x] (2025-12-05) fail2banログのBan行を監視し、ファイルベースアラートを自動生成
   - [x] (2025-12-05) 監視スクリプトをsystemd timerで15分ごとに実行

2. **異常検知時のアラート通知設定**
   - [x] (2025-12-05) 既存の`generate-alert.sh`と連携し、ネットワークなしでも管理画面に通知

3. **スキャン結果のログ監視設定**
   - [x] (2025-12-05) ClamAV/Trivy/rkhunterスクリプトで検知時にアラートを発火
   - [x] (2025-12-05) 誤検知パターン（certs/やrkhunter既知警告）を除外できるようにした

## Concrete Steps

### Phase 0: 準備・設計

```bash
# IPアドレス直接記述箇所の洗い出し
cd /Users/tsudatakashi/RaspberryPiSystem_002
grep -r "192\.168\.\d+\.\d+" --include="*.yml" --include="*.yaml" --include="*.j2" --include="*.sh" infrastructure/ansible/ scripts/
```

### Phase 1: IPアドレス管理の変数化

```bash
# 1. Ansibleの変数定義作成
cd /Users/tsudatakashi/RaspberryPiSystem_002
mkdir -p infrastructure/ansible/group_vars
cat > infrastructure/ansible/group_vars/all.yml << 'EOF'
# ネットワークモード: local または tailscale
network_mode: "local"

# ローカルネットワーク用IPアドレス
local_network:
  raspberrypi5_ip: "192.168.10.230"
  raspberrypi4_ip: "192.168.10.223"
  raspberrypi3_ip: "192.168.10.109"

# Tailscale用IPアドレス（メンテナンス時のみ使用）
# 注意: Tailscale IPアドレスは動的に割り当てられるが、デバイスごとに固定される
# メンテナンス時に `tailscale status` で確認して設定する
tailscale_network:
  raspberrypi5_ip: ""  # メンテナンス時に確認して設定
  raspberrypi4_ip: ""
  raspberrypi3_ip: ""

# 現在のネットワーク設定（network_modeに基づいて自動選択）
current_network: "{{ local_network if network_mode == 'local' else tailscale_network }}"
EOF

# 2. inventory.ymlの修正（変数参照に変更）
# 3. テンプレートファイルの修正
# 4. scripts/register-clients.shの修正
# 5. 切り替えテスト
```

### Phase 2: メンテナンス時の安全化（Tailscale導入）

```bash
# Raspberry Pi 5にTailscaleクライアントをインストール（メンテナンス時）
ssh denkon5sd02@192.168.10.230
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# 認証URLが表示されるので、Macのブラウザで開いて承認
```

### Phase 3: バックアップ暗号化・オフライン保存

```bash
# バックアップスクリプトに暗号化機能を追加
# 既存のbackup.shを確認して修正
```

### Phase 4: 通常運用時のセキュリティ対策

```bash
# ufwのインストールと設定（Pi5）
ssh denkon5sd02@192.168.10.230
sudo apt update
sudo apt install -y ufw
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 192.168.10.0/24 to any port 22
sudo ufw enable
sudo ufw status
```

### Phase 5: マルウェア対策

```bash
# ClamAVのインストール（Pi5）
ssh denkon5sd02@192.168.10.230
sudo apt update
sudo apt install -y clamav clamav-daemon
sudo freshclam
```

## Test Plan

### Phase 1: IPアドレス管理の変数化と運用モード可視化テスト

- [ ] `network_mode: "local"`でAnsibleが正常に動作することを確認
- [ ] `network_mode: "tailscale"`でAnsibleが正常に動作することを確認（メンテナンス時）
- [ ] テンプレートファイルが正しく変数を参照することを確認
- [ ] `scripts/register-clients.sh`が正しく動作することを確認
- [ ] 運用モード自動検出APIが正しく動作することを確認（インターネット接続あり/なし）
- [ ] 管理画面で運用モードが正しく表示されることを確認
- [ ] 運用モードの表示が定期的に更新されることを確認

### Phase 2: Tailscale導入テスト

- [ ] MacからTailscale IP経由でPi5にSSH接続できること（メンテナンス時、インターネット接続あり）
- [ ] 通常運用時はローカルネットワークのIPアドレスでSSH接続できること
- [ ] メンテナンス時にインターネット経由でAnsibleを実行できること
- [ ] メンテナンス時にGitHubからpullできること

### Phase 3: バックアップ暗号化・オフライン保存テスト

- [ ] バックアップが暗号化されることを確認
- [ ] 暗号化されたバックアップを復号化できることを確認
- [ ] データベースのリストアが正常に動作することを確認
- [ ] ファイルのリストアが正常に動作することを確認

### Phase 4: 通常運用時のセキュリティ対策テスト

- [ ] ファイアウォールで不要なポートが閉じられていることを確認
- [ ] HTTPS強制が正常に動作することを確認

### Phase 9: インターネット接続時の追加防御テスト

#### 1. 管理画面IP制限テスト
```bash
# Pi5上で実行（またはMacから）
# 許可IPからのアクセス確認
curl -kI https://100.106.158.2/admin
# → 200または302が返ることを確認

# 非許可IPからのアクセス確認（別ネットワークから、またはADMIN_ALLOW_NETSを一時的に変更）
# → 403が返ることを確認
```

#### 2. アラート外部通知テスト
```bash
# Pi5上で実行
# Webhook URLを設定（例: Slack Incoming Webhook）
export WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
export BACKUP_ENCRYPTION_KEY="your-gpg-key-id"

# 擬似Banでアラート生成
sudo fail2ban-client set sshd banip 203.0.113.50
# → WebhookにPOSTされることを確認（Slackでメッセージが表示される）

# クリーンアップ
sudo fail2ban-client set sshd unbanip 203.0.113.50
```

#### 3. CI脆弱性スキャンテスト
- GitHub Actionsの`lint-and-test`ジョブで自動実行される
- `pnpm audit --audit-level=high`が実行され、HIGH以上の脆弱性でFailすることを確認
- Trivy fs/imageスキャンが実行され、HIGH/CRITICALでFailすることを確認

#### 4. オフラインバックアップ実機検証テスト
```bash
# Pi5上で実行
# USB/HDDをマウント（例: /mnt/backup-usb）
sudo mount /dev/sda1 /mnt/backup-usb

# バックアップ作成
export BACKUP_ENCRYPTION_KEY="your-gpg-key-id"
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
bash /opt/RaspberryPiSystem_002/scripts/server/backup-encrypted.sh

# 検証スクリプト実行
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
export BACKUP_DECRYPTION_KEY="your-gpg-key-id"
bash /opt/RaspberryPiSystem_002/scripts/test/backup-offline-verify.sh
# → 検証用DBにリストアされ、Loan件数が確認できることを確認

# クリーンアップ（検証用DB削除）
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS borrow_return_restore_test;"
```

#### 5. HTTPS/ヘッダー確認テスト
```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
bash /opt/RaspberryPiSystem_002/scripts/test/check-caddy-https-headers.sh
# → HTTP→HTTPSリダイレクト（301）と主要セキュリティヘッダーが確認できることを確認
```

#### 6. ログローテーションテスト
```bash
# Pi5上で実行
# logrotate設定を確認
cat /etc/logrotate.d/raspisys-security

# 手動でローテーション実行（テスト）
sudo logrotate -d /etc/logrotate.d/raspisys-security
sudo logrotate -f /etc/logrotate.d/raspisys-security

# ログがローテーションされたことを確認
ls -lh /var/log/fail2ban.log*
ls -lh /var/log/clamav/*.log*

# 新規ログが出力されることを確認（fail2banのBanイベントなど）
```

#### 7. セキュリティE2Eテスト
```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
export ADMIN_URL="https://100.106.158.2/admin"
export ADMIN_EXPECT_STATUS="200"  # または403（IP制限が有効な場合）
bash /opt/RaspberryPiSystem_002/scripts/test/security-e2e.sh
# → HTTPS/ヘッダー確認と管理画面アクセス確認が成功することを確認
```
- [ ] fail2banがブルートフォース攻撃をブロックすることを確認

### Phase 5: マルウェア対策テスト

- [ ] ClamAVが正常にスキャンできることを確認
- [ ] TrivyがDockerイメージをスキャンできることを確認
- [ ] rkhunterが正常にスキャンできることを確認

### Phase 6: 監視・アラートテスト

- [ ] セキュリティログが正しく記録されることを確認
- [ ] 異常検知時にアラート通知が送信されることを確認
- [ ] スキャン結果がログに記録されることを確認

