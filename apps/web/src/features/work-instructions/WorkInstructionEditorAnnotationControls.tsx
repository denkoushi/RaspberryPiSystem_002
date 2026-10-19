import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { normalizeWorkInstructionOverlayBBox } from './workInstructionEditorDraft';

import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';
import type { OverlayBBox } from '@raspi-system/shared-types';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Gesture = { id: string; pointerId: number; corner?: Corner; start: { x: number; y: number }; bbox: OverlayBBox };
const corners = { nw: '左上', ne: '右上', sw: '左下', se: '右下' } as const;

export function WorkInstructionEditorAnnotationControls({ elements, selectedId, onSelect, onNudge, onUpdateBBox }: {
  elements: WorkInstructionOverlayElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
  onUpdateBBox: (id: string, bbox: OverlayBBox) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const point = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: event.clientX, y: event.clientY };
  };
  const begin = (event: ReactPointerEvent<HTMLButtonElement>, element: WorkInstructionOverlayElement, corner?: Corner) => {
    if (event.button !== 0) return;
    const start = point(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(element.id);
    gestureRef.current = { id: element.id, pointerId: event.pointerId, corner, start, bbox: { ...element.bbox } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    const end = point(event);
    if (!gesture || gesture.pointerId !== event.pointerId || !end) return;
    event.preventDefault();
    event.stopPropagation();
    const { bbox, corner } = gesture;
    const rect = surfaceRef.current!.getBoundingClientRect();
    const dx = (end.x - gesture.start.x) / rect.width;
    const dy = (end.y - gesture.start.y) / rect.height;
    if (!corner) {
      onUpdateBBox(gesture.id, normalizeWorkInstructionOverlayBBox({ ...bbox, xRatio: bbox.xRatio + dx, yRatio: bbox.yRatio + dy }));
      return;
    }
    const right = bbox.xRatio + bbox.widthRatio;
    const bottom = bbox.yRatio + bbox.heightRatio;
    const x = corner.includes('w') ? Math.max(0, Math.min(right - 0.02, bbox.xRatio + dx)) : bbox.xRatio;
    const y = corner.includes('n') ? Math.max(0, Math.min(bottom - 0.02, bbox.yRatio + dy)) : bbox.yRatio;
    const width = corner.includes('w') ? right - x : Math.max(0.02, Math.min(1 - x, bbox.widthRatio + dx));
    const height = corner.includes('n') ? bottom - y : Math.max(0.02, Math.min(1 - y, bbox.heightRatio + dy));
    onUpdateBBox(gesture.id, { xRatio: x, yRatio: y, widthRatio: width, heightRatio: height });
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>, cancel = false) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (cancel) onUpdateBBox(gesture.id, gesture.bbox);
    else move(event);
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={surfaceRef} className="pointer-events-none absolute inset-0" aria-label="注釈">{elements.map((element) => {
    const selected = element.id === selectedId;
    const review = ['NEEDS_REVIEW', 'UNASSIGNED'].includes(String(element.migrationState).toUpperCase());
    const label = element.kind === 'TEXT' ? `文章の注釈: ${element.text.slice(0, 30)}` : element.kind === 'IMAGE' ? '画像の注釈' : '図形・記号の注釈';
    const bbox = element.bbox;
    return <span key={element.id}><button type="button" aria-label={label} title="注釈を選択" aria-pressed={selected} data-testid={`overlay-${element.id}`} data-overlay-id={element.id} className={`pointer-events-auto absolute min-h-11 min-w-11 touch-none cursor-move bg-transparent p-0 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#5fc3e8] ${selected ? 'outline outline-2 outline-[#5fc3e8]' : review ? 'outline outline-2 outline-dashed outline-[#f6b93b]' : ''}`} style={{ left: `${bbox.xRatio * 100}%`, top: `${bbox.yRatio * 100}%`, width: `${bbox.widthRatio * 100}%`, height: `${bbox.heightRatio * 100}%`, zIndex: element.zIndex }} onClick={(event) => { event.stopPropagation(); onSelect(element.id); }} onPointerDown={(event) => begin(event, element)} onPointerMove={move} onPointerUp={finish} onPointerCancel={(event) => finish(event, true)} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const amount = event.shiftKey ? 0.01 : 0.002;
      onNudge(element.id, event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
    }}>{element.kind === 'IMAGE' && !element.assetId ? <span className="block h-full w-full bg-white text-sm text-[#161c22]">画像を選ぶ</span> : null}</button>{selected ? (Object.keys(corners) as Corner[]).map((corner) => <button key={corner} type="button" aria-label={`${corners[corner]}の大きさ変更`} title="大きさ変更" data-testid={`overlay-${element.id}-resize-${corner}`} className="pointer-events-auto absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none bg-transparent p-0 after:absolute after:left-[15px] after:top-[15px] after:h-3.5 after:w-3.5 after:rounded after:border-2 after:border-white after:bg-[#5fc3e8] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#5fc3e8]" style={{ left: `${(bbox.xRatio + (corner.includes('w') ? 0 : bbox.widthRatio)) * 100}%`, top: `${(bbox.yRatio + (corner.includes('n') ? 0 : bbox.heightRatio)) * 100}%`, zIndex: 1_000_000 }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => begin(event, element, corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={(event) => finish(event, true)} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const amount = event.shiftKey ? 0.01 : 0.002;
      const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      const x = corner.includes('w') ? Math.max(0, Math.min(bbox.xRatio + bbox.widthRatio - 0.02, bbox.xRatio + dx)) : bbox.xRatio;
      const y = corner.includes('n') ? Math.max(0, Math.min(bbox.yRatio + bbox.heightRatio - 0.02, bbox.yRatio + dy)) : bbox.yRatio;
      onUpdateBBox(element.id, normalizeWorkInstructionOverlayBBox({ xRatio: x, yRatio: y, widthRatio: corner.includes('w') ? bbox.widthRatio + bbox.xRatio - x : bbox.widthRatio + dx, heightRatio: corner.includes('n') ? bbox.heightRatio + bbox.yRatio - y : bbox.heightRatio + dy }));
    }} />) : null}</span>;
  })}</div>;
}
