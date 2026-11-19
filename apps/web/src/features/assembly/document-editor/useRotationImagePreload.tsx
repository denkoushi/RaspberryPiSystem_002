import { useCallback, useEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../../hooks/useProtectedImageBlobUrl';

import type { AssemblyProcedureOverlayAssetDto } from '../types';

function RotationImagePreload({ source, onSettled }: { source: string; onSettled: (source: string) => void }) {
  const { blobUrl, error } = useProtectedImageBlobUrl(source);
  useEffect(() => {
    if (!blobUrl && !error) return;
    let cancelled = false;
    const decode = async () => {
      try {
        if (blobUrl) {
          const image = new Image();
          image.src = blobUrl;
          await image.decode();
        }
      } catch {
        // The rotation can still be committed if the browser cannot decode the result.
      } finally {
        if (!cancelled) onSettled(source);
      }
    };
    void decode();
    return () => { cancelled = true; };
  }, [blobUrl, error, onSettled, source]);
  return null;
}

export function useRotationImagePreload(busy: boolean) {
  const [request, setRequest] = useState<{ sources: string[]; onSettled: (source: string) => void } | null>(null);
  const finish = useRef<(() => void) | null>(null);
  useEffect(() => () => finish.current?.(), []);
  useEffect(() => {
    if (!busy) setRequest(null);
  }, [busy]);

  const preload = useCallback((assets: AssemblyProcedureOverlayAssetDto[]) => new Promise<void>(resolve => {
    const pending = new Set(assets.map(asset =>
      asset.url ?? asset.relativeUrl ?? `/api/storage/assembly-procedure-assets/${encodeURIComponent(asset.assetId)}`));
    if (!pending.size) {
      resolve();
      return;
    }
    finish.current = resolve;
    setRequest({
      sources: [...pending],
      onSettled: source => {
        pending.delete(source);
        if (!pending.size) {
          finish.current = null;
          resolve();
        }
      }
    });
  }), []);

  // Keep these cache consumers mounted through the canvas asset swap.
  const preloader = request?.sources.map(source =>
    <RotationImagePreload key={source} source={source} onSettled={request.onSettled} />);
  return { preload, preloader };
}
