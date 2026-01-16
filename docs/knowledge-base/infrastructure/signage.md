---
title: トラブルシューティングナレッジベース - サイネージ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2026-01-16
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - サイネージ関連

**カテゴリ**: インフラ関連 > サイネージ関連  
**件数**: 11件  
**索引**: [index.md](../index.md)

デジタルサイネージ機能に関するトラブルシューティング情報

---

### [KB-080] Pi4キオスクがTailscale URL固定でレイアウトが旧状態のままになる

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-05）

**事象**:
- Pi4（キオスク端末）の画面が tagモード＋旧レイアウトのまま更新されない
- 管理コンソールのURLや表示スタイルがローカル運用時と一致せず、ユーザーが混乱

**要因**:
- `kiosk-launch.sh` の `--app="https://100.106.158.2/kiosk"` がTailscale経路に固定されていた
- `network_mode` を `local` に戻した後も、再デプロイを実施していなかったためURLが上書きされなかった
- Tailscale経路では証明書警告を回避するためのフラグが有効になっており、Chromiumが常にTailscale URLを優先していた

**試行した対策**:
- [x] Pi5経由でPi4へSSHし、`systemctl status kiosk-browser.service` と `cat /usr/local/bin/kiosk-launch.sh` を取得して状況を可視化
- [ ] Ansibleで `network_mode=local` を指定して `deploy.yml` を再実行し、`kiosk_url` 変数からローカルIPを再配布（未実施）
- [ ] `signage/kiosk` ロールに「現在のURLと `current_network` の不一致を検知して警告するタスク」を追加（未実施）

**有効だった対策 / 次のアクション**:
- 調査完了。再デプロイでURLを更新し、`kiosk_launch.sh.j2` に `current_network` の値を埋め込むことで解消予定。

**関連ファイル**:
- `infrastructure/ansible/group_vars/all.yml` (`network_mode`, `server_ip`, `kiosk_full_url`)
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`
- `docs/plans/security-hardening-execplan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

### [KB-127] サイネージUIで自端末の温度表示機能追加とデザイン変更

**EXEC_PLAN.md参照**: 温度表示ロジックの調査と実装（2026-01-03）

**事象**: 
- Pi3のサイネージUIに温度表示がない
- サイネージ左ペインのタイトルが以前のデザインと差異がある（「工具管理データ」→「持出中アイテム」）

**要因**: 
- `signage.renderer.ts`の`getSystemMetricsText()`がPi5の`/sys/class/thermal/thermal_zone0/temp`を読み取っていた
- サイネージレンダラーは`x-client-key`を受け取っていないため、Pi3を特定する方法がなかった
- 左ペインのタイトルが「工具管理データ」に変更されていた

**有効だった対策**: 
- ✅ **解決済み**（2026-01-03）:
  1. `getClientSystemMetricsText()`を実装し、Pi3の`ClientDevice`を特定（`apiKey: 'client-key-raspberrypi3-signage1'`）
  2. `ClientDevice.statusClientId`から`ClientStatus`を取得し、Pi3の温度を取得
  3. `buildSplitScreenSvg`と`buildToolsScreenSvg`に温度表示を追加
  4. フォールバック: Pi3の`ClientDevice`が見つからない場合はPi5の温度を表示
  5. 左ペインのタイトルを「工具管理データ」→「持出中アイテム」に変更
  6. Pi3側の処理は一切変更不要（サーバー側のみの変更）

**学んだこと**:
- サイネージ画像はPi5側のサーバーでレンダリングされるため、Pi3へのデプロイは不要
- `ClientDevice.statusClientId`を使用することで、`x-client-key`なしでもPi3を特定できる
- サーバー側レンダリングの利点: Pi3のリソースを消費せずに機能を追加できる

**解決状況**: ✅ **解決済み**（2026-01-03）

**正常化作業の追記**（2026-01-03）:
- Pi5のTSソース（`apps/api/src/services/signage/signage.renderer.ts`）が旧い実装（「工具管理データ」）のままだった
- 正しい実装（「持出中アイテム」＋`getClientSystemMetricsText()`）をPi5に反映
- APIコンテナを`--no-cache`で再ビルドし、`--force-recreate`で再作成して正常化完了
- Pi3のサイネージ画面で「持出中アイテム」タイトルと温度表示（`CPU xx% Temp yy.y°C`）が正常に表示されることを確認

**学んだこと（追加）**:
- Pi5のリポジトリとコンテナの`dist`が不一致になることがある（TSソースが旧いまま、コンテナは以前のビルドで新実装が含まれていた）
- デプロイ時は必ずTSソースを最新化し、`--no-cache`で再ビルドすることで確実に反映できる
- DEBUG MODEのNDJSONログで、repo/コンテナの不一致を検出できる（`hasTitleString: false`だが`distHasTitle: true`など）

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`
- `apps/api/src/lib/prisma.ts`
- `docs/investigation/temperature-display-investigation.md`
- `docs/guides/deployment.md`
- `scripts/debug/signage-normalize-debug.mjs`（DEBUG MODE用の診断スクリプト）

---

---

### [KB-081] Pi3サイネージのPDF/TOOLS画面が新デザインへ更新されない

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-05）

**事象**:
- Raspberry Pi 3 のサイネージ画面が、Reactで刷新したモダンUIではなく旧デザインのまま表示される
- PDFスライドショーのページ送りやカードデザインが物理サイネージに反映されず、利用者が変更を確認できない

**要因**:
- 実機が参照しているのは `SignageRenderer`（`apps/api/src/services/signage/signage.renderer.ts`）が生成するJPEGであり、React側のUI更新だけでは反映されない
- Phase 6/7 ではReact UIの改善のみを実施し、サーバー側レンダラーのSVGテンプレートを更新していなかった

**試行した対策**:
- [x] APIコードを確認し、`SignageRenderer` が旧SVGを組み立てていることを確認
- [ ] Pi3から `/var/cache/signage/current.jpg` を取得し、実際に描画されている内容を確認（未実施）
- [x] `SignageRenderer` の `renderTools` / `renderSplit` / `renderPdfImage` をReact版のスタイルに合わせて書き換え（2025-12-05）  
      - グラデーション背景・ガラス調カード・PDF表示のスライド情報表示・CPU/温度メトリクスをSVGで再構築  
      - TOOLS/PDF/SPLITの各モードでサーバーサイド描画結果がReact UIと視覚的に整合するように調整

**有効だった対策 / 次のアクション**:
- 調査段階。Phase 8-2 で新デザインのSVGテンプレートを実装し、`signage-test-plan.md` を更新する。

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`
- `docs/plans/security-hardening-execplan.md`
- `docs/guides/signage-test-plan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

---

### [KB-082] 管理コンソールでSPLITを指定してもサイネージAPIが常にTOOLSを返す

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-06）

**事象**:
- 管理コンソールで左右2ペイン（SPLIT）を設定しているのに、実機サイネージは単一ペイン（TOOLS）表示のまま
- `/api/signage/content` を確認すると `contentType: "TOOLS"` が返却され、`pdf` 情報も付与されていない

**要因**:
- 営業時間（07:30–21:00）外ではどのスケジュールにも一致せず、デフォルトの TOOLS へフォールバックしていた  
- セキュリティ機能（Tailscale/UFW）ではなく、`SignageService.getContent()` のフォールバック仕様不足が根本原因

**試行した対策**:
- [x] Pi3クライアント側で `SERVER_URL` を Tailscale IP へ一時切替 → サーバーの最新 `current.jpg` とハッシュ一致することを確認（レンダラー改修は反映済み）  
- [x] `prisma.signageSchedule` を直接確認し、営業終了後（21:00以降）はどのスケジュールにも一致せず `TOOLS` にフォールバックしていた事実を把握  
- [x] `SignageService.getContent()` にフォールバック処理を追加し、SPLITスケジュールが存在する場合は優先的に返却するよう改修（2025-12-05）

**有効だった対策 / 残作業**:
- ✅ `/api/signage/content` が営業時間外でも `contentType: "SPLIT"` を返すようになり、Pi3実機も左右ペイン表示へ復帰  
- 🔄 必要に応じてスケジュール（start/end）を見直し、意図的に単一ペインへ切り替えたい時間帯があるかを運用ドキュメントへ追記する

**関連ファイル**:
- `apps/api/src/services/signage/signage.service.ts`
- `apps/api/src/services/signage/signage.renderer.ts`
- `docs/plans/security-hardening-execplan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

---

### [KB-083] サイネージカードレイアウトが崩れる（2カラム固定・サムネ比率）

**EXEC_PLAN.md参照**: Progress (2025-12-06)

**事象**: 
- 工具カードの列幅が不揃いで間延びし、サムネイルの縦横比も崩れて表示が潰れる。ヘッダ文字が大きく表示領域が狭い。

**要因**: 
- サムネイルを`contain`で描画して余白が生じ、列数も可変でグリッドが緩みやすかった。clipがないため角丸内に収まらず、視覚的に崩れていた。

**有効だった対策**: 
- `SignageRenderer`でカード列を2カラムに固定し、gapを20px相当に統一。サムネイルを16:9相当＋`cover`＋`clipPath`で角丸内に収め、タイトル/テキストを縮小。
- Pi5で `docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build api` を実行してデプロイ。Pi3/4への操作は従来通りPi5経由SSHのみで行い、Pi3は`signage-lite`再起動で反映予定。

**学んだこと**: 
- サイネージのカードレイアウトは列数と幅を固定し、サムネイルは`cover`＋`clipPath`で比率と角丸を両立させると崩れを防げる。

**解決状況**: 🔄 進行中（Pi3実機での最終表示確認待ち）

**関連ファイル**: 
- `apps/api/src/services/signage/signage.renderer.ts`
- `infrastructure/docker/docker-compose.server.yml`

---

---

### [KB-084] サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない

**EXEC_PLAN.md参照**: Phase 8 サイネージデザイン調整（2025-12-06）

**事象**:
- サイネージ画面で2列カードレイアウトを実装したが、テキストがサムネイル右側ではなく画面左端に表示される
- 右列のカードにはテキストが一切表示されず、サムネイルのみが描画される

**要因**:
- SVGの `<text>` 要素の `x` 座標に、カード内相対位置（`textAreaX`）をそのまま使用していた
- 正しくは、カードの絶対位置 `x` にカード内相対位置 `textAreaX` を加算した `x + textAreaX` を使用する必要がある

**誤ったコード例**:
```typescript
// ❌ 間違い: textAreaXはカード内の相対位置（例: 120px）
<text x="${textAreaX}" y="${primaryY}">...</text>
```

**正しいコード例**:
```typescript
// ✅ 正解: カードの絶対位置 + カード内相対位置
const textX = x + textAreaX;
<text x="${textX}" y="${primaryY}">...</text>
```

**学んだこと**:
1. **SVGの座標は常に絶対座標**: SVGでは親要素からの相対位置ではなく、ビューポート（画面）からの絶対座標を指定する
2. **カードレイアウトの座標計算**: グリッド内の各カード位置 `(x, y)` を基準に、カード内要素の位置を計算する
   - サムネイル: `x + cardPadding`, `y + cardPadding`
   - テキスト: `x + cardPadding + thumbnailWidth + gap`, `y + textOffset`
3. **2列表示の設定**: `maxColumns: 2`, `maxRows: 3` でグリッドを制御
4. **テキスト縦並び順序**: アイテム名 → 従業員名 → 日付 → 時刻 → 警告（12時間超過時は赤色）
5. **SPLIT右ペインのタイトル/ファイル名/画像の位置決め**:
   - `text`の`y`はベースライン。フォント20pxの場合、下方向に約4pxぶん余白を見込む
   - タイトルとファイル名は基準オフセット（例: titleOffsetY ≈ 22px * scale）で揃える
   - PDF画像開始はタイトル下余白（rightHeaderHeight）を最小化して黒地を最大化（例: rightHeaderHeight ≈ 12px * scale）
   - 外枠余白は0〜2px * scale程度に抑え、上貼り付きだけ防ぐ

**有効だった対策**:
- ✅ すべての `<text>` 要素の `x` 座標を `x + textAreaX` に修正
- ✅ サムネイルの `x`, `y` 座標も同様にカード位置を基準に計算

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts` (`buildToolCardGrid` メソッド)
- `apps/api/src/services/signage/signage.renderer.ts`（SPLITペインのタイトル/ファイル名/画像オフセット調整）
- `docs/knowledge-base/infrastructure.md`（本エントリ）

---

---

### [KB-085] サイネージTOOLS左ペインを3列化・右ペインの更新文言削除

**EXEC_PLAN.md参照**: Phase 8 サイネージデザイン調整（2025-12-06）

**事象**:
- 左ペイン（TOOLS）が2列のままで表示面積が不足し、サムネイルを大きく表示できない
- 右ペインに「30s更新」表記があり、不要な文言となっている

**要因**:
- `buildToolCardGrid` の `maxColumns` が2に固定されていた
- SPLIT右ペインでスライド間隔を表示していた

**実施した対策**:
- `maxColumns: 3` に変更し、gapを14px相当に微調整してサムネイルを大型化
- SPLIT右ペインの更新間隔表示を削除
- Pi5でAPIビルド → Docker再起動 → Pi3 `signage-lite.service` 再起動

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`
- `infrastructure/docker/docker-compose.server.yml`（APIコンテナ）
- `infrastructure/ansible/playbooks/restart-services.yml`（signage-lite再起動）

---

---

### [KB-086] Pi3サイネージデプロイ時のsystemdタスクハング問題

**EXEC_PLAN.md参照**: Phase 8 デプロイモジュール実装・実機検証（2025-12-06）

**事象**:
- Pi3へのAnsibleデプロイ実行時に、`systemd`モジュールのタスクで約44分間ハング
- `update-clients-core.yml`の「Re-enable signage-lite service before restart」タスクで停止
- デプロイプロセスが完了せず、`PLAY RECAP`が出力されない
- 複数のAnsibleプロセスが重複実行され、リソースを消費

**経緯**:
1. **2025-12-06 18:27**: 最初のデプロイ実行（サイネージサービスを停止せずに実行）
   - `ansible-playbook`を実行し、`common`ロールのタスクまで正常に進行
   - `signage`ロールのタスクでサイネージサービスを停止・再起動
   - `update-clients-core.yml`の「Re-enable signage-lite service before restart」タスクでハング
   - 約44分間停止し、デプロイが完了しない

2. **2025-12-06 19:39**: ユーザーから「サイネージを停止してからデプロイする約束を守っていない」と指摘
   - 約束を無視していたことを認識
   - ドキュメントを参照せずに進めていたことを認識

3. **2025-12-06 19:46**: サイネージサービスを停止してから再デプロイを実行
   - `sudo systemctl stop signage-lite.service signage-lite-update.timer`を実行
   - メモリ使用状況を確認（120MB空き）
   - デプロイを再実行

4. **2025-12-06 19:47**: 複数のAnsibleプロセスが重複実行されていることを発見
   - `ps aux | grep ansible`で3つのプロセスを確認
   - 全てのプロセスをkillしてから再実行

5. **2025-12-06 19:59**: サイネージを停止してから実行することで、デプロイが正常に完了
   - `PLAY RECAP`: ok=77, changed=16, failed=0
   - サイネージサービスを再起動し、正常動作を確認

**要因**:
1. **リソース不足**: Pi3のメモリが少ない（1GB、実質416MB）
   - サイネージサービス（`feh`プロセス）が動作していると、メモリ使用量が約295MB
   - デプロイ時の`systemd`モジュール実行時に、メモリ不足でハング
   - `apt`パッケージマネージャーの実行時にもリソースを消費

2. **重複プロセス実行**: 複数のAnsibleプロセスが同時に実行されていた
   - 以前のデプロイプロセスが完全に終了していなかった
   - 新しいデプロイを実行すると、複数のプロセスが競合
   - SSH接続のControlMaster接続が残っていた

3. **標準手順の無視**: ドキュメントに記載されている標準手順を守っていなかった
   - 「サイネージを停止してからデプロイする」という約束を無視
   - ドキュメントを参照せずに進めていた
   - 同じミスを繰り返していた

**有効だった対策**:
- ✅ **サイネージサービスを事前に停止**: デプロイ前に`sudo systemctl stop signage-lite.service signage-lite-update.timer`を実行
- ✅ **メモリ使用状況の確認**: `free -m`でメモリ空き容量を確認（120MB以上確保）
- ✅ **重複プロセスのkill**: デプロイ前に`pkill -9 -f ansible-playbook`で全てのAnsibleプロセスを停止
- ✅ **SSH接続のクリーンアップ**: ControlMaster接続をクリーンアップ
- ✅ **標準手順の遵守**: ドキュメントに記載されている標準手順を必ず守る

**学んだこと**:
1. **リソース制約のある環境でのデプロイ**: Pi3のようなリソースが少ない環境では、デプロイ前に不要なサービスを停止する必要がある
2. **デプロイプロセスの重複実行防止**: デプロイ前に既存のプロセスをkillし、クリーンな状態で実行する
3. **標準手順の重要性**: ドキュメントに記載されている標準手順を必ず守る。無視すると同じミスを繰り返す
4. **メモリ使用状況の監視**: デプロイ前にメモリ使用状況を確認し、十分な空き容量を確保する
5. **ドキュメント参照の徹底**: デプロイ前に必ずドキュメントを参照し、標準手順を確認する

**標準プロセス**（KB-089で更新）:
1. **デプロイ前の準備**:
   ```bash
   # Pi3サイネージサービスを停止・無効化（自動再起動を防止）
   ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl disable signage-lite.service signage-lite-update.timer'
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh signageras3@<pi3_ip> 'free -m'
   
   # 既存のAnsibleプロセスをkill
   ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'
   ```

2. **デプロイ実行**:
   ```bash
   # Pi5からPi3へデプロイ
   cd /opt/RaspberryPiSystem_002/infrastructure/ansible
   ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
     ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）
   # サイネージサービスを再有効化・再起動
   ssh signageras3@<pi3_ip> 'sudo systemctl enable signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'
   
   # サービスが正常に動作していることを確認
   ssh signageras3@<pi3_ip> 'systemctl is-active signage-lite.service'
   ```

**解決状況**: ✅ **解決済み**（2025-12-06）

**関連ファイル**:
- `infrastructure/ansible/playbooks/deploy.yml`
- `infrastructure/ansible/tasks/update-clients-core.yml`
- `infrastructure/ansible/roles/signage/tasks/main.yml`
- `docs/guides/deployment.md`（標準プロセスとして追記）
- `docs/guides/ansible-best-practices.md`（ベストプラクティスとして追記）

---

---

### [KB-087] Pi3 status-agent.timer 再起動時のsudoタイムアウト

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- Pi3への標準デプロイ実行中、`status-agent.timer` 再起動タスクで `Timeout (12s) waiting for privilege escalation prompt` が発生し `UNREACHABLE`
- `signage-lite.service` や `signage-lite-update.timer` の再起動は成功するが、`status-agent.*` のみ失敗

**要因**:
1. `signageras3` の `sudo -l` を確認したところ、`NOPASSWD` が `signage-lite` 系コマンドのみに限定されていた
2. `status-agent.service` / `status-agent.timer` に対する `systemctl` はパスワードが必要で、Ansibleはbecome passwordを持たないため昇格プロンプト待ちでタイムアウトしていた

**対策**:
- `inventory.yml` にホストごとの `sudo_nopasswd_commands` を定義（Pi3: signage-lite + status-agent、Pi4: kiosk-browser + status-agent）
- `roles/client` に sudoers テンプレート（`/etc/sudoers.d/<user>`）を追加し、上記コマンドに `NOPASSWD` を付与
- `visudo -cf` 検証を組み込み、設定ミスを防止

**結果**:
- 再デプロイ時に `status-agent.timer` もパスワードなしで再起動可能となり、タイムアウトは再現しなくなった
- 既存ノウハウ（サイネージ停止→Ansible→サービス再起動）の中で sudo 権限定の抜け漏れを防止できるようになった

**関連ファイル**:
- `infrastructure/ansible/inventory.yml`（`sudo_nopasswd_commands`）
- `infrastructure/ansible/roles/client/tasks/main.yml`
- `infrastructure/ansible/roles/client/templates/sudoers-client.j2`
- `docs/guides/deployment.md`（標準プロセスの補足）

---

---

### [KB-088] Prisma P3009 (Signage migrations) 既存型が残存し migrate deploy 失敗

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- `pnpm prisma migrate status` が `Following migration have failed: 20251128180000_add_signage_models` を出力
- `pnpm prisma migrate deploy` で `P3018` / `ERROR: type "SignageContentType" already exists`（DBエラー 42710）
- DBには既に`SignageSchedule`/`SignagePdf`/`SignageEmergency`テーブルと `SignageContentType`/`SignageDisplayMode` ENUM が存在していた

**要因**:
- 過去にマイグレーションが途中適用され、DB上では型・テーブルが作成済みだが、Prismaのマイグレーション状態は「failed」のまま残っていた（不整合）

**対策**:
1. **バックアップ取得**: `docker compose exec db pg_dump -U postgres -Fc borrow_return > /var/lib/postgresql/data/backups/borrow_return_pre_20251207.dump`
2. **残存ENUMの確認/削除**: `SELECT typname FROM pg_type ... WHERE typname ILIKE 'signage%';` で存在を確認し、必要に応じて `DROP TYPE IF EXISTS "SignageContentType" CASCADE; DROP TYPE IF EXISTS "SignageDisplayMode" CASCADE;`
3. **マイグレーション状態の調整**: `pnpm prisma migrate resolve --applied 20251128180000_add_signage_models`
4. **整合性確認**: `pnpm prisma migrate deploy` → pendingなしを確認

**結果**:
- `migrate deploy` で pending 0 を確認し、P3009は解消
- Signage関連テーブル/ENUMはDBに存在し、再作成は不要

**関連ファイル/コマンド**:
- `apps/api/prisma/migrations/20251128180000_add_signage_models/migration.sql`
- `/var/lib/postgresql/data/backups/borrow_return_pre_20251207.dump`（DBバックアップ）
- `docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status|deploy`

---

---

### [KB-089] Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- `deploy-all.sh`実行中、Pi3へのAnsibleデプロイが12分以上ハング
- Pi3向けAnsibleプロセスが重複起動（親子プロセス）
- ログが`impact-analyzer`で止まり、`deploy-executor`の結果が記録されない
- Pi3のメモリ空きが80-100MB程度で不足（120MB以上必要）

**経緯**:
1. **11:33**: deploy-all.sh実行開始、Pi3サイネージサービスを停止してから実行
2. **11:33-11:45**: Pi3デプロイが進行中、Ansibleプロセスが重複起動
3. **11:45**: Pi4デプロイ開始、Pi3デプロイは継続中
4. **11:48**: Pi3デプロイ完了（756秒）、Pi4デプロイ完了（121秒）、Serverデプロイ完了（45秒）
5. **11:48**: 検証完了、全PASS

**要因**:
1. **サイネージサービスの自動再起動**: `signage-lite-update.timer`が有効なままで、デプロイ中にサイネージサービスが自動再起動し、メモリを消費
2. **メモリ不足**: Pi3のメモリは416MB（実質利用可能120MB程度）。サイネージサービスが起動するとメモリ使用量が約295MBとなり、Ansibleデプロイ時にメモリ不足でハング
3. **標準手順の無視**: KB-086で「サイネージサービスを停止してからデプロイ」と明記されているが、`systemctl disable`で自動再起動を防止する手順が実行されていなかった

**有効だった対策**:
- ✅ **サイネージサービスのdisable**: `sudo systemctl disable signage-lite.service signage-lite-update.timer`で自動再起動を防止
- ✅ **十分な待機時間**: Pi3デプロイに756秒（約12.6分）を要したが、プロセスをkillせずに完了を待った
- ✅ **プロセスの完全停止**: 再実行前に`pkill -9 ansible; pkill -9 -f deploy-all`で全プロセスをkill

**標準プロセス**（KB-086を更新）:
1. **デプロイ前の準備**:
   ```bash
   # Pi3サイネージサービスを停止・無効化（自動再起動を防止）
   ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl disable signage-lite.service signage-lite-update.timer'
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh signageras3@<pi3_ip> 'free -m'
   
   # 既存のAnsibleプロセスをkill
   ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'
   ```

2. **デプロイ実行**:
   ```bash
   # Pi5からPi3へデプロイ（deploy-all.sh経由）
   cd /opt/RaspberryPiSystem_002
   NETWORK_MODE=tailscale DEPLOY_EXECUTOR_ENABLE=1 DEPLOY_VERIFIER_ENABLE=1 ROLLBACK_ON_FAIL=1 \
     bash scripts/deploy/deploy-all.sh
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（ログでfailed=0）
   # サイネージサービスを再有効化・再起動
   ssh signageras3@<pi3_ip> 'sudo systemctl enable signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'
   
   # サービスが正常に動作していることを確認
   ssh signageras3@<pi3_ip> 'systemctl is-active signage-lite.service'
   ```

**学んだこと**:
1. **自動再起動の防止**: `systemctl stop`だけでは不十分。`systemctl disable`で自動再起動を防止する必要がある
2. **十分な待機時間**: Pi3デプロイは10-15分かかる可能性がある。プロセスをkillせずに完了を待つ
3. **標準手順の徹底**: KB-086/KB-089の標準手順を必ず実行する。特にPi3デプロイ時は`systemctl disable`を忘れない
4. **注意**: `systemctl disable`だけでは不十分な場合がある。`systemctl mask --runtime`も必要（[KB-097](#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）

**解決状況**: ✅ **解決済み**（2025-12-07）

**関連ファイル**:
- `scripts/deploy/deploy-all.sh`（標準手順参照を追加）
- `docs/guides/deployment.md`（標準プロセスの更新）
- `docs/knowledge-base/infrastructure.md`（KB-086更新、KB-089追加）

**注意**: KB-089の対策（`systemctl disable`）だけでは不十分な場合があります。`systemctl mask --runtime`も必要です（[KB-097](#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）。

---

### [KB-150] サイネージレイアウトとコンテンツの疎結合化実装完了

**EXEC_PLAN.md参照**: サイネージ表示領域の疎結合化（2026-01-06）

**事象**: 
- サイネージのレイアウト（全体/左右）と各エリアのコンテンツ（PDF/持出一覧/将来のCSV可視化）が密結合しており、新しい可視化を追加する際に巨大な`if`分岐の改修が必要だった
- `SPLIT`レイアウトは左=TOOLS / 右=PDF固定で、柔軟なコンテンツ配置ができなかった

**要因**: 
- サーバー側レンダラーが`contentType`に強く依存し、`SPLIT`は左=TOOLS / 右=PDF固定になっていた
- スケジュール返却も`SignageContentType`のif分岐で固定され、新コンテンツ追加のたびに`SignageService`/`SignageRenderer`の両方を改修する必要があった

**実施した対策**: 
- ✅ **データベーススキーマ拡張**: `SignageSchedule`と`SignageEmergency`に`layoutConfig Json?`フィールドを追加
- ✅ **レイアウト設定の型定義**: `SignageLayoutConfig`型を定義し、`layout: FULL | SPLIT`と`slots`配列で柔軟なコンテンツ配置を実現
- ✅ **レガシー形式からの変換**: `convertLegacyToLayoutConfig()`メソッドを実装し、既存の`contentType`/`pdfId`を新形式へ自動変換（後方互換性を維持）
- ✅ **レンダラーの疎結合化**: `renderWithLayoutConfig()`メソッドを実装し、レイアウトごとのキャンバス割当とslotごとのSVG生成を分離
- ✅ **管理コンソールUI拡張**: スケジュール編集画面でレイアウト（全体/左右）と各スロットのコンテンツ種別（PDF/持出一覧）を選択可能に
- ✅ **統合テスト追加**: `layoutConfig`の各組み合わせで`/api/signage/current-image`が正常に動作することを確認

**学んだこと**:
1. **Prisma Client再生成の重要性**: データベースマイグレーション適用後、APIコンテナ内で`pnpm prisma generate`を実行してPrisma Clientを再生成する必要がある。マイグレーションだけでは不十分で、コンテナ再起動も必要
2. **後方互換性の維持**: 既存の`contentType`/`pdfId`形式を新形式へ自動変換することで、既存スケジュールを壊さずに新機能を追加できる
3. **疎結合化の効果**: レイアウトとコンテンツを分離することで、新しいコンテンツ種別（CSV可視化など）を追加する際のコード変更を最小限に抑えられる
4. **デプロイスクリプトの動作**: `scripts/server/deploy.sh`はマイグレーション後にPrisma Clientを再生成するが、コンテナ内のPrisma Clientが古い場合は手動で再生成が必要

**解決状況**: ✅ **解決済み**（2026-01-06）

**実機検証で発見された問題と修正**（2026-01-07）:
1. **SPLITレイアウトで左PDF・右工具管理が機能しない**: `renderWithLayoutConfig()`が左PDF・右工具管理の組み合わせに対応していなかった。`swapSides`パラメータを追加して左右を入れ替えて表示するように修正。
2. **タイトルがハードコードされている**: `buildSplitScreenSvg()`で「持出中アイテム」「PDF表示」が固定されていた。PDF名を動的に表示するように修正。
3. **タイトルとアイテムが被る**: `leftHeaderHeight`を48pxから60pxに増やして、タイトルとカードの間隔を拡大。
4. **PDF表示の重複タイトル**: `fileNameOverlay`がタイトルと重複していた。`fileNameOverlay`を削除し、タイトルのみを表示するように修正。
5. **スケジュールの優先順位ロジック**: マッチしたスケジュールを優先順位順にソートしてから処理するように改善。優先順位が高いスケジュールが優先されることを確認。

**実機検証結果**: ✅ **すべて正常動作**（2026-01-07）
- FULLレイアウト + loansスロット: ✅ 正常
- FULLレイアウト + pdfスロット: ✅ 正常
- SPLITレイアウト + 左loans/右pdf: ✅ 正常
- SPLITレイアウト + 左pdf/右loans: ✅ 正常
- タイトルとアイテムの重なり: ✅ 解消
- PDF表示の重複タイトル: ✅ 解消
- スケジュールの優先順位ロジック: ✅ 正常動作

**関連ファイル**:
- `apps/api/prisma/schema.prisma`（`layoutConfig`フィールド追加）
- `apps/api/prisma/migrations/20260106155657_add_signage_layout_config/migration.sql`
- `apps/api/src/services/signage/signage-layout.types.ts`
- `apps/api/src/services/signage/signage.service.ts`
- `apps/api/src/services/signage/signage.renderer.ts`
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`
- `docs/guides/signage-layout-config-verification-results.md`
- `apps/api/src/services/signage/signage-layout.types.ts`（型定義）
- `apps/api/src/services/signage/signage.service.ts`（レガシー変換ロジック）
- `apps/api/src/services/signage/signage.renderer.ts`（疎結合化されたレンダラー）
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`（UI拡張）
- `docs/guides/deployment.md`（Prisma Client再生成の注意事項）
- `.cursor/plans/signage-layout-decoupling.plan.md`（実装計画）

---

## KB-152: サイネージページ表示漏れ調査と修正

**問題**: サイネージのPDFスライドショーで、ページが1ページずつ順番に表示されず、途中のページがスキップされることがある。Pi3のリソース不足の可能性も指摘されていた。

**原因**:
1. **ページ進行ロジックの問題**: `getCurrentPdfPageIndex`関数で、`steps <= 0`の場合（slideInterval未満の経過時間）でも強制的に`steps = 1`としてページを進めていた。これにより、サーバーのレンダリング間隔（20秒）がslideInterval（30秒）より短い場合、30秒経過する前に次のページに進んでしまい、Pi3がページを取得するタイミングとずれてページが飛ばされる問題が発生していた。
2. **Pi3のサービス停止**: `signage-lite.service`が停止・無効化されていたため、サイネージが表示されていなかった。
3. **Pi3の更新タイマーの精度不足（再発要因1）**: `signage-lite-update.timer`は`OnUnitActiveSec=30s`でも、systemd timerのデフォルト`AccuracySec=1min`の影響で実行が「1分単位に丸め/揺れ」ることがある。結果としてPi3の`/api/signage/current-image`取得が30秒おきにならず、サーバー側（30秒ごとにレンダリング/ページ進行）を取りこぼして「1ページずつ見えない（見かけ上ページが飛ぶ）」が発生する。
4. **Pi3の画像更新方式の問題（再発要因2、2026-01-09発見）**: `signage-update.sh`が`mv "${TEMP_IMAGE}" "${CURRENT_IMAGE}"`で画像を置換していたため、**更新のたびに`current.jpg`のinodeが変わる**。`feh --auto-reload`はinotifyでファイル変更を監視するが、inode変更には追従できない場合があり、**画面が更新されない/飛んで見える**ことがある。

**解決策**:
1. **ページ進行ロジックの修正**: `steps <= 0`の場合は、ページを進めずに**同じページを維持**するように変更。`slideInterval`以上経過した場合のみ1ページ進めるように修正。
2. **複数ページ分経過した場合の処理**: 複数ページ分の時間が経過した場合でも、1ページずつ進めるように修正（`steps = 1`に固定）。
3. **Pi3サービスの起動**: `signage-lite.service`を有効化・起動。
4. **Pi3更新タイマーの精度改善（2026-01-09 追記）**: `signage-lite-update.timer`に`AccuracySec=1s`と`RandomizedDelaySec=0`を設定（unit直編集より安全なdrop-in推奨: `/etc/systemd/system/signage-lite-update.timer.d/override.conf`）。これによりPi3の画像取得が30秒前後に安定し、ページ取りこぼしが抑制される。
5. **Pi3画像更新方式の改善（2026-01-09 追記）**: `signage-update.sh`を修正し、既存`current.jpg`がある場合は**上書き更新（inode維持）**に変更（`cat "${TEMP_IMAGE}" > "${CURRENT_IMAGE}"`）。初回のみ`mv`を使用。これにより`feh --auto-reload(inotify)`が確実にファイル変更を検知し、画面更新が安定する。

**修正内容**:
- `apps/api/src/services/signage/signage.renderer.ts`の`getCurrentPdfPageIndex`関数を修正
  - `steps <= 0`の場合: `return state.lastIndex`（同じページを維持）
  - `steps > 0`の場合: `steps = 1`に固定し、1ページずつ進める
- Pi3の`signage-lite.service`を有効化・起動
- Pi3の`signage-lite-update.timer`の精度を改善（`AccuracySec=1s`, `RandomizedDelaySec=0`）
- Pi3の`signage-update.sh`を修正（2026-01-09）
  - 既存`current.jpg`がある場合: `cat "${TEMP_IMAGE}" > "${CURRENT_IMAGE}"`（上書き更新、inode維持）
  - 初回のみ: `mv "${TEMP_IMAGE}" "${CURRENT_IMAGE}"`（inode変更は初回のみ）
- Ansibleテンプレートも同様に修正（`infrastructure/ansible/**/signage-update.sh.j2`）

**実機検証結果**: ✅ **問題解消**（2026-01-08、再発対策完了: 2026-01-09）
- ページが順番に表示される（1→2→3→...）ことを確認
- ページ飛ばしが発生しないことを確認
- 30秒ごとにページが切り替わることを確認
- 画像更新方式の改善により、`feh --auto-reload`が確実にファイル変更を検知することを確認（2026-01-09）

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`（`getCurrentPdfPageIndex`関数の修正）
- `/etc/systemd/system/signage-lite-update.timer`（Pi3のタイマー設定）
- `/usr/local/bin/signage-update.sh`（Pi3の画像更新スクリプト、2026-01-09修正）
- `infrastructure/ansible/templates/signage-update.sh.j2`（Ansibleテンプレート、2026-01-09修正）
- `infrastructure/ansible/roles/signage/templates/signage-update.sh.j2`（Ansibleロールテンプレート、2026-01-09修正）

---

### [KB-153] Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足）

**発生日時**: 2026-01-08

**事象**: 
- Pi3へのAnsibleデプロイが失敗し、ロールバックが実行された
- `signage`ロールのタスクで`signage-lite.tmpfiles.conf.j2`が見つからないエラーが発生
- デプロイ標準手順を遵守していたにもかかわらず、デプロイが失敗した

**要因**: 
- **`signage`ロールに`templates/`ディレクトリが存在しない**: `infrastructure/ansible/roles/signage/`に`templates/`ディレクトリがなく、Ansibleがテンプレートファイルを探せなかった
- **テンプレートファイルの配置場所の不一致**: テンプレートファイルは`infrastructure/ansible/templates/`に存在していたが、Ansibleロールはデフォルトで`roles/<role-name>/templates/`を参照する
- **ロール構造の不整合**: Pi3サイネージ安定化施策で新しいテンプレートファイルを追加した際に、ロール内の`templates/`ディレクトリに配置していなかった

**有効だった対策**: 
- ✅ **解決済み**（2026-01-08）:
  1. **`signage`ロールに`templates/`ディレクトリを作成**: `infrastructure/ansible/roles/signage/templates/`ディレクトリを作成
  2. **テンプレートファイルのコピー**: `infrastructure/ansible/templates/signage-*.j2`を`infrastructure/ansible/roles/signage/templates/`にコピー
  3. **Gitコミット・プッシュ**: 変更をコミットしてリモートリポジトリにプッシュ
  4. **Pi5でリポジトリ更新**: Pi5上で`git pull`を実行してテンプレートファイルを取得
  5. **標準手順でデプロイ**: デプロイ前の準備（サービス停止・無効化・マスク）を実行してからデプロイを再実行

**学んだこと**:
- **Ansibleロールのテンプレート配置**: Ansibleロールはデフォルトで`roles/<role-name>/templates/`を参照するため、ロール専用のテンプレートファイルは必ず`roles/<role-name>/templates/`に配置する必要がある
- **デプロイ標準手順の遵守**: デプロイ前の準備を実行していても、ロール構造の問題でデプロイが失敗する可能性がある
- **エラーログの詳細確認**: デプロイが失敗した場合は、ログの詳細を確認して根本原因を特定する必要がある

**解決状況**: ✅ **解決済み**（2026-01-08: テンプレートディレクトリ作成とファイルコピー完了、デプロイ成功）

**関連ファイル**:
- `infrastructure/ansible/roles/signage/templates/`（新規作成）
- `infrastructure/ansible/templates/signage-*.j2`（コピー元）
- `infrastructure/ansible/roles/signage/tasks/main.yml`（テンプレート参照タスク）
- `docs/knowledge-base/infrastructure/ansible-deployment.md`（KB-153の詳細）

**再発防止策**:
- **新しいロール作成時**: `templates/`ディレクトリを最初から作成する
- **テンプレートファイル追加時**: ロール専用のテンプレートは必ず`roles/<role-name>/templates/`に配置する
- **デプロイ前の確認**: デプロイ前にロール構造を確認し、必要なディレクトリが存在することを確認する

---

### [KB-154] SPLITモードで左右別PDF表示に対応

**実装日時**: 2026-01-08

**事象**: 
- SPLITモードで左右ともPDFを表示したいが、現状は左=工具管理/右=PDFまたは左=PDF/右=工具管理の組み合わせのみ対応
- 左右別PDF表示の場合、左ペインが真っ黒でタイトルが「持出中アイテム」とハードコードされていた

**要因**: 
- `SignageContentResponse`に`pdf`フィールドしかなく、複数PDFを参照できない
- レンダラーが左右ともPDFの場合の処理を実装していなかった
- Web側の`SignageDisplayPage`が`layoutConfig`準拠の2ペインSPLIT描画に対応していなかった

**実施した対策**: 
- ✅ **API拡張**: `SignageContentResponse`に`pdfsById`フィールドを追加し、複数PDFを辞書形式で提供可能に
- ✅ **レンダラー拡張**: `renderSplitWithPanes`メソッドを追加し、左右ともPDFの場合に対応
- ✅ **レンダラー修正**: `renderWithLayoutConfig`で左右ともPDFの場合に`renderSplitWithPanes`を呼び出すように修正
- ✅ **Web側実装**: `SignageDisplayPage`を`layoutConfig`準拠の2ペインSPLIT描画に更新し、左右それぞれのスロットに応じてPDFまたは工具を描画
- ✅ **型定義追加**: `client.ts`に`layoutConfig`と`pdfsById`の型定義を追加
- ✅ **テスト追加**: 左右別pdfIdのテストケースを追加し、`pdfsById`の内容を検証

**学んだこと**:
1. **複数PDF参照の必要性**: SPLITレイアウトで左右別PDFを表示するには、APIレスポンスに複数PDFの情報を含める必要がある
2. **レンダラーの疎結合化**: `renderSplitWithPanes`を追加することで、左右のペインの種類（PDF/工具）に応じて柔軟に描画できる
3. **後方互換性の維持**: `pdf`フィールドは先頭PDFスロット（LEFT）のPDF情報を返すことで、既存コードとの互換性を維持
4. **Web側の動的描画**: `layoutConfig`に基づいて動的にペインを描画することで、柔軟なレイアウトに対応可能

**解決状況**: ✅ **解決済み**（2026-01-08）

**実機検証結果**: ✅ **正常動作**（2026-01-08）
- SPLITレイアウト + 左pdf/右pdf: ✅ 正常
- 左右それぞれのPDFが独立してスライドショー表示されることを確認
- タイトルがPDF名から動的に生成されることを確認

**関連ファイル**:
- `apps/api/src/services/signage/signage.service.ts`（`pdfsById`フィールド追加）
- `apps/api/src/services/signage/signage.renderer.ts`（`renderSplitWithPanes`メソッド追加）
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`（`layoutConfig`準拠の2ペインSPLIT描画）
- `apps/web/src/api/client.ts`（型定義追加）
- `apps/api/src/routes/__tests__/signage.integration.test.ts`（テストケース追加）
- `docs/modules/signage/README.md`（仕様更新）

---

### [KB-155] CSVダッシュボード可視化機能実装完了

**実装日時**: 2026-01-08

**事象**: 
- Gmail経由でPowerAutomateから送信されたCSVファイルをサイネージで可視化表示する機能を実装
- `slot.kind=csv_dashboard`の実装が完了し、FULL/SPLITレイアウトでCSVダッシュボードを表示可能に

**実装内容**: 
- ✅ **データベーススキーマ**: `CsvDashboard`, `CsvDashboardIngestRun`, `CsvDashboardRow`テーブルを追加
- ✅ **CSVダッシュボード管理API**: CRUD操作、CSVアップロード、プレビュー解析エンドポイントを実装
- ✅ **Gmail連携**: 既存の`CsvImportScheduler`を拡張し、CSVダッシュボード用の取り込み処理を追加
- ✅ **データ取り込み**: `CsvDashboardIngestor`でCSV解析、重複除去/追加モード、日付列処理を実装
- ✅ **可視化レンダリング**: `CsvDashboardTemplateRenderer`でテーブル形式・カードグリッド形式のSVG生成を実装
- ✅ **サイネージ統合**: `SignageService`と`SignageRenderer`を拡張し、CSVダッシュボードをサイネージコンテンツとして表示可能に
- ✅ **管理コンソールUI**: `SignageSchedulesPage`にCSVダッシュボード選択UIを追加
- ✅ **データ保持期間管理**: 前年分保持、2年前削除、当年前月削除の自動クリーンアップを実装
- ✅ **ストレージ管理**: CSV原本ファイルの保存と保持期間管理を実装

**学んだこと**:
1. **環境変数の重要性**: `CSV_DASHBOARD_STORAGE_DIR`をデプロイ前に設定しないと、保存先が不明確になる
2. **Ansibleテンプレート管理**: 環境変数は`infrastructure/ansible/templates/docker.env.j2`に追加しないと、Ansible再実行時に消える
3. **DBマイグレーション**: 新テーブル追加のみのマイグレーションは安全だが、デプロイ前のバックアップは必須
4. **疎結合設計**: `layoutConfig`の設計により、新しいコンテンツ種別（CSVダッシュボード）を既存コードへの影響を最小限に追加可能

**解決状況**: ✅ **実装完了・CI修正・デプロイ完了**（2026-01-08: 実装完了、2026-01-09: CI修正・デプロイ完了）

**実機検証で発見された問題と修正**（2026-01-09）:
1. **CSVダッシュボードスロットの`csvDashboardId`が保持されない**: `routes/signage/schemas.ts`の`slotConfigSchema`で`csv_dashboard`用の設定が空オブジェクト（`z.object({})`）になっており、`csvDashboardId`がバリデーションで捨てられていた。専用スキーマを定義し、`csvDashboardId`を必須フィールドとして検証するように修正。すべてのスロット設定スキーマに`.strict()`を追加してキー消失を防止。
2. **手動アップロードでデータが取り込まれない**: `/api/csv-dashboards/:id/upload`エンドポイントがプレビューのみを返しており、実際のデータ取り込みを実行していなかった。`CsvDashboardIngestor.ingestFromGmail`を呼び出すように修正し、CSVファイルを保存してからデータを取り込むように変更。
3. **日付フィルタリングでデータが取得されない**: `getPageData`メソッドの日付計算でJST/UTCの変換が逆になっており、当日のデータが取得できなかった。サーバーがUTC環境で動作することを前提に、JSTの「今日の0:00」と「今日の23:59:59」をUTCに正しく変換するように修正。
4. **`displayPeriodDays`が`null`の場合のデフォルト値**: `buildScheduleResponse`と緊急情報のレスポンス構築で`displayPeriodDays`が`null`の場合のデフォルト値（`1`）が設定されていなかった。`?? 1`を追加してデフォルト値を設定。

**修正内容の詳細**:
- **スキーマ修正**: `apps/api/src/routes/signage/schemas.ts`で`csv_dashboard`用の`slotConfigSchema`を専用化し、`csvDashboardId`を必須フィールドとして定義。すべてのスロット設定スキーマに`.strict()`を追加。
- **手動アップロード修正**: `apps/api/src/routes/csv-dashboards/index.ts`の`/upload`エンドポイントを修正し、`CsvDashboardStorage.saveRawCsv`でCSVファイルを保存してから`CsvDashboardIngestor.ingestFromGmail`でデータを取り込むように変更。
- **日付フィルタリング修正**: `apps/api/src/services/csv-dashboard/csv-dashboard.service.ts`の`getPageData`メソッドを修正し、JSTの「今日の0:00」と「今日の23:59:59」をUTCに正しく変換するように変更。
- **nullチェック追加**: `apps/api/src/services/signage/signage.service.ts`の`buildScheduleResponse`と緊急情報のレスポンス構築で`displayPeriodDays ?? 1`を追加。

**実機検証結果**: ✅ **すべて正常動作**（2026-01-09）
- CSVダッシュボードスロットの`csvDashboardId`が正しく保持されることを確認
- 手動アップロードでデータが取り込まれることを確認（`rowsAdded: 3`）
- サイネージAPIレスポンスで`csvDashboardsById`にデータが含まれることを確認（`rowsCount: 6`）
- 日付フィルタリングが正しく動作し、当日のデータのみが表示されることを確認
- SPLITレイアウトで左にCSVダッシュボード・右にPDFが正常動作することを確認
- SPLITレイアウトで左にPDF・右にCSVダッシュボードが正常動作することを確認（UI修正後）

**実機検証で発見された問題と修正**（2026-01-09追加）:
1. **右スロットのCSVダッシュボード選択UIが未実装**: `SignageSchedulesPage.tsx`の右スロットドロップダウンに`csv_dashboard`オプションがなく、CSVダッシュボード選択UIも実装されていなかった。左スロットと同じ実装を追加して修正。
2. **管理コンソールに「CSVダッシュボード」タブが未実装**: 管理コンソールのナビゲーションメニューに「CSVダッシュボード」タブがなく、CSVダッシュボード管理ページにアクセスできなかった。`CsvDashboardsPage.tsx`を実装し、`App.tsx`にルートを追加、`AdminLayout.tsx`にナビゲーションリンクを追加して修正。

**検証9: 表示期間フィルタの検証結果**（2026-01-09）:
- ✅ **データベースのデータ**: 全10行（当日分8行、前日分2行）
- ✅ **サイネージAPIのレスポンス**: `rows`の長さが8行（当日分のみ）
- ✅ **表示期間フィルタの動作**: 当日分（`2026/1/9`）のみが表示され、前日分（`2026/1/8`）は除外されている
- ✅ **日付計算の正確性**: JSTの「今日の0:00」から「今日の23:59:59」をUTCに正しく変換（UTC `2026-01-08 15:00:00` 〜 `2026-01-09 14:59:59`）
- ✅ **検証方法**: テスト用CSVファイル（当日分2行、前日分2行）をアップロードし、サイネージAPIで当日分のみが返されることを確認

**CI修正とデプロイ完了**（2026-01-09）:
1. **E2Eテストのstrict mode violation修正**: `e2e/admin.spec.ts`で「ダッシュボード」リンクのセレクタが「CSVダッシュボード」リンクと重複マッチしていた問題を修正。`{ name: /ダッシュボード/i }`から`{ name: 'ダッシュボード', exact: true }`に変更して完全一致で検索するように修正。
2. **セキュリティ脆弱性対応**: `@remix-run/router@1.23.1`の脆弱性（XSS via Open Redirects）に対応し、`package.json`の`overrides`で`1.23.2`を強制。`pnpm-lock.yaml`も更新してCIの`pnpm audit --audit-level=high`が通過するように修正。
3. **GitHub Actions CI成功**: すべてのCIテスト（lint、API tests、Web tests、E2E tests）が通過し、CIが成功。
4. **デプロイ完了**: Pi5上で`feature/csv-dashboard-visualization`ブランチを`git pull`し、API/Webコンテナを`--force-recreate --build`で再ビルド・再起動。データベースマイグレーション実行（保留なし）、ヘルスチェック成功（API/Web共に正常動作）を確認。

**デプロイ時の注意事項**:
- **環境変数設定**: `CSV_DASHBOARD_STORAGE_DIR=/app/storage/csv-dashboards`を`infrastructure/docker/.env`に追加（デプロイ前に実施）
- **Ansibleテンプレート更新**: `infrastructure/ansible/templates/docker.env.j2`に`CSV_DASHBOARD_STORAGE_DIR`を追加（Ansible使用時）
- **DBマイグレーション**: マイグレーション`20260108145517_add_csv_dashboard_models`が自動適用される

**関連ファイル**:
- `apps/api/prisma/schema.prisma`（`CsvDashboard`, `CsvDashboardIngestRun`, `CsvDashboardRow`モデル）
- `apps/api/src/services/csv-dashboard/`（サービス層）
- `apps/api/src/routes/csv-dashboards/`（APIルート）
- `apps/api/src/routes/signage/schemas.ts`（スキーマ修正）
- `apps/api/src/services/signage/signage.service.ts`（サイネージサービス拡張、nullチェック追加）
- `apps/api/src/services/signage/signage.renderer.ts`（サイネージレンダラー拡張）
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`（管理コンソールUI拡張）
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx`（CSVダッシュボード管理ページ）
- `apps/web/src/App.tsx`（ルート追加）
- `apps/web/src/layouts/AdminLayout.tsx`（ナビゲーションリンク追加）
- `e2e/admin.spec.ts`（E2Eテスト修正）
- `package.json`（セキュリティ脆弱性対応）
- `docs/modules/signage/README.md`（仕様更新）

---

## サイネージ関連の残タスク

### 1. レイアウト設定機能の完成度向上（優先度: 中）

- **緊急表示（SignageEmergency）のlayoutConfig対応**: 管理コンソールUIで緊急表示のレイアウト設定を選択可能にする（`SignageEmergency`モデルに`layoutConfig`フィールドは追加済み）
- **スケジュールの一括編集機能**: 複数のスケジュールを選択して一括で有効/無効化、一括でレイアウト設定を変更
- **スケジュールのコピー機能**: 既存スケジュールをコピーして新規作成（レイアウト設定も含めてコピー）
- **スケジュールのプレビュー機能**: 管理コンソールでレイアウト設定のプレビューを表示（実際の表示イメージを確認可能に）

### [KB-156] 複数スケジュールの順番切り替え機能実装

**実装日時**: 2026-01-09

**事象**: 
- 複数のスケジュールが同時にマッチする場合、優先順位が最も高いスケジュールのみが表示され、他のスケジュールが表示されない
- 優先順位100（分割表示）と優先順位10（全画面表示）が同時にマッチする場合、優先順位100のみが表示され、優先順位10は表示されない

**要因**: 
- `signage.service.ts`の`getContent`メソッドで、マッチしたスケジュールを優先順位順にソートした後、最初の1つだけを返して終了していた
- 順番に切り替えるロジックが実装されていなかった

**実施した対策**: 
- ✅ **環境変数の追加**: `SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS`を追加（デフォルト: 30秒）
- ✅ **順番切り替えロジックの実装**: 複数のスケジュールがマッチする場合、優先順位順（高い順）にソートし、設定された間隔（デフォルト: 30秒）で順番に切り替えて表示
- ✅ **切り替え間隔の計算**: 現在時刻から切り替え間隔を計算し、どのスケジュールを表示するか決定
- ✅ **ドキュメント更新**: 優先順位の動作説明を更新し、複数スケジュールの順番切り替え機能を明記

**実装内容の詳細**:
- **環境変数**: `apps/api/src/config/env.ts`に`SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS`を追加（デフォルト: 30秒、範囲: 10-3600秒）
- **切り替えロジック**: `apps/api/src/services/signage/signage.service.ts`の`getContent`メソッドを修正
  - 複数のスケジュールがマッチする場合（`matchedSchedules.length > 1`）、現在時刻から切り替え間隔を計算
  - `currentSecond % (matchedSchedules.length * switchInterval) / switchInterval`でスケジュールインデックスを決定
  - 優先順位順（高い順）にソートされたスケジュール配列から、計算されたインデックスのスケジュールを選択
- **ログ出力**: 切り替えロジック実行時に`Schedule response built (rotating)`ログを出力し、`scheduleIndex`、`totalSchedules`、`switchInterval`を記録

**動作仕様**:
- 優先順位100（分割表示）と優先順位10（全画面表示）が同時にマッチする場合:
  - 0-29秒: 優先順位100（分割表示）
  - 30-59秒: 優先順位10（全画面表示）
  - 60-89秒: 優先順位100（分割表示）
  - 90-119秒: 優先順位10（全画面表示）
  - ...（繰り返し）

**学んだこと**:
1. **優先順位の意味**: 優先順位は「表示優先度（高いものだけ表示）」ではなく、「表示順序（高い順に順番に表示）」として実装する必要がある
2. **時間ベースの切り替え**: 現在時刻から切り替え間隔を計算することで、サーバー側で確実に切り替えを制御できる
3. **環境変数による設定**: 切り替え間隔を環境変数で設定可能にすることで、運用時の調整が容易になる

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了・実機検証完了**（2026-01-09）

**実機検証結果**: ✅ **正常動作**（2026-01-09）
- 優先順位100と優先順位10のスケジュールが同時にマッチする時間帯で、30秒ごとに交互に表示されることを確認
- ログに`Schedule response built (rotating)`が出力され、`scheduleIndex`が切り替わることを確認
- 優先順位100のスケジュールが正常に動作することを確認

**関連ファイル**:
- `apps/api/src/config/env.ts`（環境変数追加）
- `apps/api/src/services/signage/signage.service.ts`（順番切り替えロジック実装）
- `docs/modules/signage/README.md`（仕様更新）

---

### [KB-169] Pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動

**実装日時**: 2026-01-16

**事象**: 
- Pi3デプロイがメモリ不足で完了しない、または極端に遅い
- aptパッケージインストールやAnsibleタスクでswapが発生し、デプロイが数十分かかる
- デプロイ完了後に`signage-lite.service`が起動できない（lightdmが停止されているため）

**要因**: 
- Pi3はメモリが非常に限られている（総メモリ416MB、利用可能120MB程度）
- `lightdm`（GUIディスプレイマネージャー）が約100MBのメモリを消費
- `signage-lite.service`は`After=graphical.target`と`DISPLAY=:0`を必要とし、lightdmが停止していると起動できない
- clientロールの`services_to_restart`に`signage-lite.service`が含まれており、デプロイ中にサービス再起動を試みて失敗

**実施した対策**: 
- ✅ **preflight: lightdm停止**: `infrastructure/ansible/tasks/preflight-pi3-signage.yml`にlightdm停止タスクを追加。約100MBのメモリを確保（利用可能メモリ120MB→220MB）
- ✅ **signageロール: サービス起動スキップ**: lightdm停止時は`signage-lite.service`と関連タイマーの起動をスキップ（`when: lightdm_stopped is not defined or lightdm_stopped is not changed`）
- ✅ **clientロール: signage関連サービス除外**: lightdm停止時は`services_to_restart`からsignage関連サービスをフィルタリング（`services_to_restart_filtered`）
- ✅ **post_tasks: Pi3再起動**: デプロイ完了後にPi3を再起動（`ansible.builtin.reboot`）し、lightdmとsignage-lite.serviceを自動復活
- ✅ **再起動後の確認**: Pi3再起動後に`signage-lite.service`がactiveになることを確認するタスクを追加

**実装の詳細**:
1. **preflight**: `systemctl stop lightdm`でGUIを停止し、約100MBのメモリを確保
2. **signageロール**: `lightdm_stopped.changed`が`true`の場合、サービス起動タスクをスキップ
3. **clientロール**: `services_to_restart`から`signage-lite.*`にマッチするサービスを除外した`services_to_restart_filtered`を使用
4. **post_tasks**: `ansible.builtin.reboot`でPi3を再起動（タイムアウト120秒）
5. **確認タスク**: 30回のループで`systemctl is-active signage-lite.service`を確認（合計60秒待機）

**学んだこと**:
1. **lightdm停止の効果**: lightdm停止で約100MBのメモリを確保でき、デプロイが安定して完了する
2. **再起動による復活**: デプロイ後の再起動でlightdmとsignage-liteが正しい順序で自動起動する
3. **サービス依存関係**: `signage-lite.service`はlightdm（graphical.target）に依存しており、GUI環境なしでは起動できない
4. **Ansibleの変数スコープ**: preflightで設定した`lightdm_stopped`変数は後続のロールでも参照可能

**解決状況**: ✅ **解決済み**（2026-01-16）

**実機検証結果**: ✅ **デプロイ成功**（2026-01-16）
- `PLAY RECAP`: ok=101, changed=22, failed=0
- `signage-lite.service`: active
- 所要時間: 約10分

**関連ファイル**:
- `infrastructure/ansible/tasks/preflight-pi3-signage.yml`（lightdm停止タスク追加）
- `infrastructure/ansible/playbooks/deploy.yml`（post_tasksにPi3再起動タスク追加）
- `infrastructure/ansible/roles/signage/tasks/main.yml`（lightdm停止時のサービス起動スキップ）
- `infrastructure/ansible/roles/client/tasks/main.yml`（signage関連サービスのフィルタリング）
- `docs/guides/deployment.md`（Pi3デプロイ手順の自動化を反映）

---

### 2. サイネージのパフォーマンス最適化（優先度: 低）

- **画像キャッシュの改善**: レンダリング済み画像のキャッシュ戦略、キャッシュの無効化タイミング
- **レンダリング時間の最適化**: SVG生成の最適化、JPEG変換の最適化
- **エラーハンドリングの改善**: エラー時のフォールバック表示、エラーログの詳細化

---

---
