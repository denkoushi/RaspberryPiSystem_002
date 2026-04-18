import { useState } from 'react';

import { MobilePlacementRegisterOrderPanel } from './MobilePlacementRegisterOrderPanel';
import { MobilePlacementRegisterShelfPanel } from './MobilePlacementRegisterShelfPanel';

import type { OrderPlacementBranchDto } from '../../../api/client';
import type { RegisteredShelfEntryDto } from '../registeredShelves';
import type { OrderPlacementPageIntent } from '../shelfSelection';
import type { ShelfAreaId, ShelfLineId } from '../shelfSelection/shelfSelectionTypes';

export type MobilePlacementRegisterSectionProps = {
  shelfCode: string;
  onSelectShelf: (code: string) => void;
  onOpenShelfRegister: () => void;
  onShelfQrScan: () => void;
  registeredShelves: RegisteredShelfEntryDto[];
  registeredShelvesLoading: boolean;
  registeredShelvesError: boolean;
  onRetryRegisteredShelves: () => void;
  orderBarcode: string;
  onOrderBarcodeChange: (v: string) => void;
  onOrderScan: () => void;
  orderPlacementIntent: OrderPlacementPageIntent;
  onOrderPlacementIntentChange: (v: OrderPlacementPageIntent) => void;
  branches: OrderPlacementBranchDto[];
  branchesLoading: boolean;
  branchesError: boolean;
  onRetryBranches: () => void;
  selectedBranchId: string | null;
  onSelectBranchId: (id: string) => void;
  suggestedNextBranchNo: number | null;
  registerSubmitting: boolean;
  registerDisabled: boolean;
  onRegister: () => void;
  registerMessage: string | null;
  registerError: string | null;
};

/**
 * 下半: 登録済み棚番（絞り込み）+ QR + 新規登録 + 製造order・登録
 */
export function MobilePlacementRegisterSection(props: MobilePlacementRegisterSectionProps) {
  const [areaId, setAreaId] = useState<ShelfAreaId | null>(null);
  const [lineId, setLineId] = useState<ShelfLineId | null>(null);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
      <MobilePlacementRegisterShelfPanel
        shelfCode={props.shelfCode}
        onSelectShelf={props.onSelectShelf}
        onOpenShelfRegister={props.onOpenShelfRegister}
        onShelfQrScan={props.onShelfQrScan}
        registeredShelves={props.registeredShelves}
        registeredShelvesLoading={props.registeredShelvesLoading}
        registeredShelvesError={props.registeredShelvesError}
        onRetryRegisteredShelves={props.onRetryRegisteredShelves}
        areaId={areaId}
        lineId={lineId}
        onAreaChange={setAreaId}
        onLineChange={setLineId}
      />

      <MobilePlacementRegisterOrderPanel
        orderBarcode={props.orderBarcode}
        onOrderBarcodeChange={props.onOrderBarcodeChange}
        onOrderScan={props.onOrderScan}
        orderPlacementIntent={props.orderPlacementIntent}
        onOrderPlacementIntentChange={props.onOrderPlacementIntentChange}
        branches={props.branches}
        branchesLoading={props.branchesLoading}
        branchesError={props.branchesError}
        onRetryBranches={props.onRetryBranches}
        selectedBranchId={props.selectedBranchId}
        onSelectBranchId={props.onSelectBranchId}
        suggestedNextBranchNo={props.suggestedNextBranchNo}
        registerSubmitting={props.registerSubmitting}
        registerDisabled={props.registerDisabled}
        onRegister={props.onRegister}
      />

      {props.registerMessage ? (
        <p className="text-sm text-emerald-200" role="status">
          {props.registerMessage}
        </p>
      ) : null}
      {props.registerError ? (
        <p className="text-sm text-red-200" role="alert">
          {props.registerError}
        </p>
      ) : null}
    </div>
  );
}
