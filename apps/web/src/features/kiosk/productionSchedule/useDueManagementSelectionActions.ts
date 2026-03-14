import { useCallback, useMemo } from 'react';

type UseDueManagementSelectionActionsParams = {
  selectedFseibans: string[];
  onSaveSelection: (nextSelectedFseibans: string[]) => Promise<unknown>;
  isPending: boolean;
};

export function useDueManagementSelectionActions({
  selectedFseibans,
  onSaveSelection,
  isPending
}: UseDueManagementSelectionActionsParams) {
  const selectedSet = useMemo(() => new Set(selectedFseibans), [selectedFseibans]);

  const isSelected = useCallback(
    (fseiban: string) => selectedSet.has(fseiban),
    [selectedSet]
  );

  const toggleSelection = useCallback(
    async (fseiban: string) => {
      const next = new Set(selectedSet);
      if (next.has(fseiban)) {
        next.delete(fseiban);
      } else {
        next.add(fseiban);
      }
      await onSaveSelection(Array.from(next));
    },
    [onSaveSelection, selectedSet]
  );

  return {
    selectedSet,
    isSelected,
    toggleSelection,
    selectedCount: selectedSet.size,
    isPending
  };
}
