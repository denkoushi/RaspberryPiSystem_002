---
title: トラブルシューティングナレッジベース - NFC/ハードウェア関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - NFC/ハードウェア関連

**カテゴリ**: インフラ関連 > NFC/ハードウェア関連  
**件数**: 3件  
**索引**: [index.md](../index.md)

NFCリーダーとハードウェアに関するトラブルシューティング情報

---

### [KB-056] 工具スキャンが二重登録される問題（NFCエージェントのキュー処理改善）

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行655付近)

**事象**: 
- タグを1回スキャンしても、貸出が2件登録されることがある
- 再現性が100%ではなく、時折発生する
- タグのスキャンは1回しかしていないことは確実

**要因**: 
- NFCエージェントがイベントをSQLiteキューに**常に追加するだけで削除していなかった**
- Pi4のエージェントを再起動したり、WebSocketを張り直すたびに「過去の履歴」が再送され、同じUIDが複数回フロントへ届いていた
- フロント側の重複排除は「`uid + timestamp`」をキーにしているため、再送時は新しいタイムスタンプとなり、借用処理が二度実行されていた

**試行した対策**: 
- [試行1] フロント側の重複排除ロジックを確認 → **問題なし**（`uid + timestamp`で正しく重複排除している）
- [試行2] NFCエージェントのキュー処理を確認 → **問題発見**（オンライン時もキューに残っていた）
- [試行3] オンライン時にイベントを即座に配信し、配信成功したイベントはキューから削除するように変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. `WebSocketManager.broadcast()` が「1件でも送信に成功したか」を返すように変更
  2. イベントキューへ書き込むたびに挿入IDを受け取り、**配信に成功したイベントは即時削除**するように変更
  3. SQLiteの `enqueue` が挿入IDを返すよう修正
  4. これにより、オンライン時のイベントは蓄積せず、オフライン時だけキューに残る設計になった

**学んだこと**: 
- **キュー処理の設計**: オンライン時は即座に配信し、オフライン時だけキューに残す設計が重要
- **再送時のタイムスタンプ**: 再送時にタイムスタンプが更新されると、フロント側の重複排除が機能しない
- **イベントのライフサイクル**: イベントは「生成 → キュー追加 → 配信 → 削除」の流れを明確にする必要がある
- **SQLiteの挿入ID**: `lastrowid` を使用して挿入IDを取得できる

**解決状況**: ✅ **解決済み**（2025-11-30）

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/main.py`
- `clients/nfc-agent/nfc_agent/queue_store.py`

---

---

### [KB-060] Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題

**EXEC_PLAN.md参照**: Phase 2.4 実機テスト（2025-12-01）

**事象**: 
- Raspberry Pi 4のキオスクでNFCリーダーからのタグスキャンが機能しない
- `curl http://localhost:7071/api/agent/status` で `readerConnected: false` が返る
- `Service not available. (0x8010001D)` エラーが発生する
- `Failed to establish context` エラーが発生する
- `pcsc_scan`はrootで動作するが、一般ユーザーでは動作しない
- Dockerコンテナ内から`pcscd`にアクセスできない

**要因**: 
- **Dockerコンテナ内からのpcscdアクセス**: Dockerコンテナ内からホストの`pcscd`デーモンにアクセスするには、`/run/pcscd/pcscd.comm`ソケットファイルへのアクセスが必要だが、`docker-compose.client.yml`に`/run/pcscd`のマウントが設定されていなかった
- **polkit設定ファイルの削除**: `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除された（`git clean`など）ため、polkitが`pcscd`へのアクセスを拒否していた
- **ポート7071の競合**: 古い`nfc_agent`プロセスがポート7071を占有していた

**試行した対策**: 
- [試行1] `pcscd`サービスを再起動 → **失敗**（コンテナ内からアクセスできない）
- [試行2] `tools03`ユーザーを`pcscd`グループに追加 → **失敗**（グループが存在しない）
- [試行3] `pcscd.service`に`--ignore-polkit`オプションを追加 → **一時的に有効だが、設定がリセットされた**
- [試行4] `/etc/polkit-1/rules.d/`ディレクトリが存在しないことを確認 → **polkit設定ファイルが削除されていた**
- [試行5] polkit設定ファイルを再作成 → **成功**（一般ユーザーで`pcsc_scan`が動作）
- [試行6] `docker-compose.client.yml`に`/run/pcscd`のマウントを追加 → **成功**（コンテナ内から`pcscd`にアクセス可能）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **polkit設定ファイルの再作成**: `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`を作成して、すべてのユーザーが`pcscd`にアクセスできるように設定
  2. **Dockerコンテナへの`/run/pcscd`マウント**: `docker-compose.client.yml`の`volumes`セクションに`/run/pcscd:/run/pcscd:ro`を追加
  3. **コンテナの再作成**: ボリュームマウント設定を反映するため、コンテナを再作成

**学んだこと**: 
- **Dockerコンテナからのホストサービスアクセス**: ホストのデーモン（`pcscd`など）にアクセスするには、ソケットファイル（`/run/pcscd/pcscd.comm`）へのアクセスが必要で、ボリュームマウントで明示的にマウントする必要がある
- **polkit設定の重要性**: `pcscd`はpolkitを使用してアクセス制御を行っており、設定ファイルが削除されると一般ユーザーからアクセスできなくなる
- **git cleanの影響**: `git clean -fd`などの操作で、`.gitignore`に含まれていない設定ファイル（`/etc/polkit-1/rules.d/`など）が削除される可能性がある
- **システム設定ファイルの保護**: `/etc/`配下の設定ファイルは、`.gitignore`に追加するか、Ansibleなどの設定管理ツールで管理する必要がある
- **コンテナ再作成の必要性**: ボリュームマウント設定を変更した場合は、コンテナの再作成が必要

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/docker/docker-compose.client.yml`（`/run/pcscd`のマウント設定）
- `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`（polkit設定ファイル）
- `docs/modules/tools/operations.md`（NFCリーダーのトラブルシューティング手順）
- `docs/troubleshooting/nfc-reader-issues.md`（NFCリーダーの詳細なトラブルシューティング）

---

---

### [KB-067] 工具スキャンが重複登録される問題（NFCエージェントのeventId永続化対策）

**EXEC_PLAN.md参照**: Phase 6 実機検証（2025-12-01）、[tool-management-debug-execplan.md](../plans/tool-management-debug-execplan.md)

**事象**: 
- NFCタグを1回しかスキャンしていないのに、1〜2件の貸出が勝手に追加される
- 再現性は100%ではないが、WebSocket再接続後などに発生しやすい
- 同じUIDのイベントが複数回処理される

**要因**: 
1. **キュー再送による重複**: NFCエージェントのキュー再送機能により、過去のイベントがWebSocket再接続時に再配信される
2. **フロントエンドの重複判定不足**: フロントエンドの重複判定がWebSocket切断時にリセットされるため、再送イベントを弾けない
3. **イベントIDの欠如**: WebSocket payloadに一意のeventIdが含まれておらず、タイムスタンプのみでは重複判定が不完全

**試行した対策**: 
- [試行1] フロントエンドで3秒以内の同一UIDを除外 → **部分的成功**（通常時は動作するが、WebSocket再接続時に失敗）
- [試行2] WebSocket再接続時にイベントキーをリセット → **失敗**（再送イベントを弾けない）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. NFCエージェントでSQLiteの`queued_events.id`を`eventId`としてWebSocket payloadに含める
  2. フロントエンドで`sessionStorage`に最後に処理した`eventId`を永続化
  3. `useNfcStream`フックで`eventId`の単調増加を監視し、過去のIDを弾く
  4. `eventId`が無い場合は従来の`uid:timestamp`方式でフォールバック

**学んだこと**: 
- WebSocket再接続時にフロントエンドの状態がリセットされるため、永続的なストレージ（`sessionStorage`）が必要
- タイムスタンプのみでは重複判定が不完全（再送イベントは新しいタイムスタンプを持つ可能性がある）
- イベントIDの単調増加を監視することで、確実に重複を防止できる
- SQLiteの`lastrowid`を活用することで、一意のIDを簡単に生成できる

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/main.py`
- `clients/nfc-agent/nfc_agent/resend_worker.py`
- `clients/nfc-agent/nfc_agent/queue_store.py`
- `apps/web/src/hooks/useNfcStream.ts`
- `docs/plans/tool-management-debug-execplan.md`

---

---
