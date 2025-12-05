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
- [ ] (2025-12-04) セキュリティ要件定義の作成完了
- [ ] IPアドレス直接記述箇所の洗い出し完了
- [ ] 実装計画の詳細化完了

### Phase 1: IPアドレス管理の変数化と運用モード可視化（最優先）
- [ ] Ansibleの`group_vars/all.yml`にIPアドレス変数を定義
- [ ] `inventory.yml`で変数を参照するように修正
- [ ] テンプレートファイル（`.j2`）のデフォルト値を修正
- [ ] `scripts/register-clients.sh`のIPアドレスを変数参照に変更
- [ ] ローカルネットワークとTailscaleの切り替えテスト
- [ ] 運用モード自動検出APIの実装（インターネット接続の有無で判定）
- [ ] 管理画面での運用モード表示（ヘッダーまたはダッシュボード）

### Phase 2: メンテナンス時の安全化（Tailscale導入）
- [ ] MacのTailscale設定確認（✅ 完了済み）
- [ ] Raspberry Pi 5にTailscaleクライアントをインストール（メンテナンス時）
- [ ] Raspberry Pi 4/3にTailscaleクライアントをインストール（メンテナンス時、必要に応じて）
- [ ] SSH接続設定を2つ用意（Tailscale IP用とローカルIP用）
- [ ] メンテナンス時の運用フロー確立

### Phase 3: バックアップ暗号化・オフライン保存（最優先）
- [ ] バックアップスクリプトに暗号化機能を追加
- [ ] オフライン保存用のUSBメモリ/外部HDDの設定
- [ ] バックアップ自動化スクリプトの作成
- [ ] バックアップ復元テスト

### Phase 4: 通常運用時のセキュリティ対策
- [ ] ufwのインストールと有効化（Pi5）
- [ ] 必要なポートのみ開放（80, 443）
- [ ] SSHポートの制限（ローカルネットワークまたはTailscale経由のみ）
- [ ] Caddyfile.productionでHTTP→HTTPSリダイレクトを設定
- [ ] 環境変数`FORCE_HTTPS=true`を設定
- [ ] fail2banのインストールと設定
- [ ] fail2banのjail設定（SSH、HTTP、API）

### Phase 5: マルウェア対策
- [ ] ClamAVのインストール（Pi5）
- [ ] ClamAVの定期スキャン設定（cron）
- [ ] Trivyのインストール（Pi5）
- [ ] Dockerイメージの定期スキャン設定
- [ ] rkhunterのインストール（Pi5）
- [ ] rkhunterの定期スキャン設定
- [ ] ClamAVの軽量設定（Pi4、週1回スキャン）
- [ ] rkhunterの導入（Pi4）

### Phase 6: 監視・アラート
- [ ] セキュリティログの監視設定
- [ ] 異常検知時のアラート通知設定
- [ ] スキャン結果のログ監視設定

### Phase 7: テスト・検証
- [ ] IPアドレス管理の切り替えテスト
- [ ] Tailscale接続テスト
- [ ] ファイアウォール設定の動作確認
- [ ] HTTPS強制の動作確認
- [ ] fail2banの動作確認
- [ ] バックアップ暗号化・復元テスト
- [ ] セキュリティソフトのスキャンテスト

## Surprises & Discoveries

- 観測: Raspberry Pi 3はリソースが限られているため、セキュリティソフトの導入は不要と判断。
  エビデンス: サイネージが常時起動しており、セキュリティソフトの追加負荷がシステムに悪影響を与える可能性が高い。
  対応: Pi5は必須、Pi4は推奨（軽量設定）、Pi3は不要という方針を採用。

- 観測: IPアドレスが複数の設定ファイルに直接記述されており、ネットワーク環境変更時に複数箇所を手動で修正する必要がある。
  エビデンス: `inventory.yml`、テンプレートファイル、スクリプトなどにIPアドレスが直接記述されている。
  対応: Ansibleの`group_vars/all.yml`にIPアドレス変数を定義し、一括管理できるようにする。

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

## Outcomes & Retrospective

- (未記入) — 実装完了時に成果・残課題を記載。

## Context and Orientation

- **現状のセキュリティ対策**: 
  - ✅ 認証・認可（JWT、RBAC）
  - ✅ 入力バリデーション（zod）
  - ✅ XSS対策（Reactのデフォルトエスケープ）
  - ✅ SQLインジェクション対策（Prisma）
  - ✅ APIレート制限
  - ✅ HTTPS対応（設定可能だが強制は未実装）
  - ✅ バックアップ機能（暗号化・オフライン保存は未実装）

- **不足している対策**:
  - ❌ ファイアウォール設定
  - ❌ IP制限
  - ❌ fail2ban（ブルートフォース対策）
  - ❌ HTTPS強制
  - ❌ バックアップ暗号化・オフライン保存
  - ❌ セキュリティソフト（ClamAV、Trivy、rkhunter）
  - ❌ ログ監視・アラート
  - ❌ IPアドレス管理の変数化

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
   - ログファイルの監視設定
   - 異常パターンの検知設定

2. **異常検知時のアラート通知設定**
   - アラート通知方法の決定（メール、Slackなど）
   - アラート通知スクリプトの作成

3. **スキャン結果のログ監視設定**
   - ClamAV、Trivy、rkhunterのスキャン結果をログに記録
   - 異常検知時のアラート通知

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
- [ ] fail2banがブルートフォース攻撃をブロックすることを確認

### Phase 5: マルウェア対策テスト

- [ ] ClamAVが正常にスキャンできることを確認
- [ ] TrivyがDockerイメージをスキャンできることを確認
- [ ] rkhunterが正常にスキャンできることを確認

### Phase 6: 監視・アラートテスト

- [ ] セキュリティログが正しく記録されることを確認
- [ ] 異常検知時にアラート通知が送信されることを確認
- [ ] スキャン結果がログに記録されることを確認

