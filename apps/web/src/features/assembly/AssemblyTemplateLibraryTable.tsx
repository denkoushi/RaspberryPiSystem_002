import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';

import { kioskAssemblyTemplateEditPath, kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyTemplateSummaryDto } from './types';

const TEMPLATE_TABLE_SPLIT_MIN_ROWS = 2;

type Props = {
  templates: AssemblyTemplateSummaryDto[];
  busy?: boolean;
  emptyMessage?: string;
  onHistoryClick: (lineageGroupKey: string) => void;
  lineageGroupKey: (template: AssemblyTemplateSummaryDto) => string;
  onRetireClick: (template: AssemblyTemplateSummaryDto) => void;
};

type PaneProps = Props & {
  label: string;
  startIndex: number;
};

function rangeLabel(startIndex: number, rowCount: number): string {
  if (rowCount <= 0) return '';
  return `${startIndex + 1} - ${startIndex + rowCount}`;
}

function TemplateTablePane({
  label,
  templates,
  startIndex,
  onHistoryClick,
  lineageGroupKey,
  onRetireClick
}: PaneProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-white/10 bg-slate-950/35">
      <div className="min-h-0 flex-1 overflow-auto p-1">
        <table
          className="w-full table-fixed border-collapse text-left text-[0.82rem]"
          aria-label={`組立テンプレート ${label} ${rangeLabel(startIndex, templates.length)}`}
        >
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[24%]" />
            <col className="w-[48%]" />
          </colgroup>
          <thead className="sticky top-0 bg-slate-900 text-[0.72rem] text-white/70">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1.5 font-bold">型番</th>
              <th className="px-2 py-1.5 font-bold">手順</th>
              <th className="px-2 py-1.5 font-bold">手順書</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <Fragment key={template.id}>
                <tr className="border-t border-white/10 first:border-t-0">
                  <td className="truncate px-2 pb-0.5 pt-1.5 font-bold text-white" title={template.modelCode}>
                    {template.modelCode}
                  </td>
                  <td className="truncate px-2 pb-0.5 pt-1.5 text-white/85" title={template.procedurePattern}>
                    {template.procedurePattern}
                  </td>
                  <td className="truncate px-2 pb-0.5 pt-1.5 font-semibold text-white/90" title={template.procedureDocumentName}>
                    {template.procedureDocumentName}
                  </td>
                </tr>
                <tr className="border-b border-white/10 last:border-b-0">
                  <td colSpan={3} className="px-2 pb-1 pt-0 text-[0.68rem] text-white/55">
                    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                      <span className="min-w-0 truncate font-semibold text-white/75" title={template.name}>{template.name}</span>
                      <span className="shrink-0 font-semibold">v{template.version}</span>
                      <span className={template.isActive ? 'shrink-0 text-emerald-200' : 'shrink-0 text-amber-200'}>
                        {template.isActive ? '有効' : '旧版'}
                      </span>
                      <span className="shrink-0">工程 {template.areaCount}</span>
                      <span className="shrink-0">締付 {template.boltCount}</span>
                      <span className="shrink-0">更新 {formatAssemblyTimestamp(template.updatedAt)}</span>
                      <div className="ml-auto flex w-[10.5rem] shrink-0 justify-end gap-0.5">
                        <Link
                          to={kioskAssemblyTemplateEditPath(template.id)}
                          className={buttonClassName(
                            'secondary',
                            'inline-flex min-h-5 min-w-[1.8rem] shrink-0 items-center rounded !px-1 !py-0 text-[0.58rem] leading-none'
                          )}
                        >
                          編集
                        </Link>
                        <Link
                          to={kioskAssemblyTemplateNewPath({ sourceTemplateId: template.id })}
                          className={buttonClassName(
                            'ghostOnDark',
                            'inline-flex min-h-5 min-w-[1.8rem] shrink-0 items-center rounded !px-1 !py-0 text-[0.58rem] leading-none'
                          )}
                        >
                          雛形
                        </Link>
                        <Button
                          type="button"
                          variant="ghostOnDark"
                          className="min-h-5 min-w-[1.8rem] shrink-0 rounded !px-1 !py-0 text-[0.58rem] leading-none"
                          onClick={() => onHistoryClick(lineageGroupKey(template))}
                        >
                          履歴
                        </Button>
                        <Button
                          type="button"
                          variant="ghostOnDark"
                          className="min-h-5 min-w-[1.8rem] shrink-0 rounded !px-1 !py-0 text-[0.58rem] leading-none"
                          disabled={!template.isActive}
                          onClick={() => onRetireClick(template)}
                        >
                          無効
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AssemblyTemplateLibraryTable({
  templates,
  busy = false,
  emptyMessage = '条件に合う組立テンプレートはありません。',
  onHistoryClick,
  lineageGroupKey,
  onRetireClick
}: Props) {
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
        busy={busy}
        emptyMessage={emptyMessage}
        onHistoryClick={onHistoryClick}
        lineageGroupKey={lineageGroupKey}
        onRetireClick={onRetireClick}
      />
      {secondTemplates.length > 0 ? (
        <TemplateTablePane
          label="下段"
          templates={secondTemplates}
          startIndex={splitIndex}
          busy={busy}
          emptyMessage={emptyMessage}
          onHistoryClick={onHistoryClick}
          lineageGroupKey={lineageGroupKey}
          onRetireClick={onRetireClick}
        />
      ) : null}
    </div>
  );
}
