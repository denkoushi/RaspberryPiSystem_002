import { render, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WebRTCCallProvider } from './WebRTCCallContext';

type MockWebRTCState = ReturnType<typeof import('../hooks/useWebRTC').useWebRTC>;

const listeners = new Set<() => void>();
let mockState: MockWebRTCState = {
  callState: 'idle',
  currentCallId: null,
  isVideoEnabled: false,
  incomingCallInfo: null,
  localStream: null,
  remoteStream: null,
  call: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  hangup: vi.fn(),
  enableVideo: vi.fn(),
  disableVideo: vi.fn(),
  isConnected: true,
};

const setMockState = (partial: Partial<MockWebRTCState>) => {
  mockState = { ...mockState, ...partial };
  listeners.forEach((listener) => listener());
};

vi.mock('../hooks/useWebRTC', () => ({
  useWebRTC: () => {
    const state = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => mockState,
    );
    return state;
  },
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('WebRTCCallProvider', () => {
  it('switches to /kiosk/call on incoming and returns to previous path on idle', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/signage']}>
        <WebRTCCallProvider>
          <LocationDisplay />
        </WebRTCCallProvider>
      </MemoryRouter>
    );

    expect(getByTestId('location').textContent).toBe('/signage');

    setMockState({ callState: 'incoming' });
    await waitFor(() => {
      expect(getByTestId('location').textContent).toBe('/kiosk/call');
    });

    setMockState({ callState: 'idle' });
    await waitFor(() => {
      expect(getByTestId('location').textContent).toBe('/signage');
    });
  });
});
