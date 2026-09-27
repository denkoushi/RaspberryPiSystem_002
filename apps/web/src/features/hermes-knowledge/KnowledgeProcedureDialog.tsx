import { Dialog } from '../../components/ui/Dialog';

import { KnowledgeProcedureView, type KnowledgeProcedureViewProps } from './KnowledgeProcedureView';

export function knowledgeProcedureImagePath(procedureId: string, imageId: string) {
  return `/api/hermes-knowledge/procedures/${encodeURIComponent(procedureId)}/images/${encodeURIComponent(imageId)}`;
}

export function KnowledgeProcedureDialog(props: Omit<KnowledgeProcedureViewProps, 'imagePathFor'> & { isOpen: boolean; onClose: () => void }) {
  const { isOpen, onClose, procedure, onReportError } = props;
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="手順書" size="lg">
      <KnowledgeProcedureView procedure={procedure} onReportError={onReportError}
        imagePathFor={imageId => knowledgeProcedureImagePath(procedure.procedureId, imageId)} />
      <button type="button" onClick={onClose} className="mt-4 rounded border border-slate-400 px-4 py-2">閉じる</button>
    </Dialog>
  );
}
