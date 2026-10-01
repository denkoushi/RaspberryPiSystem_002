import { useEffect, useState } from 'react';

import { api } from '../../../api/http';
import { buildSignageCurrentImageUrlSearchParams } from '../../../lib/signage/buildSignageCurrentImageUrl';

/**
 * 端末に配信されている最新画像（current-image）を定期取得して object URL で返す。
 * 管理画面からの取得は JWT 付きなので、サーバー側で「端末の受信」としては数えられない。
 */
export function useSignageClientImage(clientKey: string | null, refreshMs = 30_000, refreshToken = 0) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientKey) {
      setImageUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let currentUrl: string | null = null;

    const load = async () => {
      try {
        const response = await api.get('/signage/current-image', {
          responseType: 'blob',
          params: buildSignageCurrentImageUrlSearchParams({ clientKey, cacheBust: Date.now() }),
        });
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(response.data as Blob);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        setImageUrl(nextUrl);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '画像を取得できません');
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [clientKey, refreshMs, refreshToken]);

  return { imageUrl, error };
}
