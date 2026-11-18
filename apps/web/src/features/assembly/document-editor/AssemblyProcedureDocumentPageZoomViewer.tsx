import { useEffect, useRef } from 'react';

import { Dialog } from '../../../components/ui/Dialog';

import { AssemblyProcedureDocumentEditorPagePreview } from './AssemblyProcedureDocumentEditorPageList';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentPageDto } from '../types';

const controlClassName = 'rounded-xl border border-[#344252] bg-[#161c22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8]';
const navClassName = `${controlClassName} grid h-[120px] w-[72px] place-items-center justify-self-center disabled:opacity-30`;

export function AssemblyProcedureDocumentPageZoomViewer({
  page, assets, index, total, selection, onNavigate, onClose
}: {
  page: AssemblyProcedureDocumentPageDto;
  assets: AssemblyProcedureDocumentDto['assets'];
  index: number;
  total: number;
  selection?: { order: number; onToggle: () => void };
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasPrevious = index > 0;
  const hasNext = index < total - 1;
  const order = selection?.order ?? 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' && hasPrevious) onNavigate(index - 1);
      if (event.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasPrevious, hasNext, index, onNavigate]);

  return (
    <Dialog isOpen ariaLabel={`${page.pageIndex + 1}ページ目`} onClose={onClose} closeOnBackdrop={false}
      lockScroll={false} initialFocusRef={closeRef} overlayZIndex={60}
      overlayClassName="!items-center !bg-[rgba(5,8,10,.94)] !p-0"
      className="!m-0 !max-h-none !max-w-none !border-0 !bg-transparent !p-0 !text-[#eef3f6] !shadow-none"
    >
      <div className="relative grid h-dvh grid-cols-[96px_minmax(0,1fr)_96px] items-center">
        <button type="button" aria-label="前のページ" disabled={!hasPrevious} className={navClassName}
          onClick={() => onNavigate(index - 1)}>
          <Chevron />
        </button>
        <div className={`relative w-[min(calc(92dvh/1.414),100%)] justify-self-center rounded ${order > 0 ? 'outline outline-4 outline-offset-4 outline-[#5fc3e8]' : ''}`}>
          <AssemblyProcedureDocumentEditorPagePreview page={page} assets={assets} />
          {order > 0 ? (
            <span className="absolute right-3 top-3 grid h-10 min-w-10 place-items-center rounded-full bg-[#5fc3e8] px-1 font-mono text-[22px] font-bold text-[#0a0d10]">{order}</span>
          ) : null}
        </div>
        <button type="button" aria-label="次のページ" disabled={!hasNext} className={navClassName}
          onClick={() => onNavigate(index + 1)}>
          <Chevron next />
        </button>
        <button ref={closeRef} type="button" aria-label="閉じる" onClick={onClose}
          className={`absolute right-5 top-5 h-16 w-16 text-3xl text-[#9fadb9] ${controlClassName}`}>×</button>
        <div className="absolute bottom-5 right-5 flex w-[200px] flex-col gap-2.5">
          <span className="text-center font-mono text-[22px] font-bold text-[#9fadb9]">{index + 1} / {total}</span>
          {selection ? (
            <button type="button" aria-pressed={order > 0} onClick={selection.onToggle}
              className={`h-16 rounded-xl border-2 border-[#5fc3e8] text-xl font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5fc3e8] ${order > 0 ? 'bg-[#5fc3e8] text-[#0a0d10]' : 'bg-[#0a0d10] text-[#5fc3e8]'}`}>
              {order > 0 ? '選択を外す' : '選ぶ'}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function Chevron({ next = false }: { next?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[34px] w-[34px]" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={next ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} />
    </svg>
  );
}
