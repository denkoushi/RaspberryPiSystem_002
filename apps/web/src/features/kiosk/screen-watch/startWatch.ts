type Starter = (threadId: string, employeeTagUid: string, targetLabel: string) => Promise<void>;
let starter: Starter | undefined;

export function registerWatchStarter(handler: Starter): () => void {
  starter = handler;
  return () => { if (starter === handler) starter = undefined; };
}

/** The badge UID is passed directly to HTTP; it is never retained in global state. */
export async function startWatch(threadId: string, employeeTagUid: string, targetLabel: string): Promise<void> {
  await starter?.(threadId, employeeTagUid, targetLabel);
}
