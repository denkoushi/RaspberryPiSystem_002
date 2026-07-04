import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';

import type { VisualizationDashboardEditor } from './useVisualizationDashboardEditor';

type VisualizationDashboardHeaderSectionProps = {
  editor: VisualizationDashboardEditor;
};

export function VisualizationDashboardHeaderSection({ editor }: VisualizationDashboardHeaderSectionProps) {
  return (
    <Card
      title="可視化ダッシュボード"
      action={
        <Button variant="secondary" onClick={() => editor.setIsCreating(true)}>
          新規作成
        </Button>
      }
    >
      <p className="text-sm text-slate-600">
        サイネージ向けの可視化ダッシュボード定義を管理します。データソースとレンダラーを組み合わせて表示内容を決めます。
      </p>
    </Card>
  );
}
