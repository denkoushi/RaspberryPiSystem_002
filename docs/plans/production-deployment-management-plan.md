# プロダクション環境でのデプロイメント・更新・デバッグ管理

## 概要

| 項目 | 内容 |
|------|------|
| **目的** | 現場に投入したラズパイの効率的な更新・デバッグ管理 |
| **サーバー** | Raspberry Pi 5（1台） |
| **クライアント** | Raspberry Pi 4/3/Zero2W（数十台、増加予定） |
| **ネットワーク** | 工場内ローカルネットワークのみ（インターネット接続なし） |
| **管理方式** | SSH + Ansible（更新）、HTTP/HTTPS（状態監視） |

---

## 背景と前提条件

- 工場内LANでのみ運用（外部インターネット非接続）
- Raspberry Pi 5がサーバーとして24h稼働、クライアントは今後棟をまたいで増加
- 毎日現場に行けるが、将来台数が増えると手動更新は破綻する
- 現在は **手動SSH + git pull + サービス再起動** を台数分繰り返している
- サーバー側ではDocker Compose、クライアント側では軽量スクリプトが稼働
- 管理者は専門外のため、 **ドキュメント化された手順と自動化** が必須

---

## 構想の妥当性評価

| 観点 | 評価 | 理由 |
|------|------|------|
| **実装難易度** | 中 | 既存のSSH運用が前提。Ansible導入とAPI追加は経験済みスタック内で完結 |
| **現実性** | 高 | 工場内LANのみで閉じる構成。追加ハード不要。既存資産（Docker, Fastify, Prisma）を再利用 |
| **安定度** | 高 | SSH + Ansibleはエンタープライズで実績多数。HTTP報告は既存API基盤上で動作 |
| **拡張性** | 非常に高 | インベントリに追記するだけで対象デバイスを増やせる。状態APIは将来の監視/通知に転用可能 |
| **運用負荷** | 低 | Macから1コマンド更新。状態/ログはWeb管理画面で一元確認 |

### 代替案との比較

| 案 | 概要 | 長所 | 短所 | 結論 |
|----|------|------|------|------|
| SSH + Ansible（採用案） | サーバーから一括制御 | 即時反映、標準技術、スクリプト資産と親和 | SSH鍵管理が必要 | **最もバランス良い** |
| クライアント常駐エージェントのみ | 各Piがサーバーをポーリング | SSH不要、自己完結 | 反映遅延、エージェントの開発・保守コスト増 | 状態報告には採用、更新には不向き |
| 手動更新継続 | 従来通り | 追加実装なし | 台数増で破綻、人為ミス多発 | **非現実的** |

---

## 成功条件（Definition of Done）

1. Macから `./scripts/update-all-clients.sh` を実行すると、全クライアントの更新可否が一覧表示される
2. どのクライアントで更新/エラーが発生したかを `apps/web` もしくは `curl` で即座に追跡できる
3. ネットワーク断でもクライアントは最後に取得したサイネージ/設定を維持し、復旧後に自動同期する
4. 更新フローとデバッグ手順が `docs/guides/` に手順化され、非専門家でも再現できる

---

## 実行ロードマップ（WBS抜粋）

| 期日目安 | マイルストーン | 主担当 | 依存関係 | 成果物 |
|----------|----------------|--------|----------|--------|
| Day 1 AM | Phase 1.1-1.2 完了 | サーバー担当 | なし | SSH鍵、Ansible疎通ログ |
| Day 1 PM | Phase 1.3-1.4 完了 | アプリ担当 | 1.2 | Playbook、スクリプト |
| Day 2 AM | Phase 1 総合テスト | QA | 1.4 | 更新テストレポート |
| Day 2 PM | Phase 2.1-2.2 スキーマ/API | API担当 | Phase1 | Prismaマイグレーション、API |
| Day 3 AM | Phase 2.3 クライアントAgent | クライアント担当 | 2.2 | systemdユニット |
| Day 3 PM | Phase 2.4 UI & 総合テスト | Web担当/QA | 2.3 | 管理画面、テスト記録 |

---

## 決定事項

### 1. 一括更新システム ✅ 採用

| 項目 | 内容 |
|------|------|
| **方式** | SSH + Ansible |
| **目的** | Macから1コマンドで全クライアントを更新 |
| **難易度** | ★★☆☆☆（中程度） |
| **安定度** | ★★★★★（非常に高い：業界標準） |
| **拡張性** | ★★★★★（非常に高い：台数増加に対応） |

### 2. デバッグ支援システム ✅ 採用

| 項目 | 内容 |
|------|------|
| **方式** | HTTP/HTTPS（クライアント→サーバー） |
| **目的** | 全クライアントの状態・ログを一元管理 |
| **難易度** | ★★★☆☆（やや高い） |
| **安定度** | ★★★★☆（高い） |
| **拡張性** | ★★★★★（非常に高い） |

---

## 実装計画

### Phase 1: 一括更新システム（SSH + Ansible）

**所要時間**: 約2-3日  
**前提条件**: なし

#### Step 1.1: SSH鍵の設定

| 項目 | 内容 |
|------|------|
| **難易度** | ★☆☆☆☆（簡単） |
| **所要時間** | 30分〜1時間 |
| **リスク** | 低（標準的なSSH設定） |

**作業内容**:
1. サーバー側でSSH鍵ペアを生成
2. 各クライアントに公開鍵を配布
3. パスワード認証を無効化（オプション）

**チェックリスト**:
- [ ] サーバーの `/root/.ssh/` に600権限で鍵が配置されている
- [ ] 各クライアントの `~/.ssh/authorized_keys` に公開鍵が追記されている
- [ ] `sshd_config` の `PasswordAuthentication no` が設定済み（任意）

**コマンド例**:
```bash
# サーバー（Pi5）
ssh-keygen -t ed25519 -f ~/.ssh/raspi-clients -C "batch-update"
for host in $(cat clients.txt); do
  ssh-copy-id -i ~/.ssh/raspi-clients.pub pi@$host
done
```

**成果物**:
- `/root/.ssh/id_ed25519`（秘密鍵）
- `/root/.ssh/id_ed25519.pub`（公開鍵）
- `docs/guides/ssh-setup.md`（設定手順書）

**完了条件**:
- `ssh -i ~/.ssh/raspi-clients pi@<client>` でパスワード入力なしに接続できること
- 手順書に実施日時・対象クライアントを記録済み

#### Step 1.2: Ansibleの導入

| 項目 | 内容 |
|------|------|
| **難易度** | ★★☆☆☆（中程度） |
| **所要時間** | 1-2時間 |
| **リスク** | 低（パッケージインストールのみ） |

**作業内容**:
1. サーバーにAnsibleをインストール
2. インベントリファイルを作成
3. 接続テスト（`ansible all -m ping`）

**コマンド例**:
```bash
sudo apt update && sudo apt install -y ansible
mkdir -p infrastructure/ansible/playbooks
cat <<'EOF' > infrastructure/ansible/inventory.yml
[clients]
pi-kiosk-01 ansible_host=192.168.0.30
pi-kiosk-02 ansible_host=192.168.0.31
EOF
ansible all -i infrastructure/ansible/inventory.yml -m ping -u pi -b -K
```

**成果物**:
```
infrastructure/ansible/
├── ansible.cfg          # Ansible設定
├── inventory.yml        # クライアント一覧
└── playbooks/
    └── ping.yml         # 接続テスト用
```

**完了条件**:
- `ansible all -m ping` が全ホスト success で完了
- `ansible.cfg` に `host_key_checking = False` など運用方針が反映されている

#### Step 1.3: 更新Playbookの作成

| 項目 | 内容 |
|------|------|
| **難易度** | ★★☆☆☆（中程度） |
| **所要時間** | 2-3時間 |
| **リスク** | 中（Playbook設計が重要） |

**作業内容**:
1. 更新Playbookの作成（git pull、サービス再起動）
2. エラーハンドリングの実装
3. 更新結果のレポート機能

**コマンド例（抜粋）**:
```yaml
# infrastructure/ansible/playbooks/update-clients.yml
- hosts: clients
  become: yes
  tasks:
    - name: Pull latest code
      ansible.builtin.git:
        repo: /opt/RaspberryPiSystem_002/.git
        dest: /opt/RaspberryPiSystem_002
        version: main
        force: yes
    - name: Restart kiosk service
      ansible.builtin.systemd:
        name: kiosk-browser.service
        state: restarted
    - name: Collect status for report
      ansible.builtin.shell: journalctl -u kiosk-browser.service -n 20
      register: kiosk_log
    - ansible.builtin.debug:
        var: kiosk_log.stdout_lines
```

**成果物**:
```
infrastructure/ansible/playbooks/
├── update-clients.yml   # 全クライアント更新
├── restart-services.yml # サービス再起動
└── health-check.yml     # ヘルスチェック
```

**完了条件**:
- 想定外の停止時に `failed_when` で検知し、プレイブックが適切に失敗する
- `ansible-playbook update-clients.yml --limit pi-kiosk-01` でテスト実行済み結果を記録

#### Step 1.4: 一括更新スクリプト

| 項目 | 内容 |
|------|------|
| **難易度** | ★☆☆☆☆（簡単） |
| **所要時間** | 30分 |
| **リスク** | 低（ラッパースクリプト） |

**作業内容**:
1. Macから実行するスクリプトを作成
2. サーバー経由でAnsibleを実行

**スクリプトイメージ**:
```bash
#!/usr/bin/env bash
set -euo pipefail
SSH_TARGET=pi5-server
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

ssh "$SSH_TARGET" "cd /opt/RaspberryPiSystem_002 && \
  ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/update-clients.yml" \
  | tee "$SCRIPT_DIR/logs/update-$(date +%Y%m%d-%H%M).log"
```

**成果物**:
- `scripts/update-all-clients.sh`

**完了条件**:
- スクリプト実行でAnsibleログがリアルタイムにMacへストリームされる
- ログファイルが日時付きで保存され、失敗時の追跡が可能

**実装状況**: ✅ **完了**（2025-12-01）
- `scripts/update-all-clients.sh` が実装済み
- 環境変数 `RASPI_SERVER_HOST` でRaspberry Pi 5の接続先を指定可能
- ログファイルは `logs/ansible-update-YYYYMMDD-HHMMSS.log` に保存される

**使用方法**:
```bash
# Macから実行
export RASPI_SERVER_HOST="denkon5sd02@192.168.128.131"
./scripts/update-all-clients.sh
```

**実機テスト結果**: ✅ **成功**（2025-12-01）
- Raspberry Pi 3とRaspberry Pi 4への接続成功
- Gitリポジトリの更新成功
- サービスの再起動成功（存在するサービスのみ）

---

### Phase 2: デバッグ支援システム（HTTP/HTTPS）

**所要時間**: 約3-5日  
**前提条件**: Phase 1完了

#### Step 2.1: データベーススキーマ追加

| 項目 | 内容 |
|------|------|
| **難易度** | ★★☆☆☆（中程度） |
| **所要時間** | 1-2時間 |
| **リスク** | 低（既存スキーマへの追加） |

**作業内容**:
1. ClientStatusテーブルの追加
2. ClientLogテーブルの追加
3. マイグレーション実行

**手順**:
1. `apps/api/prisma/schema.prisma` にモデル追加
2. `pnpm prisma migrate dev --name add_client_status` を実行
3. サーバーとローカルで `pnpm prisma generate` を再実行
4. 既存データがある環境では `prisma migrate deploy` で反映

**成果物**:
```prisma
model ClientStatus {
  id            String   @id @default(uuid())
  clientId      String   @unique
  hostname      String
  ipAddress     String
  cpuUsage      Float
  memoryUsage   Float
  diskUsage     Float
  temperature   Float?
  uptimeSeconds Int?
  lastBoot      DateTime?
  lastSeen      DateTime  @default(now())
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@index([lastSeen])
}

model ClientLog {
  id        String   @id @default(uuid())
  clientId  String
  level     String
  message   String
  context   Json?
  createdAt DateTime @default(now())
  @@index([clientId, createdAt])
}
```
`apps/api/prisma/migrations/20251201030000_add_client_status_logs/migration.sql` に適用済み。

**完了条件**:
- `SELECT count(*) FROM "ClientStatus";` が実行できる（テーブルが存在）
- Prisma Client の型に `ClientStatus` / `ClientLog` が生成される

#### Step 2.2: サーバー側API実装

| 項目 | 内容 |
|------|------|
| **難易度** | ★★★☆☆（やや高い） |
| **所要時間** | 4-6時間 |
| **リスク** | 中（既存APIパターンに従う） |

**作業内容**:
1. 状態報告API（`POST /api/clients/status`）
2. ログ送信API（`POST /api/clients/logs`）
3. 状態一覧API（`GET /api/clients/status`）
4. ログ検索API（`GET /api/clients/logs`）

**設計メモ**:
- Fastifyプラグインとして `apps/api/src/routes/clients/index.ts` に集約
- `x-client-key` ヘッダでクライアント認証（既存のサイネージ用キーを再利用）
- Zodでリクエストボディを検証（CPU/メモリ値は0-100の数値）
- すべてのレスポンスに `requestId` を付与し、ログ追跡を容易にする

**成果物**:
```
apps/api/src/routes/clients.ts          # メトリクス+ログAPIを実装
apps/api/src/routes/__tests__/clients.integration.test.ts  # 統合テストを追加
```

**完了条件**:
- `pnpm test clients`（API単体テスト）が通過
- `curl -X POST /api/clients/status` の疎通テスト結果を記録

#### Step 2.3: クライアント側エージェント

| 項目 | 内容 |
|------|------|
| **難易度** | ★★★☆☆（やや高い） |
| **所要時間** | 4-6時間 |
| **リスク** | 中（軽量化が重要） |

**作業内容**:
1. Python3 スクリプトでメトリクスを取得（追加パッケージ不要）
2. `/etc/raspi-status-agent.conf` から API URL / 認証キーを読み込む
3. systemd service + timer で 1 分毎に実行

**構成案 / 実装済み**:
```
clients/status-agent/
├── README.md
├── status-agent.py            # メトリクス収集 & HTTP送信
├── status-agent.conf.example  # 設定テンプレート
├── status-agent.service       # systemd unit (oneshot)
└── status-agent.timer         # 1分毎に起動
```

**送信フロー**:
1. `/proc/stat` を 0.5 秒間隔で2回読み CPU 使用率を算出
2. `/proc/meminfo` からメモリ使用率、`shutil.disk_usage('/')` からディスク使用率を算出
3. `/sys/class/thermal/thermal_zone0/temp` があれば CPU 温度を添付
4. `urllib.request` + `x-client-key` ヘッダーで `POST <API_BASE_URL>/clients/status` に送信

**成果物**:
```
clients/status-agent/
├── README.md
├── status-agent.py
├── status-agent.conf.example
├── status-agent.service
└── status-agent.timer
```

**完了条件**:
- `systemctl list-timers status-agent.timer` に 1 分周期で登録されている
- サーバーの `ClientStatus` に 1 分以内の `lastSeen` が反映され、cpuUsage 等が更新される

#### Step 2.4: 管理画面（オプション）

| 項目 | 内容 |
|------|------|
| **難易度** | ★★★★☆（高い） |
| **所要時間** | 1-2日 |
| **リスク** | 低（UIのみ、機能は既存） |

**作業内容**:
1. クライアント一覧画面
2. ログ検索画面
3. エラーアラート表示

**UI要件**:
- SPA内の `/admin/clients` に一覧を設置
- 各カードに「ホスト名 / CPU / メモリ / lastSeen / 最新エラー件数」を表示
- 12時間以上更新がないクライアントは赤背景で強調
- ログ画面には全文検索 + レベルフィルタ + requestIdリンクを実装

**成果物**:
```
apps/web/src/pages/admin/clients/
├── index.tsx        # クライアント一覧
├── [id].tsx         # クライアント詳細
└── logs.tsx         # ログ検索
```

**完了条件**:
- `pnpm test --filter web` が通過
- Chromeで表示確認し、3台以上のダミーデータでUI崩れがない

---

## テスト計画

### Phase 1 テスト

| テスト項目 | 確認内容 | 合格基準 |
|-----------|---------|---------|
| SSH接続 | サーバー→クライアント接続 | パスワードなしで接続成功 |
| Ansible ping | 全クライアントへのping | 全台成功 |
| 更新Playbook | git pull、サービス再起動 | エラーなく完了 |
| 一括更新 | Mac→全クライアント更新 | 全台更新成功、結果表示 |

### Phase 2 テスト

| テスト項目 | 確認内容 | 合格基準 |
|-----------|---------|---------|
| 状態報告API | クライアント→サーバー送信 | 200 OK、DB保存確認 |
| ログ送信API | エラーログの送信 | 200 OK、DB保存確認 |
| 状態一覧API | 全クライアント状態取得 | 全クライアント表示 |
| 定期送信 | 1分ごとの自動送信 | 連続10回成功 |

---

## 実装の優先順位

| 優先度 | Phase | 内容 | 理由 |
|-------|-------|------|------|
| **1** | 1.1-1.4 | 一括更新システム | 即座に運用効率が向上 |
| **2** | 2.1-2.3 | デバッグ支援API | 問題発生時の対応速度向上 |
| **3** | 2.4 | 管理画面 | UIがなくてもAPIで確認可能 |

---

## リスクと対策

| リスク | 影響 | 対策 |
|-------|------|------|
| SSH鍵の漏洩 | 全クライアントへの不正アクセス | 鍵のパーミッション管理、定期的な鍵ローテーション |
| クライアント増加時の負荷 | Ansible実行時間の増加 | 並列実行数の調整、段階的な更新 |
| ネットワーク障害 | 更新・状態報告の失敗 | リトライ機構、オフライン時のローカルキャッシュ |
| クライアント側エージェントの停止 | 状態が不明になる | ヘルスチェック機能、アラート通知 |

---

## 拡張性の考慮

### 台数増加への対応

- **Ansibleの並列実行**: デフォルトで5台同時、設定で調整可能
- **インベントリの動的管理**: グループ化（建物別、種類別）で効率的な管理
- **状態報告の負荷分散**: 報告間隔の調整、バッチ送信

### 将来の拡張

| 機能 | 難易度 | 優先度 | 説明 |
|------|-------|-------|------|
| ロールバック機能 | ★★★☆☆ | 中 | 更新失敗時の自動ロールバック |
| アラート通知 | ★★☆☆☆ | 中 | エラー発生時のメール/Slack通知 |
| 設定の一元管理 | ★★★☆☆ | 低 | 環境変数の集中管理 |
| 自動バックアップ | ★★☆☆☆ | 低 | DBの定期バックアップ |

---

## 次のステップ

**Phase 1.1 から開始**: SSH鍵の設定

1. サーバー（Raspberry Pi 5）でSSH鍵ペアを生成
2. 各クライアントに公開鍵を配布
3. 接続テストを実施

実装を開始しますか？

---

## システムの動作フローと詳細説明

### 全体のアーキテクチャ

```
┌─────────────┐
│   Mac PC    │  ← 開発・管理用PC
│  (開発者)   │
└──────┬──────┘
       │ SSH接続
       │ (更新コマンド実行)
       ▼
┌─────────────────────────────────────┐
│      Raspberry Pi 5 (サーバー)      │
│  ┌──────────────────────────────┐  │
│  │  Ansible (更新制御)           │  │
│  │  - inventory.yml (クライアント一覧)│
│  │  - playbooks/ (更新手順)      │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  Docker Compose               │  │
│  │  - API (Fastify + Prisma)     │  │
│  │  - Web (React管理画面)        │  │
│  │  - DB (PostgreSQL)            │  │
│  └──────────────────────────────┘  │
└──────┬──────────────────────────────┘
       │ SSH接続 (Ansible経由)
       │ HTTP/HTTPS (状態報告)
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Raspberry   │  │ Raspberry   │  │ Raspberry   │
│   Pi 4      │  │   Pi 3      │  │  Pi Zero   │
│ (キオスク)  │  │ (サイネージ) │  │  (その他)  │
│             │  │             │  │             │
│ - Git       │  │ - Git       │  │ - Git       │
│ - Services  │  │ - Services  │  │ - Services  │
│ - Agent     │  │ - Agent     │  │ - Agent    │
└─────────────┘  └─────────────┘  └─────────────┘
```

### 更新フローの詳細

#### 1. MacからRaspberry Pi 5への接続

**質問**: Macからラズパイ5基点に書くラズパイ端末へコード更新が命令され実行されるのか？

**回答**: はい、その通りです。フローは以下の通りです：

**重要**: Ansibleを使うことで、**各端末での手動`git pull`は不要になります**。Ansibleプレイブックが自動的に実行します。

1. **Mac上でコマンド実行**:
   ```bash
   # Macのターミナルで実行
   ssh denkon5sd02@192.168.128.131 "cd /opt/RaspberryPiSystem_002 && \
     ansible-playbook -i infrastructure/ansible/inventory.yml \
     infrastructure/ansible/playbooks/update-clients.yml"
   ```

2. **Raspberry Pi 5がAnsibleを実行**:
   - Raspberry Pi 5上のAnsibleが、`inventory.yml`に記載された全クライアントに対して更新を実行
   - 各クライアントにSSH接続し、プレイブックに定義された手順を実行

3. **各クライアントでの実行内容**（自動実行）:
   - Gitリポジトリの更新（`git pull`）← **手動操作不要**
   - 依存関係のインストール（必要に応じて）← **手動操作不要**
   - サービスの再起動（存在するサービスのみ）← **手動操作不要**

**従来の手動更新フロー（各端末で個別に実行）**:
```bash
# Raspberry Pi 4に接続
ssh tools03@192.168.128.102
cd /opt/RaspberryPiSystem_002
git pull origin main  # ← 手動で実行
sudo systemctl restart kiosk-browser.service  # ← 手動で実行

# Raspberry Pi 3に接続
ssh signageras3@192.168.128.152
cd /opt/RaspberryPiSystem_002
git pull origin main  # ← 手動で実行
sudo systemctl restart signage-lite.service  # ← 手動で実行
# ... 数十台分繰り返し（時間がかかる、人為的ミスのリスク）
```

**Ansibleを使った自動更新フロー（Macから1コマンド）**:
```bash
# Macから実行（1コマンドで全端末更新）
ssh denkon5sd02@192.168.128.131 "cd /opt/RaspberryPiSystem_002 && \
  ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml"
# → 全端末が自動的に更新される（git pull、サービス再起動も自動）
```

#### 2. クライアントごとの機能の違いへの対応

**質問**: 各ラズパイの機能が違う場合はどう更新を分けるのかな？

**回答**: 以下の方法で対応しています：

1. **インベントリファイルでのグループ化**:
   ```yaml
   all:
     children:
       clients:
         hosts:
           raspberrypi4:
             ansible_host: 192.168.128.102
             ansible_user: tools03
           raspberrypi3:
             ansible_host: 192.168.128.152
             ansible_user: signageras3
       # 将来的にはグループ分けも可能
       # kiosk_clients:
       #   hosts:
       #     raspberrypi4: ...
       # signage_clients:
       #   hosts:
       #     raspberrypi3: ...
   ```

2. **プレイブックでの条件分岐**:
   - サービス再起動タスクで `ignore_errors: true` を設定し、存在しないサービスをスキップ
   - 将来的には、ホスト変数やグループ変数で異なるサービスリストを設定可能

3. **実際の動作例**:
   - Raspberry Pi 4: `signage-lite.service` が存在しないためスキップ、`kiosk-browser.service` も存在しないためスキップ
   - Raspberry Pi 3: `signage-lite.service` が存在するため再起動、`kiosk-browser.service` は存在しないためスキップ

#### 3. SDカードの容量について

**質問**: 各ラズパイ端末はSDなので容量が限られているが、大丈夫かな？

**回答**: 以下の対策で対応しています：

1. **Gitリポジトリの最小化**:
   - 各クライアントには `/opt/RaspberryPiSystem_002` にリポジトリ全体をクローン
   - Gitの履歴は保持されるが、実際に使用されるのは最新のコードのみ
   - 必要に応じて `git clone --depth 1` で浅いクローンも可能

2. **不要ファイルの除外**:
   - `.git/objects` は圧縮されているため、実際のディスク使用量はコードサイズの1.5〜2倍程度
   - プロジェクト全体のサイズは約50-100MB程度（Git履歴含む）

3. **ディスク使用量の監視**:
   - `status-agent` が定期的にディスク使用率を報告
   - 管理画面で各クライアントのディスク使用率を確認可能
   - 80%を超えた場合は警告表示

4. **推奨SDカードサイズ**:
   - **最小**: 16GB（開発・テスト用）
   - **推奨**: 32GB以上（本番環境）
   - **余裕を持たせる**: 64GB以上（長期的な運用）

5. **容量管理のベストプラクティス**:
   - 定期的なログローテーション（`journalctl --vacuum-time=7d`）
   - Dockerイメージのクリーンアップ（`docker system prune`）
   - 不要なパッケージの削除（`apt autoremove`）

### 状態監視フロー

#### 1. クライアントからの状態報告

各クライアントは `status-agent`（systemd timer）で1分ごとに以下を実行：

1. **メトリクス収集**:
   - CPU使用率（`/proc/stat`から算出）
   - メモリ使用率（`/proc/meminfo`から算出）
   - ディスク使用率（`shutil.disk_usage('/')`から算出）
   - CPU温度（`/sys/class/thermal/thermal_zone0/temp`から取得、可能な場合）
   - システム稼働時間（`uptime`から取得）

2. **APIへの送信**:
   ```python
   POST http://192.168.128.131:8080/api/clients/status
   Headers:
     x-client-key: <クライアント認証キー>
   Body:
     {
       "hostname": "raspberrypi",
       "cpuUsage": 12.5,
       "memoryUsage": 45.2,
       "diskUsage": 67.8,
       "temperature": 47.4,
       "uptimeSeconds": 86400,
       "logs": [...]
     }
   ```

3. **サーバー側での保存**:
   - `ClientStatus` テーブルに upsert（`clientId` をキーに更新）
   - `ClientLog` テーブルにログエントリを追加

#### 2. 管理画面での確認

管理者はWebブラウザで以下を確認：

1. **クライアント一覧** (`/admin/clients`):
   - 全クライアントの状態（CPU、メモリ、ディスク、温度、最終確認時刻）
   - 12時間以上更新がないクライアントは赤背景で警告表示

2. **ログ検索** (`/admin/clients/logs`):
   - クライアントID、ログレベル、期間でフィルタリング
   - 最新のログを確認可能

### 更新と監視の分離

重要なポイントとして、**更新（Ansible）と監視（HTTP/HTTPS）は別の仕組み**です：

- **更新（Ansible）**: Mac → Raspberry Pi 5 → 各クライアント（SSH経由）
  - 一方向の制御（サーバーからクライアントへ）
  - 必要時にのみ実行（手動またはスケジュール）

- **監視（HTTP/HTTPS）**: 各クライアント → Raspberry Pi 5（API経由）
  - 継続的な状態報告（1分ごと）
  - クライアント側から自動的に送信

この分離により、更新が失敗しても監視は継続し、問題を早期に発見できます。

---

## Ansibleで管理できる範囲と直接操作が必要な場面

### システム構成の全体像

本システムは以下の複雑な構成を持っています：

```
┌─────────────────────────────────────────────────────────┐
│              Raspberry Pi 5 (サーバー)                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Docker Compose (docker-compose.server.yml)      │   │
│  │  - PostgreSQL (DB)                               │   │
│  │  - API (Fastify + Prisma)                       │   │
│  │  - Web (React + Caddy)                          │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 設定ファイル                                      │   │
│  │  - docker-compose.server.yml                    │   │
│  │  - apps/api/.env                                │   │
│  │  - apps/web/.env                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│         Raspberry Pi 4/3 (クライアント)                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Docker Compose (docker-compose.client.yml)      │   │
│  │  - NFC Agent (Python + SQLite)                 │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 設定ファイル                                      │   │
│  │  - docker-compose.client.yml                    │   │
│  │  - clients/nfc-agent/.env                       │   │
│  │  - infrastructure/ansible/inventory.yml          │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ハードウェア                                      │   │
│  │  - NFCリーダー (Sony RC-S300/S1)                │   │
│  │  - USBカメラ (C270 HD WEBCAM)                   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ systemdサービス                                  │   │
│  │  - signage-lite.service                         │   │
│  │  - kiosk-browser.service                        │   │
│  │  - status-agent.service                         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Ansibleで管理できる範囲

#### ✅ 1. コード・設定ファイルの更新

**管理対象**:
- Gitリポジトリ全体（`/opt/RaspberryPiSystem_002`）
- Docker Composeファイル（`docker-compose.server.yml`、`docker-compose.client.yml`）
- Ansibleプレイブック（`infrastructure/ansible/playbooks/*.yml`）
- インベントリファイル（`infrastructure/ansible/inventory.yml`）

**Ansibleでの更新方法**:
```yaml
# プレイブックで自動実行
- name: Sync repository to desired state
  ansible.builtin.git:
    repo: "{{ repo_remote }}"
    dest: "{{ repo_path }}"
    version: "{{ repo_version }}"
    force: true
```

**従来の手動操作**: 各端末で `git pull` → **不要**

#### ✅ 2. 環境変数ファイルの更新

**管理対象**:
- `apps/api/.env`
- `apps/web/.env`
- `clients/nfc-agent/.env`
- `infrastructure/docker/.env`

**Ansibleでの更新方法**:
```yaml
# プレイブックに追加可能
- name: Update environment variables
  ansible.builtin.template:
    src: templates/api.env.j2
    dest: /opt/RaspberryPiSystem_002/apps/api/.env
    owner: "{{ ansible_user }}"
    group: "{{ ansible_user }}"
    mode: '0600'
```

**従来の手動操作**: 各端末で `.env` を編集 → **Ansibleで自動化可能**

#### ✅ 3. Docker Composeの更新・再起動

**管理対象**:
- Docker Composeサービスの再ビルド・再起動
- コンテナの状態確認

**Ansibleでの更新方法**:
```yaml
# プレイブックに追加可能
- name: Restart Docker Compose services
  ansible.builtin.shell: |
    cd {{ repo_path }}/infrastructure/docker
    docker compose -f docker-compose.server.yml up -d --build
  args:
    executable: /bin/bash
```

**従来の手動操作**: 各端末で `docker compose up -d --build` → **Ansibleで自動化可能**

#### ✅ 4. systemdサービスの管理

**管理対象**:
- `signage-lite.service`
- `kiosk-browser.service`
- `status-agent.service`
- `status-agent.timer`

**Ansibleでの更新方法**:
```yaml
# 既に実装済み
- name: Restart required services
  ansible.builtin.systemd:
    name: "{{ item }}"
    state: restarted
    daemon_reload: true
  loop: "{{ services_to_restart }}"
  ignore_errors: true
```

**従来の手動操作**: 各端末で `sudo systemctl restart <service>` → **不要**

#### ✅ 5. データベースマイグレーション

**管理対象**:
- PostgreSQLのマイグレーション（Prisma）
- SQLiteのスキーマ更新（NFCエージェント）

**Ansibleでの更新方法**:
```yaml
# プレイブックに追加可能
- name: Run database migrations
  ansible.builtin.shell: |
    cd {{ repo_path }}/apps/api
    docker compose -f ../../infrastructure/docker/docker-compose.server.yml \
      exec -T api pnpm prisma migrate deploy
  args:
    executable: /bin/bash
```

**従来の手動操作**: 各端末でマイグレーション実行 → **Ansibleで自動化可能**

### 直接操作が必要な場面（Ansibleでは管理できない）

#### ❌ 1. 初回セットアップ

**理由**: SSH接続が確立されていない、Ansibleがインストールされていない

**必要な操作**:
- Raspberry Piに直接キーボード・マウスを接続
- SSH接続の設定
- Ansibleのインストール
- SSH鍵の設定

**頻度**: 新規端末追加時のみ（1回限り）

#### ❌ 2. ハードウェアの物理的な問題

**理由**: ハードウェアの故障や接続不良はAnsibleでは解決できない

**必要な操作**:
- NFCリーダーの接続確認（`lsusb`、`pcsc_scan`）
- USBカメラの接続確認（`lsusb`、`v4l2-ctl --list-devices`）
- ケーブルの交換
- ハードウェアの交換

**頻度**: 故障時のみ

**Ansibleでの確認は可能**:
```yaml
# ハードウェアの存在確認はAnsibleで可能
- name: Check NFC reader connection
  ansible.builtin.shell: lsusb | grep -i sony
  register: nfc_check
  failed_when: false

- name: Check USB camera connection
  ansible.builtin.shell: lsusb | grep -i camera
  register: camera_check
  failed_when: false
```

#### ❌ 3. ネットワーク設定の変更

**理由**: IPアドレス変更時はSSH接続が切れる可能性がある

**必要な操作**:
- Wi-Fi設定の変更（`raspi-config`、`nmcli`）
- 静的IPアドレスの設定
- ネットワーク設定ファイルの編集（`/etc/dhcpcd.conf`、`/etc/network/interfaces`）

**頻度**: ネットワーク構成変更時のみ

**Ansibleでの更新は可能（接続が確立している場合）**:
```yaml
# ネットワーク設定の更新はAnsibleで可能（接続が確立している場合）
- name: Update network configuration
  ansible.builtin.template:
    src: templates/dhcpcd.conf.j2
    dest: /etc/dhcpcd.conf
  notify: restart networking
```

#### ❌ 4. 緊急時のデバッグ

**理由**: システムが完全に停止している場合、Ansibleでは接続できない

**必要な操作**:
- 直接端末に接続してログ確認（`journalctl`、`docker logs`）
- システムの状態確認（`systemctl status`、`docker ps`）
- 緊急時の復旧作業

**頻度**: 緊急時のみ

**Ansibleでの確認は可能（接続が確立している場合）**:
```yaml
# ログ確認はAnsibleで可能
- name: Collect system logs
  ansible.builtin.shell: |
    journalctl -u {{ item }} -n 100 --no-pager
  loop: "{{ services_to_check }}"
  register: service_logs
```

#### ❌ 5. セキュリティ設定の変更

**理由**: SSH接続に影響する設定変更は慎重に行う必要がある

**必要な操作**:
- SSH設定の変更（`/etc/ssh/sshd_config`）
- ファイアウォール設定（`ufw`、`iptables`）
- ユーザー権限の変更

**頻度**: セキュリティポリシー変更時のみ

**Ansibleでの更新は可能（接続が確立している場合）**:
```yaml
# SSH設定の更新はAnsibleで可能（接続が確立している場合）
- name: Update SSH configuration
  ansible.builtin.template:
    src: templates/sshd_config.j2
    dest: /etc/ssh/sshd_config
  notify: restart ssh
```

### まとめ：Ansibleで管理できる範囲

| 項目 | Ansibleで管理可能 | 直接操作が必要 | 備考 |
|------|------------------|----------------|------|
| **コード更新** | ✅ | ❌ | Gitリポジトリの更新は完全自動化 |
| **設定ファイル更新** | ✅ | ❌ | `.env`、`docker-compose.yml`など |
| **Docker Compose更新** | ✅ | ❌ | コンテナの再ビルド・再起動 |
| **systemdサービス管理** | ✅ | ❌ | サービスの再起動・状態確認 |
| **データベースマイグレーション** | ✅ | ❌ | Prisma、SQLiteのマイグレーション |
| **初回セットアップ** | ❌ | ✅ | SSH接続確立前は不可 |
| **ハードウェア故障** | ❌ | ✅ | 物理的な問題は直接対応が必要 |
| **ネットワーク設定変更** | ⚠️ | ⚠️ | 接続が確立している場合は可能 |
| **緊急時のデバッグ** | ⚠️ | ⚠️ | 接続が確立している場合は可能 |
| **セキュリティ設定変更** | ⚠️ | ⚠️ | 接続が確立している場合は可能 |

### 推奨される運用フロー

#### 日常的な更新（Ansibleで自動化）

```bash
# Macから1コマンドで全端末を更新
ssh denkon5sd02@192.168.128.131 "cd /opt/RaspberryPiSystem_002 && \
  ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml"
```

**自動実行される内容**:
1. Gitリポジトリの更新
2. 設定ファイルの更新（`.env`、`docker-compose.yml`など）
3. Docker Composeの再ビルド・再起動
4. systemdサービスの再起動
5. データベースマイグレーション

#### 直接操作が必要な場面

1. **新規端末の追加**: 初回セットアップ時のみ
2. **ハードウェア故障**: 故障時のみ
3. **ネットワーク設定変更**: 構成変更時のみ
4. **緊急時のデバッグ**: システム停止時のみ

### 結論

**Ansibleで管理できる範囲は非常に広い**です。コード更新、設定ファイル更新、Docker Compose更新、systemdサービス管理、データベースマイグレーションなど、**日常的な更新作業のほとんどはAnsibleで自動化できます**。

**直接端末にキーボードを繋げて操作する場面は、以下の場合に限られます**：

1. **初回セットアップ時**: SSH接続確立前
2. **ハードウェア故障時**: 物理的な問題の解決
3. **緊急時のデバッグ**: システムが完全に停止している場合
4. **ネットワーク設定変更時**: IPアドレス変更など（ただし、接続が確立している場合はAnsibleでも可能）

**日常的な運用では、直接操作はほとんど不要**です。Ansibleで自動化された更新フローを使用することで、効率的にシステムを管理できます。

---

## Ansibleについて：なぜデファクトスタンダードなのか

### Ansibleとは

**Ansible**は、**構成管理・自動化ツール**（Configuration Management / Automation Tool）です。2012年にRed Hatが開発し、現在はRed Hat（IBM）がサポートしています。

### なぜデファクトスタンダードなのか

#### 1. 業界での採用実績

| 企業・組織 | 用途 |
|-----------|------|
| **NASA** | 宇宙ミッションのインフラ管理 |
| **Netflix** | 数千台のサーバー管理 |
| **Cisco** | ネットワーク機器の設定管理 |
| **GitHub** | 開発環境の自動化 |
| **多くの企業** | クラウドインフラ、オンプレミスサーバーの管理 |

**採用理由**: 大規模なインフラ管理でも安定して動作し、学習コストが低い

#### 2. 技術的な優位性

| 特徴 | 説明 | メリット |
|------|------|---------|
| **エージェントレス** | クライアント側に専用ソフトをインストール不要 | セットアップが簡単、リソース消費が少ない |
| **SSHベース** | 既存のSSH接続を利用 | 追加のポート開放やファイアウォール設定が不要 |
| **YAML記述** | 設定ファイルが読みやすい | 非エンジニアでも理解しやすい |
| **冪等性** | 何度実行しても同じ結果 | 安全に再実行できる |
| **並列実行** | 複数サーバーを同時に操作 | 大規模環境でも高速 |

#### 3. 類似ツールとの比較

| ツール | 特徴 | 難易度 | 採用例 |
|--------|------|--------|--------|
| **Ansible** | エージェントレス、YAML記述 | ★★☆☆☆ | **最も広く採用** |
| **Chef** | エージェント必要、Ruby記述 | ★★★★☆ | 大規模企業 |
| **Puppet** | エージェント必要、独自言語 | ★★★☆☆ | エンタープライズ |
| **Terraform** | インフラ構築特化 | ★★★☆☆ | クラウド環境 |

**Ansibleが選ばれる理由**: 学習コストが低く、小規模から大規模まで対応できる

### このプロジェクトでAnsibleを採用した理由

#### 1. 問題の解決

**問題**: 数十台のRaspberry Piを手動で更新するのは非効率

**解決策**: Ansibleで1コマンドで全端末を更新

```bash
# 従来: 各端末に個別にSSH接続して更新（時間がかかる）
ssh pi@192.168.128.102 "cd /opt/RaspberryPiSystem_002 && git pull"
ssh pi@192.168.128.152 "cd /opt/RaspberryPiSystem_002 && git pull"
# ... 数十台分繰り返し

# Ansible: 1コマンドで全端末を更新（数分で完了）
ansible-playbook -i inventory.yml playbooks/update-clients.yml
```

#### 2. 将来の拡張性

- **台数増加に対応**: インベントリファイルに追加するだけ
- **グループ管理**: 建物別、種類別にグループ化可能
- **ロールバック**: 更新失敗時の自動ロールバックも実装可能

#### 3. 運用の安定性

- **冪等性**: 何度実行しても同じ結果（安全）
- **エラーハンドリング**: 失敗した端末を特定可能
- **ログ記録**: 更新履歴を自動的に記録

### Ansibleの主な用途

#### 1. 構成管理（Configuration Management）

複数サーバーの設定を統一管理：

```yaml
# 例: 全サーバーに同じパッケージをインストール
- name: Install required packages
  apt:
    name:
      - git
      - curl
      - python3
    state: present
```

#### 2. アプリケーションデプロイメント（Application Deployment）

コードの更新とサービスの再起動：

```yaml
# 例: Gitリポジトリを更新してサービスを再起動
- name: Pull latest code
  git:
    repo: https://github.com/example/repo.git
    dest: /opt/app

- name: Restart service
  systemd:
    name: app.service
    state: restarted
```

#### 3. オーケストレーション（Orchestration）

複数サーバーを連携させた操作：

```yaml
# 例: ロードバランサーを停止 → アプリ更新 → ロードバランサー再開
- name: Stop load balancer
  systemd:
    name: nginx.service
    state: stopped

- name: Update application
  git:
    repo: ...
    dest: /opt/app

- name: Start load balancer
  systemd:
    name: nginx.service
    state: started
```

#### 4. クラウドプロビジョニング（Cloud Provisioning）

クラウド環境の自動構築：

```yaml
# 例: AWS EC2インスタンスを作成
- name: Create EC2 instance
  ec2_instance:
    name: web-server
    image_id: ami-12345678
    instance_type: t2.micro
```

### このプロジェクトでのAnsibleの役割

| 用途 | 実装内容 | 効果 |
|------|---------|------|
| **一括更新** | 全クライアントのGitリポジトリを更新 | 手動作業時間を90%削減 |
| **サービス管理** | 各クライアントのサービスを再起動 | 人為的ミスを防止 |
| **設定管理** | 各クライアントの設定を統一 | 設定の不整合を防止 |
| **エラー追跡** | 更新失敗を自動検出 | 問題の早期発見 |

### まとめ

**Ansibleは、このような用途のデファクトスタンダードです**：

1. **業界標準**: NASA、Netflix、GitHubなど多くの企業が採用
2. **技術的優位性**: エージェントレス、SSHベース、YAML記述で学習コストが低い
3. **実用性**: 小規模から大規模まで対応、冪等性で安全
4. **必要性**: 複数サーバーの管理には不可欠なツール

**このプロジェクトでも、Ansibleなしでは数十台のRaspberry Piを効率的に管理できません**。手動更新では時間がかかり、人為的ミスも発生します。Ansibleを使うことで、1コマンドで全端末を更新でき、運用効率が大幅に向上します。

---

## 参考資料

- [Ansible Documentation](https://docs.ansible.com/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
- [SSH Key Authentication](https://www.ssh.com/academy/ssh/public-key-authentication)
- [Ansible公式サイト](https://www.ansible.com/)
- [Ansible GitHub](https://github.com/ansible/ansible)

- [Ansible Documentation](https://docs.ansible.com/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
- [SSH Key Authentication](https://www.ssh.com/academy/ssh/public-key-authentication)
