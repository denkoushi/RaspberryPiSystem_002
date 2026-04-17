import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getKioskSignagePreviewOptions, putKioskSignagePreviewSelection } from '../../api/client';
import { buildSignageCurrentImageUrlSearchParams } from '../../lib/signage/buildSignageCurrentImageUrl';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

type KioskSignagePreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** このキオスク端末の apiKey（未設定時プレビューや表示ラベルに使用） */
  kioskClientKey: string;
};

function formatClientLabel(name: string, location: string | null | undefined): string {
  return location && location.trim() !== '' ? `${name}（${location}）` : name;
}

export function KioskSignagePreviewModal({ isOpen, onClose, kioskClientKey }: KioskSignagePreviewModalProps) {
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const latestFetchIdRef = useRef(0);

  const optionsQuery = useQuery({
    queryKey: ['kiosk-signage-preview-options'],
    queryFn: getKioskSignagePreviewOptions,
    enabled: isOpen,
    staleTime: 0,
  });

  const selectionMutation = useMutation({
    mutationFn: putKioskSignagePreviewSelection,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-signage-preview-options'] });
    },
  });

  const options = optionsQuery.data;
  const effectivePreviewApiKey = options?.effectivePreviewApiKey ?? kioskClientKey;
  const selectedApiKey = options?.selectedApiKey ?? null;
  const candidates = options?.candidates ?? [];

  const fetchImage = useCallback(async (previewTargetApiKey: string) => {
    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    try {
      setIsImageLoading(true);
      setError(null);
      const response = await api.get('/signage/current-image', {
        responseType: 'blob',
        params: buildSignageCurrentImageUrlSearchParams({
          clientKey: previewTargetApiKey,
          cacheBust: Date.now(),
        }),
      });
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);
      if (latestFetchIdRef.current !== fetchId) {
        URL.revokeObjectURL(url);
        return;
      }
      setImageUrl(url);
    } catch (err) {
      if (latestFetchIdRef.current !== fetchId) {
        return;
      }
      const message = err instanceof Error ? err.message : '画像の取得に失敗しました';
      setError(message);
    } finally {
      if (latestFetchIdRef.current === fetchId) {
        setIsImageLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      latestFetchIdRef.current += 1;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setImageUrl(null);
      setError(null);
      setIsImageLoading(false);
      return;
    }

    if (optionsQuery.isLoading || !options) {
      return undefined;
    }

    setImageUrl(null);
    void fetchImage(effectivePreviewApiKey);
    intervalRef.current = setInterval(() => {
      void fetchImage(effectivePreviewApiKey);
    }, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, options, optionsQuery.isLoading, effectivePreviewApiKey, fetchImage]);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const handleClose = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
    onClose();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const target = previewContainerRef.current;
    if (target?.requestFullscreen) {
      await target.requestFullscreen();
    }
  };

  const handleSelectChange = async (value: string) => {
    const next = value.length > 0 ? value : null;
    try {
      setError(null);
      await selectionMutation.mutateAsync({ signagePreviewTargetApiKey: next });
    } catch (err) {
      const message = err instanceof Error ? err.message : '設定の保存に失敗しました';
      setError(message);
    }
  };

  const isOptionsLoading = optionsQuery.isLoading;
  const isSelectBusy = selectionMutation.isPending;
  const canRefresh = !isImageLoading && !isOptionsLoading && Boolean(options);
  const selectionError =
    optionsQuery.isError
      ? optionsQuery.error instanceof Error
        ? optionsQuery.error.message
        : '端末一覧の取得に失敗しました'
      : null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel="サイネージプレビュー"
      size="full"
      closeOnEsc={!isFullscreen}
      className="flex flex-col"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">サイネージプレビュー</h2>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={toggleFullscreen}>
            {isFullscreen ? '全画面解除' : '全画面'}
          </Button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="閉じる"
            title="閉じる"
            className="text-slate-500 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      </div>
      <div ref={previewContainerRef} className="flex-1 overflow-y-auto space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2 min-w-0 flex-1">
            <label htmlFor="kiosk-signage-preview-target" className="text-sm font-semibold text-slate-800">
              プレビューするサイネージ端末
            </label>
            <select
              id="kiosk-signage-preview-target"
              className="w-full max-w-md rounded-md border-2 border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
              disabled={isOptionsLoading || isSelectBusy}
              value={selectedApiKey ?? ''}
              onChange={(e) => void handleSelectChange(e.target.value)}
            >
              <option value="">自端末のAPIキーでプレビュー（デフォルト）</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.apiKey}>
                  {formatClientLabel(c.name, c.location)}
                </option>
              ))}
            </select>
            <p className="text-sm text-slate-600">
              登録済みサイネージ端末（apiKey に &quot;signage&quot; を含む）向けのレンダ結果を表示します。選択はこのキオスク端末に保存され、30秒ごとに自動更新します。
            </p>
          </div>
          <Button
            type="button"
            onClick={() => void fetchImage(effectivePreviewApiKey)}
            disabled={!canRefresh}
            className="bg-emerald-600 text-white hover:bg-emerald-500 shrink-0"
          >
            {isImageLoading ? '読み込み中...' : '更新'}
          </Button>
        </div>

        {selectionError && (
          <div className="rounded-md bg-red-50 p-4 text-red-800">
            <p className="font-semibold">エラー</p>
            <p className="text-sm">{selectionError}</p>
          </div>
        )}

        {!isOptionsLoading && candidates.length === 0 && (
          <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">サイネージ用の端末が見つかりません</p>
            <p className="mt-1 text-sm">
              apiKey に &quot;signage&quot; を含む端末を登録してください。未登録の間は、このキオスクのAPIキー（
              <span className="font-mono">{kioskClientKey.slice(0, 12)}…</span>
              ）向けのキャッシュを参照します。
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-red-800">
            <p className="font-semibold">エラー</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {isOptionsLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-slate-500">設定を読み込んでいます...</p>
          </div>
        )}

        {isImageLoading && !imageUrl && options && (
          <div className="flex items-center justify-center py-12">
            <p className="text-slate-500">画像を読み込んでいます...</p>
          </div>
        )}

        {imageUrl && (
          <div className="rounded-lg border-2 border-slate-300 bg-slate-100 p-4">
            <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
              <img src={imageUrl} alt="サイネージプレビュー" className="h-full w-full object-contain" />
            </div>
            <p className="mt-2 text-xs text-slate-500">解像度: 1920x1080（Full HD）想定</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
