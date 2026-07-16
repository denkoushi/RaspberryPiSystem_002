# Pi3 サイネージ復旧 Runbook（Tailscale / signage-lite）

**対象**: Raspberry Pi 3 サイネージ（`raspberrypi3` / Tailscale `raspberrypi-2` / `tag:signage`）

**関連**: [KB-386](../knowledge-base/infrastructure/signage.md#kb-386-pi3サイネージ非表示tailscale-key-expiryとネットワーク経路) · [ラズパイ3（サイネージ）の更新](../archive/deployments/legacy-operator-guide-through-2026-07.md#ラズパイ3サイネージの更新) · [signage-client-setup.md](../guides/signage-client-setup.md)

---

## 1. 症状の切り分け

| 症状 | 想定原因 |
|------|----------|
| **デスクトップのみ**（全画面 JPEG なし） | `signage-lite` / `feh` 未起動、または `/run/signage/current.jpg` 未取得 |
| Tailscale 管理画面で **Expired** | **Key expiry**（定期失効・仕様） |
| Pi5 から SSH 不可 | 上記に伴う tailnet 切断 |
| Pi5 の `current-image` は **200** | **Pi3 クライアント側**の問題（サーバは正常） |

**前提**: Pi3 は Pi5 API を **`https://100.106.158.2/api/signage/current-image`**（Tailscale）で取得する。Pi5（`192.168.10.x`）と Pi3 工場 LAN（`192.168.128.x`）は **直結しない** ため、Tailscale 不通時は LAN 迂回できない。

---

## 2. Pi5 からの確認（リモート）

```bash
# Mac または Pi5 操作端末
ssh denkon5sd02@100.106.158.2

# Tailscale
tailscale ping -c 2 100.105.224.86
tailscale status | grep raspberrypi-2

# サーバ側 JPEG（Pi3 キー）
curl -k -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "x-client-key: client-key-raspberrypi3-signage1" \
  https://127.0.0.1/api/signage/current-image

# Ansible（リポジトリ on Pi5）
cd /opt/RaspberryPiSystem_002
ansible raspberrypi3 -i infrastructure/ansible/inventory.yml -m ping -o
```

| 結果 | 意味 |
|------|------|
| ping **pong** + Ansible **SUCCESS** | Pi5 から Pi3 に入れる → [§4 リモート復旧](#4-リモート復旧pi5-経由) |
| **Expired** / ping timeout | Pi3 現場操作が必要 → [§3 現場復旧](#3-現場復旧pi3-本体) |

---

## 3. 現場復旧（Pi3 本体）

### 3.1 管理画面（管理者）

1. [Tailscale Machines](https://login.tailscale.com/admin/machines) で **`raspberrypi-2`** を開く
2. 状態が **Expired** の場合:
   - **`...` → Temporarily extend key**（約 30 分の再接続窓）
   - 恒久対策: **`Disable key expiry`**（常時稼働サイネージ推奨）

**注意**: Extend key **だけ**ではサイネージは復旧しない。Pi3 側で再認証が必要なことが多い。

### 3.2 Pi3 で実行（キーボード or 同一 LAN から SSH）

表示用 HDMI にデスクトップが出ていれば **USB キーボードのみ**で可。

```bash
# 再認証（tag:signage）
sudo tailscale up --advertise-tags=tag:signage --force-reauth

# うまくいかない場合
sudo systemctl restart tailscaled
sleep 3
sudo tailscale up --advertise-tags=tag:signage --reset
```

ブラウザで表示された URL を承認後:

```bash
tailscale ping -c 2 100.106.158.2

curl -k -s -o /tmp/t.jpg -w "HTTP %{http_code}\n" \
  -H "x-client-key: client-key-raspberrypi3-signage1" \
  "https://100.106.158.2/api/signage/current-image"

sudo /usr/local/bin/signage-update.sh
sudo systemctl restart signage-lite.service
sudo systemctl enable --now signage-lite-update.timer

systemctl is-active signage-lite.service
pgrep -a feh
ls -lh /run/signage/current.jpg
```

### 3.3 同一 LAN から SSH（キーボード不要の場合）

ノート PC が **`192.168.128.x`** にいる場合:

```bash
ssh signageras3@192.168.128.152
# 以降は 3.2 と同じ
```

---

## 4. リモート復旧（Pi5 経由）

SSH が通る場合:

```bash
ssh denkon5sd02@100.106.158.2
ssh signageras3@100.105.224.86

sudo /usr/local/bin/signage-update.sh
sudo systemctl restart signage-lite.service
systemctl is-active signage-lite.service
```

または Ansible:

```bash
cd /opt/RaspberryPiSystem_002
ansible raspberrypi3 -i infrastructure/ansible/inventory.yml -b -m shell \
  -a '/usr/local/bin/signage-update.sh && systemctl restart signage-lite.service'
```

### 4.1 自動監視（Pi5 常駐）

リポジトリ: **`scripts/ops/recover-pi3-signage-remote.sh`**

Pi5 で SSH 復帰を 30 秒間隔で待ち、復旧後に `signage-lite` を再起動する。

```bash
# Pi5 上（例）
LOG_FILE=$HOME/recover-pi3-signage.log \
  nohup /opt/RaspberryPiSystem_002/scripts/ops/recover-pi3-signage-remote.sh \
  >> $HOME/recover-pi3-signage.log 2>&1 &
tail -f $HOME/recover-pi3-signage.log
```

---

## 5. 再発防止チェックリスト

- [ ] Tailscale: サイネージ・キオスク・サーバで **`Disable key expiry`**（2026-06-04 全端末適用済みならスキップ可）
- [ ] 現場設置後: 管理画面で **`raspberrypi-2` Online**
- [ ] モニター: **全画面サイネージ**（デスクトップのみではない）
- [ ] 定期: `./scripts/deploy/verify-phase12-real.sh`（Pi3 `signage-lite` 含む）

---

## 6. 関連ドキュメント

- [vnc-tailscale-recovery.md](./vnc-tailscale-recovery.md)（Tailscale 復旧**後**の VNC・Pi5 経由トンネル）
- [KB-384 / KB-385](../knowledge-base/infrastructure/security.md)（Pi4 キオスク / Pi5 NeedsLogin）
