import { useEffect, useState } from 'react';

import { KioskSopButton } from './KioskSopButton';
import { KioskSopDialog } from './KioskSopDialog';
import { getKioskSopManual } from './kioskSopRegistry';

import type { KioskSopManualId } from './types';

type Props = {
  manualId: KioskSopManualId;
  initialSheetId: string;
  className?: string;
};

export function KioskSopLauncher({ manualId, initialSheetId, className }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const manual = getKioskSopManual(manualId);

  useEffect(() => {
    manual.loadSourceHtml().catch(() => undefined);
  }, [manual]);

  return (
    <>
      <KioskSopButton className={className} onOpen={() => setIsOpen(true)} />
      <KioskSopDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        manual={manual}
        initialSheetId={initialSheetId}
      />
    </>
  );
}
