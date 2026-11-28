import { Button } from '../../../components/ui/Button';
import { useLocalStorage } from '../../../hooks/useLocalStorage';

import type { ProcedureDocumentFeedback, ProcedureDocumentFeedbackSection, ProcedureDocumentFeedbackVerdict } from '@raspi-system/shared-types';

const sections = [
  ['questions', '素朴な質問'],
  ['missing', '足りないかも'],
  ['unclear', '分かりにくいかも'],
  ['ideas', 'こうしたらいいかも'],
] as const;

const feedbackDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });

const feedbackFontSizes = [12, 14, 16, 18, 20, 24, 28];
const defaultFontSize = 14;

function fontSizeIndexOf(size: number) {
  const index = feedbackFontSizes.indexOf(size);
  return index >= 0 ? index : feedbackFontSizes.indexOf(defaultFontSize);
}

function ThumbIcon({ down }: { down?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-5 w-5 fill-current ${down ? 'rotate-180' : ''}`}>
    <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
  </svg>;
}

const ratingButtons = [
  ['useful', '役に立った', 'bg-[#2e9e5b] text-white', false],
  ['miss', '外れ', 'bg-[#d64545] text-white', true],
] as const;

export function AssemblyProcedureDocumentFeedbackPanel({ feedback, onRate, ratingDisabled }: {
  feedback: ProcedureDocumentFeedback;
  onRate: (section: ProcedureDocumentFeedbackSection, itemIndex: number, verdict: ProcedureDocumentFeedbackVerdict | null) => void;
  ratingDisabled: boolean;
}) {
  const [storedFontSize, setStoredFontSize] = useLocalStorage<number>('assembly-document-feedback-font-size', defaultFontSize);
  const fontSizeIndex = fontSizeIndexOf(storedFontSize);
  const changeFontSize = (step: number) => {
    setStoredFontSize(current => feedbackFontSizes[Math.min(feedbackFontSizes.length - 1, Math.max(0, fontSizeIndexOf(current) + step))]);
  };
  return <section aria-label="読んだ感想" className="min-h-0 flex-1 overflow-y-auto break-words p-4">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-[#9fadb9]">第{feedback.revisionNumber}版 <time dateTime={feedback.createdAt}>{feedbackDate.format(new Date(feedback.createdAt))}</time></p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghostOnDark" aria-label="文字を小さく" className="min-h-11 min-w-11 !px-0 text-lg" disabled={fontSizeIndex === 0} onClick={() => changeFontSize(-1)}>−</Button>
        <Button type="button" variant="ghostOnDark" aria-label="文字を大きく" className="min-h-11 min-w-11 !px-0 text-lg" disabled={fontSizeIndex === feedbackFontSizes.length - 1} onClick={() => changeFontSize(1)}>＋</Button>
      </div>
    </div>
    <div data-feedback-body className="mt-3 space-y-4" style={{ fontSize: feedbackFontSizes[fontSizeIndex] }}>
      {sections.map(([key, heading]) => <div key={key}>
        <h2 className="mb-1 font-bold text-[#5fc3e8]">{heading}</h2>
        <ul className="list-disc space-y-1 pl-5">
          {feedback[key].map((item, index) => {
            const current = feedback.ratings.find(rating => rating.section === key && rating.itemIndex === index)?.verdict;
            return <li key={index}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">{item}</span>
                <div className="flex shrink-0 gap-1">
                  {ratingButtons.map(([verdict, label, activeClass, down]) => <button key={verdict} type="button" aria-label={label} aria-pressed={current === verdict}
                    disabled={ratingDisabled} onClick={() => onRate(key, index, current === verdict ? null : verdict)}
                    className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#27313b] disabled:opacity-50 ${current === verdict ? activeClass : 'text-[#9fadb9]'}`}>
                    <ThumbIcon down={down} />
                  </button>)}
                </div>
              </div>
            </li>;
          })}
        </ul>
      </div>)}
    </div>
  </section>;
}
