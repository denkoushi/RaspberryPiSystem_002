import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { AssemblyProcedureOverlayLayer, assemblyProcedureOverlayElementLabel } from '../AssemblyProcedureOverlayLayer';

import { EditorIconButton } from './EditorIconButton';

import type { AssemblyProcedureOverlayAssetDto } from '../types';
import type { AssemblyProcedureOverlayBBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type Props = {
  elements: AssemblyProcedureOverlayElement[];
  pageIndex: number;
  onDuplicate: (id: string) => void;
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

export function AssemblyProcedureDocumentEditorPartsPane({ elements, pageIndex, onDuplicate, assets, selectedOverlayId, hiddenOverlayIds, onSelect, onBringForward, onSendBackward, onToggleHidden, readOnly, busy }: Props) {
  const [source, setSource] = useState<'current' | 'other'>('current');
  const sorted = useMemo(() => elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => b.element.zIndex - a.element.zIndex || b.index - a.index), [elements]);
  const currentRows = sorted.filter(({ element }) => element.pageIndex === pageIndex);
  const otherRows = sorted.filter(({ element }) => element.pageIndex !== pageIndex)
    .sort((a, b) => a.element.pageIndex - b.element.pageIndex);
  const rows = source === 'current' ? currentRows : otherRows;
  const selectedRow = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedOverlayId, sorted, source, pageIndex]);
  const selectedIndex = rows.findIndex(({ element }) => element.id === selectedOverlayId);
  const disabled = selectedIndex < 0 || readOnly || busy;
  const hidden = selectedOverlayId != null && hiddenOverlayIds.has(selectedOverlayId);

  return <aside aria-label="部品" className="grid min-h-0 grid-rows-[56px_minmax(0,1fr)_auto] border-r border-[#27313b] bg-[#161c22]">
    <div className="flex h-14 items-center gap-2.5 border-b border-[#27313b] pl-4 pr-3">
      <h2 className="whitespace-nowrap text-[19px] font-black tracking-[0.06em]">部品</h2>
      <div role="group" aria-label="部品の表示元" className="flex w-max gap-0.5 rounded-lg border border-[#344252] p-[3px]">
        {(['current', 'other'] as const).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)} className={`h-[34px] whitespace-nowrap rounded-[5px] px-2 text-sm ${source === value ? 'bg-[#27313b] text-[#eef3f6]' : 'text-[#9fadb9]'}`}>
          {value === 'current' ? 'このページ' : 'ほか'}<span className="ml-[5px] font-mono text-[#9fadb9]">{value === 'current' ? currentRows.length : otherRows.length}</span>
        </button>)}
      </div>
    </div>
    <div role="listbox" aria-label={source === 'current' ? 'このページの部品' : 'ほかのページの部品'} className="grid min-h-0 content-start gap-1.5 overflow-y-auto p-2">
      {rows.map(({ element }, index) => {
        const selected = source === 'current' && element.id === selectedOverlayId;
        const pageStart = rows.findIndex(row => row.element.pageIndex === element.pageIndex);
        const number = index - pageStart + 1;
        const { crop, width, height } = previewBounds(element.bbox);
        return <Fragment key={element.id}>
          {source === 'other' && index === pageStart ? <h3 className="mb-0.5 mt-1 px-1 font-mono text-[15px] text-[#9fadb9]">p{element.pageIndex + 1}</h3> : null}
          <button
          ref={selected ? selectedRow : undefined}
          type="button"
          role="option"
          aria-selected={selected}
          aria-label={source === 'current' ? `${number}: ${assemblyProcedureOverlayElementLabel(element)}` : `p${element.pageIndex + 1}から置く: ${assemblyProcedureOverlayElementLabel(element)}`}
          disabled={source === 'other' && (readOnly || busy)}
          onClick={() => {
            if (source === 'other') {
              onDuplicate(element.id);
              setSource('current');
            } else onSelect(element.id);
          }}
          className={`grid h-28 grid-cols-[minmax(0,1fr)_20px] items-center gap-1 rounded-[10px] border bg-white px-1 py-2 ${selected ? 'border-[#5fc3e8] ring-2 ring-[#5fc3e8]' : 'border-[#27313b] hover:border-[#344252]'} ${hiddenOverlayIds.has(element.id) ? 'opacity-40' : ''} disabled:cursor-default disabled:opacity-40`}
        >
          <span aria-hidden="true" className="pointer-events-none grid h-24 min-w-0 place-items-center overflow-hidden">
            <span className="grid min-h-6 min-w-6 max-w-full place-items-center bg-white" style={{ width: Math.max(24, width), height: Math.max(24, height) }}>
              <span className="relative block max-w-full bg-white" style={{ width, aspectRatio: `${crop.widthRatio} / ${crop.heightRatio * 1.414}` }}>
                <AssemblyProcedureOverlayLayer elements={[element]} assets={assets} crop={crop} className="pointer-events-none" />
              </span>
            </span>
          </span>
          <span className={`text-right font-mono text-sm ${selected ? 'text-[#5fc3e8]' : 'text-[#9fadb9]'}`}>{number}</span>
        </button></Fragment>;
      })}
    </div>
    {source === 'current' ? <div className="grid grid-cols-3 gap-1.5 border-t border-[#27313b] p-2">
      <EditorIconButton label="前へ出す" icon={<path d="M6 14l6-6 6 6" />} onClick={() => selectedOverlayId && onBringForward(selectedOverlayId)} disabled={disabled || selectedIndex === 0} tipSide="top" className="w-full rounded-lg" />
      <EditorIconButton label="後ろへ下げる" icon={<path d="M6 10l6 6 6-6" />} onClick={() => selectedOverlayId && onSendBackward(selectedOverlayId)} disabled={disabled || selectedIndex === rows.length - 1} tipSide="top" className="w-full rounded-lg" />
      <EditorIconButton label={hidden ? '出す' : '隠す'} icon={<><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /></>} onClick={() => selectedOverlayId && onToggleHidden(selectedOverlayId)} disabled={disabled} tipSide="top" className="w-full rounded-lg" />
    </div> : null}
  </aside>;
}
