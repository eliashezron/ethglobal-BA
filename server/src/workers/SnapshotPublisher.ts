import type { ApplicationContext } from '../app';

export class SnapshotPublisher {
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly context: ApplicationContext) {}

  start() {
    this.interval = setInterval(() => this.tick(), 2_000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private tick() {
    // TODO: collect order book snapshot and push to subscribers.
    this.context.events.emit('orderbook.snapshot.publish', new Date().toISOString());
  }
}
