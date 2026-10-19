import { useEffect, useState } from 'react';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export function usePlanningBoardNotices() {
  const [completionNotice, setCompletionNotice] = useState<{ item: GrindingPlanningBoardItem } | null>(null);
  useEffect(() => {
    if (!completionNotice) return;
    const timer = window.setTimeout(() => setCompletionNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [completionNotice]);
  const [scanNotice, setScanNotice] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!scanNotice) return;
    const timer = window.setTimeout(() => setScanNotice(null), 2000);
    return () => window.clearTimeout(timer);
  }, [scanNotice]);
  return { completionNotice, setCompletionNotice, scanNotice, setScanNotice };
}
