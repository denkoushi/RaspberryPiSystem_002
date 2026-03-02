# KB-288: 電源操作・連打防止オーバーレイ不具合（power-actions バインドマウントの削除済み inode 参照）

**作成日**: 2026-03-01  
**状態**: ✅ 根本原因特定済み・恒久対策実装済み（2026-03-01）  
**関連**: [KB-investigation-kiosk-ime-and-power-regression.md](./KB-investigation-kiosk-ime-and-power-regression.md)

---

## Context

- **発生日**: 2026-03-01（raspi4-robodrill01 を Firefox に切り替え後のデプロイ後）
- **稼働環境**: Pi5（サーバー）+ raspi4-robodrill01（キオスク）
- **事象**: 電源操作（再起動/シャットダウン）が機能せず、連打防止オーバーレイも表示されない

---

## Investigation

### 症状

- `POST /kiosk/power` が **500** を返す
- エラーメッセージ: `ENOENT: no such file or directory, open '/app/power-actions/2026-03-01T10-27-11-382Z-client-key-raspi4-robodrill01-kiosk1.json'`

### 検証結果

| 検証 | 結果 |
|------|------|
| ホストで `power-actions` にファイル作成 | コンテナ内 `ls /app/power-actions/` は **空**（見えない） |
| コンテナ内 `cat /proc/self/mountinfo \| grep power-actions` | `.../power-actions//deleted` を確認 |
| コンテナ内 `touch /app/power-actions/test.json` | `No such file or directory` で失敗 |

---

## Root Cause

**API コンテナの `power-actions` バインドマウントが、削除・再作成された古いディレクトリの inode を参照している。**

### メカニズム

1. Docker のバインドマウントは、マウント時点のディレクトリ inode を参照する
2. Ansible の `file` タスク（`state: directory`）により、`power-actions` が削除・再作成された（所有権変更等のため）
3. 既に起動していた API コンテナは、**古い（削除済み）inode** への参照を保持
4. ホストの新しい `power-actions` は別 inode のため、コンテナからは見えない・書き込めない
5. `//deleted` は Linux の mountinfo で「削除済みマウントソース」を示す表記

### トリガー

- `--limit "server:raspi4-robodrill01"` で Pi4 のみデプロイした場合、**Pi5 の server ロールは実行されない**
- Pi5 の API コンテナは再起動されず、過去のデプロイで再作成された `power-actions` に対する古いマウントのまま稼働
- その結果、API が JSON を書き込めず 500 エラー → 電源操作・連打防止オーバーレイが動作しない

---

## Fix

### 即時対処（Pi5 で実行）

```bash
cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api
```

API コンテナを再起動することで、現在の `power-actions` ディレクトリへの新しいバインドマウントが確立する。

**検証結果（2026-03-01）**:
- 即時対処（API 再起動）実施後、`mountinfo` で `//deleted` が解消
- コンテナ内 `ls /app/power-actions/` で `failed/` `processed/` が可視
- raspi4-robodrill01 の電源操作（再起動/シャットダウン）が正常に機能することを実機確認

### 恒久対策（2026-03-01 実装済み）

1. **server ロール**: `power-actions` 作成タスクに `register: power_actions_dir_result` と `notify: restart api` を追加。変更時のみ handler が発火し、API 再起動でバインドマウントを更新する。
2. **Runbook**: [kiosk-power-operation-recovery.md](../runbooks/kiosk-power-operation-recovery.md) に既発不具合時の即時対処を記載。恒久対策実装後も、`//deleted` 発生時は本 Runbook による手動復旧が有効。

---

## Prevention

- 電源操作不具合時は、`mountinfo` で `//deleted` の有無を確認する
- 恒久対策により、server ロール実行時（Pi5 デプロイ時）は `power-actions` 変更があれば自動で API 再起動される

---

## References

- `infrastructure/ansible/roles/server/tasks/main.yml`（power-actions 作成タスク）
- `infrastructure/docker/docker-compose.server.yml`（power-actions ボリュームマウント）
- `apps/api/src/routes/kiosk/power.ts`（writeFile で power-actions に JSON 書き込み）
