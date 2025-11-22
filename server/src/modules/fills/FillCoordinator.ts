import type { EventBus } from '../events/EventBus';
import type { SessionManager } from '../channels/SessionManager';
import type { OrderService } from '../orders/OrderService';
import type { FillIntent, FillRecord } from '@shared/types/fill';

interface FillCoordinatorDependencies {
  readonly events: EventBus;
  readonly sessionManager: SessionManager;
  readonly orderService: OrderService;
}

export class FillCoordinator {
  constructor(private readonly deps: FillCoordinatorDependencies) {
    this.deps.events.on('fill.intent.received', (payload) => {
      const fill = payload as FillIntent;
      void this.initiateFill(fill);
    });
  }

  async initiateFill(intent: FillIntent): Promise<FillRecord> {
    // TODO: validation, residual checks, partial logic
    const record: FillRecord = {
      ...intent,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.deps.sessionManager.prepareFill(intent);
    this.deps.events.emit('fill.proposed', record);
    return record;
  }
}
