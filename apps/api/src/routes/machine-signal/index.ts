import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { assertKioskApiClientKeyValid } from '../../services/clients/client-device-auth.service.js';
import { getMachineSignalAdminOverview } from '../../services/machine-signal/machine-signal-admin.service.js';
import {
  getMachineSignalGmailIngestionService,
  hasGmailCredentials,
} from '../../services/machine-signal/machine-signal-gmail-ingestion.service.js';
import {
  getMachineSignalDay,
  getMachineSignalTrend,
  listMachineSignalSensorsForAdmin,
} from '../../services/machine-signal/machine-signal-insights.service.js';
import {
  getMachineSignalSettings,
  MACHINE_SIGNAL_SENSOR_KINDS,
  updateMachineSignalSensor,
  updateMachineSignalSensorsBulk,
  updateMachineSignalSettings,
} from '../../services/machine-signal/machine-signal-settings.service.js';
import {
  importSignalReportFiles,
  listSignalImportRuns,
  type SignalReportFile,
} from '../../services/machine-signal/signal-report-import.service.js';
import { SIGNAL_CATEGORIES } from '../../services/machine-signal/signal-report.types.js';

const BASE = '/machine-signal';
/** 過去分の一括取り込みは日付フォルダごとに多数のCSVを送るので、既定（10ファイル）より広げる。 */
const IMPORT_MAX_FILES = 200;
const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 過去分は50ファイルずつ続けて送られる（2年分で700回ほど）。止めない範囲で上限を置く。 */
const importRateLimit = { max: 600, timeWindow: '1 minute' };
/** Gmail の手動確認は1回で添付の数だけ Gmail を呼ぶので、連打させない。 */
const gmailRunRateLimit = { max: 6, timeWindow: '1 minute' };
export const MACHINE_SIGNAL_TREND_DAYS = [30, 90] as const;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minuteSchema = z.number().int().min(0).max(1_439);
const secondsSchema = z.number().int().min(0).max(86_400);
const kwSchema = z.number().min(0).max(10_000).nullable();

const dayQuerySchema = z.object({ date: dateSchema.optional(), site: z.string().trim().min(1).max(80).optional() });
const trendQuerySchema = z.object({
  endDate: dateSchema,
  days: z.coerce
    .number()
    .refine((value): value is (typeof MACHINE_SIGNAL_TREND_DAYS)[number] =>
      (MACHINE_SIGNAL_TREND_DAYS as readonly number[]).includes(value)
    )
    .default(30),
});
const signalNoParamsSchema = z.object({ signalNo: z.coerce.number().int().min(0).max(100_000) });

const settingsBodySchema = z.object({
  nightStartMinute: minuteSchema,
  thresholds: z.object({
    shortStopMaxSeconds: secondsSchema,
    longStopMinSeconds: secondsSchema,
    shortStopCountForHint: z.number().int().min(1).max(10_000),
    alarmSecondsForHint: secondsSchema,
    alarmCountForHint: z.number().int().min(1).max(10_000),
    barelyRanMaxSeconds: secondsSchema,
    goodRunMinSeconds: secondsSchema,
    worseningPercent: z.number().int().min(5).max(95),
  }),
});

const sensorBodySchema = z.object({
  displayName: z.string().trim().max(200).nullable(),
  site: z.string().trim().max(80).nullable(),
  kind: z.enum(MACHINE_SIGNAL_SENSOR_KINDS),
  hidden: z.boolean(),
  plannedStartMinute: minuteSchema.nullable(),
  plannedEndMinute: minuteSchema.nullable(),
  runningKw: kwSchema,
  idleKw: kwSchema,
  categoryOverrides: z.record(z.string().regex(/^[0124]{3}$/), z.enum(SIGNAL_CATEGORIES)),
});

const sensorBulkBodySchema = z.object({
  signalNos: z.array(z.number().int().min(0).max(100_000)).min(1).max(500),
  patch: z.object({
    site: z.string().trim().max(80).nullable().optional(),
    kind: z.enum(MACHINE_SIGNAL_SENSOR_KINDS).optional(),
    hidden: z.boolean().optional(),
    planned: z.object({ startMinute: minuteSchema, endMinute: minuteSchema }).nullable().optional(),
  }),
});

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export type MachineSignalRouteDeps = { allowView: PreHandler; canManage: PreHandler };

function buildDefaultDeps(): MachineSignalRouteDeps {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  return {
    /** キオスク（クライアントキー）またはログイン済みの利用者が閲覧できる。 */
    allowView: async (request, reply) => {
      if (request.headers.authorization) {
        try {
          await canView(request, reply);
          return;
        } catch (error) {
          // 期限切れのログインが残ったキオスクでも、クライアントキーが正しければ見られるようにする。
          if ((error as { statusCode?: number }).statusCode !== 401) throw error;
        }
      }
      await assertKioskApiClientKeyValid(request.headers['x-client-key']);
      if (reply.statusCode === 401) reply.code(200);
    },
    canManage: authorizeRoles('ADMIN', 'MANAGER'),
  };
}

export function registerMachineSignalRoutes(app: FastifyInstance, deps: MachineSignalRouteDeps = buildDefaultDeps()): void {
  const { allowView, canManage } = deps;

  app.get(`${BASE}/day`, { preHandler: allowView }, async (request) =>
    getMachineSignalDay(dayQuerySchema.parse(request.query))
  );

  app.get(`${BASE}/sensors/:signalNo/trend`, { preHandler: allowView }, async (request) => {
    const { signalNo } = signalNoParamsSchema.parse(request.params);
    const query = trendQuerySchema.parse(request.query);
    return { points: await getMachineSignalTrend({ signalNo, endDate: query.endDate, days: query.days }) };
  });

  app.get(`${BASE}/settings`, { preHandler: canManage }, async () => ({ settings: await getMachineSignalSettings() }));

  app.put(`${BASE}/settings`, { preHandler: canManage }, async (request) => ({
    settings: await updateMachineSignalSettings(settingsBodySchema.parse(request.body), request.user?.username ?? null),
  }));

  app.get(`${BASE}/sensors`, { preHandler: canManage }, async () => ({
    sensors: await listMachineSignalSensorsForAdmin(),
  }));

  app.get(`${BASE}/admin/overview`, { preHandler: canManage }, async () => ({
    overview: await getMachineSignalAdminOverview(),
  }));

  app.put(`${BASE}/sensors/bulk`, { preHandler: canManage }, async (request) => {
    const body = sensorBulkBodySchema.parse(request.body);
    return { updated: await updateMachineSignalSensorsBulk(body.signalNos, body.patch) };
  });

  app.put(`${BASE}/sensors/:signalNo`, { preHandler: canManage }, async (request) => {
    const { signalNo } = signalNoParamsSchema.parse(request.params);
    return { sensor: await updateMachineSignalSensor(signalNo, sensorBodySchema.parse(request.body)) };
  });

  app.get(`${BASE}/import-runs`, { preHandler: canManage }, async () => ({ runs: await listSignalImportRuns() }));

  app.post(`${BASE}/import`, { preHandler: canManage, config: { rateLimit: importRateLimit } }, async (request) => {
    if (!request.isMultipart()) {
      throw new ApiError(400, 'multipart/form-data で送信してください', undefined, 'MACHINE_SIGNAL_IMPORT_NOT_MULTIPART');
    }
    const files: SignalReportFile[] = [];
    for await (const part of request.parts({ limits: { files: IMPORT_MAX_FILES, fileSize: IMPORT_MAX_FILE_BYTES } })) {
      if (part.type !== 'file') continue;
      files.push({ fileName: part.filename, content: await part.toBuffer() });
    }
    if (files.length === 0) {
      throw new ApiError(400, 'CSVファイルを選んでください', undefined, 'MACHINE_SIGNAL_IMPORT_EMPTY');
    }
    return { run: await importSignalReportFiles(files, { source: 'UPLOAD' }) };
  });

  app.post(`${BASE}/gmail-import/run`, { preHandler: canManage, config: { rateLimit: gmailRunRateLimit } }, async () => {
    const config = await BackupConfigLoader.load();
    if (!hasGmailCredentials(config)) {
      throw new ApiError(409, 'Gmail の連携が未設定です', undefined, 'MACHINE_SIGNAL_GMAIL_NOT_CONFIGURED');
    }
    return { summary: await getMachineSignalGmailIngestionService().runOnce({ config, allowWait: true }) };
  });
}
