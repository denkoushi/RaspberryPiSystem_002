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
- Related KB
  - `docs/knowledge-base/infrastructure/ansible-deployment.md`

