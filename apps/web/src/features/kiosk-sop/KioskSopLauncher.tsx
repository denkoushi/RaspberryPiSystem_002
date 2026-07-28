import { useState } from 'react';

import { KioskSopButton } from './KioskSopButton';
import { KioskSopDialog } from './KioskSopDialog';

import type { KioskSopView } from './types';

type Props = {
  view: KioskSopView;
  className?: string;
};

export function KioskSopLauncher({ view, className }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <KioskSopButton className={className} onOpen={() => setIsOpen(true)} />
      <KioskSopDialog isOpen={isOpen} onClose={() => setIsOpen(false)} view={view} />
    </>
  );
}
