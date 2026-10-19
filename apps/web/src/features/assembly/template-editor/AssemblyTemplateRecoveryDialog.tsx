import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

import type { AssemblyTemplateEditorRecoveryV1 } from '../assemblyTemplateEditorRecovery';

export function AssemblyTemplateRecoveryDialog({
  pending,
  onRestore,
  onDiscard
}: {
  pending: AssemblyTemplateEditorRecoveryV1 | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (!pending) return null;
  return (
    <ConfirmDialog
      isOpen
      title="途中内容を復元しますか？"
      description={`このブラウザに${new Date(pending.savedAt).toLocaleString('ja-JP')}保存された未完了の内容があります。復元しない場合は破棄されます。`}
      confirmLabel="途中内容を復元"
      cancelLabel="破棄"
      onConfirm={onRestore}
      onCancel={onDiscard}
    />
  );
}
