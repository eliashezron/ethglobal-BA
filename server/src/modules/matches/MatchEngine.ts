import type { EventBus } from '../events/EventBus';

interface MatchEngineDeps {
  readonly events: EventBus;
}

export class MatchEngine {
  constructor(private readonly deps: MatchEngineDeps) {
    this.deps.events.on('order.created', (order) => {
      console.log('Match engine received new order', (order as { id?: string }).id);
    });
  }

  // TODO: implement price level book and discovery broadcasting.
}
