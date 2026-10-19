import { SignagePdfManager } from '../../../components/signage/SignagePdfManager';

import { PanelFrame } from './PanelFrame';

/** PDF のアップロードと一覧。中身は既存の SignagePdfManager を使う。 */
export function PdfPanel({ onBack }: { onBack: () => void }) {
  return (
    <PanelFrame title="PDF" accent="var(--sh-kind-pdf)" onBack={onBack}>
      <div className="sh-legacy">
        <SignagePdfManager title="" />
      </div>
    </PanelFrame>
  );
}
