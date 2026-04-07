import { z } from 'zod';

// layoutConfigのスキーマ定義
const pdfSlotConfigSchema = z
  .object({
    pdfId: z.string().uuid(),
    displayMode: z.enum(['SLIDESHOW', 'SINGLE']),
    slideInterval: z.number().int().positive().optional().nullable(),
  })
  .strict();

// 空オブジェクトは「何でも通してキーを捨てる」挙動を避けるため strict にする
const loansSlotConfigSchema = z.object({}).strict();

const csvDashboardSlotConfigSchema = z
  .object({
    csvDashboardId: z.string().uuid(),
  })
  .strict();

const visualizationSlotConfigSchema = z
  .object({
    visualizationDashboardId: z.string().uuid(),
  })
  .strict();

const kioskProgressOverviewSlotConfigSchema = z
  .object({
    deviceScopeKey: z.string().min(1).max(200),
    slideIntervalSeconds: z.number().int().positive().optional(),
    seibanPerPage: z.number().int().min(1).max(8).optional(),
  })
  .strict();

const kioskLeaderOrderCardsSlotConfigSchema = z
  .object({
    deviceScopeKey: z.string().min(1).max(200),
    resourceCds: z.array(z.string().min(1).max(100)).min(1).max(32),
    slideIntervalSeconds: z.number().int().positive().optional(),
    cardsPerPage: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const slotConfigSchema = z.union([
  pdfSlotConfigSchema,
  loansSlotConfigSchema,
  csvDashboardSlotConfigSchema,
  visualizationSlotConfigSchema,
  kioskProgressOverviewSlotConfigSchema,
  kioskLeaderOrderCardsSlotConfigSchema,
]);

const slotSchema = z.object({
  position: z.enum(['FULL', 'LEFT', 'RIGHT']),
  kind: z.enum([
    'pdf',
    'loans',
    'csv_dashboard',
    'visualization',
    'kiosk_progress_overview',
    'kiosk_leader_order_cards',
  ]),
  config: slotConfigSchema,
});

const layoutConfigSchema = z.object({
  layout: z.enum(['FULL', 'SPLIT']),
  slots: z.array(slotSchema).min(1),
}).optional().nullable();

export const scheduleSchema = z.object({
  name: z.string().min(1),
  contentType: z.enum(['TOOLS', 'PDF', 'SPLIT']),
  pdfId: z.string().uuid().optional().nullable(),
  layoutConfig: layoutConfigSchema,
  /** 空または未指定=全端末向け。値ありのときは ClientDevice.apiKey と一致する端末のみ */
  targetClientKeys: z.array(z.string().min(1).max(512)).max(500).optional(),
  dayOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  priority: z.number().int().min(0),
  enabled: z.boolean().optional(),
});

export const scheduleUpdateSchema = scheduleSchema.partial();

export const scheduleParamsSchema = z.object({
  id: z.string().uuid(),
});

export const pdfSchema = z.object({
  name: z.string().min(1),
  filename: z.string().min(1),
  filePath: z.string().min(1),
  displayMode: z.enum(['SLIDESHOW', 'SINGLE']),
  slideInterval: z.number().int().positive().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const pdfUpdateSchema = pdfSchema.partial();

export const pdfParamsSchema = z.object({
  id: z.string().uuid(),
});

export const emergencySchema = z.object({
  message: z.string().optional().nullable(),
  contentType: z.enum(['TOOLS', 'PDF', 'SPLIT']).optional().nullable(),
  pdfId: z.string().uuid().optional().nullable(),
  layoutConfig: layoutConfigSchema,
  enabled: z.boolean().optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});

