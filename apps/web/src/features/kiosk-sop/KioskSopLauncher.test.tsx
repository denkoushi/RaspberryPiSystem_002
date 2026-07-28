import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  KIOSK_SOP_CLOSE_MESSAGE,
  KIOSK_SOP_FOCUS_CLOSE_MESSAGE
} from './buildKioskSopSrcDoc';
import { KioskSopLauncher } from './KioskSopLauncher';

import type { KioskSopView } from './types';

const view: KioskSopView = {
  id: 'test-sop',
  title: '検査図面 既存編集',
  contextLabel: '1 / 2 · 一覧画面',
  sheetId: 'library',
  srcDoc: '<!doctype html><html><body>test</body></html>'
};

describe('KioskSopLauncher', () => {
  it('opens an isolated dialog, ignores unrelated messages, and returns focus on close', () => {
    render(<KioskSopLauncher view={view} />);

    const openButton = screen.getByRole('button', { name: 'この画面の操作手順を開く' });
    openButton.focus();
    fireEvent.click(openButton);

    const dialog = screen.getByRole('dialog', {
      name: '取説 — 検査図面 既存編集 — 1 / 2 · 一覧画面'
    });
    const closeButton = screen.getByRole('button', { name: '閉じる' });
    const frame = screen.getByTitle('検査図面 既存編集 — 1 / 2 · 一覧画面');

    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('srcdoc', view.srcDoc);
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
    render(<KioskSopLauncher view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'この画面の操作手順を開く' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
