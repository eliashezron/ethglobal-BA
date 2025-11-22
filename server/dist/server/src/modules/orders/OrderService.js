export class OrderService {
    deps;
    orders = new Map();
    constructor(deps) {
        this.deps = deps;
        this.deps.events.on('fill.confirmed', (payload) => {
            const fill = payload;
            this.updateRemaining(fill.orderId, fill.remainingSize);
        });
    }
    createOrder(intent) {
        const record = {
            ...intent,
            status: 'open',
            remaining: intent.size,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.orders.set(record.id, record);
        this.deps.events.emit('order.created', record);
        return record;
    }
    getOrder(id) {
        return this.orders.get(id);
    }
    updateRemaining(orderId, remaining) {
        const order = this.orders.get(orderId);
        if (!order)
            return;
        order.remaining = remaining;
        order.status = remaining === 0n ? 'filled' : 'partially_filled';
        order.updatedAt = new Date().toISOString();
        this.orders.set(orderId, order);
    }
}
