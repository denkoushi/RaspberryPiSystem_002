import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'drawingLocalRapidOcrWorker' });

export type RapidOcrWorkerWord = {
  text: string;
  confidence: number | null;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type RapidOcrWorkerRequest = {
  id: string;
  imageBase64: string;
};

export type RapidOcrWorkerResponse =
  | { id: string; ok: true; words: RapidOcrWorkerWord[] }
  | { id: string; ok: false; error: string };

export interface DrawingLocalRapidOcrWorkerClient {
  recognize(imageJpeg: Buffer, timeoutMs: number): Promise<RapidOcrWorkerWord[]>;
  dispose(): Promise<void>;
}

type Pending = {
  resolve: (words: RapidOcrWorkerWord[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function defaultWorkerScriptPath(): string {
  const override = process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WORKER?.trim();
  if (override) return override;
  // src:  apps/api/src/services/part-measurement -> repo root (5x ..)
  // dist: apps/api/dist/services/part-measurement -> repo root (5x ..)
  // docker: /app/apps/api/dist/... -> /app (4x ..) then scripts at /app/scripts
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../../../scripts/part-measurement/drawing-local-rapidocr-worker.py'),
    path.resolve(here, '../../../../scripts/part-measurement/drawing-local-rapidocr-worker.py'),
    path.resolve(process.cwd(), '../../scripts/part-measurement/drawing-local-rapidocr-worker.py'),
    path.resolve(process.cwd(), 'scripts/part-measurement/drawing-local-rapidocr-worker.py'),
    '/app/scripts/part-measurement/drawing-local-rapidocr-worker.py'
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function readPythonBin(): string {
  return process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_PYTHON?.trim() || 'python3';
}

export function readRapidOcrTimeoutMs(): number {
  return Math.max(
    1000,
    Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_TIMEOUT_MS || '5000', 10) || 5000
  );
}

export class PersistentDrawingLocalRapidOcrWorkerClient implements DrawingLocalRapidOcrWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readline: Interface | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private starting = false;

  constructor(
    private readonly pythonBin = readPythonBin(),
    private readonly workerScript = defaultWorkerScriptPath()
  ) {}

  async recognize(imageJpeg: Buffer, timeoutMs: number): Promise<RapidOcrWorkerWord[]> {
    await this.ensureReady();
    const id = `r${Date.now()}-${++this.seq}`;
    const payload: RapidOcrWorkerRequest = {
      id,
      imageBase64: imageJpeg.toString('base64')
    };
    return new Promise<RapidOcrWorkerWord[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rapidocr worker timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async dispose(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('rapidocr worker disposed'));
    }
    this.pending.clear();
    const child = this.child;
    this.child = null;
    this.readline?.close();
    this.readline = null;
    this.ready = null;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once('exit', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        done();
      }, 1500).unref?.();
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    if (this.starting) {
      // wait briefly for concurrent start
      await new Promise((r) => setTimeout(r, 20));
      if (this.ready) return this.ready;
    }
    this.starting = true;
    this.ready = this.spawnWorker();
    try {
      await this.ready;
    } catch (error) {
      this.ready = null;
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private spawnWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn(this.pythonBin, ['-u', this.workerScript], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      const rl = createInterface({ input: child.stdout });
      this.readline = rl;

      const failStart = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
        void this.resetChild();
      };

      const startTimer = setTimeout(() => {
        failStart(new Error('rapidocr worker ready timed out'));
      }, 30_000);

      rl.on('line', (line) => {
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          log.warn({ line }, 'rapidocr_worker_non_json_line');
          return;
        }
        if (!settled && typeof msg === 'object' && msg != null && 'ready' in msg) {
          clearTimeout(startTimer);
          const ready = Boolean((msg as { ready?: unknown }).ready);
          if (!ready) {
            failStart(new Error(String((msg as { error?: unknown }).error || 'rapidocr worker not ready')));
            return;
          }
          settled = true;
          resolve();
          return;
        }
        this.handleResponse(msg);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text) log.warn({ text }, 'rapidocr_worker_stderr');
      });

      child.on('error', (error) => {
        clearTimeout(startTimer);
        failStart(error instanceof Error ? error : new Error(String(error)));
      });

      child.on('exit', (code, signal) => {
        clearTimeout(startTimer);
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`rapidocr worker exited code=${code} signal=${signal}`));
        }
        this.pending.clear();
        this.child = null;
        this.readline = null;
        this.ready = null;
        if (!settled) {
          failStart(new Error(`rapidocr worker exited before ready code=${code} signal=${signal}`));
        }
      });
    });
  }

  private handleResponse(msg: unknown): void {
    if (typeof msg !== 'object' || msg == null || !('id' in msg)) return;
    const id = String((msg as { id?: unknown }).id ?? '');
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    const ok = Boolean((msg as { ok?: unknown }).ok);
    if (!ok) {
      pending.reject(new Error(String((msg as { error?: unknown }).error || 'rapidocr worker error')));
      return;
    }
    const wordsRaw = (msg as { words?: unknown }).words;
    const words: RapidOcrWorkerWord[] = [];
    if (Array.isArray(wordsRaw)) {
      for (const word of wordsRaw) {
        if (typeof word !== 'object' || word == null) continue;
        const text = String((word as { text?: unknown }).text ?? '').trim();
        if (!text) continue;
        const bbox = (word as { bbox?: unknown }).bbox;
        if (typeof bbox !== 'object' || bbox == null) continue;
        const x0 = Number((bbox as { x0?: unknown }).x0);
        const y0 = Number((bbox as { y0?: unknown }).y0);
        const x1 = Number((bbox as { x1?: unknown }).x1);
        const y1 = Number((bbox as { y1?: unknown }).y1);
        if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
        const confidenceRaw = (word as { confidence?: unknown }).confidence;
        const confidence =
          confidenceRaw == null || confidenceRaw === ''
            ? null
            : Number.isFinite(Number(confidenceRaw))
              ? Number(confidenceRaw)
              : null;
        words.push({ text, confidence, bbox: { x0, y0, x1, y1 } });
      }
    }
    pending.resolve(words);
  }

  private async resetChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.readline?.close();
    this.readline = null;
    this.ready = null;
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
  }
}

let sharedClient: PersistentDrawingLocalRapidOcrWorkerClient | null = null;

export function getDrawingLocalRapidOcrWorkerClient(): DrawingLocalRapidOcrWorkerClient {
  if (!sharedClient) {
    sharedClient = new PersistentDrawingLocalRapidOcrWorkerClient();
  }
  return sharedClient;
}
