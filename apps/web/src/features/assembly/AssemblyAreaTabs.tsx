import clsx from 'clsx';

import { Button } from '../../components/ui/Button';

import { formatAssemblyEditorName } from './assemblyTemplateGuidePresentation';

import type { AssemblyDraftArea } from './assemblyTemplateDraft';

type Props = {
  areas: AssemblyDraftArea[];
  selectedAreaId: string;
  incompleteAreaIds: ReadonlySet<string>;
  readOnly: boolean;
  onSelect: (areaId: string) => void;
  onAdd: () => void;
};

function areaLabel(area: AssemblyDraftArea, index: number): string {
  return (
    [area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-') ||
    area.areaName.trim() ||
    `工程 ${index + 1}`
  );
}

/** 丸数字を置く先の工程を、図面のすぐ上で切り替える。並べ替え・削除・詳細は左の「文書・工程」に残す。 */
export function AssemblyAreaTabs({ areas, selectedAreaId, incompleteAreaIds, readOnly, onSelect, onAdd }: Props) {
  return (
    <div role="tablist" aria-label="工程" className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs font-bold text-white/60">工程</span>
      {areas.map((area, index) => {
        const selected = area.id === selectedAreaId;
        const label = areaLabel(area, index);
        const incomplete = incompleteAreaIds.has(area.id);
        return (
          <button
            key={area.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={`${label}（締付 ${area.bolts.length}か所${incomplete ? '・未完了' : ''}）`}
            title={label}
            className={clsx(
              'flex min-h-8 max-w-[14rem] items-center gap-2 rounded border px-2 text-sm font-bold',
              selected
                ? 'border-cyan-300 bg-cyan-900/45 text-white'
                : 'border-white/15 bg-slate-950/60 text-white/85 hover:bg-slate-800'
            )}
            onClick={() => onSelect(area.id)}
          >
            <span className="min-w-0 truncate">{formatAssemblyEditorName(label)}</span>
            <span
              className={clsx(
                'shrink-0 rounded-full px-1.5 text-xs tabular-nums',
                incomplete ? 'bg-amber-500/20 text-amber-200' : 'bg-white/10 text-white/80'
              )}
            >
              {area.bolts.length}
            </span>
          </button>
        );
      })}
      <Button
        type="button"
        variant="ghostOnDark"
        aria-label="工程を追加"
        className="min-h-8 shrink-0 !px-3 text-sm"
        disabled={readOnly}
        onClick={onAdd}
      >
        ＋
      </Button>
    </div>
  );
}
