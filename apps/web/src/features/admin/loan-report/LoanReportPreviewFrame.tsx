export function LoanReportPreviewFrame(props: { html?: string }) {
  if (!props.html) {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-lg border border-dashed border-white/15 bg-slate-900/30 text-sm text-white/60">
        プレビューは未生成です。「プレビュー生成」を押してください。
      </div>
    );
  }

  const srcDoc = props.html;

  return (
    <iframe
      title="loan-report-preview"
      className="h-[70vh] w-full rounded-lg border border-white/10 bg-white"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
    />
  );
}
