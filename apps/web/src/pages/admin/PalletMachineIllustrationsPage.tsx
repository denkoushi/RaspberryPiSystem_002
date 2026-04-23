import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { PalletVisualizationBoardResponseDto } from '../../api/client';
import {
  deleteToolsPalletVisualizationIllustration,
  getToolsPalletVisualizationBoard,
  patchToolsPalletMachinePalletCount,
  postToolsPalletVisualizationIllustration,
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

/** API MAX_MACHINE_PALLET_COUNT と同値 */
const MAX_ADMIN_PALLET_COUNT = 60;

export function PalletMachineIllustrationsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingMachineCd, setPendingMachineCd] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['tools-pallet-viz-board'],
    queryFn: () => getToolsPalletVisualizationBoard(),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ machineCd, file }: { machineCd: string; file: File }) =>
      postToolsPalletVisualizationIllustration(machineCd, file),
    onSuccess: () => {
      setMessage('アップロードしました');
      void queryClient.invalidateQueries({ queryKey: ['tools-pallet-viz-board'] });
      setPendingMachineCd(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: () => setMessage('アップロードに失敗しました'),
  });

  const deleteMutation = useMutation({
    mutationFn: (machineCd: string) => deleteToolsPalletVisualizationIllustration(machineCd),
    onSuccess: () => {
      setMessage('削除しました');
      void queryClient.invalidateQueries({ queryKey: ['tools-pallet-viz-board'] });
    },
    onError: () => setMessage('削除に失敗しました'),
  });

  const patchPalletCountMutation = useMutation({
    mutationFn: ({ machineCd, palletCount }: { machineCd: string; palletCount: number }) =>
      patchToolsPalletMachinePalletCount(machineCd, palletCount),
    onSuccess: () => {
      setMessage('パレット台数を保存しました');
      void queryClient.invalidateQueries({ queryKey: ['tools-pallet-viz-board'] });
    },
    onError: () => setMessage('台数の保存に失敗しました'),
  });

  const machines = boardQuery.data?.machines ?? [];

  return (
    <div className="space-y-6">
      <Card title="パレット可視化・加工機イラスト">
        <p className="text-sm text-slate-600">
          資源マスタに登録された加工機ごとにパレット台数（既定10）と PNG/JPEG イラストを設定します。キオスク・サイネージの可視化に表示されます。
        </p>
      </Card>

      {message ? <p className="text-sm font-semibold text-emerald-700">{message}</p> : null}

      {boardQuery.isLoading ? <p className="text-sm text-slate-600">読み込み中…</p> : null}
      {boardQuery.isError ? <p className="text-sm text-rose-600">一覧の取得に失敗しました</p> : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const cd = pendingMachineCd;
          if (f && cd) {
            uploadMutation.mutate({ machineCd: cd, file: f });
          }
          e.target.value = '';
        }}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => (
          <PalletMachineCard
            key={m.machineCd}
            machine={m}
            onPatchPalletCount={(palletCount) => patchPalletCountMutation.mutate({ machineCd: m.machineCd, palletCount })}
            patchPalletCountBusy={patchPalletCountMutation.isPending}
            uploadPending={uploadMutation.isPending}
            deletePending={deleteMutation.isPending}
            onPickUpload={() => {
              setPendingMachineCd(m.machineCd);
              requestAnimationFrame(() => fileRef.current?.click());
            }}
            onDeleteIllustration={() => {
              if (confirm(`${m.machineName} のイラストを削除しますか？`)) {
                deleteMutation.mutate(m.machineCd);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PalletMachineCard(props: {
  machine: PalletVisualizationBoardResponseDto['machines'][number];
  onPatchPalletCount: (palletCount: number) => void;
  patchPalletCountBusy: boolean;
  uploadPending: boolean;
  deletePending: boolean;
  onPickUpload: () => void;
  onDeleteIllustration: () => void;
}) {
  const { machine: m, onPatchPalletCount, patchPalletCountBusy, uploadPending, deletePending, onPickUpload, onDeleteIllustration } = props;
  const [palletCountDraft, setPalletCountDraft] = useState(String(m.palletCount));

  useEffect(() => {
    setPalletCountDraft(String(m.palletCount));
  }, [m.palletCount, m.machineCd]);

  return (
          <Card title={`${m.machineName} (${m.machineCd})`}>
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="font-semibold">パレット台数</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={MAX_ADMIN_PALLET_COUNT}
                    className="w-24 rounded-md border-2 border-slate-500 px-2 py-1 text-slate-900"
                    value={palletCountDraft}
                    onChange={(e) => setPalletCountDraft(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={patchPalletCountBusy}
                    onClick={() => {
                      const n = Number.parseInt(palletCountDraft, 10);
                      if (!Number.isInteger(n) || n < 1 || n > MAX_ADMIN_PALLET_COUNT) {
                        return;
                      }
                      onPatchPalletCount(n);
                    }}
                  >
                    台数を保存
                  </Button>
                </div>
                <span className="text-xs text-slate-500">1〜{MAX_ADMIN_PALLET_COUNT}。台数を下げる際は、高番号パレットに部品登録が無い必要があります。</span>
              </label>

              {m.illustrationUrl ? (
                <img
                  src={m.illustrationUrl}
                  alt=""
                  className="max-h-40 w-full rounded-md border border-slate-200 object-contain"
                />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-500">
                  未設定
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={uploadPending} onClick={onPickUpload}>
                  画像を選択してアップロード
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!m.illustrationUrl || deletePending}
                  onClick={onDeleteIllustration}
                >
                  削除
                </Button>
              </div>
            </div>
          </Card>
  );
}
