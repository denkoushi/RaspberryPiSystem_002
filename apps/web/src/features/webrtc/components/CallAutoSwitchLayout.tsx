import { Outlet } from 'react-router-dom';

import { WebRTCCallProvider } from '../context/WebRTCCallContext';

export function CallAutoSwitchLayout() {
  return (
    <WebRTCCallProvider>
      <Outlet />
    </WebRTCCallProvider>
  );
}
