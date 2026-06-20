import { z } from 'zod';

import { ORDER_NUMBER_MAX, ORDER_NUMBER_MIN } from '../../../routes/kiosk/production-schedule/shared.js';
import { displayItemIdSchema } from './leaderboard-display-item-id.js';

export const productionScheduleOrderSplitListQuerySchema = z.object({
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleOrderSplitListParamsSchema = z.object({
  sourceRowId: z.string().uuid()
});

export const productionScheduleOrderSplitReplaceBodySchema = z.object({
  resourceCd: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional().nullable(),
        splitNo: z.number().int().min(1).max(100),
        splitQuantity: z.number().int().min(1).max(1_000_000),
        dueDate: z.string().max(20).optional().nullable(),
        plannedStartDate: z.string().max(20).optional().nullable(),
        plannedEndDate: z.string().max(20).optional().nullable(),
        orderNumber: z
          .number()
          .int()
          .min(ORDER_NUMBER_MIN)
          .max(ORDER_NUMBER_MAX)
          .nullable()
          .optional()
      })
    )
    .min(1)
    .max(50),
  targetLocation: z.string().min(1).max(100).optional(),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleSplitOrderParamsSchema = z.object({
  splitId: z.string().uuid()
});

export const productionScheduleSplitOrderBodySchema = z.object({
  resourceCd: z.string().min(1).max(100),
  orderNumber: z.number().int().min(ORDER_NUMBER_MIN).max(ORDER_NUMBER_MAX).nullable(),
  targetLocation: z.string().min(1).max(100).optional(),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleSplitDueDateParamsSchema = z.object({
  splitId: z.string().uuid()
});

export const productionScheduleSplitDueDateBodySchema = z.object({
  dueDate: z.string().max(20).transform((s) => s.trim())
});

/** 順位ボード continue / decorations 用 display item ID 配列。 */
export const displayItemIdsArraySchema = z.array(displayItemIdSchema).max(20_000);
