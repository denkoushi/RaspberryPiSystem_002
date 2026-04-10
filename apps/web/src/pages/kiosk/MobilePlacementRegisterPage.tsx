import { isAxiosError } from 'axios';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { registerMobilePlacement, type ProductionScheduleRow } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';

type LocationState = {
  row?: ProductionScheduleRow;
};

export function MobilePlacementRegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const row = state.row;

  const [shelfCode, setShelfCode] = useState('');
  const [itemBarcode, setItemBarcode] = useState('');
  const [scanKind, setScanKind] = useState<'shelf' | 'item' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rd = row?.rowData as Record<string, unknown> | undefined;
  const summary =
    row && rd
      ? [
          typeof rd.FSEIBAN === 'string' ? rd.FSEIBAN : '',
          typeof rd.FHINCD === 'string' ? rd.FHINCD : '',
          typeof rd.ProductNo === 'string' ? rd.ProductNo : ''
        ]
          .filter((s) => s.length > 0)
          .join(' · ')
      : null;

  const onScanSuccess = useCallback(
    (text: string) => {
      const v = text.trim();
      if (scanKind === 'shelf') {
        setShelfCode(v);
      } else if (scanKind === 'item') {
        setItemBarcode(v);
      }
      setScanKind(null);
    },
    [scanKind]
  );

  const onScanAbort = useCallback(() => {
    setScanKind(null);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await registerMobilePlacement({
        shelfCodeRaw: shelfCode,
        itemBarcodeRaw: itemBarcode,
        csvDashboardRowId: row?.id
      });
      setMessage(
        `登録しました: ${res.item.itemCode} → 棚 ${res.event.newStorageLocation}${
          res.event.previousStorageLocation
            ? `（以前: ${res.event.previousStorageLocation}）`
            : ''
        }`
      );
      setShelfCode('');
      setItemBarcode('');
    } catch (e) {
      if (isAxiosError(e)) {
        const msg = typeof e.response?.data?.message === 'string' ? e.response.data.message : e.message;
        setError(msg);
      } else {
        setError('登録に失敗しました');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/kiosk/mobile-placement" className="text-sm text-sky-300 underline">
          ← 一覧へ
        </Link>
        <Button type="button" variant="ghostOnDark" className="text-sm" onClick={() => navigate(-1)}>
          戻る
        </Button>
      </div>

      <div className="rounded-md border border-white/10 bg-slate-900/60 p-3 text-sm">
        <p className="font-medium text-white">配膳配置（V1）</p>
        {summary ? (
          <p className="mt-1 text-white/80">
            選択行: {summary}
          </p>
        ) : (
          <p className="mt-1 text-white/60">スケジュール行なし（工具コードのみで登録）</p>
        )}
        <p className="mt-2 text-xs text-white/50">
          現場バーコードの意味の切り分け: リポジトリ <code className="text-white/70">docs/knowledge-base/KB-339-mobile-placement-barcode-survey.md</code>
        </p>
      </div>

      <BarcodeScanModal
        open={scanKind !== null}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={onScanSuccess}
        onAbort={onScanAbort}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white/80">棚番（スキャン or 手入力）</span>
          <div className="flex flex-wrap gap-2">
            <input
              value={shelfCode}
              onChange={(e) => setShelfCode(e.target.value)}
              className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-white"
              placeholder="例: A-01-02"
            />
            <Button type="button" variant="ghostOnDark" onClick={() => setScanKind('shelf')}>
              棚をスキャン
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-white/80">アイテム（Item.itemCode 相当のバーコード）</span>
          <div className="flex flex-wrap gap-2">
            <input
              value={itemBarcode}
              onChange={(e) => setItemBarcode(e.target.value)}
              className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-white"
              placeholder="工具ラベル"
            />
            <Button type="button" variant="ghostOnDark" onClick={() => setScanKind('item')}>
              アイテムをスキャン
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="ghostOnDark"
          className="w-full justify-center py-3 text-base"
          disabled={submitting || shelfCode.trim().length === 0 || itemBarcode.trim().length === 0}
          onClick={() => void handleSubmit()}
        >
          {submitting ? '登録中…' : '配置を登録'}
        </Button>
      </div>

      {message ? (
        <p className="text-sm text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
