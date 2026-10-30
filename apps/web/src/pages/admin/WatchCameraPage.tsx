import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { getWatchCameraImage, listWatchCameraFrames, type WatchCameraFrame } from '../../api/domains/watch-camera';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useAuth } from '../../contexts/AuthContext';

function CameraImage({ id, variant }: { id: string; variant: 'thumb' | 'full' }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    void getWatchCameraImage(id, variant).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => { /* Missing images use the same empty cell. */ });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, variant]);
  return url ? <img src={url} alt="監視カメラ"
    className={variant === 'full' ? 'max-h-[70dvh] w-full object-contain' : 'h-40 w-full rounded object-contain'} /> : <span>—</span>;
}

const time = (value: string) => new Date(value).toLocaleTimeString('ja-JP', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function WatchCameraContent() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  const [selected, setSelected] = useState<WatchCameraFrame | null>(null);
  const { data, isError } = useQuery({
    queryKey: ['watch-camera', date], queryFn: () => listWatchCameraFrames({ date }), enabled: Boolean(date)
  });
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold text-slate-900">監視カメラ</h1>
    <input type="date" aria-label="日付" value={date} onChange={(event) => { setDate(event.target.value); setSelected(null); }}
      className="rounded border border-slate-400 bg-white px-3 py-2 text-slate-900" />
    {isError && <p role="alert" className="text-red-600">写真を取得できませんでした</p>}
    <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-900 sm:grid-cols-3 lg:grid-cols-4">
      {data?.map((frame) => <div key={frame.id} className="min-w-0 space-y-1">
        <button type="button" aria-label={`${frame.deviceName} ${time(frame.capturedAt)}を拡大`}
          className="flex h-40 w-full items-center justify-center rounded bg-slate-100" onClick={() => setSelected(frame)}>
          <CameraImage id={frame.id} variant="thumb" />
        </button>
        <time dateTime={frame.capturedAt} className="block">{time(frame.capturedAt)}</time>
        <div className="break-words">{frame.deviceName}</div>
        {frame.judgement === 'unjudged' && <div className="text-xs text-slate-500">未判定</div>}
      </div>)}
    </div>
    <Dialog isOpen={selected !== null} onClose={() => setSelected(null)} ariaLabel="監視カメラ" size="full">
      {selected && <>
        <div className="mb-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setSelected(null)}>閉じる</Button>
        </div>
        <CameraImage id={selected.id} variant="full" />
      </>}
    </Dialog>
  </div>;
}

export function WatchCameraPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'ADMIN') return <Navigate to="/admin" replace />;
  return <WatchCameraContent />;
}
