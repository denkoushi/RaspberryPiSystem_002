import type { AssemblyLotSerialDto, AssemblyLotSummaryDto, AssemblyWorkSessionApprovalDto } from './types';

export function serialStatusLabel(serial: AssemblyLotSerialDto): string {
  if (serial.status === 'not_started') return '未着手';
  if (serial.status === 'in_progress') return '仕掛';
  if (serial.status === 'completed') return serial.approval ? '承認済み' : '完了';
  return '取消';
}

export function serialStatusClassName(serial: AssemblyLotSerialDto): string {
  if (serial.status === 'not_started') return 'border-white/15 bg-slate-950/55 text-white';
  if (serial.status === 'in_progress') return 'border-emerald-300/35 bg-emerald-500/15 text-emerald-50';
  if (serial.status === 'completed' && serial.approval) return 'border-cyan-300/35 bg-cyan-500/15 text-cyan-50';
  if (serial.status === 'completed') return 'border-amber-300/35 bg-amber-500/15 text-amber-50';
  return 'border-rose-300/30 bg-rose-500/15 text-rose-50';
}

export function lotProgressText(lot: AssemblyLotSummaryDto): string {
  return `作業 ${lot.completedCount}/${lot.expectedQuantity} ・ 承認 ${lot.approvedCount}/${lot.expectedQuantity}`;
}

export function completedApprovalLabel(approval: AssemblyWorkSessionApprovalDto | null): string {
  return approval != null ? '承認済み' : '未承認';
}

export function completedApprovalClassName(approval: AssemblyWorkSessionApprovalDto | null): string {
  return approval != null
    ? 'border-emerald-300/30 bg-emerald-500/15 text-emerald-100'
    : 'border-amber-300/30 bg-amber-500/15 text-amber-100';
}
