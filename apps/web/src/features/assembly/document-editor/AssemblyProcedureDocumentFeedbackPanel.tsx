import type { ProcedureDocumentFeedback } from '@raspi-system/shared-types';

const sections = [
  ['questions', '素朴な質問'],
  ['missing', '足りないかも'],
  ['unclear', '分かりにくいかも'],
  ['ideas', 'こうしたらいいかも'],
] as const;

const feedbackDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });

export function AssemblyProcedureDocumentFeedbackPanel({ feedback }: { feedback: ProcedureDocumentFeedback }) {
  return <section aria-label="読んだ感想" className="min-h-0 flex-1 space-y-4 overflow-y-auto break-words p-4 text-sm">
    <p className="text-xs text-[#9fadb9]">第{feedback.revisionNumber}版 <time dateTime={feedback.createdAt}>{feedbackDate.format(new Date(feedback.createdAt))}</time></p>
    {sections.map(([key, heading]) => <div key={key}>
      <h2 className="mb-1 font-bold text-[#5fc3e8]">{heading}</h2>
      <ul className="list-disc space-y-1 pl-5">
        {feedback[key].map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>)}
  </section>;
}
