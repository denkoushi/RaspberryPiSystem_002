import { useMemo } from 'react';

import { useCsvImportSubjectPatterns, useCsvDashboards } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CsvImportScheduleCreateForm } from '../../features/admin/csv-import/CsvImportScheduleCreateForm';
import { CsvImportScheduleListSection } from '../../features/admin/csv-import/CsvImportScheduleListSection';
import { CsvImportScheduleWarningsBanner } from '../../features/admin/csv-import/CsvImportScheduleWarningsBanner';
import { CsvImportSubjectPatternSection } from '../../features/admin/csv-import/CsvImportSubjectPatternSection';
import { useCsvImportScheduleForm } from '../../features/admin/csv-import/useCsvImportScheduleForm';
import { useCsvImportScheduleRun } from '../../features/admin/csv-import/useCsvImportScheduleRun';

export function CsvImportSchedulePage() {
  const { data: subjectPatternData } = useCsvImportSubjectPatterns();
  const { data: csvDashboardsData } = useCsvDashboards({ enabled: true });

  const subjectPatterns = useMemo(
    () => subjectPatternData?.patterns ?? [],
    [subjectPatternData?.patterns]
  );

  const form = useCsvImportScheduleForm({ subjectPatterns });
  const run = useCsvImportScheduleRun({ schedules: form.schedules, refetch: form.refetch });

  if (form.isLoading) {
    return <Card title="CSVインポートスケジュール"><p className="text-sm font-semibold text-slate-700">読み込み中...</p></Card>;
  }

  return (
    <Card
      title="CSVインポートスケジュール"
      action={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={form.isLoading}
            onClick={() => form.refetch()}
          >
            一覧更新
          </Button>
          <Button
            onClick={form.openCreateForm}
            disabled={form.showCreateForm || form.editingId !== null}
          >
            新規作成
          </Button>
        </div>
      }
    >
      <CsvImportScheduleWarningsBanner warnings={form.displayedScheduleWarnings} />
      <CsvImportScheduleCreateForm form={form} csvDashboardsData={csvDashboardsData} />
      <CsvImportScheduleListSection form={form} run={run} csvDashboardsData={csvDashboardsData} />
      <CsvImportSubjectPatternSection />
    </Card>
  );
}
