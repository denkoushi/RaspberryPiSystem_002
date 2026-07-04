import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import type { CsvImportSchedule, CsvImportSubjectPattern, CsvImportSubjectPatternType } from '../../../api/backup';
import type { CsvDashboard } from '../../../api/client';

type CsvImportTargetsEditorProps = {
  formData: Partial<CsvImportSchedule>;
  setFormData: (value: Partial<CsvImportSchedule>) => void;
  provider: CsvImportSchedule['provider'];
  patternsByType: Record<CsvImportSubjectPatternType, CsvImportSubjectPattern[]>;
  csvDashboards: CsvDashboard[] | undefined;
  editingId?: string | null;
  compact?: boolean;
  showHelpText?: boolean;
};

export function CsvImportTargetsEditor({
  formData,
  setFormData,
  provider,
  patternsByType,
  csvDashboards,
  editingId = null,
  compact = false,
  showHelpText = false
}: CsvImportTargetsEditorProps) {
  const selectClassName = compact
    ? 'flex-1 rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs'
    : 'flex-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900';
  const deleteButtonClassName = compact ? 'text-red-600 text-xs px-1 py-0.5' : 'text-red-600';
  const addButtonClassName = compact ? 'text-blue-600 text-xs px-1 py-0.5' : 'text-blue-600';
  const addButtonLabel = compact ? '+ 追加' : '+ 対象を追加';

  return (
    <>
      <div className={compact ? 'space-y-1' : 'space-y-2'}>
        {(formData.targets || []).map((target, index) => (
          <div key={index} className={compact ? 'flex gap-1' : 'flex gap-2'}>
            <select
              className={selectClassName}
              value={target.type}
              onChange={(e) => {
                const newTargets = [...(formData.targets || [])];
                newTargets[index] = { ...target, type: e.target.value as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines' | 'csvDashboards', source: '' };
                setFormData({ ...formData, targets: newTargets });
              }}
            >
              <option value="employees">従業員</option>
              <option value="items">アイテム</option>
              <option value="measuringInstruments">計測機器</option>
              <option value="riggingGears">吊具</option>
              <option value="machines">加工機</option>
              <option value="csvDashboards">CSVダッシュボード</option>
            </select>
            {target.type === 'csvDashboards' ? (
              <select
                className={selectClassName}
                value={target.source}
                onChange={(e) => {
                  const newTargets = [...(formData.targets || [])];
                  const selectedDashboardId = e.target.value;
                  newTargets[index] = { ...target, source: selectedDashboardId };

                  const selectedDashboard = (csvDashboards || []).find(d => d.id === selectedDashboardId);
                  if (compact) {
                    if (selectedDashboard && !editingId && !formData.id) {
                      const autoId = `csv-import-${selectedDashboard.name.toLowerCase().replace(/\s+/g, '-')}`;
                      setFormData({
                        ...formData,
                        id: autoId,
                        name: selectedDashboard.name ? `${selectedDashboard.name} (csvDashboards)` : formData.name,
                        targets: newTargets
                      });
                    } else {
                      setFormData({ ...formData, targets: newTargets });
                    }
                  } else if (selectedDashboard && !formData.id) {
                    const autoId = `csv-import-${selectedDashboard.name.toLowerCase().replace(/\s+/g, '-')}`;
                    setFormData({
                      ...formData,
                      id: autoId,
                      name: selectedDashboard.name ? `${selectedDashboard.name} (csvDashboards)` : undefined,
                      targets: newTargets
                    });
                  } else {
                    setFormData({ ...formData, targets: newTargets });
                  }
                }}
                required
              >
                <option value="">CSVダッシュボードを選択してください</option>
                {(csvDashboards || []).map((dashboard) => (
                  <option key={dashboard.id} value={dashboard.id}>
                    {dashboard.name}
                  </option>
                ))}
              </select>
            ) : provider === 'gmail' ? (
              <select
                className={selectClassName}
                value={target.source}
                onChange={(e) => {
                  const newTargets = [...(formData.targets || [])];
                  newTargets[index] = { ...target, source: e.target.value };
                  setFormData({ ...formData, targets: newTargets });
                }}
              >
                <option value="">選択してください</option>
                {(patternsByType[target.type as CsvImportSubjectPatternType] || []).map((pattern) => (
                  <option key={pattern.id} value={pattern.pattern}>
                    {pattern.pattern}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className={compact ? 'flex-1 text-xs' : 'flex-1'}
                placeholder={target.type === 'employees' ? '/backups/csv/employees.csv' : target.type === 'items' ? '/backups/csv/items.csv' : target.type === 'machines' ? '/backups/csv/machines.csv' : '/backups/csv/...'}
                value={target.source}
                onChange={(e) => {
                  const newTargets = [...(formData.targets || [])];
                  newTargets[index] = { ...target, source: e.target.value };
                  setFormData({ ...formData, targets: newTargets });
                }}
              />
            )}
            <Button
              variant="ghost"
              onClick={() => {
                const newTargets = (formData.targets || []).filter((_, i) => i !== index);
                setFormData({ ...formData, targets: newTargets });
              }}
              className={deleteButtonClassName}
            >
              削除
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={() => {
            setFormData({
              ...formData,
              targets: [...(formData.targets || []), { type: 'employees', source: '' }]
            });
          }}
          className={addButtonClassName}
        >
          {addButtonLabel}
        </Button>
      </div>
      {showHelpText && (
        <p className="mt-1 text-xs text-slate-600">
          {provider === 'gmail'
            ? 'Gmail検索用の件名パターン（設定された候補から選択）'
            : 'Dropboxのパス（例: /backups/csv/employees.csv）'}
        </p>
      )}
    </>
  );
}
