import { Dialog } from '../../../components/ui/Dialog';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import type { ReactNode } from 'react';

export function HaizenSheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <div style={haizenPhoneStyle}>
      <Dialog isOpen onClose={onClose} ariaLabel={title} className={hp.sheet} overlayZIndex={60}>
        <div style={haizenPhoneStyle} className={`flex min-h-0 flex-col gap-3 ${hp.hermesBottomPadding}`}>
          <div aria-hidden className="mx-auto h-1 w-10 rounded-sm bg-[var(--hp-line)]" />
          {children}
        </div>
      </Dialog>
    </div>
  );
}
