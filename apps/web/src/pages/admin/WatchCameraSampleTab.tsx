import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { deleteSampleSession, getSampleImage, labelSampleFrame, listSampleCameras, listSampleFrames, listSampleSessions,
  startSampleSession, stopSampleSession, type SampleFilter, type SampleFrame, type SampleLabel } from '../../api/domains/watch-camera';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

const intervals = [[10, '10秒'], [30, '30秒'], [60, '1分'], [300, '5分']] as const;
const durations = [[300, '5分'], [3600, '1時間'], [86400, '24時間'], [604800, '1週間']] as const;
const filters: [SampleFilter, string][] = [['all', 'すべて'], ['none', '未選択'], ['ok', '正常'], ['ng', '異常'], ['later', 'あとで見る']];
const labels: [SampleLabel, string][] = [['ok', '正常'], ['ng', '異常'], ['later', 'あとで']];
const colors = { ok: 'border-green-700 bg-green-100 text-green-800', ng: 'border-red-700 bg-red-100 text-red-800', later: 'border-yellow-700 bg-yellow-100 text-yellow-800' };
const panel = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4';
const chip = (active: boolean) => `rounded-full border px-3 py-1.5 text-sm ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-900'}`;
const formatDuration = (seconds: number) => seconds >= 86400 ? `${Math.round(seconds / 8640) / 10}日`
  : seconds >= 3600 ? `${Math.round(seconds / 360) / 10}時間` : `${Math.round(seconds / 60)}分`;

function SampleImage({ id, variant }: { id: string; variant: 'full' | 'thumb' }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    void getSampleImage(id, variant).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => { /* Missing images use an empty cell. */ });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, variant]);
  return url ? <img src={url} alt="見本" className={variant === 'full' ? 'max-h-[70dvh] w-full object-contain' : 'h-[90px] w-full rounded object-contain'} /> : <span>—</span>;
}

export function WatchCameraSampleTab() {
  const client = useQueryClient();
  const [camera, setCamera] = useState('');
  const [intervalSec, setIntervalSec] = useState(10);
  const [durationSec, setDurationSec] = useState(300);
  const [maxFrames, setMaxFrames] = useState('2000');
  const [filter, setFilter] = useState<SampleFilter>('all');
  const [armedId, setArmedId] = useState<string>();
  const [selected, setSelected] = useState<SampleFrame | null>(null);
  const cameras = useQuery({ queryKey: ['watch-camera-samples', 'cameras'], queryFn: listSampleCameras });
  const deviceId = camera || cameras.data?.[0]?.id || '';
  const sessions = useQuery({ queryKey: ['watch-camera-samples', 'sessions', deviceId],
    queryFn: () => listSampleSessions(deviceId), enabled: Boolean(deviceId), refetchInterval: 3000 });
  const session = sessions.data?.[0];
  const running = session?.status === 'running';
  const sessionId = session?.id;
  const frames = useQuery({ queryKey: ['watch-camera-samples', 'frames', sessionId, filter, session?.frameCount],
    queryFn: () => listSampleFrames(sessionId!, filter), enabled: Boolean(sessionId), refetchInterval: running ? 3000 : false });
  const refresh = () => client.invalidateQueries({ queryKey: ['watch-camera-samples'] });
  const start = useMutation({ mutationFn: () => startSampleSession({ clientDeviceId: deviceId, intervalSec, durationSec, maxFrames: Number(maxFrames) }),
    onSuccess: () => { setFilter('all'); setArmedId(undefined); void refresh(); } });
  const stop = useMutation({ mutationFn: (id: string) => stopSampleSession(id), onSuccess: refresh });
  const mark = useMutation({ mutationFn: ({ id, label }: { id: string; label: SampleLabel | null }) => labelSampleFrame(id, label), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteSampleSession(id),
    onSuccess: () => { setArmedId(undefined); setSelected(null); void refresh(); } });
  const cap = Number(maxFrames) || 0;
  const validCap = Number.isInteger(cap) && cap >= 10 && cap <= 20000;
  const expected = Math.floor(durationSec / intervalSec);
  const count = Math.min(expected, Math.max(0, cap));
  const mb = Math.round(count * 0.035 * 10) / 10;
  const remaining = session ? Math.max(0, Math.min((new Date(session.endsAt).getTime() - Date.now()) / 1000,
    (session.maxFrames - session.frameCount) * session.intervalSec)) : 0;
  const progress = session ? Math.min(100, Math.max(session.frameCount / session.maxFrames,
    (Date.now() - new Date(session.startedAt).getTime()) / (session.durationSec * 1000)) * 100) : 0;

  return <div className="space-y-4 text-slate-900">
    {!running && <section className={panel}>
      <h2 className="font-semibold">見本を撮る</h2>
      <label className="flex w-fit flex-col gap-1 text-sm text-slate-600">カメラ
        <select value={deviceId} onChange={(event) => { setCamera(event.target.value); setArmedId(undefined); setSelected(null); }}
          className="max-w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900">
          {cameras.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div role="group" aria-label="間隔" className="space-y-1"><div className="text-sm text-slate-600">間隔</div><div className="flex flex-wrap gap-1.5">
        {intervals.map(([value, text]) => <button key={value} type="button" aria-pressed={intervalSec === value} className={chip(intervalSec === value)} onClick={() => setIntervalSec(value)}>{text}</button>)}
      </div></div>
      <div role="group" aria-label="期間" className="space-y-1"><div className="text-sm text-slate-600">期間</div><div className="flex flex-wrap gap-1.5">
        {durations.map(([value, text]) => <button key={value} type="button" aria-pressed={durationSec === value} className={chip(durationSec === value)} onClick={() => setDurationSec(value)}>{text}</button>)}
      </div></div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">上限枚数<input type="number" min={10} max={20000} step={1} value={maxFrames}
          onChange={(event) => setMaxFrames(event.target.value)} className="w-36 rounded border border-slate-300 px-3 py-2 text-slate-900" /></label>
        <Button type="button" variant="secondary" disabled={!deviceId || !validCap || sessions.isPending || sessions.isError || start.isPending} onClick={() => start.mutate()}>撮影を始める</Button>
      </div>
      {start.isError && <p role="alert" className="text-red-600">撮影を開始できませんでした</p>}
      <div className="rounded bg-slate-100 px-3 py-2 text-sm">
        約 <b>{count.toLocaleString()}</b> 枚、約 <b>{mb.toLocaleString()}</b> MB、{formatDuration(Math.min(durationSec, count * intervalSec))}で終わります。
        {expected > cap && <div className="text-red-700">上限枚数で止まるため、期間の途中で終わります。</div>}
        {mb > 1500 && <div className="text-red-700">容量が大きいです。間隔を広げるか期間を短くしてください。</div>}
      </div>
    </section>}
    {(cameras.isError || sessions.isError) && <p role="alert" className="text-red-600">見本を取得できませんでした</p>}
    {running && <section className={panel}>
      <h2 className="font-semibold">撮影中</h2>
      <div className="flex flex-wrap gap-4 text-sm tabular-nums"><span>撮れた枚数 <b>{session.frameCount}</b> / <b>{session.maxFrames}</b></span>
        <span>残り <b>{formatDuration(remaining)}</b></span><span>容量 <b>{(session.byteSize / 1000000).toFixed(1)}</b> MB</span></div>
      <div role="progressbar" aria-label="進み具合" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} className="h-2.5 overflow-hidden rounded bg-slate-100">
        <div className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
      </div>
      <Button type="button" variant="secondary" disabled={stop.isPending} onClick={() => stop.mutate(session.id)}>撮影を止める</Button>
      {stop.isError && <p role="alert" className="text-red-600">撮影を停止できませんでした</p>}
    </section>}
    {session && <section className={panel}>
      <h2 className="font-semibold">撮れた写真</h2>
      <div className="flex flex-wrap gap-2 text-sm">{[['全部', session.frameCount], ['正常', session.counts.ok], ['異常', session.counts.ng], ['あとで見る', session.counts.later], ['未選択', session.counts.none]].map(([text, value]) =>
        <span key={text} className="rounded-full bg-slate-100 px-2.5 py-1">{text} {value}</span>)}</div>
      <div role="group" aria-label="絞り込み" className="flex flex-wrap gap-1.5">{filters.map(([value, text]) =>
        <button key={value} type="button" aria-pressed={filter === value} className={chip(filter === value)} onClick={() => setFilter(value)}>{text}</button>)}</div>
      {frames.isError && <p role="alert" className="text-red-600">写真を取得できませんでした</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {frames.data?.map((frame) => <div key={frame.id} className={`min-w-0 rounded-lg border-2 p-1.5 ${frame.label ? colors[frame.label] : 'border-transparent bg-slate-100'}`}>
          <button type="button" aria-label={`${new Date(frame.capturedAt).toLocaleString('ja-JP')}を拡大`} onClick={() => setSelected(frame)} className="flex h-[90px] w-full items-center justify-center rounded bg-slate-200"><SampleImage id={frame.id} variant="thumb" /></button>
          <time dateTime={frame.capturedAt} className="my-1 block text-xs text-slate-500">{new Date(frame.capturedAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hourCycle: 'h23' })}</time>
          <div className="flex gap-1">{labels.map(([value, text]) => <button key={value} type="button" aria-pressed={frame.label === value} disabled={mark.isPending}
            className={`flex-1 rounded border py-1.5 text-xs ${frame.label === value ? colors[value] : 'border-slate-300 bg-white text-slate-900'}`}
            onClick={() => mark.mutate({ id: frame.id, label: frame.label === value ? null : value })}>{text}</button>)}</div>
        </div>)}
      </div>
      {frames.data?.length === 0 && <div className="p-7 text-center text-slate-500">この条件の写真はありません</div>}
      {mark.isError && <p role="alert" className="text-red-600">印を変更できませんでした</p>}
      <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => {
        if (armedId !== session.id) { setArmedId(session.id); return; }
        remove.mutate(session.id);
      }}>{armedId === session.id ? '本当に消す(もう一度押す)' : 'この見本をすべて消す'}</Button>
      {remove.isError && <p role="alert" className="text-red-600">見本を削除できませんでした</p>}
    </section>}
    <Dialog isOpen={selected !== null} onClose={() => setSelected(null)} ariaLabel="見本" size="full">
      {selected && <><div className="mb-4 flex justify-end"><Button type="button" variant="secondary" onClick={() => setSelected(null)}>閉じる</Button></div><SampleImage id={selected.id} variant="full" /></>}
    </Dialog>
  </div>;
}
