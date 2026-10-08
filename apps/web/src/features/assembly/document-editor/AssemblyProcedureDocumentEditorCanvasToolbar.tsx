import { EditorIconButton } from './EditorIconButton';

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
  layout: <><rect x="4" y="4" width="6" height="5" rx="1" /><rect x="4" y="13" width="6" height="5" rx="1" /><path d="M14 5h6M14 8h6M14 14h6M14 17h6" /></>,
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
  const button = (label: string, icon: string, onClick: () => void, options: { disabled?: boolean; pressed?: boolean; color?: string; target?: string; badge?: number | null } = {}) => <EditorIconButton key={icon} label={label} icon={icons[icon]} onClick={onClick} disabled={options.disabled} pressed={options.pressed} target={options.target} badge={options.badge} className={options.color} tipSide="left" />;
  const separator = <span aria-hidden="true" className="my-1 h-px w-9 shrink-0 bg-[#344252]" />;
  return <nav aria-label="エディタ操作" className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] pb-[84px] pt-2.5">
    {button('保存する', 'save', () => void c.save(), { disabled: disabled || !c.canSave, color: '!border-[#3ba776] !bg-[#3ba776] !text-[#0b1a12]', target: 'assembly-document-editor-save' })}
    {button('公開する', 'publish', onPublish, { disabled: disabled || !c.canPublish, color: '!border-[#f6b93b] !text-[#f6b93b]', target: 'assembly-document-editor-publish' })}
    {separator}
    {button('素材を置く', 'material', onMaterial, { disabled, pressed: materialOpen, badge: materialCount })}
    {button('動画をつなぐ', 'video', onVideo, { disabled, pressed: videoOpen })}
    {button('文字を置く', 'text', () => c.addOverlay('TEXT'), { disabled, pressed: c.selectedElement?.kind === 'TEXT' })}
    {button('図形を置く', 'shape', () => c.addOverlay('SHAPE'), { disabled, pressed: c.selectedElement?.kind === 'SHAPE' })}
    {button('範囲を選ぶ', 'range', () => c.setSelectionMode(!c.selectionMode), { disabled, pressed: c.selectionMode, target: 'assembly-document-editor-range-add' })}
    {button('整える', 'layout', () => void c.layoutSuggestions.start(), { disabled: disabled || !c.layoutSuggestions.canSuggest, pressed: c.layoutSuggestions.locked, color: '!border-[#5fc3e8] !text-[#5fc3e8]' })}
    {separator}
    {button('元に戻す', 'undo', c.undo, { disabled: disabled || !c.canUndo })}
    {button('やり直す', 'redo', c.redo, { disabled: disabled || !c.canRedo })}
    <span aria-hidden="true" className="min-h-2 flex-1" />
    {c.document?.status === 'draft' ? button(c.document.supersedesDocumentId ? '改版を破棄する' : '削除する', 'delete', c.document.supersedesDocumentId ? onDiscard : onDelete, { disabled: disabled || (Boolean(c.document.supersedesDocumentId) && !c.canDiscard), color: '!border-transparent !text-[#e5484d]' }) : null}
    {separator}
    {button(workshop ? '工房へ戻る' : '一覧へ戻る', 'back', c.navigateBack, { disabled: c.layoutSuggestions.locked, color: '!border-transparent !text-[#9fadb9]' })}
  </nav>;
}
