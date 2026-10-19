import type { ReactNode } from 'react';

export function KioskAnalyticsPanelsGrid({ children }: { children: ReactNode }) {
  return <div className="kanalytics__cols">{children}</div>;
}
