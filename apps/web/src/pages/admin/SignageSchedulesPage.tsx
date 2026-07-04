import { SignagePdfManager } from '../../components/signage/SignagePdfManager';
import { Card } from '../../components/ui/Card';
import { SignageScheduleEditorForm } from '../../features/admin/signage/SignageScheduleEditorForm';
import { SignageScheduleListTable } from '../../features/admin/signage/SignageScheduleListTable';
import { SignageScheduleToolbar } from '../../features/admin/signage/SignageScheduleToolbar';
import { useSignageScheduleEditor } from '../../features/admin/signage/useSignageScheduleEditor';

export function SignageSchedulesPage() {
  const editor = useSignageScheduleEditor();

  return (
    <div className="space-y-6">
      <SignagePdfManager title="サイネージPDFアップロード（サイネージタブ）" />

      <Card
        title="スケジュール管理"
        action={
          <SignageScheduleToolbar
            handleRender={editor.handleRender}
            renderMutation={editor.renderMutation}
            renderStatusQuery={editor.renderStatusQuery}
            handleCreate={editor.handleCreate}
            isCreating={editor.isCreating}
            editingId={editor.editingId}
          />
        }
      >
        <SignageScheduleEditorForm editor={editor} />

        <SignageScheduleListTable
          schedules={editor.schedulesQuery.data}
          clientsByApiKey={editor.clientsForSignageQuery.clientsByApiKey}
          onEdit={editor.handleEdit}
          onDelete={editor.handleDelete}
          isError={editor.schedulesQuery.isError}
          isLoading={editor.schedulesQuery.isLoading}
        />
      </Card>
    </div>
  );
}
