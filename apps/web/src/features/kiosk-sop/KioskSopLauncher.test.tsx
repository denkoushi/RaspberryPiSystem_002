import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  KIOSK_SOP_CLOSE_MESSAGE,
  KIOSK_SOP_FOCUS_CLOSE_MESSAGE
} from './buildKioskSopSrcDoc';
import { KioskSopDialog } from './KioskSopDialog';
import { KioskSopLauncher } from './KioskSopLauncher';

describe('KioskSopLauncher', () => {
  it('opens an isolated dialog, ignores unrelated messages, and returns focus on close', async () => {
    render(<KioskSopLauncher manualId="inspection-drawing" initialSheetId="library-entry-search" />);

    const openButton = screen.getByRole('button', { name: 'この画面の操作手順を開く' });
    openButton.focus();
    fireEvent.click(openButton);

    const dialog = screen.getByRole('dialog', {
      name: '取説 — 検査図面 操作取説 — 一覧・検索'
    });
    const closeButton = screen.getByRole('button', { name: '閉じる' });
    const frame = await screen.findByTitle<HTMLIFrameElement>('検査図面 操作取説 — 一覧・検索');

    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('data-sheet="library-entry-search"');
    expect(frame.getAttribute('srcdoc')).toContain('検査図面を開く');
    expect(closeButton).toHaveFocus();

    fireEvent.mouseDown(dialog);
    expect(dialog).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: KIOSK_SOP_CLOSE_MESSAGE,
          source: window
        })
      );
    });
    expect(dialog).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: KIOSK_SOP_FOCUS_CLOSE_MESSAGE,
          source: frame.contentWindow
        })
      );
    });
    expect(closeButton).toHaveFocus();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: KIOSK_SOP_CLOSE_MESSAGE,
          source: frame.contentWindow
        })
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it('keeps the controls available while loading and ignores completion after closing', async () => {
    let resolveHtml!: (html: string) => void;
    const loadSourceHtml = vi.fn(() => new Promise<string>((resolve) => { resolveHtml = resolve; }));
    const manual = { id: 'test', title: '取説', sheets: [{ id: 'test-sheet', label: '手順' }], loadSourceHtml };
    const onClose = vi.fn();
    const view = render(<KioskSopDialog isOpen={false} onClose={onClose} manual={manual} initialSheetId="test-sheet" />);
    expect(loadSourceHtml).not.toHaveBeenCalled();
    view.rerender(<KioskSopDialog isOpen onClose={onClose} manual={manual} initialSheetId="test-sheet" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeEnabled();
    expect(screen.queryByTestId('kiosk-sop-frame')).not.toBeInTheDocument();
    view.rerender(<KioskSopDialog isOpen={false} onClose={onClose} manual={manual} initialSheetId="test-sheet" />);
    await act(async () => resolveHtml('<html><head></head><body data-sheet="test-sheet">手順</body></html>'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes with Escape while focus remains in the parent document', () => {
    render(<KioskSopLauncher manualId="inspection-drawing" initialSheetId="edit-basics" />);
    fireEvent.click(screen.getByRole('button', { name: 'この画面の操作手順を開く' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
