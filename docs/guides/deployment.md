---
title: デプロイメントガイド
tags: [デプロイ, 運用, ラズパイ5, Docker]
audience: [運用者, 開発者]
last-verified: 2026-05-24
related: [production-setup.md, backup-and-restore.md, monitoring.md, quick-start-deployment.md, environment-setup.md, ansible-ssh-architecture.md]
category: guides
update-frequency: medium
---

# デプロイメントガイド

最終更新: 2026-05-24。**棚マスタ・未使用→確定で結合マス解放（`fix/kiosk-shelf-master-release-cells-on-unused`・**Web のみ**·**Pi5→Pi4×4 本番・実機 OK（自動）**）**·代表 **`14e164d6`**·CI **`26352095694` success**·Detach Pi5 **`20260524-135448-18222`** / Pi4 **`20260524-140937-1264`** / robodrill **`20260524-141535-31219`** / fjv60-80 **`20260524-142028-18972`** / StoneBase01 **`20260524-142526-8014`**（各 **`failed=0`**）·`verify-phase12-real.sh` **43/0/0**（Pi5 後約 **112s**）·shelf-master HTTP **200**·Pi5 HEAD **`14e164d6`**·[§未使用解放](#kiosk-shelf-master-unused-release-merged-cells-2026-05-24)·[KB-382 §未使用解放](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--unused-release-merged-cells-2026-05-24)。**棚マスタ・編集 Dialog ドック UX（確定統合・リセット·`feat/kiosk-shelf-layout-editor-dock-confirm-reset`・**Web のみ**·**Pi5 のみ本番先行**·Pi4×4 未）**·代表 **`ca45c479`**·CI **`26350715019` success**·Detach Pi5 **`20260524-123432-32158`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**（約 **111s**）·[§ドック UX](#kiosk-shelf-layout-editor-dock-confirm-reset-2026-05-24)·[KB-382 §ドック](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#layout-editor-dock-confirm-reset-2026-05)。**棚マスタ・Zero2W インライン割当 + オーファン preset 解除（`feat/kiosk-shelf-master-zero2w-inline-preset`・**Web+API→Web**·**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`55a50a7b`** / **`bd4ab988`**·CI **`26346833810`** / **`26348099235` success**·Detach Pi5 **`20260524-101500-26170`** / Pi4 **`20260524-103611-3552`** / **`20260524-104215-7888`** / **`20260524-104718-254`** / **`20260524-105219-1561`**（各 **`failed=0`**）·`verify-phase12-real.sh` **43/0/0**（約 **107–108s**）·[§Zero2W インライン+オーファン](#kiosk-shelf-master-zero2w-inline-orphan-2026-05-24)·[KB-382 §本番](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--zero2w-inline-orphan-2026-05-24)。**棚マスタ・複数マス結合後の選択解除（`fix/kiosk-shelf-master-multi-cell-selection`・**Web のみ**・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`6adc89f7`**·CI **`26332578527` success**·Detach Pi5 **`20260523-214122-22482`** / Pi4 **`20260523-215426-5450`** / robodrill **`20260523-220023-22658`** / fjv60-80 **`20260523-220513-20691`** / StoneBase01 **`20260523-221011-26349`**（各 **`failed=0`**）·`verify-phase12-real.sh` **43/0/0**（初回約 **113s**·**main 再検証** `655bbe8c` 後 **約 109s**）·shelf-master HTTP **200**·[§複数マス選択解除](#kiosk-shelf-master-multi-cell-selection-clear-2026-05-23)·[KB-382 §複数マス](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--multi-cell-selection-clear-2026-05-23)。**棚マスタ・区画 Dialog コンパクト化（`fix/kiosk-shelf-master-zone-dialog-compact`・**Web のみ**・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`2e73aeed`**·CI **`26329398253` success**·Detach Pi5 **`20260523-183552-18047`** / Pi4 **`20260523-184740-26602`** / robodrill **`20260523-185339-16025`** / fjv60-80 **`20260523-185841-7412`** / StoneBase01 **`20260523-190359-5547`**（各 **`failed=0`**）·`verify-phase12-real.sh` **43/0/0**·[§Dialog コンパクト](#kiosk-shelf-master-zone-dialog-compact-2026-05-23)·[KB-382 §コンパクト](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--zone-dialog-compact-2026-05-23)。**キオスク順位ボード・製番左縁アクセント全件無色（OR フィルタ時のみ色分け·方針 A·サイネージは24色維持·`feat/kiosk-leaderboard-seiban-accent-no-color-all-items`·**Pi5→Pi4×4 本番·実機 OK（自動）**）**·代表 **`44777ac7`**·Detach Pi5 **`20260522-211412-3634`** / Pi4 **`20260522-212202-22657`** / robodrill **`20260522-212817-24357`** / fjv60-80 **`20260522-213340-9415`** / StoneBase01 **`20260522-213908-14986`**（各 **`failed=0`**）·`verify-phase12-real.sh` **43/0/0**（約 **139s**）·[§全件無色](#kiosk-leaderboard-seiban-accent-no-color-all-items-2026-05-22)·[KB-297 §全件無色](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)。**キオスク順位ボード・行内順位ピッカー（製番順位 UI 統一·黄色アンカー·`feat/kiosk-leader-board-order-rank-picker`·**Pi5 のみ本番·実機 OK（自動+現場）**）**·代表 **`949eea9c`**·PR [#327](https://github.com/denkoushi/RaspberryPiSystem_002/pull/327)·CI **`26285460170` success**·Detach Pi5 **`20260522-204821-6687`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**（約 **116s**）·Pi4/Pi3 **no hosts matched**·[§行内順位ピッカー](#kiosk-leaderboard-row-order-rank-picker-2026-05-22)·[KB-297 §行内順位ピッカー](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-order-rank-picker-2026-05-22)。**キオスク順位ボード・手動順位付き行の背景ハイライト（案A改・Web + サイネージ SVG/API・`feat/kiosk-leader-board-manual-order-row-highlight`・**Pi5 のみ本番・実機 OK**）**·代表 **`3acf4c5a`**·CI **`26281606000` success**·Detach Pi5 **`20260522-192111-31816`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**（約 **96s**）·Pi4/Pi3 **no hosts matched**·[§手動順位行ハイライト](#kiosk-leaderboard-manual-order-row-highlight-2026-05-22)·[KB-297 §手動順位行ハイライト](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-manual-order-row-highlight-2026-05-22)。**キオスク順位ボード・資源CDスロット「順位」ボタン（製番順評価 ON 時・Web のみ・`feat/kiosk-leader-board-slot-auto-rank`・**Pi5 のみ本番・実機 OK**）**·代表 **`b74c54a9`**·CI **`26279773441` success**·Detach Pi5 **`20260522-183756-28111`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**（約 **74s**）·Pi4/Pi3 **no hosts matched**·[§スロット順位ボタン](#kiosk-leaderboard-slot-auto-rank-2026-05-22)·[KB-297 §スロット順位](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-slot-auto-rank-2026-05-22)。**吊具点検サイネージカード chrome 統一（点検のみも青・`fix/rigging-inspection-card-chrome-unify`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`cf8c13bf`**·CI **`26275892524` success**·Detach Pi5 **`20260522-174718-22503`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**（約 **85s**）·[§カード chrome 統一](#rigging-inspection-card-chrome-unify-2026-05-22)·[KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)。**吊具点検 dedup refresh · idNum 登録 · サイネージデザイン分離（`fix/loan-inspection-card-combined-mgmt-numbers`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`49386387`**·Detach Pi5 **`20260522-160832-6784`** / **`20260522-163138-380`**（`ok=134` `changed=4` `failed=0`）·`verify-phase12-real.sh` **43/0/0**·backfill **103 created / 7 refreshed / unmatchedGear 6**·加工担当 **18 件/10 名**·[§dedup refresh / デザイン分離](#rigging-inspection-dedup-refresh-signage-layout-2026-05-22)·[KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)。**吊具点検 A+B 氏名マッチ・サイネージマージ（`feat/rigging-inspection-name-match-signage-merge`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`7ba9306c`**·CI **`26271507686` success**·Detach Pi5 **`20260522-152051-25493`**（`ok=134` `changed=4` `failed=0`·Docker rebuild·**新規マイグレなし**）·`verify-phase12-real.sh` **43/0/0**（約 **28s**）·backfill **88 created / unmatchedEmployee 0**·[§A+B 氏名マッチ](#rigging-inspection-name-match-signage-merge-2026-05-22)·[KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)。**吊具点検 Gmail 統合・サイネージ（`feat/rigging-slings-inspection-gmail-signage`・**API+管理Web+サイネージ JPEG 正本**・**Pi5 のみ本番・実機 OK**）**·代表 **`283b414b`**·CI **`26267694608` success**·Detach Pi5 **`20260522-131701-20332`**（`ok=134` `changed=4` `failed=0`·Docker rebuild·**新規マイグレなし**）·`verify-phase12-real.sh` **43/0/0**（約 **31s**）·Pi4/Pi3 **no hosts matched**（**Pi3 専用手順未実施で正**）·[§吊具点検 Gmail](#rigging-slings-inspection-gmail-signage-2026-05-22)·[KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)。**キオスク沉浸式ヘッダー・下端中央1/3リビール（`feat/kiosk-bottom-center-header-reveal`・**Web+Ansible**・**Pi5→Pi4×4 本番・StoneBase01 実機 UI OK**）**·代表 **`cbeb6bbc`**·CI **`26262397906` success**（初回 E2E 失敗 **`26261933696`** → `cbeb6bbc` で修正）·Detach Pi5 **`20260522-101951-717`** / StoneBase01 **`20260522-102453-31642`** / Pi4 **`20260522-103026-4234`** / robodrill **`20260522-103521-10989`** / fjv60-80 **`20260522-103915-8240`**·`verify-phase12-real.sh` **43/0/0**·[§下端リビール](#kiosk-bottom-center-header-reveal-2026-05-22)·[KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)。**キオスク順位ボード・shell 選定 SQL 第2弾（`feat/kiosk-leaderboard-shell-sql-phase2`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`56490cfd`**·CI **`26257727724` success**·Detach Pi5 **`20260522-081052-2796`**·`verify-phase12-real.sh` **43/0/0**（約 **31s**）·Pi5 shell ベンチ **robodrill median ~4.9s（min ~3.0s）/ fjv median ~3.1s / stonebase median ~6.6s**·[§shell 第2弾](#kiosk-leaderboard-shell-sql-phase2-2026-05-22)·[KB-374 §shell 第2弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み)。**キオスク順位ボード・shell 初回最適化 第1弾（`feat/kiosk-shell-initial-opt-phase1`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`143c8814`**·CI **`26226698424` success**·Detach Pi5 **`20260521-221507-30100`**·`verify-phase12-real.sh` **43/0/0**（約 **64s**）·Pi5 shell ベンチ **robodrill ~3.0s / fjv ~3.1s / stonebase ~5.1s**·[§shell 第1弾](#kiosk-leaderboard-shell-initial-opt-phase1-2026-05-21)·[KB-374 §shell 第1弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-初回最適化-第1弾-api-のみ--2026-05-21--本番反映済み)。**キオスク順位ボード・continue chunk 80/160（`feat/kiosk-leaderboard-continue-chunk-160`・Web のみ・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`4471a444`**·CI **`26222962417` success**·Detach Pi5 **`20260521-203852-9936`** / StoneBase01 **`20260521-205337-26001`** / Pi4 **`20260521-205915-5232`** / robodrill **`20260521-210531-13345`** / fjv60-80 **`20260521-211045-27096`**·`verify-phase12-real.sh` **43/0/0**（約 **123s**）·Pi5 ベンチ **80 vs 160 全 profile 出力同値**·[§continue 80/160](#kiosk-leaderboard-continue-chunk-160-2026-05-21)·[KB-374 §continue 80/160](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-80160-実装web-のみ--2026-05-21--本番反映済み)。**サイネージ `kiosk_leader_order_cards`・ヘッダ加工機名の全文1行表示（`a2f9a2c5`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`a2f9a2c5`**·Detach Pi5 **`20260521-134013-4448`**·`verify-phase12-real.sh` **43/0/0**（約 **46s**）·**現場目視 OK**·[§ヘッダ加工機名全文](#signage-leader-order-header-full-machine-name-2026-05-21)·[KB-335 §ヘッダ](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。**サイネージ `kiosk_leader_order_cards`・5列×2段・最大/既定10（`feat/signage-leader-order-cards-5x2-grid-10`・**API+管理Web**・**Pi5 のみ本番・実機 OK**）**·代表 **`0fa2d065`**·CI **`26204469250` success**·Detach Pi5 **`20260521-131417-25249`**·`verify-phase12-real.sh` **43/0/0**（約 **28s**）·[§5×2 グリッド拡張](#signage-leader-order-cards-5x2-grid-10-2026-05-21)·[KB-335 §5×2](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。**サイネージ `kiosk_leader_order_cards`・納期表示修正（`fix/signage-leader-order-due-date-from-prisma-date`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`83501b27`**·CI **`26203259837` success**·Detach Pi5 **`20260521-123106-4810`**·`verify-phase12-real.sh` **43/0/0**（約 **27s**）·[§納期 Date 正規化](#signage-leader-order-due-date-prisma-date-2026-05-21)·[KB-335 §納期表示](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。**サイネージ `kiosk_leader_order_cards`・コンパクト＋未完のみ（`feat/signage-leader-order-cards-compact-incomplete`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`bdc25afb`**·CI **`26201804495` success**·Detach Pi5 **`20260521-114344-436`**·`verify-phase12-real.sh` **43/0/0**（約 **33s**）·[§コンパクト＋未完のみ](#signage-leader-order-cards-compact-incomplete-2026-05-21)·[KB-335 §コンパクト](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。**サイネージ `kiosk_leader_order_cards`・キオスク最新レイアウト整合（`feat/signage-leader-order-kiosk-aligned`・**API のみ**・**Pi5 のみ本番・実機 OK**）**·代表 **`7b54d992`**·CI **`26199566787` success**·Detach Pi5 **`20260521-104347-10606`**·`verify-phase12-real.sh` **43/0/0**（約 **27s**）·[§キオスク整合サイネージ](#signage-leader-order-kiosk-aligned-2026-05-21)·[KB-335 §キオスク整合](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。**キオスク順位ボード・continue chunk 80/80（`feat/kiosk-leaderboard-continue-chunk-80`・Web のみ・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`a2a3c960`** / CI fix **`12c94486`**·CI **`26195283245` success**·Detach Pi5 **`20260521-083210-21952`** / StoneBase01 **`20260521-085336-30539`** / Pi4 **`20260521-085933-4370`** / robodrill **`20260521-090422-2566`** / fjv60-80 **`20260521-090802-31639`**·`verify-phase12-real.sh` **43/0/0**·[§continue 80/80](#kiosk-leaderboard-continue-chunk-80-2026-05-21)·[KB-374 §continue 80/80](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-8080-実装web-のみ--2026-05-21--本番反映済み)。**キオスク順位ボード・資源内順位割当の自動解放（A+α・**API のみ**·**Pi5→Pi4×4 本番・実機 OK**）**·`feat/kiosk-order-assignment-auto-release-a-alpha`·**`8d2c582c`** / **`643e4f4b`**·CI **`26147609881` success**·Detach Pi5 **`20260520-164356-7722`** / **`20260520-174409-16528`** / StoneBase01 **`20260520-174713-7127`** / Pi4 **`20260520-180644-29504`** / robodrill **`20260520-181206-12995`** / fjv60-80 **`20260520-181622-32182`**·`verify-phase12-real.sh` **43/0/0**（約 **76–88s**）·[§A+α 自動解放](#kiosk-leaderboard-order-assignment-auto-release-a-alpha-2026-05-20)·[KB-297 §A+α](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)。**キオスク順位ボード・製番左縁アクセント 24 色（全件表示の識別性向上・Web のみ・**Pi5→Pi4×4 本番・実機 OK**）**·`feat/kiosk-seiban-accent-palette-24`·**PR [#307](https://github.com/denkoushi/RaspberryPiSystem_002/pull/307)**·**`main` `f8c1f6d2`**·実装 **`be936a6e`**·Detach Pi5 **`20260520-141147-19965`** / Pi4 **`20260520-141629-31940`** / robodrill **`20260520-142108-13167`** / fjv60-80 **`20260520-142440-24963`** / StoneBase01 **`20260520-142830-16409`**·`verify-phase12-real.sh` **43/0/0**（約 **31s**）·[§24色アクセント](#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20)·[KB-297 §24色](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-palette-24-2026-05-20)。**キオスク順位ボード・操作即表示 × 120秒キャッシュ両立（`feat/kiosk-leaderboard-mutation-instant-display`・Web のみ・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`0d97f0de`**·Detach Pi5 **`20260520-131334-15607`** / StoneBase01 **`20260520-131843-7879`** / Pi4 **`20260520-133253-2715`** / robodrill **`20260520-133748-7589`** / fjv60-80 **`20260520-134139-3491`**·[§操作即表示](#kiosk-leaderboard-mutation-instant-display-2026-05-20)·[KB-374 §操作即表示](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#操作即表示--120秒キャッシュ両立2026-05-20--featkiosk-leaderboard-mutation-instant-display)。**キオスク順位ボード・資源CDフッタチップ端末キャッシュ（`fix/kiosk-leaderboard-footer-chips-terminal-cache`・Web のみ・**Pi5→Pi4×4 本番・実機 OK**）**·代表 **`e24d5885`**·Detach Pi5 **`20260520-103202-24115`** / StoneBase01 **`20260520-103644-1806`** / Pi4 **`20260520-110912-15304`** / robodrill **`20260520-111402-16821`** / fjv60-80 **`20260520-111744-20691`**·`verify-phase12-real.sh` **43/0/0**·[§フッタチップ端末キャッシュ](#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20)·[KB-374 §フッタチップ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache)。**キオスク順位ボード・端末キャッシュ 120s 同期改訂（`feat/kiosk-leaderboard-cache-120s-swr-lock`・Web のみ・**Pi5 + StoneBase01 部分本番・実機 OK**）**·代表 **`76e265f2`**·CI **`26133411712` success**·Detach Pi5 **`20260520-095018-31166`** / StoneBase01 **`20260520-094455-29939`**·`verify-phase12-real.sh` **43/0/0**·[§120s 同期改訂](#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20)·[KB-374 §Phase 2 改訂](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock)。**キオスク順位ボード・端末キャッシュ Phase 1（`feat/kiosk-leaderboard-terminal-cache-phase1`・Web のみ）Pi5 のみ本番・Mac/Pi5 表示 OK**·Detach 初回 Pi5 **`20260519-203723-29020`**（`072054f9`·真っ白画面）/ fix **`20260519-205437-31528`**（`3ae93221`）·[§端末キャッシュ](#kiosk-leaderboard-terminal-cache-phase1-2026-05-19)·[KB-374 §端末キャッシュ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-1-indexeddb--裏同期2026-05-19--featkiosk-leaderboard-terminal-cache-phase1)。**Pi4×4 は未デプロイ**（IDB は端末ローカル）。**キオスク順位ボード・continue COUNT 再利用（第1弾・`perf/leaderboard-board-continue-reuse-totals`・API のみ）Pi5 のみ本番・現場 OK**·Detach Pi5 **`20260519-192007-12328`**·[§COUNT 再利用](#kiosk-leaderboard-continue-count-reuse-2026-05-19)。**キオスク順位ボード・装飾後取り+appendスコープ（`feat/kiosk-leaderboard-deferred-decorations-fast-initial`）Pi5→Pi4×4 本番反映・現場 OK**·Detach Pi5 **`20260519-172543-21009`** / Pi4 **`20260519-174536-24483`** / **`20260519-175108-2934`** / **`20260519-175540-20432`** / **`20260519-180012-22517`**·[§装飾後取り](#kiosk-leaderboard-deferred-decorations-fast-initial-2026-05-19)·[KB-374 §装飾後取り](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#装飾後取り--初回80continue40--append-スコープ2026-05-19--featkiosk-leaderboard-deferred-decorations-fast-initial)。**キオスク順位ボード・初回10/追補40（`feat/leaderboard-board-initial-10-continue-40`）は Pi5 のみ反映・Pi4 展開なし**（現場: **pageSize 80 より体感遅い**）·Detach Pi5 **`20260519-125903-25635`**。**先行完了**: **`deltaRows` + 表示安定化 + pageSize 80**（`feat/leaderboard-continue-delta-safe`）を Pi5→Pi4×4 へ順次反映・実機検証完了**（**Detach** Pi5 **`20260518-222320-4985`** / **`20260519-094525-13421`**·Pi4 **`20260519-095716-15636`** / **`20260519-100222-24882`** / **`20260519-100620-10211`** / **`20260519-101025-2757`**·**`verify-phase12-real.sh` PASS 43/0/0**·現場表示正常）。詳細は [§deltaRows](#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18)·[§表示安定化](#kiosk-leaderboard-display-stability-refetch-2026-05-19)·[§pageSize 80](#kiosk-leaderboard-pagesize-80-phase1-2026-05-19)·[KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#production-deploy--verification-2026-05-19--featleaderboard-continue-delta-safe)。**先行（2026-05-18）**: **Network Error 回復性（`fix/kiosk-leaderboard-networkerror-resilience`）本番5台**。対象ホストは **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`--limit`** で 1 台ずつ、標準 `update-all-clients.sh`）。**Detach**: **`20260518-193612-24083`** / **`20260518-194538-23622`** / **`20260518-195212-20827`** / **`20260518-195749-32736`** / **`20260518-200323-26959`**（いずれも **`PLAY RECAP failed=0` / `unreachable=0`**・リモート **`exit 0`**・`Summary success: true`）。**実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **68s**・Tailscale・Pi5 `100.106.158.2`・`deploy-status` 4 台 PASS）。**Pi3** は対象外で各 run の Pi3 play は **`no hosts matched`**（Pi3 専用手順は未適用で正）。詳細は [§2026-05-18 キオスク順位ボード Network Error 回復性](#kiosk-leaderboard-network-error-resilience-2026-05-18)。**先行の一行サマリ（2026-05-18 同日）**: **消滅母集団から `statusCode === 'X'` をコード上で明示除外（`C` と同列・メール由来完了のみ差分消失対象外）**・ブランチ **`fix/kiosk-completion-exclude-x-from-disappearance`**（機能 **`49d19dce`**·CI **`2170bb18`** — **API イメージ Trivy**: **`.trivyignore` `CVE-2026-4878`**（Debian **`libcap2`**）+ **`.github/workflows/ci.yml` の API スキャンに `trivyignores: '.trivyignore'`**）·**`raspberrypi5` のみ（1台・`--limit raspberrypi5`）**·**Detach `20260518-175005-7497`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 987s**·サマリ **`Git: changed`**·**`Docker restart summary: [{'status': 'ok'}]`**・**`prisma migrate deploy` / `status` `ok`**）·**`verify-phase12-real.sh` PASS 43 / WARN 0 / FAIL 0**（**`real` 約 81s**·Tailscale·Pi5 **`100.106.158.2`**）·Pi4／Pi3 play **no hosts matched**（**Pi3 専用手順は未実施で正**）。**完了後アラート**: `alerts/alert-20260518-175009.json`・`alerts/alert-20260518-180620.json`（**デタッチ正常終了でも作られ得る**・**正本は `PLAY RECAP` / `Summary success`**）。詳細は [§2026-05-18 `X` 除外の本番整合](#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18)。**先行の一行サマリ（2026-05-16）**: **生産日程CSV「消滅」外部完了・**正本Cの current keys**（本体 dedupe winner 由来のみを「現 winner」入力に採用。`FKOJUNST` メール側の FK 欠落だけでは current から落とさない）**・ブランチ **`feat/canonical-schedule-disappearance-current-keys`**（代表 **`09f06ebf`**·**CI `25956906908` success**·**`chore(ci): suppress current caddy trivy findings`** は **`0e327378`**）·**`raspberrypi5` のみ（1台）**·**Detach `20260516-181817-25397`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 286s**・サマリ **`Git: changed`**・**Docker 再起動はスキップ**・**`prisma migrate deploy` / `status` `ok`**）·**`verify-phase12-real.sh` PASS 43 / WARN 0 / FAIL 0**（約 **140s**·Tailscale·Pi5 **`100.106.158.2`**）·Pi4／Pi3 play **no hosts matched**（**Pi3 専用手順は未実施で正**）。詳細は [§2026-05-16 正本C・消滅 current keys](#schedule-csv-disappearance-canonical-current-keys-2026-05-16)。**先行の一行サマリ（2026-05-10 以前）**: 2026-05-10。**DGX メインAI 単一キュー・用途別 `/stop` 抑止・実験優先時の gateway 自動停止除外（Pi5 API のみ）** 先行本番: ブランチ **`feature/dgx-single-queue-stop-policy`**（代表 **`4d658897`**·**`main` マージ後は `main` HEAD**）·**`raspberrypi5` のみ**·**Detach `20260510-114418-29512`**（`PLAY RECAP` **`ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 559s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **130s**·Tailscale·Pi5 API `100.106.158.2`）·Pi4/Pi3 play **no hosts matched**（**Pi3 専用手順は未実施で正**）。**CI（機能先行）**: run **`25617712720`** **success**（`test(api): align local-llm on_demand route expectations`）。詳細は [§2026-05-10 DGX メインAI 単一キュー](#dgx-main-llm-single-queue-stop-policy-2026-05-10)。**KB-376 順位ボード・装飾の表示スコープとフッタ winner 整合（API のみ）** 先行本番: ブランチ **`feature/leaderboard-footer-winner-rearchitecture`**（代表 **`c2e7438a`**·**`main` マージ後は `main` HEAD**）·**`raspberrypi5` のみ**·**Detach `20260510-091316-7496`**（`PLAY RECAP` **`ok=134` `changed=4` `failed=0`**·`--follow` 約 **615s**）·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **57s**）·Pi4/Pi3 play **no hosts matched**（Web 未変更のため Pi4 台数デプロイ不要）。詳細は [§2026-05-10 KB-376](#leaderboard-footer-display-scope-winner-alignment-2026-05-10)。**KB-375 完了整合（`/completion` + intent・CSV 空 `progress` で手動完了を落とさない）** 本番反映: ブランチ **`fix/leaderboard-completion-integrity`**（代表 **`c063ab57`**）·**Pi5→Pi4×4 順次（1 台ずつ）**·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **74s**）·**Pi3 は対象外**（Ansible signage play **no hosts matched**・**Pi3 専用手順は未実施で正**）。詳細は [§2026-05-10 KB-375](#kiosk-leaderboard-completion-integrity-2026-05-10)。**直近の本番/実機（履歴一覧）**: ① **KB-376・フッタ winner / `>900` hydrate 境界（`feature/leaderboard-footer-winner-rearchitecture`・`raspberrypi5` のみ・上記 §KB-376）**。② **生産日程CSV「消滅」外部完了の母集団を「`FKOJUNST` 非C × `occurredAt` ±3ヶ月窓」へ再定義**（**`feature/external-completion-schedule-disappearance-non-c`**・下記 [#schedule-csv-disappearance-nonc-window-2026-05-09](#schedule-csv-disappearance-nonc-window-2026-05-09)）·**API のみ**·**`raspberrypi5` のみ**·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **190s**）。**Pi3 は対象外**（個別デプロイ不要）。③ **順位ボード・`FKOJUNST_Status` 完了行（`C`/`X`）の一覧再表示 + 左ペイン完了フィルタ既定 `all`**（**`fix/kiosk-leaderboard-completed-visibility`**・下記 [#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09](#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09)）·**API+Web**·**Pi5→Pi4×4 順次**·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **67s**）。**Pi3 は対象外**。④ **`leaderboard-board/continue` の `cursor` 契約（Zod 400 防止・API+Web）**（**`fix/kiosk-leaderboard-board-continue-cursor`**・下記 [#leaderboard-board-continue-cursor-contract-2026-05-09](#leaderboard-board-continue-cursor-contract-2026-05-09)）·**Detach `20260509-202031-28691` / `20260509-204430-26553`（ローカル採取）**·残り Pi4×3 は同一手順·`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**（約 **123s**）。⑤ **FKOJUNST_Status メール同期・winner 解決の 1-pass 化 + 外部完了 transaction timeout 延長**（2026-05-08 反映）を **`main` で再検証**（2026-05-09・`verify-phase12-real.sh` **PASS 42 / WARN 1 / FAIL 0**、WARN は `auto-tuning scheduler` ログ欠損で **PUT auto-generate=200** により代替判定）·**API のみ**·**Pi5 のみ**（下記「補足（2026-05-08 · FKOJUNST mail winner 解決最終 fix）」）。⑥ **CSVダッシュボード DEDUP 取込の `dataHash IN (...)` バインド上限対策（PostgreSQL 32767）**·**API のみ**·**Pi5 のみ**（下記「補足（2026-05-08 · CSV DEDUP バインド上限）」・**マージ後は `main`**）。⑦ **順位ボード・board 集約 API（`leaderboard-board` / `leaderboard-board/continue`・`fix/leaderboard-shell-bounded-filler-fetch`）**・**Pi5+Pi4 まで反映済（残りキオスク Pi4×3 は台帳上未完了）**（下記「補足（2026-05-08 · board 集約 API）」・**マージ後は `main`**）。⑧ **順位ボード・資源CDカード単位 phased（同一製番展開の条件付き無効化・`feature/kiosk-leaderboard-card-scope`）**・Pi5→Pi4×4 順次（下記「補足（2026-05-07 · カード単位）」・**マージ後は `main`**）。⑨ **順位ボード・continue の snapshot+cursor（`nextCursor` / `hasMore`・`snapshotId` + `cursor`）**・ブランチ先行 **`fix/leaderboard-cursor-snapshot`**・Pi5→Pi4×4 順次（下記「補足（2026-05-07 · snapshot+cursor）」・**マージ後は `main`**）。⑩ **順位ボード・サーバ内 snapshot（`snapshotId` / `snapshotExpired`）**・**`main`**（下記「補足（2026-05-07 · snapshot）」）。⑪ 順位ボード段階 **`leaderboard-shell/continue`（append）**・`main` 反映済み（下記「補足（2026-05-07 · append）」）。**従来の一行サマリ**は **`### 最終更新（履歴一覧・2026-05-07）`** を参照。

### 補足（2026-05-24 · **棚マスタ・編集 Dialog ドック UX**·**`feat/kiosk-shelf-layout-editor-dock-confirm-reset`**·**Web のみ**·**Pi5 のみ先行**） {#kiosk-shelf-layout-editor-dock-confirm-reset-2026-05-24}

- **背景**: 9 マス編集 Dialog の操作を **4 列ドック**に再編。**確定**で保存／Pi 反映／割当を統合。**リセット**は操作入力のみ初期化（ドラフト維持）。**選択マスを解除**ボタン廃止。プレビュー正本: [`kiosk-shelf-master-9grid-edit-popup-ux-preview.html`](../design-previews/kiosk-shelf-master-9grid-edit-popup-ux-preview.html)。[KB-382 §ドック UX](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#layout-editor-dock-confirm-reset-2026-05)。
- **変更概要（Web のみ）**:
  - **`ca45c479`**: [`ShelfLayoutEditorDock`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfLayoutEditorDock.tsx)·[`layoutEditorConfirmAction.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/flow/layoutEditorConfirmAction.ts)·`resetFlow` / `handleDeselectOnly`·オーファン **スキャナ割当解除** 表記。
  - **触らない**: API / Prisma / Pi3 / Zero2W 端末 Ansible。
- **代表コミット**: **`ca45c479`**
- **対象ホスト**: **`raspberrypi5` のみ（2026-05-24 時点）**。Pi4×4 は **未デプロイ**（Pi5 現場 OK 後に 1 台ずつ）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-shelf-layout-editor-dock-confirm-reset infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **本番デプロイ（実績·2026-05-24）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260524-123432-32158` | `ok=134` `changed=4` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **111s**）
- **HTTP / バンドル**: Pi5 上 `https://127.0.0.1/kiosk/mobile-placement/shelf-master` **200**·Web コンテナ JS に `resetFlow` / `選択解除` / `スキャナ割当解除` を確認（**ポート 8080 は未使用** — 本番 Web は **80/443**）
- **CI**: **`26350715019` success**
- **ローカル**: shelfMaster Vitest **43 PASS**·tsc · build PASS
- **現場手動（推奨）**: 4 列ドック·選択解除·リセット（ドラフト維持）·確定 1 本化·~~選択マスを解除~~ 無し — [KB-382 §現場手動](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--layout-editor-dock-2026-05-24)
- **トラブルシュート**:
  - **旧 UI** → Pi5 **`web` ref** が `ca45c479` 以降か·キオスク **強制リロード**
  - **Pi4 だけ旧** → **Pi5 先行**漏れ
  - **確定連打** → `isLayoutEditorConfirmPending` 未入りビルド — 再デプロイ
- **ナレッジ**: [KB-382 §ドック](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#layout-editor-dock-confirm-reset-2026-05)·[EXEC_PLAN.md](../../EXEC_PLAN.md)

### 補足（2026-05-24 · **棚マスタ・未使用→確定で結合マス解放**·**`fix/kiosk-shelf-master-release-cells-on-unused`**·**Web のみ**·**Pi5→Pi4×4**） {#kiosk-shelf-master-unused-release-merged-cells-2026-05-24}

- **背景**: 編集 Dialog で **複数マスに加工機割当** → 用途 **「未使用」** → **「確定」** 後も **結合ブロックのまま**（期待は **1マスずつ空マス**）。ドック UX（`ca45c479`）で廃止した ~~選択マスを解除~~ の代替経路の不具合。[KB-382 §未使用解放](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#unused-release-merged-cells-2026-05-24)。
- **根本原因**: 旧 `applyLayoutAssignment` の **`UNUSED` 分岐**が **`MACHINE` と同型**で結合 **`UNUSED` entity を新規作成**していた。正しくは [`releaseLayoutCells`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellRelease.ts)（選択マスから entity を剥がす）。
- **変更概要（Web のみ）**:
  - 新規 [`layoutCellRelease.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellRelease.ts) — **`releaseLayoutCells`** / `stripSelectedCells` / `clearAssignmentsOnCells`（deprecated）
  - [`layoutDraftActions.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutDraftActions.ts) — **`UNUSED` → `releaseLayoutCells` のみ**（`AISLE` / `MACHINE` / `SHELF` は従来）
  - Vitest: [`layoutCellRelease.test.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/__tests__/layoutCellRelease.test.ts) + [`layoutDraftActions.test.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/__tests__/layoutDraftActions.test.ts)（MACHINE→UNUSED 全解放·部分解放·AISLE 回帰）
  - **触らない**: API / Prisma / Pi3 / Zero2W Ansible
- **代表コミット**: **`14e164d6`**
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-shelf-master-release-cells-on-unused infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **本番デプロイ（実績·2026-05-24）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260524-135448-18222` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260524-140937-1264` | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | `20260524-141535-31219` | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | `20260524-142028-18972` | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260524-142526-8014` | `ok=129` `changed=10` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 後約 **112s**）
- **HTTP / ref**: `GET https://100.106.158.2/kiosk/mobile-placement/shelf-master` **200**·Pi5 `/opt/RaspberryPiSystem_002` **HEAD `14e164d6`**
- **CI**: **`26352095694` success**
- **ローカル**: shelfMaster Vitest **49 PASS**·lint · build PASS
- **現場手動（推奨）**: 複数マス加工機割当 → **未使用** → **確定** → **1マスずつ空マス**（結合ブロック残存なし）·**通路**は複数マス結合のまま（回帰）
- **トラブルシュート**:
  - **結合のまま** → Pi5 **`web` ref** `14e164d6` 以降·**強制リロード**
  - **Pi4 のみ** → **Pi5 先行**漏れ
  - **minify バンドルに関数名が無い** → 正常（**git ref + 手動 E2E** で判定）
- **ナレッジ**: [KB-382 §本番](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--unused-release-merged-cells-2026-05-24)·[EXEC_PLAN.md](../../EXEC_PLAN.md)

### 補足（2026-05-24 · **棚マスタ・Zero2W インライン割当 + オーファン preset 解除**·**`feat/kiosk-shelf-master-zero2w-inline-preset`**·**Pi5→Pi4×4**） {#kiosk-shelf-master-zero2w-inline-orphan-2026-05-24}

- **背景**: 編集 Dialog 右の Zero2W「棚番パイ」列を廃止し **Pi セレクト + 担当を反映** に統一（**`55a50a7b`**）。本番で **preset=地図外棚番**（例 `中央-南-03` / レイアウトは `中央-南-05` のみ）により **Pi グレーアウト・「担当なし」解除不能** → **地図外担当パネル**（**`bd4ab988`**）。[KB-382 §インライン](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#zero2w-inline-preset-2026-05-24)·[§オーファン](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#orphan-zero2w-preset-clear-2026-05-24)。
- **変更概要**:
  - **`55a50a7b`**: Web — 右レール削除·`zero2wPreset/` モジュール·`layoutEditorFlow` ゲート。API — `PUT preset-shelf` **`null` 解除**。
  - **`bd4ab988`**: Web のみ — [`orphanZero2wDevices.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/zero2wPreset/orphanZero2wDevices.ts)·[`ShelfZero2wOrphanPanel`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfZero2wOrphanPanel.tsx)。
  - **触らない**: Pi3 サイネージ·Zero2W Android 端末の Ansible（編集は Pi5/Pi4 キオスク + Pi5 API）。
- **代表コミット**: **`55a50a7b`** → **`bd4ab988`**
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-shelf-master-zero2w-inline-preset infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **本番デプロイ（実績·2026-05-24）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260524-101500-26170` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260524-103611-3552` | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | `20260524-104215-7888` | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | `20260524-104718-254` | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260524-105219-1561` | `ok=129` `changed=10` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 後·Pi4 全台後 各約 **107–108s**）
- **現場（ユーザー 2026-05-24）**: Pi5 オーファン **担当を外す** **OK** → Pi4 群デプロイ完了
- **CI**: **`26346833810`**（`55a50a7b`）·**`26348099235`**（`bd4ab988`）**success**
- **ローカル**: shelfMaster Vitest **37 PASS**（最終）·lint · build PASS
- **トラブルシュート**:
  - **panel が出ない** → 旧 SPA·Pi5 **`web` ref**·**強制リロード**
  - **グレーアウトだけ** → **仕様**（他棚担当）。解除は **panel** または正しい棚を選んで **担当を反映**
  - **Pi4 だけ旧 UI** → **Pi5 先行**漏れ
- **ナレッジ**: [KB-382 §本番](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--zero2w-inline-orphan-2026-05-24)·[EXEC_PLAN.md](../../EXEC_PLAN.md)

### 補足（2026-05-23 · **棚マスタ・複数マス結合後の選択解除**·**`fix/kiosk-shelf-master-multi-cell-selection`**·**Web のみ**·**Pi5→Pi4×4**） {#kiosk-shelf-master-multi-cell-selection-clear-2026-05-23}

- **背景**: レイアウト編集で **複数マスを結合割当**したあと、結合ブロックをタップしても選択されず **「選択マスを解除」が disabled**。[KB-382 §複数マス](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#multi-cell-selection-clear-2026-05-23)。
- **根本原因**: 旧 `useZoneLayoutDraft.toggleCell` が **`cells.length === 1` のみ**処理。割当後は `ShelfFactoryMapView` が結合 entity の **全 `cellIndices`** を渡すため **no-op**。
- **変更概要（Web のみ）**:
  - 新規 [`layoutCellSelection.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellSelection.ts) — **`toggleLayoutCellSelection`**（仕様 A: 結合ブロックは entity 単位で一括選択／全選択済みなら一括解除）
  - [`useZoneLayoutDraft.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/hooks/useZoneLayoutDraft.ts) が上記に委譲
  - Vitest: `layoutCellSelection.test.ts` **7** + `layoutDraftActions` 回帰
  - **触らない**: API / Prisma / Pi3
- **代表コミット**: **`6adc89f7`**
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-shelf-master-multi-cell-selection infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **本番デプロイ（実績·2026-05-23）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260523-214122-22482` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260523-215426-5450` | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | `20260523-220023-22658` | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | `20260523-220513-20691` | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260523-221011-26349` | `ok=129` `changed=10` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（初回約 **113s**）
- **main 再検証（2026-05-23 · `655bbe8c`）**: 同一スクリプト → **43/0/0**（約 **109s**）·デプロイ再実行なし·Pi4 `status-agent`×4 / Pi3 timer / `deploy-status`×4 **PASS**
- **HTTP**: `/kiosk/mobile-placement/shelf-master` **200**（Pi5 Tailscale）·`/api/system/health` **`ok`**
- **CI**: **`26332578527` success**（`6adc89f7`）
- **ローカル**: shelfMaster Vitest **24 PASS** · web test **582 PASS** · lint · build PASS
- **現場手動（推奨）**: 複数マス割当 → 結合ブロックタップで全マス選択 → **「選択マスを解除」** または再タップで解除
- **トラブルシュート**:
  - **解除できない** → 旧 SPA（**`6adc89f7` より前**）·Pi5 **`web`** ref·**強制リロード**
  - **Pi4 だけ旧挙動** → Pi5 未デプロイ — **必ず Pi5 先行**
- **ナレッジ**: [KB-382 §本番](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--multi-cell-selection-clear-2026-05-23)·[EXEC_PLAN.md](../../EXEC_PLAN.md)

### 補足（2026-05-23 · **棚マスタ・区画編集/再割当 Dialog コンパクト化**·**`fix/kiosk-shelf-master-zone-dialog-compact`**·**Web のみ**·**Pi5→Pi4×4**） {#kiosk-shelf-master-zone-dialog-compact-2026-05-23}

- **背景**: 棚レイアウトマスタ（9 マス俯瞰＋編集 Dialog）導入後、Pi4 実機で **factory-map はみ出し**・**ドック操作不能**。[KB-382](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md) §区画 Dialog コンパクト化。
- **変更概要（Web のみ）**:
  - 新規 [`ShelfMasterZoneDialogFrame.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfMasterZoneDialogFrame.tsx) — map/dock スロット・モーダル寸法・スクロール境界
  - [`ShelfZoneLayoutDialog.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfZoneLayoutDialog.tsx) / [`ShelfZoneRelocateDialog.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfZoneRelocateDialog.tsx) が Frame を利用
  - [`shelfMasterTheme.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/theme/shelfMasterTheme.ts) — Dialog 内 `factoryMap` を **`max-w-[26rem]` 正方形**に。俯瞰 9 マスは不変
  - [`Dialog.tsx`](../../apps/web/src/components/ui/Dialog.tsx) — 任意 `titleClassName`
  - **触らない**: API / DB / `layoutEditorFlow` / `zero2wAssignmentFlow` / `relocateFlow`
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**（**Pi5 `web` SPA 配信** + Pi4 **`kiosk-browser` 再起動**·**Pi3 専用手順は未実施で正**）
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-shelf-master-zone-dialog-compact infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **本番デプロイ（実績·2026-05-23）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260523-183552-18047` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260523-184740-26602` | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | `20260523-185339-16025` | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | `20260523-185841-7412` | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260523-190359-5547` | `ok=129` `changed=10` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 単独後・Pi4 全台後）
- **現場**: Pi5 実機検証 **OK** → Pi4×4 順次デプロイ完了（ユーザー 2026-05-23）
- **CI**: **`26329398253` success**（`2e73aeed`）
- **ローカル**: shelfMaster Vitest **16 PASS** · web lint · web build PASS
- **トラブルシュート**:
  - **Dialog が巨大・保存まで届かない** → 旧 SPA（**`2e73aeed` より前**）·Pi5 **`web`** ref·**強制リロード**（[verification-checklist §6.6.4](verification-checklist.md)）
  - **デプロイ拒否（未 push / dirty tree）** → `git push` + 未コミット変更を **stash** またはコミット
  - **Pi4 だけ旧 UI** → Pi5 未デプロイのまま Pi4 のみ — **必ず Pi5 先行**
- **ナレッジ**: [KB-382 §コンパクト](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--zone-dialog-compact-2026-05-23)·[design-previews/kiosk-shelf-master-edit-dialog-compact-preview.html](../design-previews/kiosk-shelf-master-edit-dialog-compact-preview.html)·[EXEC_PLAN.md](../../EXEC_PLAN.md)

### 補足（2026-05-23 · **棚レイアウトマスタ機能（API+Web+マイグレ）**·**`feat/kiosk-shelf-layout-master`**） {#mobile-placement-shelf-layout-master-2026-05-23}

- **概要**: `/kiosk/mobile-placement/shelf-master` にレイアウト編集・再割当・Zero2W 担当棚（編集 Dialog 右）を集約。**API**: `shelf-layout` / `relocate` / `client-capabilities`。**Pi5 Docker** に `shelf-layout-core` ビルド必須。
- **代表コミット**: **`17c9ea6d`** → Docker/CI fix → **`a7f23c8a`**（ヘッダタブ）→ **`9a1af348`**（棚番パイ Dialog 統合）
- **デプロイ実績（抜粋）**: Pi5 **`20260523-110553-14539`** / StoneBase01 **`20260523-112124-29513`** / Pi5 棚番パイ **`20260523-175452-20534`**（各 `failed=0`）
- **正本**: [KB-382](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md)·[ADR-20260523](../decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)

### 補足（2026-05-22 · **キオスク順位ボード・製番左縁アクセント — 全件表示は無色（OR フィルタ時のみ色分け）**·**方針 A**·**`feat/kiosk-leaderboard-seiban-accent-no-color-all-items`**·**Web のみ**·**Pi5→Pi4×4**） {#kiosk-leaderboard-seiban-accent-no-color-all-items-2026-05-22}

- **背景**: [§24色（2026-05-20）](#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20) で全件表示の左縁を **24 色ハッシュ**に拡張したが、現場では **色が多すぎて識別できない**。**登録製番 OR フィルタ ON（~5 件）** では **リスト順の色分け**で十分。
- **Decision（方針 A）**: **キオスク Web のみ** — **全件表示（`activeQueries` 空）= 左縁なし**。**OR フィルタ ON = [§24色](#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20) どおり現状維持**。**サイネージ JPEG**（`kiosk_leader_order_cards`）は **変更しない**（常にハッシュ 24 色）。
- **変更概要（Web のみ）**:
  - [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) — `resolveSeibanAccentRowClass`: **`filters.length === 0` → `undefined`**（2026-05-20 までのハッシュ `% 24` 返却を撤回）。
  - [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) — `seibanAccentRowClass` 無し時 **`px-2`**（左縁ボーダーなし）。
  - **触らない**: API / DB·[`leader-order-seiban-accent-palette.ts`](../../apps/api/src/services/signage/leader-order-cards/leader-order-seiban-accent-palette.ts)（サイネージ）。
  - **回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts) **6 PASS**。
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**（**Pi5 `web` SPA 配信** + Pi4 **`kiosk-browser` 再起動**·**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後**）。
- **本番デプロイ（実績·2026-05-22）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260522-211412-3634` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260522-212202-22657` | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | `20260522-212817-24357` | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | `20260522-213340-9415` | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260522-213908-14986` | `ok=129` `changed=10` `failed=0` |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 139s**·Tailscale·Pi5 API `100.106.158.2`·**`deploy-status` Pi4×4 PASS**）。
- **知見**:
  - **「色を増やす」より「絞ったときだけ色」** — 全件表示の視覚ノイズ低減。
  - **24 色パレット列挙は残す** — OR フィルタ 9 件以上・リスト外製番のフォールバック用。
  - **キオスク全件無色 vs サイネージ 24 色** — **意図的分岐**（サイネージに OR フィルタ UI なし）。
  - **Pi5 `web` 再ビルド必須** — Pi4 単体デプロイだけでは SPA 更新されない。
- **トラブルシュート**:
  - **全件表示で左縁色が付く** → 旧 SPA（**`44777ac7` より前**）·Pi5 **`web`** ref·**強制リロード**（[verification-checklist §6.6.4](verification-checklist.md) / **§6.6.28**）。
  - **OR フィルタ ON なのに無色** → チップ未押下（`OR検索: なし`）·製番空行。
  - **サイネージだけ色がある** → **仕様**（方針 A）。
  - **§6.6.23「全件で色種類増」** → **2026-05-22 以降は §6.6.28 を正**とする。
- **ナレッジ**: [KB-297 §全件無色](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)·[verification-checklist §6.6.28](verification-checklist.md#kiosk-leaderboard-seiban-accent-no-color-all-items-verification-2026-05-22)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·[§24色（履歴）](#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20)。

### 補足（2026-05-22 · **キオスク順位ボード・手動順位付き行の背景ハイライト（案A改）**·**Web + API（`kiosk_leader_order_cards` SVG）**·**`raspberrypi5` のみ**） {#kiosk-leaderboard-manual-order-row-highlight-2026-05-22}

- **背景**: スロット「順位」ボタンや手動ドロップダウンで **`processingOrder` を付与した行**が、未完行の中で視覚的に埋もれやすい。**案A**: 行ブロックのみ背景を少し明るくする（資源CDカード全体は変更しない）。
- **変更概要（Web + API SVG）**:
  - **条件**: **`processingOrder != null` かつ未完**（`!row.isCompleted`）。**完了行**は従来どおり **`opacity-50 grayscale`** のみ（ハイライト対象外）。
  - **色**: キオスク **`bg-slate-600/82`**（Tailwind）。サイネージ SVG **`rgba(71, 85, 105, 0.82)`**（`LEADER_ORDER_SVG_ROW_BG_RANKED`）。案A初稿 `slate-700/82` より **やや明るく**調整済み。
  - **Web**: [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) — `hasManualOrder` で行背景切替。
  - **API / サイネージ**: [`leader-board-pure.ts`](../../apps/api/src/services/signage/leader-order-cards/leader-board-pure.ts) の **`SignageLeaderOrderSvgRow.hasManualOrder`** → [`leader-order-cards-svg-schedule-row.ts`](../../apps/api/src/services/signage/leader-order-cards/leader-order-cards-svg-schedule-row.ts) で行矩形背景切替。[`leader-order-cards-svg-theme.ts`](../../apps/api/src/services/signage/leader-order-cards/leader-order-cards-svg-theme.ts) に定数追加。
  - **触らない**: DB マイグレーションなし·Pi4 キオスク Ansible·Pi3 サイネージ playbook（**Pi5 のみ**で `web` + `api` JPEG 正本を更新）。
  - **プレビュー**: [leader-board-manual-order-row-highlight-preview.html](../design-previews/leader-board-manual-order-row-highlight-preview.html)（静的 HTML·案A改）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi5 `web` SPA 配信** + **Pi5 `api` サイネージ JPEG 正本**·**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leader-board-manual-order-row-highlight infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績・2026-05-22）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260522-192111-31816`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 816s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）。
- **CI**: GitHub Actions **`26281606000` success**（代表 **`3acf4c5a`** — `feat: highlight manually ranked rows on leader order board`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 96s**·Tailscale·Pi5 API `100.106.158.2`·**サイネージ `current-image` 含む**）。
- **知見**:
  - **キオスクとサイネージで条件・色を揃える**が、表示経路が異なるため **Web / SVG で判定式が重複**（境界ごとに許容。共有は `leader-board-pure` の `hasManualOrder` のみ SVG 側）。
  - **Pi4 単体デプロイ不要** — Pi4 キオスクは Pi5 **`kiosk_full_url`** 経由で SPA を読む。サイネージ Pi3 は Pi5 API の JPEG をポーリング。
  - **強制リロード** — 反映直後は [verification-checklist.md](verification-checklist.md) §6.6.4。サイネージは **`slideIntervalSeconds`** 待ちまたは Pi5 **`SIGNAGE_RENDER_DIR`** 更新を確認。
- **トラブルシュート**:
  - **キオスクでハイライトが出ない** → 当該行が **順位未設定** または **完了**·Pi5 **`web`** ref（**`3acf4c5a` 以降**）·**強制リロード**。
  - **サイネージだけ変わらない** → Pi5 **`api`** 未更新（Pi3 デプロイでは直らない）·Detach 上記 runId·**`Git: changed`**。
  - **完了行まで明るい** → **`isCompleted` 判定**·旧バンドル（ref 確認）。
- **ナレッジ**: [KB-297 §手動順位行ハイライト](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-manual-order-row-highlight-2026-05-22)·[KB-335 §手動順位行ハイライト](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[verification-checklist §6.6.26](verification-checklist.md#kiosk-leaderboard-manual-order-row-highlight-verification-2026-05-22)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。**キオスク最終 UI** は [§行内順位ピッカー](#kiosk-leaderboard-row-order-rank-picker-2026-05-22) を正とする。

### 補足（2026-05-22 · **キオスク順位ボード・行内順位ピッカー（製番順位 UI 統一）**·**`feat/kiosk-leader-board-order-rank-picker`**·**Web のみ**·**`raspberrypi5` のみ**） {#kiosk-leaderboard-row-order-rank-picker-2026-05-22}

- **背景**: [§手動順位行ハイライト（初回）](#kiosk-leaderboard-manual-order-row-highlight-2026-05-22) の **行背景案**は、(1) Tailwind **`/82` 未生成**（[KB-297 §Tailwind `/82`](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-tailwind-opacity-82-pitfall-2026-05-22)）→ (2) **`/[0.82]` 修正後も実機で明るすぎ** → **順位 UI のみ**強調へ pivot。
- **変更概要（Web のみ）**:
  - **`<select>` 廃止**: [`LeaderOrderRowOrderSelect.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderRowOrderSelect.tsx) を **アンカーボタン + Portal 縦リスト**に変更（左ペイン [`LeaderBoardSeibanRankPicker`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanRankPicker.tsx) と **共通** [`LeaderBoardRankPickerDropdown`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardRankPickerDropdown.tsx)）。
  - **行背景**: 常に **`bg-slate-800/80`**（`LeaderOrderResourceRow` — 行全体ハイライト **なし**）。
  - **アンカー寸法**: **`h-7 w-14 px-1.5`**（旧 select と同一 — **カードサイズ不変**）。
  - **順位 1–10**: **`border-yellow-400` + `text-sm font-semibold text-yellow-300`**。**「-」**: 白枠·白文字 **`text-[11px]`**。
  - **リスト**: 先頭 **「-」** + `availableProcessingOrderOptions`（emerald 選択行·製番順位と同 UI）。
  - **触らない**: API·DB·サイネージ SVG 行背景（`LEADER_ORDER_SVG_ROW_BG_RANKED` は [§手動順位行](#kiosk-leaderboard-manual-order-row-highlight-2026-05-22) のまま）。
  - **プレビュー**: [leader-board-ranked-order-select-highlight-preview.html](../design-previews/leader-board-ranked-order-select-highlight-preview.html)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **本番デプロイ（実績·2026-05-22）**: **Detach** **`20260522-204821-6687`**（**`ok=134` `changed=4` `failed=0`**·`--follow` 約 **461s**）。
- **CI**: **`26285460170` success**（代表 **`949eea9c`** — PR [#327](https://github.com/denkoushi/RaspberryPiSystem_002/pull/327)）。
- **実機**: `verify-phase12-real.sh` **43/0/0**（約 **116s**）·**現場目視 OK**（2026-05-22）。
- **トラブルシュート**:
  - **旧 `<select>` のまま** → Pi5 **`web`** ref **`949eea9c` 以降**·§6.6.4 強制リロード。
  - **行全体がまだ明るい** → 旧 **`3acf4c5a`/`f976bdd8`** バンドル。正は **行背景一定**。
  - **サイネージと見え方が違う** → **仕様**（SVG=行背景·キオスク=黄色アンカー）。
- **ナレッジ**: [KB-297 §行内順位ピッカー](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-order-rank-picker-2026-05-22)·[verification-checklist §6.6.27](verification-checklist.md#kiosk-leaderboard-row-order-rank-picker-verification-2026-05-22)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **キオスク順位ボード・資源CDスロット「順位」ボタン（製番順評価 ON 時）**·**`feat/kiosk-leader-board-slot-auto-rank`**·**Web のみ**·**`raspberrypi5` のみ**） {#kiosk-leaderboard-slot-auto-rank-2026-05-22}

- **背景**: 現場リーダーは **納期メール → 製番順評価 ON で登録製番を並べ → 各資源CDスロット内の行へ順位を付与** する。**1行ずつドロップダウン**は操作回数が多い。
- **変更概要（Web のみ）**:
  - **表示**: **製番順評価 ON** のときのみ、各 **資源CDカードタイトル行右端**に **「順位」** ボタン（[`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx)）。
  - **動作**: 押下で **表示順の上から** 当該 `resourceCd` の **`processingOrder == null` の未完行**（最大 **5 行**）へ、**`order-usage` 未使用番号（1–10）を昇順**に付与（例: 1,2 済 → 3,4,5,6,7）。**既存順位は維持**（未設定行のみ）。**完了行**は対象外（既定 **`completionFilter: incomplete`**）。
  - **無効条件**: **`listIncomplete`**（スロット未完のみ表示）·付与対象 0 件·**空き番 0**·実行中（`isPending`）。
  - **実装**: 純関数 [`buildLeaderBoardAutoRankAssignments.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardAutoRankAssignments.ts) → 直列 PUT [`applyLeaderBoardAutoRankAssignments.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/applyLeaderBoardAutoRankAssignments.ts)（既存 **`updateOrderAsync`** / `PUT …/:rowId/order`）。Hook: [`useLeaderBoardSlotAutoRank.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardSlotAutoRank.ts)。定数 **`LEADER_BOARD_AUTO_RANK_MAX_ASSIGNMENTS = 5`**。
  - **却下**: **`buildReorderPlan`（全 clear→再付与）** は要件と不一致のため未採用。
  - **API / DB / `search-state`**: **変更なし**。手動ドロップダウンと **完全共存**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi5 `web` SPA 配信**・**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leader-board-slot-auto-rank infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績・2026-05-22）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260522-183756-28111`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 368s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）。
- **CI**: GitHub Actions **`26279773441` success**（代表 **`b74c54a9`** — `feat: add slot auto-rank action to leaderboard`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale·Pi5 API `100.106.158.2`）。
- **知見**:
  - **製番順評価**は **表示ソートのみ**（端末ローカル）。**「順位」ボタン**は **`processingOrder`（DB・工場共有）** を書く — 左ペインの製番並びと混同しない。
  - **1回最大 5 件**は **`order-usage` の空き番枯渇**と **誤一括付与**の両方を抑える現場合意値。
  - **`listIncomplete` 時は無効** — 部分表示スロットへの一括付与を避ける。
- **トラブルシュート**:
  - **ボタンが見えない** → **製番順評価 OFF**·Pi5 **`web`** ref（**`b74c54a9` 以降**）·**強制リロード**（[verification-checklist.md](verification-checklist.md) §6.6.4 / §6.6.25）。
  - **押しても付与されない** → **空き番なし**（[`order-usage`](../../apps/api/src/routes/kiosk/production-schedule/order-usage.ts) 確認）·**対象行がすべて順位済み/完了**·**`listIncomplete` ON**。
  - **付与番号が飛ぶ** → **`order-usage` は DB 全割当**（非表示行の幽霊割当）。**A+α 自動解放**後も **次回 FKOJUNST/CSV 同期**まで残り得る（[KB-297 §A+α](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)）。
- **ナレッジ**: [KB-297 §スロット順位](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-slot-auto-rank-2026-05-22)·[verification-checklist §6.6.25](verification-checklist.md#kiosk-leaderboard-slot-auto-rank-verification-2026-05-22)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **吊具点検サイネージカード chrome 統一（点検のみも青）**·**API のみ**·**`raspberrypi5` のみ**） {#rigging-inspection-card-chrome-unify-2026-05-22}

- **変更概要（正本 [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)）**:
  - **症状**: Gmail CSV 投影の **点検のみ**従業員はダークカード、キオスク **Loan あり**（石井さん型）は青カード — **データ源ではなく chrome 判定**（`activeLoanCount>0 || returnedLoanCount>0`）の差。
  - **Fix**: `resolveRiggingHasVisibleLoanState` — **Loan または当日 `点検件数>0`** で青 chrome。**`render-loan-inspection-board` に optional hook**·**吊具 renderer のみ注入**·**MI は従来**。
  - **据え置き**: ヘッダ **`貸出中 N ・ 返却 M`** は Loan 実績のまま（点検のみは `0 ・ 0`）。
  - **触らない**: DB マイグレーションなし·Pi4 キオスク Web·Pi3 サイネージ playbook（**Pi5 のみ**）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 / Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/rigging-inspection-card-chrome-unify infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績·2026-05-22）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | `20260522-174718-22503` | ok=134 changed=4 failed=0 | **Docker rebuild**·`Git: changed`·`prisma migrate deploy` / `status` **ok** |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**·Tailscale·Pi5 **`100.106.158.2`**）。**サイネージ API**（`current-image`·Pi3 x-client-key）含む。
- **トラブルシュート**:
  - **CSV 点検者だけダーク** → Pi5 **`api`** が **`cf8c13bf` 以降**か·Detach 上記 runId·**`Git: changed`**。
  - **MI カード見た目が変わった** → hook は **吊具 renderer のみ**（共有 `layout-body` ではない）。
- **ナレッジ**: [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **吊具点検 Gmail 統合・サイネージ**·**API + 管理 Web + サイネージ JPEG 正本**·**`raspberrypi5` のみ**） {#rigging-slings-inspection-gmail-signage-2026-05-22}

- **変更概要（正本 [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)）**:
  - **境界**: `apps/api/src/services/rigging/inspection/` — `RiggingGearResolver`（`control_num` → `managementNumber` 優先・なければ `idNum`）·`RiggingInspectionDedupPolicy`（管理番号 + JST 業務日 + 氏名）·`RiggingInspectionProjectionService`（Gmail ingestRun → `RiggingInspectionRecord`）·`RiggingBorrowInspectionOrchestrator`（キオスク `borrow` 成功後 PASS·best-effort）。
  - **CsvDashboard**: 固定 ID **`c4e8a1b2-3d6f-7890-abcd-ef1234567891`**·Gmail 件名 **`slingsInspectionRecord_PowerApps`**·postIngest 配線·builtin schedule **`csv-import-rigging-slings-inspection-powerapps`**（cron `0 * * * *`·**既定 `enabled: false`**）。
  - **サイネージ**: `rigging_loan_inspection` DataSource/Renderer（共有 `loan-inspection-card`·計測機器点検可視化と同デザイン）·管理 UI「吊具点検可視化プリセット」·`SignageSchedulesPage` **`[吊具点検]`** optgroup。
  - **触らない**: **DB マイグレーションなし**·Pi4 キオスク Web·Pi3 サイネージ playbook（**Pi5 のみ**で API/Web JPEG 正本を更新）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/rigging-slings-inspection-gmail-signage infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | `20260522-131701-20332` | ok=134 changed=4 failed=0 | **Docker rebuild**（74 diff files）·`prisma migrate deploy` / `status` **ok**·リモート **exit 0**·ローカル **`--follow` 約 1430s** |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **31s**·Tailscale·Pi5 **`100.106.158.2`**）。**サイネージ API**（`current-image`·Pi3 x-client-key）含む。
- **代表コミット**: **`283b414b`**（`feat: add rigging slings inspection gmail signage`）。
- **CI**: **`26267694608` success**（push `feat/rigging-slings-inspection-gmail-signage`）。
- **ローカル回帰**: API lint/build·Web lint/build·対象 API テスト **40 件**·全体 API **1560 passed**·Web **547 passed**。
- **デプロイ後運用（手動・本番未実施）**:
  1. `/admin/imports/schedule` で **`csv-import-rigging-slings-inspection-powerapps`** を **有効化**
  2. `/admin/visualization-dashboards` で **吊具点検プリセット** 作成
  3. `/admin/signage/schedules` で **visualization スロット割当**
- **トラブルシュート**:
  - **Gmail 取込が走らない** → スケジュール **enabled: false 既定**·ダッシュボード **`gmailSubjectPattern` 空**·未読メール不在は **正常スキップ**（[csv-import-export.md §Gmail](./csv-import-export.md#gmailスケジュール取り込みcsvdashboards)）。
  - **`control_num` 未解決** → `RiggingGearResolver` が `managementNumber` / `idNum` どちらもヒットしない行は **投影スキップ**（ログ確認）。
  - **キオスク borrow 後に点検が無い** → orchestrator は **best-effort**（borrow 自体は成功のまま）·dedup キー重複時は **既存行を維持**。
  - **サイネージに吊具が出ない** → 可視化ダッシュボード・スケジュール割当が **未設定**（コードデプロイだけでは JPEG は生成されない）。
- **ナレッジ**: [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[csv-import-export.md §吊具点検](./csv-import-export.md#gmailスケジュール取り込みcsvdashboards)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

- **ナレッジ**: [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[csv-import-export.md §吊具点検](./csv-import-export.md#gmailスケジュール取り込みcsvdashboards)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **吊具点検 dedup refresh · idNum 登録 · サイネージデザイン分離**·**API のみ**·**`raspberrypi5` のみ**） {#rigging-inspection-dedup-refresh-signage-layout-2026-05-22}

- **変更概要（正本 [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)）**:
  - **dedup refresh**: `RiggingInspectionProjectionService` — 同一 dedup キーで再投影時、**incoming `inspectedAt` が新しければ UPDATE**（`refreshed` カウンタ）。**根因**: 旧 dedup スキップで古い日付が残り、**暦日 `today_jst`** 窓から漏れる。
  - **idNum 登録**: `register-rigging-inspection-missing-id-num-gears.ts` — idNum **80/73/69/82** を `RiggingGear` に登録（`managementNumber = idNum`）。
  - **サイネージデザイン分離**: **MI** は共有 `layout-body.ts` **従来**（1 機器/行）·**吊具のみ** `rigging-layout-body.ts` で active 複数を **` ・ ` 結合**（`49386387` で MI への誤適用を巻き戻し）。
  - **触らない**: DB マイグレーションなし·Pi4/Pi3。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/loan-inspection-card-combined-mgmt-numbers infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | `20260522-160832-6784` | （rebuild 中 attach 追尾） | 初回起動 |
| `raspberrypi5` | `20260522-163138-380` | ok=134 changed=4 failed=0 | 完了確認 |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **backfill 再実行**: **103 created / 7 refreshed / 74 deduped / unmatchedGear 6 / unmatchedEmployee 0**。
- **idNum 登録**: 初回 **created 4**·再実行 **skipped 4**。
- **DataSource 検証（加工担当部署·5/22 暦日）**: **18 件 / 10 名**（`2026_05_22.csv` 26 行·田中 6 行 section 除外）。
- **代表コミット**: **`49386387`**（系列 **`d5ee97ab`** / **`e328bcd2`** / **`49386387`**）。
- **トラブルシュート**:
  - **7 名しか出ない** → dedup refresh + backfill + idNum 登録（本修正で解消）。
  - **デプロイロック** → 既存 run へ **`--attach`**。
  - **MI も中黒結合になる** → **`49386387` 未デプロイ**（吊具専用 renderer のみ結合）。
- **ナレッジ**: [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **吊具点検 A+B 氏名マッチ・サイネージマージ**·**API のみ**·**`raspberrypi5` のみ**） {#rigging-inspection-name-match-signage-merge-2026-05-22}

- **変更概要（正本 [KB-381](../knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)）**:
  - **A**: `compactEmployeeDisplayName` — CSV `inspectorName`（スペースなし）と `Employee.displayName`（スペースあり）を投影 resolver で一致。
  - **B**: `rigging_loan_inspection` DataSource — Loan 明細に加え、当日 `RiggingInspectionRecord` の点検のみ吊具を `kind=active` でマージ。貸出0グループは点検件数降順ソート。
  - **backfill**: `backfill:rigging-inspection-gmail-projection` — 誤 gmail 記録削除 → CsvDashboard 永続行から再投影。
  - **触らない**: DB マイグレーションなし·Pi4 キオスク Web·Pi3 サイネージ playbook（**Pi5 のみ**）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 / Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/rigging-inspection-name-match-signage-merge infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | `20260522-152051-25493` | ok=134 changed=4 failed=0 | **Docker rebuild**（17 diff files）·`prisma migrate deploy` / `status` **ok**·リモート **exit 0**·ローカル **`--follow` 約 859s** |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**）。
- **backfill（Pi5 API コンテナ）**: dry-run → 削除 **46** / scan **142** → 実行 **created 88**·**unmatchedEmployee 0**·**unmatchedGear 28**。
- **実機（DataSource）**: `加工担当部署` 当日 **inspectedUsers=7**·点検のみ従業員も **吊具明細** 表示（例: 矢田 彗遥 点検2·貸出0·明細2）。
- **代表コミット**: **`7ba9306c`**（`fix(rigging): align gmail inspection names and signage details`）。
- **CI**: **`26271507686` success**。
- **トラブルシュート**:
  - **加工担当部署に出ない** → backfill 実施済みか·preset `sectionEquals=加工担当部署`。
  - **Loan のみ表示** → B 未デプロイ（本修正で解消）。
  - **section 空従業員に残存** → CSV 行が別従業員に解決（田中/増田 46 件例）·マスタ調査。
  - **`unmatchedGear`** → `RiggingGear.idNum` / `managementNumber` マスタ整合。

### 補足（2026-05-22 · **キオスク沉浸式ヘッダー・下端中央1/3リビール**·**Web + Ansible（Pi4 キオスク）**·**Pi5→Pi4×4**） {#kiosk-bottom-center-header-reveal-2026-05-22}

- **変更概要（正本 [KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)）**:
  - **Web**: 上端全幅リビール廃止 → **下端 14px × 幅中央 1/3** で `KioskHeader` を下から表示。`useKioskTopEdgeHeaderReveal` 削除、`useKioskEdgeHeaderReveal` / `useKioskBottomCenterHeaderReveal` / `kioskHeaderRevealHotZone.ts` 追加。
  - **allowlist**: `/kiosk/photo` を沉浸式に追加（持出タブと下端リビール統一）。
  - **Pi4**: `kiosk-launch.sh` に **`&_appRef=<git HEAD>`**、Firefox プロファイル **HTTP キャッシュ無効**・**`cache2` 削除**（Pi5 SPA 更新の取りこぼし防止）。
  - **触らない**: Pi5 `api` 契約・DB マイグレーション・Pi3 サイネージ。
- **対象ホスト**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**（各 **`--limit <host>`・1 台ずつ**）。**Pi3**: **`skipping: no hosts matched`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-bottom-center-header-reveal infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**:

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260522-101951-717` | ok=134 changed=4 failed=0 |
| `raspi4-kensaku-stonebase01` | `20260522-102453-31642` | ok=129 changed=10 failed=0 |
| `raspberrypi4` | `20260522-103026-4234` | ok=124 changed=13 failed=0 |
| `raspi4-robodrill01` | `20260522-103521-10989` | ok=124 changed=12 failed=0 |
| `raspi4-fjv60-80` | `20260522-103915-8240` | ok=124 changed=12 failed=0 |

- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **実機（UI）**: StoneBase01 で下端中央リビール・`/kiosk/photo` 沉浸式 — **OK**（ユーザー確認）。
- **代表コミット**: `175243ac`（下端リビール）·`b6424984`（pointer-events）·`8a5369e1`（Pi4 キャッシュ）·`e9a860e1`（photo allowlist）·`cbeb6bbc`（E2E）·マージ代表 **`cbeb6bbc`**。
- **CI**: **`26262397906` success**。初回 push は **`26261933696` failure**（`e2e/kiosk.spec.ts` が `revealKioskHeader` 前に「キオスク端末」可視 assert）。
- **ローカル回帰**: Vitest（hot zone + policy）·`pnpm --filter @raspi-system/web build`·E2E smoke / `kiosk.spec.ts`（`CI=true` + Postgres）。
- **トラブルシュート**:
  - **Pi4 だけ旧 UI** → `_appRef` 付き URL で `kiosk-browser` 再起動。`group_vars/all.yml` の **Tailscale IP** を正本に SSH（誤 IP でタイムアウトしやすい）。
  - **下辺左右でナビが出る** → 非表示ヘッダーの `pointer-events-none` 欠落（`b6424984` 回帰）。
  - **E2E ナビ不可視** → `revealKioskHeader()` **後**に assert（[KB-025](../knowledge-base/ci-cd.md#kb-025-e2eスモークkioskがナビゲーション不可視で失敗する) 追記）。
- **ナレッジ**: [KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)·[deploy-status-recovery.md §下端リビール](../runbooks/deploy-status-recovery.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-21 · **キオスク順位ボード・shell 初回最適化 第1弾**·**API のみ**·**`raspberrypi5` のみ**） {#kiosk-leaderboard-shell-initial-opt-phase1-2026-05-21}

- **変更概要（正本 [KB-374 §shell 第1弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-初回最適化-第1弾-api-のみ--2026-05-21--本番反映済み)）**:
  - **API**: `GET …/leaderboard-board`（初回 shell）で **`resolveLeaderboardMaterializedBaseWhere` をリクエスト内 1 回共有**（continue と同型）。
  - **`hasMore=false` スロット**: `rows.length` を total 正本とし **COUNT 結果を await しない**（hasMore スロットは shell 選定と **並行開始した COUNT を await**）。
  - **未使用 COUNT promise**: reject を **`settleUnusedLeaderboardBoardShellCount`** で握りつぶし（統合テストで COUNT reject 時も shell 200 を担保）。
  - **触らない**: Web·pageSize 80·continue 80/160·装飾後取り·COUNT 再利用（continue 側）·`deltaRows`·IDB。**新規マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3**: **`skipping: no hosts matched`**（**Pi5 `api` のみ**·Pi4 順次 **不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-shell-initial-opt-phase1 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**: **Detach Run ID** **`20260521-221507-30100`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 776s**·**`Git: changed`**·**Docker 再起動 ok**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **64s**）。
- **実機（読み取りベンチ·Pi5 実データ）**: `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-board-shell.mjs --runs 2` → **robodrill median ~3.0s**（completeInShell **2/6**）·**fjv ~3.1s**（hasMore **6/6**）·**stonebase ~5.1s**（completeInShell **1/8**）。
- **代表コミット**: **`143c8814`**·**PR [#316](https://github.com/denkoushi/RaspberryPiSystem_002/pull/316)**·**CI**: **`26226698424` success**。
- **ローカル回帰**: 単体 2·統合 `leaderboard-board` 5（COUNT reject 時 shell 200 含む）。
- **トラブルシュート**:
  - **体感が変わらない（Pi4 / 全 hasMore スロット）** → **Pi5 `api` のみ**が対象。**fjv 等は winner 共有のみ**で差は小さめ。
  - **デプロイ中 `ssh: Operation timed out`** → 一過性 Tailscale。**`PLAY RECAP failed=0`** を正とする。
  - **total がずれる** → **`snapshotExpired`** 後は shell 再取得が正。
- **ナレッジ**: [KB-374 §shell 第1弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-初回最適化-第1弾-api-のみ--2026-05-21--本番反映済み)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-22 · **キオスク順位ボード・shell 選定 SQL 第2弾**·**API のみ**·**`raspberrypi5` のみ**） {#kiosk-leaderboard-shell-sql-phase2-2026-05-22}

- **変更概要（正本 [KB-374 §shell 第2弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み)）**:
  - **Step A**: manual / expansion / filler の **重複 SELECT を共通化**（`leaderboard-shell-row-projection.sql.ts` 等）·**相関 `processingOrder` / `globalRank` を LATERAL JOIN 化**（`leaderboard-shell-rank-join.sql.ts`）·**1 行あたり 1 回評価**。
  - **Step B（prefix 初回のみ）**: **`fetchLeaderboardShellMergedPrefixRows`** 経路で manual **`LIMIT prefixLimit+1`（probe）**·manual **>= prefixLimit** なら **expansion スキップ**·continue / full merge 経路は **LIMIT なし**（挙動不変）。
  - **触らない**: Web·continue 80/160·装飾後取り·board 契約·第1弾 winner 共有 / COUNT 省略·**新規マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3**: **`skipping: no hosts matched`**（**Pi5 `api` のみ**·Pi4 順次 **不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-shell-sql-phase2 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**: **Detach Run ID** **`20260522-081052-2796`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 613s**·**`Git: changed`**·**Docker 再起動 ok**·**`prisma migrate deploy` / `status` ok**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **31s**）。
- **実機（読み取りベンチ·Pi5 実データ·デプロイ直後·`runs=2`）** — [`benchmark-leaderboard-board-shell.mjs`](../../scripts/test/benchmark-leaderboard-board-shell.mjs):

| profile | 第1弾 median（参考） | 第2弾 median | 第2弾 min | hasMore / completeInShell |
| --- | --- | --- | --- | --- |
| robodrill（6 slots） | ~3.0s | **~4.9s** | **~3.0s** | 4/6 hasMore · 2 completeInShell |
| fjv（6 slots） | ~3.1s | **~3.1s** | **~2.8s** | 6/6 hasMore |
| stonebase（8 slots） | ~5.1s | **~6.6s** | **~5.9s** | 7/8 hasMore · 1 completeInShell |

- **代表コミット**: **`56490cfd`**·**CI**: **`26257727724` success**。
- **ローカル回帰**: fetch-policy 8·compare 6·leaderboard unit 39·統合 `leaderboard` 18 PASS。
- **トラブルシュート**:
  - **ベンチ median が run 間でブレる** → **min も併記**して判断（全スロット並列 COUNT + 選定 SQL の合成時間）。
  - **Pi4 で変わらない** → **Pi5 `api` のみ**が対象（Pi4 デプロイ **不要**）。
  - **continue 順序がずれる** → continue は **`prefixLimit` 未指定**（full manual+expansion）— 統合テストで monolithic 同順を確認済。
- **スコープ（2026-05-22）**: **shell 選定 SQL は第2弾までで一旦停止**。**第3弾以降**（expansion budget LIMIT 等）は **[KB-374 §ロードマップ（保留）](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-選定-sql-第3弾以降-ロードマップ-保留-2026-05-22)**·[EXEC_PLAN §保留](../../EXEC_PLAN.md#キオスク順位ボード--shell-選定-sql-第3弾以降保留2026-05-22--後日参照) に記録。
- **ナレッジ**: [KB-374 §shell 第2弾](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-21 · **サイネージ `kiosk_leader_order_cards`・ヘッダ加工機名の全文1行表示**·`main` `a2f9a2c5`·**API のみ**·**`raspberrypi5` のみ**） {#signage-leader-order-header-full-machine-name-2026-05-21}

- **背景**: [5列×2段（2026-05-21）](#signage-leader-order-cards-5x2-grid-10-2026-05-21) 本番後、各資源CDスロット **最上段の加工機名（`resourceJapaneseNames`）** が **`立型(FJV50/8…` のように `…` で切れる** 現象。現場では **カード幅に余白があり1行で収まる** とのフィードバック（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)）。
- **根本原因**: `leader-order-cards-svg-header.ts` の **`computeLeaderOrderHeaderTruncation`** が、資源CD分を先に差し引いたうえで日本語名を **最大約36文字相当** に **`truncateChars`（`…`）** していた。5列化でカードは狭くなるが、**典型の加工機名長では1行に収まる**のに、**readability 時代の保守的キャップ**が残っていた。
- **変更概要（API のみ）**:
  - **ヘッダ**: 資源CD（mono・`titleFs`）の直後に、加工機名（`subFs`）を **同一 baseline・1行・省略なし** で描画（2つの `<text>`。`truncateChars` / `computeLeaderOrderHeaderTruncation` は **ヘッダから削除**）。
  - **折り返し**: **禁止**（現場要望。キオスクは `break-words` だがサイネージ JPEG は **1行固定**）。
  - **行内機種名10字上限**（`LEADER_ORDER_SIGNAGE_MACHINE_NAME_MAX_CHARS`）は **カード本文のみ**・本件では変更なし。
  - **Web / Pi4 / Pi3 / DB**: **変更なし**。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi3 専用手順は未実施で正**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **本番デプロイ（実績・2026-05-21）**: **Detach Run ID**: **`20260521-134013-4448`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 613s**·サマリ **`Summary success: true`**）。**Git**: **`a2f9a2c5`**（`fix(signage): show full machine name in leader order card header`）を **push 後**にデプロイ（未 push だと `update-all-clients.sh` が拒否）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **46s**）。
- **実機（現場）**: **加工機名が `…` なしで1行全文** — **OK**（ユーザー確認・2026-05-21）。
- **知見**:
  - **キオスクとの差**: キオスクヘッダは **折り返し可**（`flex-wrap` + `break-words`）。サイネージは **遠目1行優先**で **truncate しない**（はみ出しは典型名では発生しない想定）。
  - **5×2 後の見え方**: 列幅は狭いが **ヘッダ1行の実効幅はスロットの約半分が余白**になり得る — **文字数キャップより実幅を信頼**する方針に変更。
  - **デプロイ前 push**: `main` が `origin/main` より ahead のときスクリプトは **エラー終了**（意図的ガード）。
- **トラブルシュート**:
  - **加工機名がまだ `…`**: Pi5 **`api` ref** が **`a2f9a2c5` 以降**か · `slideIntervalSeconds` 待ち · JPEG キャッシュ。
  - **極端に長い名称が隣カードにかぶる**: マスタ名称の確認（運用）。必要なら **フォント縮小や2行化**は別要件（本件は **折り返し禁止**）。
  - **デプロイが「未 push」で止まる**: `git push origin main` 後に再実行。
- **ナレッジ**: [KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。**`main`**: 直接 push（**`a2f9a2c5`**）。

### 補足（2026-05-21 · **サイネージ `kiosk_leader_order_cards`・5列×2段・最大/既定10**·`feat/signage-leader-order-cards-5x2-grid-10`·**API+管理Web**·**`raspberrypi5` のみ**） {#signage-leader-order-cards-5x2-grid-10-2026-05-21}

- **背景**: [コンパクト＋未完のみ（2026-05-21）](#signage-leader-order-cards-compact-incomplete-2026-05-21) および [納期 Date 正規化](#signage-leader-order-due-date-prisma-date-2026-05-21) 反映後、現場で **1ページあたりの資源カード枚数を増やし**（4列×2段・最大8 → **5列×2段・最大10**）、遠目でも **より多くの資源を同時表示**したい要望（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)）。
- **変更概要（API + 管理 Web）**:
  - **グリッド契約（単一情報源）**: `layout-contracts.ts` — `LEADER_ORDER_SIGNAGE_GRID_COLUMNS` **4→5**、`LEADER_ORDER_SIGNAGE_GRID_ROWS` **2**（不変）、`LEADER_ORDER_SIGNAGE_GRID_CAPACITY` **10**、`DEFAULT_LEADER_ORDER_CARDS_PER_PAGE` / `MAX_LEADER_ORDER_CARDS_PER_PAGE` **10**。
  - **Zod / API**: `apps/api/src/routes/signage/schemas.ts` — `cardsPerPage` **max 10**（min 1 は従来どおり）。
  - **管理 UI**: `SignageSchedulesPage.tsx` — ラベル「**既定10・最大10・5列×2段**」、placeholder **10**、入力 clamp **`Math.min(10, …)`**。
  - **カード幅**: 列数5により `computeKioskProgressOverviewGridSlots`（既存キオスク進捗一覧グリッド幾何の再利用）で **各カード幅が自動的に狭くなる**。フォント・行レイアウト・未完フィルタ・納期表示は **本リリースでは変更なし**。
  - **後方互換**: DB に **`cardsPerPage: 8` 等で保存済み**のスケジュールは **8枚表示のまま**（空き2枠）。**10枚にしたい場合は管理画面で再保存**（または `layoutConfig.cardsPerPage` を 1〜10 で明示）。
  - **Pi4 / Pi3**: **変更なし**（JPEG 正本は Pi5 API）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 / Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/signage-leader-order-cards-5x2-grid-10 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-21）**: **Detach Run ID**: **`20260521-131417-25249`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 618s**·サマリ **`Summary success: true`**）。
- **CI（機能先行）**: GitHub Actions **`26204469250` success**（代表 **`0fa2d065`** — `fix(signage): expand leader order cards to 5x2 grid`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**）。
- **知見**:
  - **JPEG 正本は Pi5** — Pi3 単体デプロイでは見た目は変わらない（`signage-lite-update` が Pi5 の `/api/signage/current-image` を取得）。
  - **グリッド定数は `layout-contracts.ts` のみ** — ページング・SVG metrics・統合テストは同定数を参照（4→5 の差分を散在させない）。
  - **既存8枚スケジュール**は意図的にそのまま（運用で再保存すれば10枚上限まで拡張可）。
- **トラブルシュート**:
  - **まだ4列に見える** → Pi5 **`api` / `web` ref**（**`0fa2d065` 以降**）·`slideIntervalSeconds` 待ち·JPEG キャッシュ。
  - **管理画面の上限が8のまま** → **Web 未更新**（Pi5 のみで可）。ブラウザハードリロード。
  - **10枚指定で warn** → 旧 API が cap している可能性 → Pi5 ref 確認。
  - **`cardsPerPage: 8` のまま** → 保存値が8（仕様）。10にしたい場合は **再保存**。
- **ナレッジ**: [KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。**`main` マージ**: [PR #314](https://github.com/denkoushi/RaspberryPiSystem_002/pull/314)（squash **`3e37248f`**）。

### 補足（2026-05-21 · **サイネージ `kiosk_leader_order_cards`・納期表示（Prisma Date 正規化）**·`fix/signage-leader-order-due-date-from-prisma-date`·**API のみ**·**`raspberrypi5` のみ**） {#signage-leader-order-due-date-prisma-date-2026-05-21}

- **背景**: [コンパクト＋未完のみ（2026-05-21）](#signage-leader-order-cards-compact-incomplete-2026-05-21) 本番後、サイネージ JPEG の行右端納期が **すべて `—`（ダッシュ）** になる現象。キオスクでは納期が表示されるのにサイネージのみ欠落（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)）。
- **根本原因**: `listProductionScheduleRows` は `dueDate` / `plannedEndDate` を **Prisma `Date` オブジェクト**で返す。`normalizeLeaderBoardRowFromScheduleRow` が **`String(row.dueDate)`** していたため **`Wed May 15 2026 ...` 等のロケール文字列**になり、`formatDueDateSignage` の **`YYYY-MM-DD` 接頭辞パース**が失敗 → **`dueLabel` が常に `—`**。
- **変更概要（API のみ）**:
  - **`scheduleDateToIsoDateString`**: `Date` → `toISOString().slice(0, 10)`、文字列は ISO 接頭辞優先（`leader-board-pure.ts`）。
  - **表示**: `M/D(曜)` 形式は従来どおり `formatDueDateSignage`（キオスク `formatDueDate` と同型パース）。
  - **Web / Pi4 / Pi3 / DB**: **変更なし**。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 / Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/signage-leader-order-due-date-from-prisma-date infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-21）**: **Detach Run ID**: **`20260521-123106-4810`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 778s**·サマリ **`Git: changed`**）。
- **CI（機能先行）**: GitHub Actions **`26203259837` success**（代表 **`83501b27`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **27s**）。
- **知見**:
  - **キオスクとサイネージの差**: キオスク Web は JSON 経由で **ISO 文字列**の `dueDate` を受け取る。**サイネージ API 内**は **同一クエリでも `Date` 型**のため、正規化層が必要。
  - **手動納期 vs CSV 納期**: `resolveDisplayDueDate` は **手動 `dueDate` 優先**、なければ **`plannedEndDate`**（従来どおり）。
- **トラブルシュート**:
  - **納期が `—` のまま** → Pi5 **`api` ref**（**`83501b27` 以降**）·`slideIntervalSeconds` 待ち·JPEG キャッシュ。
  - **キオスクにはあるがサイネージにない** → 上記（**Pi5 未更新**または **コンパクト本番〜本 fix 前**）。
  - **日付が1日ずれる** → 本 fix は **UTC `slice(0,10)`**（due-management 他と同型）。TZ カレンダー表示は進捗一覧の `SIGNAGE_TIMEZONE` 系とは別経路。
- **ナレッジ**: [KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。**`main` マージ**: [PR #313](https://github.com/denkoushi/RaspberryPiSystem_002/pull/313)（squash **`2ca80f84`**）。

### 補足（2026-05-21 · **サイネージ `kiosk_leader_order_cards`・コンパクト＋未完のみ**·`feat/signage-leader-order-cards-compact-incomplete`·**API のみ**·**`raspberrypi5` のみ**） {#signage-leader-order-cards-compact-incomplete-2026-05-21}

- **背景**: [キオスク整合（2026-05-21）](#signage-leader-order-kiosk-aligned-2026-05-21) 反映後、現場で **カードが大きすぎて行数が少ない**・**完了行が薄く残りノイズになる** とのフィードバック。サイネージは遠目視認のため **情報密度を上げ**、キオスク順位ボードの **「未完」フィルタと同じ行集合**だけを出す（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)）。
- **変更概要（API のみ）**:
  - **表示行**: `filterLeaderBoardRowsIncompleteForSignage` — `progress === '完了'`（`listProductionScheduleRows` の実効完了と整合）の行は **非表示**（従来は **opacity 0.52 で薄表示**）。
  - **行レイアウト**: 工順（`fkojun`）行・顧客名行を **削除**。クラスタ行（製番·品目·個数）＋機種名1行＋納期1行に集約（`leader-order-cards-svg-schedule-row.ts`）。
  - **機種名**: `truncateChars(..., LEADER_ORDER_SIGNAGE_MACHINE_NAME_MAX_CHARS)` — **最大10文字**（超過は `…`）。
  - **コンパクト化**: `leader-order-cards-svg-metrics.ts` / `layout-tokens` — パディング・フォント・行間を縮小（**4列×2段・最大8カード/ページ**は不変）。
  - **フッタチップ**: `buildLeaderboardFooterChipsByPartKeyForScheduleRows` は **全行**を入力に維持（完了/未完のチップ表示は従来契約）。**カード内の行リストのみ未完**。
  - **Web / Pi4 / Pi3 / DB**: **変更なし**。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3 サイネージ**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/signage-leader-order-cards-compact-incomplete infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-21）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260521-114344-436`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 560s**·サマリ **`Git: changed`**·**`Summary success: true`**）。
- **CI（機能先行）**: GitHub Actions **`26201804495` success**（代表コミット **`bdc25afb`** — `fix(signage): compact leader order cards and hide completed rows`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 33s**・Tailscale·Pi5 API `100.106.158.2`）。**サイネージ API**（`current-image`・Pi3 x-client-key）含む。
- **知見**:
  - **JPEG 正本は Pi5** — Pi3/Pi4 単体デプロイでは見た目は変わらない。
  - **未完のみ**はキオスク左ペインの完了フィルタ **「未完」**と同義（完了行はカードから消える。資源内が全完了なら **空スロット**になり得る）。
  - **静的プレビュー**: [signage-leader-order-cards-kiosk-aligned-preview.html](../design-previews/signage-leader-order-cards-kiosk-aligned-preview.html) を **コンパクト＋未完**に合わせて更新済み（本番 SVG と同趣旨）。
- **トラブルシュート**:
  - **完了行がまだ見える** → Pi5 **`api` ref**（**`bdc25afb` 以降**）·`slideIntervalSeconds` 待ち·キャッシュ。
  - **カードが空** → 当該資源の行が **すべて完了**（仕様どおり）。キオスクで **完了フィルタ「両方」**と比較。
  - **機種名が切れる** → **10文字上限**（`LEADER_ORDER_SIGNAGE_MACHINE_NAME_MAX_CHARS`）。フル表示はキオスク側。
  - **工順・顧客名が無い** → 本リリースの **意図的削除**（遠目密度優先）。
- **ナレッジ**: [KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)·[design-previews README](../design-previews/README.md)。**`main` マージ**: [PR #312](https://github.com/denkoushi/RaspberryPiSystem_002/pull/312)（squash **`2667fc7f`**）。

### 補足（2026-05-21 · **サイネージ `kiosk_leader_order_cards`・キオスク最新レイアウト整合**·`feat/signage-leader-order-kiosk-aligned`·**API のみ**·**`raspberrypi5` のみ**） {#signage-leader-order-kiosk-aligned-2026-05-21}

- **背景**: サイネージ JPEG の順位ボード資源CDカードが、2026-04-08 までの readability 改修後も **キオスク `LeaderOrderResourceCard` 最新**（製番左縁24色・クラスタ行・行下資源チップ・閲覧専用）とずれていた。現場は管理コンソール `/admin/signage/schedules` で **`kiosk_leader_order_cards`** を設定し、Pi3 は Pi5 の `/api/signage/current-image` を表示する（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)）。
- **変更概要（API のみ）**:
  - **表示ロジック**: `leader-board-pure.ts` — キオスク `presentLeaderOrderRow` に合わせたクラスタ行・顧客行・機種行。
  - **製番色**: 新規 `leader-order-seiban-accent-palette.ts`（Web `seibanAccentPalette` と同型の24色ハッシュ）。
  - **フッタチップ**: `buildLeaderboardFooterChipsByPartKeyForScheduleRows` をデータ取得に組み込み、`leader-order-cards-svg-footer-chips.ts` で描画。
  - **SVG**: ヘッダ横並び、動的行高、チップ描画（`leader-order-cards-svg-{header,schedule-row,footer-chips,card}` 等）。
  - **Web / Pi4 / DB マイグレーション**: **変更なし**（キオスク Web は未デプロイで正）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3 サイネージ**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**・リソース僅少・差分は Pi5 `api` に集約）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/signage-leader-order-kiosk-aligned infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-21）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260521-104347-10606`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 604s**·サマリ **`Git: changed`**）。
- **CI（機能先行）**: GitHub Actions **`26199566787` success**（lint-build-unit / api-db-and-infra / security-docker / e2e-smoke / e2e-tests）。代表コミット **`7b54d992`**（`feat(signage): align leader order cards with kiosk layout`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 27s**・Tailscale·Pi5 API `100.106.158.2`）。**サイネージ API**（`current-image`・Pi3 x-client-key）含む。
- **知見**:
  - **JPEG 正本は Pi5** — Pi3 単体更新では見た目は変わらない（[KB-335](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) と同型）。
  - **`deviceScopeKey`** はスケジュールのデータスコープであり、Ansible のデプロイ先ホスト名ではない。
  - **静的プレビュー**: [signage-leader-order-cards-kiosk-aligned-preview.html](../design-previews/signage-leader-order-cards-kiosk-aligned-preview.html) が実装ターゲット（本番反映済み）。
- **トラブルシュート**:
  - **見た目が旧のまま** → Pi5 **`api` ref**（**`7b54d992` 以降**）·`slideIntervalSeconds` 待ち·`GET /api/signage/content` の `kiosk_leader_order_cards`。
  - **左縁色・チップ無し** → 上記と同様（Pi5 未更新またはキャッシュ）。
  - **Pi4 をデプロイしたが変わらない** → 本リリースは **API のみ**（Pi4 デプロイは不要だった）。
- **ナレッジ**: [KB-335 §キオスク整合](../knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)·[design-previews README](../design-previews/README.md)。**`main` マージ**: [PR #311](https://github.com/denkoushi/RaspberryPiSystem_002/pull/311)（squash **`6cb3bb1e`**）。

### 補足（2026-05-20 · **キオスク順位ボード・資源内順位割当の自動解放（A+α）**·`feat/kiosk-order-assignment-auto-release-a-alpha`·**API のみ**·Pi5→Pi4×4） {#kiosk-leaderboard-order-assignment-auto-release-a-alpha-2026-05-20}

- **背景**: 順位ドロップダウンは **`order-usage`（DB 全割当）** に対し **空き番のみ**選択可。一覧は **FKOJUNST 可視 + 完了フィルタ（既定未完）** で **部分集合**。**完了済み・非表示行**が **順位だけ残る**と **080/060 が選べず 5 からしか選べない**等の **飛び番**に見える（[KB-297 §A+α](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)）。
- **変更概要（API のみ）**:
  - **保持**: `retain ⇔ NOT 実効完了 AND キオスク一覧可視（fkmail S/R/C/X）`。
  - **解放**: 上記以外（**A** 実効完了 **OR** **α** 一覧非可視 **OR** winner 外旧行）→ **割当削除 + 同一 location×resourceCd 内番号詰め**。
  - **モジュール**: [`order-assignment/`](../../apps/api/src/services/production-schedule/order-assignment/)（retention policy · release repository · reconciliation service）。
  - **トリガ**: FKOJUNST mail / 本体 CSV 外部完了 / external completion 同期 **完了後**に reconcile。
  - **Web / DB マイグレーション**: **変更なし**（`order-usage` 契約不変）。
- **対象ホスト**:
  - **機能上必須**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。
  - **本番実績（2026-05-20）**: ユーザー指示で **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`** を **1 台ずつ**（Pi4 は **repo 同期 + `kiosk-browser` / `status-agent` 再起動**のみ）。
  - **Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-order-assignment-auto-release-a-alpha infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-20）**: **Detach Run ID**（接頭辞 `ansible-update-`）:
  - **`20260520-164356-7722`**（`raspberrypi5`·初回·**Docker rebuild: true**·compose 再起動中 **SSH timeout** 数回·**リモート exit 0**）
  - **`20260520-174409-16528`**（`raspberrypi5`·**`PLAY RECAP` `ok=131` `changed=3` `failed=0` / `unreachable=0`**·**Docker 再ビルド skip**·**`prisma migrate deploy` / `status` `ok`**）
  - **`20260520-174713-7127`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=10` `failed=0`**·**`kiosk-browser` / `status-agent` 再起動 `ok`**）
  - **`20260520-180644-29504`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**）
  - **`20260520-181206-12995`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）
  - **`20260520-181622-32182`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）
- **CI**: 初回 **`26146689419` failure**（reconcile サービス **部分 DI 未注入**·4 テスト）→ **`643e4f4b`** で修正 → **`26147609881` success**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 76–88s**·Tailscale·Pi5 API `100.106.158.2`）。**`deploy-status`（Pi4×4）**: すべて **PASS**。
- **知見**:
  - **既存幽霊割当**は **次回 FKOJUNST / 本体 CSV 同期**まで残り得る（**デプロイ ≠ 即時掃除**）。
  - **Pi5 初回デプロイ**で Docker 再ビルド済みなら、**2 回目は skip でも API ref は更新済み**のことがある（**git HEAD 確認**）。
  - **winner 外旧行**も解放対象（コードレビュー追補·[KB-297 §A+α](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)）。
- **トラブルシュート**:
  - **反映直後も飛び番** → 同期未実行。**Pi5 `api` ref**（**`643e4f4b` 以降**）·取込スケジュール·ログ **`stale order assignments released`**。
  - **順位が意図せず消えた** → 行が **実効完了**または **一覧非可視**。**完了フィルタ「両方」**で確認。
  - **Pi5 デプロイ SSH タイムアウト** → **`PLAY RECAP` / Summary success** を正本（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。
- **ナレッジ**: [KB-297 §A+α](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)·[verification-checklist §6.6.24](verification-checklist.md#kiosk-leaderboard-order-assignment-auto-release-verification-2026-05-20)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)·代表コミット **`8d2c582c`**·**`643e4f4b`**。

### 補足（2026-05-20 · **キオスク順位ボード・製番左縁アクセント 24 色（全件表示のハッシュ配色拡張）**·`feat/kiosk-seiban-accent-palette-24`·Web のみ·Pi5→Pi4×4） {#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20}

- **背景**: [2026-05-02 製番アクセント常時化](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-always-progress-resource-strip-2026-05-02) 以降、**OR フィルタ OFF（全件表示）** では製番文字列ハッシュ → **8 色** `% 8` で左縁着色。**同一製番のスロット横断同色**は既存どおりだが、製番数が多いと **色被り・近似色** で識別しづらい（登録製番 OR フィルタ ON・同時 ~5 件は現状維持で問題なし）。
- **変更概要**: [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) の **`SEIBAN_ROW_ACCENT_PALETTE` を 8 → 24 色**に拡張。**先頭 8 色の順序は不変**（登録製番 OR フィルタ時の 1〜8 番目の色は従来と同じ）。**9〜24 色**は red / yellow / lime / green / teal / blue / indigo / purple / pink（400 系）+ red / yellow / lime / green / blue / indigo / purple（300 系）を追加。**フィルタ空**は `seibanAccentPaletteIndexForString` → `% 24`。**フィルタ 1 件以上**は `idx % 24`（リスト外製番は従来どおりハッシュ）。**API / DB 変更なし**。**回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)。
- **対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**（本変更は **Pi5 `web` SPA 配信**・Pi4 は **`kiosk-browser` 再起動**のみ。**Pi3 専用手順は未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-seiban-accent-palette-24 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-20）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260520-141147-19965`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 278s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**）/ **`20260520-141629-31940`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**·**`kiosk-browser` / `status-agent` / `status-agent.timer` 再起動 `ok`**）/ **`20260520-142108-13167`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）/ **`20260520-142440-24963`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）/ **`20260520-142830-16409`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=10` `failed=0`**）。いずれも **`Pi 3 signage` play は no hosts matched**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 31s**・Tailscale·Pi5 API `100.106.158.2`）。**`deploy-status`（Pi4×4）**: すべて **PASS**。
- **知見**:
  - **登録製番 OR フィルタ（~5 件）の配色を変えない**ため、パレット拡張は **末尾 16 色追加 + 先頭 8 色固定**に限定した。
  - **全件表示**ではハッシュ `% 24` のみ変わるため、**既存製番の色は 8 色時代と変わり得る**（被り低減が目的）。**OR フィルタ ON 中の 1〜5 番目**は不変。
  - SPA は Pi5 配信。**Pi4 単体デプロイだけでは不十分**（Pi5 `web` 再ビルドが必須）。
- **トラブルシュート**:
  - **左縁が 8 色のまま / 色が変わらない** → Pi5 **`web`** が **`be936a6e` 以降（またはマージ後 `main` HEAD）**か、キオスク **強制リロード**（[verification-checklist.md](verification-checklist.md) §6.6.4）。
  - **OR フィルタ ON の色が意図と違う** → 先頭 8 色は不変のはず。**9 件以上**の OR 選択時のみ 9 色目以降が新パレット（通常運用 ~5 件では該当しにくい）。
  - **`verify-phase12-real.sh` のみ `deploy-status` FAIL** → 全台 `--limit` 完走後に再実行（[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)）。
- **ナレッジ**: [KB-297 §24色](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-palette-24-2026-05-20)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·[verification-checklist §6.6.23](verification-checklist.md#kiosk-leaderboard-seiban-accent-24-verification-2026-05-20)·実装 **`be936a6e`**·**PR [#307](https://github.com/denkoushi/RaspberryPiSystem_002/pull/307)**·**`main` squash `f8c1f6d2`**。

### 補足（2026-05-25 · **DGXリソース `private_ok` 強制メモリ解放（`stop-force`）**·**Pi5→DGX 順次・各 1 台**） {#dgx-resource-private-ok-strong-stop-force-2026-05-25}

- **変更概要（正本）**: [KB-365 §本番反映（2026-05-25）](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)。**`private_ok` + `applyWorkloadChanges`** で **`experiment-lab` → `agent-container` 停止**に加え、**`system-prod-gateway` を `POST /stop-force`**（keep_warm 上書き）で計画。**通常 `/stop` は維持**（Hermes・業務 warm 契約）。**Pi5**: `dgx-resource.policy-arbitrator.ts`・`dgx-resource.gateway-runtime.executor.ts`（内部 `stop_force`）·管理 Web 文言。**DGX**: `control-server.py` の **`POST /stop-force`**。**到達経路**: Pi5 → **`38081/stop-force`** → gateway が **`39090/stop-force`** へプロキシ（本番反映時に gateway 未転送だと **404** となるため **`gateway-server.py` も同窗口で更新**）。
- **代表コミット**: **`7fe1ca15`**（`fix(dgx): force-stop gateway in private_ok mode`）·**`2d91d032`**（`fix(api): keep force stop internal to dgx orchestration`）·**CI `26386720859` success**·gateway 転送は本番デプロイ時 **`fix(dgx): proxy stop-force on gateway`**（`main` マージ後 HEAD）。
- **対象ホスト（順序固定）**: **① `raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**② DGX Spark**（**`ubudgxkoushi@100.118.82.72`**·Ansible 対象外·**`scp` + PID ガード再起動**）。**Pi4／Pi3**: **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
- **標準コマンド（Pi5）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-strong-private-ok infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **標準手順（DGX）**: [dgx-system-prod-local-llm.md §本番反映 2026-05-25](../runbooks/dgx-system-prod-local-llm.md)（**`control-server.py`** → **`/srv/dgx/system-prod/bin/`**·**`control-server.pid` 停止→削除→`start-control-server.sh`**。続けて **`gateway-server.py`** → **同一 PID ガード手順で `start-gateway-server.sh`**）。
- **本番デプロイ（実績・2026-05-25）**:
  - **Pi5** — **Detach `20260525-162034-25035`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 938s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**）。
  - **DGX control-server** — **`scp scripts/dgx-local-llm-system/control-server.py ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/control-server.py`**·再起動後 **`39090/healthz` → 401**（トークン未付与で正常）·`grep stop-force` で新コード確認。
  - **DGX gateway** — 反映前 **`curl -X POST http://127.0.0.1:38081/stop-force` → 404**（転送未実装）→ repo の **`gateway-server.py`** を **`scp`** し再起動後 **`stop-force` → 403**（ダミートークン·**経路到達 OK**）·**`healthz` 200**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 デプロイ後 **約 68s**·Tailscale **`100.106.158.2`**）。
- **知見**:
  - **`stop_force` は公開 API 契約（`EXECUTE_TARGET_ACTION`）に含めない**。オーケストレーション内部のみ（`DgxControlTargetAction` と `ensureAuxRuntimeAction` ガード）。
  - **Pi5 の停止 URL は `38081/stop` 派生**のため、**`control-server.py` だけでは不十分**。**gateway が `/stop-force` を `39090` へ転送**する必要がある（`/start`・`/stop` と同型）。
  - **`start-control-server.sh` / `start-gateway-server.sh` の PID ガード**は Phase12 と同趣旨（**`scp` のみでは旧プロセス継続**）。
- **トラブルシュート**:
  - **`private_ok` 後も 27B/vLLM が残る** → Pi5 **`api` ref**·DGX **`control-server.py` に `stop-force`**·**`38081/stop-force` が 404 でないか**（gateway 未更新）。
  - **管理 UI が旧文言** → Pi5 **`web` 再ビルド**と **強制リロード**（[verification-checklist.md](verification-checklist.md) §6.6.4）。
  - **強制停止が 403** → **`X-Runtime-Control-Token`** と vault **`api_local_llm_runtime_control_token`** の drift。
- **ナレッジ**: [KB-365 §2026-05-25](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)·[Runbook §強制停止](../runbooks/dgx-system-prod-local-llm.md#強制停止stop-force)·[ADR-20260428](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。

### 補足（2026-05-10 · **DGX メインAI 単一キュー・用途別停止抑止・実験優先時 gateway 自動停止除外**·**Pi5 API のみ**·**`raspberrypi5` のみ**） {#dgx-main-llm-single-queue-stop-policy-2026-05-10}

- **変更概要（正本）**: [KB-365 §本番反映（2026-05-10）](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-main-llm-single-queue)。**要点**: **`enqueueMainLocalLlmRuntimeControl`** で **推論 on_demand の `/start`・`/stop`**（`HttpOnDemandLocalLlmRuntimeController`）と **`executeGatewayRuntimeStartStop`**（DGX 管理 UI 経由の `system-prod-gateway`）を **同一キューに直列化**（`local-llm-runtime-command-queue.ts`）。**`shouldSuppressLocalLlmRuntimeStop`** — `photo_label` / `document_summary` / `admin_console_chat` / **`stackchan_chat`** / **`agent_container_task`** は **参照 0 でも release 時 `/stop` 抑止**（業務/Agent warm 維持）。**`experiment_first` + `applyWorkloadChanges`** の事前調停は **`private-comfyui` のみ**自動停止・**`system-prod-gateway` の自動停止を削除**（`dgx-resource.policy-arbitrator.ts` の `planWorkloadAdjustmentsBeforePolicyChange`）。**業務優先・私用OK**への調停では **`experiment-lab` に続けて `agent-container`** も停止試行対象に追加（POST が Pi5 に設定されている場合）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3 サイネージ**: **`skipping: no hosts matched`**（本変更は **Pi5 `api` のみ**・キオスク `web` 差分なしのため **Pi4 順次不要**。**Pi3** は **リソース僅少のため専用手順の対象外**で、本 play では **当てていない**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/dgx-single-queue-stop-policy infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（先行反映・実績・2026-05-10）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-114418-29512`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 559s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`Run prisma migrate deploy` / `prisma migrate status` `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 130s**・Tailscale·Pi5 `100.106.158.2`）。**`deploy-status`（Pi4×4）**: **すべて PASS**。**`auto-tuning scheduler` ログ**: **件数=1**（WARN なし）。
- **知見**: **競合開始/停止の二重適用抑止**は **キューの FIFO + 優先度**が正本。**DGX の gateway 自動停止削除**により、実験優先へ切替えても **業務経路の意図しない cold 化**を避ける（私用 Comfy のみ事前停止）。**ローカル CI**: 初回は `local-llm.test.ts` が **admin の `/stop` 抑止**前提に未更新で **4 件失敗** → **`test(api): align local-llm on_demand route expectations`**（**`4d658897`**）で修正。
- **トラブルシュート**:
  - **推論と管理 UI の起停が食い違う／直列待ちが長い** → API ログの **`main_llm_control_queue_wait`**・同一 **`requestId`** の前後を確認。**デプロイ ref** が **`4d658897` 以降（またはマージ後 `main` HEAD）**か。
  - **実験優先へ切替えたのに業務 gateway が止まった** → Pi5 が **本項の arbitrator 変更前**では **`system-prod-gateway` が調停対象に含まれ得た**。**Detach **`Git: changed`** と `PLAY RECAP` `failed=0`** を確認。
  - **`verify-phase12-real.sh` のみ `deploy-status` FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・連続メンテ後は **再実行**。
- **ナレッジ**: [KB-365 §本番反映（2026-05-10）](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-main-llm-single-queue)·[dgx-system-prod-local-llm.md §管理コンソール](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)·**代表コミット** **`23bce3bf`**（`fix(api): serialize DGX runtime control`）·**`4d658897`**（テスト整合）。

### 補足（2026-05-10 · **DGX AgentContainer（Control Target `agent-container`）・Pi5→DGX 順次・各 1 台**） {#dgx-agent-container-control-target-2026-05-10}

- **変更概要（正本）**: [KB-365 §本番反映（2026-05-10・AgentContainer）](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-agent-container)。Control Target **`agent-container`** を **`overview.targets`**・運用コンソール・単一キュー（**`agent_container_task`**・優先度 **`business > agent`**）・調停（**`business_first` / `private_ok`** で **`experiment-lab` の次に `agent-container` stop 試行**）へ統合。DGX **`gateway-server.py`** に **`GET /agent-container/health`**・**`POST /agent-container/start|stop`**（**`X-Runtime-Control-Token`**）を追加。**既存** **`/v1/*`**・**`/start`**・**`/stop`**・**`/experiment-lab/*`** の外部契約は維持。
- **対象ホスト（順序固定・ユーザー指定スコープどおり）**: **① `raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**② DGX（`gateway-server.py` 配置ホスト）**（Ansible 対象外・SSH **`scp` + ゲートウェイ再起動**）。**Pi4／Pi3**: **`skipping: no hosts matched`**（本リリースでは Ansible を当てない）。**Pi3** はリソース僅少のため **専用手順の対象外**（Phase12 は **疎通のみ**・個体への **deploy playbook は実行しない**）。
- **標準コマンド（Pi5）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/agent-container-control-target infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は第2引数を `main`**）。
- **標準手順（DGX）**: [dgx-system-prod-local-llm.md §本番反映（AgentContainer）](../runbooks/dgx-system-prod-local-llm.md)（**repo の `scripts/dgx-local-llm-system/gateway-server.py`** を **`/srv/dgx/system-prod/bin/gateway-server.py`** へ **`scp`** のち **`start-gateway-server.sh`**。**systemd 利用可否は環境依存**）。
- **本番デプロイ（実績・2026-05-10）**: **① Pi5** — **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-125420-15123`**（**`PLAY RECAP` `ok=139` `changed=8` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 669s**·サマリ **`Git: changed`**·**Docker compose / api・web 再作成 `changed`**·**`Run prisma migrate deploy` / `prisma migrate status` `ok`**）。先行ブランチ **`feat/agent-container-control-target`**（実装 tip **`9fd37c0a`**）。**`main` squash（PR [#284](https://github.com/denkoushi/RaspberryPiSystem_002/pull/284)）**: **`14f105c1`**。**② DGX** — **`scp`** で **`ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/gateway-server.py`** を更新後、**稼働中 PID を終了**して **`bash /srv/dgx/system-prod/bin/start-gateway-server.sh`**（詳細は下記知見）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 57s**・Tailscale **Pi5 `100.106.158.2`**）。**`deploy-status`（Pi4×4）**: PASS。**Pi3 signage-lite/timer**: PASS（**Pi3 へ playbook は未適用**）。
- **知見（gateway 再起動・コード反映）**: **`start-gateway-server.sh`** は **`/srv/dgx/system-prod/logs/gateway-server.pid` が生存 PID を指すと `gateway-server already running` で exit 0 となり、**新しい `gateway-server.py` を読み込まない**。**`scp` のみでは不十分**。実績手順: **`kill $(tr -d '\n' < gateway-server.pid)`**（失敗しても可）→ 短い **`sleep`** → **`rm -f gateway-server.pid`** → **`bash .../start-gateway-server.sh`**。**起動直後の `curl http://127.0.0.1:38081/healthz`** が **`Connection refused`** になり得る（バインド競合ではなく **数 ms〜1s のレース**）。**1 秒以内の再試行で 200** となることを確認済み。
- **知見（Pi5 側トークン）**: **`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_CONTROL_TOKEN` 未設定**でも **`vault_api_local_llm_runtime_control_token`**（→ **`LOCAL_LLM_RUNTIME_CONTROL_TOKEN`**）へ **Ansible がフォールバック**（`inventory.yml` の **`default(vault_api_local_llm_runtime_control_token)`**）。**運用上は実験ラボ等と整合させる**が、分離したい場合は vault に **専用キー**を追加する。
- **ロールバック**: Pi5 は **直前の安定 ref** へ **`update-all-clients.sh`** を再実行（**`--limit raspberrypi5`**）。DGX は **直前の `gateway-server.py` を復元**して **同一の PID 終了→`start-gateway-server.sh`**。Pi5 の **`DGX_RESOURCE_AGENT_CONTAINER_*` を空**にすれば **Control Target は読取中心**に戻りうる（**gateway の新経路だけが先に残ると curl で見える**ため、**API と gateway の窗口は揃える**）。
- **トラブルシュート**:
  - **`agent-container` の start/stop が UI に出ない** → Pi5 **`docker.env` / `api` `.env`** に **`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL` と `_STOP_URL` が両方**あるか（片方のみは **`overview.notes`** に警告・capabilities は **`readStatus` のみ**）。
  - **Pi5 から `/agent-container/start` が 403** → **`X-Runtime-Control-Token`** と DGX **`runtime-control-token`** の drift を疑う（単一キュー・`experiment-lab` と同系）。
  - **gateway を更新したが挙動が古い** → 上記 **`start-gateway-server.sh` の PID ガード**を疑い **`healthz`** と **プロセス起動時刻**を確認。
  - **実機 Phase12 のみ Pi4 `deploy-status` FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**。
- **ナレッジ**: [KB-365 §AgentContainer 本番](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-agent-container)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。

### 補足（StackChan / Pi5 API 経由対話 · **`POST /api/system/stackchan/chat`**） {#stackchan-pi5-api-chat}

- **概要**: StackChan 等は **DGX に直接トークンを持たせず**、Pi5 API の **`POST /api/system/stackchan/chat`**（**`ADMIN` / `MANAGER` JWT**）経由で **`LOCAL_LLM_*`（admin と同一 upstream）**へ到達する。**runtime 用途 ID**: **`stackchan_chat`**（単一キューでは **`admin_console_chat` と同優先度（agent 層）**）。**`/stop` 抑止**は admin と同様（warm 維持）。
- **詳説既定**: サーバ側で **詳説優先の system 指示**をマージ（クライアント先頭 `system` がある場合は追記）。**既に同一詳説ブロックが含まれる `system` は二重追記しない**（履歴再送時のプロンプト肥大化防止）。**`max_tokens` 既定 1536**・**`temperature` 既定 0.35**（JSON で上書き可）。
- **常時待受の運用注意**: 短周期で叩くと **`main_llm_control_queue_wait`** が増え、業務用途（`photo_label` / `document_summary`）と **同一キューで順番待ち**になる。遅延時は Pi5 API ログと DGX gateway を確認。
- **実装**: [`stackchan.ts`](../../apps/api/src/routes/system/stackchan.ts)·[`stackchan-chat-request.ts`](../../apps/api/src/services/system/stackchan-chat-request.ts)·[`local-llm-on-demand-runtime.ts`](../../apps/api/src/services/system/local-llm-on-demand-runtime.ts)。
- **正本手順・API 一覧**: [dgx-system-prod-local-llm.md §管理コンソール](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)。

#### 本番反映（2026-05-10・StackChan Pi5 API チャット・**`raspberrypi5` のみ**） {#stackchan-production-2026-05-10}

- **変更概要**: **`feat/stackchan-interactive-chat-api`** を Pi5 API に先行反映。**新規公開契約**: **`POST /api/system/stackchan/chat`**（認可 **`ADMIN` / `MANAGER`**）。**DGX / gateway / control-server のファイル配置変更なし**（既存 admin LocalLLM 経路の再利用）。
- **代表コミット（ブランチ先端・記録時点）**: **`81fe4d2a`**（`feat(api): add StackChan chat API`）。**`main` へ squash マージ後**は **`origin/main` HEAD** を運用デプロイ引数の正本とする（マージコミット SHA は GitHub の PR 画面で確認）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3 サイネージ**: **`skipping: no hosts matched`**（**Pi3 個体へ Ansible playbook は当てない**・リソース僅少のため **Pi3 専用手順は本変更のスコープ外**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/stackchan-interactive-chat-api infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は第2引数を `main`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-134157-20990`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 650s（約 10m50s）**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**（`Docker restart summary: [{'status': 'ok'}]`）·**`Run prisma migrate deploy` / `prisma migrate status` `ok`**）。
- **実機（自動・広域）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 54s**・Tailscale **`network_mode=tailscale`**・Pi5 API **`https://100.106.158.2`**）。**`deploy-status`（Pi4×4）** PASS。**Pi3 signage-lite/timer**: PASS（**Pi3 へデプロイ playbook は未実行で正**）。
- **実機（追加スモーク・ルート存在・認可）**: 認証なし POST で **`401`**（**`AUTH_TOKEN_REQUIRED` / 「認証トークンが必要です」**）を確認済み（**JWT をログやチャットに書かないこと**）。

```bash
curl -sk -o /dev/null -w "%{http_code}\n" -X POST "https://100.106.158.2/api/system/stackchan/chat" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"smoke"}]}'
# 期待: 401
```

- **仕様（現場が読み取るべきポイント）**:
  - **upstream**: admin の **`LOCAL_LLM_BASE_URL` / `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_MODEL`** と同一（`createLocalLlmGateway`）。
  - **`on_demand`**: **`withStackChanChatOnDemandRuntime`** が **`ensureReady('stackchan_chat')` → 推論 → `release('stackchan_chat')`**。**keep-warm 用途**のため **`release` 後も upstream `/stop` は抑止**され得る（[§単一キュー](#dgx-main-llm-single-queue-stop-policy-2026-05-10) の **`shouldSuppressLocalLlmRuntimeStop`** と整合）。
  - **単一キュー**: `stackchan_chat` は **`admin_console_chat` と同じ agent 優先度層**（業務 `business` より後）。
- **知見**:
  - **デプロイ前**は **`git status` がクリーン**であること（未コミット／未追跡で **`update-all-clients.sh` が即終了**し得る）。
  - Phase12 は **`POST /api/system/stackchan/chat` の JWT 付き E2E は含まない**（トークンをスクリプトに埋め込まないため）。**運用確認**は管理 UI から発行した短命 JWT か、既存のログイン経路で **`ADMIN`/`MANAGER`** ロールを確認する。
- **トラブルシュート**:
  - **`404` / ルート無し** → Pi5 **`api` コンテナ**が **`81fe4d2a` 以降（またはマージ後 `main` HEAD）**か。**Detach サマリ `Git: changed`** と **コンテナ再作成**を確認。
  - **`401`**（クライアントが JWT 付きなのに）→ ロールが **`ADMIN`/`MANAGER`** か・Authorization ヘッダ形式 **`Bearer <token>`** か。
  - **`503` `LOCAL_LLM_NOT_CONFIGURED` / `LOCAL_LLM_RUNTIME_*`** → **`LOCAL_LLM_*`** と **`LOCAL_LLM_RUNTIME_CONTROL_*`**（on_demand 時）が Pi5 の **`docker.env` / `api` `.env`** に揃っているか（admin チャットが動くなら StackChan も同経路のはず）。
  - **応答はあるが詳説が薄い** → クライアントが毎回 **`system` を差し替えていないか**。サーバは **詳説ブロックの重複注入を避ける**ため、**同一文が既に `system` に含まれる場合は追記しない**。
  - **`verify-phase12-real.sh` のみ `deploy-status` FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・連続メンテ後は **再実行**。
- **ナレッジ**: [KB-365 §StackChan 本番](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-stackchan-pi5-api-chat)·[dgx-system-prod-local-llm.md §管理コンソール](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。

### 補足（2026-05-10 · **KB-376・装飾表示スコープとフッタ winner 選定の整合**·**API のみ**·**`raspberrypi5` のみ**） {#leaderboard-footer-display-scope-winner-alignment-2026-05-10}

- **変更概要（正本）**: [KB-376](../knowledge-base/KB-376-leaderboard-footer-display-scope-winner-alignment.md)。**要点**: **`leaderboard-display-row-scope`** で表示行 ID の正規化・**hydrate 900チャンク**を集約し、`fetchLeaderboardScheduleHydratedRowsOrderedByIds` が **全チャンクを入力順マージ**。フッタは **`preferredDisplayRowIds`** と **部品キー collector** で **画面上の winner 境界**と **SQL の `DISTINCT ON` 選定**を一致。**新規マイグレーション**: なし。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3 サイネージ**: **`skipping: no hosts matched`**（本リリースは **API のみ**・キオスク Web 差分なしのため **Pi4 への順次デプロイは不要**と判断。**Pi3** は従来どおり **専用手順の対象外**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/leaderboard-footer-winner-rearchitecture infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（先行反映・実績・2026-05-10）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-091316-7496`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 615s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 57s**·Tailscale·Pi5 API `100.106.158.2`）。**`deploy-status`（Pi4×4）**: すべて **PASS**。**`auto-tuning scheduler` ログ**: **件数=1**。
- **知見（ローカル）**: 統合テストは **Postgres 起動**が前提（**`scripts/test/start-postgres.sh`**·migrate 後に実行）。**`>900` 境界**の Vitest は **`buildLeaderboardFooterChipsByPartKeyForScheduleRows` + `preferredDisplayRowIds`** 経路が **安定**（装飾ルート単体より materialization 副作用を避けやすい）。
- **トラブルシュート**:
  - **フッタと一覧の完了表示がズレる** → Pi5 **`api`** が **`c2e7438a` 以降（またはマージ後 `main` HEAD）**か、**`Git: changed`** と **API コンテナ再作成**を確認（[KB-375](../knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md) の effective completion と混同しない）。
  - **`verify-phase12-real.sh` のみ `deploy-status` FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・再実行。
- **ナレッジ**: [KB-376](../knowledge-base/KB-376-leaderboard-footer-display-scope-winner-alignment.md)·[ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·**`main` マージ** **`1dc2aedd`**·実装 tip **`c2e7438a`**。

### 補足（2026-05-10 · **キオスク完了整合（KB-375・明示 `/completion`・CSV 同期ガード・実効完了共有）**·**API+Web**·**Pi5→Pi4×4 順次**） {#kiosk-leaderboard-completion-integrity-2026-05-10}

- **変更概要（正本）**: [KB-375](../knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)。**API**: `PUT /api/kiosk/production-schedule/:rowId/completion` + `{ "intent": "complete" | "incomplete" }`（同 intent 再適用は **`unchanged`**）。**互換**: `PUT …/complete` は **トグル**のまま。**CSV→`ProductionScheduleProgress`**: `progress` **空**は **既に手動完了**なら **同期で未完に戻さない**（[`progress-csv-sync-decision.policy.ts`](../../apps/api/src/services/production-schedule/progress-csv-sync-decision.policy.ts)）。**表示**: 一覧・資源チップ・納期集計で **effective completion** を共有。**新規マイグレーション**: なし。
- **対象ホスト（本記録・ユーザー指定どおり 5 台のみ・1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3 サイネージ**: 本リリースの **`update-all-clients.sh … --limit <上記>`** では **play は `skipping: no hosts matched`**。**Pi3 リソース僅少のため、Pi3 を対象に含める場合は本リポジトリの Pi3 専用・省リソース手順（別 playbook／別節）に従う**——**本記録では Pi3 をデプロイ対象に含めていない**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·各ホスト **`./scripts/update-all-clients.sh fix/leaderboard-completion-integrity infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**（**`main` マージ後は引数 `main`**）。
- **本番デプロイ（先行反映・実績・2026-05-10）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-074230-10392`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 766s**・サマリ **`Git: changed`**·**Docker compose 再起動タスクはリトライ後 `changed`**（一過性の `FAILED - RETRYING` あり））/ **`20260510-075520-22663`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**·**`kiosk-browser` / `status-agent` / `status-agent.timer` 再起動 `ok`**）/ **`20260510-080053-3965`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）/ **`20260510-080512-13265`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）/ **`20260510-080941-22009`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=10` `failed=0`**）。いずれも **`Pi 3 signage` play は no hosts matched**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale・Pi5 API `100.106.158.2`）。**`deploy-status`**: **4 台の Pi4 キオスクすべて PASS**。**`auto-tuning scheduler` ログ**: **件数=1**（WARN なし）。
- **知見（ローカル preflight）**: `update-all-clients.sh` は **未追跡ファイル含む作業ツリー汚れ**で **[ERROR] 未commit** となる。**デプロイ前**に **`git stash push -u`** 等でクリーン化（診断用スクリプトのみの場合も同様）。
- **トラブルシュート**:
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・**全台 `--limit` 順次完走後**に再実行。
  - **完了が CSV 後に落ちる** → Pi5 `api` が **`c063ab57` 以降（またはマージ後 `main` HEAD）**か・[`progress-csv-sync-decision.policy.test.ts`](../../apps/api/src/services/production-schedule/__tests__/progress-csv-sync-decision.policy.test.ts) の意図どおりか。
  - **同じ「完了」操作で未完に戻る** → Web が **`/completion`** + **`intent`** 版か（**`/complete` トグルの二重送信**は従来どおり反転し得る）。
- **ナレッジ**: [KB-375](../knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)·[KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`c063ab57`**。

### 補足（2026-05-09 · **生産日程CSV「消滅」外部完了・母集団を FKOJUNST 非C × occurredAt ±3ヶ月へ整合**·**API のみ**·**Pi5 のみ**） {#schedule-csv-disappearance-nonc-window-2026-05-09}

- **問題の文脈**: 生産日程本体 CSV は **日付レンジ指定取得**（運用上 **直近3ヶ月〜先3ヶ月**・`occurredAt` がその窓に収まる）。一方 **`FKOJUNST_Status` メール CSV 側はより広いレンジ**（例: 直近4ヶ月）で届くため、旧 **「取込直前スナップショット vs 取込後キー」** の差分だけでは、**日程窓外に落ちただけの行を「消滅完了」扱い**し得た。また **完了はメール status `C`/`X` の正本**と **`C` キーと日程側キーの空間不一致**（[KB-373](../knowledge-base/KB-373-fkojunst-status-c-key-domain-mismatch.md)・[ADR-20260509](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md)）から、**メール由来完了（`C`/`X`）を消滅完了の対象に含めない**（**2026-05-18**: **`X` も `C` と同様に母集団外**へ統一。実装は [`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts) の `buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql` を正本とする）。
- **仕様（本変更後）**:
  - **母集団（消滅候補）**: 生産日程ダッシュボード（`ProductionSchedule_Mishima_Grinding`）の **`CsvDashboardRow` winner** のうち、**`ProductionScheduleFkojunstMailStatus` が紐付き **メール由来完了（`C`/`X`）以外**（`UPPER(BTRIM("fkmail"."statusCode")) NOT IN ('C','X')` 相当）** かつ **`occurredAt` が基準日時の UTC `±3` カ月**に入る行の論理キー集合（[`production-schedule-nonc-window-winner-key.query.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-nonc-window-winner-key.query.ts)・窓は [`schedule-csv-disappearance-occurred-at-window.policy.ts`](../../apps/api/src/services/production-schedule/policies/schedule-csv-disappearance-occurred-at-window.policy.ts)）。
  - **消滅判定**: **母集団キー − 今回取込CSVの現 winner 論理キー**。**1 回の取込でキーが母集団にあって現CSVに無ければ** `externallyCompletedFromScheduleCsvDisappeared` 経路で完了候補（従来どおり repository の OR 合成・**再出現時は解除**）。
  - **ガード**: **現 winner 0 件（`empty_schedule_csv`）** は従来どおり **消滅差分も DB 更新もスキップ**（誤一括完了防止）。
  - **一覧・実効完了 SQL 上の「消滅候補」フラグ**: [`buildFkojunstScheduleCsvDisappearanceEligibleScalarSql`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts) を **`fkmail` ありかつメール完了以外**に変更（**`S`/`R` に限定しない**・`O`/`P`/その他 **メール完了以外** も **消滅完了の対象**になり得る。**`C`/`X` はメール完了正本側**で扱う）。
  - **スナップショット**: 取込前 `capturePreIngestSnapshot` は **no-op（deprecated）**。`ProductionScheduleCsvIngestLogicalKeySnapshot` テーブル／[`schedule-csv-logical-key-snapshot.repository.ts`](../../apps/api/src/services/production-schedule/external-completion/schedule-csv-logical-key-snapshot.repository.ts) は **互換のため保持**するが、**本消滅計算の主経路では未使用**。
- **新規マイグレーション**: **なし**。
- **自動テスト**: [`production-schedule-csv-ingest-external-completion-sync.service.test.ts`](../../apps/api/src/services/production-schedule/external-completion/__tests__/production-schedule-csv-ingest-external-completion-sync.service.test.ts)·[`schedule-csv-disappearance-occurred-at-window.policy.test.ts`](../../apps/api/src/services/production-schedule/policies/__tests__/schedule-csv-disappearance-occurred-at-window.policy.test.ts)·[`fkojunst-production-schedule-list-visibility.policy.test.ts`](../../apps/api/src/services/production-schedule/policies/__tests__/fkojunst-production-schedule-list-visibility.policy.test.ts)·[`fkojunst-mail-status-completion.policy.test.ts`](../../apps/api/src/services/production-schedule/completion/__tests__/fkojunst-mail-status-completion.policy.test.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4 キオスク／Pi3 サイネージ play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/external-completion-schedule-disappearance-non-c infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績・2026-05-09）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260509-170432-1808`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 705s**・サマリ **`Git: changed`**・**Docker 再起動あり**）。**`Run prisma migrate deploy` / `prisma migrate status`**: **成功**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 190s**・Tailscale・Pi5 API `100.106.158.2`）。
- **トラブルシュート**:
  - **外れ値の「完了が付いた／付かない」** → **①** `fkmail.statusCode`（**`C`/`X` はメール完了**・消滅母集団から **`C`/`X` は除外**） **②** 対象行の **`occurredAt` が ±3ヶ月窓内か**（窓外は母集団に入らず消滅完了しない） **③** 直近取込が **`empty_schedule_csv` で skip されていないか**（ingestor warn） **④** Pi5 **`api` ref** が **`89086089` 以降（またはマージ後 `main` HEAD）**か。
  - **再出現後も完了のまま** → 実装は **OR 再計算で消滅由来を外し得る**構成のため、**メール `C`/`X` や手動完了**が残っていないか **`ProductionScheduleExternalCompletion`** を確認。
- **ナレッジ**: [KB-370 §Production 2026-05-09](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-09-schedule-csv-disappearance-nonc-window)·[KB-373](../knowledge-base/KB-373-fkojunst-status-c-key-domain-mismatch.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`89086089`**。

### 補足（2026-05-16 · **生産日程CSV「消滅」入力の正本C current keys（本体 dedupe winner のみ）**·**API のみ**·**`raspberrypi5` のみ**） {#schedule-csv-disappearance-canonical-current-keys-2026-05-16}

- **問題の文脈（2026-05-09 仕様との関係）**: **消滅母集団**は従来どおり **メール完了（`C`/`X`）以外 × `occurredAt` ±3ヶ月**（[#schedule-csv-disappearance-nonc-window-2026-05-09](#schedule-csv-disappearance-nonc-window-2026-05-09)）。一方、**差分の「現 winner 側」キー集合**を **`FKOJUNST` メールの JOIN 有無**で間接的に絞り込むと、**メール側に行がまだ載っていない（FK 欠落）本体 winner** を **誤って「CSV から消えた」**とみなし、**消滅完了が早立ち**し得る。
- **仕様（本変更後）**:
  - **正本Cの current keys**: 今回取り込んだ **生産日程本体 CSV の dedupe winner** から導出した論理キー集合のみを、**`applyPostIngestFromSnapshot` の「現 winner」入力**に渡す（[`ProductionScheduleCanonicalCurrentKeysService`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-canonical-current-keys.service.ts)·[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts)）。
  - **母集団（消滅候補）・`C`/`X` 除外（メール完了）・空 winner ガード** は **2026-05-09 項と同一**（**2026-05-18**: `X` を **`C` と同列**に母集団外へ）。**計画ファイル（CSV）は編集しない**——専用サービス経由で **外部完了同期の入力だけ** を整理する。
  - **`currentWinnerKeys` 引数名** は **後方互換の deprecated エイリアス**。ログキーは **`canonicalScheduleDisappearanceCurrentKeys`** 側を正と読む。
- **新規マイグレーション**: **なし**。
- **自動テスト**: [`production-schedule-canonical-current-keys.service.test.ts`](../../apps/api/src/services/production-schedule/external-completion/__tests__/production-schedule-canonical-current-keys.service.test.ts)·[`production-schedule-csv-ingest-external-completion-sync.service.test.ts`](../../apps/api/src/services/production-schedule/external-completion/__tests__/production-schedule-csv-ingest-external-completion-sync.service.test.ts)（方針変更に伴い、一覧用に一度追加していた **「正本への `C` の有無」ポリシー分岐**とそのテストは **削除済み**）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。Pi4 キオスク／Pi3 サイネージ play は **no hosts matched**（**Pi3 はリソース僅少のため、本項では Ansible 本流を当てず、Pi3 専用手順も不要／未実施で正**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/canonical-schedule-disappearance-current-keys infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-16）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260516-181817-25397`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0` / `unreachable=0`**・リモート **`exit 0`**・ローカル **`--follow` 約 286s**・サマリ **`Git: changed`**。**`Rebuild/Restart docker compose services` は `skipping`**（コード差分のみで **イメージ再ビルド不要**と判断された記録）だが **`Ensure api and web containers are running` は `changed`** の後 **`prisma migrate deploy` / `status` は `ok`**・**API health `ok`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 140s**・Tailscale·Pi5 API `100.106.158.2`）。
- **CI**: **`25956906908`** **success**（同一ブランチ先端）。**事前失敗ラン** **`25956583435`**（**`security-docker` / Trivy** で **`usr/bin/caddy`** 由来 Go stdlib の **HIGH** 複数。**対処**: [`.trivyignore`](../../.trivyignore) に **CVE-2026-33811** / **CVE-2026-33814** / **CVE-2026-39820** / **CVE-2026-39836** / **CVE-2026-42499** を追記·コミット **`0e327378`**）。
- **トラブルシュート**:
  - **本体 winner はいるのに CSV 消滅だけ早く完了した** → Pi5 **`api` ref** が **`09f06ebf` 以降（またはマージ後 `main` HEAD）**か。**ingest の post-sync** が **`canonicalScheduleDisappearanceCurrentKeys`** 入力を見ているログになっているか。
  - **`update-all-clients.sh` が即終了** → **未コミット／未追跡**の作業ツリー（[§2026-05-09 項の TS](#schedule-csv-disappearance-nonc-window-2026-05-09) と同様に **stash / commit**）。
  - **Trivy で Caddy HIGH が再発** → **`.trivyignore` の方針**は [ci-troubleshooting §Trivy Caddy](../guides/ci-troubleshooting.md#trivy-が-web-イメージの-caddy-バイナリで-cve-を検出してジョブが失敗する)・**恒久はイメージ／Caddy 更新を追跡**。
- **ナレッジ**: [KB-370 §Production 2026-05-16](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-16-schedule-csv-disappearance-canonical-current-keys)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`09f06ebf`**（本体）·**`0e327378`**（Trivy 抑止）。

### 補足（2026-05-17 · **消滅 current keys の 2CSV 交差（本体 × `FKOJUNST_Status`）**·**API のみ**·**`raspberrypi5` のみ**） {#schedule-csv-disappearance-2csv-intersection-2026-05-17}

- **目的**: Follow-up で整理した **「2系統 CSV を先に照合した集合を current とみなす」** を、`ProductionScheduleCanonicalCurrentKeysService` 経由で **差分消失の入力**に反映する。
- **仕様**:
  - **`tA`（アンカー）**: **生産日程CSV DEDUP 取込が完了した時刻**（ingestor が `scheduleIngestCompletedAt` として渡す）。**`FKOJUNST_Status` 幕は `dateColumnName: null`** で **`CsvDashboardRow.occurredAt`≈メール取込時刻**のため、**本体CSVの日付列 `occurredAt` を `tA` に混ぜない**。
  - **`tB`（参照相手）**: **`tB <= tA` の最新完了 `FKOJUNST_Status` ingest run**（`CsvDashboardIngestRun.completedAt`）。**原本CSV 1件**（`csvFilePath`）だけを読み、その run の Status スナップショットを使う。
  - **Status スナップショット**: **`tB` に対応する原本CSV 1件**。同一3キーは **`FUPDTEDT` 最新**（既存 `dedupeFkojunstMailRowsByLatest`）。
  - **交差（正本C current keys）**: 本体 dedupe winner の各行について **ADR-20260509 系3キー**（`FKOJUN` + 正規化 `FSIGENCD`/`FKOTEICD` + `ProductNo`/`FSEZONO`）が Status スナップショットに存在する場合のみ、**外部完了論理キー**を current に含める。
  - **スキップ**: `tA` 以前に完了 ingest run が無い、または `tB` 原本CSVを正規化しても Status 行が **0 件**のとき、**`applyPostIngestFromSnapshot` を呼ばず**差分消失のみスキップ（ingestor **`2CSV pairing / status snapshot`** warn）。
  - **運用上の設定正本**: **管理コンソール**および Pi5 **`config/backup.json` の `csvImports`**。リポジトリの **システム予約ビルトイン**（[`system-csv-import-schedule-builtin-rows.ts`](../../apps/api/src/services/imports/system-csv-import-schedule-builtin-rows.ts)）の **`enabled` は初期マージ用**であり、**本番の有効／無効の推測根拠にはしない**（**`FKOJUNST_Status` がビルトインで `false` でも、現場では有効化されている**ことが普通にあり得る）。**`tB` 成立**には **有効な Status 取込と、少なくとも `tA` 以前の完了 ingest run** が必要。
- **実装参照**: [`schedule-csv-disappearance-canonical-keys.builder.ts`](../../apps/api/src/services/production-schedule/external-completion/schedule-csv-disappearance-canonical-keys.builder.ts)·[`production-schedule-canonical-current-keys.service.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-canonical-current-keys.service.ts)·[`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)（`loadFkojunstMailNormalizedRowsFromCsvFile`）·[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts)。
- **自動テスト**: [`schedule-csv-disappearance-canonical-keys.builder.test.ts`](../../apps/api/src/services/production-schedule/external-completion/__tests__/schedule-csv-disappearance-canonical-keys.builder.test.ts)·[`production-schedule-canonical-current-keys.service.test.ts`](../../apps/api/src/services/production-schedule/external-completion/__tests__/production-schedule-canonical-current-keys.service.test.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。Pi4 キオスク／Pi3 サイネージ play は **no hosts matched**（**Pi3 は省リソースのため本流 playbook 未適用／本項では専用手順も不要・未実施で正**）。
- **標準コマンド（先行反映時はブランチ名、マージ後は `main`）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-completion-csv-pairing infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-17）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260517-151209-29249`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0` / `unreachable=0`**・リモート **`exit 0`**・ローカル **`--follow` 約 302s**・サマリ **`Git: changed`**）。当該 run **Docker compose 再ビルド／再起動は `skipping`**。**`prisma migrate deploy` / `status`**: **`ok`**（**新規マイグレーションなし**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **最終 PASS 43 / WARN 0 / FAIL 0**（本記録 **約 140s**・Tailscale·Pi5 **`100.106.158.2`**）。
- **トラブルシュート**:
  - **`update-all-clients.sh` が「ローカルロック」で即終了** → 別端末で同一スクリプト実行中の **pid** を **終了または完了待ち**してから再実行（ロックファイルは **同コマンドの多重起動防止**）。
  - **Phase12 で Pi5 へ SSH 中に `Connection closed`・`backup.json` チェックだけ FAIL** → **一時的な SSH 切断**の典型。**数分後に `verify-phase12-real.sh` だけ再実行**（本記録では **42/0/1 → 再試行 43/0/0**）。
  - **差分消失が妙に付かない／多い** → API ログ **`[CsvDashboardIngestor] Schedule CSV disappearance sync skipped (2CSV pairing / status snapshot)`** の **`reason` / `diagnostics`**（例: **`no_status_ingest_run_at_or_before_reference_at`**・**`no_status_csv_rows_at_or_before_reference_at`**）を確認。**Pi5 `api` ref** が **`ed733bfe` 以降（またはマージ後 `main` HEAD）**か。**`no_status_ingest_run_at_or_before_reference_at` の増加**は **Status 取込スケジュール無効**・**初回のみ本体先行**・**まだ Status の完了 run が無い** 等を疑い、**`backup.json` / 管理画面**と **`CsvDashboardIngestRun`** を見る（**ビルトイン定数のみで判断しない**）。
- **ナレッジ**: [KB-370 §Production 2026-05-17](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys)·[KB-370 §2CSV 運用](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#kb-370-2csv-schedule-operational-pairing)·[Follow-up（2CSV 実装）](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#follow-up2026-05-17--2csv-照合-current-keys-の実装)·[csv-import-export §FKOJUNST/2CSV](../guides/csv-import-export.md#fkojunst-2csv-disappearance-schedule-notes)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`ed733bfe`**（**`main`**: [PR #290](https://github.com/denkoushi/RaspberryPiSystem_002/pull/290) **squash** **`f252793d`**）。

### 補足（2026-05-18 · **生産日程CSV消滅・`X` を母集団外へコード整合（ドキュメント先行と実装の齟齬解消）**·**API のみ**·**`raspberrypi5` のみ**） {#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18}

- **背景**: 2026-05-09 以降の **文書・SQL 方針**では **`C`/`X` はメール由来完了**であり **消滅母集団（メール完了以外×±3ヶ月）から除外**としていたが、実装の一部で **`X` だけ** **`scheduleCsvWinnerEligible` / 母集団クエリ**に **残る経路**があり（**`buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql` 以外の重複条件**）、**`X` が日程 CSV 側のキー挙動と「完了」解釈の間で差分消失に巻き込まれる**余地があった。**Fix**: 母集団・一覧の消滅候補 SQL の **`fkmail.statusCode` 判定を単一のスカラ SQL ビルダーへ寄せ**、**`NOT IN ('C','X')`（`UPPER(BTRIM(...))` 相当）**で固定（[`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts)・利用側 [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts)·[`production-schedule-nonc-window-winner-key.query.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-nonc-window-winner-key.query.ts)）。
- **CI（同ブランチ）**: **`security-docker`** が **API イメージ**の Debian **`libcap2`** で **CVE-2026-4878** を検出し得る。**対処**: **`.trivyignore`** 追記 + **API イメージ scan ジョブへ `trivyignores: '.trivyignore'`**（**`2170bb18`**）。**恒久**は **ベースイメージ更新タイミングで再評価**（[ci-troubleshooting §Trivy](./ci-troubleshooting.md) の方針に倣う）。
- **新規マイグレーション**: **なし**。
- **自動テスト**: `fkojunst-mail-status-completion.policy.test.ts`・`fkojunst-production-schedule-list-visibility.policy.test.ts`・`production-schedule-csv-ingest-external-completion-sync.service.test.ts`。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。Pi4／Pi3 **no hosts matched**（**Pi3 専用手順は不要／未実施で正**）。
- **標準コマンド（先行反映時）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-completion-exclude-x-from-disappearance infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数を `main`**）。
- **本番デプロイ（実績・2026-05-18）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260518-175005-7497`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit 0`**・ローカル **`--follow` 約 987s**・**Summary `success: true`**・**`Git: changed`**·**`Docker restart summary: [{'status': 'ok'}]`**・**`Run prisma migrate deploy` / `prisma migrate status` `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**`real` 約 81s**・Tailscale·Pi5 API **`100.106.158.2`**）。**`deploy-status`（Pi4×4）**: **すべて PASS**。
- **知見**:
  - **長時間デプロイ**: **`Rebuild/Restart docker compose services`** 付近から **完了まで ~16min 級**になり得る。**detach `--follow`** は **ローカル端末を占有**するが **完了判定の正本**になりやすい。
  - **`alerts/alert-*.json`**: playbook 正常終了後でも **複数生成され得る**。**`failed=0` と Summary success** が先。
- **トラブルシュート**:
  - **`X` 完了行が差分消失だけ不整合** → Pi5 **`api`** が **`49d19dce` 以降（またはマージ後 `main` HEAD）**か・**母集団 SQL が単一ビルダー**に揃っているか（本項の実装参照）。
  - **CI の API image Trivy が `libcap2` で落ちる** → **`.trivyignore`** と **workflow の `trivyignores`** を確認（**`2170bb18`**）。
- **ナレッジ**: [KB-370 §Production 2026-05-18](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-18-schedule-csv-disappearance-exclude-x-code-alignment)·[§2026-05-09 消滅窓](#schedule-csv-disappearance-nonc-window-2026-05-09)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`49d19dce`**（本体）·**`2170bb18`**（CI）·**`main` squash `e2abadce`**（[PR #294](https://github.com/denkoushi/RaspberryPiSystem_002/pull/294)）。

### 補足（2026-05-09 · **キオスク順位ボード・`FKOJUNST_Status` 完了行（`C`/`X`）一覧再表示 + 既定完了フィルタ `all`**·**API+Web**·**Pi5→Pi4×4・1 台ずつ**） {#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09}

- **変更概要**: **`FKOJUNST_Status`（`fkmail`）が `C`/`X` の winner 行**が、2026-05-08 の一覧可視ポリシー（**`S`/`R` のみ**）により **生産日程一覧 API から落ち**、キオスク順位ボードで **完了グレーアウト（カード本体・資源CDチップ）を視認できない**状態になっていた。**Fix**: [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts) で **一覧可視と `rowData.FKOJUNST` 表示を `S`/`R`/`C`/`X` に拡張**（**`O`/`P`**・不明値は **従来どおり非表示・未完了**・total 集計には残る）。**Web**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) の **`LeaderOrderCompletionFilter` 初期値を `all`**（[KB-297 §完了フィルタ既定 `incomplete`](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-default-completion-filter-incomplete-2026-04-30) とは **順位ボード用途が分岐**し、**完了 `C`/`X` 行の既定表示**を優先）。**完了判定の正本**は従来どおり **実効完了 SQL**（手動 OR 外部）+ **メール status `C`/`X` のみ**が外部完了（[`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts)）。**新規マイグレーションなし**。**自動テスト**: [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts)（`C`/`X` 可視の回帰）。
- **対象ホスト（本記録）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**キオスク順位ボード系 5 台のみ**。**Pi3 は対象外**・Pi3 専用手順は実行していない）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·各ホスト **`./scripts/update-all-clients.sh fix/kiosk-leaderboard-completed-visibility infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**（**1 台ずつ**）。**`main` 取り込み後はブランチ引数を `main`**。
- **本番デプロイ（先行反映・実績・2026-05-09）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260509-093716-30174`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 702s**・サマリ **`Git: changed`**・**Docker 再起動あり**）/ **`20260509-094901-17785`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**・**`kiosk-browser` / `status-agent` 再起動 `ok`**）/ **`20260509-095434-23706`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）/ **`20260509-095842-2865`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）/ **`20260509-100237-8760`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=11` `failed=0`**）。いずれも **`Pi 3 signage` play は no hosts matched**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 67s**・Tailscale・Pi5 API `100.106.158.2`）。**`deploy-status`** は **4 台の Pi4 キオスクすべて PASS**。
- **トラブルシュート**:
  - **`C`/`X` 行がまだ見えない / グレーアウトしない** → Pi5 **`api` と各 Pi4 `web` の ref が **`ae6034c8` 以降（またはマージ後 `main` HEAD）**か、Detach ログの **`Git: changed`** を確認。**API 単体では行が返るが UI が旧** → キオスク **強制リロード**（[verification-checklist.md](verification-checklist.md) §6.6.4）。**左ペインが「未完」のみ** → Web が **`completionFilter` 初期 `all`** 版か確認（**手動で「両方」にすれば同等表示**）。
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)・Pi5 **`config/deploy-status.json`**・全台反映完了後の再実行。
  - **2026-05-08 項の「一覧は `S`/`R` のみ」記述** → **本項で `C`/`X` を一覧に載せるよう改訂**。**運用上の正本は本項 + [KB-297 §外部完了](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)**。
- **ナレッジ**: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`ae6034c852256639a2f62aee5709786f10f608fb`**。

### 補足（2026-05-09 · **キオスク順位ボード・`leaderboard-board/continue` の `cursor` 契約（Zod 400 防止）**·**API+Web**·**Pi5→Pi4×4・1 台ずつ**） {#leaderboard-board-continue-cursor-contract-2026-05-09}

- **問題の文脈**: 複合 board の追補で **`hasMore: true` かつ `snapshotId` がある**とき、リクエストボディに **`cursor` が必須**である一方、**`nextCursor` が `undefined`** の場合にクライアントが **`cursor` を JSON から省略**し、**Zod で 400** になることがあった。
- **Fix（要約）**: API は [`resolveFiniteLeaderboardBoardNextCursor`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-board-resource-cursor.ts) で各 **`resources[].nextCursor`** を **有限カーソルへ正規化**（[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)）。Web は [`buildLeaderboardBoardContinuePayload`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) で **`hasMore && snapshotId` 時は `cursor` を必ず送る**（要時 **`0` フォールバック**）。**新規マイグレーションなし**。**自動テスト**: `leaderboard-board-resource-cursor.test.ts`・`buildLeaderboardBoardContinuePayload.test.ts` ほか。
- **対象ホスト（推奨順）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh fix/kiosk-leaderboard-board-continue-cursor infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**。**`main` マージ後は引数 `main`**）。
- **本番デプロイ（ローカル採取 Detach の実績）**: **`20260509-202031-28691`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）/ **`20260509-204430-26553`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**）。**残り 3 台**（`raspi4-robodrill01` / `raspi4-fjv60-80` / `raspi4-kensaku-stonebase01`）は **同一ブランチで順次実行し `failed=0` まで確認**（セッション記録）。**各 Detach ID** は Pi5 の **`/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.summary.json`** で追補可能。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 123s**・Tailscale・Pi5 API `100.106.158.2`）。
- **トラブルシュート**:
  - **`leaderboard-board/continue` が 400** → Network の JSON に **`cursor` が無い**か確認。**API/Web の ref** が **`6bfd2c2b` 以降（またはマージ後 `main` HEAD）**か。
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → 連続デプロイ直後の **`isMaintenance: true`** が残っている可能性。[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·全台完了後に再実行。
- **ナレッジ**: [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`6bfd2c2b`**。

### 補足（2026-05-18 · **キオスク順位ボード・追補 `Network Error` 回復性（Compose readiness + transient/terminal 分類）**·**API+Web**·**Pi5→Pi4×4・1 台ずつ**） {#kiosk-leaderboard-network-error-resilience-2026-05-18}

- **変更概要**: 順位ボードの追補（`POST /api/kiosk/production-schedule/leaderboard-board/continue`）で、契約違反（400）ではなく **API 一時未到達（Caddy 502 / connection refused）** を起点に `Network Error` が表示される経路を是正。**インフラ**は [`docker-compose.server.yml`](../../infrastructure/docker/docker-compose.server.yml) で `db` / `api` healthcheck と `web` の `api` healthy 待ちを明示。**Web** は [`leaderboardContinueErrorPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardContinueErrorPolicy.ts) で失敗を **`transient` / `terminal`** に分離し、**応答なし・5xx・408/429** は `appendError` を確定しない。契約エラー（4xx）は従来どおり明示。
- **対象ホスト（ユーザー指定の5台のみ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh fix/kiosk-leaderboard-networkerror-resilience infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ順次**）。**Pi3** は対象外で、各 run の Pi3 play は **`no hosts matched`**（Pi3 専用手順は未実施で正）。
- **本番デプロイ（実績・2026-05-18）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260518-193612-24083`**（`raspberrypi5`·**`ok=134` `changed=4` `failed=0` / `unreachable=0`**）/ **`20260518-194538-23622`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**）/ **`20260518-195212-20827`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）/ **`20260518-195749-32736`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）/ **`20260518-200323-26959`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=10` `failed=0`**）。全 run でリモート **`exit 0`**・summary **`success: true`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 68s**・Tailscale・Pi5 API `100.106.158.2`・`deploy-status` 4台 PASS）。
- **トラブルシュート**:
  - **`Network Error` 再発** → まず Caddy の **502 / connection refused** と API 側 4xx を分離。4xx は契約・認可系、応答なし/5xx は到達性系として扱う。
  - **デプロイ後も旧挙動** → detach サマリの **`Git: changed`** と各 Pi4 の `kiosk-browser` 再起動を確認。必要時は [verification-checklist.md](verification-checklist.md) の強制リロード。
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → 連続デプロイ直後の `isMaintenance` 残留を疑い、全台完了後に再実行する。
- **ナレッジ**: [KB-380](../knowledge-base/KB-380-kiosk-leaderboard-network-error-resilience.md)·[KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-18 · **キオスク順位ボード・出力不変の内部最適化（winner materialization 共有 + continue 合成責務分離）**·**API+Web**·**Pi5→Pi4×4・1 台ずつ**） {#kiosk-leaderboard-output-stable-speedup-2026-05-18}

- **変更概要**: [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) の `continue` 経路で、同一 HTTP リクエスト内の `resolveLeaderboardMaterializedBaseWhere` を 1 回化し、資源スライス間で共有。continue の prefix/チャンク合成は [`leaderboard-composite-board-continue-assembly.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-continue-assembly.ts) へ分離し、オーケストレーション責務と純粋組み立て責務を分離。Web は [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) で `scheduleEnabled=false` 時の無駄な再計算を抑制。**表示結果（rows 順序・件数・total）は不変**。
- **対象ホスト（ユーザー指定 5 台のみ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh perf/leaderboard-board-output-stable-v2 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ順次**）。**Pi3** は対象外で、各 run の Pi3 play は **`no hosts matched`**（Pi3 専用手順は未実施で正）。
- **本番デプロイ（実績・2026-05-18）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260518-205259-21751`**（`raspberrypi5`·**`ok=134` `changed=4` `failed=0` / `unreachable=0`**）/ **`20260518-210326-27579`**（`raspberrypi4`·**`ok=122` `changed=10` `failed=0`**）/ **`20260518-210844-6675`**（`raspi4-robodrill01`·**`ok=122` `changed=9` `failed=0`**）/ **`20260518-211243-7536`**（`raspi4-fjv60-80`·**`ok=122` `changed=9` `failed=0`**）/ **`20260518-211700-30413`**（`raspi4-kensaku-stonebase01`·**`ok=129` `changed=10` `failed=0`**）。全 run でリモート **`exit 0`**・summary **`success: true`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 67s**・Tailscale・Pi5 API `100.106.158.2`・`deploy-status` 4台 PASS）。
- **ローカル回帰（Mac + Docker Postgres）**: `pnpm test:postgres:start` → `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return pnpm --filter @raspi-system/api exec prisma migrate deploy` → `pnpm --filter @raspi-system/api test -- kiosk-production-schedule.integration.test.ts -t "leaderboard-board continue profile logs"` が成功。`rows[].id` と `total` が単一 `GET .../leaderboard-board` と一致することを確認後、`pnpm test:postgres:stop` で一時コンテナを削除。
- **トラブルシュート**:
  - **`gh run watch` がローカルでタイムアウト** → CI の失敗とは別。`gh run view <run-id>` で最終結論を確認する。
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → 全台の `--limit` 完了後に再実行し、`isMaintenance` 残留を排除して判定する。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)·[KB-380](../knowledge-base/KB-380-kiosk-leaderboard-network-error-resilience.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-18〜19 · **キオスク順位ボード・continue `deltaRows`（dual payload）**·**API+Web**·**Pi5 先行 → Pi4×4 順次・完了**） {#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18}

- **変更概要**: `POST …/leaderboard-board/continue` が **`deltaRows`（任意）** を返す場合がある。**累積 `rows` は従来どおり正本**で、`deltaRows` が無い／マージ失敗時も **表示は `rows` 正本で不変**。サーバ: [`leaderboard-composite-board-continue-assembly.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-continue-assembly.ts)·[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)。Web: [`mergeLeaderboardBoardContinueResponse.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardContinueResponse.ts)。
- **対象ホスト（本記録）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`--limit` 1 台ずつ**）。**Pi3** は **`no hosts matched`**（専用手順未実施で正）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-continue-delta-safe infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は `main`**）。
- **本番デプロイ（実績）**:
  - **Pi5 先行（API のみ先行意図・当時 tip `371a1ce2`）**: **Detach `20260518-222320-4985`**（`raspberrypi5`·**`failed=0` / `unreachable=0`**·`Git: changed`）。
  - **Pi5 再反映 + Pi4 順次（表示安定化・pageSize 80 を含む tip `f6a220e0`）**: Pi5 **`20260519-094525-13421`** / Pi4 **`20260519-095716-15636`** / **`20260519-100222-24882`** / **`20260519-100620-10211`** / **`20260519-101025-2757`**（いずれも **`failed=0`**・Pi4 は **`kiosk-browser` / `status-agent` 再起動**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。**`deploy-status`（Pi4×4）**・**`status-agent`（Pi4×4）**: すべて **PASS**。
- **実機（現場）**: 順位ボード表示 **正常**（ユーザー確認）。
- **ローカル回帰**: `kiosk-production-schedule.integration.test.ts -t "leaderboard-board continue profile logs"`（各 `continue` で **`deltaRows` 配列**・完了後 **`rows`/`total` 同値**）。Web Vitest `leaderOrderBoard/__tests__`。
- **トラブルシュート**:
  - **表示の件数・順序だけおかしい** → Network の **`rows` 正本**を確認（`deltaRows` マージ失敗時はクライアントが **`rows` をそのまま採用**）。
  - **Pi4 だけ遅い／ちらつく** → Pi4 **Web** の ref が **`f627dcb0`/`f6a220e0` 以降**か（Pi5 のみ更新ではキオスク体感は変わらない）。
- **ナレッジ**: [KB-374 · Production 2026-05-19](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#production-deploy--verification-2026-05-19--featleaderboard-continue-delta-safe)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`371a1ce2`**。

### 補足（2026-05-19 · **キオスク順位ボード・表示安定化（refetch 時の追補巻き戻し防止）**·**Web**·**Pi5→Pi4×4・完了**） {#kiosk-leaderboard-display-stability-refetch-2026-05-19}

- **変更概要（契約不変）**: `leaderboard-board/continue` の **`rows` 正本**は維持。Web が **ポーリング refetch（約 120s）時に shell 起点で追補を再開し、行が一時的に減って戻る**問題を修正。実装: [`leaderboardBoardAppendSessionPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionPolicy.ts)·[`leaderboardBoardDisplayPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardDisplayPolicy.ts)·[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx)。
- **本番**: [§deltaRows（2026-05-18〜19）](#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18) の **Pi5 `20260519-094525-13421` および Pi4 順次 Detach** に同梱（**`f627dcb0`**）。**現場**: 表示 **正常**（ちらつきなし・ユーザー確認）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard/__tests__`（追補完了後 refetch で行数維持）。
- **トラブルシュート**: **2 分待っても行が消える** → Pi4 **Web** が未反映・キオスク **強制リロード**。[KB-380](../knowledge-base/KB-380-kiosk-leaderboard-network-error-resilience.md) の transient 失敗と混同しない（本件は **refetch による表示巻き戻し**）。
- **ナレッジ**: [KB-374 · Web 表示安定化](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#web-表示安定化-refetch-時の追補巻き戻し防止-2026-05-19)·代表コミット **`f627dcb0`**。

### 補足（2026-05-19 · **キオスク順位ボード・pageSize 80（第1弾・continue 回数削減）**·**Web**·**Pi5→Pi4×4・完了**） {#kiosk-leaderboard-pagesize-80-phase1-2026-05-19}

- **変更概要（契約不変）**: [`LEADER_ORDER_BOARD_SHELL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) を **20 → 80**。board 初回 GET と `leaderboard-board/continue` の `pageSize` に反映。**`rows` 正本**・`deltaRows` 任意・表示安定化は維持。**API 変更なし**（Zod 上限 160 内）。Mac ベンチ（2 資源×140 行）では pageSize 20→80 で **完了時間約 75% 短縮**・**ID/件数整合 OK**（実装時記録）。
- **本番**: [§deltaRows（2026-05-18〜19）](#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18) と同一 Detach 列（**`f6a220e0`**）。**Pi5+Pi4 全 5 台**に反映済み。
- **Pi5 ゲート（実機・通過）**: ちらつきなし・体感短縮・continue 回数減・行 ID/件数整合（現場 **表示正常・体感速度維持**）。
- **ローカル回帰**: Web Vitest `leaderOrderBoard/__tests__`·統合 `leaderboard-board continue profile logs`。
- **ロールバック**: 定数を **20** に戻し Web を再デプロイ（1 点）。
- **第2弾（範囲外）**: continue 内 COUNT/装飾再利用・continue 並列化・`deltaRows` 契約変更。
- **ナレッジ**: [KB-374 · pageSize 80](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#第1弾-pagesize-80continue-回数削減2026-05-19)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·代表コミット **`f6a220e0`**。

### 補足（2026-05-21 · **キオスク順位ボード・continue chunk 80/160（追補 pageSize 80→160）**·**Web**·**Pi5→Pi4×4・完了**） {#kiosk-leaderboard-continue-chunk-160-2026-05-21}

- **背景**: [KB-374 §continue 80/80 実装](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-8080-実装web-のみ--2026-05-21--本番反映済み) 本番後、**continue 80→160** の A/B ベンチ（Pi5 実データ）で **全 profile 出力同値 + 完走時間 26–34% 短縮**（stonebase **rounds 10→5**）と **PASS**。**API `pageSize` 上限 160 済み**·**スロット並列 fan-out は却下**（変更なし）。
- **変更概要（契約不変）**: [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) **80→160** のみ。初回 shell は **80/スロット**（不変）。**API・Zod・`deltaRows`・装飾後取り・端末キャッシュ・製番 OR は不変**。**Pi5 API ロジック変更なし**。
- **対象ホスト（実績・1 台ずつ順次）**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**。**Pi3** は **`no hosts matched`**（専用手順未実施で正）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-continue-chunk-160 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID·`ansible-update-` 接頭辞）**:

  | ホスト | Detach Run ID | 備考 |
  | --- | --- | --- |
  | `raspberrypi5` | **`20260521-203852-9936`** | **`failed=0`**·**`Git: changed`**·Docker 再起動 **ok**·`--follow` 約 **879s** |
  | `raspi4-kensaku-stonebase01` | **`20260521-205337-26001`** | **`failed=0`**·**`kiosk-browser` / `status-agent` 再起動 ok**·約 **333s** |
  | `raspberrypi4` | **`20260521-205915-5232`** | **`failed=0`**·約 **370s** |
  | `raspi4-robodrill01` | **`20260521-210531-13345`** | **`failed=0`**·約 **309s** |
  | `raspi4-fjv60-80` | **`20260521-211045-27096`** | **`failed=0`**·約 **308s** |

- **CI**: **`26222962417` success**（PR [#315](https://github.com/denkoushi/RaspberryPiSystem_002/pull/315)·branch push）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **123s**·Tailscale·Pi5 `100.106.158.2`·`deploy-status` Pi4×4 PASS）。
- **実機（読み取りベンチ·Pi5 実データ）**: `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs` → **robodrill 1.42x**（rounds 2→1）·**fjv 1.36x**（4→2）·**stonebase 1.51x**（10→5）·**全 profile `row ids match: YES`**。
- **実機（手動）**: DevTools Network で **`POST …/leaderboard-board/continue`** の body **`pageSize: 160`**·continue **回数減**·完了後 **行 ID/件数一致**·必要なら **強制リロード**。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard`（**200 PASS**）·`web build` PASS。
- **ロールバック**: 定数を **80**（または **40**）に戻し **Pi4 Web** を再デプロイ（1 点·env なし）。
- **トラブルシュート**: **continue が 80 のまま** → Pi4 Web 未反映·**強制リロード**。**Pi5 のみ更新で体感不変** → **Pi4 必須**（[KB-374 §continue 80/160 Troubleshooting](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#troubleshooting本件-1)）。**デプロイ前**は **`git status` クリーン**（未コミットで `update-all-clients.sh` 拒否）— **`git stash push -u`** 可。
- **ナレッジ**: [KB-374 §continue 80/160 実装](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-80160-実装web-のみ--2026-05-21--本番反映済み)·代表コミット **`4471a444`**·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-21 · **キオスク順位ボード・continue chunk 80/80（追補 pageSize 40→80）**·**Web**·**Pi5→Pi4×4・完了**） {#kiosk-leaderboard-continue-chunk-80-2026-05-21}

- **背景**: [KB-374 §並列化事前検証](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#並列化事前検証pi5-実データ--2026-05-20--実装前) で **スロット並列 fan-out は却下**。[§continue chunk 事前検証](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-8080-事前検証pi5-実データ--2026-05-20--実装前) で **continue 40→80** が **出力同値 + 完走時間最大 ~46% 短縮（stonebase）** と **PASS**。
- **変更概要（契約不変）**: [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) **40→80** のみ。初回 shell は **80/スロット**（[`LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)·変更なし）。**API・Zod・`deltaRows`・装飾後取り・端末キャッシュ・製番 OR は不変**。**Pi5 API ロジック変更なし**（`pageSize` 受け入れ済み）。
- **対象ホスト（実績・1 台ずつ順次）**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**。**Pi3** は **`no hosts matched`**（専用手順未実施で正）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-continue-chunk-80 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID·`ansible-update-` 接頭辞）**:

  | ホスト | Detach Run ID | 備考 |
  | --- | --- | --- |
  | `raspberrypi5` | **`20260521-083210-21952`** | **`failed=0`**·**`Git: changed`**·Docker 再起動 **ok** |
  | `raspi4-kensaku-stonebase01` | **`20260521-085336-30539`** | **`failed=0`**·**`kiosk-browser` / `status-agent` 再起動** |
  | `raspberrypi4` | **`20260521-085933-4370`** | **`failed=0`** |
  | `raspi4-robodrill01` | **`20260521-090422-2566`** | **`failed=0`** |
  | `raspi4-fjv60-80` | **`20260521-090802-31639`** | **`failed=0`** |

- **CI**: 初回 **`26194548007` failure**（`security-docker`·API イメージ **`libgnutls30`**）→ **`12c94486`**（[`Dockerfile.api`](../../infrastructure/docker/Dockerfile.api) **`apt-get upgrade`**) → **`26195283245` success**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5+StoneBase 後および Pi4 全台後）。
- **実機（手動）**: Network で **`leaderboard-board/continue` の `pageSize=80`**·continue **回数減**·完了後 **行 ID/件数一致**·ちらつきなし（必要なら **強制リロード**）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard`（**200 PASS**）·`web build` PASS。
- **読み取りベンチ**: `node scripts/test/benchmark-leaderboard-continue-chunk.mjs`（Pi5 実データ·出力同値確認）。
- **ロールバック**: 定数を **40** に戻し **Pi4 Web** を再デプロイ（1 点·env なし）。
- **トラブルシュート**: **continue が 40 のまま** → Pi4 Web 未反映·**強制リロード**。**Pi5 のみ更新で体感不変** → **Pi4 必須**（[KB-374 §continue 80/80 Troubleshooting](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#troubleshooting本件)）。
- **ナレッジ**: [KB-374 §continue 80/80 実装](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-chunk-8080-実装web-のみ--2026-05-21--本番反映済み)·代表コミット **`a2a3c960`**·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-19 · **キオスク順位ボード・初回10 / 追補40 + continue 装飾分離（第1段階）**·**API+Web**·**Pi5 のみ・Pi4 展開なし**） {#kiosk-leaderboard-initial-10-continue-40-phase1-2026-05-19}

- **変更概要（出力不変・途中体感は変わりうる）**: Web は初回 **`leaderboard-board` `pageSize=10`（スロットあたり）**、continue は **`pageSize=40` 固定**（[`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) が `board.pageSize` に依存しない）。API は [`leaderboard-composite-board-decoration.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-decoration.service.ts) で continue 装飾を **増分行中心 + prefix hydrate/enrich + merged light フッタ**に分離。**新規マイグレーションなし**。
- **対象ホスト（実績）**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク 4 台は未デプロイ**（2026-05-19 決定: Pi5 実機で **pageSize 80 本番より表示が遅い**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-board-initial-10-continue-40 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**Pi4 へ展開する場合のみ** 従来どおり **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **1 台ずつ** — **現時点では実施しない**）。
- **本番デプロイ（Pi5 のみ）**: **Detach Run ID** **`20260519-125903-25635`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·サマリ **`Git: changed`**·Docker 再起動 **`ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **35s**）。
- **実機（現場・Pi5）**: 順位ボード **表示速度が pageSize 80 展開時より遅い**（ユーザー確認）。**Pi4 展開は中止**。
- **ローカル回帰**: Web Vitest `leaderOrderBoard/__tests__`（113）·API `leaderboard-composite-board-decoration.service.test.ts`（3）·統合 `leaderboard-board continue profile logs`（初回10・continue40・完了後 id/total 一致）。
- **ロールバック**: Pi5 を **`main`（pageSize 80 系）**へ再デプロイ、または定数 **10/40** を戻して再ビルド。
- **トラブルシュート**: **遅い** → Network の **continue 回数と各応答時間**、API の **prefix 装飾コスト**（[KB-374 §初回10/追補40](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#第1段階-pagesize-初回10--追補40--continue-装飾分離2026-05-19--featleaderboard-board-initial-10-continue-40)）。**Pi4 が変わらない** → **未デプロイが正**（意図）。
- **ナレッジ**: [KB-374 §初回10/追補40](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#第1段階-pagesize-初回10--追補40--continue-装飾分離2026-05-19--featleaderboard-board-initial-10-continue-40)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表コミット **`1e214213`**。

### 補足（2026-05-19 · **キオスク順位ボード・装飾後取り（`includeDecorations=false`）+ append スコープ修正**·**API+Web**·**Pi5→Pi4×4・完了**） {#kiosk-leaderboard-deferred-decorations-fast-initial-2026-05-19}

- **変更概要（正本 [KB-374 §装飾後取り](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#装飾後取り--初回80continue40--append-スコープ2026-05-19--featkiosk-leaderboard-deferred-decorations-fast-initial)）**:
  - **API+Web**: 初回 GET **`pageSize=80`**・**`includeDecorations=false`**。装飾は **`POST …/leaderboard-decorations`** を **未装飾 rowId のみ**増分取得。continue は **`pageSize=40` 固定**・装飾なし。API は continue **prefix light 行キャッシュ**（[`leaderboard-composite-board-prefix-row-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts)）。
  - **Web（製番・placeholder）**: **`b0343567`** — params 変更時のみ旧 placeholder shell を非表示（[`leaderboardBoardShellFreshnessPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardShellFreshnessPolicy.ts)）。
  - **Web（append スコープ）**: **`08613580`** — [`leaderboardBoardAppendOverrideScopePolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendOverrideScopePolicy.ts)。**`426889d6`** が append effect deps に override を入れ **continue を自己中断**していた回帰を修正（ref 正本・effect deps から override 除外）。
- **対象ホスト（実績・1 台ずつ順次）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3** は **`no hosts matched`**（専用手順未実施で正）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-deferred-decorations-fast-initial infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP |
| --- | --- | --- |
| `raspberrypi5`（最終 tip **`08613580` 含む） | **`20260519-172543-21009`** | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | **`20260519-174536-24483`** | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | **`20260519-175108-2934`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | **`20260519-175540-20432`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | **`20260519-180012-22517`** | `ok=129` `changed=10` `failed=0` |

- **中間デプロイ（記録）**: Pi5 のみ **`426889d6`** 反映時 **Detach `20260519-160314-32708`** — 本番で **製番 OFF 不具合・continue 未完**が顕在化し、**`08613580`** で修正後に Pi5 再デプロイ + Pi4 展開。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 後 約 **77s**、Pi4 全台後 約 **104s**）。**`deploy-status`（Pi4×4）**・**`status-agent`（Pi4×4）** すべて **PASS**。
- **実機（現場）**: 順位ボード **動作 OK**（リロード・製番 ON/OFF・全件表示・追補完走）（ユーザー確認）。
- **ローカル回帰**: Web Vitest `leaderOrderBoard/__tests__`（append スコープ・placeholder・hasMore+製番 OFF）·API 統合 `leaderboard-board continue profile logs`。
- **トラブルシュート**:
  - **製番 OFF で行数が戻らない** → Network で **`q` なし GET** の行数。**API 正常なら Web**。**`426889d6` のみ**なら **`08613580` へ**。
  - **continue が途中で止まる** → append effect が **`setAppendOverride` で再実行**されていないか（deps に override を入れない）。
  - **Pi5 だけ更新してキオスクが旧挙動** → **Pi4 Web** 未反映。**4 台順次**が必要。
  - **装飾だけ遅い** → **意図**（行骨格先出し）。id/total は continue 完了後。
- **ナレッジ**: [KB-374 §装飾後取り](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#装飾後取り--初回80continue40--append-スコープ2026-05-19--featkiosk-leaderboard-deferred-decorations-fast-initial)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 tip **`08613580`**（ブランチ **`feat/kiosk-leaderboard-deferred-decorations-fast-initial`**）。

### 補足（2026-05-19 · **キオスク順位ボード・continue 時 COUNT 再利用（第1弾）**·**API のみ**·**Pi5 のみ・現場 OK**） {#kiosk-leaderboard-continue-count-reuse-2026-05-19}

- **変更概要（正本 [KB-374 §continue COUNT 再利用](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-時-count-再利用第1弾--api-のみ--出力不変)）**:
  - **API**: shell GET で確定した **スロット別 `total`** を **`snapshotId` キーのプロセス内 TTL キャッシュ**に保存。`POST …/leaderboard-board/continue` は **キャッシュヒット時 COUNT 省略**（ミス時は従来 COUNT·**出力同値**）。
  - **モジュール**: [`leaderboard-composite-board-snapshot-totals.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-snapshot-totals.ts)·[`resolve-leaderboard-board-resource-totals-for-continue.ts`](../../apps/api/src/services/production-schedule/leaderboard/resolve-leaderboard-board-resource-totals-for-continue.ts)。
  - **触らない**: Web·`pageSize` 80·装飾後取り·`deltaRows`。**新規マイグレーションなし**。
  - **付帯（同一ブランチ）**: [`Dockerfile.web`](../../infrastructure/docker/Dockerfile.web) **Caddy v2.11.3**（**CVE-2026-45135**·Pi5 `web` 再ビルド）。
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク／Pi3**: **`skipping: no hosts matched`**（Pi4 は **Pi5 API 参照**のため Web 再デプロイ不要）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh perf/leaderboard-board-continue-reuse-totals infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（実績）**: **Detach Run ID** **`20260519-192007-12328`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 1030s**·**`Git: changed`**·**Docker 再起動 `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **81s**）。
- **実機（現場）**: 順位ボード **動作 OK**（全スロット完走・表示同値）（ユーザー確認）。
- **代表コミット**: **`438adb0c`**（COUNT 再利用）· **`ec938f31`**（Caddy）·**PR [#300](https://github.com/denkoushi/RaspberryPiSystem_002/pull/300)**。
- **ローカル回帰**: 単体 6·統合 `leaderboard-board` 4（`continue skips COUNT` 含む）— [KB-374 §ローカル検証](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#ローカル検証mac--docker-postgres)。
- **トラブルシュート**:
  - **体感が変わらない（Pi4）** → **Pi5 `api` のみ**が対象。**Pi4 順次は不要**（API は Pi5）。
  - **total がずれる** → **`snapshotExpired`** 後は shell 再取得が正。**キャッシュミス**時は COUNT フォールバック（同値）。
  - **CI `security-docker` 失敗** → Caddy **2.11.3** 未取り込みを疑う（**`ec938f31`**）。
- **ナレッジ**: [KB-374 §continue COUNT 再利用](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#continue-時-count-再利用第1弾--api-のみ--出力不変)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-19 · **キオスク順位ボード・端末キャッシュ Phase 1（IndexedDB + 裏同期）**·**Web のみ**·**Pi5 のみ・Mac/Pi5 表示 OK**·**Pi4 未展開**） {#kiosk-leaderboard-terminal-cache-phase1-2026-05-19}

- **変更概要（正本 [KB-374 §端末キャッシュ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-1-indexeddb--裏同期2026-05-19--featkiosk-leaderboard-terminal-cache-phase1)）**:
  - **Web のみ**: continue **完走済み** board + 装飾累積を **IndexedDB**（`idb` ^8.0.3）に **`siteKey` + `paramsKey`** 単位で保存。起動時 **bootstrap 表示** + 裏で既存 React Query / continue / decorations。
  - **照合**: ネットワーク完走版と不一致 → **サーバ正・キャッシュ delete**（同一 `shellFingerprint` サイクルでは **即 put しない**）。
  - **通信失敗**: キャッシュ継続 + 警告バナー（[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)）。
  - **Post-deploy fix（`3ae93221`）**: 初回デプロイ（`072054f9`）後 **真っ白画面** — `JSON.stringify(undefined)` による **`paramsKey` 未定義**で `buildLeaderboardBoardCacheKey` が `.trim()` 例外。**`paramsKey` 常時 string 化**で解消。
  - **触らない**: API·pageSize 80·装飾後取り·COUNT 再利用。**新規マイグレーションなし**。
- **対象ホスト（実績）**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。**Pi4 キオスク 4 台は未デプロイ**（端末キャッシュは **ブラウザ IDB** — Pi4 実機効果には **Pi4 順次が必要**）。**Pi3**: **`no hosts matched`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-terminal-cache-phase1 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。**Pi4 展開時**は装飾後取りと同順: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **1 台ずつ**。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| 段階 | Detach Run ID | コミット | PLAY RECAP |
| --- | --- | --- | --- |
| 初回 | **`20260519-203723-29020`** | **`072054f9`** | `ok=134` `changed=4` `failed=0` |
| fix 再デプロイ | **`20260519-205437-31528`** | **`3ae93221`** | `ok=134` `changed=4` `failed=0` |

- **CI（機能）**: run **`26093399804`** **success**（`072054f9`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **実機（Mac→Pi5）**: 初回 **真っ白** → fix 後 **表示 OK**（ユーザー確認）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard` → **166 tests PASS**（記録時点）。
- **ロールバック**: ビルド時 **`VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`**、または直前 ref へ **`update-all-clients.sh`** 再実行。
- **トラブルシュート**:
  - **真っ白画面** → DevTools **`Cannot read properties of undefined (reading 'trim')`** → **`3ae93221` 以降** + **Cmd+Shift+R**。
  - **体感改善なし（1 回目）** → **初回は IDB 空**が正常。**continue 完走後の 2 回目以降**で評価。
  - **Pi4 で効かない** → **Pi4 未デプロイ**が原因になりうる（Pi5 のみ反映済み）。
  - **120s より古いキャッシュ** → 表示ポリシーで **非表示**（意図）。
- **ナレッジ**: [ADR-20260519](../decisions/ADR-20260519-leaderboard-terminal-cache-phase1.md)·[KB-374 §端末キャッシュ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-1-indexeddb--裏同期2026-05-19--featkiosk-leaderboard-terminal-cache-phase1)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`072054f9`** / fix **`3ae93221`**。

### 補足（2026-05-19 · **キオスク順位ボード・端末キャッシュ Phase 2（SWR + 書き込み同期）**·**Web のみ**·**Pi5→Pi4×4 本番反映**） {#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19}

- **変更概要（正本 [KB-374 §Phase 2](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)）**:
  - **Web のみ**: Phase 1 の IndexedDB bootstrap に加え、**120s 鮮度内の continue 完走済みスナップショット**を **`paramsKey` 一致時に SWR 表示**（再検証中も維持）。
  - **書き込み同期**: 順位・備考・納期・完了の API 成功後、**同一 `paramsKey` の IDB を patch**（[`productionScheduleWriteSuccessListeners.ts`](../../apps/web/src/features/kiosk/productionSchedule/productionScheduleWriteSuccessListeners.ts)）。
  - **IDB put 判定**: 行 ID だけでなく **内容指紋**（順位・備考・納期・完了含む）（[`leaderboardBoardCachePersistPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts)）。
  - **UX**: 完了フィルタ既定 **`incomplete`**（クライアントのみ·API 不変）。
  - **触らない**: API 契約·一覧 id/total/並び·装飾意味論。**新規マイグレーションなし**。
- **対象ホスト（実績）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`--limit` で 1 台ずつ**）。**Pi3**: **`no hosts matched`**（専用手順不要）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-terminal-cache-phase2-swr infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP |
| --- | --- | --- |
| `raspberrypi5` | **`20260519-215631-11713`** | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | **`20260519-220153-2826`** | `ok=122` `changed=10` `failed=0` |
| `raspi4-robodrill01` | **`20260519-220731-12252`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | **`20260519-221143-3419`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | **`20260519-221558-18199`** | `ok=129` `changed=10` `failed=0` |

- **CI（機能）**: PR [#302](https://github.com/denkoushi/RaspberryPiSystem_002/pull/302) **success**（初回 `useProductionScheduleMutations.test.ts` 2 件失敗 → tip **`2300da83`** で `onSuccess` 期待を追加）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **70s**）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard` → **174 tests PASS**。
- **ロールバック**: `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false`（Phase 1 のみ）/ `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`（全体オフ）/ 直前 ref へ **`update-all-clients.sh`** 再実行。
- **トラブルシュート**:
  - **1 回目だけ遅い** → **IDB 空**が正常。**continue 完走後の 2 回目以降**で SWR を評価。
  - **Pi4 で Phase 1 だけ欲しい** → 本リリースは **Phase 1+2 同梱**（Pi4 は Phase 1 未展開だったため初反映が一括）。
  - **真っ白画面** → [§端末キャッシュ Phase 1](#kiosk-leaderboard-terminal-cache-phase1-2026-05-19) の **`3ae93221`** を参照。
  - **他端末の変更が 120s 超遅い** → SLA 仕様（自端末書き込みは即 patch）。
- **ナレッジ**: [ADR-20260520](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md)·[KB-374 §Phase 2](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`c581c1e1`** / fix **`2300da83`**。

### 補足（2026-05-20 · **キオスク順位ボード・製番 OR クライアントキャッシュフィルタ**·**Web のみ**·**Pi5 + Pi4 1 台本番反映**） {#kiosk-leaderboard-seiban-or-client-cache-filter-2026-05-20}

- **変更概要（正本 [KB-374 §製番 OR クライアントキャッシュフィルタ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#製番-or-クライアントキャッシュフィルタ2026-05-20)）**:
  - **Web のみ**: 登録製番 OR 切替で **`paramsKey`（無 `q` 完走 board）を固定**し、**IDB 全件をクライアント絞込**（即表示）。裏で **同製番の `q` 付き GET + continue** で照合し、**不一致はサーバ正**。
  - **製番 OFF**: 完走 IDB があれば **即全件**（primary continue を増やさない）。
  - **前提**: [端末キャッシュ Phase 2](#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19)（SWR + IDB）が各端末に入っていること。
  - **触らない**: API 契約·一覧 id/total/並び·ツールバー等の他 `q`（従来 API）。**新規マイグレーションなし**。
- **対象ホスト（実績・部分）**: **`raspberrypi5`** → **`raspi4-kensaku-stonebase01`**（各 **`--limit` で 1 台ずつ**）。**未反映**: `raspberrypi4` / `raspi4-robodrill01` / `raspi4-fjv60-80`。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-seiban-or-client-cache-filter infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP |
| --- | --- | --- |
| `raspberrypi5` | **`20260520-080628-31043`** | `ok=134` `changed=4` `failed=0` |
| `raspi4-kensaku-stonebase01` | **`20260520-081732-25804`** | `ok=129` `changed=11` `failed=0` |

- **CI（機能）**: run **`26130113027`** **success**（初回 **`26129746916`** は `tsc -b` 失敗 → fix **`84751160`**）。
- **実機（自動）**: Pi5 デプロイ後 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard` → **186 tests PASS**。
- **ロールバック**: `VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER=false` / 直前 ref へ **`update-all-clients.sh`** 再実行。
- **推奨残デプロイ**: **`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**（Phase 2 と同じ 5 台順·1 台ずつ）。
- **トラブルシュート**:
  - **製番 ON でも全件** / continue **1 回で止まる** → [KB-374 §Troubleshooting](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#troubleshooting)（`seibanOrFiltersKey`・overlay 順序）。
  - **Pi4 で効かない** → **当該ホスト未デプロイ**（上表の未反映 3 台）。
  - **reconcile 後に古い絞込** → **`serverVerifiedBoard` クリア**未反映の旧 bundle → **`84751160` 以降**を再デプロイ。
- **ナレッジ**: [KB-374 §製番 OR](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#製番-or-クライアントキャッシュフィルタ2026-05-20)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`a65c4600`** / fix **`84751160`**。

### 補足（2026-05-20 · **キオスク順位ボード・操作即表示 × 120秒キャッシュ両立**·**Web のみ**·**Pi5→Pi4×4 本番・実機 OK**） {#kiosk-leaderboard-mutation-instant-display-2026-05-20}

- **変更概要（正本 [KB-374 §操作即表示](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#操作即表示--120秒キャッシュ両立2026-05-20--featkiosk-leaderboard-mutation-instant-display)）**:
  - **Web のみ**: [Phase 2 改訂](#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20) の **120秒 SWR / 完走時 IDB put** を維持しつつ、**自端末**の順位・納期・備考・完了を **API 成功直後**に画面へ反映。**DB は即時**（既存 API）·**他端末は最大 120 秒**·**API 不変**·**新規マイグレーションなし**。
  - **patch 正本**: [`leaderboardBoardApplyMutation.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardApplyMutation.ts)。
  - **表示正本**: [`leaderboardBoardDisplayMutationCoordinator.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardDisplayMutationCoordinator.ts) — **shell + `appendOverride`** へ同型 patch（continue 追補済み一覧の巻き戻し防止）。
  - **mutation → IDB 即時ミラー**: **既定オン**（`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION` **省略時 true**）。
  - **操作ロック**: **mutation / `writePause` のみ**（120秒 poll の `isFetching` 中はロックしない）。
  - **前提**: [端末キャッシュ Phase 2](#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19) / [120s 改訂](#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20) / [フッタチップ](#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20) が各端末に入っていること。
- **対象ホスト（実績・完了）**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**（各 **`--limit` で 1 台ずつ**）。**Pi3**: **`no hosts matched`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-mutation-instant-display infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | **`20260520-131334-15607`** | `ok=134` `changed=4` `failed=0` | **Docker compose 再起動** |
| `raspi4-kensaku-stonebase01` | **`20260520-131843-7879`** | `ok=129` `changed=10` `failed=0` | `barcode-agent` ready **1 リトライ** |
| `raspberrypi4` | **`20260520-133253-2715`** | `ok=122` `changed=11` `failed=0` | `kiosk-browser` **ok** |
| `raspi4-robodrill01` | **`20260520-133748-7589`** | `ok=122` `changed=10` `failed=0` | 同上 |
| `raspi4-fjv60-80` | **`20260520-134139-3491`** | `ok=122` `changed=9` `failed=0` | 同上 |

- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard` → **199 tests PASS**·`web build` PASS。
- **実機（順位ボード·現場）**: **実機検証 OK**（ユーザー確認·2026-05-20）。
- **ロールバック**: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false` / 直前 ref へ **`update-all-clients.sh`** 再実行（5 台）。
- **トラブルシュート**:
  - **自端末で行が変わらない** → [KB-374 §操作即表示](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#操作即表示--120秒キャッシュ両立2026-05-20--featkiosk-leaderboard-mutation-instant-display) の **Troubleshooting** 表（**`appendOverride` 未 patch**·Detach ID）。
  - **Pi4 だけ直らない** → 上表 Detach·**Pi5 のみデプロイ**ではキオスクに効かない。
  - **他端末に即反映されない** → **SLA 120秒**（仕様）。
- **ナレッジ**: [ADR-20260520 §操作即表示](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md#操作即表示との両立2026-05-20--featkiosk-leaderboard-mutation-instant-display)·[KB-374 §操作即表示](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#操作即表示--120秒キャッシュ両立2026-05-20--featkiosk-leaderboard-mutation-instant-display)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`0d97f0de`**。

### 補足（2026-05-20 · **キオスク順位ボード・端末キャッシュ 120s 同期改訂（SWR 操作ロック）**·**Web のみ**·**Pi5 + StoneBase01 部分本番・実機 OK**） {#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20}

- **変更概要（正本 [KB-374 §Phase 2 改訂](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock)）**:
  - **Web のみ**: [端末キャッシュ Phase 2](#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19) の **IDB 書込タイミング**と **再検証中 UX** を改訂。**出力同値**·**API 不変**·**新規マイグレーションなし**。
  - **120秒ポーリング完走時のみ** IDB `put`（[`leaderboardBoardCacheSyncPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheSyncPolicy.ts)）。
  - **mutation 成功時の IDB 即時ミラーは既定オフ**（`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`）。
  - **`serverWins`**: purge せず **サーバ正本で replace put**（`skippedNetworkSyncTokenRef` 削除）。
  - **SWR**: `isBackgroundRevalidating` 中は **キャッシュ表示固定**·完了時のみネットワークへ切替（[`leaderboardBoardSwrDisplayPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSwrDisplayPolicy.ts)）。
  - **操作ロック**: 背景再検証中は **明示 disabled** + 短文ステータス（[`leaderboardBoardInteractionLockPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardInteractionLockPolicy.ts)）。
  - **前提**: [製番 OR クライアントキャッシュフィルタ](#kiosk-leaderboard-seiban-or-client-cache-filter-2026-05-20) または Phase 2 bundle が各端末に入っていること（StoneBase01 は **製番 OR + 本改訂** を順次反映済み）。
- **対象ホスト（実績）**: **`raspberrypi5`** → **`raspi4-kensaku-stonebase01`**（120s 改訂単体·各 **`--limit` で 1 台ずつ**）。**Pi4×3** は [§フッタチップ端末キャッシュ](#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20) の **`fix/kiosk-leaderboard-footer-chips-terminal-cache`**（`main` + **`e24d5885`**）で **120s 改訂を含む bundle を反映済み**（2026-05-20）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-cache-120s-swr-lock infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | **`20260520-095018-31166`** | `ok=131` `changed=3` `failed=0` | 同日 **9:37** 開始の同一ブランチ run が **ローカルロック**中に先行·完了待ち後に本 run で正本ログ |
| `raspi4-kensaku-stonebase01` | **`20260520-094455-29939`** | `ok=129` `changed=10` `failed=0` | **`kiosk-browser` / `status-agent` 再起動** |

- **CI（機能）**: run **`26133411712`** **success**（`fix(kiosk): stabilize leaderboard cache refresh cadence` · **`76e265f2`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **69s**）。
- **実機（順位ボード・現場）**: **実機検証 OK**（ユーザー確認·2026-05-20）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard` → **193 tests PASS**。
- **ロールバック**: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=true`（mutation 即時 IDB 復帰）/ `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false` / `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false` / 直前 ref へ **`update-all-clients.sh`** 再実行。
- **トラブルシュート**:
  - **キャッシュが効かない** → [KB-374 §Phase 2 改訂 Troubleshooting](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#troubleshooting)（purge + put 抑止·**`76e265f2` 以降**）。
  - **同期中に操作できる** → **`isInteractionLocked`** 未反映の旧 bundle → 本節 Detach ID を確認。
  - **`update-all-clients.sh` exit 3** → **ローカルロック**（`logs/.update-all-clients.local.lock/owner`）·先行プロセス完了待ち。
  - **Pi4 3 台で挙動が違う** → [§フッタチップ](#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20) の Detach を確認（**`e24d5885` 未反映**の可能性）。
- **ナレッジ**: [ADR-20260520 §Phase 2 改訂](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md#phase-2-改訂120s-同期-cadence-安定化2026-05-20)·[KB-374 §Phase 2 改訂](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`76e265f2`**。

### 補足（2026-05-20 · **キオスク順位ボード・資源CDフッタチップ端末キャッシュ**·**Web のみ**·**Pi5→Pi4×4 本番・実機 OK**） {#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20}

- **変更概要（正本 [KB-374 §資源CDフッタチップ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache)）**:
  - **Web のみ**: 端末キャッシュ IDB の put 判定を **board 指紋 + decorations 指紋**（[`fingerprintLeaderboardBoardDecorations`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts)）に拡張。**行内容が同じでも資源CDチップだけ増えたとき**に put する。
  - **装飾 hook**: `decorationParamsKey` を **`paramsKey` 固定**（製番 OR 切替で装飾 state をリセットしない）。
  - **触らない**: API 契約·一覧 id/total/並び·製番 OR の行絞込意味論。**新規マイグレーションなし**。
  - **前提**: [端末キャッシュ Phase 2](#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19) / [120s 改訂](#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20) / [製番 OR クライアントフィルタ](#kiosk-leaderboard-seiban-or-client-cache-filter-2026-05-20) が各端末に入っていること（本ブランチは **`main`（PR #304）+ `e24d5885`**）。
- **対象ホスト（実績・完了）**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**（各 **`--limit` で 1 台ずつ**）。**Pi3**: **`no hosts matched`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-leaderboard-footer-chips-terminal-cache infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）**:

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | **`20260520-103202-24115`** | `failed=0` | 先行·Pi5 後 `verify-phase12-real.sh` **43/0/0** |
| `raspi4-kensaku-stonebase01` | **`20260520-103644-1806`** | `failed=0` | **実機検証 OK**（ユーザー） |
| `raspberrypi4` | **`20260520-110912-15304`** | `ok=122` `changed=10` `failed=0` | `kiosk-browser` / `status-agent` **ok** |
| `raspi4-robodrill01` | **`20260520-111402-16821`** | `ok=122` `changed=9` `failed=0` | 同上 |
| `raspi4-fjv60-80` | **`20260520-111744-20691`** | `ok=122` `changed=9` `failed=0` | 同上 |

- **実機（自動・Pi4 全台後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **29s**）。
- **ローカル回帰**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard` → **196 tests PASS**·`web build` PASS。
- **ロールバック**: 直前 ref へ **`update-all-clients.sh`** 再実行 / 端末キャッシュ全体オフは `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`。
- **トラブルシュート**:
  - **チップだけ空** → IDB の `leaderboardFooterChipsByPartKey`·**`e24d5885` 以降**·強制リロード。
  - **製番切替でチップだけ消える** → 旧 bundle の **`decorationParamsKey` 製番連結** → 本 Fix を再デプロイ。
  - **Pi4 だけ直らない** → 上表 Detach·`deploy-status`。
- **ナレッジ**: [KB-374 §フッタチップ](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·代表 **`e24d5885`**。

### 補足（2026-05-08 · **CSVダッシュボード DEDUP 取込・PostgreSQL バインド上限（32767）対策**·**API のみ**·**Pi5 のみ**） {#csv-dedup-ingest-postgres-bind-limit-2026-05-08}

- **変更概要**: `ingestMode === DEDUP` の取込で、既存行照合 **`csvDashboardRow.findMany({ dataHash: { in: incomingHashes } })`** が **単一クエリ**だったため、**`incomingHashes` が数万件**になると **Prisma / PostgreSQL の prepared statement バインド上限（典型 32767）**を超え、**`too many bind variables … received 32768`** で失敗し得た。**対策**: [`findCsvDashboardRowsByDataHashes`](../../apps/api/src/services/csv-dashboard/csv-dashboard-existing-rows-by-hash.reader.ts) で **ハッシュ重複除去＋チャンク分割 `findMany`**・[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) から呼び出し。**新規マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/csv-import-bind-limit-dedup infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（先行反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-202603-25493`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 783s**）。**`Run prisma migrate deploy` / `prisma migrate status`**: **成功**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 134s**・Tailscale・Pi5 API `100.106.158.2`）。
- **トラブルシュート**:
  - **同じエラーが出る** → Pi5 **API コンテナ**が **`f4360e0d` 以降（またはマージ後 `main` HEAD）**か、Detach ログ **`Git: changed`** を確認。
  - **`update-all-clients.sh` がローカル未コミットで停止** — **stash / commit** で作業ツリーをクリーンにする。
- **ナレッジ**: [KB-371](../knowledge-base/KB-371-csv-dashboard-dedup-postgres-bind-limit.md)·代表コミット **`f4360e0d`**·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-08 · **FKOJUNST_Status メール同期を一覧・外部完了の唯一正本とする**·**API のみ**·**Pi5 のみ**） {#fkojunst-status-sole-source-2026-05-08}

- **変更概要**: `ProductionScheduleFkojunstMailStatus`（`fkmail`）のみでキオスク生産日程の **工順ST列・一覧可視性**と **メール由来外部完了**を判定。**歴史（2026-05-08 リリース当時）**: **`S`/`R` の winner のみ一覧**と記録した。**2026-05-09 改訂**: 一覧は **`S`/`R`/`C`/`X`**（**[§2026-05-09](#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09)**）。**`C`/`X`** は **メール由来完了かつ一覧に表示**（順位ボードでグレーアウト確認可）。**`O`/`P`** は一覧非表示・未完了（製番進捗 total には残る）。旧 **`fkst`（Gmail `FKOJUNST`）フォールバック**・**dedupe キー消失によるメール完了**を撤去（アプリは `fkojunst-status-mail-dedupe-key-snapshot.repository` を削除。DB スナップショットテーブルは残り得るが **2026-05-08 以降アプリ未参照**）。**正本**: [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md)·代表コミット **`d12b40de`**（先行ブランチ **`feat/fkojunst-status-cx-completion`**）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/fkojunst-status-cx-completion infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（先行反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-192843-15997`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 741s（約 12.3 分）**）。**`Run prisma migrate deploy` / `prisma migrate status`**: **成功**（当該リリースに **新規マイグレーションなし**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 188s**・Tailscale・Pi5 API `100.106.158.2`）。
- **トラブルシュート**:
  - **一覧から行が消えたが旧 Gmail `FKOJUNST`（`fkst`）には `S`/`R` 相当がある** → **仕様**。一覧の **`fkmail` 正本**は **2026-05-09 以降 `S`/`R`/`C`/`X`**（**`C`/`X`** は表示されるが **完了**・[本ガイド 2026-05-09 項](#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09)）。`fkst` のみでは **表示されない**。`FKOJUNST_Status` の **`unmatched`・キー照合**は [KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28) を参照。
  - **外部完了が期待と違う** → メール由来は **`C`/`X` のみ**。生産日程CSV「消滅」由来は **2026-05-09 以降** **メール完了（`C`/`X`）以外**かつ **`occurredAt` が UTC ±3ヶ月窓内**の母集団と現 winner の差分（**[§2026-05-09 消滅窓](#schedule-csv-disappearance-nonc-window-2026-05-09)**・[KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)）。
  - **`update-all-clients.sh` がローカル未コミット／未追跡で即終了** → 本リポジトリどおり **stash / commit** で作業ツリーをクリーンにする。

### 補足（2026-05-08 · **FKOJUNST メール同期・winner 解決最終 fix（bind 上限 → 1-pass 化 + 外部完了 timeout 延長）**·**API のみ**·**Pi5 のみ**） {#fkojunst-mail-winner-triple-tuple-in-chunk-2026-05-08}

- **変更概要**: 初動では **巨大 3 キー `IN`** による **PostgreSQL 32767 bind 上限**と **`stack depth`** を疑い、Pi5 実データ（**dedupedRows 91,998 件**）で切り分けたところ、**1000 件チャンクでも約 92 回の winner 再走査**が必要で request timeout 相当の長時間化が残った。**最終対策**: [`fkojunst-mail-winner-by-triple.reader.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts) を **winner 全件 1 回読込 + requested key の `Map` フィルタ**へ変更し、続く [`fkojunst-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts) の transaction には **`timeout: 60000` / `maxWait: 15000`** を明示。論理キーは [`fkojunst-mail-status-key.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-status-key.ts)。**新規マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/fkojunst-mail-winner-stack-depth infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（最終反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-230134-12773`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。**`Run prisma migrate deploy` / `prisma migrate status`**: **成功**。
- **Pi5 本処理確認**: API コンテナ内で `ProductionScheduleFkojunstMailStatusSyncService.syncFromStatusMailDashboard()` を直接実行し、**mail sync completed** → **external completion recalculated** → **result 出力**まで **約 37.3s** を確認。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 141s**・Tailscale・Pi5 API `100.106.158.2`）。
- **main 再検証（2026-05-09）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**。WARN は **`auto-tuning schedulerログ確認（件数=0）`** で、同一実行中の **`PUT global-rank/auto-generate` が 200** のためガイドどおり代替判定で正常扱い。
- **トラブルシュート**:
  - **メール同期で同種 timeout / 長時間化** → Pi5 **API** が **`b6bb449a` 以降（またはマージ後 `main` HEAD）**か、Detach の **`Git: changed`**・**Docker 再ビルド**有無を確認。
  - **`verify-phase12-real.sh` の WARN（auto-tuning scheduler ログ 0 件）** → ログローテーションの可能性があるため、**同一実行で `PUT global-rank/auto-generate` が 200** を代替正常判定にする（スクリプト出力仕様どおり）。
  - **`update-all-clients.sh` がローカル未コミットで停止** — **stash / commit**。
  - **開発**：一時 Postgres での統合検証は **`pnpm prisma migrate deploy` 後**に実行。**テストデータの資源CD正規化**が本番とずれると winner アサートが崩れる。
- **ナレッジ**: [KB-372](../knowledge-base/KB-372-fkojunst-mail-winner-triple-postgres-bind-chunk.md)·代表コミット **`b6bb449a`**（途中 fix: **`ef9e3125`**, **`b144fb40`**）·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-08 · **キオスク順位ボード・board 集約 API（`leaderboard-board` / `leaderboard-board/continue`）**·**API+Web**·**Pi5+Pi4 は反映済・残り Pi4×3**）

- **変更概要**: 端末側で **資源カードごと**に `leaderboard-shell` / `leaderboard-total` / `leaderboard-decorations` / `leaderboard-shell/continue` を **同時多発（fan-out）**していたパターンをやめ、**1 本の board 系**で **サーバがスロット順に shell・追補・件数・装飾を束ねて返す**（応答に **`resources[]`**）。**表示する行・並び・件数・装飾の意味は変えない**（行削減による疑似高速化はしない）。既存 phased ルートは **互換のため維持**。**意思決定の正本**: [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)。
- **対象ホスト（標準）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**。先行ブランチだけ反映した場合は当該ブランチ名を引数に）。**2026-05-08 時点でデプロイ実績があるのは先頭 2 台のみ**。残り 3 台は **同一手順で未完了として台帳に残す**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·**マージ後は `main`**（先行検証時のみ **`fix/leaderboard-shell-bounded-filler-fetch`**）。
- **本番デプロイ（先行反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-175314-10578`**（`raspberrypi5`・**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）/ **`20260508-181440-11189`**（`raspberrypi4`・**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。
- **実機（自動・途中実行の例）**: `./scripts/deploy/verify-phase12-real.sh` は **PASS 42 / WARN 0 / FAIL 1**（約 **77s**）の記録がある。FAIL は **`deploy-status raspberrypi4` が一時 `isMaintenance: true`** であり、**連続デプロイ／メンテナンス境界**では既知。対処は **全台反映完了後の再実行**、または Pi5 の **`config/deploy-status.json`**・各ホスト健全性の確認（[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)）。
- **補助計測（API）**: `GET /api/kiosk/production-schedule/leaderboard-board?q=A&boardResourceCds=1,2&pageSize=160&responseProfile=leaderboard`（`x-client-key: client-key-raspberrypi4-kiosk1`）で **HTTP 200 / time_total 5.43s・6.01s**（2 回）という記録がある。**当該時点の payload は rows 0 件**であり、**本番データでの体感改善を証明する計測ではない**（遅延の主因がプランナか空振りかを切り分けられない）。
- **トラブルシュート**:
  - **`update-all-clients.sh` がローカル差分で停止** → `git stash push -u` 等でクリーン化してから実行し、完了後に必要なら復元。
  - **`verify-phase12-real.sh` で `deploy-status raspberrypi4` のみ FAIL** → `isMaintenance:true` は連続デプロイ時に残ることがある。全対象ホスト完了後に再確認、または Pi5 の `config/deploy-status.json` を確認。
  - **性能評価の誤判定** → 空データ計測（rows 0）だけでは体感改善を断定できないため、**運用相当データ**で再計測する（board **1 往復**と旧 **N 往復**の対比）。
  - **遅いまま** → Pi5 **`api` とキオスク `web` の両方**が対象コミット以降か、`git log -1`・detach ログの **`Git: changed`** を確認。ブラウザは [verification-checklist.md](verification-checklist.md) §6.6.4 の **強制リロード**。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-07 · **キオスク順位ボード・資源CDカード単位 phased（`resourceCds` 1 件時は同一製番展開オフ・複合 Web hook）**·**API+Web**·**Pi5→Pi4×4・順次**）

- **変更概要**: **全資源カード**を一度に選ぶ UI でも、**段階取得（shell/continue/total）**は **`resourceCds` を 1 件だけ載せたリクエスト**を **カードごとに独立**させる。API は **問い合わせの `resourceCds.length === 1` のとき**、[同一製番展開（`expansionWhere`）](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts) を **スキップ**し、**当該資源内**の手動優先＋納期順の選定に閉じる（**0 件・複数資源**のリクエストでは従来どおり展開あり）。Web は [`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) が資源 CD ごとに [`useLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts) を束ね、**装飾は表示行 ID を集約して 1 回**。**新規マイグレーションなし**。**Pi3 は対象外**（リソース僅少・専用手順の対象外。本変更はキオスク Pi5+Pi4 系）。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh feature/kiosk-leaderboard-card-scope infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**）。**`main` マージ後の再デプロイは引数 `main`**（実装 tip **`30a664f1`** を正本にできる）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·先行反映時は **`feature/kiosk-leaderboard-card-scope`**。
- **本番デプロイ（先行反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-212820-17030`**（`raspberrypi5`·**`PLAY RECAP` `failed=0` / `unreachable=0`**）/ **`20260507-213838-14511`**（`raspberrypi4`）/ **`20260507-214421-9979`**（`raspi4-robodrill01`）/ **`20260507-214913-28430`**（`raspi4-fjv60-80`）/ **`20260507-215416-19850`**（`raspi4-kensaku-stonebase01`）。いずれもリモート **`exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 121s**・Tailscale）。
- **トラブルシュート**:
  - **カードごとに納期・順位が期待と違う** → Network で **各 shell の `resourceCds` が 1 要素**か・Pi5 **`api` / Pi4 `web` の ref** が **`30a664f1` 以降（またはマージ後 `main`）**か。旧 API は **複数資源を一括**すると **製番展開あり**のまま。
  - **追補・装飾まわり** → 下記 snapshot+cursor / snapshot 項の **`appendError`・`snapshotExpired`・decorations invalidate** と [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md) を参照（本変更は **それらと直列で利用**）。
  - **Pi4 `status-agent` 再起動失敗** → 本ファイルの **「段階取得 append（`leaderboard-shell/continue`）」項**と同様に **rollback 後に同一 `--limit` で再実行**。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[KB-297 · カード単位節](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-resource-card-phased-scope-2026-05-07)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-07 · **キオスク順位ボード・continue の snapshot+cursor（`nextCursor` / `hasMore`）**·**API+Web**·**Pi5→Pi4×4・順次**）

- **変更概要**: `POST …/leaderboard-shell/continue` を **`snapshotId` + `cursor`** 主軸にし、**`excludeRowIds`（最大 900）** は移行期間の後方互換のみ。初回 shell に **`nextCursor`** / **`hasMore`**。**装飾 POST** の **`rowIds` 上限 20000**。**新規マイグレーションなし**。**Pi3 は対象外**（リソース僅少・ユーザー指定リストにも無し）。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh fix/leaderboard-cursor-snapshot infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**）。**`main` マージ後の再デプロイは引数 `main`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·先行反映時は **`fix/leaderboard-cursor-snapshot`**（実装 tip **`52b68c8c`**）。
- **本番デプロイ（先行反映・実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-190947-13634`**（`raspberrypi5`·**`PLAY RECAP` `failed=0` / `unreachable=0`**）/ **`20260507-192208-14169`**（`raspberrypi4`）/ **`20260507-192734-3017`**（`raspi4-robodrill01`）/ **`20260507-193134-2805`**（`raspi4-fjv60-80`）/ **`20260507-193553-4333`**（`raspi4-kensaku-stonebase01`）。いずれもリモート **`exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 104s**・Tailscale）。
- **トラブルシュート**:
  - **追補 API 失敗** → Web の **`appendError`**（[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)）。**`snapshotExpired`** 時は **decorations も invalidate**。
  - **空チャンク＋`hasMore` で cursor が進まない** → 実装側で **無限ループ防止**（[`useLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts) 等）。
  - 重複・失効一般論は [ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)·下記 snapshot 項と共通。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[PR #270](https://github.com/denkoushi/RaspberryPiSystem_002/pull/270)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-07 · **キオスク順位ボード・サーバ内 snapshot（`snapshotId` / TTL インメモリ・世代失効）**·**API+Web**·**Pi5→Pi4×4・順次**）

- **変更概要**: shell は **`snapshotId`（任意）** を返し、continue は同一 ID 上で **軽量にchunk追補**（従来の **`excludeRowIds` 経路も維持**）。TTL・選定コンテキストの **フィンガープリント不一致・世代更新**では **`snapshotExpired: true`** と空行。**API**: [`leaderboard-shell-snapshot.store.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.ts)・[`leaderboard-shell-snapshot-generation.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot-generation.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)·ルート [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)。**Web**: [`useLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts) が **`snapshotId` 送信**・**`snapshotExpired` 時に shell/total を invalidate**。**Pi3 は対象外**（リソース僅少・専用手順に載せない）。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh fix/leaderboard-shell-snapshot infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**）。**`main` マージ後の再デプロイは引数 `main`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·先行反映時は **`fix/leaderboard-shell-snapshot`**。
- **本番デプロイ（先行反映・実績）**: **新規マイグレーションなし**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-163719-11899`**（`raspberrypi5`·**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）/ **`20260507-164825-22626`**（`raspberrypi4`）/ **`20260507-165243-2819`**（`raspi4-robodrill01`）/ **`20260507-165602-24775`**（`raspi4-fjv60-80`）/ **`20260507-165951-8928`**（`raspi4-kensaku-stonebase01`·ローカル保存ログで **`Limit hosts` 一致を確認**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 30s** 規模・Tailscale）。
- **トラブルシュート**:
  - **`update-all-clients.sh` がローカル未コミット変更で即終了** → 本番デプロイと無関係な変更は **`git stash`** 等で作業ツリーをクリーンにする（デプロイ後に **`git stash pop`** の要否は内容次第）。
  - **continue が毎回重い／`snapshotExpired` が多い** → **API 複数プロセス間では snapshot は共有されない**（別インスタンスに振られるとフォールバックまたは失効になりうる）。**LB のスティッキー性**・`LEADERBOARD_SHELL_SNAPSHOT_TTL_MS` を [ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)・KB に従って確認。
  - **CI: Web `tsc` が shell 応答ログで `total` を参照して失敗** → `ProductionScheduleLeaderboardShellResponse` に **`total` が無い**ときは **`hasSnapshotId` 等へ寄せる**（`apps/web/src/api/client.ts`）。
- **ナレッジ**: [ADR-20260507-leaderboard-shell-snapshot.md](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)·[KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-07 · **キオスク順位ボード・段階取得 append（`leaderboard-shell/continue`）**·**API+Web**·**Pi5→Pi4×4・順次**）

- **変更概要**: 初回 `leaderboard-shell` の **`pageSize` 未満**でも **同一フィルタ・同一並び**のまま **`POST …/leaderboard-shell/continue`** で続き行を取得し Web 側でマージ（`excludeRowIds`・上限 160）。**契約**: [`shared.ts`](../../apps/api/src/routes/kiosk/production-schedule/shared.ts) の `productionScheduleLeaderboardShellContinuationBodySchema`・ルート [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)。選定は [`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts) の続き枠。**Web**: [`useLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts)。**Pi3 は対象外**（ユーザー提示リスト・リソース僅少。**Pi3 専用手順は未実施で正**）。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh feat/leaderboard-phased-shell-append infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**）。**マージ後の標準デプロイは `main`**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·ブランチ先行時は **`feat/leaderboard-phased-shell-append`**。
- **本番デプロイ（先行反映・実績）**: 先行時の **実装 tip** は **`2dd3c9b2`**（ドキュメント追記コミット前）。**`main` 正本**: [PR #268](https://github.com/denkoushi/RaspberryPiSystem_002/pull/268) **squash**・**`1baaee98`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-090345-18842`**（`raspberrypi5`·**`PLAY RECAP` `failed=0` / `unreachable=0`**）/ **`20260507-091500-1467`**（`raspberrypi4`）/ **`20260507-093553-18573`**（`raspi4-robodrill01`·**再試行で成功**・初回 **`20260507-092030-22339`** は `status-agent.service` 再起動失敗で **rollback**）/ **`20260507-094833-877`**（`raspi4-fjv60-80`·**再試行で成功**・初回 **`20260507-093945-11807`** は同趣旨）/ **`20260507-095322-14546`**（`raspi4-kensaku-stonebase01`）。いずれも成功 run は **`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**。**新規マイグレーションなし**（コードのみ）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **第2実行 約 25s**・第1実行は `deploy-status raspberrypi4` が一時 **`isMaintenance:true`** で **FAIL 1**・全台完走後に再実行で **全 PASS**）。
- **トラブルシュート**: **Pi4 で `status-agent.service` 再起動が数回リトライ後も失敗** → ロールバック後に **同じ `--limit` で再実行**すると解消する例あり（一過性）。**失敗後の rescue で journal 取り込みが UTF-8 surrogate で Ansible が deserialize 失敗**することがあるが、**根本原因は status-agent**。**`deploy-status` が一時 true** → 別ホストデプロイ中の **メンテナンスフラグ**が残るタイミングがあり得る・**全完了後に再検証**または Pi5 の **`config/deploy-status.json`**（API コンテナ内パス）を確認。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 最終更新（履歴一覧・2026-05-07）

**順位ボード・資源CDカード単位 phased（`feature/kiosk-leaderboard-card-scope`・Pi5→Pi4×4・マージ後 `main`）**·**順位ボード・continue snapshot+cursor（`fix/leaderboard-cursor-snapshot`・Pi5→Pi4×4・マージ後 `main`）**·**順位ボード・サーバ内 snapshot（`fix/leaderboard-shell-snapshot`・Pi5→Pi4×4・マージ後 `main`）**·**順位ボード段階取得・total materialized 整合・globalRank 索引・Web stale（`feat/leaderboard-output-stable-speedup`・Pi5 のみ）**·**Mobile Placement Zero2W hardening（Pi5+Pi4×4・マイグレ・Zero playbook は KB 参照）**·**順位ボード winner materialization（leaderboard-shell 経路・Pi5 のみ）**·**生産日程CSV 空 winner ガード・Web axios 1.16+（Trivy）**·**生産スケジュール実効完了3系統OR（Pi5・API+DB）**·**順位ボード段階取得（leaderboard-shell／total／decorations）Pi5 のみ**·**leaderboard COUNT 並列化**·**DGX control-server 単一アクティブ運用ガード**·**部品納期個数補助 `P2002`**·**Phase12**·**Zero2W 断片 `sudo_nopasswd_commands`**

### 補足（2026-05-06 late · **Mobile Placement Zero2W hardening（`feat/mobile-placement-zero2w-hardening`）**·**Pi5 + Pi4×4 順次・Zero2W playbook は別**）

- **変更概要**: **`ClientDevice.haizenEdgeEnabled`** と **`GET/PUT …/haizen-target-devices`** の **フラグ連動**、キオスク **`/kiosk/mobile-placement/zero2w-status`**、**`HAIZEN_DISTRIBUTION_MODE`**（README／テンプレ追随）。**正本**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)·[mobile-placement.md](../api/mobile-placement.md)。
- **対象ホスト**: **`raspberrypi5`** → **`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 **`./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit <host> --detach --follow`**・**1 台ずつ**）。**Pi3 は対象外**（ユーザー提示リスト／変更スコープ外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·ブランチ先行時は **`feat/mobile-placement-zero2w-hardening`**。**マージ後は `main`**。
- **本番デプロイ（実績・ブランチ先行反映）**: **`Detach Run ID`**: **`20260506-203237-17583`**（`raspberrypi5`）/ **`20260506-204833-27605`**（`raspberrypi4`）/ **`20260506-205620-28633`**（`raspi4-robodrill01`）/ **`20260506-210226-30541`**（`raspi4-fjv60-80`）/ **`20260506-210653-10599`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**。Pi5 で **`Run prisma migrate deploy`** **成功**。
- **Zero2W（`zero2w-edge-setup.yml`）**: 後続で **Pi3/Pi4 と同じ `NOPASSWD: ALL` 前提**へそろえたあと、Pi5 からの専用 playbook が **`ok=82 changed=10 failed=0 unreachable=0`** で完了。運用手順・実績は [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)・[KB-368 §2026-05-06](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 67s**・Tailscale）。Pi5 で **`GET /api/mobile-placement/haizen-target-devices`**（キオスク **`x-client-key`**）が **200** であることをスモーク。
- **ナレッジ**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·[mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)。

### 補足（2026-05-06 · **キオスク順位ボード・最大 ProductNo winner の materialization（相関除去・API のみ）**·**Pi5 のみ**）

- **変更概要**: `responseProfile=leaderboard` と **`leaderboard-shell`** 経路で、同一論理キー内の **`buildMaxProductNoWinnerCondition`（相関）** を **`fetchMaxProductNoWinnerRowIdsForDashboard`（`ROW_NUMBER`・1 クエリ）** で置き換え、**COUNT** と **行取得**・**装飾 hydrate** が **同一 `materializedBaseWhere`（`IN`）を共有**。**契約・順序・件数は不変**。**正本**: [`max-product-no-winner-spec.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-spec.ts)·[`max-product-no-winner-materialization.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main`**: [PR #265](https://github.com/denkoushi/RaspberryPiSystem_002/pull/265) **squash**・**`ae5f938a`** 以降。**先行反映時**はブランチ名を引数に指定）。
- **本番デプロイ（先行反映・実績）**: 先行反映コミット **`b05baa5f`**（**`main` 取り込み後は `main` 先端**を正とする）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-190944-2060`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 888s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 132s**・Tailscale）。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **生産日程CSV DEDUP 取込の空 winner ガード**·**Web axios セキュリティ**·**API+Web**·**Pi5 のみ**）

- **変更概要**: 生産日程（`PRODUCTION_SCHEDULE_DASHBOARD_ID`）の **DEDUP** 取込で **現 winner 論理キーが 0 件** のとき、**CSV 由来の消滅差分適用・外部完了同期・`ProductionScheduleCsvIngestLogicalKeySnapshot` 更新をスキップ**（`skipped: true`, `reason: 'empty_schedule_csv'`）。空CSV・異常入力で **全行を誤って「消滅完了」扱いにしない**ガード。実装 [`production-schedule-csv-ingest-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts)。[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) は **`dashboardId` と `reason` で warn**。併せて **`apps/web` の `axios` を `^1.16.0` へ**し、**Trivy fs** の **HIGH**（例: **CVE-2026-42033**）を回避（`pnpm-lock.yaml` 同期）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**先行反映時**は **`fix/schedule-csv-empty-guard`**）。
- **本番デプロイ（実績）**: **`main` 取り込み**: [PR #264](https://github.com/denkoushi/RaspberryPiSystem_002/pull/264)（squash・**`main` 先端** **`f9b1683e`**）。先行反映コミット **API ガード** [`0fd0f248`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/0fd0f248)·**axios** [`a372ecce`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/a372ecce)·ブランチ **`fix/schedule-csv-empty-guard`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-171017-29269`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 18 分規模**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 146s**・Tailscale）。
- **トラブルシュート**: **`empty_schedule_csv` の warn** は **ガード稼働の手掛かり**（異常時は上流CSV・DEDUP 設定を疑う）。**外部完了が期待とズレる**一般論は [KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)。**CI `security-docker`（Trivy fs）**: `axios` **1.15.x** の HIGH は **`^1.16.0` + lock 同期**で解消。
- **ナレッジ**: [KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)·[knowledge-base/index.md](../knowledge-base/index.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **生産スケジュール「実効完了」の3系統OR統合（手動・FKOJUNST・生産日程CSV）**·**API+DB**·**Pi5 のみ**）

- **変更概要**: **実効完了**を **手動** OR **工順ST**（**FKOJUNST_Status メール**の **dedupe キー消滅** ＋ **`C`/`P`/`X`/`O`**・**`S`/`R` winner のみ**消滅差分を反映）OR **生産日程CSV DEDUP 取込**（**取込直前 winner 論理キー**と**今回CSVから確定した winner キー集合**の差で**消滅**を検知）の **論理OR** に統一。`ProductionScheduleExternalCompletion` に **由来別3列**＋ **`isExternallyCompleted`（3列OR同期）**・生産日程用スナップショット **`ProductionScheduleCsvIngestLogicalKeySnapshot`**。マイグレーション **`20260506150000_triple_source_external_completion`**。**正本**: [KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)·[`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)·[`fkojunst-external-completion-sync.repository.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts)·[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`・**1 台**）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/completion-triple-source-unification infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 先行反映コミット **`2b8c8427`**（**`main` 取り込み**: [PR #263](https://github.com/denkoushi/RaspberryPiSystem_002/pull/263) **squash**・**`4af94e05`**）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-152049-17895`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 803s**）。Ansible **`Run prisma migrate deploy`** **成功**（マイグレ **`20260506150000`** 適用）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 138s**・Tailscale）。
- **トラブルシュート**: **外部完了が期待とズレる** → [KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)（**3由来列**・**スナップショット**・**初回／空CSV**）·**工順ST** は [KB-297 §外部完了](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)。**DB が古い** → Pi5 **`api`** の ref と **`prisma migrate status`**。**キオスク表示** → 一覧 API は実効完了式のまま → [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。
- **ナレッジ**: [KB-370](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)·[knowledge-base/index.md](../knowledge-base/index.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **キオスク順位ボード一覧 API（`responseProfile=leaderboard`）内部レイテンシ改善・COUNT と行 SELECT 並列化**·**API のみ**·**Pi5 のみ**）

- **変更概要**: `listProductionScheduleRows` の **`leaderboard` 経路**で、**可視行 `COUNT(*)`** と **`fetchLeaderboardScheduleRowsWithSeibanAwarePriority`** を **`Promise.all`** で **並列実行**。COUNT は [`production-schedule-list-count.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-list-count.service.ts) に分離。**API 契約・SQL の意味・返却内容は不変**（`full` 経路は従来どおり並列 COUNT + 主 SELECT）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/leaderboard-internal-query-latency infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`35629338`**。**Detach Run ID** **`20260506-103441-24679`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 649s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 80s**・Tailscale）。
- **トラブルシュート**: **体感が変わらない** → Pi5 **`api` イメージ**が **`35629338` 以降**か（detach ログ・`git log -1`）。**キオスク**は [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**切り分けの正本**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[KB-297 §COUNT 並列化（2026-05-06）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-api-count-parallel-2026-05-06)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **キオスク順位ボード・段階取得（leaderboard-shell／leaderboard-total／leaderboard-decorations）初回体感短縮**·**API+Web**·**Pi5 のみ**）

- **変更概要**: 順位ボードは **単一の `responseProfile=leaderboard` で全装飾を一括取得**する従来に加え、**初回**は **シェル行 → 総件数 → 装飾（機種名・顧客名・フッターチップ）**を分割取得。**並び順は `fetchLeaderboardScheduleRowsWithSeibanAwarePriority` を再利用し、応答結合では `rowId` マージのみ（再ソートしない）**。初回ページは **`pageSize` 既定 160**・上限 **160**。実装: [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)·[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)。統合テスト: [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts)（phased ケース）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **対象外**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-phased-fetch-2s infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`cd751a2a`**。**Detach Run ID** **`20260506-113443-32585`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 849s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale）。
- **トラブルシュート**: **初回だけ空欄がチラつく** → ネットワークで **shell → total → decorations** の順と失敗有無を確認。**装飾が常に欠ける** → Pi5 **`api`/`web`** の ref。**キオスク**は [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**切り分けの正本**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)（段階取得・hydrate 知見）。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[KB-297 §段階取得（2026-05-06）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-phased-fetch-2026-05-06)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-07 · **順位ボード段階取得・total の materialized COUNT 整合・globalRank 索引・Web 再取得抑制**·**API+Web+DB（索引のみ）**·**Pi5 のみ**）

- **変更概要**: **`leaderboard-total`** の件数 COUNT を **materialized winner**（`resolveLeaderboardMaterializedBaseWhere`）に揃え、**shell／一覧 leaderboard と同一 winner 定義**のままプランナ負荷のみ低減。**装飾 hydrate** は呼び出し元から **任意で `leaderboardMaterializedBaseWhere` 注入**可能。**`globalRank` 相関**は SQL 断片を共通化。**DB**: `ProductionScheduleGlobalRowRank` の **`csvDashboardRowId` 単独 INDEX**（マイグレ **`20260506170000_add_global_row_rank_csv_dashboard_row_id_index`**）。**Web**: 段階取得 3 フックの **`staleTime` / `refetchOnWindowFocus: false`** と **履歴 progress クエリの `enabled: scheduleEnabled`**。**契約・並び・件数定義・装飾内容は不変**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-output-stable-speedup infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（先行反映・実績）**: 代表コミット **`137e7e07`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-073532-249`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 739s**）。**`Run prisma migrate deploy`** **成功**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 27s**・Tailscale）。
- **トラブルシュート**: **total と shell の件数が食い違う**ように見える → Pi5 **`api`/`web`** が当該コミット（または **`main` マージ先端**）か。**索引未適用** → `prisma migrate status`。**キオスク**は [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**切り分けの正本**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)（**2026-05-07** 項）。
- **ナレッジ**: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **DGX `control-server` 単一アクティブ運用ガード（`dgx_llm_single_active_guard`）**·**DGX のみ**）

- **変更概要**: `POST /start` の直前に **非アクティブ側 backend へ実 stop** を必ず掛け、その後アクティブ側を起動。ガード ON 時は起動時に **green/blue 双方の stop コマンドが解決できること**を検証（未設定なら **プロセスは listen せず**）。実装: [`control-server.py`](../../scripts/dgx-local-llm-system/control-server.py)·[`dgx_llm_single_active_guard.py`](../../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py)·[`stop-llama-server.sh`](../../scripts/dgx-local-llm-system/stop-llama-server.sh)·[`stop-trtllm-server.sh`](../../scripts/dgx-local-llm-system/stop-trtllm-server.sh)。**Pi5 API／Ansible 変更なし**。
- **対象ホスト**: **DGX Spark（`system-prod`）のみ**。Pi5／Pi4／Pi3 は **対象外**（**Pi3 専用手順は不要**）。
- **標準手順（DGX）**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)。**本番実績（2026-05-06）**: 上記 4 ファイルを **`scp`** で **`ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/`**。**`dgx_llm_single_active_guard.py` は `control-server.py` と同じディレクトリに必ず配置**（import 失敗で起動不可）。
- **再起動の注意**: **`/srv/dgx/system-prod/bin/start-control-server.sh`** は **既存 PID が生存していると `control-server already running` で終了**し、**新しい `control-server.py` を読まない**。反映時は **`control-server.pid` の PID を停止**してからスクリプトを再実行する（詳細は Runbook・KB-365 Phase12）。
- **実機検証（2026-05-06）**: **`ACTIVE_LLM_BACKEND` が control/gateway で一致**・`38081/healthz` **200**・`39090` **401**・`/v1/models` に **`system-prod-primary`**・（blue active 時）**`38082` 非 listen**・**`llama-server` 不在**。ゲートウェイは **再起動していない**（当該変更は control のみ）。
- **トラブルシュート**: **コードを置いたが挙動が古い** → **PID ガード**を疑い **`control-server.pid` を確認**。**起動直後にプロセスがいない** → **`GREEN_*`/`BLUE_*` stop が片系だけ**だとガード ON で **起動拒否**（`DGX_LLM_SINGLE_ACTIVE_GUARD=false` は非推奨・検証用）。
- **ナレッジ**: [KB-365 §Phase12](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-12-dgx-control-server-single-active-guard-2026-05-06)·[ADR-20260428](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **部品納期個数補助同期 `P2002`（`csvDashboardRowId`）修正の Pi5 本番反映**·**`main`**·**API のみ**）

- **変更概要**: [PR #256](https://github.com/denkoushi/RaspberryPiSystem_002/pull/256)（squash **`a204da0a`**）で、補助同期が **同一 winner `csvDashboardRowId` の既存行**に対し **3キー不整合でも create せず update** へフォールバック（`skipDuplicates` 不使用）。ドキュメント追補は [#257](https://github.com/denkoushi/RaspberryPiSystem_002/pull/257)（**`6f5ac422`**）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **本番デプロイ（実績）**: **`main`**（**`6f5ac422` 以降**）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260505-223440-27566`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 818s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 61s**・Tailscale）。
- **トラブルシュート**: 補助同期で **`P2002` on `csvDashboardRowId`** が残る → Pi5 **`api` イメージ**が当該修正を含むか（`git log -1` / デプロイ Detach ログ）、**上流3キーと本体 winner**は [KB-328 §P2002](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md#order-supplement-sync-p2002-csv-dashboard-row-id) を参照。
- **ナレッジ**: [KB-328 §P2002](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md#order-supplement-sync-p2002-csv-dashboard-row-id)·[csv-import-export.md](./csv-import-export.md) §F·[KB-297 §差分同期](../knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-incremental-sync-2026-05-01)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-06 · **Phase12 実機検証・Zero2W `sudo_nopasswd_commands`**）

- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale・**コード変更なしの健全性確認**）。
- **知見**: Zero2W が **対話 sudo 必須** のままだと Pi5 からの **`zero2w-edge-setup.yml`** で **`Missing sudo password`** になり得る。断片の **`sudo_nopasswd_commands`**（**`status-agent` / `haizen-agent` の `systemctl`**・**reboot/poweroff**）は **サービス操作向けの限定 sudoers**。**Pi3/Pi4 と同じく playbook 全体を無人で通す**には、Zero 側でも **`sudo -n true` が通る広い sudo 前提**が必要で、今回は **`NOPASSWD: ALL`** にそろえて解消した。
- **正本**: **`infrastructure/ansible/inventory-zero2w-edge-fragment.sample.yml`**（実 IP を含む **`inventory-zero2w-edge-fragment.yml`** は `.gitignore`）·[KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)·[zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)。

### 補足（2026-05-05 late · **Zero2W 棚番エッジ hardening**·**`feat/zero2w-haizen-edge-hardening`**·**Pi5 のみ標準デプロイ → Zero2W 復旧完了**）

- **変更概要**: `haizen-*` API 契約の整理（例: **`shelfCodeRaw`／`haizen-current`**・統合テストの **`errorCode`**）、Web クライアント追随、**`clients/haizen-agent`** の **`HAIZEN_TLS_VERIFY_MODE`**、Ansible **`haizen-agent.yml`**・**`/etc/raspi-haizen-agent.conf` を `0640`**（**`x-client-key` の world-readable 化を避ける**）等。**Pi3 は対象外**（本ロールアウトで **Pi3 専用手順は未実施で正**）。
- **対象ホスト（標準 `update-all-clients.sh`）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。
- **標準コマンド（Pi5）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/zero2w-haizen-edge-hardening infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 反映後は** `main`）。
- **本番デプロイ（Pi5・実績）**: 代表コミット **`1237f37a`**。**Detach Run ID** **`20260505-201203-6644`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 完了まで約 678s**）。
- **CI（feature push）**: GitHub Actions Run **`25372469180`** **success**（所要 **約 11m**）。
- **Zero2W（`zero2w-tanaban01`・専用 playbook）**:
  - 初回は **Pi5→Zero SSH :22 timeout** で `UNREACHABLE`（端末再起動前）。
  - 端末再起動後、Pi5 からの **`ssh` / `ansible ping` は復旧**。ただし playbook 再実行で **`Missing sudo password`** と **`haizen-agent` の `hid=stdin`（service が inactive）** が判明。
  - 対処: `ansible_become_password` を付与し、断片インベントリへ **`haizen_agent_hid_device: /dev/input/by-id/usb-TMC_HIDKeyBoard_1234567890abcd-event-kbd`** を追加して再適用。
  - 最終結果: `zero2w-edge-setup.yml` **成功**（`ok=81 changed=11 failed=0 unreachable=0`）。
- **実機（自動・広域）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 102s**・Tailscale）。
- **実機（Zero2W E2E）**: Pi5 上 `PATCH /haizen-preset-shelf` → `POST /haizen-scans` → `GET /haizen-current?shelfCodeRaw=西-北-01` を実行し、Zero2W キー（`client-key-zero2w-tanaban01-edge1`）で **イベント作成と一覧反映を確認**。`resolutionStatus=UNRESOLVED` は日程未一致時の仕様どおり。
- **ナレッジ**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)·[zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)·[mobile-placement.md](../api/mobile-placement.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-05: **Pi5 体感遅延・バックグラウンド負荷の緩和（API+Web）**·**`improve/pi-ux-phase-c`**·**Pi5 のみ**）

- **変更概要**: **API**: 起動経路の **ストレージ初期化並列化**、**Prisma 接続 URL のクエリ安定化**（`postgres-url-params`・`statement_timeout` 等の二重付与抑制）、**`/api/system/metrics` のヒープ／イベントループlatency 等**、`network_mode` に応じた **listen bind**、複数アラート／スケジューラ系 **`exclusive-scheduler-tick` による同日 tick 排他**、**リクエストロガーの同期 I/O 回避** 等。**Web**: **axios 既定タイムアウト**（[`api-timeout-ms`](../../apps/web/src/lib/api-timeout-ms.ts)）、**管理画面ポーリング間隔の見直し**（[`admin-polling-intervals`](../../apps/web/src/lib/admin-polling-intervals.ts)）、**React Query の refetch 間隔緩和**（[`hooks.ts`](../../apps/web/src/api/hooks.ts)）、**生産日程ミューテーションの短期クールダウン**。**調査手順の正本**: [raspberry-pi-ux-baseline-methodology.md](../investigation/raspberry-pi-ux-baseline-methodology.md)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`・**1 台**）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh improve/pi-ux-phase-c infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`a5395af4`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260505-190249-31447`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 完了まで約 576s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 84s**・Tailscale）。
- **トラブルシュート**: **操作が重いまま** → Pi5 の **`api` / `web` コンテナが当該コミット以降か**（`git log -1`／イメージビルド時刻）、キオスク **[verification-checklist.md](verification-checklist.md) §6.6.4 強制リロード**。**デプロイ完了後に `alerts/alert-*.json` が増える**場合があるが、**成功の正本は `PLAY RECAP` / `*.summary.json` / リモート `exit`**（既存 detach 運用どおり）。
- **知見（開発）**: **`pnpm --filter @raspi-system/web build`（`tsc -b`）** が **TS6310** で落ちる環境があり得る（参照プロジェクト構成）。**`vite build` と API 系ビルドが通れば**本番 Docker 経路と乖離しないことが多いが、疑う場合は **該当 tsconfig / project references** を確認。
- **ナレッジ**: [raspberry-pi-ux-baseline-methodology.md](../investigation/raspberry-pi-ux-baseline-methodology.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-05 evening: **キオスク順位ボード・一覧取得と手動順位の整合（API のみ）**·**`feat/leaderboard-priority-selection-consistency`**·**Pi5 のみ**）

- **変更概要**: `responseProfile=leaderboard` の `listProductionScheduleRows` で、**手動割当（`ProductionScheduleOrderAssignment.processingOrder`）行を SQL 取得で最優先**し、**同一製番（`FSEIBAN`）の関連行を第 2 クエリで展開**（展開は **`expansionWhere`** により **全文検索・機種名条件を外し**、絞り込み起因の製番分裂を防止）。残り枠は **納期（補助の計画終期を含む）昇順**で `pageSize` まで補完。**手動＋製番展開が `pageSize` を超えても手動側は切り捨てない**。`full` プロファイルは従来の単一 SQL のまま。実装: [`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-priority-selection-consistency infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`e4a8417d`**。**Detach Run ID** **`20260505-181206-15069`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・ローカル `--follow` 完了まで **約 658s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 84s**・Tailscale）。
- **トラブルシュート**: **`order-usage` では 1…N が占有なのに順位ボード一覧に手動行が見えない** → Pi5 **`api` イメージ**が当該コミット以降か確認。[KB-297 §leaderboard 取得整合](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-fetch-manual-priority-2026-05-05)。**キオスク**は [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。
- **ナレッジ**: [KB-297 §leaderboard 取得整合](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-fetch-manual-priority-2026-05-05)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·**`main`**: [PR #251](https://github.com/denkoushi/RaspberryPiSystem_002/pull/251)。

### 補足（2026-05-05: **キオスク順位ボード・左ペイン幅／登録製番グリッド／順位ピッカーの画面内表示**·**`feat/leader-board-left-pane-rank-picker-clamp`**·**Pi5 のみ**）

- **変更概要**: **登録製番**が **2 列グリッド＋順位列**で狭く **× と製番が重なりやすい**問題への対処。**製番順評価 ON** 時は **`grid-cols-1`**（1 行＝1 製番）。アサイドは **OFF `w-80` / ON `w-96`**（`max-w-[90vw]` 維持）。**順位ピッカー** [`LeaderBoardSeibanRankPicker`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanRankPicker.tsx) は [`AnchoredDropdownPortal`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx) を利用。既定 **`clampToViewport: true`** で **パネル左端がビューポート外に出ない**よう [`anchoredDropdownViewportClamp.ts`](../../apps/web/src/components/kiosk/anchoredDropdownViewportClamp.ts) **`computeAnchoredPanelLeftEdge`** を適用（**`clampToViewport={false}`** で従来の `translateX(-100%)` 寄りに戻せる）。**閉鎖時 `position` クリア**・**二重 rAF 前のアンマウント**は `cancelled` フラグでガード。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leader-board-left-pane-rank-picker-clamp infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`d8583f2d`**。**Detach Run ID** **`20260505-081520-1295`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・ローカル `--follow` 完了まで **約 294s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 60s**・Tailscale）。
- **トラブルシュート**: **ピッカー左が欠ける** → **`web`** が当該コミットか・**強制リロード**（[verification-checklist.md](verification-checklist.md) §6.6.4）。**広い登録製番ドロップダウン**（[`ProductionScheduleSeibanFilterDropdown`](../../apps/web/src/components/kiosk/ProductionScheduleSeibanFilterDropdown.tsx) 等）で **アンカーからパネル右端がずれる**ことがある（左クランプの意図どおり）。必要なら当該コンポーネントのみ **`clampToViewport={false}`**。
- **ナレッジ**: [KB-297 §左ペイン・ビューポートクランプ（2026-05-05）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-left-pane-viewport-clamp-2026-05-05)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-04 / **2026-05-05 本番反映**: **`FKOJUNST_Status` CSV 由来外部完了を「前回 dedupe キーあり→今回なし」差分へ**·ブランチ **`feat/fkojunst-status-disappearance-external-completion`**）

- **変更概要（歴史的記録）**: 当初は **`ProductionScheduleExternalCompletion`** を **dedupe キー消失差分**で更新し、**`ProductionScheduleFkojunstStatusMailDedupeKeySnapshot`**（マイグレ **`20260504220000_fkojunst_status_mail_dedupe_key_snapshot`**）を利用した。**2026-05-08 改訂**: **メール由来の外部完了は `fkmail.statusCode` が `C`/`X` かどうかのみ**で再計算（キー消失・スナップショットは**使わない**）。テーブルは DB に残り得る。手動完了との **OR（実効完了）** は [`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts) どおり維持。
- **正本**: [`fkojunst-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts)·[`fkojunst-external-completion-sync.repository.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts)·[KB-297 §外部完了](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/fkojunst-status-disappearance-external-completion infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（2026-05-05）**: 代表コミット **`6d9c3549`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260505-072811-487`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート `exit` **`0`**・ローカル `--follow` 完了まで **約 617s**）。Ansible の **`Run prisma migrate deploy`** が **成功**（マイグレーション **`20260504220000`** 適用）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 82s**・Tailscale）。
- **トラブルシュート**: **`Rebuild/Restart docker compose services` が無出力のまま長い**場合は **detach ログ**で **`docker compose` 完了**まで待つ（既存運用どおり）。**外部完了が期待とズレる** → [KB-297 §外部完了](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02) の **初回／空 CSV／キー照合**を確認。

### 補足（2026-05-04 late: **キオスク順位ボード・製番順評価 ON 時の登録製番ランクピッカー（↑↓ 廃止）**·**`feat/leader-board-seiban-rank-picker`**·**Pi5→Pi4×4**）

- **変更概要**: **製番順評価 ON** のとき、左ペインの登録製番で **先頭の順位番号**をタップすると **1…N** から移動先を選ぶ [`LeaderBoardSeibanRankPicker`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanRankPicker.tsx)（**幅 `w-80` 相当**）。**↑↓ は撤去**。並び替えは純関数 [`reorderSeibanToRank.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanPriority/reorderSeibanToRank.ts)、永続化は [`usePersistedLeaderBoardSeibanEval.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardSeibanEval.ts) の **`moveRegisteredSeibanToRank`**。[`AnchoredDropdownPortal`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx) に **`fixedZIndex`**、[`kioskRevealUi.ts`](../../apps/web/src/hooks/kioskRevealUi.ts) に **`KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK`**。**API / DB / `search-state` は不変**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（Web のみ・リソース僅少のため専用手順は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leader-board-seiban-rank-picker infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`d4d6160c`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260504-211859-16303`**（`raspberrypi5`）/ **`20260504-212412-27756`**（`raspberrypi4`）/ **`20260504-212945-9891`**（`raspi4-robodrill01`）/ **`20260504-213330-19891`**（`raspi4-fjv60-80`）/ **`20260504-213745-19344`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**（Pi5 は **`ok≈129–134` `changed≈4–10`** 規模、Pi4 はホストにより **`ok≈129` `changed≈10`** 前後）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 60s**・Tailscale）。
- **トラブルシュート**: **ピッカーが左ペインの下に隠れる** → Portal の **`fixedZIndex`** と `KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK`。**並びが戻る** → **製番順評価 OFF** または **端末ローカル `localStorage` の別端末**を疑う。**強制リロード**: [verification-checklist.md](verification-checklist.md) §6.6.4。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §ランクピッカー（2026-05-04）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-rank-picker-2026-05-04)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-04 evening: **キオスク順位ボード・製番順評価モード（端末ローカル `localStorage`）**·**`feat/kiosk-seiban-priority-eval-mode`**·**Pi5 のみ**）

- **変更概要**: 順位ボード `/kiosk/production-schedule/leader-order-board` の左ペインに **製番順評価 ON/OFF**。登録製番の **移動 UI** は同日追補の [**ランクピッカー項**](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-rank-picker-2026-05-04)（**`feat/leader-board-seiban-rank-picker`**）を正とする（本項リリース時点では ↑↓）。**共有 `sharedHistory`・DB・API は不変**。評価順は **`usePersistedLeaderBoardSeibanEval.ts`**・`seibanPriority/*` 純粋関数・資源列内ソートは **`sortLeaderBoardRowsForSeibanEvalDisplay`** → **`buildLeaderBoardViewModel`**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-seiban-priority-eval-mode infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は** `main`）。
- **本番デプロイ（実績）**: 代表コミット **`ffe250cb`**。**Detach Run ID** **`20260504-203034-22339`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・`--follow` 約 **397s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 156s**・Tailscale）。
- **トラブルシュート**: **トグルが見えない／資源列の並びが変わらない** → Pi5 **`web`** の反映コミット・ブラウザ **強制リロード**（[verification-checklist.md](./verification-checklist.md) §6.6.4）。**開発時**: **`pnpm --filter @raspi-system/web lint`** で **import/order** を先に通す（pre-commit で止まる典型は **純粋関数の import がグループ外**）。
- **ナレッジ**: [KB-297 §製番順評価](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-priority-eval-mode-2026-05-04)·[KB-297 §ランクピッカー（登録製番移動 UI）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-rank-picker-2026-05-04)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-04 evening: **Zero2W 担当棚設定（キオスク + `haizen-target-devices` API）**·**`feat/mobile-placement-zero2w-assignment`**·**Pi5 のみ**）

- **変更概要**: 配膳キオスクに **Zero2W 担当棚** ページ（`/kiosk/mobile-placement/zero2w-assignment`）と、`GET/PUT /api/mobile-placement/haizen-target-devices…` を追加。**候補一覧応答は `apiKey` を含めない**（ブラウザ露出抑制）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**初回本番は `feat/mobile-placement-zero2w-assignment` を適用**。以降は標準どおり **`main`**）。
- **本番デプロイ（実績）**: 代表コミット **`153af161`**。**Detach Run ID** **`20260504-183939-27983`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・ローカル `--follow` 完了まで **約 721s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 95s**・Tailscale）。
- **ナレッジ**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)·[mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-04: **DGX リソース Phase11（進行中表示持続化）**·**`main`**·**API+Web+DGX gateway**·**Pi5 → DGX 順次**）

- **変更概要**: 管理 UI `/admin/tools/dgx-resource` で、長時間シナリオ（例: `private_to_business`）実行中にタブを切り替えて戻っても **`進行中:`** が消えにくいよう、**イベントログ判定**と **`sessionStorage` pending** を併用。API／gateway のシナリオ系整理（PR #246 代表 **`5d96b59b`**）。
- **対象ホスト**: **① `raspberrypi5` のみ**（`--limit raspberrypi5`）。**② DGX** へ **`gateway-server.py`** を配置しゲートウェイ再起動。Pi4／Pi3 は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド（Pi5）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **標準手順（DGX）**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)。**本番実績（2026-05-04）**: `scp scripts/dgx-local-llm-system/gateway-server.py ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/` の後、**systemd 再起動は sudo 不可**のため **`/srv/dgx/system-prod/bin/start-gateway-server.sh`** で **`127.0.0.1:38081/healthz` 200** を確認。
- **本番デプロイ（実績・Pi5）**: **Detach Run ID** **`20260504-113918-744`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・`--follow` 約 **702s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **109s**・Tailscale）。
- **トラブルシュート**: ゲートウェイ **`healthz` が通らない** → [KB-365 §Phase11](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-11進行中表示の持続化長時間切替の運用解釈web--runbook)（**広い `pkill` は避け**、`start-gateway-server.sh` を正規経路に）。
- **ナレッジ**: [KB-365 Phase 11](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### Pi5 リモートデプロイ前提（self-SSH・孤立 lock 再発防止）

- **なぜ必要か**: `update-all-clients.sh` の Pi5 **preflight** は **Pi5 上で** `ansible … -m ping` を実行する。標準 `inventory.yml` の `raspberrypi5` は **SSH 接続**のため、Pi5 から **同一ホストの `ansible_host`（通常は Tailscale の `server_ip`）** へ鍵認証できる **self-SSH** が前提（`authorized_keys` に自分の **`~/.ssh/id_ed25519.pub`** が無いと `Permission denied (publickey)`）。
- **事前確認（手動）**: `ssh <Pi5> 'ssh -o BatchMode=yes <user>@<server_ip> "echo UPDATE_ALL_CLIENTS_SELF_SSH_OK"'`（値は Pi5 の `group_vars/all.yml` の `network_mode` / `tailscale_network|local_network` に合わせる）。**スクリプトは同チェックを preflight の ansible ping 直前に自動実行**する（TalkPlaza `inventory-talkplaza.yml` は `ansible_connection: local` のため **スキップ**）。
- **構成管理**: **server** ロールが（`ansible_connection != local` のとき）`~/.ssh/id_ed25519.pub` を **`authorized_keys` へ冪等追記**し、`.ssh` 700 / `authorized_keys` 600 を担保する（[`ssh-loopback-authorized.yml`](../../infrastructure/ansible/roles/server/tasks/ssh-loopback-authorized.yml)）。
- **孤立 lock**: preflight 失敗時でも **bootstrap 用リモート lock は EXIT で解放**する。異常終了で残った **`runner=bootstrap` / `runPid=null` / `logs/deploy/ansible-update-<runId>.status.json` 無し** は、**`REMOTE_BOOTSTRAP_ORPHAN_SECONDS`（既定 180 秒）** 経過後、**`ansible-playbook` も `ansible … -m ping` も動いていない**場合に **次回 `acquire_remote_lock` で削除**される。詳細は [KB-366](../knowledge-base/infrastructure/ansible-deployment.md#kb-366-pi5-self-ssh-preflight-and-orphan-lock)。

### 補足（2026-05-03: **Pi5 deploy 再発防止（self-SSH／authorized_keys／orphan bootstrap lock）本番反映**·`feat/deploy-preflight-selfssh-lock-guard`·Pi5 のみ）

- **変更概要**: `update-all-clients.sh` に **preflight 直前の Pi5 loopback SSH チェック**（`UPDATE_ALL_CLIENTS_SELF_SSH_OK`）。**server** ロール [`ssh-loopback-authorized.yml`](../../infrastructure/ansible/roles/server/tasks/ssh-loopback-authorized.yml) で **`id_ed25519.pub` の `authorized_keys` 冪等追記**（`ansible_connection != local`）。**bootstrap リモート lock** は preflight 完了まで **EXIT で解放**、孤立 lock は **`REMOTE_BOOTSTRAP_ORPHAN_SECONDS`** と **`ansible … -m ping` / `ansible-playbook` の稼働確認**で **次回 acquire 時に掃除し得る**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/deploy-preflight-selfssh-lock-guard infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`31baa662`**（`feat(deploy): Pi5 self-SSH preflight guard and orphan bootstrap lock cleanup`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-190010-8105`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 194s**）。preflight ログに **self-SSH チェック成功後に ansible ping** が確認できる。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 103s**・Tailscale）。
- **トラブルシュート**: self-SSH／lock の典型は [KB-366](../knowledge-base/infrastructure/ansible-deployment.md#kb-366-pi5-self-ssh-preflight-and-orphan-lock)。**手動で lock を消す前**は **`ansible-playbook` / `ansible … -m ping` が無いこと**と **対応する `.status.json` の有無**を確認する。
- **ナレッジ**: [KB-366](../knowledge-base/infrastructure/ansible-deployment.md#kb-366-pi5-self-ssh-preflight-and-orphan-lock)·上記「Pi5 リモートデプロイ前提」節·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース KPI メトリクス（overview 数値・gateway `/system/metrics`）**·`feat/dgx-kpi-metrics-fallback`·**API + DGX gateway**·**Pi5 → DGX 順次**）

- **変更概要**: Pi5 API の **`DGX_RESOURCE_METRICS_URL` 未設定**時に、admin LocalLLM の base へ **`GET /system/metrics`**（**`X-LLM-Token` 必須**）→ 失敗時 **`GET /v1/system/metrics`** の順で KPI JSON を取得。DGX **`gateway-server.py`** に **`GET /system/metrics`**（`nvidia-smi`、GPU メモリ N/A 時は **`free -b`** 由来の used/total/free）を追加し、**`/v1/*` と同様に `X-LLM-Token` を検証**。repo: `apps/api/.../dgx-resource.*`・`scripts/dgx-local-llm-system/gateway-server.py`。
- **対象ホスト**: **① `raspberrypi5` のみ**（`--limit raspberrypi5`）。**② DGX**（`100.118.82.72`、ユーザーは環境に合わせる）へ **`gateway-server.py` を `/srv/dgx/system-prod/bin/` に配置しゲートウェイを再起動**。Pi4／Pi3 は **no hosts matched**（**Pi3 専用手順は不要**）。
- **標準コマンド（Pi5）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-kpi-metrics-fallback infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **標準手順（DGX）**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（**repo の `scripts/dgx-local-llm-system/` を `/srv/dgx/system-prod/bin/` に揃える**方針・**systemd** は `systemctl restart dgx-llm-gateway` を参照）。**本番デプロイ実績（2026-05-03）**: `scp gateway-server.py ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/` のち **`sudo systemctl restart dgx-llm-gateway`** は **運用ユーザーに sudo が無く対話パスワードが必要なため実行できなかった**。当該ホストでは **`dgx-llm-gateway` が `inactive`** で **`start-gateway-server.sh`** 常駐のため、**既存 `gateway-server.py` プロセスを終了**したうえで **`/srv/dgx/system-prod/bin/start-gateway-server.sh`** を実行し **`127.0.0.1:38081/healthz` が 200** であることを確認した（詳細は Runbook の本項補足）。
- **本番デプロイ（実績・Pi5）**: ブランチ **`feat/dgx-kpi-metrics-fallback`**（代表コミット **`47a17096`**・`fix(api): /system/metrics を LLM トークンで保護` を含む）。**Detach Run ID**: **`20260503-211051-8713`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート `exit` **`0`**・ローカル `--follow` 完了まで **約 702s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 157s**・Tailscale）。
- **仕様・知見**: **API と gateway は同じ反映窗口で揃える**（先にトークン必須 gateway だけを当てると、旧 API は `/system/metrics` へヘッダ無しでフォールバックし **KPI が一時的に空**になり得る）。**DGX Spark** では `nvidia-smi` の memory 列が **`[N/A]`** になり得るため、gateway 側で **システムメモリにフォールバック**する。
- **トラブルシュート**: KPI が空のまま → Pi5 **`api` イメージが当該コミットか**、`/api/system/dgx-resource/overview` の **`kpis`** と **`notes`**、DGX で **`curl -H "X-LLM-Token: …" http://127.0.0.1:38081/system/metrics`**（**403** はトークン不一致・**503** は `nvidia-smi`/`free` 双方の収集失敗）。gateway 再起動は **systemd 利用時は root/sudo**、**ユーザー常駐時は PID 確認のうえ `start-gateway-server.sh`**（[KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) Phase 10 節）。
- **ナレッジ**: [KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) Phase 10 節·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース Phase8（KPI 先頭・説明削減・全文可読）**·`feat/dgx-resource-dashboard-ui-phase8`·**Web のみ**·Pi5 のみ）

- **変更概要**: `/admin/tools/dgx-resource` の Web を **KPI ストリップ先頭**へ再構成。**`overview.kpis`** を横一列（狭幅は横スクロール）で表示し、**読み込み完了後の `h1「DGX リソース」` と補助説明文を削除**。シナリオカードの **絵文字** と **「4つの操作だけ…」説明**を除去し、`Spark` / シナリオ / KPI の文言は **`truncate` をやめて折り返し表示**。実装は **`dgxResourceKpiStripModel.ts`** に表示モデルを分離し、KPI 組み立てを React 非依存でテスト固定。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-dashboard-ui-phase8 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後の標準運用は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`89f65a7c`**（`feat(web): simplify DGX dashboard into a KPI-first operator view`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-181600-946`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 666s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 118s**・Tailscale）。
- **トラブルシュート**: `update-all-clients.sh` の preflight で **`raspberrypi5 | UNREACHABLE! Permission denied (publickey)`** が出る場合、**Pi5 自身の公開鍵が Pi5 の `authorized_keys` に入っていない**可能性がある。Pi5 上の **`ssh -o BatchMode=yes denkon5sd02@100.106.158.2`** で self-SSH を確認し、必要なら `~/.ssh/id_ed25519.pub` を `authorized_keys` へ追加する。失敗時に **`runner=bootstrap` / `runPid=null` / deploy artifact なし** の lock だけ残った場合は、**実行中プロセスが無いことを確認してから** `/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock` を退避・削除して再試行する（詳細は [Ansible/デプロイ KB](../knowledge-base/infrastructure/ansible-deployment.md)）。
- **ナレッジ**: [KB-365 §Phase8](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-8kpi-先頭説明削減全文可読web-のみ本番反映)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース Phase9（Orchestration Strict Ready・安全ロールバック）**·`feat/dgx-resource-ready-guarantee`·API+Web·Pi5 のみ）

- **変更概要**: **`EXECUTE_ORCHESTRATION_SCENARIO`** の API 成功を **Strict Ready（業務復帰は `/v1/models`・私用は Comfy ヘルス・実験は experiment ヘルス）達成まで**に拡張。**タイムアウト時**は運用モードをガイド前へ戻し、私用／実験で補助ワークロードの **安全ロールバック**を試行。応答に **`readinessChecksJa` / `readinessSummaryJa` / `rollback`**（省略可・後方互換）。**実装**: `dgx-resource.scenario-readiness.ts`・`dgx-resource.scenario-safe-rollback.ts`・ワークロード遷移統合。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-ready-guarantee infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`8cbc6f38`**（`feat(dgx): require ready state before completing orchestration`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-194121-32704`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 684s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 89s**・Tailscale）。
- **トラブルシュート**: **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`** 超過で業務復帰が失敗 → Runbook / Ansible で閾値延伸（**`apps/api/src/config/env.ts` の Zod `max` とセット**）。**Ready 表示が長い** → **`readinessChecksJa`** と API ログ。**Phase12** はガイドの Strict Ready を直接検証しない（広域ヘルス中心）。
- **ナレッジ**: [KB-365 §Phase9](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-9orchestration-strict-readyapi--web)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース Phase7（運用 UI 最小化・実験シナリオ・gateway／Ansible 整合）**·`main`·API+Web+DGX·Pi5 のみ）

- **変更概要**: Web は **`DgxResourceDashboard` / `DgxResourcePrimaryScenarioFlow`** で **状態チップ一行 + 目的別 4 操作**。**監視 KPI・イベントタイムライン**はメインから外し **「詳細・保守」** へ。主操作は **確認後にプレビュー→実行を連続**（プレビュー専用ボタン撤去。**フロントは `planFingerprint` を主要表示しない**）。API は **`business_to_experiment`** で **`experiment-lab` post-policy `start`**、指紋 **`postPolicyStarts`**。DGX **`gateway-server.py`**: **`GET /private-comfyui/health`** はプローブ用に **認証なし**、**`experiment_lab_health_mode`**（既定 **`container`**）でコンテナ生存確認、実験起動は **`control-server.env` を source**。Ansible **`inventory.yml`** の **`api_dgx_resource_*`** と **`vault.yml.example`** の **`vault_api_dgx_resource_*`**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **リポジトリ代表コミット**: **`956cccf7`**（Web 簡素化）·**`0a136ce9`**（シナリオ・ヘルス・gateway／inventory 整合）。
- **ナレッジ**: [KB-365 §Phase7](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-7運用-ui-の最小化補助ランタイム実運用実験シナリオ整合api--web--dgx-gateway--ansible)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース 目的別4操作ガイド（タスク優先 UI）／`business_to_private` の post-policy Comfy 起動**·`feat/dgx-resource-ui-task-first`·API+Web·Pi5 のみ）

- **変更概要**: **`/admin/tools/dgx-resource`** を **「私用を始める／業務に戻す／実験を始める／実験を終えて業務に戻す」** の 4 導線中心にし、Spark・監視・手動運用モード・個別起停・技術 ID は **`DgxResourceAdvancedControls`（`<details>`）で既定折りたたみ**。API は **`dgx-resource.scenario-post-policy.ts`** で **`business_to_private` かつ Comfy の Pi5 POST 両方設定時**、ポリシー適用後に **`private-comfyui` `start`** をプレビュー・実行・指紋に組み込み（順序は **事前ワークロード → policy → post-policy**）。Web は **`dgxResourceTaskFlows.ts`** の順序安定化、`DgxResourceCurrentStateSummary`／`DgxResourcePrimaryScenarioFlow` 分離。既存 **`PREVIEW_*`/`EXECUTE_*`/`targets`/`operator` 契約は維持**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 個別デプロイは不要**（ユーザー方針の専用手順対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-ui-task-first infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`5ac0f17d`**（`feat(admin-dgx): task-first dashboard and post-policy comfy start`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-140320-20910`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 651s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 113s**・Tailscale。**Pi3 は検証のみ**）。
- **トラブルシュート**: **UI が旧のまま／`operator` 欠落**: Pi5 **`api`/`web` を同一ブランチ**、[verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**Stale（409）**は Phase 4 節どおりプレビュー再取得。**本番ビルドで post-policy の `targetId` 型不一致**: **`PostPolicyOrchestrationStep`** の `targetId` は **`WorkloadAdjustmentStep['targetId']`** にそろえると `ScenarioWorkloadStepPreview` と整合（開発時 Vitest と `tsconfig.build` の差異に注意）。
- **ナレッジ**: [KB-365 §Phase6](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-6目的別ガイド--post-policy-comfy-apiweb本番反映)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX リソース管理 UI 再設計（運用コンソール／デザイントークン集約）**·`feat/dgx-resource-ui-redesign`·**Web のみ**·Pi5 のみ）

- **変更概要**: `apps/web` の **`/admin/tools/dgx-resource`**。**`dgxResourceUi.ts`** にステータス／リスク／ポリシーバッジ／監視アラート枠・**`shouldShowMonitoringPanel`**（正常時は StatusBar へ集約）を集約。**`Button`**: **`danger`**・ダーク面は **`ghostOnDark`**（**`ghost` はライト背景向け**のまま）。**運用コンソール**: StatusBar／3 ワークロード／目的別ガイド。**シナリオクリックは選択のみ**・**プレビュー取得／再取得**は別ボタン。**StatusBar「注意」件数**は **`monitoring.alerts.length` のみ**（`operatorSummary.alertPreviewJa` は同一アラート先頭の短文要約のため加算しない）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-ui-redesign infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`d449b655`**（`feat(web): DGX resource admin UI redesign`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-131606-21654`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 347s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 125s**・Tailscale）。
- **トラブルシュート**: **UI が旧のまま** → [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**・Pi5 **`web`** イメージのコミット確認。**ダークグラデ上でボタン文字が消える** → **`ghostOnDark`** を使う（`ghost` は意図的にライト向け）。**運用監視ヒントパネルが出ない** → **仕様どおり**アラート・直近ガイド失敗・Inference 短文が異常候補のときだけ表示。
- **ナレッジ**: [KB-365 §Phase5 UI](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGXリソース Phase5（運用者コンソール・API 境界整理）**·`feat/dgx-resource-operator-console`·API+Web·Pi5 のみ）

- **変更概要**: `GET …/overview` に **`operator`**（3 ワークロード要約・`operatorSummary`・目的別ガイド **`operatorActions`**）。`SET_POLICY` / シナリオ実行の本体を **`dgx-resource.workload-transition.ts`** へ分離し、プレゼンを **`dgx-resource.operator-overview.ts`** に集約。`EXECUTE_ORCHESTRATION_SCENARIO` 応答に **`scenarioExecute.outcomeKind`**（`success` | `partial_failure` | `noop`）を付与可能。**後方互換**: `targets[]`・`monitoring`・Phase4 の Preview/Execute・既存 actions は維持。**ADR**: [`ADR-20260503-dgx-resource-operator-console.md`](../decisions/ADR-20260503-dgx-resource-operator-console.md)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 は個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-operator-console infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`e88d9206`**（`feat(dgx): add operator console overview boundary`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-115446-2532`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・ローカル `--follow` 完了まで **約 826s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 97s**・Tailscale。**Pi3 は検証スクリプトが疎通確認するのみ**・本変更の Ansible 適用対象外）。
- **トラブルシュート**: **運用コンソールが出ない／`operator` が無い** → Pi5 **`api`/`web` が同一コミット**か・[verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**ポリシー変更後に選んでいたシナリオが無効化** → Web は **`operator` 同期後に主要シナリオへフォールバック**（実装: `DgxResourceOperatorConsole` の `useEffect`）。**Phase4 と同様**: Stale（409）は **プレビュー再取得**、ガイド途中停止は **`completedStepOrders`** / `lastScenarioFailure` / イベントログ。
- **ナレッジ**: [KB-365 §Phase5](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-5-本番反映記録)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGX Control Targets（標準ターゲット一覧・gateway 起停の正規アクション）**·`feat/dgx-resource-standard-control-targets`·API+Web·Pi5 のみ）

- **変更概要**: `GET /api/system/dgx-resource/overview` に **`targets[]`**（`kind` / `capabilities` / `status`）。`POST …/actions` に **`EXECUTE_TARGET_ACTION`**（書き込みは **`system-prod-gateway`** のみ）。**後方互換**: `services[]`・`LOCAL_LLM_START` / `LOCAL_LLM_STOP`・`SET_POLICY`。実装分割: [`dgx-resource.control-target.types.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.control-target.types.ts) ほか。**ADR**: [`ADR-20260502-dgx-resource-control-targets.md`](../decisions/ADR-20260502-dgx-resource-control-targets.md)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-standard-control-targets infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`1e24d169`**（`refactor(dgx): introduce control targets for resource console`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-082132-17926`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**・所要 **約 610s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 79s**・Tailscale）。
- **トラブルシュート**: **Control Targets グリッドが出ない** → Pi5 **`api`/`web` の同一ブランチ**・ブラウザ **[verification-checklist.md](verification-checklist.md) §6.6.4 強制リロード**。**読取専用ターゲットへ `EXECUTE_TARGET_ACTION`** → API が **`DGX_TARGET_ACTION_NOT_SUPPORTED`**（設計どおり）。**`metrics-kpi` が常に不明** → KPI JSON が空または到達不能のときは **数値が1つも取れない限り running とみなさない**（2026-05-02 以降の実装）。**`inference-backend` WARN・gateway `/v1/models` が 502（`Connection refused`）で UI が空振り** → cold start 以外に **同一 GPU 上の ComfyUI 占有で blue vLLM が起動失敗**しうる（[KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)・Runbook 2026-05-03 節）。
- **ナレッジ**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGXリソース Phase3（補助起停・`SET_POLICY.applyWorkloadChanges`）**·`feat/dgx-resource-policy-orchestration-phase3`）

- **変更概要**: Control Target **`experiment-lab`**。`private-comfyui` / `experiment-lab` の **POST 起停**（Pi5 env の URL ペアが揃うとき）。**`SET_POLICY` + `applyWorkloadChanges`** による業務/実験モード切替時の **停止試行**。Ansible: [`api.env.j2`](../../infrastructure/ansible/templates/api.env.j2) / [`docker.env.j2`](../../infrastructure/ansible/templates/docker.env.j2) に **`DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_*`** / **`DGX_RESOURCE_EXPERIMENT_LAB_*`** / **`DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS`** を追加（空既定）。**KB**: [KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 は個別デプロイ不要**（ユーザー方針・リソース僅少で専用手順とは切り離す）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-policy-orchestration-phase3 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`a44b9f78`**（`feat(dgx): add policy-driven workload orchestration`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-094340-23537`**（**`PLAY RECAP` `ok=135` `changed=8` `failed=0` / `unreachable=0` / リモート `exit` `0`**・所要 **約 597s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **89s**・Tailscale）。
- **仕様（本番ユーザー向け要約）**: `overview.targets[]` で **`capabilities` に `start`/`stop` があるカードのみ** UI に起停。**補助 URL 未設定**なら読取のみ（後方互換）。**ワークロード調停**で POST が失敗した時点では **`policy.mode` は更新されない**（順序により一部 POST 済みの可能性あり）。
- **知見**: `update-all-clients.sh` が **両 server と clients と記載していても**、`--limit raspberrypi5` なら Pi4／Pi3 play は **`skipping: no hosts matched`** で問題なし。**正本は `PLAY RECAP` / `*.exit`**（既存 detach 運用どおり）。
- **トラブルシュート**: **補助起停ボタンが出ない** → Pi5 の `apps/api`/docker `.env` に **`_RUNTIME_START_URL` と `_STOP_URL` の両方**が入っているか（片方のみは **`overview.notes`** に警告が出て起停不可）。**`applyWorkloadChanges` が途切れる** → DGX hook が **503/502** なら **`policy.mode` は変わっていない**可能性が高い。UI は **[verification-checklist.md](verification-checklist.md) §6.6.4 強制リロード**。GPU 競合は [KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)。
- **ナレッジ**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-03: **DGXリソース Phase4（複合運用ガイド・プレビュー指紋付き実行・運用ヒント構造化）**·`feat/dgx-resource-guided-orchestration-monitoring`）

- **変更概要**: `POST /api/system/dgx-resource/actions` に **`PREVIEW_ORCHESTRATION_SCENARIO`** と **`EXECUTE_ORCHESTRATION_SCENARIO`（`planFingerprint`・`confirmed: true`）** を追加。**`EXECUTE`** は環境側のランタイム起停構成が変われば **Stale（`409 / DGX_SCENARIO_PLAN_STALE`）**。`GET /api/system/dgx-resource/overview` に **`monitoring`** を追加し、**Inference/`/v1/models` のヒント**・**競合ヒューリスティクス**・**直近ガイド失敗**などを載せて Web が **運用判断に使える短文**へ昇格させる。**後方互換**: 既存 `SET_POLICY` / `EXECUTE_TARGET_ACTION` は維持。実装モジュール: [`dgx-resource.scenario-planner.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.scenario-planner.ts)·[`dgx-resource.monitoring-overview.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.monitoring-overview.ts)。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 play は **no hosts matched**。**Pi3 は単体 Ansible 適用しない**（スクリプト上のサービス確認があるだけで、本変更のコンテナ再起動対象には含めない）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-guided-orchestration-monitoring infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ引数を `main`**）。
- **本番デプロイ（実績）**: 実装ブランチ代表コミット **`522ec93a`**（`feat(dgx): add guided orchestration monitoring`）。**`main` 取込後の正**: [PR #241](https://github.com/denkoushi/RaspberryPiSystem_002/pull/241) の **squash**（**`a2fa0510`**）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260503-102936-930`**（**`PLAY RECAP` `ok=130` `changed=4` `failed=0` / `unreachable=0` / リモート `exit` `0`**）。ローカル `update-all-clients.sh --detach --follow` のログ上 **総所要約 663s（Docker compose 再構築を含む）**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 205s**。Pi3 は **検証のみ**・**単体デプロイなし**）。
- **知見**: `--follow` が **detach 側のログに `PLAY RECAP` が見えても、`*.exit` 書き込み直後までローカルの待機ループが数秒ぶん残る**ことがある。**判断の正本**は **`PLAY RECAP` / `.exit`（`0` 期待）/`summary.json`**。Phase12 は **広域 API と Pi3 signage の疎通**も踏むため、**Pi5 だけ更新しても総所要は 200s 前後になり得る**。
- **トラブルシュート**: **`409 / DGX_SCENARIO_PLAN_STALE`** → **`PREVIEW` をやり直し**（環境側のランタイム起停構成が変わると fingerptint 変化）。**UI に monitoring が無い** → **`api`/`web` が同一ブランチ**であること・強制リロード（§6.6.4）。
- **ナレッジ**: [KB-365 §Phase 4](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-4半自動オーケストレーションoverview-運用ヒント実機反映)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **`FKOJUNST_Status` CSV 不在による外部完了（別テーブル・`manual OR external`）**·`feature/fkojunst-external-completion-b`·API+DB·Pi5 のみ）

- **変更概要**: **`ProductionScheduleExternalCompletion`** で **`FKOJUNST_Status` メール CSV にキーが無い** `S`/`R` winner を **外部完了**として保持。**`rowData.FKOJUNST` は変更しない**。一覧と同義の **S/R 対象のみ**。dedupe 後キーが **0 件**なら **外部完了同期をスキップ**（異常）。メール同期後／本体生産日程 CSV の **`PRODUCTION_SCHEDULE_DASHBOARD_ID` 取込成功後**にも **現行 Status CSV から再計算**。[`fkojunst-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts)·[`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)·[`csv-dashboard-post-ingest.service.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts)·マイグレーション **`20260502103000_add_production_schedule_external_completion`**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 不要**（Pi3 はリソース僅少・専用手順の対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/fkojunst-external-completion-b infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`a83c5439`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-215033-1769`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・所要 **約 1445s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 139s**・Tailscale）。
- **トラブルシュート**: **`Rebuild/Restart docker compose services` のあと長時間出力が止まって見える** → Pi5 側 **`docker compose` 再構築**で **数十分**になり得る。**完了判定は `PLAY RECAP` / リモート `summary.json` / `*.exit`**（`--follow` 中の **SSH 一時切断**と混同しない）。**マイグレーション**: Phase12 の **`マイグレーション状態`** が失敗なら Pi5 API ログ・`prisma migrate status`。**表示が期待とズレる**: まず [KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28) の **S/R 可視**と **キー照合**を確認し、外部完了は **CSV キー集合の有無**で決まる（**メール同期または本体 CSV 取込後の再計算**も確認）。
- **ナレッジ**: [KB-297 §外部完了（2026-05-02）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **DGX リソース `sparkHost` — Spark ホスト簡易状態の既定フォールバック（admin `LOCAL_LLM_BASE_URL` の `/healthz`）**·`fix/dgx-resource-admin-readable-typography`·API（+ Ansible env テンプレ）·Pi5 のみ）

- **変更概要**: **`DGX_RESOURCE_SPARK_HOST_STATUS_URL` 未設定時**は、Pi5 API が admin の **`LOCAL_LLM_BASE_URL`** に対して **`/healthz`** を既定フォールバックとして試行し、`overview.sparkHost` を最低限モニター可能にする（実装: [`dgx-resource.service.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.service.ts)）。あわせて Ansible の [`api.env.j2`](../../infrastructure/ansible/templates/api.env.j2) / [`docker.env.j2`](../../infrastructure/ansible/templates/docker.env.j2) で **`DGX_RESOURCE_*` を出力対象に追加**（将来の明示設定を配線しやすくする）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 不要**。  
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/dgx-resource-admin-readable-typography infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main`**）。  
- **本番デプロイ（実績）**: 代表コミット **`6c6888d6`**（`fix(api): restore DGX spark status fallback`）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-203857-20230`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**）。  
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Tailscale）。  
- **トラブルシュート**: **`Connection closed by … port 22` が `--follow` 中に一度混ざる** → `docker compose` 再起動付近の **一時切断**があり得る。**完了判定は `PLAY RECAP` / 遠隔 `summary.json` を正本**とする（[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md) の detach 運用メモと同系）。**`/api/system/dgx-resource/overview` が 401** → **未認証**（ルート生存の煙では 401 は正常）。  
- **ナレッジ**: [KB-363](../knowledge-base/KB-363-dgx-resource-spark-status-fallback.md)·[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **DGX リソース管理画面タイポ・余白改善（`/admin/tools/dgx-resource`）**·`fix/dgx-resource-admin-readable-typography`·Web のみ·Pi5 のみ）

- **変更概要**: [`apps/web/src/features/admin/dgx-resource/*.tsx`](../../apps/web/src/features/admin/dgx-resource/) で **見出し・本文・KPI・ボタン・フッター注記の文字サイズとパディング**を引き上げ。**`truncate`** の注記・`probes` 行に **`title`** を付け、ホバーで全文確認可能に。**当該コミット（`f856e2f2`）は Web のみで API 変更なし**（フォールバック等の API 変更は **別コミット `6c6888d6`** を参照）。  
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 不要**。  
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/dgx-resource-admin-readable-typography infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main`**）。  
- **本番デプロイ（実績）**: 代表コミット **`f856e2f2`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-195653-14945`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**・**`ok=130` `changed=4`**）。  
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Tailscale）。  
- **トラブルシュート**: **文字が旧のまま**: [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**・Pi5 **`web`** イメージの取り込みコミット確認。  
- **ナレッジ**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節）·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **`responseProfile=leaderboard` の `pageSize` サーバ上限制御（旧フロントキャッシュ吸収）と計測コード撤去**）

- **背景**: ブラウザが **旧 SPA バンドル**のままだと、一覧取得に **過大な `pageSize`（例 1240）** を送り、**API 応答・DB 負荷**が増える。Caddy `access.log` の `uri` に `pageSize` が残るため実害の有無を確認できる。
- **変更概要**: [`list.ts`](../../apps/api/src/routes/kiosk/production-schedule/list.ts) で **`responseProfile=leaderboard` のときだけ** `pageSize = min(requested, 900)`。**他プロファイル・既定は不変**。同時に一時調査で入れた **`127.0.0.1:7426` への `fetch` 計測**を API/Web から撤去。
- **標準コマンド**: **`main` 取込後**、本書上部の **標準手順**（`scripts/update-all-clients.sh`）・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`--detach --follow`。遅延再発のみの是正なら **`--limit raspberrypi5`** で足りる。**Pi3 は除外方針のまま**。
- **トラブルシュート**: `git pull` が **リモートの未コミット差分**で止まる → 当該ファイルの **所有権**（`cache/` 等が `root` 所有になっていないか）と **[KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)**。一時 **`git stash`** が複数ある場合は、不要なら整理して **ワークツリー clean** に戻してから Ansible を再実行。
- **ナレッジ**: [KB-297 §ページサイズ上限制御（2026-05-02）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-pagesize-server-cap-2026-05-02)。

### 補足（2026-05-02: **キオスク順位ボード 行フッター工程チップを `responseProfile=leaderboard` 一覧へ内包（progress-overview の二重取得撤去・完了ミューテーション後の invalidate 拡張）**·`feat/kiosk-leaderboard-footer-contract`·API+Web·**Pi5 のみ**）

- **変更概要**: API の **`responseProfile=leaderboard`** 一覧に **`leaderboardFooterChipsByPartKey`** を同梱。[`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)·[`leaderboard-part-footer-chip-key.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-chip-key.ts)。順位ボードページ [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) は一覧の **`leaderboardFooterChipsByPartKey`** と [`collectLeaderBoardFooterResourceChips`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts) で **`ReadonlyMap`** を構築し **`useKioskProductionScheduleProgressOverview`** を順位ボード文脈で呼ばない。[`hooks.ts`](../../apps/web/src/api/hooks.ts) **`useCompleteKioskProductionScheduleRow`** は **`history-progress` と `progress-overview`** を **`invalidateQueries`**。**Prisma マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4 は本記録では未デプロイ**（順次 1 台ずつ運用では後続ホストユーザー判断）。**Pi3 は除外**（リソース僅少・専用手順対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-footer-contract infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は** `main`）。
- **本番デプロイ（実績）**: 代表コミット **`a1be93a4`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-142341-11156`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 は **no hosts matched**）。**性能追補（同日）**: `leaderboard-part-footer-processes.service.ts` の部品キー照合を `targetKeys + matchedRows + winnerRows (DISTINCT ON)` へ見直したコミット **`1da74f2a`** を Pi5 のみへ反映（Detach **`20260502-150239-22559`**）。Pi5 localhost 実測（`pageSize=400`）は **修正前** `leaderboard` **4.28–4.81s** / `full` **1.63–1.68s** → **修正後** `leaderboard` **1.40–1.43s** / `full` **1.61–1.82s**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 127s**・Tailscale）。
- **トラブルシュート**: **チップ無し／常に軽い一覧だけ**: **`api`** が **`leaderboardFooterChipsByPartKey`** を返しているか、`**web`** が当該コミットか（**強制リロード**: [verification-checklist.md](verification-checklist.md) §6.6.4）。**完了直後のみ他画面と齟齬**: **`history-progress` / `progress-overview` のキャッシュ無効化**が Network で観察できるか。
- **ナレッジ**: [KB-297 §一覧内包契約（2026-05-02）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-footer-chips-contract-2026-05-02)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **順位ボード・行下資源チップの progress-overview 結合粒度（`productNo`+`fhincd`/部品行 `part.processes`）**·`fix/leaderboard-resource-chips-join-and-scope`·API+Web·Pi5→Pi4×4）

- **変更概要**: 進捗一覧の [**`ProgressOverviewPartRow`**](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx) で **部品行ごとの `part.processes`** チップを復元。[**`progressOverviewPresentation`**](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts) の部品行モデルと整合。**順位ボード**側は製番のみのキーではなく、**`seibanJoinKey + productNo + fhincd`** で progress-overview の **部品行**に引き、[**`collectLeaderBoardFooterResourceChips`**](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts) は **部品行スコープの `resourceProcesses`**（`KioskResourceChipData[]`）を **`ReadonlyMap` の値**として保持。[**`buildLeaderBoardPartResourceProcessKey`**](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardPartResourceProcessKey.ts) でキー正規化。API は [**`progress-overview-query.service`**](../../apps/api/src/services/production-schedule/progress-overview-query.service.ts) で部品行マップキーを **`productNo` と `fhincd` の組**に寄せ、Web の結合と一致させる。**Prisma マイグレーションなし**。テスト: [`collectLeaderBoardFooterResourceChips.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/collectLeaderBoardFooterResourceChips.test.ts) 等。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（本変更はキオスク API/Web・Pi5 コンテナが主・Pi3 のみ個別運用しない）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/leaderboard-resource-chips-join-and-scope infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`44aea2d9`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-125430-31676`**（`raspberrypi5`）/ **`20260502-130426-1173`**（`raspberrypi4`）/ **`20260502-131032-13145`**（`raspi4-robodrill01`）/ **`20260502-131507-16128`**（`raspi4-fjv60-80`）/ **`20260502-132009-12509`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**（Pi5 **`ok≈130` `changed≥4`** 規模、Pi4 はホストにより **`ok≈122–129` `changed≈9–10`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 152s**・Tailscale）。
- **トラブルシュート**: **`update-all-clients.sh` が手元で `origin/<branch>` fetch に失敗**する場合は、実行環境で **`git fetch` がネット到達できるか**（エージェント/サンドボックスのオフラーンなど）を先に確認。**チップや部品行が期待とずれる**: Pi5 **`api`/`web` の両方**が同一コミットか、順位ボードが **製番のみキー**の旧 SPA でないか（強制リロード・[`verification-checklist.md`](verification-checklist.md) §6.6.4）。**StoneBase で barcode-agent 待機 RETRYING**: [§行下辺チップ（2026-05-02）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-footer-resource-chips-2026-05-02) と同様に **完走して `failed=0`** になり得る。
- **ナレッジ**: [KB-297 §結合粒度（2026-05-02）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-resource-chips-part-key-overview-join-2026-05-02)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **キオスク順位ボード 行下辺・製番単位の資源進捗チップ帯（scheduled/unscheduled から集約）**·`fix/leaderboard-row-footer-resource-chips`·Web のみ·Pi5→Pi4×4）

- **変更概要**: 進捗一覧の集約と同趣旨で、[`useKioskProductionScheduleProgressOverview`](../../apps/web/src/api/hooks.ts) の取得データ（**`scheduled` / `unscheduled`**）から [`buildLeaderBoardFooterResourceChipsBySeiban`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts)（製番キー → **`KioskResourceChipData[]`** の `ReadonlyMap`）を [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) で **`useMemo`**。[`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx) → [`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx) へ受け渡し、[`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) **下辺**に [`KioskResourceProcessChips`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)（**`flex-nowrap`**・横スクロールラッパ）。**API / DB 変更なし**。テスト: [`collectLeaderBoardFooterResourceChips.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/collectLeaderBoardFooterResourceChips.test.ts)。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（本変更は Web のみ・Pi3 専用手順は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/leaderboard-row-footer-resource-chips infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`16911165`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-105130-11663`**（`raspberrypi5`）/ **`20260502-105758-25070`**（`raspberrypi4`）/ **`20260502-110434-28709`**（`raspi4-robodrill01`）/ **`20260502-110923-18185`**（`raspi4-fjv60-80`）/ **`20260502-111424-3838`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**（Pi5 **`ok=130` `changed=4`**、Pi4 はホストにより **`ok≈122–129` `changed≈9–10`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 130s**・Tailscale）。
- **トラブルシュート**: 行下のチップが出ない・旧 UI → [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**・Pi5 **`web`** と各 Pi4 **`kiosk-browser`** の取り込みブランチ／**`deploy-status`**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §行下辺資源チップ](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-footer-resource-chips-2026-05-02)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **キオスク順位ボード製番左縁アクセント（フィルタ空でも安定色）／進捗一覧製番カードの資源CD集約チップ帯**·`feat/kiosk-seiban-accent-and-progress-resource-strip`·Web のみ·Pi5→Pi4×4）

- **変更概要**: [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) で **`activeQueries` が空でも**有効製番には **製番ハッシュ由来の左縁アクセント**を付与（**製番ブランクのみ** `undefined`）。[`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx) の `activeSeibanFilters` と整合。**進捗一覧**: [`collectAggregatedProgressOverviewResourceProcesses.ts`](../../apps/web/src/features/kiosk/productionSchedule/collectAggregatedProgressOverviewResourceProcesses.ts) で製番カード内の **`resourceProcesses` を AND 完了**で集約し **`resourceCd` 昇順**・安定 **`rowId`**・型は **features で定義**（components への型逆流を回避）。[`ProgressOverviewSeibanCard.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewSeibanCard.tsx) ヘッダ直下に **`KioskResourceProcessChips`** で集約チップ帯。テスト: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)·[`collectAggregatedProgressOverviewResourceProcesses.test.ts`](../../apps/web/src/features/kiosk/productionSchedule/__tests__/collectAggregatedProgressOverviewResourceProcesses.test.ts)。**API / DB 変更なし**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（ユーザー指定運用／リソース僅少のため本記録でも専用手順は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-seiban-accent-and-progress-resource-strip infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`924a2ff4`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-094331-28033`**（`raspberrypi5`）/ **`20260502-094916-31090`**（`raspberrypi4`）/ **`20260502-095506-23348`**（`raspi4-robodrill01`）/ **`20260502-095947-26960`**（`raspi4-fjv60-80`）/ **`20260502-100443-16279`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**（Pi5 は Docker 再起動ログあり **`ok=130` `changed=4`** 規模、Pi4 クライアントはホストにより **`ok≈122–129` `changed≈9–10`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 114s**・Tailscale）。
- **トラブルシュート**: 見た目が旧のまま → [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**`raspi4-kensaku-stonebase01`** で **barcode-agent 待機が一時 RETRYING**しても playbook は **収束して `failed=0`** になり得る（Pi4 複合エージェント構成の過去事例と同系）。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §2026-05-02 追補](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-always-progress-resource-strip-2026-05-02)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-01: **キオスク順位ボード UX（製番視認性・納期アシスト資源進捗・左ペイン2列・行左アクセント）**·`feat/kiosk-leader-order-board-ux`·Web のみ·Pi5→Pi4×4）

- **変更概要**: 進捗一覧と共有の [`KioskResourceProcessChips.tsx`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)（[`ProgressOverviewPartRow.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx) から委譲）。納期アシスト [`LeaderBoardDueAssistPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel.tsx) に **資源進捗**列と **横スクロール**。左ペイン [`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx) **幅拡張（`w-72`）**・登録製番 **2 列グリッド**・チップ大型化。製番フィルタ時の **行左アクセント色**（[`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts)·[`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)·`ProductionScheduleLeaderOrderBoardPage`→`LeaderBoardGrid`→`LeaderOrderResourceCard`→`LeaderOrderResourceRow` へ **`activeQueries` 伝播**）。**API / DB 変更なし**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（本記録では対象外・リソース僅少のため専用手順は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leader-order-board-ux infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main`**）。
- **本番デプロイ（実績）**: 代表コミット **`84abca0b`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260501-224248-30928`**（`raspberrypi5`）/ **`20260501-224814-26947`**（`raspberrypi4`）/ **`20260501-225329-28559`**（`raspi4-robodrill01`）/ **`20260501-225740-4207`**（`raspi4-fjv60-80`）/ **`20260501-230236-8738`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**（Pi5 は Docker 再構築込みで **`ok=130` `changed=4` 規模**、Pi4 クライアントはホストにより **`ok≈129` `changed≈10`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 67s**・Tailscale）。
- **トラブルシュート**: 見た目が旧のまま → [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**・各ホスト `/opt/RaspberryPiSystem_002` の **取り込みブランチ/HEAD**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §順位ボード UX（2026-05-01）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-ux-seiban-accent-2026-05-01)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-02: **DGX リソース統合運用 Phase2（運用3プロファイル + Sparkホスト可視化）**·`feat/dgx-resource-profile-and-spark-visibility-clean`·API+Web·Pi5 のみ）

- **変更概要**: `SET_POLICY` を **`business_first` / `private_ok` / `experiment_first`** の3値へ拡張し、管理UIで **直前モードへ戻す**導線を追加。`overview` に **`policy.previousMode`** / **`kpis.policyMode`** / **`sparkHost`** を追加し、任意ENV **`DGX_RESOURCE_SPARK_HOST_STATUS_URL`** で DGX Spark ホスト簡易疎通を可視化。既存 `LOCAL_LLM_START/STOP` は互換維持。  
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**。  
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-profile-and-spark-visibility-clean infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（`main` 取り込み後は `main`）。  
- **本番デプロイ（実績）**: 代表コミット **`09b2423e`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-190642-27778`**（`PLAY RECAP` **`ok=130 changed=4 unreachable=0 failed=0`**）。  
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Tailscale）。  
- **トラブルシュート**: `--follow` が長時間停止して見える場合、`ssh "$RASPI_SERVER_HOST" "grep -A20 'PLAY RECAP' /opt/RaspberryPiSystem_002/logs/deploy/ansible-update-<RUN_ID>.log"` で **遠隔ログの RECAP** を先に確認する。`status.json` が `running` のままでも、`PLAY RECAP failed=0` を優先して判定してよい（ログ追従と状態ファイル更新がずれることがある）。  
- **ナレッジ**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節）·[docs/INDEX.md](../INDEX.md)·[docs/knowledge-base/index.md](../knowledge-base/index.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-01: **DGX リソース管理コンソール（`/admin/tools/dgx-resource`・Pi5 API 境界）**·`feature/dgx-resource-ui-phase1`·API+Web·Pi5 のみ）

- **変更概要**: Pi5 **`apps/api`** に **`/system/dgx-resource/*`**（overview / events / actions）、**`apps/web`** に管理画面 **`/admin/tools/dgx-resource`**（後方互換 **`/admin/dgx-resource`**）。DGX 本体へ直アクセスせず、Pi5 API 経由で `LOCAL_LLM_START` / `LOCAL_LLM_STOP` / `SET_POLICY` と疎通確認を集約。**停止**は **`LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS`** を使用（開始用タイムアウトとの混同を避ける）。任意 ENV: `DGX_RESOURCE_*`（[Runbook: dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**。**Pi3 は今回対象外**（リソース僅少・専用手順は別ドキュメント）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**マージ前の先行検証は** `feature/dgx-resource-ui-phase1`）。
- **本番デプロイ（実績・先行反映）**: 代表コミット **`5eb78001`**。**CI**（ブランチ push）: GitHub Actions **`25214297856`** **success**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260501-214011-6943`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**・Docker 再作成 **約 16 分規模**になり得る）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 54s**・Tailscale）。
- **トラブルシュート**: **`update-all-clients.sh` が未コミットで拒否** → **commit** するか **`git stash push -u`**（[KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)）。**管理 UI が 404**: Pi5 **`web` 再ビルド**済みか・ルート **`/admin/tools/dgx-resource`** を確認。**`/stop` がタイムアウトしやすい**: `LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS` と DGX 側の停止完了時間を確認。
- **ナレッジ**: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節）·[docs/INDEX.md](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-01: **Gmail CSV 日時字句の PowerAutomate 互換（`FKOJUNST_Status`・一般 `CsvDashboard`）**·`fix/csv-datetime-compat-powerautomate`·API のみ·Pi5 のみ）

- **変更概要**: PowerAutomate 側の出力変更で **`FKOJUNST_Status` の `FUPDTEDT`** や **一般 CsvDashboard の日付列**が **`YYYY-MM-DDTHH:mm:ss[.SSS]Z`（ISO8601）** で届く一方、従来は **`MM/DD/YYYY HH:mm:ss`**（Status）・**`YYYY/M/D H:M`（JST→UTC）**（ダッシュボード一般）のみ受理しており、**受理不能時は epoch 近傍／現在時刻フォールバック**となり **`FUPDTEDT` 最大選定**や **`occurredAt`** の鮮度が崩れ得た。**共通モジュール** [`csv-dashboard-datetime-parse.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-datetime-parse.ts) に **`parseFkojunstStatusMailFupdteDt`** / **`parseCsvDashboardDateColumnToUtc`** を集約し、[`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)·[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) に適用。**日付のみの ISO**（時刻なし）は **Status 側で拒否**。**Prisma マイグレーションなし**。テスト: [`csv-dashboard-datetime-parse.test.ts`](../../apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-datetime-parse.test.ts)·[`fkojunst-status-mail-sync.pipeline.test.ts`](../../apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.pipeline.test.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**先行反映時は** `fix/csv-datetime-compat-powerautomate`）。
- **本番デプロイ（実績）**: 代表コミット **`a9ce2f1b`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260501-141453-4379`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 26s**・Tailscale）。
- **トラブルシュート**: 一般ダッシュボードの解析失敗は API ログ **`[CsvDashboardIngestor]`** に **`dashboardId` / `dateColumnName`** 付きで **warn**。一覧の工順STが期待と違うときは **従来どおり** **`fkmail` / 可視ポリシー**（[KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)）を先に切り分け（本変更は **字句パース互換**）。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §PowerAutomate 日時互換](../knowledge-base/KB-297-kiosk-due-management-workflow.md#powerautomate-csv-datetime-compat-2026-05-01)·[csv-import-export.md](csv-import-export.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-01: **部品納期個数補助・`plannedEndDate` 字句拡張（ISO datetime 等）**·`main`·API のみ·Pi5 のみ）

- **変更概要**: 部品納期個数 CSV の **`plannedEndDate`** が多く **`YYYY-MM-DDTHH:mm:ss`（ISO datetime）** 形式で届く一方、同期パイプラインの `parsePlannedDate` が受理せず **`plannedEndDate` が null 化**され、キオスク順位ボード等で **`dueDate` 無し時の表示納期**が `-` になる不具合を修正。**ISO 日付接頭辞＋時刻**（`T`／空白）、**`YYYY/M/D`** 等を追加受理（既存 **`MM/DD/YYYY`** 系も維持）。**更新時は CSV が当該行に存在していても `plannedEndDate` が空なら既存 DB 値を維持**（着手日と同思想・`null` で上書きしない）。**Prisma マイグレーションなし**。実装: [`order-supplement-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts)·テスト: [`order-supplement-sync.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts)·バックフィル: [`backfill-order-supplement-planned-end-date.ts`](../../apps/api/src/scripts/backfill-order-supplement-planned-end-date.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（API のみ）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **本番デプロイ（実績）**: 代表コミット **`0356b304`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260501-122119-30686`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **本番デプロイ（実績・追補: 空値維持／バックフィル）**: 代表コミット **`46acf99c`**。**`main` 取り込み前**の先行反映例: `./scripts/update-all-clients.sh feat/order-supplement-planned-enddate-retain-and-backfill infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は** ブランチ引数を **`main`** に揃える）。**Detach Run ID**: **`20260501-131827-4551`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 28s**・Tailscale）。
- **デプロイ後 1 回バックフィル（既存 null の回復）**: パース／ポリシー修正を **Pi5 `api` に反映したあと**、補助用 CsvDashboard の**最新行**から `ProductionScheduleOrderSupplement` を再同期する。**本番（`api` コンテナ内・リポジトリ標準 compose）**: `docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:order-supplement-planned-end-date:prod`（**イメージに当該スクリプトの `dist` が含まれるビルド**であること）。**ローカル検証**: `pnpm --filter @raspi-system/api build` のあと `pnpm --filter @raspi-system/api backfill:order-supplement-planned-end-date`。**補足**: CSV 上も当該行の納期が**空のまま**なら、同期・バックフィル後も `null` のまま（更新は**空は既存維持**のため、元データに有効な字句が無ければ埋まらない）。
- **トラブルシュート**: **修正前に同期済みで `plannedEndDate` が既に null の行**は、**コード反映だけでは自動復旧しない**ことがある。上記 **バックフィル**、または **補助 CSV の再取込／通常スケジュール同期**で同趣旨の再同期を行う。**`backfill:…:prod` が見つからない**: API イメージの **ビルド成果物**に `dist/scripts/backfill-order-supplement-planned-end-date.js` が含まれるか確認。**字句は CSV に見えるのに DB が空**: まず **パース受理範囲**（本項の修正後 API）と **winner／3キー照合**（[KB-328](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md)）を切り分ける。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §補助 plannedEndDate 字句拡張](../knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-planned-end-date-parse-2026-05-01)·[KB-328](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

### 補足（2026-05-01: **部品納期個数 CSV 補助・着手日同期を差分反映**·`feat/order-supplement-incremental-sync`·API+DB·Pi5 のみ）

- **変更概要**: `ProductionScheduleOrderSupplement` の同期を **`deleteMany`→全件 `createMany`** から **incremental `createMany` / `update`** に変更。CSV で着手日が空のときも **既存の非 null 着手日を維持**。**`plannedStartDateManuallySet=true`** の行は **着手日を CSV 同期で上書きしない**。**`lastSeenAt`** で再出現時刻を記録。**Prisma マイグレーション**: `20260501015000_order_supplement_incremental_sync`。実装: [`order-supplement-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts)·[`order-supplement-sync.service.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.service.ts)。詳細計画: [`order-supplement-incremental-sync-execplan.md`](../plans/order-supplement-incremental-sync-execplan.md)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（API/DB のみ。Pi3 はリソース僅少のため本変更の追加対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**マージ前の検証時は** `feat/order-supplement-incremental-sync` **を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`58dfe0ee`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260501-111010-10961`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 26s**・Tailscale）。
- **トラブルシュート**: **着手日が期待と違う**: まず **補助 CSV に当該 `(ProductNo, FSIGENCD, FKOJUN)` が存在するか**・**winner 照合**・**手動フラグ**を確認。**マイグレーション失敗**: Pi5 API ログ・`prisma migrate status`。**キオスクのみ更新したつもりが API が古い**: 本変更は **Pi5 API** が正。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §着手日補助の差分同期](../knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-incremental-sync-2026-05-01)·[KB-328](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

最終更新（履歴）: 2026-04-30（**キオスク負荷調整（山崩し支援・API/Web/DB）**／**順位ボード・完了フィルタ既定を未完**／**CustomerSCAW 着手日＝製番集約（近傍選定の実害修正）**／**CustomerSCAW `FANKENYMD` 近傍選定**／**CustomerSCAW（製番→顧客名・API/順位ボード）**／2026-04-29 項は下記）／**順位ボード・Pi4 向け再レンダー抑制（order-usage 波及削減）**／**順位ボード・製番一覧パネル（UI改修・末尾削除／全解除・3列・9桁表示）**／**順位ボード・製番一覧パネル（接頭辞フィルタ・並べ替え・コントラスト・横幅）**／**順位ボード・表示中製番一覧パネル（共有履歴トグル）**／**順位ボード・備考モーダルから製番登録（共有履歴）**／**加工機日次点検 KPI（API）・カード基準統一**／**キオスク持出一覧・末尾揃え・108pxサムネ・固定外寸**／**キオスク持出一覧・貸出日時フォーマット**／**システム CSV インポートスケジュール不変条件**／**順位ボード・製番登録→進捗一覧・共有履歴同期**／**順位ボード・製番OR検索**／**端末記憶／資源CD順サーバ同期**／**順位ボード左パネル不透明化**／2026-04-28 項は下記）

### 補足（2026-04-30: **キオスク順位ボード・左ペイン完了フィルタの既定を「未完」**·`feat/kiosk-leaderboard-default-incomplete`·Web のみ·Pi5 のみ）

- **変更概要**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) の **`completionFilter`** 初期状態を **`'all'`（両方）→ `'incomplete'`（未完）** に変更。左ペイン [`LeaderBoardLeftToolStack`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx) の **両方／未完／完了** トグル表示と整合。**API / DB 変更なし**（クライアント `useState` のみ）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web` 配信）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-leaderboard-default-incomplete infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`e8d3943f`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260430-184641-30513`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 153s**・Tailscale）。
- **トラブルシュート**: **初期が「両方」のまま**: キオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）・Pi5 **`web` イメージ**が当該コミットで再ビルド済みか（`Rebuild/Restart docker compose`）を確認。**一覧が空に見える**: 仕様どおり **未完行のみ**表示のため、**「両方」**へ切り替えて完了行も表示。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §完了フィルタ既定](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-default-completion-filter-incomplete-2026-04-30)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-30: **キオスク負荷調整（山崩し支援）**·`feat/kiosk-load-balance-suggest`·API+Web+DB·Pi5→Pi4×4）

- **変更概要**: キオスク **`/kiosk/production-schedule/load-balancing`**・管理の負荷調整設定 CRUD・月次負荷 **`overview`**／サジェスト **`suggestions`** API。**Prisma マイグレーション**: `20260430124500_load_balancing_settings`。詳細は [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)·[kiosk-production-schedule-load-balancing.md](kiosk-production-schedule-load-balancing.md)。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（必須対象外・リソース僅少・専用手順は別）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-load-balance-suggest infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`d3c37b6f`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260430-131611-14988`**（`raspberrypi5`・**`ok=130` `changed=4`**）/ **`20260430-132522-19139`**（`raspberrypi4`）/ **`20260430-132943-9367`**（`raspi4-robodrill01`）/ **`20260430-133254-30349`**（`raspi4-fjv60-80`）/ **`20260430-133615-21765`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**・Tailscale）。負荷調整 API は本スクリプト未カバーのため、キオスク画面または `curl` で **`overview`/`suggestions`** のスモークを推奨（[KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)）。
- **トラブルシュート**: **マイグレーション失敗**は Pi5 の API ログ・`prisma migrate status`。**Mac／device-scope v2** で **`targetDeviceScopeKey` 未指定**は 400（他キオスク画面と同様）。**キオスクが古い**: [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。**`--follow` が SSH 切断**: リモートデタッチは完走し得る → Pi5 `logs/deploy/*.exit` で確認。
- **ナレッジ**: [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)·[kiosk-production-schedule-load-balancing.md](kiosk-production-schedule-load-balancing.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-30: **CustomerSCAW 近傍選定の着手日（製番 `MIN(plannedStartDate)`・`FANKENYMD` パース拡張）**·`fix/customer-scaw-seiban-start-date`·API のみ·Pi5→Pi4×4）

- **変更概要**: MH/SH winner 行に対する **行単位**の `ProductionScheduleOrderSupplement.plannedStartDate`（LEFT JOIN）だけでは、**MH 側に着手日が付かない**ことが多く、`FANKENYMD` 近傍選定が効かない場合があった。**製番（`FSEIBAN`）単位**に補助の `plannedStartDate` を **MIN 集約**したサブクエリを **LEFT JOIN** し、その日付で `pickCustomerNameFromCandidates` を判定。集約サブクエリのエイリアスは **`src`**（`buildMaxProductNoWinnerCondition` 内部の `r2` と衝突させない）。**`FANKENYMD`**: `2026-xx-xxT00:00:00`・`yyyy/mm/dd`・`yyyy年m月d日` 等を **タイムゾーン非依存／安全に**読めるよう `parseCustomerScawFankenymdUtcDayMs` を拡張。**Prisma マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（本変更の必須対象外・リソース僅少のため従来どおり専用手順は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/customer-scaw-seiban-start-date infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`0ca15b5c`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260430-121103-24992`**（`raspberrypi5`）/ **`20260430-122148-22710`**（`raspberrypi4`）/ **`20260430-122624-28383`**（`raspi4-robodrill01`）/ **`20260430-122940-2356`**（`raspi4-fjv60-80`）/ **`20260430-123309-8603`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**・Tailscale）。
- **トラブルシュート**: 顧客名が依然ずれる場合は **補助 CSV が当該製番に `plannedStartDate` を付けているか**（部品行にしか無いケースを集約で拾う）、**`FANKENYMD` 字句**（メール本文由来の表記ゆれ）を確認。**キオスクが古い**: [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-361](../knowledge-base/KB-361-customer-scaw-gmail-csv.md)·[csv-import-export.md](csv-import-export.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-30: **CustomerSCAW `FANKENYMD` 近傍選定（同一 `FANKENMEI`・複数顧客）**·`feat/customer-scaw-fankenymd-proximity`·API+Pi5→Pi4×4）

- **変更概要**: 同一正規化 `FANKENMEI` が複数顧客行にまたがるとき、`FANKENYMD`（UTC 日正規化）と補助 **`plannedStartDate`（着手日）** の **最短距離**で顧客を決定。**同距離**は **`FANKENYMD <= 着手日（UTC 日）`** を優先、**同率**は **CSV 走査の後勝ち**。着手日なし・有効な `FANKENYMD` なしは **後勝ち**のみ。実装: `customer-scaw-fankenymd.ts`・`customer-scaw-candidates.ts`・`customer-scaw-sync.pipeline.ts`（`ProductionScheduleOrderSupplement` **LEFT JOIN**）・`customer-scaw-dashboard.definition.ts`（任意列 **`FANKENYMD`**）。**Prisma マイグレーションなし**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（リソース僅少・本変更の必須対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/customer-scaw-fankenymd-proximity infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`8d95c2dd`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260430-104715-27689`**（`raspberrypi5`）/ **`20260430-105722-30608`**（`raspberrypi4`）/ **`20260430-110145-20682`**（`raspi4-robodrill01`）/ **`20260430-110452-23417`**（`raspi4-fjv60-80`）/ **`20260430-110808-28659`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**・Tailscale）。
- **トラブルシュート**: 顧客名が期待と異なるときは **`FANKENYMD` 列の有無・日付字句**、**補助 CSV の `plannedStartDate`**、同一機種の **複数顧客行の後勝ち** を疑う。**キオスクが古い**: [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。**`--follow` が SSH 切断**: リモートデタッチは完走し得る → Pi5 `logs/deploy/*.exit` で確認。
- **ナレッジ**: [KB-361](../knowledge-base/KB-361-customer-scaw-gmail-csv.md)·[csv-import-export.md](csv-import-export.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-30: **CustomerSCAW（製番→顧客名・生産日程一覧/順位ボード）**·`feat/customer-scaw-fseiban-customer-link`·API+Web+DB·Pi5→Pi4×4）

- **変更概要**: Gmail 件名 **`CustomerSCAW`** の CSV を固定 `CsvDashboard` で取込み、MH/SH winner の **`FHINMEI`** と **`FANKENMEI`** を正規化照合して **`ProductionScheduleFseibanCustomerScaw`** を **取込ソース単位で全置換**。生産日程一覧・`responseProfile=leaderboard` の **トップレベル `customerName`** と順位ボード行表示。**Prisma マイグレーション**あり。詳細は [KB-361](../knowledge-base/KB-361-customer-scaw-gmail-csv.md)·[`csv-import-export.md`](csv-import-export.md)。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**可能（リソース僅少・専用手順は別。本記録では未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/customer-scaw-fseiban-customer-link infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`31c7985c`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260430-092747-16`**（`raspberrypi5`）/ **`20260430-093831-8790`**（`raspberrypi4`）/ **`20260430-094303-29499`**（`raspi4-robodrill01`）/ **`20260430-094627-7368`**（`raspi4-fjv60-80`）/ **`20260430-094955-16246`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**・Tailscale）。
- **トラブルシュート**: **`customerName` が空のまま**: CSV 未到達・`FANKENMEI` と本体 `FHINMEI` の不一致・MH/SH 以外の行のみ、等。**キオスクが古い**: [verification-checklist.md](verification-checklist.md) §6.6.4 **強制リロード**。**デプロイ前 fail-fast**: [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。**`--follow` が SSH 切断**: リモートデタッチは完走し得る → Pi5 `logs/deploy/*.exit` で確認。
- **ナレッジ**: [KB-361](../knowledge-base/KB-361-customer-scaw-gmail-csv.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **Pi4 向け再レンダー抑制（order-usage 波及削減）**·`feat/kiosk-leaderboard-pi4-followup`·Web のみ·Pi5→Pi4×4）

- **変更概要**: [`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx)·[`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx)·[`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx)·[`buildLeaderBoardViewModel.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel.ts)·[`apps/web/src/api/client.ts`](../../apps/web/src/api/client.ts)（`leaderboard` コメント整合）。**15 秒 `order-usage` 更新**で UI 全体へ同一マップ参照が波及しにくいよう **資源ごとの使用順位配列**だけを下流へ渡す。**`@tanstack/react-virtual`** の行キーを **`row.id`** に固定し **overscan を抑制**、資源カード外枠の **`transition-all` は使わない**（**`transform` / `opacity` 系のみ**に寄せる）。**API 契約変更なし**。
- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 除外**（本変更は Pi3 専用（軽量）手順の対象外）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-pi4-followup infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`7902f5ac`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-214453-13263`**（`raspberrypi5`）/ **`20260429-215053-15127`**（`raspberrypi4`）/ **`20260429-215805-17537`**（`raspi4-robodrill01`）/ **`20260429-220418-1032`**（`raspi4-fjv60-80`）/ **`20260429-221048-28118`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 64s**）。
- **トラブルシュート**: **旧挙動のまま**: Pi4 キオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）・各ホスト `/opt/RaspberryPiSystem_002` の取り込みコミットが意図どおりか確認。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §Pi4 performance](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-pi4-performance-2026-04-24)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **製番一覧パネル（接頭辞UI改修・末尾削除／全解除・3列・9桁表示枠）**·`feat/leaderboard-seiban-panel-layout-and-prefix-controls`·Web のみ·Pi5 のみ）

- **変更概要**: [`LeaderBoardSeibanListPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel.tsx)・[`leaderBoardSeibanPrefixFilterActions.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSeibanPrefixFilterActions.ts)。**接頭辞表示**は **最大9桁相当の固定幅**（表示用パディング・フィルタ値は従来どおり）。**末尾削除**・**全解除**を **表示欄と次文字ボタン群の間**に配置し、文字ボタン行は **境界線で区切り**。一覧カードは **`sm` 以上で3列**。共有履歴登録済みカードは **グレーアウト表現**。**API 契約変更なし**。Vitest: [`LeaderBoardSeibanListPanel.test.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/LeaderBoardSeibanListPanel.test.tsx)·[`leaderBoardSeibanPrefixFilterActions.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/leaderBoardSeibanPrefixFilterActions.test.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-panel-layout-and-prefix-controls infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`74d360b6`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-210617-3239`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 139s**・Tailscale）。
- **トラブルシュート**: **接頭辞が9桁で伸びない**: **仕様どおり最大9桁**で charset 追加は無効化。**一覧が古い**: キオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §製番一覧パネル](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **製番一覧パネル（接頭辞フィルタ・共有履歴優先ソート・コントラスト・横幅）**·`feat/leaderboard-seiban-panel-prefix-filter`·Web のみ·Pi5 のみ）

- **変更概要**: [`LeaderBoardSeibanListPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel.tsx) で **パネル横幅を約2倍**（`w-[min(100vw,84rem)]`）、**共有履歴登録済み製番を一覧先頭**に並べ替え（[`sortVisibleSeibanEntriesForDisplay.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/sortVisibleSeibanEntriesForDisplay.ts)）、**登録済み／未登録の視認性**を背景・枠・文字色で強調。**接頭辞フィルタ**: 表示製番から **現在の接頭辞に続けられる次の文字**のみをボタン表示（[`collectSeibanPrefixCharset.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectSeibanPrefixCharset.ts) の **`collectNextPrefixChars`**）、押下で **`startsWith`** により段階的に絞り込み、**解除**でリセット。**API 契約変更なし**。Vitest: [`LeaderBoardSeibanListPanel.test.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/LeaderBoardSeibanListPanel.test.tsx)·[`collectSeibanPrefixCharset.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/collectSeibanPrefixCharset.test.ts)·[`sortVisibleSeibanEntriesForDisplay.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/sortVisibleSeibanEntriesForDisplay.test.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-panel-prefix-filter infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`900cb141`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-202355-27582`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 106s**・Tailscale）。
- **トラブルシュート**: **接頭辞ボタンが期待と違う**: **次に続けられる文字だけ**が出る設計（無効な深化はボタンから除外）。**一覧が古い**: キオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §製番一覧パネル追補](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **表示中製番一覧パネル（共有履歴トグル）**·`feat/leaderboard-seiban-list-panel`·Web のみ·Pi5 のみ）

- **変更概要**: 左パネル「製番検索」行に **「製番一覧」** を追加し、右半画面オーバーレイ [`LeaderBoardSeibanListPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel.tsx) で **`sortedGrouped` 由来の製番を一意に一覧**（[`deriveVisibleSeibanEntries.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/deriveVisibleSeibanEntries.ts)）。各行は **製番＋機種名の2行ボタン**・共有履歴に載っている製番はグレーアウト表示。**押下で登録／再押下で解除**は [`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts) の **`toggleSeibanInSharedHistory`**（**`PUT …/search-state`** 経由・既存 **`useKioskSharedSearchHistoryActions`** と同一契約）。**API 契約変更なし**。Vitest: [`LeaderBoardSeibanListPanel.test.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/LeaderBoardSeibanListPanel.test.tsx)·[`deriveVisibleSeibanEntries.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/deriveVisibleSeibanEntries.test.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-list-panel infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`f544a45c`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-193317-26767`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・所要 **約 436s**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 88s**・Tailscale）。
- **トラブルシュート**: **一覧が空**: 順位ボードに **表示中行が無い**／完了フィルタで絞り込み済み。**ボタンが無効**: **`dueAssist.historyWriting`**（共有履歴書き込み中）。**解除できない**: Network で **`PUT …/search-state`** の **`409`/`428`**。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §製番一覧パネル](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **備考モーダルから製番登録（共有履歴）**·`feat/leaderboard-seiban-register-modal-close`·Web のみ·Pi5 のみ）

- **変更概要**: [`KioskNoteModal.tsx`](../../apps/web/src/components/kiosk/KioskNoteModal.tsx) に任意の小型 **`extraAction`**（ラベル・`onClick`・`disabled`）。順位ボード [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) の備考（鉛筆）モーダルに **「製番登録」** を配置し、押下で当該行の **`fseiban`** を共有製番履歴（**`PUT …/search-state`**、`useKioskSharedSearchHistoryActions`）へ **`registerSeibanToSharedHistory`** 経由で追加し、成功時は **`closeNoteModal()`** でモーダルを閉じる（この操作だけでは備考本文は保存しない）。**API 契約変更なし**。Vitest: [`KioskNoteModal.test.tsx`](../../apps/web/src/components/kiosk/KioskNoteModal.test.tsx)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-register-modal-close infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`a3265139`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-184211-20335`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・所要 **約 405s**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 90s**・Tailscale）。
- **トラブルシュート**: **`製番登録` が無効のまま**: `dueAssist.historyWriting` が **`true`**（共有履歴書き込み中）。**押しても閉じない**: **`PUT …/search-state`**（If-Match）が失敗した場合はモーダルを開いたまま（実装どおり）。**UI が古い**: キオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）。デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §備考モーダル製番登録](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-note-modal-seiban-register-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: 加工機日次点検 **KPI（点検済/未点検）とカードの基準統一**·`fix/uninspected-kpi-card-alignment`·API のみ·Pi5 のみ）

- **変更概要**: [`daily-inspection-kpi.ts`](../../apps/api/src/services/tools/daily-inspection-kpi.ts)（`isDailyInspectionKpiInspected`）で「点検済」をカード（正常/異常の青・赤）と同一基準に。[`machine.service.ts`](../../apps/api/src/services/tools/machine.service.ts) の `inspectedRunningCount` / `uninspectedCount`、`findUninspected` の一覧条件を統一（テスト: `daily-inspection-kpi.test.ts`·`machine.service.test.ts`）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（本変更は **API のみ**。Pi3 はリソース僅少のため従来どおり **専用手順**・対象外のときは触れない）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/uninspected-kpi-card-alignment infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`48cfb6c2`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-174518-6203`**（**`PLAY RECAP` `failed=0` / `unreachable=0`**・Pi4/Pi3 play は **no hosts matched**）。**`--follow` が Docker 再作成付近で SSH タイムアウトしても、リモートデタッチは継続**。終了確認は **`scripts/deploy/read-detach-exit-*.sh`** で Pi5 の **`*.exit` が `0`** を確認（詳細 [KB-360](../knowledge-base/api.md#kb-360-加工機点検状況のkpiをカード配色基準と統一正常異常件数)）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **ナレッジ**: [KB-360](../knowledge-base/api.md#kb-360-加工機点検状況のkpiをカード配色基準と統一正常異常件数)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク持出一覧 **本文末尾揃え・サムネ1.5倍・カード外寸固定**·`feat/kiosk-active-loan-card-right-align-thumb-15x-fixed-size`·Web のみ·Pi5 のみ）

- **変更概要**: [`kioskActiveLoanCardLayout.ts`](../../apps/web/src/components/kiosk/kioskActiveLoanCardLayout.ts) で寸法・整列トークンを分離（色トークンは既存のまま）。**サムネ** 歴史ベース 72px の **1.5 倍 → 108px**。本文全体 **`text-end`**（論理末尾揃え）。カード **`min-h-[248px] h-[248px]`** で外寸固定、`overflow-hidden`。一覧 [`KioskReturnPage.tsx`](../../apps/web/src/pages/kiosk/KioskReturnPage.tsx) に **`[&>li]:min-w-0`**（狭列での横あふれ抑制）。[`KioskActiveLoanCard.tsx`](../../apps/web/src/components/kiosk/KioskActiveLoanCard.tsx)·Vitest。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-active-loan-card-right-align-thumb-15x-fixed-size infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`d1c6abe7`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-163457-5210`**（**`PLAY RECAP` `failed=0` / `unreachable=0`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。見た目が変わらないときはキオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）。
- **ナレッジ**: [KB-323](../knowledge-base/KB-323-kiosk-return-card-button-layout.md)（追補）·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク持出一覧 **貸出日時（秒なし・24時間制・Asia/Tokyo）**·`feat/kiosk-active-loan-borrowed-at-format`·Web のみ·Pi5 のみ）

- **変更概要**: `KioskReturnPage` の貸出日時を **`Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', … hour12: false })`** で **`formatKioskActiveLoanBorrowedAt`** に集約。**秒なし**・**午前/午後なし**。`Invalid Date` は **`—`**（部品測定の下書き日時整形と同系）。実装: [`formatKioskActiveLoanBorrowedAt.ts`](../../apps/web/src/features/kiosk/formatKioskActiveLoanBorrowedAt.ts)・Vitest。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-active-loan-borrowed-at-format infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`5d83816f`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-151939-18182`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（**WARN**: `raspi4-kensaku-stonebase01` への Pi5 経由 SSH は既存ベースラインと同型。**FAIL 0**）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。見た目が変わらないときはキオスクで **強制リロード**（[`verification-checklist.md`](verification-checklist.md) §6.6.4）。
- **ナレッジ**: [KB-323](../knowledge-base/KB-323-kiosk-return-card-button-layout.md)（追補）·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **製番登録と進捗一覧の共有履歴同期**·`fix/leaderboard-seiban-registration-sync`·Web のみ·Pi5 のみ）

- **変更概要**: 順位ボードで製番フィルタを ON にしたとき **サーバ共有の製番履歴（search-state）へ未登録なら先に `addSeibanToHistory`**。共有状態取得成功後の **初回ハイドレート**で、ローカル復元のみに残った製番を **順にサーバ登録**し、進捗一覧クエリ（**`kiosk-production-schedule-progress-overview`**）を **共有履歴書き込み成功後に invalidate**。進捗一覧 UI は **`scheduled` と `unscheduled`** の製番をカード／フィルタ候補に反映。**API 契約変更なし**（Web のみ）。純粋ゲート: [`leaderBoardSharedHistoryGate.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSharedHistoryGate.ts)（Vitest あり）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（キオスク SPA は Pi5 `web`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/leaderboard-seiban-registration-sync infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`b4afb2d7`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-143937-21499`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・サマリ **`Summary success check: true`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Tailscale）。
- **トラブルシュート**: **共有履歴取得が遅い／一度だけ成功しない**ときは **フィルタ剪定が再実行されるよう `sharedHistory` を effect 依存に含める**設計。**進捗一覧に製番が出ない**ときは **`GET …/search-state`** の製番集合と **`GET …/progress-overview`** の **`scheduled`/`unscheduled`** を突き合わせる（製番レベル納期なしは **`unscheduled`** 側）。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §製番登録と進捗一覧同期](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leaderboard-progress-overview-shared-history-sync-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: **システム固定 CSV インポートスケジュール** 更新の **不変条件**・有効 **cron 保持**·`feat/csv-import-system-schedule-preserve-cron`·API+管理 Web·Pi5 のみ）

- **変更概要**: 固定 ID の Gmail 系スケジュール（FKOJUNST / FKOBAINO / 製番補完 等）を管理画面で編集したとき、**有効な cron は保持**しつつ **`provider` / `targets` / `replaceExisting` 等はレジストリどおり矯正**。無効 cron・最短間隔違反は **既定へ**。実装の正本: [`system-csv-import-schedule-invariants.ts`](../../apps/api/src/services/imports/system-csv-import-schedule-invariants.ts)·[`import-schedule-admin.service.ts`](../../apps/api/src/services/imports/import-schedule-admin.service.ts)。管理 UI は [`CsvImportSchedulePage.tsx`](../../apps/web/src/pages/admin/CsvImportSchedulePage.tsx) の **`startEdit`** で **`scheduleMode`** を **`parsed.mode`** に合わせる。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 不要**。**Pi3 のみが対象のときは** Pi3 専用（軽量）手順（今回は未実施）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/csv-import-system-schedule-preserve-cron infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`e4e862a4`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-133724-8769`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・所要 **約 938s**・**Docker 再ビルド**・Pi4/Pi3 play は **no hosts matched**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 23s**・Tailscale）。
- **トラブルシュート**: CI で `imports-schedule.integration.test.ts` が旧仕様（cron を常にデフォルトへ）を期待すると失敗 → 応答の **有効 cron 保持**に期待値を合わせる。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [csv-import-export.md](./csv-import-export.md)（システム行の保存仕様）·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **製番チップ・複数選択（OR）・全解除**·`feat/leaderboard-seiban-multiselect-or-clear`·Web のみ·Pi5 のみ）

- **変更概要**: 左パネル登録済み製番を **クリックで OR 検索トグル**（再クリックで解除）。複数選択時は一覧の **`activeQueries`**（`GET` の **`q`** はカンマ区切りで OR と既存クエリ構築と整合）へ同期。**「製番OR検索を全解除」** は **`activeQueries` のみクリア**（履歴チップ削除・研削/切削など他条件はそのまま）。納期アシストの **詳細表示対象**は `selectedFseiban` と分離。純粋モデル: [`leaderBoardSeibanFilterModel.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSeibanFilterModel.ts)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**（SPA は Pi5 `web`）。**Pi3 が対象となる場合のみ**、`deployment.md` の **Pi3 専用（軽量）手順**に従う。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-multiselect-or-clear infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` に取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`d26b50d3`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-123438-30137`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・所要 **約 348s**・**Docker 再ビルド**含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 23s**・Tailscale）。
- **トラブルシュート**: 共有 search-state 取得前に **履歴に無い製番だけ OR フィルタに残る**と見える場合は **ページ再読込**（`searchStateQuery.isSuccess` 後にフィルタを履歴で剪定）。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §製番OR検索](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-or-filter-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク順位ボード **端末スコープ永続・資源CD順の共有・製番フィルタ**·`feat/kiosk-leaderboard-device-memory-and-slot-sync`·Web のみ·Pi5 のみ）

- **変更概要**: **`deviceScopeKey`** を localStorage に保持して復元。**資源スロット並び**は既存 `GET/PUT …/manual-order-resource-assignments` の **`resourceCds` の順序** と同期（デバウンス PUT）。**スロット本数は端末ローカル**。製番選択と **`activeQueries`** の単一製番フィルタを連動。詳細は [KB-297 の該当節](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-device-and-slot-sync-2026-04-29)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4/Pi3 個別不要**。**複数台デプロイ時はホスト単位で `--limit` を 1 台ずつ**。**Pi3 単独は資源が僅少のため、本 playbook の縮小運用または deployment.md にある Pi3 専用手順が正**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-leaderboard-device-memory-and-slot-sync infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`ba2e8da8`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-114156-3453`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130`**・所要 **約 928s**・**Docker 再ビルド**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 24s**・Tailscale）。
- **トラブルシュート**: PUT とサーバ側マージの競合、`activeQueries` と製番選択の **`ref`** 監視、`selectedResourceCd` の無効化は [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md)。デプロイ前 fail-fast は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。
- **ナレッジ**: [KB-297 §状態永続・同期](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-device-and-slot-sync-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-29: キオスク **順位ボード左スタック・納期アシスト不透明背景**·`fix/kiosk-leaderboard-left-panel-opaque-bg`·Web のみ·Pi5 のみ）

- **変更概要**: 左端ホバーで開く **操作パネル**（[`LeaderBoardLeftToolStack`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx)）の `aside` を **`bg-slate-950/98` → `bg-slate-950`**、製番検索内枠を **`bg-white/5` → `bg-slate-900`**。**第2シート** [`LeaderBoardDueAssistPanel`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel.tsx) は **`bg-slate-900/95 backdrop-blur-md` → `bg-slate-900`**（ぼかし撤去）・sticky 見出しも不透明に。背後のページ装飾グラデが透けないよう可読性優先。**API/DB 変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 不要**（キオスク SPA は Pi5 `web` 配信）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/kiosk-leaderboard-left-panel-opaque-bg infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`93e111c3`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-212925-25339`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・サマリ **`Summary success check: true`**・所要 **約 6 分**・**Docker 再ビルド**含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 151s**・Tailscale）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。見た目が変わらないときは **キャッシュ**・Pi5 **`web` イメージ再ビルド**・[`KB-297 §左パネル不透明化`](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-opaque-left-panel-2026-04-29)。
- **ナレッジ**: [KB-297（不透明化節）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-opaque-left-panel-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: 写真持出 **初見1回目 VLM 厳格化**·`feat/photo-label-firstpass-precision-tuning`·API のみ·Pi5 のみ）

- **変更概要**: 初見1回目（`FIRST_PASS_VLM`）向けに **厳格プロンプト**・**リクエスト単位の `maxTokens` / `temperature`**（`VisionCompletionInput` 上書き）・**厳格正規化**（句読点・説明混入の抑制）を **`PHOTO_TOOL_LABEL_FIRST_PASS_STRICT_MODE=true`** で有効化可能にした。シャドー／アクティブ補助の2回目は従来どおり **`INFERENCE_PHOTO_LABEL_VISION_*`**。Ansible `docker.env.j2` / `inventory.yml` に **`PHOTO_TOOL_LABEL_FIRST_PASS_*`** を配線（未設定時は **strict OFF**・既存挙動維持）。**DB マイグレーションなし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**当時の feature 取り込みは** `feat/photo-label-firstpass-precision-tuning` **相当**）。
- **本番デプロイ（実績）**: 代表コミット **`3e21b007`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-203203-20465`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=134` `changed=7`**・サマリ **`Summary success check: true`**・所要 **約 15 分規模**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 253s**・Tailscale）。**手順前の到達確認**: 初回実行で **`エラー: Pi5に到達できません`** となる場合がある（`100.106.158.2` への **ICMP が一時的に失敗**し得る）。**`ping` 成功を確認してから再実行**、または **`ssh denkon5sd02@100.106.158.2`** で到達を確認（スクリプト側は **ping 5 回リトライ**）。
- **運用**: vault で **`vault_photo_tool_label_first_pass_strict_mode: "true"`** 等を設定したうえで **同手順デプロイ**すると本番で厳格モード ON（詳細は [photo-loan.md](../modules/tools/photo-loan.md)・[KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: 生産日程 **`responseProfile=leaderboard` で `resolvedMachineName` 付与**·`feat/kiosk-leaderboard-machine-name-enrich`·API のみ·Pi5 のみ）

- **変更概要**: キオスク順位ボードは一覧を **`leaderboard`** で取得するが、従来は **`resolvedMachineName` を常に null** にしてカードの機種名が欠落していた。**`listProductionScheduleRows`** の `leaderboard` 分岐で **`enrichProductionScheduleRowsWithResolvedMachineName`** を実行し、`full` と同一のバッチ解決で表示名を付与。**`actualPerPieceMinutes` は引き続き null**（actual-hours 読み込みは省略）。**DB マイグレーションなし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 不要**（**Web 変更なし**・API は Pi5）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-leaderboard-machine-name-enrich infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`e0305c8e`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-192136-21236`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・**`ok=130` `changed=4`**・サマリ **`Summary success check: true`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 167s**・Tailscale）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。順位ボードで機種名が空のときは **`GET /api/kiosk/production-schedule?...&responseProfile=leaderboard`** の各行 **`resolvedMachineName`** と [KB-350](../knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md) の解決順を確認。
- **ナレッジ**: [KB-350 追補（2026-04-28）](../knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md)·[KB-297（順位ボード）](../knowledge-base/KB-297-kiosk-due-management-workflow.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: 生産日程 **一覧** FKOJUNST **S/R のみ**可視·`fkmail` 優先·`fkmail` 非 S/R は `fkst` 不救済·`feat/production-schedule-fkojunst-sr-only-list`·API のみ·Pi5 のみ）

- **変更概要**: 生産日程一覧（COUNT/明細）の可視条件を **`apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts`** に集約。**`ProductionScheduleFkojunstMailStatus`（`fkmail`）が `S`/`R`** の行は **`rowData.FKOJUNST` をメール値**。**`fkmail` 行が無い** winner は **`ProductionScheduleFkojunstStatus`（`fkst`）が `S`/`R` のときのみ**残す。**`fkmail` はあるが `S`/`R` でない** winner は **非表示**（**`fkst` が `S`/`R` でも表示しない**）。COUNT 用クエリも **`fkst` を JOIN** し、明細と同一条件。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 不要**（**DB マイグレーション無し**・API のみ）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/production-schedule-fkojunst-sr-only-list infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`06e62912`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-181153-28174`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 1372s**・**Docker 再ビルド**を含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **272s**・Tailscale）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。一覧が薄い／空に見える場合は **`fkmail` / `fkst` の `S`/`R` と「メールあり非 S/R は `fkst` で救わない」**を確認（[KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)）。
- **ナレッジ**: [KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: 生産日程 FKOJUNST_Status Gmail 取込・一覧の S/R 表示／非 S/R 行除外·`feature/fkojunst-status-gmail-route`·API+DB·Pi5 のみ）

- **変更概要**: Gmail 件名 **`FKOJUNST_Status`** の CSV を専用 `CsvDashboard`（固定 ID **`b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`**）へ取込み、同一キーは **`FUPDTEDT` 最大**を正とする同期で **`ProductionScheduleFkojunstMailStatus`** に winner 行へ反映。生産日程一覧 API は **`LEFT JOIN`** し、メール側が **`S`/`R`** のときだけ `rowData.FKOJUNST` をメール値とし、メール側が **`S`/`R` 以外で行が存在する**ときは **一覧から行除外**（**COUNT と明細で同一**）。旧 `FKOJUNST` ルートの **`ProductionScheduleFkojunstStatus`** とは別系統（併存時はメール側優先）。**Prisma マイグレーション**: `20260428130000_add_production_schedule_fkojunst_mail_status`。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 個別デプロイ不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/fkojunst-status-gmail-route infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は `main` を指定**）。
- **本番デプロイ（実績）**: 代表コミット **`df90caf4`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-145623-7353`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 13 分**・**Docker 再起動**を含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **62s**）。
- **運用**: 固定 **`csv-import-productionschedule-fkojunst-status-mail`**（cron **`5 1 * * *`**・既定 **`enabled: false`**・`targets` は **`b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`** へ強制）・**削除は 400**。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。一覧が期待と違う場合は **キー3項目が本体 winner と一致しているか**・同期ログ **`[ProductionScheduleFkojunstMailStatusSyncService]`**・**`skippedUnparseableDate` / `skippedInvalidStatus` / `unmatched`** を確認。
- **ナレッジ**: [KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: パレット可視化ボード サイネJPEG v3（プレビュー準拠）·`feature/pallet-board-signage-density-v3`·API のみ·Pi5 のみ）

- **変更概要**: `pallet-board-single-layout.ts` に **`renderDenseItemBlock`**（ヒント → **品番＋品名を同一行**（右 `text-anchor="end"`）→ **メタ一行**：製番プレーン・着手日 **オレンジ系バッジ**・個数は **ティール系プレーンテキスト**）。**`primaryItem` + `secondaryItem`** 時は **左右分割ではなく縦2段**＋**横破線**（破線の向きは水平）。**`palletBoardSignageColor.metaPlainTeal` / `metaSeparatorMuted`** を追加。ミニ一覧（`pallet-board-multi-layout.ts`）は **配色・本文サイズ係数のみ**微調整（細密レイアウトはシングル系と非共有）。静プレビュー: [`docs/design-previews/pallet-board-teal-dual-vertical-preview.html`](../design-previews/pallet-board-teal-dual-vertical-preview.html)。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 個別は不要**（JPEG は Pi5 `api` が生成）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/pallet-board-signage-density-v3 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: 代表コミット **`4b325c01`**（レイアウト）＋ **`7e300e74`**（上記プレビュー HTML 追跡）。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-103644-15464`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 539s**・**Docker `api` 再ビルド**を含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 31s**・Tailscale）。
- **手動目視（推奨）**: 管理 **`/admin/signage/preview`**（端末 **`x-client-key`** 指定可）で **2品（`secondaryItem`）** が **縦段**になっていること・メタ行の **日付バッジ／個数プレーン**の位置を確認。反映が古い場合は端末の **画像キャッシュ/更新間隔**（[modules/signage/README.md](../modules/signage/README.md)）。
- **知見**: 着手日用バッジは **`badgeRectSvgAnchoredLeft`**。旧 **右上の個数バッジ**は廃止（個数はメタ行へ）。Vitest の **「末尾4 `<text x=` 同一」** は同一行2要素のため **不適切** → **構造ベースの検証に置換**（`pallet-board-single-layout.test.ts`）。
- **トラブルシュート**: デプロイ前 **未追跡・未コミット**で **fail-fast** する場合は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [api.md KB-355（v3 追補）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: パレット可視化サイネJPEG v3 追随修正·`287c959e`·`main`·API のみ·Pi5 のみ）

- **変更概要**: `fix(api): pallet signage machine-type hint, single typo in dual strip`（**`287c959e`**）。機種ヒント行のソース整理（FHIN/MH/SH と `machineNameDisplay`〜FHINMEI の優先順）。密着ヒント文字列について **`ellipsizeToMaxChars` の結果にさらに `…` を足さない**ようにし、省略記号の二重付けを解消。**`renderOccupiedDual`** で **`slotTypo(innerH)` を一度だけ算出**して縦デュアル帯と **`splitY`（横破線）** を参照し、未定義になる描画異常を解消。**DB/API 契約変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 個別不要**。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-114616-12424`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 564s**・**Rebuild/Restart docker compose services**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**・Tailscale）。
- **トラブルシュート**: デプロイ前 **未コミット/未追跡** は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) と同様。
- **ナレッジ**: [api.md KB-355（追随fix 追補）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: サイネJPEG プレビュー整合·`feat/pallet-board-signage-preview-parity`·APIのみ·Pi5のみ）

- **変更概要**: コミット **`158ae8fe`**。**密着 FHINCD/品名行**を **`DENSE_FHINC_FHINMEI_FONT_PX`（14px）** で静的プレビュー [`pallet-board-teal-dual-vertical-preview.html`](../design-previews/pallet-board-teal-dual-vertical-preview.html) に合わせる。**2件時仕切り**は **`stroke-width` 強化・`stroke-dasharray`/`stroke-linecap`**、`DUAL_STRIP_SEP_STROKE`。プレビュー HTML はヒント／メタ行の色、`meta-sep` 撤去 **`column-gap`**、`.sep` 太線、`--dash-border` など。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/pallet-board-signage-preview-parity infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-125721-24544`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・所要 **約 620s**・**Rebuild/Restart docker compose services**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **27s**・Tailscale）。
- **ナレッジ**: [api.md KB-355（preview parity 追補）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。**`main` 取り込み**: PR でマージ（本記録時点）。

### 補足（2026-04-28: パレット可視化ボード サイネージJPEG ティール系レイアウト·`feature/pallet-board-teal-svg-v2`·API のみ·Pi5 のみ）

- **変更概要**: `PalletBoardRenderer` の **SVG/JPEG** をティール基調へ刷新（**`pallet-board-appearance`** で MD3 トークン上書き）。**単一機**レイアウトで **左ペイン簡素化・4列グリッド**、スロットは **空／単品／同一パレット2品（`primaryItem` + `secondaryItem`・`displayOrder` 順）** を描画。**複数機**レイアウトも配色・列数整合（`PALLET_SIGNAGE_GRID_COLS`）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3/Pi4 個別は不要**（表示端末は `GET /api/signage/current-image` のみで、**JPEG は Pi5 `api` が生成**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/pallet-board-teal-svg-v2 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feature/pallet-board-teal-svg-v2`**・代表コミット **`354f927a`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260428-093626-27554`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 630s**・**Docker `api` 再ビルド**を含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 38s**・Tailscale）。
- **手動目視（推奨）**: 管理 **`/admin/signage/preview`**（端末 **`x-client-key`** 指定可）で **パレット可視化**スケジュールの **JPEG** がティール系UI意図どおりか。反映が古い場合は端末の **画像キャッシュ/更新間隔**（[modules/signage/README.md](../modules/signage/README.md)）。
- **知見**: テーマや配色は **`mergeMd3TokensForPalletBoardSignage`** に寄せるとレイアウト関数と変更理由が分離しやすい。
- **トラブルシュート**: デプロイ前 **未追跡ファイル**で **fail-fast** する場合は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [api.md KB-355 追補（2026-04-28）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-28: VLM 画像 400 追加対策 `main`（PR #204 / PR #205）· 400 真因分類·ストレージ一括プローブ）

- **仕様要約（API）**: PR [#204](https://github.com/denkoushi/RaspberryPiSystem_002/pull/204)（VLM 400 再試行・`openai-chat-response` 共通化 等）に続き、PR [#205](https://github.com/denkoushi/RaspberryPiSystem_002/pull/205) では **`isRetryableVlmImageHttp400` の拡張**、**大きさ由来の 400 でも再送**、**`reencodeImageBufferForVlmFallback` の `maxEdge` / `quality` 等**を反映（詳細は PR / `vision-vlm-fallback`・`routed-vision-completion` 周辺テストを参照）。
- **知見（真因分類）**: 観測した **400** は単一の常設バグではなく、**入力条件依存**。**応答 body** 例: **(1) コンテキスト超過**（`Input length … exceeds … maximum context length`）、**(2) 画像デコード失敗**（`Failed to load image: cannot identify image file` 等）。**Pi5 保存画像 531 件**を本リポの `probe-photo-label-vlm.py` 相当手順で**一括**したところ**全件 HTTP 200**（当該母集団では 400 再現は出ず）。巨大・**意図的破損**画像では 400 を再現可能。
- **トラブルシュート（到達経路）**: DGX 入口へ **Mac 直 HTTP** すると **timeout** になり得る。検証は **Pi5 経由**（例: SSH トンネルで **`127.0.0.1:38081`** へ中継）が現実的なことが多い（[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)「トラブルシューティング補足」）。**長時間の `-L` トンネル**は **SSH セッション断**（例: `exit 255` / `Connection reset by peer`）で落ち得るため、**再接続して張り直す**。
- **本番追従**: 当時点の本番 **Pi5 API** は、当該差分取り込み後は従来どおり **`update-all-clients.sh main … --limit raspberrypi5`**（[deployment.md](./deployment.md) 他項・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress）で正本。

### 補足（2026-04-27: VLM 画像 400 再送・OpenAI 応答抽出共通化・`feat/dgx-blue-vlm400-hardening`・Pi5 のみ）

- **変更概要**: ブランチ **`feat/dgx-blue-vlm400-hardening`**（代表コミット **`d962afa3`**）。VLM 上流が画像ペイロードを拒否（HTTP 400 相当）する場合に **JPEG 再エンコード後の最大 1 回再送**、OpenAI 互レスポンスのテキスト抽出を **`message.content` → `reasoning` / `reasoning_content` 等へフォールバック**する共通化。**DGX の本番方針**（既定は green）と **実機が green/blue か**は別。方針は [ADR-20260428](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)、実機は **`POST /start` / `GET /v1/models`** で確認。
- **対象ホスト（本記録）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 / Pi4 個別デプロイは本変更の必須対象外**（従来どおり API は Pi5）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/dgx-blue-vlm400-hardening infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: **Detach Run ID**（`ansible-update-`）: **`20260427-205257-20823`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 738s**（**`Rebuild/Restart docker compose services`** を含む））。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 96s**・Tailscale・Pi5 `100.106.158.2`）。
- **トラブルシュート**: 400 が続く場合は **元画像**・**上流 VLM の制限**を確認。本アダプタは **再送は最大 1 回**（`routed-vision-completion`）。デプロイ前 **未追跡ファイル**は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [ADR-20260427](../decisions/ADR-20260427-blue-llm-runtime-stop-policy.md)・[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

### 補足（2026-04-27: PR #203 マージ後の Pi5 正規追従・`main`・`runtime_stop_policy` / DGX ドキュメント同梱）

- **変更概要**: [#203](https://github.com/denkoushi/RaspberryPiSystem_002/pull/203) を `main` にマージ（マージコミット **`e97c7941`**）。含む: `scripts/dgx-local-llm-system/runtime_stop_policy.py`・`control-server.py` 更新・[ADR-20260427](../decisions/ADR-20260427-blue-llm-runtime-stop-policy.md)・Runbook/KB/INDEX 追補。
- **対象ホスト（本記録）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。DGX ホスト上のファイル配置は [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md) / [KB-357](../knowledge-base/infrastructure/security.md)（inventory 外作業）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: **Detach Run ID**（`ansible-update-`）: **`20260427-201319-30682`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 202s**（**Docker 再ビルドは本記録では skip** 中心・サマリ `Git: changed`））。
- **知見（Mac 運用端末）**: 同一実行で **`./scripts/update-all-clients.sh: line 904: …/.pyenv/shims/python3: No such file or directory`** が出ることがある。リモート Ansible は完走し得るが、**整形用パイプの `python3` 解決に失敗**している。対処: **`command -v python3`** で実体を確認し、**pyenv shims を直す**か **`PATH` 先頭に解決可能な `python3`** を置く（[KB-359](../knowledge-base/ci-cd.md#kb-359-開発端末の-python3-パス不良update-all-clients-の非致命警告)）。
- **ナレッジ**: [KB-358](../knowledge-base/ci-cd.md#kb-358-api-db-and-infra-の-wait-for-postgresql-が-flake-するborrow_return-等)（CI）・[KB-359](../knowledge-base/ci-cd.md#kb-359-開発端末の-python3-パス不良update-all-clients-の非致命警告)（Mac）・[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。

最終更新（前項まで）: 2026-04-26（DGX LocalLLM 運用堅牢化・env 整合・Pi5 のみ）

### 補足（2026-04-26: DGX LocalLLM 運用堅牢化・`LOCAL_LLM` / `INFERENCE_PROVIDERS_JSON` 整合・embedding 指紋・Ansible fail-fast・API のみ・Pi5 のみ）

- **変更概要**: Pi5 API の起動時 Zod（`env.ts`）で **`LOCAL_LLM_*` と `INFERENCE_PROVIDERS_JSON` の整合**・**`PHOTO_TOOL_EMBEDDING_*`（有効時必須）** を検証。`manage-app-configs.yml` に **assert** を追加し、デプロイ時に **token / provider / on_demand URL** の不整合を早期失敗。写真ツール類似ギャラリ用に **embedding 設定の fingerprint**（秘密を含まない）を backfill ログへ。DGX 側 **systemd 化**はリポジトリの `scripts/dgx-local-llm-system/systemd/` と [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（**inventory 外・別作業**）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4 / Pi3 は不要**（本変更は Pi5 `api` と Ansible の Pi5 設定検証が中心）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/dgx-ops-hardening infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feat/dgx-ops-hardening`**・代表コミット **`01a257be`**（機能）＋本記録の **docs 追補コミット**。**Detach Run ID**（`ansible-update-`）: **`20260426-135827-7914`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 13.7 分**・Docker 再ビルド含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 361s**・Tailscale）。
- **知見**: **Secret ドリフト**は Pi5 vault / `docker.env` と DGX 実トークンの **手動同期**が前提。不整合は **Ansible assert** または **API 起動時**で検出される（[KB-356](../knowledge-base/infrastructure/ansible-deployment.md#kb-356-local-llm--inference_providers_json-の整合検証とデプロイ時-assert)）。**Embedding バックエンド変更**後は [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md) に従い **gallery backfill を再実行**。
- **トラブルシュート**: `manage-app-configs` / API が **整合エラー**で止まる → `INFERENCE_PROVIDERS_JSON` の primary と **`LOCAL_LLM_PROVIDER_ID` / `LOCAL_LLM_BASE_URL` / token / on_demand URL** を突合。未追跡ファイルで `update-all-clients.sh` が fail-fast する場合は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [KB-356](../knowledge-base/infrastructure/ansible-deployment.md#kb-356-local-llm--inference_providers_json-の整合検証とデプロイ時-assert)・[KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)・[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)・[photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md)。

### 補足（2026-04-25: パレット可視化ボード スロット幾何・下段4明細 全幅・API のみ・Pi5 のみ）

- **変更概要**: シングルマシン `PalletBoardRenderer` のカード内レイアウトを **`computePalletSlotCardLayout`**（`pallet-board-slot-card-layout.ts`）へ分離。上段右の機種1行と、下段4明細を **`fullWidthX` 基準で全幅**表示（`pallet-board-single-layout.ts` の `renderSlot` は座標適用と `ellipsize` のみ）。**DB/新規 API 契約なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 専用手順は不要**（表示端末は `GET /api/signage/current-image` のみで、**JPEG は Pi5 `api` が生成**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/pallet-board-slot-geometry-and-fullwidth-details infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feat/pallet-board-slot-geometry-and-fullwidth-details`**・代表コミット **`b67476da`**。**Detach Run ID**（`ansible-update-`）: **`20260425-133302-18334`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 13.6 分**・Docker 再ビルド含む）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 59s**・Tailscale）。
- **手動目視（推奨）**: 管理 **`/admin/signage/preview`**（端末 `x-client-key` 指定）で **パレット可視化**スケジュールを表示し、**下段4明細がカード内で全幅に揃い**、機種行の位置が意図どおりか。反映が古い場合は端末の **画像キャッシュ/更新間隔**（[modules/signage/README.md](../modules/signage/README.md)）を確認。
- **知見**: Vitest でスロット内 `<g>` だけを抜く正規表現は、フィクスチャ内 **子 SVG の `</g>`** で先にマッチし得るため、**下段4 `<text>` の `x` 整合**は **文書末尾4つの `<text x=`** で検証する前提（単一1スロット想定、`pallet-board-single-layout.test.ts`）。
- **トラブルシュート**: デプロイ前 **未追跡ファイル**は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [api.md KB-355 追補（スロット幾何・2026-04-25）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)。

### 補足（2026-04-25: パレット可視化ボード サイネージ JPEG・API のみ・Pi5 のみ）

- **変更概要**: シングルマシン用 `PalletBoardRenderer`（`pallet_board`）の SVG に **登録済み加工機イラスト**（`illustrationUrl` → `PalletMachineIllustrationStorage.readIllustration` → data URI）と **同梱サムネ PNG**（各カード左）を埋め込み、**`clipPath`＋行省略**でカード内テキストの **枠外はみ出し/隣カード重なり**を抑制。`apps/api` の `package.json` `build` で `pallet-board/assets` を `dist` へ `cp -R`。**DB/新規 API 契約なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 専用手順は不要**（表示端末は `GET /api/signage/current-image` のみで、**JPEG は Pi5 `api` が生成**）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/pallet-board-jpeg-illustration-and-text-clip infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feat/pallet-board-jpeg-illustration-and-text-clip`**・代表コミット **`d01eb79c`**。**Detach Run ID**（`ansible-update-`）: **`20260425-121049-5082`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 10.3 分**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 58s**・Tailscale）。
- **手動目視（推奨）**: 管理 **`/admin/signage/preview`**（端末 `x-client-key` 指定）で **パレット可視化**スケジュールを表示し、**左ペインの登録イラスト**・**カード左サムネ**・**長文の `…` 省略**が意図どおりか。反映が古い場合は端末の **画像キャッシュ/更新間隔**（[modules/signage/README.md](../modules/signage/README.md)）を確認。
- **知見**: `<image>` は **`href` と `xlink:href` 併記**で古いラスタライザ互換。固定 PNG が読めない場合は **従来の `palletBoardFixtureInnerSvg` 線画**にフォールバック。
- **トラブルシュート**: 左イラストが出ない → **`illustrationUrl` 未登録**または **`readIllustration` 失敗**（[KB-355](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・ストレージ bind）。**Mac fail-fast**（未追跡ファイル）は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。
- **ナレッジ**: [api.md KB-355 追補（2026-04-25）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)・[design/preview-workflow.md](../design/preview-workflow.md)（HTML と JPEG の表現差の前提）。

### 補足（2026-04-25: キオスク／配膳 パレット可視化 部品カード UI・`PalletVizItemCard`・Web のみ）

- **変更概要**: `PalletVizItemList` を `PalletVizItemCard` + `palletVizItemCardTokens` に分割。行1（番号・機種名 `truncate`・個数 em dash）、行2（製番・`fhincd`）、行3（着手日・`fhinmei` の `line-clamp-2`、ラベーなし）。**外寸は非表示**（`outsideDimensionsDisplay` は DTO/マッピングで温存、表示層は参照しない）。**API/DB 変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 専用手順は不要**（本変更は Pi5 `web` のキオスク SPA 配信。**Pi3 サイネージ**は本画面非対象）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/pallet-viz-item-card-solid-local infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feat/pallet-viz-item-card-solid-local`**・代表コミット **`c986162c`**。**Detach Run ID**（`ansible-update-`）: **`20260425-094225-8483`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 7.3 分**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 134s**・Tailscale）。
- **手動目視（推奨）**: **`/kiosk/pallet-visualization`**・**`/kiosk/mobile-placement/pallet-viz`**・タグ/写真持出の **左ペイン埋め込み**で **同一カード**・**一覧スクロール**の破綻が無いこと。古いバンドルは **スーパーリロード**。
- **知見**:
  - 機種名が **両方 null** のとき、行1 中央列は **空**（`flex-1`）で **個数は右端**（プレビュー確定案・[design preview](../design-previews/pallet-viz-card-layout-preview.html)）。
  - `PalletVizItemList` で `export type { PalletVizListItem }` **のみ**だと、同一ファイル内の **`PalletVizListItem[]` が型解決できない**（**`import type { PalletVizListItem }`** を併用）。
  - 行2 は長い **`fseiban` が伸びる**と **`fhincd` が潰れやすい**ため、トークン上 **`fseiban` を `min-w-0 flex-1 truncate`・`fhincd` を `shrink-0`** に寄せるとバランスが出やすい。
- **トラブルシュート**: デプロイ前 **未追跡 `docs/design-previews/...`** 等は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **fail-fast** → **commit するか** **`git stash push -u`**（本記録ではデプロイ前に **stash**）。
- **ナレッジ**: [KB-339 §V27](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v27-pallet-viz-item-card-ui-2026-04-25)・[api.md KB-355 追補（2026-04-25）](../knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22)。

### 補足（2026-04-24: キオスク吊具集計 `/kiosk/rigging-analytics` DADS 寄せリファクタ・Web のみ）

- **変更概要**: キオスク **吊具集計**（期間・データセット切替）を DADS プレビュー意図に揃えて **UI 構造を分割**（`KioskAnalyticsShell` / `KioskAnalyticsPeriodFilterControls` / `KioskAnalyticsPanelsGrid`）。**`KIOSK_ANALYTICS_DADS_THEME` を `kioskAnalyticsTheme.ts` に集約**、**`useKioskRiggingAnalyticsPageModel` にページロジック集約**（6 系クエリの同時取得は従来どおり）。ランキング行の帯幅・氏名 `line-clamp`、KPI ストリップの 1 行 5 列・高さ・数値色など **見た目の調整**。**`isNotFoundQueryError` 分離**。**DB / API 契約変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**キオスク SPA は Pi5 の `web` 配信**のため。Pi4／Pi3 は本変更の**必須デプロイ対象外**（Pi4 は Pi5 上の URL を読めば反映後にバンドル取得）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh refactor/kiosk-analytics-dads infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`refactor/kiosk-analytics-dads`**・代表コミット **`1dd6f158`**。**Detach Run ID**（`ansible-update-`）: **`20260424-191202-23904`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・所要 **約 7.5 分**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本セッション・Tailscale 経由）。
- **知見**: `update-all-clients.sh` の **ローカル fail-fast** により、**未コミットの `docs/design-previews` 等**があるとデプロイが起動しない。対処は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit するか一時 `stash`（`git stash push -u`）**。
- **手動目視（任意）**: キオスクで **`/kiosk/rigging-analytics`** を開き、**期間プリセット**・**データセットタブ**（吊具／持出返却アイテム／計測機器）・**ランキング／KPI** が従来どおり利用できること。反映が古い場合は **スーパーリロード**。

### 補足（2026-04-24: キオスク順位ボード Pi4 向け軽量取得・Virtualization・API `responseProfile=leaderboard`）

- **変更概要**: 生産スケジュール **キオスク一覧**に **`responseProfile=leaderboard`**（クエリ）を追加し、順位ボード専用に **実績時間系の重い付与**や **機種名の一覧外エンリッチ**を省略して **転送・DB 負荷を削減**。Web は **`@tanstack/react-virtual`** による仮想化、**`leaderBoardRefetchPolicy`** によるポーリング整理、**`useLeaderOrderBoardDeviceContext`** で **`manual-order-overview` をデバイス文脈から切り離し**、ミューテーション周りの **`useCallback` 安定化**（`useLeaderBoardDueAssist` / `useProductionScheduleMutations`）など。**DB/新規 HTTP パスはなし**（既存一覧契約のクエリ拡張）。
- **対象ホスト（5 台・順次）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。各 **`--limit <host>`**。**Pi3 は対象外**（本変更は Pi3 専用手順不要）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-leaderboard-pi4-performance-solid infrastructure/ansible/inventory.yml --limit <host> --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`feat/kiosk-leaderboard-pi4-performance-solid`**・代表コミット **`95bec8b7`**。**Detach Run ID**（`ansible-update-`）: **`20260424-153647-24567`**（`raspberrypi5`）/ **`20260424-154843-4943`**（`raspberrypi4`）/ **`20260424-155623-24544`**（`raspi4-robodrill01`）/ **`20260424-160421-6565`**（`raspi4-fjv60-80`）/ **`20260424-161137-27861`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 `100.106.158.2`・Tailscale 経由の本セッション実測）。
- **知見**: 順位ボードは **一覧 `pageSize` が大きい**と Pi4 の **パース・レイアウト**が律速になりやすい。**API 側の leaderboard プロファイル**と **行の仮想化**を組み合わせると、既存画面（本流スケジュール等）への **`responseProfile` 未指定の挙動**は変えずに済む。
- **トラブルシュート（共通）**: デプロイ前 **未追跡ファイル**は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **fail-fast**。**`raspi4-kensaku-stonebase01`** では **`barcode-agent` 健全性待機が 1 回リトライ**したが **最終的に成功**（`failed=0`）。継続失敗時は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) と当該ホストの `barcode-agent` / `deploy-status` を確認。

### 補足（2026-04-24: 計測機器持出 T4 帯 混色比の単一化・API のみ）

- **変更概要**: 貸出ありカード帯（T4）の **warning と info-container の混色比**を **`mi-instrument-card-metrics.ts` の `MI_LOAN_ACTIVE_BAND_WARNING_MIX`（0.22）** に集約。`mi-instrument-card-palette` の SVG hex 合成、`apps/api/scripts/design-preview.ts` の `color-mix` パーセンテージと T4 ラベル、ユニットテストを同一定数に揃えた。見た目は従来の 22% 相当のまま。**DB/契約変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4 / Pi3 は必須ではない**（JPEG は Pi5 API が生成。Pi3 専用手順は不要）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: ブランチ **`main`**・代表コミット **`85936fbe`**。**Detach Run ID**（`ansible-update-`）: **`20260424-124333-16207`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**。所要 **約 11 分**（Docker 再ビルド含む））。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **2 分 24 秒**）。
- **知見**: `design-preview.ts` の **HTML 生成テンプレ**内コメントに **バッククォート付き識別子**を入れると、ESLint がテンプレートリテラル境界を誤解し **パースエラー**になり得る。定数名は **プレーンテキスト**で参照メモする。
- **知見 / トラブルシュート（共通）**: デプロイ前 **未追跡ファイル**は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **fail-fast**。**Pi5 `apps/api/src` root 所有**は先に **`chown` 後**デプロイ（[KB-347 追補](../knowledge-base/api.md#kb-347-サイネージ可視化の業務日切替jst-翌900自動表示のみ)）。

### 補足（2026-04-24: 計測機器持出可視化 カード ヘッダ帯＋帯下余白・API のみ）

- **変更概要**: `measuring_instrument_loan_inspection` レンダラーに **氏名・件数行の色面（帯）** と、**帯下〜明細の縦余白**を追加。レイアウト定数は **`mi-instrument-card-metrics.ts`**、配色は **`mi-instrument-card-palette.ts`**（HTML の `color-mix` 相当の hex 合成）、SVG 片は **`mi-inspection-card-svg.ts`**。**DB/契約変更なし**。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi4 / Pi3 は必須ではない**（JPEG は Pi5 API が生成。Pi3 専用手順は不要）。
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mi-loan-inspection-header-band infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（`--foreground` 再実行は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 参照）。
- **本番デプロイ（実績）**: ブランチ **`feat/mi-loan-inspection-header-band`**・代表コミット **`ddf15fa2`**。**Detach Run ID**（`ansible-update-`）: **`20260424-113411-24095`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**）。Mac からの **`--follow` は Docker 再ビルド中に SSH がタイムアウト**し得るが、リモート `nohup` は最後まで完走。状態は Pi5（`/opt/.../logs/deploy/*.status.json` / `*.exit`）で確認。所要は **再ビルド込みで約 10 分前後**になりがち。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **2 分**）。
- **手動目視（推奨）**: 管理 **サイネージプレビュー**または Pi3 表示で、**計測機器持出**カードの帯と本文の区切りが意図どおりか。
- **知見 / トラブルシュート**: デプロイ前 **未追跡ファイル**は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **fail-fast**。**Pi5 `apps/api/src` root 所有**は **`chown` 後に**デプロイ（過去 [KB-347 追補](../knowledge-base/api.md#kb-347-サイネージ可視化の業務日切替jst-翌900自動表示のみ) と同型）。`pnpm --filter @raspi-system/api design:preview` の HTML モック（`--mi-header-body-gap`）は [preview-workflow.md](../design/preview-workflow.md) 参照。

### 補足（2026-04-24: 購買照会バーコード即時確定・キオスク標準セッション共通化・Web のみ）

- **変更概要**: 購買照会 `/kiosk/purchase-order-lookup` の `BarcodeScanModal` から **`stabilityConfig`（短時間の同一値 2 連続一致）を撤去**し、配膳トップ・パレット可視化と同様に **最初の有効デコードで確定**（`useBarcodeScanSession`）。`readerOptions` と `idleTimeoutMs`（30s）は **`KIOSK_STANDARD_BARCODE_SCAN_SESSION`**（`apps/web/src/features/barcode-scan/kioskStandardBarcodeScanSession.ts`）に集約し、対象キオスク画面は **`{...KIOSK_STANDARD_BARCODE_SCAN_SESSION}`** をスプレッド。**API/DB 変更なし**。10 桁正規化と API 実行条件は `usePurchaseOrderLookup` 従来どおり（非 10 桁は `runLookup` 未実行）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 不要**（キオスク SPA は Pi5 の `web` 配信。Pi4 個別のリポジトリ更新は不要で、`https://<Pi5>/kiosk/...` を読む端末は Pi5 反映後にバンドル更新を取得）。
- **標準コマンド（運用端末・Tailscale 等で Pi5 に SSH 可なこと）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/kiosk-purchase-order-barcode-instant infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績・2026-04-24）**: ブランチ **`fix/kiosk-purchase-order-barcode-instant`**・代表コミット **`4bc2698f`**。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: **`20260424-102338-6782`**（**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート exit **`0`**・所要約 **約 410s**）。Pi4/Pi3 の play は **`--limit raspberrypi5`** により **未実行（skipped）**。
- **到達性メモ**: ネットワークによっては **`100.106.158.2:22` がタイムアウト**し得る。**Tailscale 到達可な運用端末**から実行すること。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **96s**）。
- **実機（手動・Android Chrome）**: `/kiosk/purchase-order-lookup` の **注番スキャン確定**が、従来より **配膳・パレットに近い速さ**に感じること。ブラウザが古いバンドルを掴んでいる場合は **スーパーリロード**。
- **トラブルシュート**: **誤読で 10 桁が入り API 照会が走る**場合はラベル品質・距離・照明を先に確認。必要なら **`PurchaseOrderLookupPage` だけ `stabilityConfig` を復活**させるか UX 側で確認を増やす（トレードオフは [KB-339 §V26](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v26-purchase-order-barcode-instant-2026-04-24)）。**体感が変わらない**ときは **キャッシュ**と Pi5 `web` イメージ更新の有無を確認。
- **ナレッジ**: [KB-339 §V26](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v26-purchase-order-barcode-instant-2026-04-24)・[KB-297 §FKOBAINO](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20)。

### 補足（2026-04-24: 配膳スマホ パレット可視化・カード一覧のみ縦スクロール・Web のみ）

- **変更概要**: `/kiosk/mobile-placement/pallet-viz` で **テンキー・操作行は固定**し、**部品カード一覧だけ**が `flex-1 min-h-0 overflow-y-auto` で縦スクロールする（`KioskMobilePalletVisualizationPage.tsx`）。従来はテンキ〜一覧が同一 `overflow-y-auto` ブロックで一体スクロール。**API/DB 変更なし**。一覧ルートに **`touch-action: pan-y`**・親チェーンで **`wheel` / `touchmove` の `preventDefault`（`passive: false`）** を入れ、**ページ全体の縦バウンス**と **テンキー領域への誤スクロール伝播**を抑える（詳細は [KB-339 §V25](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v25-mobile-pallet-viz-card-only-scroll-2026-04-24)）。
- **対象ホスト（最小）**: **`raspberrypi5` のみ**（キオスク SPA は Pi5 の `web` 配信。**Pi3 サイネージは不要**）。
- **標準コマンド（運用端末・Tailscale 等で Pi5 に SSH 可なこと）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-pallet-viz-scroll-layout infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績・2026-04-24）**: ブランチ **`feat/mobile-pallet-viz-scroll-layout`**・代表コミット例 **`b292a5db`**（E2E 安定化を含む先端）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: **`20260424-093828-22068`**（**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート exit **`0`**・所要約 **291s**）。Pi4/Pi3 の play は **`--limit raspberrypi5`** により **未実行（skipped）**。
- **到達性メモ**: ネットワークによっては **`100.106.158.2:22` がタイムアウト**し得る。**Tailscale 到達可な運用端末**から実行すること（過去に Cursor 等の実行環境からは未到達の例あり）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **61s**）。
- **実機（手動・Android）**: 加工機選択済み・カード複数件で **一覧だけ**がフリックで動き、**テンキーが一緒に流れない**こと。反映が古い場合は **スーパーリロード**。
- **トラブルシュート**: 一覧が伸びてもスクロールしない → DevTools で **`PalletVizItemList` ルート**の `scrollHeight > clientHeight` と親 flex（`relative flex min-h-0 flex-1 flex-col`）を確認（[KB-339 §V25](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v25-mobile-pallet-viz-card-only-scroll-2026-04-24)）。
- **ナレッジ**: [KB-339 §V25](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v25-mobile-pallet-viz-card-only-scroll-2026-04-24)・[api.md KB-355 追補](../knowledge-base/api.md)・[mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)。

### 補足（2026-04-23: キオスク／配膳スマホ バーコード読取チューニング・Web のみ）

- **変更概要**: `@zxing/library` 連続デコードの **再試行間隔**（`timeBetweenScansMillis` / `timeBetweenDecodingAttempts`）を `readerOptionPresets` に集約。配膳・パレット可視化・部品測定などは **`BARCODE_READER_OPTIONS_KIOSK_DEFAULT`（220/120ms）** と **一次元コア形式**（`BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE`）で探索空間を削減。要領書 `/kiosk/documents` は **広域一次元（`BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL`）**のまま、**`BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE`（400/200ms＝`zxingVideoReader` 既定）**で Pi4 Firefox の同時負荷を避ける。**当時の購買照会**は **`BARCODE_FORMAT_PRESET_PURCHASE_ORDER` + `stabilityConfig`**（**2026-04-24 以降は撤去**し配膳等と同様の即時確定—上記「購買照会バーコード即時確定」節・[KB-339 §V26](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v26-purchase-order-barcode-instant-2026-04-24)）。
- **本番デプロイ（実績）**: ブランチ **`feat/kiosk-barcode-reader-tuning`**・代表 **`70cb9e09`**。**`raspberrypi5` のみ**・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-barcode-reader-tuning infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach Run ID**: **`20260423-211624-9136`**（**`failed=0` / `unreachable=0` / exit `0`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **52s**）。
- **トラブルシュート**: 未認識が続く場合は **照明・距離・ラベル品質**を先に確認。形式を増やす・間隔を短くするほど **CPU 負荷**が上がる。要領書で遅延だけを下げる場合は **保守的間隔**と **形式の二段**のトレードオフ（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）を参照。
- **実機（Android Chrome・2026-04-24 追記）**: **`/kiosk/purchase-order-lookup`（注番）**と **`/kiosk/mobile-placement`（製造order）**の **一次元**で、反映後に **読取体感が速くなった**との場内確認（**配膳**＝コア一次元＋`KIOSK_DEFAULT`、**購買**＝`PURCHASE_ORDER`＋同 `readerOptions`＋2連続一致・[KB-297 §FKOBAINO](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20)・[KB-339 V24](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v24-barcode-reader-tuning-2026-04-23)）。

### 補足（2026-04-23: 計測機器点検可視化 返却グレーアウト）

- **変更概要**: `measuring_instrument_loan_inspection` は **返却済み** を `returned` として `計測機器明細` に保持し、カード本文では **グレー 1 行**で表示する。**`貸出中計測機器数`** は未返却のみ、**`返却件数`** を新設し、カード右上は **`貸出中 {n} ・ 返却 {m}`**。
- **本番デプロイ（実績）**: ブランチ **`feature/mi-inspection-returned-grayout`**・代表 **`68b6a03b`**。**`raspberrypi5` のみ**に `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/mi-inspection-returned-grayout infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` を実行。**Detach Run ID**: `20260423-194726-14100`、**`PLAY RECAP failed=0` / `unreachable=0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **103s**）。Pi5 後続確認では `backup.json` 存在、`pnpm prisma migrate status` 最新、`MeasuringInstrumentLoanEvent` 存在、`security-monitor.timer` active を確認。
- **知見 / トラブルシュート**: 今回は **サーバー側 JPEG レンダリング**の差分なので **Pi5 のみ**が対象。デプロイ前チェックで Pi5 の **`apps/api/src` に root 所有ファイル**が見つかったため、標準手順どおり **`sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/apps/api/src`** を先に実施した。Pi3 は対象外だが、将来 **Pi3 側クライアント差分**を含む場合は [ラズパイ3（サイネージ）の更新](#ラズパイ3サイネージの更新) を単独で使う。

### 補足（2026-04-17: 計測機器 点検記録作成 API のキオスク認可・PR #147）

- **事象・根因**: `POST …/inspection-records` のみ **`canWrite`（JWT 必須）**のままだったため、キオスクの **`x-client-key` のみ**では **`401` / `AUTH_TOKEN_REQUIRED`** となり、OK 持出フローが点検記録作成で止まり得た（画面は「認証トークンが必要」）。
- **修正**: `preHandler` を **`allowWrite`** に変更（借用・返却と同じく JWT または `x-client-key`）。**`main` マージ**: PR [#147](https://github.com/denkoushi/RaspberryPiSystem_002/pull/147)・マージコミット **`2484d069`**（実装コミット **`9e2011ff`**）。
- **ナレッジ**: [frontend.md の KB-346](../knowledge-base/frontend.md#kb-346-計測機器点検記録作成apiがキオスクのx-client-keyのみで401)・[ui.md](../modules/measuring-instruments/ui.md) 持ち出し登録。
- **本番追随**: 各ホストで **`main` 取得後** `api` 再ビルド反映（例: `docker compose … up -d --build api`）。ホットパッチのみの端末は **正式コミット SHA と整合**させる。

### 補足（2026-04-16: 計測機器持出の氏名NFC自動送信修正）

- 本番反映は **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **1 台ずつ**、`scripts/update-all-clients.sh` で順次実行した。
- Pi5 は初回の detached 実行（runId `20260416-133007-2231`）が `TASK [server : Rebuild/Restart docker compose services]` で停止したように見えた。**リモートログ 10 分以上停止 + `state: running` + exit file なし** を確認したら、[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) に従ってハングプロセスを停止し、**`--foreground`** で再実行して復旧した。
- 成功実績:
  - Pi5: `ansible-update-20260416-153847.log` / health `ansible-health-20260416-153847.log`
  - `raspberrypi4`: `ansible-update-20260416-154544.log`
  - `raspi4-robodrill01`: `ansible-update-20260416-155014.log`
  - `raspi4-fjv60-80`: `ansible-update-20260416-155343.log`
  - `raspi4-kensaku-stonebase01`: `ansible-update-20260416-160026.log`
- 実機相当確認:
  - Pi5 `GET /api/system/health` → `status: ok`
  - 4台の `deploy-status` → すべて `{"isMaintenance":false}`
  - 4台の `kiosk-browser.service` / `status-agent.timer` → すべて `active`
  - 4台の `http://localhost:7071/api/agent/status` → すべて `readerConnected: true`, `queueSize: 0`
- 機能の詳細は [KB-345](../knowledge-base/frontend.md#kb-345-計測機器持出で氏名nfcスキャン後に自動送信されない) と [ui.md](../modules/measuring-instruments/ui.md) を参照。

### 補足（2026-04-21: クライアント境界のセキュリティ強化と全台順次デプロイ）

- **変更概要**: `POST /api/clients/heartbeat` は **登録済み `x-client-key` のみ**で `lastSeenAt`/`location` を更新。新規 `ClientDevice` 作成は **`POST /api/clients`（管理者 JWT）** または **`scripts/register-clients.sh`**。`status` / `logs` も未登録キーからの端末 **upsert 作成は不可**。
- **本番デプロイ（実績）**: ブランチ **`feat/security-hardening-review-gates`**・代表 **`72c95b57`**。**順序**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01` → `raspberrypi3`**（各 **`--limit` 単体**・**`--detach --follow`**）。**Detach Run ID**: `20260421-095905-19176` → `20260421-101215-27707` → `20260421-101642-25779` → `20260421-102001-19607` → `20260421-102407-17708` → `20260421-102743-30478`、各 **`PLAY RECAP failed=0` / `unreachable=0`**。
- **Pi3**: [ラズパイ3（サイネージ）の更新](#ラズパイ3サイネージの更新) に従い、**Pi5 成功後**に **`--limit raspberrypi3` のみ**で実行（リソース僅少・他ホストと並列起動しない）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **33s**）。
- **Pi3 トラブルシュート**: デプロイ中のヘルス収集で `signage-lite` が一時 **`exit-code`** でも、playbook 完了時点で **`signage-lite.service is active`** なら正常系（lightdm 復旧後に収束）。長時間 `exit-code` のみが続く場合は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。
- **ナレッジ**: [KB-206](../knowledge-base/api.md#kb-206-クライアント表示名を-status-agent-が上書きする問題)・[KB-337](../knowledge-base/infrastructure/signage.md#kb-337-android-signage-lite-401-chrome)・[pr-review-bots.md](../security/pr-review-bots.md)。

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのデプロイメント手順を説明します。

## 📖 このドキュメントを読む前に

- **初めてデプロイする場合**: まず [クイックスタートガイド](./quick-start-deployment.md) を読んでください
- **ネットワーク環境が変わった場合**: [環境構築ガイド](./environment-setup.md) を参照してください
- **SSH接続の仕組みを理解したい場合**: [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) を参照してください

## ⚠️ 重要な原則

### デプロイ方法の使い分け（運用標準を統一）

| 用途 | スクリプト | 実行場所 | ブランチ指定 |
|------|-----------|---------|------------|
| **開発/緊急（Pi5のみ）** | `scripts/server/deploy.sh` | Pi5上で直接実行 | ✅ 可能（引数で指定） |
| **運用標準（全デバイス）** | `scripts/update-all-clients.sh` | Macから実行 | ✅ 可能（ブランチ指定 + inventory指定が必要） |

**⚠️ 注意**:
- **運用の標準は`update-all-clients.sh`**。Pi5も含めて一括更新します（inventory必須）。
- `deploy.sh`は**開発・緊急（Pi5単体）**の例外経路に限定します。
- **ブランチ指定は必須です**。デフォルトブランチはありません（誤デプロイ防止のため）。

### `docs/` 配置ポリシー（ホスト別）

- **Pi5（`server`）**: `/opt/RaspberryPiSystem_002/docs` を保持します。運用時の Runbook/KB 参照は Pi5 を正とします。
- **Pi4（`kiosk`）/Pi3（`signage`）**: `/opt/RaspberryPiSystem_002/docs` はデプロイ時に削除します（実行専用端末）。
- クライアント端末で `docs/...` のファイルパス参照が必要になった場合は、**Pi5 上の同パス**または **GitHub リポジトリ**のドキュメントを参照してください。

### デプロイ成功条件（共通）

**成功条件に満たない場合は「デプロイ失敗」として扱う**（fail-fast）。最低限の共通条件は以下:

- **DB整合性**:
  - `pnpm prisma migrate status` が最新
  - 必須テーブル（例: `MeasuringInstrumentLoanEvent`）が存在
  - **運用標準（Ansible経路）ではデプロイ中に `pnpm prisma migrate deploy` を実行**し、デプロイ後にhealth-checkでstatusを再確認
- **API稼働**: `GET /api/system/health` が 200 で `status=ok`
- **証跡**: デプロイログ/検証ログが残り、失敗理由が追跡できる

### 本番セキュリティ設定（2026-02-13追加）

本番環境では、以下の設定を必須または推奨で適用してください。

- **JWT秘密鍵（必須）**
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` は**32文字以上の強い値**を設定する
  - `NODE_ENV=production` で弱い値（例: `dev-*`, `*change-me*`, `test-*`）はAPI起動時にFail-fastで拒否される
  - **注意（Docker Composeのenv_file）**: `docker-compose.server.yml` の `api` は `apps/api/.env.example` と `infrastructure/docker/.env` を `env_file` で読み込むため、`infrastructure/docker/.env` にJWTが無いと `.env.example` の弱い値（例: `replace-me`）が使われてAPIが再起動ループになる
  - **LocalLLM 代理（Pi5 API）**: `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_MODEL` も **同じく `infrastructure/docker/.env`（Ansible: `infrastructure/ansible/templates/docker.env.j2`）へ出力**する。`api` サービスは **`apps/api/.env` を `env_file` に含めない**ため、ホストの `apps/api/.env` にだけ書いてもコンテナ内に入らない（JWT と同系の切り分け。[KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）

  **JWT秘密鍵の用途と仕組み**:
  - **用途**: 管理コンソール（`/admin`）やキオスク（`/kiosk`）のログイン認証で使用される「アクセストークン」と「リフレッシュトークン」の署名に使用されます
  - **アクセストークン**: 15分間有効で、APIリクエストの認証に使用（例: バックアップ設定の取得、CSVインポート実行）
  - **リフレッシュトークン**: 7日間有効で、アクセストークンの更新に使用（期限切れ時に自動で新しいアクセストークンを取得）
  - **なぜ秘密鍵が必要か**: トークンは改ざんできないよう秘密鍵で署名されます。弱い値（例: `change-me`）だと推測されやすく、セキュリティリスクになります

  **運用上の注意点**:
  - **デプロイ後の確認（必須）**: デプロイ後は必ず `curl -sk https://localhost/api/system/health` でAPIが正常起動していることを確認してください。応答がない/エラーが出る場合は、JWT秘密鍵の問題の可能性があります
  - **JWT秘密鍵を変更した場合の影響**: 既存のログインセッション（アクセストークン/リフレッシュトークン）は無効になります。管理コンソールやキオスクから再ログインが必要です。通常は変更不要です（デプロイ時に自動で維持されます）
  - **バックアップと復旧**: `.env`ファイルはバックアップ対象に含まれています（`backup.json`で設定済み）。万が一JWT秘密鍵が失われた場合、Dropboxからバックアップを復元できます
  - **開発環境との違い**: 開発環境（`NODE_ENV=development`）では弱い値でも動作しますが、本番環境では動作しません。本番環境では32文字以上の強い値が必須です
  - **デプロイ時の自動処理**: 通常は手動操作は不要です。Ansibleが既存の強いJWT秘密鍵を自動で維持します。初回セットアップ時のみ、強い秘密鍵を生成して設定します
- **kioskレート制限（推奨）**
  - `RATE_LIMIT_REDIS_URL` を設定すると、kiosk系レート制限がRedis共有カウンタで動作する
  - 未設定時はInMemoryフォールバックで動作（単一ノード想定）
- **kiosk専用閾値（必要に応じて調整）**
  - `KIOSK_SUPPORT_RATE_LIMIT_MAX`（既定: 3）
  - `KIOSK_SUPPORT_RATE_LIMIT_WINDOW_MS`（既定: 60000）
  - `KIOSK_POWER_RATE_LIMIT_MAX`（既定: 1）
  - `KIOSK_POWER_RATE_LIMIT_WINDOW_MS`（既定: 60000）

## 🌐 ネットワーク環境の確認（デプロイ前必須）

**重要**: デプロイ前に、Pi5上の`group_vars/all.yml`の`network_mode`が**Tailscale主運用**の前提に合っているか確認してください。これがデプロイ成功の最重要ポイントです。

### ネットワークモードの選択

| ネットワーク環境 | network_mode | 使用IP | 用途 |
|----------------|-------------|--------|------|
| **通常運用（標準）** | `tailscale` | Tailscale IP（100.x.x.x） | 安全な通常運用（常時接続） |
| **緊急時のみ** | `local` | ローカルIP（192.168.x.x） | Tailscale障害/認証不能時の緊急対応 |

### ネットワークモード設定の確認・変更

**1. 現在の設定を確認**:
```bash
# Pi5上のnetwork_modeを確認
ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**2. 設定を変更（必要に応じて）**:
```bash
# Tailscaleモードに変更（通常運用・標準）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# Localモードに変更（緊急時のみ）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"tailscale\"/network_mode: \"local\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**3. 接続テスト**:
```bash
# Pi5からPi4への接続テスト（実際に使われるIPで）
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi4 -i infrastructure/ansible/inventory.yml -m ping"
```

**⚠️ 注意**: 
- `network_mode`が`tailscale`の場合、Tailscale IPが使われます（`tailscale status`で確認）
- `network_mode`が`local`の場合、ローカルIPが使われます（`hostname -I`で取得した値を使用）
- **Tailscale主運用のため、`local`は緊急時のみ許可**としてください
  - `scripts/update-all-clients.sh` で`local`を使う場合は `ALLOW_LOCAL_EMERGENCY=1` を明示
- **WebRTC通話（同一LAN限定）**: 通話を工場LAN内のみに限定したい場合、通話実施中だけ `network_mode=local` に切り替えて運用します（工場LAN限定）。通話が終わったら `network_mode=tailscale` に戻してください。
- ローカルIPは環境で変動するため、実際に`hostname -I`等で取得した値で`group_vars/all.yml`を書き換えること
- **重要**: Ansibleがリポジトリを更新する際に`git reset --hard`を実行するため、`group_vars/all.yml`の`network_mode`設定がデフォルト値（`tailscale`）に戻る可能性があります。デプロイ前だけでなく、ヘルスチェック実行前にも必ず設定を再確認すること（[KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)参照）

詳細は [環境構築ガイド](./environment-setup.md) を参照してください。

### 管理画面のIP制限（インターネット接続時）

- **Caddyでの制限**: `ADMIN_ALLOW_NETS` 環境変数（空白区切りCIDR、デフォルト: `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32`）を設定すると、`/admin*` へのアクセスが許可ネットワークに限定されます。  
  - Docker Compose: `web.environment.ADMIN_ALLOW_NETS` を上書き。  
  - テスト: 許可IPから `curl -kI https://<pi5>/admin` が200/302、非許可IPは403/timeout。
- **Tailscale ACL推奨**: 併せて Tailscale ACL で管理画面のCIDRを信頼セグメントに限定してください（例: `100.64.0.0/10` のみ許可）。
- **HTTPS/ヘッダー確認**: `scripts/test/check-caddy-https-headers.sh` で HTTP→HTTPS リダイレクトと HSTS/Content-Type-Options/X-Frame-Options/Referrer-Policy をチェック可能。

## ラズパイ5（サーバー）の更新

### デプロイ前チェックリスト

**重要**: デプロイ実行前に、以下を必ず確認・実行してください：

- [ ] **リモートリポジトリとの比較**: Pi5上のコードとリモートリポジトリ（`origin/main`）を比較し、差分を確認
  ```bash
  # Pi5上で実行
  ssh denkon5sd02@raspberrypi.local
  cd /opt/RaspberryPiSystem_002
  git fetch origin
  git diff HEAD origin/main
  ```
- [ ] **コミット/プッシュ/CIの確認（重要）**:
  - `scripts/server/deploy.sh` は **`git pull origin <branch>` でリモートを取り込む**ため、ローカルで未pushの変更はデプロイされません。
  - `scripts/update-all-clients.sh` は **fail-fastチェック**により、未commit/未pushの状態でデプロイを実行しようとするとエラーで停止します。
  - デプロイ前に **変更がリモートへpush済み**であること、可能なら **GitHub Actions CIが成功していること**を確認してください（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)、[KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) 参照）。
  - **未commit/未追跡の変更がある場合**: ドキュメント変更のみで本番コードに影響がないとき、デプロイだけ先行させたい場合は **`git stash push -u -m "..."` → デプロイ実行 → 成功後に `git stash pop`** で対応可能（[KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)、[KB-271](../knowledge-base/api.md#kb-271-生産スケジュールデータ削除ルール重複loser即時削除1年超過は保存しない) 参照）。
- [ ] **設定ファイルのバックアップ**: `backup.json`などの設定ファイルをバックアップ（[KB-163](../knowledge-base/infrastructure/backup-restore.md#kb-163-git-cleanによるbackupjson削除問題再発)参照）
  ```bash
  # Pi5上でbackup.jsonをバックアップ
  ssh denkon5sd02@raspberrypi.local "cp /opt/RaspberryPiSystem_002/config/backup.json /opt/RaspberryPiSystem_002/config/backup.json.backup.$(date +%Y%m%d-%H%M%S)"
  ```
- [ ] **フルバックアップの実行（推奨）**: DB/ENV/ストレージを含むバックアップを実行（[バックアップ手順](./backup-and-restore.md)参照）
  ```bash
  # Pi5上で実行
  ssh denkon5sd02@raspberrypi.local "cd /opt/RaspberryPiSystem_002 && ./scripts/server/backup.sh"
  ```
- [ ] **バックアップ設定の健全性確認（推奨）**: `backup.json`の衝突/ドリフト/欠落を検知（[KB-148](../knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装)参照）
  ```bash
  # Pi5上で実行（自己署名TLSのため -k）
  ssh denkon5sd02@raspberrypi.local "curl -sk https://localhost/api/backup/config/health/internal"
  ```
- [ ] **ネットワーク環境の確認**: `group_vars/all.yml`の`network_mode`が現在のネットワーク環境と一致しているか確認
  ```bash
  # Pi5上のnetwork_modeを確認
  ssh denkon5sd02@raspberrypi.local "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
  ```
- [ ] **node_modules権限の確認**: root所有の`node_modules`が存在しないか（存在する場合は事前に修正）
  ```bash
  # Pi5上で実行（root所有を検出）
  ssh denkon5sd02@raspberrypi.local "cd /opt/RaspberryPiSystem_002 && find node_modules packages -type d -name '.bin' -user root -maxdepth 4 | head -n 5"
  # 修正が必要な場合
  ssh denkon5sd02@raspberrypi.local "sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/node_modules /opt/RaspberryPiSystem_002/packages/*/node_modules"
  ```
- [ ] **Git権限の確認**: `.git`ディレクトリが`denkon5sd02`所有であることを確認（デタッチ実行に必要、[KB-219](../knowledge-base/infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗)参照）
  ```bash
  # Pi5上で実行（root所有を検出）
  ssh denkon5sd02@raspberrypi.local "ls -ld /opt/RaspberryPiSystem_002/.git"
  # 修正が必要な場合（root所有の場合）
  ssh denkon5sd02@raspberrypi.local "sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/.git"
  ```
- [ ] **ワークツリー権限の確認（Git 同期失敗対策）**: デプロイ対象リポジトリで **`git reset --hard` が `unable to create file … 許可がありません`** となる場合、**一部ディレクトリだけ `root` 所有**になっていることがある。代表例: `apps/api/src/services/signage/loan-card/`（[KB-325](../knowledge-base/infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git)）。
  ```bash
  # Pi5上で実行（root所有のソースファイルを検出・先頭のみ）
  ssh denkon5sd02@raspberrypi.local "find /opt/RaspberryPiSystem_002/apps/api/src -user root -type f 2>/dev/null | head"
  # 対象パスが判明したら chown（例）
  ssh denkon5sd02@raspberrypi.local "sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/apps/api/src/services/signage/loan-card"
  ```
- [ ] **SSH接続の確認**: MacからPi5へのSSH接続が正常に動作することを確認（fail2ban Banの確認、[KB-218](../knowledge-base/infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行)参照）
  ```bash
  # Macから実行（接続テスト）
  ssh denkon5sd02@100.106.158.2 "echo 'SSH接続成功'"
  # 接続できない場合、fail2ban Banの可能性があるため、RealVNC経由でPi5にアクセスしてBanを解除
  ```
- [ ] **aptリポジトリの確認**: NodeSourceリポジトリが存在する場合、GPG署名キー問題の可能性があるため確認（[KB-220](../knowledge-base/infrastructure/ansible-deployment.md#kb-220-nodesourceリポジトリのgpg署名キー問題sha1が2026-02-01以降拒否される)参照）
  ```bash
  # Pi5上で実行（NodeSourceリポジトリの存在確認）
  ls -la /etc/apt/sources.list.d/nodesource.list 2>/dev/null || echo "NodeSourceリポジトリは存在しません"
  # 存在する場合、apt-get updateでGPG署名エラーが発生する可能性があるため、削除を検討
  ```
- [ ] **標準手順の確認**: 本ドキュメントの標準デプロイ手順を必ず確認

### デプロイ後チェックリスト

**重要**: デプロイ実行後、以下を必ず確認してください：

- [ ] **設定ファイルの確認**: `backup.json`が正しく保持されているか確認
  ```bash
  # Pi5上でbackup.jsonの存在とサイズを確認
  ssh denkon5sd02@raspberrypi.local "ls -lh /opt/RaspberryPiSystem_002/config/backup.json"
  ```
- [ ] **APIヘルスチェック**: APIが正常に起動しているか確認
  ```bash
  # APIヘルスチェック
  curl -k https://raspberrypi.local/api/system/health
  ```
- [ ] **deploy-status API（キオスクデプロイ時）**: 端末別メンテ状態を確認する場合は `GET /api/system/deploy-status` に `x-client-key` を付与する（`/api/deploy-status` ではない）。詳細は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の実機検証チェックリストを参照。
- [ ] **管理コンソールの確認**: 管理コンソールで設定（Gmail、Dropbox）が正しく表示されているか確認
  - バックアップタブでGmail設定とDropbox設定が表示されているか
  - バックアップ履歴が継続して記録されているか
  - 黄色の警告が表示されていないか（[KB-168](../knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法)参照）
- [ ] **DB整合性チェック（重要）**: マイグレーション適用と必須テーブルの存在を確認。**デプロイ完了後、必ずマイグレーション状態を確認すること**（[KB-224](../knowledge-base/infrastructure/ansible-deployment.md#kb-224-デプロイ時のマイグレーション未適用問題)参照）。未適用のマイグレーションがある場合は、手動で`pnpm prisma migrate deploy`を実行する。
  ```bash
  # Pi5上で実行（マイグレーション状態の確認）
  cd /opt/RaspberryPiSystem_002
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status
  
  # 未適用のマイグレーションがある場合、手動で適用
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate deploy
  
  # マイグレーション履歴の確認
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
    psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT COUNT(*) FROM \"_prisma_migrations\";"
  
  # 必須テーブルの存在確認（例: MeasuringInstrumentLoanEvent）
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
    psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.\"MeasuringInstrumentLoanEvent\"') IS NOT NULL;"
  ```
- [ ] **ポート公開/不要サービス/監視の確認**: 不要なLISTEN/UNCONNが出ていないか、`ports-unexpected` がノイズ化していないか確認
  ```bash
  # LISTEN/UNCONN（プロセス込み）
  ssh denkon5sd02@raspberrypi.local "sudo ss -H -tulpen"

  # Dockerの公開状況（db/apiがホストへpublishされていないこと）
  ssh denkon5sd02@raspberrypi.local "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps"

  # security-monitor.timer が有効/稼働していること
  ssh denkon5sd02@raspberrypi.local "systemctl is-enabled security-monitor.timer && systemctl is-active security-monitor.timer"
  ```
  - 参考: [KB-177](../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ) / [port-security-audit.md](../security/port-security-audit.md)

### 初回セットアップ: 環境変数ファイルの作成

再起動後もIPアドレスが変わっても自動的に対応できるように、環境変数ファイルを作成します：

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 環境変数ファイルのサンプルをコピー
cp infrastructure/docker/.env.example infrastructure/docker/.env
cp apps/api/.env.example apps/api/.env 2>/dev/null || true

# .envファイルを編集（必要に応じて）
nano infrastructure/docker/.env
nano apps/api/.env
```

**重要**: 
- `.env`ファイルはGitにコミットされません（`.gitignore`に含まれています）。各ラズパイで個別に設定してください。
- 本番環境では、強力なパスワードを設定してください（`POSTGRES_PASSWORD`など）。パスワード生成方法: `openssl rand -base64 32`
- ファイルのパーミッションを設定（所有者のみ読み書き可能）: `chmod 600 infrastructure/docker/.env apps/api/.env`

**環境変数の管理方法**:
- `.env.example`ファイル: リポジトリに含まれるテンプレートファイル
- 手動でコピー: `.env.example`をコピーして`.env`を作成し、本番環境用の値を設定
- **Ansibleテンプレート**: Ansibleを使用する場合、`infrastructure/ansible/templates/docker.env.j2`から`.env`が再生成されます
  - ⚠️ **重要**: Ansibleで`.env`を再生成すると、テンプレートに含まれていない環境変数は削除されます
  - **永続化する方法**: 環境変数をAnsible管理化する（テンプレートに追加、inventoryに変数を追加、vaultに機密情報を追加）
  - **例**: 
    - `SLACK_KIOSK_SUPPORT_WEBHOOK_URL`はAnsible管理化済み（[KB-142](../knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url)参照）
    - `DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`、`DROPBOX_ACCESS_TOKEN`はAnsible管理化済み（[KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)参照）
    - `CSV_DASHBOARD_STORAGE_DIR`はCSVダッシュボード機能で使用（デフォルト: `/app/storage/csv-dashboards`、Ansible使用時はテンプレートに追加が必要、[KB-155](../knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了)参照）
  - **推奨**: 新しい環境変数を追加する場合は、Ansible管理化を検討してください
- **設定ファイルの管理**: `backup.json`などの設定ファイルは、APIが書き換える可能性があるため、Ansibleで上書きせず、存在保証と健全性チェックに留める（[KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)参照）
- **backup.jsonの保護機能**: `backup.json`の破壊的上書きを防ぐため、フォールバック設定の保存拒否と破壊的上書き防止ガードが実装されている（[KB-151](../knowledge-base/infrastructure/backup-restore.md#kb-151-backupjsonの破壊的上書きを防ぐセーフガード実装)参照）。設定ファイルが急激に縮小する（targets数が50%以上減る）場合や、フォールバック設定が保存されようとする場合、保存が拒否される。
- バックアップ: バックアップスクリプトで`.env`ファイルを自動バックアップ

詳細は [本番環境セットアップガイド](./production-setup.md#環境変数の管理) を参照してください。

### デプロイ前のUI検証（推奨）

**重要**: UI変更を行った場合は、デプロイ前にCursor内のブラウザで検証することで、デプロイ時間を短縮し、効率的にUI確認ができます。

詳細な手順は [開発ガイド](./development.md#ui検証デプロイ前推奨) を参照してください。

**簡易手順**:
1. ローカルでデータベースとAPIサーバー、Webアプリケーションを起動
2. Cursor内のブラウザで `http://localhost:5173` にアクセス
3. ログインしてUI変更を確認
4. 問題がなければデプロイを実行

### 方法1: デプロイスクリプトを使用（推奨）

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# mainブランチをデプロイ
./scripts/server/deploy.sh main

# 特定のブランチをデプロイ
./scripts/server/deploy.sh feature/new-feature
```

**デタッチ実行（長時間デプロイ向け）**:
```bash
# ラズパイ5で実行（デタッチ）
cd /opt/RaspberryPiSystem_002
bash ./scripts/server/deploy-detached.sh feature/new-feature

# 実行状態はログ/ステータス/exitで確認
ls -lt /opt/RaspberryPiSystem_002/logs/deploy/deploy-detached-*.status.json | head -3
```
**補足**:
- `deploy-detached.sh` は systemd-run が利用可能な場合は **ジョブ化して実行**します（不可の場合は `nohup` にフォールバック）

**Ansible経由デプロイのログ追尾**:
`scripts/update-all-clients.sh`で`--detach`モードを使用する場合、ログはリアルタイムで表示されません。以下の方法でログを追尾できます：

- **`--detach --follow`**: デプロイ開始後、`tail -f`でログをリアルタイム追尾
  ```bash
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach --follow
  ```

- **`--attach <run_id>`**: 既存のデタッチ実行のログをリアルタイム追尾
  ```bash
  ./scripts/update-all-clients.sh --attach 20260125-135737-15664
  ```

**ジョブ実行（systemd-run）**:
長時間デプロイを **端末切断に強く** 実行したい場合は `--job` を使用します。
- **`--job --follow`**: Pi5上でジョブ化して実行し、追尾する
  ```bash
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --job --follow
  ```
- **`--status <run_id>`**: ジョブの状態とunitステータスを確認（**Pi5 ターゲット時はデタッチ起動と同様に `RASPI_SERVER_HOST` が必須**。未設定だと `RASPI_SERVER_HOST is required` で停止する）
  ```bash
  ./scripts/update-all-clients.sh --status 20260125-135737-15664
  ```

詳細は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) を参照してください。

### 所要時間の目安と判定（運用目線）

**目安（通常時）**:
- **Pi5（サーバー）**: 10分前後（上限15分）
- **Pi4（キオスク）**: 5〜10分（上限10分）
- **Pi3（サイネージ）**: 10〜15分（上限30分）

**判定ルール（最低限）**:
- 上限内に完了しない場合は**「遅延」**として扱い、ログを確認する
- **`context canceled`** や `rpc error` が出た場合はビルド中断の可能性が高い

**ログからの所要時間確認**:
- `logs/ansible-history.jsonl` に **実行単位の所要時間** が記録されます（`durationSeconds`）。
```bash
# 直近の所要時間を確認（秒）
tail -n 5 /opt/RaspberryPiSystem_002/logs/ansible-history.jsonl
```

**補足**:
- 目安は「通常のコード変更＋Docker buildあり」を前提にした基準です
- 大きな差分や初回ビルド時は長くなる場合があります
  - 例: Docker build cacheの欠如、依存関係の追加など

**重要（反映漏れ防止）**:
- Ansible標準経路では、**コード更新があった場合に `api/web` を `--force-recreate --build` で再作成**します。
- これが「デプロイ成功＝変更が反映済み」の前提条件です。ビルドが重い場合は完了まで待機し、ログ/ステータスで確認してください。
- **Web bundleデプロイ修正（2026-02-03）**: `scripts/update-all-clients.sh`が`git pull`前後でHEADを比較し、変更があれば`force_docker_rebuild`フラグを設定します。これにより、Ansibleの`repo_changed`判定だけでは検出できないコード更新時でも、確実にDockerコンテナが再ビルドされます（[KB-227](../knowledge-base/infrastructure/ansible-deployment.md#kb-227-web-bundleデプロイ修正コード更新時のdocker再ビルド確実化)参照）。

**deploy.shの改善機能（2026-01-24実装）**:
- **サービスダウン状態の回避**: `docker compose down`を削除し、`build`→`up --force-recreate`に変更。ビルド完了後にコンテナを再作成することで、`down`成功後に`up`が失敗してもサービスダウン状態を回避します（[KB-193](../knowledge-base/infrastructure/ansible-deployment.md#kb-193-デプロイ標準手順のタイムアウトコンテナ未起動問題の徹底調査結果)参照）
- **中断時の自動復旧**: SSHセッション終了やプロセス中断時でも、`trap`でEXIT時に`docker compose up -d`を試行し、コンテナが起動していない状態を自動復旧します
- **ログ永続化**: デプロイ実行ログを`logs/deploy/deploy-sh-<timestamp>.log`に保存し、タイムアウト時でもログを確認可能です

**注意事項**:
- SSH経由で長時間実行する場合（Dockerビルドが数分かかる）、クライアント側のタイムアウト設定に注意してください。タイムアウトが発生した場合でも、`trap`による自動復旧が動作しますが、ログファイルで実行状況を確認してください
- デプロイログは`/opt/RaspberryPiSystem_002/logs/deploy/deploy-sh-<timestamp>.log`に保存されます

### ビルド時間短縮（任意・推奨）

**目的**: Docker buildのコンテキスト転送量を削減し、ビルド時間と`context canceled`のリスクを下げる。

**方針**:
- リポジトリルートの `.dockerignore` により、`node_modules/`, `logs/`, `storage/`, `alerts/`, `certs/`, `docs/` など **ビルド不要なディレクトリを除外**します。
- **重要**: `**/tsconfig.tsbuildinfo` と `**/*.tsbuildinfo` も除外します（[KB-218](../knowledge-base/infrastructure/ansible-deployment.md#kb-218-docker-build時のtsbuildinfo問題インクリメンタルビルドでdistが生成されない)参照）。
  - TypeScriptのインクリメンタルビルド情報（`tsbuildinfo`）がDockerにコピーされると、`tsc`が「変更なし」と判断してビルドをスキップし、`dist`が生成されない問題が発生します。
  - Docker内では常に新しいビルドを実行するため、`tsbuildinfo`を除外する必要があります。
- これにより **Pi5上のDocker buildが安定・短縮** します。

### 方法2: 手動で更新

**⚠️ 重要**: デプロイ前に必ず以下を確認してください：
1. **デプロイ前チェックリスト**: 上記の「デプロイ前チェックリスト」を必ず確認・実行してください
2. **リモートにプッシュ済みか確認**: `git log origin/<branch>`でリモートの最新コミットを確認
3. **ローカルとリモートの差分確認**: `git log HEAD..origin/<branch>`で差分を確認
4. **標準手順の遵守**: 以下の標準手順を必ず遵守してください（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)参照）

**重要**: デプロイは常に現在のブランチを使用します。`main`ブランチにマージするのは別途指示がある場合のみです。

```bash
# 1. リポジトリを更新（現在のブランチを使用）
cd /opt/RaspberryPiSystem_002
CURRENT_BRANCH=$(git branch --show-current)
git pull origin "$CURRENT_BRANCH"

# 2. IPアドレスが変わった場合は.envファイルを更新
# （初回のみ）環境変数ファイルを作成
if [ ! -f infrastructure/docker/.env ]; then
  cp infrastructure/docker/.env.example infrastructure/docker/.env
  echo "⚠️  infrastructure/docker/.env ファイルを作成しました。IPアドレスを確認して編集してください。"
fi

# 3. Docker Composeで再ビルド・再起動（重要: --force-recreateでコンテナを再作成）
# Webコンテナを再ビルドする場合（IPアドレスが変わった場合など）
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web

# APIコンテナのみを再ビルドする場合
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build api

# または、個別に実行する場合：
# docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api
# docker compose -f infrastructure/docker/docker-compose.server.yml stop api
# docker compose -f infrastructure/docker/docker-compose.server.yml rm -f api
# docker compose -f infrastructure/docker/docker-compose.server.yml up -d api

# 4. 動作確認
curl http://localhost:8080/api/system/health

# 5. デプロイ後チェックリスト: 上記の「デプロイ後チェックリスト」を必ず確認してください
```

**重要**: 
- **標準手順の遵守**: `--force-recreate --build`を1コマンドで実行してください。分割して実行すると、変更が反映されない可能性があります（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)参照）。
- `docker compose restart`では新しいイメージが使われません。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成してください。
- `VITE_API_BASE_URL`は相対パス（`/api`）に設定されているため、再起動後もIPアドレスが変わっても問題ありません。
- `VITE_AGENT_WS_URL`は環境変数ファイル（`.env`）で管理できるため、IPアドレスが変わった場合は`.env`ファイルを更新してからWebコンテナを再ビルドしてください。
- **Pi5のstatus-agent設定**: Pi5サーバー側のstatus-agent設定はAnsibleで管理されています（[KB-129](../knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま)参照）。`inventory.yml`の`status_agent_*`変数と`host_vars/raspberrypi5/vault.yml`の`vault_status_agent_client_key`が設定されていれば、Ansible実行時に自動的に設定ファイルが更新されます。
- **環境変数の空文字問題**: `docker-compose.server.yml`で`${VAR:-}`構文を使用する場合、環境変数が未設定でも空文字が注入されるため、Zodバリデーションで`z.preprocess`を使用して空文字を`undefined`に変換する必要があります（[KB-131](../knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題)参照）。APIコンテナが再起動ループに陥る場合は、環境変数のバリデーションエラーを確認してください。
- **Prisma Client再生成の注意**: データベースマイグレーション適用後、APIコンテナ内でPrisma Clientを再生成する必要がある場合があります。マイグレーションが適用されても、コンテナ内のPrisma Clientが古いスキーマを参照している場合は、以下のコマンドで再生成してください（[KB-150](../knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了)参照）:
  ```bash
  # APIコンテナ内でPrisma Clientを再生成
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma generate
  
  # APIコンテナを再起動
  docker compose -f infrastructure/docker/docker-compose.server.yml restart api
  ```

## ラズパイ4（クライアント/NFCエージェント）の更新

**重要**: Pi4デプロイ時にファイルが見つからないエラーや権限エラーが発生する場合は、[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)を参照してください。

**重要（2026-01-03更新）**: 
- Pi4の`status-agent`は`https://<Pi5>/api`経由でAPIにアクセスします（Caddy経由）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）
- `status-agent.conf`の`API_BASE_URL`は自動的に`https://<Pi5>/api`に設定されます（Ansibleが`group_vars/all.yml`の`api_base_url`を使用）

**重要（2026-03-06更新）**: 
- **Pi4デプロイ時のメンテナンス画面表示（端末別）**: デプロイ対象のキオスク端末のみメンテナンス画面が表示されます
  - **端末別フラグ**: `--limit` で対象に入ったキオスクのみメンテ表示。対象外端末は通常画面のまま
  - **プリフライト後フラグON**: 到達確認（プリフライト）成功後にのみフラグを立てる。到達不可端末にはフラグを立てない
  - デプロイスクリプト（`scripts/update-all-clients.sh`）が自動的にメンテナンスフラグを設定・クリアします
  - デプロイ完了後、対象端末のメンテナンス画面は自動的に消えます（最大5秒以内）
  - **強制解除**: メンテ画面が戻らない場合は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照
  - 詳細は [ADR-20260306](../decisions/ADR-20260306-deploy-status-per-client-maintenance.md) / [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) を参照

**重要（2026-02-07更新）**:
- **段階展開（カナリア→全台）**を推奨します（Pi4が増えた場合の安全策）
  - inventoryに `kiosk` / `signage` / `kiosk_canary` / `signage_canary` グループを用意しています
  - **カナリア成功後はPi4全台を並行デプロイ**、**Pi3は常時単独**の運用を想定しています
  - `scripts/update-all-clients.sh` のデプロイ後ヘルスチェックは `--limit` に追従します（カナリア時に全台チェックで時間が伸びるのを防止）

例（推奨）:

```bash
# Stage 0: カナリア（server + kiosk_canary）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk_canary"

# Stage 1: ロールアウト（server + kiosk 全台、カナリア除外）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk:!kiosk_canary"

# Pi3（signage）は常時単独で実行（server + signage）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:signage"
```

**重要（2026-02-07更新）**:
- **Docker build最適化**: 変更ファイルに基づいてDocker buildの必要性を判定し、不要なbuildをスキップします
  - **buildが必要な変更**: `apps/api/**`, `apps/web/**`, `packages/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `infrastructure/docker/**`, `apps/api/prisma/**`
  - **build不要な変更**: `docs/**`, `infrastructure/ansible/**`（`infrastructure/docker/**` を除く）, `scripts/**`（Dockerに影響しない場合）
  - 判定ロジックは `scripts/update-all-clients.sh` と `infrastructure/ansible/roles/common/tasks/main.yml` の両方で実装（二重安全）
  - 判定できない場合は安全側でbuild実行（初回clone/HEAD不明など）
  - 効果: カナリアで **6分34秒 → 3分11秒（約3分23秒短縮）**を確認（[KB-235](../knowledge-base/infrastructure/ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定)参照）
- **apt cache最適化**: 同一デプロイ内で`apt update`が複数回実行される無駄を削減します
  - `group_vars/all.yml`の`apt_cache_valid_time_seconds: 3600`により、最後の`apt update`から1時間以内はキャッシュが有効
  - `ansible.builtin.apt`タスクに`cache_valid_time`を追加し、`update_cache: true`は維持（判定不能時は安全側で更新）
  - 対象: kiosk/serverのセキュリティ系パッケージ（ClamAV/rkhunter/ufw/fail2ban）
  - 効果: 同一デプロイ内で最初の`apt update`以降はキャッシュが有効になり、apt関連タスクが若干短縮（例: `server : Install security packages` 4.51s → 3.46s）
  - 詳細は [KB-234](../knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策) を参照

**重要（2026-03-01更新）**:
- **Pi4キオスクの電源操作**: キオスク画面の「再起動」「シャットダウン」ボタンは、Pi5 API経由で電源操作を実行します
  - フロー: Pi4キオスク UI → `POST https://<Pi5>/api/kiosk/power`（`x-client-key`付き）→ Pi5 API が `power-actions` に JSON 書き込み → `pi5-power-dispatcher`（systemd path unit）が検知 → Ansible で Pi4 に SSH 接続し `systemctl reboot` / `poweroff` を実行
  - 遅延の目安: poweroff 約20秒、reboot 約85秒（多段構成による）。詳細は [KB-285](../knowledge-base/infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる) を参照
- **Mixed Content回避**: キオスクは `https://<Pi5>/kiosk` で開くため、Pi4のChromium起動フラグに `--allow-running-insecure-content` と `--unsafely-treat-insecure-origin-as-secure=http://localhost:7071` を設定します
- **NFC WebSocket（増台対応）**: キオスク画面は `ws://localhost:7071/stream`（自端末のNFCエージェント）に **localOnly** で接続し、Pi5経由の`/stream`へはフォールバックしません（端末分離と横漏れ防止のため）。
- **OS権限**: Pi4のAnsible設定で `sudo_nopasswd_commands` に `/usr/bin/systemctl reboot` と `/usr/bin/systemctl poweroff` を含めてください

```bash
# 1. リポジトリを更新
cd /opt/RaspberryPiSystem_002
git pull origin main

# 2. NFCエージェントの依存関係を更新（必要に応じて）
cd clients/nfc-agent
poetry install

# 3. 既存のNFCエージェントプロセスを停止
# （実行中の場合は Ctrl+C で停止、または別のターミナルで）
pkill -f "python -m nfc_agent"

# 4. NFCエージェントを再起動
poetry run python -m nfc_agent

# 5. 動作確認
curl http://localhost:7071/api/agent/status
# "queueSize": 0 が表示されればOK
```

## ラズパイ3（サイネージ）の更新

**重要**: Pi3はメモリが少ない（1GB、実質416MB）ため、デプロイ時にサイネージ関連サービスを停止してメモリを確保する必要があります。**この停止処理はプレフライトチェックで自動実行**されます。

**重要（2026-01-03更新）**: 
- Pi3のサイネージデザイン変更（左ペインタイトル、温度表示）は**Pi5側のデプロイのみで反映**されます
- Pi3へのデプロイは不要です（サーバー側レンダリングのため）
- Pi3の`status-agent`は`https://<Pi5>/api`経由でAPIにアクセスします（Caddy経由）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）

**知見（2026-04-01）**: キオスク進捗一覧を Pi3 で FULL 表示する **`kiosk_progress_overview`** スロットは、JPEG 生成が Pi5（API）側のため **Pi5 デプロイで契約・レンダラーが更新**されます。スケジュール定義や `signage-lite` クライアント側の更新が必要な場合は **Pi3 も `--limit raspberrypi3`** で順次デプロイしてください。運用手順・実機検証・一時的な `signage-lite` exit-code は [KB-321](../knowledge-base/infrastructure/signage.md#kb-321-キオスク進捗一覧スロットkiosk_progress_overviewのサイネージ表示デプロイ実機検証) を参照。

**重要（2026-01-16更新）**: 
- デバイスタイプ汎用化により、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能になりました
- デバイスタイプごとの設定は`group_vars/all.yml`の`device_type_defaults`で管理されています
- 新しいデバイスタイプを追加する場合は、`device_type_defaults`に設定を追加し、inventoryファイルに`device_type`を指定してください

### デプロイ前の準備（自動化済み）

**✅ 自動化**: サイネージ端末デプロイ時のプレフライトチェックと復旧（lightdm + signage-lite再開）は**自動的に実行**されます（2026-01-16更新）。以下の手順を手動で実行する必要はありません。

**自動実行されるプレフライトチェック**:
1. **コントロールノード側（Pi5上）**: Ansibleロールのテンプレートファイル存在確認（`roles/signage/templates/`）
2. **サイネージ端末側（デバイスタイプごとに設定）**: 
   - サービス停止・無効化（`signage-lite.service`, `signage-lite-update.timer`, `signage-lite-watchdog.timer`, `signage-daily-reboot.timer`, `status-agent.timer`）
   - サービスmask（`signage-lite.service`の自動再起動防止）
   - **lightdm停止**（デバイスタイプに応じて。Pi3/Pi Zero 2WではGUIを停止して約100MBのメモリを確保）（[KB-169](../knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動)参照）
   - 残存AnsiballZプロセスの掃除（120秒以上経過したもの）
   - メモリ閾値チェック（`group_vars` / `device_type_defaults` の **`memory_required_mb`**。機種により異なり、Pi3 / Pi Zero 2W は **100MB** 等の設定あり。旧「>= 120MB」は汎用デフォルトの一例。詳細は [KB-341](../knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy) 追記）

**デプロイ完了後の自動処理（post_tasks）**:
- **GUI/サイネージ自動復旧**: lightdmを停止した場合、デプロイ完了後に`lightdm`と`signage-lite.service`を再開して復旧します（reboot不要）
- **サイネージサービス確認**: 復旧後、`signage-lite.service`がactiveになるまで最大60秒待機し、結果をログ出力します

**⚠️ Pi3デプロイ時の`unreachable=1`について（2026-01-30追記）**:
- Pi3デプロイ実行後、`PLAY RECAP`で`raspberrypi3: unreachable=1`が表示される場合があります
- これは`post_tasks`フェーズの最後の2タスク（`signage-lite-watchdog.timer`、`signage-daily-reboot.timer`）で一時的なSSH接続問題が発生したことを示します
- **重要**: デプロイ全体が`failed=0`で`state: success`なら、主要目的（コード更新、サービス再起動、GUI/サイネージ復旧）は達成されています
- サービス状態は`systemctl is-active`で直接確認してください（ログの`unreachable`だけでは判断しない）
  ```bash
  # NOTE: Pi3のTailscale IPは変わることがあるため、到達先はPi5の`tailscale status`で確認してください
  ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite-watchdog.timer signage-daily-reboot.timer'"
  # 結果が "active active" なら正常動作中
  ```
- 詳細は [KB-216](../knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) を参照してください

### 知見（2026-04-13）: Pi3 Ansible 安定化（`main`・resource-guard / lightdm・become）

- **preflight と resource-guard**: `resource-guard` が **`memory_required_mb`** を参照するよう整理（[PR #131](https://github.com/denkoushi/RaspberryPiSystem_002/pull/131)）。Pi3 / Pi Zero 2W の閾値は **100MB**（[PR #132](https://github.com/denkoushi/RaspberryPiSystem_002/pull/132)）。
- **`lightdm` 停止と `signage-lite` 再起動順**: `stop_lightdm` 判定の堅牢化と、**`client` が `lightdm` 停止中に `signage-lite` を再起動しない**（[PR #133](https://github.com/denkoushi/RaspberryPiSystem_002/pull/133)）。
- **become タイムアウト**: [KB-087](../knowledge-base/infrastructure/signage.md#kb-087-pi3-status-agenttimer-再起動時のsudoタイムアウト) に加え、inventory の **`ansible_become_timeout: 120`**（[PR #134](https://github.com/denkoushi/RaspberryPiSystem_002/pull/134)）。
- **記録・実績**: [KB-341](../knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy) 第3回追記。**Detach Run ID** 例: `20260413-222626-2374`（`raspberrypi3`・`failed=0` / `unreachable=0`）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。

**プレフライトチェックが失敗した場合**:
- メモリ不足（`memory_required_mb` 未満）: デプロイは自動的に中断され、エラーメッセージに手動停止手順が表示されます
- テンプレートファイル不足: デプロイ開始前にfail-fastし、エラーメッセージにファイル配置場所が表示されます

**手動実行が必要な場合（プレフライトチェック失敗時）**:
```bash
# メモリ不足の場合のみ、手動でサービスを停止・無効化（自動再起動防止）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop signage-lite.service signage-lite-update.timer signage-lite-watchdog.timer signage-daily-reboot.timer status-agent.timer && sudo systemctl disable signage-lite.service signage-lite-update.timer signage-lite-watchdog.timer signage-daily-reboot.timer status-agent.timer'"

# さらに自動再起動を完全に防ぐ（ランタイムマスク）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl mask --runtime signage-lite.service'"

# デバイスタイプによりGUI(lightdm)を停止してメモリを確保（Pi3 / Pi Zero 2W等）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop lightdm || true'"

# 数秒待ってからメモリを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sleep 5 && free -m'"

# メモリが閾値（Pi3 等は 100MB 設定の例あり）以上になったら、再度デプロイを実行
```

**重要**: 
- プレフライトチェックにより、デプロイは**手順遵守に依存せず**、自動的に安全な状態で実行されます
- Pi3デプロイは10-15分以上かかる可能性があります。リポジトリが大幅に遅れている場合や、メモリ不足の場合はさらに時間がかかります（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
- **Ansibleロールのテンプレート配置**: `signage`ロールのテンプレートファイルは`infrastructure/ansible/roles/signage/templates/`に配置する必要があります。`infrastructure/ansible/templates/`にのみ配置していると、デプロイ時にテンプレートファイルが見つからず失敗します（[KB-153](../knowledge-base/infrastructure/ansible-deployment.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足)参照）

### Ansibleを使用したデプロイ（推奨）

#### Macから全クライアントを一括更新

**⚠️ デプロイ前の必須チェック**:
1. [ネットワークモード設定の確認](#ネットワーク環境の確認デプロイ前必須)（最重要）
2. [デプロイ前チェックリスト](#デプロイ前チェック)の確認

```bash
# Macのターミナルで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 環境変数を設定（Pi5のTailscale IPを指定）
# 注意: ローカルIPはネットワーク環境によって変動するため、Tailscale IPを使用
# 環境変数の設定（Pi5のTailscale IPを指定）
# ⚠️ 重要: ユーザー名を含める形式（denkon5sd02@...）を推奨
# ユーザー名を省略した場合、スクリプトがinventory.ymlから自動取得しますが、
# inventory.ymlが読み込めない場合はデフォルトユーザー名（denkon5sd02）が使用されます
# ⚠️ 必須: Pi5へのデプロイ時は、必ずRASPI_SERVER_HOSTを設定してリモート実行してください
# ansible_connection: localでも、Mac側からansible-playbookを実行するとMac側のsudoパスワードが求められます
# RASPI_SERVER_HOSTを設定することで、Pi5上でリモート実行され、Pi5上のansible.cfgが正しく読み込まれます
# 詳細は [KB-233](../knowledge-base/infrastructure/ansible-deployment.md#kb-233-デプロイ時のsudoパスワード問題ansible_connection-localでもmac側から実行される場合) を参照
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"

# または、ユーザー名を省略した形式（スクリプトが自動補完）
# export RASPI_SERVER_HOST="100.106.158.2"  # スクリプトが自動的に denkon5sd02@100.106.158.2 に変換

# mainブランチで全デバイス（Pi5 + Pi3/Pi4）を更新（第2工場）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# mainブランチで全デバイスを更新（トークプラザ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 特定のブランチで全デバイスを更新（第2工場）
./scripts/update-all-clients.sh feature/rigging-management infrastructure/ansible/inventory.yml
```

#### デタッチ実行（長時間デプロイ向け・推奨）

**ポイント**:
- Mac/SSH経由の実行はクライアント側タイムアウトで「途中停止して見える」ことがあります。
- `scripts/update-all-clients.sh` の **リモート実行はデフォルトでデタッチ**されます（Pi5側で処理が継続）。
- **明示 `--detach` / `--job`**: Mac から実行する場合、`RASPI_SERVER_HOST` が未設定だと `[ERROR] --detach requires RASPI_SERVER_HOST (remote Pi5).` で停止します。先に `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` を設定してください（[KB-238](../knowledge-base/infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加) と併せて理解）。
- 前景で実行したい場合は **`--foreground` を明示**してください（長時間は非推奨）。
- 進捗は `--attach` / `--status` で確認できます。

**デプロイモードの判断基準（2026-02-01更新）**:
- **Pi5のみ**: 前景実行も可能（短時間のみ。原則はデタッチ）
- **Pi5 + Pi4以上**: `--detach --follow`必須（15-20分以上かかるためタイムアウトする）
- **全デバイス**: `--detach --follow`必須（30分以上かかるためタイムアウトする）

**デプロイ対象の判断基準（2026-02-01更新）**:
- **Webアプリのみ**: 通常は Pi5 + Pi4（`--limit "raspberrypi5:raspberrypi4"`）。**`Dockerfile.web` / server `web` のみ**の変更で Pi4 に `web` を載せていない／更新不要なら **Pi5 のみ**（`--limit raspberrypi5`）で足りる（2026-04-04・`go-jose` 対応後に `./scripts/deploy/verify-phase12-real.sh` **PASS 43/0/0**・約 100s を確認。[ci-cd の Caddy 追記](../knowledge-base/ci-cd.md)）。
- **API/DBのみ**: Pi5のみ（`--limit raspberrypi5`）
- **Ansible のみ（例: `docker.env.j2` + Pi5 `inventory` の env 配線）**: コード変更が Pi5 のみのときも **Pi5 のみ**（`--limit raspberrypi5`）。**写真持出**: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*` はテンプレに存在しても **inventory で `photo_tool_label_assist_active_*` を vault から渡す**必要がある（欠落時は常に既定 OFF。[KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)「Ansible 配線（`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*`…）」）。
- **写真持出・env の緊急反映（Pi5 のみ・非推奨の例外）**: `infrastructure/docker/.env` を Pi5 上で直接更新した場合は **`docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api`** で API に読み直させる。**vault / Ansible 生成物とドリフト**しうるため、恒久は上記 **`--limit raspberrypi5`** デプロイで揃える。手順・検証・実測は [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)「本番オペレーション: アクティブ補助の有効化（Pi5・2026-04-09）」。
- **サイネージ関連**: Pi5のみ（サーバー側レンダリングのため）
- **Pi3固有の設定**: Pi3のみ（`--limit raspberrypi3`）

**サイネージ持出カードグリッド（HTML/CSS + Playwright）反映条件**:
- コード反映だけでは不十分です。Pi5 API コンテナへ **`SIGNAGE_LOAN_GRID_ENGINE=playwright_html`** が入って初めて新描画になります。
- 標準手順では `infrastructure/ansible/templates/docker.env.j2` と inventory/host_vars の **`api_signage_loan_grid_engine`** で管理してください。
- 反映確認は Pi5 上で `docker compose ... exec -T api /bin/sh -lc 'echo $SIGNAGE_LOAN_GRID_ENGINE'` を実行し、`playwright_html` を確認します。
- ロールバックは `api_signage_loan_grid_engine: "svg_legacy"` に戻して **Pi5 のみ再デプロイ**します。
- 「デプロイは成功したが JPEG が旧レイアウトのまま」は **API コンテナへ env が入っていない**典型です。切り分けは [KB-327](../knowledge-base/infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ)。

**知見（2026-03-06）**: 事前に「今回の実装が影響する端末」（例: Pi5 + Pi4×4）を挙げても、標準手順は inventory 全デバイス（Pi5 + Pi4×4 + Pi3）を対象とする。効率化したい場合は「対象デバイスだけデプロイせよ」と指示し、`--limit "server:kiosk"` で実行する運用が有効。

**知見（2026-03-09）**: `--limit "server:kiosk"` で Pi5 + Pi4 を並列デプロイ中、Pi5 フェーズ完了後に Pi4 キオスクフェーズでハングする事象が発生した（[KB-300](../knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時)）。**再発防止（2026-03-09 適用済み）**: Pi4 は常時 1 台ずつ直列実行（`deploy_serial.kiosk: 1`）に変更済み。ハング発生時は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「Pi4デプロイハング時の復旧手順」に従い、ハングプロセスを停止・ロック解除後、Pi4 を単体で `--limit "raspberrypi4"` / `--limit "raspi4-robodrill01"` により再デプロイする。

**1台ずつ順番デプロイ（推奨運用）**: Pi5 + Pi4×4 を確実に更新したい場合は、`--limit` で 1 台ずつ順番に実行する運用を推奨。Pi5 → raspberrypi4 → raspi4-robodrill01 → raspi4-fjv60-80 → raspi4-kensaku-stonebase01 の順で、前のデプロイが成功してから次を実行する。

**重要（2026-04-03 追記）**:
- **成功判定は `PLAY RECAP` を正本**とし、`failed=0` かつ `unreachable=0` を確認する。Pi5 の `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.summary.json` も **`totalHosts > 0` / `failedHosts=[]` / `unreachableHosts=[]`** で一致していること。
- `prisma migrate deploy` が **`service "api" is not running`** で失敗した場合、すぐに「migration 問題」と決めつけない。まず Pi5 で `docker compose -f infrastructure/docker/docker-compose.server.yml ps -a` を見て、`api` / `web` が **`Created`** で止まっていないか、bind mount error がないかを確認する。
- `part-measurement-drawings` のような **新しい bind mount** を追加した直後は、host 側ディレクトリ未作成で初回起動に失敗し得る。標準手順では server ロールがディレクトリ作成と `docker compose ... up -d api web` を migrate 前に実行して **rerun を自動復旧**する。
- **計測機器ジャンル点検画像**（`storage/measuring-instrument-genres`）も同様に **`docker-compose.server.yml` でホストへ bind** し、server ロールで **`/opt/RaspberryPiSystem_002/storage/measuring-instrument-genres` を事前作成**する。恒久化前にコンテナ内だけへ保存されていたファイルは、**api 再作成前**の Ansible タスクでホストへ **best-effort 退避**する（既存ホストファイルは上書きしない）。

**重要（2026-03-29 追記）**: 同一 `RASPI_SERVER_HOST`（Pi5）向けに **`update-all-clients.sh` を複数ターミナルから同時起動しない**。2026-03-29 の hardening 後は、Mac 側で `logs/.update-all-clients.local.lock` を使ったローカル排他と、Pi5 側で `/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock`（JSON）を使った排他が有効。**2重起動はエラーで停止**するため、解除せずに 1 本目の完了を待つこと。複数台へ配るときは **必ず 1 本のシェルで順次**（`cmd1 && cmd2`）とする。

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
# 1台目: Pi5
./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspberrypi5" --detach --follow
# 2台目: Pi4 研削メイン（1台目成功後）
./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspberrypi4" --detach --follow
# 3台目: Pi4 RoboDrill01（2台目成功後）
./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspi4-robodrill01" --detach --follow
# 4台目: Pi4 FJV60/80（3台目成功後）
./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspi4-fjv60-80" --detach --follow
# 5台目: Pi4 Kensaku StoneBase01（4台目成功後）
./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspi4-kensaku-stonebase01" --detach --follow
```

詳細は [KB-226](../knowledge-base/infrastructure/ansible-deployment.md#kb-226-デプロイ方針の見直しpi5pi4以上はdetach-follow必須) を参照。

```bash
# 第2工場: デタッチ実行（デフォルトでデタッチ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# トークプラザ: デタッチ実行（デフォルトでデタッチ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 前景実行（短時間のみ。長時間は非推奨）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --foreground

# ログ追尾（run_idを指定）
./scripts/update-all-clients.sh --attach 20260125-123456-4242

# 状態確認（run_idを指定）
./scripts/update-all-clients.sh --status 20260125-123456-4242
```

#### デプロイの所要時間を計測する（profile_tasks/timer）

「どのタスクが遅いか」を秒で確定したい場合は、`--profile` を付けて実行します。
通常のデプロイ挙動は変えず、**出力にタスクごとの所要時間（上位）が追加**されます。

```bash
# 例: カナリア（server + kiosk_canary）を計測付きで実行
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk_canary" --profile
```

読み方（目安）:
- `profile_tasks` の出力で **上位（遅い順）に並ぶタスク**が“時間の主犯”
- 主犯が `apt update` / `docker build` / `git fetch` / `uri health check` / `tailscale` などのどれかを確定してから、最小変更で削減する

**重要**: 
- `scripts/update-all-clients.sh`はPi5も含めて更新します
- **ブランチ指定は必須です**（デフォルトブランチはありません。誤デプロイ防止のため）
- **デプロイはPi5が `origin/<branch>` をpullして実行**します（ローカル未commit/未pushの変更はデプロイされません）。その状態で実行すると、スクリプトが **fail-fastで停止**します。
  - 対処: 変更をcommit → push → GitHub Actions CIが成功 → そのブランチ名で再実行
- **スクリプト実行前に、Pi5上の`network_mode`設定が正しいことを確認してください**（スクリプトが自動チェックします）

#### デプロイ安定化機能（2026-01-17実装）

`scripts/update-all-clients.sh`には以下のデプロイ安定化機能が実装されています：

1. **プリフライトリーチビリティチェック**:
   - デプロイ開始前にPi5へのSSH接続を確認
   - Pi5からinventory内の全ホストへの接続を`ansible -m ping`で確認
   - 接続不可の場合はデプロイを中断（エラーコード3）

2. **ロック（並行実行防止）**:
   - **ローカルロック（Mac）**: `logs/.update-all-clients.local.lock` を `mkdir` で取得し、同一端末での多重起動を防止
   - **リモートロック（Pi5）**: `/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock` に JSON（`runId` / `runPid` / `state` / `runner`）を書き、Pi5 上での多重起動を防止
   - stale 判定は **`runPid` 生存確認（`kill -0`）+ `ansible-playbook` 実行中確認 + 経過時間（既定 2400 秒）** で実施
   - ロック取得失敗時はデプロイを中断（エラーコード3）
   - 手動でロックを消す場合は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の **`runPid` 非生存を確認してから** の手順に従うこと

3. **リソースガード**:
   - デプロイ前に各ホストのリソースをチェック
   - メモリ: 120MB未満の場合はデプロイを中断
   - ディスク: `/opt`の使用率が90%以上の場合はデプロイを中断
   - 詳細は`infrastructure/ansible/tasks/resource-guard.yml`を参照

4. **環境限定リトライ**:
   - unreachable hostsのみを対象にリトライ（最大3回、30秒間隔）
   - タスク失敗（failed hosts）はリトライしない（環境問題とコード問題を区別）
   - `--limit`オプションで特定ホストのみリトライ可能

5. **ホストごとのタイムアウト**:
   - Pi3: 30分（リポジトリ更新が遅い場合を考慮）
   - Pi4: 10分
   - Pi5: 15分
   - タイムアウト設定は`infrastructure/ansible/inventory.yml`の`ansible_command_timeout`で管理

6. **通知（alerts一次情報 + Slackは二次経路）**:
   - デプロイ開始/成功/失敗/ホスト単位失敗のタイミングで **`alerts/alert-*.json`（一次情報）** を生成します
   - **Slack通知（チャンネル分離）はAPIのAlerts Dispatcherが担当**します（B1方針）
     - scripts側は原則「ファイル生成」に専念し、Slackはログ/運用イベントの二次経路として配送します
     - Slack配送を有効化するには、API側で `ALERTS_DISPATCHER_ENABLED=true` と `ALERTS_SLACK_WEBHOOK_*` の設定が必要です

7. **`--limit`オプション対応**:
   - 特定ホストのみを更新する場合に使用
   - 例: `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi3`
   - プリフライトチェックとリトライにも適用される

**実機検証状況**:
- ✅ Pi5でのデプロイ成功を確認（2026-01-18）
- ✅ Pi4でのデプロイ成功を確認（2026-01-19、[KB-182](../knowledge-base/infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認)参照）
- ✅ プリフライト・ロック・リソースガードの動作を確認（Pi5、Pi4）
- ✅ 並行実行ロック（2026-03-30）: ローカル + Pi5 JSON ロック・stale 判定強化を Pi5 のみデプロイで踏襲確認。`./scripts/deploy/verify-phase12-real.sh` **PASS 35 / WARN 2 / FAIL 0**（FJV が Pi5 から SSH 不可のとき WARN・[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 注記）
- ⚠️ リトライ機能は未検証（実運用では問題なく動作する見込み）
- ⚠️ Slack通知は「alerts生成」までは確認済みだが、Slack配送（API Dispatcher）設定の有無に依存するため、Slackアプリ着弾は要確認

詳細は [KB-172](../knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) を参照。

#### Slack通知のチャンネル分離（2026-01-18実装）

**概要**: Slack通知を4系統（deploy/ops/security/support）に分類し、それぞれ別チャンネルに着弾させることで、運用上の見落としとノイズを削減します。

**チャンネル構成**:
- `#rps-deploy`: デプロイ関連アラート（`ansible-update-*`, `ansible-health-check-*`）
- `#rps-ops`: 運用関連アラート（`storage-*`, `csv-import-*`、デフォルト）
- `#rps-security`: セキュリティ関連アラート（`role_change`等）
- `#rps-support`: サポート関連アラート（`kiosk-support*`、キオスクサポート直送）

**設定手順**:
1. **Slack側でチャンネル作成とIncoming Webhook取得**:
   - ✅ 各チャンネル（`#rps-deploy`, `#rps-ops`, `#rps-security`, `#rps-support`）を作成済み
   - 各チャンネルのIncoming Webhook URLを取得（詳細は [Slack Webhook URL設定手順](./slack-webhook-setup.md) を参照）

2. **Ansible VaultにWebhook URLを登録**:
   ```bash
   # Pi5のvault.ymlを編集（ansible-vaultで暗号化）
   ansible-vault edit infrastructure/ansible/host_vars/raspberrypi5/vault.yml
   ```
   
   以下の変数にWebhook URLを設定:
   ```yaml
   vault_alerts_slack_webhook_deploy: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_ops: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_security: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_support: "https://hooks.slack.com/services/..."
   ```
   
   **キオスクサポート直送もsupportチャンネルへ**:
   ```yaml
   vault_slack_kiosk_support_webhook_url: "https://hooks.slack.com/services/..."  # supportチャンネルのWebhook URL
   ```

3. **デプロイ実行**:
   ```bash
   ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
   ```
   
   デプロイ後、`infrastructure/docker/.env`に以下の環境変数が設定されます:
   - `ALERTS_DISPATCHER_ENABLED=true`
   - `ALERTS_SLACK_WEBHOOK_DEPLOY=...`
   - `ALERTS_SLACK_WEBHOOK_OPS=...`
   - `ALERTS_SLACK_WEBHOOK_SECURITY=...`
   - `ALERTS_SLACK_WEBHOOK_SUPPORT=...`

4. **自動反映**（Ansibleが`.env`更新時にapiを再作成）:
   - `.env`が更新された場合、Ansibleが`api`コンテナを`--force-recreate`で再作成して環境変数を反映
   - 反映後に環境変数の検証を行い、不足があればfail-fastでデプロイを停止

**動作確認**:
- 各routeKeyのテストアラートを生成して、正しいチャンネルに着弾することを確認:
  ```bash
  # deployチャンネル確認
  ./scripts/generate-alert.sh ansible-update-failed "テスト: デプロイ失敗" "テスト用"
  
  # opsチャンネル確認
  ./scripts/generate-alert.sh storage-usage-high "テスト: ストレージ使用量警告" "テスト用"
  
  # securityチャンネル確認（API経由）
  # 管理画面でユーザーのロールを変更すると、role_changeアラートが生成されます
  
  # supportチャンネル確認
  ./scripts/generate-alert.sh kiosk-support-test "テスト: キオスクサポート" "テスト用"
  ```

**注意事項**:
- 未設定（空文字）のrouteKeyのアラートはSlackに送信されません（ファイル生成のみ）
- Generalチャンネルは「フォールバック/人間向け雑談」として残しておくことを推奨
- 新しいアラートtypeを追加する場合は、`apps/api/src/services/alerts/alerts-config.ts`の`routing.byTypePrefix`にprefixを追加して分類を固定してください

**実機検証完了（2026-01-18）**:
- ✅ `#rps-deploy`: `ansible-update-failed`アラート受信確認
- ✅ `#rps-ops`: `storage-usage-high`アラート受信確認
- ✅ `#rps-security`: `role_change`アラート受信確認
- ✅ `#rps-support`: `kiosk-support-test`アラート受信確認

**トラブルシューティング**:
- デプロイが環境変数検証で失敗する場合は、VaultのWebhook設定を確認（未設定/空文字が原因）
- 既存の手動回避策は [KB-176](../knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) に整理済み（標準手順では不要）

**関連ドキュメント**:
- [Slack Webhook URL設定手順](./slack-webhook-setup.md) - 詳細な設定手順とトラブルシューティング
- [Alerts Platform Phase2設計](../plans/alerts-platform-phase2.md)
- [KB-172](../knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト)
- [KB-176](../knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題)

#### Pi5から特定のクライアントのみ更新

```bash
# Pi5から実行
cd /opt/RaspberryPiSystem_002/infrastructure/ansible

# Pi3へのデプロイを実行（mainブランチを指定）
ANSIBLE_REPO_VERSION=main \
  ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3

# 特定のブランチでPi3を更新
ANSIBLE_REPO_VERSION=feature/rigging-management \
  ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3
```

### デプロイ後の確認

```bash
# デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）

# 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
# サービスが正常に動作していることを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"
# → active を確認（Ansibleが自動的に再有効化している）

# 画像が更新されていることを確認
# 注意: 軽量サイネージは tmpfs の `/run/signage/current.jpg` を表示・更新します（SD書込み削減）。
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -lh /run/signage/current.jpg'"
```

**重要**: 
- デプロイ完了後は、Ansibleが自動的に`signage-lite.service`と`signage-lite-update.timer`を再有効化・再起動します。手動で`systemctl enable`や`systemctl start`を実行する必要はありません
- デプロイ前のプレフライトチェックで、Ansibleが自動的にサービスを停止・無効化・ランタイムマスクします（[KB-086](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題)、[KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)参照）

**トラブルシューティング**:
- **デプロイがハングする**: サイネージサービスが停止・無効化されているか確認。メモリ使用状況を確認（120MB以上空きが必要）。Pi3デプロイは10-15分かかる可能性があるため、プロセスをkillせずに完了を待つ（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
- **複数のAnsibleプロセスが実行されている**: 全てのプロセスをkillしてから再実行
- **デプロイが失敗する**: ログを確認（`logs/deploy/deploy-*.jsonl`）
- **Pi4でファイルが見つからないエラー**: リポジトリが古い、または権限問題の可能性があります（[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)参照）

**関連ナレッジ**: 
- [KB-086](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題): Pi3デプロイ時のsystemdタスクハング問題
- [KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング): サイネージサービス自動再起動によるメモリ不足ハング
- [KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約): Pi3デプロイに時間がかかる問題

## デプロイ方法（詳細）

### 2. デプロイスクリプトの動作

デプロイスクリプト（`scripts/server/deploy.sh`）は以下の処理を実行します：

1. **Gitリポジトリの更新**: 指定されたブランチをチェックアウトし、最新の変更を取得
2. **依存関係のインストール**: `pnpm install`を実行
3. **共有型パッケージのビルド**: `packages/shared-types`をビルド
4. **Prisma Client生成**: `pnpm prisma generate`を実行（スキーマ変更時に必要、共有型ビルド後）
5. **APIのビルド**: `apps/api`をビルド
6. **Dockerコンテナの再ビルド・再起動**: `docker compose up -d --build`を実行
7. **データベースマイグレーション**: Prismaマイグレーションを実行
8. **ヘルスチェック**: APIが正常に起動しているか確認

### 3. 自動デプロイ（cron）

cronを使用して定期的にデプロイを実行できます。

```bash
# crontabを編集
sudo crontab -e

# 毎日午前3時にmainブランチをデプロイ
0 3 * * * /opt/RaspberryPiSystem_002/scripts/server/deploy.sh >> /var/log/deploy.log 2>&1
```

### 4. Git Hookを使用した自動デプロイ

GitHubのWebhookを使用して自動デプロイを設定することもできます（要追加実装）。

## CI/CDパイプライン

### GitHub Actions

`.github/workflows/ci.yml`でCIパイプラインを定義しています。

#### 実行タイミング

- `main`または`develop`ブランチへのプッシュ
- `main`または`develop`ブランチへのプルリクエスト

#### 実行内容

1. **lint-and-testジョブ**:
   - コードのチェックアウト
   - Node.js 20のセットアップ
   - 依存関係のインストール
   - 共有型パッケージのビルド
   - APIのビルド
   - APIのテスト実行
   - Webのビルド

2. **docker-buildジョブ**:
   - API Dockerイメージのビルド
   - Web Dockerイメージのビルド

### ローカルでのCI実行

GitHub Actionsと同じ環境でローカルでテストを実行：

```bash
# 依存関係のインストール
pnpm install

# 共有型パッケージのビルド
cd packages/shared-types && pnpm build && cd ../..

# APIのビルド
cd apps/api && pnpm build && cd ../..

# APIのテスト実行
cd apps/api && pnpm test && cd ../..

# Webのビルド
cd apps/web && pnpm build && cd ../..
```

## ラズパイ5のIPアドレス確認と設定

**⚠️ 注意**: このセクションは、`group_vars/all.yml`の`network_mode`設定を使用しない場合の手動設定方法です。通常は、[ネットワークモード設定](#ネットワーク環境の確認デプロイ前必須)を使用することを推奨します。

再起動後はIPアドレスが変わる可能性があるため、以下の手順で確認・更新してください。

### 1. ラズパイ5のIPアドレスを確認

```bash
# ラズパイ5で実行
hostname -I
# ローカルIP: 192.168.x.x（ネットワーク環境によって変動）
# Tailscale IP: 100.106.158.2（固定、推奨）
```

### 2. docker-compose.server.ymlのIPアドレスを更新

**⚠️ 非推奨**: 通常は、`group_vars/all.yml`の`network_mode`設定を使用してください。

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
nano infrastructure/docker/docker-compose.server.yml
```

`web`サービスの`args`セクションで、`VITE_API_BASE_URL`のIPアドレスを更新：

```yaml
web:
  build:
    args:
      # localOnly運用では `ws://localhost:7071/stream` のみを使用し、Pi5経由の /stream は使いません。
      # そのためVITE_AGENT_WS_URLは原則デフォルトのまま（localhost）でOKです。
      VITE_AGENT_WS_URL: ws://localhost:7071/stream
      VITE_API_BASE_URL: /api   # 相対パス（推奨、IPアドレス変更に対応）
      # または絶対URL（HTTPS経由、Caddy経由）
      # VITE_API_BASE_URL: https://100.106.158.2/api   # Pi5のTailscale IP（推奨）
```

**重要（2026-01-03更新）**: 
- `VITE_API_BASE_URL`は相対パス（`/api`）に設定することを推奨します（IPアドレス変更に対応）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）
- 外部アクセスはCaddy経由（HTTPS 443）で行います

### 3. Webコンテナを再ビルド・再起動

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web
```

**注意**: IPアドレスが変わった場合は、必ずWebコンテナを再ビルドする必要があります。ビルド時に`VITE_API_BASE_URL`が設定されるため、再起動だけでは不十分です。

## デプロイ前の確認事項

1. **バックアップの取得**: デプロイ前にデータベースのバックアップを取得
   ```bash
   ./scripts/server/backup.sh
   ```

2. **変更内容の確認**: デプロイするブランチの変更内容を確認
   ```bash
   git log origin/main..HEAD
   ```

3. **テストの実行**: ローカルでテストを実行して問題がないか確認
   ```bash
   cd apps/api && pnpm test
   ```

## ロールバック手順

デプロイ後に問題が発生した場合のロールバック手順：

```bash
# 1. 前のバージョンに戻す
cd /opt/RaspberryPiSystem_002
git checkout <前のコミットハッシュ>
./scripts/server/deploy.sh

# 2. データベースをリストア（必要に応じて）
./scripts/server/restore.sh /opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz
```

**補足（運用経路別）**:
- **Ansible経路**: `scripts/update-all-clients.sh` 実行後に問題が出た場合、クライアント設定の復旧は `infrastructure/ansible/playbooks/rollback.yml` を使用する
- **統合デプロイ**: `scripts/deploy/deploy-all.sh` は `ROLLBACK_ON_FAIL=1` でロールバックを試行可能（事前に `ROLLBACK_CMD` を確認）
- **DBロールバックの原則**: 破壊的マイグレーションは避け、復旧はバックアップからのリストアを基本とする

## トラブルシューティング

### デプロイが失敗する

1. **ログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api
   ```

2. **Dockerコンテナの状態を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps
   ```

3. **手動でビルドを実行**:
   ```bash
   cd /opt/RaspberryPiSystem_002
   pnpm install
   cd packages/shared-types && pnpm build && cd ../..
   cd apps/api && pnpm build && cd ../..
   ```

### ヘルスチェックが失敗する

1. **APIコンテナが起動しているか確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps api
   ```

2. **APIログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```

3. **データベース接続を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT 1;"
   ```

### マイグレーションが失敗する

1. **マイグレーション状態を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
     pnpm prisma migrate status
   ```

2. **手動でマイグレーションを実行**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
     pnpm prisma migrate deploy
   ```

3. **`service "api" is not running` の場合はコンテナ状態を先に確認**:
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml ps -a
  docker inspect docker-api-1 --format 'status={{.State.Status}} error={{json .State.Error}} exit={{.State.ExitCode}}'
  ```
  - `Created` + mount error の場合は、host 側ディレクトリや bind mount を修正してから以下で復旧する。
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml up -d api web
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate deploy
  ```

## 統合デプロイモジュール（deploy-all.sh）

### 概要

`scripts/deploy/deploy-all.sh`は変更検知→影響分析→デプロイ実行→検証を自動化する統合スクリプトです。

### 使用方法

```bash
# Pi5で実行
cd /opt/RaspberryPiSystem_002

# ドライラン（変更検知のみ、実行なし）
NETWORK_MODE=tailscale bash scripts/deploy/deploy-all.sh --dry-run

# 本番実行（変更があれば自動デプロイ＋検証）
NETWORK_MODE=tailscale \
  DEPLOY_EXECUTOR_ENABLE=1 \
  DEPLOY_VERIFIER_ENABLE=1 \
  ROLLBACK_ON_FAIL=1 \
  bash scripts/deploy/deploy-all.sh
```

### 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `NETWORK_MODE` | `local` または `tailscale` | `local` |
| `DEPLOY_EXECUTOR_ENABLE` | デプロイ実行を有効化 | `0` |
| `DEPLOY_VERIFIER_ENABLE` | 検証を有効化 | `0` |
| `ROLLBACK_ON_FAIL` | 失敗時ロールバック | `0` |

### 検証項目

`infrastructure/ansible/verification-map.yml`で定義。詳細は[deployment-modules.md](../architecture/deployment-modules.md)を参照。

## 運用チェックリスト

### デプロイ前チェック（必須）

**⚠️ これらのチェックを実行してからデプロイを開始してください**

1. **ネットワークモード設定の確認**（最重要）
   ```bash
   # Pi5上のnetwork_modeを確認
   ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   ```
   - `network_mode: "local"` → オフィスネットワーク用
   - `network_mode: "tailscale"` → 自宅ネットワーク/リモートアクセス用
   - **現在のネットワーク環境に応じて設定を変更**（[ネットワークモード設定](#ネットワーク環境の確認デプロイ前必須)を参照）
   - **重要**: Ansibleがリポジトリを更新する際に設定がデフォルト値に戻る可能性があります（[KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)参照）。デプロイ後のヘルスチェック前にも再確認すること。

2. **Pi5への接続確認**
   ```bash
   # Tailscale IPで接続確認（推奨）
   ping -c 1 100.106.158.2
   ssh denkon5sd02@100.106.158.2 'echo "Connected"'
   ```

3. **接続テスト**
   ```bash
   # Pi5からPi4/Pi3への接続テスト（実際に使われるIPで）
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible all -i infrastructure/ansible/inventory.yml -m ping"
   ```
   - すべてのホストで`SUCCESS`が表示されることを確認
   - `UNREACHABLE`が表示される場合は、`network_mode`設定を確認

4. **既存Ansibleプロセスの確認**
   ```bash
   # Pi5上で既存のAnsibleプロセスをkill（重複実行防止）
   ssh denkon5sd02@100.106.158.2 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ || true'
   ```

5. **メモリ空き確認**
   ```bash
   # Pi5のメモリ確認（2GB以上推奨）
   ssh denkon5sd02@100.106.158.2 'free -m'
   
   # Pi3のメモリ確認（120MB以上必要）
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "free -m"'
   ```

6. **ローカルIPを使う場合の事前確認**
   ```bash
   # 各端末で実IPを取得してからgroup_vars/all.ymlを更新する
   ssh denkon5sd02@100.106.158.2 "hostname -I"
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.74.144.79 'hostname -I'"    # Pi4例（tailscale経由）
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'hostname -I'" # Pi3例（tailscale経由）
   ```
   - ローカルIPは変動するため、例のアドレス（192.168.x.x）はそのまま使わず、取得した値で`group_vars/all.yml`を更新する

### デプロイ後確認

**重要（2026-01-03更新）**: ポート8080は外部公開されていません。外部アクセスはCaddy経由（HTTPS 443）で行います。

1. **サーバーAPIヘルスチェック**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k https://100.106.158.2/api/system/health
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl http://localhost:8080/api/system/health
   # → 200 OK を確認
   ```

2. **キオスク用API確認**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k -H 'x-client-key: client-key-raspberrypi4-kiosk1' https://100.106.158.2/api/tools/loans/active
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl -H 'x-client-key: client-key-raspberrypi4-kiosk1' http://localhost:8080/api/tools/loans/active
   # → 200 OK を確認
   ```

3. **サイネージ用API確認**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k https://100.106.158.2/api/signage/content
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl http://localhost:8080/api/signage/content
   # → 200 OK を確認
   ```

4. **Pi3サイネージデザイン変更の確認**（Pi5デプロイ後）
   ```bash
   # Pi5側のサイネージレンダラーが更新されていることを確認
   # Pi3のサイネージ画像を確認（左ペインタイトルが「持出中アイテム」、温度表示が追加されている）
   # 注意: 軽量サイネージは tmpfs の `/run/signage/current.jpg` を表示・更新します（SD書込み削減）。
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ls -lh /run/signage/current.jpg"'
   # → 画像ファイルが更新されていることを確認（タイムスタンプが最新）
   ```
   
   **注意**: Pi3のサイネージデザイン変更（左ペインタイトル、温度表示）は**Pi5側のデプロイのみで反映**されます。Pi3へのデプロイは不要です（サーバー側レンダリングのため）。

5. **Pi4 systemdサービス確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 'ssh tools03@100.74.144.79 "systemctl is-active kiosk-browser.service status-agent.timer"'
   # → active を確認
   ```

6. **Pi3サイネージサービスの確認**
   ```bash
   # 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
   # サービスが正常に動作していることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "systemctl is-active signage-lite.service"'
   # → active を確認（Ansibleが自動的に再有効化している）
   
   # 画像が更新されていることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ls -lh /run/signage/current.jpg"'
   ```
   - **重要**: デプロイ完了後は、Ansibleが自動的に`signage-lite.service`と`signage-lite-update.timer`を再有効化・再起動します。手動で`systemctl enable`や`systemctl start`を実行する必要はありません（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）

### Tailscale IP一覧

| デバイス | Tailscale IP | ユーザー |
|----------|--------------|----------|
| Pi5 (サーバー) | 100.106.158.2 | denkon5sd02 |
| Pi4 (キオスク) | 100.74.144.79 | tools03 |
| Pi3 (サイネージ) | 100.105.224.86 | signageras3 |

## Phase 9 セキュリティ強化機能の実機テスト

### 1. HTTPS/ヘッダー確認テスト

```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
bash /opt/RaspberryPiSystem_002/scripts/test/check-caddy-https-headers.sh
```

**期待される結果**:
- HTTPアクセスが301/302/308でHTTPSへリダイレクトされる
- HTTPSレスポンスに以下のヘッダーが含まれる:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options`
  - `Referrer-Policy`

### 2. 管理画面IP制限テスト

```bash
# 許可IPからのアクセス確認（Tailscale経由）
curl -kI https://100.106.158.2/admin
# → 200または302が返ることを確認

# 非許可IPからのアクセス確認（ADMIN_ALLOW_NETSを一時的に変更してテスト）
# docker-compose.server.ymlのADMIN_ALLOW_NETSを変更してwebコンテナを再起動
# → 403が返ることを確認
```

### 3. アラート外部通知テスト

```bash
# Pi5上で実行
# Webhook URLを設定（例: Slack Incoming Webhook）
export WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# 擬似Banでアラート生成
sudo fail2ban-client set sshd banip 203.0.113.50
# → WebhookにPOSTされることを確認（Slackでメッセージが表示される）

# クリーンアップ
sudo fail2ban-client set sshd unbanip 203.0.113.50
```

### 4. オフラインバックアップ実機検証テスト

```bash
# Pi5上で実行
# USB/HDDをマウント（例: /mnt/backup-usb）
sudo mount /dev/sda1 /mnt/backup-usb

# バックアップ作成
export BACKUP_ENCRYPTION_KEY="your-gpg-key-id"
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
bash /opt/RaspberryPiSystem_002/scripts/server/backup-encrypted.sh

# 検証スクリプト実行
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
export BACKUP_DECRYPTION_KEY="your-gpg-key-id"
bash /opt/RaspberryPiSystem_002/scripts/test/backup-offline-verify.sh
# → 検証用DBにリストアされ、Loan件数が確認できることを確認

# クリーンアップ（検証用DB削除）
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS borrow_return_restore_test;"
```

### 5. セキュリティE2Eテスト

```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
export ADMIN_URL="https://100.106.158.2/admin"
export ADMIN_EXPECT_STATUS="200"  # または403（IP制限が有効な場合）
bash /opt/RaspberryPiSystem_002/scripts/test/security-e2e.sh
```

**期待される結果**:
- HTTPS/ヘッダー確認が成功する
- 管理画面アクセス確認が期待ステータスと一致する

詳細なテスト手順は [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md#phase-9-インターネット接続時の追加防御テスト) を参照してください。

## ベストプラクティス

1. **デプロイ前のバックアップ**: 必ずデプロイ前にバックアップを取得
2. **ネットワークモード設定の確認**: デプロイ前に必ず`network_mode`設定を確認・修正
3. **段階的なデプロイ**: まず開発環境でテストしてから本番環境にデプロイ
4. **ロールバック計画**: 問題発生時のロールバック手順を事前に準備
5. **監視**: デプロイ後は監視スクリプトでシステムの状態を確認
6. **ドキュメント更新**: デプロイ手順に変更があった場合はドキュメントを更新
7. **Tailscale使用**: リモートアクセス時は必ず`network_mode: "tailscale"`に設定

## よくある質問（FAQ）

### Q1: 環境変数ファイルはリモートリポジトリに含まれないのに、どうやって管理する？

**A**: 以下の方法で管理します：

1. **`.env.example`ファイル**: リポジトリに含まれるテンプレートファイル
2. **手動でコピー**: `.env.example`をコピーして`.env`を作成し、本番環境用の値を設定
3. **Ansibleテンプレート**: Ansibleを使用する場合、`.j2`テンプレートファイルから生成
4. **バックアップ**: バックアップスクリプトで`.env`ファイルを自動バックアップ

詳細は [本番環境セットアップガイド](./production-setup.md#環境変数の管理) を参照してください。

### Q2: 環境変数を変更した後、どうやって反映させる？

**A**: Docker Composeを再起動します：

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

### Q3: パスワードを忘れた場合、どうすれば良い？

**A**: バックアップから復元します：

```bash
# バックアップディレクトリから環境変数ファイルを確認
ls -la /opt/backups/*.env

# 最新のバックアップから復元
cp /opt/backups/api_env_YYYYMMDD_HHMMSS.env /opt/RaspberryPiSystem_002/apps/api/.env
cp /opt/backups/docker_env_YYYYMMDD_HHMMSS.env /opt/RaspberryPiSystem_002/infrastructure/docker/.env

# Docker Composeを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

詳細は [バックアップ・リストアガイド](./backup-and-restore.md) を参照してください。

## 新しいサイネージ端末（デバイスタイプ）の追加手順

**重要（2026-01-16更新）**: デバイスタイプ汎用化により、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能になりました。

### 手順概要

新しいサイネージ端末を追加する際は、以下の手順を実行してください：

1. **デバイスタイプ設定の追加**（`group_vars/all.yml`）
2. **inventoryファイルへの追加**（`inventory.yml`または`inventory-talkplaza.yml`）
3. **ネットワーク設定の追加**（`group_vars/all.yml`、必要に応じて）
4. **動作確認**

### 1. デバイスタイプ設定の追加

`infrastructure/ansible/group_vars/all.yml`の`device_type_defaults`に新しいデバイスタイプを追加します：

```yaml
device_type_defaults:
  # 新しいデバイスタイプの例（Pi Zero 2W）
  pi_zero_2w:
    memory_required_mb: 120  # デプロイに必要な最小メモリ（MB）
    stop_lightdm: true       # lightdm停止が必要か（GUIが必要な場合true）
    services_to_stop:        # デプロイ前に停止するサービスリスト
      - signage-lite.service
      - signage-lite-update.timer
      - signage-lite-watchdog.timer
      - signage-daily-reboot.timer
      - status-agent.timer
```

**設定項目の説明**:
- `memory_required_mb`: デプロイに必要な最小メモリ（MB）。デバイスのメモリ容量に応じて設定してください。
- `stop_lightdm`: `true`の場合、デプロイ前にlightdm（GUI）を停止してメモリを確保します。デプロイ完了後に自動的に再起動されます。
- `services_to_stop`: デプロイ前に停止するサービスリスト。デバイスごとに必要なサービスを指定してください。

### 2. inventoryファイルへの追加

`infrastructure/ansible/inventory.yml`（第2工場）または`infrastructure/ansible/inventory-talkplaza.yml`（トークプラザ工場）に新しいホストを追加します：

```yaml
raspberrypi-zero2w-signage01:
  ansible_host: "{{ signage_ip_02 }}"  # または直接IPアドレス
  ansible_user: signageras3
  device_type: "pi_zero_2w"  # デバイスタイプを指定
  manage_signage_lite: true
  status_agent_client_id: raspberrypi-zero2w-signage01
  status_agent_location: "ラズパイZero2W - サイネージ01"
  signage_server_url: "{{ server_base_url }}"
  signage_client_key: "{{ vault_signage_client_key | default('client-key-raspberrypi-zero2w-signage01') }}"
  services_to_restart:
    - signage-lite.service
    - signage-lite-update.timer
    - status-agent.service
    - status-agent.timer
  # ... その他の設定
```

**重要**: `device_type`変数を必ず指定してください。未指定の場合は`default`設定が使用されます。

### 3. ネットワーク設定の追加（必要に応じて）

新しいデバイスのIPアドレスを`group_vars/all.yml`に追加します：

```yaml
local_network:
  raspberrypi_zero2w_signage01_ip: "192.168.10.225"

tailscale_network:
  raspberrypi_zero2w_signage01_ip: "100.105.224.87"
```

### 4. 動作確認

```bash
# 構文チェック
cd /Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible
ansible-playbook --syntax-check playbooks/deploy.yml -i inventory.yml

# 接続テスト
ansible-playbook playbooks/ping.yml -i inventory.yml --limit raspberrypi-zero2w-signage01

# デプロイテスト（必要に応じて）
ansible-playbook playbooks/deploy.yml -i inventory.yml --limit raspberrypi-zero2w-signage01
```

### 既存デバイスタイプの確認

現在サポートされているデバイスタイプ：

- **pi3**: Raspberry Pi 3（メモリ416MB、lightdm停止が必要）
- **pi_zero_2w**: Raspberry Pi Zero 2W（メモリ512MB、lightdm停止が必要）
- **default**: デフォルト設定（device_type未指定時）

### トラブルシューティング

- **デバイスタイプが見つからない**: `device_type_defaults`に設定が追加されているか確認してください。
- **メモリ不足エラー**: `memory_required_mb`の値を調整するか、`stop_lightdm: true`を設定してください。
- **サービスが起動しない**: `services_to_stop`に必要なサービスが含まれているか確認してください。

詳細は [KB-169](../knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動) を参照してください。

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md): 一括更新とクライアント監視のクイックスタート
- [環境構築ガイド](./environment-setup.md): ローカルネットワーク変更時の対応
- [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md): SSH接続の構成と説明
- [本番環境セットアップガイド](./production-setup.md): 本番環境の初期セットアップ（環境変数の管理、新しいPi5での環境構築手順を含む）
- [バックアップ・リストアガイド](./backup-and-restore.md): バックアップとリストアの手順（デバイスごとのバックアップ対象を含む）
- [監視・アラートガイド](./monitoring.md): システム監視とアラート設定

