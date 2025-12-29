---
title: トラブルシューティングナレッジベース - サイネージ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - サイネージ関連

**カテゴリ**: インフラ関連 > サイネージ関連  
**件数**: 10件  
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

---
