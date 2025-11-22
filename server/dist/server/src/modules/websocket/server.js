import { randomUUID } from 'node:crypto';
import { Router } from './websocketRouter';
import { WebSocketServer, WebSocket } from 'ws';
function serialize(type, payload) {
    return JSON.stringify({ type, payload }, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
}
function safeParse(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.type !== 'string') {
            return undefined;
        }
        return parsed;
    }
    catch (error) {
        console.error('Failed to parse websocket message', error);
        return undefined;
    }
}
export function buildServer({ context }) {
    const router = new Router(context);
    const wss = new WebSocketServer({ port: context.env.server.port });
    const connections = new Map();
    const broadcast = (type, payload) => {
        const frame = serialize(type, payload);
        connections.forEach(({ socket }) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(frame);
            }
        });
    };
    const send = (socket, type, payload) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(serialize(type, payload));
        }
    };
    context.events.on('order.created', (payload) => broadcast('order.created', payload));
    context.events.on('order.updated', (payload) => broadcast('order.updated', payload));
    context.events.on('fill.proposed', (payload) => broadcast('fill.proposed', payload));
    context.events.on('fill.confirmed', (payload) => broadcast('fill.confirmed', payload));
    context.events.on('order.filled', (payload) => broadcast('order.filled', payload));
    context.events.on('orderbook.snapshot.publish', (payload) => broadcast('orderbook.snapshot', payload));
    wss.on('connection', (socket, request) => {
        const connectionId = randomUUID();
        connections.set(connectionId, { id: connectionId, socket });
        console.log('WebSocket connection established', connectionId, request.socket.remoteAddress);
        send(socket, 'connection.ack', { connectionId });
        socket.on('message', (data) => {
            const message = safeParse(data.toString());
            if (!message) {
                send(socket, 'error', {
                    code: 'INVALID_JSON',
                    message: 'Unable to parse websocket message payload',
                });
                return;
            }
            Promise.resolve(router.handle(message, {
                connectionId,
                send: (type, payload) => send(socket, type, payload),
            })).catch((error) => {
                console.error('Router handler failed', error);
                send(socket, 'error', {
                    code: 'INTERNAL_ERROR',
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
            });
        });
        socket.on('close', (code, reason) => {
            connections.delete(connectionId);
            console.log('WebSocket connection closed', connectionId, code, reason.toString());
        });
        socket.on('error', (error) => {
            connections.delete(connectionId);
            console.error('WebSocket error', connectionId, error);
        });
    });
    wss.on('listening', () => {
        console.log('WebSocket server listening on port', context.env.server.port);
    });
    wss.on('error', (error) => {
        console.error('WebSocket server error', error);
    });
    return { router, wss, broadcast };
}
