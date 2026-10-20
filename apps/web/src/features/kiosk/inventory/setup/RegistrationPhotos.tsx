import { inventoryThumbnailUrl, type InventoryImport } from '../../../../api/client';
import { ArrowLeftIcon, ArrowRightIcon, RotateRightIcon, TrashIcon } from '../InventoryIcons';
import { invButtonSm, invButtonSmGhost, invPanel } from '../inventoryUi';

import { iconSm } from './RegistrationRowParts';

import type { ReactNode } from 'react';

type RegistrationPhotosProps = {
  candidate: InventoryImport;
  optionsOpen: boolean;
  currentPhotoPage: number;
  lastPhotoPage: number;
  confirmDeletePhotoId: string | null;
  photoPending: boolean;
  setReadPhotoId: (id: string) => void;
  setSelectedPhoto: (id: string) => void;
  setConfirmDeletePhotoId: (id: string | null) => void;
  setPhotoPage: (page: number) => void;
  deletePhoto: (photoId: string) => void;
  movePhoto: (index: number, offset: -1 | 1) => void;
  rotatePhoto: (photoId: string) => void;
  localError: (target: string) => ReactNode;
};

export function RegistrationPhotos({
  candidate, optionsOpen, currentPhotoPage, lastPhotoPage, confirmDeletePhotoId, photoPending,
  setReadPhotoId, setSelectedPhoto, setConfirmDeletePhotoId, setPhotoPage,
  deletePhoto, movePhoto, rotatePhoto, localError,
}: RegistrationPhotosProps) {
  // The photos stay in front of the shade so the name can be chosen while looking at them.
  return (
    <section aria-label="写真の確認" className={`${invPanel} flex min-h-0 flex-col gap-3 p-4 ${optionsOpen ? 'relative z-[45]' : ''}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-black">写真の確認</h3><span className="text-sm font-bold">候補 #{candidate.sourceItemId}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-inv-faint">加工機 {candidate.area} ・ 分類 {candidate.category ?? '-'} ・ メモ {candidate.note ?? '-'}</span>
      </div>
      {candidate.photos.length === 0 ? <p className="text-sm text-inv-faint">写真はありません</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3">
        {candidate.photos.slice(currentPhotoPage * 2, currentPhotoPage * 2 + 2).map((photo, pageIndex) => {
          const index = currentPhotoPage * 2 + pageIndex;
          return (
            <figure key={photo.id} className="flex min-h-0 flex-col gap-2">
              <button type="button" className="block min-h-11 min-w-11 w-full flex-1" aria-label={`写真${index + 1}を拡大`} onClick={() => { setReadPhotoId(photo.id); setSelectedPhoto(photo.id); }}>
                <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-full w-full rounded-xl border border-inv-line bg-inv-bg object-contain" />
              </button>
              {confirmDeletePhotoId === photo.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 text-sm text-[#ffb3b3]">この写真を削除しますか？</span>
                  <button type="button" className={`${invButtonSm} border-inv-red/60 text-[#ffb3b3]`} disabled={photoPending} onClick={() => deletePhoto(photo.id)}>削除</button>
                  <button type="button" className={invButtonSmGhost} onClick={() => setConfirmDeletePhotoId(null)}>やめる</button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button type="button" className={iconSm} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || photoPending} onClick={() => movePhoto(index, -1)}><ArrowLeftIcon /></button>
                  <button type="button" className={iconSm} aria-label={`写真${index + 1}を後ろへ`} disabled={index === candidate.photos.length - 1 || photoPending} onClick={() => movePhoto(index, 1)}><ArrowRightIcon size={16} /></button>
                  <button type="button" className={iconSm} aria-label={`写真${index + 1}を右に回す`} title={`写真${index + 1}を右に回す`} disabled={photoPending} onClick={() => rotatePhoto(photo.id)}><RotateRightIcon /></button>
                  <span className="flex-1" />
                  <button type="button" className={`${iconSm} border-inv-red/45 bg-transparent text-[#ffb3b3] hover:bg-inv-red/10`} aria-label={`写真${index + 1}を削除`} disabled={photoPending} onClick={() => setConfirmDeletePhotoId(photo.id)}><TrashIcon /></button>
                </div>
              )}
            </figure>
          );
        })}
      </div>
      {candidate.photos.length > 2 ? <div className="flex shrink-0 items-center justify-center gap-3" role="group" aria-label="写真のページ">
        <button type="button" className={iconSm} aria-label="前の写真ページ" disabled={currentPhotoPage === 0} onClick={() => setPhotoPage(currentPhotoPage - 1)}>＜</button>
        <span className="text-sm tabular-nums">{currentPhotoPage * 2 + 1}–{Math.min(currentPhotoPage * 2 + 2, candidate.photos.length)} / {candidate.photos.length}</span>
        <button type="button" className={iconSm} aria-label="次の写真ページ" disabled={currentPhotoPage === lastPhotoPage} onClick={() => setPhotoPage(currentPhotoPage + 1)}>＞</button>
      </div> : null}
      {localError('photos')}
    </section>
  );
}
