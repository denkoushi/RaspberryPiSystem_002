import {
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayBBox,
  type AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { OverlayRangeSelectionSurface } from '../../overlays/OverlayRangeSelectionSurface';
import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import { InlineTextEditor, type InlineTextFlush, type InlineTextElement } from './InlineTextEditor';
import { snapOverlayBBox, type SnapGuide, type SnapMode } from './overlaySnap';

import type { MaterialDropPreview } from './useMaterialDrag';
import type { AssemblyProcedureOverlayAssetDto } from '../types';

export const AssemblyProcedureDocumentEditorCanvas = memo(function AssemblyProcedureDocumentEditorCanvas({
  pageUrl,
  pageIndex,
  crop,
  elements,
  imageAngles,
  selectionMode,
  editable,
  locked = false,
  selectedOverlayId,
  onSelectOverlay,
  onNudgeOverlay,
  onUpdateOverlayBBox,
  onInteractionStart,
  onInteractionEnd,
  onRangeSelected,
  assets,
  className,
  layerRef: externalLayerRef,
  materialPreview,
  saving,
  onUpdateText,
  registerInlineTextFlush,
  onInlineEditingChange,
  onDraftChange
}: {
  pageUrl: string;
  pageIndex: number;
  crop?: AssemblyProcedureCropRect | null;
  elements: AssemblyProcedureOverlayElement[];
  imageAngles?: ReadonlyMap<string, number>;
  selectionMode: boolean;
  editable: boolean;
  locked?: boolean;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string) => void;
  onNudgeOverlay: (id: string, dxRatio: number, dyRatio: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onUpdateOverlayBBox: (id: string, bbox: AssemblyProcedureOverlayBBox) => void;
  onRangeSelected: (bbox: AssemblyProcedureOverlayBBox) => void;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  className?: string;
  layerRef?: RefObject<HTMLDivElement | null>;
  materialPreview?: MaterialDropPreview | null;
  saving?: boolean;
  onUpdateText?: (element: InlineTextElement) => void;
  registerInlineTextFlush?: (flush: InlineTextFlush | null) => void;
  onDraftChange?: (element: InlineTextElement | null) => void;
  onInlineEditingChange?: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState<InlineTextElement | null>(null);
  const localFlush = useRef<InlineTextFlush | null>(null);
  const registerFlush = useRef(registerInlineTextFlush);
  registerFlush.current = registerInlineTextFlush;
  const registerEditorFlush = useCallback((flush: InlineTextFlush | null) => { localFlush.current = flush; registerFlush.current?.(flush); }, []);
  const finishEditing = () => { setEditing(null); onInlineEditingChange?.(null); };
  const beginEditing = (id: string) => {
    if (!editable || locked || saving || !onUpdateText) return;
    const element = elements.find(candidate => candidate.id === id);
    if (element?.kind !== 'TEXT') return;
    tap.current = null;
    setEditing(element);
    onInlineEditingChange?.(id);
  };
  useEffect(() => {
    if (editing && (!editable || locked || saving || editing.id !== selectedOverlayId || editing.pageIndex !== pageIndex)) localFlush.current?.();
  }, [editable, locked, saving, selectedOverlayId, pageIndex, editing]);
  const tap = useRef<{ id: string; edit: boolean; x: number; y: number; moved: boolean } | null>(null);
  const ownLayerRef = useRef<HTMLDivElement>(null);
  const layerRef = externalLayerRef ?? ownLayerRef;
  useLayoutEffect(() => {
    if (!imageAngles?.size) return;
    const overlays = layerRef.current?.querySelectorAll<HTMLElement>('[data-overlay-id]');
    const rotated: HTMLElement[] = [];
    for (const node of overlays ?? []) {
      const angle = imageAngles.get(node.dataset.overlayId!);
      if (!angle) continue;
      node.dataset.editorImageRotation = angle % 180 === 0 ? 'half' : 'quarter';
      node.style.setProperty('--editor-image-angle', `${angle}deg`);
      rotated.push(node);
    }
    return () => {
      for (const node of rotated) {
        delete node.dataset.editorImageRotation;
        node.style.removeProperty('--editor-image-angle');
      }
    };
  }, [crop, elements, imageAngles, layerRef]);
  const interaction = useRef<{ id: string; mode: SnapMode; original: AssemblyProcedureOverlayBBox } | null>(null);
  const active = useRef(false);
  const beginEditingRef = useRef(beginEditing);
  beginEditingRef.current = beginEditing;
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(editTimer.current), []);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const shownGuides = materialPreview?.guides ?? guides;
  const local = (coordinate: number, axis: 'x' | 'y') => (coordinate - (axis === 'x' ? crop?.xRatio ?? 0 : crop?.yRatio ?? 0)) / (axis === 'x' ? crop?.widthRatio ?? 1 : crop?.heightRatio ?? 1);
  const overlay = (
    <div ref={layerRef} className="absolute inset-0" style={{ containerType: 'inline-size' }} data-testid="document-editor-overlay-surface"
      onPointerDownCapture={event => {
        clearTimeout(editTimer.current);
        const target = event.target as HTMLElement;
        if (target.closest('textarea')) return;
        if (editing) {
          localFlush.current?.();
          const selected = target.closest('[data-overlay-id]')?.getAttribute('data-overlay-id');
          if (selected) onSelectOverlay(selected);
          event.stopPropagation();
          return;
        }
        const handle = target.closest('[data-testid]')?.getAttribute('data-testid')?.match(/-resize-(nw|ne|sw|se)$/)?.[1] as SnapMode | undefined;
        const id = target.closest('[data-overlay-id]')?.getAttribute('data-overlay-id') ?? (handle ? selectedOverlayId : null);
        const original = elements.find(element => element.id === id)?.bbox;
        interaction.current = original && id ? { id, original, mode: handle ?? 'move' } : null;
        tap.current = id && !handle ? { id, edit: id === selectedOverlayId, x: event.clientX, y: event.clientY, moved: false } : null;
      }}
      onPointerMoveCapture={event => { if (tap.current && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > 6) tap.current.moved = true; }}
      onPointerUpCapture={event => {
        const pressed = tap.current;
        if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 6) pressed.moved = true;
      }}
      onPointerCancelCapture={() => { tap.current = null; }}
      onKeyDownCapture={event => {
        if ((event.target as HTMLElement).closest('textarea')) return;
        if (editing) { event.stopPropagation(); event.preventDefault(); return; }
        const id = (event.target as HTMLElement).closest('[data-overlay-id]')?.getAttribute('data-overlay-id');
        if (event.key === 'Enter' && id && id === selectedOverlayId && editable && !saving && !locked && onUpdateText && elements.some(element => element.id === id && element.kind === 'TEXT')) {
          event.stopPropagation(); event.preventDefault(); beginEditing(id);
        }
      }}>
      {/* Swap the image content-box dimensions before object-fit is applied on a quarter turn. */}
      {imageAngles?.size ? <style>{`
        [data-editor-image-rotation] > img {
          transform: rotate(var(--editor-image-angle));
        }
        [data-editor-image-rotation="quarter"] {
          container-type: size;
        }
        [data-editor-image-rotation="quarter"] > img {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 100cqh;
          height: 100cqw;
          max-width: none;
          transform: translate(-50%, -50%) rotate(var(--editor-image-angle));
        }
      `}</style> : null}
      <AssemblyProcedureOverlayLayer
        elements={elements}
        crop={crop}
        selectedOverlayId={selectedOverlayId}
        interactive={!selectionMode && !locked && !saving && !editing}
        onSelect={onSelectOverlay}
        onNudge={editing ? undefined : onNudgeOverlay}
        onUpdateBBox={editable && !editing ? (id, bbox) => {
          const rect = layerRef.current?.getBoundingClientRect();
          if (!active.current || !interaction.current || !rect) { onUpdateOverlayBBox(id, bbox); return; }
          let mode = interaction.current.mode;
          if (mode !== 'move') {
            // Handles may cross their opposite corner; keep snapping only the moving edges.
            const original = interaction.current.original;
            const fixedX = original.xRatio + (mode.includes('w') ? original.widthRatio : 0);
            const fixedY = original.yRatio + (mode.includes('n') ? original.heightRatio : 0);
            const horizontal = Math.abs(bbox.xRatio - fixedX) < Math.abs(bbox.xRatio + bbox.widthRatio - fixedX) ? 'e' : 'w';
            const vertical = Math.abs(bbox.yRatio - fixedY) < Math.abs(bbox.yRatio + bbox.heightRatio - fixedY) ? 's' : 'n';
            mode = `${vertical}${horizontal}` as SnapMode;
          }
          const snapped = snapOverlayBBox({ bbox, targets: elements.filter(element => element.id !== id).map(element => element.bbox), viewport: rect, crop, mode });
          setGuides(snapped.guides);
          onUpdateOverlayBBox(id, snapped.bbox);
        } : undefined}
        onInteractionStart={() => { active.current = true; onInteractionStart?.(); }}
        onInteractionEnd={() => {
          const pressed = tap.current;
          if (pressed && !pressed.moved && interaction.current) onUpdateOverlayBBox(interaction.current.id, interaction.current.original);
          active.current = false; interaction.current = null; tap.current = null;
          setGuides([]);
          onInteractionEnd?.();
          if (pressed?.edit && !pressed.moved) editTimer.current = setTimeout(() => beginEditingRef.current(pressed.id), 0);
        }}
        assets={assets}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1_000_001 }}>
        {shownGuides.map(guide => <span key={`${guide.axis}:${guide.coordinate}`} data-testid="overlay-snap-guide" className="absolute bg-blue-500" style={guide.axis === 'x' ? { left: `${local(guide.coordinate, 'x') * 100}%`, top: 0, width: 1, height: '100%' } : { top: `${local(guide.coordinate, 'y') * 100}%`, left: 0, height: 1, width: '100%' }} />)}
        {materialPreview ? <span data-testid="material-drop-preview" className="absolute border-2 border-blue-500 bg-blue-500/10" style={{ left: `${local(materialPreview.bbox.xRatio, 'x') * 100}%`, top: `${local(materialPreview.bbox.yRatio, 'y') * 100}%`, width: `${materialPreview.bbox.widthRatio / (crop?.widthRatio ?? 1) * 100}%`, height: `${materialPreview.bbox.heightRatio / (crop?.heightRatio ?? 1) * 100}%`, opacity: materialPreview.pending ? 0.5 : 1 }} /> : null}
      </div>
      {editing ? <InlineTextEditor key={editing.id} element={elements.find(element => element.id === editing.id && element.kind === 'TEXT') as InlineTextElement ?? editing} crop={crop}
        onDraftChange={onDraftChange}
        onCommit={element => onUpdateText?.(element)} onFinish={finishEditing}
        registerFlush={registerEditorFlush} /> : null}
      <OverlayRangeSelectionSurface data-kiosk-sop-target="assembly-document-editor-range-surface"
        selectionMode={selectionMode}
        pageIndex={pageIndex}
        crop={crop}
        onRangeSelected={onRangeSelected}
      />
    </div>
  );

  if (crop) {
    return (
      <AssemblyProcedureCropView
        pageUrl={pageUrl}
        crop={crop}
        className={clsx('h-full w-full', className)}
        overlay={overlay}
      />
    );
  }

  return (
    <AssemblyProcedureCanvas
      imageRelativePath={pageUrl}
      bolts={[]}
      checkItems={[]}
      placementAction="place"
      overlay={overlay}
      className={clsx('h-full w-full', className)}
    />
  );
});
