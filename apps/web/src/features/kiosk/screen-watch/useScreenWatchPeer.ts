import { useEffect, useMemo, useRef, useState } from 'react';

import { getRTCConfiguration } from '../../webrtc/rtcConfiguration';
import { sendSignalingMessage } from '../../webrtc/signalingBus';

export async function startCapture(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 5, max: 5 }, displaySurface: 'browser' },
    selfBrowserSurface: 'include', audio: false, preferCurrentTab: true
  } as DisplayMediaStreamOptions);
  for (const track of stream.getVideoTracks()) track.contentHint = 'detail';
  return stream;
}

export const stopStream = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());
export const formatDelay = (seconds: number | undefined) =>
  seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? `${seconds.toFixed(1)}秒` : '—';

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type PeerEvents = {
  stream: (stream: MediaStream) => void;
  delay: (seconds: number | undefined) => void;
  ended: (failed: boolean) => void;
};

/** One watch, independent from call negotiation. All async completions check disposal. */
export class ScreenWatchPeer {
  readonly pc = new RTCPeerConnection(getRTCConfiguration());
  private closed = false;
  private tracks = new Set<MediaStreamTrack>();
  private candidates: RTCIceCandidateInit[] = [];
  private pending = Promise.resolve();
  private statsTimer?: ReturnType<typeof setInterval>;
  private readingStats = false;

  constructor(private watchId: string, private role: 'viewer' | 'target', private events: PeerEvents) {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.closed) {
        try { this.send({ candidate: candidate.toJSON() }); } catch { this.end(true); }
      }
    };
    this.pc.ontrack = ({ track, streams }) => {
      if (this.closed) { track.stop(); return; }
      const stream = streams[0] ?? new MediaStream([track]);
      this.tracks.add(track);
      stream.getTracks().forEach(item => this.tracks.add(item));
      this.events.stream(stream);
    };
    this.pc.onconnectionstatechange = () => {
      if (!this.closed && this.pc.connectionState === 'failed') this.end(true);
    };
    if (role === 'viewer') this.statsTimer = setInterval(() => { void this.readStats(); }, 2000);
  }

  private send(signal: Signal) {
    if (!sendSignalingMessage({ type: 'watch.signal', payload: { watchId: this.watchId, ...signal } })) {
      throw new Error('Signaling disconnected');
    }
  }

  async offer(stream: MediaStream): Promise<void> {
    stream.getTracks().forEach(track => this.tracks.add(track));
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new Error('Capture ended');
    track.onended = () => this.end(false);
    const sender = this.pc.addTrack(track, stream);
    const parameters = sender.getParameters();
    if (parameters.encodings?.length) {
      for (const encoding of parameters.encodings) {
        encoding.maxFramerate = 5;
        encoding.maxBitrate = 1_500_000;
      }
      parameters.degradationPreference = 'maintain-resolution';
      try {
        await sender.setParameters(parameters);
      } catch (error) {
        if (this.closed) return;
        if (!(error instanceof Error || error instanceof DOMException) || !['NotSupportedError', 'TypeError'].includes(error.name)) throw error;
        // Retry without the optional preference on Chromium versions that reject it.
        delete parameters.degradationPreference;
        await sender.setParameters(parameters);
      }
    }
    if (this.closed) return;
    const offer = await this.pc.createOffer();
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    if (!this.closed) this.send({ description: this.pc.localDescription ?? offer });
  }

  signal(payload: Signal): Promise<void> {
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      if (payload.description) {
        const expected = this.role === 'viewer' ? 'offer' : 'answer';
        if (payload.description.type !== expected) throw new Error('Unexpected watch description');
        await this.pc.setRemoteDescription(payload.description);
        if (this.closed) return;
        for (const candidate of this.candidates.splice(0)) {
          await this.pc.addIceCandidate(candidate);
          if (this.closed) return;
        }
        if (this.role === 'viewer') {
          const answer = await this.pc.createAnswer();
          if (this.closed) return;
          await this.pc.setLocalDescription(answer);
          if (!this.closed) this.send({ description: this.pc.localDescription ?? answer });
        }
      }
      if (payload.candidate && !this.closed) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload.candidate);
        else this.candidates.push(payload.candidate);
      }
    }).catch(() => { if (!this.closed) this.end(true); });
    return this.pending;
  }

  private async readStats() {
    if (this.closed || this.readingStats) return;
    this.readingStats = true;
    try {
      const stats = await this.pc.getStats();
      if (this.closed) return;
      let selected: string | undefined;
      stats.forEach(stat => { if (stat.type === 'transport') selected = stat.selectedCandidatePairId; });
      let rtt: number | undefined;
      stats.forEach(stat => {
        if (stat.type === 'candidate-pair' && (selected ? stat.id === selected : stat.selected || (stat.nominated && stat.state === 'succeeded'))) {
          rtt = stat.currentRoundTripTime;
        }
      });
      this.events.delay(rtt);
    } catch { /* Stats can be unavailable while negotiation is in progress. */ }
    finally { this.readingStats = false; }
  }

  private end(failed: boolean) {
    if (this.closed) return;
    sendSignalingMessage({ type: 'watch.stop', payload: { watchId: this.watchId } });
    this.close();
    this.events.ended(failed);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer);
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.close();
    for (const track of this.tracks) { track.onended = null; track.stop(); }
    this.tracks.clear();
    this.candidates = [];
  }
}

export function useScreenWatchPeer(onEnded: (failed: boolean) => void) {
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const peer = useRef<ScreenWatchPeer | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [delay, setDelay] = useState<number>();
  const controls = useMemo(() => ({
    start(watchId: string, role: 'viewer' | 'target') {
      peer.current?.close();
      setStream(null); setDelay(undefined);
      const next = new ScreenWatchPeer(watchId, role, {
        stream: setStream, delay: setDelay, ended: failed => endedRef.current(failed)
      });
      peer.current = next;
      return next;
    },
    signal(payload: { [key: string]: unknown }) { void peer.current?.signal(payload as Signal); },
    close() {
      peer.current?.close(); peer.current = null;
      setStream(null); setDelay(undefined);
    }
  }), []);
  useEffect(() => () => { peer.current?.close(); peer.current = null; }, []);
  return { controls, stream, delay: formatDelay(delay) };
}
