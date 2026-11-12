import { useState } from 'react';

import type { ScheduleSeibanView } from '../../../api/domains/schedule-seibans';

const KEY = 'haizen-schedule-view';
const DEFAULT_VIEW: ScheduleSeibanView = { source: 'both', range: 'all' };

function loadView(): ScheduleSeibanView {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && ['general', 'dCompany', 'both'].includes(saved.source)
      && ['all', 'aroundMonth', 'excludeOlderThanHalfYear'].includes(saved.range)) {
      return { source: saved.source, range: saved.range };
    }
  } catch {
    // Storage can be unavailable or contain invalid JSON.
  }
  return DEFAULT_VIEW;
}

export function useHaizenScheduleView() {
  const [view, setView] = useState(loadView);
  const changeView = (next: ScheduleSeibanView) => {
    setView(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, ...next }));
    } catch {
      // Keep the selection for this session when storage is unavailable.
    }
  };
  return { view, changeView };
}
