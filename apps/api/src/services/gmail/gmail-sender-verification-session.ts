import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../../lib/logger.js';
import type { BackupConfig } from '../backup/backup-config.js';
import type { GmailMessage } from '../backup/gmail-api-client.js';
import { GmailRateLimitedDeferredError } from '../backup/gmail-request-gate.service.js';
import { notifyGmailSenderRejected } from './gmail-sender-rejection-alert.js';
import { DEFAULT_GMAIL_SENDER_DOMAINS, GMAIL_SENDER_REJECTED_LABEL, GmailSenderRejectedError, verifyGmailSender } from './gmail-sender-verification.js';

const activeSession = new AsyncLocalStorage<GmailSenderVerificationSession>();

type MessageReader = {
  getMessage(messageId: string): Promise<GmailMessage>;
  addLabelToMessage?(messageId: string, labelName: string): Promise<void>;
};

/** One ingestion invocation; only verified messages can reach body, attachment or acknowledgement code. */
export class GmailSenderVerificationSession {
  static forRun(config: { gmailIngestSenderPolicy?: BackupConfig['gmailIngestSenderPolicy'] }): GmailSenderVerificationSession {
    return activeSession.getStore() ?? new GmailSenderVerificationSession(config);
  }
  private readonly domains: readonly string[];
  private readonly messages = new Map<string, GmailMessage>();
  private readonly rejected = new Map<string, GmailSenderRejectedError>();
  constructor(config: { gmailIngestSenderPolicy?: BackupConfig['gmailIngestSenderPolicy'] }) {
    this.domains = config.gmailIngestSenderPolicy?.allowedSenderDomains ?? DEFAULT_GMAIL_SENDER_DOMAINS;
  }
  get disabled(): boolean { return this.domains.length === 0; }

  wrap<T extends MessageReader>(client: T): T {
    const getMessage = async (id: string): Promise<GmailMessage> => {
      if (this.disabled) throw new GmailSenderRejectedError('policy_empty');
      const rejected = this.rejected.get(id);
      if (rejected) throw rejected;
      const cached = this.messages.get(id);
      if (cached) return cached;
      const message = await client.getMessage(id);
      const result = verifyGmailSender(message.payload?.headers, this.domains);
      if (!result.ok) {
        const error = new GmailSenderRejectedError(result.reason, result.domain);
        this.rejected.set(id, error);
        if (result.reason !== 'policy_empty' && client.addLabelToMessage) {
          try { await client.addLabelToMessage(id, GMAIL_SENDER_REJECTED_LABEL); }
          catch (labelError) {
            if (labelError instanceof GmailRateLimitedDeferredError) {
              this.rejected.delete(id);
              throw labelError;
            }
            logger.warn({ messageId: id }, 'Failed to label rejected Gmail message');
          }
        }
        throw error;
      }
      this.messages.set(id, message);
      return message;
    };
    return new Proxy(client, {
      get: (target, property) => {
        if (property === 'getMessage') return getMessage;
        const method = Reflect.get(target, property);
        if (typeof method !== 'function') return method;
        if (['searchMessages', 'searchMessagesAll', 'searchMessagesLimited'].includes(String(property))) {
          return (query: string, ...args: unknown[]) => this.disabled ? Promise.resolve([]) : method.call(target, `${query.trim() ? `(${query}) ` : ''}-label:${GMAIL_SENDER_REJECTED_LABEL}`, ...args);
        }
        if (['getAttachment', 'getFirstAttachment', 'listPdfAttachments', 'listHtmlAttachments', 'trashMessage', 'markAsRead', 'archiveMessage'].includes(String(property))) {
          return async (id: string, ...args: unknown[]) => { await getMessage(id); return method.call(target, id, ...args); };
        }
        return method.bind(target);
      },
    });
  }

  /** Check only the selected batch, preserving the existing Gmail request budget. */
  async filterMessageIds(client: MessageReader, ids: readonly string[]): Promise<string[]> {
    const accepted: string[] = [];
    for (const id of ids) {
      try { await client.getMessage(id); accepted.push(id); }
      catch (error) { if (!(error instanceof GmailSenderRejectedError)) accepted.push(id); }
    }
    return accepted;
  }

  async notify(): Promise<void> {
    if (activeSession.getStore() === this || (!this.disabled && !this.rejected.size)) return;
    const domains = [...new Set([...this.rejected.values()].flatMap((error) => error.domain ? [error.domain] : []))].sort();
    await notifyGmailSenderRejected(this.rejected.size, domains, this.disabled);
  }
}

/** Aggregate nested CSV targets and their retries into the schedule/manual invocation. */
export async function runWithGmailSenderVerification<T>(config: BackupConfig, operation: () => Promise<T>): Promise<T> {
  if (activeSession.getStore()) return operation();
  const session = new GmailSenderVerificationSession(config);
  try { return await activeSession.run(session, operation); }
  finally { await session.notify(); }
}
