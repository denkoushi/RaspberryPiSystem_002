---
title: KB-312 吊具マスター idNum（旧番号）追加・デプロイ・実機検証
tags: [吊具, マスター, キオスク, デプロイ, Prisma]
audience: [開発者, 運用者]
last-verified: 2026-03-25
category: knowledge-base
---

# KB-312: 吊具マスター `idNum`（旧番号）追加・デプロイ・実機検証

## Context

- **いつ**: 2026-03-24 以降更新（実装は `main` へ先行マージ済み。本 KB はデプロイ実績・検証・運用知見の記録）。**2026-03-25**: 3 台すべてデプロイ成功後に Phase12 自動検証 **PASS 28/0/0**
- **目的**: 現行の管理番号（例: `K02A`）に加え、過去の数字3桁など**旧番号**を `idNum` として保持し、管理コンソールとキオスク吊具持出画面の双方で参照できるようにする
- **Pi3**: 本変更は**サイネージ（Pi3）非対象**。Pi3 専用デプロイ手順は不要（[deployment.md](../guides/deployment.md)「ラズパイ3（サイネージ）の更新」参照）

## 仕様（契約）

| 項目 | 内容 |
|------|------|
| DB | `RiggingGear.idNum` … `String?`、**NULL 可**、値があるときは **UNIQUE**（重複登録不可） |
| 現行キー | `managementNumber` は従来どおり一意・必須（変更なし） |
| API | `POST/PUT /api/rigging-gears` のボディに任意 `idNum`。空文字は `null` 正規化 |
| 一覧検索 | `GET /api/rigging-gears?search=` は **名称・管理番号・idNum** の部分一致（大文字小文字区別なし） |
| 管理 UI | `/admin/tools/rigging-gears` … フォーム「旧番号」、一覧「旧番号」列、検索プレースホルダ「名称・管理番号・旧番号で検索」 |
| キオスク | `/kiosk/rigging/borrow` … 吊具情報ブロックに **旧番号** 行（未設定時は `-`） / `/kiosk/tag` の持出一覧で吊具 **idNum** を表示（下記「持出一覧レイアウト」） |
| 持出一覧UI | `/kiosk/tag` の持出一覧カードから種別アイコン（📏/⚙️/🔧）を削除。吊具は **管理番号と同一行**に idNum の**値のみ**（プレフィックス「旧番号:」なし、未設定は `-`）。実装: `presentActiveLoanListLines` → `KioskReturnPage` |
| サイネージ | 持出カードで吊具のみ **旧番号** を表示（計測機器・工具は表示なし） |
| CSV | `rigging-gears.csv` に任意列 `idNum`（ヘッダー候補: `idNum`, `ID_num`, `旧番号`）。[csv-import-export.md](../guides/csv-import-export.md) 参照 |
| ワンショット | `apps/api/scripts/import-rigging.ts` … 列 `ID_num` を `idNum` に保存 |

## デプロイ実績（2026-03-24）

### 初回（idNum 一覧・サイネージ・マスタ周り）

- **手順**: [deployment.md](../guides/deployment.md) 運用標準。Mac から `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <ホスト> --foreground`（**対象は Pi5 + kiosk の Pi4 のみ**。**Pi3 除外**、**1台ずつ順番**）
- **成功**:
  - `raspberrypi5`（サーバー）… デプロイサマリ・ヘルスチェックとも success
  - `raspberrypi4`（第2工場 kensakuMain キオスク）… 同上
- **未実施（別日再挑戦）**:
  - `raspi4-robodrill01` … preflight で **SSH `Connection timed out`**（inventory 上の Tailscale 先 `100.123.1.113:22`）。端末電源・Tailscale・ACL・現地ネットを確認のうえ、同コマンドで `--limit raspi4-robodrill01` のみ再実行

### 追従（持出一覧レイアウト: 管理番号と idNum 同一行）

- **変更**: `main` の `4b8039c7`（Web のみ・静的プレビュー HTML 同梱）。吊具カードで idNum を名称下の別行から **管理番号行へ移動**（値のみ表示）。
- **手順**: 上記と同じく `update-all-clients.sh`。**2026-03-24 再デプロイ**で `raspberrypi5` → `raspberrypi4` は success。`raspi4-robodrill01` は **再び preflight SSH timeout**（先項と同じ切り分け）。

### 全台追従（2026-03-25）

- **手順**: [deployment.md](../guides/deployment.md) どおり `main` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01`** の順に `--limit` 1 台ずつ・`--foreground`。Pi3 は対象外。
- **結果**: 3 台ともデプロイサマリ・ポストヘルス **success**（例: RoboDrill 側ログ `logs/ansible-update-20260325-084123.log`）。
- **知見（fail-fast）**: `update-all-clients.sh` は **未追跡ファイル**（`git ls-files --others --exclude-standard`）でも停止する → **`git stash push -u`** で退避してから実行し、後で `stash pop`（[KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) と併記）。
- **知見（疎通）**: **Mac → Pi4（Tailscale）直**はタイムアウトしうるが、**Pi5 上から**は同じ Pi4 に ping/SSH 可能な場合がある（Tailscale ACL）。運用確認・切り分けは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)「Pi4/Pi3 サービス確認の接続経路」どおり **Pi5 経由**を正とする。

## 実機検証

### 自動確認（実施済み）

- Pi5 上 API: `GET https://<Pi5>/api/system/health` → **200**、`status: ok`（2026-03-24、運用ネットワークからの到達確認）
- **追従デプロイ後（2026-03-24）**: Tailscale 経由で `GET https://100.106.158.2/api/system/health` → **200**、`status: ok`（リモート自動確認。DB/memory 警告は既存の運用メッセージ）
- **Phase12 一括（2026-03-25）**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` → **PASS 28 / WARN 0 / FAIL 0**。API ヘルス・`deploy-status`（両 Pi4 キー）・`/tools/loans/active`・納期管理 API 群・サイネージ `layoutConfig`・Pi5 上 `backup.json` / `prisma migrate status`・**Pi5 経由**の Pi4×2 / Pi3 サービス `active`・`verify-services-real.sh` を包含。

### 運用手動確認（デプロイ済み Pi5 + raspberrypi4 を対象）

1. **マイグレーション**: Pi5 で `pnpm prisma migrate status` が最新であること（[deployment.md デプロイ後チェックリスト](../guides/deployment.md)）
2. **管理コンソール**（`https://<Pi5>/admin/tools/rigging-gears`）  
   - 旧番号を入力して登録・更新できること  
   - 一覧に「旧番号」列が出ること  
   - 検索で旧番号がヒットすること  
   - 同一 `idNum` を別レコードに付与すると API が **409（P2002）** 等で拒否されること
3. **キオスク吊具持出**（raspberrypi4）  
   - タグスキャン後、右ペインに **旧番号** が表示されること（未設定は `-`）  
   - [KB-267](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加) の既存項目（名称・管理番号・保管場所・荷重・寸法）が従来どおりであること
4. **キオスク持出一覧 / サイネージ**（raspberrypi4）  
   - `/kiosk/tag` の持出一覧で、計測機器・吊具・工具カードの絵文字アイコンが出ないこと  
   - 吊具カードで **管理番号と同一行**に idNum（**値のみ**、未設定は `-`。**「旧番号:」プレフィックスは持出一覧では付けない** ― 吊具持出画面 `/kiosk/rigging/borrow` のブロックは従来どおり「旧番号」ラベルあり）  
   - サイネージ持出カードでも吊具のみ旧番号が表示されること（API/SVG の表記は既存どおり）

### RoboDrill01（`raspi4-robodrill01`）

- 上記は **デプロイ完了後** に同様に実施。先行して [KB-291](./infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md) の NFC 経路も合わせて確認するとよい

## Troubleshooting

| 症状 | 想定原因 | 対処 |
|------|-----------|------|
| `update-all-clients.sh` が即終了し「未commit変更」 | ローカル（または Pi5 実行時の作業ツリー）に**未コミット・未追跡**がある | [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) … `git stash`（必要なら **`-u`**）/ commit してから再実行 |
| Mac から Pi4 Tailscale IP へ SSH が timeout | Tailscale ACL（Mac 直は不可・Pi5 経由は可 等） | 疎通・サービス確認は **Pi5 経由**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) セクション4）。デプロイは Pi5 上 Ansible のため経路は正しい |
| `raspi4-robodrill01` が `UNREACHABLE` / SSH timeout | Tailscale オフライン、IP 変更、ファイアウォール | `tailscale status`、現地電源・LAN、[KB-281](./infrastructure/ansible-deployment.md) の到達不可時の `--limit` 切り分け |
| 旧番号を保存できない（409） | `idNum` の UNIQUE 衝突 | 既存レコードの `idNum` を確認し重複を解消 |
| キオスクに旧番号が出ない | 未デプロイ・ブラウザキャッシュ・マスタ未設定 | 対象 Pi4 のデプロイログ確認、`idNum` 入力済みか、強制リロード |
| サイネージに旧番号が出ない | APIが旧レスポンス / レンダラ未更新 / キャッシュ | `GET /api/signage/content` の `tools[].idNum` を確認し、render-worker 再生成後に表示更新を確認 |
| 持出一覧で idNum が名称の下に残る | ブラウザキャッシュ・未デプロイの Pi4 | 対象 Pi4 で `update-all-clients.sh` ログ確認、キオスクで強制リロード（必要なら `kiosk-browser` 再起動） |
| 管理番号が長く idNum が折り返される | 仕様上 `flex-wrap` で折り返し可 | 狭いカード幅では2行になることがある。運用上問題なら `truncate` / 表示順の見直しを検討 |

## Prevention

- 吊具まわりの仕様追加時は **DB マイグレーション + Zod + shared-types + 管理 UI + キオスク表示** をセットで追従する
- 複数 Pi4 がある場合は **inventory のホストを `--limit` で1台ずつ** デプロイし、ログで完了を確認してから次台へ
- Pi3 サイネージのみの変更でない限り、**Pi3 一括デプロイに混ぜない**（リソース僅少のため [deployment.md](../guides/deployment.md) の Pi3 専用手順に従う）

## References

- 実装（参考）: `apps/api/prisma/schema.prisma`（`RiggingGear.idNum`）、`apps/api/src/routes/rigging/schemas.ts`、`apps/api/src/services/rigging/rigging-gear.service.ts`、`apps/web/src/pages/tools/RiggingGearsPage.tsx`、`apps/web/src/pages/kiosk/KioskRiggingBorrowPage.tsx`、`apps/web/src/features/kiosk/activeLoanListLines.ts`、`apps/web/src/pages/kiosk/KioskReturnPage.tsx`
- [KB-267 吊具持出画面に吊具情報表示を追加](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加)
- [csv-import-export.md](../guides/csv-import-export.md)（吊具 CSV の `idNum`）
- [verification-checklist.md](../guides/verification-checklist.md)（6.4 / 6.6.3 / 6.6.4）
- [deployment.md](../guides/deployment.md)
- [verify-phase12-real.sh](../../scripts/deploy/verify-phase12-real.sh)（Phase12 実機一括検証）
