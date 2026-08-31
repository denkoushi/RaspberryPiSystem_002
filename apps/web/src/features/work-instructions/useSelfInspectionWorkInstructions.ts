import { useCallback, useMemo, useState } from 'react';

import { useWorkInstructionGroup, useWorkInstructionGroups } from '../../api/hooks';
import {
  dedupeAndSortWorkInstructionTargets,
  normalizeWorkInstructionPartNumber
} from '../../lib/workInstructionRules';

export type WorkInstructionPartScanResult =
  | { ok: true; partNumber: string }
  | { ok: false };

/**
 * 自主検査画面固有の要領書検索・選択状態を所有する。
 * HIDイベントやtoolbar表示はページに残し、API queryとviewer状態をここへ閉じ込める。
 */
export function useSelfInspectionWorkInstructions() {
  const [partNumber, setPartNumber] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const groupsQuery = useWorkInstructionGroups(partNumber);
  const groupQuery = useWorkInstructionGroup(partNumber, selectedTarget ?? '');
  const targets = useMemo(
    () =>
      dedupeAndSortWorkInstructionTargets(
        (groupsQuery.data ?? []).map((group) => group.shootingTarget)
      ),
    [groupsQuery.data]
  );

  const beginPartScan = useCallback(() => {
    setPartNumber('');
    setSelectedTarget(null);
  }, []);

  const acceptPartScan = useCallback((rawText: string): WorkInstructionPartScanResult => {
    const normalized = normalizeWorkInstructionPartNumber(rawText);
    setSelectedTarget(null);
    if (!normalized) {
      setPartNumber('');
      return { ok: false };
    }
    setPartNumber(normalized);
    return { ok: true, partNumber: normalized };
  }, []);

  const clear = useCallback(() => {
    setPartNumber('');
    setSelectedTarget(null);
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedTarget(null);
  }, []);

  return {
    partNumber,
    selectedTarget,
    targets,
    groupsQuery,
    groupQuery,
    beginPartScan,
    acceptPartScan,
    openTarget: setSelectedTarget,
    closeViewer,
    clear
  };
}
