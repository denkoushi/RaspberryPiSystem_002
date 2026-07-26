---
id: ADR-20260726-assembly-auto-id-operator-access-invalidation
status: accepted
scope: assembly lot work-ID issuance, operator access, and work-unit invalidation
date: 2026-07-26
source_of_truth: this file
related_code: apps/api/src/services/assembly, apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx
related_docs: ../plans/assembly-auto-id-nfc-invalidation-execplan.md
validation: isolated PostgreSQL migration, concurrency integration tests, Web tests, and EXPLAIN are required
open_items: none
---

# ADR-20260726: Assembly auto work IDs, operator access, and invalidation

## Context

組立ロット登録は作業用IDと作業者を事前入力していた。作業用IDの手入力負荷をなくし、
実際に作業へ入る人を都度NFCで記録する必要がある。また、キオスクの状態ペインから
誤登録を除外したいが、既存の作業用IDはトルク、承認、製品構成、正式ID履歴の参照元で
あり、物理削除は監査証跡と外部キー整合を壊す。

## Decision

1. ロット作業用IDは正規化製番と3桁連番からサーバーが発行する。手動入力は折りたたみの
   互換経路として残す。
2. 同一製番の再ロット登録と、過去を含む作業用ID再利用を拒否する。
3. ロット登録時には作業者を確定せず、START/RESUMEごとにACTIVE社員NFCを検証して
   append-onlyアクセス履歴を保存する。
4. キオスクの「削除」はWorkUnitの不可逆な論理無効化とする。仕掛は同時にCANCELLEDへ
   遷移し、完了・承認・トルク等の証跡は変更しない。
5. 有効な製品構成リンクまたは正式IDを持つWorkUnitの無効化は拒否する。
6. 採番、開始、無効化、traceability変更はPostgreSQLロックとrequestIdで競合・再送を
   安全に処理する。
7. 既存`AssemblyLot.operatorNameSnapshot`のNOT NULL契約はBlue/Green互換のため維持し、
   未確定ロットは空文字を保存してAPI DTOで`null`へ正規化する。
8. 既存の直接開始APIもACTIVE社員NFCとUUID requestIdを必須にし、サーバーが解決した
   社員スナップショットとSTART履歴を同一トランザクションで保存する。任意の作業者名を
   受け取る開始経路は残さない。

## Consequences

現場入力は減り、担当者履歴と削除理由が追跡可能になる。WorkUnitとLotSerialは無効化後も
残るためDB容量は減らないが、識別子と監査履歴の意味は維持される。正式ID取消と無効化復元は
別の業務判断が必要なため本決定には含めない。

## Validation

使い捨てPostgreSQLへ全migrationを適用し、採番・NFC・無効化・traceabilityの逐次／並行
統合テスト、Webテスト、索引SQL、`EXPLAIN (ANALYZE, BUFFERS)`を確認する。

## Supersedes / Superseded By

- Extends: `ADR-20260720-assembly-work-id-genealogy-and-formal-id`
- Superseded by: none
