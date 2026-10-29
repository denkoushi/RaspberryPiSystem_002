import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { getPlacementPhoto, listPlacementPhotos, type PlacementPhoto } from '../../api/domains/placement-photos';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useAuth } from '../../contexts/AuthContext';

function PhotoImage({ id, variant, large = false }: { id: string; variant: 'crop' | 'full'; large?: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    void getPlacementPhoto(id, large ? variant : `${variant}-thumb`).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => { /* Missing images use the same empty cell. */ });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, variant, large]);
  return url ? <img src={url} alt={variant === 'crop' ? '切り抜き' : '全体'}
    className={large ? 'max-h-[70dvh] w-full object-contain' : 'h-12 w-[72px] rounded object-cover'} /> : <span>—</span>;
}
const time = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
function PlacementPhotosContent() {
  const [filters, setFilters] = useState({ q: '', shelf: '', date: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(filters), 300);
    return () => window.clearTimeout(timer);
  }, [filters]);
  const [selected, setSelected] = useState<PlacementPhoto | null>(null);
  const { data, isError } = useQuery({ queryKey: ['placement-photos', debouncedFilters], queryFn: () => listPlacementPhotos(debouncedFilters) });
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold text-slate-900">配膳写真</h1>
    <div className="flex flex-wrap gap-4">
      {([{ key: 'q', label: '製造order / 注番', type: 'text' }, { key: 'shelf', label: '棚', type: 'text' }, { key: 'date', label: '日付', type: 'date' }] as const).map(({ key, label, type }) =>
        <label key={key} className="flex flex-col gap-1 text-sm text-slate-700">{label}
          <input type={type} value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
            className="rounded border border-slate-400 bg-white px-3 py-2 text-slate-900" />
        </label>)}
    </div>
    {isError && <p role="alert" className="text-red-600">写真を取得できませんでした</p>}
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <table className="w-full min-w-[800px] text-left text-sm text-slate-900">
        <thead><tr className="border-b border-slate-300 text-slate-700">
          {['置いた時刻', '票', '枝', '棚', '端末', '写真'].map((label) => <th key={label} className="px-2 pb-3 font-semibold">{label}</th>)}
        </tr></thead>
        <tbody>{data?.map((photo) => <tr key={photo.id} className="border-b border-slate-200">
          <td className="px-2 py-3"><time dateTime={photo.placedAt}>{time(photo.placedAt)}</time></td>
          <td className="px-2 py-3"><div className="font-mono font-medium">{photo.number ?? '—'}</div>
            <div className="text-xs text-slate-500">{photo.slipKind === 'purchase_order' ? '現品票' : photo.slipKind === 'manufacturing_order' ? '移動票' : '—'}</div></td>
          <td className="px-2 py-3">{photo.branchNo === 0 ? 'なし' : photo.branchNo ?? '—'}</td>
          <td className="px-2 py-3 font-medium">{photo.shelfCodeRaw ?? '—'}</td>
          <td className="px-2 py-3">{photo.deviceName}</td>
          <td className="px-2 py-3"><div className="flex gap-2">
            {(['crop', 'full'] as const).map((variant) => variant === 'crop' && !photo.hasCrop
              ? <span key={variant} className="flex h-12 w-[72px] items-center justify-center">—</span>
              : <button key={variant} type="button" aria-label={`${photo.number ?? '—'} ${variant === 'crop' ? '切り抜き' : '全体'}を拡大`}
                className="flex h-12 w-[72px] items-center justify-center rounded bg-slate-100" onClick={() => setSelected(photo)}>
                <PhotoImage id={photo.id} variant={variant} />
              </button>)}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <Dialog isOpen={selected !== null} onClose={() => setSelected(null)} ariaLabel="配膳写真" size="full">
      {selected && <>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{selected.number} → {selected.shelfCodeRaw} {time(selected.placedAt)}</h2>
          <Button type="button" variant="secondary" onClick={() => setSelected(null)}>閉じる</Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-center bg-slate-100">{selected.hasCrop ? <PhotoImage id={selected.id} variant="crop" large /> : '—'}</div>
          <div className="flex items-center justify-center bg-slate-100"><PhotoImage id={selected.id} variant="full" large /></div>
        </div>
      </>}
    </Dialog>
  </div>;
}
export function PlacementPhotosPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'ADMIN') return <Navigate to="/admin" replace />;
  return <PlacementPhotosContent />;
}
