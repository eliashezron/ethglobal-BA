import type { ApplicationContext } from '../app';

export class ExpiryWorker {
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly context: ApplicationContext) {}

  start() {
    this.interval = setInterval(() => this.tick(), 5_000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private tick() {
    // TODO: scan storage for expired orders and emit cancellations.
    this.context.events.emit('orders.expiry.scan', new Date().toISOString());
  }
}
