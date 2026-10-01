import { useMemo, useState } from 'react';

import { useCsvImportSubjectPatterns, useCsvDashboards } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { CsvImportScheduleBoard, boardButtonClassName } from '../../features/admin/csv-import/CsvImportScheduleBoard';
import { CsvImportScheduleCreateForm } from '../../features/admin/csv-import/CsvImportScheduleCreateForm';
import { CsvImportScheduleDetailDialog } from '../../features/admin/csv-import/CsvImportScheduleDetailDialog';
import { CsvImportScheduleInspector } from '../../features/admin/csv-import/CsvImportScheduleInspector';
import { CsvImportSubjectPatternSection } from '../../features/admin/csv-import/CsvImportSubjectPatternSection';
import { useCsvImportScheduleBoard } from '../../features/admin/csv-import/useCsvImportScheduleBoard';
import { useCsvImportScheduleForm } from '../../features/admin/csv-import/useCsvImportScheduleForm';
import { useCsvImportScheduleRun } from '../../features/admin/csv-import/useCsvImportScheduleRun';

export function CsvImportSchedulePage() {
  const { data: subjectPatternData } = useCsvImportSubjectPatterns();
  const { data: csvDashboardsData } = useCsvDashboards({ enabled: true });
  const [showPatterns, setShowPatterns] = useState(false);

  const subjectPatterns = useMemo(
    () => subjectPatternData?.patterns ?? [],
    [subjectPatternData?.patterns]
  );

  const form = useCsvImportScheduleForm({ subjectPatterns });
  const run = useCsvImportScheduleRun({ schedules: form.schedules, refetch: form.refetch });
  const board = useCsvImportScheduleBoard(form.schedules);

  if (form.isLoading) {
    return <Card title="取込スケジュール"><p className="text-sm font-semibold text-slate-700">読み込み中...</p></Card>;
  }

  const selectedSchedule = form.schedules.find((schedule) => schedule.id === board.selected?.id);

  return (
    <Card>
      <CsvImportScheduleBoard
        board={board}
        actions={
          <>
            <button type="button" className={boardButtonClassName} onClick={board.runAutoAdjust}>
              自動調整
            </button>
            {board.dirtyIds.length > 1 && (
              <button type="button" className={boardButtonClassName} onClick={() => board.revert()}>
                すべて戻す
              </button>
            )}
            <button type="button" className={boardButtonClassName} onClick={() => setShowPatterns(true)}>
              件名
            </button>
            <button type="button" className={boardButtonClassName} onClick={form.openCreateForm}>
              ＋ 新規
            </button>
          </>
        }
        inspector={
          selectedSchedule ? (
            <CsvImportScheduleInspector
              board={board}
              scheduleId={selectedSchedule.id}
              cron={selectedSchedule.schedule}
              isRunning={run.runningScheduleId === selectedSchedule.id}
              runDisabled={run.runningScheduleId !== null || !selectedSchedule.enabled}
              runMessage={run.runMessage[selectedSchedule.id]}
              runError={run.runError[selectedSchedule.id]}
              onRun={() => run.handleRun(selectedSchedule.id)}
              onOpenDetail={() => form.startEdit(selectedSchedule)}
            />
          ) : (
            <p className="rounded-xl border border-slate-300 p-4 text-sm text-slate-600">スケジュールがありません</p>
          )
        }
      />

      <Dialog isOpen={form.showCreateForm} onClose={form.handleCancelCreate} ariaLabel="新規スケジュール作成" size="lg">
        <CsvImportScheduleCreateForm form={form} csvDashboardsData={csvDashboardsData} />
      </Dialog>
      <CsvImportScheduleDetailDialog form={form} csvDashboardsData={csvDashboardsData} />
      <Dialog isOpen={showPatterns} onClose={() => setShowPatterns(false)} ariaLabel="件名パターン" size="lg">
        <CsvImportSubjectPatternSection />
      </Dialog>
    </Card>
  );
}
