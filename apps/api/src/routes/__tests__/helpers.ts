import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/auth.js';
import type { User } from '@prisma/client';
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
export async function createTestClientDevice(apiKey: string = 'test-api-key'): Promise<{ id: string }> {
  const client = await prisma.clientDevice.create({
    data: {
      name: 'Test Client',
      apiKey,
    },
  });
  return { id: client.id };
}

/**
 * テスト用の従業員を作成
 */
export async function createTestEmployee(data?: {
  employeeCode?: string;
  displayName?: string;
  nfcTagUid?: string;
  department?: string;
}): Promise<{ id: string }> {
  const employee = await prisma.employee.create({
    data: {
      employeeCode: data?.employeeCode ?? `EMP${Date.now()}-${Math.random().toString(36).substring(7)}`,
      displayName: data?.displayName ?? 'Test Employee',
      nfcTagUid: data?.nfcTagUid ?? `TAG${Date.now()}-${Math.random().toString(36).substring(7)}`,
      department: data?.department ?? 'Test Department',
      status: 'ACTIVE',
    },
  });
  return { id: employee.id };
}

/**
 * テスト用のアイテムを作成
 */
export async function createTestItem(data?: {
  itemCode?: string;
  name?: string;
  nfcTagUid?: string;
  category?: string;
}): Promise<{ id: string }> {
  const item = await prisma.item.create({
    data: {
      itemCode: data?.itemCode ?? `ITEM${Date.now()}-${Math.random().toString(36).substring(7)}`,
      name: data?.name ?? 'Test Item',
      nfcTagUid: data?.nfcTagUid ?? `TAG${Date.now()}-${Math.random().toString(36).substring(7)}`,
      category: data?.category ?? 'Test Category',
      status: 'AVAILABLE',
    },
  });
  return { id: item.id };
}

/**
 * テストデータベースをクリーンアップ
 */
export async function cleanupTestData(): Promise<void> {
  await prisma.transaction.deleteMany({});
  await prisma.loan.deleteMany({});
  await prisma.item.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.clientDevice.deleteMany({});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'test-' } } });
}

