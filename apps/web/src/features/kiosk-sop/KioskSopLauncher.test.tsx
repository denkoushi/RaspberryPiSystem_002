import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  buildKioskSopSrcDoc,
  KIOSK_SOP_CLOSE_MESSAGE,
  KIOSK_SOP_FOCUS_CLOSE_MESSAGE
} from './buildKioskSopSrcDoc';
import { KioskSopDialog } from './KioskSopDialog';
import { KioskSopLauncher } from './KioskSopLauncher';
import { getKioskSopManual } from './kioskSopRegistry';

import type { KioskSopManual } from './types';

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
    const frame = await screen.findByTitle('検査図面 操作取説 — 一覧・検索');

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

  it('closes with Escape while focus remains in the parent document', () => {
    render(<KioskSopLauncher manualId="inspection-drawing" initialSheetId="edit-basics" />);
    fireEvent.click(screen.getByRole('button', { name: 'この画面の操作手順を開く' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads the manual only when opened and then renders the same srcDoc as the source', async () => {
    const real = getKioskSopManual('inspection-drawing');
    const sourceHtml = await real.loadSourceHtml();
    let loaded: string | undefined;
    let resolveLoad!: () => void;
    const loadSourceHtml = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoad = () => { loaded = sourceHtml; resolve(sourceHtml); };
    }));
    const manual: KioskSopManual = { ...real, loadSourceHtml, peekSourceHtml: () => loaded };
    const onClose = vi.fn();

    const { rerender } = render(
      <KioskSopDialog isOpen={false} onClose={onClose} manual={manual} initialSheetId="edit-basics" />
    );
    expect(loadSourceHtml).not.toHaveBeenCalled();

    rerender(<KioskSopDialog isOpen onClose={onClose} manual={manual} initialSheetId="edit-basics" />);
    expect(loadSourceHtml).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('kiosk-sop-frame')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus();

    await act(async () => { resolveLoad(); });
    expect(screen.getByTestId('kiosk-sop-frame').getAttribute('srcdoc')).toBe(
      buildKioskSopSrcDoc(sourceHtml, 'edit-basics')
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '次の手順' }));
    expect(screen.getByTestId('kiosk-sop-frame').getAttribute('srcdoc')).toBe(
      buildKioskSopSrcDoc(sourceHtml, 'edit-visual-source')
    );
    expect(loadSourceHtml).toHaveBeenCalledTimes(1);
  });
});
