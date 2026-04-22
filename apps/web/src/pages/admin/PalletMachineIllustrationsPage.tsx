import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  deleteToolsPalletVisualizationIllustration,
  getToolsPalletVisualizationBoard,
  postToolsPalletVisualizationIllustration,
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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

  const machines = boardQuery.data?.machines ?? [];

  return (
    <div className="space-y-6">
      <Card title="パレット可視化・加工機イラスト">
        <p className="text-sm text-slate-600">
          資源マスタに登録された加工機ごとに PNG/JPEG イラストを登録します。キオスク・サイネージの可視化に表示されます。
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
          <Card key={m.machineCd} title={`${m.machineName} (${m.machineCd})`}>
            <div className="space-y-3">
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
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploadMutation.isPending}
                  onClick={() => {
                    setPendingMachineCd(m.machineCd);
                    requestAnimationFrame(() => fileRef.current?.click());
                  }}
                >
                  画像を選択してアップロード
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!m.illustrationUrl || deleteMutation.isPending}
                  onClick={() => {
                    if (confirm(`${m.machineName} のイラストを削除しますか？`)) {
                      deleteMutation.mutate(m.machineCd);
                    }
                  }}
                >
                  削除
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
