import { Dialog } from '../../components/ui/Dialog';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const WORK_INSTRUCTION_EDITOR_BUTTON_CLASS_NAME = 'min-h-11 min-w-11 rounded-lg border border-[#344252] px-3 text-sm hover:bg-[#27313b] disabled:cursor-default disabled:opacity-40 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#5fc3e8]';

export function WorkInstructionEditorButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${WORK_INSTRUCTION_EDITOR_BUTTON_CLASS_NAME} ${className}`} />;
}

const paths = {
  back: <path d="M15 5l-7 7 7 7" />,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  publish: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 12h10M12 9v6" /></>,
  text: <path d="M5 6h14M12 6v13" />,
  shape: <><rect x="4" y="4" width="7" height="7" /><circle cx="16.5" cy="16.5" r="3.5" /></>,
  range: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  memo: <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6" />,
  compare: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M6 8h3M15 16h3" /></>,
  history: <path d="M3 11a9 9 0 1 1 3 8M3 5v6h6M12 7v5l3 2" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />,
  close: <path d="M6 6l12 12M6 18L18 6" />,
  nfc: <><rect x="2" y="7" width="13" height="13" rx="2" /><path d="M6 7V4h5v3" /><circle cx="8.5" cy="12" r="1.5" /><path d="M5.5 17a3 3 0 0 1 6 0M17 10a5 5 0 0 1 0 7M19 7a9 9 0 0 1 0 13" /></>
};

export function WorkInstructionEditorIcon({ name, className = 'h-[26px] w-[26px]' }: { name: keyof typeof paths; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function WorkInstructionEditorPanelHeading({ title, onClose }: { title: string; onClose?: () => void }) {
  return <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-black">{title}</h2><WorkInstructionEditorButton aria-label={`${title}を閉じる`} title={`${title}を閉じる`} onClick={onClose} className="h-11 w-11 !p-0 text-[#9fadb9]"><WorkInstructionEditorIcon name="close" className="mx-auto h-[22px] w-[22px]" /></WorkInstructionEditorButton></div>;
}

export function WorkInstructionEditorDialog({ children, ...props }: { isOpen: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  return <Dialog {...props} size="md" overlayZIndex={400} className="!my-auto !w-[540px] !max-w-[calc(100vw-32px)] !rounded-[14px] !border !border-[#344252] !bg-[#161c22] !p-6 !text-[#eef3f6] [&>p]:!text-lg [&>p]:!text-[#9fadb9]" titleClassName="text-2xl font-bold">{children}</Dialog>;
}

export function WorkInstructionEditorConfirmDialog({ isOpen, title, description, confirmLabel = 'OK', cancelLabel = 'キャンセル', tone = 'primary', onConfirm, onCancel }: { isOpen: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; tone?: 'primary' | 'danger'; onConfirm: () => void; onCancel: () => void }) {
  return <WorkInstructionEditorDialog isOpen={isOpen} onClose={onCancel} title={title} description={description}><div className="mt-6 flex justify-end gap-2"><WorkInstructionEditorButton onClick={onCancel}>{cancelLabel}</WorkInstructionEditorButton><WorkInstructionEditorButton onClick={onConfirm} className={tone === 'danger' ? 'text-[#e5484d]' : '!border-[#3ba776] bg-[#3ba776] text-[#0b1a12]'}>{confirmLabel}</WorkInstructionEditorButton></div></WorkInstructionEditorDialog>;
}
