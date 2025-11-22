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

type MessageHandler = (context: RouteContext, payload: unknown) => Promise<void> | void;

export class Router {
  private readonly handlers: Record<string, MessageHandler>;
  private readonly errorCodeMap: Record<string, string> = {
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    INVALID_ORDER_PAYLOAD: 'INVALID_ORDER_PAYLOAD',
    INVALID_FILL_PAYLOAD: 'INVALID_FILL_PAYLOAD',
    INVALID_QUANTITY: 'INVALID_QUANTITY',
  };

  constructor(private readonly context: ApplicationContext) {
    this.handlers = {
      'order.create': async (routeContext, payload) => {
        const intent = this.parseOrderIntent(payload);
        const record = this.context.orderService.createOrder(intent);
        routeContext.send('order.received', { order: record });
      },
      'fill.propose': async (routeContext, payload) => {
        const intent = this.parseFillIntent(payload);
        const record = await this.context.fillCoordinator.initiateFill(intent);
        routeContext.send('fill.received', { fill: record });
      },
    } satisfies Record<string, MessageHandler>;
  }

  async handle(message: MessageEnvelope, context: RouteContext): Promise<void> {
    const handler = this.handlers[message.type];
    if (!handler) {
      context.send('error', {
        code: 'UNSUPPORTED_MESSAGE_TYPE',
        message: `Unsupported websocket message type: ${message.type}`,
      });
      return;
    }

    try {
      await handler(context, message.payload);
    } catch (error) {
      const { code, message: errorMessage } = this.normalizeError(error);
      context.send('error', { code, message: errorMessage });
    }
  }

  private parseOrderIntent(payload: unknown): OrderIntent {
    if (!payload || typeof payload !== 'object') {
      throw new Error('INVALID_ORDER_PAYLOAD');
    }
    const data = payload as Record<string, unknown>;
    const side = this.asString(data.side, 'side').toLowerCase();
    if (side !== 'buy' && side !== 'sell') {
      throw new Error('INVALID_SIDE');
    }
    return {
      id: this.asString(data.id, 'id'),
      maker: this.asString(data.maker, 'maker'),
      baseToken: this.asString(data.baseToken, 'baseToken'),
      quoteToken: this.asString(data.quoteToken, 'quoteToken'),
      side: side as OrderIntent['side'],
      price: this.asBigInt(data.price, 'price'),
      size: this.asBigInt(data.size, 'size'),
      minFill: this.asBigInt(data.minFill ?? data.size, 'minFill'),
      expiry: Number(data.expiry ?? 0),
      channelId: this.asString(data.channelId, 'channelId'),
      nonce: this.asString(data.nonce, 'nonce'),
      signature: this.asString(data.signature, 'signature'),
    } satisfies OrderIntent;
  }

  private parseFillIntent(payload: unknown): FillIntent {
    if (!payload || typeof payload !== 'object') {
      throw new Error('INVALID_FILL_PAYLOAD');
    }
    const data = payload as Record<string, unknown>;
    const quantity = this.asBigInt(data.quantity, 'quantity');
    if (quantity <= 0n) {
      throw new Error('INVALID_QUANTITY');
    }
    return {
      id: this.asString(data.id, 'id'),
      orderId: this.asString(data.orderId, 'orderId'),
      maker: this.asString(data.maker, 'maker'),
      taker: this.asString(data.taker, 'taker'),
      quantity,
      price: this.asBigInt(data.price, 'price'),
      partial: Boolean(data.partial),
      channelId: this.asString(data.channelId, 'channelId'),
      channelNonce: this.asBigInt(data.channelNonce ?? 0, 'channelNonce'),
      signature: this.asString(data.signature, 'signature'),
    } satisfies FillIntent;
  }

  private asString(value: unknown, field: string): string {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }

  private asBigInt(value: unknown, field: string): bigint {
    try {
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number') return BigInt(Math.trunc(value));
      if (typeof value === 'string') return BigInt(value);
    } catch {
      throw new Error(`INVALID_${field.toUpperCase()}`);
    }
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }

  private normalizeError(error: unknown): { code: string; message: string } {
    if (error instanceof Error) {
      const code = this.errorCodeMap[error.message] ?? error.message ?? 'INTERNAL_ERROR';
      return { code, message: error.message };
    }
    return { code: 'INTERNAL_ERROR', message: 'Unknown error' };
  }
}
