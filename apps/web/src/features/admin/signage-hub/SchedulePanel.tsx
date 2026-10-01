import { useSignageScheduleMutations } from '../../../api/hooks';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { SignageScheduleEditorForm } from '../signage/SignageScheduleEditorForm';

import { PanelFrame } from './PanelFrame';

import type { useSignageScheduleEditor } from '../signage/useSignageScheduleEditor';

/**
 * 予定の追加・編集。入力欄は既存の SignageScheduleEditorForm をそのまま使い（設定項目を失わないため）、
 * 見た目だけを暗色パネルに合わせる（signageHub.css の .sh-legacy）。
 */
export function SchedulePanel({ editor }: { editor: ReturnType<typeof useSignageScheduleEditor> }) {
  const editingId = editor.editingId;
  const confirm = useConfirm();
  const { remove } = useSignageScheduleMutations();

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'この予定を削除しますか？',
      description: `「${editor.formData.name ?? ''}」を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!ok) return;
    await remove.mutateAsync(id);
    editor.handleCancel();
  };
  return (
    <PanelFrame
      title={editor.isCreating ? '予定を追加' : '予定を編集'}
      onBack={editor.handleCancel}
      headerAction={
        editingId ? (
          <button type="button" className="sh-icon-btn" style={{ color: '#ff8a8a' }} aria-label="この予定を削除" onClick={() => void handleDelete(editingId)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
            </svg>
          </button>
        ) : undefined
      }
    >
      <div className="sh-legacy">
        <SignageScheduleEditorForm editor={editor} />
      </div>
    </PanelFrame>
  );
}
