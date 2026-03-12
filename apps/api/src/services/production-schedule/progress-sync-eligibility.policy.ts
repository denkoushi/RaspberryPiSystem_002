import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export type ProgressSyncEligibilityInput = {
  dashboardId: string;
  mappedInternalNames: string[];
};

export type ProgressSyncEligibilityResult = {
  eligible: boolean;
  reason: 'eligible' | 'not_production_schedule_dashboard' | 'missing_progress_column';
};

export class ProgressSyncEligibilityPolicy {
  evaluate(input: ProgressSyncEligibilityInput): ProgressSyncEligibilityResult {
    if (input.dashboardId !== PRODUCTION_SCHEDULE_DASHBOARD_ID) {
      return { eligible: false, reason: 'not_production_schedule_dashboard' };
    }

    if (!input.mappedInternalNames.includes('progress')) {
      return { eligible: false, reason: 'missing_progress_column' };
    }

    return { eligible: true, reason: 'eligible' };
  }
}
