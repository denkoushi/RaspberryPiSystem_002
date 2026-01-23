import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { Card } from '../../components/ui/Card';

export function SignagePreviewPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'signage-preview',hypothesisId:'H1',location:'apps/web/src/pages/admin/SignagePreviewPage.tsx:9',message:'SignagePreviewPage mounted',data:{hasAxiosAuthHeader:Boolean(api?.defaults?.headers?.common?.Authorization),pathname:typeof window!=='undefined'?window.location.pathname:null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const fetchImage = async (trigger: 'mount' | 'interval' | 'manual') => {
    try {
      setIsLoading(true);
      setError(null);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'signage-preview',hypothesisId:'H1',location:'apps/web/src/pages/admin/SignagePreviewPage.tsx:fetchImage',message:'fetchImage start',data:{trigger,hasAxiosAuthHeader:Boolean(api?.defaults?.headers?.common?.Authorization)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // 管理コンソールはJWT(Authorizationヘッダー)認証のため、axiosクライアントを使用してBlob取得する
      const response = await api.get('/signage/current-image', { responseType: 'blob' });
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'signage-preview',hypothesisId:'H1',location:'apps/web/src/pages/admin/SignagePreviewPage.tsx:fetchImage',message:'fetchImage success',data:{trigger,blobType:blob.type||null,blobSize:blob.size||null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      setImageUrl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : '画像の取得に失敗しました';
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'signage-preview',hypothesisId:'H2',location:'apps/web/src/pages/admin/SignagePreviewPage.tsx:fetchImage',message:'fetchImage error',data:{trigger,errorMessage:message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImage('mount');
    // 30秒ごとに自動更新（サイネージの更新間隔に合わせる）
    const interval = setInterval(() => fetchImage('interval'), 30000);
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
            onClick={() => fetchImage('manual')}
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
