import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate, useParams } from 'react-router-dom';

import {
  finalizeInspectionDrawingEvaluationSheet,
  finalizePartMeasurementSheet,
  getPartMeasurementSheet,
  getResolvedClientKey,
  patchInspectionDrawingEvaluationSheet,
  patchPartMeasurementSheet
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import {
  getInspectionDrawingEditAccess,
  InspectionDrawingCanvas,
  InspectionDrawingCreateHeaderBand,
  inspectionDrawingCanvasColumnClassName,
  InspectionDrawingValuePanel,
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingSideAsideClassName,
  templateItemToDrawingPoint,
  templateSupportsInspectionDrawing
} from '../../features/part-measurement/inspection-drawing';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { PartMeasurementSheetDto } from '../../features/part-measurement/types';

const AUTOSAVE_MS = 600;
const PIECE_INDEX = 0;

export function KioskInspectionDrawingEditPage() {
  const { sheetId } = useParams<{ sheetId: string }>();
  const navigate = useNavigate();
  const clientKey = getResolvedClientKey();
  const isActiveRoute = useMatch('/kiosk/part-measurement/inspection/edit/:sheetId');
  const [sheet, setSheet] = useState<PartMeasurementSheetDto | null>(null);
  const editAccess = useMemo(() => getInspectionDrawingEditAccess(sheet), [sheet]);
  const isEvaluation = editAccess.mode === 'evaluation';
  const isProduction = editAccess.mode === 'production';
  const nfcEnabled = Boolean(isActiveRoute && sheet?.status === 'DRAFT' && editAccess.allowed);
  const nfcEvent = useNfcStream(nfcEnabled);
  const lastNfcKeyRef = useRef<string | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [points, setPoints] = useState<InspectionDrawingPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const drawingPath = sheet?.template?.visualTemplate?.drawingImageRelativePath;
  const { blobUrl: drawingBlobUrl, error: drawingLoadError } = usePartMeasurementDrawingBlobUrl(drawingPath);

  const supportsDrawing = useMemo(
    () => templateSupportsInspectionDrawing(sheet?.template?.items, drawingPath),
    [sheet?.template?.items, drawingPath]
  );

  const syncPointsFromSheet = useCallback((s: PartMeasurementSheetDto) => {
    const items = [...(s.template?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const next = items.map((it) => {
      const result = s.results.find(
        (r) => r.pieceIndex === PIECE_INDEX && r.templateItemId === it.id
      );
      const testValue = result?.value != null ? String(result.value) : '';
      return templateItemToDrawingPoint(it, testValue);
    });
    setPoints(next);
    setSelectedPointId((cur) => cur ?? next[0]?.id ?? null);
  }, []);

  const load = useCallback(async () => {
    if (!sheetId) return;
    setBusy(true);
    try {
      const { sheet: s } = await getPartMeasurementSheet(sheetId, clientKey);
      setSheet(s);
      syncPointsFromSheet(s);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '読み込みに失敗しました。');
    } finally {
      setBusy(false);
    }
  }, [sheetId, clientKey, syncPointsFromSheet]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, []);

  const statusReadOnly =
    sheet?.status === 'FINALIZED' || sheet?.status === 'CANCELLED' || sheet?.status === 'INVALIDATED';
  const readOnly = statusReadOnly || !editAccess.allowed;

  const patchSheet = useCallback(
    async (
      id: string,
      body: {
        quantity?: number;
        employeeTagUid?: string;
        results?: Array<{
          pieceIndex: number;
          templateItemId: string;
          value: string | null;
        }>;
      }
    ) => {
      if (isEvaluation) {
        return patchInspectionDrawingEvaluationSheet(id, body, clientKey);
      }
      return patchPartMeasurementSheet(id, body, clientKey);
    },
    [clientKey, isEvaluation]
  );

  const finalizeSheet = useCallback(
    async (id: string) => {
      if (isEvaluation) {
        return finalizeInspectionDrawingEvaluationSheet(id, clientKey);
      }
      return finalizePartMeasurementSheet(id, clientKey);
    },
    [clientKey, isEvaluation]
  );

  useEffect(() => {
    if (!nfcEvent || !sheet || readOnly || sheet.status !== 'DRAFT' || !editAccess.allowed) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNfcKeyRef.current === key) return;
    lastNfcKeyRef.current = key;
    void (async () => {
      try {
        const { sheet: updated } = await patchSheet(sheet.id, { employeeTagUid: nfcEvent.uid });
        setSheet(updated);
        setMessage(null);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? '社員タグの反映に失敗しました。');
      }
    })();
  }, [nfcEvent, sheet, readOnly, editAccess.allowed, patchSheet]);

  const selectedPoint = points.find((p) => p.id === selectedPointId) ?? null;

  const flushSave = useCallback(
    async (nextPoints: InspectionDrawingPoint[]) => {
      if (!sheet || readOnly || !editAccess.allowed || sheet.status !== 'DRAFT') return;
      const results = nextPoints.map((pt) => ({
        pieceIndex: PIECE_INDEX,
        templateItemId: pt.id,
        value: pt.testValue.trim() === '' ? null : pt.testValue.trim()
      }));
      try {
        const { sheet: updated } = await patchSheet(sheet.id, { quantity: 1, results });
        setSheet(updated);
      } catch {
        /* 自動保存失敗は次回に委ねる */
      }
    },
    [sheet, readOnly, editAccess.allowed, patchSheet]
  );

  const scheduleSave = useCallback(
    (nextPoints: InspectionDrawingPoint[]) => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
      autosaveRef.current = setTimeout(() => {
        void flushSave(nextPoints);
      }, AUTOSAVE_MS);
    },
    [flushSave]
  );

  const updatePointValue = (id: string, testValue: string) => {
    setPoints((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, testValue } : p));
      scheduleSave(next);
      return next;
    });
  };

  const handleFinalize = async () => {
    if (!sheet || !editAccess.allowed || sheet.status !== 'DRAFT') return;
    setBusy(true);
    try {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
      await flushSave(points);
      const { sheet: finalized } = await finalizeSheet(sheet.id);
      setSheet(finalized);
      setMessage('確定しました。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '確定に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  if (!sheetId) {
    return <p className="p-4 text-amber-200">記録表IDがありません。</p>;
  }

  if (sheet && !editAccess.allowed) {
    return (
      <div className="flex flex-col gap-3 p-4 text-white">
        <p className="text-sm text-amber-200">{editAccess.reason}</p>
        <Link
          to={`/kiosk/part-measurement/edit/${sheetId}`}
          className="text-sm font-semibold text-blue-200 underline"
        >
          表形式の測定画面を開く
        </Link>
      </div>
    );
  }

  if (sheet && !supportsDrawing) {
    return (
      <div className="flex flex-col gap-3 p-4 text-white">
        <p className="text-amber-200">この記録表は図面中心UIの対象外です（座標・上下限が未設定）。</p>
        <Link
          to={`/kiosk/part-measurement/edit/${sheetId}`}
          className="text-sm font-semibold text-blue-200 underline"
        >
          表形式の測定画面を開く
        </Link>
      </div>
    );
  }

  const contextBanner = isEvaluation ? (
    <p className="text-xs text-amber-200">
      評価用テンプレート（URL 直打ち）。本番の日程・一覧導線とは別です。
    </p>
  ) : isProduction ? (
    <p className="text-xs text-emerald-200/90">本番記録（図面付きテンプレ・数量1）。通常の記録表 API で保存・確定します。</p>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-white">
      {contextBanner}
      <InspectionDrawingCreateHeaderBand
        metadata={
          <>
            <p className="text-[1.3rem] font-semibold leading-snug">
              {sheet ? `${sheet.productNo} / ${sheet.fhincd}` : '読み込み中…'}
            </p>
            {sheet ? (
              <p className="text-sm text-white/75">
                {sheet.status}
                {sheet.employeeNameSnapshot ? ` / ${sheet.employeeNameSnapshot}` : ''}
              </p>
            ) : null}
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void navigate('/kiosk/part-measurement')}>
              一覧へ
            </Button>
            {sheet?.status === 'DRAFT' && editAccess.allowed ? (
              <Button
                type="button"
                variant="primary"
                className={inspectionDrawingKioskDisabledButtonClass}
                onClick={() => void handleFinalize()}
                disabled={busy}
              >
                確定
              </Button>
            ) : null}
          </div>
        }
      />

      {message ? <p className="text-sm font-semibold text-amber-200">{message}</p> : null}
      {drawingLoadError ? <p className="text-sm text-red-300">{drawingLoadError}</p> : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className={inspectionDrawingCanvasColumnClassName}>
          {drawingBlobUrl ? (
            <InspectionDrawingCanvas
              imageUrl={drawingBlobUrl}
              points={points}
              mode="test"
              selectedPointId={selectedPointId}
              onSelectPoint={setSelectedPointId}
              onAddPoint={() => {
                /* 記録画面では点追加不可 */
              }}
            />
          ) : (
            <p className="text-sm text-white/70">{busy ? '読み込み中…' : '図面を読み込み中…'}</p>
          )}
        </div>
        <aside className={inspectionDrawingSideAsideClassName}>
          <InspectionDrawingValuePanel
            point={selectedPoint}
            readOnly={readOnly || sheet?.status !== 'DRAFT'}
            onValueChange={(v) => {
              if (!selectedPoint) return;
              updatePointValue(selectedPoint.id, v);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
