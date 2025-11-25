import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestItem, createTestLoan, createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

/**
 * データベースマイグレーションが正しく適用されているか確認するテスト
 */
describe('Database Migration: Allow delete employees/items with returned loans', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should have correct foreign key constraints (ON DELETE SET NULL)', async () => {
    // データベースの外部キー制約を確認
    const constraints = await prisma.$queryRaw<Array<{
      constraint_name: string;
      column_name: string;
      delete_rule: string;
    }>>`
      SELECT 
        tc.constraint_name,
        kcu.column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints rc 
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_name = 'Loan'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name IN ('itemId', 'employeeId')
    `;

    expect(constraints.length).toBe(2);
    
    const itemIdConstraint = constraints.find(c => c.column_name === 'itemId');
    const employeeIdConstraint = constraints.find(c => c.column_name === 'employeeId');

    expect(itemIdConstraint).toBeDefined();
    expect(itemIdConstraint?.delete_rule).toBe('SET NULL');
    
    expect(employeeIdConstraint).toBeDefined();
    expect(employeeIdConstraint?.delete_rule).toBe('SET NULL');
  });

  it('should have nullable itemId and employeeId columns', async () => {
    // カラムがnullableか確認
    const columns = await prisma.$queryRaw<Array<{
      column_name: string;
      is_nullable: string;
    }>>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Loan'
        AND column_name IN ('itemId', 'employeeId')
    `;

    expect(columns.length).toBe(2);
    
    const itemIdColumn = columns.find(c => c.column_name === 'itemId');
    const employeeIdColumn = columns.find(c => c.column_name === 'employeeId');

    expect(itemIdColumn).toBeDefined();
    expect(itemIdColumn?.is_nullable).toBe('YES');
    
    expect(employeeIdColumn).toBeDefined();
    expect(employeeIdColumn?.is_nullable).toBe('YES');
  });

  it('should allow deleting employee with returned loans (database level)', async () => {
    const employee = await createTestEmployee();
    const item = await createTestItem();
    const client = await createTestClientDevice();
    
    // 返却済みの貸出記録を作成
    const loan = await createTestLoan({
      employeeId: employee.id,
      itemId: item.id,
      clientId: client.id,
      returnedAt: new Date(),
    });

    // 従業員を削除（データベースレベルで直接削除）
    await prisma.employee.delete({
      where: { id: employee.id }
    });

    // 貸出記録が残っていることを確認（employeeIdがNULLになっている）
    const updatedLoan = await prisma.$queryRaw<Array<{
      id: string;
      employeeId: string | null;
      itemId: string | null;
    }>>`
      SELECT id, "employeeId", "itemId"
      FROM "Loan"
      WHERE id = ${loan.id}
    `;

    expect(updatedLoan.length).toBe(1);
    expect(updatedLoan[0].employeeId).toBeNull();
    expect(updatedLoan[0].itemId).toBe(item.id); // itemIdは残っている
  });

  it('should allow deleting item with returned loans (database level)', async () => {
    const employee = await createTestEmployee();
    const item = await createTestItem();
    const client = await createTestClientDevice();
    
    // 返却済みの貸出記録を作成
    const loan = await createTestLoan({
      employeeId: employee.id,
      itemId: item.id,
      clientId: client.id,
      returnedAt: new Date(),
    });

    // アイテムを削除（データベースレベルで直接削除）
    await prisma.item.delete({
      where: { id: item.id }
    });

    // 貸出記録が残っていることを確認（itemIdがNULLになっている）
    const updatedLoan = await prisma.$queryRaw<Array<{
      id: string;
      employeeId: string | null;
      itemId: string | null;
    }>>`
      SELECT id, "employeeId", "itemId"
      FROM "Loan"
      WHERE id = ${loan.id}
    `;

    expect(updatedLoan.length).toBe(1);
    expect(updatedLoan[0].itemId).toBeNull();
    expect(updatedLoan[0].employeeId).toBe(employee.id); // employeeIdは残っている
  });
});

