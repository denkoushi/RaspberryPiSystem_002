import { z } from 'zod';

import type { SignageCanvasLayoutConfig } from './signage-layout.types.js';

export const SIGNAGE_CANVAS_DEFAULT_WIDTH = 1920;
export const SIGNAGE_CANVAS_DEFAULT_HEIGHT = 1080;
export const SIGNAGE_CANVAS_MAX_ELEMENTS = 12;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const geometrySchema = z.object({
  id: z.string().trim().min(1).max(64),
  x: z.number().int().min(0).max(3839),
  y: z.number().int().min(0).max(2159),
  width: z.number().int().min(1).max(3840),
  height: z.number().int().min(1).max(2160),
}).strict();

const textStyleSchema = z.object({
  fontSize: z.number().int().min(12).max(200).optional(),
  fontWeight: z.enum(['normal', '600', '700']).optional(),
  color: hexColorSchema.optional(),
  align: z.enum(['start', 'middle', 'end']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
}).strict();

const productionScheduleConfigSchema = z.object({
  view: z.enum(['table', 'kpi', 'series']).optional(),
}).strict();

const measuringInstrumentsConfigSchema = z.object({
  metric: z.enum(['usage_top', 'return_rate']).optional(),
  periodDays: z.number().int().min(1).max(90).optional(),
  topN: z.number().int().min(1).max(20).optional(),
}).strict();

const palletBoardConfigSchema = z.object({
  machineCds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
}).strict();

const rendererConfigSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  maxRows: z.number().int().min(1).max(100).optional(),
  maxIncompletePartsPerCard: z.number().int().min(1).max(20).optional(),
  showIncompleteParts: z.boolean().optional(),
  colors: z.object({
    good: hexColorSchema.optional(),
    bad: hexColorSchema.optional(),
    neutral: hexColorSchema.optional(),
  }).strict().optional(),
}).strict();

const visualizationElementSchema = geometrySchema.extend({
  kind: z.literal('visualization'),
  title: z.string().trim().min(1).max(120).optional(),
  dataSourceType: z.enum(['production_schedule', 'measuring_instruments', 'pallet_visualization_board']),
  dataSourceConfig: z.record(z.unknown()),
  rendererType: z.enum(['kpi_cards', 'table', 'bar_chart', 'progress_list', 'pallet_visualization_board']),
  rendererConfig: rendererConfigSchema,
}).strict().superRefine((value, ctx) => {
  const sourceConfig = value.dataSourceType === 'production_schedule'
    ? productionScheduleConfigSchema.safeParse(value.dataSourceConfig)
    : value.dataSourceType === 'measuring_instruments'
      ? measuringInstrumentsConfigSchema.safeParse(value.dataSourceConfig)
      : palletBoardConfigSchema.safeParse(value.dataSourceConfig);
  if (!sourceConfig.success) {
    for (const issue of sourceConfig.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataSourceConfig', ...issue.path],
        message: issue.message,
      });
    }
    return;
  }

  const sourceView = value.dataSourceType === 'production_schedule'
    ? ((sourceConfig.data as { view?: 'table' | 'kpi' | 'series' }).view ?? 'table')
    : value.dataSourceType === 'measuring_instruments'
      ? ((sourceConfig.data as { metric?: 'usage_top' | 'return_rate' }).metric ?? 'usage_top')
      : 'pallet_board';
  const compatible = value.dataSourceType === 'production_schedule'
    ? sourceView === 'table'
      ? ['table', 'progress_list'].includes(value.rendererType)
      : sourceView === 'kpi'
        ? value.rendererType === 'kpi_cards'
        : value.rendererType === 'bar_chart'
    : value.dataSourceType === 'measuring_instruments'
      ? sourceView === 'return_rate'
        ? value.rendererType === 'kpi_cards'
        : value.rendererType === 'bar_chart'
      : value.rendererType === 'pallet_visualization_board';
  if (!compatible) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rendererType'],
      message: `${value.dataSourceType}のデータ表現とrendererTypeの組み合わせに対応していません`,
    });
  }
});

const textElementSchema = geometrySchema.extend({
  kind: z.literal('text'),
  text: z.string().max(500),
  style: textStyleSchema.optional(),
}).strict();

// superRefine turns a Zod object into ZodEffects, which cannot be inspected by
// discriminatedUnion in the Zod version used by the API. The two branches are
// still strict and each has a literal `kind`, so a plain union retains the same
// input contract without making module initialization fail.
export const signageCanvasElementSchema = z.union([
  textElementSchema,
  visualizationElementSchema,
]);

const signageCanvasLayoutBaseSchema = z.object({
  layout: z.literal('CANVAS'),
  width: z.number().int().min(640).max(3840).default(SIGNAGE_CANVAS_DEFAULT_WIDTH),
  height: z.number().int().min(360).max(2160).default(SIGNAGE_CANVAS_DEFAULT_HEIGHT),
  backgroundColor: hexColorSchema.default('#020617'),
  elements: z.array(signageCanvasElementSchema).min(1).max(SIGNAGE_CANVAS_MAX_ELEMENTS),
}).strict();

function validateCanvasBounds(
  value: { width: number; height: number; elements: Array<{ id: string; x: number; y: number; width: number; height: number }> },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  value.elements.forEach((element, index) => {
    if (ids.has(element.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['elements', index, 'id'], message: 'element id must be unique' });
    }
    ids.add(element.id);
    if (element.x + element.width > value.width) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['elements', index, 'width'], message: 'element must fit within canvas width' });
    }
    if (element.y + element.height > value.height) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['elements', index, 'height'], message: 'element must fit within canvas height' });
    }
  });
}

export const signageCanvasLayoutSchema = signageCanvasLayoutBaseSchema.superRefine(validateCanvasBounds);

export const signageCanvasSpecSchema = signageCanvasLayoutBaseSchema.omit({ layout: true }).superRefine(validateCanvasBounds);

export type SignageCanvasSpec = z.infer<typeof signageCanvasSpecSchema>;

export const SIGNAGE_CANVAS_DATA_SOURCE_DESCRIPTIONS = [
  {
    type: 'production_schedule',
    views: ['table', 'kpi', 'series'],
    description: '共有された生産スケジュール検索履歴に対する進捗集計。tableは製番別、kpiは製番・部品・完了・進捗率、seriesは製番別進捗率。',
  },
  {
    type: 'measuring_instruments',
    views: ['usage_top', 'return_rate'],
    description: '計測機器の既存貸出データ。usage_topは期間内使用回数、return_rateは期限内返却率など。',
  },
  {
    type: 'pallet_visualization_board',
    views: ['pallet_board'],
    description: '既存の加工機・パレット可視化データ。machineCdsを指定した絞り込みに対応。',
  },
] as const;

export function toSignageCanvasLayout(spec: SignageCanvasSpec): SignageCanvasLayoutConfig {
  return {
    layout: 'CANVAS',
    ...spec,
  };
}
