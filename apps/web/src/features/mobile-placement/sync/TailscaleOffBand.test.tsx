import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../../api/http';
import { failMobileRequest, stubMobileConnection } from '../connectivityTestUtils';

import { TailscaleOffBand } from './TailscaleOffBand';

vi.mock('../../../api/http', () => ({ api: { get: vi.fn() } }));

const getConnection = stubMobileConnection();
const fail = () => act(failMobileRequest);

describe('TailscaleOffBand', () => {
  it('is hidden by default', () => {
    getConnection().type = 'wifi';
    render(<TailscaleOffBand />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('shows on wifi after a non-HTTP failure and sets the top band variable', async () => {
    vi.useFakeTimers();
    getConnection().type = 'wifi';
    render(<TailscaleOffBand />);
    await fail();
    expect(screen.getByRole('status').textContent).toBe('Tailscale オフ');
    expect(document.documentElement.style.getPropertyValue('--mobile-top-band')).toBe('40px');
    vi.useRealTimers();
  });
  it('stays hidden on cellular', async () => {
    vi.useFakeTimers();
    getConnection().type = 'cellular';
    render(<TailscaleOffBand />);
    await fail();
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });
  it('stays after Wi-Fi reconnects until the server answers', async () => {
    vi.useFakeTimers();
    getConnection().type = 'wifi';
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ status: 200 });
    render(<TailscaleOffBand />);
    await fail();
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });
});
