import { useEffect, useMemo, useState } from 'react';

import {
  useCsvImportSubjectPatterns,
  useCsvImportSubjectPatternMutations,
  useCsvDashboards
} from '../../../api/hooks';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

import type { CsvImportSubjectPattern, CsvImportSubjectPatternType } from '../../../api/backup';

const SUBJECT_PATTERN_TYPES: Array<{ value: CsvImportSubjectPatternType; label: string }> = [
  { value: 'employees', label: '従業員' },
  { value: 'items', label: 'アイテム' },
  { value: 'measuringInstruments', label: '計測機器' },
  { value: 'riggingGears', label: '吊具' },
  { value: 'machines', label: '加工機' },
  { value: 'csvDashboards', label: 'CSVダッシュボード' }
];

export function CsvImportSubjectPatternSection() {
  const { data: subjectPatternData, isLoading: isLoadingPatterns } = useCsvImportSubjectPatterns();
  const { create: createPattern, update: updatePattern, remove: removePattern } =
    useCsvImportSubjectPatternMutations();
  const { data: csvDashboardsData } = useCsvDashboards({ enabled: true });

  const [patternDrafts, setPatternDrafts] = useState<CsvImportSubjectPattern[]>([]);
  const [subjectPatternDashboardId, setSubjectPatternDashboardId] = useState<string>('');
  const [newPatternDrafts, setNewPatternDrafts] = useState<Record<CsvImportSubjectPatternType, {
    pattern: string;
    priority: number;
    enabled: boolean;
  }>>({
    employees: { pattern: '', priority: 0, enabled: true },
    items: { pattern: '', priority: 0, enabled: true },
    measuringInstruments: { pattern: '', priority: 0, enabled: true },
    riggingGears: { pattern: '', priority: 0, enabled: true },
    machines: { pattern: '', priority: 0, enabled: true },
    csvDashboards: { pattern: '', priority: 0, enabled: true }
  });

  const subjectPatterns = useMemo(
    () => subjectPatternData?.patterns ?? [],
    [subjectPatternData?.patterns]
  );

  useEffect(() => {
    if (subjectPatternDashboardId) return;
    if (csvDashboardsData && csvDashboardsData.length > 0) {
      setSubjectPatternDashboardId(csvDashboardsData[0].id);
    }
  }, [csvDashboardsData, subjectPatternDashboardId]);

  useEffect(() => {
    setPatternDrafts(subjectPatterns.map((pattern) => ({ ...pattern })));
  }, [subjectPatterns]);

  return (
    <div className="mt-8">
      <Card title="Gmail件名パターン管理（DB）">
        {isLoadingPatterns ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
        ) : (
          <div className="space-y-6">
            {SUBJECT_PATTERN_TYPES.map((type) => {
              const typePatterns = patternDrafts.filter((p) => {
                if (p.importType !== type.value) return false;
                if (type.value === 'csvDashboards') {
                  return p.dashboardId === subjectPatternDashboardId;
                }
                return true;
              });
              const newDraft = newPatternDrafts[type.value];
              return (
                <div key={type.value} className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700">{type.label}</h4>
                  {type.value === 'csvDashboards' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs font-semibold text-slate-600">対象ダッシュボード</label>
                      <select
                        className="min-w-[220px] rounded-md border-2 border-slate-500 bg-white p-2 text-xs font-semibold text-slate-900"
                        value={subjectPatternDashboardId}
                        onChange={(e) => setSubjectPatternDashboardId(e.target.value)}
                      >
                        <option value="">選択してください</option>
                        {(csvDashboardsData || []).map((dashboard) => (
                          <option key={dashboard.id} value={dashboard.id}>
                            {dashboard.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {typePatterns.length === 0 ? (
                    <p className="text-xs text-slate-600">登録済みの件名パターンがありません</p>
                  ) : (
                    <div className="space-y-2">
                      {typePatterns.map((pattern) => (
                        <div key={pattern.id} className="flex flex-wrap items-center gap-2">
                          <Input
                            className="min-w-[220px] flex-1"
                            value={pattern.pattern}
                            onChange={(e) => {
                              const value = e.target.value;
                              setPatternDrafts((prev) =>
                                prev.map((item) =>
                                  item.id === pattern.id ? { ...item, pattern: value } : item
                                )
                              );
                            }}
                          />
                          <Input
                            type="number"
                            className="w-24"
                            value={pattern.priority}
                            onChange={(e) => {
                              const value = Number(e.target.value || 0);
                              setPatternDrafts((prev) =>
                                prev.map((item) =>
                                  item.id === pattern.id ? { ...item, priority: value } : item
                                )
                              );
                            }}
                          />
                          <label className="flex items-center gap-1 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={pattern.enabled}
                              onChange={(e) => {
                                const value = e.target.checked;
                                setPatternDrafts((prev) =>
                                  prev.map((item) =>
                                    item.id === pattern.id ? { ...item, enabled: value } : item
                                  )
                                );
                              }}
                              className="rounded border-2 border-slate-500"
                            />
                            有効
                          </label>
                          <Button
                            className="px-3 py-1 text-xs"
                            onClick={() =>
                              updatePattern.mutateAsync({
                                id: pattern.id,
                                data: {
                                  pattern: pattern.pattern,
                                  priority: pattern.priority,
                                  enabled: pattern.enabled
                                }
                              })
                            }
                            disabled={updatePattern.isPending}
                          >
                            {updatePattern.isPending ? '保存中...' : '保存'}
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-3 py-1 text-xs text-red-600"
                            onClick={() => {
                              if (confirm('この件名パターンを削除しますか？')) {
                                removePattern.mutateAsync(pattern.id);
                              }
                            }}
                            disabled={removePattern.isPending}
                          >
                            削除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="min-w-[220px] flex-1"
                      placeholder="件名パターンを入力"
                      value={newDraft.pattern}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewPatternDrafts((prev) => ({
                          ...prev,
                          [type.value]: { ...prev[type.value], pattern: value }
                        }));
                      }}
                    />
                    <Input
                      type="number"
                      className="w-24"
                      value={newDraft.priority}
                      onChange={(e) => {
                        const value = Number(e.target.value || 0);
                        setNewPatternDrafts((prev) => ({
                          ...prev,
                          [type.value]: { ...prev[type.value], priority: value }
                        }));
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={newDraft.enabled}
                        onChange={(e) => {
                          const value = e.target.checked;
                          setNewPatternDrafts((prev) => ({
                            ...prev,
                            [type.value]: { ...prev[type.value], enabled: value }
                          }));
                        }}
                        className="rounded border-2 border-slate-500"
                      />
                      有効
                    </label>
                    <Button
                      variant="ghost"
                      className="px-3 py-1 text-xs text-blue-600"
                      onClick={async () => {
                        if (!newDraft.pattern.trim()) {
                          alert('件名パターンを入力してください');
                          return;
                        }
                        if (type.value === 'csvDashboards' && !subjectPatternDashboardId) {
                          alert('CSVダッシュボードを選択してください');
                          return;
                        }
                        await createPattern.mutateAsync({
                          importType: type.value,
                          dashboardId: type.value === 'csvDashboards' ? subjectPatternDashboardId : undefined,
                          pattern: newDraft.pattern.trim(),
                          priority: newDraft.priority,
                          enabled: newDraft.enabled
                        });
                        setNewPatternDrafts((prev) => ({
                          ...prev,
                          [type.value]: { ...prev[type.value], pattern: '' }
                        }));
                      }}
                      disabled={createPattern.isPending}
                    >
                      {createPattern.isPending ? '追加中...' : '+ 追加'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
