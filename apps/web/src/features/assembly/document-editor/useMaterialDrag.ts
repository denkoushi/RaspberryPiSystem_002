import { useCallback, useEffect, useRef, useState } from 'react';

import { centerMaterialBBox, snapOverlayBBox, type SnapGuide } from './overlaySnap';

import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';
import type { AssemblyProcedureCropRect, AssemblyProcedureOverlayBBox as BBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export type MaterialDropPreview = { pageIndex: number; bbox: BBox; guides: SnapGuide[]; pending?: boolean };

type MaterialDropPage = {
  layerRef: RefObject<HTMLDivElement | null>;
  pageIndex: number;
  crop?: AssemblyProcedureCropRect | null;
  elements: AssemblyProcedureOverlayElement[];
};

export function materialPreviewSize(material: Pick<ProcedureMaterialDto, 'kind' | 'width' | 'height'>, pageAspect: number) {
  if (material.kind === 'TEXT') return { widthRatio: 0.8, heightRatio: 0.2 };
  let widthRatio = 0.4;
  let heightRatio = widthRatio * (material.height || 1) / (material.width || 1) * pageAspect;
  if (heightRatio > 0.9) { widthRatio *= 0.9 / heightRatio; heightRatio = 0.9; }
  return { widthRatio, heightRatio };
}

export function useMaterialDrag(options: MaterialDropPage & {
  adjacentPage?: MaterialDropPage;
  enabled: boolean;
  place: (material: ProcedureMaterialDto, options?: { bbox?: BBox; pageIndex?: number }) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const live = useRef(options);
  live.current = options;
  const [preview, setPreview] = useState<MaterialDropPreview | null>(null);
  const [shadow, setShadow] = useState<{ materialId: string; x: number; y: number } | null>(null);
  const drag = useRef<{ material: ProcedureMaterialDto; id: number; x: number; y: number; touch: boolean; ready: boolean; lifted: boolean; hold?: ReturnType<typeof setTimeout>; target?: MaterialDropPreview } | null>(null);
  const skipClick = useRef(false);
  const pending = useRef(false);
  const cancel = useCallback(() => {
    if (drag.current) skipClick.current = true;
    clearTimeout(drag.current?.hold);
    drag.current = null;
    setShadow(null);
    if (!pending.current) setPreview(null);
  }, []);
  const place = useCallback(async (material: ProcedureMaterialDto, target?: MaterialDropPreview) => {
    if (!live.current.enabled || pending.current) return;
    pending.current = true;
    if (target) setPreview(current => current && { ...current, pending: true });
    try {
      if (target) {
        const { bbox, pageIndex } = target;
        await live.current.place(material, pageIndex === live.current.pageIndex ? { bbox } : { bbox, pageIndex });
      } else await live.current.place(material);
    } catch (error) { live.current.onError(error); }
    finally { pending.current = false; setPreview(null); }
  }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - d.x, event.clientY - d.y);
      if (!d.ready) {
        if (distance > 0) { skipClick.current = true; cancel(); }
        return;
      }
      if (d.touch) setShadow({ materialId: d.material.id, x: event.clientX, y: event.clientY });
      if (!d.lifted && distance < 6) return;
      d.lifted = true;
      setShadow({ materialId: d.material.id, x: event.clientX, y: event.clientY });
      skipClick.current = true;
      if (event.cancelable) event.preventDefault();
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      d.target = undefined;
      const page = [live.current, live.current.adjacentPage].find(candidate => hit && candidate?.layerRef.current?.contains(hit));
      const layer = page?.layerRef.current;
      if (!page || !layer) { setPreview(null); return; }
      const { crop, elements, pageIndex } = page;
      const rect = layer.getBoundingClientRect();
      if (!rect.width || !rect.height) { setPreview(null); return; }
      const scaleX = crop?.widthRatio ?? 1, scaleY = crop?.heightRatio ?? 1;
      const xRatio = (crop?.xRatio ?? 0) + (event.clientX - rect.left) / rect.width * scaleX;
      const yRatio = (crop?.yRatio ?? 0) + (event.clientY - rect.top) / rect.height * scaleY;
      const size = materialPreviewSize(d.material, rect.width / rect.height * scaleY / scaleX);
      const bbox = centerMaterialBBox(size, { xRatio, yRatio, widthRatio: 0, heightRatio: 0 });
      d.target = { pageIndex, ...snapOverlayBBox({ bbox, targets: elements.map(element => element.bbox), viewport: rect, crop }) };
      setPreview(d.target);
    };
    const up = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== event.pointerId) return;
      if (d.ready) move(event);
      const target = d.target;
      const material = d.material;
      clearTimeout(d.hold);
      drag.current = null;
      setShadow(null);
      if (d.lifted && target && live.current.enabled) void place(material, target);
      else setPreview(null);
    };
    const abort = () => { if (drag.current) skipClick.current = true; cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); abort(); } };
    const touchmove = (event: TouchEvent) => {
      const d = drag.current;
      if (!d?.touch) return;
      if (!d.ready) { cancel(); return; }
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('touchmove', touchmove, { passive: false });
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', abort);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(drag.current?.hold);
      document.removeEventListener('touchmove', touchmove);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', abort);
      document.removeEventListener('keydown', key);
    };
  }, [cancel, place]);
  useEffect(() => { cancel(); }, [options.enabled, options.pageIndex, cancel]);
  return {
    preview,
    shadow,
    activeMaterialId: shadow?.materialId ?? null,
    onPointerDown: (material: ProcedureMaterialDto, event: ReactPointerEvent<HTMLButtonElement>) => {
      skipClick.current = false;
      if (!live.current.enabled || pending.current || event.button !== 0) return;
      const d = { material, id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch', ready: event.pointerType !== 'touch', lifted: false, hold: undefined as ReturnType<typeof setTimeout> | undefined };
      drag.current = d;
      if (!d.ready) d.hold = setTimeout(() => { if (drag.current === d && live.current.enabled) { d.ready = true; skipClick.current = true; setShadow({ materialId: material.id, x: d.x, y: d.y }); } }, 250);
    },
    onClick: (material: ProcedureMaterialDto) => {
      if (skipClick.current) { skipClick.current = false; return; }
      void place(material);
    }
  };
}
