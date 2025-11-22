import type { ApplicationContext } from '../../app';
import { Router } from './websocketRouter';

interface BuildServerOptions {
  readonly context: ApplicationContext;
}

export function buildServer({ context }: BuildServerOptions) {
  const router = new Router(context);
  // TODO: integrate with ws or uWebSockets server implementation.
  console.log('WebSocket server stub initialized on port', context.env.server.port);
  return { router };
}
