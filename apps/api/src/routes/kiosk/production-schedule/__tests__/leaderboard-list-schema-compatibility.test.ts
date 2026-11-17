import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  productionScheduleQuerySchema,
  productionScheduleLeaderboardShellContinuationFieldsSchema
} from '../shared.js';

// Frozen pre-refactor schemas: keep validators and field order independent of production definitions.
const PRODUCTION_SCHEDULE_COMPLETION_FILTER_VALUES = ['all', 'complete', 'incomplete'] as const;
const legacyQuerySchema = z.object({
  dueSource: z.enum(['excel', 'scaw']).default('excel'),
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  productNos: z.string().min(1).max(4000).optional(),
  resourceCds: z.string().min(1).max(400).optional(),
  resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  machineName: z.string().min(1).max(200).optional(),
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
  allowResourceOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  completionFilter: z.enum(PRODUCTION_SCHEDULE_COMPLETION_FILTER_VALUES).optional().default('all'),
  /** v2: Mac の一覧/usage 取得時に必須（サーバ側で検証） */
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  /**
   * `leaderboard`: キオスク順位ボード向けに actual-hours 解決を省略しレイテンシを抑える。
   * 取得は「当該スコープの手動割当行」を優先し、`resourceCds` が1件の場合は同一製番の他資源行を含めない（カード単位）。複数資源指定時のみ従来の製番展開を行う。
   * 残りを納期（補助終期を含む）昇順で `pageSize` まで補完する。
   * 手動+製番展開が `pageSize` を超える場合でも手動側は切り捨てない。
   * 機種名（`resolvedMachineName`）は full と同じバッチ解決を行い、順位ボードの表示欠落を防ぐ（既定は full）。
   */
  responseProfile: z.enum(['full', 'leaderboard']).optional(),
  /** 自主検査キオスク一覧: 開始可能な生産行だけをサーバー側で抽出（ページング） */
  selfInspectionEligibleOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
});

const legacyContinuationSchema = z.object({
  dueSource: z.enum(['excel', 'scaw']).default('excel'),
  /** shell 応答で返却された snapshot。付与時は continue が軽量経路になる。 */
  snapshotId: z.string().guid().optional(),
  /**
   * snapshot 並びでの次読み取り位置（0-based・既に返した行数）。
   * shell の `nextCursor` をそのまま送る。`snapshotId` がある場合はこれを優先する。
   */
  cursor: z.number().int().min(0).max(5_000_000).optional(),
  /** 移行期間のみ: snapshot が無い、または snapshot+cursor より古いクライアント向け（中身は親 UUID） */
  excludeRowIds: z.array(z.string().guid()).max(900).optional(),
  pageSize: z.coerce.number().int().min(1).max(160).optional(),
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  productNos: z.string().min(1).max(4000).optional(),
  resourceCds: z.string().min(1).max(400).optional(),
  resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  machineName: z.string().min(1).max(200).optional(),
  hasNoteOnly: z.boolean().optional(),
  hasDueDateOnly: z.boolean().optional(),
  allowResourceOnly: z.boolean().optional(),
  completionFilter: z.enum(PRODUCTION_SCHEDULE_COMPLETION_FILTER_VALUES).optional().default('all'),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});


const result = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false, issues: parsed.error.issues };
};

const inputs: unknown[] = [
  {},
  { dueSource: 'scaw', productNo: ' legacy ', q: ' query ', productNos: 'A,A, B', resourceCds: 'R1,R2',
    resourceAssignedOnlyCds: ' R3 ', resourceCategory: 'cutting', machineName: ' M ', completionFilter: 'incomplete',
    targetDeviceScopeKey: ' device ', pageSize: '160', hasNoteOnly: '1', hasDueDateOnly: 'true', allowResourceOnly: 'false', extra: 1 },
  { hasNoteOnly: true, hasDueDateOnly: false, allowResourceOnly: true, pageSize: 160, cursor: 0,
    snapshotId: '550e8400-e29b-41d4-a716-446655440000', excludeRowIds: ['550e8400-e29b-41d4-a716-446655440000'] },
  { hasNoteOnly: 'TRUE', hasDueDateOnly: '', allowResourceOnly: '0', pageSize: 2000, page: '1' },
  { dueSource: 'bad', productNo: '', q: '', productNos: '', resourceCds: '', resourceAssignedOnlyCds: '',
    resourceCategory: 'all', machineName: '', completionFilter: 'done', targetDeviceScopeKey: '',
    hasNoteOnly: 1, hasDueDateOnly: null, allowResourceOnly: [], page: 0, pageSize: 2001,
    snapshotId: 'bad', cursor: -1, excludeRowIds: ['bad'] },
  { productNo: 'x'.repeat(101), q: 'x'.repeat(201), productNos: 'x'.repeat(4001), resourceCds: 'x'.repeat(401),
    resourceAssignedOnlyCds: 'x'.repeat(401), machineName: 'x'.repeat(201), targetDeviceScopeKey: 'x'.repeat(201),
    cursor: 5000001, excludeRowIds: Array(901).fill('550e8400-e29b-41d4-a716-446655440000'), pageSize: 1.5 },
  { productNo: 'x'.repeat(100), q: 'x'.repeat(200), productNos: 'x'.repeat(4000), resourceCds: 'x'.repeat(400),
    resourceAssignedOnlyCds: 'x'.repeat(400), machineName: 'x'.repeat(200), targetDeviceScopeKey: 'x'.repeat(200),
    resourceCategory: 'grinding', completionFilter: 'complete', pageSize: 1, cursor: 5000000 },
  { pageSize: 0, page: 1.5, responseProfile: 'invalid', selfInspectionEligibleOnly: true },
  { pageSize: 'not-number', cursor: 0.5, responseProfile: 'leaderboard', selfInspectionEligibleOnly: '1' },
  null
];

describe.each([
  ['GET', productionScheduleQuerySchema, legacyQuerySchema],
  ['POST', productionScheduleLeaderboardShellContinuationFieldsSchema, legacyContinuationSchema]
] as const)('%s schema compatibility', (_name, schema, legacy) => {
  it('preserves shape key order', () => {
    expect(Object.keys(schema.shape)).toEqual(Object.keys(legacy.shape));
  });
  it.each(inputs.map((input, index) => [index, input] as const))('preserves parse results and ordered issues: %s', (_index, input) => {
    expect(result(schema, input)).toEqual(result(legacy, input));
  });
});

it('preserves randomized GET and POST safeParse success and transformed values', () => {
  const wrongType = fc.oneof(fc.constant(null), fc.boolean(), fc.integer({ min: -1, max: 2001 }),
    fc.constant([]), fc.constant({ value: 'wrong-type' }));
  const text = (max: number) => fc.oneof(fc.string({ maxLength: Math.min(max, 40) }),
    fc.constantFrom(0, 1, max - 1, max, max + 1).map((length) => 'x'.repeat(length)));
  const optional = (arbitrary: fc.Arbitrary<unknown>) => fc.oneof(arbitrary, wrongType, fc.constant(undefined));
  const booleanValue = fc.constantFrom(true, false, 'true', 'false', '1', '0', 'TRUE', '', undefined);
  const query = fc.record({
    dueSource: optional(fc.constantFrom('excel', 'scaw', 'bad')),
    productNo: optional(text(100)), q: optional(text(200)), productNos: optional(text(4000)),
    resourceCds: optional(text(400)), resourceAssignedOnlyCds: optional(text(400)),
    resourceCategory: optional(fc.constantFrom('grinding', 'cutting', 'all')),
    machineName: optional(text(200)), targetDeviceScopeKey: optional(text(200)),
    hasNoteOnly: optional(booleanValue), hasDueDateOnly: optional(booleanValue),
    allowResourceOnly: optional(booleanValue), selfInspectionEligibleOnly: optional(booleanValue),
    page: optional(fc.constantFrom('1', '2', '0', '1.5', 'not-number', 1)),
    pageSize: optional(fc.constantFrom('1', '160', '161', '2000', '2001', '0', '1.5', 'not-number', 160)),
    completionFilter: optional(fc.constantFrom('all', 'complete', 'incomplete', 'done')),
    responseProfile: optional(fc.constantFrom('full', 'leaderboard', 'invalid')),
    snapshotId: optional(fc.constantFrom('550e8400-e29b-41d4-a716-446655440000', 'bad')),
    cursor: optional(fc.constantFrom(0, 5000000, 5000001, 0.5, '1')),
    excludeRowIds: optional(fc.constantFrom([], ['550e8400-e29b-41d4-a716-446655440000'], ['bad'])),
    unknownField: optional(text(20))
  }, { requiredKeys: [] });
  // Sparse cases exercise each field without other invalid fields masking a change.
  const sparse = query.chain((input) => fc.subarray(Object.keys(input)).map((keys) =>
    Object.fromEntries(keys.map((key) => [key, input[key as keyof typeof input]]))));
  fc.assert(fc.property(fc.oneof(query, sparse), (input) => {
    for (const [schema, legacy] of [
      [productionScheduleQuerySchema, legacyQuerySchema],
      [productionScheduleLeaderboardShellContinuationFieldsSchema, legacyContinuationSchema]
    ] as const) {
      const actual = schema.safeParse(input);
      const expected = legacy.safeParse(input);
      expect(actual.success).toBe(expected.success);
      if (actual.success && expected.success) expect(actual.data).toEqual(expected.data);
    }
  }), { numRuns: 1000 });
});
