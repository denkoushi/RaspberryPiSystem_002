import { prisma } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/auth.js';
import type { ClientDevice, Employee, Item, Loan, MeasuringInstrument, User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

let employeeSequence = 0;
let itemSequence = 0;
let importTokenSequence = 0;
const importTestRunId = randomUUID();
let importEmployeeCursor = 0;
let importItemCursor = 0;
const reservedImportEmployeeCodes = new Set<string>();
const reservedImportItemCodes = new Set<string>();

const CONSTRAINED_CODE_MIN = 1000;
const CONSTRAINED_CODE_COUNT = 9000;

function constrainedCodeAt(cursor: number): string {
  const poolId = Number.parseInt(process.env.VITEST_POOL_ID ?? '0', 10);
  const normalizedPoolId = Number.isFinite(poolId) ? Math.max(0, poolId) : 0;
  const offset = (normalizedPoolId * 997 + cursor) % CONSTRAINED_CODE_COUNT;
  return String(CONSTRAINED_CODE_MIN + offset).padStart(4, '0');
}

/**
 * 4桁制約を持つCSV取込テスト用の社員コードを予約する。
 *
 * APIテストは共有DBを1 workerで直列実行する契約である。DB上の既存値と、
 * まだ取込前の同一worker内予約値の両方を避け、時刻剰余による衝突をなくす。
 */
export async function reserveUnusedImportEmployeeCode(): Promise<string> {
  for (let attempt = 0; attempt < CONSTRAINED_CODE_COUNT; attempt += 1) {
    const candidate = constrainedCodeAt(importEmployeeCursor++);
    if (reservedImportEmployeeCodes.has(candidate)) continue;
    const existing = await prisma.employee.findUnique({
      where: { employeeCode: candidate },
      select: { id: true },
    });
    if (existing) continue;
    reservedImportEmployeeCodes.add(candidate);
    return candidate;
  }
  throw new Error('Failed to reserve an unused employeeCode for import test');
}

/** 4桁制約を持つCSV取込テスト用の管理番号を予約する。 */
export async function reserveUnusedImportItemCode(): Promise<string> {
  for (let attempt = 0; attempt < CONSTRAINED_CODE_COUNT; attempt += 1) {
    const numericCode = constrainedCodeAt(importItemCursor++);
    const candidate = `TO${numericCode}`;
    if (reservedImportItemCodes.has(candidate)) continue;
    const existing = await prisma.item.findUnique({
      where: { itemCode: candidate },
      select: { id: true },
    });
    if (existing) continue;
    reservedImportItemCodes.add(candidate);
    return candidate;
  }
  throw new Error('Failed to reserve an unused itemCode for import test');
}

/** DBへ保存するテスト補助識別子。実行単位UUIDと単調増加値で再起動後も衝突を避ける。 */
export function createImportTestToken(prefix: string): string {
  importTokenSequence += 1;
  return `${prefix}-${importTestRunId}-${importTokenSequence}`;
}

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
 * 指定apiKeyのクライアントデバイスを取得、存在しなければ作成（シード/他テストとの重複を回避）
 */
export async function getOrCreateTestClientDevice(apiKey: string): Promise<ClientDevice> {
  const existing = await prisma.clientDevice.findFirst({ where: { apiKey } });
  if (existing) return existing;
  return createTestClientDevice(apiKey);
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

/** テスト用の計測機器と NFC タグを作成 */
export async function createTestMeasuringInstrumentWithTag(data?: {
  name?: string;
  managementNumber?: string;
  rfidTagUid?: string;
}): Promise<{ instrument: MeasuringInstrument; rfidTagUid: string }> {
  const genre = await prisma.measuringInstrumentGenre.create({
    data: { name: `Test Genre ${Date.now()}-${Math.random().toString(36).slice(2)}` }
  });
  const instrument = await prisma.measuringInstrument.create({
    data: {
      name: data?.name ?? 'Test Instrument',
      managementNumber: data?.managementNumber ?? `MI-${Date.now()}`,
      genreId: genre.id
    }
  });
  const rfidTagUid = data?.rfidTagUid ?? `TAG_INST_${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await prisma.measuringInstrumentTag.create({
    data: {
      measuringInstrumentId: instrument.id,
      rfidTagUid
    }
  });
  return { instrument, rfidTagUid };
}
