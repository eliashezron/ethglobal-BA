import type { EventBus } from '../events/EventBus';
import type { OrderService } from '../orders/OrderService';
import type { OrderIntent } from '@shared/types/order';

interface MatchEngineDeps {
  readonly events: EventBus;
  readonly orderService: OrderService;
}

export class MatchEngine {
  constructor(private readonly deps: MatchEngineDeps) {
    this.deps.events.on('order.intent.received', (payload) => {
      const intent = payload as OrderIntent;
      this.deps.orderService.createOrder(intent);
    });
  }

  // TODO: implement price level book and discovery broadcasting.
}
