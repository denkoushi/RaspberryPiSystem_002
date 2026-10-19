import { vi } from 'vitest';

export function mockStream() {
  const track = { stop: vi.fn(), onended: null, contentHint: '', readyState: 'live' };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}

export class MockPeerConnection {
  static instances: MockPeerConnection[] = [];
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  parameters: RTCRtpSendParameters = { encodings: [{}], degradationPreference: 'balanced', transactionId: 't', codecs: [], headerExtensions: [], rtcp: {} };
  sender = { getParameters: vi.fn(() => this.parameters), setParameters: vi.fn(async (_parameters: RTCRtpSendParameters) => {}) };
  addTrack = vi.fn(() => this.sender);
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'screen-offer' }));
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'screen-answer' }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description; });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.remoteDescription = description; });
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => {});
  getStats = vi.fn(async () => new Map<string, Record<string, unknown>>());
  close = vi.fn();
  constructor(public configuration: RTCConfiguration) { MockPeerConnection.instances.push(this); }
}
