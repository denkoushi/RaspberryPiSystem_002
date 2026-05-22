import { formatLoanInspectionInstrumentLabel } from './format-instrument-label.js';
import type { LoanInspectionInstrumentEntry } from './display.types.js';

export type LoanInspectionInstrumentDetail = {
  name: string;
  managementNumber: string;
};

export function buildLoanInspectionInstrumentDetails(params: {
  activeFromLoan: readonly LoanInspectionInstrumentDetail[];
  returnedFromLoan: readonly LoanInspectionInstrumentDetail[];
  inspectedOnly: readonly LoanInspectionInstrumentDetail[];
}): { instrumentDetailsJson: string; nameTokens: string[] } {
  const entries: LoanInspectionInstrumentEntry[] = [
    ...params.activeFromLoan.map((d) => ({
      kind: 'active' as const,
      managementNumber: d.managementNumber,
      name: d.name,
    })),
    ...params.returnedFromLoan.map((d) => ({
      kind: 'returned' as const,
      managementNumber: d.managementNumber,
      name: d.name,
    })),
    ...params.inspectedOnly.map((d) => ({
      kind: 'active' as const,
      managementNumber: d.managementNumber,
      name: d.name,
    })),
  ];

  if (entries.length === 0) {
    return { instrumentDetailsJson: '', nameTokens: [] };
  }

  const nameTokens = entries.map((d) => formatLoanInspectionInstrumentLabel(d.name, d.managementNumber));
  return {
    instrumentDetailsJson: JSON.stringify(entries),
    nameTokens,
  };
}

/**
 * Loan 明細に含まれる管理番号を除き、点検記録由来の吊具のみを返す。
 */
export function filterInspectedOnlyDetails(params: {
  inspectionDetails: readonly LoanInspectionInstrumentDetail[];
  loanManagementNumbers: ReadonlySet<string>;
}): LoanInspectionInstrumentDetail[] {
  const seen = new Set<string>();
  const out: LoanInspectionInstrumentDetail[] = [];
  for (const detail of params.inspectionDetails) {
    const mgmt = detail.managementNumber.trim();
    if (!mgmt || params.loanManagementNumbers.has(mgmt) || seen.has(mgmt)) {
      continue;
    }
    seen.add(mgmt);
    out.push(detail);
  }
  return out;
}
