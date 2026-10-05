import { useEffect, useState } from 'react';

import { getProcedureVideoFile } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedureVideoPlaybackDialog({ video, onClose }: { video: ProcedureVideoSummaryDto; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setUrl(null); setError(null);
    // Header authentication cannot be attached by a native video src. Seeking
    // works locally in this authenticated Blob; no tokens appear in the URL.
    void getProcedureVideoFile(video.id, abort.signal).then((blob) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((e: unknown) => { if (!abort.signal.aborted) setError(readAssemblyApiErrorMessage(e, '動画を取得できません')); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [video.id]);
  return <Dialog isOpen onClose={onClose} title={video.title} size="lg">
    {error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : url
      ? <video aria-label={video.title} controls playsInline muted preload="metadata" src={url} className="mt-3 max-h-[65dvh] w-full bg-black" />
      : <p role="status" className="mt-3">動画を読込中…</p>}
    <Button className="mt-3 min-h-11" onClick={onClose}>閉じる</Button>
  </Dialog>;
}
