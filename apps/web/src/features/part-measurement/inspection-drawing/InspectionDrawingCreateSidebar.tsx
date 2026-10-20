import {
  isInspectionDrawingDepthLabel,
  resolveInspectionDrawingGeneralToleranceForNominal
} from '@raspi-system/shared-types';

import { InspectionDrawingPointSidebar } from './InspectionDrawingPointSidebar';
import { InspectionDrawingProposalPanel } from './InspectionDrawingProposalPanel';
import { buildGeometricTolerancePointPatch, pointUsesGeometricTolerance } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';
import type { InspectionDrawingPlacementProposals } from './useInspectionDrawingPlacementProposals';
import type { ComponentProps } from 'react';

type Props = Omit<ComponentProps<typeof InspectionDrawingPointSidebar>, 'onApplyOcrCandidate'> & {
  placement: InspectionDrawingPlacementProposals;
  busy: boolean;
  onApplyOcrPointPatch: (pointId: string, patch: Partial<InspectionDrawingPoint>) => void;
};

export function InspectionDrawingCreateSidebar({ placement, busy, onApplyOcrPointPatch, ...props }: Props) {
  const { selectedPoint, measurementLabelSettings } = props;
  const sidebar = (
    <InspectionDrawingPointSidebar
      {...props}
      onApplyOcrCandidate={(valueText, candidate) => {
        if (!selectedPoint) return;
        if (pointUsesGeometricTolerance(selectedPoint, { measurementLabelSettings })) {
          onApplyOcrPointPatch(selectedPoint.id, buildGeometricTolerancePointPatch(valueText));
          return;
        }
        const patch: Partial<InspectionDrawingPoint> = { nominalRaw: valueText };
        // 公差欄が両方空のときだけ案を入れる。明記公差 → 普通公差（深さは下限 0）。
        const toleranceEmpty =
          selectedPoint.upperToleranceRaw.trim() === '' && selectedPoint.lowerToleranceRaw.trim() === '';
        if (toleranceEmpty) {
          const upper = candidate?.suggestedUpperTolerance ?? null;
          const lower = candidate?.suggestedLowerTolerance ?? null;
          if (candidate?.source === 'dimensionMap' && (upper !== null || lower !== null)) {
            if (upper !== null) patch.upperToleranceRaw = upper;
            if (lower !== null) patch.lowerToleranceRaw = lower;
          } else if (isInspectionDrawingDepthLabel(selectedPoint.name)) {
            patch.lowerToleranceRaw = '0';
          } else {
            const general = resolveInspectionDrawingGeneralToleranceForNominal(Number(valueText));
            if (general !== null) {
              patch.upperToleranceRaw = `+${general}`;
              patch.lowerToleranceRaw = `-${general}`;
            }
          }
        }
        onApplyOcrPointPatch(selectedPoint.id, patch);
      }}
    />
  );
  if (props.contentReadOnly || props.mode === 'guidedTrial') return sidebar;
  return (
    <InspectionDrawingProposalPanel placement={placement} confirmedCount={props.points.length} disabled={busy}>
      {sidebar}
    </InspectionDrawingProposalPanel>
  );
}
