# メンテナンス画面が戻らない場合の復旧手順

**対象**: デプロイ完了後もキオスクがメンテナンス画面のままになる場合

**想定事象**: デプロイは成功したが、特定のキオスク端末だけメンテナンス画面が消えない

---

## 1. 原因の切り分け

| 症状 | 想定原因 |
|------|----------|
| 対象端末のみメンテ表示 | デプロイ中にその端末がオフラインになり、フラグ解除を取得できなかった |
| 全キオスクがメンテ表示 | deploy-status.json が残存している（デプロイ失敗/中断時のクリア漏れ） |

---

## 2. 復旧手順

### 2.1 強制解除（Pi5上で deploy-status.json を削除）

```bash
# Macから実行（Pi5のTailscale IPで接続）
ssh denkon5sd02@100.106.158.2 "rm -f /opt/RaspberryPiSystem_002/config/deploy-status.json"
```

- 全キオスクのメンテナンス表示が解除される（最大5秒以内にポーリングで反映）
- デプロイ中に実行しないこと（デプロイ対象端末のメンテ表示が消える）

### 2.2 確認

```bash
# APIで状態確認（キオスクは x-client-key 付きでポーリングするため、直接確認する場合は client-key が必要）
curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk1"
# {"isMaintenance":false} が返ればOK
```

---

## 3. 実機検証チェックリスト（deploy-status v2 デプロイ後）

デプロイ完了後に以下を確認する（2026-03-06 実機検証で実施済み。2026-03-10 全端末共有優先順位デプロイ後、2026-03-11 ロケーション間共有化デプロイ後、2026-03-15 Location Scope Phase7/Phase8/Phase9/Phase0-4/Phase11 でも同チェックリストで検証済み）:

| 項目 | コマンド/手順 | 期待値 |
|------|---------------|--------|
| API ヘルス | `curl -sk https://100.106.158.2/api/system/health` | `status: "ok"` または `"degraded"` |
| deploy-status API（raspberrypi4） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `{"isMaintenance":false}` |
| deploy-status API（raspi4-robodrill01） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspi4-robodrill01-kiosk1"` | `{"isMaintenance":false}` |
| キオスク API | `curl -sk "https://100.106.158.2/api/tools/loans/active" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | 200 OK |
| 納期管理 API | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/triage" -H "x-client-key: client-key-raspberrypi4-kiosk1"` ほか daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / **actual-hours/stats** | 200 OK |
| global-rank targetLocation/rankingScope（2026-03-10追加） | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/global-rank" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `targetLocation`, `actorLocation`, `rankingScope` が返る。Mac向け: `?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared`（URLエンコード）で対象拠点指定可能 |
| Mac向け targetLocation 指定（Phase8/Phase9確認） | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `targetLocation` が `第2工場` で返る（`actorLocation`/`rankingScope` も整合） |
| actual-hours/stats 返却整合 | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/actual-hours/stats" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` が返る |
| location scope fallback監視（2026-03-15追加 / 2026-03-15更新） | `ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs --since=10m api | grep 'Resource category policy resolved via default fallback'"`（注: Pi5に`rg`は未導入のため`grep`を使用） | `default fallback` の警告ログが想定外に増えていない（`siteKey` / `deviceScopeKey` 解決ができていること） |
| サイネージ API | `curl -sk "https://100.106.158.2/api/signage/content"` | 200 OK、`layoutConfig` 含む |
| backup.json | `ssh denkon5sd02@100.106.158.2 "ls -lh /opt/RaspberryPiSystem_002/config/backup.json"` | ファイル存在・サイズ 0 でない |
| マイグレーション | `ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status"` | 未適用なし |
| Pi4 サービス | **Pi5経由で** `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no tools03@100.74.144.79 'systemctl is-active kiosk-browser.service status-agent.timer'"`（raspberrypi4） | 両方 `active` |
| Pi4 サービス（robodrill01） | `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no tools04@100.123.1.113 'systemctl is-active kiosk-browser.service status-agent.timer'"` | 両方 `active` |
| Pi3 signage-lite | Pi5経由で `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"` | `active` |
| Pi3/Pi4サービス簡易一括確認（Phase7確認） | `./scripts/deploy/verify-services-real.sh` | Pi3 signage-lite/timer、Pi4 kiosk-browser が `active` |
| Phase12 一括自動検証（2026-03-16追加） | `./scripts/deploy/verify-phase12-real.sh` | API/サービス/fallback監視/auto-generate が PASS（WARN は内容確認） |
| verify-phase12 ping 失敗時（2026-03-16追加） | ICMP がブロックされる環境で「Pi5に到達できません」と出る場合、上記 runbook の curl/ssh 項目を手動実行して同等検証する。HTTPS/SSH 経路は正常でも ping が通らない環境がある（[KB-302](../knowledge-base/ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗)） | 手動項目で全項目合格 |
| 納期管理新UI（V2有効時） | 実機で納期管理画面を開き、左レール・アクティブコンテキストバー・詳細パネル構成、製番選択時の視認表現、主要操作（一覧・選択・詳細・編集）を確認 | 新レイアウト表示・操作正常 |
| 納期管理UI Phase1（開閉式・重複削除、2026-03-13追加） | 左ペイン3セクションが開閉できること、詳細パネルに製番・機種の重複表示がないこと、製番一覧・選択・詳細・編集が正常に動作すること | 開閉・表示・操作正常 |
| 納期管理UI Phase2（開閉アイコン化・デフォルト閉じ・状態記憶・最下段カード削除、2026-03-13追加） | 開閉ボタンがアイコン化されていること、初回表示で全セクションが閉じていること、開閉操作後にリロードしても状態が復元されること、最下段カードが表示されず製番登録・削除がチップで動作すること | アイコン・デフォルト閉じ・状態記憶・チップ操作正常 |
| 納期管理 表面処理別納期（2026-03-14実機検証完了） | 右ペインヘッダーに「製番納期」ボタンと「製番内で使用中の表面処理別納期」ボタンが併存すること。表面処理別納期を設定すると該当部品のみ更新され、製番納期更新時に上書き済み表面処理は維持されること。表面処理別納期を解除すると製番納期へフォールバックすること。API: `PUT /seiban/:fseiban/processing/:processingType/due-date`（`dueDate: ""`で解除） | ボタン表示・上書き保持・解除フォールバック正常 |
| 納期管理UI Phase3（左ペイン導線再構成、2026-03-14実機検証完了） | 左ペインが3セクション（上段: 製番登録・納期前提、中段: 全体ランキング、下段: 当日計画への反映）になっていること。トリアージが独立セクションではなくランキングカードの属性・フィルタ・当日候補選択UIに統合されていること。開閉・状態記憶・主要操作が正常であること | 3セクション導線・トリアージ統合・開閉・操作正常 |
| 納期管理UI 左ペイン中規模改善（選択/対象化導線の統合、2026-03-14追加） | ランキングカード・今日対象候補のトグルが「対象化」（未選択）⇔「対象中」（選択）と表示されること。今日対象候補のフィルタが「対象中のみ」⇔「全件表示」と表示されること。サマリ（対象候補/対象中/危険/注意/余裕）、バッジ（今日対象/対象外/引継ぎ）、製番選択→右ペイン表示、セクション開閉のlocalStorage永続化が正常であること | 対象化/対象中・フィルタ・サマリ・バッジ・開閉永続化正常 |
| 納期管理UI 左ペイン3セクション色分け（2026-03-14追加） | 左ペイン3セクションが emerald（製番登録・納期前提）/ blue（全体ランキング）/ amber（当日計画への反映）で色分けされていること。当日計画セクションのコンテンツ背景がなし（赤「危険」の視認性のため）。開閉・製番選択・既存機能の動作確認 | 色分け・視認性・操作正常 |
| 全体ランキング自動調整（2026-03-14追加 / 2026-03-16更新） | `GET /api/kiosk/production-schedule/due-management/global-rank/proposal` が200、`PUT /api/kiosk/production-schedule/due-management/global-rank/auto-generate` が200で従来互換の応答を返すこと。Pi5 APIコンテナログで `Due management auto-tuning scheduler started` が確認できれば望ましい（確認できない場合はログローテーションを考慮し、`PUT /global-rank/auto-generate` の200を代替判定とする）。手動`PUT /global-rank`で `reasonCode`（5項目）を指定した場合、`DueManagementOperatorDecisionEvent.reasonCode` に保存されること。 | 互換維持・スケジューラ起動（または代替判定）・理由コード保存正常 |
| 納期管理 資源CDフィルタ（2026-03-17追加・2026-03-17更新） | **API**: `GET /api/kiosk/production-schedule/due-management/summary`、`/triage`、`/daily-plan`、`/global-rank` に `resourceCd` または `resourceCategory`（`grinding`/`cutting`）を付与して200が返ること。未指定時は従来通り全件返却。**UI（実機）**: 納期管理画面の納期日ボタン左側に「資源CD」ドロップダウンのみ表示されること（研削工程・切削工程ボタンは2026-03-17に削除）。ドロップダウンは研削・切削の資源CDのみ。フィルタ変更で左ペイン・右ペインの表示が絞り込まれること。フィルタ有効時は右ペインの優先順位保存・上下移動は無効化される。daily-plan の保存はフィルタ非干渉。 | API 200・UI表示（ドロップダウンのみ）・絞込・無効化・保存非干渉正常 |
| 生産スケジュール 機種名検索（2026-03-17追加） | **前提**: 機種名で絞るには「機種名」＋「工程（研削/切削）」＋「資源CD」の3つを指定する（A条件）。**API**: `GET /api/kiosk/production-schedule?resourceCategory=grinding&resourceCds=305&machineName=サーボストッパ` 等で 200 かつ該当製番のみ返ること。**UI（実機）**: 生産スケジュール画面で機種名ドロップダウンで1件選択→工程と資源CDを選択→検索で該当機種の製番・部品のみ表示されること。機種名は全角/半角混在でも正規化されて一致すること。 | API 絞込・UI 機種名＋工程＋資源で検索発動・表示正常 |

**注記（Pi3 offline 時）**: `tailscale status` で Pi3（signageras3@100.105.224.86）が offline の場合、SSH がタイムアウトする。実機検証時は Pi3 の signage サービス確認をスキップ可能。Pi4 と API の検証が完了していれば、Pi3 は復帰後に追い確認する運用で可。

---

## 4. Pi4/Pi3 サービス確認の接続経路

**重要**: MacからPi4/Pi3へ直接SSHするとタイムアウトする。本構成では**Pi5経由**で接続する（[ansible-ssh-architecture.md](../guides/ansible-ssh-architecture.md) 参照）。

- Mac → Pi5（denkon5sd02@100.106.158.2）にSSH
- Pi5 → Pi4/Pi3（tools03/tools04/signageras3@各IP）にSSH

## 5. Pi4デプロイハング時の復旧手順（2026-03-09 追加）

**注記**: 通常は Pi4 を 1 台ずつ直列実行する運用（`deploy_serial.kiosk: 1`）のため、本手順が必要になる事象は稀。過去に `--limit "server:kiosk"` で Pi5 + Pi4 を並列デプロイ中、Pi5 フェーズ完了後に Pi4 キオスクフェーズでハングする事象が発生した（[KB-300](../knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時)）。直列化適用後も、ネットワーク障害等で同様のハングが発生した場合に本手順を参照する。

### 5.1 ハングの判定

- リモートログが 10 分以上更新されない
- `state: running` のまま `exit` ファイルが生成されない
- ログ末尾が `TASK [common : Ensure repository parent directory exists]` 等で止まっている

### 5.2 復旧手順

1. **ハングしたプロセスの停止**（Pi5 上で実行中の ansible-playbook 等を kill）
   ```bash
   # リモートの PID を確認（status.json の runId から .pid ファイルを参照）
   ssh denkon5sd02@100.106.158.2 "ps aux | grep ansible-update"
   # 親プロセス（bash /tmp/ansible-update-*.sh）と ansible-playbook を kill
   ssh denkon5sd02@100.106.158.2 "kill -TERM <親PID> <ansible-playbook-PID> 2>/dev/null || true"
   ```

2. **ロックファイルの確認・削除**（cleanup が実行されない場合）
   ```bash
   ssh denkon5sd02@100.106.158.2 "rm -f /opt/RaspberryPiSystem_002/logs/.update-all-clients.lock"
   ```

3. **Pi4 を単体で再デプロイ**
   ```bash
   export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
   ./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspberrypi4" --detach --follow
   ./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspi4-robodrill01" --detach --follow
   ```

4. **実機検証チェックリスト**（セクション 3）に従って確認

---

## 6. 関連ドキュメント

- [ADR-20260306: 端末別メンテナンス状態](../decisions/ADR-20260306-deploy-status-per-client-maintenance.md)
- [deployment.md](../guides/deployment.md): デプロイ標準手順
- [location-scope-naming.md](../guides/location-scope-naming.md): `deviceScopeKey/siteKey` 命名規約と互換橋渡し（Phase13）
- [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装)
- [KB-300](../knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時): Pi4 デプロイハングの詳細
