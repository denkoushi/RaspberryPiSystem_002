import { resolveJstSignageBusinessDate } from '../../../lib/signage-business-day.js';
import { normalizeEmployeeName } from '../../measuring-instruments/analytics/measuring-instrument-loan-analytics.repository.js';

export function buildRiggingInspectionDedupKey(params: {
  managementNumber: string;
  inspectedAt: Date;
  inspectorName: string;
}): string {
  const managementNumber = params.managementNumber.trim();
  const inspectorName = normalizeEmployeeName(params.inspectorName);
  const businessDate = resolveJstSignageBusinessDate(params.inspectedAt);
  return `${managementNumber}|${businessDate}|${inspectorName}`;
}
