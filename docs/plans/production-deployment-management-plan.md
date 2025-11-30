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

## 参考資料

- [Ansible Documentation](https://docs.ansible.com/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
- [SSH Key Authentication](https://www.ssh.com/academy/ssh/public-key-authentication)
