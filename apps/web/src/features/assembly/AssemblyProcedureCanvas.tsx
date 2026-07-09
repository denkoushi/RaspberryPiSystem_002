import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import { computeContainSize } from './computeContainSize';

import type { MouseEvent, ReactNode, RefObject } from 'react';

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

function useContainFitBox(
  viewportRef: RefObject<HTMLElement | null>,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setBox(computeContainSize(rect.width, rect.height, naturalWidth, naturalHeight));
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportRef, naturalWidth, naturalHeight]);

  return box;
}

function useNaturalSizeFromImg(rootRef: RefObject<HTMLElement | null>, deps: unknown[]): {
  width: number;
  height: number;
} {
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const img = root.querySelector('img');
    if (!img) return;

    const sync = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNatural({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };

    sync();
    img.addEventListener('load', sync);
    return () => img.removeEventListener('load', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit dependency list
  }, deps);

  return natural;
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const fitted = useContainFitBox(viewportRef, natural.width, natural.height);
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
    <div
      ref={viewportRef}
      className={clsx('flex min-h-0 items-center justify-center overflow-hidden bg-slate-950 p-2', className)}
    >
      {blobUrl ? (
        <div
          className="relative shrink-0"
          style={fitted.width > 0 ? { width: fitted.width, height: fitted.height } : { maxWidth: '100%', maxHeight: '100%' }}
          onClick={handleClick}
        >
          <img
            ref={imageRef}
            src={blobUrl}
            alt=""
            className="block h-full w-full select-none object-contain"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
          />
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
      ) : (
        <div className="flex h-80 w-[42rem] max-w-full items-center justify-center text-sm text-white/60">読み込み中</div>
      )}
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
  fitToParent = false,
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
  /** When true, scale the image to the largest size that fits the parent while preserving aspect ratio. */
  fitToParent?: boolean;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const natural = useNaturalSizeFromImg(fitToParent ? viewportRef : frameRef, [imageContent, fitToParent]);
  const fitted = useContainFitBox(viewportRef, natural.width, natural.height);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onPlacementClick) return;
    const container = frameRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return;
    onPlacementClick(xRatio, yRatio);
  };

  if (!fitToParent) {
    return (
      <div className={clsx('relative inline-block max-h-full max-w-full', className)} ref={frameRef} onClick={handleClick}>
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

  return (
    <div
      ref={viewportRef}
      className={clsx('flex h-full min-h-0 w-full items-center justify-center overflow-hidden', className)}
    >
      <div
        ref={frameRef}
        className="relative shrink-0 [&>img]:h-full [&>img]:w-full [&>img]:object-contain [&>div]:h-full [&>div]:w-full"
        style={fitted.width > 0 ? { width: fitted.width, height: fitted.height } : { maxWidth: '100%', maxHeight: '100%' }}
        onClick={handleClick}
      >
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
    </div>
  );
}
