import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

type Props = {
  isOpen: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AssemblyProcedureGmailImportConfirmDialog({
  isOpen,
  busy = false,
  onConfirm,
  onCancel
}: Props) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="Gmailから手順書を取り込みますか？"
      description="受信箱の対象添付を手順書ライブラリへ下書きとして登録します。登録後に内容を確認して公開してください。"
      confirmLabel={busy ? '取込中…' : 'Gmailから取り込む'}
      cancelLabel="戻る"
      confirmTarget="assembly-gmail-confirm"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
