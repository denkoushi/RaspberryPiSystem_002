import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { Card } from '../../components/ui/Card';

export function SignagePreviewPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchImage = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 管理コンソールはJWT(Authorizationヘッダー)認証のため、axiosクライアントを使用してBlob取得する
      const response = await api.get('/signage/current-image', { responseType: 'blob' });
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);
      setImageUrl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : '画像の取得に失敗しました';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImage();
    // 30秒ごとに自動更新（サイネージの更新間隔に合わせる）
    const interval = setInterval(fetchImage, 30000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  return (
    <Card title="サイネージプレビュー">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Pi3で表示中のサイネージ画像をプレビューします（30秒ごとに自動更新）
          </p>
          <button
            onClick={fetchImage}
            disabled={isLoading}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-400 transition-colors"
          >
            {isLoading ? '読み込み中...' : '更新'}
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-red-800">
            <p className="font-semibold">エラー</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {isLoading && !imageUrl && (
          <div className="flex items-center justify-center py-12">
            <p className="text-slate-500">画像を読み込んでいます...</p>
          </div>
        )}

        {imageUrl && (
          <div className="rounded-lg border-2 border-slate-300 bg-slate-100 p-4">
            <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
              <img
                src={imageUrl}
                alt="サイネージプレビュー"
                className="h-full w-full object-contain"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              解像度: 1920x1080（Full HD）想定
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
