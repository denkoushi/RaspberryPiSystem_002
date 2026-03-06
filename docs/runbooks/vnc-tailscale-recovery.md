# RealVNC接続不可時の復旧手順（Tailscale ACL）

**対象**: MacからRealVNC ViewerでPi5/Pi4/Pi3に接続できない場合

**想定事象**: Pi5は繋がるがPi4/Pi3が繋がらない（または全端末繋がらない）

---

## 1. 採用方式（Pi5経由SSHトンネル）

**方針**: `admin -> server` を唯一の入口に固定し、Pi4/Pi3へは **Mac→Pi5のSSHトンネル経由** で接続する。

- **採用**: `tag:server -> tag:kiosk/signage: tcp:5900` を許可（Pi5からPi4/Pi3へのVNC）
- **不採用**: `tag:admin -> tag:kiosk/signage: tcp:5900` の直接許可（攻撃面拡大を避ける）
- **運用**: MacからVNC接続するたびにSSHトンネルを張る（永続化しない）

---

## 2. 原因の切り分け

| 症状 | 想定原因 |
|------|----------|
| Pi5のみ繋がる、Pi3は繋がらない | Tailscale ACLで`tag:server -> tag:signage: tcp:5900`が未許可、またはPi3のVNC未起動 |
| Pi5のみ繋がる、Pi4は繋がらない | Tailscale ACLで`tag:server -> tag:kiosk: tcp:5900`が未許可、Pi4がoffline、またはVNC未起動 |
| 全端末繋がらない | Tailscale ACLで`tag:admin -> tag:server: tcp:5900`も未許可、またはTailscale/ネットワーク障害 |
| 特定端末のみ繋がらない | 該当端末のVNCサービス未起動、UFWブロック、Tailscaleオフライン |

---

## 3. 復旧手順

### 3.1 Tailscale ACLの更新

1. https://login.tailscale.com にログイン
2. **Access controls** → **Edit policy file** を開く
3. `grants`配列に以下が含まれているか確認。不足時は追加:

```json
{
  "src": ["tag:admin"],
  "dst": ["tag:server"],
  "ip": ["tcp:22", "tcp:443", "tcp:5900"]
},
{
  "src": ["tag:kiosk", "tag:signage"],
  "dst": ["tag:server"],
  "ip": ["tcp:443"]
},
{
  "src": ["tag:server"],
  "dst": ["tag:kiosk", "tag:signage"],
  "ip": ["tcp:22"]
},
{
  "src": ["tag:server"],
  "dst": ["tag:kiosk"],
  "ip": ["tcp:5900"]
},
{
  "src": ["tag:server"],
  "dst": ["tag:signage"],
  "ip": ["tcp:5900"]
}
```

4. **Save** して約30秒待つ

### 3.2 端末状態の確認（Pi5で実行）

```bash
tailscale status
```

- Pi4/Pi3が `offline` の場合は、まず端末の電源・ネットワーク・Tailscale復旧を行う

### 3.3 Pi5経由で5900到達確認（Pi5で実行）

```bash
nc -vz -w 3 <Pi4_研削メイン_IP> 5900
nc -vz -w 3 <Pi3_IP> 5900
nc -vz -w 3 <Pi4_RoboDrill01_IP> 5900
# Connection succeeded が表示されればOK
```

**2026-03-06実測のTailscale IP**（`tailscale status`で要確認）:

| 端末 | ホスト名 | Tailscale IP |
|------|----------|--------------|
| Pi4 研削メイン | raspberrypi-1 | 100.74.144.79 |
| Pi3 サイネージ | raspberrypi-2 | 100.105.224.86 |
| Pi4 RoboDrill01 | raspi4-robodrill01 | 100.123.1.113 |

### 3.4 MacでSSHトンネルを張る

```bash
# Macで実行（接続中はターミナルを開いたまま）
ssh -N \
  -L 5904:100.74.144.79:5900 \
  -L 5905:100.123.1.113:5900 \
  -L 5903:100.105.224.86:5900 \
  denkon5sd02@100.106.158.2
```

**注意**: IPは環境により変わる。`tailscale status`（Pi5で実行）で最新のIPを確認すること。

### 3.5 RealVNC Viewerで接続

| 端末 | 接続先 |
|------|--------|
| Pi5 | `100.106.158.2:5900`（直接） |
| Pi4 研削メイン | `localhost:5904`（トンネル経由） |
| Pi4 RoboDrill01 | `localhost:5905`（トンネル経由） |
| Pi3 | `localhost:5903`（トンネル経由） |

**運用**: VNC接続するたびに 3.4 のSSHトンネルを実行する。永続化はしない（セキュリティ方針）。

---

## 4. それでも繋がらない場合

| 確認項目 | 手順 |
|---------|------|
| Tailscale接続 | `tailscale status`（Pi5で実行）。Pi4/Pi3が`offline`なら端末復旧を先に |
| VNCサービス | Pi5経由でSSH→Pi4/Pi3し、`systemctl status wayvnc` または `systemctl status vncserver-x11-serviced` |
| UFW（Pi4/Pi3） | Pi4/Pi3でUFW有効時は `100.64.0.0/10` からの5900を許可する必要あり |

---

## 5. 関連ドキュメント

- [mac-ssh-access.md](../guides/mac-ssh-access.md): Pi5/Pi4/Pi3のVNC接続手順
- [KB-277](../knowledge-base/infrastructure/security.md#kb-277-tailscale経由でのvnc接続問題acl設定不足): Pi5のVNC接続問題
- [KB-293](../knowledge-base/infrastructure/security.md#kb-293-pi4pi3のrealvnc接続復旧pi5経由sshトンネル方式): Pi4/Pi3の復旧（本手順）
- [tailscale-policy.md](../security/tailscale-policy.md): Tailscale ACLポリシー雛形
