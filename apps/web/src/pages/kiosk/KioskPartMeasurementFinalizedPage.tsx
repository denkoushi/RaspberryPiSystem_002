import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';

import { getResolvedClientKey, listPartMeasurementFinalized } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { PartMeasurementProcessGroup, PartMeasurementSheetDto } from '../../features/part-measurement/types';

export function KioskPartMeasurementFinalizedPage() {
  const clientKey = getResolvedClientKey();
  const [productNo, setProductNo] = useState('');
  const [fseiban, setFseiban] = useState('');
  const [fhincd, setFhincd] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup | ''>('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [includeInvalidated, setIncludeInvalidated] = useState(false);
  const [sheets, setSheets] = useState<PartMeasurementSheetDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const search = useCallback(
    async (cursor?: string | null) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await listPartMeasurementFinalized(
          {
            limit: 30,
            cursor: cursor ?? undefined,
            productNo: productNo.trim() || undefined,
            fseiban: fseiban.trim() || undefined,
            fhincd: fhincd.trim() || undefined,
            resourceCd: resourceCd.trim() || undefined,
            processGroup: processGroup || undefined,
            includeCancelled,
            includeInvalidated
          },
          clientKey
        );
        setSheets((prev) => (cursor ? [...prev, ...res.sheets] : res.sheets));
        setNextCursor(res.nextCursor);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? '取得に失敗しました。');
      } finally {
        setBusy(false);
      }
    },
    [
      clientKey,
      productNo,
      fseiban,
      fhincd,
      resourceCd,
      processGroup,
      includeCancelled,
      includeInvalidated
    ]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-white">
      <Link to="/kiosk/part-measurement" className="text-sm font-semibold text-blue-200 underline">
        部品測定トップへ
      </Link>

      <Card title="確定記録の検索">
        <div className="grid max-w-4xl gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            製造order番号
            <Input value={productNo} onChange={(e) => setProductNo(e.target.value)} className="text-slate-900" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            製番
            <Input value={fseiban} onChange={(e) => setFseiban(e.target.value)} className="text-slate-900" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            品番
            <Input value={fhincd} onChange={(e) => setFhincd(e.target.value)} className="text-slate-900" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            資源CD
            <Input value={resourceCd} onChange={(e) => setResourceCd(e.target.value)} className="text-slate-900" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            工程
            <select
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              value={processGroup}
              onChange={(e) => setProcessGroup(e.target.value as PartMeasurementProcessGroup | '')}
            >
              <option value="">（指定なし）</option>
              <option value="cutting">切削</option>
              <option value="grinding">研削</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
            />
            取消済みを含む
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeInvalidated}
              onChange={(e) => setIncludeInvalidated(e.target.checked)}
            />
            無効化済みを含む
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => void search()} disabled={busy}>
            検索
          </Button>
        </div>
      </Card>

      <Card title="一覧（確定日時の新しい順）">
        {message ? <p className="mb-2 text-sm text-amber-800">{message}</p> : null}
        {sheets.length === 0 ? (
          <p className="text-sm text-slate-600">検索してください。</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-auto text-sm text-slate-900">
            {sheets.map((s) => (
              <li key={s.id} className="rounded border border-slate-200 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">{s.status}</span> / {s.productNo} / {s.fhincd} /{' '}
                    {s.resourceCdSnapshot ?? '—'} / {s.finalizedAt ? new Date(s.finalizedAt).toLocaleString() : '—'}
                  </div>
                  <Link
                    to={`/kiosk/part-measurement/edit/${s.id}`}
                    className="font-semibold text-blue-700 underline"
                  >
                    開く
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => void search(nextCursor)}
          >
            さらに読み込む
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
