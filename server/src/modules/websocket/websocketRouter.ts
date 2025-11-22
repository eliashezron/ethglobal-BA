import type { ApplicationContext } from '../../app';
import type { OrderIntent } from '@shared/types/order';
import type { FillIntent } from '@shared/types/fill';

export interface RouteContext {
  readonly connectionId: string;
  readonly send: (type: string, payload: unknown) => void;
}

export interface MessageEnvelope<T = unknown> {
  readonly type: string;
  readonly payload: T;
}

type MessageHandler = (payload: unknown, context: RouteContext) => void;

export class Router {
  private readonly handlers: Record<string, MessageHandler>;

  constructor(private readonly context: ApplicationContext) {
    this.handlers = {
      'order.create': (payload, routeContext) => this.handleOrderCreate(payload as OrderIntent, routeContext),
      'fill.propose': (payload, routeContext) => this.handleFillProposed(payload as FillIntent, routeContext),
    } satisfies Record<string, MessageHandler>;
  }

  handle(message: MessageEnvelope, context: RouteContext) {
    const handler = this.handlers[message.type];
    if (!handler) {
      context.send('error', {
        code: 'UNSUPPORTED_MESSAGE_TYPE',
        message: `Unsupported websocket message type: ${message.type}`,
      });
      return;
    }

    handler(message.payload, context);
  }

  private handleOrderCreate(intent: OrderIntent, routeContext: RouteContext) {
    this.context.events.emit('order.intent.received', intent);
    routeContext.send('order.received', { id: intent.id });
  }

  private handleFillProposed(fill: FillIntent, routeContext: RouteContext) {
    this.context.events.emit('fill.intent.received', fill);
    routeContext.send('fill.received', { id: fill.id, orderId: fill.orderId });
  }
}
