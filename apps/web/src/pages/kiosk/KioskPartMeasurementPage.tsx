import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  createPartMeasurementSheet,
  getResolvedClientKey,
  listPartMeasurementDrafts,
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

import type {
  PartMeasurementProcessGroup,
  PartMeasurementResolvedCandidate,
  PartMeasurementSheetDto,
  ResolveTicketResponse
} from '../../features/part-measurement/types';

type HubLocationState = {
  productNo?: string;
  resourceCdFilter?: string;
  templateCreated?: boolean;
};

export function KioskPartMeasurementPage() {
  const clientKey = getResolvedClientKey();
  const navigate = useNavigate();
  const location = useLocation();

  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>(() =>
    loadPartMeasurementProcessGroup()
  );
  const [productNoInput, setProductNoInput] = useState('');
  const [resourceCdFilter, setResourceCdFilter] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [resolveResult, setResolveResult] = useState<ResolveTicketResponse | null>(null);
  const [drafts, setDrafts] = useState<PartMeasurementSheetDto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    savePartMeasurementProcessGroup(processGroup);
  }, [processGroup]);

  useEffect(() => {
    const st = location.state as HubLocationState | null;
    if (!st) return;
    if (typeof st.productNo === 'string' && st.productNo.trim()) {
      setProductNoInput(st.productNo.trim());
    }
    if (typeof st.resourceCdFilter === 'string') {
      setResourceCdFilter(st.resourceCdFilter.trim());
    }
    if (st.templateCreated) {
      setMessage('テンプレートを登録しました。日程を照会して記録表を開始してください。');
    }
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const refreshDrafts = useCallback(async () => {
    try {
      const { sheets } = await listPartMeasurementDrafts({ limit: 50 }, clientKey);
      setDrafts(sheets);
    } catch {
      setDrafts([]);
    }
  }, [clientKey]);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  const handleScanSuccess = (text: string) => {
    setProductNoInput(text.trim());
    setScanOpen(false);
    setMessage(null);
  };

  const createSheetFromResolved = async (
    row: PartMeasurementResolvedCandidate,
    templateId: string,
    productNo: string
  ) => {
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
      await refreshDrafts();
      void navigate(`/kiosk/part-measurement/edit/${created.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '記録表の作成に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const goTemplatePick = (c: PartMeasurementResolvedCandidate, scannedPn: string) => {
    void navigate('/kiosk/part-measurement/template/pick', {
      state: {
        productNo: c.productNo,
        fseiban: c.fseiban,
        fhincd: c.fhincd,
        fhinmei: c.fhinmei,
        resourceCd: c.resourceCd,
        processGroup,
        machineName: c.machineName,
        scheduleRowId: c.scheduleRowId,
        scannedBarcodeRaw: scannedPn
      }
    });
  };

  const handleResolve = async () => {
    const pn = productNoInput.trim();
    if (!pn) {
      setMessage('製造order番号を入力するかバーコードをスキャンしてください。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setResolveResult(null);
    try {
      const res = await resolvePartMeasurementTicket(
        {
          productNo: pn,
          processGroup,
          scannedBarcodeRaw: pn,
          resourceCd: resourceCdFilter.trim() || null
        },
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
        goTemplatePick(res.selected, pn);
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
      goTemplatePick(c, productNoInput.trim());
      return;
    }
    await createSheetFromResolved(c, resolveResult.template.id, c.productNo);
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
          variant="primary"
          className={clsx(processGroup !== 'cutting' && 'opacity-40 grayscale')}
          onClick={() => setProcessGroup('cutting')}
        >
          切削
        </Button>
        <Button
          type="button"
          variant="primary"
          className={clsx(processGroup !== 'grinding' && 'opacity-40 grayscale')}
          onClick={() => setProcessGroup('grinding')}
        >
          研削
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/kiosk/part-measurement/finalized">
          <Button type="button" variant="secondary">
            確定記録の閲覧
          </Button>
        </Link>
        <Button type="button" variant="secondary" onClick={() => void refreshDrafts()}>
          下書き一覧を更新
        </Button>
      </div>

      <Card title="下書き一覧（新しい順）">
        {drafts.length === 0 ? (
          <p className="text-sm text-slate-600">下書きはありません。</p>
        ) : (
          <ul className="max-h-48 space-y-2 overflow-auto text-sm">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link
                  to={`/kiosk/part-measurement/edit/${d.id}`}
                  className="font-semibold text-blue-700 underline hover:text-blue-900"
                >
                  {d.productNo} / {d.fhincd} / {d.resourceCdSnapshot ?? '—'} /{' '}
                  {d.processGroupSnapshot === 'grinding' ? '研削' : '切削'} / 更新{' '}
                  {new Date(d.updatedAt).toLocaleString()}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="移動票（製造order番号）">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-[14ch] max-w-full flex-col gap-1 text-sm font-semibold text-slate-700">
            製造order番号
            <Input
              value={productNoInput}
              onChange={(e) => setProductNoInput(e.target.value)}
              placeholder="スキャンまたは手入力"
              className="w-full text-slate-900"
            />
          </label>
          <label className="flex w-[12ch] max-w-full flex-col gap-1 text-sm font-semibold text-slate-700">
            資源CD絞込（任意）
            <Input
              value={resourceCdFilter}
              onChange={(e) => setResourceCdFilter(e.target.value)}
              className="w-full text-slate-900"
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

      {resolveResult && resolveResult.ambiguous ? (
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

      {message ? <p className="text-sm font-semibold text-amber-200">{message}</p> : null}
    </div>
  );
}
