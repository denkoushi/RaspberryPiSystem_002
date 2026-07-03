import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import { kioskAssemblyTemplateEditPath, kioskAssemblyTemplateNewPath } from './assemblyRoutes';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyTemplateSummaryDto } from './types';

type Props = {
  isOpen: boolean;
  title: string;
  templates: AssemblyTemplateSummaryDto[];
  onClose: () => void;
};

export function AssemblyTemplateHistoryDialog({ isOpen, title, templates, onClose }: Props) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="テンプレート履歴" description={title} size="lg">
      <div className="mt-4 max-h-[60dvh] overflow-auto rounded border border-slate-200">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[19%]" />
            <col className="w-[26%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr>
              <th className="px-2 py-2 font-bold">版</th>
              <th className="px-2 py-2 font-bold">状態</th>
              <th className="px-2 py-2 font-bold">手順書</th>
              <th className="px-2 py-2 font-bold">点</th>
              <th className="px-2 py-2 font-bold">更新</th>
              <th className="px-2 py-2 text-right font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id} className="border-t border-slate-200">
                <td className="px-2 py-2 font-bold">v{template.version}</td>
                <td className="px-2 py-2">
                  <span className={template.isActive ? 'font-bold text-emerald-700' : 'font-semibold text-slate-500'}>
                    {template.isActive ? '有効版' : '旧版'}
                  </span>
                </td>
                <td className="truncate px-2 py-2" title={template.procedureDocumentName}>
                  {template.procedureDocumentName}
                </td>
                <td className="px-2 py-2">{template.boltCount}</td>
                <td className="px-2 py-2">{formatAssemblyTimestamp(template.updatedAt)}</td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1">
                    <Link
                      to={kioskAssemblyTemplateEditPath(template.id)}
                      className={buttonClassName(
                        'secondary',
                        'inline-flex min-h-7 items-center rounded !px-2 !py-0 text-[0.75rem]'
                      )}
                    >
                      表示
                    </Link>
                    <Link
                      to={kioskAssemblyTemplateNewPath({ sourceTemplateId: template.id })}
                      className={buttonClassName(
                        'ghost',
                        'inline-flex min-h-7 items-center rounded !px-2 !py-0 text-[0.75rem]'
                      )}
                    >
                      雛形
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
