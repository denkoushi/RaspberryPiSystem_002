import { Fragment } from 'react';
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
const TEMPLATE_TABLE_SPLIT_MIN_ROWS = 2;

export type InspectionDrawingLibraryTemplateTableProps = {
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

function activeResourceCdsForTemplate(template: KioskInspectionDrawingTemplateSummaryDto): string[] {
  return template.siblingGroup?.activeResourceCds && template.siblingGroup.activeResourceCds.length > 0
    ? template.siblingGroup.activeResourceCds
    : [template.resourceCd];
}

function rangeLabel(startIndex: number, rowCount: number): string {
  if (rowCount <= 0) return '';
  return `${startIndex + 1} - ${startIndex + rowCount}`;
}

type TemplateTablePaneProps = {
  label: string;
  templates: KioskInspectionDrawingTemplateSummaryDto[];
  startIndex: number;
  resourceNameMap: Record<string, string[]>;
  onHistoryClick: (lineageGroupKey: string) => void;
  lineageGroupKey: (template: KioskInspectionDrawingTemplateSummaryDto) => string;
  editPath: (templateId: string) => string;
  printPath?: (templateId: string) => string;
  createFromSourcePath: (templateId: string) => string;
  linkState: object;
};

function TemplateTablePane({
  label,
  templates,
  startIndex,
  resourceNameMap,
  onHistoryClick,
  lineageGroupKey,
  editPath,
  printPath,
  createFromSourcePath,
  linkState
}: TemplateTablePaneProps) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-white/10 bg-slate-950/35"
      data-testid="inspection-template-table-pane"
    >
      <div className="min-h-0 flex-1 overflow-auto p-1">
        <table
          className="w-full table-fixed border-collapse text-left text-xs"
          aria-label={`検査図面テンプレート ${label} ${rangeLabel(startIndex, templates.length)}`}
        >
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[43%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[19%]" />
          </colgroup>
          <thead className="sticky top-0 bg-slate-900 text-xs text-white/70">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1.5 font-bold">品番</th>
              <th className="px-2 py-1.5 font-bold">図面名</th>
              <th className="px-2 py-1.5 font-bold">工程</th>
              <th className="px-2 py-1.5 font-bold">点</th>
              <th className="px-2 py-1.5 text-right font-bold">更新</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => {
              const activeResourceCds = activeResourceCdsForTemplate(template);
              const visibleResourceCds = activeResourceCds.slice(0, MAX_VISIBLE_RESOURCE_CHIPS);
              const hiddenResourceCount = activeResourceCds.length - visibleResourceCds.length;
              const visualName = template.visualTemplate?.name ?? '未設定';
              const resourceSummaryTitle = activeResourceCds
                .map((cd) => formatResourceCdWithJapaneseNames(cd, resourceNameMap))
                .join(' / ');
              return (
                <Fragment key={template.siblingGroupId ?? template.id}>
                  <tr className="border-t border-white/10 first:border-t-0">
                    <td className="truncate px-2 pb-0.5 pt-1.5 font-bold text-white" title={template.fhincd}>
                      {template.fhincd}
                    </td>
                    <td className="truncate px-2 pb-0.5 pt-1.5 font-semibold text-white/90" title={visualName}>
                      {visualName}
                    </td>
                    <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 text-white/80">
                      {processLabel(template.processGroup)}
                    </td>
                    <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 font-semibold text-white/80">
                      {template.itemCount}
                    </td>
                    <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 text-right font-semibold text-white/65">
                      {updatedLabel(template)}
                    </td>
                  </tr>
                  <tr className="border-b border-white/10 last:border-b-0">
                    <td colSpan={5} className="px-2 pb-1 pt-0 text-xs text-white/55">
                      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                        <span className="shrink-0 font-semibold">資源CD</span>
                        <div
                          className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
                          data-testid="inspection-template-resource-chips"
                          title={resourceSummaryTitle}
                        >
                          {visibleResourceCds.map((cd) => (
                            <span
                              key={cd}
                              className="shrink-0 truncate rounded border border-cyan-300/35 bg-cyan-950/50 px-1.5 py-0.5 text-xs font-semibold leading-tight text-cyan-100"
                              title={formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
                            >
                              {cd}
                            </span>
                          ))}
                          {hiddenResourceCount > 0 ? (
                            <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-xs leading-tight text-white/70">
                              +{hiddenResourceCount}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="ml-auto flex w-[7rem] shrink-0 justify-end gap-0.5"
                          data-testid="inspection-template-secondary-actions"
                        >
                          <Link
                            to={editPath(template.id)}
                            state={linkState}
                            className={buttonClassName(
                              'primary',
                              'inline-flex min-h-11 min-w-[1.75rem] shrink-0 items-center justify-center rounded !px-1 !py-0 text-xs leading-none whitespace-nowrap'
                            )}
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
                                'inline-flex min-h-11 min-w-[1.5rem] shrink-0 items-center justify-center rounded !px-1 !py-0 text-xs leading-none whitespace-nowrap'
                              )}
                            >
                              帳票
                            </Link>
                          ) : null}
                          {template.isActive ? (
                            <Link
                              to={createFromSourcePath(template.id)}
                              state={linkState}
                              title="雛形新規"
                              className={buttonClassName(
                                'ghostOnDark',
                                'inline-flex min-h-11 min-w-[1.5rem] shrink-0 items-center justify-center rounded !px-1 !py-0 text-xs leading-none whitespace-nowrap'
                              )}
                            >
                              雛形
                            </Link>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghostOnDark"
                            className="min-h-11 min-w-[1.5rem] shrink-0 whitespace-nowrap rounded !px-1 !py-0 text-xs leading-none"
                            onClick={() => onHistoryClick(lineageGroupKey(template))}
                          >
                            履歴
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 検査図面テンプレート一覧 — 内容幅ベースのコンパクト表で表示 */
export function InspectionDrawingLibraryTemplateTable({
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
}: InspectionDrawingLibraryTemplateTableProps) {
  if (templates.length === 0) {
    return (
      <div className="flex min-h-[4rem] w-full items-center justify-center rounded border border-dashed border-white/15 px-2 py-4 text-[0.92rem] text-white/60">
        {busy ? '読込中…' : emptyMessage}
      </div>
    );
  }

  const shouldSplit = templates.length >= TEMPLATE_TABLE_SPLIT_MIN_ROWS;
  const splitIndex = shouldSplit ? Math.ceil(templates.length / 2) : templates.length;
  const firstTemplates = templates.slice(0, splitIndex);
  const secondTemplates = shouldSplit ? templates.slice(splitIndex) : [];

  return (
    <div className="grid h-full min-h-0 w-full grid-cols-1 gap-2 2xl:grid-cols-2">
      <TemplateTablePane
        label={shouldSplit ? '上段' : '一覧'}
        templates={firstTemplates}
        startIndex={0}
        resourceNameMap={resourceNameMap}
        onHistoryClick={onHistoryClick}
        lineageGroupKey={lineageGroupKey}
        editPath={editPath}
        printPath={printPath}
        createFromSourcePath={createFromSourcePath}
        linkState={linkState}
      />
      {secondTemplates.length > 0 ? (
        <TemplateTablePane
          label="下段"
          templates={secondTemplates}
          startIndex={splitIndex}
          resourceNameMap={resourceNameMap}
          onHistoryClick={onHistoryClick}
          lineageGroupKey={lineageGroupKey}
          editPath={editPath}
          printPath={printPath}
          createFromSourcePath={createFromSourcePath}
          linkState={linkState}
        />
      ) : null}
    </div>
  );
}
