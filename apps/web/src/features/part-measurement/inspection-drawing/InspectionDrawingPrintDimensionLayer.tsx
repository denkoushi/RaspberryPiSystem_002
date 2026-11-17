import { useId, useMemo } from 'react';

import { computePrintDimensionLines } from './printMarkerLayout';

import type { InspectionDrawingPoint } from './types';

export function InspectionDrawingPrintDimensionLayer({ points, width, height, imageNaturalWidth, imageNaturalHeight }: {
  points: InspectionDrawingPoint[]; width: number; height: number; imageNaturalWidth: number; imageNaturalHeight: number;
}) {
  const markerId = `print-dimension-${useId().replace(/:/g, '')}`;
  const dimensions = useMemo(() => computePrintDimensionLines(points, width, height, imageNaturalWidth, imageNaturalHeight),
    [points, width, height, imageNaturalWidth, imageNaturalHeight]);
  if (dimensions.length === 0) return null;
  // Keep the screen's 27:3 arrow-to-line ratio at the print line width of 1.2px.
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse"
        markerWidth="10.8" markerHeight="10.8" orient="auto-start-reverse">
        <path d="M0 1 L10 5 L0 9 z" fill="#b45309" />
      </marker></defs>
      {dimensions.map((dimension) => <g key={`${dimension.pointId}-${dimension.dir}`}>
        {dimension.lines.map((line, index) => <line key={index} x1={`${line.x1Percent}%`} y1={`${line.y1Percent}%`}
          x2={`${line.x2Percent}%`} y2={`${line.y2Percent}%`} stroke="#b45309" strokeWidth={index === 2 ? 1.2 : 0.64}
          markerStart={index === 2 ? `url(#${markerId})` : undefined}
          markerEnd={index === 2 ? `url(#${markerId})` : undefined} />)}
      </g>)}
    </svg>
  );
}
