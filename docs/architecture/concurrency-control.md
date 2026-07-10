# 競合制御

複数のPi 4は単一のAPI/PostgreSQLへ接続する。端末全体を停止するグローバルロックは使わず、競合する業務データごとにDBで整合性を保証する。

## 保護方式

| 対象 | 不変条件 | 最終防衛線 | サービス側制御 |
| --- | --- | --- | --- |
| 工具・計測機器・吊具の有効貸出 | 資産ごとに最大1件 | `Loan` の部分ユニークインデックス | 事前確認と409変換 |
| Loanの返却・取消 | 終端状態は一度だけ、返却と取消は排他 | CHECK制約 | 条件付き `updateMany` |
| 自己検査セッション | 同一セッションの更新順序 | PostgreSQL行ロック、CAS | mutation guard |
| 生産順序 | 同一親行・同一スロットの直列化 | 一意制約 | transaction-scoped advisory lock |
| OCRジョブ | 1ジョブを1ワーカーだけが取得 | 行状態 | `FOR UPDATE SKIP LOCKED` |

`Loan` の部分ユニークインデックスはPrisma schemaで表現できないため、raw SQL migrationが正とする。migrationは既存重複を自動修復せず、検出時に停止する。

## HTTP競合応答

業務上の同時競合はHTTP 409で返す。呼出側は表示文言ではなく `errorCode` を判定する。

- `ASSET_ALREADY_ON_LOAN`
- `LOAN_ALREADY_RETURNED`
- `LOAN_ALREADY_CANCELLED`
- `LOAN_STATE_CONFLICT`

## APIを複数化する場合

現在は単一APIプロセスを前提とする。将来APIを複数プロセス・複数台へ拡張する場合は、バックアップ、CSV取込、定期レンダリング等のプロセスローカルmutexをPostgreSQL advisory lockまたはleaseへ置き換える。

