import clsx from 'clsx';

export function LoanReportPreviewFrame(props: { html?: string; className?: string }) {
  if (!props.html) {
    return (
      <div
        className={clsx(
          'flex min-h-[50vh] flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 bg-slate-900/30 text-sm text-white/60 lg:min-h-0',
          props.className
        )}
      >
        プレビューは未生成です。「プレビュー生成」を押してください。
      </div>
    );
  }

  const srcDoc = props.html;

  return (
    <iframe
      title="loan-report-preview"
      className={clsx(
        'min-h-[50vh] w-full flex-1 rounded-lg border border-white/10 bg-white lg:min-h-0',
        props.className
      )}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
    />
  );
}
