import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';

import { AssemblyLibraryActionIcon } from './AssemblyLibraryActionIcon';
import { kioskAssemblyTemplateEditPath, kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import { formatAssemblyMachineName } from './assemblyTemplateGuidePresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyTemplateSummaryDto } from './types';

type Props = {
  templates: AssemblyTemplateSummaryDto[];
  busy?: boolean;
  emptyMessage?: string;
  onHistoryClick: (lineageGroupKey: string) => void;
  lineageGroupKey: (template: AssemblyTemplateSummaryDto) => string;
  onRetireClick: (template: AssemblyTemplateSummaryDto) => void;
  highlightedTemplateId?: string | null;
};

const symbolClassName = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded !p-0';

export function AssemblyTemplateLibraryTable({
  templates,
  busy = false,
  emptyMessage = '条件に合う組立テンプレートはありません。',
  onHistoryClick,
  lineageGroupKey,
  onRetireClick,
  highlightedTemplateId
}: Props) {
  if (templates.length === 0) {
    return <div className="py-4 text-center text-white/60">{busy ? '読込中…' : emptyMessage}</div>;
  }

  return (
    <div className="h-full min-h-0 w-full overflow-auto">
      <table className="w-full min-w-[1080px] table-fixed border-collapse text-left text-base" aria-label="組立テンプレート">
        <colgroup>
          <col /><col className="w-[18%]" /><col className="w-[26%]" /><col className="w-[70px]" />
          <col className="w-[90px]" /><col className="w-[140px]" /><col className="w-[204px]" />
        </colgroup>
        <thead className="sr-only"><tr>
          {['機種', '手順', '手順書', '版', '有効', '更新', '操作'].map(label => <th key={label} scope="col">{label}</th>)}
        </tr></thead>
        <tbody>
          {templates.map(template => (
            <tr key={template.id} data-template-id={template.id}
              className={`h-14 border-b border-white/10 ${highlightedTemplateId === template.id ? 'bg-emerald-500/15 ring-1 ring-inset ring-emerald-300/70' : ''}`}>
              <td className="truncate px-2 text-xl font-bold" title={template.modelCode}>{formatAssemblyMachineName(template.modelCode)}<span className="sr-only"> {template.name} 工程 {template.areaCount} 締付 {template.boltCount}</span></td>
              <td className="truncate px-2 text-lg text-white/60" title={template.procedurePattern}>{template.procedurePattern}</td>
              <td className="truncate px-2 text-lg text-white/60" title={template.procedureDocumentName}>{template.procedureDocumentName}</td>
              <td className="px-2 text-right font-mono text-white/60">v{template.version}</td>
              <td className="px-2"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-sm font-semibold ${template.isActive ? 'border-emerald-400 text-emerald-100' : 'border-red-400 text-red-200'}`}>{template.isActive ? '有効' : '無効'}</span></td>
              <td className="whitespace-nowrap px-2 text-right font-mono text-white/60">{formatAssemblyTimestamp(template.updatedAt)}</td>
              <td className="px-2"><div className="flex justify-end gap-1">
                <Link to={kioskAssemblyTemplateEditPath(template.id)} data-kiosk-sop-target="assembly-template-revise"
                  aria-label={template.isActive ? '改版' : '表示'} title={template.isActive ? '改版' : '表示'}
                  className={buttonClassName('ghostOnDark', `${symbolClassName} !border-amber-400 !text-amber-200`)}>
                  <AssemblyLibraryActionIcon action="edit" />
                </Link>
                <Link to={kioskAssemblyTemplateNewPath({ sourceTemplateId: template.id })} data-kiosk-sop-target="assembly-template-duplicate"
                  aria-label="複製して新規" title="複製して新規" className={buttonClassName('ghostOnDark', symbolClassName)}>
                  <AssemblyLibraryActionIcon action="duplicate" />
                </Link>
                <Button type="button" variant="ghostOnDark" aria-label="履歴" title="履歴" className={symbolClassName} onClick={() => onHistoryClick(lineageGroupKey(template))}>
                  <AssemblyLibraryActionIcon action="history" />
                </Button>
                <Button type="button" variant="ghostOnDark" aria-label="無効" title="無効" className={`${symbolClassName} !border-red-400 !text-red-300`}
                  disabled={!template.isActive} onClick={() => onRetireClick(template)}>
                  <AssemblyLibraryActionIcon action="retire" />
                </Button>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
