import { describe, expect, it } from 'vitest';

import { decideCsvProgressSyncForProductionScheduleRow } from '../progress-csv-sync-decision.policy.js';

describe('decideCsvProgressSyncForProductionScheduleRow', () => {
  it('完了のときだけ true へ適用する', () => {
    expect(
      decideCsvProgressSyncForProductionScheduleRow({
        progressNormalized: '完了',
        existingIsCompleted: false,
      })
    ).toEqual({ kind: 'apply', isCompleted: true });
  });

  it('progress 空は手動完了済みならスキップする', () => {
    expect(
      decideCsvProgressSyncForProductionScheduleRow({
        progressNormalized: '',
        existingIsCompleted: true,
      })
    ).toEqual({ kind: 'skip' });
  });

  it('progress 空は未完了なら false へ適用する', () => {
    expect(
      decideCsvProgressSyncForProductionScheduleRow({
        progressNormalized: '',
        existingIsCompleted: false,
      })
    ).toEqual({ kind: 'apply', isCompleted: false });
    expect(
      decideCsvProgressSyncForProductionScheduleRow({
        progressNormalized: '',
        existingIsCompleted: undefined,
      })
    ).toEqual({ kind: 'apply', isCompleted: false });
  });

  it('その他の progress は同期しない', () => {
    expect(
      decideCsvProgressSyncForProductionScheduleRow({
        progressNormalized: '仕掛',
        existingIsCompleted: false,
      })
    ).toEqual({ kind: 'skip' });
  });
});
