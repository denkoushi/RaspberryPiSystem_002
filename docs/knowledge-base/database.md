---
title: トラブルシューティングナレッジベース - データベース関連
tags: [トラブルシューティング, データベース, Prisma, PostgreSQL]
audience: [開発者]
last-verified: 2025-11-27
related: [index.md, ../guides/backup-and-restore.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - データベース関連

**カテゴリ**: データベース関連  
**件数**: 3件  
**索引**: [index.md](./index.md)

---

### [KB-003] P2002エラー（nfcTagUidの重複）が発生する

**EXEC_PLAN.md参照**: Phase 3 (行70-75), Surprises & Discoveries (行187-189)

**事象**: 
- USBメモリからのCSVインポートでP2002エラー（nfcTagUidの重複）が発生
- エラーメッセージは改善されたが、根本原因は解決していない
- `nfcTagUid="04C362E1330289"は既にemployeeCode="EMP-001"で使用されています。employeeCode="EMP001"では使用できません。`

**要因**: 
- **根本原因**: CSVファイルの`employeeCode`形式が統一されていない（`EMP-001`と`EMP001`が混在）
- `employeeCode`の形式が一致しないため、システムが新しい従業員として扱い、既存の`nfcTagUid`との重複チェックでエラーが発生
- CSVインポート仕様が明確にドキュメント化されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: CSVインポート仕様を明確にドキュメント化し、Zodスキーマに正規表現バリデーションを追加。無効な`status`値はエラーにせず、デフォルト値を使用するように変更。

**学んだこと**: 
- PrismaのP2002エラーは、ユニーク制約違反を示す
- CSVファイルはUTF-8エンコーディングで保存する必要がある
- **重要**: `employeeCode`や`itemCode`の形式を統一することで、データの整合性を保つことができる
- CSVインポート仕様を明確にドキュメント化することで、ユーザーが正しい形式でデータを準備できるようになる

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `apps/api/src/routes/imports.ts`
- `apps/api/src/routes/tools/employees/schemas.ts`
- `apps/api/src/routes/tools/items/schemas.ts`
- `docs/guides/csv-import-export.md`

---

### [KB-004] 削除機能が動作しない

**EXEC_PLAN.md参照**: Phase 2 (行64-69), Surprises & Discoveries (行142-144)

**事象**: 
- 返却済みの貸出記録があっても削除できない
- 1件だけ削除できたが、他の従業員・アイテムは削除できない

**要因**: 
- データベースの外部キー制約が正しく適用されていない可能性
- 削除ロジックのバグ

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: 削除機能が正常に動作することを確認

**学んだこと**: 
- データベースの外部キー制約は、データの整合性を保つために重要
- 削除機能は、関連するデータを適切に処理する必要がある

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `apps/api/src/routes/tools/employees/delete.ts`
- `apps/api/src/routes/tools/items/delete.ts`

---

### [KB-013] 実機UIDとseedデータが不一致

**EXEC_PLAN.md参照**: Surprises & Discoveries (行151-153)

**事象**: 
- 実機UIDとseedデータが不一致で`/borrow`が404/400（従業員/アイテム未登録）になる

**要因**: 
- `apps/api/prisma/seed.ts`のUIDが実機タグと一致していない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: `apps/api/prisma/seed.ts`を実機タグ（アイテム: 04DE8366BC2A81、社員: 04C362E1330289）に合わせ、再シード

**学んだこと**: 
- 実機環境では、seedデータのUIDを実機タグに合わせる必要がある
- シードデータは、実機環境に合わせて調整する必要がある

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `apps/api/prisma/seed.ts`

