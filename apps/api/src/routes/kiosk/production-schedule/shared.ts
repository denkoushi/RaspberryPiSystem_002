import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { z } from 'zod';
import { DUE_MANAGEMENT_TUNING_REASON_CODES } from '../../../services/production-schedule/auto-tuning/tuning-reason-code.js';
import { displayItemIdSchema } from '../../../services/production-schedule/order-split/leaderboard-display-item-id.js';
import type { LeaderboardShellSnapshotStore } from '../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js';
import type { ClientDeviceForScopeResolution, LocationScopeContext } from '../shared.js';

export const ORDER_NUMBER_MIN = 1;
export const ORDER_NUMBER_MAX = 10;
export const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

export const productionScheduleQuerySchema = z.object({
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

/** 順位ボード段階取得用（一覧と同一クエリ、`responseProfile` は不要）。 */
export const productionScheduleLeaderboardPhasedQuerySchema = productionScheduleQuerySchema.omit({
  responseProfile: true
});

/** 順位ボード shell 続き取得の共通フィールド（単一資源 continue / 集約 continue で再利用） */
export const productionScheduleLeaderboardShellContinuationFieldsSchema = z.object({
  /** shell 応答で返却された snapshot。付与時は continue が軽量経路になる。 */
  snapshotId: z.string().uuid().optional(),
  /**
   * snapshot 並びでの次読み取り位置（0-based・既に返した行数）。
   * shell の `nextCursor` をそのまま送る。`snapshotId` がある場合はこれを優先する。
   */
  cursor: z.number().int().min(0).max(5_000_000).optional(),
  /** 移行期間のみ: snapshot が無い、または snapshot+cursor より古いクライアント向け（中身は DisplayItemId） */
  excludeRowIds: z.array(displayItemIdSchema).max(900).optional(),
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
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

/** 順位ボード shell 続き取得（POST・旧 excludeRowIds 全送は後方互換のみ） */
export const productionScheduleLeaderboardShellContinuationBodySchema =
  productionScheduleLeaderboardShellContinuationFieldsSchema.superRefine((data, ctx) => {
    const hasSnapshot = Boolean(data.snapshotId?.trim());
    const hasCursor = data.cursor !== undefined;
    const excludeLen = data.excludeRowIds?.length ?? 0;

    if (hasSnapshot) {
      if (hasCursor) return;
      if (excludeLen >= 1) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'snapshotId 指定時は cursor、または後方互換として excludeRowIds（1件以上）が必要です',
        path: ['cursor']
      });
      return;
    }

    if (excludeLen >= 1) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'snapshotId が無い場合は excludeRowIds（1件以上）が必要です（snapshotId + cursor でも可）',
      path: ['excludeRowIds']
    });
  });

/** board 集約: 装飾（機種名・顧客名・フッタチップ）を同梱するか。省略時 true（後方互換）。 */
export const productionScheduleLeaderboardIncludeDecorationsField = {
  includeDecorations: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v): boolean => {
      if (v === undefined) return true;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      return s !== 'false' && s !== '0';
    })
};

/** board 集約: 人工数 lookup を同梱するか。省略時 false（旧 SPA の first usable を優先）。 */
export const productionScheduleLeaderboardIncludeLaborField = {
  includeLabor: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v): boolean => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      return s !== 'false' && s !== '0';
    })
};

/** 順位ボード集約 API: スロット順の資源 CD（カンマ区切り・重複除去はサーバ側 parseCsvList） */
export const productionScheduleLeaderboardBoardQuerySchema = productionScheduleLeaderboardPhasedQuerySchema.extend({
  boardResourceCds: z.string().min(1).max(4000),
  /** true のとき初回 shell は exact total COUNT を待たず、continue で正確な total に戻す。 */
  deferTotals: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v): boolean => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === '1';
    }),
  ...productionScheduleLeaderboardIncludeDecorationsField,
  ...productionScheduleLeaderboardIncludeLaborField
});

/** 集約 continue: 各スロットごとの snapshot / cursor（単一 continue と同じ制約をスライス単位で適用） */
export const productionScheduleLeaderboardBoardContinueBodySchema = productionScheduleLeaderboardShellContinuationFieldsSchema
  .omit({
    snapshotId: true,
    cursor: true,
    excludeRowIds: true
  })
  .extend({
    boardResourceCds: z.string().min(1).max(4000),
    includeDecorations: z.boolean().optional().default(true),
    includeLabor: z.boolean().optional().default(false),
    resourceSlices: z
      .array(
        z.object({
          resourceCd: z.string().min(1).max(100),
          snapshotId: z.string().uuid().optional(),
          cursor: z.number().int().min(0).max(5_000_000).optional(),
          excludeRowIds: z.array(displayItemIdSchema).max(900).optional(),
          hasMore: z.boolean()
        })
      )
      .min(1)
      .max(100)
  })
  .superRefine((data, ctx) => {
    const expected = parseCsvList(data.boardResourceCds);
    if (data.resourceSlices.length !== expected.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resourceSlices の件数は boardResourceCds（カンマ区切り）の件数と一致させてください',
        path: ['resourceSlices']
      });
      return;
    }
    for (let i = 0; i < expected.length; i += 1) {
      if (data.resourceSlices[i]!.resourceCd !== expected[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'resourceSlices[i].resourceCd は boardResourceCds の順序・値と一致させてください',
          path: ['resourceSlices', i, 'resourceCd']
        });
      }
    }
    for (let i = 0; i < data.resourceSlices.length; i += 1) {
      const slice = data.resourceSlices[i]!;
      if (!slice.hasMore) continue;
      const hasSnapshot = Boolean(slice.snapshotId?.trim());
      const hasCursor = slice.cursor !== undefined;
      const excludeLen = slice.excludeRowIds?.length ?? 0;
      if (hasSnapshot) {
        if (hasCursor) continue;
        if (excludeLen >= 1) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'snapshotId 指定時は cursor、または後方互換として excludeRowIds（1件以上）が必要です',
          path: ['resourceSlices', i, 'cursor']
        });
      } else if (excludeLen < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'snapshotId が無い場合は excludeRowIds（1件以上）が必要です',
          path: ['resourceSlices', i, 'excludeRowIds']
        });
      }
    }
  });

export type ProductionScheduleLeaderboardShellContinuationBody = z.infer<
  typeof productionScheduleLeaderboardShellContinuationBodySchema
>;

export const productionScheduleLeaderboardDecorationsBodySchema = z.object({
  /** shell 応答の `rows[].id` を **表示順のまま** 渡す（DisplayItemId・順位ボード全件表示に合わせ上限を緩和） */
  rowIds: z.array(displayItemIdSchema).max(20_000).optional().default([]),
  /** v2: Mac が参照する端末の deviceScopeKey（一覧 shell/total と一致させる） */
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleLeaderboardClientPerfBodySchema = z.object({
  sessionId: z.string().min(1).max(80),
  event: z.string().min(1).max(80),
  pagePath: z.string().min(1).max(300).optional(),
  paramsKeyHash: z.string().min(1).max(80).optional(),
  resourceCds: z.string().min(1).max(4000).optional(),
  markMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  elapsedMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  detail: z
    .record(z.union([z.string().max(400), z.number().finite(), z.boolean(), z.null()]))
    .optional()
});

export const productionScheduleOrderSearchQuerySchema = z.object({
  resourceCds: z.string().min(1).max(400),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  machineName: z.string().min(1).max(200).optional(),
  productNoPrefix: z.string().regex(/^\d{5,10}$/),
  partName: z.string().min(1).max(200).optional()
});

export const parseCsvList = (value: string | undefined): string[] => {
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

export type LegacyLocationKey = string;

// Bridge helper: legacy service contracts still consume `locationKey` string.
// Callers must pass `deviceScopeKey` explicitly at route boundaries.
export const toLegacyLocationKeyFromDeviceScope = (
  deviceScopeKey: LocationScopeContext['deviceScopeKey']
): LegacyLocationKey =>
  deviceScopeKey;

export const productionScheduleCompleteParamsSchema = z.object({
  rowId: z.string().uuid()
});

/** キオスク完了の明示指定（トグルではない） */
export const productionScheduleCompletionIntentBodySchema = z.object({
  intent: z.enum(['complete', 'incomplete'])
});

export const productionScheduleOrderParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleOrderBodySchema = z.object({
  resourceCd: z.string().min(1).max(100),
  orderNumber: z.number().int().min(ORDER_NUMBER_MIN).max(ORDER_NUMBER_MAX).nullable(),
  targetLocation: z.string().min(1).max(100).optional(),
  /** v2: Mac 代理更新時に必須 */
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleNoteParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleNoteBodySchema = z.object({
  note: z
    .string()
    .max(100)
    .transform((s) => s.replace(/\r?\n/g, '').trim())
});

export const productionScheduleDueDateParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleDueDateBodySchema = z.object({
  dueDate: z.string().max(20).transform((s) => s.trim())
});

export const productionScheduleProcessingParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleProcessingBodySchema = z.object({
  processingType: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : ''))
});

export const productionScheduleSearchStateBodySchema = z.object({
  state: z.object({
    inputQuery: z.string().max(200).optional(),
    activeQueries: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX).optional(),
    activeResourceCds: z.array(z.string().max(100)).max(100).optional(),
    activeResourceAssignedOnlyCds: z.array(z.string().max(100)).max(100).optional(),
    history: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX).optional()
  })
});

export const productionScheduleSearchHistoryBodySchema = z.object({
  history: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX)
});

/** 素の入力を多めに受け、trim・重複除去後に 100 件まで保持する。 */
export const productionScheduleSeibanMachineNamesBodySchema = z
  .object({
    fseibans: z.array(z.string().max(200)).max(100)
  })
  .transform((body) => ({
    fseibans: Array.from(
      new Set(body.fseibans.map((value) => value.trim()).filter((value) => value.length > 0))
    ).slice(0, 100)
  }));

export const productionScheduleDueManagementSeibanParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementFilterQuerySchema = z.object({
  resourceCd: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : undefined)),
  resourceCategory: z.enum(['grinding', 'cutting']).optional()
});

export const productionScheduleDueManagementSeibanProcessingParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim()),
  processingType: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementSeibanDueDateBodySchema = z.object({
  dueDate: z.string().max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementPartPrioritiesBodySchema = z.object({
  orderedFhincds: z.array(z.string().min(1).max(50)).max(2000)
});

export const productionScheduleDueManagementPartParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim()),
  fhincd: z.string().min(1).max(50).transform((value) => value.trim())
});

export const productionScheduleDueManagementTriageSelectionBodySchema = z.object({
  selectedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000)
});

export const productionScheduleDueManagementDailyPlanBodySchema = z.object({
  orderedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000)
});

export const productionScheduleDueManagementGlobalRankBodySchema = z.object({
  orderedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000),
  reasonCode: z.enum(DUE_MANAGEMENT_TUNING_REASON_CODES).optional(),
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementGlobalRankAutoGenerateBodySchema = z
  .object({
    minCandidateCount: z.number().int().min(1).max(2000).optional(),
    maxReorderDeltaRatio: z.number().min(0).max(1).optional(),
    keepExistingTail: z.boolean().optional(),
    targetLocation: z.string().min(1).max(100).optional(),
    rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
  })
  .optional();

export const productionScheduleDueManagementGlobalRankQuerySchema = productionScheduleDueManagementFilterQuerySchema.extend({
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementGlobalRankExplanationParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementLearningReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementManualOrderOverviewQuerySchema = z.object({
  targetLocation: z.string().min(1).max(100).optional(),
  /** v2: 工場キー（必須・サーバ側で検証） */
  siteKey: z.string().min(1).max(100).optional(),
  /** v2: 端末で絞り込み。`__legacy_site__` で旧サイト単位行のみ */
  deviceScopeKey: z.string().min(1).max(200).optional(),
  resourceCd: z.string().max(100).optional()
});

export const productionScheduleDueManagementActualHoursImportBodySchema = z.object({
  csvContent: z.string().min(1),
});

export const productionScheduleDueManagementActualHoursStatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type KioskRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: ClientDeviceForScopeResolution;
  }>;
  resolveLocationScopeContext: (clientDevice: ClientDeviceForScopeResolution) => LocationScopeContext;
  resolveTargetLocation: (params: { requestedTargetLocation?: string; actorLocation: string }) => string;
  /** 順位ボード shell 段階取得の並び固定（TTL 付きインメモリ）。 */
  leaderboardShellSnapshotStore: LeaderboardShellSnapshotStore;
};
