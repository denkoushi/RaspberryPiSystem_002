import clsx from 'clsx';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import type { AssemblyDraftArea } from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';

type Props = {
  items: AssemblyTemplateProcedureDraftItem[];
  selectedPageKey: string;
  selectedDocumentId: string;
  areas: AssemblyDraftArea[];
  selectedArea: AssemblyDraftArea | null;
  selectedAreaId: string;
  templateName: string;
  modelCode: string;
  procedurePattern: string;
  busy: boolean;
  readOnly: boolean;
  onOpenDocumentLibrary: () => void;
  onFocusItem: (item: AssemblyTemplateProcedureDraftItem) => void;
  onMoveItem: (index: number, delta: -1 | 1) => void;
  onRemoveItem: (index: number) => void;
  onLabelChange: (localId: string, label: string) => void;
  onTemplateNameChange: (value: string) => void;
  onModelCodeChange: (value: string) => void;
  onProcedurePatternChange: (value: string) => void;
  onSelectArea: (areaId: string) => void;
  onAddArea: () => void;
  onAreaPatch: (areaId: string, patch: Partial<AssemblyDraftArea>) => void;
};

export function AssemblyTemplateProcedurePane({
  items,
  selectedPageKey,
  selectedDocumentId,
  areas,
  selectedArea,
  selectedAreaId,
  templateName,
  modelCode,
  procedurePattern,
  busy,
  readOnly,
  onOpenDocumentLibrary,
  onFocusItem,
  onMoveItem,
  onRemoveItem,
  onLabelChange,
  onTemplateNameChange,
  onModelCodeChange,
  onProcedurePatternChange,
  onSelectArea,
  onAddArea,
  onAreaPatch
}: Props) {
  return (
    <section
      id="assembly-procedure-pane"
      className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[1rem] font-bold">文書順</h2>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 !px-2 !py-1 text-xs"
          disabled={busy || readOnly || items.length >= 50}
          onClick={onOpenDocumentLibrary}
        >
          文書追加
        </Button>
      </div>
      <div className="mt-2 grid gap-1.5">
        {items.map((item, index) => (
          <div
            key={item.localId}
            className={clsx(
              'rounded border bg-slate-950/55 p-1.5',
              selectedPageKey.startsWith(`${item.localId}:`)
                ? 'border-cyan-300/70'
                : 'border-white/10'
            )}
          >
            <button
              type="button"
              className="flex min-h-11 w-full items-start gap-2 text-left"
              onClick={() => onFocusItem(item)}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-bold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">
                  {item.label.trim() || item.document.displayTitle?.trim() || item.document.title}
                </span>
                <span className="block truncate text-[0.65rem] text-white/50">
                  {item.documentType === 'assembly_procedure_document' ? '組立手順書' : 'PDF要領書'}
                  {item.assemblyProcedureDocumentId === selectedDocumentId ? '・主手順書' : ''}
                </span>
              </span>
            </button>
            <div className="mt-1 flex gap-1">
              <Button
                type="button"
                variant="ghostOnDark"
                aria-label={`${index + 1}番目の文書を上へ`}
                className="min-h-11 flex-1 !px-1 !py-1 text-xs"
                disabled={busy || readOnly || index === 0}
                onClick={() => onMoveItem(index, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghostOnDark"
                aria-label={`${index + 1}番目の文書を下へ`}
                className="min-h-11 flex-1 !px-1 !py-1 text-xs"
                disabled={busy || readOnly || index === items.length - 1}
                onClick={() => onMoveItem(index, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="danger"
                aria-label={`${index + 1}番目の文書を削除`}
                className="min-h-11 flex-1 !px-1 !py-1 text-xs"
                disabled={busy || readOnly}
                onClick={() => onRemoveItem(index)}
              >
                削除
              </Button>
            </div>
            <label className="mt-1 grid gap-0.5 text-[0.65rem] font-semibold text-white/55">
              表示ラベル
              <Input
                className="min-h-11 !px-2 !py-1 text-xs"
                value={item.label}
                disabled={busy || readOnly}
                onChange={(event) => onLabelChange(item.localId, event.target.value)}
              />
            </label>
          </div>
        ))}
      </div>

      <details className="mt-3 rounded border border-white/10 bg-slate-950/35 p-2">
        <summary className="min-h-11 cursor-pointer text-sm font-bold">基本設定</summary>
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1 text-xs font-semibold text-white/70">
            型番/FHINCD
            <Input
              className="min-h-11"
              value={modelCode}
              disabled={busy || readOnly}
              onChange={(event) => onModelCodeChange(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-white/70">
            手順パターン
            <Input
              className="min-h-11"
              value={procedurePattern}
              disabled={busy || readOnly}
              onChange={(event) => onProcedurePatternChange(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-white/70">
            テンプレート名
            <Input
              className="min-h-11"
              value={templateName}
              disabled={busy || readOnly}
              onChange={(event) => onTemplateNameChange(event.target.value)}
            />
          </label>
        </div>
      </details>
      <h2 className="mt-3 text-[1rem] font-bold">工程</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {areas.map((area) => (
          <Button
            key={area.id}
            type="button"
            variant={area.id === selectedAreaId ? 'primary' : 'ghostOnDark'}
            className="min-h-11 !px-2 !py-1 text-xs"
            onClick={() => onSelectArea(area.id)}
          >
            {area.processNo}-{area.areaCode}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 !px-2 !py-1 text-xs"
          disabled={readOnly}
          onClick={onAddArea}
        >
          追加
        </Button>
      </div>
      {selectedArea ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([
            ['processNo', '工程No.'],
            ['areaCode', 'エリア'],
            ['unitCode', 'ユニット'],
            ['areaName', 'エリア名']
          ] as const).map(([key, label]) => (
            <label
              key={key}
              className={clsx(
                'grid gap-1 text-xs font-semibold text-white/70',
                key === 'areaName' ? 'col-span-2' : ''
              )}
            >
              {label}
              <Input
                className="min-h-11"
                value={selectedArea[key]}
                disabled={busy || readOnly}
                onChange={(event) =>
                  onAreaPatch(selectedArea.id, { [key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
