import { ProtectedImage } from '../../components/ProtectedImage';

import type { KnowledgeReport } from '@raspi-system/shared-types';


export type KnowledgeReportViewProps = {
  report: KnowledgeReport;
  /** Resolves authorized local routes, never a URL supplied by the model. */
  imagePathFor: (sourceId: string, imageId: string) => string | null;
};

/** Fixed HTML structure with React text escaping; no model-generated HTML is executed. */
export function KnowledgeReportView({ report, imagePathFor }: KnowledgeReportViewProps) {
  return (
    <article className="mx-auto max-w-4xl space-y-8 bg-white p-4 text-slate-900 sm:p-8" aria-label="ナレッジレポート">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-sm text-slate-600">ナレッジレポート</p>
        <h1 className="mt-2 text-2xl font-bold">{report.title}</h1>
        <p className="mt-3 text-sm text-slate-600">AIが整理した内容です。元のメモ・写真・PDFと照らし合わせて確認してください。</p>
      </header>
      {report.sections.map(section => (
        <section key={section.sourceId} className="space-y-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm text-slate-600">{section.category}</p>
            <h2 className="text-xl font-semibold">{section.title}</h2>
          </div>
          <p className="whitespace-pre-wrap break-words leading-7">{section.summary}</p>
          {section.pdf ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>PDF：{section.pdf.filename} — {section.pdf.pageNumber}ページ</p>
              {section.pdf.extraction === 'ocr' ? <p>文字はOCRで読み取っています。ページ画像も確認してください。</p> : null}
              {section.pdf.extraction === 'unreadable' ? <p role="status">文字を読み取れませんでした。ページ画像で確認してください。</p> : null}
            </div>
          ) : null}
          <div className="grid gap-5 sm:grid-cols-2">
            {section.photos.map(photo => (
              <figure key={photo.imageId} className="overflow-hidden rounded border border-slate-200">
                <ProtectedImage imagePath={imagePathFor(section.sourceId, photo.imageId)} alt={photo.description}
                  className="max-h-[36rem] w-full object-contain" emptyFallback="画像を参照できません" />
                <figcaption className="whitespace-pre-wrap break-words p-3 text-sm">{photo.description}</figcaption>
              </figure>
            ))}
          </div>
          <details className="rounded bg-slate-50 p-3">
            <summary className="cursor-pointer font-medium">{section.pdf ? 'PDFから抽出した文章と出典' : '元のメモと出典'}</summary>
            <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-slate-300 pl-3">{section.originalText || '（画像のみ）'}</blockquote>
            <p className="mt-3 text-xs text-slate-600">記録日時：<time dateTime={section.capturedAt}>{section.capturedAt}</time></p>
            <p className="break-all text-xs text-slate-600">出典ID：{section.sourceId}</p>
          </details>
        </section>
      ))}
    </article>
  );
}
