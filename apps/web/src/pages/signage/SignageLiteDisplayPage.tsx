import { useEffect, useMemo, useState } from 'react';

import { getSignageCurrentImageUrl } from '../../api/client';
import { resolveClientKey } from '../../lib/client-key';

/** サーバ側 `SIGNAGE_RENDER_INTERVAL_SECONDS`（既定30s）に揃え、型落ち端末の負荷を抑える */
const POLL_INTERVAL_MS = 30_000;

/**
 * 型落ち Android タブレット等向けの軽量サイネージ表示。
 * - サーバ生成 JPEG のみ表示（React の重い `/signage` を使わない）
 * - 端末識別は `?clientKey=client-key-...` 推奨（初回に localStorage へ保存される）
 */
export function SignageLiteDisplayPage() {
  const [tick, setTick] = useState(0);
  const [clientKey, setClientKey] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const { key } = resolveClientKey({ allowDefaultFallback: false });
    setClientKey(key);
  }, []);

  const imageSrc = useMemo(
    () =>
      getSignageCurrentImageUrl(tick, {
        clientKey,
        allowDefaultFallback: false,
      }),
    [clientKey, tick]
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {loadError ? (
        <div
          className="absolute left-0 right-0 top-0 z-10 border-b border-amber-600/50 bg-amber-950/90 px-3 py-2 text-center text-sm font-semibold text-amber-100"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}
      {clientKey.length === 0 ? (
        <div className="flex h-full w-full flex-1 items-center justify-center px-4 text-center text-base font-semibold text-amber-100">
          clientKey が未設定です。URL に `?clientKey=client-key-...` を付けてアクセスしてください。
        </div>
      ) : (
        <img
          src={imageSrc}
          alt=""
          className="h-full w-full flex-1 object-contain"
          onLoad={() => setLoadError(null)}
          onError={() =>
            setLoadError('画像を取得できません。clientKey の登録・URL の clientKey 指定・ネットワークを確認してください。')
          }
        />
      )}
    </div>
  );
}
