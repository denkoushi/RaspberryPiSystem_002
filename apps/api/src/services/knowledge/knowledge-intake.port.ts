import type { KnowledgeReport } from '@raspi-system/shared-types';

import type { KnowledgeSource, OrganizedNote } from './knowledge-source.js';

export type KnowledgeAction = 'save' | 'ask' | 'report' | 'delegate' | 'clarify';
export type IntakeFile = { id: string; key: string; kind: 'image' | 'pdf'; filename: string };
export type IntakeResult = { message: string; report?: KnowledgeReport; revision?: string };
export type Intake = {
  id: string; ownerKey: string; conversationId: string; inputHash: string; text: string; files: IntakeFile[];
  sources: KnowledgeSource[] | null; organized: OrganizedNote[] | null;
  state: string; action: KnowledgeAction | null; version: number; attempts: number;
  result: IntakeResult | null; errorCode: string | null; createdAt: Date;
};
export interface KnowledgeIntakeRepositoryPort {
  receive(input: Pick<Intake, 'id' | 'ownerKey' | 'conversationId' | 'inputHash' | 'text' | 'files'>): Promise<Intake>;
  accepted(id: string, owner: string): Promise<void>;
  route(id: string, owner: string, action: KnowledgeAction): Promise<KnowledgeAction>;
  get(id: string, owner: string): Promise<Intake | null>;
  history(owner: string, conversationId: string): Promise<Intake[]>;
  choose(id: string, owner: string, version: number, action: KnowledgeAction): Promise<boolean>;
  retry(id: string, owner: string, version: number): Promise<boolean>;
  claim(token: string): Promise<Intake | null>;
  renew(token: string): Promise<boolean>;
  release(token: string): Promise<void>;
  saveProgress(id: string, token: string, sources: KnowledgeSource[], organized: OrganizedNote[]): Promise<void>;
  finish(id: string, token: string, state: string, action: KnowledgeAction, result: IntakeResult, revision?: string): Promise<void>;
  fail(id: string, token: string, errorCode: string, deferred: boolean): Promise<void>;
  readySources(): Promise<{ source: KnowledgeSource; organized: OrganizedNote }[]>;
  publication(): Promise<string | null>;
}
