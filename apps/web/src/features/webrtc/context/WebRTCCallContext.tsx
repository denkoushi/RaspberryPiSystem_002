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

  const handleWebRTCError = useCallback((error: Error) => {
    setLastError(error);
  }, []);

  const webrtc = useWebRTC({
    enabled: true,
    onError: handleWebRTCError
  });

  useEffect(() => {
    if (webrtc.callState !== 'incoming') {
      return;
    }
    if (location.pathname === '/kiosk/call') {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'webrtc-pre',hypothesisId:'H4',location:'WebRTCCallContext.tsx:autoswitch:skip',message:'webrtc_autoswitch_skipped_already_on_call_page',data:{pathname:location.pathname,search:location.search},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return;
    }

    const returnPath = `${location.pathname}${location.search}`;
    previousPathRef.current = returnPath;
    autoSwitchRef.current = true;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'webrtc-pre',hypothesisId:'H4',location:'WebRTCCallContext.tsx:autoswitch:navigate',message:'webrtc_autoswitch_navigate_to_call_page',data:{fromPath:returnPath,toPath:'/kiosk/call'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
