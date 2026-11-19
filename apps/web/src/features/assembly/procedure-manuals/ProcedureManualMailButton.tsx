import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { getAssemblyProcedureDocument } from '../../../api/client';

import { ProcedureManualMailDialog } from './ProcedureManualMailDialog';

import type { AssemblyProcedureSequenceDocumentDto } from '../types';

type Props = {
  documentId: string;
  revisionId: string;
  document: AssemblyProcedureSequenceDocumentDto;
  domain: string;
};

export function ProcedureManualMailButton({ documentId, revisionId, document, domain }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { data: revision } = useQuery({
    queryKey: ['assembly-procedure-mail-revision', revisionId],
    queryFn: () => getAssemblyProcedureDocument(revisionId),
    retry: false
  });
  if (!revision || revision.id !== revisionId || revision.status !== 'published' || !revision.isActive
    || revision.isRevisionHead === false || (revision.revisionRootId ?? revision.id) !== documentId) return null;

  return <>
    <button ref={trigger} type="button" aria-label="メールで送る" title="メールで送る" onClick={() => setOpen(true)}
      className="order-last mt-auto grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#7cc4ff] bg-[#7cc4ff1f] text-[#7cc4ff]">
      <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
      </svg>
    </button>
    {open ? <ProcedureManualMailDialog
      documentId={documentId}
      revision={revision}
      firstPage={document.pages[0]!}
      pageCount={document.pages.length}
      assets={document.assets}
      domain={domain}
      onClose={() => {
        setOpen(false);
        trigger.current?.focus();
      }}
    /> : null}
  </>;
}
