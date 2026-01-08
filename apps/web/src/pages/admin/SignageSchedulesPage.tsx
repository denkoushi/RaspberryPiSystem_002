import { useState } from 'react';

import {
  useSignageSchedules,
  useSignageScheduleMutations,
  useSignagePdfs,
  useSignageRenderMutation,
  useSignageRenderStatus,
  useCsvDashboards
} from '../../api/hooks';
import { SignagePdfManager } from '../../components/signage/SignagePdfManager';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { SignageSchedule, SignagePdf, SignageLayoutConfig, SignageSlot, CsvDashboard } from '../../api/client';

const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

export function SignageSchedulesPage() {
  const schedulesQuery = useSignageSchedules();
  const pdfsQuery = useSignagePdfs();
  const csvDashboardsQuery = useCsvDashboards({ enabled: true });
  const { create, update, remove } = useSignageScheduleMutations();
  const renderMutation = useSignageRenderMutation();
  const renderStatusQuery = useSignageRenderStatus();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<SignageSchedule>>({
    name: '',
    contentType: 'TOOLS',
    pdfId: null,
    layoutConfig: null,
    dayOfWeek: [],
    startTime: '09:00',
    endTime: '18:00',
    priority: 0,
    enabled: true,
  });
  const [useNewLayout, setUseNewLayout] = useState(false); // 新形式を使用するか
  const [layoutType, setLayoutType] = useState<'FULL' | 'SPLIT'>('FULL'); // レイアウトタイプ
  const [leftSlotKind, setLeftSlotKind] = useState<'loans' | 'pdf' | 'csv_dashboard'>('loans'); // 左スロットの種類
  const [rightSlotKind, setRightSlotKind] = useState<'loans' | 'pdf' | 'csv_dashboard'>('pdf'); // 右スロットの種類
  const [leftPdfId, setLeftPdfId] = useState<string | null>(null); // 左スロットのPDF（kind='pdf'の場合）
  const [rightPdfId, setRightPdfId] = useState<string | null>(null); // 右スロットのPDF（kind='pdf'の場合）
  const [leftCsvDashboardId, setLeftCsvDashboardId] = useState<string | null>(null); // 左スロットのCSVダッシュボード（kind='csv_dashboard'の場合）
  const [rightCsvDashboardId, setRightCsvDashboardId] = useState<string | null>(null); // 右スロットのCSVダッシュボード（kind='csv_dashboard'の場合）
  const [fullSlotKind, setFullSlotKind] = useState<'loans' | 'pdf' | 'csv_dashboard'>('loans'); // 全体スロットの種類
  const [fullPdfId, setFullPdfId] = useState<string | null>(null); // 全体スロットのPDF（kind='pdf'の場合）
  const [fullCsvDashboardId, setFullCsvDashboardId] = useState<string | null>(null); // 全体スロットのCSVダッシュボード（kind='csv_dashboard'の場合）

  const handleCreate = () => {
    setIsCreating(true);
    setUseNewLayout(false);
    setLayoutType('FULL');
    setFullSlotKind('loans');
    setLeftSlotKind('loans');
    setRightSlotKind('pdf');
    setFullPdfId(null);
    setLeftPdfId(null);
    setRightPdfId(null);
    setFullCsvDashboardId(null);
    setLeftCsvDashboardId(null);
    setRightCsvDashboardId(null);
    setFormData({
      name: '',
      contentType: 'TOOLS',
      pdfId: null,
      layoutConfig: null,
      dayOfWeek: [],
      startTime: '09:00',
      endTime: '18:00',
      priority: 0,
      enabled: true,
    });
  };

  const handleEdit = (schedule: SignageSchedule) => {
    setEditingId(schedule.id);
    const hasLayoutConfig = schedule.layoutConfig !== null && schedule.layoutConfig !== undefined;
    setUseNewLayout(hasLayoutConfig);
    
    if (hasLayoutConfig && schedule.layoutConfig) {
      const config = schedule.layoutConfig;
      setLayoutType(config.layout);
      
      if (config.layout === 'FULL') {
        const slot = config.slots[0];
        if (slot) {
          if (slot.kind === 'pdf') {
            setFullSlotKind('pdf');
            setFullPdfId('pdfId' in slot.config ? slot.config.pdfId ?? null : null);
            setFullCsvDashboardId(null);
          } else if (slot.kind === 'csv_dashboard') {
            setFullSlotKind('csv_dashboard');
            setFullCsvDashboardId('csvDashboardId' in slot.config ? slot.config.csvDashboardId ?? null : null);
            setFullPdfId(null);
          } else {
            setFullSlotKind('loans');
            setFullPdfId(null);
            setFullCsvDashboardId(null);
          }
        }
      } else {
        const leftSlot = config.slots.find((s) => s.position === 'LEFT');
        const rightSlot = config.slots.find((s) => s.position === 'RIGHT');
        if (leftSlot) {
          if (leftSlot.kind === 'pdf') {
            setLeftSlotKind('pdf');
            setLeftPdfId('pdfId' in leftSlot.config ? leftSlot.config.pdfId ?? null : null);
            setLeftCsvDashboardId(null);
          } else if (leftSlot.kind === 'csv_dashboard') {
            setLeftSlotKind('csv_dashboard');
            setLeftCsvDashboardId('csvDashboardId' in leftSlot.config ? leftSlot.config.csvDashboardId ?? null : null);
            setLeftPdfId(null);
          } else {
            setLeftSlotKind('loans');
            setLeftPdfId(null);
            setLeftCsvDashboardId(null);
          }
        }
        if (rightSlot) {
          if (rightSlot.kind === 'pdf') {
            setRightSlotKind('pdf');
            setRightPdfId('pdfId' in rightSlot.config ? rightSlot.config.pdfId ?? null : null);
            setRightCsvDashboardId(null);
          } else if (rightSlot.kind === 'csv_dashboard') {
            setRightSlotKind('csv_dashboard');
            setRightCsvDashboardId('csvDashboardId' in rightSlot.config ? rightSlot.config.csvDashboardId ?? null : null);
            setRightPdfId(null);
          } else {
            setRightSlotKind('loans');
            setRightPdfId(null);
            setRightCsvDashboardId(null);
          }
        }
      }
    } else {
      // 旧形式から初期値を設定
      if (schedule.contentType === 'TOOLS') {
        setLayoutType('FULL');
        setFullSlotKind('loans');
      } else if (schedule.contentType === 'PDF') {
        setLayoutType('FULL');
        setFullSlotKind('pdf');
        setFullPdfId(schedule.pdfId);
      } else {
        setLayoutType('SPLIT');
        setLeftSlotKind('loans');
        setRightSlotKind('pdf');
        setRightPdfId(schedule.pdfId);
      }
    }
    
    setFormData({
      name: schedule.name,
      contentType: schedule.contentType,
      pdfId: schedule.pdfId,
      layoutConfig: schedule.layoutConfig,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      priority: schedule.priority,
      enabled: schedule.enabled,
    });
  };

  const buildLayoutConfig = (): SignageLayoutConfig | null => {
    if (!useNewLayout) {
      return null; // 旧形式を使用
    }

    if (layoutType === 'FULL') {
      if (fullSlotKind === 'pdf' && fullPdfId) {
        const pdf = pdfsQuery.data?.find((p) => p.id === fullPdfId);
        return {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'pdf',
              config: {
                pdfId: fullPdfId,
                displayMode: pdf?.displayMode || 'SINGLE',
                slideInterval: pdf?.slideInterval || null,
              },
            },
          ],
        };
      } else if (fullSlotKind === 'csv_dashboard' && fullCsvDashboardId) {
        return {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'csv_dashboard',
              config: {
                csvDashboardId: fullCsvDashboardId,
              },
            },
          ],
        };
      } else {
        return {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'loans',
              config: {},
            },
          ],
        };
      }
    } else {
      // SPLIT
      const slots: SignageSlot[] = [];
      
      // 左スロット
      if (leftSlotKind === 'pdf' && leftPdfId) {
        const pdf = pdfsQuery.data?.find((p) => p.id === leftPdfId);
        slots.push({
          position: 'LEFT',
          kind: 'pdf',
          config: {
            pdfId: leftPdfId,
            displayMode: pdf?.displayMode || 'SINGLE',
            slideInterval: pdf?.slideInterval || null,
          },
        });
      } else if (leftSlotKind === 'csv_dashboard' && leftCsvDashboardId) {
        slots.push({
          position: 'LEFT',
          kind: 'csv_dashboard',
          config: {
            csvDashboardId: leftCsvDashboardId,
          },
        });
      } else {
        slots.push({
          position: 'LEFT',
          kind: 'loans',
          config: {},
        });
      }
      
      // 右スロット
      if (rightSlotKind === 'pdf' && rightPdfId) {
        const pdf = pdfsQuery.data?.find((p) => p.id === rightPdfId);
        slots.push({
          position: 'RIGHT',
          kind: 'pdf',
          config: {
            pdfId: rightPdfId,
            displayMode: pdf?.displayMode || 'SINGLE',
            slideInterval: pdf?.slideInterval || null,
          },
        });
      } else if (rightSlotKind === 'csv_dashboard' && rightCsvDashboardId) {
        slots.push({
          position: 'RIGHT',
          kind: 'csv_dashboard',
          config: {
            csvDashboardId: rightCsvDashboardId,
          },
        });
      } else {
        slots.push({
          position: 'RIGHT',
          kind: 'loans',
          config: {},
        });
      }
      
      return {
        layout: 'SPLIT',
        slots,
      };
    }
  };

  const handleSave = async () => {
    try {
      const layoutConfig = buildLayoutConfig();
      
      // 後方互換のため、contentTypeとpdfIdも設定（layoutConfigがない場合に使用）
      let contentType = formData.contentType!;
      let pdfId = formData.pdfId ?? null;
      
      if (layoutConfig) {
        // 新形式を使用する場合、contentTypeとpdfIdをlayoutConfigから推論
        if (layoutConfig.layout === 'FULL') {
          const slot = layoutConfig.slots[0];
          if (slot.kind === 'pdf') {
            contentType = 'PDF';
            pdfId = (slot.config as { pdfId: string }).pdfId;
          } else {
            contentType = 'TOOLS';
            pdfId = null;
          }
        } else {
          contentType = 'SPLIT';
          const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf');
          pdfId = pdfSlot ? (pdfSlot.config as { pdfId: string }).pdfId : null;
        }
      }
      
      if (isCreating) {
        await create.mutateAsync({
          name: formData.name!,
          contentType,
          pdfId,
          layoutConfig,
          dayOfWeek: formData.dayOfWeek!,
          startTime: formData.startTime!,
          endTime: formData.endTime!,
          priority: formData.priority!,
          enabled: formData.enabled ?? true,
        });
        setIsCreating(false);
      } else if (editingId) {
        await update.mutateAsync({
          id: editingId,
          payload: {
            ...formData,
            contentType,
            pdfId,
            layoutConfig,
          },
        });
        setEditingId(null);
      }
      
      // フォームをリセット
      setUseNewLayout(false);
      setLayoutType('FULL');
      setFullSlotKind('loans');
      setLeftSlotKind('loans');
      setRightSlotKind('pdf');
      setFullPdfId(null);
      setLeftPdfId(null);
      setRightPdfId(null);
      setFormData({
        name: '',
        contentType: 'TOOLS',
        pdfId: null,
        layoutConfig: null,
        dayOfWeek: [],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      });
    } catch (error) {
      console.error('Failed to save schedule:', error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setUseNewLayout(false);
    setLayoutType('FULL');
    setFullSlotKind('loans');
    setLeftSlotKind('loans');
    setRightSlotKind('pdf');
    setFullPdfId(null);
    setLeftPdfId(null);
    setRightPdfId(null);
    setFormData({
      name: '',
      contentType: 'TOOLS',
      pdfId: null,
      layoutConfig: null,
      dayOfWeek: [],
      startTime: '09:00',
      endTime: '18:00',
      priority: 0,
      enabled: true,
    });
  };

  const handleDelete = async (id: string) => {
    if (confirm('このスケジュールを削除しますか？')) {
      await remove.mutateAsync(id);
    }
  };

  const toggleDayOfWeek = (day: number) => {
    const currentDays = formData.dayOfWeek || [];
    if (currentDays.includes(day)) {
      setFormData({ ...formData, dayOfWeek: currentDays.filter((d) => d !== day) });
    } else {
      setFormData({ ...formData, dayOfWeek: [...currentDays, day] });
    }
  };

  const handleRender = async () => {
    try {
      await renderMutation.mutateAsync();
      alert('サイネージの再レンダリングを開始しました');
    } catch (error) {
      console.error('Failed to render signage:', error);
      alert('サイネージの再レンダリングに失敗しました');
    }
  };

  return (
    <div className="space-y-6">
      <SignagePdfManager title="サイネージPDFアップロード（サイネージタブ）" />

      <Card
        title="スケジュール管理"
        action={
          !isCreating && !editingId ? (
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
          ) : null
        }
      >
        {(isCreating || editingId) && (
          <div className="mb-6 space-y-4 rounded-lg border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
            <div>
              <label className="block text-sm font-semibold text-slate-700">スケジュール名</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useNewLayout}
                onChange={(e) => setUseNewLayout(e.target.checked)}
                className="rounded border-2 border-slate-500"
              />
              <label className="text-sm font-semibold text-slate-700">新形式レイアウトを使用（全体/左右を自由に設定）</label>
            </div>

            {useNewLayout ? (
              <>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">レイアウト</label>
                  <select
                    value={layoutType}
                    onChange={(e) => setLayoutType(e.target.value as 'FULL' | 'SPLIT')}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="FULL">全体表示</option>
                    <option value="SPLIT">左右分割</option>
                  </select>
                </div>

                {layoutType === 'FULL' ? (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">表示コンテンツ</label>
                      <select
                        value={fullSlotKind}
                        onChange={(e) => {
                          setFullSlotKind(e.target.value as 'loans' | 'pdf' | 'csv_dashboard');
                          if (e.target.value === 'loans') {
                            setFullPdfId(null);
                            setFullCsvDashboardId(null);
                          } else if (e.target.value === 'pdf') {
                            setFullCsvDashboardId(null);
                          } else if (e.target.value === 'csv_dashboard') {
                            setFullPdfId(null);
                          }
                        }}
                        className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      >
                        <option value="loans">持出一覧</option>
                        <option value="pdf">PDF</option>
                        <option value="csv_dashboard">CSVダッシュボード</option>
                      </select>
                    </div>
                    {fullSlotKind === 'pdf' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">PDF</label>
                        <select
                          value={fullPdfId || ''}
                          onChange={(e) => setFullPdfId(e.target.value || null)}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          <option value="">選択してください</option>
                          {pdfsQuery.data?.map((pdf: SignagePdf) => (
                            <option key={pdf.id} value={pdf.id}>
                              {pdf.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {fullSlotKind === 'csv_dashboard' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">CSVダッシュボード</label>
                        <select
                          value={fullCsvDashboardId || ''}
                          onChange={(e) => setFullCsvDashboardId(e.target.value || null)}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          <option value="">選択してください</option>
                          {csvDashboardsQuery.data?.map((dashboard: CsvDashboard) => (
                            <option key={dashboard.id} value={dashboard.id}>
                              {dashboard.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">左側の表示コンテンツ</label>
                      <select
                        value={leftSlotKind}
                        onChange={(e) => {
                          setLeftSlotKind(e.target.value as 'loans' | 'pdf' | 'csv_dashboard');
                          if (e.target.value === 'loans') {
                            setLeftPdfId(null);
                            setLeftCsvDashboardId(null);
                          } else if (e.target.value === 'pdf') {
                            setLeftCsvDashboardId(null);
                          } else if (e.target.value === 'csv_dashboard') {
                            setLeftPdfId(null);
                          }
                        }}
                        className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      >
                        <option value="loans">持出一覧</option>
                        <option value="pdf">PDF</option>
                        <option value="csv_dashboard">CSVダッシュボード</option>
                      </select>
                    </div>
                    {leftSlotKind === 'pdf' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">左側のPDF</label>
                        <select
                          value={leftPdfId || ''}
                          onChange={(e) => setLeftPdfId(e.target.value || null)}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          <option value="">選択してください</option>
                          {pdfsQuery.data?.map((pdf: SignagePdf) => (
                            <option key={pdf.id} value={pdf.id}>
                              {pdf.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {leftSlotKind === 'csv_dashboard' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">左側のCSVダッシュボード</label>
                        <select
                          value={leftCsvDashboardId || ''}
                          onChange={(e) => setLeftCsvDashboardId(e.target.value || null)}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          <option value="">選択してください</option>
                          {csvDashboardsQuery.data?.map((dashboard: CsvDashboard) => (
                            <option key={dashboard.id} value={dashboard.id}>
                              {dashboard.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">右側の表示コンテンツ</label>
                      <select
                        value={rightSlotKind}
                        onChange={(e) => {
                          setRightSlotKind(e.target.value as 'loans' | 'pdf');
                          if (e.target.value === 'loans') {
                            setRightPdfId(null);
                          }
                        }}
                        className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      >
                        <option value="loans">持出一覧</option>
                        <option value="pdf">PDF</option>
                      </select>
                    </div>
                    {rightSlotKind === 'pdf' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">右側のPDF</label>
                        <select
                          value={rightPdfId || ''}
                          onChange={(e) => setRightPdfId(e.target.value || null)}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          <option value="">選択してください</option>
                          {pdfsQuery.data?.map((pdf: SignagePdf) => (
                            <option key={pdf.id} value={pdf.id}>
                              {pdf.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">コンテンツタイプ（旧形式）</label>
                  <select
                    value={formData.contentType || 'TOOLS'}
                    onChange={(e) => setFormData({ ...formData, contentType: e.target.value as 'TOOLS' | 'PDF' | 'SPLIT' })}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="TOOLS">工具管理データ</option>
                    <option value="PDF">PDF</option>
                    <option value="SPLIT">分割表示（工具+PDF）</option>
                  </select>
                </div>
                {(formData.contentType === 'PDF' || formData.contentType === 'SPLIT') && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">PDF</label>
                    <select
                      value={formData.pdfId || ''}
                      onChange={(e) => setFormData({ ...formData, pdfId: e.target.value || null })}
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      <option value="">選択してください</option>
                      {pdfsQuery.data?.map((pdf: SignagePdf) => (
                        <option key={pdf.id} value={pdf.id}>
                          {pdf.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700">曜日</label>
              <div className="mt-1 flex gap-2">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDayOfWeek(day.value)}
                    className={`rounded-md border-2 px-3 py-1 text-sm font-semibold shadow-lg ${
                      formData.dayOfWeek?.includes(day.value)
                        ? 'border-emerald-700 bg-emerald-600 text-white'
                        : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">開始時刻</label>
                <input
                  type="time"
                  value={formData.startTime || ''}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">終了時刻</label>
                <input
                  type="time"
                  value={formData.endTime || ''}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">優先順位</label>
              <input
                type="number"
                value={formData.priority || 0}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
                className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.enabled ?? true}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="rounded border-2 border-slate-500"
              />
              <label className="text-sm font-semibold text-slate-700">有効</label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
                保存
              </Button>
              <Button onClick={handleCancel} variant="ghost" disabled={create.isPending || update.isPending}>
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {schedulesQuery.isError ? (
          <p className="text-red-400">スケジュール一覧の取得に失敗しました</p>
        ) : schedulesQuery.isLoading ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
        ) : schedulesQuery.data && schedulesQuery.data.length > 0 ? (
          <div className="space-y-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-500 bg-slate-100">
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">名前</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">コンテンツタイプ</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">曜日</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">時間帯</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">優先順位</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">状態</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {schedulesQuery.data.map((schedule: SignageSchedule) => (
                  <tr key={schedule.id} className="border-b border-slate-500">
                    <td className="px-4 py-2 text-sm text-slate-700">{schedule.name}</td>
                    <td className="px-4 py-2 text-sm text-slate-700">
                      {schedule.contentType === 'TOOLS' && '工具管理データ'}
                      {schedule.contentType === 'PDF' && 'PDF'}
                      {schedule.contentType === 'SPLIT' && '分割表示'}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-700">
                      {schedule.dayOfWeek.map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label).join(', ')}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-700">
                      {schedule.startTime} - {schedule.endTime}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-700">{schedule.priority}</td>
                    <td className="px-4 py-2 text-sm text-slate-700">{schedule.enabled ? '有効' : '無効'}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <Button onClick={() => handleEdit(schedule)} className="px-3 py-1 text-sm">
                          編集
                        </Button>
                        <Button
                          onClick={() => handleDelete(schedule.id)}
                          variant="ghost"
                          className="px-3 py-1 text-sm font-semibold text-red-600"
                        >
                          削除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-700">スケジュールが登録されていません。</p>
        )}
      </Card>
    </div>
  );
}

