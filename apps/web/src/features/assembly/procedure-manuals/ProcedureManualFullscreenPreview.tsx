import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { assemblyProcedureDocumentPages } from '../assemblyTemplateDraft';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureSequenceDto, AssemblyProcedureSequencePageDto } from '../types';

export function procedureDocumentToSequence(document: AssemblyProcedureDocumentDto): AssemblyProcedureSequenceDto {
  const pages: AssemblyProcedureSequencePageDto[] = assemblyProcedureDocumentPages(document).map(page => ({
    source: 'assembly_procedure_document', documentId: document.id, pageIndex: page.pageIndex, pageUrl: page.imageRelativePath,
    overlays: document.pages.find(original => original.pageIndex === page.pageIndex)?.overlays
  }));
  return {
    mode: 'configured', source: 'primary_fallback', reason: null, machineName: '', machineNameKey: '',
    fallbackProcedureDocument: null, stepSource: 'document_expansion',
    documents: [{
      orderItemId: document.id, sortOrder: 0, label: null, documentType: 'assembly_procedure_document',
      assemblyProcedureDocumentId: document.id, kioskDocumentId: null, title: document.name, displayTitle: document.name,
      filename: document.name, confirmedDocumentNumber: null, confirmedSummaryText: null, pageCount: pages.length,
      updatedAt: document.updatedAt, pageUrls: pages.map(page => page.pageUrl), pages, assets: document.assets
    }]
  };
}

type Props = { sequence: AssemblyProcedureSequenceDto; title: string; onClose: () => void };

export function ProcedureManualFullscreenPreview({ sequence, title, onClose }: Props) {
  const [twoPages, setTwoPages] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(<div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 h-dvh w-full bg-[#0a0d10] text-[#eef3f6]">
    <AssemblyProcedureSequenceViewer sequence={sequence} layout="manuals" showCurrentMarkerButton={false} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(value => !value)} onClose={onClose} className="h-full w-full" />
  </div>, document.body);
}
