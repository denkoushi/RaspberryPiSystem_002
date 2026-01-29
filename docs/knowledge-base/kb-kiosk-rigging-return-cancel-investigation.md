# KB: キオスク吊具 持出し返却・取消と「使用中」判定の調査報告

## Title

KB: キオスクからの吊具の持出し・返却の仕様と「使用中」判定ロジック／返却後に再スキャンで使用中アラートが出る事象の調査

## Context

- **いつ**: 調査日時点
- **どこで**: キオスク（吊具の持出し・返却フロー）
- **何が起きた**: 1件を返却したが、再度NFCタグをスキャンすると「使用中」アラートが出た。返却と取消の扱いが混在していないか確認が必要。

## 把握した仕様（吊具の持出し・返却）

### キオスク側

- **持出し**: `KioskRiggingBorrowPage` → 吊具タグ → 従業員タグの順でスキャン → `borrowRiggingGear()` で **POST `/rigging-gears/borrow`** を呼ぶ（吊具専用API）。
- **返却・取消**: `KioskReturnPage` は **工具・計測機器・吊具を一括表示**し、各貸出に「返却」「取消」ボタンを提供。
  - **返却**: `useReturnMutation` → **POST `/tools/loans/return`**（`{ loanId }`）のみを呼ぶ（種別によらず共通）。
  - **取消**: `useCancelLoanMutation` → **POST `/tools/loans/cancel`**（`{ loanId }`）のみを呼ぶ（種別によらず共通）。

### API・サービス側

| 種別     | 持出しAPI                     | 返却API               | 取消API               | 持出し時の「既存貸出」チェック |
|----------|-------------------------------|------------------------|------------------------|--------------------------------|
| 工具     | POST `/tools/loans/borrow`    | POST `/tools/loans/return` | POST `/tools/loans/cancel` | `itemId` + `returnedAt: null` のみ |
| 吊具     | POST `/rigging-gears/borrow`  | 上と同じ return       | 上と同じ cancel        | `riggingGearId` + `returnedAt: null` のみ |
| 計測機器 | POST `/measuring-instruments/borrow` | 上と同じ return | 上と同じ cancel        | `measuringInstrumentId` + `returnedAt: null` のみ |

- **「持ち出し中」一覧（アクティブ貸出）**: GET `/tools/loans/active` → `LoanService.findActive()` は **`returnedAt: null` かつ `cancelledAt: null`** で取得。返却済み・取消済みは一覧から除外されている。

---

## 持ち出し中の判定ロジック（再スキャンで「使用中」になる条件）

「この吊具はすでに貸出中です」は、**持出し（borrow）** 時に「既存の未返却貸出」があると出る。

- **吊具**: `apps/api/src/services/rigging/loan.service.ts` の `borrow()`  
  - `existingLoan = prisma.loan.findFirst({ where: { riggingGearId: gear.id, returnedAt: null } })`  
  - **`cancelledAt` は条件に含まれていない**。
- **工具**: `apps/api/src/services/tools/loan.service.ts` の `borrow()`  
  - `existingLoan = prisma.loan.findFirst({ where: { itemId: item.id, returnedAt: null } })`  
  - 同様に **`cancelledAt` は条件に含まれていない**。
- **計測機器**: `measuring-instruments/loan.service.ts` も同様に `returnedAt: null` のみで検索。

したがって、

- **返却済み**: `returnedAt` が立つため `existingLoan` にはヒットせず、再スキャンでは「貸出中」にはならない（仕様どおり）。
- **取消済み**: `returnedAt` は null のまま。`cancelledAt` で除外していないため、**取消済みLoanが「既存貸出」としてヒットし、「この吊具はすでに貸出中です」になる**。

---

## 取り消しと返却の混在の有無

### 結論: **混在している（取消が返却と同様に扱われていない）**

1. **取消時の実物ステータス更新**
   - **工具**: `LoanService.cancel()`（`apps/api/src/services/tools/loan.service.ts`）は **`loan.itemId` がある場合のみ** `Item.status` を AVAILABLE に戻す。
   - **吊具・計測機器**: `cancel()` には **`riggingGearId` / `measuringInstrumentId` の処理がなく**、取消後も RiggingGear / MeasuringInstrument の status は IN_USE のまま。

2. **返却時の実物ステータス更新**
   - キオスクの「返却」は常に **`/tools/loans/return`** → `LoanService.return()` のみ。
   - `return()` は **`loan.itemId` がある場合のみ** `Item.status` を AVAILABLE に戻す。
   - **吊具・計測機器**: `riggingGearId` / `measuringInstrumentId` の更新は **一切行われない**。返却後も RiggingGear / MeasuringInstrument は IN_USE のまま（在庫状態としては不整合）。

3. **持出し時の「既存貸出」判定**
   - 上記のとおり、**取消済み（`cancelledAt` のみ設定）Loanを「貸出中」から除外していない**。
   - そのため「取消」したつもりで同じ吊具を再スキャンすると、取消済みLoanが `existingLoan` としてヒットし、「この吊具はすでに貸出中です」となる。

### 事象の解釈（1件返却したのに再スキャンで使用中アラート）

- **実際に「返却」していた場合**  
  - 返却APIは `returnedAt` を立てるため、持出し時の `existingLoan` にはヒットしない。  
  - そのため、**「返却」操作のみなら通常は再スキャンで「貸出中」にはならない**。  
  - ただし吊具の返却では RiggingGear の status が AVAILABLE に戻らない不整合はある。

- **実際には「取消」していた、または取消と返却を勘違いしていた場合**  
  - 取消後も `returnedAt` は null のまま。
  - 既存貸出チェックが `cancelledAt` を見ていないため、**取消済みLoanが「貸出中」と判定される**。
  - その結果、再スキャンで「この吊具はすでに貸出中です」となり、**報告された事象と一致する**。

したがって、**「1件返却したが再スキャンで使用中アラート」は、操作が実際には「取消」だった場合に、取消と返却の扱いの差（取消済みを「貸出中」から外していない＋取消時に吊具の status を戻していない）によって説明できる**。

---

## 調査結果サマリ

| 項目 | 内容 |
|------|------|
| **持ち出し中判定** | 工具・吊具・計測機器とも「既存貸出」は **`returnedAt: null` のみ**で検索。**`cancelledAt: null` は見ていない**。 |
| **取消と返却の混在** | あり。取消済みLoanが「貸出中」として扱われ、再持出しで「すでに貸出中です」になり得る。取消時に吊具・計測機器の status を AVAILABLE に戻す処理もない。 |
| **返却時の吊具・計測機器** | キオスクは常に `/tools/loans/return` のみ使用。`LoanService.return()` は Item のみ AVAILABLE に戻し、**吊具・計測機器の status は更新しない**。 |
| **事象の説明** | 「返却」ではなく「取消」だった場合に、上記の仕様により再スキャンで「使用中」アラートが出る挙動と一致する。 |

## 参照コード（抜粋）

- 持出し時の既存貸出チェック（吊具）: `apps/api/src/services/rigging/loan.service.ts` 68–73 行付近  
  `findFirst({ riggingGearId, returnedAt: null })` のみ。
- 持出し時の既存貸出チェック（工具）: `apps/api/src/services/tools/loan.service.ts` 109–114 行付近  
  `findFirst({ itemId, returnedAt: null })` のみ。
- 取消処理（Item のみ更新）: `apps/api/src/services/tools/loan.service.ts` 517–532 行付近  
  `if (loan.itemId) { ... Item AVAILABLE }` のみ。riggingGearId / measuringInstrumentId は未処理。
- 返却処理（Item のみ更新）: `apps/api/src/services/tools/loan.service.ts` 249–252 行付近  
  `if (loan.itemId) { ... Item AVAILABLE }` のみ。
- キオスク返却・取消で呼ぶAPI: `apps/web/src/api/client.ts` 330–334 行（returnLoan → `/tools/loans/return`）、349–353 行（cancelLoan → `/tools/loans/cancel`）。

## 次のアクション（修正は今回対象外）

- 持出し時の「既存貸出」に **`cancelledAt: null`** を追加するか検討。
- 取消・返却時に **吊具（RiggingGear）・計測機器（MeasuringInstrument）の status を AVAILABLE に戻す**処理を、tools/loan.service に追加するか、あるいは種別ごとの API に振り分けるか検討。
- 運用・UI で「返却」と「取消」の違いを明示し、誤操作を防ぐ検討。

---

*本ドキュメントは調査報告のみ。修正は別タスクとする。*
