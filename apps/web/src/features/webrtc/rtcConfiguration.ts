/** Shared LAN/Pi4 settings for calls and screen watching. */
export function getRTCConfiguration(): RTCConfiguration {
  return {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    iceCandidatePoolSize: 0
  };
}
