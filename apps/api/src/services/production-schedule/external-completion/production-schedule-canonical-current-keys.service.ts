import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import { extractProductionScheduleExternalCompletionKeysFromRows } from './production-schedule-external-completion-key.js';

export type ScheduleDedupRowInput = Readonly<{ data: NormalizedRowData }>;

/**
 * 順位ボードの「CSV消滅」入力となる **正本Cの現在キー集合** を構築する。
 *
 * - **本体**: 今回取り込んだ生産日程CSVの dedupe winner 由来キー（schedule batch）。
 * - **FKOJUNST_Status**: 正本Cの周辺ルールには関与するが、**不在だけでは current keys から除外しない**。
 *   `C` も 801 化により照合錨として使わないため、現時点の current keys は **本体CSV基準**で保持する。
 */
export class ProductionScheduleCanonicalCurrentKeysService {
  async resolveScheduleCsvDisappearanceCanonicalCurrentKeys(params: {
    scheduleDedupRows: readonly ScheduleDedupRowInput[];
  }): Promise<string[]> {
    return extractProductionScheduleExternalCompletionKeysFromRows(params.scheduleDedupRows);
  }
}
