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


---

### Prisma ORM 7.10.1 への更新(2026-10-26)

- `apps/api` は `prisma`、`@prisma/client`、`@prisma/adapter-pg` を `7.10.1` に固定する(実行時に `migrate deploy` で使うため dependencies に置く)。generator は `prisma-client-js` のままで、`@prisma/client` からの import は変えていない。エラー型の import 元は `runtime/library` から `runtime/client` に変わった。
- 接続先は `apps/api/prisma.config.ts` が `process.env.DATABASE_URL` から読む(dotenv は読まない)。`schema.prisma` の `url` は削除した。イメージのビルド中の `prisma generate` は URL なしで動く。
- クライアントは `createPrismaClient`(`apps/api/src/lib/prisma-client.ts`)で pg のドライバアダプタ付きで作る。`DATABASE_PRISMA_*` の環境変数名はそのまま使える。`connection_limit` は `pg.Pool` の `max` になる。pg は接続確立と空き接続待ちを1つの `connectionTimeoutMillis` で扱うため、`connect_timeout` と `pool_timeout` のうち 0(無制限)を除いた長いほうを使う(既定値では 20 秒)。これら3つの Prisma 専用パラメータは pg に渡す接続文字列から除く。
- Prisma 7 では対話型トランザクションの中のクライアントにも `$transaction` がある。製造日程の割当解除(`order-assignment-release.repository.ts`)は自分自身を呼び直していたため、トランザクション内では本体を直接呼ぶ形に直した。
- DB スキーマと migration は変えていない。migration 履歴と schema の差(既存の 61 文)は Prisma 5.22 でも同じ内容で、今回の更新とは別の既存の差である。
- テスト中に pg 8.22 から「1つの接続で同時に query を呼んでいる」という非推奨警告が出る。pg 9 で動かなくなる予定で、別件として扱う。
