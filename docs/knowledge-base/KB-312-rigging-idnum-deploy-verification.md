---
title: KB-312 吊具マスター idNum（旧番号）追加・デプロイ・実機検証
tags: [吊具, マスター, キオスク, デプロイ, Prisma]
audience: [開発者, 運用者]
last-verified: 2026-03-24
category: knowledge-base
---

# KB-312: 吊具マスター `idNum`（旧番号）追加・デプロイ・実機検証

## Context

- **いつ**: 2026-03-24（実装は `main` へ先行マージ済み。本 KB はデプロイ実績・検証・運用知見の記録）
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
| キオスク | `/kiosk/rigging/borrow` … 吊具情報ブロックに **旧番号** 行（未設定時は `-`） |
| CSV | `rigging-gears.csv` に任意列 `idNum`（ヘッダー候補: `idNum`, `ID_num`, `旧番号`）。[csv-import-export.md](../guides/csv-import-export.md) 参照 |
| ワンショット | `apps/api/scripts/import-rigging.ts` … 列 `ID_num` を `idNum` に保存 |

## デプロイ実績（2026-03-24）

- **手順**: [deployment.md](../guides/deployment.md) 運用標準。Mac から `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <ホスト> --foreground`（**対象は Pi5 + kiosk の Pi4 のみ**。**Pi3 除外**、**1台ずつ順番**）
- **成功**:
  - `raspberrypi5`（サーバー）… デプロイサマリ・ヘルスチェックとも success
  - `raspberrypi4`（第2工場 kensakuMain キオスク）… 同上
- **未実施（別日再挑戦）**:
  - `raspi4-robodrill01` … preflight で **SSH `Connection timed out`**（inventory 上の Tailscale 先 `100.123.1.113:22`）。端末電源・Tailscale・ACL・現地ネットを確認のうえ、同コマンドで `--limit raspi4-robodrill01` のみ再実行

## 実機検証

### 自動確認（実施済み）

- Pi5 上 API: `GET https://<Pi5>/api/system/health` → **200**、`status: ok`（2026-03-24、運用ネットワークからの到達確認）

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

### RoboDrill01（`raspi4-robodrill01`）

- 上記は **デプロイ完了後** に同様に実施。先行して [KB-291](./infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md) の NFC 経路も合わせて確認するとよい

## Troubleshooting

| 症状 | 想定原因 | 対処 |
|------|-----------|------|
| `update-all-clients.sh` が即終了し「未commit変更」 | ローカル（または Pi5 実行時の作業ツリー）に未コミットがある | [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) … `git stash` / commit してから再実行 |
| `raspi4-robodrill01` が `UNREACHABLE` / SSH timeout | Tailscale オフライン、IP 変更、ファイアウォール | `tailscale status`、現地電源・LAN、[KB-281](./infrastructure/ansible-deployment.md) の到達不可時の `--limit` 切り分け |
| 旧番号を保存できない（409） | `idNum` の UNIQUE 衝突 | 既存レコードの `idNum` を確認し重複を解消 |
| キオスクに旧番号が出ない | 未デプロイ・ブラウザキャッシュ・マスタ未設定 | 対象 Pi4 のデプロイログ確認、`idNum` 入力済みか、強制リロード |

## Prevention

- 吊具まわりの仕様追加時は **DB マイグレーション + Zod + shared-types + 管理 UI + キオスク表示** をセットで追従する
- 複数 Pi4 がある場合は **inventory のホストを `--limit` で1台ずつ** デプロイし、ログで完了を確認してから次台へ
- Pi3 サイネージのみの変更でない限り、**Pi3 一括デプロイに混ぜない**（リソース僅少のため [deployment.md](../guides/deployment.md) の Pi3 専用手順に従う）

## References

- 実装（参考）: `apps/api/prisma/schema.prisma`（`RiggingGear.idNum`）、`apps/api/src/routes/rigging/schemas.ts`、`apps/api/src/services/rigging/rigging-gear.service.ts`、`apps/web/src/pages/tools/RiggingGearsPage.tsx`、`apps/web/src/pages/kiosk/KioskRiggingBorrowPage.tsx`
- [KB-267 吊具持出画面に吊具情報表示を追加](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加)
- [csv-import-export.md](../guides/csv-import-export.md)（吊具 CSV の `idNum`）
- [verification-checklist.md](../guides/verification-checklist.md)（6.4 / 6.6.3）
- [deployment.md](../guides/deployment.md)
