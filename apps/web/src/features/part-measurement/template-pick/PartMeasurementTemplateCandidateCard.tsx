import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import { PartMeasurementTemplateCandidateDrawing } from './PartMeasurementTemplateCandidateDrawing';

import type { PartMeasurementTemplateCandidateDto } from '../types';

function matchKindLabel(kind: PartMeasurementTemplateCandidateDto['matchKind']): string {
  switch (kind) {
    case 'exact_resource':
      return '一致（3要素）';
    case 'same_fhincd_other_resource':
      return '類似（2要素・別資源）';
    case 'fhinmei_similar':
      return '類似（1要素・品名）';
    default:
      return kind;
  }
}

type Props = {
  candidate: PartMeasurementTemplateCandidateDto;
  scheduleResourceCd: string;
  onPick: () => void;
  busy: boolean;
};

export function PartMeasurementTemplateCandidateCard({ candidate, scheduleResourceCd, onPick, busy }: Props) {
  const { matchKind, selectable, itemCount, template } = candidate;
  const path = template.visualTemplate?.drawingImageRelativePath;
  const isExact = matchKind === 'exact_resource';

  return (
    <article
      className={clsx(
        'grid grid-cols-1 items-stretch gap-4 rounded-xl border-2 bg-slate-50 p-4 md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)_auto]',
        isExact ? 'border-blue-400 bg-blue-50/90' : 'border-slate-200'
      )}
    >
      <div className="group relative justify-self-center focus-within:z-30 md:justify-self-stretch">
        <div
          className={clsx(
            'relative aspect-[4/3] w-full min-h-[152px] max-w-[300px] overflow-hidden rounded-lg border-2 border-slate-300 bg-white md:max-w-none',
            path ? 'border-slate-300 group-hover:border-blue-500' : 'flex items-center justify-center border-dashed bg-slate-100 text-sm font-semibold text-slate-400'
          )}
        >
          {path ? (
            <PartMeasurementTemplateCandidateDrawing
              drawingImageRelativePath={path}
              alt={`${template.name} の図面`}
              className="h-full w-full object-contain"
            />
          ) : (
            '図面なし'
          )}
        </div>
        {path ? (
          <div
            className="invisible absolute left-1/2 top-full z-20 mt-2 w-[min(92vw,52rem)] -translate-x-1/2 rounded-xl border-2 border-blue-300 bg-white p-2 opacity-0 shadow-2xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 md:left-full md:top-1/2 md:mt-0 md:ml-3 md:w-[min(52rem,94vw)] md:-translate-x-0 md:-translate-y-1/2"
            role="presentation"
          >
            <div className="aspect-[4/3] min-h-[min(42vh,22rem)] w-full overflow-hidden rounded-lg bg-slate-50">
              <PartMeasurementTemplateCandidateDrawing
                drawingImageRelativePath={path}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1">
        <p className="text-base font-bold leading-snug text-slate-900 md:text-lg">
          <span className="mr-2 inline-block rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-900">
            {matchKindLabel(matchKind)}
          </span>
          {template.name}{' '}
          <span className="text-sm font-semibold text-slate-600">
            v{template.version} · テンプレ資源 {template.resourceCd} · 日程資源 {scheduleResourceCd}
          </span>
        </p>
        <p className="text-sm text-slate-600">
          品番 {template.fhincd} · 項目 {itemCount} 件
          {matchKind === 'fhinmei_similar'
            ? ' · 選択すると日程の品番・資源・工程用テンプレを自動作成してから記録を開始します'
            : null}
        </p>
      </div>

      <div className="flex items-center justify-center md:justify-end">
        <Button
          type="button"
          variant="primary"
          className="w-full min-w-[12rem] md:w-auto"
          disabled={!selectable || busy}
          onClick={onPick}
        >
          {busy ? '作成中…' : 'このテンプレで続ける'}
        </Button>
      </div>
    </article>
  );
}
