import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSignalingSender } from '../../webrtc/signalingBus';

import { MockPeerConnection, mockStream } from './peerTestHelpers';
import { formatDelay, ScreenWatchPeer } from './useScreenWatchPeer';

let release: () => void;
const send = vi.fn(() => true);
const events = () => ({ stream: vi.fn(), delay: vi.fn(), ended: vi.fn() });
const peers: ScreenWatchPeer[] = [];
const makePeer = (role: 'target' | 'viewer', handlers = events()) => {
  const peer = new ScreenWatchPeer('watch', role, handlers); peers.push(peer); return peer;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', MockPeerConnection);
  MockPeerConnection.instances = []; send.mockClear();
  release = registerSignalingSender(send);
});
afterEach(() => { peers.splice(0).forEach(peer => peer.close()); release(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('screen watch peer', () => {
  it('offers the video with fps, bitrate and resolution preference; forwards ICE', async () => {
    const peer = makePeer('target'); const pc = MockPeerConnection.instances[0];
    const { stream } = mockStream(); await peer.offer(stream);
    expect(pc.addTrack).toHaveBeenCalledWith(stream.getVideoTracks()[0], stream);
    expect(pc.sender.setParameters).toHaveBeenCalledWith(expect.objectContaining({
      encodings: [{ maxFramerate: 5, maxBitrate: 1_500_000 }], degradationPreference: 'maintain-resolution'
    }));
    expect(send).toHaveBeenCalledWith({ type: 'watch.signal', payload: { watchId: 'watch', description: { type: 'offer', sdp: 'screen-offer' } } });
    const candidate = { candidate: 'local-ice' };
    pc.onicecandidate?.({ candidate: { toJSON: () => candidate } });
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.signal', payload: { watchId: 'watch', candidate } });
  });
  it('retains bitrate/fps limits if degradationPreference is unsupported', async () => {
    const peer = makePeer('target'); const pc = MockPeerConnection.instances[0];
    pc.sender.setParameters.mockRejectedValueOnce(new DOMException('unsupported', 'NotSupportedError'));
    await peer.offer(mockStream().stream);
    expect(pc.sender.setParameters).toHaveBeenCalledTimes(2);
    expect(pc.sender.setParameters).toHaveBeenLastCalledWith(expect.objectContaining({ encodings: [{ maxFramerate: 5, maxBitrate: 1_500_000 }] }));
    expect(pc.parameters.degradationPreference).toBeUndefined();
    expect(pc.createOffer).toHaveBeenCalledOnce();
  });
  it('still offers when encodings are empty', async () => {
    const peer = makePeer('target'); const pc = MockPeerConnection.instances[0]; pc.parameters.encodings = [];
    await peer.offer(mockStream().stream);
    expect(pc.sender.setParameters).not.toHaveBeenCalled(); expect(pc.createOffer).toHaveBeenCalledOnce();
  });
  it.each(['viewer', 'target'] as const)('buffers ICE until remote description on %s', async role => {
    const peer = makePeer(role); const pc = MockPeerConnection.instances[0];
    const candidate = { candidate: 'remote-ice' };
    await peer.signal({ candidate }); expect(pc.addIceCandidate).not.toHaveBeenCalled();
    await peer.signal({ description: { type: role === 'viewer' ? 'offer' : 'answer', sdp: 'remote' } });
    expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate);
    expect(pc.setRemoteDescription.mock.invocationCallOrder[0]).toBeLessThan(pc.addIceCandidate.mock.invocationCallOrder[0]);
    if (role === 'viewer') expect(send).toHaveBeenCalledWith({ type: 'watch.signal', payload: { watchId: 'watch', description: { type: 'answer', sdp: 'screen-answer' } } });
    else expect(pc.createAnswer).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'target'] as const)('closes and stops %s tracks, once', async role => {
    const peer = makePeer(role); const pc = MockPeerConnection.instances[0]; const { track, stream } = mockStream();
    if (role === 'target') await peer.offer(stream);
    else pc.ontrack?.({ track: stream.getTracks()[0], streams: [stream] });
    peer.close(); peer.close();
    expect(pc.close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('capture ended sends stop and closes the peer', async () => {
    const handlers = events(); const peer = makePeer('target', handlers); const { stream } = mockStream();
    await peer.offer(stream); stream.getTracks()[0].onended?.(new Event('ended'));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch' } });
    expect(handlers.ended).toHaveBeenCalledWith(false); expect(MockPeerConnection.instances[0].close).toHaveBeenCalledOnce();
  });
  it('viewer failed state stops and reports failure', () => {
    const handlers = events(); makePeer('viewer', handlers); const pc = MockPeerConnection.instances[0];
    pc.connectionState = 'failed'; pc.onconnectionstatechange?.();
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch' } });
    expect(handlers.ended).toHaveBeenCalledWith(true); expect(pc.close).toHaveBeenCalledOnce();
  });
  it('does not send a late offer after close', async () => {
    const peer = makePeer('target'); const pc = MockPeerConnection.instances[0];
    let resolve!: (description: RTCSessionDescriptionInit) => void;
    pc.createOffer.mockReturnValue(new Promise(done => { resolve = done; }));
    const offer = peer.offer(mockStream().stream); await Promise.resolve(); peer.close();
    resolve({ type: 'offer', sdp: 'late' }); await offer;
    expect(send).not.toHaveBeenCalled(); expect(pc.setLocalDescription).not.toHaveBeenCalled();
  });
  it('reads RTT from the selected pair every two seconds', async () => {
    const handlers = events(); makePeer('viewer', handlers); const pc = MockPeerConnection.instances[0];
    pc.getStats.mockResolvedValue(new Map([
      ['transport', { type: 'transport', selectedCandidatePairId: 'selected' }],
      ['other', { type: 'candidate-pair', id: 'other', currentRoundTripTime: 9 }],
      ['selected', { type: 'candidate-pair', id: 'selected', currentRoundTripTime: .12 }]
    ]));
    await vi.advanceTimersByTimeAsync(1999); expect(handlers.delay).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(handlers.delay).toHaveBeenCalledWith(.12);
  });
  it.each([[undefined, '—'], [NaN, '—'], [-1, '—'], [.12, '0.1秒'], [0, '0.0秒']])('formats delay %s', (seconds, text) => {
    expect(formatDelay(seconds as number | undefined)).toBe(text);
  });
});
