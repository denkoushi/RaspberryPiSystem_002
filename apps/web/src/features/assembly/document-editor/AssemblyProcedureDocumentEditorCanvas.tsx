import {
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayBBox,
  type AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import clsx from 'clsx';

import { OverlayRangeSelectionSurface } from '../../overlays/OverlayRangeSelectionSurface';
import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import type { AssemblyProcedureOverlayAssetDto } from '../types';

export function AssemblyProcedureDocumentEditorCanvas({
  pageUrl,
  pageIndex,
  crop,
  elements,
  selectionMode,
  editable,
  locked = false,
  selectedOverlayId,
  onSelectOverlay,
  onNudgeOverlay,
  onUpdateOverlayBBox,
  onInteractionStart,
  onInteractionEnd,
  onRangeSelected,
  assets,
  className
}: {
  pageUrl: string;
  pageIndex: number;
  crop?: AssemblyProcedureCropRect | null;
  elements: AssemblyProcedureOverlayElement[];
  selectionMode: boolean;
  editable: boolean;
  locked?: boolean;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string) => void;
  onNudgeOverlay: (id: string, dxRatio: number, dyRatio: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onUpdateOverlayBBox: (id: string, bbox: AssemblyProcedureOverlayBBox) => void;
  onRangeSelected: (bbox: AssemblyProcedureOverlayBBox) => void;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  className?: string;
}) {
  const overlay = (
    <div className="absolute inset-0">
      <AssemblyProcedureOverlayLayer
        elements={elements}
        crop={crop}
        selectedOverlayId={selectedOverlayId}
        interactive={!selectionMode && !locked}
        onSelect={onSelectOverlay}
        onNudge={onNudgeOverlay}
        onUpdateBBox={editable ? onUpdateOverlayBBox : undefined}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
        assets={assets}
      />
      <OverlayRangeSelectionSurface
        selectionMode={selectionMode}
        pageIndex={pageIndex}
        crop={crop}
        onRangeSelected={onRangeSelected}
      />
    </div>
  );

  if (crop) {
    return (
      <AssemblyProcedureCropView
        pageUrl={pageUrl}
        crop={crop}
        className={clsx('h-full w-full', className)}
        overlay={overlay}
      />
    );
  }

  return (
    <AssemblyProcedureCanvas
      imageRelativePath={pageUrl}
      bolts={[]}
      checkItems={[]}
      placementAction="place"
      overlay={overlay}
      className={clsx('h-full w-full', className)}
    />
  );
}
