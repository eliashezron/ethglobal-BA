import type { ApplicationContext } from '../../app';
import type { OrderIntent } from '@shared/types/order';
import type { FillIntent } from '@shared/types/fill';

export class Router {
  constructor(private readonly context: ApplicationContext) {}

  handleOrderCreate(_intent: OrderIntent) {
    // TODO: wire into OrderService once transport layer is selected.
    this.context.events.emit('order.intent.received', _intent);
  }

  handleFillProposed(_fill: FillIntent) {
    this.context.events.emit('fill.intent.received', _fill);
  }
}
