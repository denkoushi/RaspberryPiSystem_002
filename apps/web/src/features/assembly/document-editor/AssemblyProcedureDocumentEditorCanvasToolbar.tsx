import { memo } from 'react';

import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';

import { EditorIconButton } from './EditorIconButton';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  back: <><path d="M9 4h11v16H9M14 12H3M6 8l-4 4 4 4" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  saving: <><circle cx="12" cy="12" r="8" strokeDasharray="30 20" /><path d="M12 7v5l3 2" /></>,
  saved: <path d="M4 12l5 5L20 6" />,
  publish: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 12h10M12 9v6" /></>,
  material: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  text: <path d="M5 6h14M12 6v13" />,
  shape: <><rect x="4" y="4" width="7" height="7" /><circle cx="16.5" cy="16.5" r="3.5" /></>,
  range: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />,
  sharpen: <path d="M12 3l9 9-9 9-9-9zM9 12h6M12 9v6" />,
  layout: <><rect x="4" y="4" width="6" height="5" rx="1" /><rect x="4" y="13" width="6" height="5" rx="1" /><path d="M14 5h6M14 8h6M14 14h6M14 17h6" /></>,
  clean: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h.1m-.1 4.5h.1m-.1 4.5h.1M11.5 8H16m-4.5 4.5H16m-4.5 4.5H16" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  undo: <><path d="M9 5L4 10l5 5M4 10h9a6 6 0 016 6" /></>,
  redo: <><path d="M15 5l5 5-5 5M20 10h-9a6 6 0 00-6 6" /></>
};

export const AssemblyProcedureDocumentEditorCanvasToolbar = memo(function AssemblyProcedureDocumentEditorCanvasToolbar({ controller: c, workshop, materialCount, materialOpen, videoOpen, onMaterial, onVideo, onPublish, voiceInputEnabled, onToggleVoiceInput, cleanView, canShowCleanView, onToggleCleanView }: {
  controller: Pick<AssemblyProcedureDocumentEditorController,
    'readOnly' | 'busy' | 'canSave' | 'canPublish' | 'canUndo' | 'canRedo' |
    'canTogglePhotoSharpen' | 'photoSharpened' | 'togglePhotoSharpen' |
    'selectionMode' | 'navigateBack' | 'save' | 'addOverlay' | 'setSelectionMode' | 'undo' | 'redo'> & {
      isDirty?: boolean;
      saving?: boolean;
      selectedKind?: NonNullable<AssemblyProcedureDocumentEditorController['selectedElement']>['kind'];
      layoutLocked: boolean;
      canSuggest: boolean;
      startLayout: AssemblyProcedureDocumentEditorController['layoutSuggestions']['start'];
    };
  workshop: boolean;
  cleanView: boolean;
  canShowCleanView: boolean;
  onToggleCleanView: () => void;
  voiceInputEnabled: boolean;
  onToggleVoiceInput: () => void;
  materialCount: number | null;
  materialOpen: boolean;
  videoOpen: boolean;
  onMaterial: () => void;
  onVideo: () => void;
  onPublish: () => void;
}) {
  const { unavailable } = useLocalLlmAvailability();
  const disabled = c.readOnly || c.busy;
  const editingDisabled = disabled || cleanView;
  const button = (label: string, icon: string, onClick: () => void, options: { disabled?: boolean; pressed?: boolean; color?: string; target?: string; badge?: number | null } = {}) => <EditorIconButton key={icon} aiUnavailable={icon === 'layout' && unavailable} label={label} icon={icons[icon]} onClick={onClick} disabled={options.disabled} pressed={options.pressed} target={options.target} badge={options.badge} className={options.color} tipSide="left" />;
  const separator = <span aria-hidden="true" className="my-1 h-px w-9 shrink-0 bg-[#344252]" />;
  return <nav aria-label="エディタ操作" className="col-start-5 flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] pb-[84px] pt-2.5">
    {button(workshop ? '工房へ戻る' : '一覧へ戻る', 'back', c.navigateBack, { disabled: c.layoutLocked, color: '!border-transparent !text-[#9fadb9]' })}
    {separator}
    {button(c.saving ? '保存中' : c.isDirty ? '未保存の変更を保存する' : c.isDirty === false ? '保存済み' : '保存する', c.saving ? 'saving' : c.isDirty === false ? 'saved' : 'save', () => void c.save(), { disabled: disabled || !c.canSave, color: c.saving ? '!border-[#5fc3e8] !text-[#5fc3e8]' : c.isDirty ? '!border-[#f6b93b] !bg-[#f6b93b] !text-[#0b1a12]' : '!border-[#3ba776] !text-[#3ba776]', target: 'assembly-document-editor-save' })}
    {button('公開する', 'publish', onPublish, { disabled: disabled || !c.canPublish, color: '!border-[#f6b93b] !text-[#f6b93b]', target: 'assembly-document-editor-publish' })}
    {separator}
    {button('素材を置く', 'material', onMaterial, { disabled: editingDisabled, pressed: materialOpen, badge: materialCount })}
    {button('動画をつなぐ', 'video', onVideo, { disabled: editingDisabled, pressed: videoOpen })}
    {button('文字を置く', 'text', () => c.addOverlay('TEXT'), { disabled: editingDisabled, pressed: c.selectedKind === 'TEXT' })}
    {button('図形を置く', 'shape', () => c.addOverlay('SHAPE'), { disabled: editingDisabled, pressed: c.selectedKind === 'SHAPE' })}
    {button('範囲を選ぶ', 'range', () => c.setSelectionMode(!c.selectionMode), { disabled: editingDisabled, pressed: c.selectionMode, target: 'assembly-document-editor-range-add' })}
    {button(c.photoSharpened ? '元の写真に戻す' : '写真をくっきり', 'sharpen', () => void c.togglePhotoSharpen(),
      { disabled: editingDisabled || !c.canTogglePhotoSharpen, pressed: c.photoSharpened })}
    {button('整える', 'layout', () => void c.startLayout(), { disabled: editingDisabled || !c.canSuggest, pressed: c.layoutLocked, color: '!border-[#5fc3e8] !text-[#5fc3e8]' })}
    {button(cleanView ? '元のページに戻る' : '清書で見る', 'clean', onToggleCleanView, { disabled: !canShowCleanView, pressed: cleanView })}
    {button('音声入力', 'mic', onToggleVoiceInput, { disabled: editingDisabled, pressed: voiceInputEnabled, target: 'assembly-document-editor-voice-input', color: voiceInputEnabled ? '!border-[#7cc4ff] !bg-[#7cc4ff1f] !text-[#7cc4ff]' : undefined })}
    {separator}
    {button('元に戻す', 'undo', c.undo, { disabled: editingDisabled || !c.canUndo })}
    {button('やり直す', 'redo', c.redo, { disabled: editingDisabled || !c.canRedo })}
    <span aria-hidden="true" className="min-h-2 flex-1" />
  </nav>;
});
