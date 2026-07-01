import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../../components/ui/Button';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import {
  INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE,
  kioskInspectionDrawingCreatePathWithSource,
  kioskInspectionDrawingTemplateEditPath
} from './kioskInspectionDrawingRoutes';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../types';

function processLabel(processGroup: KioskInspectionDrawingTemplateSummaryDto['processGroup']): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

function updatedLabel(template: KioskInspectionDrawingTemplateSummaryDto): string {
  const visualUpdatedAt = template.visualTemplate?.updatedAt;
  if (!visualUpdatedAt) return '図面未設定';
  return new Date(visualUpdatedAt).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const MAX_VISIBLE_RESOURCE_CHIPS = 4;

export type InspectionDrawingLibraryTemplateGridProps = {
  templates: KioskInspectionDrawingTemplateSummaryDto[];
  resourceNameMap: Record<string, string[]>;
  busy?: boolean;
  emptyMessage?: string;
  onHistoryClick: (lineageGroupKey: string) => void;
  lineageGroupKey: (template: KioskInspectionDrawingTemplateSummaryDto) => string;
  editPath?: (templateId: string) => string;
  printPath?: (templateId: string) => string;
  createFromSourcePath?: (templateId: string) => string;
  linkState?: object;
};

/** 検査図面テンプレート一覧 — コンパクトカードを3〜4列グリッドで表示 */
export function InspectionDrawingLibraryTemplateGrid({
  templates,
  resourceNameMap,
  busy = false,
  emptyMessage = '条件に合う検査図面はありません。',
  onHistoryClick,
  lineageGroupKey,
  editPath = kioskInspectionDrawingTemplateEditPath,
  printPath,
  createFromSourcePath = kioskInspectionDrawingCreatePathWithSource,
  linkState = INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE
}: InspectionDrawingLibraryTemplateGridProps) {
  if (templates.length === 0) {
    return (
      <div className="flex min-h-[4rem] items-center justify-center rounded border border-dashed border-white/15 px-2 py-4 text-[0.92rem] text-white/60">
        {busy ? '読込中…' : emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,22rem))] gap-1.5">
      {templates.map((template) => {
        const activeResourceCds =
          template.siblingGroup?.activeResourceCds && template.siblingGroup.activeResourceCds.length > 0
            ? template.siblingGroup.activeResourceCds
            : [template.resourceCd];
        const displayName = template.siblingGroup?.displayName ?? template.name;
        const visibleResourceCds = activeResourceCds.slice(0, MAX_VISIBLE_RESOURCE_CHIPS);
        const hiddenResourceCount = activeResourceCds.length - visibleResourceCds.length;
        const visualName = template.visualTemplate?.name ?? '未設定';
        const metadataLabel = `測定点 ${template.itemCount} · 更新 ${updatedLabel(template)} · 図面 ${visualName}`;
        return (
        <section
          key={template.siblingGroupId ?? template.id}
          className="flex min-h-[10rem] min-w-0 max-w-[22rem] flex-col gap-1 rounded border border-white/15 bg-slate-900/80 p-2"
        >
          <div className="flex min-w-0 items-start justify-between gap-1">
            <p className="min-w-0 truncate text-[0.95rem] font-bold leading-tight">{displayName}</p>
            <span
              className={clsx(
                'shrink-0 rounded px-1.5 py-0.5 text-[0.72rem] font-semibold leading-none',
                template.isActive ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/70'
              )}
            >
              v{template.version}
            </span>
          </div>

          <p className="truncate text-[0.78rem] leading-snug text-white/75">
            {template.fhincd} · {processLabel(template.processGroup)}
          </p>
          <div
            className="flex min-h-[1.55rem] flex-nowrap items-center gap-1 overflow-hidden"
            data-testid="inspection-template-resource-chips"
          >
            {visibleResourceCds.map((cd) => (
              <span
                key={cd}
                className="max-w-[8.5rem] truncate rounded border border-cyan-300/35 bg-cyan-950/50 px-1.5 py-0.5 text-[0.7rem] text-cyan-100"
                title={formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
              >
                {cd}
              </span>
            ))}
            {hiddenResourceCount > 0 ? (
              <span className="rounded border border-white/15 px-1.5 py-0.5 text-[0.7rem] text-white/70">
                +{hiddenResourceCount}
              </span>
            ) : null}
          </div>
          <p
            className="truncate text-[0.8rem] leading-snug text-white/65"
            title={metadataLabel}
            data-testid="inspection-template-card-metadata"
          >
            {metadataLabel}
          </p>

          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            <Link
              to={editPath(template.id)}
              state={linkState}
              className={buttonClassName('primary', 'inline-flex min-h-9 items-center justify-center px-3 text-[0.9rem]')}
            >
              編集
            </Link>
            {printPath ? (
              <Link
                to={printPath(template.id)}
                target="_blank"
                rel="noopener noreferrer"
                title="保存済みテンプレートの帳票プレビュー（未保存の変更は反映されません）"
                className={buttonClassName(
                  'ghostOnDark',
                  'inline-flex min-h-9 items-center justify-center px-2.5 text-[0.9rem]'
                )}
              >
                帳票
              </Link>
            ) : null}
            {template.isActive ? (
              <Link
                to={createFromSourcePath(template.id)}
                state={linkState}
                className={buttonClassName(
                  'ghostOnDark',
                  'inline-flex min-h-9 items-center justify-center px-2.5 text-[0.9rem]'
                )}
              >
                雛形新規
              </Link>
            ) : null}
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-9 px-2.5 text-[0.9rem]"
              onClick={() => onHistoryClick(lineageGroupKey(template))}
            >
              履歴
            </Button>
          </div>
        </section>
        );
      })}
    </div>
  );
}
