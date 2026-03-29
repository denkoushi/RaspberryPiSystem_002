import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';

import {
  createPartMeasurementSheet,
  finalizePartMeasurementSheet,
  getResolvedClientKey,
  patchPartMeasurementSheet,
  resolvePartMeasurementTicket
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import {
  BarcodeScanModal,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL
} from '../../features/barcode-scan';
import {
  loadPartMeasurementProcessGroup,
  savePartMeasurementProcessGroup
} from '../../features/part-measurement/processGroupStorage';
import { useNfcStream } from '../../hooks/useNfcStream';

import type {
  PartMeasurementProcessGroup,
  PartMeasurementResolvedCandidate,
  PartMeasurementSheetDto,
  ResolveTicketResponse
} from '../../features/part-measurement/types';

const AUTOSAVE_MS = 600;

function resultKey(pieceIndex: number, templateItemId: string) {
  return `${pieceIndex}:${templateItemId}`;
}

export function KioskPartMeasurementPage() {
  const clientKey = getResolvedClientKey();
  const isActiveRoute = useMatch('/kiosk/part-measurement');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastNfcKeyRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>(() =>
    loadPartMeasurementProcessGroup()
  );
  const [productNoInput, setProductNoInput] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [resolveResult, setResolveResult] = useState<ResolveTicketResponse | null>(null);
  const [sheet, setSheet] = useState<PartMeasurementSheetDto | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    savePartMeasurementProcessGroup(processGroup);
  }, [processGroup]);

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
    async (sheetId: string, qty: number, cells: Record<string, string>, items: { id: string }[]) => {
      const results = buildResultsPayload(qty, cells, items);
      const updated = await patchPartMeasurementSheet(
        sheetId,
        { quantity: qty, results: results.length > 0 ? results : undefined },
        clientKey
      );
      setSheet(updated);
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
        /* 自動保存失敗は黙ってよい（次の編集で再試行） */
      });
    }, AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [quantityInput, cellValues, sheet, flushPatchSheet]);

  const handleScanSuccess = (text: string) => {
    setProductNoInput(text.trim());
    setScanOpen(false);
    setMessage(null);
  };

  const createSheetFromResolved = useCallback(
    async (row: PartMeasurementResolvedCandidate, templateId: string, productNo: string) => {
      setBusy(true);
      try {
        const created = await createPartMeasurementSheet(
          {
            productNo,
            fseiban: row.fseiban,
            fhincd: row.fhincd,
            fhinmei: row.fhinmei,
            machineName: row.machineName,
            resourceCdSnapshot: row.resourceCd,
            processGroup,
            templateId,
            scannedBarcodeRaw: productNo,
            scheduleRowId: row.scheduleRowId
          },
          clientKey
        );
        setSheet(created);
        syncCellsFromSheet(created);
        setMessage(null);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? '記録表の作成に失敗しました。');
      } finally {
        setBusy(false);
      }
    },
    [clientKey, processGroup, syncCellsFromSheet]
  );

  const handleResolve = async () => {
    const pn = productNoInput.trim();
    if (!pn) {
      setMessage('製造order番号を入力するかバーコードをスキャンしてください。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setResolveResult(null);
    setSheet(null);
    try {
      const res = await resolvePartMeasurementTicket(
        { productNo: pn, processGroup, scannedBarcodeRaw: pn },
        clientKey
      );
      setResolveResult(res);
      if (res.fhincdMismatch) {
        setMessage('日程データと照合で不一致がありました。候補から行を選んでください。');
      }
      if (!res.selected && res.candidates.length === 0) {
        setMessage('日程データに該当する製造order番号がありません。');
        return;
      }
      if (res.selected && res.template) {
        await createSheetFromResolved(res.selected, res.template.id, pn);
        return;
      }
      if (res.selected && !res.template) {
        setMessage('この品番・工程の測定テンプレートが未登録です。管理画面で登録してください。');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '照会に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handlePickCandidate = async (c: PartMeasurementResolvedCandidate) => {
    if (!resolveResult?.template) {
      setMessage('テンプレートがありません。管理画面で登録してください。');
      return;
    }
    await createSheetFromResolved(c, resolveResult.template.id, c.productNo);
  };

  useEffect(() => {
    if (!nfcEvent || !sheet || sheet.status === 'FINALIZED') return;
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
        const err = e as { response?: { data?: { message?: string } } };
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
      setMessage('確定しました。新しい記録を始める場合は「新規」へ。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '確定に失敗しました。未入力や作業者を確認してください。');
    } finally {
      setBusy(false);
    }
  };

  const handleNew = () => {
    setSheet(null);
    setResolveResult(null);
    setProductNoInput('');
    setQuantityInput('');
    setCellValues({});
    setMessage(null);
    lastNfcKeyRef.current = null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-white">
      <BarcodeScanModal
        open={scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={handleScanSuccess}
        onAbort={() => setScanOpen(false)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-white/80">工程</span>
        <Button
          type="button"
          variant={processGroup === 'cutting' ? 'primary' : 'secondary'}
          onClick={() => setProcessGroup('cutting')}
        >
          切削
        </Button>
        <Button
          type="button"
          variant={processGroup === 'grinding' ? 'primary' : 'secondary'}
          onClick={() => setProcessGroup('grinding')}
        >
          研削
        </Button>
      </div>

      <Card title="移動票（製造order番号）">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm font-semibold text-slate-700">
            製造order番号
            <Input
              value={productNoInput}
              onChange={(e) => setProductNoInput(e.target.value)}
              placeholder="スキャンまたは手入力"
              className="text-slate-900"
            />
          </label>
          <Button type="button" variant="secondary" onClick={() => setScanOpen(true)}>
            バーコード
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleResolve()} disabled={busy}>
            日程を照会
          </Button>
        </div>
      </Card>

      {resolveResult && resolveResult.ambiguous && !sheet ? (
        <Card title="候補を選択">
          <p className="mb-2 text-sm text-amber-200">複数行が該当しました。1つ選んでください。</p>
          <div className="flex flex-col gap-2">
            {resolveResult.candidates.map((c) => (
              <Button
                key={c.scheduleRowId}
                type="button"
                variant="secondary"
                className="justify-start text-left"
                onClick={() => void handlePickCandidate(c)}
                disabled={busy}
              >
                製番 {c.fseiban} / 品番 {c.fhincd} / 資源 {c.resourceCd} / {c.fhinmei || '—'}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

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
                <dt className="text-slate-600">品名</dt>
                <dd className="font-semibold text-slate-900">{sheet.fhinmei}</dd>
              </div>
              <div>
                <dt className="text-slate-600">機種名</dt>
                <dd className="font-semibold text-slate-900">{sheet.machineName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-600">作業者</dt>
                <dd className="font-semibold text-slate-900">
                  {sheet.employeeNameSnapshot ?? 'NFCで社員タグをスキャン'}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex w-32 flex-col gap-1 text-sm font-semibold text-slate-700">
                個数
                <Input
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  inputMode="numeric"
                  disabled={sheet.status === 'FINALIZED'}
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
                <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-900">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="p-2">個体</th>
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
                        {templateItems.map((it) => (
                          <td key={it.id} className="p-1">
                            <Input
                              value={cellValues[resultKey(p, it.id)] ?? ''}
                              onChange={(e) => onCellChange(p, it.id, e.target.value)}
                              disabled={sheet.status === 'FINALIZED'}
                              className="text-slate-900"
                              inputMode="decimal"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleFinalize()}
              disabled={busy || sheet.status === 'FINALIZED'}
            >
              確定
            </Button>
            <Button type="button" variant="secondary" onClick={handleNew} disabled={busy}>
              新規
            </Button>
          </div>
        </>
      ) : null}

      {message ? <p className="text-sm font-semibold text-amber-200">{message}</p> : null}
    </div>
  );
}
