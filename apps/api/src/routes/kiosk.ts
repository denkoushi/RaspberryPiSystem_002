import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { sendSlackNotification } from '../services/notifications/slack-webhook.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, COMPLETED_PROGRESS_VALUE } from '../services/production-schedule/constants.js';

const ORDER_NUMBER_MIN = 1;
const ORDER_NUMBER_MAX = 10;
const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;
const DEFAULT_LOCATION = 'default';
const SHARED_SEARCH_STATE_LOCATION = 'shared';

const normalizeClientKey = (rawKey: unknown): string | undefined => {
  if (typeof rawKey === 'string') {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // noop
    }
    return rawKey;
  }
  if (Array.isArray(rawKey) && rawKey.length > 0 && typeof rawKey[0] === 'string') {
    return rawKey[0];
  }
  return undefined;
};

const supportMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  page: z.string().min(1).max(200)
});

// シンプルなメモリベースのレート制限（1分に最大3件）
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1分
const RATE_LIMIT_MAX_REQUESTS = 3;

function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const requests = rateLimitMap.get(clientKey) || [];
  
  // 古いリクエストを削除
  const recentRequests = requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false; // レート制限超過
  }
  
  recentRequests.push(now);
  rateLimitMap.set(clientKey, recentRequests);
  
  // メモリリーク防止: 5分以上古いエントリを削除
  if (rateLimitMap.size > 100) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const filtered = timestamps.filter((ts) => now - ts < 5 * 60 * 1000);
      if (filtered.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, filtered);
      }
    }
  }
  
  return true;
}

const parseCsvList = (value: string | undefined): string[] => {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  );
};

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  const productionScheduleQuerySchema = z.object({
    productNo: z.string().min(1).max(100).optional(),
    q: z.string().min(1).max(200).optional(),
    resourceCds: z.string().min(1).max(400).optional(),
    resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
    hasNoteOnly: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    hasDueDateOnly: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(2000).optional(),
  });

  const productionScheduleCompleteParamsSchema = z.object({
    rowId: z.string().uuid(),
  });

  const productionScheduleOrderParamsSchema = z.object({
    rowId: z.string().uuid(),
  });

  const productionScheduleOrderBodySchema = z.object({
    resourceCd: z.string().min(1).max(100),
    orderNumber: z.number().int().min(ORDER_NUMBER_MIN).max(ORDER_NUMBER_MAX).nullable(),
  });

  const productionScheduleNoteParamsSchema = z.object({
    rowId: z.string().uuid(),
  });
  const productionScheduleNoteBodySchema = z.object({
    note: z
      .string()
      .max(100)
      .transform((s) => s.replace(/\r?\n/g, '').trim()),
  });
  const productionScheduleDueDateParamsSchema = z.object({
    rowId: z.string().uuid(),
  });
  const productionScheduleDueDateBodySchema = z.object({
    dueDate: z.string().max(20).transform((s) => s.trim()),
  });
  const productionScheduleProcessingParamsSchema = z.object({
    rowId: z.string().uuid(),
  });
  const productionScheduleProcessingBodySchema = z.object({
    processingType: z
      .string()
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim() : '')),
  });

  const productionScheduleSearchStateBodySchema = z.object({
    state: z.object({
      inputQuery: z.string().max(200).optional(),
      activeQueries: z.array(z.string().max(200)).max(20).optional(),
      activeResourceCds: z.array(z.string().max(100)).max(100).optional(),
      activeResourceAssignedOnlyCds: z.array(z.string().max(100)).max(100).optional(),
      history: z.array(z.string().max(200)).max(20).optional(),
    }),
  });
  const productionScheduleSearchHistoryBodySchema = z.object({
    history: z.array(z.string().max(200)).max(20),
  });

  const requireClientDevice = async (rawClientKey: unknown) => {
    const clientKey = normalizeClientKey(rawClientKey);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey },
    });
    if (!clientDevice) {
      throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
    }
    return { clientKey, clientDevice };
  };

  const resolveLocationKey = (clientDevice: { location?: string | null; name: string }) => {
    if (clientDevice.location && clientDevice.location.trim().length > 0) {
      return clientDevice.location.trim();
    }
    if (clientDevice.name && clientDevice.name.trim().length > 0) {
      return clientDevice.name.trim();
    }
    return DEFAULT_LOCATION;
  };

  const normalizeSearchHistory = (history: string[]): string[] => {
    const unique = new Set<string>();
    const next: string[] = [];
    history
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((item) => {
        if (unique.has(item)) return;
        unique.add(item);
        next.push(item);
      });
    return next.slice(0, 20);
  };

  const SEARCH_STATE_MISSING_ETAG = 'missing';

  const buildSearchStateEtag = (value: string): string => `W/"${value}"`;

  const normalizeIfMatchValue = (raw: string): string => {
    let value = raw.trim();
    if (value.startsWith('W/')) {
      value = value.slice(2).trim();
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value;
  };

  const parseIfMatch = (header: unknown): string | null => {
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    const first = raw.split(',')[0]?.trim();
    if (!first) return null;
    return normalizeIfMatchValue(first);
  };

  const extractSearchHistory = (state: Prisma.JsonValue | null | undefined): string[] => {
    return normalizeSearchHistory(((state as { history?: string[] } | null)?.history ?? []) as string[]);
  };

  // キオスク専用の従業員リスト取得エンドポイント（x-client-key認証のみ）
  app.get('/kiosk/employees', { config: { rateLimit: false } }, async (request) => {
    const rawClientKey = request.headers['x-client-key'];
    await requireClientDevice(rawClientKey);

    // アクティブな従業員のみを取得（基本情報のみ）
    const employees = await prisma.employee.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        displayName: true,
        department: true
      },
      orderBy: {
        displayName: 'asc'
      }
    });

    return { employees };
  });

  // 生産日程（研削工程）: 仕掛中のみ取得（x-client-key認証のみ）
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 400;
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const hasNoteOnly = query.hasNoteOnly === true;
    const hasDueDateOnly = query.hasDueDateOnly === true;

    const baseWhere = Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}`;
    const uniqueTokens = parseCsvList(rawQueryText).slice(0, 8);

    const textConditions: Prisma.Sql[] = [];
    for (const token of uniqueTokens) {
      const isNumeric = /^\d+$/.test(token);
      const isFseiban = /^[A-Za-z0-9*]{8}$/.test(token);
      const likeValue = `%${token}%`;
      if (isNumeric) {
        textConditions.push(Prisma.sql`("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue}`);
      } else if (isFseiban) {
        textConditions.push(Prisma.sql`("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${token}`);
      } else {
        textConditions.push(
          Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FSEIBAN') ILIKE ${likeValue})`
        );
      }
    }

    const resourceConditions: Prisma.Sql[] = [];
    if (resourceCds.length > 0) {
      resourceConditions.push(
        Prisma.sql`("CsvDashboardRow"."rowData"->>'FSIGENCD') IN (${Prisma.join(
          resourceCds.map((cd) => Prisma.sql`${cd}`),
          ','
        )})`
      );
    }

    if (assignedOnlyCds.length > 0) {
      resourceConditions.push(
        Prisma.sql`"CsvDashboardRow"."id" IN (
          SELECT "csvDashboardRowId"
          FROM "ProductionScheduleOrderAssignment"
          WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "location" = ${locationKey}
            AND "resourceCd" IN (${Prisma.join(
              assignedOnlyCds.map((cd) => Prisma.sql`${cd}`),
              ','
            )})
        )`
      );
    }

    const textWhere =
      textConditions.length > 0 ? Prisma.sql`(${Prisma.join(textConditions, ' OR ')})` : Prisma.empty;
    const resourceWhere =
      resourceConditions.length > 0 ? Prisma.sql`(${Prisma.join(resourceConditions, ' OR ')})` : Prisma.empty;
    // 資源CD単独では検索しない（登録製番単独・AND検索は維持）
    // 割当のみは対象が少ないため単独検索を許可する
    if (textConditions.length === 0 && resourceCds.length > 0 && assignedOnlyCds.length === 0) {
      return {
        page,
        pageSize,
        total: 0,
        rows: [],
      };
    }
    let queryWhere =
      textConditions.length > 0 && resourceConditions.length > 0
        ? Prisma.sql`AND ${textWhere} AND ${resourceWhere}`
        : textConditions.length > 0
          ? Prisma.sql`AND ${textWhere}`
          : resourceConditions.length > 0
            ? Prisma.sql`AND ${resourceWhere}`
            : Prisma.empty; // 検索条件なしの場合は全件を返す

    if (hasNoteOnly) {
      queryWhere = Prisma.sql`${queryWhere} AND "CsvDashboardRow"."id" IN (
        SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" = ${locationKey}
          AND TRIM("note") <> ''
      )`;
    }
    if (hasDueDateOnly) {
      queryWhere = Prisma.sql`${queryWhere} AND "CsvDashboardRow"."id" IN (
        SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" = ${locationKey}
          AND "dueDate" IS NOT NULL
      )`;
    }

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "CsvDashboardRow"
      WHERE ${baseWhere} ${queryWhere}
    `;
    const total = Number(countRows[0]?.total ?? 0n);

    const offset = (page - 1) * pageSize;
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        occurredAt: Date;
        rowData: Prisma.JsonValue;
        processingOrder: number | null;
        note: string | null;
        processingType: string | null;
        dueDate: Date | null;
      }>
    >`
      SELECT
        "CsvDashboardRow"."id",
        "CsvDashboardRow"."occurredAt",
        jsonb_build_object(
          'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
          'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
          'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
          'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
          'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
          'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
          'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
          'progress', "CsvDashboardRow"."rowData"->>'progress'
        ) AS "rowData",
        (
          SELECT "orderNumber"
          FROM "ProductionScheduleOrderAssignment"
          WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "location" = ${locationKey}
          LIMIT 1
        ) AS "processingOrder",
        NULLIF(TRIM("n"."note"), '') AS "note",
        "n"."processingType" AS "processingType",
        "n"."dueDate" AS "dueDate"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleRowNote" AS "n"
        ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "n"."location" = ${locationKey}
        AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      WHERE ${baseWhere} ${queryWhere}
      ORDER BY
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
        ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
        (CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END) ASC,
        ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      page,
      pageSize,
      total,
      rows,
    };
  });

  app.get('/kiosk/production-schedule/resources', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const resources = await prisma.$queryRaw<Array<{ resourceCd: string }>>`
      SELECT DISTINCT ("rowData"->>'FSIGENCD') AS "resourceCd"
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ("rowData"->>'FSIGENCD') IS NOT NULL
        AND ("rowData"->>'FSIGENCD') <> ''
      ORDER BY ("rowData"->>'FSIGENCD') ASC
    `;
    return { resources: resources.map((r) => r.resourceCd) };
  });

  app.get('/kiosk/production-schedule/order-usage', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const query = productionScheduleQuerySchema.parse(request.query);
    const resourceCds = parseCsvList(query.resourceCds);

    const usageRows = await prisma.$queryRaw<Array<{ resourceCd: string; orderNumbers: number[] }>>`
      SELECT
        "resourceCd" AS "resourceCd",
        array_agg("orderNumber" ORDER BY "orderNumber") AS "orderNumbers"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "location" = ${locationKey}
        ${
          resourceCds.length > 0
            ? Prisma.sql`AND "resourceCd" IN (${Prisma.join(
                resourceCds.map((cd) => Prisma.sql`${cd}`),
                ','
              )})`
            : Prisma.empty
        }
      GROUP BY "resourceCd"
    `;

    return {
      usage: usageRows.reduce<Record<string, number[]>>((acc, row) => {
        acc[row.resourceCd] = row.orderNumbers ?? [];
        return acc;
      }, {})
    };
  });

  // 生産日程（研削工程）: 完了にする（x-client-key認証のみ）
  app.put('/kiosk/production-schedule/:rowId/complete', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const params = productionScheduleCompleteParamsSchema.parse(request.params);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, rowData: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const current = row.rowData as Record<string, unknown>;
    const currentProgress = typeof current.progress === 'string' ? current.progress.trim() : '';
    
    // トグル動作: 既に完了している場合は未完了に戻す
    const nextRowData: Record<string, unknown> = {
      ...current,
      progress: currentProgress === COMPLETED_PROGRESS_VALUE ? '' : COMPLETED_PROGRESS_VALUE,
    };

    const currentAssignment = await prisma.productionScheduleOrderAssignment.findUnique({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.csvDashboardRow.update({
        where: { id: row.id },
        data: { rowData: nextRowData as Prisma.InputJsonValue },
      });

      if (currentAssignment) {
        await tx.productionScheduleOrderAssignment.delete({
          where: {
            csvDashboardRowId_location: {
              csvDashboardRowId: row.id,
              location: locationKey,
            },
          },
        });

        await tx.productionScheduleOrderAssignment.updateMany({
          where: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: locationKey,
            resourceCd: currentAssignment.resourceCd,
            orderNumber: { gt: currentAssignment.orderNumber },
          },
          data: { orderNumber: { decrement: 1 } },
        });
      }
    });

    return { success: true, alreadyCompleted: false, rowData: nextRowData };
  });

  // 生産日程（研削工程）: 行ごとの備考を保存（x-client-key認証のみ、100文字以内・改行不可）
  app.put('/kiosk/production-schedule/:rowId/note', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const params = productionScheduleNoteParamsSchema.parse(request.params);
    const body = productionScheduleNoteBodySchema.parse(request.body);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const note = body.note.slice(0, 100).trim();
    const existing = await prisma.productionScheduleRowNote.findUnique({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
    });
    if (note.length === 0) {
      if (existing?.dueDate || (existing?.processingType && existing.processingType.trim().length > 0)) {
        await prisma.productionScheduleRowNote.update({
          where: {
            csvDashboardRowId_location: {
              csvDashboardRowId: row.id,
              location: locationKey,
            },
          },
          data: { note: '' },
        });
      } else {
        await prisma.productionScheduleRowNote.deleteMany({
          where: {
            csvDashboardRowId: row.id,
            location: locationKey,
          },
        });
      }
      return { success: true, note: null };
    }
    await prisma.productionScheduleRowNote.upsert({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: locationKey,
        note,
      },
      update: { note },
    });

    return { success: true, note };
  });

  // 生産日程（研削工程）: 行ごとの納期日を保存（x-client-key認証のみ、YYYY-MM-DD）
  app.put('/kiosk/production-schedule/:rowId/due-date', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const params = productionScheduleDueDateParamsSchema.parse(request.params);
    const body = productionScheduleDueDateBodySchema.parse(request.body);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const dueDateText = body.dueDate.trim();
    const existing = await prisma.productionScheduleRowNote.findUnique({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
    });

    if (dueDateText.length === 0) {
      const existingNote = existing?.note?.trim() ?? '';
      const existingProcessing = existing?.processingType?.trim() ?? '';
      if (existingNote.length === 0 && existingProcessing.length === 0) {
        await prisma.productionScheduleRowNote.deleteMany({
          where: {
            csvDashboardRowId: row.id,
            location: locationKey,
          },
        });
      } else {
        await prisma.productionScheduleRowNote.update({
          where: {
            csvDashboardRowId_location: {
              csvDashboardRowId: row.id,
              location: locationKey,
            },
          },
          data: { dueDate: null },
        });
      }
      return { success: true, dueDate: null };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateText)) {
      throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください');
    }

    const dueDate = new Date(`${dueDateText}T00:00:00.000Z`);
    await prisma.productionScheduleRowNote.upsert({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: locationKey,
        note: existing?.note?.trim() ?? '',
        dueDate,
      },
      update: { dueDate },
    });

    return { success: true, dueDate };
  });

  // 生産日程（研削工程）: 行ごとの処理種別を保存（x-client-key認証のみ）
  app.put('/kiosk/production-schedule/:rowId/processing', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const params = productionScheduleProcessingParamsSchema.parse(request.params);
    const body = productionScheduleProcessingBodySchema.parse(request.body);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const incomingType = body.processingType ?? '';
    if (incomingType.length > 0 && !PROCESSING_TYPES.includes(incomingType as typeof PROCESSING_TYPES[number])) {
      throw new ApiError(400, '無効な処理種別です');
    }

    const existing = await prisma.productionScheduleRowNote.findUnique({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
    });

    if (incomingType.length === 0) {
      const existingNote = existing?.note?.trim() ?? '';
      const existingDueDate = existing?.dueDate ?? null;
      if (existingNote.length === 0 && !existingDueDate) {
        await prisma.productionScheduleRowNote.deleteMany({
          where: {
            csvDashboardRowId: row.id,
            location: locationKey,
          },
        });
      } else {
        await prisma.productionScheduleRowNote.update({
          where: {
            csvDashboardRowId_location: {
              csvDashboardRowId: row.id,
              location: locationKey,
            },
          },
          data: { processingType: null },
        });
      }
      return { success: true, processingType: null };
    }

    await prisma.productionScheduleRowNote.upsert({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: locationKey,
        note: existing?.note?.trim() ?? '',
        dueDate: existing?.dueDate ?? null,
        processingType: incomingType,
      },
      update: { processingType: incomingType },
    });

    return { success: true, processingType: incomingType };
  });

  app.put('/kiosk/production-schedule/:rowId/order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const params = productionScheduleOrderParamsSchema.parse(request.params);
    const body = productionScheduleOrderBodySchema.parse(request.body);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, rowData: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const rowData = row.rowData as Record<string, unknown>;
    const rowResourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD : '';
    if (rowResourceCd && rowResourceCd !== body.resourceCd) {
      throw new ApiError(400, '資源CDが一致しません');
    }

    if (body.orderNumber === null) {
      await prisma.productionScheduleOrderAssignment.deleteMany({
        where: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      });
      return { success: true, orderNumber: null };
    }

    const conflicting = await prisma.productionScheduleOrderAssignment.findFirst({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber,
        csvDashboardRowId: { not: row.id },
      },
    });
    if (conflicting) {
      throw new ApiError(409, 'この番号は既に使用されています', undefined, 'ORDER_NUMBER_CONFLICT');
    }

    await prisma.productionScheduleOrderAssignment.upsert({
      where: {
        csvDashboardRowId_location: {
          csvDashboardRowId: row.id,
          location: locationKey,
        },
      },
      update: {
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber,
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: locationKey,
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber,
      },
    });

    return { success: true, orderNumber: body.orderNumber };
  });

  app.get('/kiosk/production-schedule/search-state', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_SEARCH_STATE_LOCATION,
        },
      },
    });
    if (sharedState) {
      const history = extractSearchHistory(sharedState.state);
      const etagValue = sharedState.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
      reply.header('ETag', buildSearchStateEtag(etagValue));
      return { state: { history }, updatedAt: sharedState.updatedAt ?? null };
    }

    const fallbackState = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
        },
      },
    });
    const fallbackHistory = extractSearchHistory(fallbackState?.state ?? null);
    const fallbackEtagValue = fallbackState?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    reply.header('ETag', buildSearchStateEtag(fallbackEtagValue));
    return { state: { history: fallbackHistory }, updatedAt: fallbackState?.updatedAt ?? null };
  });

  app.get('/kiosk/production-schedule/search-history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const stored = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
        },
      },
    });
    const history = (stored?.state as { history?: string[] } | null)?.history ?? [];
    return { history, updatedAt: stored?.updatedAt ?? null };
  });

  app.put('/kiosk/production-schedule/search-state', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const ifMatch = parseIfMatch(request.headers['if-match']);
    if (!ifMatch) {
      throw new ApiError(
        428,
        'If-Matchヘッダーが必要です。再読込してから再実行してください。',
        undefined,
        'SEARCH_STATE_PRECONDITION_REQUIRED',
      );
    }
    const body = productionScheduleSearchStateBodySchema.parse(request.body);
    const incomingHistory = normalizeSearchHistory(body.state.history ?? []);
    const mergedHistory = incomingHistory;

    const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_SEARCH_STATE_LOCATION,
        },
      },
    });

    const buildConflictError = (latest: typeof sharedState | null) => {
      const latestHistory = extractSearchHistory(latest?.state ?? null);
      const latestUpdatedAt = latest?.updatedAt ?? null;
      const etagValue = latestUpdatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
      return new ApiError(
        409,
        '検索登録製番が他の端末で更新されています。再読込してやり直してください。',
        {
          state: { history: latestHistory },
          updatedAt: latestUpdatedAt,
          etag: buildSearchStateEtag(etagValue),
        },
        'SEARCH_STATE_CONFLICT',
      );
    };

    if (!sharedState) {
      const fallbackState = await prisma.kioskProductionScheduleSearchState.findUnique({
        where: {
          csvDashboardId_location: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: locationKey,
          },
        },
      });
      const fallbackEtag = fallbackState?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
      if (ifMatch !== fallbackEtag) {
        throw buildConflictError(fallbackState);
      }
      try {
        const created = await prisma.kioskProductionScheduleSearchState.create({
          data: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: SHARED_SEARCH_STATE_LOCATION,
            state: { history: mergedHistory } as Prisma.InputJsonValue,
          },
        });
        const createdEtag = created.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
        reply.header('ETag', buildSearchStateEtag(createdEtag));
        return { state: { history: mergedHistory }, updatedAt: created.updatedAt };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const latest = await prisma.kioskProductionScheduleSearchState.findUnique({
            where: {
              csvDashboardId_location: {
                csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
                location: SHARED_SEARCH_STATE_LOCATION,
              },
            },
          });
          throw buildConflictError(latest);
        }
        throw error;
      }
    }

    const sharedEtag = sharedState.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    if (ifMatch !== sharedEtag) {
      throw buildConflictError(sharedState);
    }

    const updateResult = await prisma.kioskProductionScheduleSearchState.updateMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION,
        updatedAt: sharedState.updatedAt,
      },
      data: {
        state: { history: mergedHistory } as Prisma.InputJsonValue,
      },
    });
    if (updateResult.count === 0) {
      const latest = await prisma.kioskProductionScheduleSearchState.findUnique({
        where: {
          csvDashboardId_location: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: SHARED_SEARCH_STATE_LOCATION,
          },
        },
      });
      throw buildConflictError(latest);
    }

    const updated = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_SEARCH_STATE_LOCATION,
        },
      },
    });
    const updatedEtag = updated?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    reply.header('ETag', buildSearchStateEtag(updatedEtag));
    return { state: { history: mergedHistory }, updatedAt: updated?.updatedAt ?? null };
  });

  app.put('/kiosk/production-schedule/search-history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const locationKey = resolveLocationKey(clientDevice);
    const body = productionScheduleSearchHistoryBodySchema.parse(request.body);
    const history = normalizeSearchHistory(body.history);

    const state = await prisma.kioskProductionScheduleSearchState.upsert({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
        },
      },
      update: {
        state: { history } as Prisma.InputJsonValue,
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        state: { history } as Prisma.InputJsonValue,
      },
    });
    return { history, updatedAt: state.updatedAt };
  });

  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const rawClientKey = request.headers['x-client-key'];
    // ヘッダーが文字列配列の場合や、JSON文字列化されている場合に対応
    let clientKey: string | undefined;
    if (typeof rawClientKey === 'string') {
      // JSON文字列化されている場合（"client-demo-key"）をパース
      try {
        const parsed = JSON.parse(rawClientKey);
        clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
      } catch {
        clientKey = rawClientKey;
      }
    } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
      clientKey = rawClientKey[0];
    }
    
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ 
      clientKey: clientKey ? '[REDACTED]' : undefined, 
      rawClientKey: '[REDACTED]', 
      headers: sanitizedHeaders 
    }, 'Kiosk config request');
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG
    let clientStatus: {
      temperature: number | null;
      cpuUsage: number;
      lastSeen: Date;
    } | null = null;

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey }
      });
      // 機密情報保護: clientKeyとclient.apiKeyをログから除外
      const sanitizedClient = client ? { ...client, apiKey: '[REDACTED]' } : null;
      app.log.info({ 
        client: sanitizedClient, 
        clientKey: '[REDACTED]', 
        found: !!client, 
        defaultMode: client?.defaultMode 
      }, 'Client device lookup result');
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }

      // statusClientId で ClientStatus を取得（自端末の温度・CPU負荷を返す）
      const statusClientId = (client as { statusClientId?: string | null } | null)?.statusClientId;
      if (statusClientId) {
        const status = await prisma.clientStatus.findUnique({
          where: { clientId: statusClientId }
        });
        if (status) {
          clientStatus = {
            temperature: status.temperature,
            cpuUsage: status.cpuUsage,
            lastSeen: status.lastSeen
          };
        }
      }
    }

    // 機密情報保護: clientKeyをログから除外
    app.log.info({ 
      defaultMode, 
      clientKey: '[REDACTED]', 
      hasClientStatus: !!clientStatus 
    }, 'Returning kiosk config');
    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode,
      clientStatus
    };
  });

  /**
   * キオスク通話向けの発信先一覧
   * - x-client-key 認証のみ（管理ユーザーのJWTは不要）
   * - ClientStatus(clientId) と ClientDevice(statusClientId) を突き合わせて location を付与
   */
  app.get('/kiosk/call/targets', { config: { rateLimit: false } }, async (request) => {
    const clientKey = normalizeClientKey(request.headers['x-client-key']);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const selfDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    if (!selfDevice) {
      throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
    }

    const statuses = await prisma.clientStatus.findMany({
      orderBy: { hostname: 'asc' }
    });
    const statusClientIds = statuses.map((s) => s.clientId);

    const deviceByStatusId = new Map<string, { name: string; location: string | null }>();
    if (statusClientIds.length > 0) {
      const devices = await prisma.clientDevice.findMany({
        where: { statusClientId: { in: statusClientIds } },
        select: { statusClientId: true, name: true, location: true }
      });
      for (const d of devices) {
        if (d.statusClientId) {
          deviceByStatusId.set(d.statusClientId, { name: d.name, location: d.location ?? null });
        }
      }
    }

    // 既存の /clients/status と同じ閾値（12時間）
    const staleThresholdMs = 1000 * 60 * 60 * 12;
    const now = Date.now();
    const selfClientId = selfDevice.statusClientId ?? null;

    return {
      selfClientId,
      targets: statuses
        .map((status) => {
          const lastSeen = status.lastSeen ?? status.updatedAt;
          const stale = now - lastSeen.getTime() > staleThresholdMs;
          const device = deviceByStatusId.get(status.clientId);
          return {
            clientId: status.clientId,
            hostname: status.hostname,
            ipAddress: status.ipAddress,
            lastSeen,
            stale,
            name: device?.name ?? status.hostname,
            location: device?.location ?? null
          };
        })
        .filter((t) => t.clientId !== selfClientId)
    };
  });

  app.post('/kiosk/support', { config: { rateLimit: false } }, async (request) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:224',message:'/kiosk/support endpoint called',data:{requestId:request.id,hasRawClientKey:!!request.headers['x-client-key']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    const rawClientKey = request.headers['x-client-key'];
    const clientKey = normalizeClientKey(rawClientKey);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:228',message:'clientKey normalized',data:{requestId:request.id,hasClientKey:!!clientKey,clientKeyLength:clientKey?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    // レート制限チェック
    const rateLimitPassed = checkRateLimit(clientKey);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:235',message:'rate limit check',data:{requestId:request.id,rateLimitPassed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    if (!rateLimitPassed) {
      throw new ApiError(429, 'リクエストが多すぎます。しばらく待ってから再度お試しください。', undefined, 'RATE_LIMIT_EXCEEDED');
    }

    const body = supportMessageSchema.parse(request.body);
    
    // クライアントデバイスを取得
    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });

    if (!clientDevice) {
      throw new ApiError(401, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
    }

    // clientIdはリクエストボディから取得（なければclientDevice.idを使用）
    const clientId = (request.body as { clientId?: string })?.clientId || clientDevice.id;

    // クライアントログとして保存
    const logMessage = `[SUPPORT] ${body.message}`;
    await prisma.clientLog.create({
      data: {
        clientId,
        level: 'INFO',
        message: logMessage.slice(0, 1000),
        context: {
          kind: 'kiosk-support',
          page: body.page,
          clientId,
          clientDeviceId: clientDevice.id,
          clientName: clientDevice.name,
          location: clientDevice.location,
          userMessage: body.message
        } as Prisma.InputJsonValue
      }
    });

    // Slack通知を送信（非同期、エラーはログに記録するがAPIレスポンスには影響しない）
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:271',message:'calling sendSlackNotification',data:{requestId:request.id,clientId,clientName:clientDevice.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    sendSlackNotification({
      clientId,
      clientName: clientDevice.name,
      location: clientDevice.location || undefined,
      page: body.page,
      message: body.message,
      requestId: request.id
    }).then(() => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:278',message:'sendSlackNotification resolved',data:{requestId:request.id,clientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    }).catch((error) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:281',message:'sendSlackNotification rejected',data:{requestId:request.id,clientId,errorName:error instanceof Error?error.name:'unknown',errorMessage:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      app.log.error(
        { err: error, requestId: request.id, clientId },
        '[KioskSupport] Failed to send Slack notification'
      );
    });

    return { requestId: request.id };
  });
}
