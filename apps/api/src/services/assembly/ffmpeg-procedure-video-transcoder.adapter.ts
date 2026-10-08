import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ProcedureVideoTranscodeError, type ProcedureVideoTranscoderPort, type ProcedureVideoProbe } from './procedure-video-transcoder.port.js';

const execute = promisify(execFile);
const SCALE = "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'";

export class FfmpegProcedureVideoTranscoderAdapter implements ProcedureVideoTranscoderPort {
  private async run(binary: string, args: string[], timeout: number) {
    try { return await execute(binary, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProcedureVideoTranscodeError('FFMPEG_UNAVAILABLE', 'ffmpeg/ffprobe がありません');
      }
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
      if (failure.code === 'ETIMEDOUT' || (failure.killed && failure.signal === 'SIGKILL' && failure.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) {
        throw new ProcedureVideoTranscodeError('TRANSCODE_TIMEOUT', `${binary} による動画処理がタイムアウトしました`);
      }
      throw new ProcedureVideoTranscodeError('TRANSCODE_FAILED', `${binary} による動画処理に失敗しました`);
    }
  }

  async probe(input: string): Promise<ProcedureVideoProbe> {
    const result = await this.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=width,height,sample_aspect_ratio:stream_side_data=rotation', '-of', 'json', input], 30_000);
    const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ width: number; height: number; sample_aspect_ratio?: string; side_data_list?: Array<{ rotation?: number }> }> };
    const stream = data.streams?.[0];
    const durationSeconds = Number(data.format?.duration);
    if (!stream?.width || !stream.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new ProcedureVideoTranscodeError('INVALID_VIDEO', '動画の長さ・寸法を取得できません');
    }
    const rotated = stream.side_data_list?.some((item) => Math.abs(item.rotation ?? 0) % 180 === 90);
    const [numerator, denominator] = (stream.sample_aspect_ratio ?? '1:1').split(':').map(Number);
    const ratio = numerator / denominator;
    const sar = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return { durationSeconds, sampleAspectRatio: rotated ? 1 / sar : sar, width: rotated ? stream.height : stream.width, height: rotated ? stream.width : stream.height };
  }

  async transcode(input: string, output: string, poster: string, onStepComplete?: () => Promise<void>): Promise<void> {
    // ffmpeg's default autorotation applies before scale; do not use -noautorotate.
    await this.run('ffmpeg', ['-nostdin', '-y', '-i', input, '-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', SCALE, '-r', '30', output], 120_000);
    await onStepComplete?.();
    await this.createPoster(output, poster, false, onStepComplete);
  }

  async trim(input: string, output: string, poster: string, startSeconds: number, endSeconds: number, onStepComplete?: () => Promise<void>): Promise<void> {
    await this.run('ffmpeg', ['-nostdin', '-y', '-i', input, '-ss', String(startSeconds), '-to', String(endSeconds), '-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', output], 120_000);
    await onStepComplete?.();
    await this.createPoster(output, poster, false, onStepComplete);
  }

  async concat(inputs: string[], output: string, poster: string, onStepComplete?: () => Promise<void>): Promise<void> {
    const first = await this.probe(inputs[0]);
    const displayWidth = first.width * (first.sampleAspectRatio ?? 1);
    const landscape = displayWidth >= first.height;
    const width = landscape ? 640 : Math.max(2, Math.round(displayWidth / first.height * 320) * 2);
    const height = landscape ? Math.max(2, Math.round(first.height / displayWidth * 320) * 2) : 640;
    const filter = `scale='max(2,round(iw*sar/2)*2)':ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
    const encoding = ['-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', filter, '-r', '30'];
    const directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-concat-'));
    try {
      // The concat demuxer requires matching streams, including dimensions and time base.
      for (const [index, input] of inputs.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await this.run('ffmpeg', ['-nostdin', '-y', '-i', input, ...encoding, '-video_track_timescale', '15360', path.join(directory, `${index}.mp4`)], 120_000);
        // eslint-disable-next-line no-await-in-loop
        await onStepComplete?.();
      }
      const list = path.join(directory, 'list.txt');
      await writeFile(list, inputs.map((_, index) => `file '${index}.mp4'`).join('\n') + '\n');
      await this.run('ffmpeg', ['-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...encoding, output], 120_000);
      await onStepComplete?.();
      await this.createPoster(output, poster, true, onStepComplete);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async posterAt(input: string, poster: string, startSeconds: number): Promise<void> {
    if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new ProcedureVideoTranscodeError('INVALID_VIDEO', '開始位置が不正です');
    try {
      await this.posterFrame(input, poster, String(startSeconds));
      if ((await stat(poster)).size <= 0) throw new ProcedureVideoTranscodeError('TRANSCODE_FAILED', '動画のポスターを生成できません');
    } catch (error) {
      await rm(poster, { force: true });
      throw error;
    }
  }

  private posterFrame(input: string, poster: string, seek: string) {
    return this.run('ffmpeg', ['-nostdin', '-y', '-ss', seek, '-i', input, '-an', '-threads', '2', '-frames:v', '1', '-vf', SCALE, poster], 30_000);
  }

  private async createPoster(output: string, poster: string, firstFrame = false, onStepComplete?: () => Promise<void>): Promise<void> {
    const probe = await this.probe(output);
    const createPoster = (seek: string) => this.posterFrame(output, poster, seek);
    const hasPoster = async () => {
      try { return (await stat(poster)).size > 0; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    };
    await createPoster(!firstFrame && probe.durationSeconds > 1 ? '1' : '0');
    await onStepComplete?.();
    if (!await hasPoster()) {
      await createPoster('0');
      await onStepComplete?.();
      if (!await hasPoster()) throw new ProcedureVideoTranscodeError('TRANSCODE_FAILED', '動画のポスターを生成できません');
    }
  }
}
