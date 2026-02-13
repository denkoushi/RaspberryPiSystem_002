import { prisma } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/auth.js';
import type { ClientDevice, Employee, Item, Loan, User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { expect } from 'vitest';
import { performance } from 'node:perf_hooks';

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
 * ログインAPIを実行してアクセストークンを取得
 */
export async function loginAndGetAccessToken(params: {
  app: FastifyInstance;
  username: string;
  password: string;
}): Promise<string> {
  const { app, username, password } = params;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    payload: { username, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Failed to login in test helper: status=${response.statusCode}`);
  }

  return response.json().accessToken as string;
}

/**
 * APIエラー応答の共通アサート
 */
export function expectApiError(
  response: { statusCode: number; json: () => Record<string, unknown> },
  expectedStatus: number,
  expectedMessageIncludes?: string
): Record<string, unknown> {
  expect(response.statusCode).toBe(expectedStatus);
  const body = response.json();
  if (expectedMessageIncludes) {
    const message = typeof body.message === 'string' ? body.message : '';
    expect(message).toContain(expectedMessageIncludes);
  }
  return body;
}

/**
 * app.injectの実行時間を計測して返す
 */
export async function measureInjectResponse<T>(params: {
  app: FastifyInstance;
  request: unknown;
}): Promise<{ response: T; responseTimeMs: number }> {
  const start = performance.now();
  const response = (await params.app.inject(params.request as never)) as T;
  const responseTimeMs = performance.now() - start;
  return { response, responseTimeMs };
}

/**
 * app.inject を同時実行してレスポンスタイムを計測する
 */
export async function measureConcurrentInjectResponses<T>(params: {
  app: FastifyInstance;
  requestFactory: (index: number) => unknown;
  concurrency: number;
}): Promise<{ responses: T[]; responseTimesMs: number[]; maxResponseTimeMs: number }> {
  const tasks = Array.from({ length: params.concurrency }, (_, index) =>
    measureInjectResponse<T>({
      app: params.app,
      request: params.requestFactory(index),
    })
  );
  const measured = await Promise.all(tasks);
  const responses = measured.map((v) => v.response);
  const responseTimesMs = measured.map((v) => v.responseTimeMs);
  const maxResponseTimeMs = Math.max(...responseTimesMs);
  return { responses, responseTimesMs, maxResponseTimeMs };
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

