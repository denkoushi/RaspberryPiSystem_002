export type SignalingEnvelope = { type: string; payload?: unknown };
export type SignalingSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

/** Call routing remains keyed by signaling clientId; watch routing uses authenticated device IDs. */
export class SignalingRegistry {
  readonly connections = new Map<string, SignalingSocket>();
  private devices = new Map<string, { clientId: string; socket: SignalingSocket }>();
  private disconnectHandlers = new Set<(deviceId: string) => Promise<void>>();

  async register(clientId: string, deviceId: string, socket: SignalingSocket): Promise<void> {
    const previous = this.connections.get(clientId);
    if (previous) {
      await this.disconnect(clientId, previous);
      if (previous.readyState === 1) previous.close(1000, 'Replaced by new connection');
    }
    this.connections.set(clientId, socket);
    this.devices.set(deviceId, { clientId, socket });
  }

  isOnline(deviceId: string): boolean {
    return this.devices.get(deviceId)?.socket.readyState === 1;
  }

  sendToClientDevice(deviceId: string, message: SignalingEnvelope): boolean {
    const socket = this.devices.get(deviceId)?.socket;
    if (!socket || socket.readyState !== 1) return false;
    try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  onDisconnect(handler: (deviceId: string) => Promise<void>): () => void {
    this.disconnectHandlers.add(handler);
    return () => { this.disconnectHandlers.delete(handler); };
  }

  async disconnect(clientId: string, socket: SignalingSocket): Promise<void> {
    if (this.connections.get(clientId) !== socket) return;
    this.connections.delete(clientId);
    for (const [deviceId, entry] of this.devices) {
      if (entry.socket !== socket) continue;
      this.devices.delete(deviceId);
      await Promise.all([...this.disconnectHandlers].map(handler => handler(deviceId)));
      break;
    }
  }
}

export const signalingRegistry = new SignalingRegistry();
export const sendToClientDevice = signalingRegistry.sendToClientDevice.bind(signalingRegistry);
