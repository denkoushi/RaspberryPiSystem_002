import { useState } from 'react';

import { ProtectedImage } from '../../components/ProtectedImage';

import type { KnowledgeProcedureDocument, KnowledgeProcedureStep } from '@raspi-system/shared-types';

export type KnowledgeProcedureViewProps = {
  procedure: KnowledgeProcedureDocument;
  /** Resolves authorized local routes, never a URL supplied by the model. */
  imagePathFor: (imageId: string) => string | null;
  /** Reading uses one step at a time; reviewing shows all steps. */
  singleStep?: boolean;
  onReportError?: () => void;
};

function StatusBanner({ procedure, onReportError }: Pick<KnowledgeProcedureViewProps, 'procedure' | 'onReportError'>) {
  if (procedure.state !== 'published') {
    return <div role="status" className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800"><strong>承認待ち</strong></div>;
  }
  const automatic = procedure.reviewTier === 'auto_publish';
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${automatic ? 'bg-violet-100 text-violet-700' : 'bg-green-100 text-green-700'}`}>
      <strong>{automatic ? 'AI作成' : '承認済み'}</strong>
      {onReportError ? <button type="button" onClick={onReportError} className="h-11 rounded-md border border-current bg-white px-3 text-sm">誤りを報告</button> : null}
    </div>
  );
}

function Step({ step, number, imagePathFor }: { step: KnowledgeProcedureStep; number: number; imagePathFor: KnowledgeProcedureViewProps['imagePathFor'] }) {
  return (
    <li className="grid grid-cols-[32px_1fr] gap-2 border-b border-slate-200 py-3 last:border-b-0">
      <div aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-sky-700 text-base font-bold text-white">{number}</div>
      <div className="min-w-0">
        <h3 className="mb-2 mt-1 text-base font-semibold"><span className="sr-only">手順{number} </span>{step.title}</h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{step.body}</p>
        {step.cautions.map(caution => (
          <p key={caution} className="mt-2.5 border-l-4 border-amber-700 bg-amber-100 px-3 py-2 text-sm text-amber-900">注意：{caution}</p>
        ))}
        {step.needsReview.map(issue => (
          <p key={issue} className="mt-2.5 rounded-md border border-dashed border-amber-700 bg-amber-50 px-3 py-2 text-sm text-amber-700">要確認：{issue}</p>
        ))}
        {step.photos.length ? (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
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
export function KnowledgeProcedureView({ procedure, imagePathFor, onReportError, singleStep = false }: KnowledgeProcedureViewProps) {
  const [index, setIndex] = useState(0);
  const total = procedure.steps.length;
  const current = Math.max(0, Math.min(index, total - 1));
  const { partNumber, drawingNumber, processName } = procedure.identifiers;
  const chips = [
    partNumber ? `品番 ${partNumber}` : null, drawingNumber ? `図番 ${drawingNumber}` : null, processName ? `工程 ${processName}` : null,
    `第${procedure.revisionNumber}版・${new Date(procedure.createdAt).toLocaleDateString('ja-JP')}`,
  ].filter((chip): chip is string => chip !== null);
  const visible = !singleStep ? procedure.steps.map((step, i) => ({ step, number: i + 1 })) : procedure.steps[current] ? [{ step: procedure.steps[current]!, number: current + 1 }] : [];

  return (
    <article className="break-words text-slate-900" aria-label="手順書">
      <header className="border-b border-slate-200 pb-2">
        <p className="text-sm text-slate-600">{procedure.category}</p>
        <h1 className="mb-2.5 mt-1.5 text-xl font-bold">{procedure.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(chip => <span key={chip} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[13px]">{chip}</span>)}
        </div>
        <StatusBanner procedure={procedure} onReportError={onReportError} />
      </header>

      <ol className="list-none p-0">
        {visible.map(({ step, number }) => <Step key={step.id} step={step} number={number} imagePathFor={imagePathFor} />)}
      </ol>

      {singleStep && total > 0 ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" disabled={current === 0} onClick={() => setIndex(current - 1)}
            className="h-11 rounded-lg border border-sky-700 bg-white px-3 text-sm text-sky-700 disabled:opacity-40">前へ</button>
          <span aria-live="polite" className="text-base text-slate-600">{current + 1} / {total}</span>
          <button type="button" disabled={current === total - 1} onClick={() => setIndex(current + 1)}
            className="h-11 rounded-lg border border-sky-700 bg-sky-700 px-3 text-sm text-white disabled:opacity-40">次へ</button>
        </div>
      ) : null}
    </article>
  );
}
