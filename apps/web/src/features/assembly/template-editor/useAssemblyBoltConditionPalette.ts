import { useMemo, useState } from 'react';

import {
  assemblyBoltConditionKey,
  assemblyBoltConditionPatch,
  buildAssemblyBoltConditionPalette
} from '../assemblyBoltConditionPalette';

import type { AssemblyBoltCondition } from '../assemblyBoltConditionPalette';
import type { AssemblyDraftArea } from '../assemblyTemplateDraft';
import type { Dispatch, SetStateAction } from 'react';

type Input = {
  areas: AssemblyDraftArea[];
  /** 編集できる選択中の丸数字。条件を押すとこの丸数字へ付け替える。 */
  editableBoltId: string | null;
  setAreas: Dispatch<SetStateAction<AssemblyDraftArea[]>>;
  onStartPlacement: () => void;
};

/** 締付条件の一覧と「次に置く条件」を持つ。条件は一度決めれば、以後のタップで使い回す。 */
export function useAssemblyBoltConditionPalette({ areas, editableBoltId, setAreas, onStartPlacement }: Input) {
  const [pendingConditions, setPendingConditions] = useState<AssemblyBoltCondition[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const boltConditionPalette = useMemo(
    () => buildAssemblyBoltConditionPalette(areas, pendingConditions),
    [areas, pendingConditions]
  );
  const activeBoltCondition =
    boltConditionPalette.find((entry) => entry.key === activeKey)?.condition ?? null;

  const remember = (condition: AssemblyBoltCondition) => {
    const key = assemblyBoltConditionKey(condition);
    setPendingConditions((current) =>
      current.some((candidate) => assemblyBoltConditionKey(candidate) === key)
        ? current
        : [...current, condition]
    );
    setActiveKey(key);
    onStartPlacement();
  };

  return {
    activeBoltCondition,
    activeBoltConditionKey: activeBoltCondition ? activeKey : null,
    addBoltCondition: remember,
    boltConditionPalette,
    selectBoltCondition: (key: string) => {
      const entry = boltConditionPalette.find((candidate) => candidate.key === key);
      if (!entry) return;
      if (editableBoltId) {
        const patch = assemblyBoltConditionPatch(entry.condition);
        setAreas((current) =>
          current.map((area) => ({
            ...area,
            bolts: area.bolts.map((bolt) => (bolt.id === editableBoltId ? { ...bolt, ...patch } : bolt))
          }))
        );
      }
      // 付け替えで元の条件が未使用になっても一覧に残す。
      remember(entry.condition);
    }
  };
}
