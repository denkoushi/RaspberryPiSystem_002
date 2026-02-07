---
title: トラブルシューティングナレッジベース - Ansible/デプロイ性能（調査）
tags: [トラブルシューティング, インフラ, Ansible, デプロイ, パフォーマンス]
audience: [開発者, 運用者]
last-verified: 2026-02-07
related:
  - ../index.md
  - ../../guides/deployment.md
  - ./ansible-deployment.md
category: knowledge-base
update-frequency: high
---

# トラブルシューティングナレッジベース - Ansible/デプロイ性能（調査）

**カテゴリ**: インフラ関連 > Ansible/デプロイ（性能）  
**件数**: 1件  
**索引**: [index.md](../index.md)

---

### [KB-234] Ansibleデプロイが遅い（段階展開/重複タスク/計測欠如の整理と暫定対策）

**発生日**: 2026-02-07（継続調査中）

**前提条件（絶対）**:
- 速くすることが目的だが、**デプロイが正確に安全に過不足なく実行されること**が前提
- この前提条件が低下する変更は許容しない

**事象**:
- Pi4/Pi5のデプロイが遅い（特に将来Pi4が20台規模に増えたときに、現状の逐次デプロイでは時間が伸びる）
- デプロイの一部が「実態と合っていない」（例: `pnpm`が存在しない端末で`pnpm install`タスクが実行され、しかも失敗が隠れる）
- カナリア（1台→成功後に全台）運用をしたいが、仕組みが支えきれていない（ヘルスチェックが全台走る等）
- 計測が弱く「何が何秒」かが確定しづらい

---

#### Investigation（仮説→検証→結果）

**H1: デプロイが逐次（1台ずつ）固定になっている**  
- 検証: `deploy.yml` を確認  
- 結果: **CONFIRMED**  
  - `serial: 1` により `forks` を上げても逐次で進む

**H2: “重複タスク”が存在し無駄に時間が伸びている**  
- 検証: 過去のAnsible実行ログを確認（Pi3/Pi4で同名タスクが2回登場）  
- 結果: **CONFIRMED**  
  - kiosk疎通チェックが2回
  - Pi3で`pnpm install`が2回

**H3: `pnpm install`が端末実態と合わず、正確性/安全性も損なう**  
- 検証:
  - Pi3/Pi4実機で`pnpm`の存在を確認（`command -v pnpm`）
  - signage-liteのunit/templateを確認（実行方式）
- 結果: **CONFIRMED**
  - Pi3/Pi4とも`pnpm`が存在しないケースがある
  - Pi3のsignage-liteは**feh + shell script**で動作し、`pnpm`依存ではない
  - `failed_when: false`で失敗が隠れるため「成功に見えるが必要な作業が実行されない」状態を作り得る

**H4: Tailscaleのインストールが毎回走り得て遅い**  
- 検証:
  - `common/tasks/tailscale.yml` を確認
  - ログ上で `Install Tailscale package` が毎回 `ok` になっていることを確認
- 結果: **CONFIRMED（設計面）**
  - `creates:` が効かず、インストールスクリプトが毎回実行され得る状態だった

**H5: カナリア運用時に、ヘルスチェックが全台分走って時間が伸びる**  
- 検証: `scripts/update-all-clients.sh` の health-check 呼び出しを確認  
- 結果: **CONFIRMED**
  - デプロイに `--limit` を付けても、health-check 側には伝搬していなかった

**H6: Pi3が到達不能（IP変更/オフライン等）で調査やデプロイが遅く見える**  
- 検証: Pi5の`tailscale status`でpeerを確認  
- 結果: **CONFIRMED**
  - Pi3の到達先IPが変わっており、旧IPへのSSHがタイムアウトしていた

---

#### Fix（ここまでの“暫定対策”・安全性を落とさない範囲）

**1) 段階展開の土台（カナリア→全台）**
- inventoryをグルーピング（`kiosk`/`signage` + `*_canary`）して、`--limit`運用を安全に
  - `infrastructure/ansible/inventory.yml`
- デプロイPlaybookを分割し、**Pi4は並行（kiosk play）**、**Pi3は単独（signage play: serial=1）**に
  - 追加: `infrastructure/ansible/playbooks/deploy-staged.yml`
  - 既存入口: `infrastructure/ansible/playbooks/update-clients.yml` は `deploy-staged.yml` を参照

**2) ヘルスチェックが `--limit` に追従**
- `scripts/update-all-clients.sh` の post-deploy health-check に `--limit` を伝搬

**3) “実態と合わないpnpm install” を排除/無害化**
- `infrastructure/ansible/tasks/update-clients-core.yml` から `pnpm install` を削除
- `infrastructure/ansible/roles/signage/tasks/main.yml` の `pnpm install` をデフォルト無効に（必要な場合のみ明示ON）

**4) Tailscale再インストールを抑止（未インストール時のみ）**
- `infrastructure/ansible/roles/common/tasks/tailscale.yml` で `tailscaled --version` を事前チェックし、未インストール時のみ実行

---

#### Prevention / Next（再発防止・次の調査）

**計測（必須）**:
- `ANSIBLE_CALLBACKS_ENABLED=profile_tasks,timer` を使い、「何が何秒」かをログで確定する
- カナリア（`--limit "server:kiosk_canary"`）で1回だけ計測し、支配的なボトルネックを特定してから全体へ広げる

#### 計測結果（profile_tasks/timer）

**実行**:
- **日時**: 2026-02-07
- **ブランチ**: `feat/signage-visualization-layout-improvement`
- **limit**: `server:kiosk_canary`（Pi5 + Pi4 1台）
- **runId**: `20260207-173545-16604`
- **結果**: **success（exit=0）**
- **所要時間**: **6分34秒**

**TASKS RECAP（上位）**:
- `server : Rebuild/Restart docker compose services` **181.23s**
- `server : Install security packages` **13.70s**
- `kiosk : Install ClamAV on kiosk` **12.86s**
- `kiosk : Install rkhunter on kiosk` **5.48s**
- `common : Check systemd service files to back up` **4.28s**
- `server : Run prisma migrate deploy` **4.03s**
- `Verify required signage role template files exist` **4.03s**

**改善後（docker build判定導入後の再計測）**:
- **日時**: 2026-02-07
- **ブランチ**: `feat/signage-visualization-layout-improvement`
- **limit**: `server:kiosk_canary`（Pi5 + Pi4 1台）
- **runId**: `20260207-183219-7788`
- **結果**: **success（exit=0）**
- **所要時間**: **3分11秒**

**TASKS RECAP（上位）**:
- `kiosk : Install ClamAV on kiosk` **5.67s**
- `kiosk : Install rkhunter on kiosk` **5.61s**
- `server : Install security packages` **4.46s**
- `common : Check systemd service files to back up` **4.30s**
- `Verify required signage role template files exist` **4.01s**

**改善後（apt cache_valid_time適用後の再計測）**:
- **日時**: 2026-02-07
- **ブランチ**: `feat/signage-visualization-layout-improvement`
- **limit**: `server:kiosk_canary`（Pi5 + Pi4 1台）
- **runId**: `20260207-191713-14804`
- **結果**: **success（exit=0）**
- **所要時間**: **3分15秒**

**TASKS RECAP（上位）**:
- `kiosk : Install ClamAV on kiosk` **6.31s**
- `kiosk : Install rkhunter on kiosk` **5.52s**
- `server : Install security packages` **4.51s**
- `server : Install ClamAV packages` **2.99s**
- `server : Install rkhunter` **2.92s**

**ロールアウト（apt cache_valid_time適用後）**:
- **日時**: 2026-02-07
- **ブランチ**: `feat/signage-visualization-layout-improvement`
- **limit**: `server:kiosk:!kiosk_canary`（Pi5のみ、Pi4は0台）
- **runId**: `20260207-193749-16987`
- **結果**: **success（exit=0）**
- **所要時間**: **1分17秒**

**TASKS RECAP（上位）**:
- `Verify required signage role template files exist` **3.97s**
- `server : Install security packages` **3.46s**
- `server : Configure UFW default incoming policy` **3.22s**
- `server : Install ClamAV packages` **2.92s**
- `server : Configure UFW default outgoing policy` **2.91s**
- `server : Run prisma migrate deploy` **2.85s**
- `server : Install rkhunter` **2.84s**

**改善後（cronスキップ適用後の再計測）**:
- **日時**: 2026-02-07
- **ブランチ**: `feat/signage-visualization-layout-improvement`
- **limit**: `server:kiosk_canary`（Pi5 + Pi4 1台）
- **runId**: `20260207-200055-30275`
- **結果**: **success（exit=0）**
- **所要時間**: **3分13秒**

**TASKS RECAP（上位）**:
- `kiosk : Install ClamAV on kiosk` **5.78s**
- `kiosk : Install rkhunter on kiosk` **5.78s**
- `server : Install security packages` **5.42s**
- `common : Check systemd service files to back up` **4.35s**
- `Verify required signage role template files exist` **3.97s**

**cronスキップ確認**:
- `server : Schedule ClamAV scan cron` → **skipping**
- `server : Schedule rkhunter scan cron` → **skipping**
- `kiosk : Schedule kiosk ClamAV scan` → **skipping**
- `kiosk : Schedule kiosk rkhunter scan` → **skipping**

**Before / After**:
- **6分34秒 → 3分11秒（約3分23秒短縮）**（Docker build最適化）
- `server : Rebuild/Restart docker compose services` が **TASKS RECAPから消失**（実行スキップ）
- **apt cache最適化**: `cache_valid_time`適用により、同一デプロイ内の重複`apt update`が抑制され、apt関連タスクが若干短縮（例: `server : Install security packages` 4.51s → 3.46s）
 - **cronスキップ**: スクリプト未変更時はcron再設定をスキップ（ログでskippingを確認）

**示唆（次に削るべき“主犯”）**:
- **Docker composeの`--build`が支配的**（約3分）。変更がドキュメント/Ansibleのみの時にまで毎回ビルドしていると、Pi4が増えた際の全体時間が伸びる。
- 次点は **セキュリティ系（ClamAV/rkhunter/apt系）**。`update_cache`の頻度・必要性の見直し（例: `cache_valid_time`）で短縮余地がある。
  - `cache_valid_time`適用後も、**インストール自体の時間**が上位に残るため、次の短縮は「インストール頻度」「対象パッケージの見直し」が焦点になる。

**最終判断ルール（build必要判定）**:
- 差分に以下が含まれる場合は **build必要**:
  - `apps/api/**`, `apps/web/**`, `packages/**`
  - `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`
  - `infrastructure/docker/**`
  - `apps/api/prisma/**`
- 差分が取得できない場合は **安全側でbuild実行**（初回clone/HEAD不明など）
- 判定は `scripts/update-all-clients.sh` がログ出力し、`server_docker_build_needed` としてAnsibleへ渡す

**apt cache最適化（cache_valid_time適用）**:
- **実装日**: 2026-02-07
- **目的**: 同一デプロイ内で`apt update`が複数回実行される無駄を削減（安全性は維持）
- **実装内容**:
  - `group_vars/all.yml`に`apt_cache_valid_time_seconds: 3600`を追加
  - `ansible.builtin.apt`タスクに`cache_valid_time: "{{ apt_cache_valid_time_seconds | default(3600) }}"`を追加
  - `update_cache: true`は維持し、判定不能時は安全側で更新
  - 対象タスク: `kiosk/security.yml`（ClamAV/rkhunter）、`server/security.yml`（ufw/fail2ban）、`server/malware.yml`（ClamAV/rkhunter）
- **効果**:
  - カナリア: apt関連タスクが若干短縮（例: `server : Install security packages` 4.51s → 3.46s）
  - 同一デプロイ内で最初の`apt update`以降はキャッシュが有効（1時間以内）
- **学んだこと**:
  - `cache_valid_time`により、同一デプロイ内の重複`apt update`を抑制できる
  - `update_cache: true`を維持することで、判定不能時も安全側で更新される
  - インストール自体の時間は残るため、次の短縮は「インストール頻度」「対象パッケージの見直し」が焦点

**cronスキップ最適化（スクリプト変更検知）**:
- **実装日**: 2026-02-07
- **目的**: スクリプト未変更時のcron再設定をスキップし、無駄なタスク実行を削減
- **実装内容**:
  - `ansible.builtin.template` に `register` を追加
  - `ansible.builtin.cron` に `when: <register>.changed | default(true)` を追加
  - 対象タスク: `kiosk/security.yml`（ClamAV/rkhunter）、`server/malware.yml`（ClamAV/rkhunter）
- **効果**:
  - 変更なしの再デプロイでcron再設定が **skipping** になることを確認
  - 体感短縮は小さいが、ログノイズと冗長実行が減る

**運用メモ（今回つまずいた点）**:
- `100.x`（Tailscale）宛のSSHは、Mac側のTailscaleが停止しているとタイムアウトする（デプロイ前に接続状態を確認する）。
- 事前疎通チェックは、Pi5がブランチ更新する前のinventoryを参照するため、**新規追加したgroup（例: `kiosk_canary`）が見えない警告**が出得る（デプロイ本体は更新後inventoryで実行されるため致命ではない）。
- **ロールアウト時の注意**: `--limit "server:kiosk:!kiosk_canary"`でPi4が0台になる場合がある（カナリアのPi4のみがkioskグループに含まれている場合）。実際にはserver（Pi5）のみのデプロイになる可能性がある。

**運用（推奨コマンド例）**:
- カナリア: `--limit "server:kiosk_canary"`
- ロールアウト: `--limit "server:kiosk:!kiosk_canary"`
- Pi3単独: `--limit "server:signage"`

---

#### References
- Playbook/Inventory
  - `infrastructure/ansible/playbooks/deploy-staged.yml`
  - `infrastructure/ansible/playbooks/update-clients.yml`
  - `infrastructure/ansible/inventory.yml`
- Script
  - `scripts/update-all-clients.sh`
- Variables/Config
  - `infrastructure/ansible/group_vars/all.yml`（`apt_cache_valid_time_seconds`）
- Roles/Tasks
  - `infrastructure/ansible/roles/kiosk/tasks/security.yml`（apt cache_valid_time適用）
  - `infrastructure/ansible/roles/server/tasks/security.yml`（apt cache_valid_time適用）
  - `infrastructure/ansible/roles/server/tasks/malware.yml`（apt cache_valid_time適用）
- Related KB
  - [KB-235: Docker build最適化（変更ファイルに基づくbuild判定）](./ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定)
  - `docs/knowledge-base/infrastructure/ansible-deployment.md`

