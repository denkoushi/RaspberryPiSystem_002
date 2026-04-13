import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { postMobilePlacementShelfRegister } from '../../api/client';
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
  getOccupiedSlotsForRegisteredShelves,
  isCompleteShelfSelection,
  isMobilePlacementShelfRegisterRouteState
} from '../../features/mobile-placement/shelfSelection';
import { useRegisteredShelves } from '../../features/mobile-placement/useRegisteredShelves';

import type { ShelfAreaId, ShelfLineId } from '../../features/mobile-placement/shelfSelection/shelfSelectionTypes';

const sectionShell =
  'mx-3.5 mt-3 rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] px-3.5 py-3';

function extractApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    if (data && typeof data.message === 'string' && data.message.length > 0) {
      return data.message;
    }
    if (err.message) return err.message;
  }
  return '棚番の登録に失敗しました';
}

/**
 * 棚番登録（エリア→列→2桁番号）。確定で棚マスタへ登録し、配膳ページへ `shelfCode` を router state で返す。
 */
export function KioskMobileShelfRegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const registeredShelvesQuery = useRegisteredShelves();

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    const list = registeredShelvesQuery.data?.shelves ?? [];
    return getOccupiedSlotsForRegisteredShelves(list, areaId, lineId);
  }, [areaId, lineId, registeredShelvesQuery.data?.shelves]);

  const canConfirm =
    areaId != null &&
    lineId != null &&
    slot != null &&
    !occupied.has(slot) &&
    isCompleteShelfSelection({ areaId, lineId, slot }) &&
    !registeredShelvesQuery.isLoading;

  const onBack = () => {
    navigate('/kiosk/mobile-placement', { state: routeState });
  };

  const onConfirm = async () => {
    if (!canConfirm || areaId == null || lineId == null || slot == null) return;
    const shelfCode = formatShelfCodeRaw({ areaId, lineId, slot });
    setSubmitting(true);
    setSubmitError(null);
    try {
      await postMobilePlacementShelfRegister({ shelfCodeRaw: shelfCode });
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'registered-shelves'] });
      navigate('/kiosk/mobile-placement', { state: { ...routeState, shelfCode } });
    } catch (e) {
      setSubmitError(extractApiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const step2Enabled = areaId != null;
  const step3Enabled = areaId != null && lineId != null && !registeredShelvesQuery.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
      <ShelfRegisterHeader
        previewText={previewText}
        canConfirm={canConfirm}
        submitting={submitting}
        onBack={onBack}
        onConfirm={onConfirm}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-3 pt-1">
        {registeredShelvesQuery.isError ? (
          <p className="mx-3.5 mt-2 text-center text-sm text-red-200">登録済み棚の取得に失敗しました。戻って再試行してください。</p>
        ) : null}
        {submitError ? (
          <p className="mx-3.5 mt-2 text-center text-sm text-red-200" role="alert">
            {submitError}
          </p>
        ) : null}

        <section className={sectionShell} aria-label="エリア">
          <ShelfRegisterChoiceGrid
            options={SHELF_AREA_OPTIONS}
            selectedId={areaId}
            disabled={submitting}
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
            disabled={!step2Enabled || submitting}
            onSelect={(id) => {
              setLineId(id);
              setSlot(null);
            }}
          />
        </section>

        <section className={`${sectionShell} flex min-h-0 flex-1 flex-col`} aria-label="空き番号">
          {registeredShelvesQuery.isLoading ? (
            <p className="text-center text-sm text-slate-400">登録済み棚を読み込み中…</p>
          ) : (
            <ShelfRegisterSlotGrid
              slotMax={SHELF_SLOT_MAX}
              occupied={occupied}
              selectedSlot={slot}
              disabled={!step3Enabled || submitting}
              onSelect={setSlot}
            />
          )}
        </section>

        <p className="mx-3.5 mt-3 shrink-0 text-center text-[11px] leading-relaxed text-slate-400">
          既にマスタ登録された番号は選択できません。空き番号を選んで「棚番を登録」で確定します。
        </p>
      </div>
    </div>
  );
}
