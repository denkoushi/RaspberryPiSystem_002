import { useCallback, useState } from 'react';

import { getKioskPurchaseOrderLookup } from '../../api/client';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';
import { mpKioskTheme } from '../../features/mobile-placement/ui/mobilePlacementKioskTheme';
import { resolveClientKey } from '../../lib/client-key';

export function PurchaseOrderLookupPage() {
  const [orderNo, setOrderNo] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getKioskPurchaseOrderLookup>> | null>(null);

  const runLookup = useCallback(async () => {
    const trimmed = orderNo.trim();
    if (!/^\d{10}$/.test(trimmed)) {
      setError('注文番号は10桁の数字で入力してください');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { key } = resolveClientKey({ allowDefaultFallback: true });
      const data = await getKioskPurchaseOrderLookup(trimmed, key);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '照会に失敗しました');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [orderNo]);

  const onScanSuccess = useCallback((text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 10);
    setOrderNo(digits);
    setScanOpen(false);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <h1 className="text-lg font-semibold">購買照会（FKOBAINO）</h1>
      <p className="text-sm text-gray-600">
        現品票の注文番号（10桁）を入力するか、一次元バーコードをスキャンしてください。
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          inputMode="numeric"
          className="min-w-[12rem] rounded border px-2 py-2"
          placeholder="0000000000"
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value.replace(/\D/g, '').slice(0, 10))}
          maxLength={10}
          autoComplete="off"
        />
        <button type="button" className={mpKioskTheme.partSearchButton} onClick={() => setScanOpen(true)}>
          スキャン
        </button>
        <button
          type="button"
          className={mpKioskTheme.partSearchButton}
          onClick={() => void runLookup()}
          disabled={loading}
        >
          {loading ? '照会中…' : '照会'}
        </button>
      </div>
      {error != null && <div className="text-red-600">{error}</div>}
      <BarcodeScanModal
        open={scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={onScanSuccess}
        onAbort={() => setScanOpen(false)}
      />
      {result != null && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-100">
                <th className="p-2 text-left">製番</th>
                <th className="p-2 text-left">購買品名</th>
                <th className="p-2 text-left">既存DB品名</th>
                <th className="p-2 text-left">機種名</th>
                <th className="p-2 text-left">合格数</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-gray-500">
                    データがありません
                  </td>
                </tr>
              ) : (
                result.rows.map((r, i) => (
                  <tr key={`${r.seiban}-${r.purchasePartCodeNormalized}-${i}`} className="border-b">
                    <td className="p-2">{r.seiban}</td>
                    <td className="p-2">{r.purchasePartName}</td>
                    <td className="p-2">{r.masterPartName}</td>
                    <td className="p-2">{r.machineName}</td>
                    <td className="p-2">{r.acceptedQuantity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
