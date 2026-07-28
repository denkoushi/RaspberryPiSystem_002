import { forwardRef } from 'react';

import { Button } from '../../components/ui/Button';

type Props = {
  onOpen: () => void;
  className?: string;
};

export const KioskSopButton = forwardRef<HTMLButtonElement, Props>(
  function KioskSopButton({ onOpen, className }, ref) {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghostOnDark"
        aria-label="この画面の操作手順を開く"
        className={`min-h-11 min-w-11 shrink-0 !px-3 text-[0.95rem] ${className ?? ''}`}
        data-testid="kiosk-sop-open-button"
        onClick={onOpen}
      >
        取説
      </Button>
    );
  }
);
