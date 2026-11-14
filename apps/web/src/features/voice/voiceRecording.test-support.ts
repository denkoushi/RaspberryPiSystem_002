import { vi } from 'vitest';

export function mockVoiceRecording() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ label: 'USB microphone' }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  const recorders: MockRecorder[] = [];
  class MockRecorder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    mimeType = 'audio/webm';
    onstop?: () => void;
    onerror?: () => void;
    ondataavailable?: (event: { data: Blob }) => void;
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['audio']) });
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', MockRecorder);
  let amplitude = 0;
  const closeContext = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn();
  vi.stubGlobal('AudioContext', class {
    close = closeContext;
    createMediaStreamSource() { return { connect: vi.fn(), disconnect }; }
    createAnalyser() { return { fftSize: 256, disconnect, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude) }; }
  });
  return { getUserMedia, stopTrack, closeContext, get recorder() { return recorders[recorders.length - 1]!; }, setAmplitude: (value: number) => { amplitude = value; } };
}
