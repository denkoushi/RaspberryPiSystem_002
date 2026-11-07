import { normalizeMachineName } from '../productionSchedule/machineName';

import type { OutsourceNamedTarget, ProductionScheduleLoadBalancingWorkspaceRow as Row } from '../../../api/client';

export function partKey(row: Row): string {
  return JSON.stringify([row.fseiban.trim(), row.fhincd.trim(), ...(row.fseiban.trim() === '********' ? [row.productNo.trim()] : [])]);
}

export function namedTargetKey(kind: OutsourceNamedTarget['kind'], row: Row): string {
  return kind === 'machine' ? normalizeMachineName(row.machineName, { maxChars: Number.MAX_SAFE_INTEGER }) : kind === 'seiban' ? row.fseiban.trim() : partKey(row);
}

export function namedTargetMatches(target: OutsourceNamedTarget, row: Row): boolean {
  return target.key === namedTargetKey(target.kind, row);
}

/** A more specific target always wins, regardless of vendor priority. */
export function resolveNamedTarget(targets: OutsourceNamedTarget[], row: Row): OutsourceNamedTarget | undefined {
  for (const kind of ['part', 'seiban', 'machine'] as const) {
    const match = targets.find((target) => target.kind === kind && namedTargetMatches(target, row));
    if (match) return match;
  }
  return undefined;
}
