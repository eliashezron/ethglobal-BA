import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ApplicationContext } from '../../app';
import { Router, type MessageEnvelope } from './websocketRouter';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

interface BuildServerOptions {
  readonly context: ApplicationContext;
}

interface ConnectionRecord {
  readonly id: string;
  readonly socket: WebSocket;
}

function serialize(type: string, payload: unknown): string {
  return JSON.stringify({ type, payload });
}

function safeParse(raw: string): MessageEnvelope | undefined {
  try {
    const parsed = JSON.parse(raw) as MessageEnvelope;
    if (typeof parsed?.type !== 'string') {
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse websocket message', error);
    return undefined;
  }
}

export function buildServer({ context }: BuildServerOptions) {
  const router = new Router(context);
  const wss = new WebSocketServer({ port: context.env.server.port });
  const connections = new Map<string, ConnectionRecord>();

  const broadcast = (type: string, payload: unknown) => {
    const frame = serialize(type, payload);
    connections.forEach(({ socket }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      }
    });
  };

  const send = (socket: WebSocket, type: string, payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serialize(type, payload));
    }
  };

  context.events.on('order.created', (payload) => broadcast('order.created', payload));
  context.events.on('fill.proposed', (payload) => broadcast('fill.proposed', payload));
  context.events.on('fill.confirmed', (payload) => broadcast('fill.confirmed', payload));
  context.events.on('orderbook.snapshot.publish', (payload) => broadcast('orderbook.snapshot', payload));

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const connectionId = randomUUID();
    connections.set(connectionId, { id: connectionId, socket });
    console.log('WebSocket connection established', connectionId, request.socket.remoteAddress);

    send(socket, 'connection.ack', { connectionId });

    socket.on('message', (data: RawData) => {
      const message = safeParse(data.toString());
      if (!message) {
        send(socket, 'error', {
          code: 'INVALID_JSON',
          message: 'Unable to parse websocket message payload',
        });
        return;
      }

      router.handle(message, {
        connectionId,
        send: (type, payload) => send(socket, type, payload),
      });
    });

    socket.on('close', (code: number, reason: Buffer) => {
      connections.delete(connectionId);
      console.log('WebSocket connection closed', connectionId, code, reason.toString());
    });

    socket.on('error', (error: Error) => {
      connections.delete(connectionId);
      console.error('WebSocket error', connectionId, error);
    });
  });

  wss.on('listening', () => {
    console.log('WebSocket server listening on port', context.env.server.port);
  });

  wss.on('error', (error: Error) => {
    console.error('WebSocket server error', error);
  });

  return { router, wss, broadcast };
}
