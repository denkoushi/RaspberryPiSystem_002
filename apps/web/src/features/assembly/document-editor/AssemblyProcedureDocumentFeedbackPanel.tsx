import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';

import type { ProcedureDocumentFeedback } from '@raspi-system/shared-types';

const sections = [
  ['questions', '素朴な質問'],
  ['missing', '足りないかも'],
  ['unclear', '分かりにくいかも'],
  ['ideas', 'こうしたらいいかも'],
] as const;

const feedbackDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });

const feedbackFontSizeStorageKey = 'assembly-document-feedback-font-size';
const feedbackFontSizes = [12, 14, 16, 18, 20, 24, 28] as const;
const defaultFontSizeIndex = feedbackFontSizes.indexOf(14);

function readStoredFontSizeIndex() {
  try {
    const index = feedbackFontSizes.findIndex(size => String(size) === localStorage.getItem(feedbackFontSizeStorageKey));
    if (index >= 0) return index;
  } catch { /* Fall back to the default when local storage is unavailable. */ }
  return defaultFontSizeIndex;
}

export function AssemblyProcedureDocumentFeedbackPanel({ feedback }: { feedback: ProcedureDocumentFeedback }) {
  const [fontSizeIndex, setFontSizeIndex] = useState(readStoredFontSizeIndex);
  useEffect(() => {
    try { localStorage.setItem(feedbackFontSizeStorageKey, String(feedbackFontSizes[fontSizeIndex])); }
    catch { /* The panel remains usable when local storage is unavailable. */ }
  }, [fontSizeIndex]);
  const changeFontSize = (step: number) => {
    setFontSizeIndex(current => Math.min(feedbackFontSizes.length - 1, Math.max(0, current + step)));
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
          {feedback[key].map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      </div>)}
    </div>
  </section>;
}
