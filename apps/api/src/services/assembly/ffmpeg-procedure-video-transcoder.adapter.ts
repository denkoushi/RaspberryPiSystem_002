import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
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
    const result = await this.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=width,height:stream_side_data=rotation', '-of', 'json', input], 30_000);
    const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ width: number; height: number; side_data_list?: Array<{ rotation?: number }> }> };
    const stream = data.streams?.[0];
    const durationSeconds = Number(data.format?.duration);
    if (!stream?.width || !stream.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new ProcedureVideoTranscodeError('INVALID_VIDEO', '動画の長さ・寸法を取得できません');
    }
    const rotated = stream.side_data_list?.some((item) => Math.abs(item.rotation ?? 0) % 180 === 90);
    return { durationSeconds, width: rotated ? stream.height : stream.width, height: rotated ? stream.width : stream.height };
  }

  async transcode(input: string, output: string, poster: string): Promise<void> {
    // ffmpeg's default autorotation applies before scale; do not use -noautorotate.
    await this.run('ffmpeg', ['-nostdin', '-y', '-i', input, '-an', '-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', SCALE, '-r', '30', output], 120_000);
    const probe = await this.probe(output);
    const createPoster = (seek: string) => this.run('ffmpeg', ['-nostdin', '-y', '-ss', seek, '-i', output, '-an', '-threads', '2', '-frames:v', '1', '-vf', SCALE, poster], 30_000);
    const hasPoster = async () => {
      try { return (await stat(poster)).size > 0; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    };
    await createPoster(probe.durationSeconds > 1 ? '1' : '0');
    if (!await hasPoster()) {
      await createPoster('0');
      if (!await hasPoster()) throw new ProcedureVideoTranscodeError('TRANSCODE_FAILED', '動画のポスターを生成できません');
    }
  }
}
