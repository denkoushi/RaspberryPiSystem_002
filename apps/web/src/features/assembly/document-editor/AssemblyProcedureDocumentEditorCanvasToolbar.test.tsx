import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorCanvasToolbar } from './AssemblyProcedureDocumentEditorCanvasToolbar';

import type { ComponentProps } from 'react';

vi.mock('../../../api/hooks/local-llm', () => ({ useLocalLlmAvailability: () => ({ unavailable: false }) }));

function renderToolbar({ workshop = false, locked = false, readOnly = false, isDirty = false, saving = false, canTogglePhotoSharpen = false, photoSharpened = false, cleanView = false, canShowCleanView = false } = {}) {
  const controller = {
    readOnly, isDirty, saving, busy: saving, canSave: true, canPublish: true, canUndo: true, canRedo: true,
    canTogglePhotoSharpen, photoSharpened, togglePhotoSharpen: vi.fn(),
    layoutLocked: locked, canSuggest: true, startLayout: vi.fn(),
    save: vi.fn(), navigateBack: vi.fn(), undo: vi.fn(), redo: vi.fn()
  } as unknown as ComponentProps<typeof AssemblyProcedureDocumentEditorCanvasToolbar>['controller'];
  const onToggleCleanView = vi.fn();
  render(<AssemblyProcedureDocumentEditorCanvasToolbar controller={controller} cleanView={cleanView} canShowCleanView={canShowCleanView} onToggleCleanView={onToggleCleanView} twoPage={false} workshop={workshop} materialCount={0} materialOpen={false} videoOpen={false} onMaterial={vi.fn()} onVideo={vi.fn()} onPublish={vi.fn()} voiceInputEnabled={false} onToggleVoiceInput={vi.fn()} feedbackButton={{ available: false, open: false, toggle: vi.fn() }} nightlyTargetButton={{ on: true, disabled: false, toggle: vi.fn() }} />);
  return { controller, onToggleCleanView };
}

describe('document editor toolbar navigation', () => {
  it.each([false, true])('keeps return first without document deletion actions (workshop: %s)', workshop => {
    const { controller } = renderToolbar({ workshop });
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    const buttons = within(rail).getAllByRole('button');
    const back = screen.getByRole('button', { name: workshop ? '工房へ戻る' : '一覧へ戻る' });
    expect(buttons[0]).toBe(back);
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改版を破棄する' })).not.toBeInTheDocument();
    expect(buttons[1]).toHaveAccessibleName('保存済み');
    expect(rail.children[1]).toHaveClass('h-px');
    expect(back).toHaveClass('h-12');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(back);
    expect(controller.navigateBack).toHaveBeenCalledOnce();
  });

  it('preserves navigation locking and readonly mutation guards', () => {
    const { controller } = renderToolbar({ locked: true, readOnly: true });
    const back = screen.getByRole('button', { name: '一覧へ戻る' });
    expect(back).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存済み' })).toBeDisabled();
    fireEvent.click(back);
    expect(controller.navigateBack).not.toHaveBeenCalled();
  });
});


it('puts the disabled reading feedback button immediately below voice input', () => {
  renderToolbar();
  const buttons = within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button');
  const feedbackButton = screen.getByRole('button', { name: '読んだ感想', pressed: false });
  expect(buttons[buttons.indexOf(feedbackButton) - 1]).toHaveAccessibleName('音声入力');
  expect(feedbackButton).toBeDisabled();
  const nightlyButton = screen.getByRole('button', { name: '夜に読む: する', pressed: true });
  expect(buttons[buttons.indexOf(feedbackButton) + 1]).toBe(nightlyButton);
  expect(nightlyButton).toBeEnabled();
});

describe('document editor save status', () => {
  it.each([
    { isDirty: true, label: '未保存の変更を保存する', color: '!bg-[#f6b93b]' },
    { saving: true, label: '保存中', color: '!text-[#5fc3e8]' },
    { label: '保存済み', color: '!text-[#3ba776]' }
  ])('shows $label through appearance and accessible name', ({ label, color, ...options }) => {
    renderToolbar(options);
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveClass(color);
    expect(button).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-save');
    expect(button.querySelector('svg')?.innerHTML).not.toBe(screen.getByRole('button', { name: '公開する' }).querySelector('svg')?.innerHTML);
    if ('saving' in options) expect(button).toBeDisabled();
  });
});

describe('photo sharpen button', () => {
  it.each([
    { canTogglePhotoSharpen: false, disabled: true },
    { canTogglePhotoSharpen: true, saving: true, disabled: true },
    { canTogglePhotoSharpen: true, readOnly: true, disabled: true },
    { canTogglePhotoSharpen: true, disabled: false },
    { canTogglePhotoSharpen: true, photoSharpened: true, disabled: false }
  ])('renders the correct state for %o', ({ disabled, ...options }) => {
    const { controller } = renderToolbar(options);
    const button = screen.getByRole('button', {
      name: options.photoSharpened ? '元の写真に戻す' : '写真をくっきり',
      pressed: options.photoSharpened ?? false
    });
    const buttons = within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button');
    const index = buttons.indexOf(button);
    expect(buttons[index - 1]).toHaveAccessibleName('範囲を選ぶ');
    expect(buttons[index + 1]).toHaveAccessibleName('整える');
    if (disabled) expect(button).toBeDisabled();
    else expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(controller.togglePhotoSharpen).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
});

describe('clean view button', () => {
  it('sits immediately after layout and is disabled without text', () => {
    const { onToggleCleanView } = renderToolbar();
    const button = screen.getByRole('button', { name: '清書で見る', pressed: false });
    const buttons = within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button');
    expect(buttons[buttons.indexOf(button) - 1]).toHaveAccessibleName('整える');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggleCleanView).not.toHaveBeenCalled();
  });

  it('allows opening clean view on a read-only page with text', () => {
    const { onToggleCleanView } = renderToolbar({ canShowCleanView: true, readOnly: true });
    const button = screen.getByRole('button', { name: '清書で見る', pressed: false });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onToggleCleanView).toHaveBeenCalledOnce();
  });

  it('keeps save, publish and back available while disabling edits', () => {
    const { onToggleCleanView } = renderToolbar({ cleanView: true, canShowCleanView: true, isDirty: true, canTogglePhotoSharpen: true });
    for (const name of ['素材を置く', '動画をつなぐ', '文字を置く', '図形を置く', '範囲を選ぶ', '写真をくっきり', '整える', '音声入力', '元に戻す', 'やり直す']) {
      expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    for (const name of ['未保存の変更を保存する', '公開する', '一覧へ戻る']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    const button = screen.getByRole('button', { name: '元のページに戻る', pressed: true });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onToggleCleanView).toHaveBeenCalledOnce();
  });
});
