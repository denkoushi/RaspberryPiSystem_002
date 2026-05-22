import { resolveJstSignageBusinessDate } from '../../../lib/signage-business-day.js';
import { compactEmployeeDisplayName } from '../../employee/compact-employee-display-name.js';

export function buildRiggingInspectionDedupKey(params: {
  managementNumber: string;
  inspectedAt: Date;
  inspectorName: string;
}): string {
  const managementNumber = params.managementNumber.trim();
  const inspectorName = compactEmployeeDisplayName(params.inspectorName);
  const businessDate = resolveJstSignageBusinessDate(params.inspectedAt);
  return `${managementNumber}|${businessDate}|${inspectorName}`;
}
