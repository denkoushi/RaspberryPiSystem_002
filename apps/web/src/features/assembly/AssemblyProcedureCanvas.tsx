import clsx from 'clsx';
import { useRef } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import type { MouseEvent, ReactNode } from 'react';

export type AssemblyCanvasBolt = {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  label: string;
  status?: 'pending' | 'current' | 'ok' | 'ng' | 'ignored';
};

export type AssemblyCanvasCheckItem = {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  label: string | null;
  required: boolean;
  checked: boolean;
};

type Props = {
  imageRelativePath: string | null | undefined;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onAddBolt?: (xRatio: number, yRatio: number) => void;
  onAddCheckItem?: (xRatio: number, yRatio: number) => void;
  placementMode?: 'bolt' | 'check';
  className?: string;
};

function boltMarkerClass(status: AssemblyCanvasBolt['status'], selected: boolean): string {
  if (selected) return 'bg-cyan-300 text-slate-950 ring-4 ring-cyan-100';
  if (status === 'current') return 'bg-amber-300 text-slate-950 ring-4 ring-amber-100';
  if (status === 'ok') return 'bg-emerald-500 text-white ring-2 ring-emerald-200';
  if (status === 'ng') return 'bg-rose-600 text-white ring-2 ring-rose-200';
  if (status === 'ignored') return 'bg-slate-500 text-white ring-2 ring-slate-200';
  return 'bg-white text-slate-950 ring-2 ring-slate-400';
}

function checkMarkerClass(item: AssemblyCanvasCheckItem, selected: boolean): string {
  if (selected) return 'bg-lime-200 text-slate-950 ring-4 ring-lime-100';
  if (item.checked) return 'bg-emerald-600 text-white ring-2 ring-emerald-300';
  if (item.required) return 'bg-lime-400 text-slate-950 ring-2 ring-lime-200';
  return 'bg-lime-300/80 text-slate-900 ring-2 ring-dashed ring-lime-100';
}

export function AssemblyMarkerOverlay({
  bolts,
  checkItems = [],
  selectedBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem
}: Pick<
  Props,
  | 'bolts'
  | 'checkItems'
  | 'selectedBoltId'
  | 'selectedCheckItemId'
  | 'onSelectBolt'
  | 'onSelectCheckItem'
  | 'onToggleCheckItem'
>) {
  return (
    <>
      {bolts.map((bolt) => (
        <button
          key={`bolt-${bolt.id}`}
          type="button"
          title={bolt.label}
          onClick={(event) => {
            event.stopPropagation();
            onSelectBolt?.(bolt.id);
          }}
          className={clsx(
            'absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold shadow-lg',
            boltMarkerClass(bolt.status, selectedBoltId === bolt.id)
          )}
          style={{ left: `${bolt.xRatio * 100}%`, top: `${bolt.yRatio * 100}%` }}
        >
          {bolt.markerNo}
        </button>
      ))}
      {checkItems.map((item) => (
        <button
          key={`check-${item.id}`}
          type="button"
          title={item.label ?? `チェック${item.markerNo}`}
          onClick={(event) => {
            event.stopPropagation();
            if (onToggleCheckItem) {
              onToggleCheckItem(item.id);
              return;
            }
            onSelectCheckItem?.(item.id);
          }}
          className={clsx(
            'absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold shadow-lg',
            checkMarkerClass(item, selectedCheckItemId === item.id)
          )}
          style={{ left: `${item.xRatio * 100}%`, top: `${item.yRatio * 100}%` }}
        >
          ✓{item.markerNo}
        </button>
      ))}
    </>
  );
}

export function AssemblyProcedureCanvas({
  imageRelativePath,
  bolts,
  checkItems = [],
  selectedBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem,
  onAddBolt,
  onAddCheckItem,
  placementMode = 'bolt',
  className
}: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const { blobUrl, error } = useProtectedImageBlobUrl(imageRelativePath);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const addHandler = placementMode === 'check' ? onAddCheckItem : onAddBolt;
    if (!addHandler) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return;
    addHandler(xRatio, yRatio);
  };

  if (!imageRelativePath) {
    return (
      <div className={clsx('flex min-h-[18rem] items-center justify-center bg-slate-950 text-sm text-white/60', className)}>
        手順書を選択
      </div>
    );
  }

  if (error) {
    return (
      <div className={clsx('flex min-h-[18rem] items-center justify-center bg-slate-950 text-sm text-rose-200', className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={clsx('min-h-0 overflow-auto bg-slate-950 p-2', className)}>
      <div className="relative mx-auto inline-block max-w-full" onClick={handleClick}>
        {blobUrl ? (
          <img
            ref={imageRef}
            src={blobUrl}
            alt=""
            className="block max-h-[calc(100dvh-15rem)] max-w-full select-none"
            draggable={false}
          />
        ) : (
          <div className="flex h-80 w-[42rem] max-w-full items-center justify-center text-sm text-white/60">
            読み込み中
          </div>
        )}
        {blobUrl ? (
          <AssemblyMarkerOverlay
            bolts={bolts}
            checkItems={checkItems}
            selectedBoltId={selectedBoltId}
            selectedCheckItemId={selectedCheckItemId}
            onSelectBolt={onSelectBolt}
            onSelectCheckItem={onSelectCheckItem}
            onToggleCheckItem={onToggleCheckItem}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AssemblyProcedureImageWithMarkers({
  imageContent,
  bolts,
  checkItems = [],
  selectedBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem,
  onPlacementClick,
  className
}: {
  imageContent: ReactNode;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onPlacementClick?: (xRatio: number, yRatio: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onPlacementClick) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return;
    onPlacementClick(xRatio, yRatio);
  };

  return (
    <div className={clsx('relative inline-block max-h-full max-w-full', className)} ref={containerRef} onClick={handleClick}>
      {imageContent}
      <AssemblyMarkerOverlay
        bolts={bolts}
        checkItems={checkItems}
        selectedBoltId={selectedBoltId}
        selectedCheckItemId={selectedCheckItemId}
        onSelectBolt={onSelectBolt}
        onSelectCheckItem={onSelectCheckItem}
        onToggleCheckItem={onToggleCheckItem}
      />
    </div>
  );
}
