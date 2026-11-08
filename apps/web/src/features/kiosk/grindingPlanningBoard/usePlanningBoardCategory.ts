import { useCallback, useState } from 'react';

import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';

export const CATEGORY_STORAGE_KEY = 'kiosk-planning-board-category';

function loadCategory(): GrindingPlanningBoardCategory {
  try {
    const saved = JSON.parse(window.localStorage.getItem(CATEGORY_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && ['grinding', 'cutting', 'all'].includes(saved.category)) return saved.category;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 'grinding';
}

export function usePlanningBoardCategory() {
  const [category, setCategory] = useState(loadCategory);
  const changeCategory = useCallback((category: GrindingPlanningBoardCategory) => {
    setCategory(category);
    try {
      window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, category }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  return { category, changeCategory };
}
