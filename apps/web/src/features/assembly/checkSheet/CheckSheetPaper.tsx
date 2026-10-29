import { useEffect, useState } from 'react';

import { getAssemblyCheckSheetPaperLayout } from '../../../api/domains/assembly/check-sheets';
import { getApiErrorMessage } from '../../../api/errors';
import { Dialog } from '../../../components/ui/Dialog';

import type { AssemblyCheckSheetLayout, AssemblyCheckSheetPaperLayout } from '@raspi-system/shared-types';
import type { CSSProperties } from 'react';

type Range = AssemblyCheckSheetLayout['range'];
function address(row: number, col: number) {
  let letters = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return `${letters}${row}`;
}
function border(style?: string) { return style === 'medium' ? '2px solid #222' : style === 'thin' ? '1px solid #222' : 'none'; }

function PaperTable({ data }: { data: AssemblyCheckSheetPaperLayout }) {
  const { layoutSnapshot: layout } = data;
  const { range, cells } = layout;
  const writes = new Map(data.writes.map((write) => [write.cell, write.text]));
  const stamps = new Set(data.stampCells);
  const covered = new Map<string, Range>();
  for (const merge of layout.merges) {
    for (let row = Math.max(merge.top, range.top); row <= Math.min(merge.bottom, range.bottom); row++) {
      for (let col = Math.max(merge.left, range.left); col <= Math.min(merge.right, range.right); col++) covered.set(address(row, col), merge);
    }
  }
  return <table className="check-sheet-paper-table" aria-label="紙の控え" style={{ width: layout.columnWidths.reduce((a, b) => a + b, 0) }}>
    <colgroup>{layout.columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
    <tbody>{layout.rowHeights.map((height, rowIndex) => {
      const row = range.top + rowIndex;
      return <tr key={row} style={{ height, display: height ? undefined : 'none' }}>{layout.columnWidths.map((width, colIndex) => {
        const col = range.left + colIndex;
        const cellAddress = address(row, col);
        const merge = covered.get(cellAddress);
        if (merge && (row !== Math.max(merge.top, range.top) || col !== Math.max(merge.left, range.left))) return null;
        const master = merge ? address(merge.top, merge.left) : cellAddress;
        const cell = cells[master] ?? {};
        const text = writes.get(master) ?? cell.text ?? '';
        const rowSpan = merge ? Math.min(merge.bottom, range.bottom) - row + 1 : 1;
        const colSpan = merge ? Math.min(merge.right, range.right) - col + 1 : 1;
        const cellWidth = layout.columnWidths.slice(colIndex, colIndex + colSpan).reduce((a, b) => a + b, 0);
        const cellHeight = layout.rowHeights.slice(rowIndex, rowIndex + rowSpan).reduce((a, b) => a + b, 0);
        const bottom = cells[address(row + rowSpan - 1, col)]?.borders?.bottom ?? cell.borders?.bottom;
        const right = cells[address(row, col + colSpan - 1)]?.borders?.right ?? cell.borders?.right;
        const seal = stamps.has(master) && writes.has(master);
        const match = text.match(/^(.*?) (\d+\/\d+) (\d+:\d+)$/);
        const mark = text.match(/^(該当なし|NG) (.*)$/);
        const diameter = Math.max(1, Math.min(cellWidth, cellHeight) - 4);
        return <td key={col} rowSpan={rowSpan} colSpan={colSpan} style={{
          ...(cellWidth ? { borderTop: border(cell.borders?.top), borderLeft: border(cell.borders?.left),
            borderBottom: border(bottom), borderRight: border(right) } : { border: 'none' })
        }}>{cellWidth > 0 && <div className="check-sheet-paper-cell" style={{
          fontSize: `${cell.fontSize ?? 11}pt`, fontWeight: cell.bold ? 700 : 400,
          textAlign: cell.horizontal ?? 'left', whiteSpace: cell.wrap ? 'pre-wrap' : 'pre',
          justifyContent: cell.vertical === 'top' ? 'flex-start' : cell.vertical === 'middle' ? 'center' : 'flex-end'
        }}>{seal ? <span className="seal paper-seal" aria-label={text} style={{ width: diameter, height: diameter, fontSize: diameter / 4 }}>
          <span>{mark && <span className="paper-seal-status">{mark[1]}</span>}<span>{match?.[1] ?? mark?.[2] ?? text}</span>
            {match && <span className="paper-seal-time">{match[2]}<br />{match[3]}</span>}</span>
        </span> : <span>{text}</span>}</div>}</td>;
      })}</tr>;
    })}</tbody>
  </table>;
}

export function CheckSheetPaper({ sheetId, onClose }: { sheetId: string; onClose: () => void }) {
  const [data, setData] = useState<AssemblyCheckSheetPaperLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    let active = true;
    void getAssemblyCheckSheetPaperLayout(sheetId).then((value) => { if (active) setData(value); })
      .catch((reason: unknown) => { if (active) setError(getApiErrorMessage(reason, '紙の控えを取得できませんでした')); });
    return () => { active = false; };
  }, [sheetId]);
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const width = data?.layoutSnapshot.columnWidths.reduce((a, b) => a + b, 0) || 1;
  const height = data?.layoutSnapshot.rowHeights.reduce((a, b) => a + b, 0) || 1;
  const scale = Math.max(0.01, Math.min((viewport.width - 32) / width, (viewport.height - 88) / height));
  return <Dialog isOpen onClose={onClose} ariaLabel="紙の控え" size="full" closeOnBackdrop={false} overlayZIndex={1200}
    overlayClassName="assembly-check-sheet check-sheet-paper-overlay" className="check-sheet-paper-panel" lockScroll={false}>
    <div className="check-sheet-paper-actions">
      <button className="btn" type="button" disabled={!data} onClick={() => window.print()}>印刷</button>
      <button className="btn" type="button" onClick={onClose}>閉じる</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="check-sheet-paper-viewport" aria-busy={!data && !error}>
      {data && <div className="check-sheet-paper-page" style={{ width: width * scale, height: height * scale,
        '--paper-print-scale': Math.min(718 / width, 1040 / height) } as CSSProperties}>
        <div className="check-sheet-paper-content" style={{ width, height, transform: `scale(${scale})` }}><PaperTable data={data} /></div>
      </div>}
    </div>
  </Dialog>;
}
