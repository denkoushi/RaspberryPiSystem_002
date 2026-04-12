import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  ShelfRegisterChoiceGrid,
  ShelfRegisterHeader,
  ShelfRegisterSlotGrid
} from '../../features/mobile-placement/components/shelf-register';
import {
  SHELF_AREA_OPTIONS,
  SHELF_LINE_OPTIONS,
  SHELF_SLOT_MAX,
  formatShelfCodeRaw,
  getOccupiedSlotsForCell,
  isCompleteShelfSelection,
  isMobilePlacementShelfRegisterRouteState
} from '../../features/mobile-placement/shelfSelection';

import type { ShelfAreaId, ShelfLineId } from '../../features/mobile-placement/shelfSelection/shelfSelectionTypes';

const sectionShell =
  'mx-3.5 mt-3 rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] px-3.5 py-3';

/**
 * 棚番登録（エリア→列→2桁番号）。確定で配膳ページへ `shelfCode` を router state で返す。
 * UI は `components/shelf-register/*` に分割（表示と状態コールバックの分離）。
 */
export function KioskMobileShelfRegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = isMobilePlacementShelfRegisterRouteState(location.state)
    ? location.state
    : {
        transferOrder: '',
        transferPart: '',
        actualOrder: '',
        actualFseiban: '',
        actualPart: '',
        slipResult: 'idle' as const,
        shelfCode: '',
        orderBarcode: ''
      };
  const [areaId, setAreaId] = useState<ShelfAreaId | null>(null);
  const [lineId, setLineId] = useState<ShelfLineId | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

  const previewText = useMemo(() => {
    if (!isCompleteShelfSelection({ areaId: areaId ?? undefined, lineId: lineId ?? undefined, slot: slot ?? undefined })) {
      const parts: string[] = [];
      if (areaId) {
        const row = SHELF_AREA_OPTIONS.find((a) => a.id === areaId);
        if (row) parts.push(row.label);
      }
      if (lineId) {
        const row = SHELF_LINE_OPTIONS.find((l) => l.id === lineId);
        if (row) parts.push(row.label);
      }
      if (slot != null) parts.push(String(slot).padStart(2, '0'));
      return parts.length > 0 ? parts.join('-') : routeState.shelfCode || '—';
    }
    if (areaId == null || lineId == null || slot == null) return routeState.shelfCode || '—';
    return formatShelfCodeRaw({ areaId, lineId, slot });
  }, [areaId, lineId, routeState.shelfCode, slot]);

  const occupied = useMemo(() => {
    if (areaId == null || lineId == null) return new Set<number>();
    return new Set(getOccupiedSlotsForCell(areaId, lineId));
  }, [areaId, lineId]);

  const canConfirm =
    areaId != null &&
    lineId != null &&
    slot != null &&
    !occupied.has(slot) &&
    isCompleteShelfSelection({ areaId, lineId, slot });

  const onBack = () => {
    navigate('/kiosk/mobile-placement', { state: routeState });
  };

  const onConfirm = () => {
    if (!canConfirm || areaId == null || lineId == null || slot == null) return;
    const shelfCode = formatShelfCodeRaw({ areaId, lineId, slot });
    navigate('/kiosk/mobile-placement', { state: { ...routeState, shelfCode } });
  };

  const step2Enabled = areaId != null;
  const step3Enabled = areaId != null && lineId != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
      <ShelfRegisterHeader
        previewText={previewText}
        canConfirm={canConfirm}
        onBack={onBack}
        onConfirm={onConfirm}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-3 pt-1">
        <section className={sectionShell} aria-label="エリア">
          <ShelfRegisterChoiceGrid
            options={SHELF_AREA_OPTIONS}
            selectedId={areaId}
            onSelect={(id) => {
              setAreaId(id);
              setLineId(null);
              setSlot(null);
            }}
          />
        </section>

        <section className={sectionShell} aria-label="列">
          <ShelfRegisterChoiceGrid
            options={SHELF_LINE_OPTIONS}
            selectedId={lineId}
            disabled={!step2Enabled}
            onSelect={(id) => {
              setLineId(id);
              setSlot(null);
            }}
          />
        </section>

        <section className={`${sectionShell} flex min-h-0 flex-1 flex-col`} aria-label="空き番号">
          <ShelfRegisterSlotGrid
            slotMax={SHELF_SLOT_MAX}
            occupied={occupied}
            selectedSlot={slot}
            disabled={!step3Enabled}
            onSelect={setSlot}
          />
        </section>

        <p className="mx-3.5 mt-3 shrink-0 text-center text-[11px] leading-relaxed text-slate-400">
          棚番登録（本番は API から空き番号を取得）。ここではダミーで一部を使用済み表示しています。
        </p>
      </div>
    </div>
  );
}
