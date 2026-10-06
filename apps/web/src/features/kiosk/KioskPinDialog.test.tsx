import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskPinDialog } from './KioskPinDialog';

function enter(pin: string) { for (const digit of pin) fireEvent.click(screen.getByRole('button', { name: digit, exact: true })); }

describe('KioskPinDialog', () => {
  it('submits exactly once at four digits and disables input while pending', async () => {
    let finish!: (success: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<KioskPinDialog onSubmit={onSubmit} onBack={vi.fn()} validHours={8} />);
    enter('123'); expect(onSubmit).not.toHaveBeenCalled();
    enter('4'); expect(onSubmit).toHaveBeenCalledExactlyOnceWith('1234');
    expect(screen.getByRole('button', { name: '1', exact: true })).toBeDisabled();
    expect(screen.getByText('この端末で 8 時間有効')).toBeInTheDocument();
    finish(true);
    await waitFor(() => expect(screen.getByRole('button', { name: '戻る' })).toBeEnabled());
  });
  it.each([false, 'throw'])('keeps a failed PIN and allows explicit retry (%s)', async result => {
    const onSubmit = vi.fn(async () => { if (result === 'throw') throw new Error('offline'); return false; });
    render(<KioskPinDialog onSubmit={onSubmit} onBack={vi.fn()} />);
    enter('2520');
    expect(await screen.findByRole('alert')).toHaveTextContent(result === 'throw' ? '通信できません' : '違います');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '4桁入力済み');
    fireEvent.click(screen.getByRole('button', { name: 'OK' })); await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
  it('continues past automatic four-digit mismatch and submits six digits explicitly', async () => {
    const onSubmit = vi.fn(async (pin: string) => pin === '123456');
    render(<KioskPinDialog onSubmit={onSubmit} onBack={vi.fn()} />);
    enter('1234'); await screen.findByText('違います');
    enter('56'); expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '6桁入力済み');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith('123456'));
  });
  it('limits digits to maxLength, defaulting to eight', async () => {
    render(<KioskPinDialog onSubmit={vi.fn(async () => false)} onBack={vi.fn()} />);
    enter('1234'); await screen.findByText('違います'); enter('567890');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '8桁入力済み');
  });
  it.each([
    ['mismatch', '違います'], ['network', '通信できません'], ['rate-limited', '少し待ってください']
  ] as const)('shows the caller result %s', async (result, message) => {
    render(<KioskPinDialog onSubmit={vi.fn(async () => result)} onBack={vi.fn()} />);
    enter('1234'); expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
  it('distinguishes a thrown HTTP 429 from a communication failure', async () => {
    render(<KioskPinDialog onSubmit={vi.fn(async () => { throw { isAxiosError: true, response: { status: 429 } }; })} onBack={vi.fn()} />);
    enter('1234'); expect(await screen.findByRole('alert')).toHaveTextContent('少し待ってください');
  });
  it('supports backspace and the caller return action without a duration label', () => {
    const onBack = vi.fn();
    render(<KioskPinDialog onSubmit={vi.fn()} onBack={onBack} backLabel="見るへ戻る" />);
    enter('12'); fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '1桁入力済み');
    fireEvent.click(screen.getByRole('button', { name: '見るへ戻る' })); expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByText(/この端末/)).not.toBeInTheDocument();
  });
});
