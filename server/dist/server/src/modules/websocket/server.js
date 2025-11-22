import { Router } from './websocketRouter';
export function buildServer({ context }) {
    const router = new Router(context);
    // TODO: integrate with ws or uWebSockets server implementation.
    console.log('WebSocket server stub initialized on port', context.env.server.port);
    return { router };
}
