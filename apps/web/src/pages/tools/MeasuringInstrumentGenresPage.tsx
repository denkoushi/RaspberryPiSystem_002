import { FormEvent, useMemo, useState } from 'react';

import { useMeasuringInstrumentGenreMutations, useMeasuringInstrumentGenres } from '../../api/hooks';
import { ProtectedImage } from '../../components/ProtectedImage';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useConfirm } from '../../contexts/ConfirmContext';

import type { MeasuringInstrumentGenre } from '../../api/types';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export function MeasuringInstrumentGenresPage() {
  const { data: genres, isLoading } = useMeasuringInstrumentGenres();
  const mutations = useMeasuringInstrumentGenreMutations();
  const confirm = useConfirm();
  const [editingGenre, setEditingGenre] = useState<MeasuringInstrumentGenre | null>(null);
  const [name, setName] = useState('');

  const sortedGenres = useMemo(
    () => [...(genres ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [genres]
  );

  const resetForm = () => {
    setEditingGenre(null);
    setName('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (editingGenre) {
      await mutations.update.mutateAsync({
        genreId: editingGenre.id,
        payload: { name: name.trim() }
      });
    } else {
      await mutations.create.mutateAsync({ name: name.trim() });
    }
    resetForm();
  };

  const handleDelete = async (genreId: string) => {
    const shouldDelete = await confirm({
      title: 'このジャンルを削除しますか？',
      description: '計測機器に割り当て済みのジャンルは削除できません。',
      confirmLabel: '削除',
      cancelLabel: 'キャンセル',
      tone: 'danger'
    });
    if (!shouldDelete) return;
    await mutations.remove.mutateAsync(genreId);
    if (editingGenre?.id === genreId) {
      resetForm();
    }
  };

  const handleSelectEdit = (genre: MeasuringInstrumentGenre) => {
    setEditingGenre(genre);
    setName(genre.name);
  };

  const handleUpload = async (genreId: string, slot: 1 | 2, file: File | null) => {
    if (!file) return;
    await mutations.uploadImage.mutateAsync({ genreId, slot, image: file });
  };

  const handleClearImage = async (genreId: string, slot: 1 | 2) => {
    await mutations.deleteImage.mutateAsync({ genreId, slot });
  };

  return (
    <div className="space-y-6">
      <Card title="計測機器ジャンル 登録 / 編集">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            ジャンル名
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: ノギス / マイクロメータ" required />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
              {editingGenre ? (mutations.update.isPending ? '更新中…' : '上書き保存') : mutations.create.isPending ? '登録中…' : '登録'}
            </Button>
            {editingGenre ? (
              <Button type="button" variant="ghost" className="ml-3" onClick={resetForm}>
                編集キャンセル
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="計測機器ジャンル一覧（画像1〜2枚）">
        {isLoading ? (
          <p className="text-sm text-slate-700">読み込み中…</p>
        ) : sortedGenres.length === 0 ? (
          <p className="text-sm text-slate-700">ジャンルが未登録です。</p>
        ) : (
          <div className="grid gap-4">
            {sortedGenres.map((genre) => (
              <div key={genre.id} className="rounded border-2 border-slate-300 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-bold text-slate-900">{genre.name}</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => handleSelectEdit(genre)}>
                      編集
                    </Button>
                    <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => handleDelete(genre.id)}>
                      削除
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div className="rounded border border-slate-300 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-700">画像1</p>
                    <ProtectedImage
                      imagePath={genre.imageUrlPrimary}
                      alt={`${genre.name} 画像1`}
                      className="mt-2 h-48 w-full rounded border border-slate-300 object-contain bg-white"
                      emptyFallback="未登録"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        type="file"
                        accept={IMAGE_ACCEPT}
                        onChange={(e) => void handleUpload(genre.id, 1, e.target.files?.[0] ?? null)}
                      />
                      {genre.imageUrlPrimary ? (
                        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleClearImage(genre.id, 1)}>
                          画像1をクリア
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded border border-slate-300 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-700">画像2</p>
                    <ProtectedImage
                      imagePath={genre.imageUrlSecondary}
                      alt={`${genre.name} 画像2`}
                      className="mt-2 h-48 w-full rounded border border-slate-300 object-contain bg-white"
                      emptyFallback="未登録"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        type="file"
                        accept={IMAGE_ACCEPT}
                        onChange={(e) => void handleUpload(genre.id, 2, e.target.files?.[0] ?? null)}
                      />
                      {genre.imageUrlSecondary ? (
                        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleClearImage(genre.id, 2)}>
                          画像2をクリア
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
