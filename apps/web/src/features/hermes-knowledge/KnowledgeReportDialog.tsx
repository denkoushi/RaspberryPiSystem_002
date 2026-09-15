import { Dialog } from '../../components/ui/Dialog';

import { KnowledgeReportView, type KnowledgeReportViewProps } from './KnowledgeReportView';

export function KnowledgeReportDialog(props: KnowledgeReportViewProps & { isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog isOpen={props.isOpen} onClose={props.onClose} title="レポート" size="lg">
      <KnowledgeReportView report={props.report} imagePathFor={props.imagePathFor} />
      <button type="button" onClick={props.onClose} className="mt-4 rounded border border-slate-400 px-4 py-2">閉じる</button>
    </Dialog>
  );
}
