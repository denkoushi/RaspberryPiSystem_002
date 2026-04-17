import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api/client';
import { useSignageScheduleEditorClients } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { buildSignageCurrentImageUrlSearchParams } from '../../lib/signage/buildSignageCurrentImageUrl';
import { listSignageDisplayClientDevicesSorted } from '../../lib/signageTargetClientDevices';

function formatClientLabel(name: string, location: string | null | undefined): string {
  return location && location.trim() !== '' ? `${name}（${location}）` : name;
}

export function SignagePreviewPage() {
  const clientsQuery = useSignageScheduleEditorClients();
  const candidates = useMemo(
    () => listSignageDisplayClientDevicesSorted(clientsQuery.data ?? []),
    [clientsQuery.data]
  );

  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const latestFetchIdRef = useRef(0);

  const fetchImage = useCallback(async (clientKey: string) => {
    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    try {
      setIsImageLoading(true);
      setError(null);

      const response = await api.get('/signage/current-image', {
        responseType: 'blob',
        params: buildSignageCurrentImageUrlSearchParams({
          clientKey,
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
    if (selectedClientKey && !candidates.some((c) => c.apiKey === selectedClientKey)) {
      setSelectedClientKey(null);
    }
  }, [candidates, selectedClientKey]);

  useEffect(() => {
    latestFetchIdRef.current += 1;
    if (!selectedClientKey) {
      setImageUrl(null);
      setError(null);
      setIsImageLoading(false);
      return;
    }

    setImageUrl(null);
    void fetchImage(selectedClientKey);
    const interval = setInterval(() => {
      void fetchImage(selectedClientKey);
    }, 30000);
    return () => {
      clearInterval(interval);
    };
  }, [selectedClientKey, fetchImage]);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  const isClientsLoading = clientsQuery.isLoading;
  const canRefresh = Boolean(selectedClientKey) && !isImageLoading;

  return (
    <Card title="サイネージプレビュー">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <label htmlFor="signage-preview-client" className="text-sm font-semibold text-slate-800">
              プレビューする端末
            </label>
            <select
              id="signage-preview-client"
              className="w-full max-w-md rounded-md border-2 border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
              disabled={isClientsLoading || candidates.length === 0}
              value={selectedClientKey ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedClientKey(v.length > 0 ? v : null);
              }}
            >
              <option value="">端末を選択してください</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.apiKey}>
                  {formatClientLabel(c.name, c.location)}
                </option>
              ))}
            </select>
            <p className="text-sm text-slate-600">
              登録済みサイネージ端末（apiKey に &quot;signage&quot; を含む）ごとのレンダ結果を表示します。30秒ごとに自動更新します。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (selectedClientKey) {
                void fetchImage(selectedClientKey);
              }
            }}
            disabled={!canRefresh}
            className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-400 transition-colors"
          >
            {isImageLoading ? '読み込み中...' : '更新'}
          </button>
        </div>

        {isClientsLoading && (
          <p className="text-sm text-slate-500">端末一覧を読み込んでいます...</p>
        )}

        {!isClientsLoading && candidates.length === 0 && (
          <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">サイネージ用の端末が見つかりません</p>
            <p className="mt-1 text-sm">
              apiKey に &quot;signage&quot; を含む端末を登録してください（例: …-android-signage-…）。クライアント登録後に再度開いてください。
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-red-800">
            <p className="font-semibold">エラー</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!selectedClientKey && !isClientsLoading && candidates.length > 0 && (
          <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-12">
            <p className="text-slate-600">上の一覧から端末を選ぶと、その端末向けに生成された画像が表示されます。</p>
          </div>
        )}

        {selectedClientKey && isImageLoading && !imageUrl && (
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
    </Card>
  );
}
