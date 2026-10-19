import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportKioskException } from '../features/kiosk/errorTelemetry';

import { AppErrorBoundary } from './AppErrorBoundary';
import { RouteLoadingScreen } from './RouteLoadingScreen';

import type { BrowserRuntimeRecoveryController } from '../features/kiosk/browserKioskRuntimeRecovery';

vi.mock('../features/kiosk/errorTelemetry', () => ({ reportKioskException: vi.fn().mockReturnValue({ incidentCode: 'A7K2Q9', occurredAt: '2026-10-08T05:32:00Z' }) }));

function ThrowError({ error }: { error: Error }) {
  throw error;
}

function runtimeController(
  decision: ReturnType<BrowserRuntimeRecoveryController['decide']>
): BrowserRuntimeRecoveryController {
  return {
    decide: vi.fn(() => decision),
    replace: vi.fn(),
    reload: vi.fn()
  };
}

describe('AppErrorBoundary', () => {
  const preventExpectedRenderError = (event: ErrorEvent) => event.preventDefault();

  beforeEach(() => {
    window.addEventListener('error', preventExpectedRenderError);
  });

  afterEach(() => {
    window.removeEventListener('error', preventExpectedRenderError);
    vi.restoreAllMocks();
  });

  it('performs an injected automatic replacement for one eligible failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = runtimeController({
      kind: 'reload',
      href: 'https://kiosk.example/kiosk?__raspi_web_runtime_recovery=token'
    });

    render(
      <AppErrorBoundary runtimeRecovery={runtime}>
        <ThrowError error={new Error('Failed to fetch dynamically imported module')} />
      </AppErrorBoundary>
    );

    await waitFor(() => expect(runtime.replace).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('画面を復旧しています');
    expect(reportKioskException).toHaveBeenCalledWith('render_crash', expect.any(Error), 'reload');
  });

  it('shows independent recovery controls without exposing the caught error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = runtimeController({ kind: 'stop' });

    render(
      <AppErrorBoundary runtimeRecovery={runtime}>
        <ThrowError error={new Error('secret-internal-stack-message')} />
      </AppErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: '画面を表示できませんでした' })).toBeInTheDocument();
    expect(screen.getByText(/記録番号 A7K2Q9/)).toBeInTheDocument();
    expect(screen.queryByText(/secret-internal-stack-message/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '画面を再読み込み' }));
    expect(runtime.reload).toHaveBeenCalledOnce();
    expect(runtime.replace).not.toHaveBeenCalled();
  });

  it('keeps the recovery screen usable if automatic navigation throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = runtimeController({ kind: 'reload', href: 'https://kiosk.example/kiosk' });
    vi.mocked(runtime.replace).mockImplementation(() => {
      throw new Error('navigation blocked');
    });

    render(
      <AppErrorBoundary runtimeRecovery={runtime}>
        <ThrowError error={new Error('Failed to fetch dynamically imported module')} />
      </AppErrorBoundary>
    );

    await waitFor(() => expect(
      screen.getByRole('button', { name: '画面を再読み込み' })
    ).toBeInTheDocument());
  });
});

describe('RouteLoadingScreen', () => {
  it('announces that a lazy route is loading', () => {
    render(<RouteLoadingScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('画面を準備しています');
  });
});
