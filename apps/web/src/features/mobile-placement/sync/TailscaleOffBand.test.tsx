import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mobileRequest, resetMobileConnectivityForTests } from '../connectivity';

import { TailscaleOffBand } from './TailscaleOffBand';

let connection: EventTarget & { type?: string };
beforeEach(() => {
  connection = new EventTarget();
  vi.stubGlobal('navigator', { onLine: true, connection });
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const failRequest = () => act(async () => { await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {}); });

describe('TailscaleOffBand', () => {
  it('is hidden by default', () => {
    connection.type = 'wifi';
    render(<TailscaleOffBand />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('shows on wifi after a non-HTTP failure and sets the top band variable', async () => {
    vi.useFakeTimers();
    connection.type = 'wifi';
    render(<TailscaleOffBand />);
    await failRequest();
    expect(screen.getByRole('status').textContent).toBe('Tailscale オフ');
    expect(document.documentElement.style.getPropertyValue('--mobile-top-band')).toBe('40px');
    vi.useRealTimers();
  });
  it('stays hidden on cellular', async () => {
    vi.useFakeTimers();
    connection.type = 'cellular';
    render(<TailscaleOffBand />);
    await failRequest();
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });
});
