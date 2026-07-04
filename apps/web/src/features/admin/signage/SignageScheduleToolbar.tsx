import { Button } from '../../../components/ui/Button';

import type { SignageScheduleEditorController } from './useSignageScheduleEditor';

type SignageScheduleToolbarProps = Pick<
  SignageScheduleEditorController,
  'handleRender' | 'renderMutation' | 'renderStatusQuery' | 'handleCreate' | 'isCreating' | 'editingId'
>;

export function SignageScheduleToolbar({
  handleRender,
  renderMutation,
  renderStatusQuery,
  handleCreate,
  isCreating,
  editingId,
}: SignageScheduleToolbarProps) {
  if (isCreating || editingId) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleRender}
        disabled={renderMutation.isPending}
        variant="secondary"
      >
        {renderMutation.isPending ? 'レンダリング中...' : '再レンダリング'}
      </Button>
      {renderStatusQuery.data && (
        <span className="text-sm font-semibold text-slate-700">
          （自動更新: {renderStatusQuery.data.intervalSeconds}秒間隔）
        </span>
      )}
      <Button onClick={handleCreate}>新規作成</Button>
    </div>
  );
}
