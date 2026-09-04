import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { formatAssemblyEditorName } from './assemblyTemplateGuidePresentation';

import type { AssemblyDraftArea } from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';

type Props = {
  items: Array<{ item: AssemblyTemplateProcedureDraftItem; used: boolean }>;
  selectedPageKey: string;
  selectedDocumentId: string;
  areas: AssemblyDraftArea[];
  incompleteAreaIds: ReadonlySet<string>;
  selectedArea: AssemblyDraftArea | null;
  selectedAreaId: string;
  expandedAreaDetails: ReadonlySet<string>;
  onToggleAreaDetails: (areaId: string) => void;
  templateName: string;
  modelCode: string;
  machineNameSelectionRequired: boolean;
  identityLocked: boolean;
  procedurePattern: string;
  templateNameAutomatic: boolean;
  busy: boolean;
  readOnly: boolean;
  onOpenDocumentLibrary: () => void;
  onFocusItem: (item: AssemblyTemplateProcedureDraftItem) => void;
  onRemoveItem: (localId: string) => void;
  onLabelChange: (localId: string, label: string) => void;
  onTemplateNameChange: (value: string) => void;
  onRestoreSuggestedTemplateName: () => void;
  onModelCodeChange: (value: string) => void;
  onOpenMachineNamePicker: () => void;
  onProcedurePatternChange: (value: string) => void;
  onSelectArea: (areaId: string) => void;
  onAddArea: () => void;
  onMoveArea: (areaId: string, delta: -1 | 1) => void;
  onDeleteArea: (areaId: string) => void;
  onAreaPatch: (areaId: string, patch: Partial<AssemblyDraftArea>) => void;
};

export function AssemblyTemplateProcedurePane({
  items,
  selectedPageKey,
  selectedDocumentId,
  areas,
  incompleteAreaIds,
  selectedArea,
  selectedAreaId,
  expandedAreaDetails,
  onToggleAreaDetails,
  templateName,
  modelCode,
  machineNameSelectionRequired,
  identityLocked,
  procedurePattern,
  templateNameAutomatic,
  busy,
  readOnly,
  onOpenDocumentLibrary,
  onFocusItem,
  onRemoveItem,
  onLabelChange,
  onTemplateNameChange,
  onRestoreSuggestedTemplateName,
  onModelCodeChange,
  onOpenMachineNamePicker,
  onProcedurePatternChange,
  onSelectArea,
  onAddArea,
  onMoveArea,
  onDeleteArea,
  onAreaPatch
}: Props) {
  const [expandedDocumentLabels, setExpandedDocumentLabels] = useState<Set<string>>(
    () => new Set()
  );

  const toggleDocumentLabel = (localId: string) => {
    setExpandedDocumentLabels((current) => {
      const next = new Set(current);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  };

  useEffect(() => {
    const invalidLabelIds = items
      .filter(({ item }) => item.label.length > 120)
      .map(({ item }) => item.localId);
    if (invalidLabelIds.length === 0) return;
    setExpandedDocumentLabels((current) => {
      const next = new Set(current);
      invalidLabelIds.forEach((id) => next.add(id));
      return next;
    });
  }, [items]);

  return (
    <section
      id="assembly-procedure-pane"
      className="min-h-0 min-w-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[1rem] font-bold">使用文書</h2>
          <p className="text-[0.68rem] font-semibold text-white/55">
            文書順は表示手順で最初に現れる順です。
          </p>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 shrink-0 !px-2 !py-1 text-xs"
          data-kiosk-sop-target="assembly-editor-document-add"
          disabled={busy || readOnly || items.length >= 50}
          onClick={onOpenDocumentLibrary}
        >
          文書追加
        </Button>
      </div>
      {items.some(({ used }) => !used) ? (
        <p className="mt-2 text-xs text-amber-200">
          未使用の文書を選び、中央の「全体追加」「矩形追加」で手順を追加してください。保存前に各文書を1手順以上で使用します。
        </p>
      ) : null}
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-1.5">
        {items.map(({ item, used }, index) => (
          <div
            key={item.localId}
            id={`assembly-document-${item.localId}`}
            className={clsx(
              'min-w-0 rounded border bg-slate-950/55 p-1.5',
              selectedPageKey.startsWith(`${item.localId}:`)
                ? 'border-cyan-300/70'
                : 'border-white/10'
            )}
          >
            <button
              type="button"
              className="flex min-h-11 w-full min-w-0 items-start gap-2 text-left"
              onClick={() => onFocusItem(item)}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-bold">
                {used ? index + 1 : '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-xs font-bold"
                  title={item.label.trim() || item.document.displayTitle?.trim() || item.document.title}
                >
                  {formatAssemblyEditorName(item.label.trim() || item.document.displayTitle?.trim() || item.document.title)}
                </span>
                <span className="block truncate text-[0.65rem] text-white/50">
                  {item.documentType === 'assembly_procedure_document' ? '組立手順書' : 'PDF要領書'}
                  {item.assemblyProcedureDocumentId === selectedDocumentId ? '・主手順書' : ''}
                  {!used ? '・未使用' : ''}
                </span>
              </span>
            </button>
            {item.label.trim() ? (
              <p className="mt-1 truncate text-[0.65rem] text-white/60" title={item.label.trim()}>
                表示名: {formatAssemblyEditorName(item.label.trim())}
              </p>
            ) : null}
            <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1">
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 min-w-0 !px-1 !py-1 text-xs"
                aria-expanded={expandedDocumentLabels.has(item.localId)}
                onClick={() => toggleDocumentLabel(item.localId)}
              >
                {expandedDocumentLabels.has(item.localId)
                  ? '表示名を閉じる'
                  : '表示名を変更'}
              </Button>
              <Button
                type="button"
                variant="danger"
                aria-label={`${item.label.trim() || item.document.title}を削除`}
                className="min-h-10 min-w-0 !px-1 !py-1 text-xs"
                disabled={busy || readOnly}
                onClick={() => onRemoveItem(item.localId)}
              >
                削除
              </Button>
            </div>
            {expandedDocumentLabels.has(item.localId) ? (
            <label className="mt-1 grid min-w-0 grid-cols-1 gap-0.5 text-[0.65rem] font-semibold text-white/55">
              表示ラベル
              <Input
                className="min-h-11 min-w-0 !px-2 !py-1 text-xs"
                value={item.label}
                maxLength={120}
                disabled={busy || readOnly}
                onChange={(event) => onLabelChange(item.localId, event.target.value)}
              />
            </label>
            ) : null}
          </div>
        ))}
      </div>

      <section
        id="assembly-template-basic-settings"
        className="mt-3 min-w-0 rounded border border-white/10 bg-slate-950/35 p-2"
      >
        <h2 className="text-sm font-bold">基本設定</h2>
        <p className="mt-1 text-xs text-white/60">基本設定は、このテンプレートのすべての文書に共通です。</p>
        <div className="mt-2 grid min-w-0 gap-2">
          {machineNameSelectionRequired ? (
            <div className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
              機種名
              <div className="min-w-0 rounded border border-white/10 bg-slate-950 p-2">
                <div
                  className="min-h-6 truncate text-sm font-bold text-white"
                  title={modelCode || undefined}
                >
                  {modelCode || <span className="text-amber-200">未選択</span>}
                </div>
                <Button
                  id="assembly-template-model-code"
                  data-kiosk-sop-target="assembly-editor-model-code"
                  type="button"
                  variant={modelCode ? 'secondary' : 'primary'}
                  className="mt-2 min-h-11 w-full"
                  disabled={busy || readOnly}
                  onClick={onOpenMachineNamePicker}
                >
                  {modelCode ? '機種名を変更' : '機種名を選ぶ'}
                </Button>
              </div>
            </div>
          ) : (
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
              機種名
              <Input
                id="assembly-template-model-code"
                data-kiosk-sop-target="assembly-editor-model-code"
                className="min-h-11 min-w-0"
                value={modelCode}
                maxLength={120}
                disabled={busy || readOnly || identityLocked}
                onChange={(event) => onModelCodeChange(event.target.value)}
              />
              {identityLocked ? (
                <span className="text-[0.65rem] font-normal text-amber-200">
                  改版では機種名を固定しています。別系統は「複製して新規」を使ってください。
                </span>
              ) : null}
            </label>
          )}
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
            手順パターン
            <span className="text-[0.65rem] font-normal text-white/50">
              機種名と組み合わせて改版系列を識別します。
            </span>
            <Input
              id="assembly-template-procedure-pattern"
              data-kiosk-sop-target="assembly-editor-procedure-pattern"
              className="min-h-11 min-w-0"
              value={procedurePattern}
              maxLength={120}
              disabled={busy || readOnly || identityLocked}
              onChange={(event) => onProcedurePatternChange(event.target.value)}
            />
            {identityLocked ? (
              <span className="text-[0.65rem] font-normal text-amber-200">
                改版では手順パターンを固定しています。別系統は「複製して新規」を使ってください。
              </span>
            ) : null}
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
            テンプレート名
            <Input
              id="assembly-template-name"
              data-kiosk-sop-target="assembly-editor-template-name"
              className="min-h-11 min-w-0"
              value={templateName}
              maxLength={200}
              disabled={busy || readOnly}
              onChange={(event) => onTemplateNameChange(event.target.value)}
            />
            <span className="grid min-h-6 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 text-[0.65rem] font-normal text-white/50">
              <span className="min-w-0">
                {templateNameAutomatic
                  ? '機種名と手順パターンから自動提案中'
                  : '個別の名称を使用中'}
              </span>
              {!templateNameAutomatic ? (
                <button
                  type="button"
                  className="shrink-0 whitespace-nowrap rounded px-1.5 py-1 font-semibold text-cyan-200 hover:bg-white/10 disabled:opacity-60"
                  disabled={busy || readOnly}
                  onClick={onRestoreSuggestedTemplateName}
                >
                  自動提案に戻す
                </button>
              ) : null}
            </span>
          </label>
        </div>
      </section>
      <h2 className="mt-3 text-[1rem] font-bold">工程</h2>
      <div className="mt-2 grid min-w-0 gap-1.5">
        {areas.map((area, index) => (
          <div
            key={area.id}
            className={clsx(
              'grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1 rounded border p-1',
              area.id === selectedAreaId
                ? 'border-cyan-300/60 bg-cyan-950/25'
                : 'border-white/10 bg-slate-950/35'
            )}
          >
            <button
              type="button"
              className="flex min-h-10 min-w-0 items-center gap-2 px-2 text-left text-xs font-bold"
              onClick={() => onSelectArea(area.id)}
            >
              <span
                className="min-w-0 flex-1 truncate"
                title={[area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-')
                  || area.areaName.trim() || `工程 ${index + 1}`}
              >
                {formatAssemblyEditorName(
                  [area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-')
                  || area.areaName.trim() || `工程 ${index + 1}`
                )}
              </span>
              <span
                className={clsx(
                  'shrink-0 text-[0.65rem]',
                  incompleteAreaIds.has(area.id) ? 'text-amber-200' : 'text-emerald-200'
                )}
              >
                {incompleteAreaIds.has(area.id) ? '未完了' : '完了'}
              </span>
            </button>
            <Button
              type="button"
              variant="ghostOnDark"
              aria-label={`工程${index + 1}を上へ`}
              className="min-h-10 shrink-0 whitespace-nowrap !px-2 !py-1 text-xs"
              disabled={busy || readOnly || index === 0}
              onClick={() => onMoveArea(area.id, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="ghostOnDark"
              aria-label={`工程${index + 1}を下へ`}
              className="min-h-10 shrink-0 whitespace-nowrap !px-2 !py-1 text-xs"
              disabled={busy || readOnly || index === areas.length - 1}
              onClick={() => onMoveArea(area.id, 1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="danger"
              aria-label={`工程${index + 1}を削除`}
              className="min-h-10 shrink-0 whitespace-nowrap !px-2 !py-1 text-xs"
              disabled={busy || readOnly || areas.length <= 1}
              onClick={() => onDeleteArea(area.id)}
            >
              削除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 !px-2 !py-1 text-xs"
          data-kiosk-sop-target="assembly-editor-area-add"
          disabled={busy || readOnly}
          onClick={onAddArea}
        >
          追加
        </Button>
      </div>
      {selectedArea ? (
        <div
          id={`assembly-area-${selectedArea.id}`}
          tabIndex={-1}
          className="mt-3 min-w-0"
        >
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 min-w-0 w-full !px-2 text-xs"
            aria-expanded={expandedAreaDetails.has(selectedArea.id)}
            aria-controls={`assembly-area-details-${selectedArea.id}`}
            onClick={() => onToggleAreaDetails(selectedArea.id)}
          >
            詳細（任意）
          </Button>
          {expandedAreaDetails.has(selectedArea.id) ? (
          <div
            id={`assembly-area-details-${selectedArea.id}`}
            className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"
          >
          {([
            ['processNo', '工程No.'],
            ['areaCode', 'エリアコード'],
            ['unitCode', 'ユニットコード'],
            ['areaName', 'エリア名']
          ] as const).map(([key, label]) => (
            <label
              key={key}
              className="grid min-w-0 gap-1 text-xs font-semibold text-white/70"
            >
              {label}
              <Input
                id={`assembly-area-${selectedArea.id}-${key}`}
                className="min-h-11 min-w-0"
                value={selectedArea[key]}
                maxLength={key === 'areaName' ? 200 : 80}
                disabled={busy || readOnly}
                onChange={(event) =>
                  onAreaPatch(selectedArea.id, { [key]: event.target.value })
                }
              />
            </label>
          ))}
          </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
