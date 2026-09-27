import { useState } from 'react';

import { ProtectedImage } from '../../components/ProtectedImage';

import type { KnowledgeProcedureDocument, KnowledgeProcedureStep } from '@raspi-system/shared-types';

export type KnowledgeProcedureViewProps = {
  procedure: KnowledgeProcedureDocument;
  /** Resolves authorized local routes, never a URL supplied by the model. */
  imagePathFor: (imageId: string) => string | null;
  /** Shown on AI-created (auto_publish) procedures once error reports exist. */
  onReportError?: () => void;
};

type Mode = 'all' | 'single';

function StatusBanner({ procedure, onReportError }: Pick<KnowledgeProcedureViewProps, 'procedure' | 'onReportError'>) {
  if (procedure.state !== 'published') {
    return (
      <div role="status" className="mt-3 rounded-lg bg-slate-200 px-4 py-2.5 text-[15px] text-slate-700">
        <strong className="mr-2">下書き・承認待ち</strong>品質に直結する手順のため、班長相当以上の承認後に公開されます。
      </div>
    );
  }
  if (procedure.reviewTier === 'approval_required') {
    return <div className="mt-3 rounded-lg bg-green-100 px-4 py-2.5 text-[15px] text-green-700"><strong>承認済み</strong></div>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-violet-100 px-4 py-2.5 text-[15px] text-violet-700">
      <span><strong className="mr-2">AI作成</strong>AIが素材から作成しました。出典と照らし合わせて使ってください。</span>
      {onReportError ? (
        <button type="button" onClick={onReportError} className="rounded-md border border-current bg-white px-3 py-1.5 text-sm">誤りを報告</button>
      ) : null}
    </div>
  );
}

function Step({ step, number, imagePathFor }: { step: KnowledgeProcedureStep; number: number; imagePathFor: KnowledgeProcedureViewProps['imagePathFor'] }) {
  return (
    <li className="grid grid-cols-[56px_1fr] gap-4 border-b border-slate-200 py-5 last:border-b-0">
      <div aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-sky-700 text-[22px] font-bold text-white">{number}</div>
      <div className="min-w-0">
        <h3 className="mb-2 mt-1 text-xl font-semibold"><span className="sr-only">手順{number} </span>{step.title}</h3>
        <p className="whitespace-pre-wrap break-words text-[17px] leading-8">{step.body}</p>
        {step.cautions.map(caution => (
          <p key={caution} className="mt-2.5 border-l-4 border-amber-700 bg-amber-100 px-3 py-2 text-[15px] text-amber-900">注意：{caution}</p>
        ))}
        {step.needsReview.map(issue => (
          <p key={issue} className="mt-2.5 rounded-md border border-dashed border-amber-700 bg-amber-50 px-3 py-2 text-[15px] text-amber-700">要確認：{issue}</p>
        ))}
        {step.photos.length ? (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {step.photos.map(photo => (
              <figure key={photo.imageId} className="overflow-hidden rounded-md border border-slate-200">
                <ProtectedImage imagePath={imagePathFor(photo.imageId)} alt={photo.caption || `手順${number}の写真`}
                  className="max-h-[28rem] w-full bg-slate-100 object-contain" emptyFallback="画像を参照できません" />
                {photo.caption ? <figcaption className="px-2.5 py-2 text-sm text-slate-600">{photo.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        ) : null}
        <details className="mt-2.5 text-sm">
          <summary className="cursor-pointer text-sky-700">出典（{step.sources.length}件）</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
            {step.sources.map(source => (
              <li key={`${source.kind}:${source.ref}`} className="break-words">
                {source.label}{source.quote ? `「${source.quote}」` : ''}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
}

/** Fixed template with React text escaping; no model-generated HTML is executed. */
export function KnowledgeProcedureView({ procedure, imagePathFor, onReportError }: KnowledgeProcedureViewProps) {
  const [mode, setMode] = useState<Mode>('all');
  const [index, setIndex] = useState(0);
  const total = procedure.steps.length;
  const current = Math.min(index, total - 1);
  const { partNumber, drawingNumber, processName } = procedure.identifiers;
  const chips = [
    partNumber ? `品番 ${partNumber}` : null, drawingNumber ? `図番 ${drawingNumber}` : null, processName ? `工程 ${processName}` : null,
    `第${procedure.revisionNumber}版・${new Date(procedure.createdAt).toLocaleDateString('ja-JP')}`,
  ].filter((chip): chip is string => chip !== null);
  const visible = mode === 'all' ? procedure.steps.map((step, i) => ({ step, number: i + 1 })) : [{ step: procedure.steps[current]!, number: current + 1 }];

  return (
    <article className="text-slate-900" aria-label="手順書">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-sm text-slate-600">{procedure.category}</p>
        <h1 className="mb-2.5 mt-1.5 text-[26px] font-bold">{procedure.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(chip => <span key={chip} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[13px]">{chip}</span>)}
        </div>
        <StatusBanner procedure={procedure} onReportError={onReportError} />
      </header>

      <div role="group" aria-label="表示方法" className="mb-1.5 mt-4 flex gap-1.5">
        {(['all', 'single'] as const).map(value => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
            className={`rounded-md border border-sky-700 px-3.5 py-2 text-[15px] ${mode === value ? 'bg-sky-700 text-white' : 'bg-white text-sky-700'}`}>
            {value === 'all' ? '全体を表示' : '1手順ずつ'}
          </button>
        ))}
      </div>

      <ol className="list-none p-0">
        {visible.map(({ step, number }) => <Step key={step.id} step={step} number={number} imagePathFor={imagePathFor} />)}
      </ol>

      {mode === 'single' ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" disabled={current === 0} onClick={() => setIndex(current - 1)}
            className="min-w-40 rounded-lg border border-sky-700 bg-white px-5 py-3.5 text-lg text-sky-700 disabled:opacity-40">◀ 前へ</button>
          <span aria-live="polite" className="text-base text-slate-600">手順 {current + 1} / {total}</span>
          <button type="button" disabled={current === total - 1} onClick={() => setIndex(current + 1)}
            className="min-w-40 rounded-lg border border-sky-700 bg-sky-700 px-5 py-3.5 text-lg text-white disabled:opacity-40">次へ ▶</button>
        </div>
      ) : null}
    </article>
  );
}
