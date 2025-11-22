export class OrderService {
    deps;
    orders = new Map();
    constructor(deps) {
        this.deps = deps;
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
        this.deps.events.emit('order.updated', order);
        if (order.status === 'filled') {
            this.deps.events.emit('order.filled', order);
        }
    }
}
