/**
 * WebRTCシグナリングサーバー
 * WebSocket経由でSDP offer/answer、ICE candidateを中継
 */

import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { callStore } from './call-store.js';
import type { SignalingMessage, WebSocketLike } from './types.js';

const WS_OPEN = 1;

const normalizeClientKey = (rawKey: unknown): string | undefined => {
  if (typeof rawKey === 'string') {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // noop
    }
    return rawKey;
  }
  if (Array.isArray(rawKey) && rawKey.length > 0 && typeof rawKey[0] === 'string') {
    return rawKey[0];
  }
  return undefined;
};

/**
 * クライアントデバイスの存在確認とclientId取得
 */
async function validateClient(clientKey: string): Promise<{ id: string; clientId: string | null }> {
  const client = await prisma.clientDevice.findUnique({
    where: { apiKey: clientKey },
    select: { id: true, statusClientId: true }
  });

  if (!client) {
    throw new ApiError(401, 'Invalid client key', undefined, 'INVALID_CLIENT_KEY');
  }

  return {
    id: client.id,
    clientId: client.statusClientId || null
  };
}

/**
 * クライアントIDからクライアント情報を取得
 */
async function getClientByClientId(
  clientId: string
): Promise<{ id: string; name: string; location: string | null } | null> {
  const client = await prisma.clientDevice.findFirst({
    where: { statusClientId: clientId },
    select: { id: true, name: true, location: true }
  });

  return client;
}

export function registerWebRTCSignaling(app: FastifyInstance): void {
  // クライアント接続管理（clientId -> WebSocket）
  const clientConnections = new Map<string, WebSocketLike>();

  // NOTE:
  // - `registerWebRTCRoutes()` が prefix `/webrtc` でサブアプリを登録しているため、
  //   ここでは `/signaling` のみを定義する（`/webrtc/...` を重ねると二重になる）。
  app.log.info('Registering WebRTC signaling WebSocket route: /signaling');
  app.get('/signaling', { websocket: true }, async (connection, req) => {
    app.log.info({ url: req.url, headers: req.headers }, 'WebRTC signaling WebSocket connection attempt');
    // @fastify/websocket の connection 形状が環境差分で異なる可能性があるため、
    // `connection.socket` が無い場合は `connection` 自体をソケットとして扱う（実測でconnection.socketがundefinedのケースあり）。
    const maybeSocket = (connection as unknown as { socket?: unknown }).socket ?? connection;
    const socket = maybeSocket as unknown as WebSocketLike;
    app.log.info(
      {
        hasConnectionSocket: Boolean((connection as unknown as { socket?: unknown }).socket),
        socketHasOn: typeof (socket as unknown as { on?: unknown }).on === 'function',
        socketHasSend: typeof (socket as unknown as { send?: unknown }).send === 'function',
        socketHasClose: typeof (socket as unknown as { close?: unknown }).close === 'function'
      },
      'WebRTC signaling socket shape'
    );

    if (
      typeof (socket as unknown as { on?: unknown }).on !== 'function' ||
      typeof (socket as unknown as { send?: unknown }).send !== 'function' ||
      typeof (socket as unknown as { close?: unknown }).close !== 'function'
    ) {
      app.log.error('WebRTC signaling: invalid websocket object (missing on/send/close)');
      return;
    }

    // クライアントキーを取得（x-client-keyヘッダーまたはクエリパラメータ）
    const headerClientKey = (req.headers as Record<string, unknown>)['x-client-key'];
    const rawClientKey = headerClientKey || (req.query as { clientKey?: string }).clientKey;
    const clientKey = normalizeClientKey(rawClientKey);
    app.log.info({ hasHeaderKey: !!headerClientKey, hasQueryKey: !!(req.query as { clientKey?: string }).clientKey, hasClientKey: !!clientKey }, 'WebRTC signaling client key resolution');

    if (!clientKey) {
      app.log.warn('WebRTC signaling: Client key required but not found');
      socket.close(1008, 'Client key required');
      return;
    }

    // クライアントの存在確認
    let clientInfo: { id: string; clientId: string | null };
    try {
      clientInfo = await validateClient(clientKey);
    } catch {
      socket.close(1008, 'Invalid client key');
      return;
    }

    // clientIdが設定されていない場合はエラー
    if (!clientInfo.clientId) {
      socket.close(1008, 'Client ID not configured. Please set statusClientId.');
      return;
    }

    const clientId = clientInfo.clientId;

    // 既存の接続があれば閉じる（重複接続防止）
    const existingConnection = clientConnections.get(clientId);
    if (existingConnection && existingConnection.readyState === WS_OPEN) {
      existingConnection.close(1000, 'Replaced by new connection');
    }

    clientConnections.set(clientId, socket);
    const connectionStartTime = Date.now();
    app.log.info({ clientId, connectionStartTime }, 'WebRTC signaling client connected');

    // メッセージ受信処理
    socket.on('message', async (message: Buffer) => {
      try {
        const data: SignalingMessage = JSON.parse(message.toString());

        // メッセージタイプに応じて処理
        switch (data.type) {
          case 'invite': {
            // 発信: 相手に着信通知を送信
            if (!data.to) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Missing "to" field' }
                })
              );
              return;
            }

            app.log.info(
              {
                from: clientId,
                to: data.to,
                connectedClientCount: clientConnections.size,
                connectedClientIds: Array.from(clientConnections.keys()),
              },
              'WebRTC signaling invite received'
            );

            // 相手の存在確認
            const callee = await getClientByClientId(data.to);
            if (!callee) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: `Client ${data.to} not found` }
                })
              );
              return;
            }

            // 既存のコールをチェック（相手が既に通話中の場合）
            const existingCall = callStore.getCallByClientId(data.to);
            if (existingCall && existingCall.state === 'in_call') {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Callee is already in a call' }
                })
              );
              return;
            }

            // コールIDを生成
            const callId = `call-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            callStore.createCall(callId, clientId, data.to);

            // 発信者を参加者に追加
            callStore.addParticipant(callId, {
              clientId,
              socket,
              joinedAt: Date.now()
            });

            // 相手に着信通知を送信
            const calleeSocket = clientConnections.get(data.to);
            app.log.info(
              {
                to: data.to,
                hasCalleeSocket: Boolean(calleeSocket),
                calleeReadyState: calleeSocket?.readyState ?? null,
              },
              'WebRTC signaling invite callee socket lookup'
            );
            if (calleeSocket && calleeSocket.readyState === WS_OPEN) {
              const caller = await getClientByClientId(clientId);
              calleeSocket.send(
                JSON.stringify({
                  type: 'incoming',
                  callId,
                  from: clientId,
                  to: data.to,
                  payload: {
                    callerName: caller?.name || clientId,
                    callerLocation: caller?.location || null
                  },
                  timestamp: Date.now()
                })
              );
            } else {
              // 相手が接続していない場合はエラー
              callStore.deleteCall(callId);
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Callee is not connected' }
                })
              );
            }
            break;
          }

          case 'accept': {
            // 受話: コール状態を更新し、発信者に通知
            if (!data.callId) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Missing "callId" field' }
                })
              );
              return;
            }

            const call = callStore.getCall(data.callId);
            if (!call) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Call not found' }
                })
              );
              return;
            }

            // 受話者はcall.toと一致する必要がある
            if (call.to !== clientId) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Unauthorized' }
                })
              );
              return;
            }

            // 受話者を参加者に追加
            callStore.addParticipant(data.callId, {
              clientId,
              socket,
              joinedAt: Date.now()
            });

            // コール状態を更新
            callStore.updateCallState(data.callId, 'in_call');

            // 発信者に受話通知を送信
            const callerSocket = clientConnections.get(call.from);
            if (callerSocket && callerSocket.readyState === WS_OPEN) {
              callerSocket.send(
                JSON.stringify({
                  type: 'accept',
                  callId: data.callId,
                  from: clientId,
                  to: call.from,
                  timestamp: Date.now()
                })
              );
            }
            break;
          }

          case 'reject':
          case 'cancel':
          case 'hangup': {
            // 拒否/キャンセル/切断: コールを終了し、相手に通知
            if (!data.callId) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Missing "callId" field' }
                })
              );
              return;
            }

            const call = callStore.getCall(data.callId);
            if (!call) {
              // コールが既に削除されている場合は無視
              return;
            }

            // 相手のclientIdを特定
            const otherClientId = call.from === clientId ? call.to : call.from;
            const otherSocket = clientConnections.get(otherClientId);

            // 相手に通知
            if (otherSocket && otherSocket.readyState === WS_OPEN) {
              otherSocket.send(
                JSON.stringify({
                  type: data.type,
                  callId: data.callId,
                  from: clientId,
                  to: otherClientId,
                  timestamp: Date.now()
                })
              );
            }

            // コールを削除
            callStore.deleteCall(data.callId);
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            // WebRTCシグナリングメッセージ: 相手に転送
            if (!data.callId) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Missing "callId" field' }
                })
              );
              return;
            }

            const call = callStore.getCall(data.callId);
            if (!call) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Call not found' }
                })
              );
              return;
            }

            // 相手のclientIdを特定
            const otherClientId = call.from === clientId ? call.to : call.from;
            const otherSocket = clientConnections.get(otherClientId);

            app.log.info(
              {
                type: data.type,
                callId: data.callId,
                from: clientId,
                callFrom: call.from,
                callTo: call.to,
                otherClientId,
                selfEqualsOther: otherClientId === clientId,
                hasOtherSocket: Boolean(otherSocket),
                otherReadyState: otherSocket?.readyState ?? null
              },
              'WebRTC signaling relay'
            );

            if (otherSocket && otherSocket.readyState === WS_OPEN) {
              otherSocket.send(
                JSON.stringify({
                  ...data,
                  from: clientId,
                  to: otherClientId
                })
              );
            } else {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  payload: { message: 'Other participant not connected' }
                })
              );
            }
            break;
          }

          default:
            socket.send(
              JSON.stringify({
                type: 'error',
                payload: { message: `Unknown message type: ${data.type}` }
              })
            );
        }
      } catch (error) {
        app.log.error({ err: error }, 'Failed to process signaling message');
        socket.send(
          JSON.stringify({
            type: 'error',
            payload: { message: error instanceof Error ? error.message : 'Failed to process message' }
          })
        );
      }
    });

    // 切断処理
    socket.on('close', async () => {
      const disconnectTime = Date.now();
      const connectionDuration = disconnectTime - connectionStartTime;
      clientConnections.delete(clientId);
      app.log.info({ clientId, connectionStartTime, disconnectTime, connectionDuration }, 'WebRTC signaling client disconnected');

      // このクライアントが参加しているコールを終了
      const call = callStore.getCallByClientId(clientId);
      if (call) {
        const otherClientId = call.from === clientId ? call.to : call.from;
        const otherSocket = clientConnections.get(otherClientId);

        if (otherSocket && otherSocket.readyState === WS_OPEN) {
          otherSocket.send(
            JSON.stringify({
              type: 'hangup',
              callId: call.callId,
              from: clientId,
              to: otherClientId,
              timestamp: Date.now()
            })
          );
        }

        callStore.deleteCall(call.callId);
      }
    });
  });
}
