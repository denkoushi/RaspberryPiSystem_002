import type { ReactNode } from 'react';

export type KioskAnalyticsPanelsGridProps = {
  children: ReactNode;
};

/** 2×2 グリッド（< md 1 列 4 段、≥ md 2×2）。min-h-0 / min-w-0 で子パネルの overflow を許可。 */
export function KioskAnalyticsPanelsGrid({ children }: KioskAnalyticsPanelsGridProps) {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-4 gap-2 overflow-hidden md:grid-cols-2 md:grid-rows-2">
      {children}
    </div>
  );
}
