---
title: トラブルシューティングナレッジベース - セキュリティ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2026-01-19
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - セキュリティ関連

**カテゴリ**: インフラ関連 > セキュリティ関連  
**件数**: 10件  
**索引**: [index.md](../index.md)

セキュリティ対策と監視に関するトラブルシューティング情報

---

### [KB-071] Tailscale導入とSSH接続設定

**EXEC_PLAN.md参照**: Phase 2 メンテナンス時の安全化（Tailscale導入）（2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- メンテナンス時にインターネット経由でAnsible実行・GitHubからpullする際、SSHポートをインターネットに公開する必要がある
- 動的IPアドレスで接続が不安定になる可能性がある
- 自宅と会社の両方から接続する際、IPアドレスが異なる

**要因**: 
1. **VPNの未導入**: TailscaleなどのVPNが導入されていなかった
2. **SSHポートの公開**: SSHポート（22）をインターネットに公開する必要があった
3. **動的IPの問題**: 動的IPアドレスで接続が不安定になる可能性がある

**試行した対策**: 
- [試行1] 固定IPアドレスを取得 → **失敗**（コストが高い、設定が複雑）
- [試行2] ポート転送を設定 → **失敗**（セキュリティリスクがある）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. Tailscaleアカウントを作成（無料プランで100デバイスまで利用可能）
  2. MacにTailscaleクライアントをインストール・認証
  3. Pi5、Pi4、Pi3にTailscaleクライアントをインストール
  4. 各デバイスで`sudo tailscale up`を実行して認証
  5. Tailscale IPアドレスを`group_vars/all.yml`に設定
  6. Mac側の`~/.ssh/config`に2つの接続設定を追加:
     - `raspi5-local`: 通常運用時（ローカルネットワーク `192.168.10.230`）
     - `raspi5-tailscale`: メンテナンス時（Tailscale経由 `100.106.158.2`）
  7. Ansibleタスク（`roles/common/tasks/tailscale.yml`）を作成し、自動インストール可能にする

**実装の詳細**:
- Tailscaleインストール:
  - Pi5: `curl -fsSL https://tailscale.com/install.sh | sh`
  - Pi4: Pi5経由でSSH接続してインストール
  - Pi3: Pi5経由でSSH接続してインストール（サイネージサービスを停止してから実行）
- Tailscale認証:
  - 各デバイスで`sudo tailscale up`を実行
  - 認証URLが表示されるので、Macのブラウザで開いて承認
  - `tailscale status`でIPアドレスを確認
- SSH接続設定:
  - `~/.ssh/config`に`raspi5-local`と`raspi5-tailscale`を追加
  - `IdentityFile`に正しいSSH鍵（`id_ed25519`）を指定
  - `StrictHostKeyChecking no`でホストキーチェックを無効化（初回接続時）

**学んだこと**: 
- Tailscaleは無料で利用でき、設定が簡単
- WireGuardベースで暗号化が強固
- 動的IPアドレスでも固定IPのように接続可能
- SSHポートをインターネットに公開する必要がない
- メンテナンス時のみ使用し、通常運用時はローカルネットワークを使用する運用が適切
- Pi3はリソースが限られているため、サイネージサービスを停止してからインストールする必要がある

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/common/tasks/tailscale.yml`
- `infrastructure/ansible/roles/common/tasks/main.yml`
- `~/.ssh/config`（Mac側）
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-072] Pi5のUFW適用とHTTPSリダイレクト強化

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- Pi5のポート80/443/22以外も開放されており、SSHがインターネット側から到達可能だった
- HTTPアクセスがそのまま提供され、HTTPS強制が徹底されていなかった

**要因**: 
1. UFWが未導入で、iptablesのデフォルト許可状態だった
2. HTTP→HTTPSリダイレクトはCaddyfile.localに存在したが、設定がコード化されておらず再現性が低かった

**試行した対策**: 
- [試行1] iptablesで手動設定 → **失敗**（再起動で消える、Ansible未管理）
- [試行2] Caddyでヘッダー追加のみ → **部分的成功**（HTTPSは使用できるがHTTPが残る）

**有効だった対策**: 
- ✅ UFWをAnsibleで導入し、デフォルトdeny/allow構成に設定
- ✅ HTTP(S)のみ許可、SSHはローカルLANとTailscaleのサブネットからのみ許可
- ✅ Caddyfile（dev/local/production）にHTTP→HTTPSリダイレクトとセキュリティヘッダーを明記
- ✅ `docker-compose.server.yml`で`/var/log/caddy`をホストにマウントして設定を一元化

**学んだこと**: 
- 工場LANとTailscaleネットワークだけを明示的に許可する事で、SSH暴露を避けられる
- WebサーバーのHTTPSリダイレクトはCaddyレイヤーで完結させるとシンプル
- ファイアウォールとリバースプロキシの設定はAnsible管理に統一しておくと再現性が高い

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/docker/Caddyfile*`
- `infrastructure/docker/docker-compose.server.yml`
- `docs/security/requirements.md`

---

---

### [KB-073] Caddyアクセスログとfail2ban（SSH/HTTP）の連携

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- fail2banでHTTP/APIの不正アクセスを検知したかったが、Caddyのログがstdoutのみで参照できない
- SSHブルートフォースも検知できていなかった

**要因**: 
1. Caddyコンテナのログがファイルに出力されておらず、ホスト上でfail2banが読めない
2. fail2banのjail/filterが未構成

**試行した対策**: 
- [試行1] docker logsをfail2banで読み込む → **失敗**（ファイルではないため不可）
- [試行2] journalctlでCaddyログを拾う → **失敗**（コンテナがjournaldに書き込んでいない）

**有効だった対策**: 
- ✅ `/var/log/caddy`をホストで作成し、コンテナにマウント
- ✅ Caddyの`log`ディレクティブでCLF形式をファイル出力
- ✅ fail2banに`factory.conf`（sshd + caddy-http-auth）と専用filterを追加
- ✅ Ansibleでテンプレート化し、サービス再起動まで自動化

**学んだこと**: 
- fail2banは標準でCLF（common log format）を解析できるため、CaddyでもCLFを採用すると流用しやすい
- コンテナのセキュリティログはホストへバインドマウントし、OS側ツールと連携させると管理が単純化する
- SSH/HTTP双方の閾値をAnsible変数化しておくと、リスクレベルに応じた調整が容易

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/templates/fail2ban.local.j2`
- `infrastructure/ansible/templates/fail2ban-filter-caddy-http.conf.j2`
- `infrastructure/docker/Caddyfile*`
- `docs/plans/security-hardening-execplan.md`### [KB-074] Pi5のマルウェアスキャン自動化（ClamAV/Trivy/rkhunter）

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi5にウイルス/ルートキット検知の仕組みがなく、感染を検知できない
- スキャンログが分散し、監視フェーズで再利用しづらかった

**有効だった対策**: 
- ✅ ClamAV/Trivy/rkhunterをAnsibleで導入し、`/usr/local/bin/*-scan.sh`を配置
- ✅ 03:00/03:30/04:00のcronで夜間スキャンを自動化し、ログを`/var/log/{clamav,trivy,rkhunter}`へ集約
- ✅ TrivyはGitHub公式ARM64 `.deb`をダウンロードしてdpkgでインストール（APTリポジトリが無いため）

**学んだこと**: 
- Debian bookworm系ではTrivyのAPTパッケージが提供されていないため、公式リリースを直接導入するのが確実
- `freshclam`デーモンに任せれば手動`freshclam`は不要で、ログロックエラーも避けられる

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/malware.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-075] Pi4キオスクの軽量マルウェア対策

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi4（キオスク）はリソースが限られており、Pi5と同じ対象・頻度でスキャンするとUIレスポンスが低下する

**有効だった対策**: 
- ✅ ClamAVとrkhunterのみを導入し、対象を`/opt/RaspberryPiSystem_002/storage`に限定
- ✅ 週1回（日曜02:00開始）のcronを設定し、低負荷時間帯だけスキャン
- ✅ Pi5と同じスクリプト/ログ命名に揃え、監視・アラートの共通化を容易にした

**学んだこと**: 
- リソースが限られた端末では、対象フォルダと頻度を絞ることでセキュリティとUXの両立が可能
- Pi5を経由したscp→sshの配布フローを整備すると、再デプロイが容易になる

**関連ファイル**: 
- `infrastructure/ansible/roles/kiosk/tasks/security.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-076] fail2ban連携のセキュリティ監視タイマー

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ローカル運用では外部通知サービス（Slack等）が使えず、fail2banログを目視しないと侵入試行に気付けない
- 既存の`alerts/`ファイルベース通知と連携できていなかった

**有効だった対策**: 
- ✅ `/usr/local/bin/security-monitor.sh`を追加し、fail2banログのBan行を15分間隔で走査
- ✅ systemd timer（`security-monitor.timer`）で常時起動し、stateファイルで重複通知を防止
- ✅ Banイベントを検知すると`generate-alert.sh`を呼び、管理コンソールのアラートバナーへ自動表示

**学んだこと**: 
- 初回実行時は既存ログを基準化してから監視を開始しないと、過去のBanが大量通知になる
- `logger`タグを付与しておくと、journalctlでも監視スクリプトの動作状況を追跡しやすい

**関連ファイル**: 
- `infrastructure/ansible/templates/security-monitor.sh.j2`
- `infrastructure/ansible/templates/security-monitor.service.j2`
- `infrastructure/ansible/templates/security-monitor.timer.j2`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-177] `ports-unexpected` が15分おきに発生し続ける（Pi5の不要ポート露出/監視ノイズ）

**EXEC_PLAN.md参照**: 2026-01-18（ポート露出削減 + `security-monitor` 改善）

**事象**:
- 管理コンソール（`/admin`）に **同一内容の `ports-unexpected`** が15分間隔で出続ける
- 例: `許可されていないLISTENポートを検出: 111 25 ... 5353 ... 631 ... 5900 ...` のように、OS/常駐サービス由来のポートが混在してノイズ化

**調査（再現/確認コマンド）**:
- Pi5上でLISTEN/UNCONNの実態を確認:
  - `sudo ss -H -tulpen`
- UFWの許可状況を確認:
  - `sudo ufw status verbose`
- Docker公開の有無を確認（`db`/`api`がホストへpublishされていないこと）:
  - `docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps`
- ベースライン（証跡）: `docs/knowledge-base/infrastructure/ports-baseline-20260118.md`

**根本要因**:
1. **`security-monitor.sh` が「ポート番号だけ」で判定**していたため、
   - `127.0.0.1` だけのサービス（exim4/cups 等）や、
   - Tailscale由来のソケット（`tailscaled`）や、
   - OS標準の常駐（rpcbind/avahi 等）
   まで一律に「危険」と判定し、運用上ノイズになっていた
2. UFWで遮断していても **サービス自体がLISTENしている**ため、監視としては検知され続ける（＝通知が止まらない）

**有効だった対策（恒久化）**:
- ✅ 不要サービスを **stop + disable + mask** して、LISTEN自体を消す（UFW依存を減らす）
  - 対象: `rpcbind.socket` / `rpcbind.service` / `avahi-daemon.service` / `exim4.service` / `cups.service`
  - 実装: `infrastructure/ansible/roles/server/tasks/security.yml`
  - 変数: `infrastructure/ansible/group_vars/all.yml`
    - `server_disable_unused_services: true`
    - `server_unused_systemd_units_to_mask: [...]`
- ✅ `security-monitor.sh` のポート監視を改善（**外部露出 + プロセス込み**）
  - `ss -H -tulpen` を使い `addr:port(process,proto)` をdetailsに含める
  - 監視から除外:
    - `127.0.0.1` / `::1`（ループバックのみ）
    - `tailscaled` および Tailscaleアドレス帯（`100.*`, `fd7a:*`）
    - link-local（`fe80:*`、DHCPv6クライアント等）
  - VNC運用を踏まえ `ALLOWED_LISTEN_PORTS` のデフォルトに `5900` を追加
  - 既存の重複抑止（state比較）は維持
  - 実装: `infrastructure/ansible/templates/security-monitor.sh.j2`

**適用手順（Pi5）**:
- `inventory.yml` の `server` は `ansible_connection: local` のため、**Pi5上でAnsibleを実行**するのが前提。
- 例:
  - `cd /opt/RaspberryPiSystem_002/infrastructure/ansible`
  - `ansible-playbook playbooks/harden-server-ports.yml`

**実機検証結果（2026-01-18）**:
- ✅ デプロイ成功: `feat/ports-hardening-20260118`ブランチをPi5にデプロイし、`harden-server-ports.yml`を実行
- ✅ 設定維持確認: Gmail/Dropboxの設定（`backup.json`）が維持されていることを確認
- ✅ アラート解消: `ports-unexpected`アラートの新規発生なし（ノイズが解消）
- ✅ ポート状態確認: 期待ポート（22/80/443/5900）のみ外部露出、Docker内部ポート（5432/8080）は非公開
- ✅ サービス状態確認: 不要サービス（rpcbind/avahi/exim4/cups）がmask/inactive状態
- ✅ 監視稼働確認: `security-monitor.timer`が有効化・稼働中、環境変数が正しく注入されていることを確認

**トラブルシューティング**:
- `security-monitor` のアラートに `(...unknown,udp)` のようにプロセス名が出ない:
  - `ss -H -tulpen` の `users:(("proc",pid=...))` 抽出が崩れている可能性。
  - `sed` の正規表現は **basic regex** と **グルーピングの `\(...\)`** が必要（`\\1` のエスケープ違いで失敗しやすい）。
- コントローラ（Mac）側から `ansible-playbook` を実行すると `role 'server' not found` になる:
  - `ansible.cfg` の `roles_path = ./roles` は **`infrastructure/ansible` をCWDにして実行**する前提。
- デプロイ時に`harden-server-ports.yml`が未追跡ファイルとして存在すると、git checkoutで上書き警告が出る:
  - エビデンス: `error: The following untracked working tree files would be overwritten by checkout`
  - 対応: Pi5上で未追跡ファイルを削除してから再デプロイ（`rm infrastructure/ansible/playbooks/harden-server-ports.yml`）。次回以降はmainブランチにマージ済みのため発生しない。
- `deploy.sh`のヘルスチェックがタイムアウトしても、実際にはAPIは正常起動していることがある:
  - エビデンス: デプロイスクリプトが10分タイムアウトしたが、手動で`curl`すると`/api/system/health`が`ok`を返す。
  - 対応: Dockerサービス起動に時間がかかる場合があるため、タイムアウト後も手動でヘルスチェックを実施し、必要に応じてコンテナ再起動を確認。

**関連ファイル**:
- `infrastructure/ansible/templates/security-monitor.sh.j2`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/playbooks/harden-server-ports.yml`
- `docs/security/port-security-audit.md`
- `docs/security/port-security-verification-results.md`
- `docs/knowledge-base/infrastructure/ports-baseline-20260118.md`
- `docs/runbooks/ports-unexpected-and-port-exposure.md`

---

---

### [KB-077] マルウェアスキャン結果の自動アラート化

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ClamAV/Trivy/rkhunterが感染や秘密情報を検出しても、ログを開かなければ気づけなかった
- rkhunterの既知警告やTrivyの秘密鍵検出など、誤検知を抑制しつつ通知したかった

**有効だった対策**: 
- ✅ 各スキャンスクリプトで終了コード／警告行を判定し、`generate-alert.sh`に詳細を渡すよう改修
- ✅ Trivyの`--skip-dirs`とignoreパターン、rkhunterの除外リストをAnsible変数にして誤検知を抑制
- ✅ アラート種別（`clamav-detection`、`trivy-detection`、`rkhunter-warning`）を分け、管理画面で原因を特定しやすくした

**学んだこと**: 
- `clamscan`はexit code=1で感染ファイル、2でエラーなので、両ケースを分けて通知する必要がある
- Trivyの秘密鍵検出は証明書ディレクトリを`--skip-dirs`対象にすることでノイズを大幅に減らせる

**関連ファイル**: 
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `infrastructure/ansible/group_vars/all.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-078] 複数ローカルネットワーク環境でのVNC接続設定

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- 会社のネットワーク（192.168.10.0/24）と自宅のネットワーク（192.168.128.0/24）で異なるIPアドレスを使用
- UFWでVNCポート（5900/tcp）が `192.168.10.0/24` からのみ許可されていたため、自宅からRealVNC ViewerでPi5に接続できなかった

**有効だった対策**: 
- ✅ UFWのVNC許可ネットワークに `192.168.128.0/24` を追加（`sudo ufw allow from 192.168.128.0/24 to any port 5900`）
- ✅ Ansibleの `group_vars/all.yml` の `ufw_vnc_allowed_networks` に両方のネットワークを定義し、次回デプロイ時に自動反映されるように設定
- ✅ 複数のローカルネットワークに対応できるよう、リスト形式で管理

**学んだこと**: 
- 異なるネットワーク環境（会社/自宅）で運用する場合、ファイアウォール設定も複数のネットワークを許可する必要がある
- UFWのルールは `ufw_vnc_allowed_networks` のようなリスト変数で管理することで、環境ごとの追加が容易になる
- Tailscale経由での接続は別途設定されているため、ローカルネットワークの追加設定は必要ない

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml` (ufw_vnc_allowed_networks)
- `infrastructure/ansible/roles/server/tasks/security.yml` (VNCポート許可タスク)
- `docs/plans/security-hardening-execplan.md`
- `docs/security/requirements.md`

---

---

### [KB-079] Phase7セキュリティテストの実施結果と検証ポイント

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- Phase1-6で実装したセキュリティ対策が正しく動作するか、包括的なテストが必要だった
- ネットワーク環境の切り替え、Tailscale経路、ファイアウォール、HTTPS強制、fail2ban、バックアップ復元、マルウェアスキャンの各機能を検証する必要があった

**実施した検証**:
- ✅ **IPアドレス管理の切り替え**: `ansible ... -e network_mode={local,tailscale}` で server/kiosk/signage IP が正しく切り替わることを確認
- ✅ **Tailscale接続**: Mac → Pi5 への Tailscale SSH/HTTPS が機能し、インターネット経由でも安全に接続できることを確認
- ✅ **ファイアウォール設定**: UFWで許可されたポート（80/443/22/5900）のみ通過し、その他が遮断されることを確認
- ✅ **HTTPS強制**: HTTPアクセスが301リダイレクトでHTTPSに転送されることを確認
- ✅ **fail2ban動作**: 意図的なBanイベントで `security-monitor.sh` がアラートを生成し、解除後に正常に戻ることを確認
- ✅ **バックアップ暗号化・復元**: GPG暗号化バックアップからテストDBへ復元し、データ整合性（Loan 436件）を確認
- ✅ **マルウェアスキャン**: ClamAV/Trivy/rkhunterの手動スキャンでログとアラート生成を確認

**学んだこと**: 
- ネットワークモードの切り替えは `-e network_mode=` で動的に変更でき、Ansible変数が正しく展開されることを確認
- Tailscale経由での接続はローカルネットワークが変わっても安定して機能する
- fail2banのBanイベントは `security-monitor.sh` で自動的にアラート化され、管理画面で確認可能
- バックアップ復元テストは本番DBとは別のテストDBを使用することで、安全に検証できる
- Trivyの秘密鍵検出は `--skip-dirs` で抑制できるが、ログには過去の検出履歴も残るためタイムスタンプで判断する必要がある
- rkhunterの既知警告（PermitRootLogin等）はアラート経由で把握できるため、運用上問題なし

**残課題**:
- オフラインUSBメディアを実際にマウントした状態でのバックアップコピー/削除テストは未実施（USB接続時に実施予定）
- TrivyのDockerイメージ単位のスキャンは未実装（今後の課題）

**関連ファイル**: 
- `docs/plans/security-hardening-execplan.md` (Phase 7 進捗)
- `docs/security/requirements.md` (テスト状況)
- `scripts/server/backup-encrypted.sh`
- `scripts/server/restore-encrypted.sh`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`

---

---

### [KB-178] ログの機密情報保護実装（x-client-keyの[REDACTED]置換）

**EXEC_PLAN.md参照**: 2026-01-18（セキュリティ評価・緊急対策実装）

**事象**: 
- `x-client-key`（キオスクAPI認証キー）がログに平文で出力されていた
- ログファイルが漏洩した場合、`x-client-key`が悪用され、キオスクAPIへの不正アクセスが可能になる
- セキュリティ評価で中優先度だが影響が大きい脆弱性として特定された

**要因**: 
1. **ログ出力時の機密情報フィルタリング未実装**: リクエストロガーや各ルートハンドラーで、`x-client-key`をそのままログに出力していた
2. **機密情報の定義が不明確**: どの情報が機密情報として扱うべきか、明確な基準がなかった

**有効だった対策**: 
- ✅ **ログ出力時の機密情報フィルタリング実装**（2026-01-18）:
  1. `request-logger.ts`: `x-client-key`を`[REDACTED]`に置換
  2. `kiosk.ts`: `clientKey`、`rawClientKey`、`client.apiKey`を`[REDACTED]`に置換、`headers`から`x-client-key`を除外
  3. `tools/loans/cancel.ts`: `headerKey`と`headers`から`x-client-key`を除外
  4. `tools/loans/return.ts`: `headerKey`と`headers`から`x-client-key`を除外
  5. `webrtc/signaling.ts`: `headers`から`x-client-key`を除外
  6. `tools/loans/delete.ts`: `headers`から`x-client-key`を除外

**実装の詳細**:
- **修正パターン1**: ヘッダーから直接除外
  ```typescript
  // 修正前
  'x-client-key': request.headers['x-client-key'],
  
  // 修正後
  'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
  ```

- **修正パターン2**: ヘッダーオブジェクト全体をサニタイズ
  ```typescript
  // 修正前
  app.log.info({ headers: request.headers }, 'Request received');
  
  // 修正後
  const sanitizedHeaders = { ...request.headers };
  if ('x-client-key' in sanitizedHeaders) {
    sanitizedHeaders['x-client-key'] = '[REDACTED]';
  }
  app.log.info({ headers: sanitizedHeaders }, 'Request received');
  ```

- **修正パターン3**: 変数自体を`[REDACTED]`に置換
  ```typescript
  // 修正前
  app.log.info({ clientKey, rawClientKey }, 'Kiosk config request');
  
  // 修正後
  app.log.info({ 
    clientKey: clientKey ? '[REDACTED]' : undefined, 
    rawClientKey: '[REDACTED]' 
  }, 'Kiosk config request');
  ```

**実機検証結果（2026-01-18）**:
- ✅ CI成功: GitHub Actions CIで全テストが成功（lint-and-test、e2e-smoke、e2e-tests、docker-build）
- ✅ デプロイ成功: `feat/ports-hardening-20260118`ブランチをPi5にデプロイし、正常に動作
- ✅ ログ確認: ログに`x-client-key`が`[REDACTED]`として出力されることを確認
- ✅ 機能確認: キオスクAPIが正常に動作し、認証も正常に機能

**学んだこと**: 
- ログ出力時は機密情報（認証キー、パスワード、トークン等）を必ずフィルタリングする
- `[REDACTED]`という明確なマーカーを使用することで、機密情報が意図的に隠されていることを示す
- ログの可読性は低下するが、セキュリティを優先する
- デバッグ時は必要に応じて、デバッグモードでのみ値を出力する機能を追加することを検討できる

**副作用**: 
- **ログの可読性**: `x-client-key`が`[REDACTED]`に置換されるため、ログの可読性が低下する可能性があるが、セキュリティを優先
- **デバッグ**: `x-client-key`の値がログに出力されないため、デバッグ時に値の確認が困難になる可能性がある

**再発防止**: 
- 新しいAPIエンドポイントを追加する際は、ログ出力時に機密情報をフィルタリングすることを徹底
- コードレビュー時に、ログ出力箇所で機密情報が含まれていないか確認するチェックリストを追加
- CIでログ出力に機密情報が含まれていないか検証するテストを追加することを検討

**関連ファイル**: 
- `apps/api/src/plugins/request-logger.ts`
- `apps/api/src/routes/kiosk.ts`
- `apps/api/src/routes/tools/loans/cancel.ts`
- `apps/api/src/routes/tools/loans/return.ts`
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/api/src/routes/tools/loans/delete.ts`
- `docs/security/log-redaction-implementation.md`
- `docs/security/urgent-security-measures.md`
- `docs/security/evaluation-report.md`

---
