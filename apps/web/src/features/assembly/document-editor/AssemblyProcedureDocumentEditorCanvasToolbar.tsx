import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  publish: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 12h10M12 9v6" /></>,
  material: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  text: <path d="M5 6h14M12 6v13" />,
  shape: <><rect x="4" y="4" width="7" height="7" /><circle cx="16.5" cy="16.5" r="3.5" /></>,
  range: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />,
  undo: <><path d="M9 5L4 10l5 5M4 10h9a6 6 0 016 6" /></>,
  redo: <><path d="M15 5l5 5-5 5M20 10h-9a6 6 0 00-6 6" /></>,
  delete: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>
};

export function AssemblyProcedureDocumentEditorCanvasToolbar({ controller: c, workshop, materialCount, materialOpen, videoOpen, onMaterial, onVideo, onPublish, onDelete, onDiscard }: {
  controller: AssemblyProcedureDocumentEditorController;
  workshop: boolean;
  materialCount: number | null;
  materialOpen: boolean;
  videoOpen: boolean;
  onMaterial: () => void;
  onVideo: () => void;
  onPublish: () => void;
  onDelete: () => void;
  onDiscard: () => void;
}) {
  const disabled = c.readOnly || c.busy;
  const button = (label: string, icon: string, onClick: () => void, options: { disabled?: boolean; pressed?: boolean; color?: string; target?: string; badge?: number | null } = {}) => <button key={icon} type="button" aria-label={label} title={label} aria-pressed={options.pressed} disabled={options.disabled} data-kiosk-sop-target={options.target} onClick={onClick} className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] text-[#eef3f6] disabled:opacity-40 aria-pressed:bg-[#27313b] ${options.color ?? ''}`}>
    <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icons[icon]}</svg>
    {options.badge != null && options.badge > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f6b93b] px-1 text-[13px] font-black text-[#0b1a12]">{options.badge}</span> : null}
  </button>;
  const separator = <span aria-hidden="true" className="my-1 h-px w-9 shrink-0 bg-[#344252]" />;
  return <nav aria-label="エディタ操作" className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] pb-[84px] pt-2.5">
    {button('保存', 'save', () => void c.save(), { disabled: disabled || !c.canSave, color: '!border-[#3ba776] !bg-[#3ba776] !text-[#0b1a12]', target: 'assembly-document-editor-save' })}
    {button('公開', 'publish', onPublish, { disabled: disabled || !c.canPublish, color: '!border-[#f6b93b] !text-[#f6b93b]', target: 'assembly-document-editor-publish' })}
    {separator}
    {button('素材', 'material', onMaterial, { disabled, pressed: materialOpen, badge: materialCount })}
    {button('動画', 'video', onVideo, { disabled, pressed: videoOpen })}
    {button('文字', 'text', () => c.addOverlay('TEXT'), { disabled, pressed: c.selectedElement?.kind === 'TEXT' })}
    {button('図形', 'shape', () => c.addOverlay('SHAPE'), { disabled, pressed: c.selectedElement?.kind === 'SHAPE' })}
    {button('範囲', 'range', () => c.setSelectionMode(!c.selectionMode), { disabled, pressed: c.selectionMode, target: 'assembly-document-editor-range-add' })}
    {separator}
    {button('元に戻す', 'undo', c.undo, { disabled: disabled || !c.canUndo })}
    {button('やり直す', 'redo', c.redo, { disabled: disabled || !c.canRedo })}
    <span aria-hidden="true" className="min-h-2 flex-1" />
    {c.document?.status === 'draft' ? button(c.document.supersedesDocumentId ? '改版を破棄' : '削除', 'delete', c.document.supersedesDocumentId ? onDiscard : onDelete, { disabled: disabled || (Boolean(c.document.supersedesDocumentId) && !c.canDiscard), color: '!border-transparent !text-[#e5484d]' }) : null}
    {separator}
    {button(workshop ? '工房へ戻る' : '一覧へ', 'back', c.navigateBack, { color: '!border-transparent !text-[#9fadb9]' })}
  </nav>;
}
