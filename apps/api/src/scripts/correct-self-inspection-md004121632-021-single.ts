/**
 * MD004121632 / CUTTING / 021 の自主検査頻度を抜き取り1個へ補正する対象固定CLI。
 *
 * dry-run（既定）:
 *   pnpm --filter @raspi-system/api correct:self-inspection-md004121632-021-single
 *
 * 実行:
 *   pnpm --filter @raspi-system/api correct:self-inspection-md004121632-021-single -- \
 *     --execute --confirm=MD004121632/021
 */

import { prisma } from '../lib/prisma.js';
import {
  SelfInspectionSamplingPolicyCorrectionService,
  type SelfInspectionSamplingPolicyCorrectionTarget
} from '../services/part-measurement/self-inspection-sampling-policy-correction.service.js';

const CONFIRMATION = 'MD004121632/021';

export const MD004121632_021_SINGLE_TARGET = {
  correctionKey: 'self-inspection-md004121632-021-single-v1',
  templateId: 'e9e5bc7e-334f-4844-91b5-9a82fdddb8e0',
  fhincd: 'MD004121632',
  processGroup: 'CUTTING',
  resourceCd: '021',
  sourceVersion: 5,
  expectedInitialEntryCount: 5,
  expectedSessionIds: [
    '5f303da4-485e-4c2d-ac10-d3bd364133df',
    'f095b974-4ce2-4b13-b115-ffe3c8029dc9'
  ],
  populatedSessionId: '5f303da4-485e-4c2d-ac10-d3bd364133df',
  emptySessionId: 'f095b974-4ce2-4b13-b115-ffe3c8029dc9',
  expectedTemplateItemCount: 13,
  expectedOperatorValueCount: 13,
  expectedInspectorValueCount: 13,
  expectedFinalReviewCount: 1,
  expectedFinalJudgementCount: 1
} as const satisfies SelfInspectionSamplingPolicyCorrectionTarget;

async function main(): Promise<number> {
  const execute = process.argv.includes('--execute');
  const confirmation =
    process.argv
      .find((argument) => argument.startsWith('--confirm='))
      ?.slice('--confirm='.length) ?? null;
  if (execute && confirmation !== CONFIRMATION) {
    throw new Error(
      `実更新には --confirm=${CONFIRMATION} を同時に指定してください`
    );
  }

  const service = new SelfInspectionSamplingPolicyCorrectionService();
  const result = await service.run(MD004121632_021_SINGLE_TARGET, { execute });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify(
        {
          correctionKey: MD004121632_021_SINGLE_TARGET.correctionKey,
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    })
  );
