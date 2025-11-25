-- AlterTable: LoanテーブルのitemIdとemployeeIdをnullableに変更し、外部キー制約をON DELETE SET NULLに変更
-- これにより、返却済みの貸出記録があっても従業員/アイテムを削除できるようになる

-- 1. 既存の外部キー制約を削除
ALTER TABLE "Loan" DROP CONSTRAINT IF EXISTS "Loan_itemId_fkey";
ALTER TABLE "Loan" DROP CONSTRAINT IF EXISTS "Loan_employeeId_fkey";

-- 2. itemIdとemployeeIdをnullableに変更
ALTER TABLE "Loan" ALTER COLUMN "itemId" DROP NOT NULL;
ALTER TABLE "Loan" ALTER COLUMN "employeeId" DROP NOT NULL;

-- 3. 新しい外部キー制約を追加（ON DELETE SET NULL）
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

