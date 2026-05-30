import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../types';

type Props = {
  isOpen: boolean;
  templateName: string;
  templates: KioskInspectionDrawingTemplateSummaryDto[];
  onClose: () => void;
  onOpen: (template: KioskInspectionDrawingTemplateSummaryDto) => void;
};

export function InspectionDrawingTemplateHistoryDialog({
  isOpen,
  templateName,
  templates,
  onClose,
  onOpen
}: Props) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="履歴"
      description={`${templateName} の版一覧`}
      size="lg"
    >
      <div className="mt-3 grid gap-2">
        {templates.map((template) => (
          <div
            key={template.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3"
          >
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">
                v{template.version} {template.isActive ? '有効' : '履歴'}
              </p>
              <p className="text-sm text-slate-600">
                {template.itemCount} 点 / {template.visualTemplate?.name ?? '図面未設定'}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => onOpen(template)}>
              {template.isActive ? '編集' : '表示'}
            </Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
