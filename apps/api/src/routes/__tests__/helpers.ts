import { prisma } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/auth.js';
import type { ClientDevice, Employee, Item, Loan, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

let employeeSequence = 0;
let itemSequence = 0;

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
  const attempts = 10;
  const generateCode = () =>
    String(1000 + ((employeeSequence++ + Date.now()) % 9000)).padStart(4, '0');

  for (let i = 0; i < attempts; i++) {
    const employeeCode = data?.employeeCode ?? generateCode();
    try {
      return await prisma.employee.create({
        data: {
          employeeCode,
          displayName: data?.displayName ?? 'Test Employee',
          nfcTagUid: data?.nfcTagUid ?? `TAG_EMP_${Date.now()}-${Math.random().toString(36).slice(2)}`,
          department: data?.department ?? 'Test Department',
          status: 'ACTIVE',
        },
      });
    } catch (error) {
      if (
        data?.employeeCode ||
        !(error instanceof PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate unique employeeCode for test');
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
  const attempts = 10;
  const generateCode = () =>
    `TO${String(1000 + ((itemSequence++ + Date.now()) % 9000)).padStart(4, '0')}`;

  for (let i = 0; i < attempts; i++) {
    const itemCode = data?.itemCode ?? generateCode();
    try {
      return await prisma.item.create({
        data: {
          itemCode,
          name: data?.name ?? 'Test Item',
          nfcTagUid: data?.nfcTagUid ?? `TAG_ITEM_${Date.now()}-${Math.random().toString(36).slice(2)}`,
          category: data?.category ?? 'Test Category',
          status: data?.status ?? 'AVAILABLE',
        },
      });
    } catch (error) {
      if (
        data?.itemCode ||
        !(error instanceof PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate unique itemCode for test');
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

