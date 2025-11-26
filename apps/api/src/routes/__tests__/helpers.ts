import { prisma } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/auth.js';
import type { ClientDevice, Employee, Item, Loan, User } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * テスト用の認証トークンを生成
 */
export async function createTestUser(
  role: User['role'] = 'ADMIN',
  password: string = 'test-password-123',
): Promise<{ user: User; token: string; password: string }> {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      passwordHash,
      role,
      status: 'ACTIVE',
    },
  });
  const token = signAccessToken(user);
  return { user, token, password };
}

/**
 * テスト用の認証ヘッダーを生成
 */
export function createAuthHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * テスト用のクライアントデバイスを作成
 */
export async function createTestClientDevice(apiKey?: string): Promise<ClientDevice> {
  const generatedKey = apiKey ?? `test-client-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const client = await prisma.clientDevice.create({
    data: {
      name: `Test Client ${new Date().toISOString()}`,
      apiKey: generatedKey,
    },
  });
  return client;
}

/**
 * テスト用の従業員を作成
 */
export async function createTestEmployee(data?: {
  employeeCode?: string;
  displayName?: string;
  nfcTagUid?: string;
  department?: string;
}): Promise<Employee> {
  // デフォルトのemployeeCodeを数字4桁の形式に変更（新しいバリデーション仕様に対応）
  const defaultEmployeeCode = data?.employeeCode ?? String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999の範囲
  return prisma.employee.create({
    data: {
      employeeCode: defaultEmployeeCode,
      displayName: data?.displayName ?? 'Test Employee',
      nfcTagUid: data?.nfcTagUid ?? `TAG_EMP_${Date.now()}-${Math.random().toString(36).slice(2)}`,
      department: data?.department ?? 'Test Department',
      status: 'ACTIVE',
    },
  });
}

/**
 * テスト用のアイテムを作成
 */
export async function createTestItem(data?: {
  itemCode?: string;
  name?: string;
  nfcTagUid?: string;
  category?: string;
  status?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
}): Promise<Item> {
  // デフォルトのitemCodeをTO+数字4桁の形式に変更（新しいバリデーション仕様に対応）
  const defaultItemCode = data?.itemCode ?? `TO${String(Math.floor(1000 + Math.random() * 9000)).padStart(4, '0')}`; // TO1000-TO9999の範囲
  return prisma.item.create({
    data: {
      itemCode: defaultItemCode,
      name: data?.name ?? 'Test Item',
      nfcTagUid: data?.nfcTagUid ?? `TAG_ITEM_${Date.now()}-${Math.random().toString(36).slice(2)}`,
      category: data?.category ?? 'Test Category',
      status: data?.status ?? 'AVAILABLE',
    },
  });
}

/**
 * テスト用の貸出記録を作成
 */
export async function createTestLoan(data: {
  employeeId: string;
  itemId: string;
  clientId?: string | null;
  returnedAt?: Date | null;
}): Promise<Loan> {
  return prisma.loan.create({
    data: {
      employeeId: data.employeeId,
      itemId: data.itemId,
      clientId: data.clientId ?? null,
      returnedAt: data.returnedAt ?? null,
    },
  });
}

