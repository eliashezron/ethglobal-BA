import partialFillMath from '@shared/math/partialFill';
const { computePartialFill } = partialFillMath;
export class FillCoordinator {
    deps;
    fills = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    async initiateFill(intent) {
        const order = this.deps.orderService.getOrder(intent.orderId);
        if (!order) {
            throw new Error('ORDER_NOT_FOUND');
        }
        const now = new Date().toISOString();
        const proposed = {
            ...intent,
            status: 'proposed',
            executedQuantity: 0n,
            remainingAfter: order.remaining,
            createdAt: now,
            updatedAt: now,
        };
        this.fills.set(proposed.id, proposed);
        this.deps.events.emit('fill.proposed', proposed);
        await this.deps.sessionManager.prepareFill(intent);
        const { executed, remainingAfter } = computePartialFill(intent.quantity, order.remaining);
        const confirmed = {
            ...proposed,
            status: 'confirmed',
            executedQuantity: executed,
            remainingAfter,
            updatedAt: new Date().toISOString(),
        };
        this.fills.set(confirmed.id, confirmed);
        this.deps.orderService.updateRemaining(intent.orderId, remainingAfter);
        this.deps.events.emit('fill.confirmed', confirmed);
        return confirmed;
    }
}
