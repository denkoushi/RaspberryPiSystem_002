import { afterEach, describe, expect, it, vi } from 'vitest';

describe('haizenSounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('AudioContext が無くても例外を出さない', async () => {
    vi.resetModules();
    const { playHaizenSound, unlockHaizenSound } = await import('./haizenSounds');
    expect(() => { unlockHaizenSound(); playHaizenSound('ng'); }).not.toThrow();
  });

  it('ok は音を2つ鳴らす', async () => {
    vi.resetModules();
    const createOscillator = vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }));
    const createGain = vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }));
    class FakeContext { state = 'running'; currentTime = 0; destination = {}; createOscillator = createOscillator; createGain = createGain; resume = vi.fn(); }
    vi.stubGlobal('AudioContext', FakeContext);
    const { playHaizenSound } = await import('./haizenSounds');
    playHaizenSound('ok');
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });
});
