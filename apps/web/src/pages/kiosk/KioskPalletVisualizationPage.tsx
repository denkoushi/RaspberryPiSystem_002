import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  clearKioskPalletVisualizationPallet,
  deleteKioskPalletVisualizationItem,
  getKioskPalletVisualizationBoard,
  getResolvedClientKey,
  postKioskPalletVisualizationItem,
  postKioskPalletVisualizationItemReplace,
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';
import { useKeyboardWedgeScan } from '../../features/barcode-scan/useKeyboardWedgeScan';

const LS_SELECTED_MACHINE = 'pallet-visualization-selected-machine-cd';

export function KioskPalletVisualizationPage() {
  const clientKey = getResolvedClientKey();
  const queryClient = useQueryClient();
  const boardQuery = useQuery({
    queryKey: ['kiosk-pallet-viz-board', clientKey],
    queryFn: () => getKioskPalletVisualizationBoard(clientKey),
    refetchInterval: 15_000,
  });

  const machines = useMemo(() => boardQuery.data?.machines ?? [], [boardQuery.data?.machines]);
  const [selectedCd, setSelectedCd] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(LS_SELECTED_MACHINE) ?? '';
  });
  const [palletNo, setPalletNo] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (machines.length === 0) return;
    const exists = machines.some((m) => m.machineCd === selectedCd);
    if (!selectedCd || !exists) {
      const next = machines[0]?.machineCd ?? '';
      setSelectedCd(next);
      if (typeof window !== 'undefined' && next) {
        window.localStorage.setItem(LS_SELECTED_MACHINE, next);
      }
    }
  }, [machines, selectedCd]);

  const selectMachine = useCallback((cd: string) => {
    setSelectedCd(cd);
    setSelectedItemId(null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LS_SELECTED_MACHINE, cd);
    }
  }, []);

  const currentMachine = useMemo(
    () => machines.find((m) => m.machineCd === selectedCd),
    [machines, selectedCd]
  );

  const currentPallet = useMemo(
    () => currentMachine?.pallets.find((p) => p.palletNo === palletNo),
    [currentMachine, palletNo]
  );

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['kiosk-pallet-viz-board', clientKey] });

  const addMutation = useMutation({
    mutationFn: (barcode: string) =>
      postKioskPalletVisualizationItem(
        { machineCd: selectedCd, palletNo, manufacturingOrderBarcodeRaw: barcode },
        clientKey
      ),
    onSuccess: () => {
      void invalidate();
    },
  });

  const replaceMutation = useMutation({
    mutationFn: ({ itemId, barcode }: { itemId: string; barcode: string }) =>
      postKioskPalletVisualizationItemReplace(itemId, { manufacturingOrderBarcodeRaw: barcode }, clientKey),
    onSuccess: () => {
      setSelectedItemId(null);
      void invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteKioskPalletVisualizationItem(itemId, clientKey),
    onSuccess: () => {
      setSelectedItemId(null);
      void invalidate();
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearKioskPalletVisualizationPallet(selectedCd, palletNo, clientKey),
    onSuccess: () => {
      void invalidate();
    },
  });

  const applyBarcode = useCallback(
    (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (selectedItemId) {
        replaceMutation.mutate({ itemId: selectedItemId, barcode });
      } else {
        addMutation.mutate(barcode);
      }
    },
    [selectedItemId, addMutation, replaceMutation]
  );

  const handleScanSuccess = useCallback(
    (text: string) => {
      setScanOpen(false);
      applyBarcode(text);
    },
    [applyBarcode]
  );

  const busy =
    addMutation.isPending ||
    replaceMutation.isPending ||
    deleteMutation.isPending ||
    clearMutation.isPending;

  useKeyboardWedgeScan({
    active: !scanOpen && !busy && Boolean(selectedCd),
    onScan: applyBarcode,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 text-white">
      <BarcodeScanModal
        open={scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={handleScanSuccess}
        onAbort={() => setScanOpen(false)}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-emerald-200">パレット可視化</h1>
        {boardQuery.isError ? (
          <span className="text-sm text-red-300">読み込みに失敗しました</span>
        ) : boardQuery.isFetching ? (
          <span className="text-sm text-white/60">更新中…</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
        <aside className="flex max-h-48 min-h-0 w-full shrink-0 flex-col gap-2 overflow-y-auto overscroll-y-contain rounded-lg bg-slate-900/80 p-2 lg:max-h-none lg:w-56">
          <p className="shrink-0 text-xs font-semibold text-white/60">加工機（資源CD順）</p>
          {machines.map((m) => (
            <button
              key={m.machineCd}
              type="button"
              onClick={() => selectMachine(m.machineCd)}
              className={`shrink-0 rounded-md px-2 py-2 text-left text-sm font-semibold transition-colors ${
                m.machineCd === selectedCd ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white/90 hover:bg-slate-700'
              }`}
            >
              <div className="truncate">{m.machineName}</div>
              <div className="font-mono text-xs text-white/70">{m.machineCd}</div>
            </button>
          ))}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-lg bg-slate-900/60 p-3">
          {currentMachine ? (
            <>
              <div className="flex shrink-0 flex-wrap items-start gap-3">
                {currentMachine.illustrationUrl ? (
                  <img
                    src={currentMachine.illustrationUrl}
                    alt=""
                    className="h-28 max-w-xs rounded-md border border-white/10 object-contain"
                  />
                ) : (
                  <div className="flex h-28 w-40 items-center justify-center rounded-md border border-dashed border-white/20 text-xs text-white/50">
                    イラスト未設定
                  </div>
                )}
                <div>
                  <p className="text-xl font-bold">{currentMachine.machineName}</p>
                  <p className="font-mono text-sm text-white/70">{currentMachine.machineCd}</p>
                  <p className="mt-2 text-sm text-white/80">
                    パレット <span className="font-mono font-bold text-amber-200">{palletNo}</span> を選択中
                  </p>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-10 gap-2">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setPalletNo(n);
                      setSelectedItemId(null);
                    }}
                    className={`rounded-lg py-3 text-center leading-none ${
                      palletNo === n ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                  >
                    <span className="text-[1.75rem] font-bold tabular-nums">{n}</span>
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy || !selectedCd}
                    onClick={() => {
                      setScanOpen(true);
                    }}
                  >
                    追加（製造orderスキャン）
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || !selectedItemId}
                    onClick={() => {
                      setScanOpen(true);
                    }}
                  >
                    上書き（部品選択＋スキャン）
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || !selectedItemId}
                    onClick={() => selectedItemId && deleteMutation.mutate(selectedItemId)}
                  >
                    選択部品を削除
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => clearMutation.mutate()}
                    className="text-red-200 hover:text-red-100"
                  >
                    このパレットを全消し
                  </Button>
                </div>
                <p className="text-xs text-white/45">
                  USB ハンディ（キーボードウェッジ）はカメラを開かずに読取できます。部品を選択中ならスキャン値は上書きに使われます。
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-md bg-slate-950/50 p-2">
                <p className="mb-2 text-xs text-white/50">
                  上書き・削除する部品をタップして選択してください（確認ダイアログはありません）。
                </p>
                <ul className="space-y-2">
                  {(currentPallet?.items ?? []).map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedItemId(it.id === selectedItemId ? null : it.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          it.id === selectedItemId
                            ? 'border-amber-400 bg-amber-500/20'
                            : 'border-white/10 bg-slate-800/80 hover:border-white/30'
                        }`}
                      >
                        <div className="font-mono text-xs text-white/60">{it.fhincd}</div>
                        <div className="font-semibold">{it.fhinmei}</div>
                        <div className="text-xs text-white/70">
                          製番 {it.fseiban}
                          {it.machineName ? ` ／ ${it.machineName}` : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                  {(currentPallet?.items ?? []).length === 0 ? (
                    <li className="text-sm text-white/50">このパレットに部品はありません</li>
                  ) : null}
                </ul>
              </div>

              {(addMutation.error || replaceMutation.error) && (
                <p className="shrink-0 text-sm text-red-300">
                  {(addMutation.error as Error)?.message ?? (replaceMutation.error as Error)?.message ?? 'エラーが発生しました'}
                </p>
              )}
            </>
          ) : (
            <p className="text-white/60">加工機データを読み込めませんでした</p>
          )}
        </main>
      </div>
    </div>
  );
}
