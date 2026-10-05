import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FfmpegProcedureVideoTranscoderAdapter } from '../ffmpeg-procedure-video-transcoder.adapter.js';

const { execute, stat, childKill, mkdtemp, rm, writeFile } = vi.hoisted(() => ({ execute: vi.fn(), stat: vi.fn(), childKill: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat, mkdtemp, rm, writeFile }));
vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), { value: async (...args: unknown[]) => {
    const result = await execute(...args);
    if (result instanceof Error) throw result;
    return { stdout: result ?? '', stderr: '' };
  } });
  return { execFile };
});
function conversion(duration: string) {
  execute.mockReturnValueOnce('').mockReturnValueOnce(JSON.stringify({ format: { duration }, streams: [{ width: 640, height: 360 }] }));
}
beforeEach(() => { execute.mockReset(); stat.mockReset().mockResolvedValue({ size: 64 }); childKill.mockReset(); mkdtemp.mockReset().mockResolvedValue('/tmp/concat'); rm.mockReset(); writeFile.mockReset(); });
afterEach(() => vi.useRealTimers());
describe('ffmpeg procedure-video transcoder', () => {
  it.each([[640, 360, '640:360'], [360, 640, '360:640']])('normalizes mixed inputs to first orientation %sx%s, re-encodes with the concat demuxer and creates a first-frame poster', async (width, height, dimensions) => {
    execute.mockImplementation((binary) => binary === 'ffprobe' ? JSON.stringify({ format: { duration: '80' }, streams: [{ width, height }] }) : '');
    await new FfmpegProcedureVideoTranscoderAdapter().concat(['first.mp4', 'second.mp4', 'first.mp4'], 'out.mp4', 'poster.jpg');
    const conversions = execute.mock.calls.filter((call) => call[0] === 'ffmpeg');
    expect(conversions.slice(0, 3).map((call) => call[1][3])).toEqual(['first.mp4', 'second.mp4', 'first.mp4']);
    for (const call of conversions.slice(0, 4)) {
      expect(call[1]).toEqual(expect.arrayContaining(['-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30']));
      expect(call[1][call[1].indexOf('-vf') + 1]).toBe(`scale='max(2,round(iw*sar/2)*2)':ih,setsar=1,scale=${dimensions}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${dimensions}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`);
    }
    expect(writeFile).toHaveBeenCalledWith('/tmp/concat/list.txt', "file '0.mp4'\nfile '1.mp4'\nfile '2.mp4'\n");
    expect(conversions[3][1]).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '-i', '/tmp/concat/list.txt', 'out.mp4']));
    expect(conversions[4][1]).toEqual(expect.arrayContaining(['-ss', '0', '-i', 'out.mp4', 'poster.jpg']));
    expect(rm).toHaveBeenCalledWith('/tmp/concat', { recursive: true, force: true });
  });
  it.each([[640, 360, undefined, '640:180'], [360, 640, undefined, '640:568'], [640, 360, -90, '180:640']])('uses SAR=2 display dimensions for %sx%s rotation %s', async (width, height, rotation, dimensions) => {
    execute.mockImplementation((binary) => binary === 'ffprobe' ? JSON.stringify({ format: { duration: '10' }, streams: [{ width, height, sample_aspect_ratio: '2:1', side_data_list: [{ rotation }] }] }) : '');
    const heartbeat = vi.fn();
    await new FfmpegProcedureVideoTranscoderAdapter().concat(['first.mp4', 'second.mp4'], 'out.mp4', 'poster.jpg', heartbeat);
    const filter = execute.mock.calls.find((call) => call[0] === 'ffmpeg')![1];
    expect(filter[filter.indexOf('-vf') + 1]).toBe(`scale='max(2,round(iw*sar/2)*2)':ih,setsar=1,scale=${dimensions}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${dimensions}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`);
    expect(execute.mock.calls[0][1]).toContain('format=duration:stream=width,height,sample_aspect_ratio:stream_side_data=rotation');
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });
  it('stops concat immediately when a normalization heartbeat loses ownership and cleans temporary files', async () => {
    execute.mockImplementation((binary) => binary === 'ffprobe' ? JSON.stringify({ format: { duration: '10' }, streams: [{ width: 640, height: 360 }] }) : '');
    const lost = new Error('recovered');
    await expect(new FfmpegProcedureVideoTranscoderAdapter().concat(['first.mp4', 'second.mp4'], 'out.mp4', 'poster.jpg', vi.fn().mockRejectedValue(lost))).rejects.toBe(lost);
    expect(execute.mock.calls.filter((call) => call[0] === 'ffmpeg')).toHaveLength(1);
    expect(rm).toHaveBeenCalledWith('/tmp/concat', { recursive: true, force: true });
  });
  it.each(['transcode', 'trim'] as const)('heartbeats after %s encoding and poster creation', async (mode) => {
    conversion('8');
    const heartbeat = vi.fn();
    const adapter = new FfmpegProcedureVideoTranscoderAdapter();
    if (mode === 'trim') await adapter.trim('in', 'out.mp4', 'poster.jpg', 2, 10, heartbeat);
    else await adapter.transcode('in', 'out.mp4', 'poster.jpg', heartbeat);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });
  it('cleans normalized concat files after an encoder failure', async () => {
    execute.mockReturnValueOnce(JSON.stringify({ format: { duration: '10' }, streams: [{ width: 640, height: 360 }] })).mockReturnValueOnce(new Error('encoder failure'));
    await expect(new FfmpegProcedureVideoTranscoderAdapter().concat(['first.mp4', 'second.mp4'], 'out.mp4', 'poster.jpg')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' });
    expect(rm).toHaveBeenCalledWith('/tmp/concat', { recursive: true, force: true });
  });
  it('reads duration and rotated display dimensions', async () => {
    execute.mockReturnValue(JSON.stringify({ format: { duration: '12.3' }, streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }));
    expect(await new FfmpegProcedureVideoTranscoderAdapter().probe('/tmp/in')).toEqual({ durationSeconds: 12.3, sampleAspectRatio: 1, width: 1080, height: 1920 });
  });
  it('uses bounded execFile with H264 MP4, two threads, no audio, scaling, default autorotation and a poster', async () => {
    conversion('1.5');
    await new FfmpegProcedureVideoTranscoderAdapter().transcode('/tmp/in', '/tmp/out.mp4', '/tmp/poster.jpg');
    expect(execute.mock.calls[0][0]).toBe('ffmpeg');
    const args = execute.mock.calls[0][1];
    expect(args).toEqual(['-nostdin', '-y', '-i', '/tmp/in', '-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", '-r', '30', '/tmp/out.mp4']);
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining(['-ss', '1', '-threads', '2', '-frames:v', '1', '/tmp/poster.jpg']));
    expect(execute.mock.calls.map((call) => call[2])).toEqual([
      { timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
    ]);
  });
  it.each(['0.033333', '0.5', '1'])('uses the first frame for one-frame and <=1-second clips (%s seconds)', async (duration) => {
    conversion(duration);
    await new FfmpegProcedureVideoTranscoderAdapter().transcode('in', 'out.mp4', 'poster.jpg');
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining(['-ss', '0']));
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it.each(['missing', 'empty'])('retries a %s poster once from the first frame', async (failure) => {
    conversion('12');
    if (failure === 'missing') stat.mockRejectedValueOnce(Object.assign(new Error('missing poster'), { code: 'ENOENT' }));
    else stat.mockResolvedValueOnce({ size: 0 });
    await new FfmpegProcedureVideoTranscoderAdapter().transcode('in', 'out.mp4', 'poster.jpg');
    expect(execute.mock.calls.slice(2).map((call) => call[1][3])).toEqual(['1', '0']);
    expect(stat).toHaveBeenCalledTimes(2);
  });
  it('fails after one retry if the poster is still empty', async () => {
    conversion('0.033333'); stat.mockResolvedValue({ size: 0 });
    await expect(new FfmpegProcedureVideoTranscoderAdapter().transcode('in', 'out.mp4', 'poster.jpg')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' });
    expect(execute.mock.calls.slice(2).map((call) => call[1][3])).toEqual(['0', '0']);
    expect(execute).toHaveBeenCalledTimes(4);
  });
  it.each(['ffprobe', 'ffmpeg'])('forcibly kills an unresponsive %s child at timeout and reports TRANSCODE_TIMEOUT', async (binary) => {
    vi.useFakeTimers();
    execute.mockImplementation((_binary, _args, options) => new Promise((_resolve, reject) => {
      // This child ignores SIGTERM and never exits by itself.
      childKill.mockImplementation((signal) => {
        if (signal === 'SIGKILL') reject(Object.assign(new Error('killed'), { killed: true, signal, code: null }));
        return true;
      });
      setTimeout(() => childKill(options.killSignal ?? 'SIGTERM'), options.timeout);
    }));
    const adapter = new FfmpegProcedureVideoTranscoderAdapter();
    const operation = binary === 'ffprobe' ? adapter.probe('in') : adapter.transcode('in', 'out.mp4', 'poster.jpg');
    const assertion = expect(operation).rejects.toMatchObject({ code: 'TRANSCODE_TIMEOUT' });
    const timeout = binary === 'ffprobe' ? 30_000 : 120_000;
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(childKill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(childKill).toHaveBeenCalledWith('SIGKILL');
    await assertion;
  });
  it('keeps an output-buffer limit failure distinct from a timeout', async () => {
    execute.mockReturnValue(Object.assign(new Error('buffer exceeded'), { killed: true, signal: 'SIGKILL', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
    await expect(new FfmpegProcedureVideoTranscoderAdapter().probe('in')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' });
  });
  it('reports missing binary as FFMPEG_UNAVAILABLE', async () => {
    execute.mockReturnValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(new FfmpegProcedureVideoTranscoderAdapter().probe('in')).rejects.toMatchObject({ code: 'FFMPEG_UNAVAILABLE' });
  });
  it('accurately re-encodes the requested range with two threads and creates a poster', async () => {
    conversion('8');
    await new FfmpegProcedureVideoTranscoderAdapter().trim('sd.mp4', 'new.mp4', 'new.jpg', 2, 10);
    expect(execute.mock.calls[0][1]).toEqual(['-nostdin', '-y', '-i', 'sd.mp4', '-ss', '2', '-to', '10', '-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', 'new.mp4']);
    expect(execute.mock.calls[0][2]).toMatchObject({ timeout: 120_000, killSignal: 'SIGKILL' });
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining(['-ss', '1', 'new.mp4', 'new.jpg']));
  });

});
