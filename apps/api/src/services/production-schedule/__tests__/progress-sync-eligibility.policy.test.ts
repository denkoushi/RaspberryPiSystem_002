import { describe, expect, it } from 'vitest';
import { ProgressSyncEligibilityPolicy } from '../progress-sync-eligibility.policy.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

describe('ProgressSyncEligibilityPolicy', () => {
  const policy = new ProgressSyncEligibilityPolicy();

  it('生産日程ダッシュボードかつprogress列ありなら同期対象', () => {
    const result = policy.evaluate({
      dashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      mappedInternalNames: ['ProductNo', 'FSEIBAN', 'progress'],
    });

    expect(result).toEqual({ eligible: true, reason: 'eligible' });
  });

  it('生産日程ダッシュボードでもprogress列が無ければ同期対象外', () => {
    const result = policy.evaluate({
      dashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      mappedInternalNames: ['ProductNo', 'FSEIBAN'],
    });

    expect(result).toEqual({ eligible: false, reason: 'missing_progress_column' });
  });

  it('別ダッシュボードは同期対象外', () => {
    const result = policy.evaluate({
      dashboardId: 'other-dashboard',
      mappedInternalNames: ['progress'],
    });

    expect(result).toEqual({ eligible: false, reason: 'not_production_schedule_dashboard' });
  });
});
