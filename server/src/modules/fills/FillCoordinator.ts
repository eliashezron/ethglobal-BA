import type { EventBus } from '../events/EventBus';
import type { SessionManager } from '../channels/SessionManager';
import type { OrderService } from '../orders/OrderService';
import type { FillIntent, FillRecord } from '@shared/types/fill';
import partialFillMath from '@shared/math/partialFill';

const { computePartialFill } = partialFillMath;

interface FillCoordinatorDependencies {
  readonly events: EventBus;
  readonly sessionManager: SessionManager;
  readonly orderService: OrderService;
}

export class FillCoordinator {
  private readonly fills = new Map<string, FillRecord>();

  constructor(private readonly deps: FillCoordinatorDependencies) {}

  async initiateFill(intent: FillIntent): Promise<FillRecord> {
    const order = this.deps.orderService.getOrder(intent.orderId);
    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const now = new Date().toISOString();
    const proposed: FillRecord = {
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

    const confirmed: FillRecord = {
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
