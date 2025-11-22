export class Router {
    context;
    handlers;
    errorCodeMap = {
        ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
        INVALID_ORDER_PAYLOAD: 'INVALID_ORDER_PAYLOAD',
        INVALID_FILL_PAYLOAD: 'INVALID_FILL_PAYLOAD',
        INVALID_QUANTITY: 'INVALID_QUANTITY',
    };
    constructor(context) {
        this.context = context;
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
        };
    }
    async handle(message, context) {
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
        }
        catch (error) {
            const { code, message: errorMessage } = this.normalizeError(error);
            context.send('error', { code, message: errorMessage });
        }
    }
    parseOrderIntent(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('INVALID_ORDER_PAYLOAD');
        }
        const data = payload;
        const side = this.asString(data.side, 'side').toLowerCase();
        if (side !== 'buy' && side !== 'sell') {
            throw new Error('INVALID_SIDE');
        }
        return {
            id: this.asString(data.id, 'id'),
            maker: this.asString(data.maker, 'maker'),
            baseToken: this.asString(data.baseToken, 'baseToken'),
            quoteToken: this.asString(data.quoteToken, 'quoteToken'),
            side: side,
            price: this.asBigInt(data.price, 'price'),
            size: this.asBigInt(data.size, 'size'),
            minFill: this.asBigInt(data.minFill ?? data.size, 'minFill'),
            expiry: Number(data.expiry ?? 0),
            channelId: this.asString(data.channelId, 'channelId'),
            nonce: this.asString(data.nonce, 'nonce'),
            signature: this.asString(data.signature, 'signature'),
        };
    }
    parseFillIntent(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('INVALID_FILL_PAYLOAD');
        }
        const data = payload;
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
        };
    }
    asString(value, field) {
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
        throw new Error(`INVALID_${field.toUpperCase()}`);
    }
    asBigInt(value, field) {
        try {
            if (typeof value === 'bigint')
                return value;
            if (typeof value === 'number')
                return BigInt(Math.trunc(value));
            if (typeof value === 'string')
                return BigInt(value);
        }
        catch {
            throw new Error(`INVALID_${field.toUpperCase()}`);
        }
        throw new Error(`INVALID_${field.toUpperCase()}`);
    }
    normalizeError(error) {
        if (error instanceof Error) {
            const code = this.errorCodeMap[error.message] ?? error.message ?? 'INTERNAL_ERROR';
            return { code, message: error.message };
        }
        return { code: 'INTERNAL_ERROR', message: 'Unknown error' };
    }
}
