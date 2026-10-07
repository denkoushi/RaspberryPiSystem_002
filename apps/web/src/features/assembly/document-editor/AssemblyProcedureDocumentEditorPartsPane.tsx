import { useEffect, useMemo, useRef } from 'react';

import { AssemblyProcedureOverlayLayer, assemblyProcedureOverlayElementLabel } from '../AssemblyProcedureOverlayLayer';

import { EditorIconButton } from './EditorIconButton';

import type { AssemblyProcedureOverlayAssetDto } from '../types';
import type { AssemblyProcedureOverlayBBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type Props = {
  elements: AssemblyProcedureOverlayElement[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  selectedOverlayId: string | null;
  hiddenOverlayIds: Set<string>;
  onSelect: (id: string) => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onToggleHidden: (id: string) => void;
  readOnly: boolean;
  busy: boolean;
};

function previewBounds(bbox: AssemblyProcedureOverlayBBox) {
  const xRatio = Math.max(0, bbox.xRatio - bbox.widthRatio * 0.06);
  const yRatio = Math.max(0, bbox.yRatio - bbox.heightRatio * 0.06);
  const widthRatio = Math.min(1, bbox.xRatio + bbox.widthRatio * 1.06) - xRatio;
  const heightRatio = Math.min(1, bbox.yRatio + bbox.heightRatio * 1.06) - yRatio;
  const crop = { xRatio, yRatio, widthRatio, heightRatio };
  const ratio = widthRatio / (heightRatio * 1.414);
  const width = Math.min(224, 96 * ratio);
  const height = width / ratio;
  return { crop, width, height };
}

export function AssemblyProcedureDocumentEditorPartsPane({ elements, assets, selectedOverlayId, hiddenOverlayIds, onSelect, onBringForward, onSendBackward, onToggleHidden, readOnly, busy }: Props) {
  const rows = useMemo(() => elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => b.element.zIndex - a.element.zIndex || b.index - a.index), [elements]);
  const selectedRow = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedOverlayId, rows]);
  const selectedIndex = rows.findIndex(({ element }) => element.id === selectedOverlayId);
  const disabled = selectedIndex < 0 || readOnly || busy;
  const hidden = selectedOverlayId != null && hiddenOverlayIds.has(selectedOverlayId);

  return <aside aria-label="部品" className="grid min-h-0 grid-rows-[auto_1fr_auto] border-r border-[#27313b] bg-[#161c22]">
    <div className="flex h-14 items-center gap-2.5 border-b border-[#27313b] pl-4 pr-3">
      <h2 className="text-[19px] font-black tracking-[0.06em]">部品</h2>
      <span className="font-mono text-base text-[#9fadb9]">{rows.length}</span>
    </div>
    <div role="listbox" aria-label="このページの部品" className="grid min-h-0 content-start gap-1.5 overflow-y-auto p-2">
      {rows.map(({ element }, index) => {
        const selected = element.id === selectedOverlayId;
        const { crop, width, height } = previewBounds(element.bbox);
        return <button
          key={element.id}
          ref={selected ? selectedRow : undefined}
          type="button"
          role="option"
          aria-selected={selected}
          aria-label={`${index + 1}: ${assemblyProcedureOverlayElementLabel(element)}`}
          onClick={() => onSelect(element.id)}
          className={`grid h-28 grid-cols-[minmax(0,1fr)_20px] items-center gap-1 rounded-[10px] border bg-white px-1 py-2 ${selected ? 'border-[#5fc3e8] ring-2 ring-[#5fc3e8]' : 'border-[#27313b] hover:border-[#344252]'} ${hiddenOverlayIds.has(element.id) ? 'opacity-40' : ''}`}
        >
          <span aria-hidden="true" className="pointer-events-none grid h-24 min-w-0 place-items-center overflow-hidden">
            <span className="grid min-h-6 min-w-6 max-w-full place-items-center bg-white" style={{ width: Math.max(24, width), height: Math.max(24, height) }}>
              <span className="relative block max-w-full bg-white" style={{ width, aspectRatio: `${crop.widthRatio} / ${crop.heightRatio * 1.414}` }}>
                <AssemblyProcedureOverlayLayer elements={[element]} assets={assets} crop={crop} className="pointer-events-none" />
              </span>
            </span>
          </span>
          <span className={`text-right font-mono text-sm ${selected ? 'text-[#5fc3e8]' : 'text-[#9fadb9]'}`}>{index + 1}</span>
        </button>;
      })}
    </div>
    <div className="grid grid-cols-3 gap-1.5 border-t border-[#27313b] p-2">
      <EditorIconButton label="前へ出す" icon={<path d="M6 14l6-6 6 6" />} onClick={() => selectedOverlayId && onBringForward(selectedOverlayId)} disabled={disabled || selectedIndex === 0} tipSide="top" className="w-full rounded-lg" />
      <EditorIconButton label="後ろへ下げる" icon={<path d="M6 10l6 6 6-6" />} onClick={() => selectedOverlayId && onSendBackward(selectedOverlayId)} disabled={disabled || selectedIndex === rows.length - 1} tipSide="top" className="w-full rounded-lg" />
      <EditorIconButton label={hidden ? '出す' : '隠す'} icon={<><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /></>} onClick={() => selectedOverlayId && onToggleHidden(selectedOverlayId)} disabled={disabled} tipSide="top" className="w-full rounded-lg" />
    </div>
  </aside>;
}
