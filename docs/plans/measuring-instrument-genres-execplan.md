# 計測機器ジャンル化 ExecPlan

## Goal

キオスクの計測機器持出画面で、計測機器ごとの個別設定ではなく「ジャンル」単位で点検項目と画像を表示できるようにする。管理コンソールではジャンルの登録、画像1〜2枚の差し替え、ジャンル単位の点検項目管理を行えるようにする。

## Decisions

- 点検項目の所有者は `MeasuringInstrument` ではなく `MeasuringInstrumentGenre` とする。
- キオスクは選択機器からジャンルを解決し、ジャンル未設定または画像未登録時は明示エラーで持出不可にする。
- ジャンル画像は既存の storage 配信パターンを流用するが、Web 側は保護画像を Blob URL 化して表示し、`<img src>` の認証ヘッダ欠落を避ける。
- 初回移行では既存機器からジャンルをバックフィルし、既存点検項目は同一ジャンルへ引き継ぐ。

## Work Breakdown

- Prisma schema / migration / seed をジャンル中心へ更新する。
- API の service / route を、機器 CRUD・ジャンル CRUD・点検プロフィール取得・画像更新で責務分離する。
- Web の管理画面にジャンル管理ページを追加し、既存の計測機器管理画面はジャンル選択に縮退する。
- キオスク持出画面でジャンル名・点検項目・画像1〜2枚を同時表示する。
- ドキュメント、型定義、テストを更新する。

## Verification

- `pnpm --filter @raspi-system/api build`
- `pnpm --filter @raspi-system/web build`
- `pnpm test:postgres:start`
- `pnpm --filter @raspi-system/api exec prisma migrate deploy`
- `pnpm --filter @raspi-system/api test -- src/routes/__tests__/measuring-instruments.integration.test.ts src/services/measuring-instruments/__tests__/inspection-item.service.test.ts src/services/measuring-instruments/__tests__/measuring-instrument.service.test.ts`
- `pnpm test:postgres:stop`

## Status

- 完了。レビューで見つかった保護画像表示の認証欠落も、共通コンポーネント化で対処済み。

## 本番反映（2026-04-14）

- **ブランチ**: `feat/measuring-instrument-genres`（先端 `451074e3` 時点）
- **手順**: [deployment.md](../guides/deployment.md) の **1 台ずつ順番デプロイ**。`RASPI_SERVER_HOST=denkon5sd02@100.106.158.2` のうえ、`update-all-clients.sh` + `--limit` を **Pi5 → Pi4 研削メイン → RoboDrill01 → FJV60/80 → Kensaku StoneBase01** の順で実行（**Pi3 は本機能の必須対象外**）。
- **Detach Run ID**（`ansible-update-` 接頭辞）: `20260414-102948-25918`（Pi5）→ `20260414-105004-26771` → `20260414-105444-18459` → `20260414-105835-24001` → `20260414-110248-303`（各 `failed=0`）。
- **実機（自動）**: リポジトリ直下で `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **手動スポット**: 管理 **`/admin/tools/measuring-instrument-genres`** とキオスク計測機器持出で、ジャンル画像（Blob URL 経由）と点検項目の同時表示を確認。
