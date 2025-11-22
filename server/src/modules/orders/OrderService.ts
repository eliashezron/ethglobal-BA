import type { OrderIntent, OrderRecord } from '@shared/types/order';
import type { EventBus } from '../events/EventBus';
import type { SessionManager } from '../channels/SessionManager';

interface OrderServiceDependencies {
  readonly events: EventBus;
  readonly sessionManager: SessionManager;
}

export class OrderService {
  private readonly orders = new Map<string, OrderRecord>();

  constructor(private readonly deps: OrderServiceDependencies) {
    this.deps.events.on('fill.confirmed', (payload) => {
      const fill = payload as { orderId: string; remainingSize: bigint };
      this.updateRemaining(fill.orderId, fill.remainingSize);
    });
  }

  createOrder(intent: OrderIntent): OrderRecord {
    const record: OrderRecord = {
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

  getOrder(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }

  updateRemaining(orderId: string, remaining: bigint) {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.remaining = remaining;
    order.status = remaining === 0n ? 'filled' : 'partially_filled';
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);
  }
}
