import type { SignalingMessage } from './types';

export type SignalingEvent = SignalingMessage | { type: 'connection.closed'; payload?: never };
type Handler = (message: SignalingEvent) => void;
const subscribers = new Set<{ prefix: string; handler: Handler }>();
let sender: ((message: SignalingMessage) => boolean) | undefined;

/** The existing signaling hook is the sole socket owner. Cleanup cannot detach a newer socket. */
export function registerSignalingSender(send: (message: SignalingMessage) => boolean): () => void {
  sender = send;
  return () => {
    if (sender !== send) return;
    sender = undefined;
    publishSignaling({ type: 'connection.closed' });
  };
}

export function sendSignalingMessage(message: SignalingMessage): boolean {
  return sender?.(message) ?? false;
}

export function subscribeSignaling(prefix: string, handler: Handler): () => void {
  const subscription = { prefix, handler };
  subscribers.add(subscription);
  return () => { subscribers.delete(subscription); };
}

export function publishSignaling(message: SignalingEvent): void {
  for (const { prefix, handler } of subscribers) {
    if (message.type.startsWith(prefix)) handler(message);
  }
}
