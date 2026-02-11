import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useWebRTC } from '../hooks/useWebRTC';

import type { CallState } from '../hooks/useWebRTC';
import type { PropsWithChildren } from 'react';

type WebRTCCallContextValue = ReturnType<typeof useWebRTC> & {
  lastError: Error | null;
  clearLastError: () => void;
};

const WebRTCCallContext = createContext<WebRTCCallContextValue | null>(null);

const RETURN_PATH_KEY = 'webrtc-call-return-path';

const shouldReturnOnCallState = (callState: CallState) => callState === 'idle' || callState === 'ended';

export function WebRTCCallProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const autoSwitchRef = useRef(false);
  const previousPathRef = useRef<string | null>(null);

  const [lastError, setLastError] = useState<Error | null>(null);
  const clearLastError = useCallback(() => {
    setLastError(null);
  }, []);

  const webrtc = useWebRTC({
    enabled: true,
    onError: (error) => {
      setLastError(error);
    }
  });

  useEffect(() => {
    if (webrtc.callState !== 'incoming') {
      return;
    }
    if (location.pathname === '/kiosk/call') {
      return;
    }

    const returnPath = `${location.pathname}${location.search}`;
    previousPathRef.current = returnPath;
    autoSwitchRef.current = true;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
    }
    navigate('/kiosk/call');
  }, [webrtc.callState, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!shouldReturnOnCallState(webrtc.callState)) {
      return;
    }
    if (!autoSwitchRef.current) {
      return;
    }

    let returnPath = previousPathRef.current;
    if (!returnPath && typeof window !== 'undefined') {
      returnPath = window.sessionStorage.getItem(RETURN_PATH_KEY);
    }

    if (returnPath && returnPath !== location.pathname) {
      navigate(returnPath, { replace: true });
    }

    autoSwitchRef.current = false;
    previousPathRef.current = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(RETURN_PATH_KEY);
    }
  }, [webrtc.callState, location.pathname, navigate]);

  const value = useMemo(
    () => ({
      ...webrtc,
      lastError,
      clearLastError,
    }),
    [webrtc, lastError, clearLastError]
  );

  return (
    <WebRTCCallContext.Provider value={value}>
      {children}
    </WebRTCCallContext.Provider>
  );
}

export function useWebRTCCall() {
  const context = useContext(WebRTCCallContext);
  if (!context) {
    throw new Error('useWebRTCCall must be used within WebRTCCallProvider');
  }
  return context;
}
