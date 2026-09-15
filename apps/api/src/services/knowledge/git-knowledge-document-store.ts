import { execFile } from 'node:child_process';
import { mkdir, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

import { KnowledgeRevisionConflict, knowledgeReportSchema, type KnowledgeDocument, type KnowledgeDocumentStorePort, type KnowledgeRevision } from './knowledge-document.js';

const REF = 'refs/heads/knowledge';
const ZERO = '0'.repeat(40);
const REVISION = /^[a-f0-9]{40}$/;

/** A dedicated bare data repository: no working tree, shared index, hooks, shell or network. */
export class GitKnowledgeDocumentStore implements KnowledgeDocumentStorePort {
  constructor(private directory: string) {
    if (!path.isAbsolute(directory)) throw new Error('Knowledge Git directory must be absolute');
  }

  /** Provision only a new/empty directory, or verify this adapter's own repository. */
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Knowledge Git directory must not be a symlink');
    this.directory = await realpath(this.directory);
    if ((await readdir(this.directory)).length === 0) {
      await this.git(['init', '--bare', '--object-format=sha1', this.directory]);
      await this.git(['config', 'hermesKnowledge.formatVersion', '1']);
      await this.git(['symbolic-ref', 'HEAD', REF]);
    }
    await this.verifyRepository();
  }

  async read(revision?: string): Promise<KnowledgeRevision | null> {
    await this.verifyRepository();
    if (revision && !REVISION.test(revision)) throw new Error('Invalid knowledge revision');
    const head = await this.head();
    if (!head) return null;
    const selected = revision ?? head;
    if (selected !== head) {
      const ancestor = await this.git(['merge-base', '--is-ancestor', selected, head], undefined, true);
      if (ancestor.code !== 0) throw new Error('Unknown knowledge revision');
    }
    const markdown = (await this.git(['show', `${selected}:knowledge.md`])).stdout;
    const report = knowledgeReportSchema.parse(JSON.parse((await this.git(['show', `${selected}:report.json`])).stdout));
    return { revision: selected, document: { markdown, report } };
  }

  async publish(document: KnowledgeDocument, expectedRevision: string | null): Promise<KnowledgeRevision> {
    await this.verifyRepository();
    if (expectedRevision !== null && !REVISION.test(expectedRevision)) throw new Error('Invalid expected knowledge revision');
    if (Buffer.byteLength(document.markdown) > 2_000_000 || !document.markdown.trim()) throw new Error('Invalid knowledge Markdown size');
    const report = knowledgeReportSchema.parse(document.report);
    const markdownBlob = (await this.git(['hash-object', '-w', '--stdin'], document.markdown)).stdout.trim();
    const reportBlob = (await this.git(['hash-object', '-w', '--stdin'], `${JSON.stringify(report)}\n`)).stdout.trim();
    const tree = (await this.git(['mktree'], `100644 blob ${markdownBlob}\tknowledge.md\n100644 blob ${reportBlob}\treport.json\n`)).stdout.trim();
    const current = await this.head();
    if (current && await this.tree(current) === tree) return { revision: current, document: { ...document, report } };
    if (current !== expectedRevision) throw new KnowledgeRevisionConflict();
    const revision = (await this.git(['commit-tree', tree, ...(current ? ['-p', current] : []), '-m', 'Organize knowledge sources'])).stdout.trim();
    // Atomic compare-and-swap fences a stale worker. Failed writers leave only unreachable objects.
    const updated = await this.git(['update-ref', REF, revision, expectedRevision ?? ZERO], undefined, true);
    if (updated.code !== 0) {
      const winner = await this.head();
      if (winner && await this.tree(winner) === tree) return { revision: winner, document: { ...document, report } };
      if (winner === expectedRevision) throw new Error('Knowledge Git publication failed');
      throw new KnowledgeRevisionConflict();
    }
    return { revision, document: { ...document, report } };
  }

  private async tree(revision: string): Promise<string> {
    return (await this.git(['rev-parse', `${revision}^{tree}`])).stdout.trim();
  }

  private async head(): Promise<string | null> {
    const result = await this.git(['rev-parse', '--verify', '--quiet', REF], undefined, true);
    if (result.code === 1) return null;
    if (result.code !== 0 || !REVISION.test(result.stdout.trim())) throw new Error('Cannot read knowledge Git head');
    return result.stdout.trim();
  }

  private async verifyRepository(): Promise<void> {
    const bare = await this.git(['rev-parse', '--is-bare-repository']);
    const marker = await this.git(['config', '--local', '--get', 'hermesKnowledge.formatVersion']);
    if (bare.stdout.trim() !== 'true' || marker.stdout.trim() !== '1') throw new Error('Not a dedicated knowledge Git repository');
  }

  private git(args: string[], input?: string, allowFailure = false): Promise<{ stdout: string; code: number }> {
    // Ignore inherited Git routing/config overrides; data must never be committed to the source checkout.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    return new Promise((resolve, reject) => {
      const child = execFile('git', ['--git-dir', this.directory, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
        timeout: 15_000, maxBuffer: 4_000_000,
        env: { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1',
          GIT_AUTHOR_NAME: 'Hermes knowledge', GIT_AUTHOR_EMAIL: 'knowledge@localhost',
          GIT_COMMITTER_NAME: 'Hermes knowledge', GIT_COMMITTER_EMAIL: 'knowledge@localhost' },
      }, (error, stdout) => {
        if (error && (!allowFailure || typeof error.code !== 'number')) reject(new Error('Knowledge Git operation failed'));
        else resolve({ stdout, code: typeof error?.code === 'number' ? error.code : 0 });
      });
      child.stdin?.on('error', () => { /* execFile callback reports child failure */ });
      child.stdin?.end(input);
    });
  }
}
