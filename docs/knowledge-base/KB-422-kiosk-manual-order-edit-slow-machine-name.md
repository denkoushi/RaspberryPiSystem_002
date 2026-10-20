---
title: KB-422 手動順番で「編集」後の一覧が重い（機種名の引き方）
tags: [kiosk, production-schedule, manual-order, api, performance]
audience: [開発者]
last-verified: 2026-10-20
category: knowledge-base
---

# KB-422: 手動順番で「編集」後の一覧が重い（機種名の引き方）

## Context

- 2026-10-20、#2179 で手動順番画面の「編集」押下後の再描画ループを直した後も、「動作が重いけど、待てば動く」という報告があった。
- 「編集」を押すと、その資源の生産スケジュール一覧（最大 400 行）を `GET /kiosk/production-schedule` で取り直す。

## 切り分け（2026-10-20 実測）

対象は資源 581（400 行に 184 製番）。API は本番 DB の読み取り専用 `EXPLAIN ANALYZE`、画面は vitest（jsdom、Mac）の React Profiler で測った。実機キオスクでは測っていない。

| 部分 | 時間 |
|---|---|
| 件数と 1 ページ分の行（並列） | 約 0.05〜0.15 秒 |
| **機種名の付与（100 製番ずつ 2 回、直列）** | **約 1.35 + 0.69 ≒ 2.0 秒**（一部は JIT） |
| 実績工数の読み込み | SQL 約 0.01 秒 |
| 顧客名 | ほぼ 0 |
| 画面の描画（400 行、jsdom） | 約 0.3 秒 + 注文番号の使用状況の到着後に約 0.08 秒 |

Pi5 の API ログでも同じ要求の応答は 2.2〜5.0 秒だった。重さの大半は API の機種名の付与。

## 原因

`resolveSeibanMachineDisplayNames` が、手動順番の全体像用の `fetchSeibanProgressRows`（製番ごとの件数、完了数、未完了品名の配列、完了判定の JOIN を含む集計）を流用し、その中の `machineName` だけを使っていた。必要なのは「winner 行のうち FHINCD が MH/SH の行の FHINMEI の最小値」だけなので、集計と JOIN は無駄だった。

## 対策

- `resolveSeibanMachineDisplayNames` は機種名だけを 1 回の SQL で引く（MH/SH・FHINMEI 空でない・winner 条件・製番で GROUP BY）。解決順は変えない（MH/SH 行の FHINMEI → 補完テーブル → 機種名未登録）。
- 本番 DB で新旧の結果を突き合わせ、機種名のある 180 製番で同一だった。
- 補完テーブルの機種名は前後の空白を落として使う（従来も行のある製番はそうしていた。行の無い製番だけ空白付きのまま返る可能性があった）。
- 機種名の付与は約 2.0 秒 → 約 0.05 秒（100 製番あたり 20〜70 ms。最終版の SQL は 23〜45 ms）。
- 画面側の 0.08 秒の再描画は、注文番号の選択肢が実データで変わるための必要な更新なので残した。

## 反映後の確認

- Pi5 の API ログで `/kiosk/production-schedule` の `responseTime` を、反映前（2.2〜5.0 秒）と比べる。
