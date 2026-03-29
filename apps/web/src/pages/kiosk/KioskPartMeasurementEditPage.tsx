import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';

import {
  cancelPartMeasurementSheet,
  downloadPartMeasurementSheetCsv,
  finalizePartMeasurementSheet,
  getPartMeasurementSheet,
  getResolvedClientKey,
  patchPartMeasurementSheet,
  transferPartMeasurementEditLock
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { PartMeasurementSheetDto } from '../../features/part-measurement/types';

const AUTOSAVE_MS = 600;

function resultKey(pieceIndex: number, templateItemId: string) {
  return `${pieceIndex}:${templateItemId}`;
}

export function KioskPartMeasurementEditPage() {
  const { sheetId } = useParams<{ sheetId: string }>();
  const navigate = useNavigate();
  const clientKey = getResolvedClientKey();
  const isActiveRoute = useMatch('/kiosk/part-measurement/edit/:sheetId');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastNfcKeyRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sheet, setSheet] = useState<PartMeasurementSheetDto | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockPrompt, setLockPrompt] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const syncCellsFromSheet = useCallback((s: PartMeasurementSheetDto) => {
    const next: Record<string, string> = {};
    for (const r of s.results) {
      if (r.value !== null && r.value !== undefined && String(r.value).length > 0) {
        next[resultKey(r.pieceIndex, r.templateItemId)] = String(r.value);
      }
    }
    setCellValues(next);
    setQuantityInput(s.quantity != null ? String(s.quantity) : '');
  }, []);

  const load = useCallback(async () => {
    if (!sheetId) return;
    setBusy(true);
    setMessage(null);
    try {
      const s = await getPartMeasurementSheet(sheetId, clientKey);
      setSheet(s);
      syncCellsFromSheet(s);
      if (s.status === 'FINALIZED' || s.status === 'CANCELLED' || s.status === 'INVALIDATED') {
        /* 閲覧モード */
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '読み込みに失敗しました。');
    } finally {
      setBusy(false);
    }
  }, [sheetId, clientKey, syncCellsFromSheet]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildResultsPayload = useCallback(
    (qty: number, cells: Record<string, string>, items: { id: string }[]) => {
      const results: Array<{ pieceIndex: number; templateItemId: string; value: string }> = [];
      for (let p = 0; p < qty; p += 1) {
        for (const it of items) {
          const k = resultKey(p, it.id);
          const raw = cells[k];
          if (raw !== undefined && raw.trim() !== '') {
            results.push({ pieceIndex: p, templateItemId: it.id, value: raw.trim() });
          }
        }
      }
      return results;
    },
    []
  );

  const flushPatchSheet = useCallback(
    async (id: string, qty: number, cells: Record<string, string>, items: { id: string }[]) => {
      const results = buildResultsPayload(qty, cells, items);
      try {
        const updated = await patchPartMeasurementSheet(
          id,
          { quantity: qty, results: results.length > 0 ? results : undefined },
          clientKey
        );
        setSheet(updated);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { errorCode?: string } } };
        if (err.response?.status === 409 && err.response?.data?.errorCode === 'PART_MEASUREMENT_EDIT_LOCKED') {
          setLockPrompt(true);
          throw e;
        }
        throw e;
      }
    },
    [buildResultsPayload, clientKey]
  );

  useEffect(() => {
    if (!sheet || sheet.status !== 'DRAFT') return;
    const items = sheet.template?.items ?? [];
    if (items.length === 0) return;

    const n = parseInt(quantityInput, 10);
    if (!Number.isFinite(n) || n < 0) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void flushPatchSheet(sheet.id, n, cellValues, items).catch(() => {
        /* 自動保存失敗は次回に委ねる */
      });
    }, AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [quantityInput, cellValues, sheet, flushPatchSheet]);

  useEffect(() => {
    if (!nfcEvent || !sheet || sheet.status !== 'DRAFT') return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNfcKeyRef.current === key) return;
    lastNfcKeyRef.current = key;
    void (async () => {
      try {
        const updated = await patchPartMeasurementSheet(
          sheet.id,
          { employeeTagUid: nfcEvent.uid },
          clientKey
        );
        setSheet(updated);
        setMessage(null);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string }; status?: number; errorCode?: string } };
        if (err.response?.status === 409) setLockPrompt(true);
        setMessage(err.response?.data?.message ?? '社員タグの反映に失敗しました。');
      }
    })();
  }, [nfcEvent, sheet, clientKey]);

  const templateItems = sheet?.template?.items ?? [];
  const pieceCount = useMemo(() => {
    const n = parseInt(quantityInput, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [quantityInput]);

  const onCellChange = (pieceIndex: number, templateItemId: string, value: string) => {
    const k = resultKey(pieceIndex, templateItemId);
    setCellValues((prev) => ({ ...prev, [k]: value }));
  };

  const isRowComplete = (p: number) => {
    if (templateItems.length === 0) return false;
    return templateItems.every((it) => {
      const v = cellValues[resultKey(p, it.id)];
      return v !== undefined && v.trim() !== '';
    });
  };

  const firstEmptyPieceIndex = () => {
    for (let p = 0; p < pieceCount; p += 1) {
      if (!isRowComplete(p)) return p;
    }
    return -1;
  };

  const copyRowFrom = (fromPiece: number) => {
    if (!isRowComplete(fromPiece)) return;
    const to = firstEmptyPieceIndex();
    if (to < 0) {
      setMessage('空の行がありません。');
      return;
    }
    setCellValues((prev) => {
      const next = { ...prev };
      for (const it of templateItems) {
        const kFrom = resultKey(fromPiece, it.id);
        const kTo = resultKey(to, it.id);
        next[kTo] = prev[kFrom] ?? '';
      }
      return next;
    });
    setMessage(null);
  };

  const copyCellFrom = (pieceIndex: number, templateItemId: string) => {
    const src = cellValues[resultKey(pieceIndex, templateItemId)]?.trim() ?? '';
    if (!src) return;
    let targetPiece = -1;
    for (let p = pieceIndex + 1; p < pieceCount; p += 1) {
      const cur = cellValues[resultKey(p, templateItemId)]?.trim() ?? '';
      if (!cur) {
        targetPiece = p;
        break;
      }
    }
    if (targetPiece < 0) {
      setMessage('同じ項目の空欄セルがありません。');
      return;
    }
    setCellValues((prev) => ({
      ...prev,
      [resultKey(targetPiece, templateItemId)]: src
    }));
    setMessage(null);
  };

  const handleManualSave = async () => {
    if (!sheet || sheet.status !== 'DRAFT') return;
    const items = sheet.template?.items ?? [];
    const n = parseInt(quantityInput, 10);
    if (!Number.isFinite(n) || n < 0 || items.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      await flushPatchSheet(sheet.id, n, cellValues, items);
      setMessage('保存しました。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (!sheet) return;
    setBusy(true);
    setMessage(null);
    try {
      const n = parseInt(quantityInput, 10);
      const items = sheet.template?.items ?? [];
      if (Number.isFinite(n) && n >= 1 && items.length > 0) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        await flushPatchSheet(sheet.id, n, cellValues, items);
      }
      const finalized = await finalizePartMeasurementSheet(sheet.id, clientKey);
      setSheet(finalized);
      setMessage('確定しました。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '確定に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleTransferLock = async () => {
    if (!sheetId) return;
    setBusy(true);
    try {
      const updated = await transferPartMeasurementEditLock(sheetId, { confirm: true }, clientKey);
      setSheet(updated);
      setLockPrompt(false);
      setMessage('編集ロックを引き継ぎました。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '引き継ぎに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!sheetId) return;
    const r = cancelReason.trim();
    if (!r) {
      setMessage('取消理由を入力してください。');
      return;
    }
    setBusy(true);
    try {
      await cancelPartMeasurementSheet(sheetId, r, clientKey);
      setCancelOpen(false);
      void navigate('/kiosk/part-measurement');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '取消に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const readOnly =
    sheet?.status === 'FINALIZED' || sheet?.status === 'CANCELLED' || sheet?.status === 'INVALIDATED';

  if (!sheetId) {
    return <p className="p-4 text-amber-200">記録表IDがありません。</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-white">
      {lockPrompt ? (
        <Card title="別端末が編集中">
          <p className="mb-2 text-sm text-slate-700">この端末で編集を引き継ぎますか？</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={() => void handleTransferLock()} disabled={busy}>
              引き継ぐ
            </Button>
            <Button type="button" variant="secondary" onClick={() => setLockPrompt(false)}>
              閉じる
            </Button>
          </div>
        </Card>
      ) : null}

      {cancelOpen ? (
        <Card title="下書きを取消">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            取消理由（必須）
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="text-slate-900"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="primary" onClick={() => void handleCancel()} disabled={busy}>
              取消する
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCancelOpen(false)}>
              戻る
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void navigate('/kiosk/part-measurement')}>
          一覧へ
        </Button>
        {sheet?.status === 'DRAFT' ? (
          <>
            <Button type="button" variant="secondary" onClick={() => void handleManualSave()} disabled={busy}>
              手動保存
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCancelOpen(true)} disabled={busy}>
              下書き取消
            </Button>
          </>
        ) : null}
        {sheet?.status === 'FINALIZED' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void downloadPartMeasurementSheetCsv(sheet.id, clientKey)}
          >
            CSVダウンロード
          </Button>
        ) : null}
      </div>

      {sheet ? (
        <>
          <Card title="ヘッダ">
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-slate-600">製番</dt>
                <dd className="font-semibold text-slate-900">{sheet.fseiban}</dd>
              </div>
              <div>
                <dt className="text-slate-600">製造order</dt>
                <dd className="font-semibold text-slate-900">{sheet.productNo}</dd>
              </div>
              <div>
                <dt className="text-slate-600">品番</dt>
                <dd className="font-semibold text-slate-900">{sheet.fhincd}</dd>
              </div>
              <div>
                <dt className="text-slate-600">資源CD</dt>
                <dd className="font-semibold text-slate-900">{sheet.resourceCdSnapshot ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">工程</dt>
                <dd className="font-semibold text-slate-900">
                  {sheet.processGroupSnapshot === 'grinding' ? '研削' : '切削'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">作業者（確定前NFC）</dt>
                <dd className="font-semibold text-slate-900">
                  {sheet.employeeNameSnapshot ?? 'NFCで社員タグをスキャン'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">作成者</dt>
                <dd className="font-semibold text-slate-900">{sheet.createdByEmployeeNameSnapshot ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">確定者</dt>
                <dd className="font-semibold text-slate-900">{sheet.finalizedByEmployeeNameSnapshot ?? '—'}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex w-[14ch] max-w-full flex-col gap-1 text-sm font-semibold text-slate-700">
                個数
                <Input
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  inputMode="numeric"
                  disabled={readOnly}
                  className="text-slate-900"
                />
              </label>
            </div>
          </Card>

          <Card title="測定値">
            {templateItems.length === 0 ? (
              <p className="text-sm text-amber-700">テンプレート項目がありません。</p>
            ) : pieceCount < 1 ? (
              <p className="text-sm text-slate-600">個数を入力すると入力欄が表示されます。</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm text-slate-900">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="p-2">個体</th>
                      <th className="p-2 w-24">行</th>
                      {templateItems.map((it) => (
                        <th key={it.id} className="p-2">
                          <div className="font-semibold">{it.measurementLabel}</div>
                          <div className="text-xs font-normal text-slate-600">
                            基準 {it.datumSurface} / 部位 {it.measurementPoint}
                            {it.unit ? ` / ${it.unit}` : ''}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: pieceCount }, (_, p) => (
                      <tr key={p} className="border-b border-slate-200">
                        <td className="p-2 font-semibold">{p + 1}</td>
                        <td className="p-1">
                          {!readOnly && isRowComplete(p) ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="px-2 py-1 text-xs"
                              title="行コピー"
                              onClick={() => copyRowFrom(p)}
                            >
                              行→
                            </Button>
                          ) : null}
                        </td>
                        {templateItems.map((it) => (
                          <td key={it.id} className="p-1 align-top">
                            <div className="flex items-start gap-1">
                              <Input
                                value={cellValues[resultKey(p, it.id)] ?? ''}
                                onChange={(e) => onCellChange(p, it.id, e.target.value)}
                                disabled={readOnly}
                                className="min-w-0 flex-1 text-slate-900"
                                inputMode="decimal"
                              />
                              {!readOnly &&
                              (cellValues[resultKey(p, it.id)]?.trim() ?? '').length > 0 ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="shrink-0 px-1 py-1 text-xs"
                                  title="セルコピー（同項目の次の空欄へ）"
                                  onClick={() => copyCellFrom(p, it.id)}
                                >
                                  ⧉
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {sheet.status === 'DRAFT' ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="primary" onClick={() => void handleFinalize()} disabled={busy}>
                確定
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-white/80">{busy ? '読み込み中…' : '記録表がありません。'}</p>
      )}

      {message ? <p className="text-sm font-semibold text-amber-200">{message}</p> : null}
    </div>
  );
}
