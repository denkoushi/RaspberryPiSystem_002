import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {setPriority} from 'node:os';

export type HermesTrialAnswer = {
  status: string;
  answer: string;
  recordIds: string[];
  elapsedMs: number;
};

type WorkerResponse = { workerReady?: boolean; workerRequestId?: string; workerError?: string; runtime?: {
  snapshot?: { count: number; snapshotId: string }; organized?: { count: number };
}; result?: HermesTrialAnswer };

export class HermesSearchTrialService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { id: string; resolve: (value: HermesTrialAnswer) => void; reject: (error: Error) => void } | null = null;
  private runtime: WorkerResponse['runtime'];
  private ready: Promise<void> | null = null;
  private failure: Error | null = null;

  constructor(private readonly settings = {
    enabled: process.env.HERMES_SEARCH_TRIAL_ENABLED === 'true',
    node: process.env.HERMES_SEARCH_NODE ?? '/opt/hermes-node/bin/node',
    entry: process.env.HERMES_SEARCH_ENTRY ?? '/app/scripts/hermes-search/hermes-qmd-prefetch-worker.mjs'
  }) {}

  isEnabled() { return this.settings.enabled; }

  private start(): Promise<void> {
    if (!this.settings.enabled) return Promise.reject(new Error('試用検索は無効です。'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.ready) return this.ready;
    if (!process.env.HERMES_INFERENCE_ORIGIN || !process.env.HERMES_INFERENCE_TOKEN) {
      return Promise.reject(new Error('試用検索の接続設定がありません。'));
    }
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(this.settings.node, ['--max-old-space-size=384', this.settings.entry, '--hermes-ui-prefetch-worker'], {
        env: { ...process.env, HERMES_ALLOW_INDEX_UPDATE: 'false', UV_THREADPOOL_SIZE:'2' }, stdio: ['pipe','pipe','pipe']
      });
      child.once('spawn',()=>{if(child.pid)try{setPriority(child.pid,10);}catch{/* OS scheduling may already constrain this container. */}});
      this.child = child;
      let buffer = '';
      const fail = () => {
        const error = new Error('試用検索を利用できません。検索失敗のため、該当なしとは判断していません。');
        this.failure = error;
        this.pending?.reject(error);
        this.pending = null;
        reject(error);
      };
      const timeout = setTimeout(() => { fail(); child.kill('SIGTERM'); }, 30000);
      child.once('error', () => { clearTimeout(timeout); fail(); });
      child.stdin.on('error', () => { clearTimeout(timeout); fail(); child.kill('SIGTERM'); });
      child.once('exit', () => { clearTimeout(timeout); fail(); this.child = null; });
      // Diagnostic bodies can include source text. The API never logs them.
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 8 * 1024 * 1024) { fail(); child.kill('SIGTERM'); return; }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('__HERMES_UI_PREFETCH__')) continue;
          try {
            const row = JSON.parse(line.slice('__HERMES_UI_PREFETCH__'.length)) as WorkerResponse;
            if (row.workerReady) { clearTimeout(timeout); this.runtime = row.runtime; resolve(); }
            else if (row.workerRequestId === this.pending?.id) {
              const pending = this.pending;
              this.pending = null;
              if (row.workerError || !row.result || typeof row.result.answer !== 'string') pending?.reject(new Error('検索に失敗しました。該当なしとは判断していません。'));
              else pending?.resolve(row.result);
            } else if (row.workerError) { clearTimeout(timeout); fail(); }
          } catch { fail(); child.kill('SIGTERM'); }
        }
      });
    });
    return this.ready;
  }

  async scope() {
    if (!this.settings.enabled) return { enabled: false };
    await this.start();
    return { enabled: true, snapshotCount: this.runtime?.snapshot?.count,
      organizedCount: this.runtime?.organized?.count, snapshotId: this.runtime?.snapshot?.snapshotId };
  }

  async answer(question: string): Promise<HermesTrialAnswer> {
    await this.start();
    if (this.pending) throw new Error('別の検索を処理中です。少し待って再送してください。');
    const result = await new Promise<HermesTrialAnswer>((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        // Keep worker ownership until it actually completes; do not start overlapping work.
        reject(new Error('検索の待ち時間を超えました。該当なしとは判断していません。'));
      }, 30000);
      this.pending = { id, resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
      this.child!.stdin.write(JSON.stringify({ type:'request', requestId:id, question })+'\n');
    });
    // Source identities and spans remain in the worker; send only the existing text answer.
    return { status:result.status, answer:result.answer, recordIds:result.recordIds, elapsedMs:result.elapsedMs };
  }

  close() { this.child?.kill('SIGTERM'); }
}
