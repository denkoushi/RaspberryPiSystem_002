import { describe, expect, it } from 'vitest';

import {
  completedApprovalClassName,
  completedApprovalLabel,
  lotProgressText,
  serialStatusClassName,
  serialStatusLabel
} from './assemblyStatusPresentation';

import type { AssemblyLotSerialDto, AssemblyLotSummaryDto, AssemblyWorkSessionApprovalDto } from './types';

const approval: AssemblyWorkSessionApprovalDto = {
  approvedAt: '2026-07-06T02:00:00.000Z',
  approverEmployeeId: 'emp-1',
  approverEmployeeCodeSnapshot: 'E001',
  approverEmployeeNameSnapshot: '承認者',
  approverNfcTagUidSnapshot: 'TAG-001',
  comment: null,
  clientDeviceId: null,
  clientDeviceNameSnapshot: null
};

function serial(partial: Partial<AssemblyLotSerialDto>): AssemblyLotSerialDto {
  return {
    id: 'serial-1',
    lotId: 'lot-1',
    sortOrder: 1,
    serialNo: 'S-001',
    status: 'not_started',
    workSessionId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: '2026-07-06T00:00:00.000Z',
    approval: null,
    ...partial
  };
}

describe('assemblyStatusPresentation', () => {
  it('maps serial status labels and class names', () => {
    expect(serialStatusLabel(serial({ status: 'not_started' }))).toBe('未着手');
    expect(serialStatusLabel(serial({ status: 'in_progress' }))).toBe('仕掛');
    expect(serialStatusLabel(serial({ status: 'completed' }))).toBe('完了');
    expect(serialStatusLabel(serial({ status: 'completed', approval }))).toBe('承認済み');
    expect(serialStatusLabel(serial({ status: 'cancelled' }))).toBe('取消');

    expect(serialStatusClassName(serial({ status: 'not_started' }))).toContain('bg-slate-950/55');
    expect(serialStatusClassName(serial({ status: 'in_progress' }))).toContain('bg-emerald-500/15');
    expect(serialStatusClassName(serial({ status: 'completed' }))).toContain('bg-amber-500/15');
    expect(serialStatusClassName(serial({ status: 'completed', approval }))).toContain('bg-cyan-500/15');
    expect(serialStatusClassName(serial({ status: 'cancelled' }))).toContain('bg-rose-500/15');
  });

  it('formats lot progress and completed approval badges', () => {
    const lot = {
      completedCount: 1,
      expectedQuantity: 3,
      approvedCount: 0
    } as AssemblyLotSummaryDto;

    expect(lotProgressText(lot)).toBe('作業 1/3 ・ 承認 0/3');
    expect(completedApprovalLabel(null)).toBe('未承認');
    expect(completedApprovalLabel(approval)).toBe('承認済み');
    expect(completedApprovalClassName(null)).toContain('bg-amber-500/15');
    expect(completedApprovalClassName(approval)).toContain('bg-emerald-500/15');
  });
});
